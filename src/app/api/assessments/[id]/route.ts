import { getSession } from '@/lib/auth';
import { ownedAssessment, publicAssessment, errorResponse } from '@/lib/assessment';
export const runtime = 'nodejs';
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) return Response.json({ error: 'Sign in with GitHub first.' }, { status: 401 });
    const { id } = await context.params;
    return Response.json(publicAssessment(await ownedAssessment(id, session.githubId)), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}
