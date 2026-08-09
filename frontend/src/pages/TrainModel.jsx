import { useEffect, useRef, useState } from 'react'
import axios from '../api/axios'
import { ToastContainer, useToast } from '../components/Toast'
import {
  Brain, Upload, Database, RefreshCw, CheckCircle,
  XCircle, Clock, Users, AlertCircle, Zap, ChevronDown,
  ChevronUp, HardDrive, Cpu
} from 'lucide-react'

// ── API helpers ───────────────────────────────────────────────────────────────
const api = {
  stats:        () => axios.get('/api/train/stats'),
  jobs:         () => axios.get('/api/train/jobs'),
  job:          (id) => axios.get(`/api/train/jobs/${id}`),
  reloadCache:  () => axios.post('/api/train/reload-cache'),
}

// ── Stat card ─────────────────────────────────────────────────────────────────
const StatCard = ({ icon: Icon, label, value, sub, accent = 'text-cyan-400', bg = 'bg-cyan-500/10' }) => (
  <div className="card-glass px-5 py-4 flex items-center gap-4">
    <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${bg} border border-slate-700`}>
      <Icon size={20} className={accent} />
    </div>
    <div>
      <p className="text-xs text-slate-500 font-medium">{label}</p>
      <p className="text-2xl font-black text-slate-100 leading-tight">{value}</p>
      {sub && <p className="text-xs text-slate-600 mt-0.5">{sub}</p>}
    </div>
  </div>
)

// ── Job accordion ─────────────────────────────────────────────────────────────
const JobCard = ({ jid, job }) => {
  const [open, setOpen] = useState(false)
  const badge = {
    queued:  'text-slate-400 bg-slate-700/50 border-slate-600',
    running: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
    done:    'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
    failed:  'text-rose-300 bg-rose-500/10 border-rose-500/30',
  }[job.status] || 'text-slate-400 bg-slate-700 border-slate-600'

  return (
    <div className="rounded-xl border border-slate-700/60 overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-800/40 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${badge}`}>{job.status}</span>
          <span className="text-sm text-slate-300">
            {job.result?.persons?.length ?? '?'} person(s) · +{job.result?.total_added ?? '…'} encodings
          </span>
        </div>
        <div className="flex items-center gap-3">
          {job.status === 'running' && (
            <div className="w-24 h-1.5 rounded-full bg-slate-700">
              <div className="h-1.5 rounded-full bg-cyan-500 transition-all" style={{ width: `${job.progress}%` }} />
            </div>
          )}
          {open ? <ChevronUp size={14} className="text-slate-500" /> : <ChevronDown size={14} className="text-slate-500" />}
        </div>
      </button>
      {open && (
        <div className="border-t border-slate-700/60 p-4 space-y-3">
          <div className="bg-slate-950 rounded-lg p-3 max-h-40 overflow-y-auto text-xs font-mono text-slate-400 space-y-0.5">
            {job.log?.length ? job.log.map((l, i) => <p key={i}>{l}</p>) : <p className="text-slate-600">No log yet</p>}
          </div>
          {job.result?.persons?.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {job.result.persons.map((p, i) => (
                <div key={i} className={`p-2.5 rounded-lg text-xs border
                  ${p.added > 0 ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-slate-800 border-slate-700'}`}>
                  <p className="font-semibold text-slate-300 truncate">{p.person}</p>
                  <p className={p.added > 0 ? 'text-emerald-400' : 'text-slate-500'}>+{p.added} encodings</p>
                  {p.skipped > 0 && <p className="text-slate-600">{p.skipped} skipped</p>}
                  {p.reason === 'no_user' && <p className="text-amber-400">No matching user</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function TrainModel() {
  const { toasts, removeToast, toast } = useToast()
  const zipRef   = useRef(null)
  const dropRef  = useRef(null)
  const pollRef  = useRef(null)

  const [stats, setStats]       = useState(null)
  const [jobs, setJobs]         = useState({})
  const [loading, setLoading]   = useState(true)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [zipFile, setZipFile]   = useState(null)
  const [dragging, setDragging] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [activeJob, setActiveJob] = useState(null)
  const [createUsers, setCreateUsers] = useState(false)

  // ── Load stats & jobs ────────────────────────────────────────────────────────
  const loadData = async () => {
    setLoading(true)
    try {
      const [sr, jr] = await Promise.all([api.stats(), api.jobs()])
      setStats(sr.data)
      setJobs(jr.data.jobs || {})
    } catch {
      toast.error('Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  // ── Poll active job ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeJob) { clearInterval(pollRef.current); return }
    pollRef.current = setInterval(async () => {
      try {
        const r = await api.job(activeJob)
        const job = r.data.job
        setJobs(prev => ({ ...prev, [activeJob]: job }))
        if (['done', 'failed'].includes(job.status)) {
          clearInterval(pollRef.current)
          setActiveJob(null)
          loadData()
          if (job.status === 'done') {
            toast.success(`Training complete — +${job.result?.total_added ?? 0} encodings added`)
          } else {
            toast.error('Training job failed')
          }
        }
      } catch { clearInterval(pollRef.current) }
    }, 1500)
    return () => clearInterval(pollRef.current)
  }, [activeJob])

  // ── Drag & drop ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = dropRef.current
    if (!el) return
    const over  = e => { e.preventDefault(); setDragging(true) }
    const leave = () => setDragging(false)
    const drop  = e => {
      e.preventDefault(); setDragging(false)
      const f = e.dataTransfer.files?.[0]
      if (f?.name.endsWith('.zip')) setZipFile(f)
      else toast.error('Only ZIP files are accepted')
    }
    el.addEventListener('dragover', over)
    el.addEventListener('dragleave', leave)
    el.addEventListener('drop', drop)
    return () => {
      el.removeEventListener('dragover', over)
      el.removeEventListener('dragleave', leave)
      el.removeEventListener('drop', drop)
    }
  }, [])

  // ── Upload handler ───────────────────────────────────────────────────────────
  const handleUpload = async () => {
    if (!zipFile) return
    setUploading(true); setProgress(0)
    const ticker = setInterval(() => setProgress(p => Math.min(p + 5, 90)), 300)
    try {
      const form = new FormData()
      form.append('zip', zipFile)
      const url = `/api/train/upload-dataset${createUsers ? '?create_users=1' : ''}`
      const res = await axios.post(url, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 60000,
      })
      setProgress(100)
      const jobId = res.data.job_id
      setActiveJob(jobId)
      setZipFile(null)
      if (zipRef.current) zipRef.current.value = ''
      setJobs(prev => ({ ...prev, [jobId]: { status: 'queued', progress: 0, log: [], result: null } }))
      toast.success(`Training started for ${res.data.total_images} image(s)`)
    } catch (err) {
      toast.error(err.response?.data?.message || 'Upload failed')
    } finally {
      clearInterval(ticker); setUploading(false)
    }
  }

  const handleReload = async () => {
    setReloading(true)
    try {
      const r = await api.reloadCache()
      toast.success(r.data.message)
      await loadData()
    } catch { toast.error('Cache reload failed') }
    finally { setReloading(false) }
  }

  const jobList = Object.entries(jobs).sort(([, a], [, b]) => (b.started || 0) - (a.started || 0))

  return (
    <div className="space-y-8 animate-fade-in max-w-4xl">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="section-title flex items-center gap-2">
            <Brain size={22} className="text-cyan-400" /> Train Model
          </h1>
          <p className="section-subtitle">
            Add face images for registered users to improve recognition accuracy.
          </p>
        </div>
        <button
          onClick={handleReload}
          disabled={reloading}
          className="btn-secondary text-sm flex-shrink-0"
        >
          <RefreshCw size={14} className={reloading ? 'animate-spin' : ''} />
          {reloading ? 'Reloading...' : 'Reload Cache'}
        </button>
      </div>

      {/* ── Stats row ──────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex justify-center py-10">
          <div className="w-7 h-7 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard icon={Database} label="Total Encodings" value={stats.total_encodings} accent="text-cyan-400" bg="bg-cyan-500/10" />
          <StatCard icon={Users} label="Trained Users" value={stats.trained_users}
            sub={`of ${stats.total_users} users`} accent="text-emerald-400" bg="bg-emerald-500/10" />
          <StatCard icon={AlertCircle} label="Untrained Users" value={stats.untrained_users}
            accent="text-amber-400" bg="bg-amber-500/10" />
          <StatCard icon={Cpu} label="Engine"
            value={stats.engine?.replace('Engine', '') ?? '—'}
            sub={`${stats.embedding_dim ?? '?'}d embeddings`}
            accent="text-purple-400" bg="bg-purple-500/10" />
        </div>
      )}

      {/* Untrained users warning */}
      {stats?.untrained_users > 0 && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-500/5 border border-amber-500/20">
          <AlertCircle size={16} className="text-amber-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-300">
              {stats.untrained_users} user{stats.untrained_users > 1 ? 's have' : ' has'} no face data
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              {stats.untrained_names.join(', ')}{stats.untrained_users > 10 ? '…' : ''}
            </p>
            <p className="text-xs text-slate-600 mt-1">
              Register faces via <strong className="text-slate-400">User Profile → Face Management</strong>, or upload a dataset ZIP below.
            </p>
          </div>
        </div>
      )}

      {/* ── Upload dataset card ────────────────────────────────────────────── */}
      <div className="card space-y-5">
        {/* Section header */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
            <HardDrive size={16} className="text-cyan-400" />
          </div>
          <div>
            <h2 className="font-bold text-slate-100 text-base">Upload Face Dataset</h2>
            <p className="text-xs text-slate-500">ZIP file with one folder per person containing their face photos</p>
          </div>
        </div>

        {/* ZIP format guide */}
        <div className="bg-slate-950 rounded-xl p-4 font-mono text-xs text-slate-400 space-y-0.5 border border-slate-800">
          <p className="text-cyan-300 mb-1">dataset.zip</p>
          <p className="text-slate-300">├── <span className="text-emerald-300">Asif Rahman</span>/</p>
          <p className="ml-4">├── photo1.jpg</p>
          <p className="ml-4">└── photo2.jpg</p>
          <p className="text-slate-300">└── <span className="text-emerald-300">Jane Smith</span>/</p>
          <p className="ml-4 text-slate-600">← folder name must match the registered user's name</p>
        </div>

        {/* Option: Auto-create users */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setCreateUsers(v => !v)}
            className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${createUsers ? 'bg-cyan-600' : 'bg-slate-700'}`}
          >
            <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all ${createUsers ? 'left-6' : 'left-1'}`} />
          </button>
          <div>
            <p className="text-sm font-medium text-slate-300">Auto-create users for unknown names</p>
            <p className="text-xs text-slate-600">Creates a new account if no user matches the folder name</p>
          </div>
        </div>

        {/* Drop zone */}
        <div
          ref={dropRef}
          onClick={() => zipRef.current?.click()}
          className={`
            border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all duration-200
            ${dragging
              ? 'border-cyan-400 bg-cyan-500/10 scale-[1.01]'
              : zipFile
              ? 'border-emerald-500/50 bg-emerald-500/5'
              : 'border-slate-600 hover:border-cyan-500/60 hover:bg-cyan-500/5'}
          `}
        >
          <input
            ref={zipRef}
            type="file"
            accept=".zip"
            onChange={e => { const f = e.target.files?.[0]; if (f) setZipFile(f) }}
            className="hidden"
          />
          {zipFile ? (
            <div className="space-y-2">
              <CheckCircle size={32} className="mx-auto text-emerald-400" />
              <p className="font-semibold text-emerald-300">{zipFile.name}</p>
              <p className="text-xs text-slate-500">
                {(zipFile.size / 1024 / 1024).toFixed(1)} MB · Click to change
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <Upload size={32} className="mx-auto text-slate-500" />
              <p className="font-semibold text-slate-400">Drop your dataset ZIP here</p>
              <p className="text-xs text-slate-600">Or click to browse files</p>
            </div>
          )}
        </div>

        {/* Upload button */}
        {zipFile && (
          <div className="space-y-2">
            <button
              onClick={handleUpload}
              disabled={uploading}
              className="btn-primary w-full py-3 text-base"
            >
              {uploading ? (
                <><RefreshCw size={17} className="animate-spin" /> Processing…</>
              ) : (
                <><Brain size={17} /> Start Training</>
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
      </div>

      {/* ── Training Jobs ──────────────────────────────────────────────────── */}
      {jobList.length > 0 && (
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-slate-100 flex items-center gap-2">
              <Clock size={15} className="text-cyan-400" />
              Training Jobs
              <span className="text-xs bg-cyan-600/50 px-2 py-0.5 rounded-full">{jobList.length}</span>
            </h2>
            <button onClick={loadData} disabled={loading} className="btn-secondary text-xs py-1.5">
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
          <div className="space-y-2">
            {jobList.map(([jid, job]) => (
              <JobCard key={jid} jid={jid} job={job} />
            ))}
          </div>
        </div>
      )}

      {/* Empty state when no jobs */}
      {jobList.length === 0 && !loading && (
        <div className="text-center py-8 text-slate-600 text-sm">
          No training jobs yet — upload a dataset to get started.
        </div>
      )}
    </div>
  )
}
