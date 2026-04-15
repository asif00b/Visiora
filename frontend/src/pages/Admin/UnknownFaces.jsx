import { useEffect, useState } from 'react'
import { getUnknownFaces, assignUnknownFace, deleteUnknownFace } from '../../api/admin'
import { getUsers } from '../../api/users'
import { ToastContainer, useToast } from '../../components/Toast'
import ConfirmModal from '../../components/ConfirmModal'
import { AlertCircle, UserCheck, Trash2, X } from 'lucide-react'
import { format } from 'date-fns'

export default function UnknownFaces() {
  const { toasts, removeToast, toast } = useToast()
  const [unknowns, setUnknowns] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [assigning, setAssigning] = useState(null) // {id, selectedUser: ''}
  const [deleteTarget, setDeleteTarget] = useState(null)

  const load = async () => {
    setLoading(true)
    try {
      const [ur, usr] = await Promise.all([getUnknownFaces(), getUsers()])
      setUnknowns(ur.data.unknown_faces)
      setUsers(usr.data.users)
    } catch { toast.error('Failed to load') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const handleAssign = async () => {
    if (!assigning?.selectedUser) { toast.warning('Select a user'); return }
    try {
      await assignUnknownFace(assigning.id, parseInt(assigning.selectedUser))
      toast.success('Assigned successfully')
      setAssigning(null)
      load()
    } catch { toast.error('Assignment failed') }
  }

  const handleDelete = async () => {
    try {
      await deleteUnknownFace(deleteTarget.id)
      toast.success('Deleted')
      setDeleteTarget(null)
      load()
    } catch { toast.error('Delete failed') }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      {deleteTarget && (
        <ConfirmModal title="Delete Unknown Face" message="Delete this unknown face snapshot?" onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} />
      )}

      <div>
        <h1 className="section-title">Unknown Faces</h1>
        <p className="section-subtitle">Review and assign unrecognized face captures</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : !unknowns.length ? (
        <div className="text-center py-20 text-slate-500">
          <AlertCircle size={40} className="mx-auto mb-3 text-slate-600" />
          <p className="font-medium">No unknown faces captured</p>
          <p className="text-sm mt-1">Unknown faces will appear here when the scanner detects them</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {unknowns.map(face => (
            <div key={face.id} className="card p-3 space-y-2">
              <div className="relative rounded-xl overflow-hidden bg-slate-800 aspect-square">
                <img
                  src={`/storage/${face.image_path}`}
                  alt={`Unknown ${face.id}`}
                  className="w-full h-full object-cover"
                  onError={e => { e.target.style.display = 'none' }}
                />
                <button
                  onClick={() => setDeleteTarget(face)}
                  className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center text-rose-400 hover:bg-rose-500/20 transition-colors"
                >
                  <X size={12} />
                </button>
                {face.assigned_to_id && (
                  <div className="absolute inset-0 bg-emerald-900/60 flex items-end p-1.5">
                    <span className="badge-success text-xs">Assigned</span>
                  </div>
                )}
              </div>
              <div>
                <p className="text-xs text-slate-500">
                  {face.captured_at ? format(new Date(face.captured_at), 'dd MMM · HH:mm') : '—'}
                </p>
                {face.assigned_to_name && (
                  <p className="text-xs text-emerald-400 font-medium truncate">{face.assigned_to_name}</p>
                )}
              </div>

              {/* Assign action */}
              {assigning?.id === face.id ? (
                <div className="space-y-1.5">
                  <select
                    value={assigning.selectedUser}
                    onChange={e => setAssigning(a => ({ ...a, selectedUser: e.target.value }))}
                    className="select text-xs py-1.5"
                  >
                    <option value="">Select user...</option>
                    {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                  <div className="flex gap-1">
                    <button onClick={handleAssign} className="btn-success py-1 px-2 text-xs flex-1"><UserCheck size={11} /> Assign</button>
                    <button onClick={() => setAssigning(null)} className="btn-secondary py-1 px-2 text-xs"><X size={11} /></button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setAssigning({ id: face.id, selectedUser: face.assigned_to_id || '' })}
                  className="btn-secondary py-1.5 text-xs w-full"
                >
                  <UserCheck size={12} /> Assign to User
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
