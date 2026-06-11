import { useEffect, useRef, useState, useCallback } from 'react'
import { useCamera } from '../hooks/useCamera'
import { recognizeFace } from '../api/face'
import { getActiveSessions } from '../api/sessions'
import { Camera, CameraOff, Zap, UserCheck, Activity } from 'lucide-react'

export default function Scanner() {
  const { videoRef, canvasRef, isActive, error, devices, startCamera, stopCamera, captureFrame } = useCamera()
  const overlayRef = useRef(null)
  const intervalRef = useRef(null)
  const inFlightRef = useRef(false)
  const scannerIdRef = useRef(`scanner-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const markedRef = useRef(new Set())
  const debugRef = useRef({ active: false, landmarks: true, measurements: true, fps: true })
  const lastDrawTime = useRef(Date.now())
  const frameCount = useRef(0)
  const currentFps = useRef(0)

  const [sessions, setSessions] = useState([])
  const [selectedSession, setSelectedSession] = useState('')
  const [selectedCamera, setSelectedCamera] = useState('')
  const [scanning, setScanning] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [markedCount, setMarkedCount] = useState(0)
  const [debugToggles, setDebugToggles] = useState(debugRef.current)
  const [mirrored, setMirrored] = useState(false)

  const scannerIntervalMs = 240
  const scannerFrameMaxWidth = 640

  const toggleDebug = useCallback((key) => {
    setDebugToggles(prev => {
      const next = { ...prev, [key]: !prev[key] }
      debugRef.current = next
      return next
    })
  }, [])

  useEffect(() => {
    getActiveSessions()
      .then(r => setSessions(r.data.sessions || []))
      .catch(() => {})
  }, [])

  const drawBoxes = useCallback((faces) => {
    const video = videoRef.current
    const canvas = overlayRef.current
    if (!canvas || !video) return

    const nextWidth = Math.max(1, video.clientWidth)
    const nextHeight = Math.max(1, video.clientHeight)
    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      canvas.width = nextWidth
      canvas.height = nextHeight
    }

    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Calculate actual video dimensions and offsets (handling object-contain)
    const vWidth = video.videoWidth || 640
    const vHeight = video.videoHeight || 480
    const cWidth = canvas.width
    const cHeight = canvas.height
    
    const vRatio = vWidth / vHeight
    const cRatio = cWidth / cHeight
    
    let drawW, drawH, offsetX, offsetY
    if (cRatio > vRatio) {
      drawH = cHeight
      drawW = cHeight * vRatio
      offsetX = (cWidth - drawW) / 2
      offsetY = 0
    } else {
      drawW = cWidth
      drawH = cWidth / vRatio
      offsetX = 0
      offsetY = (cHeight - drawH) / 2
    }

    const now = Date.now()
    frameCount.current += 1
    if (now - lastDrawTime.current > 1000) {
      currentFps.current = frameCount.current
      frameCount.current = 0
      lastDrawTime.current = now
    }

    if (debugRef.current.active && debugRef.current.fps) {
      ctx.fillStyle = '#10b981'
      ctx.font = 'bold 16px monospace'
      ctx.fillText(`FPS: ${currentFps.current}`, 15, 25)
    }

    faces.forEach(face => {
      const { box, name, matched, confidence } = face
      if (!box) return

      const bTop = box.top ?? 0
      const bLeft = box.left ?? 0
      const bRight = box.right ?? 0
      const bBottom = box.bottom ?? 0

      // Map 0-1 coordinates to the actual video area
      const x_v = mirrored ? (1.0 - bRight) : bLeft
      const y_v = bTop
      const w_v = bRight - bLeft
      const h_v = bBottom - bTop

      const x = offsetX + (x_v * drawW)
      const y = offsetY + (y_v * drawH)
      const w = w_v * drawW
      const h = h_v * drawH

      const alreadyMarked = matched && markedRef.current.has(face.user_id)
      const justMarked = face.attendance_marked
      const statusColor = face.debug?.status_color || (matched ? '#10b981' : '#ef4444')

      ctx.strokeStyle = statusColor
      ctx.lineWidth = 2.5
      ctx.strokeRect(x, y, w, h)

      const corner = 14
      ctx.lineWidth = 3
      ;[[x, y], [x + w - corner, y], [x, y + h - corner], [x + w - corner, y + h - corner]].forEach(([cx, cy], i) => {
        ctx.beginPath()
        if (i === 0) { ctx.moveTo(cx, cy + corner); ctx.lineTo(cx, cy); ctx.lineTo(cx + corner, cy) }
        else if (i === 1) { ctx.moveTo(cx, cy); ctx.lineTo(cx + corner, cy); ctx.lineTo(cx + corner, cy + corner) }
        else if (i === 2) { ctx.moveTo(cx, cy); ctx.lineTo(cx, cy + corner); ctx.lineTo(cx + corner, cy + corner) }
        else { ctx.moveTo(cx, cy + corner); ctx.lineTo(cx + corner, cy + corner); ctx.lineTo(cx + corner, cy) }
        ctx.stroke()
      })

      const label = face.recognition_confirmed ? name : (face.debug?.status === 'STABILIZING' || !face.debug ? 'Scanning...' : 'Unknown')
      const sub = justMarked ? 'Marked' : alreadyMarked ? 'Present' : matched ? `${Number(confidence || 0).toFixed(0)}%` : ''
      ctx.font = 'bold 13px Inter, sans-serif'
      const textWidth = Math.max(ctx.measureText(label).width, ctx.measureText(sub).width) + 16
      const labelHeight = sub ? 42 : 24
      const labelX = Math.min(Math.max(4, x), canvas.width - textWidth - 4)
      const labelY = Math.max(4, y - labelHeight - 4)

      ctx.fillStyle = `${statusColor}D9`
      ctx.beginPath()
      ctx.roundRect(labelX, labelY, textWidth, labelHeight, 6)
      ctx.fill()

      ctx.fillStyle = '#fff'
      ctx.fillText(label, labelX + 8, labelY + 18)
      if (sub) {
        ctx.font = '12px Inter, sans-serif'
        ctx.fillText(sub, labelX + 8, labelY + 35)
      }

      if (debugRef.current.active && debugRef.current.landmarks && face.kpss) {
        face.kpss.forEach((pt, i) => {
          const px_v = mirrored ? (1.0 - pt.x) : pt.x
          const py_v = pt.y
          const px = offsetX + (px_v * drawW)
          const py = offsetY + (py_v * drawH)
          ctx.beginPath()
          ctx.arc(px, py, 2.5, 0, 2 * Math.PI)
          ctx.fillStyle = i < 2 ? '#3b82f6' : i === 2 ? '#eab308' : '#ec4899'
          ctx.fill()
          ctx.strokeStyle = '#fff'
          ctx.lineWidth = 1
          ctx.stroke()
        })
      }

      if (debugRef.current.active && debugRef.current.measurements && face.debug) {
        const panelW = 210
        const panelH = 126
        const panelX = x + w + panelW + 14 < canvas.width ? x + w + 10 : Math.max(10, x - panelW - 10)
        const panelY = Math.min(Math.max(10, y), canvas.height - panelH - 10)
        const hist = (face.debug.history || []).map(v => v ? String(v).slice(0, 3) : '---').join(',')

        ctx.fillStyle = 'rgba(15, 23, 42, 0.86)'
        ctx.beginPath()
        ctx.roundRect(panelX, panelY, panelW, panelH, 8)
        ctx.fill()
        ctx.strokeStyle = statusColor
        ctx.lineWidth = 1
        ctx.stroke()

        ctx.fillStyle = statusColor
        ctx.font = 'bold 11px monospace'
        ctx.fillText(`STATUS: ${face.debug.status || 'TRACKING'}`, panelX + 8, panelY + 19)
        ctx.fillStyle = '#cbd5e1'
        ctx.font = '10px monospace'
        ctx.fillText(`TRACK: ${face.debug.tracker_id} ${face.debug.tracker_backend || ''}`, panelX + 8, panelY + 38)
        ctx.fillText(`AGE:   ${face.debug.stable_frames || 0}f`, panelX + 8, panelY + 53)
        ctx.fillText(`SIM:   ${Number(face.debug.confidence || 0).toFixed(1)}%`, panelX + 8, panelY + 68)
        ctx.fillText(`DIST:  ${Number(face.debug.distance || 0).toFixed(3)}`, panelX + 8, panelY + 83)
        ctx.fillText(`ANGLE: ${Number(face.debug.eye_angle || 0).toFixed(1)} deg`, panelX + 8, panelY + 98)
        ctx.fillText(`HIST:  [${hist}]`, panelX + 8, panelY + 113)
      }
    })
  }, [videoRef])

  const doScan = useCallback(async () => {
    if (!isActive || inFlightRef.current) return
    const frame = captureFrame(0.58, 0, scannerFrameMaxWidth)
    if (!frame) return

    inFlightRef.current = true
    try {
      const res = await recognizeFace(frame, selectedSession || null, true, scannerIdRef.current)
      const processed = res.data.faces || []

      processed.forEach(face => {
        if (face.matched && markedRef.current.has(face.user_id)) {
          face.attendance_status = 'already_marked_today'
        }
        if (face.attendance_marked) {
          markedRef.current.add(face.user_id)
        }
      })

      requestAnimationFrame(() => drawBoxes(processed))

      const newMarks = processed.filter(f => f.attendance_marked).length
      if (newMarks > 0) {
        setMarkedCount(prev => prev + newMarks)
        processed.filter(f => f.attendance_marked).forEach(f => {
          const note = { id: Date.now() + Math.random(), name: f.name }
          setNotifications(n => [note, ...n].slice(0, 4))
          setTimeout(() => setNotifications(n => n.filter(x => x.id !== note.id)), 3500)
        })
      }
    } catch {
      // Drop this frame; the next interval will retry.
    } finally {
      inFlightRef.current = false
    }
  }, [isActive, captureFrame, selectedSession, drawBoxes])

  const handleStart = async () => {
    scannerIdRef.current = `scanner-${Date.now()}-${Math.random().toString(36).slice(2)}`
    inFlightRef.current = false
    markedRef.current = new Set()
    setMarkedCount(0)
    setNotifications([])
    const started = await startCamera(selectedCamera || null)
    setScanning(!!started)
  }

  const handleStop = () => {
    stopCamera()
    setScanning(false)
    clearInterval(intervalRef.current)
    if (overlayRef.current) {
      const ctx = overlayRef.current.getContext('2d')
      ctx?.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height)
    }
  }

  useEffect(() => {
    if (scanning && isActive) {
      intervalRef.current = setInterval(doScan, scannerIntervalMs)
    } else {
      clearInterval(intervalRef.current)
    }
    return () => clearInterval(intervalRef.current)
  }, [scanning, isActive, doScan])

  return (
    <div className="space-y-4 animate-fade-in">
      <div>
        <h1 className="section-title">Scanner</h1>
        <p className="section-subtitle">Face recognition attendance</p>
      </div>

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <select
          value={selectedSession}
          onChange={e => setSelectedSession(e.target.value)}
          className="select flex-1 sm:max-w-xs"
          disabled={scanning}
        >
          <option value="">No Session (General)</option>
          {sessions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>

        <select
          value={selectedCamera}
          onChange={e => setSelectedCamera(e.target.value)}
          className="select flex-1 sm:max-w-xs"
          disabled={scanning}
        >
          <option value="">Default Camera</option>
          {devices.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>)}
        </select>

        {!scanning ? (
          <button id="start-scanner-btn" onClick={handleStart} className="btn-primary py-3 px-6 text-base gap-2">
            <Camera size={20} /> Start Scanner
          </button>
        ) : (
          <button id="stop-scanner-btn" onClick={handleStop} className="btn-danger py-3 px-6 text-base gap-2">
            <CameraOff size={20} /> Stop Scanner
          </button>
        )}

        <button
          onClick={() => setMirrored(!mirrored)}
          className={`btn-secondary py-3 px-4 ${mirrored ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/50' : ''}`}
          title="Toggle Mirror View (Flip Box)"
        >
          <Zap size={20} className={mirrored ? 'fill-current' : ''} />
          <span className="hidden sm:inline ml-2">{mirrored ? 'Mirrored' : 'Direct'}</span>
        </button>

        {scanning && (
          <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
            <UserCheck size={16} className="text-emerald-400" />
            <span className="text-sm text-emerald-300 font-semibold">{markedCount} marked</span>
          </div>
        )}

        <button
          onClick={() => toggleDebug('active')}
          className={`ml-auto btn-secondary p-3 ${debugToggles.active ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/50' : ''}`}
          title="Toggle Debug Overlay"
        >
          <Activity size={20} />
        </button>
      </div>

      {debugToggles.active && (
        <div className="flex flex-wrap items-center gap-3 p-3 bg-slate-800/50 border border-slate-700/50 rounded-xl text-sm animate-fade-in">
          <span className="text-slate-400 font-medium px-2">Debug Toggles:</span>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={debugToggles.landmarks} onChange={() => toggleDebug('landmarks')} className="rounded bg-slate-700 border-slate-600 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-slate-800" />
            <span className="text-slate-300">Landmarks</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={debugToggles.measurements} onChange={() => toggleDebug('measurements')} className="rounded bg-slate-700 border-slate-600 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-slate-800" />
            <span className="text-slate-300">Measurements</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={debugToggles.fps} onChange={() => toggleDebug('fps')} className="rounded bg-slate-700 border-slate-600 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-slate-800" />
            <span className="text-slate-300">FPS Counter</span>
          </label>
        </div>
      )}

      <div className="relative rounded-2xl overflow-hidden border border-slate-700 bg-black" style={{ minHeight: '400px' }}>
        <video
          ref={videoRef}
          className="w-full h-full object-contain"
          style={{ maxHeight: '70vh', transform: mirrored ? 'scaleX(-1)' : 'none' }}
          muted
          playsInline
          autoPlay
        />

        <canvas ref={overlayRef} className="absolute inset-0 w-full h-full pointer-events-none" />
        <canvas ref={canvasRef} className="hidden" />

        {!isActive && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-slate-950">
            <Camera size={56} className="text-slate-600" />
            <p className="text-slate-500 text-lg font-medium">Camera offline</p>
            <p className="text-slate-600 text-sm">Click Start Scanner to begin</p>
          </div>
        )}

        {scanning && (
          <div className="absolute top-4 left-4 flex items-center gap-2 bg-black/60 backdrop-blur-sm rounded-full px-3 py-1.5">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-xs font-semibold text-white">LIVE</span>
          </div>
        )}

        <div className="absolute top-4 right-4 flex flex-col gap-2">
          {notifications.map(n => (
            <div key={n.id} className="flex items-center gap-2 bg-emerald-950/90 border border-emerald-700/50 backdrop-blur-sm text-emerald-300 text-sm font-medium px-4 py-2.5 rounded-xl shadow-lg animate-slide-up">
              <Zap size={14} className="text-emerald-400" />
              <span>{n.name}</span>
            </div>
          ))}
        </div>

        {error && (
          <div className="absolute bottom-4 left-4 right-4 p-3 bg-rose-950/90 border border-rose-700/50 rounded-xl text-rose-300 text-sm">
            {error}
          </div>
        )}
      </div>
    </div>
  )
}
