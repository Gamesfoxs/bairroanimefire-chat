const { v4: uuidv4 } = require('uuid');
const { verifyToken } = require('../middleware/auth');

/** userId -> Set of socket ids */
const onlineUsers = new Map();
/** socketId -> user payload */
const socketUsers = new Map();

function getOnlineIds() {
  return Array.from(onlineUsers.keys());
}

function broadcastPresence(io) {
  io.emit('presence:update', { online: getOnlineIds() });
}

function setupSocket(io, db) {
  io.use((socket, next) => {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.query?.token ||
      (socket.handshake.headers.cookie || '')
        .split(';')
        .map((c) => c.trim())
        .find((c) => c.startsWith('token='))
        ?.slice(6);
    if (!token) return next(new Error('Não autenticado'));
    const payload = verifyToken(token);
    if (!payload) return next(new Error('Token inválido'));
    socket.user = payload;
    next();
  });

  io.on('connection', (socket) => {
    const userId = socket.user.id;
    socketUsers.set(socket.id, socket.user);

    if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
    onlineUsers.get(userId).add(socket.id);
    broadcastPresence(io);

    socket.join(`user:${userId}`);

    socket.on('channel:join', ({ channelId }) => {
      if (!channelId) return;
      socket.join(`channel:${channelId}`);
    });

    socket.on('channel:leave', ({ channelId }) => {
      if (!channelId) return;
      socket.leave(`channel:${channelId}`);
    });

    socket.on('dm:join', ({ dmId }) => {
      if (!dmId) return;
      socket.join(`dm:${dmId}`);
    });

    socket.on('message:send', (payload, ack) => {
      try {
        const content = String(payload?.content || '').trim();
        const channelId = payload?.channelId;
        if (!content || !channelId) {
          if (typeof ack === 'function') ack({ error: 'Mensagem inválida' });
          return;
        }
        if (content.length > 2000) {
          if (typeof ack === 'function') ack({ error: 'Mensagem muito longa' });
          return;
        }

        const channel = db.get(`SELECT * FROM channels WHERE id = ?`, [channelId]);
        if (!channel) {
          if (typeof ack === 'function') ack({ error: 'Canal não encontrado' });
          return;
        }
        const member = db.get(
          `SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?`,
          [channel.server_id, userId]
        );
        if (!member) {
          if (typeof ack === 'function') ack({ error: 'Sem acesso' });
          return;
        }

        const id = uuidv4();
        const created_at = new Date().toISOString().replace('T', ' ').slice(0, 19);
        db.run(
          `INSERT INTO messages (id, channel_id, author_id, content, created_at) VALUES (?, ?, ?, ?, ?)`,
          [id, channelId, userId, content, created_at]
        );

        const author = db.get(
          `SELECT id, username, display_name, avatar_color FROM users WHERE id = ?`,
          [userId]
        );
        const message = {
          id,
          channel_id: channelId,
          content,
          created_at,
          author_id: author.id,
          author_username: author.username,
          author_display_name: author.display_name,
          author_color: author.avatar_color,
        };
        io.to(`channel:${channelId}`).emit('message:new', message);
        if (typeof ack === 'function') ack({ ok: true, message });
      } catch (err) {
        console.error('message:send', err);
        if (typeof ack === 'function') ack({ error: 'Erro interno' });
      }
    });

    socket.on('dm:send', (payload, ack) => {
      try {
        const content = String(payload?.content || '').trim();
        const dmId = payload?.dmId;
        if (!content || !dmId) {
          if (typeof ack === 'function') ack({ error: 'Mensagem inválida' });
          return;
        }
        if (content.length > 2000) {
          if (typeof ack === 'function') ack({ error: 'Mensagem muito longa' });
          return;
        }

        const channel = db.get(`SELECT * FROM dm_channels WHERE id = ?`, [dmId]);
        if (!channel) {
          if (typeof ack === 'function') ack({ error: 'DM não encontrada' });
          return;
        }
        if (channel.user1_id !== userId && channel.user2_id !== userId) {
          if (typeof ack === 'function') ack({ error: 'Sem acesso' });
          return;
        }

        const id = uuidv4();
        const created_at = new Date().toISOString().replace('T', ' ').slice(0, 19);
        db.run(
          `INSERT INTO dm_messages (id, dm_channel_id, author_id, content, created_at) VALUES (?, ?, ?, ?, ?)`,
          [id, dmId, userId, content, created_at]
        );

        const author = db.get(
          `SELECT id, username, display_name, avatar_color FROM users WHERE id = ?`,
          [userId]
        );
        const message = {
          id,
          dm_channel_id: dmId,
          content,
          created_at,
          author_id: author.id,
          author_username: author.username,
          author_display_name: author.display_name,
          author_color: author.avatar_color,
        };
        io.to(`dm:${dmId}`).emit('dm:new', message);

        // Notificar o outro usuário se não estiver na room
        const peerId = channel.user1_id === userId ? channel.user2_id : channel.user1_id;
        io.to(`user:${peerId}`).emit('dm:notify', {
          dmId,
          message,
          from: author,
        });

        if (typeof ack === 'function') ack({ ok: true, message });
      } catch (err) {
        console.error('dm:send', err);
        if (typeof ack === 'function') ack({ error: 'Erro interno' });
      }
    });

    socket.on('typing:start', ({ channelId, dmId }) => {
      if (channelId) {
        socket.to(`channel:${channelId}`).emit('typing:start', {
          channelId,
          userId,
          username: socket.user.username,
        });
      }
      if (dmId) {
        socket.to(`dm:${dmId}`).emit('typing:start', {
          dmId,
          userId,
          username: socket.user.username,
        });
      }
    });

    socket.on('disconnect', () => {
      socketUsers.delete(socket.id);
      const set = onlineUsers.get(userId);
      if (set) {
        set.delete(socket.id);
        if (set.size === 0) onlineUsers.delete(userId);
      }
      broadcastPresence(io);
    });
  });
}

module.exports = { setupSocket, getOnlineIds };
