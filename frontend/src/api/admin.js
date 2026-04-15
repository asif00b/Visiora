import api from './axios'
export const getConfig = () => api.get('/api/admin/config')
export const updateConfig = (data) => api.put('/api/admin/config', data)
export const getUnknownFaces = () => api.get('/api/admin/unknown-faces')
export const assignUnknownFace = (id, userId) => api.post(`/api/admin/unknown-faces/${id}/assign`, { user_id: userId })
export const deleteUnknownFace = (id) => api.delete(`/api/admin/unknown-faces/${id}`)
export const reloadCache = () => api.post('/api/admin/reload-cache')
export const getSystemInfo = () => api.get('/api/admin/system-info')
