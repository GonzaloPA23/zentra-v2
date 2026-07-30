import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "react-toastify";
import {
  ArrowLeft,
  Boxes,
  Download,
  Loader2,
  Plus,
  Save,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import api, { getMensajeError } from "../utils/api";
import SearchableSelect from "../components/SearchableSelect";
import { getPeruTodayDateInputValue, toSafeDateInputValue } from "../utils/date";
import { downloadBlobResponse, getBlobErrorMessage } from "../utils/download";

const ACCIONES = ["MERMA", "DESPACHO A CANJISTAS", "OTROS MOVIMIENTOS"];
const TIPO_ACCION_OPTIONS = [
  { value: "ENTRADA", label: "ENTRADA" },
  { value: "SALIDA", label: "SALIDA" },
];
const ZONA_OPTIONS = [
  { value: "LIMA", label: "LIMA" },
  { value: "PROVINCIA", label: "PROVINCIA" },
];

function buildEmptyDetail() {
  return {
    tipo_mercaderia_id: "",
    sku_id: "",
    lote_id: "",
    fecha_vencimiento: "",
    cantidad: "",
  };
}

function buildSearchOptions(rows = [], labelBuilder, searchBuilder) {
  return rows.map((row) => ({
    value: String(row.id),
    label: labelBuilder(row),
    searchText: searchBuilder ? searchBuilder(row) : labelBuilder(row),
    raw: row,
  }));
}

function appendCurrentOption(options = [], value, label, searchText = label) {
  const normalizedValue =
    value === null || value === undefined || value === "" ? "" : String(value);
  const normalizedLabel = String(label || "").trim();
  if (!normalizedValue || !normalizedLabel) return options;
  if (options.some((option) => String(option.value) === normalizedValue))
    return options;

  return [
    {
      value: normalizedValue,
      label: normalizedLabel,
      searchText: searchText || normalizedLabel,
      persisted: true,
    },
    ...options,
  ];
}

function parseFlag(value) {
  return value === true || value === 1 || value === "1";
}

function normalizeLookupText(value) {
  return String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function isTgMolitaliaIndicator(indicator) {
  return normalizeLookupText(indicator?.nombre) === "TG MOLITALIA";
}

function ModalCrearLote({ skuId, skuNombre, onClose, onCreated }) {
  const [codigoLote, setCodigoLote] = useState("");
  const [fechaVencimiento, setFechaVencimiento] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSave = async () => {
    if (!codigoLote.trim()) {
      setError("El código del lote es obligatorio");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const response = await api.post("/catalogos/lotes", {
        sku_id: skuId,
        codigo_lote: codigoLote.trim(),
        fecha_vencimiento: fechaVencimiento || null,
      });
      const loteCreado = response.data?.datos || {};
      onCreated({
        id: loteCreado.id || response.data.id,
        codigo_lote: loteCreado.codigo_lote || codigoLote.trim(),
        fecha_vencimiento:
          loteCreado.fecha_vencimiento ?? fechaVencimiento ?? null,
      });
      toast.success("Lote creado correctamente");
    } catch (err) {
      setError(getMensajeError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="modal-overlay"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="modal-box max-w-md">
        <div className="modal-header">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Nuevo lote</h2>
            <p className="mt-0.5 text-xs text-gray-500">{skuNombre}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-icon text-gray-400"
          >
            <X size={18} />
          </button>
        </div>

        <div className="modal-body space-y-4">
          <div>
            <label className="label">
              Código de lote <span className="text-red-500">*</span>
            </label>
            <input
              className={`input ${error ? "input-error" : ""}`}
              value={codigoLote}
              onChange={(event) => setCodigoLote(event.target.value)}
              placeholder="Ej: LOTE-001"
              autoFocus
            />
          </div>
          <div>
            <label className="label">Fecha de vencimiento</label>
            <input
              type="date"
              className="input"
              value={fechaVencimiento}
              onChange={(event) => setFechaVencimiento(event.target.value)}
            />
            <p className="mt-1 text-xs text-gray-400">
              Si se registra aquí, luego quedará bloqueada en la línea del
              registro.
            </p>
          </div>
          {error && <p className="error-msg">{error}</p>}
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Guardando...
              </>
            ) : (
              <>
                <Plus size={14} /> Crear lote
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function DetalleRow({
  index,
  control,
  register,
  setValue,
  clearErrors,
  getValues,
  categoriaId,
  zona,
  tiposMercaderia,
  remove,
  canRemove,
  disabled,
  errors,
}) {
  const queryClient = useQueryClient();
  const [modalLoteOpen, setModalLoteOpen] = useState(false);
  const tipoMercaderiaId = useWatch({
    control,
    name: `detalles.${index}.tipo_mercaderia_id`,
  });
  const skuId = useWatch({ control, name: `detalles.${index}.sku_id` });
  const loteId = useWatch({ control, name: `detalles.${index}.lote_id` });
  const previousTipoRef = useRef(tipoMercaderiaId);
  const previousSkuRef = useRef(skuId);
  const previousLoteRef = useRef(loteId);

  const { data: skus = [] } = useQuery({
    queryKey: [
      "registro-line-skus",
      categoriaId || "",
      tipoMercaderiaId || "",
      zona || "",
    ],
    queryFn: () => {
      const params = new URLSearchParams({
        categoria_id: categoriaId,
        tipo_mercaderia_id: tipoMercaderiaId,
        zona,
      });
      return api
        .get(`/catalogos/skus?${params.toString()}`)
        .then((response) => response.data.datos);
    },
    enabled: !!categoriaId && !!tipoMercaderiaId && !!zona,
  });

  const skuSeleccionado = useMemo(
    () => skus.find((sku) => String(sku.id) === String(skuId)),
    [skus, skuId],
  );
  const lotesQueryKey = ["registro-line-lotes", skuId || ""];
  const {
    data: lotes = [],
    refetch: refetchLotes,
    isFetching: loadingLotes,
    isError: lotesQueryFailed,
    error: lotesQueryError,
  } = useQuery({
    queryKey: lotesQueryKey,
    queryFn: () =>
      api
        .get(`/catalogos/lotes?sku_id=${skuId}`)
        .then((response) => response.data.datos),
    enabled: !!skuId && parseFlag(skuSeleccionado?.tiene_lote),
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
  });
  const loteSeleccionado = useMemo(
    () => lotes.find((lote) => String(lote.id) === String(loteId)),
    [lotes, loteId],
  );
  const skuManejaLote = parseFlag(skuSeleccionado?.tiene_lote);
  const skuManejaVencimiento = parseFlag(skuSeleccionado?.tiene_vencimiento);
  const fechaBloqueada = true;

  useEffect(() => {
    if (previousTipoRef.current === tipoMercaderiaId) return;
    previousTipoRef.current = tipoMercaderiaId;
    setValue(`detalles.${index}.sku_id`, "");
    setValue(`detalles.${index}.lote_id`, "");
    setValue(`detalles.${index}.fecha_vencimiento`, "");
  }, [index, setValue, tipoMercaderiaId]);

  useEffect(() => {
    if (previousSkuRef.current === skuId) return;
    previousSkuRef.current = skuId;
    setValue(`detalles.${index}.lote_id`, "");
    setValue(`detalles.${index}.fecha_vencimiento`, "");
  }, [index, setValue, skuId]);

  useEffect(() => {
    if (!skuSeleccionado) return;
    if (!skuManejaLote) {
      setValue(`detalles.${index}.lote_id`, "");
      setValue(`detalles.${index}.fecha_vencimiento`, "");
      clearErrors([
        `detalles.${index}.lote_id`,
        `detalles.${index}.fecha_vencimiento`,
      ]);
      return;
    }

    if (!skuManejaVencimiento && !loteSeleccionado?.fecha_vencimiento) {
      setValue(`detalles.${index}.fecha_vencimiento`, "");
      clearErrors(`detalles.${index}.fecha_vencimiento`);
    }
  }, [
    clearErrors,
    index,
    loteSeleccionado?.fecha_vencimiento,
    setValue,
    skuManejaLote,
    skuManejaVencimiento,
    skuSeleccionado,
  ]);

  useEffect(() => {
    if (previousLoteRef.current === loteId) return;
    previousLoteRef.current = loteId;

    if (!skuManejaLote) {
      setValue(`detalles.${index}.fecha_vencimiento`, "");
      clearErrors([
        `detalles.${index}.lote_id`,
        `detalles.${index}.fecha_vencimiento`,
      ]);
      return;
    }

    if (loteSeleccionado?.fecha_vencimiento) {
      setValue(
        `detalles.${index}.fecha_vencimiento`,
        toSafeDateInputValue(loteSeleccionado.fecha_vencimiento),
      );
      return;
    }

    setValue(`detalles.${index}.fecha_vencimiento`, "");
  }, [clearErrors, index, loteId, loteSeleccionado, setValue, skuManejaLote]);

  useEffect(() => {
    if (!skuManejaLote) {
      clearErrors([
        `detalles.${index}.lote_id`,
        `detalles.${index}.fecha_vencimiento`,
      ]);
      return;
    }

    if (!skuManejaVencimiento) {
      clearErrors(`detalles.${index}.fecha_vencimiento`);
    }
  }, [clearErrors, index, skuManejaLote, skuManejaVencimiento]);

  const tipoOptions = buildSearchOptions(
    tiposMercaderia,
    (tipo) => tipo.nombre,
    (tipo) => `${tipo.nombre} ${tipo.categoria_nombre || ""}`,
  );
  const skuOptions = buildSearchOptions(
    skus,
    (sku) => (sku.codigo ? `${sku.nombre} (${sku.codigo})` : sku.nombre),
    (sku) => `${sku.nombre} ${sku.codigo || ""} ${sku.unidad || ""}`,
  );
  const loteOptions = buildSearchOptions(
    lotes,
    (lote) =>
      lote.fecha_vencimiento
        ? `${lote.codigo_lote} · vence ${toSafeDateInputValue(lote.fecha_vencimiento)}`
        : lote.codigo_lote,
    (lote) => `${lote.codigo_lote} ${lote.fecha_vencimiento || ""}`,
  );

  const handleLoteCreated = async (nuevoLote) => {
    const loteNormalizado = {
      id: Number(nuevoLote.id),
      sku_id: Number(skuId),
      codigo_lote: nuevoLote.codigo_lote,
      fecha_vencimiento: nuevoLote.fecha_vencimiento
        ? toSafeDateInputValue(nuevoLote.fecha_vencimiento)
        : null,
      activo: 1,
    };

    queryClient.setQueryData(lotesQueryKey, (previous = []) => {
      const base = Array.isArray(previous)
        ? previous.filter(
            (item) => String(item.id) !== String(loteNormalizado.id),
          )
        : [];
      return [...base, loteNormalizado].sort((left, right) =>
        left.codigo_lote.localeCompare(right.codigo_lote),
      );
    });

    setValue(`detalles.${index}.lote_id`, String(loteNormalizado.id), {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
    setValue(
      `detalles.${index}.fecha_vencimiento`,
      loteNormalizado.fecha_vencimiento || "",
      {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: true,
      },
    );

    await queryClient.invalidateQueries({ queryKey: lotesQueryKey });
    await refetchLotes();
    setModalLoteOpen(false);
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50/70 p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h4 className="font-semibold text-gray-800">Línea {index + 1}</h4>
          <p className="text-xs text-gray-500">
            Tipo de mercadería, SKU, lote, vencimiento y cantidad.
          </p>
        </div>
        {canRemove && (
          <button
            type="button"
            className="btn-danger btn-sm"
            onClick={() => remove(index)}
            disabled={disabled}
          >
            <Trash2 size={14} /> Quitar
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <div>
          <label className="label">
            Tipo de mercadería <span className="text-red-500">*</span>
          </label>
          <SearchableSelect
            control={control}
            name={`detalles.${index}.tipo_mercaderia_id`}
            rules={{ required: "Requerido" }}
            options={tipoOptions}
            placeholder={
              categoriaId
                ? "Seleccionar tipo..."
                : "Primero selecciona categoría"
            }
            disabled={!categoriaId || disabled}
            emptyText="Sin tipos disponibles"
          />
          {errors?.tipo_mercaderia_id && (
            <p className="error-msg">{errors.tipo_mercaderia_id.message}</p>
          )}
        </div>

        <div>
          <label className="label">
            SKU <span className="text-red-500">*</span>
          </label>
          <SearchableSelect
            control={control}
            name={`detalles.${index}.sku_id`}
            rules={{ required: "Requerido" }}
            options={skuOptions}
            placeholder={
              tipoMercaderiaId
                ? `Seleccionar SKU (${skus.length})...`
                : "Primero selecciona tipo"
            }
            disabled={!tipoMercaderiaId || disabled}
            emptyText="Sin SKUs disponibles"
          />
          {errors?.sku_id && (
            <p className="error-msg">{errors.sku_id.message}</p>
          )}
        </div>

        <div>
          <label className="label">
            Lote
            {skuManejaLote && <span className="text-red-500"> *</span>}
          </label>
          <div className="flex gap-2">
            <SearchableSelect
              control={control}
              name={`detalles.${index}.lote_id`}
              rules={{
                validate: (value) =>
                  !skuManejaLote || String(value || "").trim()
                    ? true
                    : "Requerido",
              }}
              options={loteOptions}
              placeholder={
                !skuId
                  ? "Primero selecciona SKU"
                  : loadingLotes
                    ? "Cargando lotes..."
                    : skuManejaLote
                      ? `Seleccionar lote (${lotes.length})...`
                      : "Este SKU no maneja lotes"
              }
              disabled={!skuId || !skuManejaLote || disabled}
              emptyText={
                lotesQueryFailed
                  ? getMensajeError(lotesQueryError)
                  : skuManejaLote
                    ? "Sin lotes disponibles"
                    : "No aplica"
              }
              className="flex-1"
            />
            {skuManejaLote && (
              <button
                type="button"
                className="btn-primary btn-sm px-2.5"
                onClick={() => setModalLoteOpen(true)}
                disabled={!skuId || disabled}
                title="Crear lote"
              >
                <Plus size={15} />
              </button>
            )}
          </div>
          {skuSeleccionado && !skuManejaLote && (
            <p className="mt-1 text-xs text-gray-400">
              Este SKU no maneja lotes.
            </p>
          )}
          {lotesQueryFailed && skuManejaLote && (
            <p className="error-msg">
              No se pudieron cargar los lotes.{" "}
              {getMensajeError(lotesQueryError)}
            </p>
          )}
          {errors?.lote_id && (
            <p className="error-msg">{errors.lote_id.message}</p>
          )}
        </div>

        <div>
          <label className="label">
            Fecha de vencimiento
            {skuManejaLote && skuManejaVencimiento && (
              <span className="text-red-500"> *</span>
            )}
          </label>
          <input
            type="date"
            className={`input ${errors?.fecha_vencimiento ? "input-error" : ""} ${fechaBloqueada ? "cursor-not-allowed bg-gray-100 text-gray-500" : ""}`}
            readOnly={fechaBloqueada}
            disabled={!skuManejaLote || !skuManejaVencimiento || disabled}
            title="Esta fecha viene asociada al lote"
            {...register(`detalles.${index}.fecha_vencimiento`, {
              validate: (value) =>
                !skuManejaLote ||
                !skuManejaVencimiento ||
                String(value || "").trim()
                  ? true
                  : "Requerido",
            })}
          />
          {skuManejaLote && skuManejaVencimiento && (
            <p className="mt-1 text-xs text-gray-400">
              Se completa automaticamente desde el lote y no se puede editar
              aqui.
            </p>
          )}
          {skuSeleccionado && (!skuManejaLote || !skuManejaVencimiento) && (
            <p className="mt-1 text-xs text-gray-400">
              No aplica para este SKU.
            </p>
          )}
          {errors?.fecha_vencimiento && (
            <p className="error-msg">{errors.fecha_vencimiento.message}</p>
          )}
        </div>

        <div>
          <label className="label">
            Cantidad <span className="text-red-500">*</span>
          </label>
          <input
            type="number"
            min="1"
            step="1"
            className={`input ${errors?.cantidad ? "input-error" : ""}`}
            placeholder="0"
            {...register(`detalles.${index}.cantidad`, {
              required: "Requerido",
              min: { value: 1, message: "Debe ser un número entero mayor a 0" },
            })}
          />
          {errors?.cantidad && (
            <p className="error-msg">{errors.cantidad.message}</p>
          )}
        </div>
      </div>

      {skuSeleccionado && (
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="badge-blue text-xs">
            SKU: {skuSeleccionado.nombre}
          </span>
          {skuSeleccionado.codigo && (
            <span className="badge-gray text-xs">
              Código: {skuSeleccionado.codigo}
            </span>
          )}
          {skuManejaLote && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">
              <Boxes size={12} />
              Lote
            </span>
          )}
        </div>
      )}

      {modalLoteOpen && skuId && skuManejaLote && (
        <ModalCrearLote
          skuId={skuId}
          skuNombre={skuSeleccionado?.nombre || ""}
          onClose={() => setModalLoteOpen(false)}
          onCreated={handleLoteCreated}
        />
      )}
    </div>
  );
}

export default function RegistroFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isEditing = !!id;
  const isHydratingRef = useRef(false);
  const previousZonaRef = useRef("");
  const previousCategoriaRef = useRef("");

  const [saving, setSaving] = useState(false);
  const [fotoFile, setFotoFile] = useState(null);
  const [fotoActual, setFotoActual] = useState("");

  const {
    control,
    register,
    handleSubmit,
    reset,
    setValue,
    clearErrors,
    getValues,
    formState: { errors },
  } = useForm({
    defaultValues: {
      fecha: getPeruTodayDateInputValue(),
      zona: "",
      ciudad_id: "",
      almacen_origen_id: "",
      almacen_destino_id: "",
      categoria_id: "",
      accion: "",
      tipo_accion: "",
      personal_receptor_id: "",
      indicador_id: "",
      nro_guia: "",
      observaciones: "",
      detalles: [buildEmptyDetail()],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "detalles",
  });

  const zona = useWatch({ control, name: "zona" });
  const ciudadId = useWatch({ control, name: "ciudad_id" });
  const almacenOrigenId = useWatch({ control, name: "almacen_origen_id" });
  const almacenDestinoId = useWatch({ control, name: "almacen_destino_id" });
  const categoriaId = useWatch({ control, name: "categoria_id" });
  const indicadorId = useWatch({ control, name: "indicador_id" });

  const { data: categorias = [] } = useQuery({
    queryKey: ["categorias"],
    queryFn: () =>
      api.get("/catalogos/categorias").then((response) => response.data.datos),
  });
  const { data: indicadores = [] } = useQuery({
    queryKey: ["indicadores"],
    queryFn: () =>
      api.get("/catalogos/indicadores").then((response) => response.data.datos),
  });
  const { data: ciudades = [] } = useQuery({
    queryKey: ["registros-ciudades", zona || ""],
    queryFn: () =>
      api
        .get(`/catalogos/ciudades?zona=${zona}`)
        .then((response) => response.data.datos),
    enabled: !!zona,
  });
  const {
    data: almacenesOrigen = [],
    isFetched: fetchedAlmacenesOrigen,
    isFetching: loadingAlmacenesOrigen,
  } = useQuery({
    queryKey: ["registros-almacenes-origen", ciudadId || ""],
    queryFn: () =>
      api
        .get(`/catalogos/almacenes?ciudad_id=${ciudadId}`)
        .then((response) => response.data.datos),
    enabled: !!ciudadId,
  });
  const {
    data: almacenesDestino = [],
    isFetched: fetchedAlmacenesDestino,
    isFetching: loadingAlmacenesDestino,
  } = useQuery({
    queryKey: ["registros-almacenes-destino", zona || ""],
    queryFn: () =>
      api
        .get(`/catalogos/almacenes?zona=${zona}`)
        .then((response) => response.data.datos),
    enabled: !!zona,
  });
  const { data: tiposMercaderia = [] } = useQuery({
    queryKey: ["registros-tipos-mercaderia", categoriaId || ""],
    queryFn: () =>
      api
        .get(`/catalogos/tipos-mercaderia?categoria_id=${categoriaId}`)
        .then((response) => response.data.datos),
    enabled: !!categoriaId,
  });
  const {
    data: personalReceptor = [],
    isFetching: loadingPersonalReceptor,
    isFetched: fetchedPersonalReceptor,
    refetch: refetchPersonalReceptor,
  } = useQuery({
    queryKey: [
      "registros-personal-receptor",
      almacenOrigenId || "",
      almacenDestinoId || "",
      categoriaId || "",
    ],
    queryFn: () => {
      const params = new URLSearchParams({
        categoria_id: categoriaId,
      });
      if (almacenOrigenId) {
        params.set("almacen_origen_id", almacenOrigenId);
      }
      if (almacenDestinoId) {
        params.set("almacen_destino_id", almacenDestinoId);
      }
      return api
        .get(`/catalogos/personal-receptor?${params.toString()}`)
        .then((response) => response.data.datos);
    },
    enabled: !!categoriaId && (!!almacenOrigenId || !!almacenDestinoId),
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
  });
  const registroQuery = useQuery({
    queryKey: ["registro-detalle", id || ""],
    queryFn: () =>
      api.get(`/registros/${id}`).then((response) => response.data.datos),
    enabled: isEditing,
  });
  const currentRegistro = registroQuery.data;

  const categoriaOptions = buildSearchOptions(
    categorias,
    (categoria) => categoria.nombre,
    (categoria) => `${categoria.nombre} ${categoria.descripcion || ""}`,
  );
  const indicadorOptions = buildSearchOptions(
    indicadores,
    (indicador) => indicador.nombre,
    (indicador) => indicador.nombre,
  );
  const indicadorSeleccionado = useMemo(
    () =>
      indicadores.find(
        (indicador) => String(indicador.id) === String(indicadorId),
      ) || null,
    [indicadorId, indicadores],
  );
  const isTgMolitalia = isTgMolitaliaIndicator(indicadorSeleccionado);
  const ciudadOptions = buildSearchOptions(
    ciudades,
    (ciudad) => `${ciudad.nombre} · ${ciudad.region_nombre}`,
    (ciudad) => `${ciudad.nombre} ${ciudad.region_nombre || ""}`,
  );
  const almacenOrigenOptions = appendCurrentOption(
    buildSearchOptions(
      almacenesOrigen,
      (almacen) => almacen.nombre,
      (almacen) =>
        `${almacen.nombre} ${almacen.ciudad_nombre || ""} ${almacen.region_nombre || ""}`,
    ),
    currentRegistro?.almacen_origen_id,
    currentRegistro?.almacen_origen,
    `${currentRegistro?.almacen_origen || ""} ${currentRegistro?.ciudad_nombre || ""}`,
  );
  const almacenDestinoOptions = appendCurrentOption(
    buildSearchOptions(
      almacenesDestino,
      (almacen) => `${almacen.nombre} · ${almacen.ciudad_nombre || ""}`,
      (almacen) =>
        `${almacen.nombre} ${almacen.ciudad_nombre || ""} ${almacen.region_nombre || ""}`,
    ),
    currentRegistro?.almacen_destino_id,
    currentRegistro?.almacen_destino,
    `${currentRegistro?.almacen_destino || ""} ${currentRegistro?.ciudad_nombre || ""}`,
  );
  const personalOptions = appendCurrentOption(
    buildSearchOptions(
      personalReceptor,
      (persona) =>
        persona.cargo ? `${persona.nombre} · ${persona.cargo}` : persona.nombre,
      (persona) =>
        `${persona.nombre} ${persona.cargo || ""} ${persona.almacen_nombre || ""}`,
    ),
    currentRegistro?.personal_receptor_id,
    currentRegistro?.personal_receptor_nombre,
    `${currentRegistro?.personal_receptor_nombre || ""} ${currentRegistro?.almacen_origen || ""} ${currentRegistro?.almacen_destino || ""}`,
  );

  const isReadOnly = isEditing && registroQuery.data?.estado === "aprobado";

  useEffect(() => {
    if (!registroQuery.isError) return;
    toast.error("No se pudo cargar el registro");
    navigate("/registros");
  }, [navigate, registroQuery.isError]);

  useEffect(() => {
    if (!registroQuery.data) return;

    const registro = registroQuery.data;
    isHydratingRef.current = true;
    reset({
      fecha: toSafeDateInputValue(registro.fecha),
      zona: registro.zona || "",
      ciudad_id: registro.ciudad_id ? String(registro.ciudad_id) : "",
      almacen_origen_id: registro.almacen_origen_id
        ? String(registro.almacen_origen_id)
        : "",
      almacen_destino_id: registro.almacen_destino_id
        ? String(registro.almacen_destino_id)
        : "",
      categoria_id: registro.categoria_id ? String(registro.categoria_id) : "",
      accion: registro.accion || "",
      tipo_accion: registro.tipo_accion || "",
      personal_receptor_id: registro.personal_receptor_id
        ? String(registro.personal_receptor_id)
        : "",
      indicador_id: registro.indicador_id ? String(registro.indicador_id) : "",
      nro_guia: registro.nro_guia || "",
      observaciones: registro.observaciones || "",
      detalles:
        Array.isArray(registro.detalles) && registro.detalles.length
          ? registro.detalles.map((detail) => ({
              tipo_mercaderia_id: detail.tipo_mercaderia_id
                ? String(detail.tipo_mercaderia_id)
                : "",
              sku_id: detail.sku_id ? String(detail.sku_id) : "",
              lote_id: detail.lote_id ? String(detail.lote_id) : "",
              fecha_vencimiento: toSafeDateInputValue(detail.fecha_vencimiento),
              cantidad: detail.cantidad ? String(detail.cantidad) : "",
            }))
          : [buildEmptyDetail()],
    });
    setFotoActual(registro.foto_guia || "");
    setFotoFile(null);
    previousZonaRef.current = registro.zona || "";
    previousCategoriaRef.current = registro.categoria_id
      ? String(registro.categoria_id)
      : "";

    window.setTimeout(() => {
      isHydratingRef.current = false;
    }, 0);
  }, [registroQuery.data, reset]);

  useEffect(() => {
    if (isHydratingRef.current) return;
    if (previousZonaRef.current === zona) return;
    previousZonaRef.current = zona;

    const ciudadActual = getValues("ciudad_id");
    if (
      ciudadActual &&
      !ciudades.some((ciudad) => String(ciudad.id) === String(ciudadActual))
    ) {
      setValue("ciudad_id", "");
      setValue("almacen_origen_id", "");
      setValue("almacen_destino_id", "");
      setValue("personal_receptor_id", "");
    }

    const currentDetails = getValues("detalles") || [];
    currentDetails.forEach((_, index) => {
      setValue(`detalles.${index}.sku_id`, "");
      setValue(`detalles.${index}.lote_id`, "");
      setValue(`detalles.${index}.fecha_vencimiento`, "");
    });
  }, [ciudades, getValues, setValue, zona]);

  useEffect(() => {
    if (isHydratingRef.current) return;
    if (previousCategoriaRef.current === categoriaId) return;
    previousCategoriaRef.current = categoriaId;

    setValue("personal_receptor_id", "");
    const currentDetails = getValues("detalles") || [];
    currentDetails.forEach((_, index) => {
      setValue(`detalles.${index}.tipo_mercaderia_id`, "");
      setValue(`detalles.${index}.sku_id`, "");
      setValue(`detalles.${index}.lote_id`, "");
      setValue(`detalles.${index}.fecha_vencimiento`, "");
      setValue(`detalles.${index}.cantidad`, "");
    });
  }, [categoriaId, getValues, setValue]);

  useEffect(() => {
    if (isHydratingRef.current) return;
    if (!isTgMolitalia) return;

    const originId = getValues("almacen_origen_id");
    const destinationId = getValues("almacen_destino_id");
    if (!originId && destinationId) {
      setValue("almacen_destino_id", "", {
        shouldDirty: true,
        shouldValidate: true,
      });
    } else if (originId && String(destinationId || "") !== String(originId)) {
      setValue("almacen_destino_id", originId, {
        shouldDirty: true,
        shouldValidate: true,
      });
    }

    if (getValues("tipo_accion") !== "ENTRADA") {
      setValue("tipo_accion", "ENTRADA", {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
  }, [getValues, isTgMolitalia, indicadorId, setValue, almacenOrigenId]);

  useEffect(() => {
    if (isHydratingRef.current) return;
    if (!ciudadId) {
      setValue("almacen_origen_id", "");
    }
    if (!zona) {
      setValue("almacen_destino_id", "");
      setValue("personal_receptor_id", "");
      return;
    }

    const origin = getValues("almacen_origen_id");
    const destination = getValues("almacen_destino_id");

    if (
      origin &&
      ciudadId &&
      fetchedAlmacenesOrigen &&
      !loadingAlmacenesOrigen &&
      !almacenesOrigen.some((almacen) => String(almacen.id) === String(origin))
    ) {
      setValue("almacen_origen_id", "");
    }
    if (
      destination &&
      zona &&
      fetchedAlmacenesDestino &&
      !loadingAlmacenesDestino &&
      !almacenesDestino.some(
        (almacen) => String(almacen.id) === String(destination),
      )
    ) {
      setValue("almacen_destino_id", "");
      setValue("personal_receptor_id", "");
    }
  }, [
    almacenesDestino,
    almacenesOrigen,
    ciudadId,
    fetchedAlmacenesDestino,
    fetchedAlmacenesOrigen,
    getValues,
    loadingAlmacenesDestino,
    loadingAlmacenesOrigen,
    setValue,
    zona,
  ]);

  useEffect(() => {
    if ((!almacenOrigenId && !almacenDestinoId) || !categoriaId)
      return undefined;

    const refreshPersonalReceptor = () => {
      queryClient.invalidateQueries({
        queryKey: ["registros-personal-receptor"],
      });
      refetchPersonalReceptor();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshPersonalReceptor();
      }
    };

    window.addEventListener("focus", refreshPersonalReceptor);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", refreshPersonalReceptor);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    almacenDestinoId,
    almacenOrigenId,
    categoriaId,
    queryClient,
    refetchPersonalReceptor,
  ]);

  useEffect(() => {
    const personalId = getValues("personal_receptor_id");
    if (!personalId) return;
    if (!categoriaId || (!almacenOrigenId && !almacenDestinoId)) return;
    if (loadingPersonalReceptor || !fetchedPersonalReceptor) return;
    if (
      !personalReceptor.some(
        (persona) => String(persona.id) === String(personalId),
      )
    ) {
      setValue("personal_receptor_id", "");
    }
  }, [
    almacenDestinoId,
    almacenOrigenId,
    categoriaId,
    fetchedPersonalReceptor,
    getValues,
    loadingPersonalReceptor,
    personalReceptor,
    setValue,
  ]);

  const handleDownloadDetail = async () => {
    try {
      const response = await api.get(`/registros/${id}/export/excel`, {
        responseType: "blob",
        timeout: 120_000,
      });
      await downloadBlobResponse(response, `zentra_registro_${id}.xlsx`);
    } catch (err) {
      toast.error(
        await getBlobErrorMessage(err, "No se pudo descargar el detalle"),
      );
    }
  };

  const onSubmit = async (data) => {
    if (!fotoFile && !fotoActual) {
      toast.error("La foto guía es obligatoria");
      return;
    }

    setSaving(true);
    try {
      const payload = new FormData();
      payload.append("fecha", data.fecha);
      payload.append("zona", data.zona);
      payload.append("ciudad_id", data.ciudad_id);
      payload.append("almacen_origen_id", data.almacen_origen_id);
      payload.append("almacen_destino_id", data.almacen_destino_id);
      payload.append("categoria_id", data.categoria_id);
      payload.append("accion", data.accion);
      payload.append("tipo_accion", data.tipo_accion);
      payload.append("personal_receptor_id", data.personal_receptor_id);
      payload.append("indicador_id", data.indicador_id);
      payload.append("nro_guia", data.nro_guia);
      payload.append("observaciones", data.observaciones);
      payload.append("detalles", JSON.stringify(data.detalles));

      if (fotoFile) {
        payload.append("foto_guia", fotoFile);
      }

      const config = { headers: { "Content-Type": "multipart/form-data" } };
      if (isEditing) {
        await api.put(`/registros/${id}`, payload, config);
        toast.success("Registro actualizado");
      } else {
        await api.post("/registros", payload, config);
        toast.success("Registro creado correctamente");
      }

      navigate("/registros");
    } catch (err) {
      toast.error(getMensajeError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate("/registros")}
            className="btn-secondary btn-sm"
          >
            <ArrowLeft size={14} /> Volver
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {isEditing
                ? isReadOnly
                  ? "Ver registro aprobado"
                  : "Editar registro"
                : "Nuevo registro"}
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              Módulo 1 · Cabecera compartida con líneas múltiples por guía
            </p>
          </div>
        </div>

        {isEditing && (
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={handleDownloadDetail}
          >
            <Download size={14} /> Descargar detalle
          </button>
        )}
      </div>

      {isReadOnly && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Este registro ya fue aprobado. Los campos quedan bloqueados y solo
          puedes descargar su detalle.
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <fieldset
          disabled={isReadOnly || saving || registroQuery.isLoading}
          className="space-y-6"
        >
          <div className="card">
            <h3 className="mb-4 border-b border-gray-200 pb-2 font-semibold text-gray-800">
              Cabecera
            </h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div>
                <label className="label">
                  Fecha <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  className={`input ${errors.fecha ? "input-error" : ""}`}
                  {...register("fecha", { required: "Requerido" })}
                />
                {errors.fecha && (
                  <p className="error-msg">{errors.fecha.message}</p>
                )}
              </div>

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
                {errors.zona && (
                  <p className="error-msg">{errors.zona.message}</p>
                )}
              </div>

              <div>
                <label className="label">
                  Ciudad <span className="text-red-500">*</span>
                </label>
                <SearchableSelect
                  control={control}
                  name="ciudad_id"
                  rules={{ required: "Requerido" }}
                  options={ciudadOptions}
                  placeholder={
                    zona ? "Seleccionar ciudad..." : "Primero selecciona zona"
                  }
                  disabled={!zona}
                  emptyText="Sin ciudades para la zona"
                />
                {errors.ciudad_id && (
                  <p className="error-msg">{errors.ciudad_id.message}</p>
                )}
              </div>

              <div>
                <label className="label">
                  Categoría <span className="text-red-500">*</span>
                </label>
                <SearchableSelect
                  control={control}
                  name="categoria_id"
                  rules={{ required: "Requerido" }}
                  options={categoriaOptions}
                  placeholder="Seleccionar categoría..."
                />
                {errors.categoria_id && (
                  <p className="error-msg">{errors.categoria_id.message}</p>
                )}
              </div>

              <div>
                <label className="label">
                  Almacén origen <span className="text-red-500">*</span>
                </label>
                <SearchableSelect
                  control={control}
                  name="almacen_origen_id"
                  rules={{ required: "Requerido" }}
                  options={almacenOrigenOptions}
                  placeholder={
                    ciudadId
                      ? "Seleccionar almacén..."
                      : "Primero selecciona ciudad"
                  }
                  disabled={!ciudadId}
                  emptyText="Sin almacenes para la ciudad"
                />
                {errors.almacen_origen_id && (
                  <p className="error-msg">
                    {errors.almacen_origen_id.message}
                  </p>
                )}
              </div>

              <div>
                <label className="label">
                  Almacén destino <span className="text-red-500">*</span>
                </label>
                <SearchableSelect
                  control={control}
                  name="almacen_destino_id"
                  rules={{ required: "Requerido" }}
                  options={almacenDestinoOptions}
                  placeholder={
                    zona
                      ? "Seleccionar almacén destino..."
                      : "Primero selecciona zona"
                  }
                  disabled={!zona || isTgMolitalia}
                  emptyText="Sin almacenes para la zona"
                />
                {errors.almacen_destino_id && (
                  <p className="error-msg">
                    {errors.almacen_destino_id.message}
                  </p>
                )}
                {isTgMolitalia && (
                  <p className="mt-1 text-xs text-amber-600">
                    TG MOLITALIA usa el mismo almacén que el origen.
                  </p>
                )}
              </div>

              <div>
                <label className="label">
                  Acción <span className="text-red-500">*</span>
                </label>
                <SearchableSelect
                  control={control}
                  name="accion"
                  rules={{ required: "Requerido" }}
                  options={ACCIONES.map((accion) => ({
                    value: accion,
                    label: accion,
                  }))}
                  placeholder="Seleccionar acción..."
                />
                {errors.accion && (
                  <p className="error-msg">{errors.accion.message}</p>
                )}
              </div>

              <div>
                <label className="label">
                  Tipo de acción <span className="text-red-500">*</span>
                </label>
                <SearchableSelect
                  control={control}
                  name="tipo_accion"
                  rules={{ required: "Requerido" }}
                  options={TIPO_ACCION_OPTIONS}
                  placeholder="Seleccionar tipo..."
                  disabled={isTgMolitalia}
                />
                {errors.tipo_accion && (
                  <p className="error-msg">{errors.tipo_accion.message}</p>
                )}
                {isTgMolitalia && (
                  <p className="mt-1 text-xs text-amber-600">
                    TG MOLITALIA requiere tipo de acción ENTRADA.
                  </p>
                )}
              </div>

              <div>
                <label className="label">
                  Personal receptor <span className="text-red-500">*</span>
                </label>
                <SearchableSelect
                  control={control}
                  name="personal_receptor_id"
                  rules={{ required: "Requerido" }}
                  options={personalOptions}
                  placeholder={
                    !categoriaId && !almacenOrigenId && !almacenDestinoId
                      ? "Primero selecciona categoría y almacén"
                      : !categoriaId
                        ? "Primero selecciona categoría"
                        : !almacenOrigenId && !almacenDestinoId
                          ? "Primero selecciona origen o destino"
                          : loadingPersonalReceptor
                            ? "Cargando personal..."
                            : "Seleccionar personal..."
                  }
                  disabled={
                    !categoriaId ||
                    (!almacenOrigenId && !almacenDestinoId) ||
                    loadingPersonalReceptor
                  }
                  emptyText="Sin personal para el filtro"
                />
                {errors.personal_receptor_id && (
                  <p className="error-msg">
                    {errors.personal_receptor_id.message}
                  </p>
                )}
              </div>

              <div>
                <label className="label">
                  Indicador <span className="text-red-500">*</span>
                </label>
                <SearchableSelect
                  control={control}
                  name="indicador_id"
                  rules={{ required: "Requerido" }}
                  options={indicadorOptions}
                  placeholder="Seleccionar indicador..."
                />
                {errors.indicador_id && (
                  <p className="error-msg">{errors.indicador_id.message}</p>
                )}
              </div>

              <div>
                <label className="label">
                  Nro. guía <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  className={`input ${errors.nro_guia ? "input-error" : ""}`}
                  placeholder="Ej: G-001"
                  {...register("nro_guia", { required: "Requerido" })}
                />
                {errors.nro_guia && (
                  <p className="error-msg">{errors.nro_guia.message}</p>
                )}
              </div>

              <div>
                <label className="label">
                  Foto guía <span className="text-red-500">*</span>
                </label>
                <label className="btn-secondary flex w-full cursor-pointer justify-center">
                  <Upload size={14} />
                  {fotoFile
                    ? fotoFile.name
                    : fotoActual
                      ? "Reemplazar archivo"
                      : "Subir archivo"}
                  <input
                    type="file"
                    accept=".jpg,.jpeg,.png,.pdf"
                    className="hidden"
                    onChange={(event) =>
                      setFotoFile(event.target.files?.[0] || null)
                    }
                  />
                </label>
                {fotoActual && !fotoFile && (
                  <a
                    href={`/uploads/${fotoActual}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex text-xs text-primary-600 hover:underline"
                  >
                    Ver archivo actual
                  </a>
                )}
              </div>
            </div>

            <div className="mt-4">
              <label className="label">Observaciones</label>
              <textarea
                rows={3}
                className={`input ${errors.observaciones ? "input-error" : ""}`}
                placeholder="Detalle adicional del movimiento (opcional)"
                {...register("observaciones")}
              />
              {errors.observaciones && (
                <p className="error-msg">{errors.observaciones.message}</p>
              )}
            </div>
          </div>

          <div className="card">
            <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="font-semibold text-gray-800">
                  Detalle de mercadería
                </h3>
                <p className="text-sm text-gray-500">
                  Una misma guía puede registrar varios SKUs en un solo
                  formulario.
                </p>
              </div>
              <button
                type="button"
                className="btn-primary btn-sm"
                onClick={() => append(buildEmptyDetail())}
                disabled={!categoriaId}
              >
                <Plus size={14} /> Agregar línea
              </button>
            </div>

            <div className="space-y-4">
              {fields.map((field, index) => (
                <DetalleRow
                  key={field.id}
                  index={index}
                  control={control}
                  register={register}
                  setValue={setValue}
                  clearErrors={clearErrors}
                  getValues={getValues}
                  categoriaId={categoriaId}
                  zona={zona}
                  tiposMercaderia={tiposMercaderia}
                  remove={remove}
                  canRemove={fields.length > 1}
                  disabled={isReadOnly || saving}
                  errors={errors.detalles?.[index]}
                />
              ))}
            </div>
          </div>
        </fieldset>

        <div className="flex justify-end gap-3 pb-6">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => navigate("/registros")}
          >
            {isReadOnly ? "Volver" : "Cancelar"}
          </button>
          {!isReadOnly && (
            <button
              type="submit"
              className="btn-primary"
              disabled={saving || registroQuery.isLoading}
            >
              {saving ? (
                <>
                  <Loader2 size={15} className="animate-spin" /> Guardando...
                </>
              ) : (
                <>
                  <Save size={15} /> Guardar registro
                </>
              )}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
