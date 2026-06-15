import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Boxes, Layers, PackageSearch, Warehouse } from 'lucide-react';
import { formatSafeDate } from '../utils/date';

const CHART_COLORS = {
  almacen: '#2563eb',
  categoria: '#0891b2',
  tipo: '#16a34a',
};
const CATEGORY_COLORS = ['#0891b2', '#2563eb', '#16a34a', '#f59e0b', '#db2777', '#7c3aed', '#475569', '#0f766e'];
const TYPE_COLORS = ['#16a34a', '#2563eb', '#f59e0b', '#db2777', '#7c3aed', '#0891b2', '#475569'];

function formatInt(value) {
  return Math.trunc(Number(value || 0)).toLocaleString('es-PE');
}

function shortLabel(value, limit = 24) {
  const text = String(value || 'SIN DATO');
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function ChartHeader({ title, icon: Icon, detail }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-100 text-gray-700">
          <Icon size={17} />
        </div>
        <div>
          <h3 className="font-semibold text-gray-800">{title}</h3>
          {detail && <p className="text-xs text-gray-500">{detail}</p>}
        </div>
      </div>
    </div>
  );
}

function WarehouseBarCard({ data }) {
  const chartData = (Array.isArray(data) ? data : []).map((item) => ({
    ...item,
    label: shortLabel(item.nombre, 34),
  }));
  const chartHeight = Math.max(360, chartData.length * 24 + 72);

  return (
    <div className="card">
      <ChartHeader title="Stock por almacen" icon={Warehouse} detail={`${formatInt(chartData.length)} almacenes visibles`} />

      {chartData.length === 0 ? (
        <div className="flex h-64 items-center justify-center text-sm text-gray-400">Sin datos para graficar</div>
      ) : (
        <div className="max-h-[680px] overflow-y-auto pr-2">
          <ResponsiveContainer width="100%" height={chartHeight}>
            <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 34, left: 26, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#edf2f7" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={formatInt} />
            <YAxis
              type="category"
              dataKey="label"
              width={190}
              tick={{ fontSize: 11, fill: '#334155' }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              formatter={(value) => [formatInt(value), 'Stock final']}
              labelFormatter={(_, payload) => payload?.[0]?.payload?.nombre || ''}
            />
              <Bar dataKey="stock" fill={CHART_COLORS.almacen} radius={[0, 6, 6, 0]} name="Stock final" barSize={16} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function CategoryDonutCard({ data }) {
  const chartData = Array.isArray(data) ? data : [];
  const total = chartData.reduce((sum, item) => sum + Number(item.stock || 0), 0);

  return (
    <div className="card">
      <ChartHeader title="Stock por categoria" icon={Boxes} detail={`${formatInt(total)} unidades`} />
      {chartData.length === 0 ? (
        <div className="flex h-72 items-center justify-center text-sm text-gray-400">Sin datos para graficar</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_180px]">
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={chartData} dataKey="stock" nameKey="nombre" cx="50%" cy="50%" innerRadius={62} outerRadius={98} paddingAngle={3}>
                {chartData.map((_, index) => (
                  <Cell key={index} fill={CATEGORY_COLORS[index % CATEGORY_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => [formatInt(value), 'Stock final']} />
            </PieChart>
          </ResponsiveContainer>
          <div className="space-y-2 self-center">
            {chartData.slice(0, 8).map((item, index) => (
              <div key={`${item.nombre}-${index}`} className="flex items-center justify-between gap-3 text-xs">
                <span className="flex min-w-0 items-center gap-2 text-gray-600">
                  <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: CATEGORY_COLORS[index % CATEGORY_COLORS.length] }} />
                  <span className="truncate">{item.nombre}</span>
                </span>
                <span className="font-semibold text-gray-900">{formatInt(item.stock)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TypeRadialCard({ data }) {
  const chartData = (Array.isArray(data) ? data : []).map((item, index) => ({
    ...item,
    fill: TYPE_COLORS[index % TYPE_COLORS.length],
  }));
  const maxStock = Math.max(...chartData.map((item) => Number(item.stock || 0)), 1);

  return (
    <div className="card">
      <ChartHeader title="Stock por tipo" icon={Layers} detail={`${formatInt(chartData.length)} tipos`} />
      {chartData.length === 0 ? (
        <div className="flex h-72 items-center justify-center text-sm text-gray-400">Sin datos para graficar</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_190px]">
          <ResponsiveContainer width="100%" height={280}>
            <RadialBarChart innerRadius="18%" outerRadius="96%" data={chartData} startAngle={90} endAngle={-270}>
              <PolarAngleAxis type="number" domain={[0, maxStock]} tick={false} />
              <RadialBar dataKey="stock" background cornerRadius={8} />
              <Tooltip formatter={(value) => [formatInt(value), 'Stock final']} />
            </RadialBarChart>
          </ResponsiveContainer>
          <div className="space-y-2 self-center">
            {chartData.map((item, index) => (
              <div key={`${item.nombre}-${index}`} className="flex items-center justify-between gap-3 text-xs">
                <span className="flex min-w-0 items-center gap-2 text-gray-600">
                  <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: item.fill }} />
                  <span className="truncate">{item.nombre}</span>
                </span>
                <span className="font-semibold text-gray-900">{formatInt(item.stock)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StockTableMatrix({ data, isLoading }) {
  const rows = data?.rows || [];
  const resumen = data?.resumen || {};
  const stockTotal = rows.reduce((sum, row) => sum + Number(row.stock_final || 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-3 flex items-center gap-2">
          <PackageSearch size={18} className="text-primary-600" />
          <h2 className="text-lg font-semibold text-gray-900">Analisis de stock</h2>
        </div>
        <div className="space-y-6">
          <WarehouseBarCard data={resumen.por_almacen || []} />
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <CategoryDonutCard data={resumen.por_categoria || []} />
            <TypeRadialCard data={resumen.por_tipo_mercaderia || []} />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="font-semibold text-gray-800">Stock final por SKU y lote</h3>
            <p className="text-sm text-gray-500">{formatInt(stockTotal)} unidades visibles</p>
          </div>
          <span className="badge-blue self-start md:self-auto">{formatInt(rows.length)} filas</span>
        </div>

        {isLoading ? (
          <div className="py-10 text-center text-gray-500">Cargando...</div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-gray-500">No hay stock para los filtros seleccionados</div>
        ) : (
          <div className="max-h-[520px] overflow-auto rounded-lg border border-gray-200">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-3">Almacen</th>
                  <th className="px-3 py-3">Zona</th>
                  <th className="px-3 py-3">Categoria</th>
                  <th className="px-3 py-3">Tipo mercaderia</th>
                  <th className="px-3 py-3">Cod. SKU</th>
                  <th className="px-3 py-3">SKU</th>
                  <th className="px-3 py-3">Lote</th>
                  <th className="px-3 py-3">Fecha vencimiento</th>
                  <th className="px-3 py-3 text-right">Stock final</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.almacen_id}-${row.sku_id}-${row.lote_id || 'sin-lote'}`} className="border-t border-gray-100 hover:bg-blue-50">
                    <td className="px-3 py-2 font-medium text-gray-900">{row.almacen || '-'}</td>
                    <td className="px-3 py-2">{row.zona || '-'}</td>
                    <td className="px-3 py-2">{row.categoria || '-'}</td>
                    <td className="px-3 py-2">{row.tipo_mercaderia || '-'}</td>
                    <td className="px-3 py-2">{row.sku_codigo || '-'}</td>
                    <td className="min-w-64 px-3 py-2">{row.sku || '-'}</td>
                    <td className="px-3 py-2">{row.lote || '-'}</td>
                    <td className="px-3 py-2">{formatSafeDate(row.fecha_vencimiento)}</td>
                    <td className="px-3 py-2 text-right font-semibold">{formatInt(row.stock_final)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default StockTableMatrix;
