import api from './axios'
export const getAttendance = (params) => api.get('/api/attendance/report', { params })
export const getUserAttendance = (uid) => api.get(`/api/attendance/user/${uid}`)
export const markAttendance = (data) => api.post('/api/attendance/mark', data)
export const getStats = () => api.get('/api/attendance/stats')
export const exportCSV = (params) => {
  const query = new URLSearchParams(params).toString()
  window.open(`/api/attendance/export?${query}`, '_blank')
}
