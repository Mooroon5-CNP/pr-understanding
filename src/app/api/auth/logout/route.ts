import { NextResponse } from 'next/server';
import { cookieOptions, requireSameOrigin, SESSION_COOKIE } from '@/lib/auth';

export async function POST(request: Request) {
  try { requireSameOrigin(request); } catch { return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 }); }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, '', { ...cookieOptions(), maxAge: 0 });
  return response;
}
