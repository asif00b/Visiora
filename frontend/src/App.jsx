import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import RoleGuard from './components/RoleGuard'
import Layout from './components/Layout'

import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import StudentList from './pages/Students/StudentList'
import StudentRegister from './pages/Students/StudentRegister'
import StudentProfile from './pages/Students/StudentProfile'
import Sessions from './pages/Sessions'
import Departments from './pages/Departments'
import AttendanceReport from './pages/Attendance/AttendanceReport'
import Scanner from './pages/Scanner'
import AdminConfig from './pages/Admin/Config'
import UnknownFaces from './pages/Admin/UnknownFaces'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public */}
          <Route path="/login" element={<Login />} />

          {/* Protected */}
          <Route element={<RoleGuard roles={['admin', 'hr', 'student']} />}>
            <Route element={<Layout />}>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/students/:id" element={<StudentProfile />} />

              {/* Admin + HR */}
              <Route element={<RoleGuard roles={['admin', 'hr']} />}>
                <Route path="/students" element={<StudentList />} />
                <Route path="/students/register" element={<StudentRegister />} />
                <Route path="/attendance/report" element={<AttendanceReport />} />
                <Route path="/scanner" element={<Scanner />} />
              </Route>

              {/* Admin only */}
              <Route element={<RoleGuard roles={['admin']} />}>
                <Route path="/sessions" element={<Sessions />} />
                <Route path="/departments" element={<Departments />} />
                <Route path="/admin/config" element={<AdminConfig />} />
                <Route path="/admin/unknown-faces" element={<UnknownFaces />} />
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
