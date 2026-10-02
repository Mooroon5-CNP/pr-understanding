import { createHmac, timingSafeEqual } from 'node:crypto';
import { createAppAuth } from '@octokit/auth-app';

const API = 'https://api.github.com';
export const CHECK_NAME = 'developer-understanding';
export type PullRequestFile = { filename: string; status: string; additions: number; deletions: number; patch: string };
export type PullRequest = {
  owner: string; repo: string; number: number; title: string; body: string; state: string;
  baseRef: string; baseSha: string; headSha: string; authorId: number; authorLogin: string;
  files: PullRequestFile[]; diff: string;
};

export function assertAllowedRepository(owner: string, repo: string) {
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) throw new Error('Invalid repository name');
  const fullName = `${owner}/${repo}`.toLowerCase();
  const repositories = (process.env.ALLOWED_REPOSITORIES || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const organizations = (process.env.ALLOWED_ORGANIZATIONS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!repositories.includes(fullName) && !organizations.includes(owner.toLowerCase())) throw new Error('Repository is not enabled for assessments');
}

export function isRepositoryAllowed(owner: string, repo: string): boolean {
  try { assertAllowedRepository(owner, repo); return true; } catch { return false; }
}

function appAuth() {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!appId || !privateKey) throw new Error('GitHub App credentials are not configured');
  return createAppAuth({ appId, privateKey });
}

async function api<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...options, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json', ...options.headers },
    cache: 'no-store', signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`GitHub request failed (${response.status}). Check App installation and permissions.`);
  return response.json() as Promise<T>;
}

async function installationToken(owner: string, repo: string) {
  assertAllowedRepository(owner, repo);
  const auth = appAuth();
  const jwt = await auth({ type: 'app' });
  const installation = await api<{ id: number }>(`/repos/${owner}/${repo}/installation`, jwt.token);
  // A repository-scoped token avoids granting this request access to other repositories.
  const token = await auth({ type: 'installation', installationId: installation.id, repositoryNames: [repo] });
  return token.token;
}

type GitHubPR = { title: string; body: string | null; state: string; changed_files: number; additions: number; deletions: number; head: { sha: string }; base: { sha: string; ref: string }; user: { id: number; login: string } };
type GitHubFile = { filename: string; status: string; additions: number; deletions: number; patch?: string };

async function assertUniqueHeadWithToken(owner: string, repo: string, number: number, headSha: string, token: string) {
  // Required checks are commit-scoped. A second PR sharing this commit must never
  // inherit an assessment of a different PR/diff or another author's attempt.
  for (let page = 1; page <= 10; page++) {
    const pulls = await api<{ number: number; head: { sha: string } }[]>(`/repos/${owner}/${repo}/pulls?state=open&base=main&per_page=100&page=${page}`, token);
    if (pulls.some(pr => pr.number !== number && pr.head.sha === headSha)) throw new Error('Another open PR to main uses the same head commit. Use a distinct commit before assessing this PR.');
    if (pulls.length < 100) return;
  }
  throw new Error('Too many open PRs to verify commit uniqueness safely');
}

export async function ensureUniqueHead(owner: string, repo: string, number: number, headSha: string) {
  if (!Number.isSafeInteger(number) || number < 1 || !/^[a-f0-9]{40}$/.test(headSha)) throw new Error('Invalid pull request or commit');
  const token = await installationToken(owner, repo);
  await assertUniqueHeadWithToken(owner, repo, number, headSha, token);
}

export async function getPullRequest(owner: string, repo: string, number: number): Promise<PullRequest> {
  if (!Number.isSafeInteger(number) || number < 1) throw new Error('Invalid pull request number');
  const token = await installationToken(owner, repo);
  const path = `/repos/${owner}/${repo}/pulls/${number}`;
  const pr = await api<GitHubPR>(path, token);
  const maxFiles = 100;
  const maxCharacters = 60000;
  if (pr.changed_files > maxFiles) throw new Error('This PR exceeds 100 changed files. Split it into smaller PRs for a complete assessment.');
  const files: PullRequestFile[] = [];
  let characters = 0;
  for (let page = 1; files.length < pr.changed_files; page++) {
    const batch = await api<GitHubFile[]>(`${path}/files?per_page=100&page=${page}`, token);
    if (batch.length === 0 || page > 30) throw new Error('GitHub returned an incomplete file list');
    for (const file of batch) {
      if (typeof file.patch !== 'string') throw new Error(`Cannot assess ${file.filename}: GitHub omitted its patch (binary or oversized file).`);
      const lines = file.patch.split('\n');
      const additions = lines.filter(line => line.startsWith('+')).length;
      const deletions = lines.filter(line => line.startsWith('-')).length;
      if (additions !== file.additions || deletions !== file.deletions) throw new Error(`Cannot assess ${file.filename}: GitHub returned a truncated patch.`);
      characters += file.patch.length + file.filename.length + 50;
      if (characters > maxCharacters) throw new Error('This PR exceeds the assessment context limit. Split it into smaller PRs.');
      files.push({ ...file, patch: file.patch });
    }
  }
  if (files.length !== pr.changed_files || files.reduce((sum, f) => sum + f.additions, 0) !== pr.additions || files.reduce((sum, f) => sum + f.deletions, 0) !== pr.deletions) throw new Error('GitHub returned incomplete changes');
  // Guard against a push while paginating: never associate mixed-version content with a SHA.
  const latest = await api<GitHubPR>(path, token);
  if (latest.head.sha !== pr.head.sha || latest.base.sha !== pr.base.sha) throw new Error('The PR changed while its diff was being read. Please retry.');
  await assertUniqueHeadWithToken(owner, repo, number, pr.head.sha, token);
  return { owner, repo, number, title: pr.title, body: pr.body || '', state: pr.state, baseRef: pr.base.ref, baseSha: pr.base.sha, headSha: pr.head.sha, authorId: pr.user.id, authorLogin: pr.user.login, files, diff: files.map(f => `File: ${f.filename} (${f.status})\n${f.patch}`).join('\n\n') };
}

export async function getPullRequestHead(owner: string, repo: string, number: number) {
  if (!Number.isSafeInteger(number) || number < 1) throw new Error('Invalid pull request number');
  const token = await installationToken(owner, repo);
  const pr = await api<GitHubPR>(`/repos/${owner}/${repo}/pulls/${number}`, token);
  await assertUniqueHeadWithToken(owner, repo, number, pr.head.sha, token);
  return { headSha: pr.head.sha, baseSha: pr.base.sha, baseRef: pr.base.ref, state: pr.state, authorId: pr.user.id };
}

export async function publishCheck(input: {
  owner: string; repo: string; headSha: string; status: 'in_progress' | 'completed';
  conclusion?: 'success' | 'failure'; detailsUrl?: string; summary: string; checkId?: number;
}): Promise<number> {
  if (!/^[a-f0-9]{40}$/.test(input.headSha)) throw new Error('Invalid commit SHA');
  if (input.status === 'completed' && !input.conclusion) throw new Error('Completed check requires a conclusion');
  const token = await installationToken(input.owner, input.repo);
  const existing = await api<{ check_runs: { id: number; app: { id: number }; created_at: string }[] }>(
    `/repos/${input.owner}/${input.repo}/commits/${input.headSha}/check-runs?check_name=${CHECK_NAME}&filter=latest&per_page=100`, token,
  );
  const canonical = existing.check_runs.filter(check => String(check.app.id) === process.env.GITHUB_APP_ID).sort((a, b) => b.id - a.id)[0];
  const checkId = canonical?.id;
  const body = {
    name: CHECK_NAME, ...(checkId ? {} : { head_sha: input.headSha }), status: input.status,
    ...(input.status === 'completed' ? { conclusion: input.conclusion, completed_at: new Date().toISOString() } : {}),
    ...(input.detailsUrl ? { details_url: input.detailsUrl } : {}),
    output: { title: input.conclusion === 'success' ? 'Understanding assessment passed' : 'Understanding assessment required', summary: input.summary },
  };
  const check = await api<{ id: number }>(`/repos/${input.owner}/${input.repo}/check-runs${checkId ? `/${checkId}` : ''}`, token, { method: checkId ? 'PATCH' : 'POST', body: JSON.stringify(body) });
  return check.id;
}

export function verifyWebhookSignature(rawBody: string | Buffer, signature: string | null): boolean {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret || !signature || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
