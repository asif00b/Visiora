import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import StatsCard from '../components/StatsCard'
import { getStats, getUserAttendance } from '../api/attendance'
import { getSystemInfo } from '../api/admin'
import { getSessions } from '../api/sessions'
import AttendanceTable from '../components/AttendanceTable'
import {
  Users, CalendarCheck, Database, Camera,
  TrendingUp, Clock, Shield
} from 'lucide-react'
import {
  Chart as ChartJS, CategoryScale, LinearScale,
  BarElement, Title, Tooltip, Legend
} from 'chart.js'
import { Bar } from 'react-chartjs-2'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

export default function Dashboard() {
  const { user, isAdmin, canManage } = useAuth()
  const navigate = useNavigate()
  const [stats, setStats]     = useState(null)
  const [sysInfo, setSysInfo] = useState(null)
  const [loading, setLoading] = useState(true)

  // Student states
  const [allRecords, setAllRecords]         = useState([])
  const [sessions, setSessions]             = useState([])
  const [studentLoading, setStudentLoading] = useState(true)
  const [preset, setPreset]                 = useState('all')
  const [filters, setFilters]               = useState({
    session_id: '',
    status: '',
    date_from: '',
    date_to: '',
  })

  useEffect(() => {
    const load = async () => {
      try {
        if (canManage) {
          const [sr, ir] = await Promise.all([
            getStats().catch(() => null),
            isAdmin ? getSystemInfo().catch(() => null) : null,
          ])
          if (sr) setStats(sr.data.stats)
          if (ir) setSysInfo(ir.data.info)
        } else if (user?.role === 'student' || user?.role === 'user') {
          const [ar, ss] = await Promise.all([
            getUserAttendance(user?.id).catch(() => ({ data: { attendance: [] } })),
            getSessions().catch(() => ({ data: { sessions: [] } })),
          ])
          setAllRecords(ar?.data?.attendance || [])
          setSessions(ss?.data?.sessions || [])
        }
      } finally {
        setLoading(false)
        setStudentLoading(false)
      }
    }
    load()
  }, [canManage, isAdmin, user])

  // Student Statistics Calculations
  const todayStr = new Date().toDateString()
  const todayRecord = allRecords.find(r => r.timestamp && new Date(r.timestamp).toDateString() === todayStr)
  const todayStatus = todayRecord ? todayRecord.status : 'not_marked'

  const startOfWeek = new Date()
  const day = startOfWeek.getDay()
  const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1) // Monday
  startOfWeek.setDate(diff)
  startOfWeek.setHours(0, 0, 0, 0)
  const weekCount = allRecords.filter(r => r.timestamp && new Date(r.timestamp) >= startOfWeek && ['present', 'late', 'manual'].includes(r.status)).length

  // New accurate calculations based on actual hours_worked
  const completedHoursThisWeek = allRecords
    .filter(r => r.timestamp && new Date(r.timestamp) >= startOfWeek)
    .reduce((sum, r) => sum + (r.hours_worked || 0), 0)
  
  const targetCompletedPercent = Math.min(100, Math.round((completedHoursThisWeek / (user?.weekly_target_hours || 40.0)) * 100))

  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)
  const monthCount = allRecords.filter(r => r.timestamp && new Date(r.timestamp) >= startOfMonth && ['present', 'late', 'manual'].includes(r.status)).length
  
  const lateCountMonth = allRecords.filter(r => r.timestamp && new Date(r.timestamp) >= startOfMonth && r.status === 'late').length

  const totalAttended = allRecords.filter(r => ['present', 'late', 'manual'].includes(r.status)).length
  const totalDays = allRecords.length
  const attendanceRate = totalDays > 0 ? Math.round((totalAttended / totalDays) * 100) : 100

  // Filter student records on frontend
  const filteredRecords = allRecords.filter(rec => {
    if (filters.session_id && String(rec.session_id) !== filters.session_id) return false
    if (filters.status && rec.status !== filters.status) return false
    if (!rec.timestamp) return false

    const recDate = new Date(rec.timestamp)

    if (preset === 'week') {
      const oneWeekAgo = new Date()
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7)
      if (recDate < oneWeekAgo) return false
    } else if (preset === 'month') {
      const oneMonthAgo = new Date()
      oneMonthAgo.setDate(oneMonthAgo.getDate() - 30)
      if (recDate < oneMonthAgo) return false
    }

    if (filters.date_from) {
      const fromDate = new Date(filters.date_from)
      fromDate.setHours(0, 0, 0, 0)
      if (recDate < fromDate) return false
    }
    if (filters.date_to) {
      const toDate = new Date(filters.date_to)
      toDate.setHours(23, 59, 59, 999)
      if (recDate > toDate) return false
    }

    return true
  })

  const STATUS_CLASSES = {
    present: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
    late: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
    manual: 'text-sky-400 bg-sky-500/10 border-sky-500/30',
    absent: 'text-rose-400 bg-rose-500/10 border-rose-500/30',
    not_marked: 'text-slate-400 bg-slate-500/10 border-slate-500/30',
  }

  const chartData = stats?.trend ? {
    labels: stats.trend.map(d => {
      const date = new Date(d.date)
      return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    }),
    datasets: [{
      label: 'Attendance',
      data: stats.trend.map(d => d.count),
      backgroundColor: 'rgba(6, 182, 212, 0.6)',
      borderColor: 'rgba(6, 182, 212, 1)',
      borderWidth: 1,
      borderRadius: 6,
    }]
  } : null

  const chartOptions = {
    responsive: true,
    plugins: {
      legend: { display: false },
      tooltip: { backgroundColor: '#1e293b', borderColor: '#334155', borderWidth: 1 }
    },
    scales: {
      x: { grid: { color: 'rgba(51,65,85,0.5)' }, ticks: { color: '#94a3b8' } },
      y: { grid: { color: 'rgba(51,65,85,0.5)' }, ticks: { color: '#94a3b8', stepSize: 1 } }
    }
  }

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="section-title">
          Welcome back, <span className="text-gradient">{user?.name}</span>
        </h1>
        <p className="section-subtitle capitalize">
          {user?.role} · {user?.dept_name || 'System'}
        </p>
      </div>

      {/* General User view */}
      {(!canManage || user?.role === 'user' || user?.role === 'student') && (
        <div className="space-y-6">
          {/* Weekly Work Target Hours Card */}
          <div className="card p-5 space-y-3 bg-gradient-to-r from-slate-900 via-slate-800 to-cyan-950/20">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Weekly Work Target ({user?.weekly_target_hours || 40} Hours/Week)</p>
                <h3 className="text-xl font-bold text-slate-100 mt-1">
                  {completedHoursThisWeek.toFixed(1)} / {user?.weekly_target_hours || 40} Hours Completed
                </h3>
              </div>
              <span className="badge badge-success text-xs font-bold px-3 py-1">
                {targetCompletedPercent}% Completed
              </span>
            </div>
            <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden border border-slate-700">
              <div
                className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400 rounded-full transition-all duration-500"
                style={{ width: `${targetCompletedPercent}%` }}
              />
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="card flex items-center justify-between p-4">
              <div>
                <p className="text-xs text-slate-500 font-medium">Today's Status</p>
                <div className="mt-1">
                  <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border capitalize ${STATUS_CLASSES[todayStatus]}`}>
                    {todayStatus.replace('_', ' ')}
                  </span>
                </div>
              </div>
              <CalendarCheck size={28} className="text-cyan-400" />
            </div>

            <div className="card flex items-center justify-between p-4">
              <div>
                <p className="text-xs text-slate-500 font-medium">Hours This Week</p>
                <h3 className="text-xl font-bold text-slate-100 mt-1 tabular-nums">
                  {completedHoursThisWeek.toFixed(1)} hrs
                </h3>
              </div>
              <Clock size={28} className="text-emerald-400" />
            </div>

            <div className="card flex items-center justify-between p-4">
              <div>
                <p className="text-xs text-slate-500 font-medium">Lates (This Month)</p>
                <h3 className="text-xl font-bold text-rose-400 mt-1 tabular-nums">
                  {lateCountMonth} {lateCountMonth === 1 ? 'day' : 'days'}
                </h3>
              </div>
              <Clock size={28} className="text-rose-400" />
            </div>

            <div className="card flex items-center justify-between p-4">
              <div>
                <p className="text-xs text-slate-500 font-medium">Attendance Rate</p>
                <h3 className="text-xl font-bold text-slate-100 mt-1 tabular-nums">
                  {attendanceRate}%
                </h3>
              </div>
              <TrendingUp size={28} className="text-pink-400" />
            </div>
          </div>

          {/* Assigned Work Schedule & Rules */}
          <div className="card p-5 bg-gradient-to-r from-slate-900 to-cyan-950/10 border border-cyan-500/10 space-y-3">
            <h4 className="font-bold text-sm text-slate-200 flex items-center gap-2">
              <Shield size={16} className="text-cyan-400" /> Your Assigned Work Schedule & Rules
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-400">
              <div className="space-y-1 bg-slate-800/40 p-3 rounded-lg border border-slate-700/30">
                <p className="text-slate-500 font-semibold uppercase tracking-wider text-[10px]">Check-in Deadline</p>
                <p className="text-sm font-semibold text-slate-200">
                  {user?.must_check_in_time ? `Must check in by ${user.must_check_in_time.substring(0, 5)}` : 'No fixed check-in deadline (Flexible)'}
                </p>
                <p className="text-[10px] text-slate-500">Checking in after this time automatically sets status to "Late".</p>
              </div>
              <div className="space-y-1 bg-slate-800/40 p-3 rounded-lg border border-slate-700/30">
                <p className="text-slate-500 font-semibold uppercase tracking-wider text-[10px]">Mandatory Presence (Core Hours)</p>
                <p className="text-sm font-semibold text-slate-200">
                  {user?.must_be_in_start ? `Must be present between ${user.must_be_in_start.substring(0, 5)} - ${user.must_be_in_end.substring(0, 5)}` : 'No mandatory core presence hours (Flexible)'}
                </p>
                <p className="text-[10px] text-slate-500">Leaving early or checking in late violates core hours presence.</p>
              </div>
            </div>
          </div>


          {/* Log filtering */}
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-slate-100">Your Attendance History</h2>
                <p className="text-xs text-slate-500 mt-0.5">{filteredRecords.length} records shown</p>
              </div>

              {/* Preset filters */}
              <div className="flex gap-1 bg-slate-800/80 p-0.5 rounded-lg border border-slate-700/50 w-fit">
                <button
                  onClick={() => setPreset('all')}
                  className={`text-xs px-3 py-1.5 rounded-md font-medium transition-all ${
                    preset === 'all' ? 'bg-cyan-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  All Time
                </button>
                <button
                  onClick={() => setPreset('week')}
                  className={`text-xs px-3 py-1.5 rounded-md font-medium transition-all ${
                    preset === 'week' ? 'bg-cyan-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  This Week
                </button>
                <button
                  onClick={() => setPreset('month')}
                  className={`text-xs px-3 py-1.5 rounded-md font-medium transition-all ${
                    preset === 'month' ? 'bg-cyan-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  This Month
                </button>
              </div>
            </div>

            {/* Custom filters panel */}
            <div className="card grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="label">Session</label>
                <select
                  value={filters.session_id}
                  onChange={e => setFilters(f => ({ ...f, session_id: e.target.value }))}
                  className="select text-xs py-1.5"
                >
                  <option value="">All Sessions</option>
                  {sessions.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label">Status</label>
                <select
                  value={filters.status}
                  onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}
                  className="select text-xs py-1.5"
                >
                  <option value="">All</option>
                  <option value="present">Present</option>
                  <option value="late">Late</option>
                  <option value="manual">Manual</option>
                  <option value="absent">Absent</option>
                </select>
              </div>

              <div>
                <label className="label">From Date</label>
                <input
                  type="date"
                  value={filters.date_from}
                  onChange={e => setFilters(f => ({ ...f, date_from: e.target.value }))}
                  className="input text-xs py-1.5"
                />
              </div>

              <div>
                <label className="label">To Date</label>
                <input
                  type="date"
                  value={filters.date_to}
                  onChange={e => setFilters(f => ({ ...f, date_to: e.target.value }))}
                  className="input text-xs py-1.5"
                />
              </div>
            </div>

            <AttendanceTable records={filteredRecords} loading={studentLoading} />
          </div>
        </div>
      )}

      {/* Admin/HR stats */}
      {canManage && (
        <>
          {loading ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="card h-32 animate-pulse bg-slate-800" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatsCard title="Total Users" value={stats?.total_users ?? '—'} icon={Users} color="cyan" />
              <StatsCard title="Today's Attendance" value={stats?.today_count ?? '—'} icon={CalendarCheck} color="emerald" />
              <StatsCard title="Total Records" value={stats?.total_records ?? '—'} icon={Database} color="violet" />
              <StatsCard
                title="Face Encodings"
                value={sysInfo?.total_encodings ?? '—'}
                subtitle={sysInfo?.face_recognition_available ? 'AI Active' : 'AI Offline'}
                icon={Camera}
                color={sysInfo?.face_recognition_available ? 'emerald' : 'rose'}
              />
            </div>
          )}

          {/* Chart */}
          {chartData && (
            <div className="card">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-lg font-bold text-slate-100">Attendance Trend</h2>
                  <p className="text-xs text-slate-500 mt-0.5">Last 7 days</p>
                </div>
                <TrendingUp size={20} className="text-cyan-400" />
              </div>
              <Bar data={chartData} options={chartOptions} height={80} />
            </div>
          )}

          {/* Quick actions */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <button
              onClick={() => navigate('/scanner')}
              className="card hover:border-cyan-500/40 transition-all duration-300 text-left group"
            >
              <Camera size={24} className="text-cyan-400 mb-3 group-hover:scale-110 transition-transform" />
              <h3 className="font-bold text-slate-100">Open Scanner</h3>
              <p className="text-sm text-slate-500 mt-1">Launch real-time face recognition</p>
            </button>
            <button
              onClick={() => navigate('/students/register')}
              className="card hover:border-emerald-500/40 transition-all duration-300 text-left group"
            >
              <Users size={24} className="text-emerald-400 mb-3 group-hover:scale-110 transition-transform" />
              <h3 className="font-bold text-slate-100">Register User</h3>
              <p className="text-sm text-slate-500 mt-1">Add new user with face capture</p>
            </button>
            <button
              onClick={() => navigate('/attendance/report')}
              className="card hover:border-violet-500/40 transition-all duration-300 text-left group"
            >
              <Clock size={24} className="text-violet-400 mb-3 group-hover:scale-110 transition-transform" />
              <h3 className="font-bold text-slate-100">Attendance Report</h3>
              <p className="text-sm text-slate-500 mt-1">Filter, view and export records</p>
            </button>
          </div>
        </>
      )}
    </div>
  )
}
