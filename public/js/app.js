(() => {
  'use strict';

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

  const state = {
    token: null, // Session stays in secure HttpOnly cookie; never store JWT in localStorage.
    user: null,
    socket: null,
    servers: [],
    channels: [],
    members: [],
    friends: [],
    pending: [],
    dms: [],
    pendingMediaFile: null,
    attachmentObjectUrl: null,
    mediaSending: false,
    historyRequestId: 0,
    loadingHistoryKey: null,
    bufferedHistoryMessages: [],
    wasConnected: false,
    videoQuality: localStorage.getItem('baf_chat_video_quality') || 'auto',
    currentAdminServerId: null,
    online: new Set(),
    view: 'home', // home | channel | dm
    activeServerId: null,
    activeChannelId: null,
    activeDmId: null,
    typingTimer: null,
    voiceChannelId: null,
    localStream: null,
    videoStream: null,
    videoMode: null,
    voicePeers: new Map(),
    voiceParticipants: new Map(),
    pendingInvite: new URLSearchParams(location.search).get('invite') || localStorage.getItem('baf_chat_invite'),
  };

  // ---------- API ----------
  async function api(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    const res = await fetch(`/api${path}`, { ...opts, headers, credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
    return data;
  }

  function toast(msg, ms = 2800) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.hidden = true; }, ms);
  }

  function initials(name) {
    return (name || '?').slice(0, 2).toUpperCase();
  }

  function formatTime(iso) {
    try {
      const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
      return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  }

  function formatDay(iso) {
    try {
      const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
      return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
    } catch {
      return '';
    }
  }

  if (state.pendingInvite) localStorage.setItem('baf_chat_invite', state.pendingInvite);
  localStorage.removeItem('baf_token');

  // ---------- Auth UI (SSO only) ----------
  (function showSsoError() {
    const params = new URLSearchParams(location.search);
    const err = params.get('sso_error');
    const ok = params.get('sso');
    if (err || ok) {
      const clean = location.pathname;
      history.replaceState({}, '', clean);
    }
    if (err) {
      const map = {
        state_invalid: 'Login cancelado ou inválido. Tenta de novo.',
        state_expired: 'Demorou demais. Clica em Entrar de novo.',
        exchange_denied: 'O site principal não liberou o login.',
        callback_failed: 'Falha no login. Tenta de novo.',
        sso_unavailable: 'SSO fora do ar. Tenta daqui a pouco.',
      };
      const el = $('#auth-error');
      el.textContent = map[err] || 'Não deu pra entrar. Tenta de novo.';
      el.hidden = false;
    }
  })();

  $('#btn-logout').addEventListener('click', async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch {}
    localStorage.removeItem('baf_token');
    state.token = null;
    state.user = null;
    leaveVoice();
    updateRealtimeIndicator(false);
    if (state.socket) { state.socket.disconnect(); state.socket = null; }
    state.wasConnected = false;
    state.historyRequestId++;
    state.loadingHistoryKey = null;
    state.bufferedHistoryMessages = [];
    $('#app').classList.add('hidden');
    $('#auth-screen').classList.remove('hidden');
  });

  // ---------- Socket ----------
  function connectSocket() {
    if (state.socket) state.socket.disconnect();
    state.socket = io({
      auth: {}, // WebSocket authenticates using same-origin HttpOnly session cookie.
      withCredentials: true,
      transports: ['websocket', 'polling'],
    });

    state.socket.on('connect', () => {
      const reconnect = state.wasConnected;
      state.wasConnected = true;
      updateRealtimeIndicator(true);
      if (reconnect) refreshCurrentHistory(true).catch(() => {});
      if (state.voiceChannelId && state.localStream) {
        for (const p of state.voicePeers.values()) p.close();
        state.voicePeers.clear();
        state.voiceParticipants.clear();
        joinVoiceSocket().catch(err => toast(err.message));
      }
      if (state.activeChannelId) {
        state.socket.emit('channel:join', { channelId: state.activeChannelId });
      }
      if (state.activeDmId) {
        state.socket.emit('dm:join', { dmId: state.activeDmId });
      }
    });

    state.socket.on('presence:update', ({ online }) => {
      state.online = new Set(online || []);
      renderMembers();
      renderFriendsHome();
      updateMeStatus();
    });

    state.socket.on('message:new', (msg) => {
      if (state.view === 'channel' && msg.channel_id === state.activeChannelId) {
        if (state.loadingHistoryKey === 'channel:' + msg.channel_id) state.bufferedHistoryMessages.push(msg);
        appendMessage(msg);
      }
    });

    state.socket.on('dm:new', (msg) => {
      if (state.view === 'dm' && msg.dm_channel_id === state.activeDmId) {
        if (state.loadingHistoryKey === 'dm:' + msg.dm_channel_id) state.bufferedHistoryMessages.push(msg);
        appendMessage(msg);
      }
    });

    state.socket.on('dm:notify', ({ from }) => {
      if (state.view !== 'dm') {
        toast(`💬 Nova DM de ${from.display_name || from.username}`);
      }
    });

    state.socket.on('typing:start', ({ channelId, dmId, username, userId }) => {
      if (userId === state.user.id) return;
      const match =
        (channelId && channelId === state.activeChannelId) ||
        (dmId && dmId === state.activeDmId);
      if (!match) return;
      const el = $('#typing');
      el.textContent = `${username} está digitando…`;
      el.hidden = false;
      clearTimeout(el._t);
      el._t = setTimeout(() => { el.hidden = true; }, 2500);
    });

    state.socket.on('voice:peer-joined', ({ channelId, socketId, userId, username }) => {
      if (channelId !== state.voiceChannelId || !state.localStream) return;
      state.voiceParticipants.set(socketId, { userId, username });
      renderVoiceParticipants();
    });
    state.socket.on('voice:peer-left', ({ channelId, socketId }) => {
      if (channelId !== state.voiceChannelId) return;
      closeVoicePeer(socketId);
      state.voiceParticipants.delete(socketId);
      renderVoiceParticipants();
    });
    state.socket.on('voice:signal', (payload) => {
      if (payload?.channelId === state.voiceChannelId && state.localStream) {
        handleVoiceSignal(payload).catch(() => toast('Falha na conexão de voz. Tente sair e entrar.'));
      }
    });
    state.socket.on('message:deleted', ({channelId,messageId}) => {
      if (state.view === 'channel' && state.activeChannelId === channelId) {
        const el = $$('.msg', $('#messages')).find(x => x.dataset.id === messageId);
        el?.remove();
      }
    });
    state.socket.on('server:removed', async ({serverId}) => {
      await loadServers().catch(() => {});
      if (state.activeServerId === serverId) showHome();
      closeAdmin();
      toast('Você foi removido de um servidor.');
    });
    state.socket.on('servers:changed', () => { loadServers().catch(() => {}); });
    state.socket.on('disconnect', () => updateRealtimeIndicator(false));
    state.socket.on('connect_error', (err) => {
      updateRealtimeIndicator(false);
      console.warn('socket', err.message);
      toast('Conexão do chat indisponível');
    });
  }

  // Atualizado diretamente pela conexão Socket.IO: nunca anuncie "ao vivo" desconectado.
  function updateRealtimeIndicator(connected) {
    const chip = $('#realtime-chip');
    chip.classList.toggle('connected', Boolean(connected));
    $('#realtime-label').textContent = connected ? 'Ao vivo' : 'Reconectando';
    chip.title = connected ? 'Conectado ao chat em tempo real' : 'Sem conexão em tempo real';
  }

  // ---------- Boot ----------
  async function bootApp() {
    $('#auth-screen').classList.add('hidden');
    $('#app').classList.remove('hidden');
    updateMePanel();
    connectSocket();
    await loadServers();
    await loadFriends();
    await loadDms();
    showHome();
    await handlePendingInvite();
  }

  function updateMePanel() {
    const u = state.user;
    const av = $('#me-avatar');
    av.textContent = initials(u.display_name || u.username);
    av.style.background = u.avatar_color || '#7289da';
    av.classList.add('online');
    $('#me-name').textContent = u.display_name || u.username;
    updateMeStatus();
  }

  function updateMeStatus() {
    $('#me-status').textContent = 'Online';
  }

  async function loadServers() {
    const { servers } = await api('/servers');
    state.servers = servers;
    renderServerRail();
  }

  async function loadFriends() {
    const [{ friends }, { pending }] = await Promise.all([
      api('/friends'),
      api('/friends/pending'),
    ]);
    state.friends = friends;
    state.pending = pending;
    renderFriendsHome();
  }

  async function loadDms() {
    const { channels } = await api('/dms');
    state.dms = channels;
  }

  function renderServerRail() {
    const list = $('#server-list');
    list.innerHTML = '';
    for (const s of state.servers) {
      const btn = document.createElement('button');
      btn.className = 'server-btn' + (s.id === state.activeServerId ? ' active' : '');
      btn.title = s.name;
      btn.textContent = s.icon_emoji && s.icon_emoji !== '✨'
        ? s.icon_emoji
        : initials(s.name.replace(/\s+/g, ' ').trim());
      btn.setAttribute('aria-label', 'Abrir servidor ' + s.name);
      btn.addEventListener('click', () => openServer(s.id));
      list.appendChild(btn);
    }
  }

  $('#btn-home').addEventListener('click', () => {
    state.activeServerId = null;
    $$('.server-btn').forEach((b) => b.classList.remove('active'));
    $('#btn-home').classList.add('active');
    showHome();
  });

  $('#join-invite-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const raw = $('#invite-code').value.trim();
    const code = extractInviteCode(raw);
    if (!code) return toast('Cole um convite válido');
    try {
      await joinInvite(code);
      $('#invite-code').value = '';
    } catch (err) { toast(err.message); }
  });

  function extractInviteCode(raw) {
    try { raw = new URL(raw).searchParams.get('invite') || ''; } catch {}
    return /^[A-Za-z0-9_-]{20,40}$/.test(raw) ? raw : null;
  }
  async function joinInvite(code) {
    const { server_id, server_name } = await api('/servers/invites/join', {
      method: 'POST', body: JSON.stringify({ code })
    });
    localStorage.removeItem('baf_chat_invite');
    state.pendingInvite = null;
    await loadServers();
    toast('Você entrou em ' + server_name + '!');
    await openServer(server_id);
  }
  async function handlePendingInvite() {
    const code = extractInviteCode(state.pendingInvite || '');
    if (!code) return;
    $('#invite-code').value = code;
    try {
      const { invite } = await api('/servers/invites/' + encodeURIComponent(code));
      if (confirm('Entrar na sala privada "' + invite.name + '"?')) await joinInvite(code);
    } catch (err) {
      localStorage.removeItem('baf_chat_invite');
      state.pendingInvite = null;
      toast(err.message);
    }
  }

  async function createServer() {
    const name = prompt('Nome do novo servidor:');
    if (!name || !name.trim()) return;
    try {
      const { server } = await api('/servers', { method: 'POST', body: JSON.stringify({ name: name.trim() }) });
      await loadServers();
      if (server?.id) await openServer(server.id);
      toast('Servidor criado!');
    } catch (err) {
      toast(err.message);
    }
  }
  $('#btn-add-server').addEventListener('click', createServer);
  $('#home-create-server').addEventListener('click', createServer);

  async function openServer(serverId) {
    closeAdmin();
    clearMediaAttachment();
    leaveVoice();
    state.activeServerId = serverId;
    state.view = 'channel';
    $('#btn-home').classList.remove('active');
    renderServerRail();

    const server = state.servers.find((s) => s.id === serverId);
    $('#sidebar-title').textContent = server ? server.name : 'Servidor';

    const [{ channels }, { members }] = await Promise.all([
      api(`/servers/${serverId}/channels`),
      api(`/servers/${serverId}/members`),
    ]);
    state.channels = channels;
    state.members = members;
    renderChannelSidebar();
    renderMembers();
    $('#members-panel').classList.remove('hidden');

    const firstText = channels.find(c => c.type === 'text');
    if (firstText) await openChannel(firstText.id);
    else if (channels.length) await openVoiceChannel(channels[0].id);
    closeMobilePanels();
  }

  function canModerateCurrentServer() {
    const server = state.servers.find(x => x.id === state.activeServerId);
    return Boolean(server && (server.owner_id === state.user.id ||
      state.members.some(member => member.id === state.user.id && member.role === 'moderator')));
  }

  function renderChannelSidebar() {
    const body = $('#sidebar-body');
    body.innerHTML = '';
    const server = state.servers.find(s => s.id === state.activeServerId);
    if (server && canModerateCurrentServer()) {
      const tools = document.createElement('div');
      tools.className = 'channel-toolbar';
      const invite = document.createElement('button');
      invite.textContent = '🔗 Convidar amigos';
      invite.addEventListener('click', async () => {
        try {
          const { invite } = await api('/servers/' + server.id + '/invites', { method: 'POST' });
          try {
            await navigator.clipboard.writeText(invite.url);
            toast('Link privado copiado! Envie no grupo da guilda.');
          } catch {
            prompt('Copie o link privado:', invite.url);
          }
        } catch (err) { toast(err.message); }
      });
      async function addChannel(type) {
        const suggested = type === 'voice' ? 'sala-de-voz' : 'novo-canal';
        const name = prompt(type === 'voice' ? 'Nome do canal de voz:' : 'Nome do canal de texto:', suggested);
        if (!name || !name.trim()) return;
        try {
          const result = await api('/servers/' + server.id + '/channels', {
            method: 'POST', body: JSON.stringify({ name, type })
          });
          const data = await api('/servers/' + server.id + '/channels');
          state.channels = data.channels;
          renderChannelSidebar();
          toast(type === 'voice' ? 'Sala de voz criada!' : 'Canal de texto criado!');
          if (type === 'voice' && result.channel?.id) await openVoiceChannel(result.channel.id);
        } catch (err) { toast(err.message); }
      }
      const addText = document.createElement('button');
      addText.textContent = '# Criar texto';
      addText.addEventListener('click', () => addChannel('text'));
      const addVoice = document.createElement('button');
      addVoice.textContent = '🎙️ Criar voz';
      addVoice.addEventListener('click', () => addChannel('voice'));
      const admin = document.createElement('button');
      admin.textContent = '🛡️ Administração';
      admin.addEventListener('click', openAdmin);
      tools.append(invite, addText, addVoice, admin);
      body.appendChild(tools);
    }
    for (const type of ['text', 'voice']) {
      const channels = state.channels.filter(ch => (ch.type || 'text') === type);
      if (!channels.length) continue;
      const section = document.createElement('div');
      section.className = 'nav-section';
      const title = document.createElement('div');
      title.className = 'nav-section-title';
      title.textContent = type === 'voice' ? 'Canais de voz' : 'Canais de texto';
      section.appendChild(title);
      for (const ch of channels) {
        const btn = document.createElement('button');
        const active = type === 'voice' ? state.view === 'voice' && ch.id === state.voiceChannelId : state.view === 'channel' && ch.id === state.activeChannelId;
        btn.className = 'nav-item' + (type === 'voice' ? ' voice-channel' : '') + (active ? ' active' : '');
        btn.textContent = (type === 'voice' ? '🔊 ' : '# ') + ch.name;
        btn.addEventListener('click', () => type === 'voice' ? openVoiceChannel(ch.id) : openChannel(ch.id));
        section.appendChild(btn);
      }
      body.appendChild(section);
    }
    if (state.dms.length) {
      const dmSec = document.createElement('div');
      dmSec.className = 'nav-section';
      dmSec.innerHTML = '<div class="nav-section-title">Mensagens diretas</div>';
      for (const dm of state.dms) {
        const btn = document.createElement('button');
        btn.className = 'nav-item' + (dm.id === state.activeDmId ? ' active' : '');
        const dot = document.createElement('span');
        dot.textContent = state.online.has(dm.peer_id) ? '🟢 ' : '⚪ ';
        btn.append(dot, document.createTextNode(dm.peer_display_name || dm.peer_username));
        btn.addEventListener('click', () => openDm(dm.id, dm));
        dmSec.appendChild(btn);
      }
      body.appendChild(dmSec);
    }
  }

  function renderMembers() {
    const list = $('#members-list');
    list.innerHTML = '';
    const sorted = [...state.members].sort((a, b) => {
      const ao = state.online.has(a.id) ? 0 : 1;
      const bo = state.online.has(b.id) ? 0 : 1;
      if (ao !== bo) return ao - bo;
      return (a.display_name || '').localeCompare(b.display_name || '', 'pt-BR');
    });
    $('#member-count').textContent = sorted.length;
    for (const m of sorted) {
      const li = document.createElement('li');
      const isOnline = state.online.has(m.id);
      li.className = 'member-row' + (isOnline ? ' online' : '');
      li.innerHTML = `
        <div class="avatar" style="background:${m.avatar_color}">${escapeHtml(initials(m.display_name))}</div>
        <span>${escapeHtml(m.display_name || m.username)}</span>
        <span class="dot" title="${isOnline ? 'Online' : 'Offline'}"></span>
      `;
      if (m.role === 'owner' || m.role === 'moderator') {
        const role = document.createElement('span');
        role.className = 'member-role ' + m.role;
        role.textContent = m.role === 'owner' ? '👑 Dono' : '🛡️ Mod';
        li.insertBefore(role, li.querySelector('.dot'));
      }
      li.addEventListener('dblclick', () => startDmWith(m.id));
      list.appendChild(li);
    }
  }

  async function openChannel(channelId) {
    clearMediaAttachment();
    leaveVoice();
    if (state.activeDmId && state.socket) state.socket.emit('dm:leave', { dmId: state.activeDmId });
    if (state.activeChannelId && state.socket) {
      state.socket.emit('channel:leave', { channelId: state.activeChannelId });
    }
    state.view = 'channel';
    state.activeChannelId = channelId;
    state.activeDmId = null;
    const ch = state.channels.find((c) => c.id === channelId);
    showChatView();
    $('#chat-hash').textContent = '#';
    $('#chat-hash').hidden = false;
    $('#chat-title').textContent = ch ? ch.name : 'canal';
    $('#composer').hidden = false;
    $('#composer-input').placeholder = `Mensagem em #${ch?.name || 'canal'}`;
    renderChannelSidebar();

    if (state.socket) state.socket.emit('channel:join', { channelId });

    await refreshCurrentHistory();
    if (state.view === 'channel' && state.activeChannelId === channelId) closeMobilePanels();
  }

  async function openDm(dmId, meta) {
    clearMediaAttachment();
    leaveVoice();
    if (state.activeDmId && state.socket) state.socket.emit('dm:leave', { dmId: state.activeDmId });
    if (state.activeChannelId && state.socket) {
      state.socket.emit('channel:leave', { channelId: state.activeChannelId });
    }
    state.view = 'dm';
    state.activeDmId = dmId;
    state.activeChannelId = null;
    showChatView();
    $('#chat-hash').textContent = '@';
    $('#chat-title').textContent = meta?.peer_display_name || meta?.peer_username || 'DM';
    $('#composer').hidden = false;
    $('#composer-input').placeholder = `Mensagem para ${meta?.peer_display_name || '…'}`;
    renderChannelSidebar();
    if (state.socket) state.socket.emit('dm:join', { dmId });

    await refreshCurrentHistory();
    if (state.view === 'dm' && state.activeDmId === dmId) closeMobilePanels();
  }

  async function startDmWith(userId) {
    try {
      const { channel } = await api('/dms/open', {
        method: 'POST',
        body: JSON.stringify({ userId }),
      });
      await loadDms();
      // If on a server, keep sidebar with DMs
      if (state.activeServerId) renderChannelSidebar();
      else showHomeSidebarWithDms();
      await openDm(channel.id, channel);
    } catch (err) {
      toast(err.message);
    }
  }

  function showHome() {
    state.historyRequestId++;
    state.loadingHistoryKey = null;
    state.bufferedHistoryMessages = [];
    closeAdmin();
    clearMediaAttachment();
    leaveVoice();
    if (state.activeChannelId && state.socket) state.socket.emit('channel:leave', { channelId: state.activeChannelId });
    if (state.activeDmId && state.socket) state.socket.emit('dm:leave', { dmId: state.activeDmId });
    state.view = 'home';
    state.activeChannelId = null;
    state.activeDmId = null;
    state.activeServerId = null;
    $('#app').dataset.view = 'home';
    $('#btn-toggle-members').hidden = true;
    $('#btn-home').classList.add('active');
    renderServerRail();
    $('#sidebar-title').textContent = 'Amigos';
    $('#home-view').classList.remove('hidden');
    $('#voice-view').classList.add('hidden');
    $('#messages').classList.add('hidden');
    $('#composer').hidden = true;
    $('#typing').hidden = true;
    $('#chat-hash').hidden = true;
    $('#chat-title').textContent = 'Início';
    $('#members-panel').classList.add('hidden');
    showHomeSidebarWithDms();
    renderFriendsHome();
    closeMobilePanels();
  }

  function showHomeSidebarWithDms() {
    const body = $('#sidebar-body');
    body.innerHTML = '';
    const sec = document.createElement('div');
    sec.className = 'nav-section';
    sec.innerHTML = `<div class="nav-section-title">Navegação</div>`;
    const homeBtn = document.createElement('button');
    homeBtn.className = 'nav-item active';
    homeBtn.textContent = '🏠 Amigos';
    homeBtn.addEventListener('click', () => showHome());
    sec.appendChild(homeBtn);
    body.appendChild(sec);

    if (state.dms.length) {
      const dmSec = document.createElement('div');
      dmSec.className = 'nav-section';
      dmSec.innerHTML = `<div class="nav-section-title">Mensagens diretas</div>`;
      for (const dm of state.dms) {
        const btn = document.createElement('button');
        btn.className = 'nav-item';
        const online = state.online.has(dm.peer_id);
        btn.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:${online ? 'var(--online)' : 'var(--offline)'}"></span> ${escapeHtml(dm.peer_display_name || dm.peer_username)}`;
        btn.addEventListener('click', () => openDm(dm.id, dm));
        dmSec.appendChild(btn);
      }
      body.appendChild(dmSec);
    }

    if (state.servers.length) {
      const sSec = document.createElement('div');
      sSec.className = 'nav-section';
      sSec.innerHTML = `<div class="nav-section-title">Servidores</div>`;
      for (const s of state.servers) {
        const btn = document.createElement('button');
        btn.className = 'nav-item';
        btn.innerHTML = `${s.icon_emoji || '✨'} ${escapeHtml(s.name)}`;
        btn.addEventListener('click', () => openServer(s.id));
        sSec.appendChild(btn);
      }
      body.appendChild(sSec);
    }
  }

  function showChatView() {
    $('#app').dataset.view = state.view;
    $('#btn-toggle-members').hidden = $('#members-panel').classList.contains('hidden');
    $('#voice-view').classList.add('hidden');
    $('#home-view').classList.add('hidden');
    $('#messages').classList.remove('hidden');
    $('#chat-hash').hidden = false;
  }

  function renderFriendsHome() {
    const fl = $('#friends-list');
    const pl = $('#pending-list');
    fl.innerHTML = '';
    pl.innerHTML = '';

    if (!state.friends.length) {
      fl.innerHTML = '<li style="color:var(--text-dim)">Nenhum amigo ainda</li>';
    }
    for (const f of state.friends) {
      if (f.status && f.status !== 'accepted' && f.status !== undefined) {
        // show outgoing pending separately? skip non-accepted in friends list display if status pending from us
      }
      const accepted = !f.status || f.status === 'accepted';
      if (!accepted) continue;
      const li = document.createElement('li');
      const online = state.online.has(f.id);
      li.innerHTML = `
        <div class="avatar" style="background:${f.avatar_color};width:28px;height:28px;font-size:0.7rem">${escapeHtml(initials(f.display_name))}</div>
        <span>${escapeHtml(f.display_name)} <small style="color:var(--text-dim)">@${escapeHtml(f.username)}</small>
        ${online ? '<small style="color:var(--online)"> · online</small>' : ''}</span>
        <button type="button" class="btn-sm">Mensagem</button>
      `;
      li.querySelector('.btn-sm').addEventListener('click', () => startDmWith(f.id));
      fl.appendChild(li);
    }

    if (!state.pending.length) {
      pl.innerHTML = '<li style="color:var(--text-dim)">Nenhum pedido</li>';
    }
    for (const p of state.pending) {
      const li = document.createElement('li');
      li.innerHTML = `
        <div class="avatar" style="background:${p.avatar_color};width:28px;height:28px;font-size:0.7rem">${escapeHtml(initials(p.display_name))}</div>
        <span>${escapeHtml(p.display_name)} <small style="color:var(--text-dim)">@${escapeHtml(p.username)}</small></span>
        <button type="button" class="btn-sm">Aceitar</button>
      `;
      li.querySelector('.btn-sm').addEventListener('click', async () => {
        try {
          await api(`/friends/${p.friendship_id}/accept`, { method: 'POST' });
          await loadFriends();
          toast('Amizade aceita!');
        } catch (err) {
          toast(err.message);
        }
      });
      pl.appendChild(li);
    }
  }

  $('#add-friend-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = $('#friend-username').value.trim();
    const msg = $('#friend-msg');
    try {
      const res = await api('/friends/request', {
        method: 'POST',
        body: JSON.stringify({ username }),
      });
      msg.textContent = res.status === 'accepted' ? 'Vocês agora são amigos!' : 'Pedido enviado!';
      $('#friend-username').value = '';
      await loadFriends();
    } catch (err) {
      msg.textContent = err.message;
    }
  });

  // ---------- Messages ----------
  async function refreshCurrentHistory(preserveScroll = false) {
    const type = state.view;
    const id = type === 'channel' ? state.activeChannelId : type === 'dm' ? state.activeDmId : null;
    if (!id) return;
    const request = ++state.historyRequestId;
    const key = type + ':' + id;
    state.loadingHistoryKey = key;
    state.bufferedHistoryMessages = [];
    const url = type === 'channel'
      ? '/servers/channels/' + encodeURIComponent(id) + '/messages?limit=80'
      : '/dms/' + encodeURIComponent(id) + '/messages?limit=80';
    try {
      const result = await api(url);
      if (request !== state.historyRequestId || state.view !== type
          || (type === 'channel' ? state.activeChannelId : state.activeDmId) !== id) return;
      const merged = new Map((result.messages || []).map(message => [message.id,message]));
      for (const message of state.bufferedHistoryMessages) merged.set(message.id,message);
      const messages = [...merged.values()].sort((a,b) =>
        (a.created_at || '').localeCompare(b.created_at || '') || a.id.localeCompare(b.id));
      state.loadingHistoryKey = null;
      state.bufferedHistoryMessages = [];
      renderMessages(messages,preserveScroll);
    } catch(err) {
      if (request === state.historyRequestId) {
        state.loadingHistoryKey = null;
        state.bufferedHistoryMessages = [];
        toast('Falha ao atualizar mensagens: ' + err.message);
      }
    }
  }
  function renderMessages(messages, preserveScroll = false) {
    const box = $('#messages');
    const previousScroll = box.scrollTop;
    const wasNearBottom = (box.scrollHeight - box.clientHeight - box.scrollTop) < 110;
    box.innerHTML = '';
    if (!messages.length) {
      box.innerHTML = `<div class="empty-chat"><div class="big">💬</div><p>Nenhuma mensagem ainda. Manda a primeira!</p></div>`;
      return;
    }
    let lastDay = '';
    for (const m of messages) {
      const day = formatDay(m.created_at);
      if (day && day !== lastDay) {
        lastDay = day;
        const sep = document.createElement('div');
        sep.className = 'msg-day';
        sep.textContent = day;
        box.appendChild(sep);
      }
      box.appendChild(buildMessageEl(m));
    }
    box.scrollTop = preserveScroll && !wasNearBottom ? previousScroll : box.scrollHeight;
  }

  function appendMessage(msg) {
    const box = $('#messages');
    const empty = box.querySelector('.empty-chat');
    if (empty) empty.remove();
    const item = buildMessageEl(msg);
    item.classList.add('msg-new');
    box.appendChild(item);
    box.scrollTop = box.scrollHeight;
  }

  function buildMessageEl(m) {
    const el = document.createElement('div');
    el.className = 'msg';
    el.dataset.id = m.id;
    el.innerHTML = `
      <div class="msg-avatar" style="background:${m.author_color || '#7289da'}">${escapeHtml(initials(m.author_display_name || m.author_username))}</div>
      <div class="msg-body">
        <div class="msg-meta">
          <span class="msg-author" style="color:${m.author_color || 'inherit'}">${escapeHtml(m.author_display_name || m.author_username)}</span>
          <span class="msg-time">${formatTime(m.created_at)}</span>
        </div>
        <div class="msg-content">${escapeHtml(m.content)}</div>
      </div>
    `;
    if (m.media_id && /^[a-f0-9-]{36}$/i.test(m.media_id) && m.media_type) {
      const container = document.createElement('div');
      container.className = 'msg-media';
      const url = '/api/media/' + encodeURIComponent(m.media_id);
      if (m.media_type.startsWith('image/')) {
        const image = document.createElement('img');
        image.src = url;
        image.alt = m.media_type === 'image/gif' ? 'GIF enviado na conversa' : 'Imagem enviada na conversa';
        image.loading = 'lazy';
        image.decoding = 'async';
        image.tabIndex = 0;
        image.role = 'button';
        image.title = 'Ver imagem ampliada';
        image.setAttribute('aria-label', 'Ampliar imagem enviada');
        const zoom = () => openMediaLightbox(url, image.alt);
        image.addEventListener('click', zoom);
        image.addEventListener('keydown',event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); zoom(); }
        });
        container.appendChild(image);
      } else if (m.media_type.startsWith('video/')) {
        const video = document.createElement('video');
        video.src = url;
        video.controls = true;
        video.preload = 'metadata';
        video.playsInline = true;
        video.setAttribute('aria-label','Vídeo enviado na conversa');
        container.appendChild(video);
      }
      el.querySelector('.msg-body').appendChild(container);
    }
    if (state.view === 'channel' && state.activeServerId && (m.author_id === state.user.id || canModerateCurrentServer())) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'msg-delete';
      remove.textContent = 'Apagar';
      remove.setAttribute('aria-label', 'Apagar mensagem');
      remove.addEventListener('click', async () => {
        if (!confirm('Apagar esta mensagem para todos?')) return;
        try {
          await api('/admin/' + state.activeServerId + '/messages/' + m.id, {method:'DELETE'});
          el.remove();
        } catch(err) { toast(err.message); }
      });
      el.querySelector('.msg-meta').appendChild(remove);
    }
    return el;
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ---------- Image lightbox ----------
  function openMediaLightbox(src,alt) {
    const viewer = $('#media-lightbox');
    const image = $('#media-lightbox-image');
    image.src = src;
    image.alt = alt || 'Imagem ampliada';
    viewer.hidden = false;
    $('#media-lightbox-close').focus();
  }
  function closeMediaLightbox() {
    $('#media-lightbox').hidden = true;
    $('#media-lightbox-image').removeAttribute('src');
  }
  $('#media-lightbox-close').addEventListener('click',closeMediaLightbox);
  $('#media-lightbox').addEventListener('click',event => {
    if (event.target === $('#media-lightbox')) closeMediaLightbox();
  });

  // ---------- Composer ----------
  // ---------- Media attachments: uploaded directly to private S3 via the API ----------
  function clearMediaAttachment() {
    state.pendingMediaFile = null;
    $('#media-file').value = '';
    if (state.attachmentObjectUrl) URL.revokeObjectURL(state.attachmentObjectUrl);
    state.attachmentObjectUrl = null;
    $('#attachment-thumb').removeAttribute('src');
    $('#attachment-thumb').hidden = true;
    $('#attachment-preview').hidden = true;
    $('#attachment-name').textContent = '';
    $('#attachment-state').textContent = 'Pronto para enviar • qualidade original';
    updateMediaProgress(null);
  }
  function updateMediaProgress(percent) {
    const el = $('#upload-progress');
    el.hidden = percent === null;
    const value = Math.max(0,Math.min(100,Number(percent)||0));
    el.setAttribute('aria-valuenow',String(value));
    $('#upload-progress-bar').style.width = value + '%';
  }
  function selectMediaFile(file) {
    if (!file) return;
    const allowed = ['image/jpeg','image/png','image/gif','image/webp','video/mp4','video/webm'];
    if (!allowed.includes(file.type)) return toast('Use PNG, JPEG, GIF, WEBP, MP4 ou WEBM');
    const max = file.type.startsWith('image/') ? 8 * 1048576 : 24 * 1048576;
    if (file.size > max || file.size === 0) {
      return toast('Limite: imagens e GIFs 8 MB, vídeos 24 MB');
    }
    clearMediaAttachment();
    state.pendingMediaFile = file;
    $('#attachment-name').textContent = (file.type.startsWith('video/') ? '🎬 ' : '📎 ') +
      file.name + ' • ' + (file.size / 1048576).toFixed(1) + ' MB';
    if (file.type.startsWith('image/')) {
      state.attachmentObjectUrl = URL.createObjectURL(file);
      $('#attachment-thumb').src = state.attachmentObjectUrl;
      $('#attachment-thumb').hidden = false;
    }
    $('#attachment-preview').hidden = false;
  }
  $('#btn-attach').addEventListener('click', () => {
    $('#media-file').accept = 'image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm';
    $('#media-file').click();
  });
  $('#btn-gif').addEventListener('click', () => {
    $('#media-file').accept = '.gif,image/gif';
    $('#media-file').click();
  });
  $('#attachment-clear').addEventListener('click', clearMediaAttachment);
  $('#media-file').addEventListener('change', () => selectMediaFile($('#media-file').files?.[0]));
  // Paste an image directly from the clipboard; drag and drop files on desktop.
  $('#composer-input').addEventListener('paste', event => {
    const file = [...(event.clipboardData?.items || [])]
      .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
      .map(item => item.getAsFile()).find(Boolean);
    if (file) { event.preventDefault(); selectMediaFile(file); }
  });
  const dropArea = $('.chat-main');
  dropArea.addEventListener('dragover', event => {
    if (event.dataTransfer?.types?.includes('Files')) {
      event.preventDefault();
      dropArea.classList.add('dragging-file');
    }
  });
  dropArea.addEventListener('dragleave', event => {
    if (!dropArea.contains(event.relatedTarget)) dropArea.classList.remove('dragging-file');
  });
  dropArea.addEventListener('drop', event => {
    dropArea.classList.remove('dragging-file');
    if (!event.dataTransfer?.files?.length) return;
    event.preventDefault();
    if ($('#composer').hidden) return toast('Abra um canal de texto ou PV para enviar arquivos');
    selectMediaFile(event.dataTransfer.files[0]);
  });

  function uploadMedia(file, scopeType, scopeId) {
    const url = '/api/media/upload?scope_type=' + encodeURIComponent(scopeType) + '&scope_id=' + encodeURIComponent(scopeId);
    return new Promise((resolve,reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST',url);
      xhr.withCredentials = true;
      xhr.timeout = 120000;
      xhr.setRequestHeader('Content-Type','application/octet-stream');
      xhr.upload.addEventListener('progress',event => {
        if (!event.lengthComputable) return;
        const progress = Math.round((event.loaded / event.total) * 100);
        updateMediaProgress(progress);
        $('#attachment-state').textContent = 'Enviando ' + progress + '% • arquivo original';
      });
      xhr.addEventListener('load',() => {
        let data;
        try { data = JSON.parse(xhr.responseText); } catch { data = {}; }
        if (xhr.status < 200 || xhr.status >= 300) return reject(new Error(data.error || 'Falha ao enviar o arquivo'));
        if (!data.media?.id) return reject(new Error('Arquivo enviado sem confirmação'));
        updateMediaProgress(100);
        $('#attachment-state').textContent = 'Enviado • finalizando mensagem';
        resolve(data.media.id);
      });
      xhr.addEventListener('error',()=>reject(new Error('Falha de conexão durante o upload')));
      xhr.addEventListener('timeout',()=>reject(new Error('Upload demorou demais. Verifique sua conexão.')));
      xhr.addEventListener('abort',()=>reject(new Error('Upload cancelado')));
      updateMediaProgress(0);
      xhr.send(file);
    });
  }
  function sendSocketMessage(eventName, payload) {
    return new Promise((resolve,reject) => {
      const timer = setTimeout(() => reject(new Error('O envio da mensagem demorou demais')), 15000);
      state.socket.emit(eventName,payload,ack => {
        clearTimeout(timer);
        if (!ack?.ok) return reject(new Error(ack?.error || 'Falha ao enviar mensagem'));
        resolve(ack);
      });
    });
  }
  $('#composer').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (state.mediaSending) return;
    const input = $('#composer-input');
    const content = input.value.trim();
    const file = state.pendingMediaFile;
    if ((!content && !file) || !state.socket?.connected) return;
    const type = state.view === 'channel' ? 'channel' : state.view === 'dm' ? 'dm' : null;
    const id = type === 'channel' ? state.activeChannelId : type === 'dm' ? state.activeDmId : null;
    if (!type || !id) return;
    state.mediaSending = true;
    $('#btn-submit-message').disabled = true;
    $('#btn-submit-message').textContent = file ? '…' : '➤';
    try {
      let mediaId = null;
      if (file) {
        toast('Enviando arquivo para o armazenamento…', 4500);
        mediaId = await uploadMedia(file,type,id);
      }
      if (state.view !== type || (type === 'channel' ? state.activeChannelId : state.activeDmId) !== id) {
        throw new Error('A conversa mudou durante o envio. Tente novamente.');
      }
      await sendSocketMessage(type === 'channel' ? 'message:send' : 'dm:send', {
        ...(type === 'channel' ? {channelId:id} : {dmId:id}),
        content, ...(mediaId ? {mediaId} : {}),
      });
      input.value = '';
      clearMediaAttachment();
    } catch(err) { toast(err.message,5000); }
    finally {
      state.mediaSending = false;
      $('#btn-submit-message').disabled = false;
      $('#btn-submit-message').textContent = '➤';
      if (state.pendingMediaFile) {
        $('#attachment-state').textContent = 'Não enviado • toque em enviar para tentar novamente';
        updateMediaProgress(null);
      }
    }
  });

  $('#composer-input').addEventListener('input', () => {
    if (!state.socket) return;
    clearTimeout(state.typingTimer);
    state.typingTimer = setTimeout(() => {
      if (state.view === 'channel' && state.activeChannelId) {
        state.socket.emit('typing:start', { channelId: state.activeChannelId });
      } else if (state.view === 'dm' && state.activeDmId) {
        state.socket.emit('typing:start', { dmId: state.activeDmId });
      }
    }, 200);
  });


  // ---------- Private WebRTC voice (small guild rooms) ----------
  async function openVoiceChannel(channelId) {
    state.historyRequestId++;
    state.loadingHistoryKey = null;
    state.bufferedHistoryMessages = [];
    if (state.voiceChannelId !== channelId) leaveVoice();
    if (state.activeChannelId && state.socket) state.socket.emit('channel:leave', { channelId: state.activeChannelId });
    if (state.activeDmId && state.socket) state.socket.emit('dm:leave', { dmId: state.activeDmId });
    state.activeChannelId = null;
    state.activeDmId = null;
    state.view = 'voice';
    $('#app').dataset.view = 'voice';
    $('#btn-toggle-members').hidden = $('#members-panel').classList.contains('hidden');
    state.voiceChannelId = channelId;
    const ch = state.channels.find(c => c.id === channelId);
    $('#chat-title').textContent = '🔊 ' + (ch?.name || 'Voz');
    $('#chat-hash').hidden = true;
    $('#composer').hidden = true;
    $('#messages').classList.add('hidden');
    $('#home-view').classList.add('hidden');
    $('#voice-view').classList.remove('hidden');
    $('#voice-title').textContent = '🔊 ' + (ch?.name || 'Voz');
    syncCallControls();
    $('#voice-status').textContent = state.localStream ? 'Conectado à chamada' : 'Seu microfone está desligado';
    renderVoiceParticipants();
    renderChannelSidebar();
    closeMobilePanels();
  }

  function renderVoiceParticipants() {
    const list = $('#voice-peers');
    list.innerHTML = '';
    if (!state.localStream) return;
    const mine = document.createElement('li');
    mine.textContent = '🎙️ Você';
    list.appendChild(mine);
    for (const p of state.voiceParticipants.values()) {
      const li = document.createElement('li');
      li.textContent = '🎧 ' + (p.username || 'Participante');
      list.appendChild(li);
    }
    $('#voice-status').textContent = 'Conectado • ' + (1 + state.voiceParticipants.size) + ' pessoa(s) na voz';
  }

  function closeVoicePeer(socketId) {
    const pc = state.voicePeers.get(socketId);
    if (pc) pc.close();
    state.voicePeers.delete(socketId);
    const audio = document.getElementById('voice-audio-' + socketId);
    if (audio) { audio.srcObject = null; audio.remove(); }
    const videoCard = document.getElementById('voice-video-' + socketId);
    if (videoCard) {
      const video = videoCard.querySelector('video');
      if (video) video.srcObject = null;
      videoCard.remove();
    }
    syncVideoGrid();
  }

  // Responsive capture quality: prioritize clarity without saturating mobile uplinks.
  const videoPresets = {
    high: { width: 1280, height: 720, fps: 24, bitrate: 1700000, label: 'HD 720p' },
    balanced: { width: 960, height: 540, fps: 24, bitrate: 850000, label: '540p equilibrado' },
    data: { width: 640, height: 360, fps: 15, bitrate: 380000, label: '360p econômico' },
  };
  function currentVideoPreset() {
    if (videoPresets[state.videoQuality]) return videoPresets[state.videoQuality];
    const mobile = window.matchMedia('(max-width: 720px)').matches;
    return navigator.connection?.saveData
      ? videoPresets.data : mobile ? videoPresets.balanced : videoPresets.high;
  }
  function renderVideoQualityHint() {
    const preset = currentVideoPreset();
    $('#voice-quality-hint').textContent = state.videoQuality === 'auto'
      ? 'Automático: ' + preset.label + (navigator.connection?.saveData ? ' • economia de dados ativa' : '')
      : 'Selecionado: ' + preset.label + ' • ajuste conforme a conexão';
  }
  async function applyPeerVideoQuality(pc) {
    const sender = pc?._videoSender;
    if (!sender || !sender.getParameters || !sender.setParameters) return;
    try {
      const params = sender.getParameters();
      if (!params.encodings?.length) return;
      const target = currentVideoPreset();
      params.encodings[0].maxBitrate = state.videoMode === 'screen'
        ? Math.min(2400000, Math.round(target.bitrate * 1.45)) : target.bitrate;
      params.degradationPreference = state.videoMode === 'screen' ? 'maintain-resolution' : 'balanced';
      await sender.setParameters(params);
    } catch(err) {
      console.warn('Bitrate adjustment unsupported by browser:', err.message);
    }
  }
  async function applyLiveVideoQuality() {
    const track = state.videoStream?.getVideoTracks()[0];
    if (track && track.readyState === 'live' && state.videoMode === 'camera') {
      const p = currentVideoPreset();
      try {
        await track.applyConstraints({
          width: { ideal:p.width }, height: { ideal:p.height }, frameRate: { ideal:p.fps, max:30 }
        });
      } catch(err) {
        console.warn('Camera cannot change resolution live:',err.message);
        toast('Câmera: seu aparelho não permite essa resolução');
      }
    }
    await Promise.all([...state.voicePeers.values()].map(applyPeerVideoQuality));
    renderVideoQualityHint();
  }
  const videoQualitySelect = $('#voice-quality');
  videoQualitySelect.value = Object.prototype.hasOwnProperty.call(videoPresets,state.videoQuality) || state.videoQuality === 'auto'
    ? state.videoQuality : 'auto';
  state.videoQuality = videoQualitySelect.value;
  renderVideoQualityHint();
  videoQualitySelect.addEventListener('change',() => {
    state.videoQuality = videoQualitySelect.value;
    localStorage.setItem('baf_chat_video_quality',state.videoQuality);
    applyLiveVideoQuality().catch(() => toast('Não foi possível ajustar a qualidade'));
  });
  window.addEventListener('resize',() => {
    if (state.videoQuality === 'auto') renderVideoQualityHint();
  });

  function createVoicePeer(socketId) {
    if (state.voicePeers.has(socketId)) return state.voicePeers.get(socketId);
    if (!state.localStream) throw new Error('Microfone não autorizado');
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }]
    });
    pc._pendingIce = [];
    for (const track of state.localStream.getAudioTracks()) pc.addTrack(track, state.localStream);
    // Negotiate a recv/send video transceiver from the start, even for audio-only
    // calls. replaceTrack() then turns camera/screen on without offer glare.
    const videoTransceiver = pc.addTransceiver('video', { direction: 'sendrecv' });
    pc._videoSender = videoTransceiver.sender;
    if (state.videoStream) {
      const videoTrack = state.videoStream.getVideoTracks()[0];
      if (videoTrack && videoTrack.readyState === 'live') {
        pc._videoSender.replaceTrack(videoTrack).catch(() => {
          toast('Não foi possível transmitir vídeo a um participante');
        });
      }
    }
    pc.onicecandidate = event => {
      if (event.candidate && state.socket?.connected && state.voiceChannelId) {
        state.socket.emit('voice:signal', {
          channelId: state.voiceChannelId, to: socketId, type: 'ice', candidate: event.candidate.toJSON()
        });
      }
    };
    pc.ontrack = event => {
      if (event.track.kind === 'audio') {
        let audio = document.getElementById('voice-audio-' + socketId);
        if (!audio) {
          audio = document.createElement('audio');
          audio.id = 'voice-audio-' + socketId;
          audio.autoplay = true;
          audio.playsInline = true;
          $('#voice-audio').appendChild(audio);
        }
        audio.srcObject = new MediaStream([event.track]);
        audio.play().catch(() => {
          $('#voice-status').textContent = 'Toque na tela para liberar o som';
        });
        return;
      }
      if (event.track.kind === 'video') {
        const showVideo = () => {
          if (event.track.readyState === 'ended') return;
          let card = document.getElementById('voice-video-' + socketId);
          if (!card) {
            card = document.createElement('div');
            card.id = 'voice-video-' + socketId;
            card.className = 'voice-video-card remote';
            const video = document.createElement('video');
            video.autoplay = true;
            video.playsInline = true;
            video.setAttribute('aria-label', 'Vídeo de outro participante');
            const caption = document.createElement('span');
            caption.className = 'voice-video-label';
            caption.textContent = state.voiceParticipants.get(socketId)?.username || 'Participante';
            card.append(video, caption);
            $('#voice-video-grid').appendChild(card);
          }
          const video = card.querySelector('video');
          video.srcObject = new MediaStream([event.track]);
          video.play().catch(() => {
            $('#voice-status').textContent = 'Toque na chamada para liberar o vídeo';
          });
          syncVideoGrid();
        };
        const hideVideo = () => {
          const card = document.getElementById('voice-video-' + socketId);
          if (card) { card.querySelector('video').srcObject = null; card.remove(); }
          syncVideoGrid();
        };
        event.track.addEventListener('unmute', showVideo);
        event.track.addEventListener('mute', hideVideo);
        event.track.addEventListener('ended', hideVideo);
        if (!event.track.muted) showVideo();
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        $('#voice-status').textContent = 'Falha de conexão de voz com participante. Tente entrar novamente.';
      }
    };
    state.voicePeers.set(socketId, pc);
    applyPeerVideoQuality(pc).catch(() => {});
    return pc;
  }

  async function offerVoiceTo(socketId) {
    const pc = createVoicePeer(socketId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    state.socket.emit('voice:signal', {
      channelId: state.voiceChannelId, to: socketId, type: 'offer', sdp: pc.localDescription.sdp
    });
  }

  async function handleVoiceSignal({ from, type, sdp, candidate }) {
    if (!from || !state.localStream) return;
    const pc = createVoicePeer(from);
    if (type === 'ice') {
      if (!candidate) return;
      if (pc.remoteDescription) await pc.addIceCandidate(candidate);
      else pc._pendingIce.push(candidate);
      return;
    }
    if (type === 'offer') {
      await pc.setRemoteDescription({ type: 'offer', sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      state.socket.emit('voice:signal', {
        channelId: state.voiceChannelId, to: from, type: 'answer', sdp: pc.localDescription.sdp
      });
    } else if (type === 'answer' && pc.signalingState === 'have-local-offer') {
      await pc.setRemoteDescription({ type: 'answer', sdp });
    }
    if (pc.remoteDescription && pc._pendingIce?.length) {
      for (const c of pc._pendingIce.splice(0)) await pc.addIceCandidate(c);
    }
  }

  async function joinVoiceSocket() {
    if (!state.socket?.connected) throw new Error('Chat desconectado. Tente novamente.');
    const channelId = state.voiceChannelId;
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('A sala de voz não respondeu')), 12000);
      state.socket.emit('voice:join', { channelId }, ack => {
        clearTimeout(timer);
        if (ack?.error) reject(new Error(ack.error));
        else if (ack?.ok) resolve(ack);
        else reject(new Error('Não foi possível entrar na voz'));
      });
    });
    if (state.voiceChannelId !== channelId || !state.localStream) return;
    for (const peer of result.peers || []) {
      state.voiceParticipants.set(peer.socketId, peer);
      offerVoiceTo(peer.socketId).catch(() => toast('Não conectou a um participante'));
    }
    renderVoiceParticipants();
  }

  async function startVoice() {
    if (!state.voiceChannelId || state.localStream) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
      return toast('Este navegador não permite chamadas de voz');
    }
    $('#voice-status').textContent = 'Solicitando acesso ao microfone…';
    try {
      state.localStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false
      });
      await joinVoiceSocket();
      syncCallControls();
      $('#voice-mute').textContent = '🔇 Silenciar';
      renderVoiceParticipants();
    } catch (err) {
      leaveVoice(false);
      $('#voice-status').textContent = 'Microfone desligado — ' + err.message;
      toast('Voz: ' + err.message);
    }
  }

  function leaveVoice(resetView = true) {
    if (state.voiceChannelId && state.socket && state.localStream) {
      state.socket.emit('voice:leave', { channelId: state.voiceChannelId });
    }
    for (const id of [...state.voicePeers.keys()]) closeVoicePeer(id);
    state.voiceParticipants.clear();
    stopLocalVideo();
    if (state.localStream) {
      for (const track of state.localStream.getTracks()) track.stop();
      state.localStream = null;
    }
    $('#voice-audio').replaceChildren();
    syncCallControls();
    if (resetView) state.voiceChannelId = null;
    if (state.view === 'voice') $('#voice-status').textContent = 'Microfone desligado';
  }

  // ---------- Camera and screen sharing (WebRTC) ----------
  function syncVideoGrid() {
    const grid = $('#voice-video-grid');
    grid.classList.toggle('has-video', Boolean(grid.querySelector('.voice-video-card:not([hidden])')));
  }

  function syncCallControls() {
    const connected = Boolean(state.localStream);
    $('#voice-join').classList.toggle('hidden', connected);
    for (const id of ['voice-mute','voice-camera','voice-screen','voice-leave']) {
      $('#' + id).classList.toggle('hidden', !connected);
    }
    $('#voice-camera').textContent = state.videoMode === 'camera' ? '📷 Desligar câmera' : '📹 Ligar câmera';
    $('#voice-camera').setAttribute('aria-pressed', String(state.videoMode === 'camera'));
    $('#voice-screen').textContent = state.videoMode === 'screen' ? '⏹️ Parar transmissão' : '🖥️ Transmitir tela';
    $('#voice-screen').setAttribute('aria-pressed', String(state.videoMode === 'screen'));
    const supported = Boolean(navigator.mediaDevices?.getDisplayMedia);
    $('#voice-screen').disabled = !supported && state.videoMode !== 'screen';
    $('#voice-screen').title = supported ? 'Compartilhar a tela ou janela (com permissão)' : 'Seu navegador não permite transmitir a tela';
  }

  function updateLocalVideo() {
    const track = state.videoStream?.getVideoTracks()[0];
    const card = $('#voice-local-card');
    const preview = $('#voice-local-video');
    if (track && track.readyState === 'live') {
      preview.srcObject = new MediaStream([track]);
      card.dataset.mode = state.videoMode || '';
      card.hidden = false;
      $('#voice-local-label').textContent = state.videoMode === 'screen' ? '🖥️ Você • tela' : '📹 Você • câmera';
      preview.play().catch(() => {});
    } else {
      card.hidden = true;
      preview.srcObject = null;
    }
    syncVideoGrid();
    syncCallControls();
  }

  function stopLocalVideo() {
    const previous = state.videoStream;
    state.videoStream = null;
    state.videoMode = null;
    // No renegotiation: the sender remains available for the next camera/screen.
    for (const pc of state.voicePeers.values()) {
      pc._videoSender?.replaceTrack(null).catch(() => {});
    }
    if (previous) for (const track of previous.getTracks()) track.stop();
    updateLocalVideo();
  }

  async function switchLocalVideo(mode) {
    if (!state.localStream || !state.voiceChannelId) return toast('Entre na chamada primeiro');
    if (state.videoMode === mode) { stopLocalVideo(); return; }
    const channelId = state.voiceChannelId;
    let stream;
    try {
      if (mode === 'screen') {
        if (!navigator.mediaDevices?.getDisplayMedia) {
          return toast('Seu navegador não suporta transmissão de tela. A câmera funciona no celular.');
        }
        const profile = currentVideoPreset();
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: { width: { ideal: Math.max(1280, profile.width) }, frameRate: { ideal: profile.fps } },
          audio: false
        });
      } else {
        const profile = currentVideoPreset();
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal:profile.width },
            height: { ideal:profile.height },
            frameRate: { ideal:profile.fps,max:30 }
          },
          audio: false
        });
      }
      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error('Nenhuma imagem encontrada');
      if (!state.localStream || channelId !== state.voiceChannelId) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }
      const previousTrack = state.videoStream?.getVideoTracks()[0] || null;
      const updatedPeers = [];
      const failed = [];
      for (const [id, pc] of state.voicePeers) {
        try {
          await pc._videoSender.replaceTrack(track);
          updatedPeers.push(pc);
        } catch {
          failed.push(id);
        }
      }
      if (failed.length) {
        await Promise.all(updatedPeers.map(pc => pc._videoSender.replaceTrack(previousTrack).catch(() => {})));
        stream.getTracks().forEach(t => t.stop());
        toast('Este navegador não conseguiu enviar vídeo. Saia e entre na chamada.');
        return;
      }
      const previous = state.videoStream;
      state.videoStream = stream;
      state.videoMode = mode;
      // Browser's own "stop sharing" button returns to audio-only.
      track.addEventListener('ended', () => {
        if (state.videoStream === stream) stopLocalVideo();
      });
      if (previous) previous.getTracks().forEach(t => t.stop());
      updateLocalVideo();
      await Promise.all([...state.voicePeers.values()].map(applyPeerVideoQuality));
      toast(mode === 'screen' ? '🖥️ Transmissão iniciada' : '📹 Câmera ligada');
    } catch (err) {
      stream?.getTracks().forEach(t => t.stop());
      if (err.name !== 'NotAllowedError' && err.name !== 'AbortError') {
        toast('Vídeo: ' + err.message);
      } else {
        toast('Permissão de câmera ou tela não concedida');
      }
    }
  }

  $('#voice-camera').addEventListener('click', () => switchLocalVideo('camera'));
  $('#voice-screen').addEventListener('click', () => switchLocalVideo('screen'));

  $('#voice-join').addEventListener('click', startVoice);
  $('#voice-leave').addEventListener('click', () => leaveVoice(false));
  $('#voice-mute').addEventListener('click', () => {
    if (!state.localStream) return;
    const track = state.localStream.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    $('#voice-mute').textContent = track.enabled ? '🔇 Silenciar' : '🎙️ Ativar microfone';
  });

  // ---------- Owner / moderator dashboard ----------
  function closeAdmin() {
    $('#admin-panel').classList.add('hidden');
    state.currentAdminServerId = null;
  }
  $('#admin-close').addEventListener('click', closeAdmin);
  $('#admin-panel').addEventListener('click', ev => {
    if (ev.target === $('#admin-panel')) closeAdmin();
  });
  function adminActionButton(text,cssClass,handler) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'admin-action ' + (cssClass || '');
    b.textContent = text;
    b.addEventListener('click', async () => {
      b.disabled = true;
      try { await handler(); }
      catch(err) { toast(err.message,4500); }
      finally { b.disabled = false; }
    });
    return b;
  }
  async function refreshAdmin() {
    const serverId = state.currentAdminServerId;
    if (!serverId) return;
    const data = await api('/admin/' + serverId);
    if (state.currentAdminServerId !== serverId) return;
    $('#admin-title').textContent = 'Administrar ' + data.server.name;
    $('#admin-rename-form').hidden = !data.is_owner;
    $('#admin-server-name').value = data.server.name;
    $('#admin-member-count').textContent = '(' + data.members.length + ')';
    const memberList = $('#admin-members');
    memberList.replaceChildren();
    for (const member of data.members) {
      const line = document.createElement('div');
      line.className = 'admin-member';
      const meta = document.createElement('div');
      meta.className = 'admin-member-info';
      const name = document.createElement('strong');
      name.textContent = member.display_name || member.username;
      const role = document.createElement('small');
      role.textContent = member.role === 'owner' ? '👑 Dono' : member.role === 'moderator' ? '🛡️ Moderador' : 'Membro';
      meta.append(name,role);
      const actions = document.createElement('div');
      actions.className = 'admin-member-actions';
      if (member.role !== 'owner' && member.id !== state.user.id) {
        if (data.is_owner) {
          const nextRole = member.role === 'moderator' ? 'member' : 'moderator';
          actions.appendChild(adminActionButton(member.role === 'moderator' ? 'Remover mod' : 'Tornar mod','', async () => {
            await api('/admin/' + serverId + '/roles/' + member.id, {
              method:'PUT', body:JSON.stringify({role:nextRole})
            });
            await refreshAdmin();
          }));
        }
        if (data.is_owner || member.role !== 'moderator') {
          actions.appendChild(adminActionButton('Expulsar','', async () => {
            if (!confirm('Expulsar ' + (member.display_name || member.username) + '?')) return;
            await api('/admin/' + serverId + '/members/' + member.id + '/kick',{method:'POST'});
            await refreshAdmin();
          }));
          actions.appendChild(adminActionButton('Banir','danger', async () => {
            if (!confirm('Banir ' + (member.display_name || member.username) + ' deste servidor?')) return;
            const reason = prompt('Motivo (opcional):') || '';
            await api('/admin/' + serverId + '/members/' + member.id + '/ban',{
              method:'POST',body:JSON.stringify({reason})
            });
            await refreshAdmin();
          }));
        }
      }
      line.append(meta,actions);
      memberList.appendChild(line);
    }
    const bans = $('#admin-bans');
    bans.replaceChildren();
    if (!data.bans.length) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = 'Nenhuma pessoa banida';
      bans.appendChild(empty);
    }
    for (const ban of data.bans) {
      const line = document.createElement('div');
      line.className = 'admin-member';
      const label = document.createElement('span');
      label.textContent = (ban.display_name || ban.username || 'Usuário') + (ban.reason ? ' • ' + ban.reason : '');
      const unban = adminActionButton('Desbanir','',async ()=>{
        await api('/admin/' + serverId + '/bans/' + ban.user_id, {method:'DELETE'});
        await refreshAdmin();
      });
      line.append(label,unban);
      bans.appendChild(line);
    }
    const audit = $('#admin-audit');
    audit.replaceChildren();
    if (!data.audit.length) audit.textContent = 'Nenhuma ação ainda';
    for (const action of data.audit) {
      const row = document.createElement('p');
      row.textContent = (action.actor || 'Admin') + ' • ' + action.action + ' • ' + action.created_at;
      audit.appendChild(row);
    }
    const activeId = state.activeServerId;
    if (activeId === serverId) {
      try {
        const result = await api('/servers/' + serverId + '/members');
        state.members = result.members;
        renderMembers();
        renderChannelSidebar();
      } catch {}
    }
  }
  async function openAdmin() {
    if (!state.activeServerId || !canModerateCurrentServer()) return;
    state.currentAdminServerId = state.activeServerId;
    $('#admin-panel').classList.remove('hidden');
    closeMobilePanels();
    $('#admin-close').focus();
    try { await refreshAdmin(); }
    catch(err) { closeAdmin(); toast(err.message); }
  }
  $('#admin-rename-form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const serverId = state.currentAdminServerId;
    if (!serverId) return;
    try {
      await api('/admin/' + serverId, {
        method:'PATCH',body:JSON.stringify({name:$('#admin-server-name').value})
      });
      await loadServers();
      if (state.activeServerId === serverId) {
        const server = state.servers.find(x => x.id === serverId);
        $('#sidebar-title').textContent = server?.name || 'Servidor';
      }
      await refreshAdmin();
      toast('Nome atualizado!');
    } catch(err) { toast(err.message); }
  });

  // ---------- Mobile navigation and modal panels ----------
  const navButton = $('#btn-toggle-sidebar');
  const membersButton = $('#btn-toggle-members');
  const overlay = $('#mobile-backdrop');
  function syncMobilePanels() {
    const app = $('#app');
    const navOpen = app.classList.contains('nav-open');
    const membersOpen = app.classList.contains('members-open');
    const mobile = window.matchMedia('(max-width: 900px)').matches;
    overlay.hidden = !mobile || !(navOpen || membersOpen);
    navButton.setAttribute('aria-expanded', String(mobile && navOpen));
    membersButton.setAttribute('aria-expanded', String(mobile && membersOpen));
    $('#sidebar').inert = mobile && !navOpen;
    $('#server-rail').inert = mobile && !navOpen;
    $('#members-panel').inert = mobile && !membersOpen;
  }
  function closeMobilePanels() {
    $('#app').classList.remove('nav-open', 'members-open');
    syncMobilePanels();
  }
  function openMobilePanel(kind) {
    const app = $('#app');
    const className = kind === 'nav' ? 'nav-open' : 'members-open';
    const wasOpen = app.classList.contains(className);
    app.classList.remove('nav-open', 'members-open');
    if (!wasOpen) app.classList.add(className);
    syncMobilePanels();
    if (!wasOpen) {
      (kind === 'nav' ? $('#btn-close-sidebar') : $('#btn-close-members')).focus();
    }
  }
  navButton.addEventListener('click', () => openMobilePanel('nav'));
  membersButton.addEventListener('click', () => openMobilePanel('members'));
  $('#btn-close-sidebar').addEventListener('click', closeMobilePanels);
  $('#btn-close-members').addEventListener('click', closeMobilePanels);
  overlay.addEventListener('click', closeMobilePanels);
  $('#home-open-nav').addEventListener('click', () => openMobilePanel('nav'));
  $('#home-open-voice').addEventListener('click', async () => {
    const server = state.servers.find(s => /stunt\s*games/i.test(s.name)) || state.servers[0];
    if (!server) return toast('Entre ou crie um servidor para abrir a chamada');
    try {
      await openServer(server.id);
      const voice = state.channels.find(ch => ch.type === 'voice');
      if (!voice) return toast('Este servidor ainda não tem sala de voz');
      await openVoiceChannel(voice.id);
    } catch (err) { toast(err.message); }
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeMobilePanels();
      closeAdmin();
      closeMediaLightbox();
    }
  });
  window.addEventListener('resize', syncMobilePanels);
  syncMobilePanels();

  // ---------- Init ----------
  async function init() {
    try {
      const data = await api('/auth/me');
      state.user = data.user;
      await bootApp();
    } catch {
      localStorage.removeItem('baf_token');
      state.token = null;
      state.user = null;
    }
  }

  init();
})();
