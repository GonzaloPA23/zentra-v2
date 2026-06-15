import { useEffect, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  Eye,
  FileSpreadsheet,
  Loader2,
  Pencil,
  Plus,
  Save,
  Trash2,
  Upload,
} from "lucide-react";
import api, { getMensajeError } from "../utils/api";
import { useAuth } from "../context/AuthContext";
import ConfirmDialog from "../components/ConfirmDialog";
import ExcelBulkUploadModal from "../components/ExcelBulkUploadModal";
import Modal from "../components/Modal";
import SearchableSelect from "../components/SearchableSelect";
import SortableFilterHeader from "../components/SortableFilterHeader";
import { formatSafeDate, toSafeDateInputValue } from "../utils/date";
import { downloadBlobResponse, getBlobErrorMessage } from "../utils/download";

const ESTADOS = {
  pendiente: "badge-yellow",
  en_transito: "badge-blue",
  aprobado: "badge-green",
  rechazado: "badge-red",
};

const LABELS = {
  pendiente: "Pendiente",
  en_transito: "En tránsito",
  aprobado: "Aprobado",
  rechazado: "Rechazado",
};

const EMPTY_FILTERS = {
  fecha_ini: "",
  fecha_fin: "",
  q_almacen_origen: "",
  q_almacen_destino: "",
  q_categoria: "",
  q_tipo_accion: "",
  q_sku: "",
  q_estado: "",
  q_registrado_por: "",
  q_nro_guia: "",
  sort_by: "fecha",
  sort_dir: "desc",
  page: 1,
};

const STOCK_INICIAL_DEFAULTS = {
  almacen_id: "",
  categoria_id: "",
  sku_id: "",
  lote_id: "",
  codigo_lote: "",
  fecha_vencimiento: "",
  cantidad: "",
  observaciones: "",
};

const NUEVO_LOTE_OPTION = "__nuevo__";

function buildSearchOptions(rows = [], labelBuilder, searchBuilder) {
  return rows.map((row) => ({
    value: String(row.id),
    label: labelBuilder(row),
    searchText: searchBuilder ? searchBuilder(row) : labelBuilder(row),
    raw: row,
  }));
}

function parseFlag(value) {
  return value === true || value === 1 || value === "1";
}

function nextSortState(current, key) {
  if (current.sort_by === key) {
    return {
      sort_by: key,
      sort_dir: current.sort_dir === "asc" ? "desc" : "asc",
    };
  }

  return { sort_by: key, sort_dir: key === "fecha" ? "desc" : "asc" };
}

function StockInicialModal({ open, onClose, onSaved }) {
  const {
    control,
    register,
    handleSubmit,
    reset,
    setValue,
    clearErrors,
    formState: { errors },
  } = useForm({
    defaultValues: STOCK_INICIAL_DEFAULTS,
  });

  const almacenId = useWatch({ control, name: "almacen_id" });
  const categoriaId = useWatch({ control, name: "categoria_id" });
  const skuId = useWatch({ control, name: "sku_id" });
  const loteId = useWatch({ control, name: "lote_id" });
  const codigoLote = useWatch({ control, name: "codigo_lote" });

  // Almacenes filtrados por categoria - usa endpoint con stock de esa categoria
  const { data: almacenes = [] } = useQuery({
    queryKey: ["stock-inicial-almacenes", categoriaId || ""],
    queryFn: () => {
      const params = new URLSearchParams();
      if (categoriaId) params.set("categoria_id", categoriaId);
      return api
        .get(`/registros/stock-inicial/almacenes?${params.toString()}`)
        .then((r) => r.data.datos);
    },
    enabled: open,
  });
  const { data: categorias = [] } = useQuery({
    queryKey: ["categorias"],
    queryFn: () =>
      api.get("/catalogos/categorias").then((response) => response.data.datos),
    enabled: open,
  });

  const almacenSeleccionado = useMemo(
    () => almacenes.find((almacen) => String(almacen.id) === String(almacenId)),
    [almacenId, almacenes],
  );
  const zona = almacenSeleccionado?.zona || "";

  const { data: skus = [] } = useQuery({
    queryKey: ["stock-inicial-skus", categoriaId || "", zona || ""],
    queryFn: () => {
      const params = new URLSearchParams({
        categoria_id: categoriaId,
        zona,
      });
      return api
        .get(`/catalogos/skus?${params.toString()}`)
        .then((response) => response.data.datos);
    },
    enabled: open && !!categoriaId && !!zona,
  });

  const skuSeleccionado = useMemo(
    () => skus.find((sku) => String(sku.id) === String(skuId)),
    [skuId, skus],
  );
  const skuManejaLote = parseFlag(skuSeleccionado?.tiene_lote);
  const skuManejaVencimiento = parseFlag(skuSeleccionado?.tiene_vencimiento);

  const {
    data: lotes = [],
    isFetching: loadingLotes,
    isError: lotesQueryFailed,
    error: lotesQueryError,
  } = useQuery({
    queryKey: ["stock-inicial-lotes", skuId || ""],
    queryFn: () =>
      api
        .get(`/catalogos/lotes?sku_id=${skuId}`)
        .then((response) => response.data.datos),
    enabled: open && !!skuId && skuManejaLote,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
  });

  const loteSeleccionado = useMemo(
    () => lotes.find((lote) => String(lote.id) === String(loteId)),
    [loteId, lotes],
  );
  const hasSelectedExistingLote = !!loteId && loteId !== NUEVO_LOTE_OPTION;
  const fechaBloqueada = !!loteSeleccionado?.fecha_vencimiento;

  const stockInicialMutation = useMutation({
    mutationFn: (payload) => api.post("/registros/stock-inicial", payload),
  });

  useEffect(() => {
    if (!open) {
      reset(STOCK_INICIAL_DEFAULTS);
      stockInicialMutation.reset();
    }
  }, [open, reset, stockInicialMutation]);

  useEffect(() => {
    setValue("sku_id", "");
    setValue("lote_id", "");
    setValue("codigo_lote", "");
    setValue("fecha_vencimiento", "");
  }, [almacenId, setValue]);

  useEffect(() => {
    // Al cambiar categoria, resetear almacen y SKU ya que la lista de almacenes cambia
    setValue("almacen_id", "");
    setValue("sku_id", "");
    setValue("lote_id", "");
    setValue("codigo_lote", "");
    setValue("fecha_vencimiento", "");
  }, [categoriaId, setValue]);

  useEffect(() => {
    setValue("lote_id", "");
    setValue("codigo_lote", "");
    setValue("fecha_vencimiento", "");
  }, [setValue, skuId]);

  useEffect(() => {
    if (!skuManejaLote) {
      setValue("lote_id", "");
      setValue("codigo_lote", "");
      setValue("fecha_vencimiento", "");
      clearErrors(["lote_id", "fecha_vencimiento"]);
    }
  }, [clearErrors, setValue, skuManejaLote]);

  useEffect(() => {
    if (loteSeleccionado?.fecha_vencimiento) {
      setValue(
        "fecha_vencimiento",
        toSafeDateInputValue(loteSeleccionado.fecha_vencimiento),
        {
          shouldValidate: true,
        },
      );
      clearErrors("fecha_vencimiento");
      return;
    }

    if (loteId) {
      setValue("fecha_vencimiento", "", { shouldValidate: true });
    }
  }, [clearErrors, loteId, loteSeleccionado?.fecha_vencimiento, setValue]);

  const almacenesOptions = buildSearchOptions(
    almacenes,
    (almacen) =>
      almacen.stock_total !== undefined
        ? `${almacen.nombre} · ${almacen.ciudad_nombre || ""} · ${almacen.zona || ""}`
        : `${almacen.nombre} · ${almacen.ciudad_nombre || ""}`,
    (almacen) =>
      `${almacen.nombre} ${almacen.ciudad_nombre || ""} ${almacen.zona || ""}`,
  );
  const categoriaOptions = buildSearchOptions(
    categorias,
    (categoria) => categoria.nombre,
    (categoria) => `${categoria.nombre} ${categoria.descripcion || ""}`,
  );
  const skuOptions = buildSearchOptions(
    skus,
    (sku) => (sku.codigo ? `${sku.nombre} (${sku.codigo})` : sku.nombre),
    (sku) => `${sku.nombre} ${sku.codigo || ""} ${sku.unidad || ""}`,
  );
  const loteOptions = buildSearchOptions(
    [
      {
        id: NUEVO_LOTE_OPTION,
        codigo_lote: "Crear nuevo lote manualmente",
        fecha_vencimiento: null,
      },
      ...lotes,
    ],
    (lote) =>
      lote.fecha_vencimiento
        ? `${lote.codigo_lote} · vence ${toSafeDateInputValue(lote.fecha_vencimiento)}`
        : lote.codigo_lote,
    (lote) => `${lote.codigo_lote} ${lote.fecha_vencimiento || ""}`,
  );

  const onSubmit = async (data) => {
    try {
      const response = await stockInicialMutation.mutateAsync({
        almacen_id: data.almacen_id,
        categoria_id: data.categoria_id,
        sku_id: data.sku_id,
        lote_id: hasSelectedExistingLote ? data.lote_id : null,
        codigo_lote: data.codigo_lote || null,
        fecha_vencimiento: data.fecha_vencimiento || null,
        cantidad: data.cantidad,
        observaciones: data.observaciones || null,
      });

      const stockActual = Number(response.data?.datos?.stock_actual || 0);
      toast.success(
        `Stock inicial registrado. Stock actual: ${stockActual.toLocaleString()}`,
      );
      onSaved?.();
      onClose();
    } catch (error) {
      toast.error(getMensajeError(error));
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Cargar stock inicial" size="lg">
      <form onSubmit={handleSubmit(onSubmit)}>
        <div className="modal-body space-y-4">
          <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
            Este ingreso suma stock directo al almacen elegido y deja
            trazabilidad en auditoria.
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="label">
                Categoria <span className="text-red-500">*</span>
              </label>
              <SearchableSelect
                control={control}
                name="categoria_id"
                rules={{ required: "Requerido" }}
                options={categoriaOptions}
                placeholder="Seleccionar categoria..."
                emptyText="Sin categorias disponibles"
                disabled={stockInicialMutation.isPending}
              />
              {errors.categoria_id && (
                <p className="error-msg">{errors.categoria_id.message}</p>
              )}
            </div>

            <div>
              <label className="label">
                Almacen <span className="text-red-500">*</span>
              </label>
              <SearchableSelect
                control={control}
                name="almacen_id"
                rules={{ required: "Requerido" }}
                options={almacenesOptions}
                placeholder="Seleccionar almacen..."
                emptyText="Sin almacenes disponibles"
                disabled={stockInicialMutation.isPending}
              />
              {errors.almacen_id && (
                <p className="error-msg">{errors.almacen_id.message}</p>
              )}
            </div>

            <div className="md:col-span-2">
              <label className="label">
                SKU <span className="text-red-500">*</span>
              </label>
              <SearchableSelect
                control={control}
                name="sku_id"
                rules={{ required: "Requerido" }}
                options={skuOptions}
                placeholder={
                  categoriaId
                    ? "Seleccionar SKU..."
                    : "Primero selecciona categoria"
                }
                emptyText="Sin SKUs disponibles"
                disabled={
                  !categoriaId || !zona || stockInicialMutation.isPending
                }
              />
              {errors.sku_id && (
                <p className="error-msg">{errors.sku_id.message}</p>
              )}
            </div>
          </div>

          {skuSeleccionado && (
            <div className="flex flex-wrap gap-2">
              <span className="badge-blue text-xs">Zona: {zona || "-"}</span>
              {skuSeleccionado.codigo && (
                <span className="badge-gray text-xs">
                  Codigo: {skuSeleccionado.codigo}
                </span>
              )}
              {skuManejaLote && (
                <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">
                  Maneja lote
                </span>
              )}
            </div>
          )}

          {skuManejaLote && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="label">Lote existente</label>
                <SearchableSelect
                  control={control}
                  name="lote_id"
                  rules={{
                    validate: (value) =>
                      !skuManejaLote ||
                      (String(value || "").trim() &&
                        value !== NUEVO_LOTE_OPTION) ||
                      String(codigoLote || "").trim()
                        ? true
                        : "Selecciona un lote o registra un nuevo codigo",
                  }}
                  options={loteOptions}
                  placeholder={
                    loadingLotes
                      ? "Cargando lotes..."
                      : lotes.length
                        ? `Seleccionar lote (${lotes.length})...`
                        : "Sin lotes creados"
                  }
                  emptyText={
                    lotesQueryFailed
                      ? getMensajeError(lotesQueryError)
                      : "Sin lotes disponibles"
                  }
                  disabled={!skuId || stockInicialMutation.isPending}
                />
                {errors.lote_id && (
                  <p className="error-msg">{errors.lote_id.message}</p>
                )}
              </div>

              <div>
                <label className="label">Nuevo codigo de lote</label>
                <input
                  className="input"
                  placeholder="Escribe un codigo si el lote aun no existe"
                  disabled={
                    hasSelectedExistingLote ||
                    !skuId ||
                    stockInicialMutation.isPending
                  }
                  {...register("codigo_lote")}
                />
                <p className="mt-1 text-xs text-gray-400">
                  Si no seleccionas un lote, este codigo se crea al guardar.
                </p>
              </div>

              <div>
                <label className="label">
                  Fecha de vencimiento
                  {skuManejaVencimiento && (
                    <span className="text-red-500"> *</span>
                  )}
                </label>
                <input
                  type="date"
                  className={`input ${errors.fecha_vencimiento ? "input-error" : ""} ${fechaBloqueada ? "cursor-not-allowed bg-gray-100 text-gray-500" : ""}`}
                  readOnly={fechaBloqueada}
                  disabled={stockInicialMutation.isPending}
                  {...register("fecha_vencimiento", {
                    validate: (value) =>
                      !skuManejaVencimiento ||
                      loteSeleccionado?.fecha_vencimiento ||
                      String(value || "").trim()
                        ? true
                        : "Requerido",
                  })}
                />
                {skuManejaVencimiento && (
                  <p className="mt-1 text-xs text-gray-400">
                    Si el lote elegido ya tiene fecha, se completa
                    automaticamente.
                  </p>
                )}
                {errors.fecha_vencimiento && (
                  <p className="error-msg">
                    {errors.fecha_vencimiento.message}
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="label">
                Cantidad <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                min="1"
                step="1"
                className={`input ${errors.cantidad ? "input-error" : ""}`}
                placeholder="0"
                {...register("cantidad", {
                  required: "Requerido",
                  min: { value: 1, message: "Debe ser un numero entero mayor a 0" },
                  validate: (value) =>
                    Number.isInteger(Number(value)) || "Debe ser un numero entero",
                })}
              />
              {errors.cantidad && (
                <p className="error-msg">{errors.cantidad.message}</p>
              )}
            </div>

            <div>
              <label className="label">Observaciones</label>
              <input
                className="input"
                placeholder="Opcional"
                {...register("observaciones")}
              />
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={stockInicialMutation.isPending}
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={stockInicialMutation.isPending}
          >
            {stockInicialMutation.isPending ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Guardando...
              </>
            ) : (
              <>
                <Save size={14} /> Registrar stock inicial
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DetalleExpandido({ row }) {
  return (
    <tr className="bg-blue-50/40">
      <td colSpan={11} className="px-4 py-4">
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-3 xl:grid-cols-6">
            <div>
              <span className="text-xs uppercase text-gray-500">
                ID registro
              </span>
              <p className="font-medium text-gray-900">{row.id}</p>
            </div>
            <div>
              <span className="text-xs uppercase text-gray-500">Acción</span>
              <p className="font-medium text-gray-900">{row.accion || "-"}</p>
            </div>
            <div>
              <span className="text-xs uppercase text-gray-500">Zona</span>
              <p className="font-medium text-gray-900">{row.zona || "-"}</p>
            </div>
            <div>
              <span className="text-xs uppercase text-gray-500">Ciudad</span>
              <p className="font-medium text-gray-900">
                {row.ciudad_nombre || "-"}
              </p>
            </div>
            <div>
              <span className="text-xs uppercase text-gray-500">
                Personal receptor
              </span>
              <p className="font-medium text-gray-900">
                {row.personal_receptor_nombre || "-"}
              </p>
            </div>
            <div>
              <span className="text-xs uppercase text-gray-500">Indicador</span>
              <p className="font-medium text-gray-900">
                {row.indicador_nombre || "-"}
              </p>
            </div>
            <div>
              <span className="text-xs uppercase text-gray-500">Nro. guía</span>
              <p className="font-medium text-gray-900">{row.nro_guia || "-"}</p>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white">
            <div className="border-b border-gray-200 px-4 py-3">
              <h4 className="font-semibold text-gray-800">
                Líneas del registro
              </h4>
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
                      <td>{detail.tipo_mercaderia_nombre || "-"}</td>
                      <td
                        className="max-w-[280px] truncate"
                        title={detail.sku_nombre || ""}
                      >
                        {detail.sku_nombre || "-"}
                      </td>
                      <td>{detail.codigo_lote || "-"}</td>
                      <td>{formatSafeDate(detail.fecha_vencimiento)}</td>
                      <td>{Number(detail.cantidad || 0).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <span className="text-xs uppercase text-gray-500">
                Observaciones
              </span>
              <p className="mt-1 rounded-lg bg-white p-3 text-sm text-gray-700">
                {row.observaciones || "-"}
              </p>
            </div>

            {row.foto_guia && (
              <div>
                <span className="text-xs uppercase text-gray-500">
                  Foto guía
                </span>
                <div className="mt-1">
                  <a
                    href={`/uploads/${row.foto_guia}`}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-secondary btn-sm inline-flex"
                  >
                    <Eye size={13} /> Ver archivo
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}

function RegistroRow({
  row,
  expanded,
  onToggle,
  canEdit,
  canDelete,
  onDelete,
  onDownloadDetail,
}) {
  const navigate = useNavigate();

  return (
    <>
      <tr className="cursor-pointer" onClick={() => onToggle(row.id)}>
        <td className="font-semibold text-gray-900">{row.id}</td>
        <td className="whitespace-nowrap">{formatSafeDate(row.fecha)}</td>
        <td className="max-w-[180px] truncate" title={row.almacen_origen || ""}>
          {row.almacen_origen || "-"}
        </td>
        <td
          className="max-w-[180px] truncate"
          title={row.almacen_destino || ""}
        >
          {row.almacen_destino || "-"}
        </td>
        <td>{row.categoria_nombre || "-"}</td>
        <td>
          <span className="badge-gray badge">{row.tipo_accion || "-"}</span>
        </td>
        <td className="max-w-[260px] truncate" title={row.sku_resumen || ""}>
          {row.sku_resumen || "-"}
        </td>
        <td className="font-medium">
          {Number(row.cantidad_total || 0).toLocaleString()}
        </td>
        <td>
          <span className={ESTADOS[row.estado] || "badge-gray"}>
            {LABELS[row.estado] || row.estado}
          </span>
        </td>
        <td className="text-xs text-gray-500">{row.registrado_por || "-"}</td>
        <td>
          <div
            className="flex items-center gap-1"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="btn-icon text-gray-500"
              title="Descargar detalle"
              onClick={() => onDownloadDetail(row.id)}
            >
              <Download size={14} />
            </button>
            {canEdit && (
              <button
                type="button"
                className="btn-icon text-blue-500"
                title={row.estado === "aprobado" ? "Ver" : "Editar"}
                onClick={() => navigate(`/registros/${row.id}/editar`)}
              >
                {row.estado === "aprobado" ? (
                  <Eye size={14} />
                ) : (
                  <Pencil size={14} />
                )}
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                className="btn-icon text-red-500"
                title="Eliminar"
                onClick={() => onDelete(row)}
              >
                <Trash2 size={14} />
              </button>
            )}
            <button
              type="button"
              className="btn-icon text-gray-400"
              title={expanded ? "Ocultar detalle" : "Ver detalle"}
              onClick={() => onToggle(row.id)}
            >
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </div>
        </td>
      </tr>
      {expanded && <DetalleExpandido row={row} />}
    </>
  );
}

export default function RegistrosPageV2() {
  const { hasRole } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [expandedId, setExpandedId] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [stockInicialOpen, setStockInicialOpen] = useState(false);
  const [stockInicialBulkOpen, setStockInicialBulkOpen] = useState(false);

  const canCreate = hasRole("superadmin", "admin", "almacenero");
  const canEdit = hasRole("superadmin", "admin");
  const canDelete = hasRole("superadmin", "admin");
  const canDownload = hasRole("superadmin", "admin", "supervisor");

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["registros", filters],
    queryFn: () => {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });
      return api
        .get(`/registros?${params.toString()}`)
        .then((response) => response.data);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (registroId) => api.delete(`/registros/${registroId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["registros"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["auditoria-registros"] });
      toast.success("Registro eliminado");
      setDeleting(null);
      setExpandedId(null);
    },
    onError: (error) => {
      toast.error(getMensajeError(error));
      setDeleting(null);
    },
  });

  const rows = Array.isArray(data?.datos) ? data.datos : [];
  const pagination = data?.paginacion ?? {};
  const sortConfig = { key: filters.sort_by, direction: filters.sort_dir };

  const updateFilter = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value, page: 1 }));
  };

  const handleSort = (key) => {
    setFilters((prev) => ({ ...prev, ...nextSortState(prev, key), page: 1 }));
  };

  const handleExport = async (endpoint, fallbackName) => {
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });

      const response = await api.get(`${endpoint}?${params.toString()}`, {
        responseType: "blob",
      });
      downloadBlobResponse(response, fallbackName);
    } catch (error) {
      toast.error(await getBlobErrorMessage(error));
    }
  };

  const handleDownloadDetail = async (registroId) => {
    try {
      const response = await api.get(`/registros/${registroId}/export/excel`, {
        responseType: "blob",
      });
      downloadBlobResponse(response, `zentra_registro_${registroId}.xlsx`);
    } catch (error) {
      toast.error(await getBlobErrorMessage(error));
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Registros</h1>
          <p className="mt-1 text-sm text-gray-500">
            Una fila por guía, con detalle descargable y líneas expandibles.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {canDownload && (
            <>
              <button
                type="button"
                onClick={() =>
                  handleExport(
                    "/registros/export/excel",
                    `zentra_registros_${Date.now()}.xlsx`,
                  )
                }
                className="btn-secondary btn-sm"
              >
                <FileSpreadsheet size={14} /> Exportar Excel
              </button>
              <button
                type="button"
                onClick={() =>
                  handleExport(
                    "/registros/export/lotes/excel",
                    `zentra_lotes_${Date.now()}.xlsx`,
                  )
                }
                className="btn-secondary btn-sm"
              >
                <Download size={14} /> Exportar lotes
              </button>
              <button
                type="button"
                onClick={() =>
                  handleExport(
                    "/registros/export/stock/excel",
                    `zentra_stock_sku_lote_${Date.now()}.xlsx`,
                  )
                }
                className="btn-secondary btn-sm"
              >
                <FileSpreadsheet size={14} /> Reporte stock
              </button>
              <button
                type="button"
                onClick={() =>
                  handleExport(
                    "/registros/export/stock-inicial/excel",
                    `zentra_stock_inicial_${Date.now()}.xlsx`,
                  )
                }
                className="btn-secondary btn-sm"
              >
                <FileSpreadsheet size={14} /> Reporte stock inicial
              </button>
            </>
          )}
          {canCreate && (
            <>
              <button
                type="button"
                onClick={() => setStockInicialBulkOpen(true)}
                className="btn-secondary btn-sm"
              >
                <Upload size={14} /> Carga masiva stock
              </button>
              <button
                type="button"
                onClick={() => setStockInicialOpen(true)}
                className="btn-secondary btn-sm"
              >
                <Plus size={14} /> Stock inicial
              </button>
              <button
                type="button"
                onClick={() => navigate("/registros/nuevo")}
                className="btn-primary btn-sm"
              >
                <Plus size={14} /> Nuevo registro
              </button>
            </>
          )}
        </div>
      </div>

      <div className="card-sm">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className="label">Fecha inicio</label>
            <input
              type="date"
              className="input"
              value={filters.fecha_ini}
              onChange={(event) =>
                updateFilter("fecha_ini", event.target.value)
              }
            />
          </div>
          <div>
            <label className="label">Fecha fin</label>
            <input
              type="date"
              className="input"
              value={filters.fecha_fin}
              onChange={(event) =>
                updateFilter("fecha_fin", event.target.value)
              }
            />
          </div>
          <div className="flex items-end">
            <button
              type="button"
              className="btn-secondary w-full"
              onClick={() => setFilters(EMPTY_FILTERS)}
            >
              Limpiar filtros
            </button>
          </div>
        </div>
      </div>

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <SortableFilterHeader label="ID" filterType="none" />
              <SortableFilterHeader
                label="Fecha"
                sortKey="fecha"
                sortConfig={sortConfig}
                onSort={handleSort}
                filterType="none"
              />
              <SortableFilterHeader
                label="Almacén Origen"
                sortKey="almacen_origen"
                sortConfig={sortConfig}
                onSort={handleSort}
                filterValue={filters.q_almacen_origen}
                onFilterChange={(value) =>
                  updateFilter("q_almacen_origen", value)
                }
              />
              <SortableFilterHeader
                label="Almacén Destino"
                sortKey="almacen_destino"
                sortConfig={sortConfig}
                onSort={handleSort}
                filterValue={filters.q_almacen_destino}
                onFilterChange={(value) =>
                  updateFilter("q_almacen_destino", value)
                }
              />
              <SortableFilterHeader
                label="Categoría"
                sortKey="categoria"
                sortConfig={sortConfig}
                onSort={handleSort}
                filterValue={filters.q_categoria}
                onFilterChange={(value) => updateFilter("q_categoria", value)}
              />
              <SortableFilterHeader
                label="Tipo Acción"
                sortKey="tipo_accion"
                sortConfig={sortConfig}
                onSort={handleSort}
                filterValue={filters.q_tipo_accion}
                onFilterChange={(value) => updateFilter("q_tipo_accion", value)}
              />
              <SortableFilterHeader
                label="SKU(s)"
                sortKey="sku"
                sortConfig={sortConfig}
                onSort={handleSort}
                filterValue={filters.q_sku}
                onFilterChange={(value) => updateFilter("q_sku", value)}
              />
              <SortableFilterHeader
                label="Cantidad"
                sortKey="cantidad"
                sortConfig={sortConfig}
                onSort={handleSort}
                filterType="none"
              />
              <SortableFilterHeader
                label="Estado"
                sortKey="estado"
                sortConfig={sortConfig}
                onSort={handleSort}
                filterValue={filters.q_estado}
                onFilterChange={(value) => updateFilter("q_estado", value)}
                placeholder="Todos"
                options={[
                  { value: "pendiente", label: "Pendiente" },
                  { value: "en_transito", label: "En tránsito" },
                  { value: "aprobado", label: "Aprobado" },
                  { value: "rechazado", label: "Rechazado" },
                ]}
              />
              <SortableFilterHeader
                label="Registrado por"
                sortKey="registrado_por"
                sortConfig={sortConfig}
                onSort={handleSort}
                filterValue={filters.q_registrado_por}
                onFilterChange={(value) =>
                  updateFilter("q_registrado_por", value)
                }
              />
              <SortableFilterHeader label="Acciones" filterType="none" />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={11} className="py-12 text-center text-gray-400">
                  <div className="flex items-center justify-center gap-2">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-400 border-t-transparent" />
                    Cargando registros...
                  </div>
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={11} className="py-12 text-center text-gray-400">
                  No hay registros para mostrar.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <RegistroRow
                  key={row.id}
                  row={row}
                  expanded={expandedId === row.id}
                  onToggle={(registroId) =>
                    setExpandedId((prev) =>
                      prev === registroId ? null : registroId,
                    )
                  }
                  canEdit={canEdit}
                  canDelete={
                    canDelete &&
                    (row.estado !== "aprobado" || hasRole("superadmin"))
                  }
                  onDelete={setDeleting}
                  onDownloadDetail={handleDownloadDetail}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {pagination.pages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>
            {pagination.total} registros totales
            {isFetching && !isLoading ? " · Actualizando..." : ""}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="btn-icon"
              disabled={filters.page <= 1}
              onClick={() =>
                setFilters((prev) => ({ ...prev, page: prev.page - 1 }))
              }
            >
              <ChevronLeft size={16} />
            </button>
            <span className="px-3">
              Pág. {filters.page} / {pagination.pages}
            </span>
            <button
              type="button"
              className="btn-icon"
              disabled={filters.page >= pagination.pages}
              onClick={() =>
                setFilters((prev) => ({ ...prev, page: prev.page + 1 }))
              }
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      <StockInicialModal
        open={stockInicialOpen}
        onClose={() => setStockInicialOpen(false)}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: ["dashboard"] });
          queryClient.invalidateQueries({ queryKey: ["registros"] });
        }}
      />

      <ExcelBulkUploadModal
        open={stockInicialBulkOpen}
        onClose={() => setStockInicialBulkOpen(false)}
        title="Carga masiva de stock inicial"
        description="Carga y actualiza stock inicial por Excel usando nombres simples de almacen, categoria y SKU."
        templateEndpoint="/registros/stock-inicial/import/template"
        importEndpoint="/registros/stock-inicial/import/excel"
        templateFileName={`plantilla_stock_inicial_${Date.now()}.xlsx`}
        submitLabel="Procesar stock inicial"
        helpItems={[
          "Paso 1 — Descarga la plantilla. Tiene ejemplos en colores y hojas de referencia con nombres exactos.",
          "Paso 2 — Copia ALMACEN y SKU exactamente desde las hojas de referencia. Revisa la columna MANEJA_LOTE.",
          "Paso 3 — Si el SKU maneja lote: escribe CODIGO_LOTE. Si el lote no existe se crea automaticamente.",
          "Paso 4 — FECHA_VENCIMIENTO obligatoria si el lote es nuevo. Si el lote ya existe y tiene fecha, dejala vacia.",
          "Paso 5 — SUMAR agrega al stock actual. REEMPLAZAR fija el stock exacto en la cantidad indicada.",
          "Paso 6 — Si una fila falla, no se guarda nada (transaccional).",
        ]}
        buildSuccessMessage={(summary) =>
          `Carga masiva de stock inicial completada: ${Number(summary?.filas_procesadas || 0)} filas, ` +
          `${Number(summary?.sumados || 0)} en SUMAR, ` +
          `${Number(summary?.reemplazados || 0)} en REEMPLAZAR.`
        }
        onSuccess={async () => {
          await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
          await queryClient.invalidateQueries({ queryKey: ["registros"] });
        }}
      />

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleteMutation.mutate(deleting?.id)}
        loading={deleteMutation.isPending}
        title="Eliminar registro"
        message={`¿Eliminar el registro "${deleting?.nro_guia || deleting?.sku_resumen || ""}"? Esta acción no se puede deshacer.`}
      />
    </div>
  );
}
