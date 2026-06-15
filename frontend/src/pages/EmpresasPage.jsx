import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { toast } from 'react-toastify';
import api, { getMensajeError } from '../utils/api';
import DataTable from '../components/DataTable';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import { Plus, Pencil, Trash2, Loader2, Building2 } from 'lucide-react';
import { toSafeLocaleDateString } from '../utils/date';

function EmpresaForm({ defaults, onSubmit, onCancel, loading, isEdit }) {
  const { register, handleSubmit, formState: { errors } } = useForm({ defaultValues: defaults || {} });
  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <div className="modal-body space-y-4">
        <div>
          <label className="label">Nombre de la empresa <span className="text-red-500">*</span></label>
          <input className={`input ${errors.nombre ? 'input-error' : ''}`}
            placeholder="Ej: Empresa ABC S.A.C."
            {...register('nombre', { required: 'Requerido' })} />
          {errors.nombre && <p className="error-msg">{errors.nombre.message}</p>}
        </div>
        <div>
          <label className="label">RUC</label>
          <input className={`input ${errors.ruc ? 'input-error' : ''}`}
            placeholder="20123456789 (11 dígitos)"
            maxLength={11}
            {...register('ruc', {
              pattern: { value: /^\d{11}$/, message: 'RUC debe tener exactamente 11 dígitos' },
            })} />
          {errors.ruc && <p className="error-msg">{errors.ruc.message}</p>}
        </div>
        {isEdit && (
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" {...register('activo')} defaultChecked={defaults?.activo} />
            Empresa activa
          </label>
        )}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-700">
          <strong>Nota:</strong> Al crear una empresa, deberás configurar manualmente sus regiones, ciudades, almacenes, categorías y usuarios desde los catálogos correspondientes.
        </div>
      </div>
      <div className="modal-footer">
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancelar</button>
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? <><Loader2 size={14} className="animate-spin" /> Guardando...</> : 'Guardar Empresa'}
        </button>
      </div>
    </form>
  );
}

export default function EmpresasPage() {
  const qc = useQueryClient();
  const [modal, setModal] = useState(null);
  const [selected, setSelected] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const { data: empresas = [], isLoading } = useQuery({
    queryKey: ['empresas'],
    queryFn: () => api.get('/empresas').then(r => r.data.datos),
  });

  const mutCreate = useMutation({
    mutationFn: (d) => api.post('/empresas', d),
    onSuccess: () => { qc.invalidateQueries(['empresas']); toast.success('Empresa creada'); closeModal(); },
    onError: (e) => toast.error(getMensajeError(e)),
  });

  const mutUpdate = useMutation({
    mutationFn: (d) => api.put(`/empresas/${selected.id}`, d),
    onSuccess: () => { qc.invalidateQueries(['empresas']); toast.success('Empresa actualizada'); closeModal(); },
    onError: (e) => toast.error(getMensajeError(e)),
  });

  const mutDelete = useMutation({
    mutationFn: () => api.delete(`/empresas/${deleting.id}`),
    onSuccess: () => { qc.invalidateQueries(['empresas']); toast.success('Empresa desactivada'); setDeleting(null); },
    onError: (e) => { toast.error(getMensajeError(e)); setDeleting(null); },
  });

  const closeModal = () => { setModal(null); setSelected(null); };

  const handleSubmit = (data) => {
    if (modal === 'create') mutCreate.mutate(data);
    else mutUpdate.mutate({ ...data, activo: data.activo ? 1 : 0 });
  };

  const columns = [
    { header: '#', accessor: 'id', width: 60 },
    {
      header: 'Empresa', accessor: 'nombre', searchable: true,
      render: r => (
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-primary-100 rounded-lg flex items-center justify-center">
            <Building2 size={14} className="text-primary-600" />
          </div>
          <span className="font-medium text-gray-900">{r.nombre}</span>
        </div>
      ),
    },
    { header: 'RUC', accessor: 'ruc', render: r => r.ruc || '—' },
    { header: 'Estado', filterValue: r => r.activo ? 'Activa' : 'Inactiva', sortValue: r => r.activo ? 'Activa' : 'Inactiva', render: r => <span className={r.activo ? 'badge-green' : 'badge-red'}>{r.activo ? 'Activa' : 'Inactiva'}</span> },
    { header: 'Creada', accessor: 'created_at', render: r => r.created_at ? new Date(r.created_at).toLocaleDateString('es-PE') : '—' },
    {
      header: 'Acciones', width: 100,
      render: r => (
        <div className="flex items-center gap-1">
          <button className="btn-icon text-blue-500" title="Editar" onClick={() => { setSelected(r); setModal('edit'); }}>
            <Pencil size={14} />
          </button>
          <button className="btn-icon text-red-500" title="Desactivar" onClick={() => setDeleting(r)}>
            <Trash2 size={14} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Empresas</h1>
        <p className="text-sm text-gray-500 mt-1">Gestión multiempresa — Solo SuperAdmin</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="stat-card">
          <div className="stat-icon bg-primary-500">
            <Building2 size={20} className="text-white" />
          </div>
          <div>
            <p className="text-2xl font-bold">{empresas.length}</p>
            <p className="text-sm text-gray-500">Total Empresas</p>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon bg-green-500">
            <Building2 size={20} className="text-white" />
          </div>
          <div>
            <p className="text-2xl font-bold">{empresas.filter(e => e.activo).length}</p>
            <p className="text-sm text-gray-500">Activas</p>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon bg-red-400">
            <Building2 size={20} className="text-white" />
          </div>
          <div>
            <p className="text-2xl font-bold">{empresas.filter(e => !e.activo).length}</p>
            <p className="text-sm text-gray-500">Inactivas</p>
          </div>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={empresas}
        loading={isLoading}
        searchPlaceholder="Buscar empresas..."
        actions={
          <button className="btn-primary btn-sm" onClick={() => setModal('create')}>
            <Plus size={14} /> Nueva Empresa
          </button>
        }
      />

      <Modal open={!!modal} onClose={closeModal}
        title={modal === 'create' ? 'Nueva Empresa' : `Editar: ${selected?.nombre}`}>
        <EmpresaForm
          defaults={selected}
          onSubmit={handleSubmit}
          onCancel={closeModal}
          loading={mutCreate.isPending || mutUpdate.isPending}
          isEdit={modal === 'edit'}
        />
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => mutDelete.mutate()}
        loading={mutDelete.isPending}
        title="Desactivar Empresa"
        message={`¿Desactivar la empresa "${deleting?.nombre}"? Todos sus usuarios no podrán ingresar al sistema.`}
      />
    </div>
  );
}
