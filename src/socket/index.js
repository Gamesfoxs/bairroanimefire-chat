const { v4: uuidv4 } = require('uuid');
const { verifyToken } = require('../middleware/auth');

/** userId -> Set of socket ids */
const onlineUsers = new Map();
/** socketId -> user payload */
const socketUsers = new Map();

function getOnlineIds() {
  return Array.from(onlineUsers.keys());
}

function broadcastPresence(io, db) {
  const online = new Set(getOnlineIds());
  for (const userId of online) {
    // Only share presence with friends or members of the same private server.
    const visible = db.all(`SELECT DISTINCT b.user_id AS id FROM server_members a
      JOIN server_members b ON a.server_id = b.server_id
      JOIN servers s ON s.id = a.server_id
      WHERE a.user_id = ? AND s.name != 'Bairro Anime Fire'
      UNION SELECT CASE WHEN user_id = ? THEN friend_id ELSE user_id END AS id
      FROM friendships WHERE status = 'accepted' AND (user_id = ? OR friend_id = ?)`,
      [userId, userId, userId, userId]);
    const allowed = visible.map(row => row.id).filter(id => online.has(id));
    io.to(`user:${userId}`).emit('presence:update', { online: [userId, ...allowed] });
  }
}

function setupSocket(io, db) {
  // Sliding-window limits per account (across browser tabs).
  // Prevents burst spam and runaway signaling without retaining message content.
  const rate = new Map();
  function rateAllowed(userId,kind,maxEvents,windowMs) {
    const key = userId + ':' + kind;
    const now = Date.now();
    let item = rate.get(key);
    if (!item || now - item.started >= windowMs) {
      item = {started:now,count:0};
      rate.set(key,item);
    }
    if (item.count >= maxEvents) return false;
    item.count++;
    return true;
  }
  const rateCleanup = setInterval(() => {
    const now = Date.now();
    for (const [key,item] of rate) {
      if (now - item.started > 60000) rate.delete(key);
    }
  },60000);
  rateCleanup.unref();

  // Rooms are not an authorization boundary: validate membership before joining
  // or sending typing/signaling events, including after reconnects.
  function channelAccess(userId, channelId) {
    return db.get(`SELECT c.id, c.type FROM channels c
      JOIN server_members m ON m.server_id = c.server_id
      WHERE c.id = ? AND m.user_id = ?`, [channelId, userId]);
  }
  function dmAccess(userId, dmId) {
    return db.get(`SELECT id FROM dm_channels WHERE id = ?
      AND (user1_id = ? OR user2_id = ?)`, [dmId, userId, userId]);
  }
  io.use((socket, next) => {
    const token =
      socket.handshake.auth?.token ||
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
    socket.join(`user:${userId}`);
    broadcastPresence(io, db);

    socket.on('channel:join', ({ channelId } = {}, ack) => {
      if (!channelId || !channelAccess(userId, channelId)) {
        if (typeof ack === 'function') ack({ error: 'Sem acesso ao canal' });
        return;
      }
      socket.join(`channel:${channelId}`);
      if (typeof ack === 'function') ack({ ok: true });
    });

    socket.on('channel:leave', ({ channelId } = {}) => {
      if (channelId) socket.leave(`channel:${channelId}`);
    });

    socket.on('dm:join', ({ dmId } = {}, ack) => {
      if (!dmId || !dmAccess(userId, dmId)) {
        if (typeof ack === 'function') ack({ error: 'Sem acesso à conversa' });
        return;
      }
      socket.join(`dm:${dmId}`);
      if (typeof ack === 'function') ack({ ok: true });
    });

    socket.on('dm:leave', ({ dmId } = {}) => {
      if (dmId) socket.leave(`dm:${dmId}`);
    });

    socket.on('message:send', (payload, ack) => {
      try {
        if (!rateAllowed(userId,'messages',16,10000)) {
          if (typeof ack === 'function') ack({error:'Muitas mensagens em pouco tempo. Aguarde alguns segundos.'});
          return;
        }
        const content = String(payload?.content || '').trim();
        const channelId = payload?.channelId;
        const mediaId = typeof payload?.mediaId === 'string' ? payload.mediaId : null;
        if ((!content && !mediaId) || !channelId) {
          if (typeof ack === 'function') ack({ error: 'Mensagem inválida' });
          return;
        }
        if (content.length > 2000) {
          if (typeof ack === 'function') ack({ error: 'Mensagem muito longa' });
          return;
        }

        const channel = db.get(`SELECT * FROM channels WHERE id = ?`, [channelId]);
        if (!channel || channel.type !== 'text') {
          if (typeof ack === 'function') ack({ error: 'Canal de texto não encontrado' });
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

        const media = mediaId && db.get('SELECT id,mime,bytes FROM media_uploads WHERE id=? AND owner_id=? AND scope_type=? AND scope_id=? AND status=?',[mediaId,userId,'channel',channelId,'pending']);
        if (mediaId && !media) {
          if (typeof ack === 'function') ack({ error: 'Anexo inválido ou usado' });
          return;
        }
        const id = uuidv4();
        const created_at = new Date().toISOString().replace('T', ' ').slice(0, 19);
        db.run(
          `INSERT INTO messages (id, channel_id, author_id, content, created_at, media_id) VALUES (?, ?, ?, ?, ?, ?)`,
          [id, channelId, userId, content, created_at, mediaId || null]
        );
        if (media) db.run('UPDATE media_uploads SET status=?,message_id=? WHERE id=?',['sent',id,mediaId]);

        const author = db.get(
          `SELECT id, username, display_name, avatar_color FROM users WHERE id = ?`,
          [userId]
        );
        const message = {
          id,
          channel_id: channelId,
          content,
          created_at,
          media_id: media?.id || null,
          media_type: media?.mime || null,
          media_size: media?.bytes || null,
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
        if (!rateAllowed(userId,'messages',16,10000)) {
          if (typeof ack === 'function') ack({error:'Muitas mensagens em pouco tempo. Aguarde alguns segundos.'});
          return;
        }
        const content = String(payload?.content || '').trim();
        const dmId = payload?.dmId;
        const mediaId = typeof payload?.mediaId === 'string' ? payload.mediaId : null;
        if ((!content && !mediaId) || !dmId) {
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

        const media = mediaId && db.get('SELECT id,mime,bytes FROM media_uploads WHERE id=? AND owner_id=? AND scope_type=? AND scope_id=? AND status=?',[mediaId,userId,'dm',dmId,'pending']);
        if (mediaId && !media) {
          if (typeof ack === 'function') ack({ error: 'Anexo inválido ou usado' });
          return;
        }
        const id = uuidv4();
        const created_at = new Date().toISOString().replace('T', ' ').slice(0, 19);
        db.run(
          `INSERT INTO dm_messages (id, dm_channel_id, author_id, content, created_at, media_id) VALUES (?, ?, ?, ?, ?, ?)`,
          [id, dmId, userId, content, created_at, mediaId || null]
        );
        if (media) db.run('UPDATE media_uploads SET status=?,message_id=? WHERE id=?',['sent',id,mediaId]);

        const author = db.get(
          `SELECT id, username, display_name, avatar_color FROM users WHERE id = ?`,
          [userId]
        );
        const message = {
          id,
          dm_channel_id: dmId,
          content,
          created_at,
          media_id: media?.id || null,
          media_type: media?.mime || null,
          media_size: media?.bytes || null,
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

    socket.on('typing:start', ({ channelId, dmId } = {}) => {
      if (!rateAllowed(userId,'typing',12,10000)) return;
      if (channelId && socket.rooms.has(`channel:${channelId}`) && channelAccess(userId, channelId)) {
        socket.to(`channel:${channelId}`).emit('typing:start', {
          channelId, userId, username: socket.user.username,
        });
      }
      if (dmId && socket.rooms.has(`dm:${dmId}`) && dmAccess(userId, dmId)) {
        socket.to(`dm:${dmId}`).emit('typing:start', {
          dmId, userId, username: socket.user.username,
        });
      }
    });

    // Small private voice channels: WebRTC carries audio P2P, Socket.IO only
    // relays signaling to authenticated participants in the same voice room.
    const voiceRooms = new Set();
    function leaveVoice(channelId) {
      if (!voiceRooms.has(channelId)) return;
      voiceRooms.delete(channelId);
      socket.leave(`voice:${channelId}`);
      socket.to(`voice:${channelId}`).emit('voice:peer-left', { channelId, socketId: socket.id });
    }
    socket.on('voice:join', ({ channelId } = {}, ack) => {
      const channel = channelId && channelAccess(userId, channelId);
      if (!channel || channel.type !== 'voice') {
        if (typeof ack === 'function') ack({ error: 'Sem acesso à sala de voz' });
        return;
      }
      const room = `voice:${channelId}`;
      const current = [...(io.sockets.adapter.rooms.get(room) || [])];
      if (current.length >= 10 && !current.includes(socket.id)) {
        if (typeof ack === 'function') ack({ error: 'Sala cheia (10 pessoas)' });
        return;
      }
      // One voice room per browser connection at a time.
      for (const old of [...voiceRooms]) if (old !== channelId) leaveVoice(old);
      const peers = current.filter(id => id !== socket.id).map(id => ({
        socketId: id, userId: socketUsers.get(id)?.id,
        username: socketUsers.get(id)?.username
      }));
      socket.join(room);
      voiceRooms.add(channelId);
      if (typeof ack === 'function') ack({ ok: true, peers, socketId: socket.id });
      socket.to(room).emit('voice:peer-joined', { channelId, socketId: socket.id, userId, username: socket.user.username });
    });
    socket.on('voice:leave', ({ channelId } = {}) => {
      if (channelId) leaveVoice(channelId);
    });
    socket.on('voice:signal', (payload = {}) => {
      if (!rateAllowed(userId,'webrtc',160,10000)) return;
      const { channelId, to, type, sdp, candidate } = payload;
      const room = `voice:${channelId}`;
      const isMember = channelId && channelAccess(userId, channelId);
      if (!isMember || !voiceRooms.has(channelId) || !socket.rooms.has(room)) return;
      if (!['offer', 'answer', 'ice'].includes(type) || typeof to !== 'string') return;
      const members = io.sockets.adapter.rooms.get(room);
      if (!members?.has(to) || to === socket.id) return;
      if (type === 'ice' && (!candidate || JSON.stringify(candidate).length > 4096)) return;
      if (type !== 'ice' && (typeof sdp !== 'string' || sdp.length > 64000)) return;
      io.to(to).emit('voice:signal', {
        channelId, from: socket.id, type,
        ...(type === 'ice' ? { candidate } : { sdp })
      });
    });

    socket.on('disconnect', () => {
      for (const room of [...voiceRooms]) leaveVoice(room);
      socketUsers.delete(socket.id);
      const set = onlineUsers.get(userId);
      if (set) {
        set.delete(socket.id);
        if (set.size === 0) onlineUsers.delete(userId);
      }
      broadcastPresence(io, db);
    });
  });
}

module.exports = { setupSocket, getOnlineIds };
