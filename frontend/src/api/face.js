import api from './axios'
export const registerFace = (userId, images) => api.post('/api/face/register', { user_id: userId, images })
export const recognizeFace = (image, sessionId = null, markAttendance = true) =>
  api.post('/api/face/recognize', { image, session_id: sessionId, mark_attendance: markAttendance })
export const deleteFaceEncodings = (userId) => api.delete(`/api/face/delete/${userId}`)
export const checkLiveness = (image, sessionData) =>
  api.post('/api/face/liveness', { image, session_data: sessionData })
