const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authRequired } = require('../middleware/auth');
const { enrichMessages } = require('../messages/format');

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
        CASE WHEN dc.user1_id = ? THEN u2.avatar_color ELSE u1.avatar_color END AS peer_color,
        (SELECT COUNT(*) FROM dm_messages unread
         WHERE unread.dm_channel_id=dc.id AND unread.author_id != ?
         AND unread.rowid > COALESCE(
           (SELECT r.last_read_rowid FROM dm_reads r WHERE r.dm_id=dc.id AND r.user_id=?),0)
        ) AS unread_count
       FROM dm_channels dc
       INNER JOIN users u1 ON u1.id = dc.user1_id
       INNER JOIN users u2 ON u2.id = dc.user2_id
       WHERE dc.user1_id = ? OR dc.user2_id = ?
       ORDER BY dc.created_at DESC`,
      [req.user.id, req.user.id, req.user.id, req.user.id, req.user.id, req.user.id, req.user.id, req.user.id]
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

    // DMs only between confirmed friends or members of the same private server.
    const friend = db.get(`SELECT 1 FROM friendships WHERE status = 'accepted'
      AND ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?))`,
      [req.user.id, peerId, peerId, req.user.id]);
    const guildMate = db.get(`SELECT 1 FROM server_members a
      JOIN server_members b ON b.server_id = a.server_id
      JOIN servers s ON s.id = a.server_id
      WHERE a.user_id = ? AND b.user_id = ? AND s.name != 'Bairro Anime Fire'`,
      [req.user.id, peerId]);
    const [u1, u2] = orderedPair(req.user.id, peerId);
    let channel = db.get(
      `SELECT * FROM dm_channels WHERE user1_id = ? AND user2_id = ?`,
      [u1, u2]
    );
    if (!channel) {
      if (!friend && !guildMate) {
        return res.status(403).json({ error: 'Só é possível iniciar DMs com amigos ou membros do seu servidor privado' });
      }
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

  router.post('/:dmId/read', authRequired, (req,res) => {
    const dm = db.get('SELECT id FROM dm_channels WHERE id=? AND (user1_id=? OR user2_id=?)',
      [req.params.dmId,req.user.id,req.user.id]);
    if (!dm) return res.status(403).json({error:'Sem acesso à conversa'});
    const current = db.get('SELECT COALESCE(MAX(rowid),0) AS row_no FROM dm_messages WHERE dm_channel_id=?',
      [dm.id]);
    db.run('INSERT INTO dm_reads(dm_id,user_id,last_read_rowid) VALUES(?,?,?) '
      + 'ON CONFLICT(dm_id,user_id) DO UPDATE SET last_read_rowid=MAX(last_read_rowid,excluded.last_read_rowid)',
      [dm.id,req.user.id,current.row_no]);
    res.json({ok:true});
  });

  router.get('/:dmId/messages', authRequired, (req, res) => {
    const channel = db.get(`SELECT * FROM dm_channels WHERE id = ?`, [req.params.dmId]);
    if (!channel) return res.status(404).json({ error: 'DM não encontrada' });
    if (channel.user1_id !== req.user.id && channel.user2_id !== req.user.id) {
      return res.status(403).json({ error: 'Sem acesso' });
    }
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const messages = db.all(
      `SELECT m.id, m.content, m.created_at, m.dm_channel_id, m.media_id, m.reply_to_id, m.edited_at, a.mime AS media_type, a.bytes AS media_size,
              u.id AS author_id, u.username AS author_username,
              u.display_name AS author_display_name, u.avatar_color AS author_color
       FROM dm_messages m
       LEFT JOIN media_uploads a ON a.id = m.media_id
       INNER JOIN users u ON u.id = m.author_id
       WHERE m.dm_channel_id = ?
       ORDER BY m.created_at DESC
       LIMIT ?`,
      [req.params.dmId, limit]
    );
    res.json({ messages: enrichMessages(db,'dm',messages.reverse(),req.user.id) });
  });

  return router;
}

module.exports = { createDmsRouter };
