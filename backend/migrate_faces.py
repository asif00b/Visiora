"""
migrate_faces.py — One-time migration script
=============================================
For each user with multiple stored face encodings:
  1. Load all their face images from disk
  2. Score each image (sharpness + face size + brightness)
  3. Keep the best image → rename to {user_id}.jpg
  4. Delete all other images + their DB rows
  5. Recompute encoding from the best image (stored as new single row)

Run ONCE with the Flask app NOT running (stop app.py first):
    python migrate_faces.py

After this script, restart app.py normally.
"""

import os
import sys

# ── Ensure we're running from the backend directory ──────────────────────────
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
os.chdir(BACKEND_DIR)
sys.path.insert(0, BACKEND_DIR)

# ── Bootstrap Flask app context ───────────────────────────────────────────────
from app import create_app
app = create_app()

with app.app_context():
    import base64
    import json
    from database import db
    from models.user import User
    from models.face_encoding import FaceEncoding
    from face_engine.encoder import FaceEngine, score_image_quality, select_best_image
    import numpy as np

    try:
        import cv2
        CV2 = True
    except ImportError:
        CV2 = False

    try:
        import face_recognition
        FR = True
    except ImportError:
        FR = False
        print('[ERROR] face_recognition not installed. Cannot migrate.')
        sys.exit(1)

    engine        = FaceEngine.get_instance()
    storage_root  = os.path.join(BACKEND_DIR, '..', 'storage')
    known_dir     = os.path.join(storage_root, 'known_faces')

    print('\n' + '='*60)
    print('  Face Storage Migration')
    print('='*60 + '\n')

    users = User.query.filter_by(is_active=True).all()
    print(f'Total active users: {len(users)}\n')

    migrated  = 0
    skipped   = 0
    errors_ct = 0

    for user in users:
        encodings = (
            FaceEncoding.query
            .filter_by(user_id=user.id)
            .all()
        )

        if not encodings:
            print(f'  [{user.id}] {user.name:<30} — no face data, skip')
            skipped += 1
            continue

        if len(encodings) == 1:
            # Single encoding: ensure image is named {user_id}.jpg
            enc = encodings[0]
            if enc.image_path:
                src = os.path.join(storage_root, enc.image_path)
                dst = os.path.join(known_dir, f'{user.id}.jpg')
                if os.path.exists(src) and src != dst:
                    os.replace(src, dst)
                    enc.image_path = f'known_faces/{user.id}.jpg'
                    user.image_path = enc.image_path
                    db.session.commit()
            print(f'  [{user.id}] {user.name:<30} — already 1 encoding, renamed if needed')
            skipped += 1
            continue

        print(f'  [{user.id}] {user.name:<30} — {len(encodings)} encodings, selecting best...')

        # ── Load and score each encoding's source image ───────────────────────
        candidates = []
        for enc in encodings:
            img_path = os.path.join(storage_root, enc.image_path) if enc.image_path else None

            if img_path and os.path.exists(img_path):
                try:
                    if CV2:
                        bgr = cv2.imread(img_path)
                        if bgr is None:
                            raise ValueError('cv2 returned None')
                        image_rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
                    else:
                        from PIL import Image
                        image_rgb = np.array(Image.open(img_path).convert('RGB'))

                    # Detect face location for scoring
                    locations = face_recognition.face_locations(
                        image_rgb, model='hog', number_of_times_to_upsample=1
                    )
                    face_box = locations[0] if locations else (0, image_rgb.shape[1], image_rgb.shape[0], 0)
                    quality  = score_image_quality(image_rgb, face_box)

                    # Re-encode from this image for clean vector
                    new_encs = face_recognition.face_encodings(image_rgb, [face_box], num_jitters=1)
                    encoding = new_encs[0] if new_encs else np.array(enc.get_encoding())

                    candidates.append({
                        'enc_obj':      enc,
                        'image_path':   img_path,
                        'image_rgb':    image_rgb,
                        'encoding':     encoding,
                        'quality_score': quality,
                        'face_box':     face_box,
                    })
                except Exception as e:
                    print(f'    [WARN] Could not load image {img_path}: {e}')
                    # Fall back to DB encoding without image scoring
                    candidates.append({
                        'enc_obj':      enc,
                        'image_path':   img_path,
                        'image_rgb':    None,
                        'encoding':     np.array(enc.get_encoding()),
                        'quality_score': enc.quality_score or 0.0,
                        'face_box':     None,
                    })
            else:
                # No image on disk — use quality_score from DB
                candidates.append({
                    'enc_obj':      enc,
                    'image_path':   img_path,
                    'image_rgb':    None,
                    'encoding':     np.array(enc.get_encoding()),
                    'quality_score': enc.quality_score or 0.0,
                    'face_box':     None,
                })

        if not candidates:
            print(f'    [WARN] No candidates for {user.name}, skipping')
            errors_ct += 1
            continue

        # ── Select best ───────────────────────────────────────────────────────
        best = max(candidates, key=lambda c: c['quality_score'])
        print(f'    Best quality: {round(best["quality_score"] * 100)}% '
              f'(from {os.path.basename(best["image_path"] or "unknown")})')

        # ── Save best image as {user_id}.jpg ──────────────────────────────────
        dst = os.path.join(known_dir, f'{user.id}.jpg')
        if best['image_path'] and os.path.exists(best['image_path']):
            if best['image_path'] != dst:
                import shutil
                shutil.copy2(best['image_path'], dst)

        canonical_path = f'known_faces/{user.id}.jpg'

        # ── Delete all old DB rows except the best; update best row ──────────
        best_enc = best['enc_obj']
        for c in candidates:
            if c['enc_obj'].id == best_enc.id:
                continue
            # Delete old image file
            if c['image_path'] and os.path.exists(c['image_path']):
                try:
                    os.remove(c['image_path'])
                except Exception:
                    pass
            db.session.delete(c['enc_obj'])

        # Update best encoding row
        best_enc.set_encoding(best['encoding'])
        best_enc.quality_score = best['quality_score']
        best_enc.image_path    = canonical_path

        # Update user profile image
        user.image_path = canonical_path

        db.session.commit()
        print(f'    Kept 1 encoding, deleted {len(candidates)-1} old row(s).')
        migrated += 1

    # ── Rebuild in-memory cache ───────────────────────────────────────────────
    print('\nRebuilding face recognition cache...')
    engine.load_from_db()
    print(f'Cache: {engine.cache_size()} encoding(s) loaded for {len(engine._cache)} users.')

    print('\n' + '='*60)
    print(f'  Migration complete.')
    print(f'  Migrated (multi → single): {migrated}')
    print(f'  Already clean (skipped):   {skipped}')
    print(f'  Errors:                    {errors_ct}')
    print('='*60 + '\n')
