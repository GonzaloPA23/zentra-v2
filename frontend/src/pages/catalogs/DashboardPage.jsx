import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  Boxes,
  CalendarDays,
  CheckCircle,
  ClipboardList,
  Clock,
  Filter,
  Layers,
  RotateCcw,
  Search,
  TrendingUp,
  Warehouse,
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { getSafeDate } from '../utils/date';
import StockTableMatrix from '../components/StockTableMatrix';

const COLORS = ['#2563eb', '#0891b2', '#16a34a', '#f59e0b', '#db2777', '#7c3aed', '#475569'];
const EMPTY_FILTERS = {
  almacen_id: '',
  categoria_id: '',
  tipo_mercaderia_id: '',
  sku: '',
  lote: '',
  vencimiento_desde: '',
  vencimiento_hasta: '',
};

function formatInt(value) {
  return Math.trunc(Number(value || 0)).toLocaleString('es-PE');
}

function StatCard({ icon: Icon, label, value, color, sub }) {
  return (
    <div className="stat-card">
      <div className={`stat-icon ${color}`}>
        <Icon size={22} className="text-white" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-2xl font-bold text-gray-900">{value ?? '-'}</p>
        <p className="text-sm text-gray-500">{label}</p>
        {sub && <p className="text-xs text-gray-400">{sub}</p>}
      </div>
    </div>
  );
}

function DashboardFilters({ filters, options, onChange, onClear }) {
  const tiposMercaderia = (options.tipos_mercaderia || []).filter((item) => (
    !filters.categoria_id || Number(item.categoria_id) === Number(filters.categoria_id)
  ));

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
            <Filter size={18} />
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900">Filtros generales</h2>
            <p className="text-sm text-gray-500">Aplican al resumen, alertas, graficas de stock y matriz.</p>
          </div>
        </div>
        <button type="button" className="btn-secondary btn-sm self-start lg:self-auto" onClick={onClear}>
          <RotateCcw size={14} />
          Limpiar
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="block">
          <span className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase text-gray-500">
            <Warehouse size={13} /> Almacen
          </span>
          <select className="input" value={filters.almacen_id} onChange={(e) => onChange('almacen_id', e.target.value)}>
            <option value="">Todos los almacenes</option>
            {(options.almacenes || []).map((item) => (
              <option key={item.id} value={item.id}>{item.nombre}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase text-gray-500">
            <Boxes size={13} /> Categoria
          </span>
          <select
            className="input"
            value={filters.categoria_id}
            onChange={(e) => {
              onChange('categoria_id', e.target.value);
              onChange('tipo_mercaderia_id', '');
            }}
          >
            <option value="">Todas las categorias</option>
            {(options.categorias || []).map((item) => (
              <option key={item.id} value={item.id}>{item.nombre}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase text-gray-500">
            <Layers size={13} /> Tipo
          </span>
          <select className="input" value={filters.tipo_mercaderia_id} onChange={(e) => onChange('tipo_mercaderia_id', e.target.value)}>
            <option value="">Todos los tipos</option>
            {tiposMercaderia.map((item) => (
              <option key={`${item.categoria_id || 'sin-categoria'}-${item.id}`} value={item.id}>
                {filters.categoria_id ? item.nombre : `${item.nombre} - ${item.categoria_nombre || 'Sin categoria'}`}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase text-gray-500">
            <Search size={13} /> SKU
          </span>
          <input className="input" placeholder="Nombre o codigo" value={filters.sku} onChange={(e) => onChange('sku', e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase text-gray-500">
            <Search size={13} /> Lote
          </span>
          <input className="input" placeholder="Codigo de lote" value={filters.lote} onChange={(e) => onChange('lote', e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase text-gray-500">
            <CalendarDays size={13} /> Vence desde
          </span>
          <input type="date" className="input" value={filters.vencimiento_desde} onChange={(e) => onChange('vencimiento_desde', e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase text-gray-500">
            <CalendarDays size={13} /> Vence hasta
          </span>
          <input type="date" className="input" value={filters.vencimiento_hasta} onChange={(e) => onChange('vencimiento_hasta', e.target.value)} />
        </label>
      </div>
    </div>
  );
}

function AlertRow({ item, tipo }) {
  const fechaVencimiento = getSafeDate(item.fecha_vencimiento);
  const dias = fechaVencimiento ? Math.ceil((fechaVencimiento - new Date()) / 86400000) : null;

  return (
    <div className={`flex items-center gap-3 rounded-lg p-3 text-sm ${tipo === 'vencido' ? 'bg-red-50' : 'bg-yellow-50'}`}>
      <AlertTriangle size={15} className={tipo === 'vencido' ? 'text-red-500' : 'text-yellow-500'} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-gray-900">{item.sku}</p>
        <p className="text-xs text-gray-500">{item.almacen} - Cant: {formatInt(item.cantidad)}</p>
      </div>
      <span className={`text-xs font-semibold ${tipo === 'vencido' ? 'text-red-600' : 'text-yellow-600'}`}>
        {tipo === 'vencido' ? 'VENCIDO' : dias === null ? '-' : `${dias}d`}
      </span>
    </div>
  );
}

function StockAlertRow({ item, tipo }) {
  return (
    <div className={`flex items-center gap-3 rounded-lg p-3 text-sm ${tipo === 'critico' ? 'bg-red-50' : 'bg-yellow-50'}`}>
      <AlertTriangle size={15} className={tipo === 'critico' ? 'text-red-500' : 'text-yellow-500'} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-gray-900">{item.sku}</p>
        <p className="text-xs text-gray-500">{item.almacen} - Stock: {formatInt(item.cantidad)}</p>
      </div>
      <span className={`text-xs font-semibold ${tipo === 'critico' ? 'text-red-600' : 'text-yellow-600'}`}>
        {tipo === 'critico' ? 'CRITICO' : 'BAJO'}
      </span>
    </div>
  );
}

export default function DashboardPage() {
  const { usuario } = useAuth();
  const [filters, setFilters] = useState(EMPTY_FILTERS);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    return params.toString();
  }, [filters]);

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', queryString],
    queryFn: () => api.get(`/dashboard/resumen?${queryString}`).then((r) => r.data.datos),
  });

  const { data: stockData, isLoading: isStockLoading } = useQuery({
    queryKey: ['stock-table', queryString],
    queryFn: () => api.get(`/dashboard/stock-table?${queryString}`).then((r) => r.data.datos),
  });

  const t = data?.totales ?? {};
  const porMes = (Array.isArray(data?.por_mes) ? data.por_mes : []).map((m) => ({
    mes: m.mes,
    total: parseInt(m.total, 10),
    cantidad: Math.trunc(Number(m.cantidad || 0)),
  }));
  const porCategoria = Array.isArray(data?.por_categoria) ? data.por_categoria : [];
  const alertas = {
    vencidos: Array.isArray(data?.alertas?.vencidos) ? data.alertas.vencidos : [],
    vencimientos_proximos: Array.isArray(data?.alertas?.vencimientos_proximos) ? data.alertas.vencimientos_proximos : [],
    stock_critico: Array.isArray(data?.alertas?.stock_critico) ? data.alertas.stock_critico : [],
    stock_bajo: Array.isArray(data?.alertas?.stock_bajo) ? data.alertas.stock_bajo : [],
    stock_limites: data?.alertas?.stock_limites ?? { critico: 100, bajo: 200 },
  };

  const stockRows = Array.isArray(stockData?.rows) ? stockData.rows : [];
  const stockTotal = stockRows.reduce((sum, row) => sum + Number(row.stock_final || 0), 0);
  const skuCount = new Set(stockRows.map((row) => row.sku_id).filter(Boolean)).size;
  const warehouseCount = new Set(stockRows.map((row) => row.almacen_id).filter(Boolean)).size;
  const lotCount = new Set(stockRows.map((row) => row.lote_id || `sin-lote-${row.sku_id}-${row.almacen_id}`).filter(Boolean)).size;
  const setFilter = (key, value) => setFilters((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">
          Bienvenido, {usuario?.nombre}. {format(new Date(), "EEEE d 'de' MMMM, yyyy", { locale: es })}
        </p>
      </div>

      <DashboardFilters
        filters={filters}
        options={stockData?.filtros || {}}
        onChange={setFilter}
        onClear={() => setFilters(EMPTY_FILTERS)}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={ClipboardList} label="Total registros" value={formatInt(t.total_registros)} color="bg-primary-500" />
        <StatCard icon={Clock} label="Pendientes" value={formatInt(t.pendientes)} color="bg-yellow-500" />
        <StatCard icon={TrendingUp} label="En transito" value={formatInt(t.en_transito)} color="bg-blue-500" />
        <StatCard icon={CheckCircle} label="Aprobados" value={formatInt(t.aprobados)} color="bg-green-500" sub={`${formatInt(t.hoy)} hoy`} />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={Boxes} label="Stock final" value={formatInt(stockTotal)} color="bg-slate-700" />
        <StatCard icon={Search} label="SKUs con stock" value={formatInt(skuCount)} color="bg-indigo-500" />
        <StatCard icon={Warehouse} label="Almacenes" value={formatInt(warehouseCount)} color="bg-cyan-600" />
        <StatCard icon={Layers} label="Lotes visibles" value={formatInt(lotCount)} color="bg-emerald-600" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <h3 className="mb-4 font-semibold text-gray-800">Registros por mes (ultimos 6 meses)</h3>
          {isLoading ? (
            <div className="flex h-56 items-center justify-center text-gray-400">Cargando...</div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={porMes} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#edf2f7" vertical={false} />
                <XAxis dataKey="mes" tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
                <Tooltip formatter={(value) => formatInt(value)} />
                <Bar dataKey="total" fill="#2563eb" radius={[6, 6, 0, 0]} name="Registros" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card">
          <h3 className="mb-4 font-semibold text-gray-800">Registros por categoria</h3>
          {isLoading ? (
            <div className="flex h-56 items-center justify-center text-gray-400">Cargando...</div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={porCategoria} dataKey="total" nameKey="nombre" cx="50%" cy="45%" innerRadius={54} outerRadius={82} paddingAngle={3}>
                  {porCategoria.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Tooltip formatter={(value) => formatInt(value)} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {(alertas.vencidos.length > 0 || alertas.vencimientos_proximos.length > 0) && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {alertas.vencidos.length > 0 && (
            <div className="card border-red-200">
              <h3 className="mb-3 flex items-center gap-2 font-semibold text-red-700">
                <AlertTriangle size={16} /> Productos vencidos ({alertas.vencidos.length})
              </h3>
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {alertas.vencidos.map((item) => (
                  <AlertRow key={item.id} item={item} tipo="vencido" />
                ))}
              </div>
            </div>
          )}
          {alertas.vencimientos_proximos.length > 0 && (
            <div className="card border-yellow-200">
              <h3 className="mb-3 flex items-center gap-2 font-semibold text-yellow-700">
                <AlertTriangle size={16} /> Proximos a vencer ({alertas.vencimientos_proximos.length})
              </h3>
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {alertas.vencimientos_proximos.map((item) => (
                  <AlertRow key={item.id} item={item} tipo="proximo" />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {(alertas.stock_critico.length > 0 || alertas.stock_bajo.length > 0) && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {alertas.stock_critico.length > 0 && (
            <div className="card border-red-200">
              <h3 className="mb-3 flex items-center gap-2 font-semibold text-red-700">
                <AlertTriangle size={16} /> Stock critico (&lt;= {alertas.stock_limites.critico} und)
              </h3>
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {alertas.stock_critico.map((item) => (
                  <StockAlertRow key={`${item.almacen_id}-${item.sku_id}`} item={item} tipo="critico" />
                ))}
              </div>
            </div>
          )}
          {alertas.stock_bajo.length > 0 && (
            <div className="card border-yellow-200">
              <h3 className="mb-3 flex items-center gap-2 font-semibold text-yellow-700">
                <AlertTriangle size={16} /> Stock bajo (&lt;= {alertas.stock_limites.bajo} und)
              </h3>
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {alertas.stock_bajo.map((item) => (
                  <StockAlertRow key={`${item.almacen_id}-${item.sku_id}`} item={item} tipo="bajo" />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <StockTableMatrix data={stockData} isLoading={isStockLoading} />
    </div>
  );
}
