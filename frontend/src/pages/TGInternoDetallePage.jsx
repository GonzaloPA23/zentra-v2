import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Printer, Edit, Trash2 } from "lucide-react";
import { toast } from "react-toastify";
import api from "../utils/api";
import { useAuth } from "../context/AuthContext";

export default function TGInternoDetallePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const canManage = hasRole("superadmin", "admin");

  const { data: transferencia, isLoading } = useQuery({
    queryKey: ["tg-interno-detalle", id],
    queryFn: () => api.get(`/tg-interno/${id}`).then((r) => r.data.dato),
  });

  const { data: almacenes = [] } = useQuery({
    queryKey: ["almacenes"],
    queryFn: () => api.get("/catalogos/almacenes").then((r) => r.data.datos),
  });

  const { data: categorias = [] } = useQuery({
    queryKey: ["categorias"],
    queryFn: () => api.get("/catalogos/categorias").then((r) => r.data.datos),
  });

  const handleAnular = async () => {
    if (!window.confirm("¿Deseas anular esta transferencia?")) return;

    try {
      await api.delete(`/tg-interno/${id}`);
      toast.success("Transferencia anulada exitosamente");
      navigate("/tg-interno/listado");
    } catch (error) {
      toast.error(error.response?.data?.mensaje || "Error al anular");
    }
  };

  const getAlmacenNombre = (id) => almacenes.find((a) => a.id === Number(id))?.nombre || "N/A";
  const getCategoriaNombre = (id) => categorias.find((c) => c.id === Number(id))?.nombre || "N/A";

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Cargando...</p>
        </div>
      </div>
    );
  }

  if (!transferencia) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <div className="card text-center py-12">
          <p className="text-gray-600">Transferencia no encontrada</p>
          <button
            onClick={() => navigate("/tg-interno/listado")}
            className="btn-primary btn-sm mt-4"
          >
            Volver al listado
          </button>
        </div>
      </div>
    );
  }

  const sumaDestinos = transferencia.detalles?.reduce(
    (sum, d) => sum + Number(d.cantidad),
    0
  ) || 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate("/tg-interno/listado")}
            className="btn-secondary btn-sm"
          >
            <ArrowLeft size={14} /> Volver
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Detalle TG INTERNO #{transferencia.id}
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              {new Date(transferencia.created_at).toLocaleDateString("es-PE")}
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="btn-secondary btn-sm"
          >
            <Printer size={14} /> Imprimir
          </button>
          {canManage && transferencia.activo && (
            <button
              type="button"
              onClick={() => navigate(`/tg-interno/${id}/editar`)}
              className="btn-secondary btn-sm"
            >
              <Edit size={14} /> Editar
            </button>
          )}
          {canManage && transferencia.activo && (
            <button
              type="button"
              onClick={handleAnular}
              className="btn-secondary btn-sm bg-red-50 text-red-600 hover:bg-red-100"
            >
              <Trash2 size={14} /> Anular
            </button>
          )}
        </div>
      </div>

      {/* Estado */}
      {!transferencia.activo && (
        <div className="p-4 bg-red-50 border border-red-200 rounded text-red-800 text-sm">
          ⚠️ Esta transferencia ha sido anulada
        </div>
      )}

      {/* Información Principal */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 border-b pb-2">
          Información Principal
        </h2>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <p className="text-sm font-medium text-gray-600">Almacén</p>
            <p className="text-lg font-semibold text-gray-900">
              {getAlmacenNombre(transferencia.almacen_id)}
            </p>
          </div>

          <div>
            <p className="text-sm font-medium text-gray-600">Usuario</p>
            <p className="text-lg font-semibold text-gray-900">
              {transferencia.usuario_nombre || "N/A"}
            </p>
          </div>

          <div>
            <p className="text-sm font-medium text-gray-600">Categoría Origen</p>
            <p className="text-lg font-semibold text-gray-900">
              {getCategoriaNombre(transferencia.categoria_origen_id)}
            </p>
          </div>

          <div>
            <p className="text-sm font-medium text-gray-600">SKU Origen</p>
            <p className="text-lg font-semibold text-gray-900">
              {transferencia.sku_origen_nombre || "N/A"}
            </p>
            {transferencia.lote_origen_codigo && (
              <p className="text-sm text-gray-500">Lote {transferencia.lote_origen_codigo}</p>
            )}
          </div>

          <div>
            <p className="text-sm font-medium text-gray-600">Cantidad Origen</p>
            <p className="text-lg font-semibold text-blue-600">
              {Number(transferencia.cantidad_origen).toFixed(2)}
            </p>
          </div>

          {transferencia.foto_guia && (
            <div>
              <p className="text-sm font-medium text-gray-600">Sustento guía</p>
              <a
                href={`/uploads/${transferencia.foto_guia}`}
                target="_blank"
                rel="noreferrer"
                className="btn-secondary btn-sm mt-1 inline-flex"
              >
                Ver archivo
              </a>
            </div>
          )}

          {transferencia.observaciones && (
            <div className="md:col-span-2">
              <p className="text-sm font-medium text-gray-600">Observaciones</p>
              <p className="text-gray-900">{transferencia.observaciones}</p>
            </div>
          )}
        </div>
      </div>

      {/* Destinos */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 border-b pb-2">
          Categorías Destino
        </h2>

        {transferencia.detalles && transferencia.detalles.length > 0 ? (
          <div className="space-y-3">
            {transferencia.detalles.map((detalle, index) => (
              <div
                key={detalle.id}
                className="p-4 border border-gray-200 rounded bg-gray-50 flex justify-between items-center"
              >
                <div>
                  <p className="text-sm font-medium text-gray-600">
                    Destino {index + 1}
                  </p>
                  <p className="text-lg font-semibold text-gray-900">
                    {getCategoriaNombre(detalle.categoria_destino_id)}
                  </p>
                  <p className="text-sm text-gray-600">
                    {detalle.sku_destino_nombre || "SKU no registrado"}
                    {detalle.lote_destino_codigo ? ` | Lote ${detalle.lote_destino_codigo}` : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-gray-600">Cantidad</p>
                  <p className="text-2xl font-bold text-green-600">
                    {Number(detalle.cantidad).toFixed(2)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500">Sin destinos registrados</p>
        )}

        {/* Resumen */}
        <div className="mt-6 p-4 bg-blue-50 border-l-4 border-blue-600 rounded">
          <p className="text-sm font-medium text-gray-600">Verificación</p>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-gray-900 font-semibold">
              Origen: {Number(transferencia.cantidad_origen).toFixed(2)} ÷ Destinos: {sumaDestinos.toFixed(2)}
            </span>
            <span
              className={`text-lg font-bold ${
                Math.abs(Number(transferencia.cantidad_origen) - sumaDestinos) < 0.01
                  ? "text-green-600"
                  : "text-red-600"
              }`}
            >
              {Math.abs(Number(transferencia.cantidad_origen) - sumaDestinos) < 0.01
                ? "✓ Correcta"
                : "✗ Error"}
            </span>
          </div>
        </div>
      </div>

      {/* Timestamps */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 border-b pb-2">
          Auditoría
        </h2>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <p className="text-sm font-medium text-gray-600">Creada</p>
            <p className="text-gray-900">
              {new Date(transferencia.created_at).toLocaleString("es-PE")}
            </p>
          </div>
          {transferencia.updated_at && (
            <div>
              <p className="text-sm font-medium text-gray-600">Última modificación</p>
              <p className="text-gray-900">
                {new Date(transferencia.updated_at).toLocaleString("es-PE")}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Botones */}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => navigate("/tg-interno/listado")}
          className="btn-secondary flex-1"
        >
          Volver al listado
        </button>
      </div>
    </div>
  );
}
