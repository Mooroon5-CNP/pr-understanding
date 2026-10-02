import { timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { appUrl, cookieOptions, readValue, signValue, SESSION_COOKIE, STATE_COOKIE } from '@/lib/auth';

export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const stateToken = (await cookies()).get(STATE_COOKIE)?.value;
    if (!code || !state || !stateToken) throw new Error('Invalid OAuth callback');
    const value = await readValue(stateToken, 'oauth-state');
    if (typeof value.state !== 'string' || value.state.length !== state.length || !timingSafeEqual(Buffer.from(value.state), Buffer.from(state))) throw new Error('Invalid OAuth state');
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: process.env.GITHUB_CLIENT_ID, client_secret: process.env.GITHUB_CLIENT_SECRET, code, redirect_uri: `${appUrl()}/api/auth/callback` }),
      cache: 'no-store', signal: AbortSignal.timeout(15000),
    });
    const token = await tokenResponse.json();
    if (!tokenResponse.ok || typeof token.access_token !== 'string') throw new Error('OAuth exchange failed');
    const userResponse = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, cache: 'no-store', signal: AbortSignal.timeout(15000) });
    const user = await userResponse.json();
    if (!userResponse.ok || !Number.isSafeInteger(user.id) || typeof user.login !== 'string') throw new Error('GitHub identity lookup failed');
    // Only identity is retained; the OAuth access token is never stored or exposed.
    const response = NextResponse.redirect(new URL('/', appUrl()));
    response.cookies.set(SESSION_COOKIE, await signValue({ githubId: user.id, login: user.login }, 'session', '8h'), { ...cookieOptions(), maxAge: 28800 });
    response.cookies.set(STATE_COOKIE, '', { ...cookieOptions(), maxAge: 0 });
    return response;
  } catch {
    const response = NextResponse.json({ error: 'GitHub sign-in failed. Please start sign-in again.' }, { status: 400 });
    response.cookies.set(STATE_COOKIE, '', { ...cookieOptions(), maxAge: 0 });
    return response;
  }
}
