// Plant Swap — a tiny zero-dependency Node.js server.
// Run with: node server.js  (then open http://localhost:PORT)
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const ROOT = __dirname;
const CONFIG_PATH = path.join(ROOT, 'config.json');

// Everything that needs to survive a restart/redeploy lives under DATA_DIR.
// Locally this defaults to ./data. On a host with a persistent disk (Render,
// Railway, Fly, etc.), set DATA_DIR to the disk's mount path via an env var
// so listings, photos, and push subscriptions aren't wiped on every deploy.
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const DATA_PATH = path.join(DATA_DIR, 'plants.json');
const VAPID_PATH = path.join(DATA_DIR, 'vapid-keys.json');
const SUBSCRIPTIONS_PATH = path.join(DATA_DIR, 'push-subscriptions.json');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const PUBLIC_DIR = path.join(ROOT, 'public');

// Make sure the data directory (and uploads subfolder) exist before anything
// tries to read/write into them — matters most on a fresh deploy where a
// freshly-mounted persistent disk may start out empty.
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const MAX_BODY_BYTES = 12 * 1024 * 1024; // 12MB, generous enough for a couple of photos

// How a listing is being offered. Shown as a filter + badge on the public page.
const FORM_TYPES = ['fresh_prop', 'bare_root', 'in_soil'];

// Config resolves in this order: environment variables (what you set on your
// host's dashboard) > config.json (handy for local dev, gitignored since it
// can hold your admin password) > safe built-in defaults. Nothing secret is
// ever required to be committed to the repo.
function loadConfig() {
  let fileConfig = {};
  try {
    fileConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (e) {
    // No config.json — fine, env vars/defaults cover it (this is the normal
    // case in production, where secrets are set via the host's dashboard).
  }
  return {
    port: parseInt(process.env.PORT, 10) || fileConfig.port || 3000,
    adminUser: process.env.ADMIN_USER || fileConfig.adminUser || 'admin',
    adminPassword: process.env.ADMIN_PASSWORD || fileConfig.adminPassword || 'plants123',
    siteName: process.env.SITE_NAME || fileConfig.siteName || 'Plant Swap',
    vapidSubject: process.env.VAPID_SUBJECT || fileConfig.vapidSubject || 'mailto:admin@example.com'
  };
}

function loadPlants() {
  try {
    const plants = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
    // Defensive defaults in case of older/hand-edited data.
    return plants.map((p) => ({
      claims: [],
      quantity: 1,
      form: 'in_soil',
      ...p
    }));
  } catch (e) {
    return [];
  }
}

function savePlants(plants) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(plants, null, 2));
}

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function notFound(res) {
  sendJSON(res, 404, { error: 'Not found' });
}

function isAdminRequest(req) {
  const config = loadConfig();
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const idx = decoded.indexOf(':');
  const user = decoded.slice(0, idx);
  const pass = decoded.slice(idx + 1);
  return user === config.adminUser && pass === config.adminPassword;
}

function requireAdmin(req, res) {
  if (isAdminRequest(req)) return true;
  res.writeHead(401, {
    'WWW-Authenticate': 'Basic realm="Plant Swap Admin"',
    'Content-Type': 'application/json'
  });
  res.end(JSON.stringify({ error: 'Admin login required' }));
  return false;
}

function readBody(req, callback) {
  let chunks = [];
  let total = 0;
  let tooBig = false;
  req.on('data', (chunk) => {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      tooBig = true;
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (tooBig) return callback(new Error('Body too large'));
    const raw = Buffer.concat(chunks).toString('utf8');
    if (!raw) return callback(null, {});
    try {
      callback(null, JSON.parse(raw));
    } catch (e) {
      callback(new Error('Invalid JSON'));
    }
  });
  req.on('error', (err) => callback(err));
}

// Units still reserved: any claim that's pending confirmation or already confirmed
// (i.e. spoken for) counts against the total. Rejected claims are removed outright.
function reservedQty(plant) {
  return (plant.claims || [])
    .filter((c) => c.status === 'requested' || c.status === 'confirmed')
    .reduce((sum, c) => sum + c.qty, 0);
}

function remainingQty(plant) {
  return Math.max(0, (plant.quantity || 0) - reservedQty(plant));
}

function withComputed(plant) {
  return { ...plant, remaining: remainingQty(plant) };
}

// Strip requester contact info for public (non-admin) viewers — they only need
// to know how many units are still open, not who else has asked.
function publicView(plant) {
  const { claims, ...rest } = withComputed(plant);
  return rest;
}

function saveDataUrlImage(dataUrl, plantId) {
  const match = /^data:(image\/(png|jpeg|jpg|webp|gif));base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  const ext = match[2] === 'jpeg' ? 'jpg' : match[2];
  const buffer = Buffer.from(match[3], 'base64');
  if (buffer.length > 8 * 1024 * 1024) return null; // 8MB per-photo cap
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const filename = `${plantId}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), buffer);
  return `/uploads/${filename}`;
}

// ============================================================================
// Web Push — real push notifications, delivered even when the browser tab
// (or the whole browser) is closed. Implements RFC 8291 (aes128gcm message
// encryption) and RFC 8292 (VAPID) directly with Node's built-in crypto —
// no external push library needed, since this project has none installed.
// ============================================================================

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}

// The VAPID key pair identifies this server to push services (FCM, Mozilla's
// push relay, etc.) and must stay stable across restarts, or every existing
// subscription breaks. Generated once, then persisted to data/vapid-keys.json.
let _vapidKeys = null;
function loadOrCreateVapidKeys() {
  if (_vapidKeys) return _vapidKeys;
  try {
    const saved = JSON.parse(fs.readFileSync(VAPID_PATH, 'utf8'));
    _vapidKeys = {
      privateKey: crypto.createPrivateKey(saved.privateKeyPem),
      publicKeyRaw: base64UrlDecode(saved.publicKeyRawBase64url),
      publicKeyRawBase64url: saved.publicKeyRawBase64url
    };
  } catch (e) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = publicKey.export({ format: 'jwk' });
    const publicKeyRaw = Buffer.concat([Buffer.from([0x04]), base64UrlDecode(jwk.x), base64UrlDecode(jwk.y)]);
    const publicKeyRawBase64url = base64url(publicKeyRaw);
    fs.writeFileSync(VAPID_PATH, JSON.stringify({
      privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
      publicKeyRawBase64url
    }, null, 2));
    _vapidKeys = { privateKey, publicKeyRaw, publicKeyRawBase64url };
  }
  return _vapidKeys;
}

function loadSubscriptions() {
  try {
    return JSON.parse(fs.readFileSync(SUBSCRIPTIONS_PATH, 'utf8'));
  } catch (e) {
    return [];
  }
}

function saveSubscriptions(subs) {
  fs.writeFileSync(SUBSCRIPTIONS_PATH, JSON.stringify(subs, null, 2));
}

// RFC 8291: encrypt a JSON payload for a single subscriber using their
// p256dh (EC public key) and auth secret. Verified against an independent
// decrypt implementation in test-webpush-crypto.js before this went live.
function encryptPushPayload(plaintextBuffer, p256dhB64url, authB64url) {
  const uaPublic = base64UrlDecode(p256dhB64url);
  const authSecret = base64UrlDecode(authB64url);

  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const sharedSecret = ecdh.computeSecret(uaPublic);

  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0', 'utf8'), uaPublic, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', sharedSecret, authSecret, keyInfo, 32));

  const salt = crypto.randomBytes(16);
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0', 'utf8'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0', 'utf8'), 12));

  const padded = Buffer.concat([plaintextBuffer, Buffer.from([0x02])]); // 0x02 = final/only record
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(padded), cipher.final(), cipher.getAuthTag()]);

  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096, 0);
  const header = Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic]);
  return Buffer.concat([header, ciphertext]);
}

// RFC 8292: a short-lived JWT (ES256, raw r||s signature) proving to the push
// service that we own the VAPID key pair the subscription was created with.
function buildVapidAuthHeader(endpointUrl) {
  const { privateKey, publicKeyRawBase64url } = loadOrCreateVapidKeys();
  const config = loadConfig();
  const aud = `${endpointUrl.protocol}//${endpointUrl.host}`;
  const header = base64url(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = base64url(Buffer.from(JSON.stringify({
    aud,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: config.vapidSubject || 'mailto:admin@example.com'
  })));
  const signingInput = `${header}.${payload}`;
  const signature = crypto.createSign('SHA256').update(signingInput).sign({ key: privateKey, dsaEncoding: 'ieee-p1363' });
  const jwt = `${signingInput}.${base64url(signature)}`;
  return `vapid t=${jwt}, k=${publicKeyRawBase64url}`;
}

// Sends one push message. Resolves { ok, statusCode, gone } — `gone` means
// the push service says this subscription is dead (404/410) and should be
// dropped from storage.
function sendWebPush(subscription, payloadObj) {
  return new Promise((resolve) => {
    let encrypted, authHeader, endpointUrl;
    try {
      endpointUrl = new URL(subscription.endpoint);
      encrypted = encryptPushPayload(
        Buffer.from(JSON.stringify(payloadObj), 'utf8'),
        subscription.keys.p256dh,
        subscription.keys.auth
      );
      authHeader = buildVapidAuthHeader(endpointUrl);
    } catch (e) {
      return resolve({ ok: false, error: e.message });
    }

    const req = https.request(subscription.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Encoding': 'aes128gcm',
        'Content-Length': encrypted.length,
        TTL: '86400',
        Authorization: authHeader
      }
    }, (res) => {
      res.on('data', () => {}); // drain
      res.on('end', () => {
        const gone = res.statusCode === 404 || res.statusCode === 410;
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, statusCode: res.statusCode, gone });
      });
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.write(encrypted);
    req.end();
  });
}

// Fire-and-forget: notify every subscribed admin device, pruning any
// subscription the push service reports as gone. Never blocks the caller.
function notifyAdmins(payloadObj) {
  const subs = loadSubscriptions();
  if (!subs.length) return;
  Promise.all(subs.map((sub) => sendWebPush(sub, payloadObj).then((result) => ({ sub, result }))))
    .then((results) => {
      const stillValid = subs.filter((sub) => {
        const r = results.find((x) => x.sub.endpoint === sub.endpoint);
        return !(r && r.result.gone);
      });
      if (stillValid.length !== subs.length) saveSubscriptions(stillValid);
    })
    .catch(() => {});
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8'
};

function serveStatic(req, res, urlPath, baseDir, stripPrefix) {
  baseDir = baseDir || PUBLIC_DIR;
  let filePath = urlPath === '/' ? '/index.html' : urlPath;
  if (stripPrefix) filePath = filePath.slice(stripPrefix.length);
  filePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
  const fullPath = path.join(baseDir, filePath);
  if (!fullPath.startsWith(baseDir)) return notFound(res);

  fs.readFile(fullPath, (err, content) => {
    if (err) return notFound(res);
    const ext = path.extname(fullPath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const method = req.method;

  // --- Admin page is gated behind Basic Auth right at the HTML level ---
  if (pathname === '/admin.html') {
    if (!requireAdmin(req, res)) return;
    return serveStatic(req, res, '/admin.html');
  }

  // --- API routes ---
  if (pathname === '/api/session' && method === 'GET') {
    return sendJSON(res, 200, { isAdmin: isAdminRequest(req) });
  }

  if (pathname === '/api/plants' && method === 'GET') {
    const plants = loadPlants().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const admin = isAdminRequest(req);
    return sendJSON(res, 200, admin ? plants.map(withComputed) : plants.map(publicView));
  }

  if (pathname === '/api/plants' && method === 'POST') {
    if (!requireAdmin(req, res)) return;
    return readBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { error: err.message });
      if (!body.name || !String(body.name).trim()) {
        return sendJSON(res, 400, { error: 'Plant name/type is required' });
      }
      if (!FORM_TYPES.includes(body.form)) {
        return sendJSON(res, 400, { error: 'Form must be one of: ' + FORM_TYPES.join(', ') });
      }
      const quantity = Math.max(1, parseInt(body.quantity, 10) || 1);
      const id = crypto.randomBytes(6).toString('hex');
      let photo = null;
      if (body.photoDataUrl) {
        photo = saveDataUrlImage(body.photoDataUrl, id);
        if (photo === null) {
          return sendJSON(res, 400, { error: 'Photo must be a PNG/JPEG/WEBP/GIF under 8MB' });
        }
      }
      const plant = {
        id,
        name: String(body.name).trim(),
        form: body.form,
        quantity,
        notes: body.notes ? String(body.notes).trim() : '',
        photo,
        claims: [],
        createdAt: new Date().toISOString()
      };
      const plants = loadPlants();
      plants.push(plant);
      savePlants(plants);
      return sendJSON(res, 201, withComputed(plant));
    });
  }

  // /api/plants/:id/claims/:claimId/(confirm|reject)  — admin only
  const claimActionMatch = pathname.match(/^\/api\/plants\/([a-f0-9]+)\/claims\/([a-f0-9]+)\/(confirm|reject)$/);
  if (claimActionMatch && method === 'POST') {
    if (!requireAdmin(req, res)) return;
    const [, id, claimId, action] = claimActionMatch;
    const plants = loadPlants();
    const plant = plants.find((p) => p.id === id);
    if (!plant) return notFound(res);
    const claim = plant.claims.find((c) => c.id === claimId);
    if (!claim) return notFound(res);

    if (action === 'confirm') {
      claim.status = 'confirmed';
    } else {
      plant.claims = plant.claims.filter((c) => c.id !== claimId);
    }
    savePlants(plants);
    return sendJSON(res, 200, withComputed(plant));
  }

  // /api/plants/:id and /api/plants/:id/claim
  const plantIdMatch = pathname.match(/^\/api\/plants\/([a-f0-9]+)(\/claim)?$/);
  if (plantIdMatch) {
    const id = plantIdMatch[1];
    const isClaim = !!plantIdMatch[2];
    const plants = loadPlants();
    const idx = plants.findIndex((p) => p.id === id);

    if (idx === -1) return notFound(res);

    // Public: submit a claim request for N units of this specific listing.
    if (isClaim && method === 'POST') {
      return readBody(req, (err, body) => {
        if (err) return sendJSON(res, 400, { error: err.message });
        if (!body.name || !body.contact) {
          return sendJSON(res, 400, { error: 'Name and a way to reach you are required' });
        }
        const plant = plants[idx];
        const qty = Math.max(1, parseInt(body.qty, 10) || 1);
        const available = remainingQty(plant);
        if (available <= 0) {
          return sendJSON(res, 409, { error: 'This listing is fully claimed' });
        }
        if (qty > available) {
          return sendJSON(res, 409, { error: `Only ${available} left on this listing` });
        }
        const claim = {
          id: crypto.randomBytes(6).toString('hex'),
          name: String(body.name).trim(),
          contact: String(body.contact).trim(),
          message: body.message ? String(body.message).trim() : '',
          qty,
          status: 'requested',
          requestedAt: new Date().toISOString()
        };
        plant.claims.push(claim);
        savePlants(plants);
        notifyAdmins({
          title: 'New claim on Plant Swap',
          body: `${claim.name} wants ${claim.qty} × ${plant.name}`,
          url: '/admin.html'
        });
        return sendJSON(res, 200, publicView(plant));
      });
    }

    // Admin: edit a plant's fields
    if (!isClaim && method === 'PATCH') {
      if (!requireAdmin(req, res)) return;
      return readBody(req, (err, body) => {
        if (err) return sendJSON(res, 400, { error: err.message });
        const p = plants[idx];
        if (body.name !== undefined) p.name = String(body.name).trim();
        if (body.notes !== undefined) p.notes = String(body.notes).trim();
        if (body.form !== undefined) {
          if (!FORM_TYPES.includes(body.form)) {
            return sendJSON(res, 400, { error: 'Form must be one of: ' + FORM_TYPES.join(', ') });
          }
          p.form = body.form;
        }
        if (body.quantity !== undefined) {
          const newQty = Math.max(1, parseInt(body.quantity, 10) || 1);
          if (newQty < reservedQty(p)) {
            return sendJSON(res, 400, { error: `Can't set quantity below ${reservedQty(p)} already spoken for` });
          }
          p.quantity = newQty;
        }
        if (body.photoDataUrl) {
          const photo = saveDataUrlImage(body.photoDataUrl, p.id);
          if (photo) p.photo = photo;
        }
        savePlants(plants);
        return sendJSON(res, 200, withComputed(p));
      });
    }

    // Admin: delete a plant
    if (!isClaim && method === 'DELETE') {
      if (!requireAdmin(req, res)) return;
      const [removed] = plants.splice(idx, 1);
      if (removed && removed.photo) {
        // removed.photo is a URL path like "/uploads/xyz.png" — strip the
        // leading "/uploads/" to get the filename within UPLOADS_DIR.
        const filePath = path.join(UPLOADS_DIR, removed.photo.replace(/^\/uploads\//, ''));
        fs.unlink(filePath, () => {});
      }
      savePlants(plants);
      return sendJSON(res, 200, { ok: true });
    }
  }

  if (pathname === '/api/config' && method === 'GET') {
    const config = loadConfig();
    return sendJSON(res, 200, { siteName: config.siteName, formTypes: FORM_TYPES });
  }

  // Public key browsers need to create a push subscription. Not secret —
  // VAPID public keys are meant to be shared, same idea as any public key.
  if (pathname === '/api/push/vapid-public-key' && method === 'GET') {
    const { publicKeyRawBase64url } = loadOrCreateVapidKeys();
    return sendJSON(res, 200, { publicKey: publicKeyRawBase64url });
  }

  if (pathname === '/api/push/subscribe' && method === 'POST') {
    if (!requireAdmin(req, res)) return;
    return readBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { error: err.message });
      if (!body.endpoint || !body.keys || !body.keys.p256dh || !body.keys.auth) {
        return sendJSON(res, 400, { error: 'Invalid subscription' });
      }
      const subs = loadSubscriptions().filter((s) => s.endpoint !== body.endpoint);
      subs.push({ endpoint: body.endpoint, keys: body.keys, createdAt: new Date().toISOString() });
      saveSubscriptions(subs);
      return sendJSON(res, 200, { ok: true });
    });
  }

  if (pathname === '/api/push/unsubscribe' && method === 'POST') {
    if (!requireAdmin(req, res)) return;
    return readBody(req, (err, body) => {
      if (err) return sendJSON(res, 400, { error: err.message });
      const subs = loadSubscriptions().filter((s) => s.endpoint !== body.endpoint);
      saveSubscriptions(subs);
      return sendJSON(res, 200, { ok: true });
    });
  }

  if (pathname === '/api/push/test' && method === 'POST') {
    if (!requireAdmin(req, res)) return;
    notifyAdmins({ title: 'Plant Swap', body: 'Test notification — push is working!', url: '/admin.html' });
    return sendJSON(res, 200, { ok: true });
  }

  if (pathname.startsWith('/api/')) return notFound(res);

  // Built dynamically so it always reflects config.json's siteName —
  // this is what makes the site installable ("Add to Home Screen").
  if (pathname === '/manifest.json' && method === 'GET') {
    const config = loadConfig();
    const manifest = {
      name: config.siteName || 'Plant Swap',
      short_name: 'Plant Swap',
      description: 'Share plants, cuttings, and green stuff available to swap or take for free.',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#faf9f5',
      theme_color: '#3d4630',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
      ]
    };
    const body = JSON.stringify(manifest);
    res.writeHead(200, {
      'Content-Type': 'application/manifest+json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body)
    });
    return res.end(body);
  }

  // Uploaded photos live under DATA_DIR (persistent disk in production),
  // separate from the app's own static files under public/.
  if (pathname.startsWith('/uploads/')) {
    return serveStatic(req, res, pathname, UPLOADS_DIR, '/uploads');
  }

  // --- Static files ---
  return serveStatic(req, res, pathname);
});

const config = loadConfig();
server.listen(config.port, () => {
  console.log(`Plant Swap running at http://localhost:${config.port}`);
  console.log(`Admin page: http://localhost:${config.port}/admin.html`);
  console.log(`  (admin user: ${config.adminUser} — change the password in config.json!)`);
});
