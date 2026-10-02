import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { appUrl } from './auth';
import { getPullRequest, getPullRequestHead, publishCheck } from './github';
import { claimRetry, consumeGeneration, consumeAttempt, findAssessment, markError, recordAttempt, reserveAssessment, saveContent, withCheckLock, type AssessmentRow } from './db';
import { generateAssessment, type GeneratedAssessment } from './generator';

export class AssessmentError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function parsePullRequestUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new AssessmentError('Enter a valid GitHub pull request URL.'); }
  const match = url.pathname.match(/^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/([1-9][0-9]*)\/?$/);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password || !match) {
    throw new AssessmentError('Enter a URL such as https://github.com/organization/repository/pull/123.');
  }
  const number = Number(match[3]);
  if (!Number.isSafeInteger(number)) throw new AssessmentError('Invalid pull request number.');
  return { owner: match[1], repo: match[2], number };
}
export function publicAssessment(row: AssessmentRow) {
  return { id: row.id, owner: row.owner, repo: row.repo, number: row.pr_number,
    headSha: row.head_sha, status: row.status, passed: row.passed,
    explanation: row.content?.explanation ?? null,
    questions: row.content?.questions.map(({ id, prompt, choices }) => ({ id, prompt, choices })) ?? [],
  };
}
export function gradeAnswers(content: GeneratedAssessment, answers: Record<string, string>) {
  if (Object.keys(answers).length !== content.questions.length || content.questions.some(q =>
    !Object.hasOwn(answers, q.id) || !q.choices.some(c => c.id === answers[q.id]))) {
    throw new AssessmentError('Answer each question with one valid choice.');
  }
  const correct = content.questions.filter(q => answers[q.id] === q.correctChoiceId).length;
  const total = content.questions.length;
  return { correct, total, score: correct / total * 100, passed: correct * 100 > total * 80 };
}
function detailsUrl(id: string) { return `${appUrl()}/assessments/${id}`; }
async function currentPR(row: AssessmentRow, githubId: number) {
  const pr = await getPullRequestHead(row.owner, row.repo, row.pr_number);
  if (Number(row.author_id) !== githubId || pr.authorId !== githubId) throw new AssessmentError('Only the pull request author can take this assessment.', 403);
  if (pr.state !== 'open' || pr.baseRef !== 'main') throw new AssessmentError('The pull request must be open and target main.', 409);
  if (pr.headSha !== row.head_sha || pr.baseSha !== row.base_sha) throw new AssessmentError('The pull request changed. Create a new assessment for its current version.', 409);
  return pr;
}
export async function ownedAssessment(id: string, githubId: number) {
  if (!z.string().uuid().safeParse(id).success) throw new AssessmentError('Assessment not found.', 404);
  const row = await findAssessment(id);
  if (!row) throw new AssessmentError('Assessment not found.', 404);
  if (Number(row.author_id) !== githubId) throw new AssessmentError('This assessment belongs to another developer.', 403);
  await currentPR(row, githubId);
  return row;
}
export async function createAssessment(pullRequestUrl: string, githubId: number) {
  const ref = parsePullRequestUrl(pullRequestUrl);
  const pr = await getPullRequest(ref.owner, ref.repo, ref.number);
  if (pr.authorId !== githubId) throw new AssessmentError('Only the pull request author can create this assessment.', 403);
  if (pr.state !== 'open' || pr.baseRef !== 'main') throw new AssessmentError('Choose an open pull request targeting main.', 409);
  if (!pr.diff.trim()) throw new AssessmentError('There are no assessable changes in this pull request.');
  const reserved = await reserveAssessment({ id: randomUUID(), owner: ref.owner.toLowerCase(), repo: ref.repo.toLowerCase(),
    pr_number: ref.number, head_sha: pr.headSha, base_sha: pr.baseSha, author_id: githubId });
  const row = reserved.row;
  if (!reserved.created && !(row.status !== 'ready' && await claimRetry(row.id))) {
    if (row.status === 'building') throw new AssessmentError('This assessment is being generated. Try again shortly.', 409);
    return publicAssessment(row);
  }
  try {
    if (!await consumeGeneration(githubId)) throw new AssessmentError('Generation limit reached. Try again in an hour.', 429);
    await withCheckLock({owner:row.owner,repo:row.repo,headSha:row.head_sha}, async () => {
      await currentPR(row,githubId);
      await publishCheck({ ...ref, headSha: pr.headSha, status: 'in_progress', detailsUrl: detailsUrl(row.id), summary: 'Complete your understanding assessment. A score greater than 80% is required.' });
    });
    const content = await generateAssessment(pr);
    await currentPR(row, githubId);
    await saveContent(row.id, content);
    return publicAssessment({ ...row, content, status: 'ready' });
  } catch (error) {
    await markError(row.id);
    if (error instanceof AssessmentError) throw error;
    throw new AssessmentError('Unable to generate the assessment. Check service configuration or try again later.', 503);
  }
}
export async function submitAttempt(id: string, githubId: number, answers: Record<string, string>) {
  const row = await ownedAssessment(id, githubId);
  if (row.status !== 'ready' || !row.content) throw new AssessmentError('This assessment is not ready.', 409);
  const result = gradeAnswers(row.content, answers);
  if (!await consumeAttempt(githubId)) throw new AssessmentError('You have used five attempts in the past hour. Please try later.', 429);
  await recordAttempt(row, result.correct, result.total, result.passed);
  try {
    return await withCheckLock({owner:row.owner,repo:row.repo,headSha:row.head_sha}, async () => {
      const latest = await findAssessment(id);
      const passed = result.passed || latest?.passed === true;
      await currentPR(row, githubId);
      await publishCurrentResult(row, githubId, passed, result.score);
      return { ...result, passed, checkPublished:true };
    });
  } catch (error) {
    if (error instanceof AssessmentError) throw error;
    return { ...result, passed: result.passed || (await findAssessment(id))?.passed === true, checkPublished:false };
  }
}
async function publishCurrentResult(row: AssessmentRow, githubId: number, passed: boolean, score?: number) {
  await publishCheck({ owner:row.owner,repo:row.repo,headSha:row.head_sha,status:'completed',conclusion:passed?'success':'failure',detailsUrl:detailsUrl(row.id),summary:passed?'Developer understanding verified: score greater than 80%.':`Assessment score ${score}%. A score greater than 80% is required.` });
  try { await currentPR(row, githubId); }
  catch (error) {
    await publishCheck({ owner:row.owner,repo:row.repo,headSha:row.head_sha,status:'completed',conclusion:'failure',summary:'This assessment is stale. Validate the latest pull request version.' });
    throw error;
  }
}

export function errorResponse(error: unknown) {
  if (error instanceof AssessmentError) return Response.json({ error: error.message }, { status: error.status });
  console.error('Assessment request failed:', error instanceof Error ? error.name : 'unknown');
  return Response.json({ error: 'The assessment service is unavailable. Please try again later.' }, { status: 503 });
}
export async function publishPassingAssessment(id: string, githubId: number) {
  const row = await ownedAssessment(id, githubId);
  return withCheckLock({owner:row.owner,repo:row.repo,headSha:row.head_sha}, async () => {
    const latest = await findAssessment(id);
    if (!latest?.passed) throw new AssessmentError('Pass the assessment before publishing validation.', 409);
    await currentPR(row,githubId);
    await publishCurrentResult(row,githubId,true);
    return {passed:true,checkPublished:true};
  });
}
