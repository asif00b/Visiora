import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { getUsers, deleteUser } from '../../api/users'
import ConfirmModal from '../../components/ConfirmModal'
import { ToastContainer, useToast } from '../../components/Toast'
import { UserPlus, Search, Trash2, Eye, Camera, Filter } from 'lucide-react'

const ROLE_COLORS = {
  admin: 'badge-error',
  hr: 'badge-warning',
  student: 'badge-info',
}

export default function StudentList() {
  const navigate = useNavigate()
  const { isAdmin } = useAuth()
  const { toasts, removeToast, toast } = useToast()
  const [users, setUsers] = useState([])
  const [filtered, setFiltered] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await getUsers()
      setUsers(res.data.users)
    } catch {
      toast.error('Failed to load users')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    let f = users
    if (search) {
      const q = search.toLowerCase()
      f = f.filter(u => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || (u.student_id || '').toLowerCase().includes(q))
    }
    if (roleFilter) f = f.filter(u => u.role === roleFilter)
    setFiltered(f)
  }, [users, search, roleFilter])

  const handleDelete = async () => {
    try {
      await deleteUser(deleteTarget.id)
      toast.success(`${deleteTarget.name} deleted`)
      setDeleteTarget(null)
      load()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Delete failed')
      setDeleteTarget(null)
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      {deleteTarget && (
        <ConfirmModal
          title="Delete User"
          message={`Are you sure you want to delete "${deleteTarget.name}"? This also removes all their face encodings and attendance records.`}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="section-title">Users</h1>
          <p className="section-subtitle">{filtered.length} user{filtered.length !== 1 ? 's' : ''}</p>
        </div>
        <button id="add-user-btn" onClick={() => navigate('/students/register')} className="btn-primary">
          <UserPlus size={16} /> Add User
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            id="user-search"
            type="text"
            placeholder="Search name, email, ID..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="input pl-10"
          />
        </div>
        <select
          id="role-filter"
          value={roleFilter}
          onChange={e => setRoleFilter(e.target.value)}
          className="select w-40"
        >
          <option value="">All Roles</option>
          <option value="admin">Admin</option>
          <option value="hr">HR</option>
          <option value="student">Student</option>
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>ID</th>
                <th>Email</th>
                <th>Department</th>
                <th>Role</th>
                <th>Face</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(user => (
                <tr key={user.id}>
                  <td>
                    <div className="flex items-center gap-3">
                      {user.image_path ? (
                        <img
                          src={`/storage/${user.image_path}`}
                          alt={user.name}
                          className="w-8 h-8 rounded-full object-cover border border-slate-700"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-indigo-600/20 border border-indigo-500/20 flex items-center justify-center text-xs font-bold text-indigo-400">
                          {user.name[0]}
                        </div>
                      )}
                      <span className="font-medium text-slate-200">{user.name}</span>
                    </div>
                  </td>
                  <td className="font-mono text-xs text-slate-400">{user.student_id || '—'}</td>
                  <td className="text-slate-400 text-xs">{user.email}</td>
                  <td className="text-slate-400">{user.dept_name || '—'}</td>
                  <td><span className={ROLE_COLORS[user.role] || 'badge-gray'}>{user.role}</span></td>
                  <td>
                    {user.has_face
                      ? <span className="badge-success"><Camera size={10} /> {user.face_count}</span>
                      : <span className="badge-gray">None</span>}
                  </td>
                  <td>
                    <div className="flex gap-1.5">
                      <button
                        id={`view-user-${user.id}`}
                        onClick={() => navigate(`/students/${user.id}`)}
                        className="btn-icon"
                        title="View profile"
                      >
                        <Eye size={15} />
                      </button>
                      {isAdmin && (
                        <button
                          id={`delete-user-${user.id}`}
                          onClick={() => setDeleteTarget(user)}
                          className="btn-icon hover:text-rose-400 hover:bg-rose-500/10"
                          title="Delete"
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-slate-500">
                    No users found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
