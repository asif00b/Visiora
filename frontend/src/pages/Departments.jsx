import { useEffect, useState } from 'react'
import { getDepartments, createDepartment, updateDepartment, deleteDepartment } from '../api/departments'
import ConfirmModal from '../components/ConfirmModal'
import { ToastContainer, useToast } from '../components/Toast'
import { Building2, Plus, Pencil, Trash2, Check, X } from 'lucide-react'

export default function Departments() {
  const { toasts, removeToast, toast } = useToast()
  const [depts, setDepts] = useState([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [editing, setEditing] = useState(null) // {id, name, description}
  const [deleteTarget, setDeleteTarget] = useState(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await getDepartments()
      setDepts(res.data.departments)
    } catch { toast.error('Failed to load') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const handleCreate = async (e) => {
    e.preventDefault()
    if (!newName.trim()) return
    try {
      await createDepartment({ name: newName.trim(), description: newDesc.trim() })
      toast.success('Department created')
      setNewName(''); setNewDesc('')
      load()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed')
    }
  }

  const handleUpdate = async (id) => {
    try {
      await updateDepartment(id, { name: editing.name, description: editing.description })
      toast.success('Updated')
      setEditing(null)
      load()
    } catch (err) { toast.error(err.response?.data?.message || 'Failed') }
  }

  const handleDelete = async () => {
    try {
      await deleteDepartment(deleteTarget.id)
      toast.success('Deleted')
      setDeleteTarget(null)
      load()
    } catch (err) { toast.error(err.response?.data?.message || 'Cannot delete') }
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      {deleteTarget && (
        <ConfirmModal
          title="Delete Department"
          message={`Delete "${deleteTarget.name}"? All users must be reassigned first.`}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      <div>
        <h1 className="section-title">Departments</h1>
        <p className="section-subtitle">Manage organizational departments</p>
      </div>

      {/* Add form */}
      <form onSubmit={handleCreate} className="card space-y-3">
        <h2 className="font-semibold text-slate-300 flex items-center gap-2"><Plus size={16} /> New Department</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Name *</label>
            <input value={newName} onChange={e => setNewName(e.target.value)} className="input" placeholder="Computer Science" required />
          </div>
          <div>
            <label className="label">Description</label>
            <input value={newDesc} onChange={e => setNewDesc(e.target.value)} className="input" placeholder="Optional" />
          </div>
        </div>
        <button id="create-dept-btn" type="submit" className="btn-primary">
          <Plus size={15} /> Create
        </button>
      </form>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-10">
          <div className="w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-2">
          {depts.map(dept => (
            <div key={dept.id} className="card py-3 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-cyan-600/15 border border-cyan-500/20 flex items-center justify-center flex-shrink-0">
                <Building2 size={18} className="text-cyan-400" />
              </div>
              {editing?.id === dept.id ? (
                <div className="flex-1 flex gap-2">
                  <input value={editing.name} onChange={e => setEditing(v => ({ ...v, name: e.target.value }))} className="input flex-1" />
                  <button onClick={() => handleUpdate(dept.id)} className="btn-success p-2"><Check size={14} /></button>
                  <button onClick={() => setEditing(null)} className="btn-secondary p-2"><X size={14} /></button>
                </div>
              ) : (
                <>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-200">{dept.name}</p>
                    <p className="text-xs text-slate-500">{dept.member_count} member{dept.member_count !== 1 ? 's' : ''}{dept.description ? ` · ${dept.description}` : ''}</p>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => setEditing(dept)} className="btn-icon"><Pencil size={14} /></button>
                    <button onClick={() => setDeleteTarget(dept)} className="btn-icon hover:text-rose-400"><Trash2 size={14} /></button>
                  </div>
                </>
              )}
            </div>
          ))}
          {!depts.length && <p className="text-center text-slate-500 py-8">No departments yet</p>}
        </div>
      )}
    </div>
  )
}
