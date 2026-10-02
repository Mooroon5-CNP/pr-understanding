import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { appUrl, cookieOptions, signValue, STATE_COOKIE } from '@/lib/auth';

export const runtime = 'nodejs';
export async function GET() {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) return NextResponse.json({ error: 'GitHub sign-in is not configured' }, { status: 503 });
  const state = randomBytes(32).toString('hex');
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', `${appUrl()}/api/auth/callback`);
  url.searchParams.set('scope', 'read:user');
  url.searchParams.set('state', state);
  const response = NextResponse.redirect(url);
  response.cookies.set(STATE_COOKIE, await signValue({ state }, 'oauth-state', '10m'), { ...cookieOptions(), maxAge: 600 });
  return response;
}
