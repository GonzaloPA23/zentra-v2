import Modal from './Modal';
import { AlertTriangle } from 'lucide-react';

export default function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title = '¿Estás seguro?',
  message,
  loading,
  confirmLabel = 'Sí, eliminar',
  loadingLabel = 'Eliminando...',
  confirmClassName = 'btn-danger',
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <div className="modal-body">
        <div className="flex gap-4">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-red-100">
            <AlertTriangle size={18} className="text-red-600" />
          </div>
          <p className="pt-2 text-sm text-gray-600">{message || 'Esta acción no se puede deshacer.'}</p>
        </div>
      </div>
      <div className="modal-footer">
        <button onClick={onClose} className="btn-secondary" disabled={loading}>Cancelar</button>
        <button onClick={onConfirm} className={confirmClassName} disabled={loading}>
          {loading ? loadingLabel : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
