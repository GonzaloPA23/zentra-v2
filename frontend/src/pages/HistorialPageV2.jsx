import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, FileSpreadsheet } from 'lucide-react';
import api, { getMensajeError } from '../utils/api';
import { toast } from 'react-toastify';
import SortableFilterHeader from '../components/SortableFilterHeader';
import { downloadBlobResponse } from '../utils/download';
import { formatSafeDate } from '../utils/date';

const ACTION_BADGES = {
  CREATE: 'badge-green',
  UPDATE: 'badge-blue',
  STATUS_CHANGE: 'badge-yellow',
  DELETE: 'badge-red',
};

const ACTION_LABELS = {
  CREATE: 'Creación',
  UPDATE: 'Edición',
  STATUS_CHANGE: 'Estado',
  DELETE: 'Eliminación',
};

const EMPTY_FILTERS = {
  accion: '',
  registro_id: '',
  q_usuario: '',
  q_sku: '',
  q_almacen: '',
  q_detalle: '',
  sort_by: 'fecha',
  sort_dir: 'desc',
  page: 1,
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

function nextSortState(current, key) {
  if (current.sort_by === key) {
    return { sort_by: key, sort_dir: current.sort_dir === 'asc' ? 'desc' : 'asc' };
  }

  return { sort_by: key, sort_dir: key === 'fecha' ? 'desc' : 'asc' };
}

export default function HistorialPageV2() {
  const [filters, setFilters] = useState(EMPTY_FILTERS);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['auditoria-registros', filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });
      const response = await api.get(`/auditoria/registros?${params.toString()}`);
      return response.data;
    },
  });

  const updateFilter = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value, page: 1 }));
  };

  const handleSort = (key) => {
    setFilters((prev) => ({ ...prev, ...nextSortState(prev, key), page: 1 }));
  };

  const handleExport = async () => {
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });
      const response = await api.get(`/auditoria/registros/export/excel?${params.toString()}`, {
        responseType: 'blob',
      });
      downloadBlobResponse(response, `zentra_historial_${Date.now()}.xlsx`);
    } catch (error) {
      toast.error(getMensajeError(error));
    }
  };

  const rows = Array.isArray(data?.datos) ? data.datos : [];
  const pag = data?.paginacion ?? {};
  const sortConfig = { key: filters.sort_by, direction: filters.sort_dir };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Historial</h1>
          <p className="text-sm text-gray-500 mt-1">
            Seguimiento de creaciones, ediciones y cambios de estado en registros
          </p>
        </div>
        <button className="btn-secondary btn-sm" onClick={handleExport}>
          <FileSpreadsheet size={14} /> Exportar Excel
        </button>
      </div>

      <div className="card-sm">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="label">Acción</label>
            <select
              className="input"
              value={filters.accion}
              onChange={(e) => updateFilter('accion', e.target.value)}
            >
              <option value="">Todas</option>
              <option value="CREATE">Creación</option>
              <option value="UPDATE">Edición</option>
              <option value="STATUS_CHANGE">Cambio de estado</option>
              <option value="DELETE">Eliminación</option>
            </select>
          </div>
          <div>
            <label className="label">Registro ID</label>
            <input
              type="number"
              min="1"
              className="input"
              value={filters.registro_id}
              onChange={(e) => updateFilter('registro_id', e.target.value)}
              placeholder="Ej: 3"
            />
          </div>
          <div className="md:col-span-2 flex items-end">
            <button className="btn-secondary w-full" onClick={() => setFilters(EMPTY_FILTERS)}>
              Limpiar filtros
            </button>
          </div>
        </div>
      </div>

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <SortableFilterHeader
                label="Fecha"
                sortKey="fecha"
                sortConfig={sortConfig}
                onSort={handleSort}
                filterType="none"
              />
              <SortableFilterHeader
                label="Usuario"
                sortKey="usuario"
                sortConfig={sortConfig}
                onSort={handleSort}
                filterValue={filters.q_usuario}
                onFilterChange={(value) => updateFilter('q_usuario', value)}
              />
              <SortableFilterHeader
                label="Acción"
                sortKey="accion"
                sortConfig={sortConfig}
                onSort={handleSort}
                filterType="none"
              />
              <SortableFilterHeader
                label="Registro"
                sortKey="registro"
                sortConfig={sortConfig}
                onSort={handleSort}
                filterType="none"
              />
              <SortableFilterHeader
                label="SKU"
                sortKey="sku"
                sortConfig={sortConfig}
                onSort={handleSort}
                filterValue={filters.q_sku}
                onFilterChange={(value) => updateFilter('q_sku', value)}
              />
              <SortableFilterHeader
                label="Almacenes"
                sortKey="almacen"
                sortConfig={sortConfig}
                onSort={handleSort}
                filterValue={filters.q_almacen}
                onFilterChange={(value) => updateFilter('q_almacen', value)}
              />
              <SortableFilterHeader
                label="Detalle"
                filterValue={filters.q_detalle}
                onFilterChange={(value) => updateFilter('q_detalle', value)}
              />
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
                    {formatSafeDate(row.created_at, 'dd/MM/yyyy HH:mm')}
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
                  <td className="max-w-[260px] truncate" title={`${row.almacen_origen || '-'} -> ${row.almacen_destino || '-'}`}>
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
          <span>{pag.total} eventos {isFetching && !isLoading ? '· Actualizando...' : ''}</span>
          <div className="flex items-center gap-1">
            <button
              className="btn-icon"
              disabled={filters.page <= 1}
              onClick={() => setFilters((prev) => ({ ...prev, page: prev.page - 1 }))}
            >
              <ChevronLeft size={16} />
            </button>
            <span className="px-3">Pág. {filters.page} / {pag.pages}</span>
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
