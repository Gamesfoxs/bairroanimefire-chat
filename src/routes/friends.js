const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authRequired } = require('../middleware/auth');

function createFriendsRouter(db) {
  const router = express.Router();

  router.get('/', authRequired, (req, res) => {
    const friends = db.all(
      `SELECT u.id, u.username, u.display_name, u.avatar_color, f.status, f.id AS friendship_id
       FROM friendships f
       INNER JOIN users u ON (
         (f.user_id = ? AND u.id = f.friend_id) OR
         (f.friend_id = ? AND u.id = f.user_id AND f.status = 'accepted')
       )
       WHERE (f.user_id = ? OR (f.friend_id = ? AND f.status = 'accepted'))
       ORDER BY u.display_name COLLATE NOCASE`,
      [req.user.id, req.user.id, req.user.id, req.user.id]
    );
    // Deduplicate
    const map = new Map();
    for (const f of friends) {
      if (!map.has(f.id)) map.set(f.id, f);
    }
    res.json({ friends: Array.from(map.values()) });
  });

  router.get('/pending', authRequired, (req, res) => {
    const pending = db.all(
      `SELECT f.id AS friendship_id, u.id, u.username, u.display_name, u.avatar_color
       FROM friendships f
       INNER JOIN users u ON u.id = f.user_id
       WHERE f.friend_id = ? AND f.status = 'pending'`,
      [req.user.id]
    );
    res.json({ pending });
  });

  router.post('/request', authRequired, (req, res) => {
    const username = String(req.body?.username || '').trim().toLowerCase();
    if (!username) return res.status(400).json({ error: 'Informe o usuário' });
    const target = db.get(`SELECT id, username, display_name, avatar_color FROM users WHERE username = ?`, [
      username,
    ]);
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado' });
    if (target.id === req.user.id) {
      return res.status(400).json({ error: 'Você não pode adicionar a si mesmo' });
    }
    const existing = db.get(
      `SELECT * FROM friendships WHERE
        (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)`,
      [req.user.id, target.id, target.id, req.user.id]
    );
    if (existing) {
      if (existing.status === 'accepted') {
        return res.status(409).json({ error: 'Vocês já são amigos' });
      }
      if (existing.friend_id === req.user.id && existing.status === 'pending') {
        // Aceitar pedido invertido
        db.run(`UPDATE friendships SET status = 'accepted' WHERE id = ?`, [existing.id]);
        return res.json({ ok: true, status: 'accepted', friend: target });
      }
      return res.status(409).json({ error: 'Pedido já enviado' });
    }
    const id = uuidv4();
    db.run(
      `INSERT INTO friendships (id, user_id, friend_id, status) VALUES (?, ?, ?, 'pending')`,
      [id, req.user.id, target.id]
    );
    res.status(201).json({ ok: true, status: 'pending', friend: target });
  });

  router.post('/:friendshipId/accept', authRequired, (req, res) => {
    const f = db.get(`SELECT * FROM friendships WHERE id = ?`, [req.params.friendshipId]);
    if (!f || f.friend_id !== req.user.id) {
      return res.status(404).json({ error: 'Pedido não encontrado' });
    }
    db.run(`UPDATE friendships SET status = 'accepted' WHERE id = ?`, [f.id]);
    res.json({ ok: true });
  });

  router.delete('/:friendshipId', authRequired, (req, res) => {
    const f = db.get(`SELECT * FROM friendships WHERE id = ?`, [req.params.friendshipId]);
    if (!f || (f.user_id !== req.user.id && f.friend_id !== req.user.id)) {
      return res.status(404).json({ error: 'Amizade não encontrada' });
    }
    db.run(`DELETE FROM friendships WHERE id = ?`, [f.id]);
    res.json({ ok: true });
  });

  return router;
}

module.exports = { createFriendsRouter };
