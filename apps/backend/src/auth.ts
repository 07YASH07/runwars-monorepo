/**
 * Authentication & authorization for the StrideClash backend.
 *
 * - Backend JWTs (HS256, 30 days) are the single identity credential for both
 *   email/password and Google users. Identity is ALWAYS derived from the
 *   verified token, never from a client-supplied userId.
 * - Google sign-in: the mobile app sends its Firebase ID token once; the
 *   backend verifies it with Firebase Admin and issues a backend JWT.
 * - Firebase custom tokens: issued to authenticated users so email/password
 *   accounts also get a Firebase Auth session (uid === backend user id),
 *   which Storage security rules can enforce.
 * - Secrets: refuses the hard-coded defaults that are visible in the public
 *   repository.
 */
import crypto from 'crypto';
import type express from 'express';
import jwt from 'jsonwebtoken';
import * as admin from 'firebase-admin';

// ─── Secrets ──────────────────────────────────────────────────────────────────

const PUBLIC_DEFAULT_JWT_SECRETS = new Set(['super_secret_runwars_key_123', 'changeme', 'secret']);
const PUBLIC_DEFAULT_ADMIN_KEYS = new Set(['default_admin_secret_key_change_me', 'changeme', 'admin']);

function resolveJwtSecret(): { secret: string; source: string } {
  const env = process.env.JWT_SECRET?.trim();
  if (env && env.length >= 32 && !PUBLIC_DEFAULT_JWT_SECRETS.has(env)) {
    return { secret: env, source: 'JWT_SECRET' };
  }
  // Fallback: derive a stable, non-public secret from DATABASE_URL (itself a
  // private deployment secret) so sessions survive restarts without ever
  // falling back to a value published in source control.
  const dbUrl = process.env.DATABASE_URL?.trim();
  if (dbUrl) {
    const derived = crypto.createHmac('sha256', dbUrl).update('strideclash-jwt-v1').digest('hex');
    return { secret: derived, source: 'derived-from-DATABASE_URL (set JWT_SECRET to override)' };
  }
  return { secret: crypto.randomBytes(48).toString('hex'), source: 'ephemeral-random (dev only; sessions reset on restart)' };
}

const { secret: JWT_SECRET, source: JWT_SECRET_SOURCE } = resolveJwtSecret();
console.log(`[Auth] JWT secret source: ${JWT_SECRET_SOURCE}`);

export const TOKEN_TTL = '30d';

export function signUserToken(userId: string): string {
  return jwt.sign({ sub: userId }, JWT_SECRET, { algorithm: 'HS256', expiresIn: TOKEN_TTL });
}

export type TokenCheck =
  | { ok: true; userId: string }
  | { ok: false; code: 'TOKEN_MISSING' | 'TOKEN_EXPIRED' | 'TOKEN_INVALID' };

export function verifyUserToken(token: string | undefined | null): TokenCheck {
  if (!token) return { ok: false, code: 'TOKEN_MISSING' };
  try {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as jwt.JwtPayload;
    const userId = typeof payload.sub === 'string' ? payload.sub : undefined;
    if (!userId) return { ok: false, code: 'TOKEN_INVALID' };
    return { ok: true, userId };
  } catch (e: any) {
    return { ok: false, code: e?.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID' };
  }
}

function bearer(req: express.Request): string | undefined {
  const h = req.headers.authorization;
  if (!h) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : undefined;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { userId?: string }
  }
}

/**
 * Requires a valid backend JWT. Sets req.userId from the token.
 * If the client also sends a userId (legacy bodies/queries), it must match
 * the token identity — otherwise 403 (impersonation attempt).
 */
export function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const check = verifyUserToken(bearer(req));
  if (!check.ok) {
    const msg = check.code === 'TOKEN_EXPIRED' ? 'Session expired. Please log in again.' : 'Authentication required.';
    return res.status(401).json({ error: msg, code: check.code });
  }
  const claimed = (req.body && typeof req.body === 'object' ? req.body.userId : undefined) ?? req.query.userId;
  if (claimed !== undefined && claimed !== null && claimed !== '' && String(claimed) !== check.userId) {
    return res.status(403).json({ error: 'You can only act as yourself.', code: 'IDENTITY_MISMATCH' });
  }
  req.userId = check.userId;
  next();
}

/** Sets req.userId when a valid token is present; never rejects. */
export function optionalAuth(req: express.Request, _res: express.Response, next: express.NextFunction) {
  const check = verifyUserToken(bearer(req));
  if (check.ok) req.userId = check.userId;
  next();
}

// ─── Admin ────────────────────────────────────────────────────────────────────

export function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const configured = process.env.ADMIN_SECRET_KEY?.trim();
  if (!configured || configured.length < 16 || PUBLIC_DEFAULT_ADMIN_KEYS.has(configured)) {
    return res.status(503).json({ error: 'Admin API disabled: ADMIN_SECRET_KEY is not securely configured.', code: 'ADMIN_NOT_CONFIGURED' });
  }
  const given = String(req.headers['x-admin-token'] || '');
  const a = Buffer.from(given);
  const b = Buffer.from(configured);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ─── Firebase Admin ───────────────────────────────────────────────────────────

const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID?.trim() || 'runwars-355df';
let firebaseApp: admin.app.App | null = null;
let firebaseHasCredential = false;

function loadServiceAccount(): admin.ServiceAccount | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  try {
    const json = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    const parsed = JSON.parse(json);
    return {
      projectId: parsed.project_id,
      clientEmail: parsed.client_email,
      privateKey: String(parsed.private_key || '').replace(/\\n/g, '\n'),
    };
  } catch (e: any) {
    console.error('[Firebase] FIREBASE_SERVICE_ACCOUNT_JSON is set but could not be parsed:', e.message);
    return null;
  }
}

function getFirebaseApp(): admin.app.App {
  if (firebaseApp) return firebaseApp;
  const sa = loadServiceAccount();
  firebaseHasCredential = !!sa;
  firebaseApp = admin.initializeApp(
    sa
      ? { credential: admin.credential.cert(sa), projectId: sa.projectId || FIREBASE_PROJECT_ID }
      : { projectId: FIREBASE_PROJECT_ID }, // ID-token verification only needs the project id
    'strideclash-backend'
  );
  console.log(`[Firebase] Admin initialised for project ${FIREBASE_PROJECT_ID} (custom tokens: ${sa ? 'enabled' : 'DISABLED — FIREBASE_SERVICE_ACCOUNT_JSON not set'})`);
  return firebaseApp;
}

export function firebaseCustomTokensEnabled(): boolean {
  getFirebaseApp();
  return firebaseHasCredential;
}

export async function verifyFirebaseIdToken(idToken: string) {
  return getFirebaseApp().auth().verifyIdToken(idToken, true);
}

export async function createFirebaseCustomToken(userId: string): Promise<string> {
  if (!firebaseCustomTokensEnabled()) {
    const err: any = new Error('Firebase custom tokens are not configured on the server.');
    err.code = 'FIREBASE_ADMIN_NOT_CONFIGURED';
    throw err;
  }
  return getFirebaseApp().auth().createCustomToken(userId);
}

/** Socket.IO handshake auth: returns the verified user id or null. */
export function socketUserId(handshakeAuth: any): string | null {
  const token = handshakeAuth && typeof handshakeAuth.token === 'string' ? handshakeAuth.token : null;
  const check = verifyUserToken(token);
  return check.ok ? check.userId : null;
}
