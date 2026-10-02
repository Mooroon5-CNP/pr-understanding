import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { requireSameOrigin } from '@/lib/http-security';
import { createAssessment, errorResponse } from '@/lib/assessment';
export const runtime = 'nodejs';
export const maxDuration = 180;
export async function POST(request: Request) {
  try {
    try { requireSameOrigin(request); } catch { return Response.json({ error: 'Request origin is not allowed.' }, { status: 403 }); }
    const session = await getSession();
    if (!session) return Response.json({ error: 'Sign in with GitHub first.' }, { status: 401 });
    const parsed = z.object({ pullRequestUrl: z.string().max(1000) }).strict().safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: 'Provide a GitHub pull request URL.' }, { status: 400 });
    return Response.json(await createAssessment(parsed.data.pullRequestUrl, session.githubId), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}
