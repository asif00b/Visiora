import { useEffect, useState } from 'react'
import { getSessions, createSession, updateSession, deleteSession } from '../api/sessions'
import ConfirmModal from '../components/ConfirmModal'
import { ToastContainer, useToast } from '../components/Toast'
import { Calendar, Plus, Pencil, Trash2, Check, X, Clock, AlertCircle } from 'lucide-react'

const EMPTY = { name: '', description: '', start_time: '', end_time: '', allow_multiple: false, cooldown_minutes: 10, is_active: true }

export default function Sessions() {
  const { toasts, removeToast, toast } = useToast()
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(EMPTY)
  const [editId, setEditId] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [showForm, setShowForm] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const res = await getSessions()
      setSessions(res.data.sessions)
    } catch { toast.error('Failed to load') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      if (editId) { await updateSession(editId, form); toast.success('Session updated') }
      else { await createSession(form); toast.success('Session created') }
      setForm(EMPTY); setEditId(null); setShowForm(false)
      load()
    } catch (err) { toast.error(err.response?.data?.message || 'Failed') }
  }

  const startEdit = (s) => {
    setForm({ ...s, start_time: s.start_time || '', end_time: s.end_time || '' })
    setEditId(s.id)
    setShowForm(true)
  }

  const handleDelete = async () => {
    try {
      await deleteSession(deleteTarget.id)
      toast.success('Deleted')
      setDeleteTarget(null)
      load()
    } catch { toast.error('Failed to delete') }
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl">
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      {deleteTarget && (
        <ConfirmModal title="Delete Session" message={`Delete "${deleteTarget.name}"?`} onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} />
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="section-title">Sessions</h1>
          <p className="section-subtitle">Manage class/shift attendance windows</p>
        </div>
        <button onClick={() => { setForm(EMPTY); setEditId(null); setShowForm(v => !v) }} className="btn-primary">
          <Plus size={16} /> {showForm && !editId ? 'Cancel' : 'New Session'}
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="card space-y-4">
          <h2 className="font-semibold text-slate-300">{editId ? 'Edit Session' : 'New Session'}</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="label">Session Name *</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="input" placeholder="Morning Class / Office Shift A" required />
            </div>
            <div>
              <label className="label">Start Time</label>
              <input type="time" value={form.start_time} onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))} className="input" />
            </div>
            <div>
              <label className="label">End Time</label>
              <input type="time" value={form.end_time} onChange={e => setForm(f => ({ ...f, end_time: e.target.value }))} className="input" />
            </div>
            <div>
              <label className="label">Cooldown (minutes)</label>
              <input type="number" min="0" value={form.cooldown_minutes} onChange={e => setForm(f => ({ ...f, cooldown_minutes: e.target.value }))} className="input" />
            </div>
            <div className="flex flex-col gap-2 pt-5">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.allow_multiple} onChange={e => setForm(f => ({ ...f, allow_multiple: e.target.checked }))} className="w-4 h-4 accent-cyan-500" />
                <span className="text-sm text-slate-300">Allow multiple per day</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} className="w-4 h-4 accent-cyan-500" />
                <span className="text-sm text-slate-300">Active</span>
              </label>
            </div>
          </div>
          <div className="flex gap-3">
            <button type="submit" className="btn-primary">{editId ? 'Update' : 'Create'}</button>
            <button type="button" onClick={() => { setShowForm(false); setEditId(null) }} className="btn-secondary">Cancel</button>
          </div>
        </form>
      )}

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="space-y-3">
          {sessions.map(s => (
            <div key={s.id} className={`card py-4 border ${s.is_currently_active ? 'border-emerald-500/40 glow-emerald' : ''}`}>
              <div className="flex items-start gap-4">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${s.is_currently_active ? 'bg-emerald-500/20 text-emerald-400' : 'bg-cyan-600/15 text-cyan-400'}`}>
                  <Calendar size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-slate-200">{s.name}</p>
                    {s.is_currently_active && <span className="badge-success">● Active Now</span>}
                    {!s.is_active && <span className="badge-gray">Inactive</span>}
                  </div>
                  <div className="flex flex-wrap gap-3 mt-1 text-xs text-slate-500">
                    {s.start_time && <span className="flex items-center gap-1"><Clock size={11} /> {s.start_time}–{s.end_time}</span>}
                    <span className="flex items-center gap-1"><AlertCircle size={11} /> {s.cooldown_minutes}min cooldown</span>
                    {s.allow_multiple && <span>Multiple/day allowed</span>}
                  </div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => startEdit(s)} className="btn-icon"><Pencil size={14} /></button>
                  <button onClick={() => setDeleteTarget(s)} className="btn-icon hover:text-rose-400"><Trash2 size={14} /></button>
                </div>
              </div>
            </div>
          ))}
          {!sessions.length && <p className="text-center text-slate-500 py-8">No sessions. Create one above.</p>}
        </div>
      )}
    </div>
  )
}
