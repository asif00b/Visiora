import { useEffect, useRef, useState, useCallback } from 'react'
import { useCamera } from '../../hooks/useCamera'
import api from '../../api/axios'
import { Camera, CameraOff, RotateCw } from 'lucide-react'

/**
 * Admin Training Scanner
 *
 * Real-time face detection with face-shape contour overlay.
 * Uses InsightFace 106-point landmarks for jawline + forehead arc.
 */

export default function Training() {
  const { videoRef, canvasRef, isActive, error, devices, startCamera, stopCamera, captureFrame } = useCamera()
  const overlayRef    = useRef(null)
  const inFlightRef   = useRef(false)
  const intervalRef   = useRef(null)

  const [selectedCamera, setSelectedCamera] = useState('')
  const [videoRotation, setVideoRotation]   = useState(0)
  const [running, setRunning]               = useState(false)
  const [faceCount, setFaceCount]           = useState(0)
  const [fps, setFps]                       = useState(0)
  const lastFrameTime = useRef(Date.now())

  // ── Draw face contours on overlay ───────────────────────────────────────
  const drawFaces = useCallback((faces) => {
    const video  = videoRef.current
    const canvas = overlayRef.current
    if (!canvas || !video) return

    canvas.width  = video.clientWidth
    canvas.height = video.clientHeight
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    if (!faces || faces.length === 0) return

    faces.forEach(face => {
      const { contour, keypoints, score } = face

      if (!contour || contour.length < 5) return

      const cw = canvas.width
      const ch = canvas.height
      const pts = contour.map(([px, py]) => [cw - px * cw, py * ch])

      ctx.save()

      // Outer glow
      ctx.strokeStyle = 'rgba(34, 211, 238, 0.2)'
      ctx.lineWidth   = 5
      ctx.shadowColor = '#22d3ee'
      ctx.shadowBlur  = 12
      drawContourPath(ctx, pts, true)
      ctx.stroke()

      // Inner crisp line
      ctx.shadowBlur  = 2
      ctx.strokeStyle = '#22d3ee'
      ctx.lineWidth   = 1.5
      drawContourPath(ctx, pts, true)
      ctx.stroke()

      // Draw 5 keypoints (eyes, nose, mouth corners) as small dots
      if (keypoints && keypoints.length >= 5) {
        ctx.fillStyle = '#22d3ee'
        ctx.shadowBlur = 4
        keypoints.forEach(([kx, ky]) => {
          const x = cw - kx * cw
          const y = ky * ch
          ctx.beginPath()
          ctx.arc(x, y, 2.5, 0, Math.PI * 2)
          ctx.fill()
        })
      }

      ctx.restore()

      // Confidence label
      const topPt = pts.reduce((a, b) => a[1] < b[1] ? a : b)
      const centerX = pts.reduce((s, p) => s + p[0], 0) / pts.length
      const label = `${(score * 100).toFixed(0)}%`
      ctx.font = 'bold 11px Inter, system-ui, sans-serif'
      const tw = ctx.measureText(label).width + 12
      ctx.fillStyle = 'rgba(6, 182, 212, 0.8)'
      ctx.beginPath()
      ctx.roundRect(centerX - tw / 2, topPt[1] - 26, tw, 20, 5)
      ctx.fill()
      ctx.fillStyle = '#fff'
      ctx.textAlign  = 'center'
      ctx.fillText(label, centerX, topPt[1] - 11)
      ctx.textAlign  = 'left'
    })
  }, [videoRef])

  // ── Poll backend for face detection ─────────────────────────────────────
  const doDetect = useCallback(async () => {
    if (!isActive || inFlightRef.current) return

    const frame = captureFrame(0.4, videoRotation)
    if (!frame) return

    inFlightRef.current = true
    try {
      const res = await api.post('/api/face/detect', { image: frame })
      const faces = res.data.faces || []
      
      drawFaces(faces)
      setFaceCount(faces.length)

      const now = Date.now()
      const delta = now - lastFrameTime.current
      lastFrameTime.current = now
      if (delta > 0) setFps(Math.round(1000 / delta))
    } catch {
      // skip
    } finally {
      inFlightRef.current = false
    }
  }, [isActive, captureFrame, videoRotation, drawFaces])

  // ── Start / Stop ────────────────────────────────────────────────────────
  const handleStart = async () => {
    await startCamera(selectedCamera || null)
    setRunning(true)
  }

  const handleStop = () => {
    stopCamera()
    setRunning(false)
    setFaceCount(0)
    setFps(0)
    if (overlayRef.current) {
      const ctx = overlayRef.current.getContext('2d')
      ctx?.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height)
    }
  }

  // ── Detection loop ──────────────────────────────────────────────────────
  useEffect(() => {
    if (running && isActive) {
      intervalRef.current = setInterval(doDetect, 120)
    } else {
      clearInterval(intervalRef.current)
    }
    return () => clearInterval(intervalRef.current)
  }, [running, isActive, doDetect])

  const handleCameraChange = (e) => {
    const id = e.target.value
    setSelectedCamera(id)
    if (running) {
      stopCamera()
      setTimeout(() => startCamera(id || null), 300)
    }
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <div>
        <h1 className="section-title">Training Scanner</h1>
        <p className="section-subtitle">Real-time face contour detection & tracking</p>
      </div>

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <select value={selectedCamera} onChange={handleCameraChange}
                className="select flex-1 sm:max-w-xs" disabled={running}>
          <option value="">Default Camera</option>
          {devices.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>
          ))}
        </select>

        <button onClick={() => setVideoRotation(r => (r + 90) % 360)}
                className="p-2.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700 transition-colors"
                title="Rotate 90°">
          <RotateCw size={18} />
        </button>

        {!running ? (
          <button onClick={handleStart} className="btn-primary py-3 px-6 text-base gap-2">
            <Camera size={20} /> Start Scanner
          </button>
        ) : (
          <button onClick={handleStop} className="btn-danger py-3 px-6 text-base gap-2">
            <CameraOff size={20} /> Stop Scanner
          </button>
        )}

        {running && (
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-cyan-500/10 border border-cyan-500/30">
              <span className="text-sm text-cyan-300 font-semibold">{faceCount} face{faceCount !== 1 ? 's' : ''}</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800 border border-slate-700">
              <span className="text-sm text-slate-400 font-mono">{fps} fps</span>
            </div>
          </div>
        )}
      </div>

      <div className="relative rounded-2xl overflow-hidden border border-slate-700 bg-black"
           style={{ minHeight: '400px' }}>
        <video ref={videoRef} className="w-full h-full object-contain"
               style={{ maxHeight: '70vh', transform: `scaleX(-1) rotate(${videoRotation}deg)` }}
               muted playsInline autoPlay />
        <canvas ref={overlayRef} className="absolute inset-0 w-full h-full pointer-events-none" />
        <canvas ref={canvasRef} className="hidden" />

        {!isActive && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-slate-950">
            <Camera size={56} className="text-slate-600" />
            <p className="text-slate-500 text-lg font-medium">Camera offline</p>
            <p className="text-slate-600 text-sm">Click Start Scanner to begin</p>
          </div>
        )}

        {running && (
          <div className="absolute top-4 left-4 flex items-center gap-2 bg-black/60 backdrop-blur-sm rounded-full px-3 py-1.5">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
            <span className="text-xs font-semibold text-white">TRAINING</span>
          </div>
        )}

        {error && (
          <div className="absolute bottom-4 left-4 right-4 p-3 bg-rose-950/90 border border-rose-700/50 rounded-xl text-rose-300 text-sm">
            ⚠ {error}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Draw a contour as connected line segments.
 */
function drawContourPath(ctx, points, closed = false) {
  if (points.length < 3) return
  ctx.beginPath()
  ctx.moveTo(points[0][0], points[0][1])
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i][0], points[i][1])
  }
  if (closed) ctx.closePath()
}
