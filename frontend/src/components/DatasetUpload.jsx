import { useEffect, useRef, useState } from 'react'
import { getEncodingsInfo, trainDataset } from '../api/face'
import {
  Upload, Database, CheckCircle, XCircle, AlertCircle,
  RefreshCw, ChevronDown, ChevronUp, Cpu, Zap
} from 'lucide-react'

const MAX = 15

const QualityBar = ({ value, label }) => {
  const pct = value ?? 0
  const color = pct >= 75 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-rose-500'
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-slate-400">
        <span>{label}</span>
        <span className="font-medium text-slate-300">{pct}%</span>
      </div>
      <div className="w-full h-1.5 rounded-full bg-slate-700">
        <div className={`h-1.5 rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

const TypePill = ({ label, count, color }) => (
  <div className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium border ${color}`}>
    <span>{count}</span>
    <span className="opacity-70">{label}</span>
  </div>
)

export default function DatasetUpload({ userId, userName }) {
  const fileRef  = useRef(null)
  const dropRef  = useRef(null)
  const [info, setInfo]         = useState(null)
  const [loading, setLoading]   = useState(true)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult]     = useState(null)
  const [selectedFiles, setSelectedFiles] = useState([])
  const [dragging, setDragging] = useState(false)
  const [showDetails, setShowDetails]     = useState(false)

  const loadInfo = async () => {
    setLoading(true)
    try {
      const res = await getEncodingsInfo(userId)
      setInfo(res.data)
    } catch {
      setInfo(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadInfo() }, [userId])

  // ── Drag & Drop ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = dropRef.current
    if (!el) return
    const over = (e) => { e.preventDefault(); setDragging(true) }
    const leave = () => setDragging(false)
    const drop = (e) => {
      e.preventDefault()
      setDragging(false)
      const files = Array.from(e.dataTransfer.files || []).filter(isValidFile)
      if (files.length) setSelectedFiles(files)
    }
    el.addEventListener('dragover', over)
    el.addEventListener('dragleave', leave)
    el.addEventListener('drop', drop)
    return () => { el.removeEventListener('dragover', over); el.removeEventListener('dragleave', leave); el.removeEventListener('drop', drop) }
  }, [])

  const isValidFile = (f) =>
    /\.(jpe?g|png|bmp|webp|zip)$/i.test(f.name)

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files || []).filter(isValidFile)
    setSelectedFiles(files)
    setResult(null)
  }

  const handleUpload = async () => {
    if (!selectedFiles.length) return
    setUploading(true)
    setProgress(0)
    setResult(null)

    // Fake progress ticker (real progress needs XHR — just for UX)
    const ticker = setInterval(() => {
      setProgress(p => Math.min(p + 3, 92))
    }, 400)

    try {
      const res = await trainDataset(userId, selectedFiles)
      setProgress(100)
      setResult(res.data)
      setSelectedFiles([])
      if (fileRef.current) fileRef.current.value = ''
      await loadInfo()
    } catch (err) {
      setResult({
        success: false,
        message: err.response?.data?.message || 'Upload failed',
        added: 0,
        rejected: 0,
      })
    } finally {
      clearInterval(ticker)
      setUploading(false)
    }
  }

  const slots = info ? Math.max(0, MAX - info.total) : MAX

  return (
    <div className="card space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-bold text-slate-100 flex items-center gap-2">
            <Cpu size={16} className="text-cyan-400" />
            Training Dataset Upload
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Upload images of <strong className="text-slate-400">{userName}</strong> to strengthen
            recognition accuracy. More diverse angles = better matching.
          </p>
        </div>
        <button onClick={loadInfo} className="btn-secondary py-1.5 px-2.5 text-xs" disabled={loading}>
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Current encoding stats */}
      {loading ? (
        <div className="flex justify-center py-4">
          <div className="w-5 h-5 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : info ? (
        <div className="space-y-3">
          {/* Slot progress bar */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-slate-400">
              <span className="flex items-center gap-1.5">
                <Database size={11} className="text-cyan-400" />
                Encodings stored
              </span>
              <span>
                <strong className={info.total >= MAX ? 'text-rose-400' : 'text-slate-200'}>
                  {info.total}
                </strong>
                <span className="text-slate-600"> / {MAX}</span>
              </span>
            </div>
            <div className="w-full h-2 rounded-full bg-slate-700">
              <div
                className={`h-2 rounded-full transition-all duration-500 ${
                  info.total >= MAX ? 'bg-rose-500' : info.total >= MAX * 0.7 ? 'bg-amber-500' : 'bg-cyan-500'
                }`}
                style={{ width: `${(info.total / MAX) * 100}%` }}
              />
            </div>
            <p className="text-xs text-slate-600">
              {slots > 0 ? `${slots} slot(s) available for new images` : 'Full — re-register to reset'}
            </p>
          </div>

          {/* Quality metrics */}
          <div className="grid grid-cols-3 gap-2">
            <QualityBar value={info.avg_quality} label="Avg Quality" />
            <QualityBar value={info.min_quality} label="Min Quality" />
            <QualityBar value={info.max_quality} label="Max Quality" />
          </div>

          {/* Type breakdown pills */}
          <div className="flex flex-wrap gap-2">
            {info.type_breakdown?.individual > 0 && (
              <TypePill label="Guided" count={info.type_breakdown.individual} color="bg-cyan-500/10 border-cyan-500/25 text-cyan-300" />
            )}
            {info.type_breakdown?.dataset > 0 && (
              <TypePill label="Dataset" count={info.type_breakdown.dataset} color="bg-emerald-500/10 border-emerald-500/30 text-emerald-300" />
            )}
            {info.type_breakdown?.merged > 0 && (
              <TypePill label="Merged" count={info.type_breakdown.merged} color="bg-amber-500/10 border-amber-500/30 text-amber-300" />
            )}
          </div>

          {/* Accuracy tip */}
          {info.total < 5 && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-500/5 border border-amber-500/20">
              <Zap size={13} className="text-amber-400 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-amber-300">
                <strong>Tip:</strong> For best accuracy, aim for at least 8–10 diverse encodings (different
                angles, lighting conditions). Current: {info.total}.
              </p>
            </div>
          )}

          {info.total >= MAX && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-500/5 border border-rose-500/20">
              <AlertCircle size={13} className="text-rose-400 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-rose-300">
                Maximum encodings reached. To add new dataset images, go to <strong>Face Management</strong> and
                re-register first (this resets the count).
              </p>
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-slate-500">Could not load encoding info</p>
      )}

      {/* Drop zone */}
      {slots > 0 && (
        <div
          ref={dropRef}
          onClick={() => fileRef.current?.click()}
          className={`
            border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all duration-200
            ${dragging
              ? 'border-cyan-400 bg-cyan-500/10 scale-[1.01]'
              : selectedFiles.length
              ? 'border-emerald-500/50 bg-emerald-500/5'
              : 'border-slate-600 hover:border-cyan-500/60 hover:bg-cyan-500/5'}
          `}
        >
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".jpg,.jpeg,.png,.bmp,.webp,.zip"
            onChange={handleFileChange}
            className="hidden"
          />
          {selectedFiles.length > 0 ? (
            <div className="space-y-2">
              <CheckCircle size={28} className="mx-auto text-emerald-400" />
              <p className="text-sm font-medium text-emerald-300">{selectedFiles.length} file(s) selected</p>
              <p className="text-xs text-slate-500">
                {selectedFiles.map(f => f.name).slice(0, 3).join(', ')}
                {selectedFiles.length > 3 ? ` + ${selectedFiles.length - 3} more` : ''}
              </p>
              <p className="text-xs text-slate-600">Click to change selection</p>
            </div>
          ) : (
            <div className="space-y-2">
              <Upload size={28} className="mx-auto text-slate-500" />
              <p className="text-sm font-medium text-slate-400">Drop images or ZIP file here</p>
              <p className="text-xs text-slate-600">
                JPEG · PNG · BMP · WEBP · ZIP — up to {slots} image(s) will be processed
              </p>
              <p className="text-xs text-cyan-400">
                More diverse angles = significantly better recognition accuracy
              </p>
            </div>
          )}
        </div>
      )}

      {/* Upload button */}
      {selectedFiles.length > 0 && (
        <div className="space-y-2">
          <button
            onClick={handleUpload}
            disabled={uploading}
            className="btn-primary w-full"
          >
            {uploading ? (
              <>
                <RefreshCw size={15} className="animate-spin" />
                Processing {selectedFiles.length} image(s)...
              </>
            ) : (
              <>
                <Upload size={15} />
                Upload & Train ({selectedFiles.length} image{selectedFiles.length > 1 ? 's' : ''})
              </>
            )}
          </button>
          {uploading && (
            <div className="w-full h-1.5 rounded-full bg-slate-700">
              <div
                className="h-1.5 rounded-full bg-cyan-500 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* Result panel */}
      {result && (
        <div className={`rounded-xl p-4 space-y-3 border ${
          result.success
            ? 'bg-emerald-500/5 border-emerald-500/20'
            : 'bg-rose-500/5 border-rose-500/20'
        }`}>
          <div className="flex items-center gap-2">
            {result.success
              ? <CheckCircle size={16} className="text-emerald-400" />
              : <XCircle    size={16} className="text-rose-400" />}
            <p className={`text-sm font-medium ${result.success ? 'text-emerald-300' : 'text-rose-300'}`}>
              {result.message}
            </p>
          </div>

          {(result.accepted_details?.length > 0 || result.rejected_details?.length > 0) && (
            <button
              onClick={() => setShowDetails(v => !v)}
              className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1"
            >
              {showDetails ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {showDetails ? 'Hide' : 'Show'} details
            </button>
          )}

          {showDetails && (
            <div className="space-y-2 text-xs">
              {result.accepted_details?.length > 0 && (
                <div>
                  <p className="text-emerald-400 font-medium mb-1">Accepted ({result.added})</p>
                  <div className="space-y-0.5">
                    {result.accepted_details.map((a, i) => (
                      <p key={i} className="text-slate-400">
                        <span className="text-emerald-500">✓</span> {a.label} — quality {a.quality}%
                      </p>
                    ))}
                  </div>
                </div>
              )}
              {result.rejected_details?.length > 0 && (
                <div>
                  <p className="text-rose-400 font-medium mb-1">Skipped ({result.rejected})</p>
                  <div className="space-y-0.5">
                    {result.rejected_details.map((r, i) => (
                      <p key={i} className="text-slate-500">
                        <span className="text-rose-500">✗</span> {r}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
