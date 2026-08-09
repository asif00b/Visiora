import { useEffect, useState } from 'react'
import { getUsers, updateBulkSchedule } from '../../api/users'
import { getDepartments } from '../../api/departments'
import { Sliders, Search, Building2, CheckSquare, Square, Save, Loader2, Clock } from 'lucide-react'
import { ToastContainer, useToast } from '../../components/Toast'

export default function Schedules() {
  const [users, setUsers]                 = useState([])
  const [departments, setDepartments]     = useState([])
  const [loading, setLoading]             = useState(true)
  const [saving, setSaving]               = useState(false)
  const { toasts, removeToast, toast }   = useToast()

  // Filters & selection
  const [search, setSearch]               = useState('')
  const [selectedDept, setSelectedDept]   = useState('all')
  const [selectedUserIds, setSelectedUserIds] = useState([])

  // Bulk Edit inputs & toggles
  const [bulkTarget, setBulkTarget]       = useState('')
  const [bulkCheckIn, setBulkCheckIn]     = useState('')
  const [updateTarget, setUpdateTarget]   = useState(false)
  const [updateCheckIn, setUpdateCheckIn] = useState(false)

  const loadData = async () => {
    setLoading(true)
    try {
      const [uRes, dRes] = await Promise.all([
        getUsers(),
        getDepartments()
      ])
      if (uRes.data.success) setUsers(uRes.data.users || [])
      if (dRes.data.success) setDepartments(dRes.data.departments || [])
    } catch {
      toast.error('Failed to load user and department data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  // Filter users
  const filteredUsers = users.filter(u => {
    const matchesSearch = u.name.toLowerCase().includes(search.toLowerCase()) || 
                          (u.student_id && u.student_id.toLowerCase().includes(search.toLowerCase()))
    const matchesDept   = selectedDept === 'all' || String(u.dept_id) === selectedDept
    return matchesSearch && matchesDept
  })

  // Select all / Toggle selection
  const handleSelectAll = () => {
    if (selectedUserIds.length === filteredUsers.length) {
      setSelectedUserIds([])
    } else {
      setSelectedUserIds(filteredUsers.map(u => u.id))
    }
  }

  const handleToggleSelect = (id) => {
    setSelectedUserIds(prev => 
      prev.includes(id) ? prev.filter(uid => uid !== id) : [...prev, id]
    )
  }

  const handleApplyBulk = async (e) => {
    e.preventDefault()
    if (selectedUserIds.length === 0) {
      toast.warning('Select at least one user from the list')
      return
    }

    if (!updateTarget && !updateCheckIn) {
      toast.warning('Select at least one setting to update')
      return
    }

    setSaving(true)
    try {
      const payload = { user_ids: selectedUserIds }

      if (updateTarget) {
        payload.weekly_target_hours = bulkTarget !== '' ? parseFloat(bulkTarget) : 40.0
      }
      if (updateCheckIn) {
        payload.must_check_in_time = bulkCheckIn || null
      }

      const res = await updateBulkSchedule(payload)
      if (res.data.success) {
        toast.success(res.data.message || 'Schedules updated successfully')
        setSelectedUserIds([])
        setUpdateTarget(false)
        setUpdateCheckIn(false)
        setBulkTarget('')
        setBulkCheckIn('')
        loadData()
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update schedules')
    } finally {
      setSaving(false)
    }
  }

  const formatTime = (timeStr) => {
    if (!timeStr) return '—'
    const parts = timeStr.split(':')
    return `${parts[0]}:${parts[1]}`
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="section-title flex items-center gap-2">
            <Sliders className="text-cyan-400" size={22} /> Targets & Schedules
          </h1>
          <p className="section-subtitle">
            Configure weekly target hours and check-in deadlines for employees.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Left Side: Search, Filter & Users Table */}
        <div className="xl:col-span-2 space-y-4">
          <div className="card grid grid-cols-1 md:grid-cols-2 gap-3 p-4">
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
              <input
                type="text"
                placeholder="Search user name or ID..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="input pl-10 text-xs py-2"
              />
            </div>

            <div className="relative">
              <Building2 className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
              <select
                value={selectedDept}
                onChange={e => setSelectedDept(e.target.value)}
                className="select pl-10 text-xs py-2"
              >
                <option value="all">All Departments</option>
                {departments.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Table */}
          <div className="card p-0 overflow-hidden">
            <div className="p-3.5 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
              <div className="flex items-center gap-2.5">
                <button
                  onClick={handleSelectAll}
                  className="text-slate-400 hover:text-cyan-400 transition-colors"
                  title="Select / Deselect All"
                >
                  {selectedUserIds.length > 0 && selectedUserIds.length === filteredUsers.length ? (
                    <CheckSquare size={18} className="text-cyan-400" />
                  ) : (
                    <Square size={18} />
                  )}
                </button>
                <span className="text-xs text-slate-300 font-medium">
                  {selectedUserIds.length} of {filteredUsers.length} users selected
                </span>
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-8 h-8 text-cyan-500 animate-spin" />
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="text-center py-16 text-slate-500">
                <p className="font-medium text-sm">No users matched your search</p>
              </div>
            ) : (
              <div className="table-wrapper">
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: '40px' }}></th>
                      <th>Name</th>
                      <th>User ID</th>
                      <th>Department</th>
                      <th className="text-center">Target (Hrs)</th>
                      <th className="text-center">Check-In Deadline</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map(u => {
                      const isSelected = selectedUserIds.includes(u.id)
                      return (
                        <tr
                          key={u.id}
                          onClick={() => handleToggleSelect(u.id)}
                          className={`cursor-pointer transition-colors ${
                            isSelected ? 'bg-cyan-500/10 border-l-2 border-l-cyan-400' : 'hover:bg-slate-800/40'
                          }`}
                        >
                          <td onClick={(e) => { e.stopPropagation(); handleToggleSelect(u.id); }}>
                            {isSelected ? (
                              <CheckSquare size={16} className="text-cyan-400" />
                            ) : (
                              <Square size={16} className="text-slate-500 hover:text-slate-300" />
                            )}
                          </td>
                          <td className="font-medium text-slate-200">{u.name}</td>
                          <td className="font-mono text-xs text-slate-400">{u.student_id || '—'}</td>
                          <td className="text-slate-400 text-xs">{u.dept_name || '—'}</td>
                          <td className="text-center font-bold text-cyan-400 font-mono text-xs">
                            {u.weekly_target_hours || '40'} hrs
                          </td>
                          <td className="text-center font-mono text-xs text-slate-300">
                            {formatTime(u.must_check_in_time)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Right Side: Bulk Configuration Panel */}
        <div>
          <div className="card p-5 space-y-5 sticky top-6">
            <h3 className="font-bold text-slate-100 text-sm flex items-center gap-2 border-b border-slate-800 pb-3">
              <Clock size={16} className="text-cyan-400" /> Update Schedule Rules
            </h3>

            <form onSubmit={handleApplyBulk} className="space-y-5 text-xs">
              {/* Weekly Target Hours */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="chk-target"
                    checked={updateTarget}
                    onChange={e => setUpdateTarget(e.target.checked)}
                    className="accent-cyan-500 cursor-pointer"
                  />
                  <label htmlFor="chk-target" className="font-semibold text-slate-300 cursor-pointer select-none">
                    Weekly Target Hours
                  </label>
                </div>
                <input
                  type="number"
                  step="0.5"
                  placeholder="40.0"
                  disabled={!updateTarget}
                  value={bulkTarget}
                  onChange={e => setBulkTarget(e.target.value)}
                  className="input text-xs py-2 disabled:opacity-40 disabled:cursor-not-allowed"
                />
              </div>

              {/* Check-In Deadline */}
              <div className="space-y-2 pt-2 border-t border-slate-800/60">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="chk-deadline"
                    checked={updateCheckIn}
                    onChange={e => setUpdateCheckIn(e.target.checked)}
                    className="accent-cyan-500 cursor-pointer"
                  />
                  <label htmlFor="chk-deadline" className="font-semibold text-slate-300 cursor-pointer select-none">
                    Check-in Deadline (Mark Late)
                  </label>
                </div>
                <input
                  type="time"
                  disabled={!updateCheckIn}
                  value={bulkCheckIn}
                  onChange={e => setBulkCheckIn(e.target.value)}
                  className="input text-xs py-2 disabled:opacity-40 disabled:cursor-not-allowed"
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={saving || selectedUserIds.length === 0}
                  className="w-full btn-primary py-2.5 text-xs flex items-center justify-center gap-2"
                >
                  {saving ? (
                    <>
                      <Loader2 size={15} className="animate-spin" /> Saving...
                    </>
                  ) : (
                    <>
                      <Save size={15} /> Apply to {selectedUserIds.length} User(s)
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
