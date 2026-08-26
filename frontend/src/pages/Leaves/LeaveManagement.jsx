import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../context/AuthContext'
import {
  getMyLeaves,
  getLeaveSummary,
  applyLeave,
  updateLeave,
  getAlternativeUsers,
  getAllLeaves,
  reviewLeave,
  deleteLeave
} from '../../api/leaves'
import {
  Calendar,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Plus,
  FileText,
  UserCheck,
  Filter,
  Trash2,
  Send,
  Sparkles,
  User,
  Check,
  X,
  Search,
  CalendarCheck,
  FileEdit,
  Save,
  Eye
} from 'lucide-react'

const LEAVE_TYPES = ['Casual', 'Medical', 'Festival']

const TYPE_COLORS = {
  Casual: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/25',
  Medical: 'bg-rose-500/10 text-rose-400 border-rose-500/25',
  Festival: 'bg-amber-500/10 text-amber-400 border-amber-500/25',
}

const STATUS_BADGES = {
  draft: {
    label: 'Draft',
    icon: FileEdit,
    className: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
  },
  pending: {
    label: 'Pending',
    icon: Clock,
    className: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  },
  approved: {
    label: 'Approved',
    icon: CheckCircle2,
    className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  },
  rejected: {
    label: 'Rejected',
    icon: XCircle,
    className: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
  },
}

export default function LeaveManagement() {
  const { user, canManage } = useAuth()
  const [activeTab, setActiveTab] = useState('my_leaves') // 'my_leaves' | 'apply' | 'review'

  // Data states
  const [myLeaves, setMyLeaves] = useState([])
  const [allLeaves, setAllLeaves] = useState([])
  const [summary, setSummary] = useState({
    yearly_entitlement: 25,
    leave_taken: 0,
    pending_leave: 0,
    remaining_leave: 25,
    last_leave_date: 'None',
  })
  const [altUsers, setAltUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [savingDraft, setSavingDraft] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Form states
  const [editingLeaveId, setEditingLeaveId] = useState(null)
  const [formData, setFormData] = useState({
    leave_type: 'Casual',
    reason: '',
    start_date: '',
    end_date: '',
    alternative_user_id: '',
  })

  // Filter states
  const [myFilterStatus, setMyFilterStatus] = useState('all')
  const [reviewFilterStatus, setReviewFilterStatus] = useState('all')
  const [reviewSearchTerm, setReviewSearchTerm] = useState('')

  // Review & Selected Applicant Summary states
  const [selectedReviewLeaveItem, setSelectedReviewLeaveItem] = useState(null)
  const [inspectedUserSummary, setInspectedUserSummary] = useState(null)
  const [inspectedLoading, setInspectedLoading] = useState(false)

  // Review Modal state
  const [selectedReviewLeave, setSelectedReviewLeave] = useState(null)
  const [reviewAction, setReviewAction] = useState('') // 'approved' | 'rejected'
  const [adminComment, setAdminComment] = useState('')
  const [reviewSubmitting, setReviewSubmitting] = useState(false)

  // Load data
  const fetchData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [myRes, altRes] = await Promise.all([
        getMyLeaves().catch(() => ({ data: { leaves: [], summary: null } })),
        getAlternativeUsers().catch(() => ({ data: { users: [] } })),
      ])

      if (myRes.data?.leaves) setMyLeaves(myRes.data.leaves)
      if (myRes.data?.summary) setSummary(myRes.data.summary)
      if (altRes.data?.users) setAltUsers(altRes.data.users)

      if (canManage) {
        const allRes = await getAllLeaves().catch(() => ({ data: { leaves: [] } }))
        if (allRes.data?.leaves) setAllLeaves(allRes.data.leaves)
      }
    } catch (err) {
      console.error('Error loading leaves data:', err)
    } finally {
      setLoading(false)
    }
  }, [canManage])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Filtered lists
  const filteredMyLeaves = myLeaves.filter(l => {
    if (myFilterStatus === 'all') return true
    return l.status === myFilterStatus
  })

  const filteredReviewLeaves = allLeaves.filter(l => {
    if (reviewFilterStatus !== 'all' && l.status !== reviewFilterStatus) return false
    if (reviewSearchTerm.trim()) {
      const term = reviewSearchTerm.toLowerCase()
      const name = (l.user_name || '').toLowerCase()
      const dept = (l.department_name || '').toLowerCase()
      const sid = (l.user_student_id || '').toLowerCase()
      return name.includes(term) || dept.includes(term) || sid.includes(term)
    }
    return true
  })

  // Auto-select first application in review list when entering review tab or changing filter
  useEffect(() => {
    if (activeTab === 'review' && filteredReviewLeaves.length > 0) {
      if (!selectedReviewLeaveItem || !filteredReviewLeaves.some(l => l.id === selectedReviewLeaveItem.id)) {
        setSelectedReviewLeaveItem(filteredReviewLeaves[0])
      }
    }
  }, [activeTab, filteredReviewLeaves, selectedReviewLeaveItem])

  // Fetch inspected user summary whenever selected applicant changes in review tab
  useEffect(() => {
    if (activeTab === 'review' && selectedReviewLeaveItem?.user_id) {
      setInspectedLoading(true)
      getLeaveSummary(selectedReviewLeaveItem.user_id)
        .then(res => {
          if (res.data?.summary) {
            setInspectedUserSummary(res.data.summary)
          }
        })
        .catch(err => console.error('Error fetching inspected user summary:', err))
        .finally(() => setInspectedLoading(false))
    } else {
      setInspectedUserSummary(null)
    }
  }, [activeTab, selectedReviewLeaveItem?.user_id])

  // Reset form
  const resetForm = () => {
    setEditingLeaveId(null)
    setFormData({
      leave_type: 'Casual',
      reason: '',
      start_date: '',
      end_date: '',
      alternative_user_id: '',
    })
    setError('')
    setSuccess('')
  }

  // Edit draft item
  const handleEditDraft = (l) => {
    setEditingLeaveId(l.id)
    setFormData({
      leave_type: l.leave_type || 'Casual',
      reason: l.reason || '',
      start_date: l.start_date || '',
      end_date: l.end_date || '',
      alternative_user_id: l.alternative_user_id ? String(l.alternative_user_id) : '',
    })
    setError('')
    setSuccess('')
    setActiveTab('apply')
  }

  // Calculate days for form preview
  const calculatedFormDays = (() => {
    if (!formData.start_date || !formData.end_date) return 0
    const start = new Date(formData.start_date)
    const end = new Date(formData.end_date)
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return 0
    return Math.floor((end - start) / (1000 * 60 * 60 * 24)) + 1
  })()

  // Form submit / draft save handler
  const handleFormSubmit = async (targetStatus = 'pending') => {
    setError('')
    setSuccess('')

    if (targetStatus === 'pending') {
      if (!formData.reason.trim()) {
        setError('Please provide a reason for your leave request.')
        return
      }
      if (!formData.start_date || !formData.end_date) {
        setError('Please select both start and end dates.')
        return
      }
      if (calculatedFormDays <= 0) {
        setError('Start date cannot be after end date.')
        return
      }
      if (calculatedFormDays > summary.remaining_leave) {
        setError(`Requested duration (${calculatedFormDays} days) exceeds your remaining leave entitlement (${summary.remaining_leave} days).`)
        return
      }
    }

    if (targetStatus === 'draft') {
      setSavingDraft(true)
    } else {
      setSubmitting(true)
    }

    try {
      const payload = {
        ...formData,
        status: targetStatus,
      }

      let res
      if (editingLeaveId) {
        res = await updateLeave(editingLeaveId, payload)
      } else {
        res = await applyLeave(payload)
      }

      if (res.data.success) {
        const msg = targetStatus === 'draft' ? 'Leave draft saved successfully!' : 'Leave application submitted successfully!'
        setSuccess(msg)
        resetForm()
        fetchData()
        setTimeout(() => {
          setActiveTab('my_leaves')
          setSuccess('')
        }, 1200)
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to process leave application.')
    } finally {
      setSubmitting(false)
      setSavingDraft(false)
    }
  }

  // Directly submit a draft request from the list
  const handleSubmitDraftDirectly = async (leaveId) => {
    try {
      await updateLeave(leaveId, { status: 'pending' })
      fetchData()
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to submit draft application.')
    }
  }

  // Cancel / Delete pending or draft leave
  const handleCancelLeave = async (leaveId, isDraft = false) => {
    const confirmMsg = isDraft
      ? 'Are you sure you want to discard this draft leave request?'
      : 'Are you sure you want to cancel this pending leave request?'
    if (!window.confirm(confirmMsg)) return
    try {
      await deleteLeave(leaveId)
      fetchData()
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to remove leave request.')
    }
  }

  // Open Review modal
  const handleOpenReview = (e, leaveItem, action) => {
    e.stopPropagation()
    setSelectedReviewLeave(leaveItem)
    setReviewAction(action)
    setAdminComment('')
  }

  // Submit Review (Approve/Reject)
  const handleReviewSubmit = async () => {
    if (!selectedReviewLeave || !reviewAction) return
    setReviewSubmitting(true)
    try {
      await reviewLeave(selectedReviewLeave.id, {
        status: reviewAction,
        admin_comment: adminComment,
      })
      setSelectedReviewLeave(null)
      setReviewAction('')
      setAdminComment('')
      fetchData()
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to submit leave review.')
    } finally {
      setReviewSubmitting(false)
    }
  }

  const pendingReviewCount = allLeaves.filter(l => l.status === 'pending').length
  const draftCount = myLeaves.filter(l => l.status === 'draft').length

  // Active Summary calculation for right panel
  const activeSummary = (activeTab === 'review' && inspectedUserSummary) ? inspectedUserSummary : summary
  const usedPercentage = Math.min(100, Math.round((activeSummary.leave_taken / activeSummary.yearly_entitlement) * 100))

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="section-title flex items-center gap-2">
            <Calendar className="text-cyan-400" size={26} />
            <span className="text-gradient">Leave Management</span>
          </h1>
        </div>

        <button
          onClick={() => {
            resetForm()
            setActiveTab('apply')
          }}
          className="btn-primary text-xs flex items-center gap-2 py-2 px-4 w-fit"
        >
          <Plus size={15} />
          Apply for Leave
        </button>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Section (Tabs & Content) */}
        <div className="lg:col-span-2 space-y-6">
          {/* Navigation Tabs */}
          <div className="flex items-center gap-2 bg-slate-900/80 p-1.5 rounded-xl border border-slate-800 w-fit">
            <button
              onClick={() => setActiveTab('my_leaves')}
              className={`flex items-center gap-2 text-xs font-semibold px-4 py-2 rounded-lg transition-all ${
                activeTab === 'my_leaves'
                  ? 'bg-cyan-600/20 text-cyan-300 border border-cyan-500/30 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <FileText size={15} />
              My Applications ({myLeaves.length})
              {draftCount > 0 && (
                <span className="bg-purple-500/20 text-purple-300 border border-purple-500/30 font-bold px-1.5 py-0.2 text-[10px] rounded-full">
                  {draftCount} draft
                </span>
              )}
            </button>

            <button
              onClick={() => {
                if (activeTab !== 'apply') resetForm()
                setActiveTab('apply')
              }}
              className={`flex items-center gap-2 text-xs font-semibold px-4 py-2 rounded-lg transition-all ${
                activeTab === 'apply'
                  ? 'bg-cyan-600/20 text-cyan-300 border border-cyan-500/30 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <Plus size={15} />
              {editingLeaveId ? 'Edit Draft' : 'Apply for Leave'}
            </button>

            {canManage && (
              <button
                onClick={() => setActiveTab('review')}
                className={`flex items-center gap-2 text-xs font-semibold px-4 py-2 rounded-lg transition-all relative ${
                  activeTab === 'review'
                    ? 'bg-cyan-600/20 text-cyan-300 border border-cyan-500/30 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
              >
                <UserCheck size={15} />
                Review Applications
                {pendingReviewCount > 0 && (
                  <span className="bg-amber-500 text-slate-950 font-bold px-1.5 py-0.2 text-[10px] rounded-full">
                    {pendingReviewCount}
                  </span>
                )}
              </button>
            )}
          </div>

          {/* Tab 1: My Applications List */}
          {activeTab === 'my_leaves' && (
            <div className="card space-y-5 p-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
                <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                  <FileText size={18} className="text-cyan-400" />
                  My Leave Applications
                </h3>

                {/* Filter presets */}
                <div className="flex gap-1 bg-slate-800/60 p-1 rounded-lg border border-slate-700/40 text-xs flex-wrap">
                  {['all', 'draft', 'pending', 'approved', 'rejected'].map((st) => (
                    <button
                      key={st}
                      onClick={() => setMyFilterStatus(st)}
                      className={`capitalize px-2.5 py-1 rounded-md font-medium transition-all ${
                        myFilterStatus === st
                          ? 'bg-cyan-600 text-white shadow'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {st}
                    </button>
                  ))}
                </div>
              </div>

              {loading ? (
                <div className="space-y-3 py-6">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="h-24 bg-slate-800/50 rounded-xl animate-pulse" />
                  ))}
                </div>
              ) : filteredMyLeaves.length === 0 ? (
                <div className="text-center py-12 space-y-3">
                  <CalendarCheck size={40} className="mx-auto text-slate-600" />
                  <p className="text-sm font-semibold text-slate-400">No leave applications found</p>
                  {myFilterStatus === 'all' && (
                    <button onClick={() => setActiveTab('apply')} className="btn-secondary text-xs mt-2 py-2 px-4">
                      Submit First Application
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredMyLeaves.map((l) => {
                    const stBadge = STATUS_BADGES[l.status] || STATUS_BADGES.pending
                    const StatusIcon = stBadge.icon
                    const typeColor = TYPE_COLORS[l.leave_type] || TYPE_COLORS.Casual
                    const isDraft = l.status === 'draft'

                    return (
                      <div
                        key={l.id}
                        className={`p-4 rounded-xl transition-all space-y-3 ${
                          isDraft
                            ? 'bg-purple-950/20 border border-purple-500/30 hover:border-purple-500/50'
                            : 'bg-slate-800/40 border border-slate-700/40 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${typeColor}`}>
                              {l.leave_type} Leave
                            </span>
                            <span className="text-xs font-semibold text-slate-300">
                              {l.total_days} {l.total_days === 1 ? 'Day' : 'Days'}
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${stBadge.className}`}>
                              <StatusIcon size={13} />
                              {stBadge.label}
                            </span>

                            {isDraft && (
                              <>
                                <button
                                  onClick={() => handleSubmitDraftDirectly(l.id)}
                                  title="Submit Draft Now"
                                  className="btn-primary text-xs py-1 px-3 flex items-center gap-1"
                                >
                                  <Send size={12} /> Submit
                                </button>

                                <button
                                  onClick={() => handleEditDraft(l)}
                                  title="Edit Draft"
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-purple-300 hover:bg-purple-500/10 transition-colors"
                                >
                                  <FileEdit size={15} />
                                </button>

                                <button
                                  onClick={() => handleCancelLeave(l.id, true)}
                                  title="Discard Draft"
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                                >
                                  <Trash2 size={15} />
                                </button>
                              </>
                            )}

                            {l.status === 'pending' && (
                              <button
                                onClick={() => handleCancelLeave(l.id, false)}
                                title="Cancel Pending Request"
                                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                              >
                                <Trash2 size={15} />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Dates & Details */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-400">
                          <div>
                            <span className="text-slate-500 font-medium">Duration: </span>
                            <span className="text-slate-200 font-semibold">{l.start_date}</span> to <span className="text-slate-200 font-semibold">{l.end_date}</span>
                          </div>

                          {l.alternative_user_name && (
                            <div>
                              <span className="text-slate-500 font-medium">Alternative Cover: </span>
                              <span className="text-cyan-400 font-semibold">{l.alternative_user_name}</span>
                            </div>
                          )}
                        </div>

                        <div className="text-xs bg-slate-900/60 p-2.5 rounded-lg border border-slate-800 text-slate-300">
                          <span className="text-slate-500 font-semibold uppercase text-[10px] block mb-0.5">Reason:</span>
                          {l.reason || <span className="text-slate-500 italic">No reason provided (Draft)</span>}
                        </div>

                        {l.status !== 'pending' && l.status !== 'draft' && (
                          <div className="text-[11px] text-slate-400 pt-1 flex items-center justify-between flex-wrap gap-2 border-t border-slate-800/80">
                            <span>
                              Reviewed by <span className="text-slate-200 font-semibold">{l.reviewed_by_name || 'Admin'}</span>
                            </span>
                            {l.admin_comment && (
                              <span className="italic text-slate-400">"{l.admin_comment}"</span>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Tab 2: Apply for Leave Form / Edit Draft */}
          {activeTab === 'apply' && (
            <div className="card space-y-6 p-6">
              <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                  {editingLeaveId ? <FileEdit size={18} className="text-purple-400" /> : <Plus size={18} className="text-cyan-400" />}
                  {editingLeaveId ? 'Edit Leave Draft' : 'Leave Application Form'}
                </h3>

                {editingLeaveId && (
                  <button
                    onClick={resetForm}
                    className="text-xs text-slate-400 hover:text-slate-200 btn-secondary py-1 px-3"
                  >
                    Cancel Editing
                  </button>
                )}
              </div>

              {error && (
                <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                  <AlertCircle size={16} className="flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {success && (
                <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
                  <CheckCircle2 size={16} className="flex-shrink-0" />
                  <span>{success}</span>
                </div>
              )}

              <form onSubmit={(e) => { e.preventDefault(); handleFormSubmit('pending'); }} className="space-y-4">
                {/* Leave Type */}
                <div>
                  <label className="label">Leave Type <span className="text-rose-400">*</span></label>
                  <div className="grid grid-cols-3 gap-3">
                    {LEAVE_TYPES.map((t) => (
                      <button
                        type="button"
                        key={t}
                        onClick={() => setFormData(f => ({ ...f, leave_type: t }))}
                        className={`p-3 rounded-xl border text-xs font-semibold transition-all flex flex-col items-center gap-1.5 ${
                          formData.leave_type === t
                            ? 'bg-cyan-600/20 text-cyan-300 border-cyan-500 shadow-sm'
                            : 'bg-slate-800/40 text-slate-400 border-slate-700/50 hover:bg-slate-800'
                        }`}
                      >
                        <span>{t} Leave</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Dates */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="label">Start Date <span className="text-rose-400">*</span></label>
                    <input
                      type="date"
                      value={formData.start_date}
                      onChange={(e) => setFormData(f => ({ ...f, start_date: e.target.value }))}
                      className="input text-xs py-2"
                    />
                  </div>

                  <div>
                    <label className="label">End Date <span className="text-rose-400">*</span></label>
                    <input
                      type="date"
                      value={formData.end_date}
                      onChange={(e) => setFormData(f => ({ ...f, end_date: e.target.value }))}
                      className="input text-xs py-2"
                    />
                  </div>
                </div>

                {/* Duration Readout */}
                {calculatedFormDays > 0 && (
                  <div className="p-3 rounded-xl bg-cyan-950/30 border border-cyan-500/20 text-cyan-300 text-xs flex items-center justify-between">
                    <span className="font-medium">Calculated Duration:</span>
                    <span className="font-bold text-sm bg-cyan-500/20 px-2.5 py-0.5 rounded-md border border-cyan-500/30">
                      {calculatedFormDays} {calculatedFormDays === 1 ? 'Day' : 'Days'}
                    </span>
                  </div>
                )}

                {/* Alternative User */}
                <div>
                  <label className="label">
                    Alternative Cover User <span className="text-slate-500 font-normal">(Optional)</span>
                  </label>
                  <select
                    value={formData.alternative_user_id}
                    onChange={(e) => setFormData(f => ({ ...f, alternative_user_id: e.target.value }))}
                    className="select text-xs py-2"
                  >
                    <option value="">-- Select alternative user --</option>
                    {altUsers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.department_name}){u.is_same_dept ? ' (Same Dept)' : ''} - ID: {u.student_id}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Reason */}
                <div>
                  <label className="label">Leave Reason <span className="text-rose-400">*</span></label>
                  <textarea
                    rows={3}
                    placeholder="Enter leave reason..."
                    value={formData.reason}
                    onChange={(e) => setFormData(f => ({ ...f, reason: e.target.value }))}
                    className="input text-xs py-2 resize-none"
                  />
                </div>

                {/* Action Buttons */}
                <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      resetForm()
                      setActiveTab('my_leaves')
                    }}
                    className="btn-secondary text-xs py-2.5 px-4"
                  >
                    Cancel
                  </button>

                  <button
                    type="button"
                    disabled={savingDraft || submitting}
                    onClick={() => handleFormSubmit('draft')}
                    className="px-4 py-2.5 rounded-xl text-xs font-semibold bg-purple-600/20 text-purple-300 border border-purple-500/30 hover:bg-purple-600/30 transition-all flex items-center gap-2"
                  >
                    {savingDraft ? (
                      <span>Saving Draft...</span>
                    ) : (
                      <>
                        <Save size={15} />
                        Save as Draft
                      </>
                    )}
                  </button>

                  <button
                    type="submit"
                    disabled={submitting || savingDraft}
                    className="btn-primary text-xs py-2.5 px-5 flex items-center gap-2"
                  >
                    {submitting ? (
                      <span>Submitting...</span>
                    ) : (
                      <>
                        <Send size={15} />
                        Submit Application
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Tab 3: Review Applications (Admin / HR only) */}
          {activeTab === 'review' && canManage && (
            <div className="card space-y-5 p-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
                <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                  <UserCheck size={18} className="text-cyan-400" />
                  Review Leave Requests
                </h3>

                {/* Search & Status Filters */}
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search size={14} className="absolute left-2.5 top-2.5 text-slate-500" />
                    <input
                      type="text"
                      placeholder="Search user..."
                      value={reviewSearchTerm}
                      onChange={(e) => setReviewSearchTerm(e.target.value)}
                      className="input text-xs py-1.5 pl-8 pr-3 w-40"
                    />
                  </div>

                  <div className="flex gap-1 bg-slate-800/60 p-1 rounded-lg border border-slate-700/40 text-xs">
                    {['all', 'pending', 'approved', 'rejected'].map((st) => (
                      <button
                        key={st}
                        onClick={() => setReviewFilterStatus(st)}
                        className={`capitalize px-2.5 py-1 rounded-md font-medium transition-all ${
                          reviewFilterStatus === st
                            ? 'bg-cyan-600 text-white shadow'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {filteredReviewLeaves.length === 0 ? (
                <div className="text-center py-12 space-y-2">
                  <CheckCircle2 size={36} className="mx-auto text-slate-600" />
                  <p className="text-sm font-semibold text-slate-400">No applications to review</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {filteredReviewLeaves.map((l) => {
                    const stBadge = STATUS_BADGES[l.status] || STATUS_BADGES.pending
                    const StatusIcon = stBadge.icon
                    const typeColor = TYPE_COLORS[l.leave_type] || TYPE_COLORS.Casual
                    const isSelected = selectedReviewLeaveItem?.id === l.id

                    return (
                      <div
                        key={l.id}
                        onClick={() => setSelectedReviewLeaveItem(l)}
                        className={`p-4 rounded-xl cursor-pointer transition-all space-y-3 ${
                          isSelected
                            ? 'bg-gradient-to-r from-cyan-950/40 via-slate-800 to-slate-800 border-2 border-cyan-500/80 shadow-lg shadow-cyan-950/40 ring-1 ring-cyan-500/30'
                            : 'bg-slate-800/40 border border-slate-700/40 hover:border-slate-600 hover:bg-slate-800/60'
                        }`}
                      >
                        {/* User & Status Header */}
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/60 pb-3">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-cyan-600/15 border border-cyan-500/25 flex items-center justify-center text-cyan-400 font-bold text-xs">
                              {l.user_name ? l.user_name.charAt(0).toUpperCase() : 'U'}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="text-xs font-bold text-slate-100">{l.user_name}</p>
                                {isSelected && (
                                  <Eye size={13} className="text-cyan-400" title="Selected for Summary View" />
                                )}
                              </div>
                              <p className="text-[11px] text-slate-500">{l.department_name} · ID: {l.user_student_id}</p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            {l.reason?.includes('[Email Submission]') && (
                              <span className="px-2.5 py-0.5 rounded-full text-xs font-extrabold tracking-wider bg-purple-500/20 text-purple-300 border border-purple-500/30 flex items-center gap-1 shadow-sm">
                                📩 Email Request
                              </span>
                            )}
                            <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${typeColor}`}>
                              {l.leave_type} Leave
                            </span>
                            <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${stBadge.className}`}>
                              <StatusIcon size={12} />
                              {stBadge.label}
                            </span>
                          </div>
                        </div>

                        {/* Details */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-slate-400">
                          <div>
                            <span className="text-slate-500 font-medium">Dates: </span>
                            <span className="text-slate-200 font-semibold">{l.start_date}</span> to <span className="text-slate-200 font-semibold">{l.end_date}</span>
                          </div>
                          <div>
                            <span className="text-slate-500 font-medium">Duration: </span>
                            <span className="text-cyan-400 font-bold">{l.total_days} {l.total_days === 1 ? 'Day' : 'Days'}</span>
                          </div>
                          <div>
                            <span className="text-slate-500 font-medium">Cover User: </span>
                            <span className="text-slate-200 font-semibold">{l.alternative_user_name || 'None'}</span>
                          </div>
                        </div>

                        {/* Reason */}
                        <div className="text-xs bg-slate-900/60 p-2.5 rounded-lg border border-slate-800 text-slate-300">
                          <span className="text-slate-500 font-semibold uppercase text-[10px] block mb-0.5">Reason:</span>
                          {l.reason}
                        </div>

                        {/* Action buttons if pending */}
                        {l.status === 'pending' ? (
                          <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-800/80">
                            <button
                              onClick={(e) => handleOpenReview(e, l, 'rejected')}
                              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/30 hover:bg-rose-500/20 transition-colors flex items-center gap-1.5"
                            >
                              <X size={14} /> Reject
                            </button>

                            <button
                              onClick={(e) => handleOpenReview(e, l, 'approved')}
                              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 transition-colors flex items-center gap-1.5"
                            >
                              <Check size={14} /> Approve
                            </button>
                          </div>
                        ) : (
                          <div className="text-[11px] text-slate-400 pt-1 flex items-center justify-between flex-wrap gap-2 border-t border-slate-800/80">
                            <span>Reviewed by <span className="text-slate-200 font-semibold">{l.reviewed_by_name || 'Admin'}</span></span>
                            {l.admin_comment && <span className="italic text-slate-400">"{l.admin_comment}"</span>}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Section (Leave Summary Panel) */}
        <div className="lg:col-span-1 space-y-6">
          <div className="card p-6 bg-gradient-to-br from-slate-900 via-slate-900 to-cyan-950/30 border border-cyan-500/20 space-y-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div>
                <h3 className="font-bold text-base text-slate-100 flex items-center gap-2">
                  <Sparkles size={18} className="text-cyan-400" />
                  {activeTab === 'review' && selectedReviewLeaveItem
                    ? `${selectedReviewLeaveItem.user_name}'s Summary`
                    : 'Leave Summary'}
                </h3>
                {activeTab === 'review' && selectedReviewLeaveItem && (
                  <p className="text-xs text-slate-500 mt-0.5">
                    {selectedReviewLeaveItem.department_name} · ID: {selectedReviewLeaveItem.user_student_id}
                  </p>
                )}
              </div>
              <span className="badge badge-success text-[11px] font-bold px-2.5 py-0.5">
                {new Date().getFullYear()}
              </span>
            </div>

            {inspectedLoading ? (
              <div className="py-8 space-y-3 animate-pulse">
                <div className="h-4 bg-slate-800 rounded w-3/4" />
                <div className="h-10 bg-slate-800 rounded" />
                <div className="h-10 bg-slate-800 rounded" />
              </div>
            ) : (
              <>
                {/* Visual Progress Bar */}
                <div className="space-y-2">
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="text-slate-400">Used Entitlement</span>
                    <span className="text-cyan-300">{activeSummary.leave_taken} / {activeSummary.yearly_entitlement} Days ({usedPercentage}%)</span>
                  </div>
                  <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden border border-slate-700">
                    <div
                      className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400 rounded-full transition-all duration-500"
                      style={{ width: `${usedPercentage}%` }}
                    />
                  </div>
                </div>

                {/* Summary Metrics Cards */}
                <div className="space-y-3">
                  {/* Entitlement */}
                  <div className="flex items-center justify-between p-3 rounded-xl bg-slate-800/40 border border-slate-700/40">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
                        <Calendar size={16} />
                      </div>
                      <p className="text-xs font-medium text-slate-400">Yearly Entitlement</p>
                    </div>
                    <span className="text-sm font-bold text-slate-100">{activeSummary.yearly_entitlement} Days</span>
                  </div>

                  {/* Leave Taken */}
                  <div className="flex items-center justify-between p-3 rounded-xl bg-slate-800/40 border border-slate-700/40">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                        <CheckCircle2 size={16} />
                      </div>
                      <p className="text-xs font-medium text-slate-400">Leave Taken</p>
                    </div>
                    <span className="text-sm font-bold text-emerald-400">{activeSummary.leave_taken} Days</span>
                  </div>

                  {/* Pending Leave */}
                  <div className="flex items-center justify-between p-3 rounded-xl bg-slate-800/40 border border-slate-700/40">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                        <Clock size={16} />
                      </div>
                      <p className="text-xs font-medium text-slate-400">Pending Requests</p>
                    </div>
                    <span className="text-sm font-bold text-amber-400">{activeSummary.pending_leave} Days</span>
                  </div>

                  {/* Remaining Leave */}
                  <div className="flex items-center justify-between p-3.5 rounded-xl bg-gradient-to-r from-cyan-950/40 to-slate-800/60 border border-cyan-500/30">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-300">
                        <Sparkles size={16} />
                      </div>
                      <p className="text-xs font-bold text-slate-200">Remaining Balance</p>
                    </div>
                    <span className="text-base font-extrabold text-cyan-300">{activeSummary.remaining_leave} Days</span>
                  </div>

                  {/* Last Leave Date */}
                  <div className="flex items-center justify-between p-3 rounded-xl bg-slate-800/40 border border-slate-700/40">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-slate-700/40 border border-slate-600/30 flex items-center justify-center text-slate-400">
                        <CalendarCheck size={16} />
                      </div>
                      <p className="text-xs font-medium text-slate-400">Last Leave Date</p>
                    </div>
                    <span className="text-xs font-semibold text-slate-200">{activeSummary.last_leave_date}</span>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Approve/Reject Review Modal */}
      {selectedReviewLeave && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="card max-w-md w-full p-6 space-y-4 animate-scale-in">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                {reviewAction === 'approved' ? (
                  <CheckCircle2 size={18} className="text-emerald-400" />
                ) : (
                  <XCircle size={18} className="text-rose-400" />
                )}
                {reviewAction === 'approved' ? 'Approve' : 'Reject'} Leave Request
              </h3>
              <button
                onClick={() => setSelectedReviewLeave(null)}
                className="text-slate-500 hover:text-slate-300"
              >
                <X size={18} />
              </button>
            </div>

            <div className="text-xs text-slate-300 space-y-2 bg-slate-800/40 p-3 rounded-xl border border-slate-700/40">
              <p><span className="text-slate-500">Applicant:</span> <strong>{selectedReviewLeave.user_name}</strong> ({selectedReviewLeave.department_name})</p>
              <p><span className="text-slate-500">Leave Type:</span> <strong>{selectedReviewLeave.leave_type} Leave</strong> ({selectedReviewLeave.total_days} Days)</p>
              <p><span className="text-slate-500">Duration:</span> {selectedReviewLeave.start_date} to {selectedReviewLeave.end_date}</p>
              {selectedReviewLeave.alternative_user_name && (
                <p><span className="text-slate-500">Cover User:</span> {selectedReviewLeave.alternative_user_name}</p>
              )}
            </div>

            <div>
              <label className="label">
                Review Note / Comment <span className="text-slate-500 font-normal">(Optional)</span>
              </label>
              <textarea
                rows={3}
                placeholder={reviewAction === 'approved' ? 'Add approval note...' : 'Provide reason for rejection...'}
                value={adminComment}
                onChange={(e) => setAdminComment(e.target.value)}
                className="input text-xs py-2 resize-none"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setSelectedReviewLeave(null)}
                className="btn-secondary text-xs py-2 px-4"
              >
                Cancel
              </button>

              <button
                type="button"
                disabled={reviewSubmitting}
                onClick={handleReviewSubmit}
                className={`text-xs font-semibold py-2 px-4 rounded-xl text-white transition-all ${
                  reviewAction === 'approved'
                    ? 'bg-emerald-600 hover:bg-emerald-500 shadow-lg shadow-emerald-600/20'
                    : 'bg-rose-600 hover:bg-rose-500 shadow-lg shadow-rose-600/20'
                }`}
              >
                {reviewSubmitting ? 'Processing...' : reviewAction === 'approved' ? 'Confirm Approval' : 'Confirm Rejection'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
