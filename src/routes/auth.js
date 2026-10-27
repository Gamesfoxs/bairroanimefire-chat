const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { signToken, authRequired } = require('../middleware/auth');

const COLORS = ['#7289da', '#43b581', '#faa61a', '#f04747', '#9b59b6', '#e91e63', '#00bcd4', '#ff5722'];

function createAuthRouter(db) {
  const router = express.Router();

  router.post('/register', (req, res) => {
    const { username, password, displayName } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Usuário e senha são obrigatórios' });
    }
    const clean = String(username).trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (clean.length < 3 || clean.length > 20) {
      return res.status(400).json({ error: 'Usuário deve ter 3–20 caracteres (a-z, 0-9, _)' });
    }
    if (String(password).length < 4) {
      return res.status(400).json({ error: 'Senha deve ter pelo menos 4 caracteres' });
    }
    const existing = db.get(`SELECT id FROM users WHERE username = ?`, [clean]);
    if (existing) {
      return res.status(409).json({ error: 'Esse nome de usuário já existe' });
    }

    const id = uuidv4();
    const hash = bcrypt.hashSync(String(password), 10);
    const name = (displayName && String(displayName).trim()) || clean;
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];

    db.run(
      `INSERT INTO users (id, username, password_hash, display_name, avatar_color) VALUES (?, ?, ?, ?, ?)`,
      [id, clean, hash, name, color]
    );

    // Entrar no servidor padrão
    const server = db.get(`SELECT id FROM servers WHERE name = ?`, ['Bairro Anime Fire']);
    if (server) {
      db.run(
        `INSERT OR IGNORE INTO server_members (server_id, user_id) VALUES (?, ?)`,
        [server.id, id]
      );
      // Primeiro usuário vira owner se owner_id ainda for system
      const srv = db.get(`SELECT owner_id FROM servers WHERE id = ?`, [server.id]);
      if (srv && srv.owner_id === 'system') {
        db.run(`UPDATE servers SET owner_id = ? WHERE id = ?`, [id, server.id]);
      }
    }

    const user = { id, username: clean, display_name: name, avatar_color: color };
    const token = signToken(user);
    res.cookie('token', token, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
    res.status(201).json({ user, token });
  });

  router.post('/login', (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Usuário e senha são obrigatórios' });
    }
    const clean = String(username).trim().toLowerCase();
    const row = db.get(`SELECT * FROM users WHERE username = ?`, [clean]);
    if (!row || !bcrypt.compareSync(String(password), row.password_hash)) {
      return res.status(401).json({ error: 'Usuário ou senha incorretos' });
    }
    const user = {
      id: row.id,
      username: row.username,
      display_name: row.display_name,
      avatar_color: row.avatar_color,
    };
    const token = signToken(user);
    res.cookie('token', token, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
    res.json({ user, token });
  });

  router.post('/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ ok: true });
  });

  router.get('/me', authRequired, (req, res) => {
    const row = db.get(
      `SELECT id, username, display_name, avatar_color, created_at FROM users WHERE id = ?`,
      [req.user.id]
    );
    if (!row) return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json({ user: row });
  });

  return router;
}

module.exports = { createAuthRouter };
