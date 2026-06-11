import axios from 'axios'

// In production, VITE_API_URL points to the Render backend (e.g. https://visiora-api.onrender.com)
// In dev, Vite's proxy handles /api → localhost:5000 so we use '/'
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/',
  timeout: 120000,   // 120s — CNN face encoding can be slow
})

// Inject token from storage on every request
api.interceptors.request.use(config => {
  const token = localStorage.getItem('token')
  if (token) config.headers['Authorization'] = `Bearer ${token}`
  return config
})

// Redirect to login on 401
api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export default api
