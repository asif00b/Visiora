import { useState } from 'react'
import { Fingerprint, CheckCircle2, RefreshCw, X, ShieldCheck, Loader2 } from 'lucide-react'
import { enrollFingerprint } from '../api/biometric'

export default function BiometricEnrollModal({ userId, userName, isOpen, onClose, onSuccess }) {
  const [fingerName, setFingerName] = useState('Right Index')
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [quality, setQuality] = useState(0)
  const [done, setDone] = useState(false)

  if (!isOpen) return null

  const handleEnroll = async () => {
    setSubmitting(true)
    setErrorMsg('')
    try {
      const enrollRes = await enrollFingerprint({
        user_id: Number(userId),
        finger_name: fingerName,
      })
      if (enrollRes.data?.success) {
        setQuality(enrollRes.data.fingerprint?.quality_score || 98)
        setDone(true)
        if (onSuccess) onSuccess()
      } else {
        setErrorMsg(enrollRes.data?.message || 'Enrollment failed.')
      }
    } catch (err) {
      setErrorMsg(err.response?.data?.message || err.message || 'Enrollment request failed. Make sure scanner is connected.')
    } finally {
      setSubmitting(false)
    }
  }

  const reset = () => {
    setSubmitting(false)
    setErrorMsg('')
    setQuality(0)
    setDone(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-fade-in">
      <div className="card max-w-md w-full bg-slate-900 border border-slate-800 shadow-2xl p-6 space-y-5 relative">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2 text-cyan-400 font-bold text-sm">
            <Fingerprint size={18} />
            Register Fingerprint (Native SDK)
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200" disabled={submitting}><X size={18} /></button>
        </div>

        {/* User metadata */}
        <div className="flex items-center justify-between bg-slate-950/50 p-3 rounded-xl border border-slate-800/40">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">User</p>
            <p className="text-sm font-bold text-slate-200">{userName}</p>
          </div>
          <select 
            value={fingerName} 
            onChange={e => setFingerName(e.target.value)}
            disabled={submitting || done}
            className="select text-xs py-1 px-3 bg-slate-800 border-slate-700 rounded-lg text-slate-200"
          >
            <option value="Right Index">Right Index</option>
            <option value="Right Thumb">Right Thumb</option>
            <option value="Left Index">Left Index</option>
            <option value="Left Thumb">Left Thumb</option>
          </select>
        </div>

        {/* Scanner Indicator Panel */}
        <div 
          className="rounded-2xl bg-slate-950 border border-slate-800/60 flex flex-col items-center justify-center p-6 relative overflow-hidden"
          style={{ minHeight: '220px' }}
        >
          {done ? (
            <div className="text-center space-y-3 animate-fade-in">
              <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/50 mx-auto flex items-center justify-center shadow-lg shadow-emerald-500/10">
                <CheckCircle2 size={36} className="text-emerald-400" />
              </div>
              <p className="text-base font-bold text-slate-100">Enrollment Complete!</p>
              <p className="text-xs text-emerald-400 font-mono">Template Verified</p>
            </div>
          ) : submitting ? (
            <div className="text-center space-y-4 animate-fade-in">
              <Loader2 size={40} className="text-cyan-400 animate-spin mx-auto" />
              <div className="space-y-1.5">
                <p className="text-sm font-bold text-cyan-400 uppercase tracking-widest font-mono">Scanner Active</p>
                <p className="text-xs text-slate-300 max-w-[280px] mx-auto leading-normal">
                  Please place your finger on the optical sensor glass when the green light turns on.
                </p>
                <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
                  Requires 3 successful touches (Lift & Replace)
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="w-20 h-20 rounded-full border border-slate-800 bg-slate-900/60 flex items-center justify-center mb-4">
                <Fingerprint size={36} className="text-slate-500" />
              </div>
              
              <div className="text-center max-w-[280px] space-y-3">
                <p className="text-xs text-slate-400 leading-normal">
                  Ready to capture 1KB high-precision biometric minutiae template.
                </p>
                <button 
                  onClick={handleEnroll} 
                  className="btn-primary py-2 px-6 text-xs mx-auto gap-2"
                >
                  <Fingerprint size={14} /> Start Registration
                </button>
              </div>
            </>
          )}
        </div>

        {errorMsg && (
          <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-400 text-center font-semibold animate-fade-in">
            {errorMsg}
          </div>
        )}

        {/* Footer actions */}
        {done && (
          <div className="flex gap-2 pt-1">
            <button onClick={reset} className="btn-secondary flex-1 text-xs gap-1 py-2 justify-center">
              <RefreshCw size={14} /> Register Another
            </button>
            <button onClick={onClose} className="btn-primary flex-1 text-xs gap-1 py-2 justify-center">
              <ShieldCheck size={14} /> Finished
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
