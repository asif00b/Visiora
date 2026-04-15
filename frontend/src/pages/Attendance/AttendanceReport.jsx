import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { getAttendance } from '../../api/attendance'
import { getSessions } from '../../api/sessions'
import { getDepartments } from '../../api/departments'
import { getUsers } from '../../api/users'
import AttendanceTable from '../../components/AttendanceTable'
import { ToastContainer, useToast } from '../../components/Toast'
import { exportCSV } from '../../api/attendance'
import { Download, Filter, RotateCcw } from 'lucide-react'

export default function AttendanceReport() {
  const { toasts, removeToast, toast } = useToast()
  const [records, setRecords] = useState([])
  const [sessions, setSessions] = useState([])
  const [departments, setDepartments] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(false)
  const [filters, setFilters] = useState({
    user_id: '', session_id: '', dept_id: '',
    date_from: '', date_to: '', status: ''
  })

  useEffect(() => {
    Promise.all([
      getSessions().catch(() => ({ data: { sessions: [] } })),
      getDepartments().catch(() => ({ data: { departments: [] } })),
      getUsers().catch(() => ({ data: { users: [] } })),
    ]).then(([s, d, u]) => {
      setSessions(s.data.sessions)
      setDepartments(d.data.departments)
      setUsers(u.data.users)
    })
    handleLoad()
  }, [])

  const handleLoad = async (f = filters) => {
    setLoading(true)
    try {
      const params = Object.fromEntries(Object.entries(f).filter(([, v]) => v))
      const res = await getAttendance(params)
      setRecords(res.data.attendance)
    } catch {
      toast.error('Failed to load attendance')
    } finally {
      setLoading(false)
    }
  }

  const handleReset = () => {
    const reset = { user_id: '', session_id: '', dept_id: '', date_from: '', date_to: '', status: '' }
    setFilters(reset)
    handleLoad(reset)
  }

  const handleExport = () => {
    const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v))
    exportCSV(params)
  }

  const setFilter = (k, v) => setFilters(f => ({ ...f, [k]: v }))

  return (
    <div className="space-y-6 animate-fade-in">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="section-title">Attendance Report</h1>
          <p className="section-subtitle">{records.length} record(s)</p>
        </div>
        <button onClick={handleExport} className="btn-success">
          <Download size={16} /> Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="card space-y-4">
        <h2 className="font-semibold text-slate-300 flex items-center gap-2"><Filter size={16} /> Filters</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div>
            <label className="label">User</label>
            <select value={filters.user_id} onChange={e => setFilter('user_id', e.target.value)} className="select">
              <option value="">All Users</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Session</label>
            <select value={filters.session_id} onChange={e => setFilter('session_id', e.target.value)} className="select">
              <option value="">All Sessions</option>
              {sessions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
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
            <label className="label">Date From</label>
            <input type="date" value={filters.date_from} onChange={e => setFilter('date_from', e.target.value)} className="input" />
          </div>
          <div>
            <label className="label">Date To</label>
            <input type="date" value={filters.date_to} onChange={e => setFilter('date_to', e.target.value)} className="input" />
          </div>
          <div>
            <label className="label">Status</label>
            <select value={filters.status} onChange={e => setFilter('status', e.target.value)} className="select">
              <option value="">All</option>
              <option value="present">Present</option>
              <option value="late">Late</option>
              <option value="manual">Manual</option>
            </select>
          </div>
        </div>
        <div className="flex gap-3">
          <button onClick={() => handleLoad()} className="btn-primary">
            <Filter size={15} /> Apply Filters
          </button>
          <button onClick={handleReset} className="btn-secondary">
            <RotateCcw size={15} /> Reset
          </button>
        </div>
      </div>

      <AttendanceTable records={records} loading={loading} />
    </div>
  )
}
