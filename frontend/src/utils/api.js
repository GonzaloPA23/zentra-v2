import axios from 'axios';
import { toast } from 'react-toastify';

const api = axios.create({
  baseURL: '/api',
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
});

// Interceptor request: adjunta token JWT
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('zentra_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Interceptor response: maneja 401 globalmente
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('zentra_token');
      localStorage.removeItem('zentra_usuario');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

function getMensajeDesdePayload(payload) {
  if (!payload) return null;

  if (typeof payload === 'string') {
    try {
      return getMensajeDesdePayload(JSON.parse(payload));
    } catch {
      return payload.trim() || null;
    }
  }

  if (typeof payload !== 'object') return null;

  return payload?.mensaje
    || payload?.errores?.[0]?.msg
    || null;
}

// Helper para extraer mensaje de error
export function getMensajeError(err) {
  return getMensajeDesdePayload(err?.response?.data)
    || getMensajeDesdePayload(err?.request?.response)
    || getMensajeDesdePayload(err?.request?.responseText)
    || err?.message
    || 'Error inesperado';
}

// Helper para peticiones con toast automático
export async function apiCall(fn, { successMsg, errorMsg } = {}) {
  try {
    const res = await fn();
    if (successMsg) toast.success(successMsg);
    return res.data;
  } catch (err) {
    const msg = errorMsg || getMensajeError(err);
    toast.error(msg);
    throw err;
  }
}

export default api;
