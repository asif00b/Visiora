import { useEffect, useRef, useState, useCallback } from 'react'
import { useCamera } from '../hooks/useCamera'
import { recognizeFace } from '../api/face'
import { markAttendance } from '../api/attendance'
import { getActiveSessions } from '../api/sessions'
import { Camera, CameraOff, Zap, UserCheck } from 'lucide-react'

/**
 * Simplified Scanner Portal
 *
 * - Start/Stop button + session dropdown (always visible, no hidden panels)
 * - Green bounding boxes with names
 * - Toast when attendance is marked
 * - Frontend dedup: once a user is marked, never sends another mark request
 *   and shows "✓ Present" on subsequent frames
 * - Backend also enforces one-per-day as a safety net
 */

export default function Scanner() {
  const { videoRef, canvasRef, isActive, error, startCamera, stopCamera, captureFrame } = useCamera()
  const overlayRef  = useRef(null)
  const intervalRef = useRef(null)
  const inFlightRef = useRef(false)
  const scannerIdRef = useRef(`scanner-${Date.now()}-${Math.random().toString(36).slice(2)}`)

  // Set of user IDs already marked in this scanning session — prevents duplicate API calls
  const markedRef = useRef(new Set())

  const [sessions, setSessions]               = useState([])
  const [selectedSession, setSelectedSession] = useState('')
  const [scanning, setScanning]               = useState(false)
  const [notifications, setNotifications]     = useState([])
  const [markedCount, setMarkedCount]         = useState(0)

  useEffect(() => {
    getActiveSessions()
      .then(r => setSessions(r.data.sessions))
      .catch(() => {})
  }, [])

  // ── Draw face boxes ─────────────────────────────────────────────────────
  const drawBoxes = useCallback((faces) => {
    const video  = videoRef.current
    const canvas = overlayRef.current
    if (!canvas || !video) return

    canvas.width  = video.clientWidth
    canvas.height = video.clientHeight
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    faces.forEach(face => {
      const { box, name, matched, confidence } = face
      if (!box) return

      const x = (box.left ?? 0) * canvas.width
      const y = (box.top  ?? 0) * canvas.height
      const w = ((box.right ?? 0) - (box.left ?? 0)) * canvas.width
      const h = ((box.bottom ?? 0) - (box.top ?? 0)) * canvas.height

      // Was this user already marked today?
      const alreadyMarked = matched && markedRef.current.has(face.user_id)
      const justMarked    = face.attendance_marked

      // Box color
      const green  = matched
      ctx.strokeStyle = green ? '#10b981' : '#f43f5e'
      ctx.lineWidth   = 2.5
      ctx.strokeRect(x, y, w, h)

      // Corner accents
      const cs = 14
      ctx.lineWidth = 3
      ;[[x, y], [x + w - cs, y], [x, y + h - cs], [x + w - cs, y + h - cs]].forEach(([cx, cy], i) => {
        ctx.beginPath()
        if (i === 0)      { ctx.moveTo(cx, cy + cs); ctx.lineTo(cx, cy); ctx.lineTo(cx + cs, cy) }
        else if (i === 1) { ctx.moveTo(cx, cy); ctx.lineTo(cx + cs, cy); ctx.lineTo(cx + cs, cy + cs) }
        else if (i === 2) { ctx.moveTo(cx, cy); ctx.lineTo(cx, cy + cs); ctx.lineTo(cx + cs, cy + cs) }
        else              { ctx.moveTo(cx, cy + cs); ctx.lineTo(cx + cs, cy + cs); ctx.lineTo(cx + cs, cy) }
        ctx.stroke()
      })

      // Label
      const label = matched ? name : 'Unknown'
      const sub   = justMarked ? '✓ Marked'
                  : alreadyMarked ? '✓ Present'
                  : matched ? `${confidence?.toFixed(0)}%`
                  : ''
      ctx.font   = 'bold 13px Inter, sans-serif'
      const tw   = Math.max(ctx.measureText(label).width, ctx.measureText(sub).width) + 16
      const lh   = sub ? 42 : 24

      ctx.fillStyle = green ? 'rgba(5,150,105,0.85)' : 'rgba(220,38,38,0.85)'
      ctx.beginPath()
      ctx.roundRect(x, y - lh - 4, tw, lh, 6)
      ctx.fill()

      ctx.fillStyle = '#fff'
      ctx.fillText(label, x + 8, y - lh + 15)
      if (sub) {
        ctx.font = '12px Inter, sans-serif'
        ctx.fillText(sub, x + 8, y - lh + 32)
      }
    })
  }, [videoRef])

  // ── Scan one frame ──────────────────────────────────────────────────────
  const doScan = useCallback(async () => {
    if (!isActive || inFlightRef.current) return
    const frame = captureFrame(0.70)
    if (!frame) return

    inFlightRef.current = true
    try {
      // Only request mark_attendance for faces NOT already marked on frontend
      const res   = await recognizeFace(frame, selectedSession || null, false, scannerIdRef.current)
      const faces = res.data.faces || []

      // Process results — track who was just marked
      const processed = [...faces]
      for (const f of processed) {
        if (f.matched && f.recognition_confirmed && !markedRef.current.has(f.user_id)) {
          try {
            const markRes = await markAttendance({
              user_id: f.user_id,
              session_id: selectedSession || null,
              status: 'present',
            })
            f.attendance_marked = !!markRes.data.marked
            f.attendance_status = markRes.data.reason
            if (markRes.data.marked || ['already_marked_today', 'cooldown'].includes(markRes.data.reason)) {
              markedRef.current.add(f.user_id)
            }
          } catch {
            f.attendance_status = 'mark_failed'
          }
        } else if (f.matched && markedRef.current.has(f.user_id)) {
          f.attendance_status = 'already_marked_today'
        }

        if (f.attendance_marked) {
          // Backend confirmed new mark — add to our dedup set
          markedRef.current.add(f.user_id)
        }
      }

      drawBoxes(processed)

      // Count new marks this session
      const newMarks = processed.filter(f => f.attendance_marked).length
      if (newMarks > 0) {
        setMarkedCount(prev => prev + newMarks)
      }

      // Show toast for newly marked faces
      processed.filter(f => f.attendance_marked).forEach(f => {
        const note = { id: Date.now() + Math.random(), name: f.name }
        setNotifications(n => [note, ...n].slice(0, 4))
        setTimeout(() => setNotifications(n => n.filter(x => x.id !== note.id)), 3500)
      })
    } catch {
      // Network error — skip this frame
    } finally {
      inFlightRef.current = false
    }
  }, [isActive, captureFrame, selectedSession, drawBoxes])

  // ── Start / Stop ────────────────────────────────────────────────────────
  const handleStart = async () => {
    scannerIdRef.current = `scanner-${Date.now()}-${Math.random().toString(36).slice(2)}`
    inFlightRef.current = false
    markedRef.current = new Set()
    setMarkedCount(0)
    setNotifications([])
    await startCamera()
    setScanning(true)
  }

  const handleStop = () => {
    stopCamera()
    setScanning(false)
    if (overlayRef.current) {
      const ctx = overlayRef.current.getContext('2d')
      ctx?.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height)
    }
  }

  // Scan interval
  useEffect(() => {
    if (scanning && isActive) {
      intervalRef.current = setInterval(doScan, 1000)
    } else {
      clearInterval(intervalRef.current)
    }
    return () => clearInterval(intervalRef.current)
  }, [scanning, isActive, doScan])

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="section-title">Scanner</h1>
        <p className="section-subtitle">Face recognition attendance</p>
      </div>

      {/* Session selector + Start/Stop — always visible, no hidden panel */}
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

        {!scanning ? (
          <button id="start-scanner-btn" onClick={handleStart}
                  className="btn-primary py-3 px-6 text-base gap-2">
            <Camera size={20} /> Start Scanner
          </button>
        ) : (
          <button id="stop-scanner-btn" onClick={handleStop}
                  className="btn-danger py-3 px-6 text-base gap-2">
            <CameraOff size={20} /> Stop Scanner
          </button>
        )}

        {scanning && (
          <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
            <UserCheck size={16} className="text-emerald-400" />
            <span className="text-sm text-emerald-300 font-semibold">{markedCount} marked</span>
          </div>
        )}
      </div>

      {/* Scanner video */}
      <div className="relative rounded-2xl overflow-hidden border border-slate-700 bg-black"
           style={{ minHeight: '400px' }}>

        <video ref={videoRef} className="w-full object-cover" style={{ maxHeight: '70vh' }}
               muted playsInline autoPlay />

        <canvas ref={overlayRef}
                className="absolute inset-0 w-full h-full pointer-events-none" />

        <canvas ref={canvasRef} className="hidden" />

        {/* Offline state */}
        {!isActive && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-slate-950">
            <Camera size={56} className="text-slate-600" />
            <p className="text-slate-500 text-lg font-medium">Camera offline</p>
            <p className="text-slate-600 text-sm">Click Start Scanner to begin</p>
          </div>
        )}

        {/* LIVE badge */}
        {scanning && (
          <div className="absolute top-4 left-4 flex items-center gap-2 bg-black/60 backdrop-blur-sm rounded-full px-3 py-1.5">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-xs font-semibold text-white">LIVE</span>
          </div>
        )}

        {/* Attendance toast notifications */}
        <div className="absolute top-4 right-4 flex flex-col gap-2">
          {notifications.map(n => (
            <div key={n.id}
                 className="flex items-center gap-2 bg-emerald-950/90 border border-emerald-700/50 backdrop-blur-sm text-emerald-300 text-sm font-medium px-4 py-2.5 rounded-xl shadow-lg animate-slide-up">
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
    </div>
  )
}
