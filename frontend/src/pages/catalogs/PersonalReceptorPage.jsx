import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Loader2 } from 'lucide-react';
import GenericCatalogPage from '../../components/GenericCatalogPage';
import SearchableSelect from '../../components/SearchableSelect';
import api from '../../utils/api';

function buildOptions(rows = [], labelBuilder, searchBuilder) {
  return rows.map((row) => ({
    value: String(row.id),
    label: labelBuilder(row),
    searchText: searchBuilder ? searchBuilder(row) : labelBuilder(row),
  }));
}

function PersonalForm({ defaults, onSubmit, onCancel, loading }) {
  const {
    control,
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm({
    defaultValues: {
      nombre: defaults?.nombre || '',
      email: defaults?.email || '',
      cargo: defaults?.cargo || '',
      almacen_id: defaults?.almacen_id || '',
      categoria_id: defaults?.categoria_id || '',
      activo: defaults?.activo ?? true,
    },
  });

  const { data: almacenes = [] } = useQuery({
    queryKey: ['almacenes'],
    queryFn: () => api.get('/catalogos/almacenes').then((response) => response.data.datos),
  });
  const { data: categorias = [] } = useQuery({
    queryKey: ['categorias'],
    queryFn: () => api.get('/catalogos/categorias').then((response) => response.data.datos),
  });

  const almacenId = watch('almacen_id');
  const almacenSeleccionado = almacenes.find((almacen) => String(almacen.id) === String(almacenId));

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <div className="modal-body space-y-4">
        <div>
          <label className="label">Nombre completo <span className="text-red-500">*</span></label>
          <input
            className={`input ${errors.nombre ? 'input-error' : ''}`}
            {...register('nombre', { required: 'Requerido' })}
          />
          {errors.nombre && <p className="error-msg">{errors.nombre.message}</p>}
        </div>

        <div>
          <label className="label">Cargo</label>
          <input className="input" placeholder="Ej: Almacenero, Supervisor..." {...register('cargo')} />
        </div>

        <div>
          <label className="label">Correo <span className="text-red-500">*</span></label>
          <input
            type="email"
            className={`input ${errors.email ? 'input-error' : ''}`}
            placeholder="Ej: receptor@empresa.com"
            {...register('email', {
              required: 'Requerido',
              pattern: {
                value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                message: 'Correo invalido',
              },
            })}
          />
          {errors.email && <p className="error-msg">{errors.email.message}</p>}
          {!errors.email && (
            <p className="mt-1 text-xs text-gray-400">
              El mismo correo se puede reutilizar en otros almacenes o categorias.
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="label">Almacén / Ciudad <span className="text-red-500">*</span></label>
            <SearchableSelect
              control={control}
              name="almacen_id"
              rules={{ required: 'Requerido' }}
              options={buildOptions(
                almacenes,
                (almacen) => `${almacen.nombre} · ${almacen.ciudad_nombre}`,
                (almacen) => `${almacen.nombre} ${almacen.ciudad_nombre || ''} ${almacen.region_nombre || ''}`
              )}
              placeholder="Seleccionar almacén..."
            />
            {errors.almacen_id && <p className="error-msg">{errors.almacen_id.message}</p>}
            {almacenSeleccionado && (
              <p className="mt-1 text-xs text-gray-400">
                Ciudad asociada: {almacenSeleccionado.ciudad_nombre}
              </p>
            )}
          </div>

          <div>
            <label className="label">Categoría <span className="text-red-500">*</span></label>
            <SearchableSelect
              control={control}
              name="categoria_id"
              rules={{ required: 'Requerido' }}
              options={buildOptions(categorias, (categoria) => categoria.nombre)}
              placeholder="Seleccionar categoría..."
            />
            {errors.categoria_id && <p className="error-msg">{errors.categoria_id.message}</p>}
          </div>
        </div>

        {defaults?.id && (
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" {...register('activo')} defaultChecked={defaults?.activo} />
            Activo
          </label>
        )}
      </div>

      <div className="modal-footer">
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancelar</button>
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : 'Guardar'}
        </button>
      </div>
    </form>
  );
}

export default function PersonalReceptorPage() {
  return (
    <GenericCatalogPage
      title="Personal Receptor"
      subtitle="Personas que pueden recibir mercadería"
      endpoint="/catalogos/personal-receptor"
      queryKey={['personal-receptor', 'catalogo']}
      columns={[
        { header: '#', accessor: 'id', width: 60 },
        { header: 'Nombre', accessor: 'nombre', searchable: true },
        { header: 'Correo', accessor: 'email', searchable: true },
        { header: 'Almacén', accessor: 'almacen_nombre', searchable: true, render: (row) => row.almacen_nombre || '-' },
        { header: 'Ciudad', accessor: 'ciudad_nombre', searchable: true, render: (row) => row.ciudad_nombre || '-' },
        { header: 'Categoría', accessor: 'categoria_nombre', searchable: true, render: (row) => row.categoria_nombre || '-' },
        { header: 'Cargo', accessor: 'cargo', render: (row) => row.cargo || '—' },
      ]}
      FormComponent={PersonalForm}
    />
  );
}
