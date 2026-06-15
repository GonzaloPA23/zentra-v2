import { Component } from 'react';
import { AlertTriangle, Home, RefreshCw } from 'lucide-react';

export default class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('AppErrorBoundary caught an error', error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    window.location.href = '/';
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-red-100">
              <AlertTriangle size={22} className="text-red-600" />
            </div>
            <div className="min-w-0 flex-1 space-y-3">
              <div>
                <h1 className="text-xl font-semibold text-gray-900">
                  Ocurrio un problema al cargar esta vista
                </h1>
                <p className="mt-1 text-sm text-gray-600">
                  La aplicacion detecto un error inesperado. Puedes recargar la pagina o volver al inicio.
                </p>
              </div>

              {this.state.error?.message && (
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                  {this.state.error.message}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-primary btn-sm" onClick={this.handleReload}>
                  <RefreshCw size={14} /> Recargar
                </button>
                <button type="button" className="btn-secondary btn-sm" onClick={this.handleGoHome}>
                  <Home size={14} /> Ir al inicio
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
