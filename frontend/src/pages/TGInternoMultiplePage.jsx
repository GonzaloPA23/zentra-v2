import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { toast } from "react-toastify";
import { AlertCircle, ArrowLeft, Check, ChevronDown, Plus, Save, Search, Trash2, Upload, X } from "lucide-react";
import api from "../utils/api";
import SearchableSelect from "../components/SearchableSelect";

const emptyDestination = () => ({
  categoria_destino_id: "",
  sku_destino_id: "",
  lote_destino_id: "",
  cantidad: "",
});

const emptyOrigin = (stockRow, categoryId) => ({
  categoria_origen_id: String(categoryId || ""),
  source_stock_key: stockRow
    ? `${stockRow.sku_id}|${stockRow.lote_id ? stockRow.lote_id : "sin-lote"}`
    : "",
  sku_origen_id: stockRow?.sku_id ? String(stockRow.sku_id) : "",
  lote_origen_id: stockRow?.lote_id ? String(stockRow.lote_id) : "",
  stock_disponible: stockRow?.stock_disponible ? String(stockRow.stock_disponible) : "",
  sku_codigo: stockRow?.sku_codigo || "",
  sku_nombre: stockRow?.sku_nombre || "",
  codigo_lote: stockRow?.codigo_lote || "",
  cantidad_origen: "",
  detalles: [emptyDestination()],
});

function options(rows, labelBuilder) {
  return rows.map((row) => ({
    value: String(row.id),
    label: labelBuilder(row),
    raw: row,
  }));
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0;
}

function normalize(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toUpperCase();
}

function equivalentSku(source, target) {
  if (!source || !target || normalize(source.nombre) !== normalize(target.nombre)) return false;
  if (source.codigo && String(source.codigo) !== String(target.codigo || "")) return false;
  if (source.zona && target.zona && normalize(source.zona) !== normalize(target.zona)) return false;
  return true;
}

function usesLot(sku) {
  return sku?.tiene_lote === true || sku?.tiene_lote === 1 || sku?.tiene_lote === "1";
}

export default function TGInternoMultiplePage() {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const { data: almacenes = [] } = useQuery({
    queryKey: ["almacenes"],
    queryFn: () => api.get("/catalogos/almacenes").then((response) => response.data.datos),
  });
  const { data: categorias = [] } = useQuery({
    queryKey: ["categorias"],
    queryFn: () => api.get("/catalogos/categorias").then((response) => response.data.datos),
  });
  const { data: skus = [] } = useQuery({
    queryKey: ["skus"],
    queryFn: () => api.get("/catalogos/skus").then((response) => response.data.datos),
  });

  const { control, register, handleSubmit, setValue, formState: { errors } } = useForm({
    defaultValues: {
      almacen_id: "",
      categoria_origen_id: "",
      sku_origen_keys: [],
      observaciones: "",
      foto_guia: null,
      origenes: [],
    },
  });
  const { fields, replace } = useFieldArray({ control, name: "origenes" });
  const almacenId = useWatch({ control, name: "almacen_id" });
  const categoriaOrigenId = useWatch({ control, name: "categoria_origen_id" });
  const selectedSourceKeys = useWatch({ control, name: "sku_origen_keys" }) || [];
  const foto = useWatch({ control, name: "foto_guia" });
  const origenes = useWatch({ control, name: "origenes" }) || [];

  const { data: stockRows = [], isFetching: loadingStock } = useQuery({
    queryKey: ["tg-interno-stock", almacenId || "", categoriaOrigenId || ""],
    enabled: Boolean(almacenId && categoriaOrigenId),
    queryFn: () => api
      .get(`/tg-interno/stock?almacen_id=${almacenId}&categoria_id=${categoriaOrigenId}`)
      .then((response) => response.data.datos),
  });
  const stockOptions = stockRows.map((row) => ({
    value: `${row.sku_id}|${row.lote_id ? row.lote_id : "sin-lote"}`,
    label: `${row.sku_codigo ? `${row.sku_codigo} - ` : ""}${row.sku_nombre} | ${row.codigo_lote ? `Lote ${row.codigo_lote}` : "SIN LOTE"} | Stock ${Number(row.stock_disponible || 0).toFixed(2)}`,
    raw: row,
  }));

  const clearSelectedSources = () => {
    setValue("sku_origen_keys", []);
    replace([]);
  };

  const changeSelectedSources = (nextKeys) => {
    const currentByKey = new Map(origenes.map((origin) => [origin.source_stock_key, origin]));
    const nextOrigins = nextKeys.map((key) => {
      if (currentByKey.has(key)) return currentByKey.get(key);
      const row = stockRows.find((stockRow) => (
        `${stockRow.sku_id}|${stockRow.lote_id ? stockRow.lote_id : "sin-lote"}` === key
      ));
      return emptyOrigin(row, categoriaOrigenId);
    });
    setValue("sku_origen_keys", nextKeys, { shouldDirty: true });
    replace(nextOrigins);
  };

  const submit = async (data) => {
    const selectedFile = data.foto_guia?.[0];
    if (!selectedFile) return toast.error("La foto guía es obligatoria");
    if (!data.almacen_id) return toast.error("Selecciona un almacén");
    if (!data.origenes?.length) return toast.error("Agrega al menos un SKU origen");

    const sourceKeys = new Set();
    for (let index = 0; index < data.origenes.length; index += 1) {
      const origin = data.origenes[index];
      const number = index + 1;
      if (!origin.categoria_origen_id || !origin.sku_origen_id) {
        return toast.error(`Completa el SKU origen ${number}`);
      }
      const sourceKey = `${origin.sku_origen_id}|${origin.lote_origen_id || "sin-lote"}`;
      if (sourceKeys.has(sourceKey)) {
        return toast.error("No puedes repetir el mismo SKU y lote de origen");
      }
      sourceKeys.add(sourceKey);
      if (!positiveInteger(origin.cantidad_origen)) {
        return toast.error(`La cantidad del origen ${number} debe ser un entero mayor a 0`);
      }
      if (Number(origin.cantidad_origen) > Number(origin.stock_disponible || 0)) {
        return toast.error(`Stock insuficiente en el origen ${number}`);
      }
      if (!origin.detalles?.length) {
        return toast.error(`Agrega al menos un destino para el origen ${number}`);
      }
      if (origin.detalles.some((detail) => (
        !detail.categoria_destino_id ||
        !detail.sku_destino_id ||
        !positiveInteger(detail.cantidad)
      ))) {
        return toast.error(`Completa todos los destinos del origen ${number}`);
      }
      const missingLot = origin.detalles.some((detail) => {
        const destinationSku = skus.find((sku) => String(sku.id) === String(detail.sku_destino_id));
        return usesLot(destinationSku) && !detail.lote_destino_id;
      });
      if (missingLot) return toast.error(`Selecciona los lotes destino del origen ${number}`);
      const destinationTotal = origin.detalles.reduce(
        (sum, detail) => sum + Number(detail.cantidad || 0),
        0,
      );
      if (destinationTotal !== Number(origin.cantidad_origen)) {
        return toast.error(`Los destinos del origen ${number} deben sumar ${origin.cantidad_origen}`);
      }
    }

    setSaving(true);
    try {
      const formData = new FormData();
      formData.append("almacen_id", data.almacen_id);
      formData.append("observaciones", data.observaciones || "");
      formData.append("foto_guia", selectedFile);
      formData.append("origenes", JSON.stringify(data.origenes.map((origin) => ({
        categoria_origen_id: origin.categoria_origen_id,
        sku_origen_id: origin.sku_origen_id,
        lote_origen_id: origin.lote_origen_id || null,
        cantidad_origen: origin.cantidad_origen,
        detalles: origin.detalles.map((detail) => ({
          categoria_destino_id: detail.categoria_destino_id,
          sku_destino_id: detail.sku_destino_id,
          lote_destino_id: detail.lote_destino_id || null,
          cantidad: detail.cantidad,
        })),
      }))));
      const response = await api.post("/tg-interno/multiple", formData);
      toast.success(response.data.mensaje || "Transferencias registradas exitosamente");
      navigate("/tg-interno/listado");
    } catch (error) {
      toast.error(error.response?.data?.mensaje || "Error al guardar las transferencias");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => navigate("/tg-interno/listado")} className="btn-secondary btn-sm">
          <ArrowLeft size={14} /> Volver
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Transferencia TG INTERNO (Mismo Almacén)</h1>
          <p className="mt-1 text-sm text-gray-500">Traslada varios SKU y define los destinos de cada uno.</p>
        </div>
      </div>

      <div className="flex gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
        <AlertCircle size={20} className="mt-0.5 flex-shrink-0" />
        <div>
          <p className="font-semibold">Cómo funciona</p>
          <p className="mt-1">Selecciona el almacén y la categoría, marca uno o varios SKU origen y distribuye individualmente la cantidad de cada producto entre sus destinos.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit(submit)} className="space-y-6">
        <div className="card">
          <h3 className="mb-4 border-b border-gray-200 pb-2 font-semibold text-gray-800">Datos generales</h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="label">Almacén <span className="text-red-500">*</span></label>
              <SearchableSelect
                control={control}
                name="almacen_id"
                rules={{ required: "Requerido" }}
                options={options(almacenes, (warehouse) => warehouse.nombre)}
                placeholder="Selecciona almacén"
                onValueChange={() => {
                  setValue("categoria_origen_id", "");
                  clearSelectedSources();
                }}
              />
              {errors.almacen_id && <p className="error-msg">{errors.almacen_id.message}</p>}
            </div>
            <div>
              <label className="label">Categoría origen <span className="text-red-500">*</span></label>
              <SearchableSelect
                control={control}
                name="categoria_origen_id"
                rules={{ required: "Requerido" }}
                options={options(categorias, (category) => category.nombre)}
                placeholder={almacenId ? "Selecciona categoría" : "Selecciona almacén primero"}
                disabled={!almacenId}
                onValueChange={clearSelectedSources}
              />
              {errors.categoria_origen_id && <p className="error-msg">{errors.categoria_origen_id.message}</p>}
            </div>
            <div className="md:col-span-2">
              <label className="label">SKU origen <span className="text-red-500">*</span></label>
              <SkuMultiSelect
                options={stockOptions}
                values={selectedSourceKeys}
                onChange={changeSelectedSources}
                disabled={!almacenId || !categoriaOrigenId || loadingStock}
                placeholder={loadingStock ? "Cargando stock..." : categoriaOrigenId ? "Selecciona uno o varios SKU" : "Selecciona almacén y categoría primero"}
              />
              <p className="mt-1 text-xs text-gray-500">Marca todos los SKU que forman parte del traslado.</p>
            </div>
            <div>
              <label className="label">Observaciones</label>
              <textarea className="input" rows={2} placeholder="Motivo del traslado (opcional)" {...register("observaciones")} />
            </div>
            <div>
              <label className="label">Foto guía <span className="text-red-500">*</span></label>
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50">
                <Upload size={16} /> {foto?.[0]?.name || "Subir archivo"}
                <input type="file" accept=".jpg,.jpeg,.png,.pdf" className="hidden" {...register("foto_guia", { required: "Foto guía requerida" })} />
              </label>
              {errors.foto_guia && <p className="error-msg">{errors.foto_guia.message}</p>}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Distribución por SKU</h2>
            <p className="text-sm text-gray-500">Completa la cantidad y los destinos de cada SKU seleccionado.</p>
          </div>
          {fields.length > 0 && <span className="rounded-full bg-blue-100 px-3 py-1 text-sm font-semibold text-blue-700">{fields.length} SKU seleccionado{fields.length === 1 ? "" : "s"}</span>}
        </div>

        {!fields.length && (
          <div className="card border-dashed py-10 text-center text-gray-500">
            Selecciona uno o varios SKU origen en Datos generales.
          </div>
        )}

        {fields.map((field, index) => (
          <OriginCard
            key={field.id}
            index={index}
            control={control}
            setValue={setValue}
            categorias={categorias}
            skus={skus}
            remove={() => changeSelectedSources(selectedSourceKeys.filter((key) => key !== origenes[index]?.source_stock_key))}
          />
        ))}

        <div className="flex justify-end gap-3 pb-6">
          <button type="button" className="btn-secondary" onClick={() => navigate("/tg-interno/listado")}>Cancelar</button>
          <button type="submit" className="btn-primary" disabled={saving || !foto?.[0] || !fields.length}>
            {saving ? "Guardando..." : <><Save size={15} /> Guardar {fields.length} transferencia{fields.length === 1 ? "" : "s"}</>}
          </button>
        </div>
      </form>
    </div>
  );
}

function OriginCard({ index, control, setValue, categorias, skus, remove }) {
  const base = `origenes.${index}`;
  const origin = useWatch({ control, name: base }) || {};
  const { fields, append, remove: removeDestination } = useFieldArray({ control, name: `${base}.detalles` });
  const categoryId = origin.categoria_origen_id;
  const selectedStock = {
    sku_id: origin.sku_origen_id,
    sku_codigo: origin.sku_codigo,
    sku_nombre: origin.sku_nombre,
    lote_id: origin.lote_origen_id,
    codigo_lote: origin.codigo_lote,
    stock_disponible: origin.stock_disponible,
  };
  const sourceSku = skus.find((sku) => String(sku.id) === String(origin.sku_origen_id || "")) || null;
  const validCategoryIds = new Set(
    skus.filter((sku) => equivalentSku(sourceSku, sku) && String(sku.categoria_id) !== String(categoryId)).map((sku) => String(sku.categoria_id)),
  );
  const destinationCategoryOptions = options(categorias, (category) => category.nombre).filter((option) => validCategoryIds.has(option.value));
  const amount = Number(origin.cantidad_origen || 0);
  const destinationTotal = (origin.detalles || []).reduce((sum, detail) => sum + Number(detail.cantidad || 0), 0);
  const matches = amount > 0 && amount === destinationTotal;

  return (
    <section className="card border-l-4 border-l-blue-500">
      <div className="mb-4 flex items-center justify-between border-b border-gray-200 pb-3">
        <div>
          <h3 className="font-bold text-gray-900">SKU origen {index + 1}: {origin.sku_codigo ? `${origin.sku_codigo} - ` : ""}{origin.sku_nombre}</h3>
          <p className="text-xs text-gray-500">{origin.codigo_lote ? `Lote ${origin.codigo_lote}` : "SIN LOTE"} · Stock disponible: {Number(origin.stock_disponible || 0).toFixed(2)}</p>
        </div>
        <button type="button" onClick={remove} className="btn-danger btn-sm"><Trash2 size={14} /> Quitar SKU</button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label className="label">Cantidad a trasladar <span className="text-red-500">*</span></label>
          <input type="number" min="1" step="1" className="input" disabled={!selectedStock} {...control.register(`${base}.cantidad_origen`)} />
          {selectedStock && <p className="mt-1 text-xs text-gray-500">Stock disponible: {Number(selectedStock.stock_disponible).toFixed(2)}</p>}
        </div>
        <div className="flex items-end">
          {amount > 0 && <div className={`w-full rounded-lg border p-3 text-sm font-semibold ${matches ? "border-green-200 bg-green-50 text-green-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>Origen: {amount} | Destinos: {destinationTotal} {matches ? "Correcto" : "No coincide"}</div>}
        </div>
      </div>

      <div className="mt-5">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="font-semibold text-gray-800">Destinos del SKU origen {index + 1}</h4>
          <button type="button" className="btn-primary btn-sm" disabled={!selectedStock || !destinationCategoryOptions.length} onClick={() => append(emptyDestination())}>
            <Plus size={14} /> Agregar destino
          </button>
        </div>
        <div className="space-y-3">
          {fields.map((field, detailIndex) => (
            <DestinationRow
              key={field.id}
              base={`${base}.detalles.${detailIndex}`}
              number={detailIndex + 1}
              control={control}
              setValue={setValue}
              sourceSku={sourceSku}
              sourceStock={selectedStock}
              categoryOptions={destinationCategoryOptions}
              skus={skus}
              canRemove={fields.length > 1}
              remove={() => removeDestination(detailIndex)}
            />
          ))}
          {selectedStock && !destinationCategoryOptions.length && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Este SKU no tiene categorías destino disponibles.</div>}
        </div>
      </div>
    </section>
  );
}

function SkuMultiSelect({ options: availableOptions, values, onChange, disabled, placeholder }) {
  const rootRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selectedSet = useMemo(() => new Set(values), [values]);
  const selectedOptions = availableOptions.filter((option) => selectedSet.has(option.value));
  const filteredOptions = availableOptions.filter((option) => (
    normalize(option.label).includes(normalize(search))
  ));

  useEffect(() => {
    const close = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const toggle = (value) => {
    onChange(selectedSet.has(value)
      ? values.filter((selected) => selected !== value)
      : [...values, value]);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="input flex min-h-11 items-center justify-between gap-3 text-left"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={values.length ? "text-gray-900" : "text-gray-400"}>
          {values.length ? `${values.length} SKU seleccionado${values.length === 1 ? "" : "s"}` : placeholder}
        </span>
        <ChevronDown size={16} className={`text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {selectedOptions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2 rounded-lg border border-blue-100 bg-blue-50 p-2">
          {selectedOptions.map((option) => (
            <span key={option.value} className="inline-flex max-w-full items-center gap-1 rounded-full bg-white px-3 py-1 text-xs font-medium text-blue-700 shadow-sm">
              <span className="truncate">{option.label}</span>
              <button type="button" onClick={() => toggle(option.value)} aria-label={`Quitar ${option.label}`} className="rounded-full p-0.5 hover:bg-blue-100"><X size={12} /></button>
            </span>
          ))}
        </div>
      )}

      {open && !disabled && (
        <div className="absolute z-50 mt-1 w-full rounded-xl border border-gray-200 bg-white shadow-xl">
          <div className="relative border-b border-gray-100 p-2">
            <Search size={15} className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} className="input h-9 py-1 pl-9 text-sm" placeholder="Buscar SKU por código o nombre..." autoFocus />
          </div>
          <div className="max-h-72 overflow-y-auto p-1">
            {!filteredOptions.length ? (
              <p className="px-3 py-3 text-sm text-gray-500">No hay SKU con stock disponible.</p>
            ) : filteredOptions.map((option) => {
              const selected = selectedSet.has(option.value);
              return (
                <button key={option.value} type="button" onClick={() => toggle(option.value)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ${selected ? "bg-blue-50 text-blue-700" : "text-gray-700 hover:bg-gray-50"}`}>
                  <span className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${selected ? "border-blue-600 bg-blue-600 text-white" : "border-gray-300"}`}>{selected && <Check size={11} />}</span>
                  <span>{option.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function DestinationRow({ base, number, control, setValue, sourceSku, sourceStock, categoryOptions, skus, canRemove, remove }) {
  const detail = useWatch({ control, name: base }) || {};
  const categoryId = detail.categoria_destino_id;
  const skuId = detail.sku_destino_id;
  const skuOptions = skus
    .filter((sku) => String(sku.categoria_id) === String(categoryId || "") && equivalentSku(sourceSku, sku))
    .map((sku) => ({ value: String(sku.id), label: `${sku.codigo ? `${sku.codigo} - ` : ""}${sku.nombre}${sku.zona ? ` | ${sku.zona}` : ""}`, raw: sku }));
  const selectedSku = skus.find((sku) => String(sku.id) === String(skuId || "")) || null;
  const skuUsesLot = usesLot(selectedSku);
  const { data: lots = [], isFetching } = useQuery({
    queryKey: ["tg-interno-lotes-destino", skuId || ""],
    enabled: Boolean(skuId && skuUsesLot),
    queryFn: () => api.get(`/catalogos/lotes?sku_id=${skuId}`).then((response) => response.data.datos),
  });
  const lotOptions = options(lots, (lot) => `${lot.codigo_lote || "SIN LOTE"}${lot.fecha_vencimiento ? ` | Vence ${lot.fecha_vencimiento}` : ""}`);

  useEffect(() => {
    if (!categoryId) return;
    const valid = skuOptions.some((option) => option.value === String(skuId || ""));
    const nextSku = valid ? String(skuId) : (skuOptions[0]?.value || "");
    if (nextSku !== String(skuId || "")) {
      setValue(`${base}.sku_destino_id`, nextSku);
      setValue(`${base}.lote_destino_id`, "");
    }
  }, [base, categoryId, setValue, skuId, skuOptions]);

  useEffect(() => {
    if (!skuUsesLot || isFetching || detail.lote_destino_id) return;
    const sourceLot = normalize(sourceStock?.codigo_lote);
    const matching = sourceLot ? lots.find((lot) => normalize(lot.codigo_lote) === sourceLot) : null;
    if (matching?.id) setValue(`${base}.lote_destino_id`, String(matching.id));
  }, [base, detail.lote_destino_id, isFetching, lots, setValue, skuUsesLot, sourceStock?.codigo_lote]);

  return (
    <div className="grid grid-cols-1 gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 md:grid-cols-[1fr_1fr_12rem_9rem_auto] md:items-end">
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-700">Categoría destino {number} <span className="text-red-500">*</span></label>
        <SearchableSelect control={control} name={`${base}.categoria_destino_id`} options={categoryOptions} placeholder="Selecciona categoría" onValueChange={() => { setValue(`${base}.sku_destino_id`, ""); setValue(`${base}.lote_destino_id`, ""); }} />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-700">SKU destino <span className="text-red-500">*</span></label>
        <SearchableSelect control={control} name={`${base}.sku_destino_id`} options={skuOptions} placeholder={categoryId ? "Selecciona SKU destino" : "Selecciona categoría"} disabled={!categoryId} emptyText="No existe SKU equivalente" onValueChange={() => setValue(`${base}.lote_destino_id`, "")} />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-700">Lote destino {skuUsesLot && <span className="text-red-500">*</span>}</label>
        <SearchableSelect control={control} name={`${base}.lote_destino_id`} options={lotOptions} placeholder={isFetching ? "Cargando lotes..." : skuUsesLot ? "Selecciona lote" : "SIN LOTE"} disabled={!skuUsesLot || isFetching} emptyText="No hay lotes registrados" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-700">Cantidad <span className="text-red-500">*</span></label>
        <input type="number" min="1" step="1" className="input text-sm" {...control.register(`${base}.cantidad`)} />
      </div>
      {canRemove && <button type="button" onClick={remove} className="p-2 text-red-600 hover:text-red-800"><Trash2 size={16} /></button>}
    </div>
  );
}
