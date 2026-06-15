import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

function SortIcon({ active, direction }) {
  if (!active) return <ArrowUpDown size={13} className="text-gray-400" />;
  if (direction === 'asc') return <ArrowUp size={13} className="text-primary-600" />;
  return <ArrowDown size={13} className="text-primary-600" />;
}

export default function SortableFilterHeader({
  label,
  sortKey,
  sortConfig,
  onSort,
  filterValue = '',
  onFilterChange,
  placeholder = 'Buscar...',
  options,
  filterType = 'text',
  className = '',
}) {
  const isSortable = Boolean(sortKey);
  const isActive = isSortable && sortConfig?.key === sortKey;
  const direction = isActive ? (sortConfig?.direction ?? null) : null;

  return (
    <th className={className}>
      <div className="space-y-2 min-w-[120px]">
        <button
          type="button"
          onClick={() => isSortable && onSort?.(sortKey)}
          className={`flex items-center gap-1.5 uppercase tracking-wide ${isSortable ? 'cursor-pointer hover:text-primary-600' : 'cursor-default'}`}
        >
          <span>{label}</span>
          {isSortable && <SortIcon active={isActive} direction={direction} />}
        </button>

        {filterType === 'none' ? null : options ? (
          <select
            className="input h-9 min-h-0 py-1.5 text-xs font-normal"
            value={filterValue}
            onChange={(e) => onFilterChange?.(e.target.value)}
          >
            <option value="">{placeholder}</option>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            className="input h-9 min-h-0 py-1.5 text-xs font-normal"
            value={filterValue}
            onChange={(e) => onFilterChange?.(e.target.value)}
            placeholder={placeholder}
          />
        )}
      </div>
    </th>
  );
}
