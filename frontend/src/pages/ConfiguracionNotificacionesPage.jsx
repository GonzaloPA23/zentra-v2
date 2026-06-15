import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import { AlertCircle, CheckCircle, Plus, Trash2 } from 'lucide-react';
import api, { getMensajeError } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import DataTable from '../components/DataTable';

function ConfiguracionNotificacionesPage() {
  const { usuario } = useAuth();
  const queryClient = useQueryClient();

  const { data: configData, isLoading } = useQuery({
    queryKey: ['config-notificaciones'],
    queryFn: () => api.get('/notificaciones/config').then((response) => response.data.datos),
    enabled: usuario?.rol === 'admin' || usuario?.rol === 'superadmin',
  });

  const addMutacion = useMutation({
    mutationFn: (tipoMercaderiaId) =>
      api.post('/notificaciones/config', {
        tipo_mercaderia_id: tipoMercaderiaId,
        excluir_de_stock_critico: true,
        excluir_de_stock_bajo: true,
        excluir_de_vencimientos: true,
      }),
    onSuccess: () => {
      toast.success('Configuracion agregada');
      queryClient.invalidateQueries({ queryKey: ['config-notificaciones'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err) => toast.error(getMensajeError(err)),
  });

  const eliminarMutacion = useMutation({
    mutationFn: (configId) => api.delete(`/notificaciones/config/${configId}`),
    onSuccess: () => {
      toast.success('Configuracion eliminada');
      queryClient.invalidateQueries({ queryKey: ['config-notificaciones'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err) => toast.error(getMensajeError(err)),
  });

  const addAllMutacion = useMutation({
    mutationFn: (tipoMercaderiaIds) =>
      api.post('/notificaciones/config/bulk', {
        tipo_mercaderia_ids: tipoMercaderiaIds,
      }),
    onSuccess: () => {
      toast.success('Exclusiones pendientes agregadas');
      queryClient.invalidateQueries({ queryKey: ['config-notificaciones'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err) => toast.error(getMensajeError(err)),
  });

  if (usuario?.rol !== 'admin' && usuario?.rol !== 'superadmin') {
    return (
      <div className="p-6 text-center">
        <AlertCircle size={48} className="mx-auto mb-4 text-orange-500" />
        <p className="text-lg font-semibold text-gray-700">
          Solo administradores pueden acceder a esta configuracion
        </p>
      </div>
    );
  }

  const config = configData?.config || [];
  const tiposDisponibles = configData?.tipos_disponibles || [];
  const tiposConfigurados = new Set(config.map((item) => Number(item.tipo_mercaderia_id)));
  const tiposDisponiblesParaAgregar = tiposDisponibles.filter(
    (tipo) => !tiposConfigurados.has(Number(tipo.id)),
  );
  const isMutating = addMutacion.isPending || addAllMutacion.isPending || eliminarMutacion.isPending;
  const booleanColumn = (field) => ({
    filterValue: (row) => (row[field] ? 'Si' : 'No'),
    sortValue: (row) => (row[field] ? 'Si' : 'No'),
    render: (row) => (
      <div className="flex justify-center">
        {row[field] ? (
          <CheckCircle size={20} className="text-green-500" />
        ) : (
          <div className="h-5 w-5 rounded-full border-2 border-gray-300" />
        )}
      </div>
    ),
  });
  const configColumns = [
    { header: 'Categoria', accessor: 'categoria_nombre', render: (row) => <span className="font-medium">{row.categoria_nombre || '-'}</span> },
    { header: 'Tipo de Mercaderia', accessor: 'tipo_mercaderia_nombre', render: (row) => row.tipo_mercaderia_nombre || '-' },
    { header: 'Excluir de Stock Critico', ...booleanColumn('excluir_de_stock_critico') },
    { header: 'Excluir de Stock Bajo', ...booleanColumn('excluir_de_stock_bajo') },
    { header: 'Excluir de Vencimientos', ...booleanColumn('excluir_de_vencimientos') },
    {
      header: 'Acciones',
      width: 90,
      filterable: false,
      sortable: false,
      render: (row) => (
        <button
          type="button"
          className="btn-icon text-red-500 hover:bg-red-50"
          onClick={() => eliminarMutacion.mutate(row.id)}
          disabled={isMutating}
          title="Eliminar"
        >
          <Trash2 size={18} />
        </button>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-8">
        <h1 className="mb-2 text-3xl font-bold text-gray-900">
          Configuracion de Notificaciones
        </h1>
        <p className="text-gray-600">
          Configura que tipos de mercaderia se excluyen de alertas de stock y vencimientos.
        </p>
      </div>

      {config.length > 0 && (
        <div className="mb-8 rounded-lg bg-white p-6 shadow-md">
          <h2 className="mb-4 text-xl font-semibold text-gray-900">
            Exclusiones Configuradas
          </h2>
          <DataTable
            columns={configColumns}
            data={config}
            loading={isLoading}
            searchPlaceholder="Buscar exclusiones..."
            rowKey="id"
          />
        </div>
      )}

      {tiposDisponiblesParaAgregar.length > 0 && (
        <div className="rounded-lg bg-white p-6 shadow-md">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <h2 className="text-xl font-semibold text-gray-900">
              Agregar Nueva Exclusion
            </h2>
            <button
              type="button"
              className="btn-primary btn-sm"
              onClick={() => addAllMutacion.mutate(tiposDisponiblesParaAgregar.map((tipo) => tipo.id))}
              disabled={isMutating}
            >
              <Plus size={14} /> Agregar todos los pendientes
            </button>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {tiposDisponiblesParaAgregar.map((tipo) => (
              <button
                key={tipo.id}
                type="button"
                className="btn-secondary flex items-center justify-between gap-2 p-4 text-left"
                onClick={() => addMutacion.mutate(tipo.id)}
                disabled={isMutating}
              >
                <span className="flex flex-col items-start">
                  <span className="font-semibold">{tipo.nombre}</span>
                  <span className="text-xs font-normal text-gray-500">
                    {tipo.categoria_nombre || 'Sin categoria'}
                  </span>
                </span>
                <Plus size={20} />
              </button>
            ))}
          </div>
        </div>
      )}

      {config.length === 0 && tiposDisponiblesParaAgregar.length === 0 && !isLoading && (
        <div className="rounded-lg bg-blue-50 p-8 text-center">
          <p className="text-gray-600">No hay tipos de mercaderia disponibles para configurar</p>
        </div>
      )}
    </div>
  );
}

export default ConfiguracionNotificacionesPage;
