import { useEffect, useState } from 'react'
import { getProfileRequests, approveProfileRequest, rejectProfileRequest } from '../../api/profileRequests'
import { ToastContainer, useToast } from '../../components/Toast'
import ConfirmModal from '../../components/ConfirmModal'
import {
  Check, X, AlertCircle, RefreshCw, User, Phone, Image, Calendar, CheckCircle2, XCircle, ShieldAlert
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

export default function ProfileRequests() {
  const { toasts, removeToast, toast } = useToast()
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('pending') // pending, approved, rejected
  const [actioning, setActioning] = useState(false)
  const [confirmApprove, setConfirmApprove] = useState(null) // request object
  const [rejectTarget, setRejectTarget] = useState(null) // request object
  const [rejectionReason, setRejectionReason] = useState('')

  const loadRequests = async () => {
    setLoading(true)
    try {
      const res = await getProfileRequests(tab)
      setRequests(res.data.requests || [])
    } catch {
      toast.error('Failed to load profile change requests')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadRequests()
  }, [tab])

  const handleApprove = async () => {
    if (!confirmApprove) return
    setActioning(true)
    try {
      await approveProfileRequest(confirmApprove.id)
      toast.success('Profile change request approved')
      setConfirmApprove(null)
      loadRequests()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to approve request')
    } finally {
      setActioning(false)
    }
  }

  const handleReject = async () => {
    if (!rejectTarget) return
    setActioning(true)
    try {
      await rejectProfileRequest(rejectTarget.id, rejectionReason)
      toast.success('Profile change request rejected')
      setRejectTarget(null)
      setRejectionReason('')
      loadRequests()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to reject request')
    } finally {
      setActioning(false)
    }
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-6xl">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      {/* Approve Confirm Modal */}
      {confirmApprove && (
        <ConfirmModal
          title="Approve Profile Changes"
          message={`Are you sure you want to approve profile changes for ${confirmApprove.user_name}? This will update their profile immediately.`}
          confirmLabel="Approve"
          danger={false}
          onConfirm={handleApprove}
          onCancel={() => setConfirmApprove(null)}
        />
      )}

      {/* Reject Modal with Reason Input */}
      {rejectTarget && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="card max-w-md w-full p-6 space-y-4 border border-slate-800 bg-slate-900 shadow-2xl">
            <div className="flex items-center gap-3 text-rose-400">
              <ShieldAlert size={22} />
              <h3 className="text-lg font-bold text-slate-100">Reject Profile Request</h3>
            </div>
            <p className="text-sm text-slate-400">
              Specify a reason for rejecting the profile change request from <strong className="text-slate-200">{rejectTarget.user_name}</strong>:
            </p>
            <textarea
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              className="textarea min-h-[100px] w-full"
              placeholder="e.g. Invalid name format, or face photo is blurry."
            />
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => { setRejectTarget(null); setRejectionReason('') }}
                className="btn-secondary text-sm py-2"
                disabled={actioning}
              >
                Cancel
              </button>
              <button
                onClick={handleReject}
                className="btn-danger text-sm py-2"
                disabled={actioning}
              >
                {actioning ? 'Rejecting...' : 'Reject Request'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="section-title">Approval Requests</h1>
          <p className="section-subtitle">Review and verify user profile change requests</p>
        </div>
        <button onClick={loadRequests} className="btn-secondary text-sm">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 bg-slate-800/60 p-1 rounded-xl w-fit">
        {[
          { id: 'pending', label: 'Pending Requests' },
          { id: 'approved', label: 'Approved' },
          { id: 'rejected', label: 'Rejected' },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all
              ${tab === t.id ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Main List */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : !requests.length ? (
        <div className="card text-center py-16 text-slate-500">
          <AlertCircle size={40} className="mx-auto mb-3 text-slate-600" />
          <p className="font-semibold text-slate-400">No requests found</p>
          <p className="text-sm mt-1">There are no profile change requests in this category</p>
        </div>
      ) : (
        <div className="space-y-4">
          {requests.map((req) => {
            const hasNameChange = req.requested_name && req.requested_name !== req.current_name
            const hasPhoneChange = req.requested_phone && req.requested_phone !== req.current_phone
            const hasImageChange = !!req.requested_image_path

            return (
              <div key={req.id} className="card p-5 space-y-4 border border-slate-800/80 bg-slate-900/60 hover:bg-slate-900/80 transition-all duration-200">
                {/* User Banner / Header */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-slate-800 pb-3">
                  <div>
                    <h2 className="font-bold text-slate-200 text-base">{req.user_name}</h2>
                    <p className="text-xs text-slate-500">
                      ID: {req.user_student_id || 'N/A'} · {req.user_email}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <Calendar size={13} className="text-slate-500" />
                    <span>
                      {req.created_at ? formatDistanceToNow(new Date(req.created_at), { addSuffix: true }) : '—'}
                    </span>
                  </div>
                </div>

                {/* Side-by-Side Comparison */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-1">
                  {/* Name Changes */}
                  <div className="space-y-2 card-glass p-3.5">
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                      <User size={13} className="text-cyan-400" /> Name
                    </h3>
                    <div className="space-y-1">
                      <p className="text-xs text-slate-500">Current:</p>
                      <p className="text-sm text-slate-300 font-medium">{req.current_name || 'N/A'}</p>
                      {hasNameChange ? (
                        <>
                          <p className="text-xs text-amber-500 mt-2 font-bold">Requested:</p>
                          <p className="text-sm text-amber-400 font-semibold bg-amber-500/5 px-2 py-1 rounded border border-amber-500/10">
                            {req.requested_name}
                          </p>
                        </>
                      ) : (
                        <p className="text-xs text-slate-600 mt-1 italic">No change requested</p>
                      )}
                    </div>
                  </div>

                  {/* Phone Changes */}
                  <div className="space-y-2 card-glass p-3.5">
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                      <Phone size={13} className="text-cyan-400" /> Phone
                    </h3>
                    <div className="space-y-1">
                      <p className="text-xs text-slate-500">Current:</p>
                      <p className="text-sm text-slate-300 font-medium">{req.current_phone || 'N/A'}</p>
                      {hasPhoneChange ? (
                        <>
                          <p className="text-xs text-amber-500 mt-2 font-bold">Requested:</p>
                          <p className="text-sm text-amber-400 font-semibold bg-amber-500/5 px-2 py-1 rounded border border-amber-500/10">
                            {req.requested_phone}
                          </p>
                        </>
                      ) : (
                        <p className="text-xs text-slate-600 mt-1 italic">No change requested</p>
                      )}
                    </div>
                  </div>

                  {/* Profile Image Comparison */}
                  <div className="space-y-2 card-glass p-3.5 md:col-span-1">
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                      <Image size={13} className="text-cyan-400" /> Photo Verification
                    </h3>
                    {hasImageChange ? (
                      <div className="flex gap-4 items-center mt-1">
                        {/* Current Photo */}
                        <div className="text-center space-y-1">
                          <p className="text-[10px] text-slate-500">Current</p>
                          {req.current_image_path ? (
                            <img
                              src={`/storage/${req.current_image_path}`}
                              alt="Current"
                              className="w-16 h-16 rounded-xl object-cover border border-slate-700 shadow"
                              onError={(e) => { e.target.style.display = 'none' }}
                            />
                          ) : (
                            <div className="w-16 h-16 rounded-xl bg-slate-800 flex items-center justify-center font-bold text-slate-600 text-xl border border-slate-700">
                              {req.user_name?.[0]?.toUpperCase()}
                            </div>
                          )}
                        </div>

                        {/* Arrow */}
                        <div className="text-slate-600 font-black">➔</div>

                        {/* Requested Photo */}
                        <div className="text-center space-y-1">
                          <p className="text-[10px] text-amber-500 font-bold">Requested</p>
                          <img
                            src={`/storage/${req.requested_image_path}`}
                            alt="Requested"
                            className="w-16 h-16 rounded-xl object-cover border-2 border-amber-500/40 shadow-lg shadow-amber-500/5"
                            onError={(e) => { e.target.style.display = 'none' }}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="pt-2 text-xs text-slate-600 italic">No photo change requested</div>
                    )}
                  </div>
                </div>

                {/* History Info / Actions */}
                <div className="flex justify-end gap-2 pt-2 border-t border-slate-800/50">
                  {tab === 'pending' ? (
                    <>
                      <button
                        onClick={() => setRejectTarget(req)}
                        className="btn-secondary text-xs flex items-center gap-1 py-1.5 px-3 hover:bg-rose-500/10 hover:text-rose-400 hover:border-rose-500/20"
                      >
                        <X size={13} /> Reject
                      </button>
                      <button
                        onClick={() => setConfirmApprove(req)}
                        className="btn-primary text-xs flex items-center gap-1 py-1.5 px-3"
                      >
                        <Check size={13} /> Approve
                      </button>
                    </>
                  ) : tab === 'approved' ? (
                    <div className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 px-2.5 py-1 rounded-lg">
                      <CheckCircle2 size={13} />
                      <span>Approved</span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-end gap-1">
                      <div className="flex items-center gap-1.5 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/25 px-2.5 py-1 rounded-lg">
                        <XCircle size={13} />
                        <span>Rejected</span>
                      </div>
                      {req.rejection_reason && (
                        <p className="text-xs text-slate-500 italic max-w-xs text-right mt-1">
                          Reason: "{req.rejection_reason}"
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
