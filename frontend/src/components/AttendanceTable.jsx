import { ChevronLeft, ChevronRight, CheckCircle2, AlertTriangle, Clock } from 'lucide-react'
import { useState } from 'react'
import { format } from 'date-fns'

const STATUS_COLORS = {
  present: 'badge-success',
  late:    'badge-warning',
  manual:  'badge-info',
  absent:  'badge-error',
}

const PAGE_SIZE = 20

export default function AttendanceTable({ records = [], loading = false }) {
  const [page, setPage] = useState(1)
  const totalPages = Math.max(1, Math.ceil(records.length / PAGE_SIZE))
  const paged = records.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!records.length) {
    return (
      <div className="text-center py-16 text-slate-500 card bg-slate-900/40 border-slate-800">
        <p className="text-4xl mb-3">📋</p>
        <p className="font-medium text-slate-300">No attendance records found</p>
        <p className="text-xs text-slate-500 mt-1">Try adjusting your filters or date range</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="table-wrapper">
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>Employee / User</th>
              <th>User ID</th>
              <th>Department</th>
              <th>Check-In Time</th>
              <th>Punch Out</th>
              <th>Hours Worked</th>
              <th>Status</th>
              <th>Core Hours</th>
              <th>Marked By</th>
            </tr>
          </thead>
          <tbody>
            {paged.map((rec, idx) => {
              const userName = rec.user_name || rec.user?.name || 'Unknown'
              const deptName = rec.dept_name || rec.user?.department?.name || '—'
              const userIdCode = rec.user_student_id || rec.user?.student_id || '—'
              const checkInStr = rec.timestamp ? format(new Date(rec.timestamp), 'dd MMM yyyy, hh:mm:ss a') : '—'
              const punchOutStr = rec.punch_out ? format(new Date(rec.punch_out), 'hh:mm:ss a') : '—'
              const isSatisfied = rec.is_core_hours_satisfied !== false

              return (
                <tr key={rec.id}>
                  <td className="text-slate-500 tabular-nums">{(page - 1) * PAGE_SIZE + idx + 1}</td>
                  <td>
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-cyan-600/15 border border-cyan-500/25 flex items-center justify-center text-xs font-bold text-cyan-400 flex-shrink-0">
                        {userName[0]}
                      </div>
                      <span className="font-medium text-slate-200">{userName}</span>
                    </div>
                  </td>
                  <td className="font-mono text-xs text-slate-400">{userIdCode}</td>
                  <td className="text-slate-400">{deptName}</td>
                  <td className="tabular-nums text-slate-300 text-xs">
                    {checkInStr}
                  </td>
                  <td className="tabular-nums text-slate-400 text-xs">
                    {punchOutStr}
                  </td>
                  <td className="tabular-nums font-semibold text-slate-300 text-xs">
                    {rec.hours_worked ? `${Number(rec.hours_worked).toFixed(1)} hrs` : '0.0 hrs'}
                  </td>
                  <td>
                    <span className={`badge ${STATUS_COLORS[rec.status] || 'badge-gray'} text-[10px] uppercase font-bold`}>
                      {rec.status}
                    </span>
                  </td>
                  <td>
                    {isSatisfied ? (
                      <span className="badge badge-success text-[10px] flex items-center gap-1 font-semibold">
                        <CheckCircle2 size={10} /> Satisfied
                      </span>
                    ) : (
                      <span className="badge badge-warning text-[10px] flex items-center gap-1 font-semibold">
                        <AlertTriangle size={10} /> Violation
                      </span>
                    )}
                  </td>
                  <td className="text-slate-400 text-xs">{rec.marked_by || 'System'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm pt-2">
          <p className="text-slate-500 text-xs">
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, records.length)} of {records.length} records
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="btn-secondary py-1.5 px-2.5 text-xs"
            >
              <ChevronLeft size={14} /> Previous
            </button>
            <span className="px-3 py-1.5 text-slate-300 text-xs font-semibold">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="btn-secondary py-1.5 px-2.5 text-xs"
            >
              Next <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
