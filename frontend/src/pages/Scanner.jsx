import { useEffect, useRef, useState, useCallback } from 'react'
import { useCamera } from '../hooks/useCamera'
import { recognizeFace } from '../api/face'
import { getActiveSessions } from '../api/sessions'
import { Camera, CameraOff, Zap, UserCheck, Activity, Maximize2, Minimize2 } from 'lucide-react'
// Estimate basic facial expression from 5 facial keypoints using geometry
const estimateEmotion = (kpss) => {
  if (!kpss || kpss.length < 5) return 'Neutral'
  try {
    const dxMouth = kpss[4].x - kpss[3].x
    const dyMouth = kpss[4].y - kpss[3].y
    const mouthWidth = Math.sqrt(dxMouth * dxMouth + dyMouth * dyMouth)

    const dxEyes = kpss[1].x - kpss[0].x
    const dyEyes = kpss[1].y - kpss[0].y
    const eyeDist = Math.sqrt(dxEyes * dxEyes + dyEyes * dyEyes)

    if (eyeDist === 0) return 'Neutral'
    const ratio = mouthWidth / eyeDist
    
    // Smile widens the mouth corners relative to the distance between eyes
    if (ratio > 0.82) return 'Happy'
    if (ratio < 0.65) return 'Serious'
    return 'Neutral'
  } catch {
    return 'Neutral'
  }
}

export default function Scanner() {
  const { videoRef, canvasRef, isActive, error, devices, startCamera, stopCamera, captureFrame } = useCamera()
  const overlayRef = useRef(null)
  const zoomWrapperRef = useRef(null)
  const currentScaleRef = useRef(1.0)
  const currentTxRef = useRef(0.0)
  const currentTyRef = useRef(0.0)
  const intervalRef = useRef(null)
  const inFlightRef = useRef(false)
  const scannerIdRef = useRef(`scanner-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const markedRef = useRef(new Set())
  const debugRef = useRef({ active: false, landmarks: true, measurements: true, fps: true })
  const lastScanTime = useRef(Date.now())
  const scanCount = useRef(0)
  const currentScanRate = useRef(0)
  const latestFacesRef = useRef([])

  const [sessions, setSessions] = useState([])
  const [selectedSession, setSelectedSession] = useState('')
  const [selectedCamera, setSelectedCamera] = useState('')
  const [scanning, setScanning] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [markedCount, setMarkedCount] = useState(0)
  const [debugToggles, setDebugToggles] = useState(debugRef.current)
  const [mirrored, setMirrored] = useState(false)

  const containerRef = useRef(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  const toggleFullscreen = () => {
    if (!containerRef.current) return
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {})
    } else {
      document.exitFullscreen().catch(() => {})
    }
  }

  const scannerIntervalMs = 150
  const scannerFrameMaxWidth = 640

  // ── Cyber Blue Theme Colors ──
  const THEME = {
    primary: '#00d4ff',       // Bright cyan for reticle & matched
    primaryDim: '#0891b2',    // Muted cyan
    accent: '#06b6d4',        // Tailwind cyan-500
    danger: '#ef4444',        // Red for unmatched
    success: '#10b981',       // Green for confirmed match
    text: '#e2e8f0',          // Slate-200
    textDim: '#64748b',       // Slate-500
    cardBg: 'rgba(8, 18, 40, 0.88)', // Deep navy glass
    cardBorder: 'rgba(6, 182, 212, 0.15)', // Cyan border
    landmarkEye: '#22d3ee',   // Cyan-400
    landmarkNose: '#facc15',  // Yellow
    landmarkMouth: '#f472b6', // Pink
  }

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

    // Calculate actual video dimensions and offsets (handling object-cover)
    const vWidth = video.videoWidth || 640
    const vHeight = video.videoHeight || 480
    const cWidth = canvas.width
    const cHeight = canvas.height
    
    const vRatio = vWidth / vHeight
    const cRatio = cWidth / cHeight
    
    let drawW, drawH, offsetX, offsetY
    if (cRatio > vRatio) {
      // Canvas is wider relative to video ratio, fill width and overflow height (object-cover)
      drawW = cWidth
      drawH = cWidth / vRatio
      offsetX = 0
      offsetY = (cHeight - drawH) / 2
    } else {
      // Canvas is taller relative to video ratio, fill height and overflow width (object-cover)
      drawH = cHeight
      drawW = cHeight * vRatio
      offsetX = (cWidth - drawW) / 2
      offsetY = 0
    }

    // Update scan rate counter (measured per second from doScan completions)
    const now = Date.now()
    if (now - lastScanTime.current > 1000) {
      currentScanRate.current = scanCount.current
      scanCount.current = 0
      lastScanTime.current = now
    }

    if (debugRef.current.active && debugRef.current.fps) {
      ctx.fillStyle = THEME.primary
      ctx.font = 'bold 14px monospace'
      const fpsText = `${currentScanRate.current} scans/s`
      const fpsTextWidth = ctx.measureText(fpsText).width
      ctx.fillText(fpsText, canvas.width - fpsTextWidth - 15, 25)
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

      const rawX = offsetX + (x_v * drawW)
      const rawY = offsetY + (y_v * drawH)
      const rawW = w_v * drawW
      const rawH = h_v * drawH

      // Calculate visual screen coordinates by applying current zoom & pan (keeping canvas sharp)
      const scale = currentScaleRef.current
      const txPx = (currentTxRef.current / 100) * canvas.width
      const tyPx = (currentTyRef.current / 100) * canvas.height
      const centerX = canvas.width / 2
      const centerY = canvas.height / 2

      const x = (rawX - centerX) * scale + centerX + txPx
      const y = (rawY - centerY) * scale + centerY + tyPx
      const w = rawW * scale
      const h = rawH * scale

      const alreadyMarked = matched && markedRef.current.has(face.user_id)
      const justMarked = face.attendance_marked
      
      // Color logic: GREEN = matched, RED = unknown/spoof, CYAN = scanning/stabilizing
      let statusColor = THEME.danger  // default: red for unknown
      if (face.recognition_confirmed || (matched && alreadyMarked)) {
        statusColor = THEME.success   // green for confirmed match
      } else if (matched) {
        statusColor = THEME.success   // green for matched
      } else if (face.debug?.status === 'SPOOF_DETECTED') {
        statusColor = THEME.danger    // red for spoof
      } else if (face.debug?.status === 'STABILIZING' || face.debug?.status === 'LIVENESS_CHECK') {
        statusColor = THEME.primary   // cyan while scanning
      }

      // ── Corner Bracket Reticle ──
      const cornerOffset = 4;
      const cornerLength = Math.min(22, w * 0.18, h * 0.18);
      const strokeWidth = 2.5;
      
      ctx.strokeStyle = statusColor;
      ctx.lineWidth = strokeWidth;
      
      // Top-Left Corner
      ctx.beginPath();
      ctx.moveTo(x - cornerOffset, y - cornerOffset + cornerLength);
      ctx.lineTo(x - cornerOffset, y - cornerOffset);
      ctx.lineTo(x - cornerOffset + cornerLength, y - cornerOffset);
      ctx.stroke();
      
      // Top-Right Corner
      ctx.beginPath();
      ctx.moveTo(x + w + cornerOffset - cornerLength, y - cornerOffset);
      ctx.lineTo(x + w + cornerOffset, y - cornerOffset);
      ctx.lineTo(x + w + cornerOffset, y - cornerOffset + cornerLength);
      ctx.stroke();
      
      // Bottom-Left Corner
      ctx.beginPath();
      ctx.moveTo(x - cornerOffset, y + h + cornerOffset - cornerLength);
      ctx.lineTo(x - cornerOffset, y + h + cornerOffset);
      ctx.lineTo(x - cornerOffset + cornerLength, y + h + cornerOffset);
      ctx.stroke();
      
      // Bottom-Right Corner
      ctx.beginPath();
      ctx.moveTo(x + w + cornerOffset - cornerLength, y + h + cornerOffset);
      ctx.lineTo(x + w + cornerOffset, y + h + cornerOffset);
      ctx.lineTo(x + w + cornerOffset, y + h + cornerOffset - cornerLength);
      ctx.stroke();

      // ── Faint dashed bounding box ──
      ctx.strokeStyle = statusColor + '15';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);

      // ── Subtle face ellipse ──
      ctx.strokeStyle = statusColor + '30';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, w / 2 * 1.05, h / 2 * 1.15, 0, 0, 2 * Math.PI);
      ctx.stroke();

      // ── Face Name / Identification Label ──
      const label = face.recognition_confirmed
        ? name
        : (face.debug?.status === 'SPOOF_DETECTED'
          ? 'Spoof Detected'
          : face.debug?.status === 'LIVENESS_CHECK'
            ? 'Blink or Move'
            : face.debug?.status === 'STABILIZING' || !face.debug
              ? 'Scanning...'
              : 'Unknown')
      const sub = justMarked ? 'Marked' : alreadyMarked ? 'Present' : matched ? `${Number(confidence || 0).toFixed(0)}%` : ''
      ctx.font = 'bold 12px Inter, sans-serif'
      const textWidth = Math.max(ctx.measureText(label).width, ctx.measureText(sub).width) + 16
      const labelHeight = sub ? 40 : 24
      const labelX = Math.min(Math.max(4, x), canvas.width - textWidth - 4)
      const labelY = Math.max(4, y - labelHeight - 8)

      // Deep navy glassmorphic card for label
      ctx.fillStyle = THEME.cardBg;
      ctx.beginPath();
      ctx.roundRect(labelX, labelY, textWidth, labelHeight, 6);
      ctx.fill();
      
      // Left border accent line
      ctx.strokeStyle = statusColor;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(labelX, labelY);
      ctx.lineTo(labelX, labelY + labelHeight);
      ctx.stroke();

      // Draw text
      ctx.fillStyle = THEME.text;
      ctx.font = 'bold 11px Inter, sans-serif';
      ctx.fillText(label, labelX + 8, labelY + 16);
      if (sub) {
        ctx.font = '500 10px Inter, sans-serif';
        ctx.fillStyle = statusColor;
        ctx.fillText(sub, labelX + 8, labelY + 31);
      }

      // ── Simplified Diagnostics Telemetry Panel (3 lines) ──
      if (debugRef.current.active && debugRef.current.measurements && face.debug) {
        const panelW = 200
        const panelH = 90
        const panelX = x + w + panelW + 14 < canvas.width ? x + w + 10 : Math.max(10, x - panelW - 10)
        const panelY = Math.min(Math.max(10, y), canvas.height - panelH - 10)

        // Deep navy glassmorphic card
        ctx.fillStyle = THEME.cardBg
        ctx.beginPath()
        ctx.roundRect(panelX, panelY, panelW, panelH, 10)
        ctx.fill()
        
        // Cyan border
        ctx.strokeStyle = THEME.cardBorder
        ctx.lineWidth = 1.5
        ctx.stroke()

        // Header bar
        const headerH = 24
        ctx.fillStyle = statusColor + '10'
        ctx.beginPath()
        ctx.roundRect(panelX, panelY, panelW, headerH, [10, 10, 0, 0])
        ctx.fill()

        ctx.fillStyle = statusColor
        ctx.font = 'bold 9px Inter, monospace'
        ctx.fillText(`SCAN #${face.debug.tracker_id}`, panelX + 10, panelY + 15)

        // Divider
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(panelX, panelY + headerH)
        ctx.lineTo(panelX + panelW, panelY + headerH)
        ctx.stroke()

        // ── Simplified 3-line stats ──
        // Line 1: Status (plain English)
        let displayStatus = 'Scanning...'
        if (face.debug.status === 'FACE_STABLE') {
          displayStatus = matched ? 'Matched ✓' : 'Unknown'
        }
        else if (face.debug.status === 'STABILIZING') displayStatus = 'Aligning...'
        else if (face.debug.status === 'LIVENESS_CHECK') displayStatus = 'Blink to Verify'
        else if (face.debug.status === 'SPOOF_DETECTED') displayStatus = 'Spoof Alert ✕'
        else if (face.debug.status === 'FACE_ROTATED') displayStatus = 'Face Rotated'

        // Line 2: Real-time geometric emotion estimate
        const emotionVal = estimateEmotion(face.kpss)

        // Line 3: Head tilt angle in degrees
        const rawAngle = face.debug.eye_angle || 0
        const displayAngle = `${rawAngle > 0 ? '+' : ''}${rawAngle.toFixed(1)}°`
        // 100% alignment score at 0 degrees, down to 0% at 20 degrees tilt
        const alignmentScore = Math.max(0, 20 - Math.min(20, Math.abs(rawAngle))) / 20

        const drawSimpleRow = (label, val, lineNum, barVal) => {
          const lineY = panelY + headerH + 16 + (lineNum * 18)
          
          // Label
          ctx.fillStyle = THEME.textDim
          ctx.font = 'bold 9px Inter, monospace'
          ctx.fillText(label, panelX + 10, lineY)
          
          // Value
          const isStatusLine = lineNum === 0
          ctx.fillStyle = isStatusLine ? statusColor : THEME.text
          ctx.font = isStatusLine ? 'bold 10px Inter, sans-serif' : '10px monospace'
          ctx.fillText(val, panelX + 70, lineY)

          // Progress bar (only drawn if barVal is specified)
          if (barVal !== undefined) {
            const barX = panelX + 135
            const barW = 55
            const barH = 4
            const barY = lineY - 5

            ctx.fillStyle = 'rgba(255, 255, 255, 0.05)'
            ctx.beginPath()
            ctx.roundRect(barX, barY, barW, barH, 2)
            ctx.fill()

            ctx.fillStyle = statusColor
            ctx.beginPath()
            ctx.roundRect(barX, barY, barW * Math.min(1, Math.max(0, barVal)), barH, 2)
            ctx.fill()
          }
        }

        drawSimpleRow('Status', displayStatus, 0)
        drawSimpleRow('Emotion', emotionVal, 1)
        drawSimpleRow('Angle', displayAngle, 2, alignmentScore)
      }
    })
  }, [videoRef, mirrored, scanning])

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

      // Store in ref for continuous 60fps render loop
      latestFacesRef.current = processed
      scanCount.current += 1  // Track real scan rate

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
      // Drop frame
    } finally {
      inFlightRef.current = false
    }
  }, [isActive, captureFrame, selectedSession])

  const handleStart = async () => {
    scannerIdRef.current = `scanner-${Date.now()}-${Math.random().toString(36).slice(2)}`
    inFlightRef.current = false
    markedRef.current = new Set()
    setMarkedCount(0)
    setNotifications([])
    latestFacesRef.current = [] // clear faces ref
    const started = await startCamera(selectedCamera || null)
    setScanning(!!started)
  }

  const handleStop = () => {
    stopCamera()
    setScanning(false)
    clearInterval(intervalRef.current)
    latestFacesRef.current = [] // clear faces ref
    if (overlayRef.current) {
      const ctx = overlayRef.current.getContext('2d')
      ctx?.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height)
    }
  }

  // Continuous rendering loop for 60fps HUD animations
  useEffect(() => {
    let animId
    const render = () => {
      const faces = latestFacesRef.current
      
      let targetScale = 1.0
      let targetTx = 0.0
      let targetTy = 0.0

      if (faces && faces.length > 0) {
        // Find bounding box enclosing all faces
        let minLeft = 1.0
        let minTop = 1.0
        let maxRight = 0.0
        let maxBottom = 0.0
        let validFacesCount = 0

        faces.forEach(f => {
          if (f.box) {
            minLeft = Math.min(minLeft, f.box.left ?? 0)
            minTop = Math.min(minTop, f.box.top ?? 0)
            maxRight = Math.max(maxRight, f.box.right ?? 1)
            maxBottom = Math.max(maxBottom, f.box.bottom ?? 1)
            validFacesCount++
          }
        })

        if (validFacesCount > 0) {
          const centerX = (minLeft + maxRight) / 2
          const centerY = (minTop + maxBottom) / 2
          const combinedW = maxRight - minLeft
          const combinedH = maxBottom - minTop

          // Adjust zoom padding based on number of faces
          // More padding for 1 face to keep it a comfortable size, less padding for multiple faces to keep them in view
          const zoomPadding = validFacesCount > 1 ? 1.8 : 2.8
          targetScale = 1.0 / Math.max(combinedW * zoomPadding, combinedH * zoomPadding)
          
          // Gentle max zoom of 1.45x for single face, and 1.2x for multiple faces
          const maxScale = validFacesCount > 1 ? 1.2 : 1.45
          targetScale = Math.max(1.0, Math.min(maxScale, targetScale))

          // Apply visual coordinate space based on whether feed is mirrored
          const visualCenterX = mirrored ? (1.0 - centerX) : centerX

          const video = videoRef.current
          if (video) {
            const vWidth = video.videoWidth || 640
            const vHeight = video.videoHeight || 480
            const cWidth = video.clientWidth || 640
            const cHeight = video.clientHeight || 480

            const vRatio = vWidth / vHeight
            const cRatio = cWidth / cHeight

            let drawW, drawH, offsetX, offsetY
            if (cRatio > vRatio) {
              drawW = cWidth
              drawH = cWidth / vRatio
              offsetX = 0
              offsetY = (cHeight - drawH) / 2
            } else {
              drawH = cHeight
              drawW = cHeight * vRatio
              offsetX = (cWidth - drawW) / 2
              offsetY = 0
            }

            const rawX = offsetX + visualCenterX * drawW
            const rawY = offsetY + centerY * drawH

            // Translate zoomWrapperRef by targetScale * distance from center
            targetTx = (0.5 - rawX / cWidth) * targetScale * 100
            targetTy = (0.5 - rawY / cHeight) * targetScale * 100

            // Clamp translation to prevent black bars at edges
            const maxTx = Math.max(0, (targetScale - 1) * 50)
            const maxTy = Math.max(0, (targetScale - 1) * 50)
            targetTx = Math.max(-maxTx, Math.min(maxTx, targetTx))
            targetTy = Math.max(-maxTy, Math.min(maxTy, targetTy))
          }
        }
      }

      // Smooth interpolation using a lerp factor of 0.08 (takes ~15-20 frames to settle)
      const lerp = 0.08
      currentScaleRef.current += (targetScale - currentScaleRef.current) * lerp
      currentTxRef.current += (targetTx - currentTxRef.current) * lerp
      currentTyRef.current += (targetTy - currentTyRef.current) * lerp

      // Directly update style transform on wrapper element for maximum performance
      if (zoomWrapperRef.current) {
        zoomWrapperRef.current.style.transform = `translate3d(${currentTxRef.current.toFixed(2)}%, ${currentTyRef.current.toFixed(2)}%, 0) scale(${currentScaleRef.current.toFixed(4)})`
      }

      drawBoxes(faces)
      animId = requestAnimationFrame(render)
    }

    if (scanning && isActive) {
      animId = requestAnimationFrame(render)
    } else {
      const canvas = overlayRef.current
      if (canvas) {
        const ctx = canvas.getContext('2d')
        ctx?.clearRect(0, 0, canvas.width, canvas.height)
      }
      if (zoomWrapperRef.current) {
        zoomWrapperRef.current.style.transform = 'translate3d(0, 0, 0) scale(1)'
      }
      currentScaleRef.current = 1.0
      currentTxRef.current = 0.0
      currentTyRef.current = 0.0
    }
    return () => {
      cancelAnimationFrame(animId)
    }
  }, [scanning, isActive, drawBoxes, mirrored])

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
          className={`btn-secondary py-3 px-4 ${mirrored ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/50' : ''}`}
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
          className={`ml-auto btn-secondary p-3 ${debugToggles.active ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/50' : ''}`}
          title="Toggle Debug Overlay"
        >
          <Activity size={20} />
        </button>
      </div>

      {debugToggles.active && (
        <div className="flex flex-wrap items-center gap-3 p-3 bg-slate-800/50 border border-slate-700/50 rounded-xl text-sm animate-fade-in">
          <span className="text-slate-400 font-medium px-2">Debug Toggles:</span>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={debugToggles.landmarks} onChange={() => toggleDebug('landmarks')} className="rounded bg-slate-700 border-slate-600 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-slate-800" />
            <span className="text-slate-300">Landmarks</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={debugToggles.measurements} onChange={() => toggleDebug('measurements')} className="rounded bg-slate-700 border-slate-600 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-slate-800" />
            <span className="text-slate-300">Measurements</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={debugToggles.fps} onChange={() => toggleDebug('fps')} className="rounded bg-slate-700 border-slate-600 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-slate-800" />
            <span className="text-slate-300">FPS Counter</span>
          </label>
        </div>
      )}

      <div 
        ref={containerRef}
        className={`relative mx-auto bg-black ${isFullscreen ? 'w-screen h-screen flex items-center justify-center' : 'w-full rounded-2xl overflow-hidden border border-slate-700'}`}
        style={isFullscreen ? {} : {
          aspectRatio: '1.1 / 1',
          maxWidth: 'min(650px, 82.5vh)',
          maxHeight: '75vh'
        }}
      >
        <div 
          className="relative w-full h-full"
          style={isFullscreen ? {
            aspectRatio: '1.1 / 1',
            maxWidth: 'min(100vw, 110vh)',
            maxHeight: '100vh',
            margin: '0 auto',
            overflow: 'hidden',
            border: '1px solid #334155',
            borderRadius: '1rem'
          } : {
            width: '100%',
            height: '100%'
          }}
        >
          <div
            ref={zoomWrapperRef}
            className="absolute inset-0 origin-center"
            style={{ transform: 'translate3d(0, 0, 0) scale(1)' }}
          >
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              style={{
                transform: mirrored ? 'scaleX(-1)' : 'none',
                filter: 'brightness(1.15) contrast(1.1)'
              }}
              muted
              playsInline
              autoPlay
            />
          </div>
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

          <button
            onClick={toggleFullscreen}
            className="absolute bottom-4 right-4 z-10 p-2.5 rounded-xl bg-black/60 hover:bg-black/80 text-white border border-slate-700/50 backdrop-blur-sm shadow-lg transition-all"
            title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
          >
            {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>

          <div className="absolute top-4 right-4 flex flex-col gap-2 z-10">
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
    </div>
  )
}
