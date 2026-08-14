import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import RoleGuard from './components/RoleGuard'
import Layout from './components/Layout'

import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import UserList from './pages/Users/UserList'
import UserRegister from './pages/Users/UserRegister'
import UserProfile from './pages/Users/UserProfile'
import Departments from './pages/Departments'
import AttendanceReport from './pages/Attendance/AttendanceReport'
import Schedules from './pages/Admin/Schedules'
import Scanner from './pages/Scanner'
import AdminConfig from './pages/Admin/Config'
import UnknownFaces from './pages/Admin/UnknownFaces'
import ProfileRequests from './pages/Admin/ProfileRequests'
import LeaveManagement from './pages/Leaves/LeaveManagement'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public */}
          <Route path="/login" element={<Login />} />

          {/* Protected */}
          <Route element={<RoleGuard roles={['admin', 'hr', 'student', 'user']} />}>
            <Route element={<Layout />}>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/leaves" element={<LeaveManagement />} />
              <Route path="/users/:id" element={<UserProfile />} />

              {/* Backward compatibility route for student profiles */}
              <Route path="/students/:id" element={<UserProfile />} />

              {/* Admin + HR */}
              <Route element={<RoleGuard roles={['admin', 'hr']} />}>
                <Route path="/users" element={<UserList />} />
                <Route path="/users/register" element={<UserRegister />} />

                {/* Backward compatibility routes for student list & register */}
                <Route path="/students" element={<Navigate to="/users" replace />} />
                <Route path="/students/register" element={<Navigate to="/users/register" replace />} />

                <Route path="/attendance/report" element={<AttendanceReport />} />
                <Route path="/attendance/schedules" element={<Schedules />} />
                <Route path="/scanner" element={<Scanner />} />
              </Route>

              {/* Admin only */}
              <Route element={<RoleGuard roles={['admin']} />}>
                {/* Session management panel hidden per requirement */}
                {/* <Route path="/sessions" element={<Sessions />} /> */}
                <Route path="/departments" element={<Departments />} />
                <Route path="/admin/config" element={<AdminConfig />} />
                <Route path="/admin/unknown-faces" element={<UnknownFaces />} />
                <Route path="/admin/profile-requests" element={<ProfileRequests />} />
              </Route>
            </Route>
          </Route>

          {/* Catch-all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
