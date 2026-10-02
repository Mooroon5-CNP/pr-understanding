import { getSession } from '@/lib/auth';
import { requireSameOrigin } from '@/lib/http-security';
import { errorResponse, publishPassingAssessment } from '@/lib/assessment';
export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    try { requireSameOrigin(request); } catch { return Response.json({ error: 'Request origin is not allowed.' }, { status: 403 }); }
    const session = await getSession();
    if (!session) return Response.json({ error: 'Sign in with GitHub first.' }, { status: 401 });
    const { id } = await context.params;
    return Response.json(await publishPassingAssessment(id, session.githubId), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}
