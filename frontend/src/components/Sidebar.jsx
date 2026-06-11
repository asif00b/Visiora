import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  LayoutDashboard, Users, Camera, ClipboardList, Settings, LogOut, X, ShieldCheck
} from 'lucide-react'

const NavItem = ({ to, icon: Icon, label, onClick }) => (
  <NavLink
    to={to}
    onClick={onClick}
    className={({ isActive }) =>
      `flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group
       ${isActive
         ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/30'
         : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'}`
    }
  >
    <Icon size={18} className="flex-shrink-0" />
    {label}
  </NavLink>
)

const NavSection = ({ title, children }) => (
  <div className="mb-2">
    <p className="text-xs font-semibold text-slate-600 uppercase tracking-widest px-4 mb-1">{title}</p>
    <div className="space-y-0.5">{children}</div>
  </div>
)

export default function Sidebar({ onClose }) {
  const { user, logout, isAdmin, canManage } = useAuth()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const close = onClose || (() => {})

  return (
    <div className="flex flex-col h-full w-64 bg-slate-900 border-r border-slate-800">
      {/* Logo */}
      <div className="flex items-center justify-between px-5 py-5 border-b border-slate-800">
        <div>
          <span className="text-gradient font-bold text-xl tracking-tight">Visiora</span>
          <p className="text-xs text-slate-500 mt-0.5">Recognize. Verify. Record.</p>
        </div>
        <button onClick={close} className="lg:hidden btn-icon">
          <X size={18} />
        </button>
      </div>

      {/* Nav — simplified to essential items only */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-4">
        <NavSection title="Main">
          <NavItem to="/dashboard" icon={LayoutDashboard} label="Dashboard" onClick={close} />
        </NavSection>

        {canManage && (
          <NavSection title="People">
            <NavItem to="/students" icon={Users} label="Students" onClick={close} />
          </NavSection>
        )}

        {canManage && (
          <NavSection title="Attendance">
            <NavItem to="/scanner" icon={Camera} label="Scanner" onClick={close} />
            <NavItem to="/attendance/report" icon={ClipboardList} label="Reports" onClick={close} />
          </NavSection>
        )}

        {isAdmin && (
          <NavSection title="Admin">
            <NavItem to="/admin/config" icon={Settings} label="Settings" onClick={close} />
          </NavSection>
        )}
      </nav>

      {/* User footer */}
      <div className="border-t border-slate-800 p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 rounded-full bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center flex-shrink-0">
            <ShieldCheck size={16} className="text-indigo-400" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-200 truncate">{user?.name}</p>
            <p className="text-xs capitalize text-slate-500">{user?.role}</p>
          </div>
        </div>
        <button
          id="sidebar-logout"
          onClick={handleLogout}
          className="w-full btn-danger text-sm py-2"
        >
          <LogOut size={15} />
          Sign Out
        </button>
      </div>
    </div>
  )
}
