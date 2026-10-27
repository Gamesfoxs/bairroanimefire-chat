const express = require('express');
const { signToken } = require('../middleware/auth');
const { ISSUER, AUDIENCE, BASE_URL, randomToken, ssoPost, cookieOpts } = require('../sso/client');

const COLORS = ['#7289da', '#43b581', '#faa61a', '#f04747', '#9b59b6', '#e91e63', '#00bcd4', '#ff5722'];

function sanitizeUsername(raw) {
  const clean = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 20);
  return clean.length >= 3 ? clean : `user${Date.now().toString(36).slice(-6)}`;
}

function autoJoinDefaultServer(db, userId) {
  const server = db.get(`SELECT id, owner_id FROM servers WHERE name = ?`, ['Bairro Anime Fire']);
  if (!server) return;
  db.run(`INSERT OR IGNORE INTO server_members (server_id, user_id) VALUES (?, ?)`, [server.id, userId]);
  if (server.owner_id === 'system') {
    db.run(`UPDATE servers SET owner_id = ? WHERE id = ?`, [userId, server.id]);
  }
}

function upsertSsoUser(db, identity) {
  const prodId = Number(identity.user_id);
  const username = sanitizeUsername(identity.username);
  const display = String(identity.display_name || username).trim().slice(0, 64) || username;
  const color = COLORS[Math.floor(Math.random() * COLORS.length)];

  let row = db.get(`SELECT * FROM users WHERE production_user_id = ?`, [prodId]);
  if (row) {
    db.run(
      `UPDATE users SET username = ?, display_name = ?, source_role = ? WHERE id = ?`,
      [username, display, String(identity.role || 'user'), row.id]
    );
    return {
      id: row.id,
      username,
      display_name: display,
      avatar_color: row.avatar_color,
      production_user_id: prodId,
    };
  }

  // Prefer stable id linked to production account
  const id = `baf:${prodId}`;
  const clash = db.get(`SELECT id FROM users WHERE username = ? OR id = ?`, [username, id]);
  if (clash && clash.id !== id) {
    // Username taken by a legacy local account — keep production link unique with suffix
    const alt = `${username}_${prodId}`.slice(0, 20);
    db.run(
      `INSERT INTO users (id, username, password_hash, display_name, avatar_color, production_user_id, source_role)
       VALUES (?, ?, '', ?, ?, ?, ?)`,
      [id, alt, display, color, prodId, String(identity.role || 'user')]
    );
    autoJoinDefaultServer(db, id);
    return { id, username: alt, display_name: display, avatar_color: color, production_user_id: prodId };
  }

  db.run(
    `INSERT INTO users (id, username, password_hash, display_name, avatar_color, production_user_id, source_role)
     VALUES (?, ?, '', ?, ?, ?, ?)`,
    [id, username, display, color, prodId, String(identity.role || 'user')]
  );
  autoJoinDefaultServer(db, id);
  return { id, username, display_name: display, avatar_color: color, production_user_id: prodId };
}

function createSsoRouter(db) {
  const router = express.Router();

  router.get('/start', (req, res) => {
    try {
      const state = randomToken(32);
      const nonce = randomToken(32);
      res.cookie('baf_sso_state', state, cookieOpts(5 * 60 * 1000));
      res.cookie('baf_sso_nonce', nonce, cookieOpts(5 * 60 * 1000));
      res.cookie('baf_sso_started', String(Math.floor(Date.now() / 1000)), cookieOpts(5 * 60 * 1000));
      const loc = `${BASE_URL}/authorize?state=${encodeURIComponent(state)}&nonce=${encodeURIComponent(nonce)}`;
      res.set('Cache-Control', 'no-store');
      return res.redirect(303, loc);
    } catch (err) {
      console.error('SSO start failed:', err.message);
      return res.redirect(302, '/?sso_error=' + encodeURIComponent('sso_unavailable'));
    }
  });

  router.get('/callback', async (req, res) => {
    const clearSsoCookies = () => {
      res.clearCookie('baf_sso_state', { path: '/' });
      res.clearCookie('baf_sso_nonce', { path: '/' });
      res.clearCookie('baf_sso_started', { path: '/' });
    };
    try {
      const code = String(req.query.code || '');
      const state = String(req.query.state || '');
      const expected = String(req.cookies?.baf_sso_state || '');
      const nonce = String(req.cookies?.baf_sso_nonce || '');
      const started = Number(req.cookies?.baf_sso_started || 0);
      clearSsoCookies();

      if (!code || !state || !expected || !nonce || expected !== state) {
        return res.redirect(302, '/?sso_error=' + encodeURIComponent('state_invalid'));
      }
      if (!started || started < Math.floor(Date.now() / 1000) - 300) {
        return res.redirect(302, '/?sso_error=' + encodeURIComponent('state_expired'));
      }

      const resp = await ssoPost('exchange', { code, state, nonce });
      if (
        !resp.ok ||
        resp.issuer !== ISSUER ||
        resp.audience !== AUDIENCE ||
        !resp.identity ||
        typeof resp.identity !== 'object'
      ) {
        return res.redirect(302, '/?sso_error=' + encodeURIComponent('exchange_denied'));
      }

      const user = upsertSsoUser(db, resp.identity);
      const token = signToken(user);
      res.cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production' || process.env.CHAT_SSO_SECURE_COOKIES === '1',
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000,
        path: '/',
      });
      // Also expose via fragment-free query so SPA can pick token if cookie-only fails
      res.set('Cache-Control', 'no-store');
      return res.redirect(302, '/?sso=ok');
    } catch (err) {
      console.error('SSO callback failed:', err.message);
      clearSsoCookies();
      return res.redirect(302, '/?sso_error=' + encodeURIComponent('callback_failed'));
    }
  });

  return router;
}

module.exports = { createSsoRouter, upsertSsoUser };
