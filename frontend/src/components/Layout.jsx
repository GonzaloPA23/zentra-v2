import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import api from "../utils/api";
import { formatSafeDate } from "../utils/date";
import {
  LayoutDashboard,
  ClipboardList,
  Package,
  Users,
  Building2,
  ChevronDown,
  ChevronRight,
  Menu,
  X,
  LogOut,
  User,
  Boxes,
  Tag,
  Warehouse,
  UserCheck,
  Activity,
  AlertTriangle,
  Layers,
  Bell,
  Settings,
  Truck,
} from "lucide-react";

const NAV = [
  {
    label: "Dashboard",
    to: "/",
    icon: LayoutDashboard,
    roles: ["superadmin", "admin", "supervisor", "almacenero"],
    exact: true,
  },
  {
    label: "Módulo 1: Registros",
    to: "/registros",
    icon: ClipboardList,
    roles: ["superadmin", "admin", "supervisor", "almacenero"],
  },
  {
    label: "TG INTERNO",
    to: "/tg-interno/listado",
    icon: Package,
    roles: ["superadmin", "admin", "almacenero"],
  },
  {
    label: "Historial",
    to: "/historial",
    icon: Bell,
    roles: ["superadmin", "admin", "supervisor"],
  },
  {
    label: "Módulo 2: Tránsito",
    to: "/transito-aprobaciones",
    icon: Truck,
    roles: ["superadmin", "admin", "supervisor", "almacenero"],
  },
  {
    label: "Catálogos",
    icon: Package,
    roles: ["superadmin", "admin"],
    children: [
      { label: "Categorías", to: "/catalogos/categorias", icon: Tag },
      {
        label: "Tipos Mercadería",
        to: "/catalogos/tipos-mercaderia",
        icon: Layers,
      },
      { label: "Almacenes", to: "/catalogos/almacenes", icon: Warehouse },
      { label: "SKUs", to: "/catalogos/skus", icon: Boxes },
      {
        label: "Personal Receptor",
        to: "/catalogos/personal-receptor",
        icon: UserCheck,
      },
      { label: "Indicadores", to: "/catalogos/indicadores", icon: Activity },
    ],
  },
  {
    label: "Usuarios",
    to: "/usuarios",
    icon: Users,
    roles: ["superadmin", "admin"],
  },
  {
    label: "Config. Notificaciones",
    to: "/configuracion/notificaciones",
    icon: Settings,
    roles: ["superadmin", "admin"],
  },
  {
    label: "Empresas",
    to: "/empresas",
    icon: Building2,
    roles: ["superadmin"],
  },
];

function NavItem({ item, collapsed, onClick }) {
  const { hasRole } = useAuth();
  const [open, setOpen] = useState(false);

  if (item.roles && !hasRole(...item.roles)) return null;

  if (item.children) {
    return (
      <div>
        <button
          onClick={() => setOpen(!open)}
          className="sidebar-link w-full sidebar-link-inactive"
        >
          <item.icon size={18} className="flex-shrink-0" />
          {!collapsed && (
            <>
              <span className="flex-1 text-left">{item.label}</span>
              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </>
          )}
        </button>
        {open && !collapsed && (
          <div className="ml-4 mt-1 space-y-0.5 border-l-2 border-gray-200 pl-3">
            {item.children.map((c) => (
              <NavLink
                key={c.to}
                to={c.to}
                onClick={onClick}
                className={({ isActive }) =>
                  `sidebar-link ${isActive ? "sidebar-link-active" : "sidebar-link-inactive"}`
                }
              >
                <c.icon size={15} className="flex-shrink-0" />
                <span>{c.label}</span>
              </NavLink>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <NavLink
      to={item.to}
      end={item.exact}
      onClick={onClick}
      className={({ isActive }) =>
        `sidebar-link ${isActive ? "sidebar-link-active" : "sidebar-link-inactive"}`
      }
    >
      <item.icon size={18} className="flex-shrink-0" />
      {!collapsed && <span>{item.label}</span>}
    </NavLink>
  );
}

function NotificationEntry({ tone = "gray", title, description, meta, onClick }) {
  const toneClasses = {
    blue: "border-blue-200 bg-blue-50 hover:bg-blue-100/70",
    yellow: "border-yellow-200 bg-yellow-50 hover:bg-yellow-100/70",
    red: "border-red-200 bg-red-50 hover:bg-red-100/70",
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-xl border px-3 py-2 text-left transition-colors ${toneClasses[tone] || "border-gray-200 bg-gray-50 hover:bg-gray-100"}`}
    >
      <p className="text-sm font-medium text-gray-900">{title}</p>
      {description && <p className="mt-1 text-xs text-gray-600">{description}</p>}
      {meta && <p className="mt-1 text-[11px] uppercase tracking-wide text-gray-500">{meta}</p>}
    </button>
  );
}

export default function Layout() {
  const { usuario, logout } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const notificationsRef = useRef(null);

  const { data: dashboardData } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.get("/dashboard/resumen").then((response) => response.data.datos),
    enabled: !!usuario,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const ROL_BADGE = {
    superadmin: "badge-purple",
    admin: "badge-blue",
    supervisor: "badge-green",
    almacenero: "badge-gray",
  };

  const alertas = dashboardData?.alertas ?? {};
  const notificationSections = useMemo(() => {
    const transito = Array.isArray(alertas.transito) ? alertas.transito : [];
    const vencidos = Array.isArray(alertas.vencidos) ? alertas.vencidos : [];
    const proximos = Array.isArray(alertas.vencimientos_proximos) ? alertas.vencimientos_proximos : [];
    const stockCritico = Array.isArray(alertas.stock_critico) ? alertas.stock_critico : [];
    const stockBajo = Array.isArray(alertas.stock_bajo) ? alertas.stock_bajo : [];
    const stockLimites = alertas.stock_limites ?? { critico: 100, bajo: 200 };

    return [
      {
        key: "transito",
        title: `Transito (${transito.length})`,
        tone: "blue",
        items: transito,
        path: "/transito-aprobaciones",
        renderTitle: (item) => item.nro_guia ? `Guia ${item.nro_guia}` : `Registro #${item.id}`,
        renderDescription: (item) => `${item.almacen_origen || "-"} -> ${item.almacen_destino || "-"}`,
        renderMeta: (item) => item.sku_resumen || `Fecha ${formatSafeDate(item.fecha)}`,
        emptyLabel: "No hay productos en transito.",
      },
      {
        key: "vencidos",
        title: `Vencidos (${vencidos.length})`,
        tone: "red",
        items: vencidos,
        path: "/",
        renderTitle: (item) => item.sku || "SKU sin nombre",
        renderDescription: (item) => `${item.almacen || "-"} · Cantidad ${item.cantidad ?? 0}`,
        renderMeta: (item) => `Vence ${formatSafeDate(item.fecha_vencimiento)}`,
        emptyLabel: "No hay productos vencidos.",
      },
      {
        key: "proximos",
        title: `Por vencer (${proximos.length})`,
        tone: "yellow",
        items: proximos,
        path: "/",
        renderTitle: (item) => item.sku || "SKU sin nombre",
        renderDescription: (item) => `${item.almacen || "-"} · Cantidad ${item.cantidad ?? 0}`,
        renderMeta: (item) => `Vence ${formatSafeDate(item.fecha_vencimiento)}`,
        emptyLabel: "No hay vencimientos proximos.",
      },
      {
        key: "stock_critico",
        title: `Stock critico (${stockCritico.length})`,
        tone: "red",
        items: stockCritico,
        path: "/",
        renderTitle: (item) => item.sku || "SKU sin nombre",
        renderDescription: (item) => `${item.almacen || "-"} · Stock ${item.cantidad ?? 0}`,
        renderMeta: () => `Base ${stockLimites.critico} und`,
        emptyLabel: "No hay stock critico.",
      },
      {
        key: "stock_bajo",
        title: `Stock bajo (${stockBajo.length})`,
        tone: "yellow",
        items: stockBajo,
        path: "/",
        renderTitle: (item) => item.sku || "SKU sin nombre",
        renderDescription: (item) => `${item.almacen || "-"} · Stock ${item.cantidad ?? 0}`,
        renderMeta: () => `Base ${stockLimites.bajo} und`,
        emptyLabel: "No hay stock bajo.",
      },
    ];
  }, [alertas]);
  const totalNotifications = notificationSections.reduce((acc, section) => acc + section.items.length, 0);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (notificationsRef.current && !notificationsRef.current.contains(event.target)) {
        setNotificationsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 flex flex-col bg-white border-r border-gray-200 transition-all duration-200
        ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
        ${collapsed ? "w-16" : "w-64"}`}
      >
        {/* Logo */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 min-h-[64px]">
          {!collapsed && (
            <img
              src="/DB_Impulso_oficial.png"
              alt="Deal Brand"
              className="h-9 object-contain"
            />
          )}
          {collapsed && (
            <img
              src="/DB_Impulso_oficial.png"
              alt="Deal Brand"
              className="h-7 w-7 object-contain mx-auto"
            />
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="btn-icon hidden lg:flex text-gray-500 flex-shrink-0"
          >
            <Menu size={16} />
          </button>
          <button
            onClick={() => setSidebarOpen(false)}
            className="btn-icon lg:hidden text-gray-500 flex-shrink-0"
          >
            <X size={16} />
          </button>
        </div>

        {/* Empresa */}
        {!collapsed && (
          <div className="px-4 py-2 border-b border-gray-200">
            <p className="text-xs text-gray-500 truncate">
              {usuario?.empresa_nombre}
            </p>
          </div>
        )}

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
          {NAV.map((item, i) => (
            <NavItem
              key={i}
              item={item}
              collapsed={collapsed}
              onClick={() => setSidebarOpen(false)}
            />
          ))}
        </nav>

        {/* User */}
        <div className="border-t border-gray-200 p-3">
          {!collapsed ? (
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
                <User size={14} className="text-primary-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {usuario?.nombre} {usuario?.apellido}
                </p>
                <span
                  className={`text-xs ${ROL_BADGE[usuario?.rol] || "badge-gray"}`}
                >
                  {usuario?.rol}
                </span>
              </div>
              <button
                onClick={handleLogout}
                className="btn-icon text-gray-400 hover:text-red-500"
                title="Cerrar sesión"
              >
                <LogOut size={15} />
              </button>
            </div>
          ) : (
            <button
              onClick={handleLogout}
              className="btn-icon w-full flex justify-center text-gray-400 hover:text-red-500"
            >
              <LogOut size={15} />
            </button>
          )}
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 lg:px-6 flex-shrink-0">
          <button
            className="btn-icon lg:hidden text-gray-600"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu size={20} />
          </button>
          <div className="flex-1 lg:flex-none" />
          <div className="flex items-center gap-2">
            <div className="relative" ref={notificationsRef}>
              <button
                type="button"
                className="btn-icon text-gray-500 relative"
                onClick={() => setNotificationsOpen((prev) => !prev)}
                title="Notificaciones"
              >
                <Bell size={18} />
                {totalNotifications > 0 && (
                  <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                    {totalNotifications > 99 ? "99+" : totalNotifications}
                  </span>
                )}
              </button>

              {notificationsOpen && (
                <div className="absolute right-0 top-12 z-50 w-[380px] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl">
                  <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3">
                    <AlertTriangle size={16} className="text-amber-500" />
                    <div>
                      <p className="text-sm font-semibold text-gray-900">Notificaciones</p>
                      <p className="text-xs text-gray-500">
                        {totalNotifications > 0 ? `${totalNotifications} alerta(s) activas` : "Sin alertas activas"}
                      </p>
                    </div>
                  </div>

                  <div className="max-h-[70vh] overflow-y-auto">
                    {notificationSections.map((section) => (
                      <div key={section.key} className="border-b border-gray-100 px-4 py-3 last:border-b-0">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                            {section.title}
                          </p>
                          {section.items.length > 0 && (
                            <button
                              type="button"
                              className="text-xs font-medium text-primary-600 hover:underline"
                              onClick={() => {
                                navigate(section.path);
                                setNotificationsOpen(false);
                              }}
                            >
                              Ver
                            </button>
                          )}
                        </div>

                        {section.items.length === 0 ? (
                          <p className="text-xs text-gray-400">{section.emptyLabel}</p>
                        ) : (
                          <div className="space-y-2">
                            {section.items.map((item, index) => (
                              <NotificationEntry
                                key={`${section.key}-${item.id || item.sku_id || index}`}
                                tone={section.tone}
                                title={section.renderTitle(item)}
                                description={section.renderDescription(item)}
                                meta={section.renderMeta(item)}
                                onClick={() => {
                                  navigate(section.path);
                                  setNotificationsOpen(false);
                                }}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
