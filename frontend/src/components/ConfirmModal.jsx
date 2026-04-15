import { AlertTriangle, X } from 'lucide-react'

export default function ConfirmModal({ title, message, onConfirm, onCancel, confirmLabel = 'Delete', danger = true }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onCancel}
      />
      {/* Modal */}
      <div className="relative card max-w-md w-full animate-slide-up shadow-2xl">
        <div className="flex items-start gap-4">
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${danger ? 'bg-rose-500/15 text-rose-400' : 'bg-amber-500/15 text-amber-400'}`}>
            <AlertTriangle size={22} />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-bold text-slate-100">{title}</h3>
            <p className="text-sm text-slate-400 mt-1">{message}</p>
          </div>
          <button onClick={onCancel} className="btn-icon">
            <X size={16} />
          </button>
        </div>
        <div className="flex gap-3 mt-6 justify-end">
          <button id="confirm-cancel" onClick={onCancel} className="btn-secondary">
            Cancel
          </button>
          <button
            id="confirm-action"
            onClick={onConfirm}
            className={danger ? 'btn bg-rose-600 hover:bg-rose-500 text-white' : 'btn-primary'}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
