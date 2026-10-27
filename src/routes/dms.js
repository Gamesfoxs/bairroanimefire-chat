const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authRequired } = require('../middleware/auth');

function createDmsRouter(db) {
  const router = express.Router();

  function orderedPair(a, b) {
    return a < b ? [a, b] : [b, a];
  }

  router.get('/', authRequired, (req, res) => {
    const channels = db.all(
      `SELECT dc.*,
        CASE WHEN dc.user1_id = ? THEN u2.id ELSE u1.id END AS peer_id,
        CASE WHEN dc.user1_id = ? THEN u2.username ELSE u1.username END AS peer_username,
        CASE WHEN dc.user1_id = ? THEN u2.display_name ELSE u1.display_name END AS peer_display_name,
        CASE WHEN dc.user1_id = ? THEN u2.avatar_color ELSE u1.avatar_color END AS peer_color
       FROM dm_channels dc
       INNER JOIN users u1 ON u1.id = dc.user1_id
       INNER JOIN users u2 ON u2.id = dc.user2_id
       WHERE dc.user1_id = ? OR dc.user2_id = ?
       ORDER BY dc.created_at DESC`,
      [req.user.id, req.user.id, req.user.id, req.user.id, req.user.id, req.user.id]
    );
    res.json({ channels });
  });

  router.post('/open', authRequired, (req, res) => {
    const peerId = req.body?.userId;
    if (!peerId) return res.status(400).json({ error: 'userId obrigatório' });
    if (peerId === req.user.id) {
      return res.status(400).json({ error: 'Não é possível abrir DM consigo mesmo' });
    }
    const peer = db.get(
      `SELECT id, username, display_name, avatar_color FROM users WHERE id = ?`,
      [peerId]
    );
    if (!peer) return res.status(404).json({ error: 'Usuário não encontrado' });

    const [u1, u2] = orderedPair(req.user.id, peerId);
    let channel = db.get(
      `SELECT * FROM dm_channels WHERE user1_id = ? AND user2_id = ?`,
      [u1, u2]
    );
    if (!channel) {
      const id = uuidv4();
      db.run(
        `INSERT INTO dm_channels (id, user1_id, user2_id) VALUES (?, ?, ?)`,
        [id, u1, u2]
      );
      channel = db.get(`SELECT * FROM dm_channels WHERE id = ?`, [id]);
    }
    res.json({
      channel: {
        ...channel,
        peer_id: peer.id,
        peer_username: peer.username,
        peer_display_name: peer.display_name,
        peer_color: peer.avatar_color,
      },
    });
  });

  router.get('/:dmId/messages', authRequired, (req, res) => {
    const channel = db.get(`SELECT * FROM dm_channels WHERE id = ?`, [req.params.dmId]);
    if (!channel) return res.status(404).json({ error: 'DM não encontrada' });
    if (channel.user1_id !== req.user.id && channel.user2_id !== req.user.id) {
      return res.status(403).json({ error: 'Sem acesso' });
    }
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const messages = db.all(
      `SELECT m.id, m.content, m.created_at, m.dm_channel_id,
              u.id AS author_id, u.username AS author_username,
              u.display_name AS author_display_name, u.avatar_color AS author_color
       FROM dm_messages m
       INNER JOIN users u ON u.id = m.author_id
       WHERE m.dm_channel_id = ?
       ORDER BY m.created_at DESC
       LIMIT ?`,
      [req.params.dmId, limit]
    );
    res.json({ messages: messages.reverse() });
  });

  return router;
}

module.exports = { createDmsRouter };
