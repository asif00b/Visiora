"""
reset_db.py — Drop all tables and recreate them fresh.
Run this ONCE if you get 'Unknown column' errors from schema changes.
"""
import pymysql
import sys

HOST     = 'localhost'
PORT     = 3306
USER     = 'root'
PASSWORD = ''
DB_NAME  = 'attendance_db'

print(f"\nResetting database '{DB_NAME}'...")

try:
    conn = pymysql.connect(
        host=HOST, port=PORT, user=USER, password=PASSWORD,
        database=DB_NAME, charset='utf8mb4', connect_timeout=5,
    )
    cursor = conn.cursor()

    cursor.execute('SET FOREIGN_KEY_CHECKS = 0;')

    # Drop all known tables in dependency order
    tables = [
        'attendance',
        'face_encodings',
        'unknown_faces',
        'sessions',
        'users',
        'departments',
        'system_config',
    ]
    for t in tables:
        cursor.execute(f'DROP TABLE IF EXISTS `{t}`;')
        print(f'  Dropped table: {t}')

    cursor.execute('SET FOREIGN_KEY_CHECKS = 1;')
    conn.commit()
    cursor.close()
    conn.close()

    print('\n[OK] All old tables dropped.')
    print('[OK] Run app.py now — tables will be recreated with the correct schema.')
    print('[OK] Default admin account will be seeded automatically.\n')

except pymysql.err.OperationalError as e:
    print(f'[ERROR] {e}')
    sys.exit(1)
