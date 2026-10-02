import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { requireSameOrigin } from '@/lib/http-security';
import { errorResponse, submitAttempt } from '@/lib/assessment';
export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    try { requireSameOrigin(request); } catch { return Response.json({ error: 'Request origin is not allowed.' }, { status: 403 }); }
    const session = await getSession();
    if (!session) return Response.json({ error: 'Sign in with GitHub first.' }, { status: 401 });
    const parsed = z.object({ answers: z.record(z.string().max(32), z.string().max(32)) }).strict().safeParse(await request.json());
    if (!parsed.success || Object.keys(parsed.data.answers).length > 10) return Response.json({ error: 'Provide one choice for each question.' }, { status: 400 });
    const { id } = await context.params;
    return Response.json(await submitAttempt(id, session.githubId, parsed.data.answers), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}
