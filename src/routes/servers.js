const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authRequired } = require('../middleware/auth');

function createServersRouter(db) {
  const router = express.Router();

  router.get('/', authRequired, (req, res) => {
    const servers = db.all(
      `SELECT s.* FROM servers s
       INNER JOIN server_members sm ON sm.server_id = s.id
       WHERE sm.user_id = ?
       ORDER BY s.name`,
      [req.user.id]
    );
    res.json({ servers });
  });

  router.get('/:serverId/channels', authRequired, (req, res) => {
    const member = db.get(
      `SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?`,
      [req.params.serverId, req.user.id]
    );
    if (!member) return res.status(403).json({ error: 'Você não é membro deste servidor' });
    const channels = db.all(
      `SELECT * FROM channels WHERE server_id = ? ORDER BY position, name`,
      [req.params.serverId]
    );
    res.json({ channels });
  });

  router.get('/:serverId/members', authRequired, (req, res) => {
    const member = db.get(
      `SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?`,
      [req.params.serverId, req.user.id]
    );
    if (!member) return res.status(403).json({ error: 'Você não é membro deste servidor' });
    const members = db.all(
      `SELECT u.id, u.username, u.display_name, u.avatar_color
       FROM users u
       INNER JOIN server_members sm ON sm.user_id = u.id
       WHERE sm.server_id = ?
       ORDER BY u.display_name COLLATE NOCASE`,
      [req.params.serverId]
    );
    res.json({ members });
  });

  router.get('/channels/:channelId/messages', authRequired, (req, res) => {
    const channel = db.get(`SELECT * FROM channels WHERE id = ?`, [req.params.channelId]);
    if (!channel) return res.status(404).json({ error: 'Canal não encontrado' });
    const member = db.get(
      `SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?`,
      [channel.server_id, req.user.id]
    );
    if (!member) return res.status(403).json({ error: 'Sem acesso' });

    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const messages = db.all(
      `SELECT m.id, m.content, m.created_at, m.channel_id,
              u.id AS author_id, u.username AS author_username,
              u.display_name AS author_display_name, u.avatar_color AS author_color
       FROM messages m
       INNER JOIN users u ON u.id = m.author_id
       WHERE m.channel_id = ?
       ORDER BY m.created_at DESC
       LIMIT ?`,
      [req.params.channelId, limit]
    );
    res.json({ messages: messages.reverse() });
  });

  router.post('/', authRequired, (req, res) => {
    const name = (req.body?.name || '').trim();
    if (!name || name.length > 40) {
      return res.status(400).json({ error: 'Nome do servidor inválido' });
    }
    const id = uuidv4();
    db.run(
      `INSERT INTO servers (id, name, owner_id, icon_emoji) VALUES (?, ?, ?, ?)`,
      [id, name, req.user.id, '✨']
    );
    db.run(`INSERT INTO server_members (server_id, user_id) VALUES (?, ?)`, [id, req.user.id]);
    const channelId = uuidv4();
    db.run(
      `INSERT INTO channels (id, server_id, name, type, position) VALUES (?, ?, 'geral', 'text', 0)`,
      [channelId, id]
    );
    res.status(201).json({
      server: { id, name, owner_id: req.user.id, icon_emoji: '✨' },
      channels: [{ id: channelId, name: 'geral' }],
    });
  });

  return router;
}

module.exports = { createServersRouter };
