import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Boxes,
  Loader2,
  PackagePlus,
  Pencil,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "react-toastify";
import GenericCatalogPage from "../../components/GenericCatalogPage";
import Modal from "../../components/Modal";
import ConfirmDialog from "../../components/ConfirmDialog";
import ExcelBulkUploadModal from "../../components/ExcelBulkUploadModal";
import SearchableSelect from "../../components/SearchableSelect";
import api, { getMensajeError } from "../../utils/api";
import { toSafeDateInputValue } from "../../utils/date";

const ZONA_OPTIONS = [
  { value: "LIMA", label: "LIMA" },
  { value: "PROVINCIA", label: "PROVINCIA" },
];

function buildOptions(rows = [], labelBuilder, searchBuilder) {
  return rows.map((row) => ({
    value: String(row.id),
    label: labelBuilder(row),
    searchText: searchBuilder ? searchBuilder(row) : labelBuilder(row),
  }));
}

function skuManejaLotes(sku) {
  return (
    sku?.tiene_lote === true || sku?.tiene_lote === 1 || sku?.tiene_lote === "1"
  );
}

function formatLoteDate(value, fallback = "-") {
  return toSafeDateInputValue(value, fallback);
}

function SkuForm({ defaults, onSubmit, onCancel, loading }) {
  const {
    control,
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm({
    defaultValues: defaults || { zona: "LIMA" },
  });
  const categoriaId = watch("categoria_id");

  const { data: categorias = [] } = useQuery({
    queryKey: ["categorias"],
    queryFn: () =>
      api.get("/catalogos/categorias").then((response) => response.data.datos),
  });
  const { data: tiposMercaderia = [] } = useQuery({
    queryKey: ["sku-form-tipos-mercaderia", categoriaId || ""],
    queryFn: () =>
      api
        .get(`/catalogos/tipos-mercaderia?categoria_id=${categoriaId}`)
        .then((response) => response.data.datos),
    enabled: !!categoriaId,
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <div className="modal-body space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="label">
              Nombre <span className="text-red-500">*</span>
            </label>
            <input
              className={`input ${errors.nombre ? "input-error" : ""}`}
              {...register("nombre", { required: "Requerido" })}
            />
            {errors.nombre && (
              <p className="error-msg">{errors.nombre.message}</p>
            )}
          </div>
          <div>
            <label className="label">Código</label>
            <input
              className="input"
              placeholder="Código interno"
              {...register("codigo")}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="label">
              Categoría <span className="text-red-500">*</span>
            </label>
            <SearchableSelect
              control={control}
              name="categoria_id"
              rules={{ required: "Requerido" }}
              options={buildOptions(categorias, (item) => item.nombre)}
              placeholder="Seleccionar categoría..."
            />
            {errors.categoria_id && (
              <p className="error-msg">{errors.categoria_id.message}</p>
            )}
          </div>
          <div>
            <label className="label">Tipo de mercadería</label>
            <SearchableSelect
              control={control}
              name="tipo_mercaderia_id"
              options={buildOptions(tiposMercaderia, (item) => item.nombre)}
              placeholder={
                categoriaId
                  ? "Seleccionar tipo..."
                  : "Primero selecciona categoría"
              }
              disabled={!categoriaId}
              emptyText="Sin tipos disponibles"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="label">
              Zona <span className="text-red-500">*</span>
            </label>
            <SearchableSelect
              control={control}
              name="zona"
              rules={{ required: "Requerido" }}
              options={ZONA_OPTIONS}
              placeholder="Seleccionar zona..."
            />
            {errors.zona && <p className="error-msg">{errors.zona.message}</p>}
          </div>
          <div>
            <label className="label">Unidad</label>
            <input
              className="input"
              placeholder="Ej: unidad, kg, caja..."
              {...register("unidad")}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-6">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              {...register("tiene_lote")}
              defaultChecked={defaults?.tiene_lote}
            />
            Maneja lotes
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              {...register("tiene_vencimiento")}
              defaultChecked={defaults?.tiene_vencimiento}
            />
            Tiene fecha de vencimiento
          </label>
          {defaults?.id && (
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                {...register("activo")}
                defaultChecked={defaults?.activo}
              />
              Activo
            </label>
          )}
        </div>
      </div>

      <div className="modal-footer">
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancelar
        </button>
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : "Guardar"}
        </button>
      </div>
    </form>
  );
}

function LoteForm({ lote, onSubmit, onCancel, loading }) {
  const buildDefaults = (currentLote) =>
    currentLote
      ? {
          ...currentLote,
          fecha_vencimiento: toSafeDateInputValue(
            currentLote.fecha_vencimiento,
          ),
          activo: currentLote.activo ?? true,
        }
      : {
          codigo_lote: "",
          fecha_vencimiento: "",
          activo: true,
        };

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({
    defaultValues: buildDefaults(lote),
  });

  useEffect(() => {
    reset(buildDefaults(lote));
  }, [lote, reset]);

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <label className="label">
          Código de lote <span className="text-red-500">*</span>
        </label>
        <input
          className={`input ${errors.codigo_lote ? "input-error" : ""}`}
          {...register("codigo_lote", { required: "Requerido" })}
        />
        {errors.codigo_lote && (
          <p className="error-msg">{errors.codigo_lote.message}</p>
        )}
      </div>

      <div>
        <label className="label">Fecha de vencimiento</label>
        <input
          type="date"
          className="input"
          {...register("fecha_vencimiento")}
        />
      </div>

      {lote?.id && (
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            {...register("activo")}
            defaultChecked={lote?.activo}
          />
          Activo
        </label>
      )}

      <div className="flex justify-end gap-3">
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancelar
        </button>
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            "Guardar lote"
          )}
        </button>
      </div>
    </form>
  );
}

function LotesManagerModal({ sku, open, onClose }) {
  const queryClient = useQueryClient();
  const [editingLote, setEditingLote] = useState(null);
  const [deletingLote, setDeletingLote] = useState(null);
  const lotesQueryKey = ["sku-lotes", "catalogo", String(sku?.id || "")];

  const {
    data: lotes = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: lotesQueryKey,
    queryFn: () =>
      api
        .get(`/catalogos/lotes?sku_id=${sku.id}&incluir_inactivos=1`)
        .then((response) => response.data.datos),
    enabled: open && !!sku?.id,
    staleTime: 0,
    refetchOnMount: "always",
  });

  const saveMutation = useMutation({
    mutationFn: (data) => {
      const payload = {
        codigo_lote: data.codigo_lote,
        fecha_vencimiento: data.fecha_vencimiento || null,
        activo: data.activo ?? true,
      };

      if (editingLote?.id) {
        return api.put(`/catalogos/lotes/${editingLote.id}`, payload);
      }

      return api.post("/catalogos/lotes", {
        sku_id: sku.id,
        ...payload,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: lotesQueryKey });
      await queryClient.invalidateQueries({ queryKey: ["skus"] });
      await refetch();
      toast.success(editingLote?.id ? "Lote actualizado" : "Lote creado");
      setEditingLote(null);
    },
    onError: (error) => toast.error(getMensajeError(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/catalogos/lotes/${deletingLote.id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: lotesQueryKey });
      await queryClient.invalidateQueries({ queryKey: ["skus"] });
      await refetch();
      toast.success("Lote eliminado");
      setDeletingLote(null);
      if (editingLote?.id === deletingLote?.id) {
        setEditingLote(null);
      }
    },
    onError: (error) => {
      toast.error(getMensajeError(error));
      setDeletingLote(null);
    },
  });

  return (
    <>
      <Modal
        open={open}
        onClose={() => {
          setEditingLote(null);
          onClose();
        }}
        title={sku ? `Lotes de ${sku.nombre}` : "Lotes"}
        size="xl"
      >
        <div className="grid gap-6 p-6 lg:grid-cols-[360px,1fr]">
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
            <div className="mb-4">
              <h3 className="font-semibold text-gray-800">
                {editingLote?.id ? "Editar lote" : "Nuevo lote"}
              </h3>
              <p className="mt-1 text-sm text-gray-500">
                Gestiona lotes directamente desde el catálogo de SKUs.
              </p>
            </div>

            <LoteForm
              lote={editingLote}
              onSubmit={(data) => saveMutation.mutate(data)}
              onCancel={() => setEditingLote(null)}
              loading={saveMutation.isPending}
            />
          </div>

          <div className="space-y-3">
            {isError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                No se pudieron cargar los lotes. {getMensajeError(error)}
              </div>
            )}
            <div className="rounded-xl border border-gray-200 bg-white">
              <table className="table">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Vencimiento</th>
                    <th>Estado</th>
                    <th width="100">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="py-12 text-center text-gray-400"
                      >
                        Cargando lotes...
                      </td>
                    </tr>
                  ) : lotes.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="py-12 text-center text-gray-400"
                      >
                        Este SKU aún no tiene lotes.
                      </td>
                    </tr>
                  ) : (
                    lotes.map((lote) => (
                      <tr key={lote.id}>
                        <td>{lote.codigo_lote}</td>
                        <td>{formatLoteDate(lote.fecha_vencimiento)}</td>
                        <td>
                          <span
                            className={
                              lote.activo ? "badge-green" : "badge-red"
                            }
                          >
                            {lote.activo ? "Activo" : "Inactivo"}
                          </span>
                        </td>
                        <td>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              className="btn-icon text-blue-500"
                              onClick={() => setEditingLote(lote)}
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              type="button"
                              className="btn-icon text-red-500"
                              onClick={() => setDeletingLote(lote)}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deletingLote}
        onClose={() => setDeletingLote(null)}
        onConfirm={() => deleteMutation.mutate()}
        loading={deleteMutation.isPending}
        title="Eliminar lote"
        message={`¿Eliminar el lote "${deletingLote?.codigo_lote || ""}"?`}
      />
    </>
  );
}

export default function SkusPage() {
  const [managingSku, setManagingSku] = useState(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkLotesOpen, setBulkLotesOpen] = useState(false);
  const queryClient = useQueryClient();

  const columns = useMemo(
    () => [
      { header: "#", accessor: "id", width: 60 },
      { header: "Nombre", accessor: "nombre", searchable: true },
      {
        header: "Código",
        accessor: "codigo",
        render: (row) => row.codigo || "—",
      },
      { header: "Categoría", accessor: "categoria_nombre", searchable: true },
      {
        header: "Tipo Merc.",
        accessor: "tipo_mercaderia_nombre",
        render: (row) => row.tipo_mercaderia_nombre || "—",
      },
      {
        header: "Zona",
        accessor: "zona",
        render: (row) => <span className="badge-gray badge">{row.zona}</span>,
      },
      {
        header: "Lote",
        filterValue: (row) => (row.tiene_lote ? "Si" : "No"),
        sortValue: (row) => (row.tiene_lote ? "Si" : "No"),
        render: (row) => (row.tiene_lote ? "✓" : "—"),
        width: 60,
      },
      {
        header: "Venc.",
        filterValue: (row) => (row.tiene_vencimiento ? "Si" : "No"),
        sortValue: (row) => (row.tiene_vencimiento ? "Si" : "No"),
        render: (row) => (row.tiene_vencimiento ? "✓" : "—"),
        width: 60,
      },
      {
        header: "Gestionar lotes",
        width: 130,
        render: (row) =>
          skuManejaLotes(row) ? (
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => setManagingSku(row)}
            >
              <PackagePlus size={14} /> Lotes ({Number(row.lotes_count || 0)})
            </button>
          ) : (
            <span className="text-sm text-gray-400">No aplica</span>
          ),
      },
    ],
    [],
  );

  return (
    <>
      <GenericCatalogPage
        title="SKUs"
        subtitle="Catálogo de productos/materiales por categoría"
        endpoint="/catalogos/skus"
        queryKey={["skus", "catalogo"]}
        columns={columns}
        FormComponent={SkuForm}
        extraActions={
          <>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => setBulkOpen(true)}
            >
              <Upload size={14} /> Carga masiva SKUs
            </button>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => setBulkLotesOpen(true)}
            >
              <Upload size={14} /> Carga masiva Lotes
            </button>
          </>
        }
      />

      <LotesManagerModal
        sku={managingSku}
        open={!!managingSku}
        onClose={() => setManagingSku(null)}
      />

      <ExcelBulkUploadModal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        title="Carga masiva de SKUs"
        description="Descarga una sola plantilla con 3 hojas: Carga_SKUs, Carga_Lotes y SKUs_Actuales (referencia)."
        templateEndpoint="/catalogos/skus/import/template"
        importEndpoint="/catalogos/skus/import/excel"
        templateFileName={`plantilla_skus_${Date.now()}.xlsx`}
        submitLabel="Procesar SKUs"
        helpItems={[
          "Paso 1 - Descarga la plantilla. Solo trae 3 hojas: Carga_SKUs, Carga_Lotes y SKUs_Actuales (referencia).",
          "Paso 2 - En Carga_SKUs usa CREAR para nuevos o ACTUALIZAR para modificar. Para actualizar, copia NOMBRE_REFERENCIA desde SKUs_Actuales (referencia).",
          "Paso 3 - Si el SKU maneja lotes, completa tambien la hoja Carga_Lotes con SKU_REFERENCIA, CODIGO_LOTE y FECHA_VENCIMIENTO.",
          "Paso 4 - Sube el archivo. Si una fila falla, no se guarda nada.",
        ]}
        buildSuccessMessage={(summary) =>
          `Carga masiva de SKUs completada: ${Number(summary?.filas_procesadas || 0)} filas, ` +
          `${Number(summary?.creados || 0)} creados, ` +
          `${Number(summary?.actualizados || 0)} actualizados, ` +
          `${Number(summary?.lotes_creados || 0)} lotes creados, ` +
          `${Number(summary?.lotes_actualizados || 0)} lotes actualizados y ` +
          `${Number(summary?.lotes_reactivados || 0)} lotes reactivados.`
        }
        onSuccess={async () => {
          await queryClient.invalidateQueries({ queryKey: ["skus"] });
        }}
      />

      <ExcelBulkUploadModal
        open={bulkLotesOpen}
        onClose={() => setBulkLotesOpen(false)}
        title="Carga masiva de Lotes"
        description="Descarga la misma plantilla de 3 hojas y usa solo Carga_Lotes."
        templateEndpoint="/catalogos/skus/import/template"
        importEndpoint="/catalogos/lotes/import/excel"
        templateFileName={`plantilla_lotes_${Date.now()}.xlsx`}
        submitLabel="Procesar Lotes"
        helpItems={[
          "Paso 1 - Descarga la plantilla y abre la hoja Carga_Lotes.",
          "Paso 2 - Copia el SKU_REFERENCIA exacto desde la hoja SKUs_Actuales (referencia).",
          "Paso 3 - Agrega CODIGO_LOTE y FECHA_VENCIMIENTO. Si el SKU tiene vencimiento, la fecha es obligatoria.",
          "Paso 4 - Si el lote ya existe, se actualiza; si estaba inactivo, se reactiva.",
        ]}
        buildSuccessMessage={(summary) =>
          `Lotes cargados: ${Number(summary?.creados || 0)} creados, ` +
          `${Number(summary?.actualizados || 0)} actualizados y ` +
          `${Number(summary?.reactivados || 0)} reactivados.`
        }
        onSuccess={async () => {
          await queryClient.invalidateQueries({ queryKey: ["skus"] });
        }}
      />
    </>
  );
}
