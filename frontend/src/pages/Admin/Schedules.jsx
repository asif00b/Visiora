import { useEffect, useState } from 'react'
import { getUsers, updateBulkSchedule } from '../../api/users'
import { getDepartments } from '../../api/departments'
import { Sliders, Search, Building2, CheckSquare, Square, Save, Loader2, AlertCircle } from 'lucide-react'
import { ToastContainer, useToast } from '../../components/Toast'

export default function Schedules() {
  const [users, setUsers] = useState([])
  const [departments, setDepartments] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Toast
  const { toasts, removeToast, toast } = useToast()

  // Filters
  const [search, setSearch] = useState('')
  const [selectedDept, setSelectedDept] = useState('all')

  // Selected User IDs for bulk operations
  const [selectedUserIds, setSelectedUserIds] = useState([])

  // Bulk Edit Inputs
  const [bulkTarget, setBulkTarget] = useState('')
  const [bulkCheckIn, setBulkCheckIn] = useState('')
  const [bulkInStart, setBulkInStart] = useState('')
  const [bulkInEnd, setBulkInEnd] = useState('')

  // Control variables to decide if we modify specific rules
  const [updateTarget, setUpdateTarget] = useState(false)
  const [updateCheckIn, setUpdateCheckIn] = useState(false)
  const [updateCoreHours, setUpdateCoreHours] = useState(false)

  const loadData = async () => {
    setLoading(true)
    try {
      const [uRes, dRes] = await Promise.all([
        getUsers(),
        getDepartments()
      ])
      if (uRes.data.success) {
        setUsers(uRes.data.users || [])
      }
      if (dRes.data.success) {
        setDepartments(dRes.data.departments || [])
      }
    } catch (err) {
      console.error(err)
      toast.error('Failed to load user and department data.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  // Filter users
  const filteredUsers = users.filter(u => {
    const matchesSearch = u.name.toLowerCase().includes(search.toLowerCase()) || 
                          (u.student_id && u.student_id.toLowerCase().includes(search.toLowerCase()))
    const matchesDept = selectedDept === 'all' || String(u.dept_id) === selectedDept
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
      toast.warning('Please select at least one user to update.')
      return
    }

    if (!updateTarget && !updateCheckIn && !updateCoreHours) {
      toast.warning('Please select at least one parameter checkbox to update.')
      return
    }

    setSaving(true)
    try {
      const payload = {
        user_ids: selectedUserIds
      }

      if (updateTarget) {
        payload.weekly_target_hours = bulkTarget !== '' ? parseFloat(bulkTarget) : 40.0
      }
      if (updateCheckIn) {
        payload.must_check_in_time = bulkCheckIn || null
      }
      if (updateCoreHours) {
        payload.must_be_in_start = bulkInStart || null
        payload.must_be_in_end = bulkInEnd || null
      }

      const res = await updateBulkSchedule(payload)
      if (res.data.success) {
        toast.success(res.data.message || 'Schedules updated successfully!')
        // Reset bulk selection
        setSelectedUserIds([])
        setUpdateTarget(false)
        setUpdateCheckIn(false)
        setUpdateCoreHours(false)
        setBulkTarget('')
        setBulkCheckIn('')
        setBulkInStart('')
        setBulkInEnd('')
        // Refresh data
        loadData()
      }
    } catch (err) {
      console.error(err)
      toast.error(err.response?.data?.message || 'Failed to update schedule configurations.')
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
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="section-title flex items-center gap-2">
            <Sliders className="text-cyan-500" size={24} /> Targets & Schedules
          </h1>
          <p className="section-subtitle">
            Configure weekly work targets, clock-in deadlines, and core hours for departments or individuals.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Left Side: Users list and Filters */}
        <div className="xl:col-span-2 space-y-4">
          <div className="card grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-2.5 text-slate-500" size={18} />
              <input
                type="text"
                placeholder="Search user by name or ID..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="input pl-10 text-sm py-2"
              />
            </div>

            {/* Department Filter */}
            <div className="relative">
              <Building2 className="absolute left-3 top-2.5 text-slate-500" size={18} />
              <select
                value={selectedDept}
                onChange={e => setSelectedDept(e.target.value)}
                className="select pl-10 text-sm py-2"
              >
                <option value="all">All Departments</option>
                {departments.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* User Selection Grid */}
          <div className="card p-0 overflow-hidden">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/40">
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSelectAll}
                  className="text-slate-400 hover:text-cyan-400 transition-colors"
                >
                  {selectedUserIds.length > 0 && selectedUserIds.length === filteredUsers.length ? (
                    <CheckSquare size={20} className="text-cyan-400" />
                  ) : (
                    <Square size={20} />
                  )}
                </button>
                <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">
                  {selectedUserIds.length} of {filteredUsers.length} selected
                </span>
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-8 h-8 text-cyan-500 animate-spin" />
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="text-center py-16 text-slate-500">
                <p className="text-3xl mb-2">👥</p>
                <p className="font-medium text-sm">No users matched your filters</p>
              </div>
            ) : (
              <div className="table-wrapper">
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: '40px' }}></th>
                      <th>User</th>
                      <th>ID</th>
                      <th>Dept</th>
                      <th className="text-center">Target (Hrs)</th>
                      <th className="text-center">Deadline</th>
                      <th className="text-center">Core Hours</th>
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
                            isSelected ? 'bg-cyan-500/5 border-l-2 border-l-cyan-500' : 'hover:bg-slate-800/40'
                          }`}
                        >
                          <td onClick={(e) => { e.stopPropagation(); handleToggleSelect(u.id); }}>
                            {isSelected ? (
                              <CheckSquare size={16} className="text-cyan-400" />
                            ) : (
                              <Square size={16} className="text-slate-500 hover:text-slate-300" />
                            )}
                          </td>
                          <td className="font-semibold text-slate-200">{u.name}</td>
                          <td className="font-mono text-xs text-slate-400">{u.student_id || '—'}</td>
                          <td className="text-slate-400 text-xs">{u.dept_name || '—'}</td>
                          <td className="text-center font-semibold text-cyan-400 font-mono text-xs">
                            {u.weekly_target_hours || '40'} hrs
                          </td>
                          <td className="text-center font-mono text-xs text-slate-300">
                            {formatTime(u.must_check_in_time)}
                          </td>
                          <td className="text-center font-mono text-xs text-slate-300">
                            {u.must_be_in_start ? `${formatTime(u.must_be_in_start)} - ${formatTime(u.must_be_in_end)}` : '—'}
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

        {/* Right Side: Bulk Configuration panel */}
        <div className="space-y-4">
          <div className="card p-6 space-y-6">
            <div>
              <h3 className="font-bold text-slate-100 flex items-center gap-2">
                Configure Schedule Settings
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                Configure target hours, deadlines, and mandatory times for all selected users. Check the checkbox next to the rule to apply it.
              </p>
            </div>

            <form onSubmit={handleApplyBulk} className="space-y-6">
              {/* Weekly target hours */}
              <div className="space-y-2 border-b border-slate-800/50 pb-4">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="chk-target"
                    checked={updateTarget}
                    onChange={e => setUpdateTarget(e.target.checked)}
                    className="accent-cyan-500"
                  />
                  <label htmlFor="chk-target" className="text-xs font-semibold uppercase tracking-wider text-slate-300 cursor-pointer select-none">
                    Weekly target hours
                  </label>
                </div>
                <input
                  type="number"
                  placeholder="e.g. 40"
                  disabled={!updateTarget}
                  value={bulkTarget}
                  onChange={e => setBulkTarget(e.target.value)}
                  className="input text-sm py-2 disabled:opacity-40 disabled:cursor-not-allowed"
                />
              </div>

              {/* Fixed check-in deadline */}
              <div className="space-y-2 border-b border-slate-800/50 pb-4">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="chk-deadline"
                    checked={updateCheckIn}
                    onChange={e => setUpdateCheckIn(e.target.checked)}
                    className="accent-cyan-500"
                  />
                  <label htmlFor="chk-deadline" className="text-xs font-semibold uppercase tracking-wider text-slate-300 cursor-pointer select-none">
                    Check-in Deadline (Status: Late)
                  </label>
                </div>
                <input
                  type="time"
                  disabled={!updateCheckIn}
                  value={bulkCheckIn}
                  onChange={e => setBulkCheckIn(e.target.value)}
                  className="input text-sm py-2 disabled:opacity-40 disabled:cursor-not-allowed"
                />
                <p className="text-[10px] text-slate-500 leading-tight">
                  Leaving the time field blank will clear the check-in deadline requirement.
                </p>
              </div>

              {/* Core hours presence */}
              <div className="space-y-2 pb-2">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="chk-core"
                    checked={updateCoreHours}
                    onChange={e => setUpdateCoreHours(e.target.checked)}
                    className="accent-cyan-500"
                  />
                  <label htmlFor="chk-core" className="text-xs font-semibold uppercase tracking-wider text-slate-300 cursor-pointer select-none">
                    Core Presence Hours (Must be in)
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="label text-[10px] text-slate-500 uppercase tracking-widest">Start Time</label>
                    <input
                      type="time"
                      disabled={!updateCoreHours}
                      value={bulkInStart}
                      onChange={e => setBulkInStart(e.target.value)}
                      className="input text-sm py-2 disabled:opacity-40 disabled:cursor-not-allowed"
                    />
                  </div>
                  <div>
                    <label className="label text-[10px] text-slate-500 uppercase tracking-widest">End Time</label>
                    <input
                      type="time"
                      disabled={!updateCoreHours}
                      value={bulkInEnd}
                      onChange={e => setBulkInEnd(e.target.value)}
                      className="input text-sm py-2 disabled:opacity-40 disabled:cursor-not-allowed"
                    />
                  </div>
                </div>
                <p className="text-[10px] text-slate-500 leading-tight">
                  Leaving both start/end times blank will clear the mandatory core hours presence constraint.
                </p>
              </div>

              {/* Selection Summary Alert */}
              <div className="p-3 bg-slate-800/40 border border-slate-700/30 rounded-xl flex items-start gap-2.5 text-xs text-slate-400">
                <AlertCircle size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
                <div>
                  Updates will apply to <span className="text-gradient font-bold">{selectedUserIds.length}</span> user(s) selected from the left panel.
                </div>
              </div>

              <button
                type="submit"
                disabled={saving || selectedUserIds.length === 0}
                className="w-full btn-primary text-sm py-2.5 flex items-center justify-center gap-2"
              >
                {saving ? (
                  <>
                    <Loader2 size={16} className="animate-spin" /> Saving Configuration...
                  </>
                ) : (
                  <>
                    <Save size={16} /> Save and Apply Rules
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      </div>
      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </div>
  )
}
