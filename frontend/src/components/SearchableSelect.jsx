import { useEffect, useMemo, useRef, useState } from 'react';
import { useController } from 'react-hook-form';
import { Check, ChevronDown, Search } from 'lucide-react';

function normalizeOptionValue(value) {
  return value === null || value === undefined ? '' : String(value);
}

export default function SearchableSelect({
  control,
  name,
  rules,
  options = [],
  placeholder = 'Seleccionar...',
  searchPlaceholder = 'Buscar...',
  emptyText = 'Sin opciones disponibles',
  disabled = false,
  onValueChange,
  className = '',
  buttonClassName = '',
  optionToSearchText,
}) {
  const { field, fieldState } = useController({ control, name, rules });
  const rootRef = useRef(null);
  const searchInputRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selectedValue = normalizeOptionValue(field.value);
  const normalizedOptions = useMemo(
    () => options.map((option) => ({
      ...option,
      value: normalizeOptionValue(option.value),
    })),
    [options]
  );

  const selectedOption = useMemo(
    () => normalizedOptions.find((option) => option.value === selectedValue) || null,
    [normalizedOptions, selectedValue]
  );

  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return normalizedOptions;

    return normalizedOptions.filter((option) => {
      const haystack = optionToSearchText
        ? optionToSearchText(option)
        : `${option.label || ''} ${option.searchText || ''}`;
      return haystack.toLowerCase().includes(normalizedQuery);
    });
  }, [normalizedOptions, optionToSearchText, query]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }

    const timer = window.setTimeout(() => {
      searchInputRef.current?.focus();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);

  const handleSelect = (option) => {
    field.onChange(option.value);
    onValueChange?.(option.value, option);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        className={`input flex items-center justify-between gap-3 text-left ${fieldState.error ? 'input-error' : ''} ${buttonClassName}`}
        onClick={() => !disabled && setOpen((prev) => !prev)}
        disabled={disabled}
      >
        <span className={selectedOption ? 'text-gray-900' : 'text-gray-400'}>
          {selectedOption?.label || placeholder}
        </span>
        <ChevronDown size={16} className={`flex-shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && !disabled && (
        <div className="absolute z-40 mt-1 w-full rounded-xl border border-gray-200 bg-white shadow-xl">
          <div className="border-b border-gray-100 p-2">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                ref={searchInputRef}
                type="text"
                className="input h-9 min-h-0 py-1.5 pl-9 text-sm"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={searchPlaceholder}
              />
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto p-1">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-2 text-sm text-gray-400">{emptyText}</div>
            ) : (
              filteredOptions.map((option) => {
                const active = option.value === selectedValue;
                return (
                  <button
                    key={`${name}-${option.value}`}
                    type="button"
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                      active ? 'bg-primary-50 text-primary-700' : 'text-gray-700 hover:bg-gray-50'
                    }`}
                    onClick={() => handleSelect(option)}
                  >
                    <span>{option.label}</span>
                    {active && <Check size={14} className="flex-shrink-0" />}
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
