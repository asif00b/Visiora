import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getDepartments } from '../../api/departments'
import { createUser } from '../../api/users'
import { registerFace } from '../../api/face'
import CameraCapture from '../../components/CameraCapture'
import { ToastContainer, useToast } from '../../components/Toast'
import { UserPlus, ChevronRight, ChevronLeft, CheckCircle } from 'lucide-react'

const STEPS = ['Personal Info', 'Face Registration', 'Done']

export default function StudentRegister() {
  const navigate = useNavigate()
  const { toasts, removeToast, toast } = useToast()
  const [step, setStep] = useState(0)
  const [departments, setDepartments] = useState([])
  const [form, setForm] = useState({
    name: '', email: '', password: '', role: 'student',
    student_id: '', phone: '', dept_id: '', image_b64: ''
  })
  const [capturedImages, setCapturedImages] = useState([])
  const [createdUser, setCreatedUser] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    getDepartments().then(r => setDepartments(r.data.departments)).catch(() => {})
  }, [])

  const handleField = (e) => setForm(f => ({ ...f, [e.target.name]: e.target.value }))

  // Step 1: Create user
  const handleCreateUser = async (e) => {
    e.preventDefault()
    if (!form.password || form.password.length < 4) {
      toast.error('Password must be at least 4 characters')
      return
    }
    setLoading(true)
    try {
      const payload = { ...form }
      if (capturedImages.length > 0) payload.image_b64 = capturedImages[0]
      const res = await createUser(payload)
      setCreatedUser(res.data.user)
      toast.success('User created successfully!')
      setStep(1)
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to create user')
    } finally {
      setLoading(false)
    }
  }

  // Step 2: Register face
  const handleRegisterFace = async () => {
    if (capturedImages.length === 0) {
      toast.warning('Capture at least 1 face image')
      return
    }
    setLoading(true)
    try {
      const res = await registerFace(createdUser.id, capturedImages)
      if (res.data.success) {
        toast.success(`${res.data.saved} face image(s) registered!`)
        setStep(2)
      } else {
        toast.error(res.data.message || 'No faces detected in images')
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Face registration failed')
    } finally {
      setLoading(false)
    }
  }

  const handleSkipFace = () => setStep(2)

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      <div>
        <h1 className="section-title">Register New User</h1>
        <p className="section-subtitle">Create account and capture face for recognition</p>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2 mb-2">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all
              ${i < step ? 'bg-emerald-600 text-white' : i === step ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-500'}`}>
              {i < step ? <CheckCircle size={14} /> : i + 1}
            </div>
            <span className={`text-sm font-medium ${i === step ? 'text-slate-200' : 'text-slate-500'}`}>{s}</span>
            {i < STEPS.length - 1 && <div className={`flex-1 h-px ${i < step ? 'bg-emerald-600' : 'bg-slate-700'} w-8`} />}
          </div>
        ))}
      </div>

      {/* Step 0 — Info */}
      {step === 0 && (
        <form onSubmit={handleCreateUser} className="card space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="label">Full Name *</label>
              <input name="name" value={form.name} onChange={handleField} className="input" placeholder="John Doe" required />
            </div>
            <div>
              <label className="label">Email *</label>
              <input name="email" type="email" value={form.email} onChange={handleField} className="input" placeholder="john@example.com" required />
            </div>
            <div>
              <label className="label">Password *</label>
              <input name="password" type="password" value={form.password} onChange={handleField} className="input" placeholder="Min 4 chars" required />
            </div>
            <div>
              <label className="label">Student / Staff ID</label>
              <input name="student_id" value={form.student_id} onChange={handleField} className="input" placeholder="STU001" />
            </div>
            <div>
              <label className="label">Phone</label>
              <input name="phone" value={form.phone} onChange={handleField} className="input" placeholder="+1234567890" />
            </div>
            <div>
              <label className="label">Department</label>
              <select name="dept_id" value={form.dept_id} onChange={handleField} className="select">
                <option value="">Select Department</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Role</label>
              <select name="role" value={form.role} onChange={handleField} className="select">
                <option value="student">Student</option>
                <option value="hr">HR</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>

          <button
            id="create-user-submit"
            type="submit"
            disabled={loading}
            className="btn-primary w-full"
          >
            {loading ? 'Creating...' : <><ChevronRight size={16} /> Create User & Continue</>}
          </button>
        </form>
      )}

      {/* Step 1 — Face */}
      {step === 1 && (
        <div className="card space-y-4">
          <div>
            <h2 className="font-bold text-slate-100">Capture Face Images</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Capture 5–10 photos for best accuracy. Slightly vary the angle each time.
            </p>
          </div>
          <CameraCapture onCapture={setCapturedImages} maxImages={10} />
          <div className="flex gap-3 pt-2">
            <button onClick={handleSkipFace} className="btn-secondary flex-1">
              Skip (add later)
            </button>
            <button
              id="register-face-btn"
              onClick={handleRegisterFace}
              disabled={loading || capturedImages.length === 0}
              className="btn-primary flex-1"
            >
              {loading ? 'Registering...' : `Register ${capturedImages.length} Image(s)`}
            </button>
          </div>
        </div>
      )}

      {/* Step 2 — Done */}
      {step === 2 && (
        <div className="card text-center py-10">
          <div className="w-16 h-16 rounded-full bg-emerald-500/15 flex items-center justify-center mx-auto mb-4">
            <CheckCircle size={32} className="text-emerald-400" />
          </div>
          <h2 className="text-xl font-bold text-slate-100">Registration Complete!</h2>
          <p className="text-slate-500 mt-1 text-sm mb-6">
            {createdUser?.name} has been registered successfully.
          </p>
          <div className="flex gap-3 justify-center">
            <button onClick={() => navigate(`/students/${createdUser.id}`)} className="btn-secondary">
              View Profile
            </button>
            <button onClick={() => { setStep(0); setCreatedUser(null); setCapturedImages([]); setForm({ name:'',email:'',password:'',role:'student',student_id:'',phone:'',dept_id:'',image_b64:'' }) }} className="btn-primary">
              <UserPlus size={16} /> Register Another
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
