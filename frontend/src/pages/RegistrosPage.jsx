import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api, { getMensajeError } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-toastify';
import { Plus, Download, Pencil, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import ConfirmDialog from '../components/ConfirmDialog';
import { format } from 'date-fns';

const ESTADOS = { pendiente: 'badge-yellow', en_transito: 'badge-blue', aprobado: 'badge-green', rechazado: 'badge-red' };
const LABELS  = { pendiente: 'Pendiente', en_transito: 'En Tránsito', aprobado: 'Aprobado', rechazado: 'Rechazado' };

export default function RegistrosPage() {
  const { hasRole } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [filters, setFilters] = useState({ fecha_ini: '', fecha_fin: '', estado: '', page: 1 });
  const [deleting, setDeleting] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['registros', filters],
    queryFn: () => {
      const p = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => { if (v) p.set(k, v); });
      return api.get(`/registros?${p}`).then(r => r.data);
    },
  });

  const mutDel = useMutation({
    mutationFn: (id) => api.delete(`/registros/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['registros'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Registro eliminado');
      setDeleting(null);
    },
    onError: (e) => { toast.error(getMensajeError(e)); setDeleting(null); },
  });

  const handleExport = async () => {
    try {
      const p = new URLSearchParams({ fecha_ini: filters.fecha_ini, fecha_fin: filters.fecha_fin });
      const res = await api.get(`/registros/export/csv?${p}`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url; a.download = `zentra_registros_${Date.now()}.csv`;
      a.click(); URL.revokeObjectURL(url);
    } catch { toast.error('Error al exportar'); }
  };

  const rows = data?.datos ?? [];
  const pag = data?.paginacion ?? {};

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Registros</h1>
          <p className="text-sm text-gray-500 mt-1">Módulo 1 · Gestión de movimientos</p>
        </div>
        <div className="flex gap-2">
          {hasRole('superadmin','admin','supervisor') && (
            <button onClick={handleExport} className="btn-secondary btn-sm">
              <Download size={14} /> Exportar CSV
            </button>
          )}
          <button onClick={() => navigate('/registros/nuevo')} className="btn-primary btn-sm">
            <Plus size={14} /> Nuevo Registro
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="card-sm">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="label">Fecha inicio</label>
            <input type="date" className="input" value={filters.fecha_ini}
              onChange={(e) => setFilters({ ...filters, fecha_ini: e.target.value, page: 1 })} />
          </div>
          <div>
            <label className="label">Fecha fin</label>
            <input type="date" className="input" value={filters.fecha_fin}
              onChange={(e) => setFilters({ ...filters, fecha_fin: e.target.value, page: 1 })} />
          </div>
          <div>
            <label className="label">Estado</label>
            <select className="input" value={filters.estado}
              onChange={(e) => setFilters({ ...filters, estado: e.target.value, page: 1 })}>
              <option value="">Todos</option>
              <option value="pendiente">Pendiente</option>
              <option value="en_transito">En Tránsito</option>
              <option value="aprobado">Aprobado</option>
              <option value="rechazado">Rechazado</option>
            </select>
          </div>
          <div className="flex items-end">
            <button className="btn-secondary w-full" onClick={() => setFilters({ fecha_ini:'', fecha_fin:'', estado:'', page:1 })}>
              Limpiar
            </button>
          </div>
        </div>
      </div>

      {/* Tabla */}
      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Almacén Origen</th>
              <th>Categoría</th>
              <th>Tipo Acción</th>
              <th>SKU</th>
              <th>Cantidad</th>
              <th>Estado</th>
              <th>Registrado por</th>
              <th width="120">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={9} className="text-center py-12 text-gray-400">
                <div className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-primary-400 border-t-transparent rounded-full animate-spin" />
                  Cargando registros...
                </div>
              </td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={9} className="text-center py-12 text-gray-400">Sin registros para mostrar.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap">{r.fecha ? format(new Date(r.fecha), 'dd/MM/yyyy') : '—'}</td>
                <td className="max-w-[160px] truncate" title={r.almacen_origen}>{r.almacen_origen}</td>
                <td>{r.categoria_nombre}</td>
                <td>
                  <span className="badge-gray badge">{r.tipo_accion}</span>
                </td>
                <td className="max-w-[180px] truncate" title={r.sku_nombre}>{r.sku_nombre}</td>
                <td className="font-medium">{parseFloat(r.cantidad).toLocaleString()}</td>
                <td>
                  <span className={ESTADOS[r.estado] || 'badge-gray'}>{LABELS[r.estado] || r.estado}</span>
                </td>
                <td className="text-xs text-gray-500">{r.registrado_por}</td>
                <td>
                  <div className="flex items-center gap-1">
                    {hasRole('superadmin','admin','supervisor') && (
                      <button title="Editar" className="btn-icon text-blue-500"
                        onClick={() => navigate(`/registros/${r.id}/editar`)}>
                        <Pencil size={14} />
                      </button>
                    )}
                    {hasRole('superadmin','admin') && (
                      <button title="Eliminar" className="btn-icon text-red-500"
                        onClick={() => setDeleting(r)}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Paginación */}
      {pag.pages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>{pag.total} registros totales</span>
          <div className="flex items-center gap-1">
            <button className="btn-icon" disabled={filters.page <= 1}
              onClick={() => setFilters(f => ({ ...f, page: f.page - 1 }))}>
              <ChevronLeft size={16} />
            </button>
            <span className="px-3">Pág. {filters.page} / {pag.pages}</span>
            <button className="btn-icon" disabled={filters.page >= pag.pages}
              onClick={() => setFilters(f => ({ ...f, page: f.page + 1 }))}>
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => mutDel.mutate(deleting?.id)}
        loading={mutDel.isPending}
        title="Eliminar Registro"
        message={`¿Eliminar el registro de "${deleting?.sku_nombre}"? Esta acción no se puede deshacer.`}
      />
    </div>
  );
}
