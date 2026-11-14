const express = require('express');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
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
    const voiceId = uuidv4();
    db.run(
      'INSERT INTO channels (id, server_id, name, type, position) VALUES (?, ?, ?, ?, ?)',
      [voiceId, id, 'voz-geral', 'voice', 1]
    );
    res.status(201).json({
      server: { id, name, owner_id: req.user.id, icon_emoji: '✨' },
      channels: [
        { id: channelId, name: 'geral', type: 'text' },
        { id: voiceId, name: 'voz-geral', type: 'voice' },
      ],
    });
  });

  // Convites apenas para servidores privados criados pelos usuários.
  router.post('/:serverId/invites', authRequired, (req, res) => {
    const server = db.get('SELECT id, name, owner_id FROM servers WHERE id = ?', [req.params.serverId]);
    if (!server) return res.status(404).json({ error: 'Servidor não encontrado' });
    if (server.owner_id !== req.user.id) return res.status(403).json({ error: 'Somente o dono pode convidar' });
    const code = crypto.randomBytes(18).toString('base64url');
    const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
    db.run('INSERT INTO server_invites (code, server_id, created_by, expires_at, max_uses) VALUES (?, ?, ?, ?, ?)',
      [code, server.id, req.user.id, expiresAt, 30]);
    res.status(201).json({ invite: { code, expires_at: expiresAt, url: 'https://chat.bairroanimefire.com/?invite=' + code } });
  });

  router.get('/invites/:code', authRequired, (req, res) => {
    const code = String(req.params.code || '');
    if (!/^[A-Za-z0-9_-]{20,40}$/.test(code)) return res.status(404).json({ error: 'Convite inválido' });
    const invite = db.get(`SELECT i.code, i.expires_at, i.max_uses, i.uses, s.id AS server_id, s.name, s.icon_emoji
      FROM server_invites i JOIN servers s ON s.id = i.server_id WHERE i.code = ?`, [code]);
    if (!invite || Date.parse(invite.expires_at) < Date.now() || invite.uses >= invite.max_uses) {
      return res.status(404).json({ error: 'Convite expirado ou esgotado' });
    }
    res.json({ invite });
  });

  router.post('/invites/join', authRequired, (req, res) => {
    const code = String(req.body?.code || '').trim();
    if (!/^[A-Za-z0-9_-]{20,40}$/.test(code)) return res.status(400).json({ error: 'Código inválido' });
    const invite = db.get(`SELECT i.*, s.name FROM server_invites i
      JOIN servers s ON s.id = i.server_id WHERE i.code = ?`, [code]);
    if (!invite || Date.parse(invite.expires_at) < Date.now() || invite.uses >= invite.max_uses) {
      return res.status(404).json({ error: 'Convite expirado ou esgotado' });
    }
    const already = db.get('SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?',
      [invite.server_id, req.user.id]);
    if (!already) {
      db.run('INSERT INTO server_members (server_id, user_id) VALUES (?, ?)', [invite.server_id, req.user.id]);
      db.run('UPDATE server_invites SET uses = uses + 1 WHERE code = ?', [code]);
    }
    res.json({ ok: true, already_member: !!already, server_id: invite.server_id, server_name: invite.name });
  });

  router.post('/:serverId/channels', authRequired, (req, res) => {
    const server = db.get('SELECT id, owner_id FROM servers WHERE id = ?', [req.params.serverId]);
    if (!server) return res.status(404).json({ error: 'Servidor não encontrado' });
    if (server.owner_id !== req.user.id) return res.status(403).json({ error: 'Somente o dono pode criar canais' });
    const name = String(req.body?.name || '').trim().toLowerCase().replace(/\s+/g, '-');
    const type = req.body?.type === 'voice' ? 'voice' : 'text';
    if (!/^[a-z0-9_\-]{2,32}$/.test(name)) return res.status(400).json({ error: 'Nome do canal inválido (letras, números e -)' });
    if (db.get('SELECT 1 FROM channels WHERE server_id = ? AND name = ?', [server.id, name])) {
      return res.status(409).json({ error: 'Esse canal já existe' });
    }
    const pos = db.get('SELECT MAX(position) AS pos FROM channels WHERE server_id = ?', [server.id]);
    const id = uuidv4();
    db.run('INSERT INTO channels (id, server_id, name, type, position) VALUES (?, ?, ?, ?, ?)',
      [id, server.id, name, type, (Number(pos?.pos) || 0) + 1]);
    res.status(201).json({ channel: { id, server_id: server.id, name, type } });
  });

  return router;
}

module.exports = { createServersRouter };
