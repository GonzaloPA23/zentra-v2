import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Search } from 'lucide-react';

export default function DataTable({
  columns,
  data = [],
  loading,
  searchPlaceholder = 'Buscar...',
  actions,
  onRowClick,
  rowKey,
}) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [columnFilters, setColumnFilters] = useState({});
  const [sortConfig, setSortConfig] = useState({ key: '', direction: '' });
  const PER_PAGE = 15;
  const safeData = Array.isArray(data) ? data : [];

  const getColumnValue = (row, col, purpose = 'value') => {
    const key = `${purpose}Value`;
    if (typeof col[key] === 'function') return col[key](row);
    if (typeof col.value === 'function') return col.value(row);
    if (typeof col.accessor === 'function') return col.accessor(row);
    if (col.accessor) return String(col.accessor).split('.').reduce((current, part) => current?.[part], row);
    return '';
  };

  const normalize = (value) => String(value ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  const searchableColumns = columns.filter((col) => col.searchable || col.accessor || col.searchValue || col.value);

  const filtered = useMemo(() => {
    const globalSearch = normalize(search);

    return safeData.filter((row) => {
      const matchesGlobal = !globalSearch || searchableColumns.some((col) => (
        normalize(getColumnValue(row, col, 'search')).includes(globalSearch)
      ));
      if (!matchesGlobal) return false;

      return columns.every((col, index) => {
        const filterValue = columnFilters[index];
        if (!filterValue) return true;
        return normalize(getColumnValue(row, col, 'filter')).includes(normalize(filterValue));
      });
    });
  }, [safeData, columns, searchableColumns, search, columnFilters]);

  const sorted = useMemo(() => {
    if (!sortConfig.key) return filtered;
    const column = columns[Number(sortConfig.key)];
    if (!column) return filtered;

    return [...filtered].sort((a, b) => {
      const aValue = getColumnValue(a, column, 'sort');
      const bValue = getColumnValue(b, column, 'sort');
      const aNumber = Number(aValue);
      const bNumber = Number(bValue);

      let result;
      if (Number.isFinite(aNumber) && Number.isFinite(bNumber) && String(aValue).trim() !== '' && String(bValue).trim() !== '') {
        result = aNumber - bNumber;
      } else {
        result = normalize(aValue).localeCompare(normalize(bValue), 'es', { numeric: true });
      }

      return sortConfig.direction === 'desc' ? -result : result;
    });
  }, [filtered, columns, sortConfig]);

  const pages = Math.ceil(sorted.length / PER_PAGE);
  const currentPage = pages > 0 ? Math.min(page, pages) : 1;
  const paged = sorted.slice((currentPage - 1) * PER_PAGE, currentPage * PER_PAGE);

  const handleSort = (index) => {
    setSortConfig((current) => {
      if (current.key !== String(index)) return { key: String(index), direction: 'asc' };
      if (current.direction === 'asc') return { key: String(index), direction: 'desc' };
      return { key: '', direction: '' };
    });
    setPage(1);
  };

  const handleFilter = (index, value) => {
    setColumnFilters((current) => ({ ...current, [index]: value }));
    setPage(1);
  };

  const renderSortIcon = (index) => {
    if (sortConfig.key !== String(index)) return <ArrowUpDown size={13} className="text-gray-400" />;
    if (sortConfig.direction === 'asc') return <ArrowUp size={13} className="text-primary-600" />;
    return <ArrowDown size={13} className="text-primary-600" />;
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="relative w-full sm:w-72">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            className="input pl-9"
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        {actions && <div className="flex gap-2 flex-shrink-0">{actions}</div>}
      </div>

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              {columns.map((col, i) => {
                const hasValue = Boolean(col.accessor || col.value || col.searchValue || col.filterValue || col.sortValue);
                const filterable = col.filterable ?? (hasValue && col.header !== 'Acciones');
                const sortable = col.sortable ?? (hasValue && col.header !== 'Acciones');

                return (
                <th key={i} style={col.width ? { width: col.width } : {}}>
                  <div className="min-w-[110px] space-y-2">
                    <button
                      type="button"
                      onClick={() => sortable && handleSort(i)}
                      className={`flex items-center gap-1.5 uppercase tracking-wide ${sortable ? 'cursor-pointer hover:text-primary-600' : 'cursor-default'}`}
                    >
                      <span>{col.header}</span>
                      {sortable && renderSortIcon(i)}
                    </button>

                    {filterable && (
                      col.filterOptions ? (
                        <select
                          className="input h-9 min-h-0 py-1.5 text-xs font-normal"
                          value={columnFilters[i] || ''}
                          onChange={(e) => handleFilter(i, e.target.value)}
                        >
                          <option value="">{col.filterPlaceholder || 'Todos'}</option>
                          {col.filterOptions.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          className="input h-9 min-h-0 py-1.5 text-xs font-normal"
                          value={columnFilters[i] || ''}
                          onChange={(e) => handleFilter(i, e.target.value)}
                          placeholder={col.filterPlaceholder || 'Buscar...'}
                        />
                      )
                    )}
                  </div>
                </th>
              );})}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columns.length} className="text-center py-12 text-gray-400">
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-5 h-5 border-2 border-primary-400 border-t-transparent rounded-full animate-spin" />
                    Cargando...
                  </div>
                </td>
              </tr>
            ) : paged.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="text-center py-12 text-gray-400">
                  {search || Object.values(columnFilters).some(Boolean) ? 'No se encontraron resultados.' : 'Sin registros disponibles.'}
                </td>
              </tr>
            ) : (
              paged.map((row, i) => (
                <tr
                  key={typeof rowKey === 'function' ? rowKey(row, i) : (row[rowKey] ?? i)}
                  onClick={() => onRowClick?.(row)}
                  className={onRowClick ? 'cursor-pointer hover:bg-blue-50' : undefined}
                >
                  {columns.map((col, j) => (
                    <td key={j}>
                      {col.render ? col.render(row) : row[col.accessor]}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>{sorted.length} registros</span>
          <div className="flex items-center gap-1">
            <button className="btn-icon" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
              <ChevronLeft size={16} />
            </button>
            <span className="px-3">{currentPage} / {pages}</span>
            <button className="btn-icon" onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={currentPage === pages}>
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
