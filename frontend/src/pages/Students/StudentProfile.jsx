import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { getUser, updateUser } from '../../api/users'
import { registerFace, deleteFaceEncodings } from '../../api/face'
import { getUserAttendance } from '../../api/attendance'
import { getDepartments } from '../../api/departments'
import CameraCapture from '../../components/CameraCapture'
import AttendanceTable from '../../components/AttendanceTable'
import ConfirmModal from '../../components/ConfirmModal'
import { ToastContainer, useToast } from '../../components/Toast'
import { User, Camera, ClipboardList, Save, Trash2 } from 'lucide-react'

const TABS = ['Profile', 'Attendance', 'Face Management']

export default function StudentProfile() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { canManage, isAdmin, user: me } = useAuth()
  const { toasts, removeToast, toast } = useToast()
  const [user, setUser] = useState(null)
  const [attendance, setAttendance] = useState([])
  const [departments, setDepartments] = useState([])
  const [tab, setTab] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [captures, setCaptures] = useState([])
  const [confirmDeleteFace, setConfirmDeleteFace] = useState(false)
  const [editForm, setEditForm] = useState({})

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
        name: editForm.name,
        email: editForm.email,
        phone: editForm.phone,
        dept_id: editForm.dept_id,
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

  return (
    <div className="space-y-6 animate-fade-in max-w-4xl">
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      {confirmDeleteFace && (
        <ConfirmModal
          title="Delete Face Encodings"
          message="This will remove all face data for this user. They won't be recognized until re-registered."
          onConfirm={handleDeleteFace}
          onCancel={() => setConfirmDeleteFace(false)}
        />
      )}

      {/* Header */}
      <div className="flex items-center gap-4">
        {user.image_path ? (
          <img
            src={`/storage/${user.image_path}`}
            alt={user.name}
            className="w-16 h-16 rounded-2xl object-cover border-2 border-indigo-500/40 shadow-lg"
          />
        ) : (
          <div className="w-16 h-16 rounded-2xl bg-indigo-600/20 border-2 border-indigo-500/20 flex items-center justify-center text-2xl font-bold text-indigo-400">
            {user.name[0]}
          </div>
        )}
        <div>
          <h1 className="section-title">{user.name}</h1>
          <p className="section-subtitle capitalize">{user.role} · {user.dept_name || 'No department'}</p>
        </div>
        <div className="ml-auto flex gap-2">
          <span className={`badge ${user.has_face ? 'badge-success' : 'badge-gray'}`}>
            <Camera size={11} /> {user.has_face ? 'Face registered' : 'No face'}
          </span>
        </div>
      </div>

      {/* Tabs */}
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

      {/* Profile tab */}
      {tab === 0 && (
        <div className="card space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Full Name</label>
              <input value={editForm.name || ''} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} className="input" disabled={!canManage} />
            </div>
            <div>
              <label className="label">Email</label>
              <input value={editForm.email || ''} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} className="input" disabled={!canManage} />
            </div>
            <div>
              <label className="label">Student / Staff ID</label>
              <input value={editForm.student_id || ''} onChange={e => setEditForm(f => ({ ...f, student_id: e.target.value }))} className="input" disabled={!canManage} />
            </div>
            <div>
              <label className="label">Phone</label>
              <input value={editForm.phone || ''} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} className="input" disabled={!canManage} />
            </div>
            <div>
              <label className="label">Department</label>
              <select value={editForm.dept_id || ''} onChange={e => setEditForm(f => ({ ...f, dept_id: e.target.value }))} className="select" disabled={!canManage}>
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
      )}

      {/* Attendance tab */}
      {tab === 1 && <AttendanceTable records={attendance} />}

      {/* Face tab */}
      {tab === 2 && canManage && (
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-bold text-slate-100">Face Registration</h2>
              <p className="text-sm text-slate-500">
                {user.has_face
                  ? 'Image registered. Capture new images to replace.'
                  : 'No face registered yet. Capture 3–5 images for best accuracy.'}
              </p>
            </div>
            {user.has_face && isAdmin && (
              <button onClick={() => setConfirmDeleteFace(true)} className="btn-danger">
                <Trash2 size={14} /> Delete All
              </button>
            )}
          </div>
          <CameraCapture onCapture={setCaptures} maxImages={10} />
          <button
            onClick={handleRegisterFace}
            disabled={saving || captures.length === 0}
            className="btn-primary w-full"
          >
            <Camera size={15} /> {saving ? 'Registering...' : `Add ${captures.length} Image(s)`}
          </button>
        </div>
      )}
    </div>
  )
}
