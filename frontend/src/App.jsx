import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import { AuthProvider, useAuth } from './context/AuthContext';
import AppErrorBoundary from './components/AppErrorBoundary';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import RegistrosPage from './pages/RegistrosPageV2';
import RegistroFormPage from './pages/RegistroFormPage';
import Modulo2Page from './pages/Modulo2PageV2';
import TGInternoPage from './pages/TGInternoPage';
import TGInternoListadoPage from './pages/TGInternoListadoPage';
import TGInternoDetallePage from './pages/TGInternoDetallePage';
import CategoriasPage from './pages/catalogs/CategoriasPage';
import AlmacenesPage from './pages/catalogs/AlmacenesPage';
import SkusPage from './pages/catalogs/SkusPage';
import PersonalReceptorPage from './pages/catalogs/PersonalReceptorPage';
import IndicadoresPage from './pages/catalogs/IndicadoresPage';
import TiposMercaderiaPage from './pages/catalogs/TiposMercaderiaPage';
import UsuariosPage from './pages/UsuariosPage';
import EmpresasPage from './pages/EmpresasPage';
import HistorialPage from './pages/HistorialPageV2';
import ConfiguracionNotificacionesPage from './pages/ConfiguracionNotificacionesPage';
import NotFound from './pages/NotFound';

function ProtectedRoute({ children, roles }) {
  const { usuario } = useAuth();
  if (!usuario) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(usuario.rol)) return <Navigate to="/" replace />;
  return children;
}

function AppRoutes() {
  const { usuario } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={usuario ? <Navigate to="/" replace /> : <LoginPage />} />

      <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<DashboardPage />} />

        {/* Módulo 1 */}
        <Route path="registros" element={<RegistrosPage />} />
        <Route path="registros/nuevo" element={
          <ProtectedRoute roles={['superadmin','admin','almacenero']}>
            <RegistroFormPage />
          </ProtectedRoute>
        } />
        <Route path="registros/:id/editar" element={
          <ProtectedRoute roles={['superadmin','admin']}>
            <RegistroFormPage />
          </ProtectedRoute>
        } />

        {/* TG INTERNO */}
        <Route path="tg-interno/nuevo" element={
          <ProtectedRoute roles={['superadmin','admin','almacenero']}>
            <TGInternoPage />
          </ProtectedRoute>
        } />
        <Route path="tg-interno/:id/editar" element={
          <ProtectedRoute roles={['superadmin','admin']}>
            <TGInternoPage />
          </ProtectedRoute>
        } />
        <Route path="tg-interno/listado" element={
          <ProtectedRoute roles={['superadmin','admin','almacenero']}>
            <TGInternoListadoPage />
          </ProtectedRoute>
        } />
        <Route path="tg-interno/detalle/:id" element={
          <ProtectedRoute roles={['superadmin','admin','almacenero']}>
            <TGInternoDetallePage />
          </ProtectedRoute>
        } />

        {/* Módulo 2 */}
        <Route path="transito-aprobaciones" element={
          <ProtectedRoute roles={['superadmin','admin','supervisor','almacenero']}>
            <Modulo2Page />
          </ProtectedRoute>
        } />
        <Route path="historial" element={
          <ProtectedRoute roles={['superadmin','admin','supervisor']}>
            <HistorialPage />
          </ProtectedRoute>
        } />

        {/* Catálogos */}
        <Route path="catalogos/categorias"        element={<ProtectedRoute roles={['superadmin','admin']}><CategoriasPage /></ProtectedRoute>} />
        <Route path="catalogos/almacenes"         element={<ProtectedRoute roles={['superadmin','admin']}><AlmacenesPage /></ProtectedRoute>} />
        <Route path="catalogos/skus"              element={<ProtectedRoute roles={['superadmin','admin']}><SkusPage /></ProtectedRoute>} />
        <Route path="catalogos/personal-receptor" element={<ProtectedRoute roles={['superadmin','admin']}><PersonalReceptorPage /></ProtectedRoute>} />
        <Route path="catalogos/indicadores"       element={<ProtectedRoute roles={['superadmin','admin']}><IndicadoresPage /></ProtectedRoute>} />
        <Route path="catalogos/tipos-mercaderia"  element={<ProtectedRoute roles={['superadmin','admin']}><TiposMercaderiaPage /></ProtectedRoute>} />

        {/* Admin */}
        <Route path="usuarios" element={<ProtectedRoute roles={['superadmin','admin']}><UsuariosPage /></ProtectedRoute>} />
        <Route path="empresas" element={<ProtectedRoute roles={['superadmin']}><EmpresasPage /></ProtectedRoute>} />
        <Route path="configuracion/notificaciones" element={<ProtectedRoute roles={['superadmin','admin']}><ConfiguracionNotificacionesPage /></ProtectedRoute>} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppErrorBoundary>
        <BrowserRouter>
          <AppRoutes />
          <ToastContainer
            position="top-right"
            autoClose={3500}
            hideProgressBar={false}
            newestOnTop
            closeOnClick
            pauseOnHover
            theme="light"
          />
        </BrowserRouter>
      </AppErrorBoundary>
    </AuthProvider>
  );
}
