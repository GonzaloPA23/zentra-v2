import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Download, ArrowLeft, Edit, Trash2 } from "lucide-react";
import { toast } from "react-toastify";
import api from "../utils/api";
import { downloadBlobResponse, getBlobErrorMessage } from "../utils/download";
import DataTable from "../components/DataTable";
import { useAuth } from "../context/AuthContext";

export default function TGInternoListadoPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasRole } = useAuth();
  const [filtro, setFiltro] = useState("activos");
  const canManage = hasRole("superadmin", "admin");

  const { data: transferencias = [], isLoading } = useQuery({
    queryKey: ["tg-interno-transferencias"],
    queryFn: () => api.get("/tg-interno").then((r) => r.data.datos),
  });

  const { data: almacenes = [] } = useQuery({
    queryKey: ["almacenes"],
    queryFn: () => api.get("/catalogos/almacenes").then((r) => r.data.datos),
  });

  const { data: categorias = [] } = useQuery({
    queryKey: ["categorias"],
    queryFn: () => api.get("/catalogos/categorias").then((r) => r.data.datos),
  });

  const getAlmacenNombre = (id) => almacenes.find((a) => a.id === Number(id))?.nombre || "N/A";
  const getCategoriaNombre = (id) => categorias.find((c) => c.id === Number(id))?.nombre || "N/A";

  const filtradas = transferencias.filter((t) => {
    if (filtro === "activos") return t.activo;
    if (filtro === "inactivos") return !t.activo;
    return true;
  });

  const columns = [
    { header: "ID", accessor: "id", width: 70 },
    {
      header: "Almacén",
      value: (row) => getAlmacenNombre(row.almacen_id),
      render: (row) => getAlmacenNombre(row.almacen_id),
    },
    {
      header: "Cat. Origen",
      value: (row) => getCategoriaNombre(row.categoria_origen_id),
      render: (row) => getCategoriaNombre(row.categoria_origen_id),
    },
    {
      header: "SKU Origen",
      value: (row) => row.sku_origen_nombre || "",
      render: (row) => row.sku_origen_nombre || "N/A",
    },
    { header: "Cantidad", accessor: "cantidad_origen" },
    {
      header: "Sustento",
      value: (row) => row.foto_guia || "",
      render: (row) => row.foto_guia ? (
        <a
          href={`/uploads/${row.foto_guia}`}
          target="_blank"
          rel="noreferrer"
          className="text-xs font-medium text-blue-600 hover:text-blue-800"
          onClick={(event) => event.stopPropagation()}
        >
          Ver archivo
        </a>
      ) : "-",
    },
    {
      header: "Destinos",
      value: (row) => `${Number(row.detalles_count || 0)} categorias`,
      render: (row) => (
        <span className="inline-block rounded bg-blue-100 px-2 py-1 text-xs font-medium text-blue-800">
          {Number(row.detalles_count || 0)} categorías
        </span>
      ),
    },
    { header: "Usuario", accessor: "usuario_nombre", render: (row) => row.usuario_nombre || "N/A" },
    {
      header: "Fecha",
      accessor: "created_at",
      render: (row) => row.created_at ? new Date(row.created_at).toLocaleDateString("es-PE") : "-",
    },
    ...(canManage ? [{
      header: "Acciones",
      sortable: false,
      filterable: false,
      render: (row) => (
        <div className="flex items-center gap-2">
          {row.activo && (
            <>
              <button
                type="button"
                className="btn-icon text-blue-600 hover:bg-blue-50"
                title="Editar montos"
                onClick={(event) => {
                  event.stopPropagation();
                  navigate(`/tg-interno/${row.id}/editar`);
                }}
              >
                <Edit size={15} />
              </button>
              <button
                type="button"
                className="btn-icon text-red-600 hover:bg-red-50"
                title="Anular"
                onClick={(event) => {
                  event.stopPropagation();
                  handleAnular(row);
                }}
              >
                <Trash2 size={15} />
              </button>
            </>
          )}
        </div>
      ),
    }] : []),
  ];

  const handleAnular = async (row) => {
    if (!window.confirm(`Deseas anular la transferencia TG INTERNO #${row.id}?`)) return;

    try {
      await api.delete(`/tg-interno/${row.id}`);
      toast.success("Transferencia anulada correctamente");
      queryClient.invalidateQueries(["tg-interno-transferencias"]);
    } catch (error) {
      toast.error(error.response?.data?.mensaje || "Error al anular");
    }
  };

  const handleExportar = async () => {
    try {
      const response = await api.get("/tg-interno/export", {
        responseType: "blob",
        timeout: 120_000,
      });
      await downloadBlobResponse(
        response,
        `tg-interno-${new Date().toISOString().split("T")[0]}.xlsx`,
      );
    } catch (error) {
      console.error("Error al exportar:", error);
      toast.error(await getBlobErrorMessage(error, "No se pudo exportar TG INTERNO"));
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="btn-secondary btn-sm"
          >
            <ArrowLeft size={14} /> Volver
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">TG INTERNO - Transferencias</h1>
            <p className="mt-1 text-sm text-gray-500">
              Movimientos entre categorías en mismo almacén
            </p>
          </div>
        </div>

        <div className="flex gap-2 flex-col md:flex-row">
          <button
            type="button"
            onClick={handleExportar}
            className="btn-secondary btn-sm"
          >
            <Download size={14} /> Exportar
          </button>
          <button
            onClick={() => navigate("/tg-interno/nuevo")}
            className="btn-primary btn-sm"
          >
            <Plus size={14} /> Nueva Transferencia
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="card">
        <div className="flex gap-4">
          <button
            onClick={() => setFiltro("todos")}
            className={`px-4 py-2 rounded text-sm font-medium ${
              filtro === "todos"
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            Todos
          </button>
          <button
            onClick={() => setFiltro("activos")}
            className={`px-4 py-2 rounded text-sm font-medium ${
              filtro === "activos"
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            Activos
          </button>
          <button
            onClick={() => setFiltro("inactivos")}
            className={`px-4 py-2 rounded text-sm font-medium ${
              filtro === "inactivos"
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            Inactivos
          </button>
        </div>
      </div>

      {/* Tabla */}
      <div className="card overflow-x-auto">
        <DataTable
          columns={columns}
          data={filtradas}
          loading={isLoading}
          searchPlaceholder="Buscar transferencias..."
          rowKey="id"
          onRowClick={(row) => navigate(`/tg-interno/detalle/${row.id}`)}
        />
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="card">
          <p className="text-sm text-gray-600">Total Transferencias</p>
          <p className="text-3xl font-bold text-blue-600">{filtradas.length}</p>
        </div>
        <div className="card">
          <p className="text-sm text-gray-600">Cantidad Total Movida</p>
          <p className="text-3xl font-bold text-green-600">
            {filtradas
              .reduce((sum, t) => sum + Number(t.cantidad_origen), 0)
              .toFixed(2)}
          </p>
        </div>
        <div className="card">
          <p className="text-sm text-gray-600">Últimas 24 horas</p>
          <p className="text-3xl font-bold text-orange-600">
            {filtradas
              .filter(
                (t) =>
                  new Date(t.created_at) > new Date(Date.now() - 24 * 60 * 60 * 1000)
              )
              .length.toString()}
          </p>
        </div>
      </div>
    </div>
  );
}
