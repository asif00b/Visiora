import { useEffect, useState } from 'react'
import {
  getConfig, updateConfig, reloadCache, getSystemInfo,
  getStorageInfo, cleanupStorage, cleanupUnknown
} from '../../api/admin'
import { ToastContainer, useToast } from '../../components/Toast'
import {
  Settings, Save, RefreshCw, CheckCircle, XCircle,
  HardDrive, Trash2, Cpu, ShieldCheck
} from 'lucide-react'

export default function AdminConfig() {
  const { toasts, removeToast, toast } = useToast()
  const [config, setConfig]           = useState({})
  const [sysInfo, setSysInfo]         = useState(null)
  const [storageInfo, setStorageInfo] = useState(null)
  const [loading, setLoading]         = useState(true)
  const [saving, setSaving]           = useState(false)
  const [reloading, setReloading]     = useState(false)
  const [cleaning, setCleaning]       = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [cr, ir, sr] = await Promise.all([
        getConfig(),
        getSystemInfo(),
        getStorageInfo().catch(() => ({ data: null })),
      ])
      setConfig(cr.data.config || {})
      setSysInfo(ir.data.info || null)
      setStorageInfo(sr.data || null)
    } catch {
      toast.error('Failed to load system settings')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      await updateConfig(config)
      toast.success('Settings saved successfully')
    } catch {
      toast.error('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  const handleReloadCache = async () => {
    setReloading(true)
    try {
      const res = await reloadCache()
      toast.success(res.data.message || 'Face recognition cache reloaded')
    } catch (err) {
      toast.error(err.response?.data?.message || 'Cache reload failed')
    } finally {
      setReloading(false)
    }
  }

  const handleCleanupUnknown = async () => {
    setCleaning(true)
    try {
      const res = await cleanupUnknown()
      toast.success(res.data.message || 'Unknown face storage cleaned up')
      const sr = await getStorageInfo().catch(() => ({ data: null }))
      setStorageInfo(sr.data)
    } catch (err) {
      toast.error(err.response?.data?.message || 'Cleanup failed')
    } finally {
      setCleaning(false)
    }
  }

  const setValue = (key, val) => setConfig(c => ({ ...c, [key]: val }))

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      {/* Header */}
      <div>
        <h1 className="section-title flex items-center gap-2">
          <Settings size={22} className="text-cyan-400" /> System Settings
        </h1>
        <p className="section-subtitle">
          Manage face recognition parameters, attendance rules, and system storage.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Main Settings Panel */}
        <div className="md:col-span-2 space-y-5">
          <div className="card p-6 space-y-5">
            <h2 className="font-bold text-slate-100 text-sm border-b border-slate-800 pb-3 flex items-center gap-2">
              <ShieldCheck size={16} className="text-cyan-400" /> Recognition & Attendance Rules
            </h2>

            {/* Recognition Tolerance */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <label className="label mb-0">Face Matching Tolerance</label>
                <span className="font-mono text-xs text-cyan-400 font-bold">
                  {config['recognition_tolerance'] || '0.50'}
                </span>
              </div>
              <input
                type="range"
                min="0.30"
                max="0.70"
                step="0.01"
                value={config['recognition_tolerance'] || '0.50'}
                onChange={e => setValue('recognition_tolerance', e.target.value)}
                className="w-full accent-cyan-500 bg-slate-800 h-2 rounded-lg cursor-pointer"
              />
              <p className="text-[11px] text-slate-500">
                Lower values (0.40) increase strictness. Higher values (0.60) allow faster matching.
              </p>
            </div>

            {/* Cooldown */}
            <div className="space-y-1.5 pt-3 border-t border-slate-800/60">
              <label className="label">Punch Cooldown (Seconds)</label>
              <input
                type="number"
                min="10"
                max="3600"
                value={config['attendance_cooldown_seconds'] || '600'}
                onChange={e => setValue('attendance_cooldown_seconds', e.target.value)}
                className="input text-xs py-2"
                placeholder="600"
              />
              <p className="text-[11px] text-slate-500">
                Minimum wait time before a user can punch in/out again.
              </p>
            </div>

            {/* Save Unknown Faces Toggle */}
            <div className="space-y-1.5 pt-3 border-t border-slate-800/60">
              <label className="label">Capture Unknown Faces</label>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setValue('save_unknown_faces', config['save_unknown_faces'] === 'true' ? 'false' : 'true')}
                  className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${config['save_unknown_faces'] === 'true' ? 'bg-cyan-600' : 'bg-slate-700'}`}
                >
                  <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all duration-200 ${config['save_unknown_faces'] === 'true' ? 'left-6' : 'left-1'}`} />
                </button>
                <span className="text-xs text-slate-300 font-medium">
                  {config['save_unknown_faces'] === 'true' ? 'Enabled (Store unrecognized faces)' : 'Disabled'}
                </span>
              </div>
            </div>

            {/* Save Button */}
            <div className="pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="btn-primary w-full py-2.5 text-xs flex items-center justify-center gap-2"
              >
                <Save size={15} />
                {saving ? 'Saving...' : 'Save Settings'}
              </button>
            </div>
          </div>
        </div>

        {/* Right Side: Maintenance & System Status */}
        <div className="space-y-5">
          {/* Status Overview */}
          {sysInfo && (
            <div className="card p-5 space-y-4">
              <h3 className="font-bold text-slate-100 text-xs flex items-center gap-2 border-b border-slate-800 pb-2.5 uppercase tracking-wider">
                <Cpu size={14} className="text-cyan-400" /> System Health
              </h3>
              <div className="space-y-2.5 text-xs">
                <div className="flex justify-between items-center text-slate-300">
                  <span>Recognition Engine</span>
                  <span className="badge badge-info text-[10px] font-bold uppercase">{sysInfo.recommended_model || 'ArcFace'}</span>
                </div>
                <div className="flex justify-between items-center text-slate-300">
                  <span>Cached Users</span>
                  <span className="font-mono font-bold text-slate-100">{sysInfo.cache_size}</span>
                </div>
                <div className="flex justify-between items-center text-slate-300">
                  <span>GPU Acceleration</span>
                  {sysInfo.gpu_available ? (
                    <span className="text-emerald-400 flex items-center gap-1 font-semibold text-[11px]">
                      <CheckCircle size={12} /> Active
                    </span>
                  ) : (
                    <span className="text-slate-500 text-[11px]">Disabled</span>
                  )}
                </div>
              </div>

              <button
                onClick={handleReloadCache}
                disabled={reloading}
                className="btn-secondary w-full py-2 text-xs flex items-center justify-center gap-2 mt-2"
              >
                <RefreshCw size={13} className={reloading ? 'animate-spin' : ''} />
                {reloading ? 'Reloading...' : 'Reload Recognition Cache'}
              </button>
            </div>
          )}

          {/* Storage Maintenance */}
          <div className="card p-5 space-y-4">
            <h3 className="font-bold text-slate-100 text-xs flex items-center gap-2 border-b border-slate-800 pb-2.5 uppercase tracking-wider">
              <HardDrive size={14} className="text-cyan-400" /> Storage Cleanup
            </h3>
            {storageInfo && (
              <div className="text-xs text-slate-400 space-y-1">
                <p>Unknown Faces: <span className="text-slate-200 font-semibold">{storageInfo.unknown_faces?.files ?? 0} files</span> ({storageInfo.unknown_faces?.mb ?? 0} MB)</p>
              </div>
            )}
            <button
              onClick={handleCleanupUnknown}
              disabled={cleaning}
              className="btn-secondary w-full py-2 text-xs flex items-center justify-center gap-2 text-slate-300 hover:text-rose-400 hover:bg-rose-500/10"
            >
              <Trash2 size={13} className={cleaning ? 'animate-spin' : ''} />
              {cleaning ? 'Cleaning...' : 'Clear Unknown Snapshots'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
