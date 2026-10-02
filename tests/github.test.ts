import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureUniqueHead, getPullRequest, isRepositoryAllowed, publishCheck, verifyWebhookSignature } from '../src/lib/github';

vi.mock('@octokit/auth-app', () => ({ createAppAuth: () => async () => ({ token: 'test-token' }) }));

beforeEach(() => {
  vi.stubEnv('ALLOWED_REPOSITORIES', 'Mooroon5-CNP/demo');
  vi.stubEnv('ALLOWED_ORGANIZATIONS', '');
  vi.stubEnv('GITHUB_APP_ID', '123');
  vi.stubEnv('GITHUB_APP_PRIVATE_KEY', 'test-key');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('repository authorization', () => {
  it('fails closed and authorizes case-insensitive explicit repositories', () => {
    expect(isRepositoryAllowed('mooroon5-cnp', 'DEMO')).toBe(true);
    expect(isRepositoryAllowed('Mooroon5-CNP', 'other')).toBe(false);
    expect(isRepositoryAllowed('other-org', 'demo')).toBe(false);
    expect(isRepositoryAllowed('Mooroon5-CNP/evil', 'demo')).toBe(false);
    vi.stubEnv('ALLOWED_REPOSITORIES', '');
    expect(isRepositoryAllowed('Mooroon5-CNP', 'demo')).toBe(false);
  });
  it('organization allowlist is explicitly opt-in', () => {
    vi.stubEnv('ALLOWED_ORGANIZATIONS', 'Mooroon5-CNP');
    expect(isRepositoryAllowed('Mooroon5-CNP', 'new-repo')).toBe(true);
    expect(isRepositoryAllowed('another-org', 'new-repo')).toBe(false);
  });
});

it('verifies raw webhook body and rejects altered, missing and malformed signatures', () => {
  vi.stubEnv('GITHUB_WEBHOOK_SECRET', 'test-secret');
  const body = '{"action":"opened"}';
  const signature = `sha256=${createHmac('sha256', 'test-secret').update(body).digest('hex')}`;
  expect(verifyWebhookSignature(body, signature)).toBe(true);
  expect(verifyWebhookSignature(`${body} `, signature)).toBe(false);
  expect(verifyWebhookSignature(body, null)).toBe(false);
  expect(verifyWebhookSignature(body, 'sha256=bad')).toBe(false);
  vi.stubEnv('GITHUB_WEBHOOK_SECRET', '');
  expect(verifyWebhookSignature(body, signature)).toBe(false);
});

it('updates the current App check on the current SHA instead of a stale recorded check', async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ id: 99 }))
    .mockResolvedValueOnce(Response.json({ check_runs: [{ id: 8, app: { id: 123 } }, { id: 9, app: { id: 456 } }] }))
    .mockResolvedValueOnce(Response.json({ id: 8 }));
  vi.stubGlobal('fetch', fetchMock);
  expect(await publishCheck({ owner: 'Mooroon5-CNP', repo: 'demo', headSha: 'a'.repeat(40), status: 'completed', conclusion: 'success', summary: '9/10', checkId: 1 })).toBe(8);
  expect(fetchMock.mock.calls[2][0]).toContain('/check-runs/8');
  expect(fetchMock.mock.calls[2][1].method).toBe('PATCH');
});

it('rejects omitted or truncated patches rather than generating questions from partial changes', async () => {
  const pr = { title: 'x', body: '', state: 'open', changed_files: 1, additions: 2, deletions: 0, head: { sha: 'a'.repeat(40) }, base: { sha: 'b'.repeat(40), ref: 'main' }, user: { id: 1, login: 'author' } };
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ id: 99 }))
    .mockResolvedValueOnce(Response.json(pr))
    .mockResolvedValueOnce(Response.json([{ filename: 'file.ts', status: 'modified', additions: 2, deletions: 0, patch: '@@ -0,0 +1,2 @@\n+only-one-line' }]));
  vi.stubGlobal('fetch', fetchMock);
  await expect(getPullRequest('Mooroon5-CNP', 'demo', 1)).rejects.toThrow('truncated patch');
});

it('rejects a different open PR sharing the assessed commit even if another author owns it', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ id: 99 })).mockResolvedValueOnce(Response.json([
    { number: 1, head: { sha: 'a'.repeat(40) } }, { number: 2, head: { sha: 'a'.repeat(40) } },
  ])));
  await expect(ensureUniqueHead('Mooroon5-CNP', 'demo', 1, 'a'.repeat(40))).rejects.toThrow('same head commit');
});

it('permits the assessed PR itself and distinct open PR commits', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ id: 99 })).mockResolvedValueOnce(Response.json([
    { number: 1, head: { sha: 'a'.repeat(40) } }, { number: 2, head: { sha: 'b'.repeat(40) } },
  ])));
  await expect(ensureUniqueHead('Mooroon5-CNP', 'demo', 1, 'a'.repeat(40))).resolves.toBeUndefined();
});

it('fails closed if bounded pagination cannot establish commit uniqueness', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ id: 99 })).mockImplementation(async () => Response.json(Array.from({ length: 100 }, (_, n) => ({ number: n + 2, head: { sha: 'b'.repeat(40) } })))));
  await expect(ensureUniqueHead('Mooroon5-CNP', 'demo', 1, 'a'.repeat(40))).rejects.toThrow('Too many open PRs');
});
