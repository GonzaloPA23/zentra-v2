import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import api from '../utils/api';

const ACTION_BADGES = {
  CREATE: 'badge-green',
  UPDATE: 'badge-blue',
  STATUS_CHANGE: 'badge-yellow',
  DELETE: 'badge-red',
};

const ACTION_LABELS = {
  CREATE: 'Creacion',
  UPDATE: 'Edicion',
  STATUS_CHANGE: 'Estado',
  DELETE: 'Eliminacion',
};

function buildDetailText(row) {
  const detail = row.detalle_json;
  if (!detail) return row.descripcion || '-';

  if (detail.changes?.length) {
    const preview = detail.changes
      .slice(0, 3)
      .map((change) => `${change.field}: ${change.from ?? '-'} -> ${change.to ?? '-'}`)
      .join(' | ');

    return `${row.descripcion} (${detail.changes.length} cambio(s))${preview ? `: ${preview}` : ''}`;
  }

  return row.descripcion || '-';
}

export default function HistorialPage() {
  const [filters, setFilters] = useState({
    accion: '',
    registro_id: '',
    page: 1,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['auditoria-registros', filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });
      const res = await api.get(`/auditoria/registros?${params.toString()}`);
      return res.data;
    },
  });

  const rows = data?.datos ?? [];
  const pag = data?.paginacion ?? {};

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Historial</h1>
        <p className="text-sm text-gray-500 mt-1">
          Seguimiento de creaciones, ediciones y cambios de estado en registros
        </p>
      </div>

      <div className="card-sm">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="label">Accion</label>
            <select
              className="input"
              value={filters.accion}
              onChange={(e) => setFilters((prev) => ({ ...prev, accion: e.target.value, page: 1 }))}
            >
              <option value="">Todas</option>
              <option value="CREATE">Creacion</option>
              <option value="UPDATE">Edicion</option>
              <option value="STATUS_CHANGE">Cambio de estado</option>
              <option value="DELETE">Eliminacion</option>
            </select>
          </div>
          <div>
            <label className="label">Registro ID</label>
            <input
              type="number"
              min="1"
              className="input"
              value={filters.registro_id}
              onChange={(e) => setFilters((prev) => ({ ...prev, registro_id: e.target.value, page: 1 }))}
              placeholder="Ej: 3"
            />
          </div>
          <div className="md:col-span-2 flex items-end">
            <button
              className="btn-secondary w-full"
              onClick={() => setFilters({ accion: '', registro_id: '', page: 1 })}
            >
              Limpiar
            </button>
          </div>
        </div>
      </div>

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Usuario</th>
              <th>Accion</th>
              <th>Registro</th>
              <th>SKU</th>
              <th>Almacenes</th>
              <th>Detalle</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={7} className="text-center py-12 text-gray-400">
                  Cargando historial...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-12 text-gray-400">
                  No hay eventos para mostrar.
                </td>
              </tr>
            ) : rows.map((row) => {
              const detailText = buildDetailText(row);
              return (
                <tr key={row.id}>
                  <td className="whitespace-nowrap">
                    {row.created_at ? format(new Date(row.created_at), 'dd/MM/yyyy HH:mm') : '-'}
                  </td>
                  <td>{row.actor_nombre || 'Sistema'}</td>
                  <td>
                    <span className={ACTION_BADGES[row.accion] || 'badge-gray'}>
                      {ACTION_LABELS[row.accion] || row.accion}
                    </span>
                  </td>
                  <td>#{row.registro_id || '-'}</td>
                  <td className="max-w-[220px] truncate" title={row.sku_nombre || ''}>
                    {row.sku_nombre || '-'}
                  </td>
                  <td className="max-w-[220px] truncate" title={`${row.almacen_origen || '-'} -> ${row.almacen_destino || '-'}`}>
                    {row.almacen_origen || '-'} {'->'} {row.almacen_destino || '-'}
                  </td>
                  <td className="max-w-[420px] truncate" title={detailText}>
                    {detailText}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pag.pages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>{pag.total} eventos</span>
          <div className="flex items-center gap-1">
            <button
              className="btn-icon"
              disabled={filters.page <= 1}
              onClick={() => setFilters((prev) => ({ ...prev, page: prev.page - 1 }))}
            >
              <ChevronLeft size={16} />
            </button>
            <span className="px-3">Pag. {filters.page} / {pag.pages}</span>
            <button
              className="btn-icon"
              disabled={filters.page >= pag.pages}
              onClick={() => setFilters((prev) => ({ ...prev, page: prev.page + 1 }))}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
