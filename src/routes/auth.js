const express = require('express');
const { authRequired, signToken } = require('../middleware/auth');

function createAuthRouter(db) {
  const router = express.Router();

  // Conta local desativada — use o SSO do site principal.
  router.post('/register', (_req, res) => {
    res.status(410).json({
      error: 'Use Entrar com BairroAnimeFire',
      sso: '/auth/sso/start',
    });
  });

  router.post('/login', (_req, res) => {
    res.status(410).json({
      error: 'Use Entrar com BairroAnimeFire',
      sso: '/auth/sso/start',
    });
  });

  router.post('/logout', (req, res) => {
    res.clearCookie('token', { path: '/' });
    res.json({ ok: true });
  });

  router.get('/me', authRequired, (req, res) => {
    const row = db.get(
      `SELECT id, username, display_name, avatar_color, production_user_id, source_role, created_at FROM users WHERE id = ?`,
      [req.user.id]
    );
    if (!row) return res.status(404).json({ error: 'Usuário não encontrado' });
    const token = signToken(row);
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production' || process.env.CHAT_SSO_SECURE_COOKIES === '1',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: '/',
    });
    res.json({ user: row, token });
  });

  return router;
}

module.exports = { createAuthRouter };
