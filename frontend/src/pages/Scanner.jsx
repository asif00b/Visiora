import { useEffect, useRef, useState, useCallback } from 'react'
import { useCamera } from '../hooks/useCamera'
import { recognizeFace } from '../api/face'
import { getActiveSessions } from '../api/sessions'
import { getConfig } from '../api/admin'
import { Camera, CameraOff, Settings, Maximize, X, Zap } from 'lucide-react'

/**
 * Always-ON Scanner Portal
 * - Fullscreen video feed
 * - Draws bounding boxes over detected faces (green=matched, red=unknown)
 * - Marks attendance automatically
 * - Shows toast when attendance is marked
 */

export default function Scanner() {
  const { videoRef, canvasRef, isActive, error, devices, startCamera, stopCamera, captureFrame } = useCamera()
  const overlayRef = useRef(null)
  const intervalRef = useRef(null)

  const [sessions, setSessions] = useState([])
  const [selectedSession, setSelectedSession] = useState('')
  const [scanning, setScanning] = useState(false)
  const [config, setConfig] = useState({ scanner_interval_ms: '800', recognition_tolerance: '0.55' })
  const [notifications, setNotifications] = useState([])  // [{id, name, color, ts}]
  const [scanResult, setScanResult] = useState([])        // latest faces
  const [selectedDevice, setSelectedDevice] = useState('')
  const [stats, setStats] = useState({ total: 0, marked: 0, unknown: 0 })
  const [showSettings, setShowSettings] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    Promise.all([
      getActiveSessions().catch(() => ({ data: { sessions: [] } })),
      getConfig().catch(() => ({ data: { config: {} } })),
    ]).then(([sr, cr]) => {
      setSessions(sr.data.sessions)
      setConfig(prev => ({ ...prev, ...cr.data.config }))
    })
  }, [])

  const drawBoxes = useCallback((faces) => {
    const video = videoRef.current
    const canvas = overlayRef.current
    if (!canvas || !video) return

    canvas.width = video.clientWidth
    canvas.height = video.clientHeight
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    faces.forEach(face => {
      const { box, name, matched, attendance_marked } = face
      if (!box) return

      const x = box.left * canvas.width
      const y = box.top * canvas.height
      const w = (box.right - box.left) * canvas.width
      const h = (box.bottom - box.top) * canvas.height

      // Box
      ctx.strokeStyle = matched ? '#10b981' : '#f43f5e'
      ctx.lineWidth = 2.5
      ctx.strokeRect(x, y, w, h)

      // Corner accents
      const cs = 16
      ctx.lineWidth = 3.5
      ;[[x, y], [x + w - cs, y], [x, y + h - cs], [x + w - cs, y + h - cs]].forEach(([cx, cy], i) => {
        ctx.beginPath()
        if (i === 0) { ctx.moveTo(cx, cy + cs); ctx.lineTo(cx, cy); ctx.lineTo(cx + cs, cy) }
        else if (i === 1) { ctx.moveTo(cx, cy); ctx.lineTo(cx + cs, cy); ctx.lineTo(cx + cs, cy + cs) }
        else if (i === 2) { ctx.moveTo(cx, cy); ctx.lineTo(cx, cy + cs); ctx.lineTo(cx + cs, cy + cs) }
        else { ctx.moveTo(cx, cy + cs); ctx.lineTo(cx + cs, cy + cs); ctx.lineTo(cx + cs, cy) }
        ctx.stroke()
      })

      // Label background
      const label = matched ? name : '? Unknown'
      const subLabel = attendance_marked ? '✓ Marked' : ''
      ctx.font = 'bold 13px Inter, sans-serif'
      const tw = Math.max(ctx.measureText(label).width, ctx.measureText(subLabel).width) + 16
      const lh = subLabel ? 44 : 26

      ctx.fillStyle = matched ? 'rgba(5, 150, 105, 0.85)' : 'rgba(220, 38, 38, 0.85)'
      ctx.beginPath()
      ctx.roundRect(x, y - lh - 4, tw, lh, 6)
      ctx.fill()

      ctx.fillStyle = '#fff'
      ctx.fillText(label, x + 8, y - lh + 16)
      if (subLabel) ctx.fillText(subLabel, x + 8, y - lh + 34)
    })
  }, [videoRef])

  const doScan = useCallback(async () => {
    if (!isActive) return
    const frame = captureFrame(0.75)
    if (!frame) return

    try {
      const res = await recognizeFace(frame, selectedSession || null, true)
      const faces = res.data.faces || []
      setScanResult(faces)
      drawBoxes(faces)

      // Update stats
      setStats(prev => ({
        total: prev.total + faces.length,
        marked: prev.marked + faces.filter(f => f.attendance_marked).length,
        unknown: prev.unknown + faces.filter(f => !f.matched).length,
      }))

      // Notifications  for newly marked
      faces.filter(f => f.attendance_marked).forEach(f => {
        const note = { id: Date.now() + Math.random(), name: f.name, color: 'emerald' }
        setNotifications(n => [note, ...n].slice(0, 5))
        setTimeout(() => setNotifications(n => n.filter(x => x.id !== note.id)), 4000)
      })
    } catch {
      // Silently ignore network errors during scan
    }
  }, [isActive, captureFrame, selectedSession, drawBoxes])

  const startScan = async () => {
    await startCamera(selectedDevice || null)
    setStats({ total: 0, marked: 0, unknown: 0 })
    setScanning(true)
  }

  const stopScan = () => {
    stopCamera()
    setScanning(false)
    if (overlayRef.current) {
      const ctx = overlayRef.current.getContext('2d')
      ctx.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height)
    }
  }

  // Run scan interval
  useEffect(() => {
    if (scanning && isActive) {
      const interval = parseInt(config.scanner_interval_ms) || 800
      intervalRef.current = setInterval(doScan, interval)
    } else {
      clearInterval(intervalRef.current)
    }
    return () => clearInterval(intervalRef.current)
  }, [scanning, isActive, doScan, config.scanner_interval_ms])

  const toggleFullscreen = () => {
    const el = document.getElementById('scanner-container')
    if (!document.fullscreenElement) {
      el?.requestFullscreen?.()
      setFullscreen(true)
    } else {
      document.exitFullscreen?.()
      setFullscreen(false)
    }
  }

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="section-title">Scanner Portal</h1>
          <p className="section-subtitle">Real-time face recognition attendance</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowSettings(v => !v)} className="btn-secondary">
            <Settings size={16} /> Settings
          </button>
          <button onClick={toggleFullscreen} className="btn-secondary">
            <Maximize size={16} /> Fullscreen
          </button>
        </div>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="card space-y-3">
          <h2 className="font-semibold text-slate-300 flex items-center gap-2"><Settings size={15} /> Scanner Settings</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div>
              <label className="label">Session</label>
              <select value={selectedSession} onChange={e => setSelectedSession(e.target.value)} className="select" disabled={scanning}>
                <option value="">No Session (General)</option>
                {sessions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            {devices.length > 1 && (
              <div>
                <label className="label">Camera</label>
                <select value={selectedDevice} onChange={e => setSelectedDevice(e.target.value)} className="select" disabled={scanning}>
                  <option value="">Default</option>
                  {devices.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>)}
                </select>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Stats bar */}
      {scanning && (
        <div className="flex gap-4">
          <div className="card-glass py-2.5 px-4 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs text-slate-400">Scans: <strong className="text-slate-200">{stats.total}</strong></span>
          </div>
          <div className="card-glass py-2.5 px-4 text-xs text-slate-400">
            Marked: <strong className="text-emerald-400">{stats.marked}</strong>
          </div>
          <div className="card-glass py-2.5 px-4 text-xs text-slate-400">
            Unknown: <strong className="text-rose-400">{stats.unknown}</strong>
          </div>
        </div>
      )}

      {/* Scanner window */}
      <div
        id="scanner-container"
        className="relative rounded-2xl overflow-hidden border border-slate-700 bg-black"
        style={{ minHeight: '400px' }}
      >
        <video
          ref={videoRef}
          className="w-full object-cover"
          style={{ maxHeight: '70vh' }}
          muted
          playsInline
          autoPlay
        />

        {/* Face box overlay canvas */}
        <canvas
          ref={overlayRef}
          className="absolute inset-0 w-full h-full pointer-events-none"
          style={{ position: 'absolute', top: 0, left: 0 }}
        />

        {/* Hidden capture canvas */}
        <canvas ref={canvasRef} className="hidden" />

        {/* Offline state */}
        {!isActive && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-slate-950">
            <Camera size={56} className="text-slate-600" />
            <p className="text-slate-500 text-lg font-medium">Camera offline</p>
            <p className="text-slate-600 text-sm">Click Start Scanner to begin</p>
          </div>
        )}

        {/* Scanning indicator */}
        {scanning && (
          <div className="absolute top-4 left-4 flex items-center gap-2 bg-black/60 backdrop-blur-sm rounded-full px-3 py-1.5">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-xs font-semibold text-white">LIVE</span>
          </div>
        )}

        {/* Attendance notifications */}
        <div className="absolute top-4 right-4 flex flex-col gap-2">
          {notifications.map(n => (
            <div key={n.id} className="flex items-center gap-2 bg-emerald-950/90 border border-emerald-700/50 backdrop-blur-sm text-emerald-300 text-sm font-medium px-3 py-2 rounded-xl animate-slide-up shadow-lg">
              <Zap size={14} className="text-emerald-400" />
              <span>✓ {n.name}</span>
            </div>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div className="absolute bottom-4 left-4 right-4 p-3 bg-rose-950/90 border border-rose-700/50 rounded-xl text-rose-300 text-sm">
            ⚠ {error}
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex gap-3">
        {!scanning ? (
          <button id="start-scanner-btn" onClick={startScan} className="btn-primary gap-3 py-3 px-6 text-base">
            <Camera size={20} /> Start Scanner
          </button>
        ) : (
          <button id="stop-scanner-btn" onClick={stopScan} className="btn-danger gap-3 py-3 px-6 text-base">
            <CameraOff size={20} /> Stop Scanner
          </button>
        )}
      </div>

      {/* Real-time face list */}
      {scanResult.length > 0 && (
        <div className="card">
          <h3 className="font-semibold text-slate-300 mb-3 text-sm">Last Scan Result</h3>
          <div className="flex flex-wrap gap-2">
            {scanResult.map((f, i) => (
              <div key={i} className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm border
                ${f.matched ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-rose-500/10 border-rose-500/30 text-rose-300'}`}>
                <span>{f.matched ? '✓' : '?'} {f.name}</span>
                <span className="text-xs opacity-60">{f.confidence?.toFixed(1)}%</span>
                {f.attendance_marked && <span className="badge-success text-xs">Marked</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
