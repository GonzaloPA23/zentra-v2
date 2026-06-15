import { useNavigate } from 'react-router-dom';
import { Home, AlertCircle } from 'lucide-react';

export default function NotFound() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="w-20 h-20 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <AlertCircle size={36} className="text-gray-400" />
        </div>
        <h1 className="text-5xl font-bold text-gray-900 mb-2">404</h1>
        <p className="text-gray-500 mb-6">Página no encontrada</p>
        <button onClick={() => navigate('/')} className="btn-primary">
          <Home size={16} /> Ir al inicio
        </button>
      </div>
    </div>
  );
}
