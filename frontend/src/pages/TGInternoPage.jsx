import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useFieldArray, useForm } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { toast } from "react-toastify";
import { AlertCircle, ArrowLeft, Plus, Save, Trash2, Upload } from "lucide-react";
import api from "../utils/api";
import SearchableSelect from "../components/SearchableSelect";

function buildSearchOptions(rows = [], labelBuilder) {
  return rows.map((row) => ({
    value: String(row.id),
    label: labelBuilder(row),
    raw: row,
  }));
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isPositiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0;
}

function parseFlag(value) {
  return value === true || value === 1 || value === "1";
}

function normalizeSkuName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function sameNormalizedValue(left, right) {
  return normalizeSkuName(left) === normalizeSkuName(right);
}

function isEquivalentSku(sourceSku, targetSku) {
  if (!sourceSku || !targetSku) return false;
  if (!sameNormalizedValue(sourceSku.nombre || sourceSku.sku_nombre, targetSku.nombre || targetSku.sku_nombre)) return false;
  if (sourceSku.codigo || sourceSku.sku_codigo) {
    if (String(sourceSku.codigo || sourceSku.sku_codigo) !== String(targetSku.codigo || targetSku.sku_codigo || "")) return false;
  }
  if (sourceSku.zona && targetSku.zona && !sameNormalizedValue(sourceSku.zona, targetSku.zona)) return false;
  return true;
}

export default function TGInternoPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEditing = Boolean(id);
  const [saving, setSaving] = useState(false);

  const { data: almacenes = [] } = useQuery({
    queryKey: ["almacenes"],
    queryFn: () => api.get("/catalogos/almacenes").then((r) => r.data.datos),
  });

  const { data: categorias = [] } = useQuery({
    queryKey: ["categorias"],
    queryFn: () => api.get("/catalogos/categorias").then((r) => r.data.datos),
  });

  const { data: skus = [] } = useQuery({
    queryKey: ["skus"],
    queryFn: () => api.get("/catalogos/skus").then((r) => r.data.datos),
  });

  const {
    control,
    handleSubmit,
    register,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm({
    defaultValues: {
      almacen_id: "",
      categoria_origen_id: "",
      source_stock_key: "",
      sku_origen_id: "",
      lote_origen_id: "",
      cantidad_origen: "",
      foto_guia: null,
      observaciones: "",
      detalles: [{ categoria_destino_id: "", sku_destino_id: "", lote_destino_id: "", cantidad: "" }],
    },
  });

  const { data: transferenciaEdit, isLoading: loadingTransferenciaEdit } = useQuery({
    queryKey: ["tg-interno-detalle", id],
    enabled: isEditing,
    queryFn: () => api.get(`/tg-interno/${id}`).then((r) => r.data.dato),
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "detalles",
  });

  const almacenId = watch("almacen_id");
  const categoriaOrigenId = watch("categoria_origen_id");
  const sourceStockKey = watch("source_stock_key");
  const cantidadOrigen = toNumber(watch("cantidad_origen"));
  const detalles = watch("detalles") || [];
  const selectedFotoGuia = watch("foto_guia");
  const fotoGuiaDisponible = Boolean(selectedFotoGuia?.[0] || transferenciaEdit?.foto_guia);

  const { data: stockOrigen = [], isFetching: loadingStockOrigen } = useQuery({
    queryKey: ["tg-interno-stock", almacenId || "", categoriaOrigenId || ""],
    enabled: !!almacenId && !!categoriaOrigenId,
    queryFn: () => {
      const params = new URLSearchParams({
        almacen_id: almacenId,
        categoria_id: categoriaOrigenId,
      });
      return api.get(`/tg-interno/stock?${params.toString()}`).then((r) => r.data.datos);
    },
  });

  useEffect(() => {
    if (isEditing) return;
    setValue("source_stock_key", "");
    setValue("sku_origen_id", "");
    setValue("lote_origen_id", "");
    setValue("cantidad_origen", "");
  }, [almacenId, categoriaOrigenId, isEditing, setValue]);

  useEffect(() => {
    if (!transferenciaEdit) return;

    const loteKey = transferenciaEdit.lote_origen_id ? String(transferenciaEdit.lote_origen_id) : "sin-lote";
    reset({
      almacen_id: String(transferenciaEdit.almacen_id || ""),
      categoria_origen_id: String(transferenciaEdit.categoria_origen_id || ""),
      source_stock_key: `${transferenciaEdit.sku_origen_id}|${loteKey}`,
      sku_origen_id: String(transferenciaEdit.sku_origen_id || ""),
      lote_origen_id: transferenciaEdit.lote_origen_id ? String(transferenciaEdit.lote_origen_id) : "",
      cantidad_origen: String(Number(transferenciaEdit.cantidad_origen || 0)),
      foto_guia: null,
      observaciones: transferenciaEdit.observaciones || "",
      detalles: (transferenciaEdit.detalles || []).map((detalle) => ({
        id: detalle.id,
        categoria_destino_id: String(detalle.categoria_destino_id || ""),
        sku_destino_id: detalle.sku_destino_id ? String(detalle.sku_destino_id) : "",
        lote_destino_id: detalle.lote_destino_id ? String(detalle.lote_destino_id) : "",
        lote_destino_codigo: detalle.lote_destino_codigo || "",
        cantidad: String(Number(detalle.cantidad || 0)),
      })),
    });
  }, [reset, transferenciaEdit]);

  const selectedStock = useMemo(() => {
    const stockRow = stockOrigen.find((row) => {
        const loteKey = row.lote_id ? String(row.lote_id) : "sin-lote";
        return `${row.sku_id}|${loteKey}` === sourceStockKey;
      });
    if (stockRow) return stockRow;
    if (isEditing && transferenciaEdit) {
      return {
        almacen_id: transferenciaEdit.almacen_id,
        sku_id: transferenciaEdit.sku_origen_id,
        lote_id: transferenciaEdit.lote_origen_id,
        stock_disponible: Number(transferenciaEdit.cantidad_origen || 0),
        sku_codigo: transferenciaEdit.sku_origen_codigo,
        sku_nombre: transferenciaEdit.sku_origen_nombre,
        categoria_id: transferenciaEdit.categoria_origen_id,
        codigo_lote: transferenciaEdit.lote_origen_codigo,
      };
    }
    return null;
  }, [isEditing, sourceStockKey, stockOrigen, transferenciaEdit]);

  const sumaDestinos = detalles.reduce((sum, det) => sum + toNumber(det.cantidad), 0);
  const coinciden = cantidadOrigen > 0 && sumaDestinos === cantidadOrigen;
  const stockDisponible = Number(selectedStock?.stock_disponible || 0);
  const stockSuficiente = isEditing || (selectedStock && cantidadOrigen > 0 && cantidadOrigen <= stockDisponible + 0.000001);
  const sourceSku = useMemo(
    () => skus.find((sku) => String(sku.id) === String(selectedStock?.sku_id || "")) || null,
    [selectedStock?.sku_id, skus],
  );

  const almacenOptions = buildSearchOptions(almacenes, (a) => a.nombre);
  const categoriaOptions = buildSearchOptions(categorias, (c) => c.nombre);
  const sourceStockOptions = stockOrigen.map((row) => {
    const loteLabel = row.codigo_lote ? `Lote ${row.codigo_lote}` : "SIN LOTE";
    const codigo = row.sku_codigo ? `${row.sku_codigo} - ` : "";
    return {
      value: `${row.sku_id}|${row.lote_id ? String(row.lote_id) : "sin-lote"}`,
      label: `${codigo}${row.sku_nombre} | ${loteLabel} | Stock ${Number(row.stock_disponible || 0).toFixed(2)}`,
      raw: row,
    };
  });
  if (
    isEditing &&
    transferenciaEdit &&
    !sourceStockOptions.some((option) => option.value === sourceStockKey)
  ) {
    const loteLabel = transferenciaEdit.lote_origen_codigo ? `Lote ${transferenciaEdit.lote_origen_codigo}` : "SIN LOTE";
    const codigo = transferenciaEdit.sku_origen_codigo ? `${transferenciaEdit.sku_origen_codigo} - ` : "";
    sourceStockOptions.push({
      value: sourceStockKey,
      label: `${codigo}${transferenciaEdit.sku_origen_nombre || "SKU origen"} | ${loteLabel}`,
      raw: selectedStock,
    });
  }

  const skuOptionsByCategory = useMemo(() => {
    const map = new Map();
    skus.forEach((sku) => {
      const key = String(sku.categoria_id || "");
      const options = map.get(key) || [];
      const codigo = sku.codigo ? `${sku.codigo} - ` : "";
      const zona = sku.zona ? ` | ${sku.zona}` : "";
      options.push({
        value: String(sku.id),
        label: `${codigo}${sku.nombre}${zona}`,
        raw: sku,
      });
      map.set(key, options);
    });
    return map;
  }, [skus]);

  const validDestinationCategoryOptions = useMemo(() => {
    if (!sourceSku || !categoriaOrigenId) return [];

    const validCategoryIds = new Set(
      skus
        .filter((sku) => (
          isEquivalentSku(sourceSku, sku) &&
          String(sku.categoria_id) !== String(categoriaOrigenId)
        ))
        .map((sku) => String(sku.categoria_id)),
    );

    return categoriaOptions.filter((option) => validCategoryIds.has(option.value));
  }, [categoriaOptions, categoriaOrigenId, sourceSku, skus]);

  useEffect(() => {
    if (isEditing) return;
    if (!selectedStock) return;
    const validIds = new Set(validDestinationCategoryOptions.map((option) => option.value));
    detalles.forEach((detalle, index) => {
      if (detalle?.categoria_destino_id && !validIds.has(String(detalle.categoria_destino_id))) {
        setValue(`detalles.${index}.categoria_destino_id`, "");
        setValue(`detalles.${index}.sku_destino_id`, "");
        setValue(`detalles.${index}.lote_destino_id`, "");
      }
    });
  }, [detalles, isEditing, selectedStock, setValue, validDestinationCategoryOptions]);

  const handleSave = async (data) => {
    const selectedFile = data.foto_guia?.[0] || null;
    if (!selectedFile && !transferenciaEdit?.foto_guia) {
      return toast.error("La foto guía es obligatoria");
    }
    if (!data.almacen_id) return toast.error("Selecciona un almacen");
    if (!data.categoria_origen_id) return toast.error("Selecciona categoria origen");
    if (!data.sku_origen_id) return toast.error("Selecciona el SKU origen con stock");
    if (!isPositiveInteger(data.cantidad_origen)) {
      return toast.error("Ingresa una cantidad entera mayor a 0");
    }
    if (!isEditing && !stockSuficiente) {
      return toast.error(`Stock insuficiente. Disponible: ${stockDisponible.toFixed(2)}`);
    }
    if (!Array.isArray(data.detalles) || data.detalles.length < 1) {
      return toast.error("Debe haber al menos 1 destino");
    }
    if (
      data.detalles.some(
        (d) => !d.categoria_destino_id || !d.sku_destino_id || !isPositiveInteger(d.cantidad),
      )
    ) {
      return toast.error("Completa cada destino con categoria, SKU y cantidad entera");
    }
    const missingRequiredDestinationLot = data.detalles.some((detalle) => {
      const skuDestino = skus.find((sku) => String(sku.id) === String(detalle.sku_destino_id));
      return parseFlag(skuDestino?.tiene_lote) && !detalle.lote_destino_id;
    });
    if (missingRequiredDestinationLot) {
      return toast.error("Selecciona el lote destino para cada SKU que maneja lote");
    }
    if (data.detalles.some((d) => String(d.categoria_destino_id) === String(data.categoria_origen_id))) {
      return toast.error("La categoria destino debe ser distinta a la categoria origen");
    }
    if (!coinciden) {
      return toast.error(
        `La suma de destinos (${sumaDestinos}) debe ser igual al origen (${cantidadOrigen})`,
      );
    }

    setSaving(true);
    try {
      const payload = {
        almacen_id: data.almacen_id,
        categoria_origen_id: data.categoria_origen_id,
        sku_origen_id: data.sku_origen_id,
        lote_origen_id: data.lote_origen_id || null,
        cantidad_origen: data.cantidad_origen,
        observaciones: data.observaciones,
        detalles: data.detalles.map((detalle) => ({
          id: detalle.id,
          categoria_destino_id: detalle.categoria_destino_id,
          sku_destino_id: detalle.sku_destino_id,
          lote_destino_id: detalle.lote_destino_id || null,
          cantidad: detalle.cantidad,
        })),
      };
      if (isEditing) {
        if (selectedFile) {
          const formData = new FormData();
          formData.append("cantidad_origen", payload.cantidad_origen);
          formData.append("observaciones", payload.observaciones || "");
          formData.append("detalles", JSON.stringify(payload.detalles.map((detalle) => ({
            id: detalle.id,
            cantidad: detalle.cantidad,
          }))));
          formData.append("foto_guia", selectedFile);
          await api.put(`/tg-interno/${id}`, formData);
        } else {
          await api.put(`/tg-interno/${id}`, {
          cantidad_origen: payload.cantidad_origen,
          observaciones: payload.observaciones,
          detalles: payload.detalles.map((detalle) => ({
            id: detalle.id,
            cantidad: detalle.cantidad,
          })),
          });
        }
      } else {
        const formData = new FormData();
        formData.append("almacen_id", payload.almacen_id);
        formData.append("categoria_origen_id", payload.categoria_origen_id);
        formData.append("sku_origen_id", payload.sku_origen_id);
        if (payload.lote_origen_id) formData.append("lote_origen_id", payload.lote_origen_id);
        formData.append("cantidad_origen", payload.cantidad_origen);
        formData.append("observaciones", payload.observaciones || "");
        formData.append("detalles", JSON.stringify(payload.detalles));
        if (selectedFile) formData.append("foto_guia", selectedFile);
        await api.post("/tg-interno", formData);
      }

      toast.success(isEditing ? "Transferencia TG INTERNO actualizada exitosamente" : "Transferencia TG INTERNO registrada exitosamente");
      navigate("/tg-interno/listado");
    } catch (error) {
      toast.error(error.response?.data?.mensaje || "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => navigate("/tg-interno/listado")} className="btn-secondary btn-sm">
          <ArrowLeft size={14} /> Volver
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {isEditing ? `Editar TG INTERNO #${id}` : "Transferencia TG INTERNO (Mismo Almacen)"}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {isEditing ? "Ajustar montos de una transferencia activa" : "Trasladar stock entre categorias y SKUs del mismo almacen"}
          </p>
        </div>
      </div>

      {loadingTransferenciaEdit ? (
        <div className="card py-10 text-center text-gray-500">Cargando transferencia...</div>
      ) : (
      <form onSubmit={handleSubmit(handleSave)} className="space-y-6">
        {!isEditing && <div className="flex gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4">
          <AlertCircle size={20} className="mt-0.5 flex-shrink-0 text-blue-600" />
          <div className="text-sm text-blue-800">
            <p className="font-semibold">Como funciona</p>
            <p className="mt-1">
              1. Selecciona almacen, categoria origen y SKU con stock disponible
              <br />
              2. Indica la cantidad a trasladar
              <br />
              3. Distribuye la cantidad indicando categoria, SKU y lote destino
              <br />
              4. El sistema valida stock y registra salida/entrada TG - INTERNO
            </p>
          </div>
        </div>}

        <div className="card">
          <h3 className="mb-4 border-b border-gray-200 pb-2 font-semibold text-gray-800">Datos de Transferencia</h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="label">Almacen <span className="text-red-500">*</span></label>
              <SearchableSelect
                control={control}
                name="almacen_id"
                rules={{ required: "Requerido" }}
                options={almacenOptions}
                placeholder="Selecciona almacen"
                disabled={isEditing}
              />
              {errors.almacen_id && <p className="error-msg">{errors.almacen_id.message}</p>}
            </div>

            <div>
              <label className="label">Categoria Origen <span className="text-red-500">*</span></label>
              <SearchableSelect
                control={control}
                name="categoria_origen_id"
                rules={{ required: "Requerido" }}
                options={categoriaOptions}
                placeholder="Selecciona categoria"
                disabled={isEditing}
              />
              {errors.categoria_origen_id && <p className="error-msg">{errors.categoria_origen_id.message}</p>}
            </div>

            <div className="md:col-span-2">
              <label className="label">SKU Origen <span className="text-red-500">*</span></label>
              <SearchableSelect
                control={control}
                name="source_stock_key"
                rules={{ required: "Requerido" }}
                options={sourceStockOptions}
                placeholder={
                  loadingStockOrigen
                    ? "Cargando stock..."
                    : almacenId && categoriaOrigenId
                      ? "Selecciona SKU con stock"
                      : "Selecciona almacen y categoria primero"
                }
                disabled={isEditing || !almacenId || !categoriaOrigenId || loadingStockOrigen}
                emptyText="No hay SKUs con stock que tengan otra categoria disponible"
                onValueChange={(_, option) => {
                  const row = option?.raw;
                  setValue("sku_origen_id", row?.sku_id ? String(row.sku_id) : "");
                  setValue("lote_origen_id", row?.lote_id ? String(row.lote_id) : "");
                  setValue("cantidad_origen", "");
                }}
              />
              {errors.source_stock_key && <p className="error-msg">{errors.source_stock_key.message}</p>}
            </div>

            <div>
              <label className="label">Cantidad a Trasladar <span className="text-red-500">*</span></label>
              <input
                type="number"
                className={`input ${errors.cantidad_origen ? "input-error" : ""}`}
                placeholder="0"
                step="1"
                min="1"
                max={selectedStock ? stockDisponible : undefined}
                disabled={!selectedStock}
                {...control.register("cantidad_origen", {
                  required: "Requerido",
                  validate: (value) => isPositiveInteger(value) || "Debe ser un entero mayor a 0",
                })}
              />
              {selectedStock && (
                <p className={`mt-1 text-xs ${stockSuficiente || !cantidadOrigen ? "text-gray-500" : "text-red-600"}`}>
                  {isEditing ? "El stock se recalcula al guardar la edicion." : `Stock disponible: ${stockDisponible.toFixed(2)}`}
                </p>
              )}
              {errors.cantidad_origen && <p className="error-msg">{errors.cantidad_origen.message}</p>}
            </div>

            <div>
              <label className="label">Observaciones</label>
              <textarea
                rows={2}
                className="input"
                placeholder="Motivo del traslado (opcional)"
                {...control.register("observaciones")}
              />
            </div>

            <div className="md:col-span-2">
              <label className="label">Foto guía <span className="text-red-500">*</span></label>
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50">
                <Upload size={16} />
                {selectedFotoGuia?.[0]?.name || "Subir archivo"}
                <input
                  type="file"
                  accept=".jpg,.jpeg,.png,.pdf"
                  className="hidden"
                  {...register("foto_guia", {
                    validate: (files) => (
                      files?.length || transferenciaEdit?.foto_guia ? true : "Foto guía requerida"
                    ),
                  })}
                />
              </label>
              {errors.foto_guia && <p className="error-msg">{errors.foto_guia.message}</p>}
              {!fotoGuiaDisponible && (
                <p className="mt-2 text-xs font-medium text-red-600">
                  Debes adjuntar una foto guía para registrar el TG Interno.
                </p>
              )}
              {transferenciaEdit?.foto_guia && (
                <a
                  href={`/uploads/${transferenciaEdit.foto_guia}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex text-xs font-medium text-blue-600 hover:text-blue-800"
                >
                  Ver sustento actual
                </a>
              )}
              {isEditing && !transferenciaEdit?.foto_guia && (
                <p className="mt-2 text-xs text-gray-500">
                  Sin sustento actual guardado. Selecciona un archivo para adjuntarlo.
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="font-semibold text-gray-800">Destinos</h3>
              <p className="text-sm text-gray-500">
                La suma debe ser {cantidadOrigen > 0 ? cantidadOrigen : "igual al origen"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => append({ categoria_destino_id: "", sku_destino_id: "", lote_destino_id: "", cantidad: "" })}
              className="btn-primary btn-sm"
              disabled={isEditing || !selectedStock || validDestinationCategoryOptions.length === 0}
            >
              <Plus size={14} /> Agregar destino
            </button>
          </div>

          {cantidadOrigen > 0 && (
            <div className={`mb-4 rounded border p-3 ${coinciden ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50"}`}>
              <p className={`text-sm font-semibold ${coinciden ? "text-green-800" : "text-amber-800"}`}>
                Origen: {cantidadOrigen} | Destinos: {sumaDestinos} {coinciden ? "Correcto" : "No coincide"}
              </p>
            </div>
          )}

          <div className="space-y-3">
            {fields.map((field, index) => (
              <DetailLineRow
                key={field.id}
                index={index}
                control={control}
                categoriaOptions={validDestinationCategoryOptions}
                skuOptionsByCategory={skuOptionsByCategory}
                skus={skus}
                sourceSku={sourceSku}
                detalle={detalles[index] || {}}
                selectedStock={selectedStock}
                categoriaOrigenId={categoriaOrigenId}
                setValue={setValue}
                remove={remove}
                canRemove={!isEditing && fields.length > 1}
                errors={errors.detalles?.[index]}
                isEditing={isEditing}
              />
            ))}
            {selectedStock && validDestinationCategoryOptions.length === 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                Este SKU no tiene categorias destino disponibles.
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-3 pb-6">
          <button type="button" className="btn-secondary" onClick={() => navigate("/tg-interno/listado")}>
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving || !coinciden || !stockSuficiente || !fotoGuiaDisponible}
            className="btn-primary"
            title={!fotoGuiaDisponible ? "Adjunta la foto guía obligatoria" : !stockSuficiente ? "Selecciona SKU y cantidad con stock suficiente" : !coinciden ? "Las cantidades deben coincidir" : ""}
          >
            {saving ? "Guardando..." : <><Save size={15} /> Guardar Transferencia</>}
          </button>
        </div>
      </form>
      )}
    </div>
  );
}

function DetailLineRow({
  index,
  control,
  categoriaOptions,
  skuOptionsByCategory,
  skus,
  sourceSku,
  detalle,
  selectedStock,
  categoriaOrigenId,
  setValue,
  remove,
  canRemove,
  errors,
  isEditing,
}) {
  const categoriaDestinoId = String(detalle?.categoria_destino_id || "");
  const skuDestinoId = String(detalle?.sku_destino_id || "");
  const loteDestinoId = String(detalle?.lote_destino_id || "");
  const sourceName = normalizeSkuName(selectedStock?.sku_nombre);
  const allCategorySkuOptions = skuOptionsByCategory.get(categoriaDestinoId) || [];
  const matchingSkuOptions = useMemo(
    () => sourceSku
      ? allCategorySkuOptions.filter((option) => isEquivalentSku(sourceSku, option.raw))
      : [],
    [allCategorySkuOptions, sourceSku],
  );
  const skuOptions = matchingSkuOptions;
  const firstMatchValue = matchingSkuOptions[0]?.value || "";
  const selectedDestinationSku = skus.find((sku) => String(sku.id) === skuDestinoId) || null;
  const selectedDestinationSkuUsesLot = parseFlag(selectedDestinationSku?.tiene_lote);

  const { data: lotesDestino = [], isFetching: loadingLotesDestino } = useQuery({
    queryKey: ["tg-interno-lotes-destino", skuDestinoId || ""],
    enabled: !!skuDestinoId && selectedDestinationSkuUsesLot,
    queryFn: () => api.get(`/catalogos/lotes?sku_id=${skuDestinoId}`).then((r) => r.data.datos),
  });

  const loteDestinoOptions = buildSearchOptions(lotesDestino, (lote) => {
    const vencimiento = lote.fecha_vencimiento ? ` | Vence ${lote.fecha_vencimiento}` : "";
    return `${lote.codigo_lote || "SIN LOTE"}${vencimiento}`;
  });
  if (
    isEditing &&
    loteDestinoId &&
    !loteDestinoOptions.some((option) => option.value === loteDestinoId)
  ) {
    loteDestinoOptions.push({
      value: loteDestinoId,
      label: detalle?.lote_destino_codigo || `Lote ${loteDestinoId}`,
      raw: {
        id: loteDestinoId,
        codigo_lote: detalle?.lote_destino_codigo || "",
      },
    });
  }

  const matchingDestinationLot = useMemo(() => {
    const sourceLotCode = normalizeSkuName(selectedStock?.codigo_lote);
    if (!sourceLotCode) return null;
    return lotesDestino.find((lote) => normalizeSkuName(lote.codigo_lote) === sourceLotCode) || null;
  }, [lotesDestino, selectedStock?.codigo_lote]);

  useEffect(() => {
    if (isEditing) return;
    if (!categoriaDestinoId || !sourceName) {
      setValue(`detalles.${index}.sku_destino_id`, "");
      setValue(`detalles.${index}.lote_destino_id`, "");
      return;
    }

    const currentSkuStillValid = skuDestinoId && matchingSkuOptions.some((option) => option.value === skuDestinoId);
    if (skuDestinoId && !currentSkuStillValid) {
      setValue(`detalles.${index}.sku_destino_id`, firstMatchValue);
      setValue(`detalles.${index}.lote_destino_id`, "");
      return;
    }

    if (!skuDestinoId && firstMatchValue) {
      setValue(`detalles.${index}.sku_destino_id`, firstMatchValue);
    }
  }, [categoriaDestinoId, firstMatchValue, index, isEditing, matchingSkuOptions, setValue, skuDestinoId, sourceName]);

  useEffect(() => {
    if (!selectedDestinationSkuUsesLot || loadingLotesDestino || loteDestinoId) return;
    if (matchingDestinationLot?.id) {
      setValue(`detalles.${index}.lote_destino_id`, String(matchingDestinationLot.id));
    }
  }, [
    index,
    loadingLotesDestino,
    loteDestinoId,
    matchingDestinationLot,
    selectedDestinationSkuUsesLot,
    setValue,
  ]);

  return (
    <div className="grid grid-cols-1 gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 md:grid-cols-[1fr_1fr_12rem_9rem_auto] md:items-end">
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-700">
          Categoria Destino {index + 1} <span className="text-red-500">*</span>
        </label>
        <SearchableSelect
          control={control}
          name={`detalles.${index}.categoria_destino_id`}
          rules={{ required: "Requerido" }}
          options={categoriaOptions.filter((option) => option.value !== String(categoriaOrigenId || ""))}
          placeholder="Selecciona categoria"
          onValueChange={() => {
            setValue(`detalles.${index}.sku_destino_id`, "");
            setValue(`detalles.${index}.lote_destino_id`, "");
          }}
          disabled={isEditing}
        />
        {errors?.categoria_destino_id && <p className="error-msg text-xs">{errors.categoria_destino_id.message}</p>}
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-gray-700">
          SKU Destino <span className="text-red-500">*</span>
        </label>
        <SearchableSelect
          control={control}
          name={`detalles.${index}.sku_destino_id`}
          rules={{ required: "Requerido" }}
          options={skuOptions}
          placeholder={categoriaDestinoId ? "Selecciona SKU destino" : "Selecciona categoria"}
          emptyText="No existe SKU equivalente en esta categoria"
          disabled={isEditing || !categoriaDestinoId}
          onValueChange={() => setValue(`detalles.${index}.lote_destino_id`, "")}
        />
        {errors?.sku_destino_id && <p className="error-msg text-xs">{errors.sku_destino_id.message}</p>}
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-gray-700">
          Lote Destino {selectedDestinationSkuUsesLot && <span className="text-red-500">*</span>}
        </label>
        <SearchableSelect
          control={control}
          name={`detalles.${index}.lote_destino_id`}
          rules={{
            validate: (value) => !selectedDestinationSkuUsesLot || !!value || "Requerido",
          }}
          options={loteDestinoOptions}
          placeholder={
            loadingLotesDestino
              ? "Cargando lotes..."
              : selectedDestinationSkuUsesLot
                ? "Selecciona lote"
                : "SIN LOTE"
          }
          emptyText="Este SKU no tiene lotes registrados"
          disabled={isEditing || !selectedDestinationSkuUsesLot || loadingLotesDestino}
        />
        {errors?.lote_destino_id && <p className="error-msg text-xs">{errors.lote_destino_id.message}</p>}
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-gray-700">
          Cantidad <span className="text-red-500">*</span>
        </label>
        <input
          type="number"
          className={`input text-sm ${errors?.cantidad ? "input-error" : ""}`}
          placeholder="0"
          step="1"
          min="1"
          {...control.register(`detalles.${index}.cantidad`, {
            required: "Requerido",
            validate: (value) => isPositiveInteger(value) || "Debe ser un entero mayor a 0",
          })}
        />
        {errors?.cantidad && <p className="error-msg text-xs">{errors.cantidad.message}</p>}
      </div>

      {canRemove && (
        <button type="button" onClick={() => remove(index)} className="p-2 text-red-600 hover:text-red-800">
          <Trash2 size={16} />
        </button>
      )}

      {detalle?.categoria_destino_id && sourceName && skuOptions.length === 0 && (
        <p className="text-xs text-red-600 md:col-span-5">
          No existe {selectedStock?.sku_nombre} en esta categoria.
        </p>
      )}
      {skuDestinoId && selectedDestinationSkuUsesLot && lotesDestino.length === 0 && (
        <p className="text-xs text-red-600 md:col-span-5">
          Este SKU destino maneja lote, pero no tiene lotes registrados.
        </p>
      )}
      {skuDestinoId && selectedDestinationSkuUsesLot && lotesDestino.length > 0 && !matchingDestinationLot && selectedStock?.codigo_lote && (
        <p className="text-xs text-amber-700 md:col-span-5">
          No existe el lote origen {selectedStock.codigo_lote} en el SKU destino. Selecciona el lote destino manualmente.
        </p>
      )}
      {matchingDestinationLot && (
        <p className="text-xs text-gray-500 md:col-span-5">
          Lote destino sugerido por lote origen: {matchingDestinationLot.codigo_lote}
        </p>
      )}
    </div>
  );
}
