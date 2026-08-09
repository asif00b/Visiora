import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { getUsers, deleteUser, updateUser } from '../../api/users'
import { getDepartments } from '../../api/departments'
import ConfirmModal from '../../components/ConfirmModal'
import { ToastContainer, useToast } from '../../components/Toast'
import {
  UserPlus, Search, Trash2, Eye, Camera, AlertTriangle, Fingerprint,
  Edit, UserCheck, UserX, X, Save, Clock
} from 'lucide-react'

const ROLE_COLORS = {
  admin:   'badge-error',
  hr:      'badge-warning',
  user:    'badge-info',
  student: 'badge-info',
}

export default function UserList() {
  const navigate = useNavigate()
  const { isAdmin } = useAuth()
  const { toasts, removeToast, toast } = useToast()
  const [users, setUsers]               = useState([])
  const [departments, setDepartments]   = useState([])
  const [filtered, setFiltered]         = useState([])
  const [loading, setLoading]           = useState(true)
  const [search, setSearch]             = useState('')
  const [roleFilter, setRoleFilter]     = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [missingBioOnly, setMissingBioOnly] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  
  // Edit User Modal State
  const [editUser, setEditUser]         = useState(null)
  const [savingEdit, setSavingEdit]     = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [resUsers, resDepts] = await Promise.all([
        getUsers(),
        getDepartments().catch(() => ({ data: { departments: [] } })),
      ])
      setUsers(resUsers.data.users)
      setDepartments(resDepts.data.departments || [])
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
      f = f.filter(u =>
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.student_id || '').toLowerCase().includes(q)
      )
    }
    if (roleFilter) f = f.filter(u => u.role === roleFilter)
    if (statusFilter) {
      const isActiveValue = statusFilter === 'active'
      f = f.filter(u => u.is_active === isActiveValue)
    }
    if (missingBioOnly) {
      f = f.filter(u => !u.has_face || !u.has_fingerprint)
    }
    setFiltered(f)
  }, [users, search, roleFilter, statusFilter, missingBioOnly])

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

  const handleToggleStatus = async (targetUser) => {
    try {
      const newStatus = !targetUser.is_active
      await updateUser(targetUser.id, { is_active: newStatus })
      toast.success(`${targetUser.name} marked as ${newStatus ? 'Active' : 'Inactive'}`)
      load()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Status update failed')
    }
  }

  const handleSaveEditUser = async (e) => {
    e.preventDefault()
    if (!editUser.name || !editUser.email) {
      toast.error('Name and Email are required')
      return
    }
    if (editUser.phone && !/^01\d{9}$/.test(editUser.phone)) {
      toast.error('Phone number must be an 11-digit Bangladeshi number starting with 01')
      return
    }

    setSavingEdit(true)
    try {
      await updateUser(editUser.id, {
        name: editUser.name,
        email: editUser.email,
        student_id: editUser.student_id,
        phone: editUser.phone,
        dept_id: editUser.dept_id,
        role: editUser.role,
        is_active: editUser.is_active,
        weekly_target_hours: editUser.weekly_target_hours,
        must_check_in_time: editUser.must_check_in_time,
        must_be_in_start: editUser.must_be_in_start,
        must_be_in_end: editUser.must_be_in_end,
      })
      toast.success(`User "${editUser.name}" updated successfully`)
      setEditUser(null)
      load()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Update failed')
    } finally {
      setSavingEdit(false)
    }
  }

  const incompleteBioCount = users.filter(u => !u.has_face || !u.has_fingerprint).length

  return (
    <div className="space-y-6 animate-fade-in">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <ConfirmModal
          title="Delete User"
          message={`Are you sure you want to delete "${deleteTarget.name}"? This also removes all their face encodings and attendance records.`}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {/* Edit User Modal */}
      {editUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in overflow-y-auto">
          <div className="card max-w-2xl w-full p-6 space-y-5 bg-slate-900 border border-slate-700/60 my-8 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-2">
                <Edit size={18} className="text-cyan-400" />
                <h2 className="text-lg font-bold text-slate-100">Edit User Profile</h2>
              </div>
              <button
                onClick={() => setEditUser(null)}
                className="text-slate-400 hover:text-slate-200 p-1 rounded-lg hover:bg-slate-800"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveEditUser} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Full Name *</label>
                  <input
                    type="text"
                    required
                    value={editUser.name || ''}
                    onChange={e => setEditUser(f => ({ ...f, name: e.target.value }))}
                    className="input"
                  />
                </div>

                <div>
                  <label className="label">Email Address *</label>
                  <input
                    type="email"
                    required
                    value={editUser.email || ''}
                    onChange={e => setEditUser(f => ({ ...f, email: e.target.value }))}
                    className="input"
                  />
                </div>

                <div>
                  <label className="label">User ID / Code</label>
                  <input
                    type="text"
                    value={editUser.student_id || ''}
                    onChange={e => setEditUser(f => ({ ...f, student_id: e.target.value }))}
                    className="input"
                    placeholder="e.g. EMP001"
                  />
                </div>

                <div>
                  <label className="label">Phone (11-digit Bangladeshi)</label>
                  <input
                    type="text"
                    value={editUser.phone || ''}
                    onChange={e => setEditUser(f => ({ ...f, phone: e.target.value }))}
                    className="input"
                    placeholder="01XXXXXXXXX"
                  />
                </div>

                <div>
                  <label className="label">Department</label>
                  <select
                    value={editUser.dept_id || ''}
                    onChange={e => setEditUser(f => ({ ...f, dept_id: e.target.value }))}
                    className="select"
                  >
                    <option value="">None</option>
                    {departments.map(d => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="label">Role</label>
                  <select
                    value={editUser.role === 'student' ? 'user' : (editUser.role || 'user')}
                    onChange={e => setEditUser(f => ({ ...f, role: e.target.value }))}
                    className="select"
                    disabled={!isAdmin}
                  >
                    <option value="user">User</option>
                    <option value="hr">HR</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>

                <div>
                  <label className="label">Account Status</label>
                  <select
                    value={editUser.is_active ? 'active' : 'inactive'}
                    onChange={e => setEditUser(f => ({ ...f, is_active: e.target.value === 'active' }))}
                    className="select"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>

                <div>
                  <label className="label">Weekly Target Hours</label>
                  <input
                    type="number"
                    step="0.5"
                    value={editUser.weekly_target_hours ?? 40.0}
                    onChange={e => setEditUser(f => ({ ...f, weekly_target_hours: e.target.value }))}
                    className="input"
                  />
                </div>
              </div>

              {/* Schedule settings */}
              <div className="pt-2 border-t border-slate-800 space-y-3">
                <p className="font-semibold text-slate-300 flex items-center gap-1.5">
                  <Clock size={14} className="text-cyan-400" /> Work Schedule Rules
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="label">Must Check In By</label>
                    <input
                      type="time"
                      value={editUser.must_check_in_time || ''}
                      onChange={e => setEditUser(f => ({ ...f, must_check_in_time: e.target.value }))}
                      className="input"
                    />
                  </div>
                  <div>
                    <label className="label">Shift Start (Must be in)</label>
                    <input
                      type="time"
                      value={editUser.must_be_in_start || ''}
                      onChange={e => setEditUser(f => ({ ...f, must_be_in_start: e.target.value }))}
                      className="input"
                    />
                  </div>
                  <div>
                    <label className="label">Shift End (Must be in)</label>
                    <input
                      type="time"
                      value={editUser.must_be_in_end || ''}
                      onChange={e => setEditUser(f => ({ ...f, must_be_in_end: e.target.value }))}
                      className="input"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditUser(null)}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="btn-primary"
                >
                  <Save size={15} />
                  {savingEdit ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="section-title">Users</h1>
          <p className="section-subtitle">
            {filtered.length} user{filtered.length !== 1 ? 's' : ''}
            {missingBioOnly && <span className="ml-1 text-amber-400">· Missing biometrics filter active</span>}
          </p>
        </div>
        <button id="add-user-btn" onClick={() => navigate('/users/register')} className="btn-primary">
          <UserPlus size={16} /> Add User
        </button>
      </div>

      {/* Incomplete biometrics warning alert */}
      {incompleteBioCount > 0 && !missingBioOnly && (
        <div
          className="flex items-center gap-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-sm cursor-pointer hover:bg-amber-500/15 transition-colors"
          onClick={() => setMissingBioOnly(true)}
          title="Click to filter users missing face or fingerprint data"
        >
          <AlertTriangle size={16} className="flex-shrink-0" />
          <span>
            <strong>{incompleteBioCount}</strong> user{incompleteBioCount > 1 ? 's have' : ' has'} incomplete biometrics (missing Face ID or Fingerprint).
            <span className="ml-1 underline underline-offset-2 opacity-80">Show only these users</span>
          </span>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-3">
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
          className="select w-full md:w-40"
        >
          <option value="">All Roles</option>
          <option value="admin">Admin</option>
          <option value="hr">HR</option>
          <option value="user">User</option>
        </select>

        <select
          id="status-filter"
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="select w-full md:w-40"
        >
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>

        {/* Missing biometrics toggle */}
        <button
          id="missing-bio-filter-btn"
          onClick={() => setMissingBioOnly(v => !v)}
          className={`btn ${missingBioOnly ? 'btn-primary' : 'btn-secondary'} whitespace-nowrap`}
          title="Show only users missing face or fingerprint data"
        >
          <Fingerprint size={15} />
          {missingBioOnly ? 'All Users' : `Missing Bio (${incompleteBioCount})`}
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>User ID</th>
                <th>Email</th>
                <th>Department</th>
                <th>Role</th>
                <th>Status</th>
                <th>Face ID</th>
                <th>Fingerprint</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(user => (
                <tr key={user.id} className={!user.is_active ? 'opacity-60 bg-slate-950/30' : ''}>
                  <td>
                    <div className="flex items-center gap-3">
                      {user.image_path ? (
                        <img
                          src={`/storage/${user.image_path}`}
                          alt={user.name}
                          className="w-8 h-8 rounded-full object-cover border border-slate-700"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-cyan-600/15 border border-cyan-500/20 flex items-center justify-center text-xs font-bold text-cyan-400">
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
                    <button
                      onClick={() => handleToggleStatus(user)}
                      title={`Click to ${user.is_active ? 'deactivate' : 'activate'} ${user.name}`}
                      className="cursor-pointer group"
                    >
                      {user.is_active ? (
                        <span className="badge badge-success text-[10px] font-bold group-hover:bg-rose-500/20 group-hover:text-rose-300 transition-colors">
                          Active
                        </span>
                      ) : (
                        <span className="badge badge-error text-[10px] font-bold group-hover:bg-emerald-500/20 group-hover:text-emerald-300 transition-colors">
                          Inactive
                        </span>
                      )}
                    </button>
                  </td>
                  <td>
                    {user.has_face ? (
                      <span className="badge badge-success flex items-center gap-1">
                        <Camera size={10} /> {user.face_count}
                      </span>
                    ) : (
                      <span className="badge badge-warning text-xs flex items-center gap-1">
                        <AlertTriangle size={10} /> None
                      </span>
                    )}
                  </td>
                  <td>
                    {user.has_fingerprint ? (
                      <span className="badge badge-success flex items-center gap-1">
                        <Fingerprint size={10} /> {user.fingerprint_count}
                      </span>
                    ) : (
                      <span className="badge badge-warning text-xs flex items-center gap-1">
                        <AlertTriangle size={10} /> None
                      </span>
                    )}
                  </td>
                  <td>
                    <div className="flex gap-1.5 items-center">
                      <button
                        id={`view-user-${user.id}`}
                        onClick={() => navigate(`/users/${user.id}`)}
                        className="btn-icon"
                        title="View Full Profile"
                      >
                        <Eye size={15} />
                      </button>

                      <button
                        id={`edit-user-${user.id}`}
                        onClick={() => setEditUser(user)}
                        className="btn-icon text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/15"
                        title="Edit User"
                      >
                        <Edit size={15} />
                      </button>

                      <button
                        id={`toggle-user-status-${user.id}`}
                        onClick={() => handleToggleStatus(user)}
                        className={`btn-icon ${
                          user.is_active
                            ? 'text-emerald-400 hover:text-rose-400 hover:bg-rose-500/15'
                            : 'text-rose-400 hover:text-emerald-400 hover:bg-emerald-500/15'
                        }`}
                        title={user.is_active ? 'Deactivate User (Mark Inactive)' : 'Activate User (Mark Active)'}
                      >
                        {user.is_active ? <UserCheck size={15} /> : <UserX size={15} />}
                      </button>

                      {isAdmin && (
                        <button
                          id={`delete-user-${user.id}`}
                          onClick={() => setDeleteTarget(user)}
                          className="btn-icon hover:text-rose-400 hover:bg-rose-500/10"
                          title="Delete User"
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
                  <td colSpan={9} className="text-center py-12 text-slate-500">
                    {missingBioOnly ? 'All users have complete face & fingerprint data registered ✓' : 'No users found'}
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
