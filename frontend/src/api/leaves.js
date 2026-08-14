import api from './axios'

export const getMyLeaves = () => api.get('/api/leaves/my-leaves')
export const getLeaveSummary = () => api.get('/api/leaves/summary')
export const applyLeave = (data) => api.post('/api/leaves/apply', data)
export const updateLeave = (id, data) => api.put(`/api/leaves/${id}`, data)
export const getAlternativeUsers = () => api.get('/api/leaves/users')
export const getAllLeaves = (params) => api.get('/api/leaves/all', { params })
export const reviewLeave = (id, data) => api.put(`/api/leaves/${id}/review`, data)
export const deleteLeave = (id) => api.delete(`/api/leaves/${id}`)
