import { useEffect, useRef, useState, useCallback } from 'react'
import { useCamera } from '../hooks/useCamera'
import { recognizeFace } from '../api/face'
import { getAttendance } from '../api/attendance'
import { verifyBiometricScan } from '../api/biometric'
import { Camera, CameraOff, Zap, UserCheck, Activity, Maximize2, Minimize2, Fingerprint, RefreshCw } from 'lucide-react'

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

  const [selectedCamera, setSelectedCamera] = useState('')
  const [scanning, setScanning] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [markedCount, setMarkedCount] = useState(0)
  const [debugToggles, setDebugToggles] = useState(debugRef.current)
  const [mirrored, setMirrored] = useState(true)
  const [bioMessage, setBioMessage] = useState('')
  const [sensorTouch, setSensorTouch] = useState(false)
  const [livePreviewSrc, setLivePreviewSrc] = useState(null)
  const [isSleeping, setIsSleeping] = useState(false)
  const lastMotionRef = useRef(Date.now())
  const scanningRef = useRef(false)

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

  const scannerIntervalMs = 120
  const scannerFrameMaxWidth = 720

  const THEME = {
    primary: '#00d4ff',
    primaryDim: '#0891b2',
    accent: '#06b6d4',
    danger: '#ef4444',
    success: '#10b981',
    text: '#e2e8f0',
    textDim: '#64748b',
    cardBg: 'rgba(8, 18, 40, 0.88)',
    cardBorder: 'rgba(6, 182, 212, 0.15)',
    landmarkEye: '#22d3ee',
    landmarkNose: '#facc15',
    landmarkMouth: '#f472b6',
  }

  const toggleDebug = useCallback((key) => {
    setDebugToggles(prev => {
      const next = { ...prev, [key]: !prev[key] }
      debugRef.current = next
      return next
    })
  }, [])

  // Load today's recent attendance records so the Live Feed NEVER vanishes
  const loadTodayAttendance = useCallback(async () => {
    try {
      const todayStr = new Date().toISOString().slice(0, 10)
      const res = await getAttendance({ start_date: todayStr, end_date: todayStr })
      const recs = res.data.attendance || []
      recs.sort((a, b) => new Date(b.punch_out || b.timestamp || 0) - new Date(a.punch_out || a.timestamp || 0))

      const items = recs.map(r => ({
        id: r.id,
        user_id: r.user_id,
        name: r.user_name || r.user?.name || 'User',
        photo: r.photo_url || r.user_image || r.user?.image_path || r.user?.photo_url || null,
        punch_type: r.punch_out ? 'OUT' : 'IN',
        method: (r.note || '').toLowerCase().includes('biometric') ? 'Fingerprint' : 'Face',
        time: new Date(r.punch_out || r.timestamp),
        student_id: r.user_student_id || r.user?.student_id || '—',
        in_time: r.timestamp,
        out_time: r.punch_out,
        target_hours: r.weekly_target_hours || r.user?.weekly_target_hours || 40.0,
        hours_worked: r.hours_worked || 0.0
      }))

      setNotifications(items.slice(0, 5))
      setMarkedCount(recs.length)
    } catch {
      // Keep existing
    }
  }, [])

  useEffect(() => {
    loadTodayAttendance()
  }, [loadTodayAttendance])

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
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Backend face coordinates are in the CAPTURED frame resolution (downscaled),
    // not the native camera resolution. Mirror the captureFrame downscale logic:
    const nativeW = video.videoWidth || 640
    const nativeH = video.videoHeight || 480
    const captureScale = nativeW > scannerFrameMaxWidth ? scannerFrameMaxWidth / nativeW : 1
    const capturedW = Math.round(nativeW * captureScale)
    const capturedH = Math.round(nativeH * captureScale)

    const scaleX = canvas.width / capturedW
    const scaleY = canvas.height / capturedH
    const activeDebug = debugRef.current

    if (faces.length > 0 && faces.some(f => f.matched)) {
      const primaryFace = faces.find(f => f.matched)
      if (primaryFace && (primaryFace.location || primaryFace.box)) {
        const [top, right, bottom, left] = primaryFace.location || [
          primaryFace.box.top * capturedH,
          primaryFace.box.right * capturedW,
          primaryFace.box.bottom * capturedH,
          primaryFace.box.left * capturedW
        ]
        const fw = (right - left) * scaleX
        const fh = (bottom - top) * scaleY
        const videoW = canvas.width
        const videoH = canvas.height

        const targetScale = Math.min(1.2, Math.max(1.0, 0.35 / (fw / videoW)))
        const faceCenterX = ((left + right) / 2) * scaleX
        const faceCenterY = ((top + bottom) / 2) * scaleY

        const targetTx = (videoW / 2 - faceCenterX) * (targetScale - 1.0)
        const targetTy = (videoH / 2 - faceCenterY) * (targetScale - 1.0)

        currentScaleRef.current += (targetScale - currentScaleRef.current) * 0.12
        currentTxRef.current += (targetTx - currentTxRef.current) * 0.12
        currentTyRef.current += (targetTy - currentTyRef.current) * 0.12
      }
    } else {
      currentScaleRef.current += (1.0 - currentScaleRef.current) * 0.15
      currentTxRef.current += (0.0 - currentTxRef.current) * 0.15
      currentTyRef.current += (0.0 - currentTyRef.current) * 0.15
    }

    if (zoomWrapperRef.current) {
      zoomWrapperRef.current.style.transform = `translate3d(${currentTxRef.current}px, ${currentTyRef.current}px, 0) scale(${currentScaleRef.current})`
    }

    faces.forEach((face) => {
      const loc = face.location || (face.box ? [
        face.box.top * capturedH,
        face.box.right * capturedW,
        face.box.bottom * capturedH,
        face.box.left * capturedW
      ] : null)

      if (!loc) return
      let [top, right, bottom, left] = loc

      // Expand reticle frame box (18% padding) so it surrounds face, forehead, hair & chin naturally
      const rawW = right - left
      const rawH = bottom - top
      const padW = rawW * 0.18
      const padH = rawH * 0.18

      left = Math.max(0, left - padW)
      right = Math.min(capturedW, right + padW)
      top = Math.max(0, top - padH * 1.2)
      bottom = Math.min(capturedH, bottom + padH * 0.8)

      let x = left * scaleX
      const y = top * scaleY
      const w = (right - left) * scaleX
      const h = (bottom - top) * scaleY

      if (mirrored) {
        x = canvas.width - x - w
      }

      const isConfirmed = face.matched && face.recognition_confirmed
      const isCandidate = face.matched && !face.recognition_confirmed
      const color = isConfirmed ? THEME.success : isCandidate ? THEME.primary : THEME.danger
      const glowColor = isConfirmed ? 'rgba(16, 185, 129, 0.4)' : isCandidate ? 'rgba(0, 212, 255, 0.4)' : 'rgba(239, 68, 68, 0.4)'

      ctx.save()
      ctx.shadowColor = glowColor
      ctx.shadowBlur = 16

      const cornerLen = Math.min(w, h) * 0.25
      const cornerRadius = 6

      ctx.strokeStyle = color
      ctx.lineWidth = 2.5
      ctx.beginPath()

      ctx.moveTo(x + cornerRadius, y)
      ctx.lineTo(x + cornerLen, y)
      ctx.moveTo(x, y + cornerRadius)
      ctx.lineTo(x, y + cornerLen)
      ctx.arcTo(x, y, x + cornerRadius, y, cornerRadius)

      ctx.moveTo(x + w - cornerLen, y)
      ctx.lineTo(x + w - cornerRadius, y)
      ctx.moveTo(x + w, y + cornerRadius)
      ctx.lineTo(x + w, y + cornerLen)
      ctx.arcTo(x + w, y, x + w - cornerRadius, y, cornerRadius)

      ctx.moveTo(x + cornerRadius, y + h)
      ctx.lineTo(x + cornerLen, y + h)
      ctx.moveTo(x, y + h - cornerRadius)
      ctx.lineTo(x, y + h - cornerLen)
      ctx.arcTo(x, y + h, x + cornerRadius, y + h, cornerRadius)

      ctx.moveTo(x + w - cornerLen, y + h)
      ctx.lineTo(x + w - cornerRadius, y + h)
      ctx.moveTo(x + w, y + h - cornerRadius)
      ctx.lineTo(x + w, y + h - cornerLen)
      ctx.arcTo(x + w, y + h, x + w - cornerRadius, y + h, cornerRadius)

      ctx.stroke()
      ctx.restore()

      if (activeDebug.active && activeDebug.landmarks && face.landmarks) {
        const kps = face.landmarks
        kps.forEach((pt, idx) => {
          let px = pt.x * scaleX
          const py = pt.y * scaleY
          if (mirrored) px = canvas.width - px

          ctx.beginPath()
          ctx.arc(px, py, 2.5, 0, 2 * Math.PI)
          if (idx <= 1) ctx.fillStyle = THEME.landmarkEye
          else if (idx === 2) ctx.fillStyle = THEME.landmarkNose
          else ctx.fillStyle = THEME.landmarkMouth
          ctx.fill()
        })
      }

      const cardW = Math.max(w * 1.15, 230)
      const cardH = 85
      let cardX = x + (w - cardW) / 2
      let cardY = y + h + 12

      if (cardX < 10) cardX = 10
      if (cardX + cardW > canvas.width - 10) cardX = canvas.width - cardW - 10
      if (cardY + cardH > canvas.height - 10) cardY = y - cardH - 12

      ctx.save()
      ctx.fillStyle = THEME.cardBg
      ctx.strokeStyle = THEME.cardBorder
      ctx.lineWidth = 1

      ctx.beginPath()
      ctx.roundRect(cardX, cardY, cardW, cardH, 12)
      ctx.fill()
      ctx.stroke()

      ctx.font = 'bold 15px system-ui, -apple-system, sans-serif'
      ctx.fillStyle = THEME.text
      ctx.fillText(face.name, cardX + 14, cardY + 24)

      ctx.font = '11px system-ui, -apple-system, sans-serif'
      const isSpoof = face.is_spoof || face.liveness_passed === false
      const statusText = isSpoof
        ? '⚠️ SPOOF ATTACK / PHOTO DETECTED'
        : face.matched
        ? (face.attendance_status === 'already_marked_today' ? 'ALREADY PUNCHED' : 'VERIFIED')
        : 'UNMATCHED'
      const statusColor = isSpoof ? THEME.danger : face.matched ? THEME.accent : THEME.danger

      ctx.fillStyle = statusColor
      ctx.fillText(statusText, cardX + 14, cardY + 40)

      if (activeDebug.active && activeDebug.measurements) {
        ctx.fillStyle = THEME.textDim
        ctx.fillText(`Dist: ${face.distance} | Exp: ${emotion}`, cardX + 14, cardY + 56)

        const barY = cardY + 66
        const barW = cardW - 28
        ctx.fillStyle = 'rgba(255,255,255,0.1)'
        ctx.fillRect(cardX + 14, barY, barW, 4)

        ctx.fillStyle = color
        ctx.fillRect(cardX + 14, barY, barW * (face.confidence / 100), 4)
      } else {
        const barY = cardY + 54
        const barW = cardW - 28
        ctx.fillStyle = 'rgba(255,255,255,0.1)'
        ctx.fillRect(cardX + 14, barY, barW, 4)

        ctx.fillStyle = color
        ctx.fillRect(cardX + 14, barY, barW * (face.confidence / 100), 4)
      }

      ctx.restore()
    })

    if (activeDebug.active && activeDebug.fps) {
      ctx.save()
      ctx.font = '12px monospace'
      ctx.fillStyle = THEME.textDim
      ctx.fillText(`API Rate: ${currentScanRate.current} fps`, 14, canvas.height - 14)
      ctx.restore()
    }
  }, [mirrored, THEME])

  const processFrame = useCallback(async () => {
    if (!isActive || inFlightRef.current || !scanningRef.current) return
    inFlightRef.current = true

    const frameB64 = captureFrame(0.80, 0, scannerFrameMaxWidth)
    if (!frameB64) {
      inFlightRef.current = false
      return
    }

    try {
      const res = await recognizeFace(frameB64, null, true, scannerIdRef.current)
      const processed = res.data.faces || []

      processed.forEach(face => {
        if (face.matched && markedRef.current.has(face.user_id)) {
          face.attendance_status = 'already_marked_today'
        }
        if (face.attendance_marked) {
          markedRef.current.add(face.user_id)
        }
      })

      latestFacesRef.current = processed
      scanCount.current += 1
      setIsSleeping(false)

      const newMarks = processed.filter(f => f.attendance_marked).length
      if (newMarks > 0) {
        setMarkedCount(prev => prev + newMarks)
        processed.filter(f => f.attendance_marked).forEach(f => {
          const note = { 
            id: Date.now() + Math.random(), 
            name: f.name,
            photo: f.photo_url || f.image || f.photo || null,
            punch_type: f.punch_type || 'IN',
            method: 'Face',
            time: new Date(),
            student_id: f.student_id,
            in_time: f.in_time,
            out_time: f.out_time,
            target_hours: f.target_hours
          }
          setNotifications(n => [note, ...n].slice(0, 10))
        })
      }
    } catch {
      // Drop frame
    } finally {
      inFlightRef.current = false
    }
  }, [isActive, captureFrame])

  const handleStart = async () => {
    scannerIdRef.current = `scanner-${Date.now()}-${Math.random().toString(36).slice(2)}`
    inFlightRef.current = false
    markedRef.current = new Set()
    latestFacesRef.current = []
    loadTodayAttendance()
    const started = await startCamera(selectedCamera || null)
    setScanning(!!started)
  }

  const handleStop = () => {
    stopCamera()
    setScanning(false)
    clearInterval(intervalRef.current)
    latestFacesRef.current = []
    if (overlayRef.current) {
      const ctx = overlayRef.current.getContext('2d')
      ctx?.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height)
    }
    loadTodayAttendance()
  }

  useEffect(() => {
    let animId
    const loop = () => {
      drawBoxes(latestFacesRef.current)
      animId = requestAnimationFrame(loop)
    }
    if (scanning) {
      animId = requestAnimationFrame(loop)
    }
    return () => cancelAnimationFrame(animId)
  }, [scanning, drawBoxes])

  useEffect(() => {
    if (!scanning) return
    const fpsTimer = setInterval(() => {
      const elapsed = (Date.now() - lastScanTime.current) / 1000
      currentScanRate.current = (scanCount.current / elapsed).toFixed(1)
      scanCount.current = 0
      lastScanTime.current = Date.now()
    }, 1000)
    return () => clearInterval(fpsTimer)
  }, [scanning])

  useEffect(() => {
    if (scanning && isActive) {
      intervalRef.current = setInterval(processFrame, scannerIntervalMs)
    } else {
      clearInterval(intervalRef.current)
    }
    return () => clearInterval(intervalRef.current)
  }, [scanning, isActive, processFrame, scannerIntervalMs])

  useEffect(() => {
    scanningRef.current = scanning
  }, [scanning])

  // Biometric Futronic fingerprint polling loop
  useEffect(() => {
    if (!scanning) return
    let isMounted = true

    const runLoop = async () => {
      await new Promise(r => setTimeout(r, 500))
      setBioMessage('Waiting for finger touch...')

      while (isMounted && scanningRef.current) {
        setSensorTouch(false)
        
        try {
          const scanRes = await verifyBiometricScan({
            session_id: null
          })

          if (!isMounted || !scanningRef.current) break

          if (scanRes.data.success && scanRes.data.attendance_marked) {
            try {
              const playBeep = (freq, delay, dur) => {
                const ctx = new (window.AudioContext || window.webkitAudioContext)()
                const osc = ctx.createOscillator()
                const g = ctx.createGain()
                osc.type = 'sine'
                osc.frequency.value = freq
                g.gain.value = 0.15
                osc.connect(g)
                g.connect(ctx.destination)
                osc.start(ctx.currentTime + delay)
                osc.stop(ctx.currentTime + delay + dur)
              }
              playBeep(880, 0, 0.1)
              playBeep(880, 0.15, 0.1)
            } catch {}

            setBioMessage(`✓ Attendance Verified: ${scanRes.data.user.name} (${scanRes.data.punch_type} Punch)`)
            setMarkedCount(c => c + 1)
            setNotifications(prev => [
              {
                id: Date.now(),
                name: scanRes.data.user.name,
                photo: scanRes.data.user?.photo_url || scanRes.data.user?.image_path || null,
                punch_type: scanRes.data.punch_type || 'IN',
                method: 'Fingerprint',
                time: new Date(),
                student_id: scanRes.data.user.student_id,
                in_time: scanRes.data.in_time,
                out_time: scanRes.data.out_time,
                target_hours: scanRes.data.target_hours
              },
              ...prev.slice(0, 9)
            ])

            await new Promise(r => setTimeout(r, 4000))
            if (isMounted && scanningRef.current) setBioMessage('')
          } else if (scanRes.data.success && !scanRes.data.attendance_marked) {
            setBioMessage(scanRes.data.message || `✓ Verified: ${scanRes.data.user.name} (Cooldown active: min 10 min wait between punches)`)
            await new Promise(r => setTimeout(r, 4000))
            if (isMounted && scanningRef.current) setBioMessage('')
          } else {
            if (scanRes.data.message && !scanRes.data.message.includes('timed out') && !scanRes.data.message.includes('No matching fingerprint')) {
              try {
                const ctx = new (window.AudioContext || window.webkitAudioContext)()
                const osc = ctx.createOscillator()
                const g = ctx.createGain()
                osc.type = 'sawtooth'
                osc.frequency.value = 220
                g.gain.value = 0.1
                osc.connect(g)
                g.connect(ctx.destination)
                osc.start()
                osc.stop(ctx.currentTime + 0.25)
              } catch {}
              setBioMessage(scanRes.data.message)
              await new Promise(r => setTimeout(r, 3000))
              if (isMounted && scanningRef.current) setBioMessage('')
            } else {
              setBioMessage('')
              await new Promise(r => setTimeout(r, 1000))
            }
          }
        } catch (err) {
          if (!isMounted || !scanningRef.current) break
          setBioMessage('')
          await new Promise(r => setTimeout(r, 1500))
        }
      }
    }

    runLoop()

    return () => {
      isMounted = false
    }
  }, [scanning])

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-in">
      <div className="lg:col-span-2 space-y-4">
        <div>
          <h1 className="section-title">Attendance Scanner</h1>
          <p className="section-subtitle">Real-time Biometric Attendance System</p>
        </div>

        {/* Clean Controls Bar (Session Removed) */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
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
                  transform: mirrored ? 'scaleX(-1)' : 'none'
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
              <div className="absolute top-4 left-4 flex items-center gap-2 bg-black/60 backdrop-blur-sm rounded-full px-3 py-1.5 z-20">
                <span className={`w-2 h-2 rounded-full ${isSleeping ? 'bg-amber-400 animate-ping' : 'bg-red-500 animate-pulse'}`} />
                <span className="text-xs font-semibold text-white">{isSleeping ? 'STANDBY' : 'LIVE SCANNER'}</span>
              </div>
            )}

            {scanning && isSleeping && (
              <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-[2px] flex flex-col items-center justify-center pointer-events-none animate-fade-in z-10">
                <div className="p-4 rounded-2xl bg-slate-900/90 border border-cyan-500/30 text-center space-y-2 max-w-xs shadow-2xl">
                  <div className="w-12 h-12 mx-auto rounded-full bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                    <Activity size={24} className="animate-pulse" />
                  </div>
                  <h4 className="text-sm font-bold text-slate-100 uppercase tracking-wider">System Standby</h4>
                  <p className="text-xs text-slate-400">Approach camera to activate</p>
                </div>
              </div>
            )}

            <button
              onClick={toggleFullscreen}
              className="absolute bottom-4 right-4 z-10 p-2.5 rounded-xl bg-black/60 hover:bg-black/80 text-white border border-slate-700/50 backdrop-blur-sm shadow-lg transition-all"
              title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
            >
              {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </button>

            {error && (
              <div className="absolute bottom-4 left-4 right-4 p-3 bg-rose-950/90 border border-rose-700/50 rounded-xl text-rose-300 text-sm">
                {error}
              </div>
            )}

            {scanning && (
              <div className="absolute bottom-4 left-4 z-20 flex flex-col items-start gap-2 max-w-[220px] pointer-events-none">
                {livePreviewSrc && (
                  <div className="relative p-1 rounded-xl bg-slate-900/80 border-2 border-cyan-500/50 shadow-lg shadow-cyan-500/20 backdrop-blur-md animate-fade-in overflow-hidden">
                    <div className="absolute inset-0 bg-cyan-500/20 animate-pulse pointer-events-none" />
                    <img src={livePreviewSrc} alt="Live Fingerprint" className="w-20 h-[120px] object-cover rounded-lg filter contrast-125 sepia opacity-80 mix-blend-screen" />
                  </div>
                )}
                {(bioMessage || sensorTouch) && (
                  <div className="px-3 py-2 bg-slate-900/90 border border-cyan-500/30 rounded-lg shadow-lg backdrop-blur-sm flex items-center gap-2 animate-fade-in">
                    <Fingerprint size={16} className={sensorTouch ? "text-cyan-400 animate-pulse" : "text-slate-400"} />
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${sensorTouch ? 'text-cyan-300' : 'text-slate-400'}`}>
                      {bioMessage || (sensorTouch ? 'Scanning...' : 'Ready')}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Right Column: Attendance Feed */}
      <div className="lg:col-span-1 flex flex-col lg:mt-24">
        <div className="card p-4 bg-slate-900/80 border border-slate-700/50 flex-1 overflow-hidden flex flex-col">
          <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Activity className="text-cyan-400" size={18} />
              <h2 className="text-sm font-bold text-slate-100 tracking-wide uppercase">Live Attendance Feed</h2>
            </div>
            <button
              onClick={loadTodayAttendance}
              className="text-xs text-slate-500 hover:text-cyan-400 flex items-center gap-1 transition-colors"
              title="Refresh Today's Records"
            >
              <RefreshCw size={12} /> Sync
            </button>
          </div>
          <div className="flex-1 flex flex-col gap-3 pr-1 overflow-hidden">
            {notifications.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-2 opacity-50 py-12">
                <UserCheck size={32} />
                <p className="text-xs font-medium uppercase tracking-wider">No scans today yet</p>
              </div>
            ) : (
              notifications.slice(0, 5).map((n, idx) => {
                const rawPhoto = n.photo || n.user_image || n.user?.image_path;
                let photoUrl = null;
                if (rawPhoto) {
                  if (rawPhoto.startsWith('http') || rawPhoto.startsWith('data:')) {
                    photoUrl = rawPhoto;
                  } else {
                    const cleanPath = String(rawPhoto).replace(/^\/?(storage\/)?/, '');
                    photoUrl = `/storage/${cleanPath}`;
                  }
                }

                const inTimeObj = n.in_time ? new Date(n.in_time) : (n.time ? new Date(n.time) : null);
                const inTimeStr = inTimeObj && !isNaN(inTimeObj) ? inTimeObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--';

                const outTimeObj = n.out_time ? new Date(n.out_time) : (n.punch_type === 'OUT' && n.time ? new Date(n.time) : null);
                const outTimeStr = outTimeObj && !isNaN(outTimeObj) ? outTimeObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : (n.punch_type === 'IN' ? 'In Office' : '--:--');

                return (
                  <div key={n.id || idx} className="flex-shrink-0 flex items-center gap-4 p-3.5 bg-gradient-to-r from-slate-900/90 via-slate-800/80 to-slate-900/90 rounded-xl border border-slate-700/60 shadow-lg backdrop-blur-md hover:border-cyan-500/40 transition-all animate-slide-up" style={{ animationDelay: `${idx * 40}ms` }}>
                    <div className="relative flex-shrink-0">
                      {photoUrl ? (
                        <img 
                          src={photoUrl} 
                          alt={n.name} 
                          className="w-14 h-14 rounded-xl object-cover border-2 border-cyan-500/40 shadow-md shadow-cyan-500/10"
                          onError={(e) => { e.currentTarget.src = ''; e.currentTarget.alt = n.name?.[0] || '?'; }}
                        />
                      ) : (
                        <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-cyan-950 via-slate-800 to-slate-900 border-2 border-cyan-500/30 flex items-center justify-center text-cyan-400 font-extrabold text-2xl shadow-lg shadow-cyan-500/10">
                          {n.name ? n.name.substring(0, 1).toUpperCase() : '?'}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0 space-y-0.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex flex-col min-w-0">
                          <h4 className="text-base font-bold text-slate-100 truncate tracking-wide">{n.name}</h4>
                          <span className="text-xs font-medium text-slate-400">ID: {n.student_id || 'N/A'}</span>
                        </div>
                        <div className="flex flex-col items-end gap-0.5">
                          <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-extrabold tracking-wider border ${n.punch_type === 'IN' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' : 'bg-amber-500/20 text-amber-300 border-amber-500/30'}`}>
                            {n.punch_type}
                          </span>
                          <span className="text-[9px] text-slate-500 uppercase font-bold tracking-wider">{n.method}</span>
                        </div>
                      </div>
                      
                      <div className="flex items-center justify-between pt-1 mt-1 border-t border-slate-800/50 text-[11px] font-medium">
                        <div className="flex flex-col">
                          <span className="text-slate-500 text-[9px] uppercase tracking-wider">IN Time</span>
                          <span className="text-emerald-400 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />{inTimeStr}</span>
                        </div>
                        <div className="flex flex-col items-center">
                          <span className="text-slate-500 text-[9px] uppercase tracking-wider">Rem. Target</span>
                          <span className="text-cyan-400 font-bold" title={`Weekly Target: ${n.target_hours || 40}h | Logged: ${(n.hours_worked || 0).toFixed(1)}h`}>
                            {Math.max(0, (n.target_hours || 40) - (n.hours_worked || 0)).toFixed(1)}h
                          </span>
                        </div>
                        <div className="flex flex-col items-end">
                          <span className="text-slate-500 text-[9px] uppercase tracking-wider">Left (Out Time)</span>
                          <span className="text-amber-400 flex items-center gap-1">{outTimeStr}<span className="w-1.5 h-1.5 rounded-full bg-amber-400" /></span>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
