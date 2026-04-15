import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import StatsCard from '../components/StatsCard'
import { ToastContainer, useToast } from '../components/Toast'
import { getStats } from '../api/attendance'
import { getSystemInfo } from '../api/admin'
import {
  Users, CalendarCheck, Database, Camera,
  TrendingUp, Clock, Shield, AlertTriangle
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
  const { toasts, removeToast } = useToast()
  const [stats, setStats] = useState(null)
  const [sysInfo, setSysInfo] = useState(null)
  const [loading, setLoading] = useState(true)

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
        }
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [canManage, isAdmin])

  const chartData = stats?.trend ? {
    labels: stats.trend.map(d => {
      const date = new Date(d.date)
      return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    }),
    datasets: [{
      label: 'Attendance',
      data: stats.trend.map(d => d.count),
      backgroundColor: 'rgba(99, 102, 241, 0.6)',
      borderColor: 'rgba(99, 102, 241, 1)',
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
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      {/* Header */}
      <div>
        <h1 className="section-title">
          Welcome back, <span className="text-gradient">{user?.name}</span>
        </h1>
        <p className="section-subtitle capitalize">
          {user?.role} · {user?.dept_name || 'System'}
        </p>
      </div>

      {/* Student view */}
      {user?.role === 'student' && (
        <div className="card-glass text-center py-12">
          <div className="w-20 h-20 rounded-full bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center mx-auto mb-4">
            <Shield size={32} className="text-indigo-400" />
          </div>
          <h2 className="text-xl font-bold text-slate-100">Your Profile</h2>
          <p className="text-slate-500 mt-1 text-sm mb-6">View your profile and attendance history</p>
          <button onClick={() => navigate(`/students/${user.id}`)} className="btn-primary">
            View My Profile
          </button>
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
              <StatsCard
                title="Total Students"
                value={stats?.total_users ?? '—'}
                icon={Users}
                color="indigo"
              />
              <StatsCard
                title="Today's Attendance"
                value={stats?.today_count ?? '—'}
                icon={CalendarCheck}
                color="emerald"
              />
              <StatsCard
                title="Total Records"
                value={stats?.total_records ?? '—'}
                icon={Database}
                color="violet"
              />
              <StatsCard
                title="Face Encodings"
                value={sysInfo?.total_encodings ?? '—'}
                subtitle={sysInfo?.face_recognition_available ? 'AI Active' : 'AI Offline'}
                icon={Camera}
                color={sysInfo?.face_recognition_available ? 'emerald' : 'rose'}
              />
            </div>
          )}

          {/* System alert */}
          {sysInfo && !sysInfo.face_recognition_available && (
            <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300">
              <AlertTriangle size={18} className="flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-sm">Face Recognition Offline</p>
                <p className="text-xs text-amber-400 mt-0.5">
                  The <code className="font-mono">face_recognition</code> library is not installed.
                  Run <code className="font-mono">setup.bat</code> to install it.
                </p>
              </div>
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
                <TrendingUp size={20} className="text-indigo-400" />
              </div>
              <Bar data={chartData} options={chartOptions} height={80} />
            </div>
          )}

          {/* Quick actions */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <button
              onClick={() => navigate('/scanner')}
              className="card hover:border-indigo-500/40 transition-all duration-300 text-left group"
            >
              <Camera size={24} className="text-indigo-400 mb-3 group-hover:scale-110 transition-transform" />
              <h3 className="font-bold text-slate-100">Open Scanner</h3>
              <p className="text-sm text-slate-500 mt-1">Launch real-time face recognition portal</p>
            </button>
            <button
              onClick={() => navigate('/students/register')}
              className="card hover:border-emerald-500/40 transition-all duration-300 text-left group"
            >
              <Users size={24} className="text-emerald-400 mb-3 group-hover:scale-110 transition-transform" />
              <h3 className="font-bold text-slate-100">Register Student</h3>
              <p className="text-sm text-slate-500 mt-1">Add new student with face capture</p>
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
