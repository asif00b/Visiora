import { useState, useRef, useEffect, useCallback } from 'react'
import { useCamera } from '../hooks/useCamera'
import api from '../api/axios'
import { Camera, CheckCircle, Smile, MoveRight, MoveLeft, User } from 'lucide-react'

const INITIAL_STEPS = [
  { id: 'front',  label: 'Look straight & smile', icon: Smile, needsSmile: true },
  { id: 'left',   label: 'Turn head slightly left', icon: MoveLeft, needsSmile: false },
  { id: 'right',  label: 'Turn head slightly right', icon: MoveRight, needsSmile: false },
]

export default function GuidedCapture({ onCapture, maxImages = 10 }) {
  const { videoRef, canvasRef, isActive, error, devices, startCamera, stopCamera, captureFrame } = useCamera()
  const overlayRef   = useRef(null)
  const animRef      = useRef(null)
  const analyzeRef   = useRef(null)

  const [captures, setCaptures]       = useState([])
  const [steps, setSteps]             = useState(INITIAL_STEPS)
  const [stepIdx, setStepIdx]         = useState(0)
  const [instruction, setInstruction] = useState('Starting camera…')
  const [status, setStatus]           = useState('waiting')  // waiting | analyzing | hold | captured | done
  const [holdProgress, setHoldProgress] = useState(0)        // 0–100
  const [selectedCamera, setSelectedCamera] = useState('')
  const [videoRotation, setVideoRotation] = useState(0)
  const [isScanning, setIsScanning]   = useState(false)

  const currentStep = steps[stepIdx] || steps[0]
  const isDone = captures.length >= steps.length

  // ── Auto-start camera on mount or camera switch ──────────────────────────
  useEffect(() => {
    startCamera(selectedCamera || null)
    return () => stopCamera()
  }, [selectedCamera, startCamera, stopCamera])

  // Sync captures to parent component whenever it changes
  useEffect(() => {
    if (onCapture) {
      onCapture(captures)
    }
  }, [captures, onCapture])

  // ── Draw oval guide ─────────────────────────────────────────────────────
  const drawGuide = useCallback(() => {
    const video  = videoRef.current
    const canvas = overlayRef.current
    if (!canvas || !video) return

    canvas.width  = video.clientWidth  || 640
    canvas.height = video.clientHeight || 480
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const cx = canvas.width / 2
    const cy = canvas.height / 2
    const minDim = Math.min(canvas.width, canvas.height)
    const rx = minDim * 0.30
    const ry = rx * 1.35

    // Dark vignette
    ctx.save()
    ctx.fillStyle = 'rgba(0,0,0,0.50)'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.globalCompositeOperation = 'destination-out'
    ctx.beginPath()
    ctx.ellipse(cx, cy, rx + 6, ry + 6, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()

    // Oval border — color reflects status
    const color = status === 'hold' ? '#10b981'
                : status === 'captured' ? '#10b981'
                : status === 'analyzing' ? '#6366f1'
                : '#475569'
    ctx.strokeStyle = color
    ctx.lineWidth   = status === 'hold' ? 4 : 3
    ctx.beginPath()
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
    ctx.stroke()

    // Progress arc during "hold still"
    if (status === 'hold' && holdProgress > 0) {
      ctx.strokeStyle = '#10b981'
      ctx.lineWidth   = 5
      ctx.beginPath()
      ctx.ellipse(cx, cy, rx + 3, ry + 3, -Math.PI / 2, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * holdProgress / 100))
      ctx.stroke()
    }
  }, [videoRef, status, holdProgress])

  // Animation loop
  useEffect(() => {
    if (!isActive) return
    let stopped = false
    const loop = () => {
      if (stopped) return
      drawGuide()
      animRef.current = requestAnimationFrame(loop)
    }
    loop()
    return () => { stopped = true; cancelAnimationFrame(animRef.current) }
  }, [isActive, drawGuide])

  // ── Capture a frame ─────────────────────────────────────────────────────
  const doCapture = useCallback(() => {
    const frame = captureFrame(0.92, videoRotation)
    if (!frame) return

    const next = [...captures, frame]
    setCaptures(next)
    setStatus('captured')
    setHoldProgress(100)

    if (next.length >= steps.length) {
      setInstruction('All photos captured! ✓')
      setStatus('done')
    } else {
      setTimeout(() => {
        setStepIdx(prev => prev + 1)
        setStatus('waiting')
        setHoldProgress(0)
        goodFramesRef.current = 0
      }, 1500)
    }
  }, [captures, captureFrame, steps, videoRotation])

  // ── Discard a capture ───────────────────────────────────────────────────
  const discardCapture = (idx) => {
    const next = captures.filter((_, i) => i !== idx)
    setCaptures(next)
    setStepIdx(next.length)
    setStatus('waiting')
    setHoldProgress(0)
    goodFramesRef.current = 0
    if (next.length < steps.length) {
      setInstruction(steps[next.length].label)
    } else {
      setInstruction('All photos captured! ✓')
      setStatus('done')
    }
  }

  // ── Add more scans ──────────────────────────────────────────────────────
  const addMoreStep = () => {
    if (steps.length >= maxImages) {
      alert(`Maximum of ${maxImages} images reached.`)
      return
    }
    const nextStepNum = steps.length + 1
    const newStep = {
      id: `more_${nextStepNum}`,
      label: `Look straight or turn slightly (${nextStepNum})`,
      icon: User,
      needsSmile: false
    }
    setSteps([...steps, newStep])
    setStepIdx(steps.length)
    setStatus('waiting')
    setHoldProgress(0)
    goodFramesRef.current = 0
    setInstruction(`Look straight or turn slightly (${nextStepNum})`)
  }

  // ── Poll backend for face analysis ──────────────────────────────────────
  const isProcessingRef = useRef(false)
  const goodFramesRef   = useRef(0)
  const FRAMES_TO_CAPTURE = 1
  const YAW_THRESHOLD = 6

  useEffect(() => {
    if (!isActive || isDone || !isScanning) return

    const analyze = async () => {
      if (status === 'captured' || status === 'done') return
      if (isProcessingRef.current) return

      const frame = captureFrame(0.6, videoRotation)
      if (!frame) return

      isProcessingRef.current = true
      try {
        const res = await api.post('/api/face/analyze-frame', { image: frame })
        const d   = res.data
        const yaw = d.yaw_angle ?? 0

        if (!d.face_detected) {
          goodFramesRef.current = 0
          setStatus('analyzing')
          setHoldProgress(0)
          setInstruction('Position your face in the oval')
          return
        }
        if (!d.face_size_ok) {
          goodFramesRef.current = 0
          setStatus('analyzing')
          setHoldProgress(0)
          setInstruction('Move closer to the camera')
          return
        }
        if (!d.face_centered) {
          goodFramesRef.current = 0
          setStatus('analyzing')
          setHoldProgress(0)
          setInstruction('Center your face in the oval')
          return
        }

        // Step 1: Smile check (soft check)
        if (currentStep.needsSmile && !d.is_smiling) {
          goodFramesRef.current = 0
          setStatus('analyzing')
          setHoldProgress(0)
          setInstruction('Look straight & smile! 😊')
          return
        }

        // Step 2: Turn head LEFT (user turns physical left -> yaw >= +4°)
        if (currentStep.id === 'left' && yaw < 4) {
          goodFramesRef.current = 0
          setStatus('analyzing')
          setHoldProgress(0)
          setInstruction('Turn your head slightly to your LEFT ←')
          return
        }

        // Step 3: Turn head RIGHT (user turns physical right -> yaw <= -4°)
        if (currentStep.id === 'right' && yaw > -4) {
          goodFramesRef.current = 0
          setStatus('analyzing')
          setHoldProgress(0)
          setInstruction('Turn your head slightly to your RIGHT →')
          return
        }

        goodFramesRef.current += 1
        const progress = Math.min(100, Math.round((goodFramesRef.current / FRAMES_TO_CAPTURE) * 100))
        setHoldProgress(progress)
        setStatus('hold')

        if (currentStep.id === 'left') {
          setInstruction('Good! Hold still… ←')
        } else if (currentStep.id === 'right') {
          setInstruction('Good! Hold still… →')
        } else {
          setInstruction('Perfect! Hold still… ✓')
        }

        if (goodFramesRef.current >= FRAMES_TO_CAPTURE) {
          goodFramesRef.current = 0
          doCapture()
        }
      } catch {
        // Ignore network errors
      } finally {
        isProcessingRef.current = false
      }
    }

    analyzeRef.current = setInterval(analyze, 350)
    return () => clearInterval(analyzeRef.current)
  }, [isActive, isDone, isScanning, status, stepIdx, currentStep, captureFrame, doCapture, videoRotation])

  useEffect(() => () => clearInterval(analyzeRef.current), [])

  const StepIcon = currentStep?.icon || Camera

  return (
    <div className="space-y-4">
      {/* Camera selector & Rotate */}
      <div className="flex justify-center items-center gap-2 mb-2">
        {devices.length > 1 && (
          <select
            value={selectedCamera}
            onChange={e => setSelectedCamera(e.target.value)}
            className="select text-sm w-full sm:max-w-xs"
          >
            <option value="">Default Camera</option>
            {devices.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>)}
          </select>
        )}
        <button
          onClick={() => setVideoRotation(r => (r + 90) % 360)}
          className="p-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700 transition-colors"
          title="Rotate Camera 90°"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
        </button>
      </div>

      {/* Progress dots */}
      <div className="flex items-center justify-center gap-3 flex-wrap">
        {steps.map((s, i) => {
          return (
            <div key={s.id} className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all
                ${i < captures.length
                  ? 'bg-emerald-600 text-white'
                  : i === stepIdx && !isDone
                    ? 'bg-cyan-600 text-white ring-2 ring-cyan-400/50'
                    : 'bg-slate-800 text-slate-500'
                }`}>
                {i < captures.length ? <CheckCircle size={14} /> : i + 1}
              </div>
              <span className={`text-xs font-medium hidden sm:inline ${i === stepIdx && !isDone ? 'text-slate-200' : 'text-slate-600'}`}>
                {s.label}
              </span>
              {i < steps.length - 1 && <div className={`w-6 h-px ${i < captures.length ? 'bg-emerald-600' : 'bg-slate-700'}`} />}
            </div>
          )
        })}
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-sm">
          ⚠ {error}
        </div>
      )}

      <div className="relative rounded-2xl overflow-hidden bg-slate-900 border border-slate-700">
        <div className="w-full h-full" style={{ transform: 'scaleX(-1)' }}>
          <video
            ref={videoRef}
            className={`w-full h-full object-contain ${isActive ? 'block' : 'hidden'}`}
            style={{ maxHeight: '400px', transform: `rotate(${videoRotation}deg)` }}
            muted playsInline autoPlay
          />
        </div>

        {isActive && (
          <canvas
            ref={overlayRef}
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={{ transform: 'scaleX(-1)' }}
          />
        )}
        <canvas ref={canvasRef} className="hidden" />

        {!isActive && (
          <div className="flex flex-col items-center justify-center h-56 gap-3">
            <Camera size={40} className="text-slate-600 animate-pulse" />
            <p className="text-slate-500 text-sm">Starting camera…</p>
          </div>
        )}

        {/* Start Scan Overlay */}
        {isActive && !isScanning && (
          <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center z-10">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-cyan-600/15 border border-cyan-500/25 mb-4 animate-bounce">
              <Camera size={26} className="text-cyan-400" />
            </div>
            <h3 className="text-lg font-bold text-slate-100 mb-1">Guided Face Registration</h3>
            <p className="text-xs text-slate-400 max-w-xs mb-6">
              Click Start Scan to begin the guided automatic multi-angle photo captures.
            </p>
            <button
              onClick={() => {
                setIsScanning(true)
                setStatus('waiting')
                setInstruction(steps[0].label)
              }}
              className="px-6 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-sm transition-all hover:scale-105 active:scale-95 shadow-lg shadow-cyan-500/25"
              type="button"
            >
              Start Scan
            </button>
          </div>
        )}

        {/* Instruction overlay */}
        {isActive && isScanning && (
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/85 to-transparent p-5">
            <div className="flex items-center gap-4">
              <div className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 transition-colors
                ${status === 'hold' || status === 'captured'
                  ? 'bg-emerald-500/20 border-2 border-emerald-500'
                  : 'bg-cyan-500/20 border-2 border-cyan-500'}`}>
                {status === 'captured'
                  ? <CheckCircle size={22} className="text-emerald-400" />
                  : <StepIcon size={22} className={status === 'hold' ? 'text-emerald-400' : 'text-cyan-400'} />
                }
              </div>
              <div className="flex-1">
                <p className={`font-bold text-base ${status === 'hold' || status === 'captured' ? 'text-emerald-300' : 'text-white'}`}>
                  {instruction}
                </p>
                <p className="text-slate-400 text-xs mt-0.5">
                  {isDone
                    ? 'Registration photos complete'
                    : `Photo ${captures.length + 1} of ${steps.length}`
                  }
                </p>
              </div>

              {status === 'captured' && (
                <CheckCircle size={32} className="text-emerald-400 animate-pulse" />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Captured thumbnails (small) */}
      {captures.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-slate-500">Captured:</span>
          {captures.map((img, idx) => (
            <div key={idx} className="relative w-14 h-14 rounded-xl overflow-hidden border-2 border-emerald-500/50 group">
              <img src={img} alt={`Photo ${idx + 1}`} className="w-full h-full object-cover" />
              <div className="absolute bottom-0 right-0 w-4 h-4 bg-emerald-500 rounded-tl-lg flex items-center justify-center">
                <CheckCircle size={8} className="text-white" />
              </div>
              {/* Individual Discard Cross */}
              <button
                onClick={() => discardCapture(idx)}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-rose-600 hover:bg-rose-500 text-white flex items-center justify-center shadow transition-all scale-0 group-hover:scale-100 z-10 font-bold border border-slate-900"
                style={{ fontSize: '12px', lineHeight: 1 }}
                title="Discard this capture"
                type="button"
              >
                ×
              </button>
            </div>
          ))}

          {isDone && (
            <div className="flex items-center gap-2 ml-auto">
              <button
                onClick={addMoreStep}
                className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition-all hover:scale-105 active:scale-95"
                type="button"
              >
                + Add More
              </button>
              <span className="text-emerald-400 text-xs font-semibold">
                ✓ Ready
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
