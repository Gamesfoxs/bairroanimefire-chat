const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'bairro-anime-fire-dev-secret-change-me';

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
  const cookieToken = req.cookies?.token;
  const token = bearer || cookieToken;
  if (!token) {
    return res.status(401).json({ error: 'Não autenticado' });
  }
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }
  req.user = payload;
  next();
}

function optionalAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
  const cookieToken = req.cookies?.token;
  const token = bearer || cookieToken;
  if (token) {
    const payload = verifyToken(token);
    if (payload) req.user = payload;
  }
  next();
}

module.exports = { signToken, verifyToken, authRequired, optionalAuth, JWT_SECRET };
