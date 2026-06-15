import { useForm } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
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

function AlmacenForm({ defaults, onSubmit, onCancel, loading }) {
  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ defaultValues: defaults || {} });

  const { data: ciudades = [] } = useQuery({
    queryKey: ['ciudades'],
    queryFn: () => api.get('/catalogos/ciudades').then((response) => response.data.datos),
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <div className="modal-body space-y-4">
        <div>
          <label className="label">Nombre <span className="text-red-500">*</span></label>
          <input
            className={`input ${errors.nombre ? 'input-error' : ''}`}
            placeholder="Ej: ALMACEN LIMA NORTE"
            {...register('nombre', { required: 'Requerido' })}
          />
          {errors.nombre && <p className="error-msg">{errors.nombre.message}</p>}
        </div>

        <div>
          <label className="label">Ciudad <span className="text-red-500">*</span></label>
          <SearchableSelect
            control={control}
            name="ciudad_id"
            rules={{ required: 'Requerido' }}
            options={buildOptions(
              ciudades,
              (ciudad) => `${ciudad.nombre} · ${ciudad.region_nombre}`,
              (ciudad) => `${ciudad.nombre} ${ciudad.region_nombre || ''} ${ciudad.zona || ''}`
            )}
            placeholder="Seleccionar ciudad..."
          />
          {errors.ciudad_id && <p className="error-msg">{errors.ciudad_id.message}</p>}
        </div>

        <div>
          <label className="label">Dirección</label>
          <input className="input" placeholder="Dirección física del almacén" {...register('direccion')} />
        </div>

        {defaults?.id && (
          <div className="flex items-center gap-2">
            <input type="checkbox" id="activo" {...register('activo')} defaultChecked={defaults.activo} />
            <label htmlFor="activo" className="text-sm">Activo</label>
          </div>
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

export default function AlmacenesPage() {
  return (
    <GenericCatalogPage
      title="Almacenes"
      subtitle="Gestión de almacenes por ciudad y región"
      endpoint="/catalogos/almacenes"
      queryKey={['almacenes', 'catalogo']}
      columns={[
        { header: '#', accessor: 'id', width: 60 },
        { header: 'Nombre', accessor: 'nombre', searchable: true },
        { header: 'Ciudad', accessor: 'ciudad_nombre', searchable: true },
        { header: 'Región', accessor: 'region_nombre' },
        { header: 'Zona', accessor: 'zona', render: (row) => <span className="badge-gray badge">{row.zona}</span> },
        { header: 'Dirección', accessor: 'direccion', render: (row) => row.direccion || '—' },
      ]}
      FormComponent={AlmacenForm}
    />
  );
}
