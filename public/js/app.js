(() => {
  'use strict';

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

  const state = {
    token: localStorage.getItem('baf_token') || null,
    user: null,
    socket: null,
    servers: [],
    channels: [],
    members: [],
    friends: [],
    pending: [],
    dms: [],
    online: new Set(),
    view: 'home', // home | channel | dm
    activeServerId: null,
    activeChannelId: null,
    activeDmId: null,
    typingTimer: null,
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
    if (state.socket) { state.socket.disconnect(); state.socket = null; }
    $('#app').classList.add('hidden');
    $('#auth-screen').classList.remove('hidden');
  });

  // ---------- Socket ----------
  function connectSocket() {
    if (state.socket) state.socket.disconnect();
    state.socket = io({
      auth: { token: state.token },
      withCredentials: true,
      transports: ['websocket', 'polling'],
    });

    state.socket.on('connect', () => {
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
        appendMessage(msg);
      }
    });

    state.socket.on('dm:new', (msg) => {
      if (state.view === 'dm' && msg.dm_channel_id === state.activeDmId) {
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

    state.socket.on('connect_error', (err) => {
      console.warn('socket', err.message);
    });
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
      btn.textContent = s.icon_emoji || s.name.slice(0, 1);
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

  $('#btn-add-server').addEventListener('click', async () => {
    const name = prompt('Nome do novo servidor:');
    if (!name || !name.trim()) return;
    try {
      await api('/servers', { method: 'POST', body: JSON.stringify({ name: name.trim() }) });
      await loadServers();
      toast('Servidor criado!');
    } catch (err) {
      toast(err.message);
    }
  });

  async function openServer(serverId) {
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

    if (channels.length) {
      await openChannel(channels[0].id);
    }
    closeMobilePanels();
  }

  function renderChannelSidebar() {
    const body = $('#sidebar-body');
    body.innerHTML = '';

    const section = document.createElement('div');
    section.className = 'nav-section';
    section.innerHTML = `<div class="nav-section-title">Canais de texto</div>`;
    for (const ch of state.channels) {
      const btn = document.createElement('button');
      btn.className = 'nav-item' + (ch.id === state.activeChannelId ? ' active' : '');
      btn.innerHTML = `<span class="hash">#</span> ${escapeHtml(ch.name)}`;
      btn.addEventListener('click', () => openChannel(ch.id));
      section.appendChild(btn);
    }
    body.appendChild(section);

    // DMs quick list
    if (state.dms.length) {
      const dmSec = document.createElement('div');
      dmSec.className = 'nav-section';
      dmSec.innerHTML = `<div class="nav-section-title">Mensagens diretas</div>`;
      for (const dm of state.dms) {
        const btn = document.createElement('button');
        btn.className = 'nav-item' + (dm.id === state.activeDmId ? ' active' : '');
        const online = state.online.has(dm.peer_id);
        btn.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:${online ? 'var(--online)' : 'var(--offline)'}"></span> ${escapeHtml(dm.peer_display_name || dm.peer_username)}`;
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
      li.addEventListener('dblclick', () => startDmWith(m.id));
      list.appendChild(li);
    }
  }

  async function openChannel(channelId) {
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

    const { messages } = await api(`/servers/channels/${channelId}/messages?limit=80`);
    renderMessages(messages);
    closeMobilePanels();
  }

  async function openDm(dmId, meta) {
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

    const { messages } = await api(`/dms/${dmId}/messages?limit=80`);
    renderMessages(messages);
    closeMobilePanels();
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
    state.view = 'home';
    state.activeChannelId = null;
    state.activeDmId = null;
    state.activeServerId = null;
    $('#sidebar-title').textContent = 'Amigos';
    $('#home-view').classList.remove('hidden');
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
  function renderMessages(messages) {
    const box = $('#messages');
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
    box.scrollTop = box.scrollHeight;
  }

  function appendMessage(msg) {
    const box = $('#messages');
    const empty = box.querySelector('.empty-chat');
    if (empty) empty.remove();
    box.appendChild(buildMessageEl(msg));
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
    return el;
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ---------- Composer ----------
  $('#composer').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#composer-input');
    const content = input.value.trim();
    if (!content || !state.socket) return;

    if (state.view === 'channel' && state.activeChannelId) {
      state.socket.emit('message:send', { channelId: state.activeChannelId, content }, (ack) => {
        if (ack?.error) toast(ack.error);
      });
    } else if (state.view === 'dm' && state.activeDmId) {
      state.socket.emit('dm:send', { dmId: state.activeDmId, content }, (ack) => {
        if (ack?.error) toast(ack.error);
      });
    }
    input.value = '';
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

  // ---------- Mobile ----------
  $('#btn-toggle-sidebar').addEventListener('click', () => {
    $('#sidebar').classList.toggle('open');
    $('#members-panel').classList.remove('open');
  });
  $('#btn-toggle-members').addEventListener('click', () => {
    $('#members-panel').classList.toggle('open');
    $('#sidebar').classList.remove('open');
  });
  function closeMobilePanels() {
    $('#sidebar').classList.remove('open');
    $('#members-panel').classList.remove('open');
  }

  // ---------- Init ----------
  async function init() {
    try {
      const data = await api('/auth/me');
      state.user = data.user;
      if (data.token) {
        state.token = data.token;
        localStorage.setItem('baf_token', data.token);
      }
      await bootApp();
    } catch {
      localStorage.removeItem('baf_token');
      state.token = null;
      state.user = null;
    }
  }

  init();
})();
