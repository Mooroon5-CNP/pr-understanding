import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readValue, requireSameOrigin, signValue } from '../src/lib/auth';

beforeEach(() => {
  vi.stubEnv('SESSION_SECRET', 'test-secret-with-more-than-thirty-two-characters');
  vi.stubEnv('APP_URL', 'https://example.test');
});
afterEach(() => vi.unstubAllEnvs());

it('signed session cannot be substituted for OAuth state', async () => {
  const token = await signValue({ githubId: 42, login: 'maia' }, 'session', '8h');
  expect((await readValue(token, 'session')).githubId).toBe(42);
  await expect(readValue(token, 'oauth-state')).rejects.toThrow();
});

it('OAuth state rejects tampering and expires', async () => {
  const token = await signValue({ state: 'random-state' }, 'oauth-state', '10m');
  expect((await readValue(token, 'oauth-state')).state).toBe('random-state');
  const parts = token.split('.');
  parts[1] = Buffer.from(JSON.stringify({ state: 'attacker' })).toString('base64url');
  await expect(readValue(parts.join('.'), 'oauth-state')).rejects.toThrow();
  const expired = await signValue({ state: 'old-state' }, 'oauth-state', '-1s');
  await expect(readValue(expired, 'oauth-state')).rejects.toThrow();
});

it('mutations require the canonical application origin', () => {
  expect(() => requireSameOrigin(new Request('https://example.test/api/test', { headers: { Origin: 'https://example.test' } }))).not.toThrow();
  expect(() => requireSameOrigin(new Request('https://example.test/api/test', { headers: { Origin: 'https://attacker.test' } }))).toThrow();
  expect(() => requireSameOrigin(new Request('https://example.test/api/test'))).toThrow();
});
