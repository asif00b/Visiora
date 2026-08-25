import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { getAttendance, exportCSV, postManualAttendance } from '../../api/attendance'
import { getDepartments } from '../../api/departments'
import { getUsers } from '../../api/users'
import AttendanceTable from '../../components/AttendanceTable'
import { ToastContainer, useToast } from '../../components/Toast'
import { format, subDays, startOfWeek, startOfMonth } from 'date-fns'
import {
  Download, Filter, RotateCcw, Printer, Calendar, Clock,
  CheckCircle2, AlertTriangle, Users, Award, FileSpreadsheet, PlusCircle, X
} from 'lucide-react'

export default function AttendanceReport() {
  const { toasts, removeToast, toast } = useToast()
  const [records, setRecords]           = useState([])
  const [departments, setDepartments]   = useState([])
  const [users, setUsers]               = useState([])
  const [loading, setLoading]           = useState(false)
  const [filters, setFilters]           = useState({
    user_id: '', dept_id: '', date_from: '', date_to: '', status: ''
  })

  // Manual Attendance Modal State
  const [showManualModal, setShowManualModal] = useState(false)
  const [savingManual, setSavingManual]     = useState(false)
  const [manualForm, setManualForm]         = useState({
    user_id: '',
    attendance_date: format(new Date(), 'yyyy-MM-dd'),
    status: 'present',
    check_in_time: '09:00',
    check_out_time: '17:00',
    reason: 'Forgot to scan at entrance'
  })

  useEffect(() => {
    Promise.all([
      getDepartments().catch(() => ({ data: { departments: [] } })),
      getUsers().catch(() => ({ data: { users: [] } })),
    ]).then(([d, u]) => {
      setDepartments(d.data.departments || [])
      setUsers(u.data.users || [])
    })
    handleLoad()
  }, [])

  const handleLoad = async (f = filters) => {
    setLoading(true)
    try {
      const params = Object.fromEntries(Object.entries(f).filter(([, v]) => v))
      const res = await getAttendance(params)
      setRecords(res.data.attendance || [])
    } catch {
      toast.error('Failed to load attendance records')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmitManual = async (e) => {
    e.preventDefault()
    if (!manualForm.user_id) {
      toast.error('Please select an employee / user')
      return
    }
    if (!manualForm.reason.trim()) {
      toast.error('Please provide a manual entry reason / note')
      return
    }

    setSavingManual(true)
    try {
      const res = await postManualAttendance(manualForm)
      if (res.data.success) {
        toast.success(res.data.message || 'Manual attendance recorded successfully!')
        setShowManualModal(false)
        handleLoad()
      } else {
        toast.error(res.data.message || 'Failed to record manual attendance')
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to record manual attendance')
    } finally {
      setSavingManual(false)
    }
  }

  const handleReset = () => {
    const reset = { user_id: '', dept_id: '', date_from: '', date_to: '', status: '' }
    setFilters(reset)
    handleLoad(reset)
  }

  const handleExport = async () => {
    try {
      const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v))
      await exportCSV(params)
      toast.success('Attendance CSV downloaded successfully!')
    } catch {
      toast.error('Failed to download CSV report')
    }
  }

  const handlePrint = () => {
    window.print()
  }

  const applyPreset = (type) => {
    const today = new Date()
    let from = ''
    let to = format(today, 'yyyy-MM-dd')

    if (type === 'today') {
      from = to
    } else if (type === 'yesterday') {
      const y = subDays(today, 1)
      from = format(y, 'yyyy-MM-dd')
      to = from
    } else if (type === 'week') {
      from = format(startOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd')
    } else if (type === 'month') {
      from = format(startOfMonth(today), 'yyyy-MM-dd')
    } else if (type === 'all') {
      from = ''
      to = ''
    }

    const updated = { ...filters, date_from: from, date_to: to }
    setFilters(updated)
    handleLoad(updated)
  }

  const setFilter = (k, v) => setFilters(f => ({ ...f, [k]: v }))

  // Summary Metrics calculations from filtered records
  const totalRecords = records.length
  const totalHoursWorked = records.reduce((acc, r) => acc + (Number(r.hours_worked) || 0), 0)
  const presentCount = records.filter(r => r.status === 'present').length
  const lateCount = records.filter(r => r.status === 'late').length
  const manualCount = records.filter(r => r.status === 'manual').length
  
  const totalPunches = presentCount + lateCount
  const punctualityRate = totalPunches > 0 ? Math.round((presentCount / totalPunches) * 100) : 100

  return (
    <div className="space-y-6 animate-fade-in print:p-0 print:m-0 print:bg-white print:text-black">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 print:hidden">
        <div>
          <h1 className="section-title">Attendance Report</h1>
          <p className="section-subtitle">
            Comprehensive log of all biometric punches, work hours, and arrival punctuality
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <button onClick={() => setShowManualModal(true)} className="btn-primary">
            <PlusCircle size={15} /> Add Manual Attendance
          </button>
          <button onClick={handlePrint} className="btn-secondary">
            <Printer size={15} /> Print / Save PDF
          </button>
          <button onClick={handleExport} className="btn-success">
            <Download size={15} /> Export CSV
          </button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-4 flex items-center gap-4 bg-slate-900/60 border-slate-800">
          <div className="w-11 h-11 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 flex-shrink-0">
            <FileSpreadsheet size={20} />
          </div>
          <div>
            <p className="text-xs text-slate-400 font-medium">Filtered Records</p>
            <p className="text-xl font-bold text-slate-100">{totalRecords}</p>
          </div>
        </div>

        <div className="card p-4 flex items-center gap-4 bg-slate-900/60 border-slate-800">
          <div className="w-11 h-11 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 flex-shrink-0">
            <Clock size={20} />
          </div>
          <div>
            <p className="text-xs text-slate-400 font-medium">Total Hours Worked</p>
            <p className="text-xl font-bold text-emerald-400">{totalHoursWorked.toFixed(1)} hrs</p>
          </div>
        </div>

        <div className="card p-4 flex items-center gap-4 bg-slate-900/60 border-slate-800">
          <div className="w-11 h-11 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 flex-shrink-0">
            <Users size={20} />
          </div>
          <div>
            <p className="text-xs text-slate-400 font-medium">Punches Breakdown</p>
            <p className="text-xs font-semibold text-slate-300 mt-0.5">
              <span className="text-emerald-400">{presentCount} On-Time</span> ·{' '}
              <span className="text-amber-400">{lateCount} Late</span> ·{' '}
              <span className="text-sky-400">{manualCount} Manual</span>
            </p>
          </div>
        </div>

        <div className="card p-4 flex items-center gap-4 bg-slate-900/60 border-slate-800">
          <div className="w-11 h-11 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 flex-shrink-0">
            <Clock size={20} />
          </div>
          <div>
            <p className="text-xs text-slate-400 font-medium">Punctuality Rate</p>
            <p className="text-xl font-bold text-amber-400">{punctualityRate}% On-Time</p>
          </div>
        </div>
      </div>

      {/* Filters Card */}
      <div className="card space-y-4 print:hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 className="font-semibold text-slate-300 flex items-center gap-2 text-sm">
            <Filter size={16} className="text-cyan-400" /> Filter Criteria
          </h2>

          {/* Quick Date Presets */}
          <div className="flex flex-wrap items-center gap-1.5 bg-slate-950/40 p-1 rounded-lg border border-slate-800">
            <span className="text-[11px] text-slate-500 px-2 font-medium">Presets:</span>
            <button onClick={() => applyPreset('today')} className="btn-secondary text-[11px] py-1 px-2.5">Today</button>
            <button onClick={() => applyPreset('yesterday')} className="btn-secondary text-[11px] py-1 px-2.5">Yesterday</button>
            <button onClick={() => applyPreset('week')} className="btn-secondary text-[11px] py-1 px-2.5">This Week</button>
            <button onClick={() => applyPreset('month')} className="btn-secondary text-[11px] py-1 px-2.5">This Month</button>
            <button onClick={() => applyPreset('all')} className="btn-secondary text-[11px] py-1 px-2.5">All</button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
          <div>
            <label className="label">User / Employee</label>
            <select value={filters.user_id} onChange={e => setFilter('user_id', e.target.value)} className="select">
              <option value="">All Users</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>

          <div>
            <label className="label">Department</label>
            <select value={filters.dept_id} onChange={e => setFilter('dept_id', e.target.value)} className="select">
              <option value="">All Departments</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>

          <div>
            <label className="label">Status</label>
            <select value={filters.status} onChange={e => setFilter('status', e.target.value)} className="select">
              <option value="">All Statuses</option>
              <option value="present">Present (On-Time)</option>
              <option value="late">Late Arrival</option>
              <option value="manual">Manual Punch</option>
            </select>
          </div>

          <div>
            <label className="label">Date From</label>
            <input type="date" value={filters.date_from} onChange={e => setFilter('date_from', e.target.value)} className="input" />
          </div>

          <div>
            <label className="label">Date To</label>
            <input type="date" value={filters.date_to} onChange={e => setFilter('date_to', e.target.value)} className="input" />
          </div>
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button onClick={() => handleLoad()} className="btn-primary">
            <Filter size={15} /> Apply Filters
          </button>
          <button onClick={handleReset} className="btn-secondary">
            <RotateCcw size={15} /> Reset
          </button>
        </div>
      </div>

      {/* Table */}
      <AttendanceTable records={records} loading={loading} />

      {/* Manual Attendance Modal */}
      {showManualModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
          <div className="card max-w-lg w-full p-6 bg-slate-900 border-slate-700 shadow-2xl relative space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-slate-100 font-semibold text-base">
                <PlusCircle className="text-cyan-400" size={18} /> Add Manual Attendance Record
              </div>
              <button
                onClick={() => setShowManualModal(false)}
                className="text-slate-400 hover:text-slate-200 p-1 rounded-lg hover:bg-slate-800"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmitManual} className="space-y-4">
              <div>
                <label className="label">Employee / User <span className="text-rose-400">*</span></label>
                <select
                  value={manualForm.user_id}
                  onChange={e => setManualForm({ ...manualForm, user_id: e.target.value })}
                  className="select"
                  required
                >
                  <option value="">-- Select Employee --</option>
                  {users.map(u => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.student_id || `ID: ${u.id}`}) — {u.dept_name || 'General'}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label">Attendance Date <span className="text-rose-400">*</span></label>
                  <input
                    type="date"
                    value={manualForm.attendance_date}
                    onChange={e => setManualForm({ ...manualForm, attendance_date: e.target.value })}
                    className="input"
                    required
                  />
                </div>
                <div>
                  <label className="label">Attendance Status</label>
                  <select
                    value={manualForm.status}
                    onChange={e => setManualForm({ ...manualForm, status: e.target.value })}
                    className="select"
                  >
                    <option value="present">Present (On-Time)</option>
                    <option value="late">Late Arrival</option>
                    <option value="manual">Manual Entry</option>
                    <option value="absent">Absent</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label">Check-In Time</label>
                  <input
                    type="time"
                    value={manualForm.check_in_time}
                    onChange={e => setManualForm({ ...manualForm, check_in_time: e.target.value })}
                    className="input"
                  />
                </div>
                <div>
                  <label className="label">Check-Out Time</label>
                  <input
                    type="time"
                    value={manualForm.check_out_time}
                    onChange={e => setManualForm({ ...manualForm, check_out_time: e.target.value })}
                    className="input"
                  />
                </div>
              </div>

              <div>
                <label className="label">Reason / Note <span className="text-rose-400">*</span></label>
                <input
                  type="text"
                  placeholder="e.g. Forgot to scan at entrance, Hardware scanner offline..."
                  value={manualForm.reason}
                  onChange={e => setManualForm({ ...manualForm, reason: e.target.value })}
                  className="input"
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowManualModal(false)}
                  className="btn-secondary"
                  disabled={savingManual}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary flex items-center gap-2"
                  disabled={savingManual}
                >
                  {savingManual ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <PlusCircle size={15} /> Save Manual Attendance
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
