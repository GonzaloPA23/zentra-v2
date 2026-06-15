import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import api, { getMensajeError } from '../utils/api';
import { CheckCircle, XCircle, Truck, ClipboardCheck, Eye, ChevronDown, ChevronUp } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

const TIPO_BADGE = {
  ENTRADA: 'badge-green', SALIDA: 'badge-red', CANJES: 'badge-blue',
  'DEGUSTACIÓN': 'badge-purple', CRUCERISMO: 'badge-yellow',
  MERCADERISMO: 'badge-gray', ACTIVOS: 'badge-gray',
};

function RegistroRow({ r, onAprobar, onRechazar, onEnCamino, loading }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr className="cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <td className="whitespace-nowrap font-medium">
          {r.fecha ? format(new Date(r.fecha), 'dd/MM/yyyy') : '—'}
        </td>
        <td className="max-w-[150px] truncate" title={r.almacen_origen}>{r.almacen_origen}</td>
        <td className="max-w-[150px] truncate" title={r.almacen_destino}>{r.almacen_destino || '—'}</td>
        <td>{r.categoria_nombre}</td>
        <td><span className={TIPO_BADGE[r.tipo_accion] || 'badge-gray'}>{r.tipo_accion}</span></td>
        <td className="max-w-[180px] truncate" title={r.sku_nombre}>{r.sku_nombre}</td>
        <td className="font-semibold">{parseFloat(r.cantidad).toLocaleString()}</td>
        <td>{r.nro_guia || '—'}</td>
        <td className="text-xs text-gray-500">{r.registrado_por}</td>
        <td>
          <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
            {r.estado === 'pendiente' && (
              <button title="Marcar En Camino" disabled={loading}
                className="btn-icon text-blue-500 hover:bg-blue-50"
                onClick={() => onEnCamino(r.id)}>
                <Truck size={15} />
              </button>
            )}
            {(r.estado === 'pendiente' || r.estado === 'en_transito') && (
              <>
                <button title="Aprobar" disabled={loading}
                  className="btn-icon text-green-600 hover:bg-green-50"
                  onClick={() => onAprobar(r.id)}>
                  <CheckCircle size={15} />
                </button>
                <button title="Rechazar" disabled={loading}
                  className="btn-icon text-red-500 hover:bg-red-50"
                  onClick={() => onRechazar(r.id)}>
                  <XCircle size={15} />
                </button>
              </>
            )}
            <button className="btn-icon text-gray-400" onClick={() => setExpanded(!expanded)}>
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-blue-50/50">
          <td colSpan={10} className="px-4 py-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div>
                <span className="text-gray-500 text-xs uppercase">Acción</span>
                <p className="font-medium">{r.accion}</p>
              </div>
              <div>
                <span className="text-gray-500 text-xs uppercase">Indicador</span>
                <p className="font-medium">{r.indicador_nombre || '—'}</p>
              </div>
              <div>
                <span className="text-gray-500 text-xs uppercase">Personal Receptor</span>
                <p className="font-medium">{r.personal_receptor_nombre || '—'}</p>
              </div>
              <div>
                <span className="text-gray-500 text-xs uppercase">Tipo Mercadería</span>
                <p className="font-medium">{r.tipo_mercaderia_nombre || '—'}</p>
              </div>
              <div>
                <span className="text-gray-500 text-xs uppercase">Lote</span>
                <p className="font-medium">{r.codigo_lote || '—'}</p>
              </div>
              <div>
                <span className="text-gray-500 text-xs uppercase">F. Vencimiento</span>
                <p className="font-medium">{r.fecha_vencimiento ? format(new Date(r.fecha_vencimiento), 'dd/MM/yyyy') : '—'}</p>
              </div>
              <div>
                <span className="text-gray-500 text-xs uppercase">Ciudad</span>
                <p className="font-medium">{r.ciudad_nombre || '—'}</p>
              </div>
              <div>
                <span className="text-gray-500 text-xs uppercase">Observaciones</span>
                <p className="font-medium">{r.observaciones || '—'}</p>
              </div>
              {r.foto_guia && (
                <div className="col-span-2">
                  <span className="text-gray-500 text-xs uppercase">Foto Guía</span>
                  <div className="mt-1">
                    <a href={`/uploads/${r.foto_guia}`} target="_blank" rel="noreferrer"
                      className="btn-secondary btn-sm inline-flex">
                      <Eye size={13} /> Ver archivo
                    </a>
                  </div>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function TablaModulo({ titulo, icono: Icono, color, registros, isLoading, onAprobar, onRechazar, onEnCamino, mutLoading }) {
  return (
    <div className="card p-0 overflow-hidden">
      {/* Header */}
      <div className={`flex items-center gap-3 px-5 py-4 border-b border-gray-200 ${color}`}>
        <Icono size={20} />
        <div>
          <h2 className="font-semibold text-gray-900">{titulo}</h2>
          <p className="text-xs text-gray-500">{registros.length} registro(s)</p>
        </div>
      </div>

      {/* Tabla */}
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Almacén Origen</th>
              <th>Almacén Destino</th>
              <th>Categoría</th>
              <th>Tipo Acción</th>
              <th>SKU</th>
              <th>Cantidad</th>
              <th>Nro. Guía</th>
              <th>Registrado por</th>
              <th width="130">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={10} className="text-center py-10 text-gray-400">
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-primary-400 border-t-transparent rounded-full animate-spin" />
                    Cargando...
                  </div>
                </td>
              </tr>
            ) : registros.length === 0 ? (
              <tr>
                <td colSpan={10} className="text-center py-10 text-gray-400">
                  No hay registros en esta sección.
                </td>
              </tr>
            ) : registros.map(r => (
              <RegistroRow
                key={r.id}
                r={r}
                onAprobar={onAprobar}
                onRechazar={onRechazar}
                onEnCamino={onEnCamino}
                loading={mutLoading}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Modulo2Page() {
  const qc = useQueryClient();

  const fetchRegistros = (estado) =>
    api.get(`/registros?estado=${estado}&limit=200`).then(r => r.data.datos ?? []);

  const { data: pendientes = [], isLoading: loadP } = useQuery({
    queryKey: ['registros', { estado: 'pendiente' }],
    queryFn: () => fetchRegistros('pendiente'),
    refetchInterval: 30_000,
  });

  const { data: enTransito = [], isLoading: loadT } = useQuery({
    queryKey: ['registros', { estado: 'en_transito' }],
    queryFn: () => fetchRegistros('en_transito'),
    refetchInterval: 30_000,
  });

  const mutEstado = useMutation({
    mutationFn: ({ id, estado }) => api.patch(`/registros/${id}/estado`, { estado }),
    onSuccess: (_, { estado }) => {
      qc.invalidateQueries({ queryKey: ['registros'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['auditoria-registros'] });
      const msgs = { aprobado: '✅ Registro aprobado', rechazado: '❌ Registro rechazado', en_transito: '🚚 Marcado como En Camino' };
      toast.success(msgs[estado] || 'Estado actualizado');
    },
    onError: (e) => toast.error(getMensajeError(e)),
  });

  const handleAprobar   = (id) => mutEstado.mutate({ id, estado: 'aprobado' });
  const handleRechazar  = (id) => mutEstado.mutate({ id, estado: 'rechazado' });
  const handleEnCamino  = (id) => mutEstado.mutate({ id, estado: 'en_transito' });

  // Stats rápidos
  const statsCards = [
    { label: 'Pendientes de aprobación', value: pendientes.length, color: 'bg-yellow-500', dot: 'bg-yellow-400' },
    { label: 'Guías en camino', value: enTransito.length, color: 'bg-blue-500', dot: 'bg-blue-400' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Control de Tránsito y Aprobaciones</h1>
        <p className="text-sm text-gray-500 mt-1">Módulo 2 · Visibilidad de guías y aprobación de ingresos</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4">
        {statsCards.map((s, i) => (
          <div key={i} className="stat-card">
            <div className={`stat-icon ${s.color}`}>
              {i === 0 ? <ClipboardCheck size={22} className="text-white" /> : <Truck size={22} className="text-white" />}
            </div>
            <div>
              <p className="text-3xl font-bold text-gray-900">{s.value}</p>
              <p className="text-sm text-gray-500">{s.label}</p>
            </div>
            {s.value > 0 && (
              <div className="ml-auto">
                <span className={`inline-block w-3 h-3 rounded-full ${s.dot} animate-pulse`} />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Sección 1: Guías en camino */}
      <TablaModulo
        titulo="Visibilidad de Guías en Camino"
        icono={Truck}
        color="bg-blue-50"
        registros={enTransito}
        isLoading={loadT}
        onAprobar={handleAprobar}
        onRechazar={handleRechazar}
        onEnCamino={handleEnCamino}
        mutLoading={mutEstado.isPending}
      />

      {/* Sección 2: Cuadro de aprobación */}
      <TablaModulo
        titulo="Cuadro de Aprobación de Ingresos"
        icono={ClipboardCheck}
        color="bg-yellow-50"
        registros={pendientes}
        isLoading={loadP}
        onAprobar={handleAprobar}
        onRechazar={handleRechazar}
        onEnCamino={handleEnCamino}
        mutLoading={mutEstado.isPending}
      />

      <p className="text-xs text-gray-400 text-center">
        Se actualiza automáticamente cada 30 segundos · Haz clic en una fila para ver el detalle completo
      </p>
    </div>
  );
}
