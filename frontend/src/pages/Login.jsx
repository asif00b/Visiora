import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Eye, EyeOff, Lock, Mail } from 'lucide-react'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ email: '', password: '' })
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const canvasRef = useRef(null)

  // ── Particle Background Effect ───────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let animationFrameId
    
    let width = canvas.width = window.innerWidth
    let height = canvas.height = window.innerHeight
    
    const handleResize = () => {
      if (!canvas) return
      width = canvas.width = window.innerWidth
      height = canvas.height = window.innerHeight
    }
    window.addEventListener('resize', handleResize)
    
    // Create subtle particles
    const particleCount = Math.min(70, Math.floor((width * height) / 18000))
    const particles = []
    
    for (let i = 0; i < particleCount; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.35, // slow moving
        vy: (Math.random() - 0.5) * 0.35,
        radius: Math.random() * 1.5 + 1,
        color: `rgba(6, 182, 212, ${Math.random() * 0.12 + 0.06})` // soft cyan glowing dots
      })
    }
    
    const draw = () => {
      ctx.clearRect(0, 0, width, height)
      
      // Update and draw particles
      particles.forEach(p => {
        p.x += p.vx
        p.y += p.vy
        
        // Boundaries
        if (p.x < 0 || p.x > width) p.vx *= -1
        if (p.y < 0 || p.y > height) p.vy *= -1
        
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2)
        ctx.fillStyle = p.color
        ctx.fill()
      })
      
      // Draw faint connections (constellation mesh)
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.05)'
      ctx.lineWidth = 0.7
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dist = Math.hypot(particles[i].x - particles[j].x, particles[i].y - particles[j].y)
          if (dist < 120) {
            ctx.beginPath()
            ctx.moveTo(particles[i].x, particles[i].y)
            ctx.lineTo(particles[j].x, particles[j].y)
            ctx.stroke()
          }
        }
      }
      
      animationFrameId = requestAnimationFrame(draw)
    }
    
    draw()
    
    return () => {
      window.removeEventListener('resize', handleResize)
      cancelAnimationFrame(animationFrameId)
    }
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(form.email, form.password)
      navigate('/dashboard')
    } catch (err) {
      setError(err.response?.data?.message || 'Login failed. Check your credentials.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden bg-[#060d1b]">
      {/* Particle Canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ zIndex: 0 }}
      />

      {/* Static Background gradients */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" style={{ zIndex: 0 }}>
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-cyan-600/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-sky-600/10 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-cyan-950/5 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md animate-slide-up z-10">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-cyan-600/20 border border-cyan-500/30 mb-4 shadow-xl shadow-cyan-500/10">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-8 h-8 text-cyan-400">
              {/* Focus Brackets / Tech Border */}
              <path d="M3 8V5a2 2 0 0 1 2-2h3" className="stroke-cyan-500" strokeWidth="2" />
              <path d="M16 3h3a2 2 0 0 1 2 2v3" className="stroke-cyan-500" strokeWidth="2" />
              <path d="M21 16v3a2 2 0 0 1-2 2h-3" className="stroke-cyan-500" strokeWidth="2" />
              <path d="M8 21H5a2 2 0 0 1-2-2v-3" className="stroke-cyan-500" strokeWidth="2" />

              {/* Shutter Blades forming circular core */}
              <circle cx="12" cy="12" r="5" stroke="currentColor" strokeWidth="1" className="stroke-cyan-400/40" />
              <path d="M12 7c2.76 0 5 2.24 5 5" className="stroke-cyan-400" />
              <path d="M17 12c0 2.76-2.24 5-5 5" className="stroke-cyan-400" />
              <path d="M12 17c-2.76 0-5-2.24-5-5" className="stroke-cyan-400" />
              <path d="M7 12c0-2.76 2.24-5 5-5" className="stroke-cyan-400" />

              {/* Abstract overlapping tech face lines */}
              <path d="M9 11a3 3 0 0 1 6 0" className="stroke-cyan-300" strokeWidth="2" />
              <path d="M12 11v2" className="stroke-cyan-300" strokeWidth="2" />
              <path d="M8 17a4 4 0 0 1 8 0" className="stroke-cyan-300" strokeWidth="2" />

              {/* Scanner target line */}
              <line x1="2" y1="12" x2="22" y2="12" className="stroke-sky-500/60" strokeWidth="1" strokeDasharray="2 2" />
            </svg>
          </div>
          <h1 className="text-3xl font-black text-gradient tracking-tight">Visiora</h1>
          <p className="text-slate-500 mt-1 text-sm font-medium">Recognize. Verify. Record.</p>
        </div>

        {/* Card */}
        <div className="card-glass shadow-2xl relative overflow-hidden border border-cyan-900/30">
          <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-cyan-500/40 to-transparent" />
          
          <h2 className="text-xl font-bold text-slate-100 mb-6">Sign In</h2>

          {error && (
            <div className="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label" htmlFor="login-email">Email Address</label>
              <div className="relative">
                <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  id="login-email"
                  type="email"
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  className="input pl-10 bg-slate-900/60 focus:bg-slate-900/90 border border-slate-700/50 focus:border-cyan-500/50"
                  placeholder="name@example.com"
                  required
                  autoComplete="email"
                />
              </div>
            </div>

            <div>
              <label className="label" htmlFor="login-password">Password</label>
              <div className="relative">
                <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  id="login-password"
                  type={showPw ? 'text' : 'password'}
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  className="input pl-10 pr-10 bg-slate-900/60 focus:bg-slate-900/90 border border-slate-700/50 focus:border-cyan-500/50"
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(v => !v)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                >
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              id="login-submit"
              type="submit"
              disabled={loading}
              className="btn-primary w-full py-3 text-base mt-2 shadow-lg shadow-cyan-600/20 active:scale-[0.98]"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Signing in...
                </span>
              ) : 'Sign In'}
            </button>
          </form>

          <div className="mt-6 pt-4 border-t border-slate-700/40 text-center">
            <p className="text-[10px] text-slate-600">© {new Date().getFullYear()} Visiora — Face Recognition Attendance System</p>
          </div>
        </div>
      </div>
    </div>
  )
}
