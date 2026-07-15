import api from './axios'

export const getProfileRequests = (status = 'pending') => api.get('/api/admin/profile-requests', { params: { status } })
export const approveProfileRequest = (id) => api.post(`/api/admin/profile-requests/${id}/approve`)
export const rejectProfileRequest = (id, reason) => api.post(`/api/admin/profile-requests/${id}/reject`, { reason })
