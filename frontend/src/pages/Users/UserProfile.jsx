import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { getUser, updateUser } from '../../api/users'
import { registerFace, deleteFaceEncodings } from '../../api/face'
import { getUserAttendance } from '../../api/attendance'
import { getDepartments } from '../../api/departments'
import { enrollFingerprint, getUserFingerprints, deleteFingerprint } from '../../api/biometric'
import GuidedCapture from '../../components/GuidedCapture'
import DatasetUpload from '../../components/DatasetUpload'
import AttendanceTable from '../../components/AttendanceTable'
import ConfirmModal from '../../components/ConfirmModal'
import BiometricEnrollModal from '../../components/BiometricEnrollModal'
import { ToastContainer, useToast } from '../../components/Toast'
import {
  User, Camera, ClipboardList, Save, Trash2,
  Award, MapPin, Phone, Mail, Hash, Shield, ShieldCheck, Star, AlertCircle,
  Fingerprint, CheckCircle2
} from 'lucide-react'

const TABS = ['Profile', 'Attendance', 'Face Management', 'Biometric Fingerprint']

const QUALITY_COLOR = (q) => {
  if (!q) return 'text-slate-500'
  if (q >= 0.75) return 'text-emerald-400'
  if (q >= 0.5)  return 'text-amber-400'
  return 'text-rose-400'
}

const QUALITY_LABEL = (q) => {
  if (!q) return 'None'
  if (q >= 0.75) return 'Excellent'
  if (q >= 0.5)  return 'Good'
  return 'Low'
}

export default function UserProfile() {
  const { id }     = useParams()
  const navigate   = useNavigate()
  const { canManage, isAdmin, user: me } = useAuth()
  const { toasts, removeToast, toast }   = useToast()
  const [user, setUser]                  = useState(null)
  const [attendance, setAttendance]      = useState([])
  const [departments, setDepartments]    = useState([])
  const [tab, setTab]                    = useState(0)
  const [loading, setLoading]            = useState(true)
  const [saving, setSaving]              = useState(false)
  const [captures, setCaptures]          = useState([])
  const [confirmDeleteFace, setConfirmDeleteFace] = useState(false)
  const [editForm, setEditForm]          = useState({})
  const [imgError, setImgError]          = useState(false)
  const [imagePreview, setImagePreview]  = useState(null)
  const [fingerprints, setFingerprints]  = useState([])
  const [isEnrollModalOpen, setIsEnrollModalOpen] = useState(false)

  const isOwnProfile = me?.id === Number(id)

  const loadFingerprints = async () => {
    try {
      const fr = await getUserFingerprints(id)
      setFingerprints(fr.data.fingerprints || [])
    } catch {
      setFingerprints([])
    }
  }

  useEffect(() => {
    const load = async () => {
      try {
        const [ur, ar, dr] = await Promise.all([
          getUser(id),
          getUserAttendance(id),
          getDepartments(),
        ])
        setUser(ur.data.user)
        setEditForm(ur.data.user)
        setAttendance(ar.data.attendance)
        setDepartments(dr.data.departments)
        setImgError(false)
        setImagePreview(null)
        loadFingerprints()
      } catch {
        toast.error('Failed to load profile')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id])

  const handleSave = async () => {
    if (editForm.phone && !/^01\d{9}$/.test(editForm.phone)) {
      toast.error('Phone number must be an 11-digit Bangladeshi number starting with 01')
      return
    }
    setSaving(true)
    try {
      const res = await updateUser(id, {
        name:                editForm.name,
        email:               editForm.email,
        phone:               editForm.phone,
        dept_id:             editForm.dept_id,
        student_id:          editForm.student_id,
        role:                editForm.role,
        is_active:           editForm.is_active,
        weekly_target_hours: editForm.weekly_target_hours,
        image_b64:           editForm.image_b64,
      })
      if (res.data.pending) {
        toast.success(res.data.message || 'Profile changes submitted for admin approval')
      } else {
        toast.success('Profile updated')
      }
      const ur = await getUser(id)
      setUser(ur.data.user)
      setEditForm(ur.data.user)
      setImagePreview(null)
    } catch (err) {
      toast.error(err.response?.data?.message || 'Update failed')
    } finally {
      setSaving(false)
    }
  }

  const handleImageChange = (e) => {
    const file = e.target.files[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image size must be less than 5MB')
      return
    }
    const reader = new FileReader()
    reader.onloadend = () => {
      setImagePreview(reader.result)
      setEditForm(f => ({ ...f, image_b64: reader.result }))
    }
    reader.readAsDataURL(file)
  }

  const handleRegisterFace = async () => {
    if (!captures.length) { toast.warning('Capture face images first'); return }
    setSaving(true)
    try {
      const res = await registerFace(id, captures)
      toast[res.data.success ? 'success' : 'error'](res.data.message)
      if (res.data.success) {
        const ur = await getUser(id)
        setUser(ur.data.user)
        setImgError(false)
      }
    } catch {
      toast.error('Face registration failed')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteFace = async () => {
    try {
      await deleteFaceEncodings(id)
      toast.success('Face encodings deleted')
      const ur = await getUser(id)
      setUser(ur.data.user)
      setConfirmDeleteFace(false)
    } catch {
      toast.error('Failed to delete face encodings')
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (!user) return <div className="text-center py-20 text-slate-500">User not found</div>

  const hasValidImage = user.image_path && !imgError

  return (
    <div className="space-y-6 animate-fade-in max-w-5xl">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      {/* Alert banner if there's a pending change request */}
      {user.pending_profile_request && (
        <div className="card-glass border-amber-500/25 bg-amber-500/5 px-5 py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex gap-3">
            <AlertCircle className="text-amber-500 flex-shrink-0 mt-0.5" size={20} />
            <div>
              <h3 className="text-sm font-bold text-amber-500">Profile Changes Pending Approval</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                You have requested changes to your profile (
                {[
                  user.pending_profile_request.requested_name !== user.name ? 'Name' : null,
                  user.pending_profile_request.requested_phone !== user.phone ? 'Phone' : null,
                  user.pending_profile_request.requested_image_path ? 'Photo' : null
                ].filter(Boolean).join(', ')}
                ) which are currently awaiting administrator review.
              </p>
            </div>
          </div>
          <span className="text-[10px] uppercase font-bold text-amber-500/80 bg-amber-500/10 border border-amber-500/25 px-2.5 py-1 rounded-full flex-shrink-0">
            Awaiting Admin Review
          </span>
        </div>
      )}

      {confirmDeleteFace && (
        <ConfirmModal
          title="Delete Face Encodings"
          message="This will remove all face data for this user. They won't be recognized until re-registered."
          onConfirm={handleDeleteFace}
          onCancel={() => setConfirmDeleteFace(false)}
        />
      )}

      {/* ── Profile Header: Left image / Right info ──────────────────── */}
      <div className="card p-0 overflow-hidden">
        <div className="flex flex-col sm:flex-row">
          {/* LEFT — Profile photo */}
          <div
            className="flex-shrink-0 flex items-center justify-center sm:w-52 bg-gradient-to-br from-slate-800 to-slate-900 p-6"
            style={{ minHeight: '180px' }}
          >
            {imagePreview ? (
              <img
                src={imagePreview}
                alt={user.name}
                className="w-36 h-36 rounded-2xl object-cover border-2 border-cyan-500/40 shadow-xl shadow-cyan-500/10"
              />
            ) : hasValidImage ? (
              <img
                src={`/storage/${user.image_path}`}
                alt={user.name}
                onError={() => setImgError(true)}
                className="w-36 h-36 rounded-2xl object-cover border-2 border-cyan-500/40 shadow-xl shadow-cyan-500/10"
              />
            ) : (
              <div className="w-36 h-36 rounded-2xl bg-cyan-600/15 border-2 border-cyan-500/25 flex items-center justify-center">
                <span className="text-5xl font-black text-cyan-400">{user.name?.[0]?.toUpperCase()}</span>
              </div>
            )}
          </div>

          {/* RIGHT — User information */}
          <div className="flex-1 p-5 space-y-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <h1 className="text-xl font-black text-slate-100">{user.name}</h1>
                <p className="text-slate-400 text-sm capitalize mt-0.5">
                  {user.role} · {user.dept_name || 'No department'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className={`badge ${user.has_face ? 'badge-success' : 'badge-gray'}`}>
                  <Camera size={11} /> {user.has_face ? 'Face Registered' : 'No Face'}
                </span>
                <span className={`badge ${user.is_active ? 'badge-success' : 'badge-gray'}`}>
                  {user.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>

            {/* Info grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {user.student_id && (
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <Hash size={13} className="text-cyan-400" />
                  <span className="text-slate-300">{user.student_id}</span>
                </div>
              )}
              {user.email && (
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <Mail size={13} className="text-cyan-400" />
                  <span className="text-slate-300 truncate">{user.email}</span>
                </div>
              )}
              {user.phone && (
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <Phone size={13} className="text-cyan-400" />
                  <span className="text-slate-300">{user.phone}</span>
                </div>
              )}
              {user.dept_name && (
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <MapPin size={13} className="text-cyan-400" />
                  <span className="text-slate-300">{user.dept_name}</span>
                </div>
              )}
            </div>

            {/* Face quality indicator */}
            {user.has_face && (
              <div className="flex items-center gap-3 pt-1">
                <Star size={13} className={QUALITY_COLOR(user.face_quality_score)} />
                <span className={`text-xs font-medium ${QUALITY_COLOR(user.face_quality_score)}`}>
                  Face Quality: {QUALITY_LABEL(user.face_quality_score)}
                  {user.face_quality_score && ` (${Math.round(user.face_quality_score * 100)}%)`}
                </span>
                {user.face_count > 0 && (
                  <span className="text-xs text-slate-500">
                    · {user.face_count} encoding{user.face_count > 1 ? 's' : ''}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Tabs ──────────────────────────────────────────────────────── */}
      <div className="flex gap-1 bg-slate-800/60 p-1 rounded-xl w-fit">
        {TABS.map((t, i) => (
          <button
            key={t}
            onClick={() => setTab(i)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all
              ${tab === i ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ── Profile tab: Left form / Right read-only info ────────────── */}
      {tab === 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Profile photo card */}
          <div className="card flex flex-col items-center gap-4 py-6">
            {imagePreview ? (
              <img
                src={imagePreview}
                alt={user.name}
                className="w-32 h-32 rounded-2xl object-cover border-2 border-cyan-500/40 shadow-lg"
              />
            ) : hasValidImage ? (
              <img
                src={`/storage/${user.image_path}`}
                alt={user.name}
                onError={() => setImgError(true)}
                className="w-32 h-32 rounded-2xl object-cover border-2 border-cyan-500/40 shadow-lg"
              />
            ) : (
              <div className="w-32 h-32 rounded-2xl bg-cyan-600/15 border-2 border-cyan-500/20 flex items-center justify-center text-4xl font-black text-cyan-400">
                {user.name?.[0]?.toUpperCase()}
              </div>
            )}
            <div className="text-center">
              <p className="text-sm font-semibold text-slate-200">{user.name}</p>
              <p className="text-xs text-slate-500 capitalize mt-0.5">{user.role}</p>
            </div>
            {(canManage || isOwnProfile) && (
              <div className="mt-1">
                <input
                  type="file"
                  accept="image/*"
                  id="profile-pic-upload"
                  className="hidden"
                  onChange={handleImageChange}
                />
                <label
                  htmlFor="profile-pic-upload"
                  className="btn-secondary text-xs cursor-pointer py-1.5 px-3 flex items-center gap-1.5"
                >
                  <Camera size={12} /> Change Photo
                </label>
              </div>
            )}
            <div className="w-full space-y-2">
              <div className={`flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border
                ${user.has_face
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                  : 'bg-slate-800 border-slate-700 text-slate-500'}`}>
                <Camera size={12} />
                {user.has_face ? 'Face Registered' : 'No Face Data'}
              </div>
              {user.created_at && (
                <p className="text-xs text-slate-600 text-center">
                  Joined {new Date(user.created_at).toLocaleDateString()}
                </p>
              )}
            </div>
          </div>

          {/* Right: Edit form */}
          <div className="lg:col-span-2 card space-y-4">
            <h2 className="font-bold text-slate-100 text-sm flex items-center gap-2">
              <User size={15} className="text-cyan-400" /> Personal Information
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Full Name</label>
                <input
                  value={editForm.name || ''}
                  onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                  className="input"
                  disabled={!(canManage || isOwnProfile)}
                />
              </div>
              <div>
                <label className="label">Email (Username)</label>
                <input
                  value={editForm.email || ''}
                  onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))}
                  className="input"
                  disabled={!canManage}
                />
              </div>
              <div>
                <label className="label">User ID / Code</label>
                <input
                  value={editForm.student_id || ''}
                  onChange={e => setEditForm(f => ({ ...f, student_id: e.target.value }))}
                  className="input"
                  disabled={!canManage}
                />
              </div>
              <div>
                <label className="label">Phone (01XXXXXXXXX)</label>
                <input
                  value={editForm.phone || ''}
                  onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))}
                  className="input"
                  placeholder="01XXXXXXXXX"
                  disabled={!(canManage || isOwnProfile)}
                />
              </div>
              <div>
                <label className="label">Department</label>
                <select
                  value={editForm.dept_id || ''}
                  onChange={e => setEditForm(f => ({ ...f, dept_id: e.target.value }))}
                  className="select"
                  disabled={!canManage}
                >
                  <option value="">None</option>
                  {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              {canManage && (
                <div>
                  <label className="label">User Role</label>
                  <select
                    value={editForm.role === 'student' ? 'user' : (editForm.role || 'user')}
                    onChange={e => setEditForm(f => ({ ...f, role: e.target.value }))}
                    className="select"
                    disabled={!isAdmin}
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                    <option value="hr">HR</option>
                  </select>
                </div>
              )}
              {canManage && (
                <div>
                  <label className="label">Account Status</label>
                  <select
                    value={editForm.is_active ? 'active' : 'inactive'}
                    onChange={e => setEditForm(f => ({ ...f, is_active: e.target.value === 'active' }))}
                    className="select"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              )}
              {canManage && (
                <div>
                  <label className="label">Weekly Target Hours</label>
                  <input
                    type="number"
                    step="0.5"
                    value={editForm.weekly_target_hours || 40.0}
                    onChange={e => setEditForm(f => ({ ...f, weekly_target_hours: e.target.value }))}
                    className="input"
                  />
                </div>
              )}
            </div>
            {(canManage || isOwnProfile) && (
              <button onClick={handleSave} disabled={saving} className="btn-primary">
                <Save size={15} /> {saving ? 'Saving...' : 'Save Changes'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Attendance tab ─────────────────────────────────────────────── */}
      {tab === 1 && <AttendanceTable records={attendance} />}

      {/* ── Face Management tab ──────────────────────────────────────── */}
      {tab === 2 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Current face photo */}
          <div className="card flex flex-col items-center gap-4 py-6">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Current Profile Photo</p>
            {hasValidImage ? (
              <img
                src={`/storage/${user.image_path}`}
                alt={user.name}
                onError={() => setImgError(true)}
                className="w-32 h-32 rounded-2xl object-cover border-2 border-emerald-500/40 shadow-lg"
              />
            ) : (
              <div className="w-32 h-32 rounded-2xl bg-slate-800 border-2 border-dashed border-slate-600 flex items-center justify-center">
                <Camera size={28} className="text-slate-600" />
              </div>
            )}
            <div className={`w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border
              ${user.has_face
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : 'bg-slate-800 border-slate-700 text-slate-500'}`}>
              <Camera size={12} />
              {user.has_face ? `${user.face_count} encoding(s)` : 'Not Registered'}
            </div>
            {user.has_face && isAdmin && (
              <button
                onClick={() => setConfirmDeleteFace(true)}
                className="btn-danger w-full text-sm"
              >
                <Trash2 size={13} /> Delete Face Data
              </button>
            )}
          </div>

          {/* Right: AI-Guided Capture */}
          {(canManage || isOwnProfile) ? (
            <div className="lg:col-span-2 card space-y-4">
              <div>
                <h2 className="font-bold text-slate-100 flex items-center gap-2">
                  <Camera size={15} className="text-cyan-400" /> AI-Guided Face Registration
                </h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  {user.has_face
                    ? 'Register new face scans to update and expand your model. Best quality old scans will be kept automatically.'
                    : 'Position your face in the oval guide and capture multiple images from different angles for best accuracy.'}
                </p>
              </div>
              <GuidedCapture onCapture={setCaptures} maxImages={10} />
              <button
                onClick={handleRegisterFace}
                disabled={saving || captures.length === 0}
                className="btn-primary w-full"
                style={captures.length > 0 ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' } : {}}
              >
                <Camera size={15} />
                {saving ? 'Registering...' : `Register ${captures.length} Image(s)${captures.length >= 3 ? ' (Merged Encoding)' : ''}`}
              </button>
            </div>
          ) : (
            <div className="lg:col-span-2 card flex items-center justify-center py-16 text-slate-500">
              <p>Face management requires Admin or HR access.</p>
            </div>
          )}

          {/* ── Full-width Dataset Training card ─────────────────────────── */}
          {canManage && (
            <div className="lg:col-span-3">
              <DatasetUpload userId={user.id} userName={user.name} />
            </div>
          )}
        </div>
      )}

      {/* ── Biometric Fingerprint tab (Futronic FS80H) ────────────────────────── */}
      {tab === 3 && (
        <div className="card space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="font-bold text-slate-100 flex items-center gap-2">
                <Fingerprint className="text-cyan-400" size={18} /> Futronic FS80H Biometric Hardware Registration
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Register optical minutiae template from Futronic FS80H USB scanner for hardware attendance verification.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setIsEnrollModalOpen(true)}
                className="btn-primary gap-2 text-xs py-2 px-4"
              >
                <Fingerprint size={15} /> Register Fingerprint
              </button>
            </div>
          </div>

          {/* 3-Step Interactive Futronic FS80H Hardware Enrollment Modal */}
          <BiometricEnrollModal
            userId={user?.id || id}
            userName={user?.name || 'User'}
            isOpen={isEnrollModalOpen}
            onClose={() => setIsEnrollModalOpen(false)}
            onSuccess={() => {
              toast.success('Fingerprint registered successfully!')
              loadFingerprints()
            }}
          />

          <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold text-slate-200">Enrolled Hardware Biometrics ({fingerprints.length})</span>
              <span className="badge badge-success text-xs gap-1">
                <CheckCircle2 size={12} /> Futronic FS80H Active
              </span>
            </div>
            {fingerprints.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {fingerprints.map(fp => (
                  <div key={fp.id} className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/50 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
                        <Fingerprint size={20} />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-200">{fp.finger_name || 'Fingerprint'}</p>
                        <p className="text-xs text-slate-500">Quality: {fp.quality_score || 85}% · ANSI 378</p>
                      </div>
                    </div>
                    {canManage && (
                      <button
                        onClick={async () => {
                          try {
                            await deleteFingerprint(fp.id)
                            toast.success('Fingerprint removed')
                            loadFingerprints()
                          } catch {
                            toast.error('Delete failed')
                          }
                        }}
                        className="btn-icon text-rose-400 hover:bg-rose-500/10"
                        title="Delete Fingerprint"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 text-slate-500 text-xs">
                No fingerprints enrolled yet. Click "Enroll Fingerprint (FS80H)" above to register.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
