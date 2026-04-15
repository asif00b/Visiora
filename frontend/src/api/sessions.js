import api from './axios'
export const getSessions = () => api.get('/api/sessions')
export const getActiveSessions = () => api.get('/api/sessions/active')
export const createSession = (data) => api.post('/api/sessions', data)
export const updateSession = (id, data) => api.put(`/api/sessions/${id}`, data)
export const deleteSession = (id) => api.delete(`/api/sessions/${id}`)
