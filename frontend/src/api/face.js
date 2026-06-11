import api from './axios'
export const registerFace       = (userId, images) => api.post('/api/face/register', { user_id: userId, images })
export const recognizeFace      = (image, sessionId = null, markAttendance = true, scannerId = 'default') =>
  api.post('/api/face/recognize', { image, session_id: sessionId, mark_attendance: markAttendance, scanner_id: scannerId })
export const deleteFaceEncodings = (userId) => api.delete(`/api/face/delete/${userId}`)
export const getEncodingsInfo   = (userId) => api.get(`/api/face/encodings/${userId}`)
export const checkLiveness = (image, sessionData) =>
  api.post('/api/face/liveness', { image, session_data: sessionData })

/**
 * Upload a dataset of images to improve recognition accuracy for a user.
 * Accepts a FileList of images or a single ZIP file.
 * @param {number} userId
 * @param {FileList|File[]} files
 */
export const trainDataset = (userId, files) => {
  const form = new FormData()
  const fileArr = Array.from(files)
  if (fileArr.length === 1 && fileArr[0].name.endsWith('.zip')) {
    form.append('zip', fileArr[0])
  } else {
    fileArr.forEach(f => form.append('images', f))
  }
  return api.post(`/api/face/train-dataset/${userId}`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,   // dataset processing can take a while
  })
}
