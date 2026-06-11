import { useState, useRef, useEffect, useCallback } from 'react'
import { useCamera } from '../hooks/useCamera'
import api from '../api/axios'
import { Camera, CheckCircle, Smile, MoveRight, MoveLeft, User } from 'lucide-react'

/**
 * KYC-Style Smart Face Capture
 *
 * Flow:
 *   1. Camera auto-starts
 *   2. Polls /api/face/analyze-frame at ~2fps
 *   3. Shows guided prompts: "Center face" → "Move closer" → "Smile!" → auto-capture
 *   4. After first capture: "Turn slightly left" → auto-capture
 *   5. Then: "Turn slightly right" → auto-capture
 *   6. 3 captures done → auto-submits via onCapture([img1, img2, img3])
 *
 * NO manual buttons. Fully automatic.
 */

const STEPS = [
  { id: 'front',  label: 'Look straight & smile', icon: Smile, needsSmile: true },
  { id: 'left',   label: 'Turn head slightly left', icon: MoveLeft, needsSmile: false },
  { id: 'right',  label: 'Turn head slightly right', icon: MoveRight, needsSmile: false },
]

const TOTAL_CAPTURES = 3

export default function GuidedCapture({ onCapture, maxImages = TOTAL_CAPTURES }) {
  const { videoRef, canvasRef, isActive, error, startCamera, stopCamera, captureFrame } = useCamera()
  const overlayRef   = useRef(null)
  const animRef      = useRef(null)
  const analyzeRef   = useRef(null)
  const holdTimer    = useRef(null)

  const [captures, setCaptures]       = useState([])
  const [stepIdx, setStepIdx]         = useState(0)
  const [instruction, setInstruction] = useState('Starting camera…')
  const [status, setStatus]           = useState('waiting')  // waiting | analyzing | hold | captured | done
  const [holdProgress, setHoldProgress] = useState(0)        // 0–100

  const currentStep = STEPS[stepIdx] || STEPS[0]
  const isDone = captures.length >= TOTAL_CAPTURES

  // ── Auto-start camera on mount ──────────────────────────────────────────
  useEffect(() => {
    startCamera()
    return () => stopCamera()
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

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
    const rx = canvas.width  * 0.22
    const ry = canvas.height * 0.36

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
    const frame = captureFrame(0.92)
    if (!frame) return

    const next = [...captures, frame]
    setCaptures(next)
    setStatus('captured')

    if (next.length >= TOTAL_CAPTURES) {
      // All done
      setInstruction('All photos captured! ✓')
      setStatus('done')
      if (onCapture) onCapture(next)
    } else {
      // Move to next step after a brief pause
      setTimeout(() => {
        setStepIdx(prev => prev + 1)
        setStatus('analyzing')
        setHoldProgress(0)
      }, 1000)
    }
  }, [captures, captureFrame, onCapture])

  // ── Poll backend for face analysis ──────────────────────────────────────
  useEffect(() => {
    if (!isActive || isDone) return

    const analyze = async () => {
      if (status === 'captured' || status === 'done') return

      const frame = captureFrame(0.6)
      if (!frame) return

      try {
        const res = await api.post('/api/face/analyze-frame', { image: frame })
        const d   = res.data

        if (!d.face_detected) {
          setInstruction('Position your face in the oval')
          setStatus('analyzing')
          setHoldProgress(0)
          clearTimeout(holdTimer.current)
          return
        }

        if (!d.face_size_ok) {
          setInstruction('Move closer to the camera')
          setStatus('analyzing')
          setHoldProgress(0)
          clearTimeout(holdTimer.current)
          return
        }

        if (!d.face_centered) {
          setInstruction('Center your face in the oval')
          setStatus('analyzing')
          setHoldProgress(0)
          clearTimeout(holdTimer.current)
          return
        }

        // Face is good — check step-specific condition
        if (currentStep.needsSmile && !d.is_smiling) {
          setInstruction('Now smile! 😊')
          setStatus('analyzing')
          setHoldProgress(0)
          clearTimeout(holdTimer.current)
          return
        }

        // For angle steps (left/right), just need face detected + centered
        if (!currentStep.needsSmile && stepIdx > 0) {
          setInstruction(currentStep.label + ' — hold still…')
        } else {
          setInstruction('Perfect! Hold still… ✓')
        }

        // Start hold timer if not already counting
        if (status !== 'hold') {
          setStatus('hold')
          setHoldProgress(0)
          let progress = 0
          clearTimeout(holdTimer.current)

          const tick = () => {
            progress += 20
            setHoldProgress(progress)
            if (progress >= 100) {
              doCapture()
            } else {
              holdTimer.current = setTimeout(tick, 200)
            }
          }
          holdTimer.current = setTimeout(tick, 200)
        }
      } catch {
        // Network error — keep trying
      }
    }

    analyzeRef.current = setInterval(analyze, 500)
    return () => {
      clearInterval(analyzeRef.current)
      clearTimeout(holdTimer.current)
    }
  }, [isActive, isDone, status, stepIdx, currentStep, captureFrame, doCapture])

  // Cleanup
  useEffect(() => () => { clearTimeout(holdTimer.current); clearInterval(analyzeRef.current) }, [])

  const StepIcon = currentStep.icon

  return (
    <div className="space-y-4">
      {/* Progress dots */}
      <div className="flex items-center justify-center gap-3">
        {STEPS.map((s, i) => (
          <div key={s.id} className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all
              ${i < captures.length
                ? 'bg-emerald-600 text-white'
                : i === stepIdx && !isDone
                  ? 'bg-indigo-600 text-white ring-2 ring-indigo-400/50'
                  : 'bg-slate-800 text-slate-500'
              }`}>
              {i < captures.length ? <CheckCircle size={14} /> : i + 1}
            </div>
            <span className={`text-xs font-medium hidden sm:inline ${i === stepIdx && !isDone ? 'text-slate-200' : 'text-slate-600'}`}>
              {s.label}
            </span>
            {i < STEPS.length - 1 && <div className={`w-6 h-px ${i < captures.length ? 'bg-emerald-600' : 'bg-slate-700'}`} />}
          </div>
        ))}
      </div>

      {/* Camera + Overlay */}
      {error && (
        <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-sm">
          ⚠ {error}
        </div>
      )}

      <div className="relative rounded-2xl overflow-hidden bg-slate-900 border border-slate-700">
        <video
          ref={videoRef}
          className={`w-full object-cover ${isActive ? 'block' : 'hidden'}`}
          style={{ maxHeight: '400px' }}
          muted playsInline autoPlay
        />

        {isActive && (
          <canvas
            ref={overlayRef}
            className="absolute inset-0 w-full h-full pointer-events-none"
          />
        )}
        <canvas ref={canvasRef} className="hidden" />

        {!isActive && (
          <div className="flex flex-col items-center justify-center h-56 gap-3">
            <Camera size={40} className="text-slate-600 animate-pulse" />
            <p className="text-slate-500 text-sm">Starting camera…</p>
          </div>
        )}

        {/* Instruction overlay */}
        {isActive && (
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/85 to-transparent p-5">
            <div className="flex items-center gap-4">
              <div className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 transition-colors
                ${status === 'hold' || status === 'captured'
                  ? 'bg-emerald-500/20 border-2 border-emerald-500'
                  : 'bg-indigo-500/20 border-2 border-indigo-500'}`}>
                {status === 'captured'
                  ? <CheckCircle size={22} className="text-emerald-400" />
                  : <StepIcon size={22} className={status === 'hold' ? 'text-emerald-400' : 'text-indigo-400'} />
                }
              </div>
              <div className="flex-1">
                <p className={`font-bold text-base ${status === 'hold' || status === 'captured' ? 'text-emerald-300' : 'text-white'}`}>
                  {instruction}
                </p>
                <p className="text-slate-400 text-xs mt-0.5">
                  {isDone
                    ? 'Registration photos complete'
                    : `Photo ${captures.length + 1} of ${TOTAL_CAPTURES}`
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
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">Captured:</span>
          {captures.map((img, idx) => (
            <div key={idx} className="relative w-14 h-14 rounded-xl overflow-hidden border-2 border-emerald-500/50">
              <img src={img} alt={`Photo ${idx + 1}`} className="w-full h-full object-cover" />
              <div className="absolute bottom-0 right-0 w-5 h-5 bg-emerald-500 rounded-tl-lg flex items-center justify-center">
                <CheckCircle size={10} className="text-white" />
              </div>
            </div>
          ))}
          {isDone && (
            <span className="text-emerald-400 text-xs font-semibold ml-auto">
              ✓ Ready to register
            </span>
          )}
        </div>
      )}
    </div>
  )
}
