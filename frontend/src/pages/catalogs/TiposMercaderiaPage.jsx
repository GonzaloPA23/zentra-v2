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

function TipoMercaderiaForm({ defaults, onSubmit, onCancel, loading }) {
  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ defaultValues: defaults || {} });

  const { data: categorias = [] } = useQuery({
    queryKey: ['categorias'],
    queryFn: () => api.get('/catalogos/categorias').then((response) => response.data.datos),
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <div className="modal-body space-y-4">
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

        <div>
          <label className="label">Nombre <span className="text-red-500">*</span></label>
          <input
            className={`input ${errors.nombre ? 'input-error' : ''}`}
            placeholder="Ej: ACTIVOS, CANJES, MERCADERISMO..."
            {...register('nombre', { required: 'Requerido' })}
          />
          {errors.nombre && <p className="error-msg">{errors.nombre.message}</p>}
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

export default function TiposMercaderiaPage() {
  return (
    <GenericCatalogPage
      title="Tipos de Mercadería"
      subtitle="Tipos asociados a cada categoría"
      endpoint="/catalogos/tipos-mercaderia"
      queryKey={['tipos-mercaderia', 'catalogo']}
      columns={[
        { header: '#', accessor: 'id', width: 60 },
        { header: 'Categoría', accessor: 'categoria_nombre', searchable: true },
        { header: 'Nombre', accessor: 'nombre', searchable: true },
      ]}
      FormComponent={TipoMercaderiaForm}
    />
  );
}
