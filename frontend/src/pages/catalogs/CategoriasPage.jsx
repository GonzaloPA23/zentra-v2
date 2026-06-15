// ─── CategoriasPage.jsx ────────────────────────────────────────────────────
import { useForm } from 'react-hook-form';
import GenericCatalogPage from '../../components/GenericCatalogPage';
import { Loader2 } from 'lucide-react';

function CategoriaForm({ defaults, onSubmit, onCancel, loading }) {
  const { register, handleSubmit, formState: { errors } } = useForm({ defaultValues: defaults || {} });
  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <div className="modal-body space-y-4">
        <div>
          <label className="label">Nombre <span className="text-red-500">*</span></label>
          <input className={`input ${errors.nombre ? 'input-error' : ''}`}
            {...register('nombre', { required: 'Requerido' })} />
          {errors.nombre && <p className="error-msg">{errors.nombre.message}</p>}
        </div>
        <div>
          <label className="label">Descripción</label>
          <textarea className="input" rows={3} {...register('descripcion')} />
        </div>
        {defaults?.id && (
          <div className="flex items-center gap-2">
            <input type="checkbox" id="activo" {...register('activo')} defaultChecked={defaults.activo} />
            <label htmlFor="activo" className="text-sm text-gray-700">Activo</label>
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

export function CategoriasPage() {
  return (
    <GenericCatalogPage
      title="Categorías"
      subtitle="Catálogo de categorías de mercadería"
      endpoint="/catalogos/categorias"
      queryKey={['categorias', 'catalogo']}
      columns={[
        { header: '#', accessor: 'id', width: 60 },
        { header: 'Nombre', accessor: 'nombre', searchable: true },
        { header: 'Descripción', accessor: 'descripcion', render: r => r.descripcion || '—' },
      ]}
      FormComponent={CategoriaForm}
    />
  );
}

export default CategoriasPage;
