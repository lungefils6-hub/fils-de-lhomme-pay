import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import SQLiteStoreFactory from 'better-sqlite3';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

if (isProduction && (!process.env.SESSION_SECRET || !process.env.BASE_URL?.startsWith('https://'))) {
  throw new Error('En production, SESSION_SECRET et BASE_URL HTTPS sont obligatoires.');
}

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 150, standardHeaders: true, legacyHeaders: false }));

const db = new SQLiteStoreFactory(path.join(__dirname, 'app.sqlite'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, email TEXT UNIQUE, display_name TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS social_accounts (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, provider TEXT NOT NULL,
 provider_user_id TEXT, connected_at TEXT NOT NULL, UNIQUE(user_id, provider)
);
CREATE TABLE IF NOT EXISTS content_stats (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, provider TEXT NOT NULL,
 provider_content_id TEXT, views INTEGER DEFAULT 0, likes INTEGER DEFAULT 0,
 comments INTEGER DEFAULT 0, checked_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payout_requests (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, amount REAL NOT NULL,
 currency TEXT NOT NULL DEFAULT 'USD', method TEXT NOT NULL, phone TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending_review', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ledger (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, amount REAL NOT NULL,
 currency TEXT NOT NULL DEFAULT 'USD', reason TEXT NOT NULL, source_ref TEXT,
 created_at TEXT NOT NULL
);
`);

app.use(session({
  name: 'fhpay.sid',
  secret: process.env.SESSION_SECRET || 'dev-only-change-me-before-publishing',
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: isProduction, maxAge: 1000 * 60 * 60 * 8 }
}));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20 });
function requireUser(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Connecte-toi pour continuer.' });
  next();
}
function currentUser(req) {
  return db.prepare('SELECT id,email,display_name,created_at FROM users WHERE id=?').get(req.session.userId);
}

app.use(express.static(path.join(__dirname, 'public')));
app.get('/api/health', (_req, res) => res.json({ ok: true, mode: isProduction ? 'production' : 'development' }));

// Démo de création de session uniquement : à remplacer par une inscription/méthode d'identité vérifiée avant ouverture publique.
app.post('/api/demo-session', authLimiter, (req, res) => {
  if (isProduction) return res.status(404).json({ error: 'Route de démonstration désactivée.' });
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Adresse e-mail invalide.' });
  let user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!user) {
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO users(id,email,display_name,created_at) VALUES(?,?,?,?)')
      .run(id, email, email.split('@')[0], new Date().toISOString());
    user = { id };
  }
  req.session.userId = user.id;
  res.json({ ok: true, message: 'Session de test créée. Ce n’est pas une inscription de production.' });
});

app.get('/api/me', requireUser, (req, res) => {
  const user = currentUser(req);
  const balance = db.prepare("SELECT COALESCE(SUM(amount),0) AS total FROM ledger WHERE user_id=?").get(user.id).total;
  const socials = db.prepare('SELECT provider,connected_at FROM social_accounts WHERE user_id=?').all(user.id);
  res.json({ user, balance, socials, demo: !isProduction });
});
app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));

app.get('/api/payouts', requireUser, (req, res) => {
  res.json(db.prepare('SELECT id,amount,currency,method,phone,status,created_at FROM payout_requests WHERE user_id=? ORDER BY created_at DESC').all(req.session.userId));
});
app.post('/api/payouts', requireUser, (req, res) => {
  const amount = Number(req.body.amount);
  const method = String(req.body.method || '').trim();
  const phone = String(req.body.phone || '').trim();
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1000) return res.status(400).json({ error: 'Montant invalide.' });
  if (!['Airtel Money','Orange Money','M-Pesa','Autre Mobile Money'].includes(method)) return res.status(400).json({ error: 'Moyen de retrait invalide.' });
  if (!/^[+0-9 ()-]{7,25}$/.test(phone)) return res.status(400).json({ error: 'Numéro de téléphone invalide.' });
  const balance = db.prepare('SELECT COALESCE(SUM(amount),0) AS total FROM ledger WHERE user_id=?').get(req.session.userId).total;
  const pending = db.prepare("SELECT COALESCE(SUM(amount),0) AS total FROM payout_requests WHERE user_id=? AND status IN ('pending_review','approved','processing')").get(req.session.userId).total;
  if (amount > balance - pending) return res.status(400).json({ error: 'Solde disponible insuffisant. Aucun dépôt ne peut être effectué.' });
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO payout_requests(id,user_id,amount,method,phone,status,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(id, req.session.userId, amount, method, phone, 'pending_review', new Date().toISOString());
  res.status(201).json({ ok: true, id, status: 'pending_review', message: 'Demande enregistrée pour vérification. Aucun transfert réel n’a été envoyé.' });
});

// OAuth endpoints intentionally fail closed until official apps, scopes and callback URLs are configured.
app.get('/auth/facebook', (_req, res) => {
  if (!process.env.META_APP_ID || !process.env.META_APP_SECRET || !process.env.META_REDIRECT_URI) {
    return res.status(503).send('Connexion Facebook non configurée : les identifiants développeur Meta et l’URL HTTPS de retour sont requis.');
  }
  const state = crypto.randomBytes(24).toString('hex');
  // Store state in session to prevent CSRF; finish setup using the exact permissions approved by Meta.
  _req.session.fbOAuthState = state;
  const url = new URL('https://www.facebook.com/v21.0/dialog/oauth');
  url.searchParams.set('client_id', process.env.META_APP_ID);
  url.searchParams.set('redirect_uri', process.env.META_REDIRECT_URI);
  url.searchParams.set('state', state);
  url.searchParams.set('scope', 'public_profile,email');
  res.redirect(url.toString());
});
app.get('/auth/facebook/callback', (req, res) => {
  if (!req.query.code || !req.query.state || req.query.state !== req.session.fbOAuthState) return res.status(400).send('Retour Facebook invalide. Réessaie la connexion.');
  // TODO: échanger code côté serveur, vérifier le jeton et l’identité via les endpoints officiels Meta,
  // demander seulement les permissions approuvées, puis enregistrer l'identifiant social.
  res.status(501).send('Facebook a retourné un code, mais l’échange sécurisé du jeton doit être configuré et testé avant activation.');
});

app.get('/auth/tiktok', (req, res) => {
  if (!process.env.TIKTOK_CLIENT_KEY || !process.env.TIKTOK_CLIENT_SECRET || !process.env.TIKTOK_REDIRECT_URI) {
    return res.status(503).send('Connexion TikTok non configurée : les identifiants développeur TikTok et l’URL HTTPS de retour sont requis.');
  }
  const state = crypto.randomBytes(24).toString('hex');
  req.session.ttOAuthState = state;
  const url = new URL('https://www.tiktok.com/v2/auth/authorize/');
  url.searchParams.set('client_key', process.env.TIKTOK_CLIENT_KEY);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'user.info.basic,video.list');
  url.searchParams.set('redirect_uri', process.env.TIKTOK_REDIRECT_URI);
  url.searchParams.set('state', state);
  res.redirect(url.toString());
});
app.get('/auth/tiktok/callback', (req, res) => {
  if (!req.query.code || !req.query.state || req.query.state !== req.session.ttOAuthState) return res.status(400).send('Retour TikTok invalide. Réessaie la connexion.');
  // TODO: échanger le code côté serveur, vérifier les permissions accordées et enregistrer l'identifiant social.
  res.status(501).send('TikTok a retourné un code, mais l’échange sécurisé du jeton doit être configuré et testé avant activation.');
});

// Créditer un solde depuis une action serveur vérifiée seulement. Ne jamais exposer une route publique de crédit.
app.post('/api/internal/credit', (_req, res) => res.status(404).json({ error: 'Fonction interne non exposée. Les récompenses nécessitent une source de financement et une validation anti-fraude.' }));

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(port, () => console.log(`Fils de l’Homme Pay écoute sur le port ${port}`));
