import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { toast } from "react-toastify";
import api, { getMensajeError } from "../utils/api";
import { useAuth } from "../context/AuthContext";
import DataTable from "../components/DataTable";
import Modal from "../components/Modal";
import ConfirmDialog from "../components/ConfirmDialog";
import { Plus, Pencil, Trash2, Loader2 } from "lucide-react";

const ROLES = ["admin", "supervisor", "almacenero"];
const ROL_BADGE = {
  admin: "badge-blue",
  supervisor: "badge-green",
  almacenero: "badge-gray",
};

function parseIdList(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

// Genera email a partir de nombre y apellido: nombre.apellido@gdb.com.pe
// Quita tildes, espacios y caracteres especiales
function generarEmail(nombre, apellido) {
  const limpiar = (s) =>
    s
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // quitar tildes
      .replace(/[^a-z0-9]/g, ""); // solo letras y números
  const n = limpiar(nombre || "");
  const a = limpiar(apellido || "");
  if (!n && !a) return "";
  if (!a) return `${n}@gdb.com.pe`;
  return `${n}.${a}@gdb.com.pe`;
}

function UsuarioForm({
  defaults,
  onSubmit,
  onCancel,
  loading,
  isEdit,
  isSuperAdmin,
  empresaIdActual,
}) {
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm({
    defaultValues: {
      nombre: defaults?.nombre || "",
      apellido: defaults?.apellido || "",
      email: defaults?.email || "",
      rol: defaults?.rol || "almacenero",
      activo: defaults?.activo ?? true,
      empresa_id: defaults?.empresa_id || empresaIdActual || "",
      ciudad_id: defaults?.ciudad_id ? String(defaults.ciudad_id) : "",
      ciudad_ids: parseIdList(defaults?.ciudad_ids || defaults?.ciudad_id),
      almacenes: defaults?.almacenes_ids || [],
    },
  });

  const empresaSeleccionada = watch("empresa_id");
  const ciudadesSeleccionadas = parseIdList(watch("ciudad_ids"));
  const nombre = watch("nombre");
  const apellido = watch("apellido");

  // Auto-generar email solo al crear, no al editar
  const handleNombreChange = (e) => {
    setValue("nombre", e.target.value);
    if (!isEdit) setValue("email", generarEmail(e.target.value, apellido));
  };
  const handleApellidoChange = (e) => {
    setValue("apellido", e.target.value);
    if (!isEdit) setValue("email", generarEmail(nombre, e.target.value));
  };

  // Empresas — solo superadmin las necesita
  const { data: empresas = [] } = useQuery({
    queryKey: ["empresas"],
    queryFn: () => api.get("/empresas").then((r) => r.data.datos),
    enabled: isSuperAdmin,
  });

  // Empresa efectiva para cargar almacenes:
  // - superadmin: la que seleccione en el form
  // - admin: su propia empresa (viene en empresaIdActual)
  const empresaEfectiva = isSuperAdmin ? empresaSeleccionada : empresaIdActual;

  const { data: almacenes = [] } = useQuery({
    queryKey: ["almacenes-form", empresaEfectiva],
    queryFn: () =>
      api
        .get(`/catalogos/almacenes?empresa_id=${empresaEfectiva}`)
        .then((r) => r.data.datos),
    enabled: !!empresaEfectiva,
  });
  const { data: ciudades = [] } = useQuery({
    queryKey: ["ciudades-form", empresaEfectiva],
    queryFn: () =>
      api
        .get(`/catalogos/ciudades?empresa_id=${empresaEfectiva}`)
        .then((r) => r.data.datos),
    enabled: !!empresaEfectiva,
  });
  const almacenesFiltrados = ciudadesSeleccionadas.length
    ? almacenes.filter((almacen) => ciudadesSeleccionadas.includes(String(almacen.ciudad_id)))
    : almacenes;

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <div className="modal-body space-y-4">
        {/* Selector empresa — SOLO superadmin al crear */}
        {isSuperAdmin && !isEdit && (
          <div>
            <label className="label">
              Empresa <span className="text-red-500">*</span>
            </label>
            <select
              className={`input ${errors.empresa_id ? "input-error" : ""}`}
              {...register("empresa_id", { required: "Empresa requerida" })}
            >
              <option value="">Seleccionar empresa...</option>
              {empresas
                .filter((e) => e.activo)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nombre}
                  </option>
                ))}
            </select>
            {errors.empresa_id && (
              <p className="error-msg">{errors.empresa_id.message}</p>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">
              Nombre <span className="text-red-500">*</span>
            </label>
            <input
              className={`input ${errors.nombre ? "input-error" : ""}`}
              {...register("nombre", { required: "Requerido" })}
              onChange={handleNombreChange}
            />
            {errors.nombre && (
              <p className="error-msg">{errors.nombre.message}</p>
            )}
          </div>
          <div>
            <label className="label">
              Apellido <span className="text-red-500">*</span>
            </label>
            <input
              className={`input ${errors.apellido ? "input-error" : ""}`}
              {...register("apellido", { required: "Requerido" })}
              onChange={handleApellidoChange}
            />
            {errors.apellido && (
              <p className="error-msg">{errors.apellido.message}</p>
            )}
          </div>
        </div>

        <div>
          <label className="label">
            Email <span className="text-red-500">*</span>
          </label>
          <input
            type="email"
            className={`input ${errors.email ? "input-error" : ""}`}
            {...register("email", {
              required: "Requerido",
              pattern: {
                value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                message: "Email inválido",
              },
            })}
          />
          {errors.email && <p className="error-msg">{errors.email.message}</p>}
        </div>

        <div>
          <label className="label">
            Contraseña{" "}
            {isEdit ? (
              <span className="text-gray-400 font-normal text-xs">
                (dejar vacío para no cambiar)
              </span>
            ) : (
              <span className="text-red-500">*</span>
            )}
          </label>
          <input
            type="password"
            className={`input ${errors.password ? "input-error" : ""}`}
            autoComplete="new-password"
            placeholder={isEdit ? "••••••••" : "Mínimo 8 caracteres"}
            {...register("password", {
              required: !isEdit ? "Requerido" : false,
              minLength: { value: 8, message: "Mínimo 8 caracteres" },
            })}
          />
          {errors.password && (
            <p className="error-msg">{errors.password.message}</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">
              Rol <span className="text-red-500">*</span>
            </label>
            <select
              className={`input ${errors.rol ? "input-error" : ""}`}
              {...register("rol", { required: "Requerido" })}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r.charAt(0).toUpperCase() + r.slice(1)}
                </option>
              ))}
            </select>
            {errors.rol && <p className="error-msg">{errors.rol.message}</p>}
          </div>
          {isEdit && (
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  {...register("activo")}
                  defaultChecked={defaults?.activo}
                />
                Usuario activo
              </label>
            </div>
          )}
        </div>

        <div>
          <label className="label">
            Ciudades asignadas <span className="text-red-500">*</span>
          </label>
          <div className={`max-h-44 space-y-1 overflow-y-auto rounded-lg border bg-gray-50 p-3 ${errors.ciudad_ids ? "border-red-300" : "border-gray-200"}`}>
            {ciudades.length === 0 ? (
              <p className="py-2 text-center text-sm text-gray-400">Sin ciudades disponibles.</p>
            ) : ciudades.map((ciudad) => (
              <label key={ciudad.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-white">
                <input
                  type="checkbox"
                  value={ciudad.id}
                  {...register("ciudad_ids", {
                    validate: (value, formValues) =>
                      ["supervisor", "almacenero"].includes(formValues.rol) && parseIdList(value).length === 0
                        ? "Selecciona al menos una ciudad"
                        : true,
                  })}
                />
                <span className="flex-1 text-gray-800">{ciudad.nombre}</span>
                <span className="text-xs text-gray-400">{ciudad.zona || ciudad.region_nombre || ""}</span>
              </label>
            ))}
          </div>
          <input
            type="hidden"
            {...register("ciudad_id", {
              validate: (value, formValues) =>
                ["supervisor", "almacenero"].includes(formValues.rol) && parseIdList(formValues.ciudad_ids).length === 0
                  ? "Ciudad requerida"
                  : true,
            })}
          />
          {errors.ciudad_ids && (
            <p className="error-msg">{errors.ciudad_ids.message}</p>
          )}
        </div>

        {/* Almacenes */}
        <div>
          <label className="label">Almacenes asignados</label>
          <div className="border border-gray-200 rounded-lg p-3 max-h-52 overflow-y-auto space-y-1 bg-gray-50">
            {!empresaEfectiva ? (
              <p className="text-sm text-gray-400 text-center py-3">
                {isSuperAdmin
                  ? "Selecciona una empresa para ver sus almacenes."
                  : "Cargando almacenes..."}
              </p>
            ) : almacenesFiltrados.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-3">
                No hay almacenes registrados para la ciudad seleccionada.
              </p>
            ) : (
              almacenesFiltrados.map((a) => (
                <label
                  key={a.id}
                  className="flex items-center gap-2 text-sm cursor-pointer hover:bg-white px-2 py-1.5 rounded transition-colors"
                >
                  <input
                    type="checkbox"
                    value={a.id}
                    defaultChecked={(defaults?.almacenes_ids ?? [])
                      .map(String)
                      .includes(String(a.id))}
                    {...register("almacenes")}
                  />
                  <span className="text-gray-800 flex-1">{a.nombre}</span>
                  <span className="text-xs text-gray-400">
                    {a.ciudad_nombre} · {a.zona || ""}
                  </span>
                </label>
              ))
            )}
          </div>
          <p className="text-xs text-gray-400 mt-1">
            Los almaceneros solo acceden a sus almacenes asignados.
          </p>
        </div>
      </div>

      <div className="modal-footer">
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancelar
        </button>
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? (
            <>
              <Loader2 size={14} className="animate-spin" /> Guardando...
            </>
          ) : (
            "Guardar Usuario"
          )}
        </button>
      </div>
    </form>
  );
}

export default function UsuariosPage() {
  const { usuario } = useAuth();
  const isSuperAdmin = usuario?.rol === "superadmin";
  const qc = useQueryClient();

  const [modal, setModal] = useState(null);
  const [selected, setSelected] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const { data: usuarios = [], isLoading } = useQuery({
    queryKey: ["usuarios"],
    queryFn: () => api.get("/usuarios").then((r) => r.data.datos),
  });

  const { data: almacenes = [] } = useQuery({
    queryKey: ["almacenes"],
    queryFn: () => api.get("/catalogos/almacenes").then((r) => r.data.datos),
  });

  const mutCreate = useMutation({
    mutationFn: (d) => api.post("/usuarios", d),
    onSuccess: () => {
      qc.invalidateQueries(["usuarios"]);
      toast.success("Usuario creado");
      closeModal();
    },
    onError: (e) => toast.error(getMensajeError(e)),
  });

  const mutUpdate = useMutation({
    mutationFn: (d) => api.put(`/usuarios/${selected.id}`, d),
    onSuccess: () => {
      qc.invalidateQueries(["usuarios"]);
      toast.success("Usuario actualizado");
      closeModal();
    },
    onError: (e) => toast.error(getMensajeError(e)),
  });

  const mutDelete = useMutation({
    mutationFn: () => api.delete(`/usuarios/${deleting.id}`),
    onSuccess: () => {
      qc.invalidateQueries(["usuarios"]);
      toast.success("Usuario desactivado");
      setDeleting(null);
    },
    onError: (e) => {
      toast.error(getMensajeError(e));
      setDeleting(null);
    },
  });

  const openEdit = (u) => {
    const nombresAsignados = (u.almacenes || "").split(", ").filter(Boolean);
    const idsAsignados = almacenes
      .filter((a) => nombresAsignados.includes(a.nombre))
      .map((a) => String(a.id));
    setSelected({ ...u, ciudad_ids: parseIdList(u.ciudad_ids || u.ciudad_id), almacenes_ids: idsAsignados });
    setModal("edit");
  };

  const closeModal = () => {
    setModal(null);
    setSelected(null);
  };

  const handleSubmit = (data) => {
    // empresa_id: superadmin lo elige en el form, admin usa el suyo propio
    const empresaId = isSuperAdmin
      ? parseInt(data.empresa_id)
      : usuario.empresa_id;

    const ciudadIds = parseIdList(data.ciudad_ids);
    const payload = {
      nombre: data.nombre,
      apellido: data.apellido,
      email: data.email,
      rol: data.rol,
      empresa_id: empresaId,
      ciudad_id: ciudadIds[0] ? Number(ciudadIds[0]) : null,
      ciudad_ids: ciudadIds.map(Number).filter(Boolean),
      activo: data.activo ?? true,
      almacenes: Array.isArray(data.almacenes)
        ? data.almacenes.map(Number).filter(Boolean)
        : [],
    };
    if (data.password) payload.password = data.password;

    if (modal === "create") mutCreate.mutate(payload);
    else mutUpdate.mutate(payload);
  };

  const columns = [
    { header: "#", accessor: "id", width: 50 },
    {
      header: "Usuario",
      searchable: true,
      searchValue: (r) => `${r.nombre || ""} ${r.apellido || ""} ${r.email || ""}`,
      sortValue: (r) => `${r.nombre || ""} ${r.apellido || ""}`,
      filterValue: (r) => `${r.nombre || ""} ${r.apellido || ""} ${r.email || ""}`,
      render: (r) => (
        <div>
          <p className="font-medium text-gray-900">
            {r.nombre} {r.apellido}
          </p>
          <p className="text-xs text-gray-400">{r.email}</p>
        </div>
      ),
    },
    {
      header: "Rol",
      accessor: "rol",
      render: (r) => (
        <span className={ROL_BADGE[r.rol] || "badge-gray"}>{r.rol}</span>
      ),
    },
    ...(isSuperAdmin
      ? [
          {
            header: "Empresa",
            accessor: "empresa_nombre",
            render: (r) => (
              <span className="text-sm text-gray-600">
                {r.empresa_nombre || "—"}
              </span>
            ),
          },
        ]
      : []),
    {
      header: "Ciudad",
      filterValue: (r) => `${r.ciudad_nombre || ""} ${r.zona || ""}`,
      sortValue: (r) => `${r.ciudad_nombre || ""} ${r.zona || ""}`,
      render: (r) => (
        <span className="text-sm text-gray-600">
          {r.ciudad_nombre ? `${r.ciudad_nombre} · ${r.zona || ""}` : "Sin ciudad"}
        </span>
      ),
    },
    {
      header: "Almacenes",
      accessor: "almacenes",
      render: (r) => (
        <span
          className="text-xs text-gray-500 max-w-xs block truncate"
          title={r.almacenes}
        >
          {r.almacenes || "Sin asignar"}
        </span>
      ),
    },
    {
      header: "Estado",
      filterValue: (r) => (r.activo ? "Activo" : "Inactivo"),
      sortValue: (r) => (r.activo ? "Activo" : "Inactivo"),
      render: (r) => (
        <span className={r.activo ? "badge-green" : "badge-red"}>
          {r.activo ? "Activo" : "Inactivo"}
        </span>
      ),
    },
    {
      header: "Acciones",
      width: 90,
      render: (r) => (
        <div className="flex items-center gap-1">
          <button
            className="btn-icon text-blue-500"
            title="Editar"
            onClick={() => openEdit(r)}
          >
            <Pencil size={14} />
          </button>
          <button
            className="btn-icon text-red-500"
            title="Desactivar"
            onClick={() => setDeleting(r)}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Usuarios</h1>
        <p className="text-sm text-gray-500 mt-1">
          {isSuperAdmin
            ? "Todos los usuarios del sistema"
            : "Usuarios de tu empresa"}
        </p>
      </div>

      <DataTable
        columns={columns}
        data={usuarios}
        loading={isLoading}
        searchPlaceholder="Buscar por nombre o email..."
        actions={
          <button
            className="btn-primary btn-sm"
            onClick={() => setModal("create")}
          >
            <Plus size={14} /> Nuevo Usuario
          </button>
        }
      />

      <Modal
        open={!!modal}
        onClose={closeModal}
        title={
          modal === "create"
            ? "Nuevo Usuario"
            : `Editar: ${selected?.nombre} ${selected?.apellido}`
        }
        size="lg"
      >
        <UsuarioForm
          defaults={selected}
          onSubmit={handleSubmit}
          onCancel={closeModal}
          loading={mutCreate.isPending || mutUpdate.isPending}
          isEdit={modal === "edit"}
          isSuperAdmin={isSuperAdmin}
          empresaIdActual={usuario?.empresa_id}
        />
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => mutDelete.mutate()}
        loading={mutDelete.isPending}
        title="Desactivar Usuario"
        message={`¿Desactivar a "${deleting?.nombre} ${deleting?.apellido}"? No podrá ingresar al sistema.`}
      />
    </div>
  );
}
