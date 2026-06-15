import { createContext, useContext, useState, useCallback } from 'react';
import api from '../utils/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(() => {
    try { return JSON.parse(localStorage.getItem('zentra_usuario')); }
    catch { return null; }
  });

  const login = useCallback(async (email, password) => {
    const res = await api.post('/auth/login', { email, password });
    const { token, usuario: u } = res.data;
    localStorage.setItem('zentra_token', token);
    localStorage.setItem('zentra_usuario', JSON.stringify(u));
    setUsuario(u);
    return u;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('zentra_token');
    localStorage.removeItem('zentra_usuario');
    setUsuario(null);
  }, []);

  const hasRole = useCallback((...roles) => {
    return usuario && roles.includes(usuario.rol);
  }, [usuario]);

  return (
    <AuthContext.Provider value={{ usuario, login, logout, hasRole }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
