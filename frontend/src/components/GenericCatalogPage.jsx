import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "react-toastify";
import api, { getMensajeError } from "../utils/api";
import DataTable from "./DataTable";
import Modal from "./Modal";
import ConfirmDialog from "./ConfirmDialog";
import { FileSpreadsheet, Plus, Pencil, Trash2 } from "lucide-react";
import { downloadBlobResponse, getBlobErrorMessage } from "../utils/download";

/**
 * GenericCatalogPage
 * Props:
 *  - title, subtitle
 *  - endpoint: e.g. '/catalogos/categorias'
 *  - queryKey: array
 *  - columns: DataTable columns
 *  - FormComponent: form JSX component
 *  - formDefaults: default values for new item
 *  - buildPayload: (formData) => object to send
 */
export default function GenericCatalogPage({
  title,
  subtitle,
  endpoint,
  queryKey,
  columns,
  FormComponent,
  formDefaults = {},
  buildPayload = (d) => d,
  extraActions = null,
}) {
  const qc = useQueryClient();
  const [modal, setModal] = useState(null); // null | 'create' | 'edit'
  const [selected, setSelected] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [exporting, setExporting] = useState(false);
  const baseQueryKey = Array.isArray(queryKey) && queryKey.length ? [queryKey[0]] : queryKey;
  const exportFileName = `catalogo_${String(title || 'datos')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'datos'}.xlsx`;

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => api.get(`${endpoint}?incluir_inactivos=1`).then((r) => r.data.datos),
  });

  const mutCreate = useMutation({
    mutationFn: (d) => api.post(endpoint, buildPayload(d)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: baseQueryKey });
      toast.success("Registro creado");
      closeModal();
    },
    onError: (e) => toast.error(getMensajeError(e)),
  });

  const mutUpdate = useMutation({
    mutationFn: (d) => api.put(`${endpoint}/${selected.id}`, buildPayload(d)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: baseQueryKey });
      toast.success("Registro actualizado");
      closeModal();
    },
    onError: (e) => toast.error(getMensajeError(e)),
  });

  const mutDelete = useMutation({
    mutationFn: () => api.delete(`${endpoint}/${deleting.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: baseQueryKey });
      toast.success("Registro eliminado");
      setDeleting(null);
    },
    onError: (e) => {
      toast.error(getMensajeError(e));
      setDeleting(null);
    },
  });

  const openCreate = () => {
    setSelected(null);
    setModal("create");
  };
  const openEdit = (row) => {
    setSelected(row);
    setModal("edit");
  };
  const closeModal = () => {
    setModal(null);
    setSelected(null);
  };

  const handleSubmit = (data) => {
    if (modal === "create") mutCreate.mutate(data);
    else mutUpdate.mutate(data);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const response = await api.get(`${endpoint}/export/excel?incluir_inactivos=1`, {
        responseType: "blob",
      });
      downloadBlobResponse(response, exportFileName);
    } catch (error) {
      toast.error(await getBlobErrorMessage(error, "No se pudo exportar el catálogo"));
    } finally {
      setExporting(false);
    }
  };

  const allColumns = [
    ...columns,
    {
      header: "Estado",
      width: 80,
      filterValue: (row) => (row.activo ? "Activo" : "Inactivo"),
      sortValue: (row) => (row.activo ? "Activo" : "Inactivo"),
      render: (row) =>
        row.activo !== undefined ? (
          <span className={row.activo ? "badge-green" : "badge-red"}>
            {row.activo ? "Activo" : "Inactivo"}
          </span>
        ) : null,
    },
    {
      header: "Acciones",
      width: 100,
      render: (row) => (
        <div className="flex items-center gap-1">
          <button
            className="btn-icon text-blue-500"
            onClick={() => openEdit(row)}
            title="Editar"
          >
            <Pencil size={14} />
          </button>
          <button
            className="btn-icon text-red-500"
            onClick={() => setDeleting(row)}
            title="Eliminar"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
        {subtitle && <p className="text-sm text-gray-500 mt-1">{subtitle}</p>}
      </div>

      <DataTable
        columns={allColumns}
        data={data ?? []}
        loading={isLoading}
        searchPlaceholder={`Buscar en ${title.toLowerCase()}...`}
        actions={
          <>
            {extraActions}
            <button className="btn-secondary btn-sm" onClick={handleExport} disabled={exporting}>
              <FileSpreadsheet size={14} /> {exporting ? "Exportando..." : "Exportar Excel"}
            </button>
            <button className="btn-primary btn-sm" onClick={openCreate}>
              <Plus size={14} /> Nuevo
            </button>
          </>
        }
      />

      {/* Modal crear/editar */}
      <Modal
        open={!!modal}
        onClose={closeModal}
        title={
          modal === "create"
            ? `Nuevo en ${title}`
            : `Editar: ${selected?.nombre}`
        }
      >
        <FormComponent
          defaults={modal === "edit" ? selected : formDefaults}
          onSubmit={handleSubmit}
          onCancel={closeModal}
          loading={mutCreate.isPending || mutUpdate.isPending}
        />
      </Modal>

      {/* Confirm delete */}
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => mutDelete.mutate()}
        loading={mutDelete.isPending}
        title={`Eliminar`}
        message={`¿Eliminar "${deleting?.nombre}"? Verifique que no tenga registros asociados.`}
      />
    </div>
  );
}
