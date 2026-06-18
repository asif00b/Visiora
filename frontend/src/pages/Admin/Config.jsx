import { useEffect, useState } from 'react'
import {
  getConfig, updateConfig, reloadCache, getSystemInfo,
  getStorageInfo, cleanupStorage, compressStorage, cleanupUnknown
} from '../../api/admin'
import { ToastContainer, useToast } from '../../components/Toast'
import {
  Settings, Save, RefreshCw, CheckCircle, XCircle, Info,
  HardDrive, Zap, Trash2, Archive, Cpu
} from 'lucide-react'

const CONFIG_META = [
  { key: 'liveness_enabled',            label: 'Liveness Detection',           type: 'bool',   desc: 'Require blink challenge during face registration' },
  { key: 'liveness_blink_count',         label: 'Required Blinks',              type: 'number', desc: 'How many blinks required to pass liveness check',       min: 1, max: 5 },
  { key: 'recognition_tolerance',        label: 'Recognition Tolerance',        type: 'float',  desc: 'Lower = stricter (0.4–0.65 recommended)',               min: 0.3, max: 0.8, step: 0.01 },
  { key: 'attendance_cooldown_minutes',  label: 'Attendance Cooldown (min)',    type: 'number', desc: 'Minimum time between attendance marks for same user',    min: 0 },
  { key: 'save_unknown_faces',           label: 'Save Unknown Faces',           type: 'bool',   desc: 'Capture and store snapshots of unrecognized faces' },
]

export default function AdminConfig() {
  const { toasts, removeToast, toast } = useToast()
  const [config, setConfig]     = useState({})
  const [sysInfo, setSysInfo]   = useState(null)
  const [storageInfo, setStorageInfo] = useState(null)
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [reloading, setReloading] = useState(false)
  const [storageOp, setStorageOp] = useState(null)  // 'cleanup' | 'compress' | 'unknown_cleanup'

  const load = async () => {
    setLoading(true)
    try {
      const [cr, ir, sr] = await Promise.all([
        getConfig(),
        getSystemInfo(),
        getStorageInfo().catch(() => ({ data: null })),
      ])
      setConfig(cr.data.config)
      setSysInfo(ir.data.info)
      setStorageInfo(sr.data)
    } catch { toast.error('Failed to load config') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      await updateConfig(config)
      toast.success('Configuration saved')
    } catch { toast.error('Save failed') }
    finally { setSaving(false) }
  }

  const handleReload = async () => {
    setReloading(true)
    try {
      const res = await reloadCache()
      toast.success(res.data.message)
    } catch (err) {
      toast.error(err.response?.data?.message || 'Reload failed')
    } finally { setReloading(false) }
  }

  const handleStorageOp = async (op) => {
    setStorageOp(op)
    try {
      let res
      if (op === 'cleanup')         res = await cleanupStorage()
      else if (op === 'compress')   res = await compressStorage()
      else if (op === 'unk_cleanup') res = await cleanupUnknown()
      toast.success(res.data.message || 'Done')
      // Refresh storage info
      const sr = await getStorageInfo().catch(() => ({ data: null }))
      setStorageInfo(sr.data)
    } catch (err) {
      toast.error(err.response?.data?.message || `${op} failed`)
    } finally { setStorageOp(null) }
  }

  const setValue = (key, val) => setConfig(c => ({ ...c, [key]: val }))

  if (loading) return (
    <div className="flex justify-center py-20">
      <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      <div>
        <h1 className="section-title">System Configuration</h1>
        <p className="section-subtitle">Recognition, attendance, scanner and storage settings</p>
      </div>

      {/* ── System Status ────────────────────────────────────────────────── */}
      {sysInfo && (
        <div className="card space-y-4">
          <h2 className="font-semibold text-slate-300 flex items-center gap-2"><Info size={15} /> System Status</h2>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Face Recognition Library', ok: sysInfo.face_recognition_available },
              { label: 'OpenCV',                   ok: sysInfo.opencv_available },
              { label: 'GPU / CUDA',               ok: sysInfo.gpu_available },
            ].map(item => (
              <div key={item.label} className="flex items-center gap-2 text-sm">
                {item.ok
                  ? <CheckCircle size={16} className="text-emerald-400" />
                  : <XCircle    size={16} className="text-rose-400"    />}
                <span className={item.ok ? 'text-slate-300' : 'text-slate-500'}>{item.label}</span>
              </div>
            ))}
            <div className="text-sm text-slate-400">
              <Cpu size={13} className="inline mr-1 text-indigo-400" />
              Model: <strong className="text-slate-200 uppercase">{sysInfo.recommended_model || 'HOG'}</strong>
            </div>
            <div className="text-sm text-slate-400">
              🗄 <strong className="text-slate-200">{sysInfo.cache_size}</strong> encoding(s) cached
            </div>
            <div className="text-sm text-slate-400">
              👤 <strong className="text-slate-200">{sysInfo.total_users}</strong> users
            </div>
            <div className="text-sm text-slate-400">
              ❓ <strong className="text-slate-200">{sysInfo.total_unknown_faces ?? '—'}</strong> unknown faces
            </div>
          </div>
          <button onClick={handleReload} disabled={reloading} className="btn-secondary text-sm">
            <RefreshCw size={14} className={reloading ? 'animate-spin' : ''} />
            {reloading ? 'Reloading...' : 'Reload Face Cache'}
          </button>
        </div>
      )}

      {/* ── Storage Management ────────────────────────────────────────────── */}
      <div className="card space-y-4">
        <h2 className="font-semibold text-slate-300 flex items-center gap-2">
          <HardDrive size={15} /> Storage Management
        </h2>

        {storageInfo && (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700">
              <p className="text-slate-500 text-xs mb-1">Known Faces</p>
              <p className="text-slate-200 font-semibold">{storageInfo.known_faces?.files ?? 0} files</p>
              <p className="text-slate-500 text-xs">{storageInfo.known_faces?.mb ?? 0} MB</p>
            </div>
            <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700">
              <p className="text-slate-500 text-xs mb-1">Unknown Faces</p>
              <p className="text-slate-200 font-semibold">{storageInfo.unknown_faces?.files ?? 0} files</p>
              <p className="text-slate-500 text-xs">{storageInfo.unknown_faces?.mb ?? 0} MB</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <button
            id="storage-cleanup-btn"
            onClick={() => handleStorageOp('cleanup')}
            disabled={storageOp !== null}
            className="btn-secondary flex-col items-center py-3 gap-1 h-auto"
          >
            <Trash2 size={18} className={storageOp === 'cleanup' ? 'animate-spin' : 'text-rose-400'} />
            <span className="text-xs font-medium">Cleanup Orphans</span>
            <span className="text-[10px] text-slate-500">Remove files with no DB record</span>
          </button>

          <button
            id="storage-compress-btn"
            onClick={() => handleStorageOp('compress')}
            disabled={storageOp !== null}
            className="btn-secondary flex-col items-center py-3 gap-1 h-auto"
          >
            <Archive size={18} className={storageOp === 'compress' ? 'animate-spin' : 'text-amber-400'} />
            <span className="text-xs font-medium">Compress Images</span>
            <span className="text-[10px] text-slate-500">Re-save at 85% quality</span>
          </button>

          <button
            id="unknown-cleanup-btn"
            onClick={() => handleStorageOp('unk_cleanup')}
            disabled={storageOp !== null}
            className="btn-secondary flex-col items-center py-3 gap-1 h-auto"
          >
            <Zap size={18} className={storageOp === 'unk_cleanup' ? 'animate-spin' : 'text-indigo-400'} />
            <span className="text-xs font-medium">Unknown Cleanup</span>
            <span className="text-[10px] text-slate-500">Remove stale & duplicates</span>
          </button>
        </div>
      </div>

      {/* ── Settings ──────────────────────────────────────────────────────── */}
      <div className="card space-y-5">
        <h2 className="font-semibold text-slate-300 flex items-center gap-2"><Settings size={15} /> Settings</h2>
        {CONFIG_META.map(meta => (
          <div key={meta.key}>
            <label className="label">{meta.label}</label>
            {meta.type === 'bool' ? (
              <div className="flex items-center gap-3">
                <button
                  id={`toggle-${meta.key}`}
                  onClick={() => setValue(meta.key, config[meta.key] === 'true' ? 'false' : 'true')}
                  className={`relative w-12 h-6 rounded-full transition-colors duration-200 ${config[meta.key] === 'true' ? 'bg-indigo-600' : 'bg-slate-700'}`}
                >
                  <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all duration-200 ${config[meta.key] === 'true' ? 'left-7' : 'left-1'}`} />
                </button>
                <span className="text-sm text-slate-400">{config[meta.key] === 'true' ? 'Enabled' : 'Disabled'}</span>
              </div>
            ) : meta.type === 'select' ? (
              <select
                value={config[meta.key] || ''}
                onChange={e => setValue(meta.key, e.target.value)}
                className="select"
              >
                {meta.options.map(o => <option key={o} value={o}>{o.toUpperCase()}</option>)}
              </select>
            ) : (
              <input
                id={`config-${meta.key}`}
                type="number"
                min={meta.min}
                max={meta.max}
                step={meta.step || 1}
                value={config[meta.key] || ''}
                onChange={e => setValue(meta.key, e.target.value)}
                className="input"
              />
            )}
            <p className="text-xs text-slate-600 mt-1">{meta.desc}</p>
          </div>
        ))}
        <button id="save-config-btn" onClick={handleSave} disabled={saving} className="btn-primary">
          <Save size={15} /> {saving ? 'Saving...' : 'Save Configuration'}
        </button>
      </div>
    </div>
  )
}
