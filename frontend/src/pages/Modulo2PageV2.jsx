import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import {
  CheckCircle,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  FileSpreadsheet,
  Loader2,
  Pencil,
  Plus,
  Save,
  Truck,
  X,
  XCircle,
} from 'lucide-react';
import api, { getMensajeError } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import SortableFilterHeader from '../components/SortableFilterHeader';
import ConfirmDialog from '../components/ConfirmDialog';
import { downloadBlobResponse, getBlobErrorMessage } from '../utils/download';
import { formatSafeDate } from '../utils/date';

const TIPO_BADGE = {
  ENTRADA: 'badge-green',
  SALIDA: 'badge-red',
};

const EMPTY_TABLE_FILTERS = {
  q_almacen_origen: '',
  q_almacen_destino: '',
  q_categoria: '',
  q_tipo_accion: '',
  q_sku: '',
  q_nro_guia: '',
  q_zona: '',
  q_registrado_por: '',
  sort_by: 'fecha',
  sort_dir: 'desc',
};

function nextSortState(current, key) {
  if (current.sort_by === key) {
    return { sort_by: key, sort_dir: current.sort_dir === 'asc' ? 'desc' : 'asc' };
  }

  return { sort_by: key, sort_dir: key === 'fecha' ? 'desc' : 'asc' };
}

function DetalleExpandido({ row }) {
  return (
    <tr className="bg-blue-50/40">
      <td colSpan={12} className="px-4 py-4">
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-3 xl:grid-cols-6">
            <div>
              <span className="text-xs uppercase text-gray-500">ID registro</span>
              <p className="font-medium text-gray-900">{row.id}</p>
            </div>
            <div>
              <span className="text-xs uppercase text-gray-500">Acción</span>
              <p className="font-medium text-gray-900">{row.accion || '-'}</p>
            </div>
            <div>
              <span className="text-xs uppercase text-gray-500">Zona</span>
              <p className="font-medium text-gray-900">{row.zona || '-'}</p>
            </div>
            <div>
              <span className="text-xs uppercase text-gray-500">Ciudad</span>
              <p className="font-medium text-gray-900">{row.ciudad_nombre || '-'}</p>
            </div>
            <div>
              <span className="text-xs uppercase text-gray-500">Personal receptor</span>
              <p className="font-medium text-gray-900">{row.personal_receptor_nombre || '-'}</p>
            </div>
            <div>
              <span className="text-xs uppercase text-gray-500">Indicador</span>
              <p className="font-medium text-gray-900">{row.indicador_nombre || '-'}</p>
            </div>
            <div>
              <span className="text-xs uppercase text-gray-500">Observaciones</span>
              <p className="font-medium text-gray-900">{row.observaciones || '-'}</p>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white">
            <div className="border-b border-gray-200 px-4 py-3">
              <h4 className="font-semibold text-gray-800">Líneas</h4>
            </div>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Tipo Mercadería</th>
                    <th>SKU</th>
                    <th>Lote</th>
                    <th>F. Vencimiento</th>
                    <th>Cantidad</th>
                  </tr>
                </thead>
                <tbody>
                  {(row.detalles || []).map((detail, index) => (
                    <tr key={`${row.id}-${detail.id || index}`}>
                      <td>{index + 1}</td>
                      <td>{detail.tipo_mercaderia_nombre || '-'}</td>
                      <td className="max-w-[280px] truncate" title={detail.sku_nombre || ''}>{detail.sku_nombre || '-'}</td>
                      <td>{detail.codigo_lote || '-'}</td>
                      <td>{formatSafeDate(detail.fecha_vencimiento)}</td>
                      <td>{Number(detail.cantidad || 0).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {row.foto_guia && (
            <div>
              <a
                href={`/uploads/${row.foto_guia}`}
                target="_blank"
                rel="noreferrer"
                className="btn-secondary btn-sm inline-flex"
              >
                Ver archivo guía
              </a>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

function parseFlag(value) {
  return value === true || value === 1 || value === '1';
}

function ApprovalDetailLine({ detail, index, value, onChange, almacenOrigenId }) {
  const [newLote, setNewLote] = useState({ codigo_lote: '', fecha_vencimiento: '' });
  const [creating, setCreating] = useState(false);
  const skuManejaLote = parseFlag(detail.tiene_lote);
  const skuManejaVencimiento = parseFlag(detail.tiene_vencimiento);
  const { data: lotes = [], refetch } = useQuery({
    queryKey: ['aprobacion-lotes', detail.sku_id, almacenOrigenId || ''],
    queryFn: () => {
      const params = new URLSearchParams({ sku_id: detail.sku_id });
      if (almacenOrigenId) params.set('almacen_id', almacenOrigenId);
      return api.get(`/catalogos/lotes?${params.toString()}`).then((response) => response.data.datos || []);
    },
    enabled: !!detail.sku_id && !!almacenOrigenId && skuManejaLote,
  });

  const handleCreateLote = async () => {
    if (!skuManejaLote) return;
    if (!newLote.codigo_lote.trim() || (skuManejaVencimiento && !newLote.fecha_vencimiento)) {
      toast.error(skuManejaVencimiento ? 'El lote nuevo requiere codigo y fecha de vencimiento' : 'El lote nuevo requiere codigo');
      return;
    }
    setCreating(true);
    try {
      const response = await api.post('/catalogos/lotes', {
        sku_id: detail.sku_id,
        codigo_lote: newLote.codigo_lote.trim(),
        fecha_vencimiento: newLote.fecha_vencimiento || null,
      });
      await refetch();
      onChange(index, {
        ...value,
        lote_id: String(response.data?.datos?.id || response.data?.id || ''),
        fecha_vencimiento: newLote.fecha_vencimiento || '',
      });
      setNewLote({ codigo_lote: '', fecha_vencimiento: '' });
      toast.success('Lote creado');
    } catch (error) {
      toast.error(getMensajeError(error));
    } finally {
      setCreating(false);
    }
  };

  const selectedLote = lotes.find((lote) => String(lote.id) === String(value.lote_id));

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
      <div className="mb-3 grid grid-cols-1 gap-2 text-sm md:grid-cols-3">
        <div>
          <span className="text-xs uppercase text-gray-500">Tipo Mercaderia</span>
          <p className="font-medium text-gray-900">{detail.tipo_mercaderia_nombre || '-'}</p>
        </div>
        <div className="md:col-span-2">
          <span className="text-xs uppercase text-gray-500">SKU</span>
          <p className="font-medium text-gray-900">{detail.sku_nombre || '-'}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        {skuManejaLote ? <div>
          <label className="label">Lote</label>
          <select
            className="input"
            value={value.lote_id || ''}
            onChange={(event) => {
              const lote = lotes.find((item) => String(item.id) === event.target.value);
              onChange(index, {
                ...value,
                lote_id: event.target.value,
                fecha_vencimiento: lote?.fecha_vencimiento?.slice(0, 10) || '',
              });
            }}
          >
            <option value="">Seleccionar lote</option>
            {lotes.map((lote) => (
              <option key={lote.id} value={lote.id}>
                {lote.codigo_lote} {lote.fecha_vencimiento ? `- vence ${lote.fecha_vencimiento.slice(0, 10)}` : ''}
              </option>
            ))}
          </select>
        </div> : null}
        {skuManejaLote ? <div>
          <label className="label">Fecha vencimiento</label>
          <input
            type="date"
            className="input"
            value={value.fecha_vencimiento || ''}
            readOnly
            disabled
            title={selectedLote ? 'Fecha asociada al lote seleccionado' : 'Crea o selecciona un lote con vencimiento'}
          />
        </div> : null}
        <div>
          <label className="label">Cantidad</label>
          <input
            type="number"
            min="1"
            step="1"
            className="input"
            value={value.cantidad || ''}
            onChange={(event) => onChange(index, { ...value, cantidad: event.target.value })}
          />
        </div>
      </div>

      {skuManejaLote ? <div className="mt-3 grid grid-cols-1 gap-3 border-t border-gray-200 pt-3 md:grid-cols-[1fr_180px_auto]">
        <input
          className="input"
          placeholder="Codigo de lote nuevo"
          value={newLote.codigo_lote}
          onChange={(event) => setNewLote((prev) => ({ ...prev, codigo_lote: event.target.value }))}
        />
        <input
          type="date"
          className="input"
          value={newLote.fecha_vencimiento}
          onChange={(event) => setNewLote((prev) => ({ ...prev, fecha_vencimiento: event.target.value }))}
        />
        <button type="button" className="btn-secondary btn-sm" onClick={handleCreateLote} disabled={creating}>
          {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Crear lote
        </button>
      </div> : (
        <p className="mt-3 rounded-lg bg-white px-3 py-2 text-xs text-gray-500">
          Este SKU no maneja lote ni fecha de vencimiento; solo se modifica la cantidad.
        </p>
      )}
    </div>
  );
}

function ApprovalEditModal({ row, onClose, onSave, loading }) {
  const [fecha, setFecha] = useState(row.fecha ? String(row.fecha).slice(0, 10) : '');
  const [detalles, setDetalles] = useState(() => (row.detalles || []).map((detail) => ({
    tipo_mercaderia_id: detail.tipo_mercaderia_id,
    sku_id: detail.sku_id,
    lote_id: detail.lote_id ? String(detail.lote_id) : '',
    fecha_vencimiento: detail.fecha_vencimiento ? String(detail.fecha_vencimiento).slice(0, 10) : '',
    cantidad: Math.trunc(Number(detail.cantidad || 0)) || '',
  })));

  const updateDetail = (index, nextValue) => {
    setDetalles((prev) => prev.map((item, itemIndex) => (itemIndex === index ? nextValue : item)));
  };

  const handleSubmit = () => {
    if (!fecha) {
      toast.error('La fecha es obligatoria');
      return;
    }
    const invalidLine = detalles.find((detail, index) => {
      const original = row.detalles?.[index] || {};
      const requiresLote = parseFlag(original.tiene_lote);
      const requiresVencimiento = parseFlag(original.tiene_vencimiento);
      return (
        (requiresLote && !detail.lote_id) ||
        (requiresLote && requiresVencimiento && !detail.fecha_vencimiento) ||
        !Number.isInteger(Number(detail.cantidad)) ||
        Number(detail.cantidad) <= 0
      );
    });
    if (invalidLine) {
      toast.error('Revisa las lineas: lote/vencimiento solo aplica a SKUs que lo manejan, y la cantidad debe ser entera mayor a 0');
      return;
    }
    onSave(row.id, { fecha, detalles });
  };

  return (
    <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal-box max-w-5xl">
        <div className="modal-header">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Editar antes de aprobar</h2>
            <p className="text-xs text-gray-500">Registro #{row.id} - {row.nro_guia || 'sin guia'}</p>
          </div>
          <button type="button" className="btn-icon text-gray-400" onClick={onClose} disabled={loading}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body space-y-4">
          <div className="max-w-xs">
            <label className="label">Fecha</label>
            <input type="date" className="input" value={fecha} onChange={(event) => setFecha(event.target.value)} />
          </div>
          {(row.detalles || []).map((detail, index) => (
            <ApprovalDetailLine
              key={detail.id || index}
              detail={detail}
              index={index}
              value={detalles[index]}
              onChange={updateDetail}
              almacenOrigenId={row.almacen_origen_id}
            />
          ))}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={loading}>Cancelar</button>
          <button type="button" className="btn-primary" onClick={handleSubmit} disabled={loading}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Guardar cambios
          </button>
        </div>
      </div>
    </div>
  );
}

function RegistroRow({ row, expanded, onToggle, canManageStates, onAprobar, onRechazar, onEnCamino, onEditApproval, loading }) {
  return (
    <>
      <tr className="cursor-pointer" onClick={() => onToggle(row.id)}>
        <td><span className="badge-gray badge">{row.zona || '-'}</span></td>
        <td className="font-semibold text-gray-900">{row.id}</td>
        <td className="whitespace-nowrap font-medium">{formatSafeDate(row.fecha)}</td>
        <td className="max-w-[180px] truncate" title={row.almacen_origen || ''}>{row.almacen_origen || '-'}</td>
        <td className="max-w-[180px] truncate" title={row.almacen_destino || ''}>{row.almacen_destino || '-'}</td>
        <td>{row.categoria_nombre || '-'}</td>
        <td><span className={TIPO_BADGE[row.tipo_accion] || 'badge-gray'}>{row.tipo_accion || '-'}</span></td>
        <td className="max-w-[240px] truncate" title={row.sku_resumen || ''}>{row.sku_resumen || '-'}</td>
        <td className="font-semibold">{Number(row.cantidad_total || 0).toLocaleString()}</td>
        <td>{row.nro_guia || '-'}</td>
        <td className="text-xs text-gray-500">{row.registrado_por || '-'}</td>
        <td>
          <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
            {canManageStates && row.estado === 'pendiente' && (
              <button
                type="button"
                title="Marcar en camino"
                disabled={loading}
                className="btn-icon text-blue-500 hover:bg-blue-50"
                onClick={() => onEnCamino(row.id)}
              >
                <Truck size={15} />
              </button>
            )}
            {canManageStates && (row.estado === 'pendiente' || row.estado === 'en_transito') && (
              <>
                <button
                  type="button"
                  title="Editar antes de aprobar"
                  disabled={loading}
                  className="btn-icon text-amber-600 hover:bg-amber-50"
                  onClick={() => onEditApproval(row)}
                >
                  <Pencil size={15} />
                </button>
                <button
                  type="button"
                  title="Aprobar"
                  disabled={loading}
                  className="btn-icon text-green-600 hover:bg-green-50"
                  onClick={() => onAprobar(row.id)}
                >
                  <CheckCircle size={15} />
                </button>
                <button
                  type="button"
                  title="Rechazar"
                  disabled={loading}
                  className="btn-icon text-red-500 hover:bg-red-50"
                  onClick={() => onRechazar(row.id)}
                >
                  <XCircle size={15} />
                </button>
              </>
            )}
            <button type="button" className="btn-icon text-gray-400" onClick={() => onToggle(row.id)}>
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </div>
        </td>
      </tr>
      {expanded && <DetalleExpandido row={row} />}
    </>
  );
}

function TablaModulo({
  titulo,
  icono: Icono,
  color,
  registros,
  isLoading,
  filters,
  onFilterChange,
  onSort,
  onExport,
  canDownload,
  canManageStates,
  onAprobar,
  onRechazar,
  onEnCamino,
  onEditApproval,
  mutLoading,
}) {
  const [expandedId, setExpandedId] = useState(null);
  const sortConfig = { key: filters.sort_by, direction: filters.sort_dir };

  return (
    <div className="card overflow-hidden p-0">
      <div className={`flex flex-col gap-3 border-b border-gray-200 px-5 py-4 ${color} md:flex-row md:items-center md:justify-between`}>
        <div className="flex items-center gap-3">
          <Icono size={20} />
          <div>
            <h2 className="font-semibold text-gray-900">{titulo}</h2>
            <p className="text-xs text-gray-500">{registros.length} registro(s)</p>
          </div>
        </div>
        {canDownload && (
          <button type="button" className="btn-secondary btn-sm" onClick={onExport}>
            <FileSpreadsheet size={14} /> Exportar Excel
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <SortableFilterHeader
                label="Zona"
                sortConfig={sortConfig}
                filterValue={filters.q_zona}
                onFilterChange={(value) => onFilterChange('q_zona', value)}
                placeholder="Todas"
                options={[
                  { value: 'LIMA', label: 'LIMA' },
                  { value: 'PROVINCIA', label: 'PROVINCIA' },
                ]}
              />
              <SortableFilterHeader label="ID" filterType="none" />
              <SortableFilterHeader
                label="Fecha"
                sortKey="fecha"
                sortConfig={sortConfig}
                onSort={onSort}
                filterType="none"
              />
              <SortableFilterHeader
                label="Almacén Origen"
                sortKey="almacen_origen"
                sortConfig={sortConfig}
                onSort={onSort}
                filterValue={filters.q_almacen_origen}
                onFilterChange={(value) => onFilterChange('q_almacen_origen', value)}
              />
              <SortableFilterHeader
                label="Almacén Destino"
                sortKey="almacen_destino"
                sortConfig={sortConfig}
                onSort={onSort}
                filterValue={filters.q_almacen_destino}
                onFilterChange={(value) => onFilterChange('q_almacen_destino', value)}
              />
              <SortableFilterHeader
                label="Categoría"
                sortKey="categoria"
                sortConfig={sortConfig}
                onSort={onSort}
                filterValue={filters.q_categoria}
                onFilterChange={(value) => onFilterChange('q_categoria', value)}
              />
              <SortableFilterHeader
                label="Tipo Acción"
                sortKey="tipo_accion"
                sortConfig={sortConfig}
                onSort={onSort}
                filterValue={filters.q_tipo_accion}
                onFilterChange={(value) => onFilterChange('q_tipo_accion', value)}
              />
              <SortableFilterHeader
                label="SKU(s)"
                sortKey="sku"
                sortConfig={sortConfig}
                onSort={onSort}
                filterValue={filters.q_sku}
                onFilterChange={(value) => onFilterChange('q_sku', value)}
              />
              <SortableFilterHeader
                label="Cantidad"
                sortKey="cantidad"
                sortConfig={sortConfig}
                onSort={onSort}
                filterType="none"
              />
              <SortableFilterHeader
                label="Nro. Guía"
                sortKey="nro_guia"
                sortConfig={sortConfig}
                onSort={onSort}
                filterValue={filters.q_nro_guia}
                onFilterChange={(value) => onFilterChange('q_nro_guia', value)}
              />
              <SortableFilterHeader
                label="Registrado por"
                sortKey="registrado_por"
                sortConfig={sortConfig}
                onSort={onSort}
                filterValue={filters.q_registrado_por}
                onFilterChange={(value) => onFilterChange('q_registrado_por', value)}
              />
              <SortableFilterHeader label="Acciones" filterType="none" />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={12} className="py-10 text-center text-gray-400">
                  <div className="flex items-center justify-center gap-2">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-400 border-t-transparent" />
                    Cargando...
                  </div>
                </td>
              </tr>
            ) : registros.length === 0 ? (
              <tr>
                <td colSpan={12} className="py-10 text-center text-gray-400">
                  No hay registros en esta sección.
                </td>
              </tr>
            ) : registros.map((row) => (
              <RegistroRow
                key={row.id}
                row={row}
                expanded={expandedId === row.id}
                onToggle={(registroId) => setExpandedId((prev) => prev === registroId ? null : registroId)}
                canManageStates={canManageStates}
                onAprobar={onAprobar}
                onRechazar={onRechazar}
                onEnCamino={onEnCamino}
                onEditApproval={onEditApproval}
                loading={mutLoading}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Modulo2PageV2() {
  const { hasRole } = useAuth();
  const queryClient = useQueryClient();
  const [pendientesFilters, setPendientesFilters] = useState(EMPTY_TABLE_FILTERS);
  const [transitoFilters, setTransitoFilters] = useState(EMPTY_TABLE_FILTERS);
  const [editingApprovalRow, setEditingApprovalRow] = useState(null);
  const [approvalToConfirm, setApprovalToConfirm] = useState(null);

  const canDownload = hasRole('superadmin', 'admin', 'supervisor');
  const canManageStates = hasRole('superadmin', 'admin', 'almacenero');

  const fetchRegistros = (estado, filters) => {
    const params = new URLSearchParams({ estado, limit: '200' });
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    return api.get(`/registros?${params.toString()}`).then((response) => (
      Array.isArray(response.data.datos) ? response.data.datos : []
    ));
  };

  const { data: pendientes = [], isLoading: loadPendientes } = useQuery({
    queryKey: ['registros', 'modulo2', 'pendientes', pendientesFilters],
    queryFn: () => fetchRegistros('pendiente', pendientesFilters),
    refetchInterval: 30_000,
  });

  const { data: enTransito = [], isLoading: loadTransito } = useQuery({
    queryKey: ['registros', 'modulo2', 'transito', transitoFilters],
    queryFn: () => fetchRegistros('en_transito', transitoFilters),
    refetchInterval: 30_000,
  });

  const estadoMutation = useMutation({
    mutationFn: ({ id, estado }) => api.patch(`/registros/${id}/estado`, { estado }),
    onSuccess: (_, { estado }) => {
      queryClient.invalidateQueries({ queryKey: ['registros'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['auditoria-registros'] });

      const messages = {
        aprobado: 'Registro aprobado',
        rechazado: 'Registro rechazado',
        en_transito: 'Marcado como en camino',
      };
      toast.success(messages[estado] || 'Estado actualizado');
      if (estado === 'aprobado') setApprovalToConfirm(null);
    },
    onError: (error) => toast.error(getMensajeError(error)),
  });

  const requestApproval = (id) => {
    setApprovalToConfirm(id);
  };

  const confirmApproval = () => {
    if (!approvalToConfirm) return;
    estadoMutation.mutate({ id: approvalToConfirm, estado: 'aprobado' });
  };

  const approvalEditMutation = useMutation({
    mutationFn: ({ id, payload }) => api.patch(`/registros/${id}/aprobacion-detalles`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['registros'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['auditoria-registros'] });
      setEditingApprovalRow(null);
      toast.success('Detalle actualizado');
    },
    onError: (error) => toast.error(getMensajeError(error)),
  });

  const exportSection = async (estado, filters, fallbackName) => {
    try {
      const params = new URLSearchParams({ estado });
      Object.entries(filters).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });

      const response = await api.get(`/registros/export/excel?${params.toString()}`, {
        responseType: 'blob',
      });
      await downloadBlobResponse(response, fallbackName);
    } catch (error) {
      toast.error(await getBlobErrorMessage(error));
    }
  };

  const statsCards = [
    { label: 'Pendientes de aprobación', value: pendientes.length, color: 'bg-yellow-500', dot: 'bg-yellow-400' },
    { label: 'Guías en camino', value: enTransito.length, color: 'bg-blue-500', dot: 'bg-blue-400' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Control de Tránsito y Aprobaciones</h1>
        <p className="mt-1 text-sm text-gray-500">
          Los descargables usan exactamente el mismo dataset filtrado que ves en pantalla.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {statsCards.map((stat, index) => (
          <div key={stat.label} className="stat-card">
            <div className={`stat-icon ${stat.color}`}>
              {index === 0 ? <ClipboardCheck size={22} className="text-white" /> : <Truck size={22} className="text-white" />}
            </div>
            <div>
              <p className="text-3xl font-bold text-gray-900">{stat.value}</p>
              <p className="text-sm text-gray-500">{stat.label}</p>
            </div>
            {stat.value > 0 && (
              <div className="ml-auto">
                <span className={`inline-block h-3 w-3 rounded-full ${stat.dot} animate-pulse`} />
              </div>
            )}
          </div>
        ))}
      </div>

      <TablaModulo
        titulo="Visibilidad de Guías en Camino"
        icono={Truck}
        color="bg-blue-50"
        registros={enTransito}
        isLoading={loadTransito}
        filters={transitoFilters}
        onFilterChange={(key, value) => setTransitoFilters((prev) => ({ ...prev, [key]: value }))}
        onSort={(key) => setTransitoFilters((prev) => ({ ...prev, ...nextSortState(prev, key) }))}
        onExport={() => exportSection('en_transito', transitoFilters, `zentra_guias_en_camino_${Date.now()}.xlsx`)}
        canDownload={canDownload}
        canManageStates={canManageStates}
        onAprobar={requestApproval}
        onRechazar={(id) => estadoMutation.mutate({ id, estado: 'rechazado' })}
        onEnCamino={(id) => estadoMutation.mutate({ id, estado: 'en_transito' })}
        onEditApproval={setEditingApprovalRow}
        mutLoading={estadoMutation.isPending || approvalEditMutation.isPending}
      />

      <TablaModulo
        titulo="Cuadro de Aprobación de Ingresos"
        icono={ClipboardCheck}
        color="bg-yellow-50"
        registros={pendientes}
        isLoading={loadPendientes}
        filters={pendientesFilters}
        onFilterChange={(key, value) => setPendientesFilters((prev) => ({ ...prev, [key]: value }))}
        onSort={(key) => setPendientesFilters((prev) => ({ ...prev, ...nextSortState(prev, key) }))}
        onExport={() => exportSection('pendiente', pendientesFilters, `zentra_aprobacion_ingresos_${Date.now()}.xlsx`)}
        canDownload={canDownload}
        canManageStates={canManageStates}
        onAprobar={requestApproval}
        onRechazar={(id) => estadoMutation.mutate({ id, estado: 'rechazado' })}
        onEnCamino={(id) => estadoMutation.mutate({ id, estado: 'en_transito' })}
        onEditApproval={setEditingApprovalRow}
        mutLoading={estadoMutation.isPending || approvalEditMutation.isPending}
      />

      <p className="text-center text-xs text-gray-400">
        Se actualiza automáticamente cada 30 segundos · Haz clic en una fila para ver el detalle completo
      </p>

      {editingApprovalRow && (
        <ApprovalEditModal
          row={editingApprovalRow}
          onClose={() => setEditingApprovalRow(null)}
          onSave={(id, payload) => approvalEditMutation.mutate({ id, payload })}
          loading={approvalEditMutation.isPending}
        />
      )}

      <ConfirmDialog
        open={!!approvalToConfirm}
        onClose={() => !estadoMutation.isPending && setApprovalToConfirm(null)}
        onConfirm={confirmApproval}
        title="Confirmar aprobación"
        message="Estás por aprobar este registro. Al confirmar se actualizará el estado y el impacto correspondiente en stock."
        loading={estadoMutation.isPending}
        confirmLabel="Sí, aprobar"
        loadingLabel="Aprobando..."
        confirmClassName="btn-primary"
      />
    </div>
  );
}
