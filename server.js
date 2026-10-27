require('dotenv').config();
const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { Server } = require('socket.io');

const { init } = require('./src/db');
const { createAuthRouter } = require('./src/routes/auth');
const { createServersRouter } = require('./src/routes/servers');
const { createFriendsRouter } = require('./src/routes/friends');
const { createDmsRouter } = require('./src/routes/dms');
const { setupSocket } = require('./src/socket');

const PORT = process.env.PORT || 3000;

async function main() {
  const db = await init();

  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: true, credentials: true },
  });

  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(express.static(path.join(__dirname, 'public')));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, brand: 'Bairro Anime Fire', time: new Date().toISOString() });
  });

  app.use('/api/auth', createAuthRouter(db));
  app.use('/api/servers', createServersRouter(db));
  app.use('/api/friends', createFriendsRouter(db));
  app.use('/api/dms', createDmsRouter(db));

  setupSocket(io, db);

  // SPA fallback (Express 5)
  app.get('/{*path}', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  server.listen(PORT, () => {
    console.log(`🔥 Bairro Anime Fire Chat rodando em http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error('Falha ao iniciar:', err);
  process.exit(1);
});
