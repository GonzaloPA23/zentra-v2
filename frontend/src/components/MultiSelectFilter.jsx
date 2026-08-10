import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export default function MultiSelectFilter({
  options = [],
  values = [],
  onChange,
  placeholder = "Seleccionar...",
  searchPlaceholder = "Buscar...",
  emptyText = "Sin opciones disponibles",
}) {
  const rootRef = useRef(null);
  const searchRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const normalizedValues = useMemo(
    () => values.map((value) => String(value)),
    [values],
  );
  const selectedSet = useMemo(
    () => new Set(normalizedValues),
    [normalizedValues],
  );
  const normalizedOptions = useMemo(
    () =>
      options.map((option) => ({
        ...option,
        value: String(option.value),
      })),
    [options],
  );
  const selectedOptions = useMemo(
    () =>
      normalizedValues
        .map((value) =>
          normalizedOptions.find((option) => option.value === value),
        )
        .filter(Boolean),
    [normalizedOptions, normalizedValues],
  );
  const filteredOptions = useMemo(() => {
    const term = normalize(query.trim());
    if (!term) return normalizedOptions;
    return normalizedOptions.filter((option) =>
      normalize(`${option.label || ""} ${option.searchText || ""}`).includes(
        term,
      ),
    );
  }, [normalizedOptions, query]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return undefined;
    }
    const timer = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  const toggleOption = (value) => {
    const next = selectedSet.has(value)
      ? normalizedValues.filter((selected) => selected !== value)
      : [...normalizedValues, value];
    onChange?.(next);
  };

  const selectVisible = () => {
    const next = new Set(normalizedValues);
    filteredOptions.forEach((option) => next.add(option.value));
    onChange?.([...next]);
  };

  const removeOption = (value) => {
    onChange?.(normalizedValues.filter((selected) => selected !== value));
  };

  return (
    <div ref={rootRef} className="relative w-full">
      <button
        type="button"
        className="input flex min-h-11 items-center justify-between gap-3 text-left"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <span className={selectedOptions.length ? "text-gray-900" : "text-gray-400"}>
          {selectedOptions.length
            ? `${selectedOptions.length} SKU seleccionado${selectedOptions.length === 1 ? "" : "s"}`
            : placeholder}
        </span>
        <ChevronDown
          size={16}
          className={`flex-shrink-0 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {selectedOptions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2 rounded-xl border border-blue-100 bg-blue-50 p-2">
          {selectedOptions.map((option) => (
            <span
              key={option.value}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-medium text-blue-700 shadow-sm"
            >
              <span className="truncate">{option.label}</span>
              <button
                type="button"
                className="rounded-full p-0.5 hover:bg-blue-100"
                onClick={() => removeOption(option.value)}
                aria-label={`Quitar ${option.label}`}
              >
                <X size={12} />
              </button>
            </span>
          ))}
          <button
            type="button"
            className="px-2 py-1 text-xs font-semibold text-blue-700 hover:text-blue-900"
            onClick={() => onChange?.([])}
          >
            Limpiar selección
          </button>
        </div>
      )}

      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[320px] rounded-xl border border-gray-200 bg-white shadow-xl">
          <div className="border-b border-gray-100 p-2">
            <div className="relative">
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                ref={searchRef}
                type="text"
                className="input h-9 min-h-0 py-1.5 pl-9 text-sm"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={searchPlaceholder}
              />
            </div>
            <div className="mt-2 flex items-center justify-between px-1">
              <button
                type="button"
                className="text-xs font-semibold text-blue-600 hover:text-blue-800"
                onClick={selectVisible}
              >
                Seleccionar visibles
              </button>
              {normalizedValues.length > 0 && (
                <button
                  type="button"
                  className="text-xs font-semibold text-gray-500 hover:text-gray-700"
                  onClick={() => onChange?.([])}
                >
                  Limpiar
                </button>
              )}
            </div>
          </div>

          <div className="max-h-64 overflow-y-auto p-1">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-3 text-sm text-gray-400">{emptyText}</div>
            ) : (
              filteredOptions.map((option) => {
                const selected = selectedSet.has(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                      selected
                        ? "bg-blue-50 text-blue-700"
                        : "text-gray-700 hover:bg-gray-50"
                    }`}
                    onClick={() => toggleOption(option.value)}
                  >
                    <span
                      className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${
                        selected
                          ? "border-blue-600 bg-blue-600 text-white"
                          : "border-gray-300 bg-white"
                      }`}
                    >
                      {selected && <Check size={11} />}
                    </span>
                    <span>{option.label}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
