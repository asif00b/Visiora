import { useRef, useState, useCallback, useEffect } from 'react'

/**
 * Hook for webcam access.
 * Returns: videoRef, canvasRef, isActive, error, startCamera, stopCamera, captureFrame
 */
export function useCamera(cameraIndex = 0) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const [isActive, setIsActive] = useState(false)
  const [error, setError] = useState(null)
  const [devices, setDevices] = useState([])

  // Enumerate available cameras
  useEffect(() => {
    navigator.mediaDevices?.enumerateDevices?.().then(devs => {
      setDevices(devs.filter(d => d.kind === 'videoinput'))
    }).catch(() => {})
  }, [])

  const startCamera = useCallback(async (deviceId = null) => {
    setError(null)
    try {
      const constraints = {
        video: deviceId
          ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { width: { ideal: 1280 }, height: { ideal: 720 } }
      }
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      streamRef.current = stream

      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }

      setIsActive(true)
    } catch (err) {
      setError(err.message || 'Camera access denied')
      setIsActive(false)
    }
  }, [])

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setIsActive(false)
  }, [])

  /**
   * Capture current video frame as base64 JPEG.
   * @param {number} quality - JPEG quality 0-1
   */
  const captureFrame = useCallback((quality = 0.8) => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || !isActive) return null

    canvas.width = video.videoWidth || 640
    canvas.height = video.videoHeight || 480

    const ctx = canvas.getContext('2d')
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', quality)
  }, [isActive])

  // Clean up on unmount
  useEffect(() => {
    return () => stopCamera()
  }, [stopCamera])

  return { videoRef, canvasRef, isActive, error, devices, startCamera, stopCamera, captureFrame }
}
