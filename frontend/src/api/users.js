import api from './axios'
export const getUsers = (params) => api.get('/api/users', { params })
export const getUser = (id) => api.get(`/api/users/${id}`)
export const createUser = (data) => api.post('/api/users', data)
export const updateUser = (id, data) => api.put(`/api/users/${id}`, data)
export const deleteUser = (id) => api.delete(`/api/users/${id}`)
