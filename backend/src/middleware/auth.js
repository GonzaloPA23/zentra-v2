const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, mensaje: 'Token requerido' });
  }
  const token = header.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.usuario = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ ok: false, mensaje: 'Token inválido o expirado' });
  }
}

function requireRol(...roles) {
  return (req, res, next) => {
    if (!req.usuario) return res.status(401).json({ ok: false, mensaje: 'No autenticado' });
    if (!roles.includes(req.usuario.rol)) {
      return res.status(403).json({ ok: false, mensaje: 'Sin permisos suficientes' });
    }
    next();
  };
}

// Resuelve empresa_id para la request:
// - superadmin: usa empresa_id del query/body si viene, sino null
// - otros roles: siempre usan su empresa_id del token
function empresaMiddleware(req, res, next) {
  if (req.usuario.rol === 'superadmin') {
    const eid = req.query.empresa_id || req.body?.empresa_id;
    req.empresa_id = eid ? parseInt(eid) : null;
  } else {
    req.empresa_id = req.usuario.empresa_id;
  }
  next();
}

module.exports = { authMiddleware, requireRol, empresaMiddleware };
