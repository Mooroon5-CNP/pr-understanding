import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';

export type Session = { githubId: number; login: string };
export const SESSION_COOKIE = 'pr-understanding-session';
export const STATE_COOKIE = 'pr-understanding-oauth-state';

function signingKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters');
  return new TextEncoder().encode(secret);
}

export function appUrl() {
  const url = new URL(process.env.APP_URL || 'http://localhost:3000');
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') throw new Error('APP_URL must use HTTPS in production');
  return url.origin;
}

export const cookieOptions = () => ({ httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/' });

export async function signValue(payload: Record<string, unknown>, purpose: string, expiry: string) {
  return new SignJWT(payload).setProtectedHeader({ alg: 'HS256' }).setIssuer('pr-understanding').setAudience(purpose).setIssuedAt().setExpirationTime(expiry).sign(signingKey());
}

export async function readValue(token: string, purpose: string) {
  const result = await jwtVerify(token, signingKey(), { algorithms: ['HS256'], issuer: 'pr-understanding', audience: purpose });
  return result.payload;
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const value = await readValue(token, 'session');
    if (!Number.isSafeInteger(value.githubId) || typeof value.login !== 'string') return null;
    return { githubId: value.githubId as number, login: value.login };
  } catch { return null; }
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new Error('Authentication required');
  return session;
}

/** Call on every browser mutation to prevent cross-origin submissions. */
export function requireSameOrigin(request: Request) {
  if (request.headers.get('origin') !== appUrl()) throw new Error('Invalid request origin');
}
