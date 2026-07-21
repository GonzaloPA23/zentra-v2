import { useEffect, useMemo, useState } from 'react';
import { Download, FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import { toast } from 'react-toastify';
import Modal from './Modal';
import api, { getMensajeError } from '../utils/api';
import { downloadBlobResponse, getBlobErrorMessage } from '../utils/download';

function buildDefaultSuccessMessage(title, summary = {}) {
  const counts = Object.entries(summary || {})
    .filter(([key, value]) => key !== 'filas_procesadas' && Number(value) > 0)
    .map(([key, value]) => `${value} ${String(key).replace(/_/g, ' ')}`);

  const base = Number(summary?.filas_procesadas || 0);
  if (!base) {
    return `${title} completada correctamente`;
  }

  return counts.length
    ? `${title} completada: ${base} filas procesadas, ${counts.join(', ')}.`
    : `${title} completada: ${base} filas procesadas.`;
}

export default function ExcelBulkUploadModal({
  open,
  onClose,
  title,
  description,
  templateEndpoint,
  importEndpoint,
  templateFileName = `plantilla_${Date.now()}.xlsx`,
  submitLabel = 'Procesar Excel',
  helpItems = [],
  onSuccess,
  buildSuccessMessage,
}) {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!open) {
      setFile(null);
      setUploading(false);
      setDownloading(false);
    }
  }, [open]);

  const selectedFileName = useMemo(() => file?.name || '', [file]);

  const handleDownloadTemplate = async () => {
    setDownloading(true);
    try {
      const response = await api.get(templateEndpoint, { responseType: 'blob' });
      await downloadBlobResponse(response, templateFileName);
    } catch (error) {
      toast.error(await getBlobErrorMessage(error, 'No se pudo descargar la plantilla'));
    } finally {
      setDownloading(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!file) {
      toast.error('Selecciona un archivo Excel .xlsx');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);

    setUploading(true);
    try {
      const response = await api.post(importEndpoint, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000,
      });

      const summary = response.data?.datos || {};
      const message = buildSuccessMessage
        ? buildSuccessMessage(summary, response.data)
        : buildDefaultSuccessMessage(title, summary);

      toast.success(message);
      await onSuccess?.(response.data);
      onClose?.();
    } catch (error) {
      toast.error(getMensajeError(error));
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal open={open} onClose={() => !uploading && onClose?.()} title={title} size="lg">
      <form onSubmit={handleSubmit}>
        <div className="modal-body space-y-4">
          <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
            {description}
          </div>

          {helpItems.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
              <p className="text-sm font-medium text-gray-800">Antes de importar</p>
              <ul className="mt-2 space-y-1 text-sm text-gray-600">
                {helpItems.map((item) => (
                  <li key={item}>- {item}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-medium text-gray-800">Plantilla Excel</p>
                <p className="mt-1 text-xs text-gray-500">
                  Descarga la plantilla desde aquí mismo. Incluye instrucciones y hojas de referencia.
                </p>
              </div>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={handleDownloadTemplate}
                disabled={downloading || uploading}
              >
                {downloading ? <><Loader2 size={14} className="animate-spin" /> Descargando...</> : <><Download size={14} /> Descargar plantilla</>}
              </button>
            </div>
          </div>

          <div>
            <label className="label">Archivo Excel <span className="text-red-500">*</span></label>
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-gray-300 bg-white px-4 py-3 transition hover:border-gray-400">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-800">
                  {selectedFileName || 'Seleccionar archivo .xlsx'}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  Solo se acepta formato Excel `.xlsx`
                </p>
              </div>
              <span className="btn-secondary btn-sm">
                <FileSpreadsheet size={14} /> Elegir
              </span>
              <input
                type="file"
                accept=".xlsx,.xlsm"
                className="hidden"
                disabled={uploading}
                onChange={(event) => setFile(event.target.files?.[0] || null)}
              />
            </label>
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={uploading}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary" disabled={uploading}>
            {uploading ? <><Loader2 size={14} className="animate-spin" /> Procesando...</> : <><Upload size={14} /> {submitLabel}</>}
          </button>
        </div>
      </form>
    </Modal>
  );
}
