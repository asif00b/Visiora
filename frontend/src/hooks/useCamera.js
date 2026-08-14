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
          ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } }
          : { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } }
      }
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      streamRef.current = stream

      if (videoRef.current) {
        videoRef.current.srcObject = stream
        try {
          await videoRef.current.play()
        } catch (playErr) {
          // Ignore AbortError caused by React unmounting before play() resolves
          if (playErr.name !== 'AbortError') {
            console.warn('Camera play error:', playErr)
          }
        }
      }

      setIsActive(true)
      return true
    } catch (err) {
      setError(err.message || 'Camera access denied')
      setIsActive(false)
      return false
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
  const captureFrame = useCallback((quality = 0.72, rotation = 0, maxWidth = 640) => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || !isActive) return null
    if (video.readyState < 2) return null

    const vw = video.videoWidth || 640
    const vh = video.videoHeight || 480
    const scale = vw > maxWidth ? maxWidth / vw : 1
    const drawW = Math.round(vw * scale)
    const drawH = Math.round(vh * scale)

    // If rotated 90 or 270, swap width and height for the final capture
    if (rotation === 90 || rotation === 270) {
      canvas.width = drawH
      canvas.height = drawW
    } else {
      canvas.width = drawW
      canvas.height = drawH
    }

    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    
    ctx.save()
    // Move to center to rotate around center
    ctx.translate(canvas.width / 2, canvas.height / 2)
    ctx.rotate((rotation * Math.PI) / 180)
    
    // Draw centered
    ctx.drawImage(video, -drawW / 2, -drawH / 2, drawW, drawH)
    ctx.restore()

    return canvas.toDataURL('image/jpeg', quality)
  }, [isActive])

  // Clean up on unmount
  useEffect(() => {
    return () => stopCamera()
  }, [stopCamera])

  return { videoRef, canvasRef, isActive, error, devices, startCamera, stopCamera, captureFrame }
}
