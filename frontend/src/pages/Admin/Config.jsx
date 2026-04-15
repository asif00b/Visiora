import { useEffect, useState } from 'react'
import { getConfig, updateConfig, reloadCache, getSystemInfo } from '../../api/admin'
import { ToastContainer, useToast } from '../../components/Toast'
import { Settings, Save, RefreshCw, CheckCircle, XCircle, Info } from 'lucide-react'

const CONFIG_META = [
  { key: 'liveness_enabled', label: 'Liveness Detection', type: 'bool', desc: 'Require blink challenge during face registration' },
  { key: 'liveness_blink_count', label: 'Required Blinks', type: 'number', desc: 'How many blinks required to pass liveness check', min: 1, max: 5 },
  { key: 'recognition_tolerance', label: 'Recognition Tolerance', type: 'float', desc: 'Lower = stricter (0.4–0.65 recommended)', min: 0.3, max: 0.8, step: 0.01 },
  { key: 'attendance_cooldown_minutes', label: 'Attendance Cooldown (minutes)', type: 'number', desc: 'Minimum time between attendance marks for same user', min: 0 },
  { key: 'scanner_interval_ms', label: 'Scanner Interval (ms)', type: 'number', desc: 'How often to send frames for recognition (lower = faster, more CPU)', min: 300, max: 5000 },
  { key: 'scanner_camera_index', label: 'Camera Device Index', type: 'number', desc: 'Default camera device index (0 = first webcam)', min: 0, max: 5 },
  { key: 'save_unknown_faces', label: 'Save Unknown Faces', type: 'bool', desc: 'Capture and store snapshots of unrecognized faces' },
  { key: 'face_detection_model', label: 'Detection Model', type: 'select', options: ['hog', 'cnn'], desc: 'HOG = faster, CNN = more accurate (requires GPU)' },
]

export default function AdminConfig() {
  const { toasts, removeToast, toast } = useToast()
  const [config, setConfig] = useState({})
  const [sysInfo, setSysInfo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [reloading, setReloading] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [cr, ir] = await Promise.all([getConfig(), getSystemInfo()])
      setConfig(cr.data.config)
      setSysInfo(ir.data.info)
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
    } finally {
      setReloading(false)
    }
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

      <div className="flex items-center justify-between">
        <div>
          <h1 className="section-title">System Configuration</h1>
          <p className="section-subtitle">Configure recognition, attendance and scanner settings</p>
        </div>
      </div>

      {/* System Info */}
      {sysInfo && (
        <div className="card space-y-3">
          <h2 className="font-semibold text-slate-300 flex items-center gap-2"><Info size={15} /> System Status</h2>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Face Recognition Library', ok: sysInfo.face_recognition_available },
              { label: 'OpenCV', ok: sysInfo.opencv_available },
            ].map(item => (
              <div key={item.label} className="flex items-center gap-2 text-sm">
                {item.ok ? <CheckCircle size={16} className="text-emerald-400" /> : <XCircle size={16} className="text-rose-400" />}
                <span className={item.ok ? 'text-slate-300' : 'text-slate-500'}>{item.label}</span>
              </div>
            ))}
            <div className="text-sm text-slate-400">
              🗄 <strong className="text-slate-200">{sysInfo.cache_size}</strong> encoding(s) cached
            </div>
            <div className="text-sm text-slate-400">
              👤 <strong className="text-slate-200">{sysInfo.total_users}</strong> users total
            </div>
          </div>
          <button onClick={handleReload} disabled={reloading} className="btn-secondary text-sm">
            <RefreshCw size={14} className={reloading ? 'animate-spin' : ''} />
            {reloading ? 'Reloading...' : 'Reload Face Cache'}
          </button>
        </div>
      )}

      {/* Config fields */}
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
              <select value={config[meta.key] || ''} onChange={e => setValue(meta.key, e.target.value)} className="select">
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
