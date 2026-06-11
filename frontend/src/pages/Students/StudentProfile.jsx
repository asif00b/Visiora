import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { getUser, updateUser } from '../../api/users'
import { registerFace, deleteFaceEncodings } from '../../api/face'
import { getUserAttendance } from '../../api/attendance'
import { getDepartments } from '../../api/departments'
import GuidedCapture from '../../components/GuidedCapture'
import DatasetUpload from '../../components/DatasetUpload'
import AttendanceTable from '../../components/AttendanceTable'
import ConfirmModal from '../../components/ConfirmModal'
import { ToastContainer, useToast } from '../../components/Toast'
import {
  User, Camera, ClipboardList, Save, Trash2,
  Award, MapPin, Phone, Mail, Hash, Shield, Star
} from 'lucide-react'

const TABS = ['Profile', 'Attendance', 'Face Management']

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

export default function StudentProfile() {
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
      } catch {
        toast.error('Failed to load profile')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id])

  const handleSave = async () => {
    setSaving(true)
    try {
      await updateUser(id, {
        name:       editForm.name,
        email:      editForm.email,
        phone:      editForm.phone,
        dept_id:    editForm.dept_id,
        student_id: editForm.student_id,
      })
      toast.success('Profile updated')
    } catch (err) {
      toast.error(err.response?.data?.message || 'Update failed')
    } finally {
      setSaving(false)
    }
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
      <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (!user) return <div className="text-center py-20 text-slate-500">User not found</div>

  const hasValidImage = user.image_path && !imgError

  return (
    <div className="space-y-6 animate-fade-in max-w-5xl">
      <ToastContainer toasts={toasts} removeToast={removeToast} />
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
            {hasValidImage ? (
              <img
                src={`/storage/${user.image_path}`}
                alt={user.name}
                onError={() => setImgError(true)}
                className="w-36 h-36 rounded-2xl object-cover border-2 border-indigo-500/40 shadow-xl shadow-indigo-500/10"
              />
            ) : (
              <div className="w-36 h-36 rounded-2xl bg-indigo-600/20 border-2 border-indigo-500/30 flex items-center justify-center">
                <span className="text-5xl font-black text-indigo-400">{user.name?.[0]?.toUpperCase()}</span>
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
                  <Hash size={13} className="text-indigo-400" />
                  <span className="text-slate-300">{user.student_id}</span>
                </div>
              )}
              {user.email && (
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <Mail size={13} className="text-indigo-400" />
                  <span className="text-slate-300 truncate">{user.email}</span>
                </div>
              )}
              {user.phone && (
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <Phone size={13} className="text-indigo-400" />
                  <span className="text-slate-300">{user.phone}</span>
                </div>
              )}
              {user.dept_name && (
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <MapPin size={13} className="text-indigo-400" />
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
              ${tab === i ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
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
            {hasValidImage ? (
              <img
                src={`/storage/${user.image_path}`}
                alt={user.name}
                onError={() => setImgError(true)}
                className="w-32 h-32 rounded-2xl object-cover border-2 border-indigo-500/40 shadow-lg"
              />
            ) : (
              <div className="w-32 h-32 rounded-2xl bg-indigo-600/20 border-2 border-indigo-500/20 flex items-center justify-center text-4xl font-black text-indigo-400">
                {user.name?.[0]?.toUpperCase()}
              </div>
            )}
            <div className="text-center">
              <p className="text-sm font-semibold text-slate-200">{user.name}</p>
              <p className="text-xs text-slate-500 capitalize mt-0.5">{user.role}</p>
            </div>
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
              <User size={15} className="text-indigo-400" /> Personal Information
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Full Name</label>
                <input
                  value={editForm.name || ''}
                  onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                  className="input"
                  disabled={!canManage}
                />
              </div>
              <div>
                <label className="label">Email</label>
                <input
                  value={editForm.email || ''}
                  onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))}
                  className="input"
                  disabled={!canManage}
                />
              </div>
              <div>
                <label className="label">Student / Staff ID</label>
                <input
                  value={editForm.student_id || ''}
                  onChange={e => setEditForm(f => ({ ...f, student_id: e.target.value }))}
                  className="input"
                  disabled={!canManage}
                />
              </div>
              <div>
                <label className="label">Phone</label>
                <input
                  value={editForm.phone || ''}
                  onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))}
                  className="input"
                  disabled={!canManage}
                />
              </div>
              <div className="col-span-2">
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
            </div>
            {canManage && (
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
          {canManage ? (
            <div className="lg:col-span-2 card space-y-4">
              <div>
                <h2 className="font-bold text-slate-100 flex items-center gap-2">
                  <Camera size={15} className="text-indigo-400" /> AI-Guided Face Registration
                </h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  {user.has_face
                    ? 'Re-register to replace the current face data with better quality images.'
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
    </div>
  )
}
