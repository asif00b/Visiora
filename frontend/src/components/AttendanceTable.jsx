import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { format } from 'date-fns'

const STATUS_COLORS = {
  present: 'badge-success',
  late: 'badge-warning',
  manual: 'badge-info',
  absent: 'badge-error',
}

const PAGE_SIZE = 20

export default function AttendanceTable({ records = [], loading = false }) {
  const [page, setPage] = useState(1)
  const totalPages = Math.max(1, Math.ceil(records.length / PAGE_SIZE))
  const paged = records.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!records.length) {
    return (
      <div className="text-center py-16 text-slate-500">
        <p className="text-4xl mb-3">📋</p>
        <p className="font-medium">No attendance records found</p>
        <p className="text-sm mt-1">Try adjusting your filters</p>
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
              <th>Student</th>
              <th>ID</th>
              <th>Department</th>
              <th>Session</th>
              <th>Date</th>
              <th>Time</th>
              <th>Status</th>
              <th>Marked By</th>
            </tr>
          </thead>
          <tbody>
            {paged.map((rec, idx) => (
              <tr key={rec.id}>
                <td className="text-slate-500 tabular-nums">{(page - 1) * PAGE_SIZE + idx + 1}</td>
                <td className="font-medium text-slate-200">{rec.user_name}</td>
                <td className="font-mono text-xs text-slate-400">{rec.user_student_id || '—'}</td>
                <td className="text-slate-400">{rec.dept_name || '—'}</td>
                <td className="text-slate-400">{rec.session_name}</td>
                <td className="tabular-nums text-slate-400">
                  {rec.timestamp ? format(new Date(rec.timestamp), 'dd MMM yyyy') : '—'}
                </td>
                <td className="tabular-nums text-slate-400">
                  {rec.timestamp ? format(new Date(rec.timestamp), 'HH:mm:ss') : '—'}
                </td>
                <td>
                  <span className={STATUS_COLORS[rec.status] || 'badge-gray'}>
                    {rec.status}
                  </span>
                </td>
                <td className="text-slate-400 text-xs">{rec.marked_by}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <p className="text-slate-500">
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, records.length)} of {records.length}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="btn-secondary py-1.5 px-2.5"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="px-3 py-1.5 text-slate-300 font-medium">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="btn-secondary py-1.5 px-2.5"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
