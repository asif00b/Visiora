import api from './axios'

export const getBiometricStatus = () => api.get('/api/biometric/status')

export const pollHardwareSensor = () => api.get('/api/biometric/poll-hardware')

export const enrollFingerprint = (data) => api.post('/api/biometric/enroll', data)

export const verifyBiometricScan = (data) => api.post('/api/biometric/verify', data)

export const getUserFingerprints = (uid) => api.get(`/api/biometric/user/${uid}`)

export const deleteFingerprint = (fid) => api.delete(`/api/biometric/fingerprint/${fid}`)
