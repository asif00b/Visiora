import api from './axios'
export const getDepartments = () => api.get('/api/departments')
export const createDepartment = (data) => api.post('/api/departments', data)
export const updateDepartment = (id, data) => api.put(`/api/departments/${id}`, data)
export const deleteDepartment = (id) => api.delete(`/api/departments/${id}`)
