import api from './axios'

export const getAttendance = (params) => api.get('/api/attendance/report', { params })
export const getUserAttendance = (uid, params) => api.get(`/api/attendance/user/${uid}`, { params })
export const markAttendance = (data) => api.post('/api/attendance/mark', data)
export const postManualAttendance = (data) => api.post('/api/attendance/manual', data)
export const getStats = () => api.get('/api/attendance/stats')

export const exportCSV = async (params) => {
  const response = await api.get('/api/attendance/export', {
    params,
    responseType: 'blob',
  })
  const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8;' })
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.setAttribute('download', `attendance_report_${new Date().toISOString().slice(0, 10)}.csv`)
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.URL.revokeObjectURL(url)
}
