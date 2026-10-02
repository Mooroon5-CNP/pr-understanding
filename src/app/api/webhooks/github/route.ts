import { NextResponse } from 'next/server';
import { publishCheck, verifyWebhookSignature, isRepositoryAllowed, getPullRequestHead } from '@/lib/github';
import { withCheckLock, hasPassingAssessment } from '@/lib/db';

export const runtime = 'nodejs';
export const maxDuration = 180;

export async function POST(request: Request) {
  if (Number(request.headers.get('content-length') || 0) > 1_000_000) return NextResponse.json({error:'Payload too large'},{status:413});
  const body = await request.text();
  if (body.length > 1_000_000) return NextResponse.json({error:'Payload too large'},{status:413});
  try {
    if (!verifyWebhookSignature(body, request.headers.get('x-hub-signature-256'))) return NextResponse.json({error:'Invalid signature'},{status:401});
    const event = request.headers.get('x-github-event');
    if (event === 'ping') return NextResponse.json({ok:true});
    if (event !== 'pull_request') return NextResponse.json({ignored:true});
    const payload = JSON.parse(body);
    if (!['opened','reopened','synchronize','edited','ready_for_review'].includes(payload.action)) return NextResponse.json({ignored:true});
    const pr = payload.pull_request;
    const owner = payload.repository?.owner?.login;
    const repo = payload.repository?.name;
    if (!owner || !repo || !isRepositoryAllowed(owner,repo) || pr?.base?.ref !== 'main' || pr.state !== 'open') return NextResponse.json({ignored:true});
    if (!/^[a-f0-9]{40}$/.test(pr.head.sha) || !Number.isSafeInteger(payload.number)) return NextResponse.json({error:'Invalid payload'},{status:400});
    const appUrl = process.env.APP_URL;
    if (!appUrl) throw new Error('APP_URL missing');
    await withCheckLock({owner,repo,headSha:pr.head.sha}, async () => {
      let current;
      try { current = await getPullRequestHead(owner,repo,payload.number); }
      catch {
        await publishCheck({owner,repo,headSha:pr.head.sha,status:'completed',conclusion:'failure',summary:'PR validation is unavailable or this commit is shared by multiple open PRs. Resolve the issue and retry validation.'});
        throw new Error('Could not verify PR');
      }
      // Deliveries can arrive out of order. Do not reset the current version from stale events.
      if (current.headSha !== pr.head.sha || current.state !== 'open' || current.baseRef !== 'main') return;
      const passed = await hasPassingAssessment({owner,repo,number:payload.number,headSha:current.headSha,baseSha:current.baseSha,authorId:current.authorId});
      const detailsUrl = `${appUrl}/?pr=${encodeURIComponent(`https://github.com/${owner}/${repo}/pull/${payload.number}`)}`;
      await publishCheck({owner,repo,headSha:current.headSha,status:passed?'completed':'in_progress',...(passed?{conclusion:'success' as const}:{}),detailsUrl,summary:passed?'Developer understanding verified: score greater than 80%.':'The PR author must complete the assessment for this version and score greater than 80% before merging.'});
    });
    return NextResponse.json({ok:true});
  } catch {
    return NextResponse.json({error:'Webhook processing failed. Retry delivery after checking configuration.'},{status:503});
  }
}
