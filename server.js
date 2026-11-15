require('dotenv').config();
const path = require('path');
const http = require('http');
const express = require('express');
const cookieParser = require('cookie-parser');
const { Server } = require('socket.io');

const { init } = require('./src/db');
const { createAuthRouter } = require('./src/routes/auth');
const { createSsoRouter } = require('./src/routes/sso');
const { createServersRouter } = require('./src/routes/servers');
const { createFriendsRouter } = require('./src/routes/friends');
const { createDmsRouter } = require('./src/routes/dms');
const { createAdminRouter } = require('./src/routes/admin');
const { createMediaRouter } = require('./src/routes/media');
const { createMessagesRouter } = require('./src/routes/messages');
const mediaStorage = require('./src/media/s3');
const { setupSocket } = require('./src/socket');

const PORT = process.env.PORT || 3000;

async function main() {
  const db = await init();

  const app = express();
  const server = http.createServer(app);
  const trustedOrigins = new Set(['https://chat.bairroanimefire.com', 'https://chat.bairroanimefire.com.br']);
  const io = new Server(server, {
    cors: { origin: [...trustedOrigins], credentials: true },
    allowRequest: (request, callback) => {
      const origin = request.headers.origin;
      callback(null, !origin || trustedOrigins.has(origin));
    },
    maxHttpBufferSize: 100000,
  });

  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  // Restrict executable scripts to our own origin; external media is allowed
  // only from the configured private S3 endpoint. No inline JavaScript.
  const mediaOrigin = mediaStorage.config()?.endpoint?.origin || '';
  const allowedMedia = mediaOrigin ? ' ' + mediaOrigin : '';
  const contentSecurityPolicy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:" + allowedMedia,
    "media-src 'self' blob:" + allowedMedia,
    "connect-src 'self' https: wss: stun: turn: turns:",
    "font-src 'self' data:",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  app.use((req, res, next) => {
    if (req.headers.origin && !trustedOrigins.has(req.headers.origin)) {
      return res.status(403).json({ error: 'Origem não autorizada' });
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', contentSecurityPolicy);
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=()');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    if (req.path.startsWith('/api') || req.path.startsWith('/auth')) {
      res.setHeader('Cache-Control', 'private, no-store');
    }
    next();
  });
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  // SSO before static/SPA so /auth/sso/* is never swallowed
  app.use('/auth/sso', createSsoRouter(db));

  app.use(express.static(path.join(__dirname, 'public')));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, brand: 'Bairro Anime Fire', time: new Date().toISOString() });
  });

  app.use('/api/auth', createAuthRouter(db));
  app.use('/api/servers', createServersRouter(db));
  app.use('/api/friends', createFriendsRouter(db));
  app.use('/api/dms', createDmsRouter(db));
  app.use('/api/admin', createAdminRouter(db, io));
  app.use('/api/media', createMediaRouter(db));
  app.use('/api/messages', createMessagesRouter(db, io));

  setupSocket(io, db);

  // Clean unfinished private S3 uploads after 24h. Already-sent messages
  // are never touched. Limited batches keep maintenance cheap.
  async function cleanPendingMedia() {
    if (!mediaStorage.config()) return;
    const orphaned = db.all("SELECT id,s3_key FROM media_uploads WHERE status='pending' AND created_at<datetime('now','-24 hours') LIMIT 30");
    for (const item of orphaned) {
      try {
        await mediaStorage.remove(item.s3_key);
        db.run('DELETE FROM media_uploads WHERE id=? AND status=?',[item.id,'pending']);
      } catch (err) { console.warn('media cleanup:',err.message); }
    }
  }
  cleanPendingMedia().catch(err => console.warn('media cleanup:',err.message));
  const cleanupTimer = setInterval(() => cleanPendingMedia().catch(() => {}), 6 * 3600000);
  cleanupTimer.unref();

  // SPA fallback (Express 5)
  app.get('/{*path}', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io') || req.path.startsWith('/auth/sso')) {
      return next();
    }
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
