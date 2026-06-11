import { useEffect, useState } from 'react'
import {
  getUnknownFaces, getUnknownStats, assignUnknownFace,
  deleteUnknownFace, bulkDeleteUnknown, deleteAllUnknown, cleanupUnknown
} from '../../api/admin'
import { getUsers } from '../../api/users'
import { ToastContainer, useToast } from '../../components/Toast'
import ConfirmModal from '../../components/ConfirmModal'
import { AlertCircle, UserCheck, Trash2, X, RefreshCw, Sparkles, HardDrive, Calendar, BarChart2 } from 'lucide-react'
import { format, formatDistanceToNow } from 'date-fns'

export default function UnknownFaces() {
  const { toasts, removeToast, toast } = useToast()
  const [unknowns, setUnknowns]     = useState([])
  const [users, setUsers]           = useState([])
  const [stats, setStats]           = useState(null)
  const [loading, setLoading]       = useState(true)
  const [cleaning, setCleaning]     = useState(false)
  const [assigning, setAssigning]   = useState(null)   // {id, selectedUser: ''}
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false)
  const [selected, setSelected]     = useState(new Set())

  const load = async () => {
    setLoading(true)
    try {
      const [ur, usr, sr] = await Promise.all([
        getUnknownFaces(),
        getUsers(),
        getUnknownStats().catch(() => ({ data: null })),
      ])
      setUnknowns(ur.data.unknown_faces || [])
      setUsers(usr.data.users || [])
      setStats(sr.data || null)
    } catch {
      toast.error('Failed to load')
    } finally {
      setLoading(false)
    }
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

  const handleDeleteAll = async () => {
    try {
      const res = await deleteAllUnknown()
      toast.success(res.data.message || 'All deleted')
      setConfirmDeleteAll(false)
      setSelected(new Set())
      load()
    } catch { toast.error('Bulk delete failed') }
  }

  const handleBulkDelete = async () => {
    if (!selected.size) { toast.warning('Select some faces first'); return }
    try {
      const res = await bulkDeleteUnknown([...selected])
      toast.success(res.data.message || `${selected.size} deleted`)
      setSelected(new Set())
      load()
    } catch { toast.error('Bulk delete failed') }
  }

  const handleCleanup = async () => {
    setCleaning(true)
    try {
      const res = await cleanupUnknown()
      const r   = res.data.report
      toast.success(`Cleanup done: ${r.total_deleted} removed (${r.stale_deleted} stale, ${r.dup_deleted} duplicates, ${r.orphan_deleted} orphans)`)
      load()
    } catch { toast.error('Cleanup failed') }
    finally { setCleaning(false) }
  }

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (selected.size === unknowns.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(unknowns.map(u => u.id)))
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      {deleteTarget && (
        <ConfirmModal
          title="Delete Unknown Face"
          message="Delete this unknown face snapshot?"
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
      {confirmDeleteAll && (
        <ConfirmModal
          title="Delete ALL Unknown Faces"
          message={`This will permanently delete ALL ${unknowns.length} unknown face records and their images. This cannot be undone.`}
          onConfirm={handleDeleteAll}
          onCancel={() => setConfirmDeleteAll(false)}
        />
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="section-title">Unknown Faces</h1>
          <p className="section-subtitle">Review and manage unrecognized face captures</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleCleanup}
            disabled={cleaning}
            className="btn-secondary text-sm"
          >
            <Sparkles size={14} className={cleaning ? 'animate-spin' : ''} />
            {cleaning ? 'Cleaning...' : 'Auto Cleanup'}
          </button>
          <button onClick={load} className="btn-secondary text-sm">
            <RefreshCw size={14} /> Refresh
          </button>
          {unknowns.length > 0 && (
            <button
              onClick={() => setConfirmDeleteAll(true)}
              className="btn-danger text-sm"
            >
              <Trash2 size={14} /> Delete All
            </button>
          )}
        </div>
      </div>

      {/* Stats bar */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total Records', value: stats.total_db ?? unknowns.length, icon: BarChart2, color: 'text-indigo-400' },
            { label: 'Files on Disk', value: stats.total_files ?? '—', icon: HardDrive, color: 'text-blue-400' },
            { label: 'Disk Usage', value: stats.disk_mb != null ? `${stats.disk_mb} MB` : '—', icon: HardDrive, color: 'text-amber-400' },
            { label: 'Oldest Entry', value: stats.oldest ? formatDistanceToNow(new Date(stats.oldest), { addSuffix: true }) : 'None', icon: Calendar, color: 'text-rose-400' },
          ].map(item => {
            const Icon = item.icon
            return (
              <div key={item.label} className="card-glass px-4 py-3 flex items-center gap-3">
                <Icon size={18} className={item.color} />
                <div>
                  <p className="text-xs text-slate-500">{item.label}</p>
                  <p className="text-sm font-bold text-slate-200">{item.value}</p>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/30">
          <span className="text-sm text-indigo-300 font-medium">{selected.size} selected</span>
          <button onClick={handleBulkDelete} className="btn-danger text-sm py-1.5">
            <Trash2 size={13} /> Delete Selected
          </button>
          <button onClick={() => setSelected(new Set())} className="btn-secondary text-sm py-1.5">
            <X size={13} /> Clear
          </button>
        </div>
      )}

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
        <>
          {/* Select all toggle */}
          <div className="flex items-center gap-3">
            <button onClick={toggleAll} className="text-xs text-slate-400 hover:text-slate-200 transition-colors">
              {selected.size === unknowns.length ? 'Deselect All' : 'Select All'}
            </button>
            <span className="text-slate-600 text-xs">{unknowns.length} face(s)</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {unknowns.map(face => {
              const isSelected = selected.has(face.id)
              const confidence = face.confidence_score != null
                ? Math.round((1 - face.confidence_score) * 100)
                : null

              return (
                <div
                  key={face.id}
                  className={`card p-2.5 space-y-2 cursor-pointer transition-all ${isSelected ? 'ring-2 ring-indigo-500' : ''}`}
                  onClick={() => toggleSelect(face.id)}
                >
                  <div className="relative rounded-xl overflow-hidden bg-slate-800 aspect-square">
                    <img
                      src={`/storage/${face.image_path}`}
                      alt={`Unknown ${face.id}`}
                      className="w-full h-full object-cover"
                      onError={e => { e.target.style.display = 'none' }}
                      onClick={e => e.stopPropagation()}
                    />
                    {/* Selection overlay */}
                    {isSelected && (
                      <div className="absolute inset-0 bg-indigo-500/30 flex items-center justify-center">
                        <div className="w-6 h-6 rounded-full bg-indigo-500 flex items-center justify-center">
                          <span className="text-white text-xs font-bold">✓</span>
                        </div>
                      </div>
                    )}
                    {/* Delete button */}
                    <button
                      onClick={e => { e.stopPropagation(); setDeleteTarget(face) }}
                      className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center text-rose-400 hover:bg-rose-500/20 transition-colors"
                    >
                      <X size={11} />
                    </button>
                    {/* Confidence badge */}
                    {confidence !== null && (
                      <div className="absolute top-1.5 left-1.5">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                          confidence < 40 ? 'bg-red-900/80 text-red-300' :
                          confidence < 60 ? 'bg-amber-900/80 text-amber-300' :
                          'bg-emerald-900/80 text-emerald-300'
                        }`}>
                          dist {Math.round(face.confidence_score * 100)}%
                        </span>
                      </div>
                    )}
                    {/* Assigned indicator */}
                    {face.assigned_to_id && (
                      <div className="absolute inset-x-0 bottom-0 bg-emerald-900/70 py-0.5 px-1">
                        <p className="text-[10px] text-emerald-300 truncate text-center">{face.assigned_to_name}</p>
                      </div>
                    )}
                  </div>

                  <div>
                    <p className="text-[10px] text-slate-500">
                      {face.captured_at
                        ? formatDistanceToNow(new Date(face.captured_at), { addSuffix: true })
                        : '—'}
                    </p>
                  </div>

                  {/* Assign action */}
                  {assigning?.id === face.id ? (
                    <div className="space-y-1" onClick={e => e.stopPropagation()}>
                      <select
                        value={assigning.selectedUser}
                        onChange={e => setAssigning(a => ({ ...a, selectedUser: e.target.value }))}
                        className="select text-xs py-1"
                      >
                        <option value="">Select user...</option>
                        {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </select>
                      <div className="flex gap-1">
                        <button onClick={handleAssign} className="btn-success py-1 px-2 text-xs flex-1">
                          <UserCheck size={10} /> Assign
                        </button>
                        <button onClick={() => setAssigning(null)} className="btn-secondary py-1 px-2 text-xs">
                          <X size={10} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={e => { e.stopPropagation(); setAssigning({ id: face.id, selectedUser: face.assigned_to_id || '' }) }}
                      className="btn-secondary py-1 text-[11px] w-full"
                    >
                      <UserCheck size={11} /> Assign
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
