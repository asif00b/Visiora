import { useState, useRef } from 'react'
import { useCamera } from '../hooks/useCamera'
import { Camera, CameraOff, RotateCcw, CheckCircle, Trash2 } from 'lucide-react'

/**
 * CameraCapture — capture multiple face images for registration.
 * Props:
 *   onCapture(images: string[]) — called with array of base64 images
 *   maxImages — max number of captures (default 8)
 */
export default function CameraCapture({ onCapture, maxImages = 8 }) {
  const { videoRef, canvasRef, isActive, error, devices, startCamera, stopCamera, captureFrame } = useCamera()
  const [captures, setCaptures] = useState([])
  const [selectedDevice, setSelectedDevice] = useState('')

  const handleStart = () => startCamera(selectedDevice || null)
  const handleStop = () => stopCamera()

  const handleCapture = () => {
    const frame = captureFrame(0.9)
    if (!frame) return
    if (captures.length >= maxImages) return
    const next = [...captures, frame]
    setCaptures(next)
    if (onCapture) onCapture(next)
  }

  const handleRemove = (idx) => {
    const next = captures.filter((_, i) => i !== idx)
    setCaptures(next)
    if (onCapture) onCapture(next)
  }

  const handleClear = () => {
    setCaptures([])
    if (onCapture) onCapture([])
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        {devices.length > 1 && (
          <select
            id="camera-device-select"
            value={selectedDevice}
            onChange={e => setSelectedDevice(e.target.value)}
            className="select flex-1 min-w-40"
            disabled={isActive}
          >
            <option value="">Default Camera</option>
            {devices.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Camera ${i + 1}`}
              </option>
            ))}
          </select>
        )}

        {!isActive ? (
          <button id="start-camera-btn" onClick={handleStart} className="btn-primary">
            <Camera size={16} /> Start Camera
          </button>
        ) : (
          <>
            <button
              id="capture-face-btn"
              onClick={handleCapture}
              disabled={captures.length >= maxImages}
              className="btn-success"
            >
              <Camera size={16} />
              Capture ({captures.length}/{maxImages})
            </button>
            <button id="stop-camera-btn" onClick={handleStop} className="btn-secondary">
              <CameraOff size={16} /> Stop
            </button>
          </>
        )}

        {captures.length > 0 && (
          <button onClick={handleClear} className="btn-danger">
            <Trash2 size={15} /> Clear All
          </button>
        )}
      </div>

      {/* Camera feed */}
      {error && (
        <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-sm">
          ⚠ {error}
        </div>
      )}

      <div className="relative rounded-2xl overflow-hidden bg-slate-800 border border-slate-700">
        <video
          ref={videoRef}
          className={`w-full max-h-80 object-cover ${isActive ? 'block' : 'hidden'}`}
          muted
          playsInline
        />
        {!isActive && (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <Camera size={40} className="text-slate-600" />
            <p className="text-slate-500 text-sm">Camera not started</p>
          </div>
        )}
        <canvas ref={canvasRef} className="hidden" />
      </div>

      {/* Captured thumbnails */}
      {captures.length > 0 && (
        <div>
          <p className="label mb-2">Captured Images ({captures.length})</p>
          <div className="grid grid-cols-4 gap-2">
            {captures.map((img, idx) => (
              <div key={idx} className="relative group rounded-xl overflow-hidden border border-slate-700">
                <img src={img} alt={`Face ${idx + 1}`} className="w-full aspect-square object-cover" />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center">
                  <button
                    onClick={() => handleRemove(idx)}
                    className="opacity-0 group-hover:opacity-100 btn-danger p-1.5 transition-opacity"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="absolute top-1 left-1 w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center">
                  <CheckCircle size={12} className="text-white" />
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-500 mt-2">
            💡 5–10 images recommended for best accuracy. Vary angles slightly.
          </p>
        </div>
      )}
    </div>
  )
}
