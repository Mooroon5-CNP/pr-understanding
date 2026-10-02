import { describe, expect, it, vi, afterEach } from 'vitest';
vi.mock('../src/lib/auth', () => ({ appUrl: () => 'https://quiz.example.com' }));
vi.mock('../src/lib/github', () => ({ getPullRequest: vi.fn(), getPullRequestHead: vi.fn(), publishCheck: vi.fn() }));
import { gradeAnswers, parsePullRequestUrl, publicAssessment, ownedAssessment, submitAttempt, publishPassingAssessment } from '../src/lib/assessment';
vi.mock('../src/lib/db', () => ({ findAssessment: vi.fn(), consumeAttempt: vi.fn(), recordAttempt: vi.fn(), reserveAssessment: vi.fn(), claimRetry: vi.fn(), consumeGeneration: vi.fn(), markError: vi.fn(), saveContent: vi.fn(), withCheckLock: async (_key:unknown, callback:()=>Promise<unknown>) => callback() }));
import { findAssessment, consumeAttempt, recordAttempt } from '../src/lib/db';
import { getPullRequestHead, publishCheck } from '../src/lib/github';
import { generatedAssessmentSchema, generateAssessment, type GeneratedAssessment } from '../src/lib/generator';
const content: GeneratedAssessment = {
  explanation: { title: 'Change', summary: 'A useful explanation', sections: [{ title: 'Behavior', body: 'Details about behavior' }] },
  questions: Array.from({ length: 10 }, (_, i) => ({ id: `q${i}`, prompt: 'What does this change do?',
    choices: ['a','b','c','d'].map(id => ({ id, text: `Choice ${id}` })), correctChoiceId: 'a' })),
};
function answers(count: number) { return Object.fromEntries(content.questions.map((q,i) => [q.id, i<count?'a':'b'])); }
afterEach(() => vi.unstubAllGlobals());
describe('trusted grading and safe questions', () => {
  it('rejects 80 percent and accepts 90 percent', () => {
    expect(gradeAnswers(content, answers(8))).toMatchObject({ score: 80, passed: false });
    expect(gradeAnswers(content, answers(9))).toMatchObject({ score: 90, passed: true });
  });
  it('requires exactly one valid answer per question', () => {
    expect(() => gradeAnswers(content, {})).toThrow();
    expect(() => gradeAnswers(content, { ...answers(10), q0: 'forged' })).toThrow();
    expect(() => gradeAnswers(content, { ...answers(10), extra: 'a' })).toThrow();
  });
  it('never exposes the key in browser responses', () => {
    const row = { id:'id',owner:'org',repo:'repo',pr_number:1,head_sha:'sha',base_sha:'base',author_id:1,status:'ready' as const,content,passed:false };
    expect(JSON.stringify(publicAssessment(row))).not.toContain('correctChoiceId');
  });
  it('validates generated answer keys and unique question IDs', () => {
    expect(generatedAssessmentSchema.safeParse(content).success).toBe(true);
    expect(generatedAssessmentSchema.safeParse({ ...content, questions: content.questions.map(q => ({...q,id:'duplicate'})) }).success).toBe(false);
    expect(generatedAssessmentSchema.safeParse({ ...content, questions: content.questions.map(q => ({...q,correctChoiceId:'unknown'})) }).success).toBe(false);
  });
  it('accepts only GitHub PR URLs', () => {
    expect(parsePullRequestUrl('https://github.com/Mooroon5-CNP/repo/pull/12')).toEqual({owner:'Mooroon5-CNP',repo:'repo',number:12});
    for (const url of ['https://github.com.evil.test/o/r/pull/1','https://evil.test/o/r/pull/1','http://github.com/o/r/pull/1','https://github.com/o/r/issues/1']) expect(() => parsePullRequestUrl(url)).toThrow();
  });
  it('rejects an oversized diff instead of silently losing coverage', async () => {
    await expect(generateAssessment({title:'PR',body:null,diff:'x'.repeat(60001)})).rejects.toThrow('limit');
  });
  it('validates an OpenAI-compatible generator response', async () => {
    vi.stubEnv('GENERATIVE_API_KEY','test'); vi.stubEnv('GENERATIVE_MODEL','test');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ choices: [{message:{content:JSON.stringify(content)}}] })));
    expect(await generateAssessment({title:'PR',body:null,diff:'diff'})).toEqual(content);
    vi.unstubAllEnvs();
  });
});

describe('assessment authorization and check publication', () => {
  const row = { id:'550e8400-e29b-41d4-a716-446655440000',owner:'org',repo:'repo',pr_number:1,head_sha:'sha',base_sha:'base',author_id:1,status:'ready' as const,content,passed:false };
  const head = {headSha:'sha',baseSha:'base',baseRef:'main',state:'open' as const,authorId:1};
  it('refuses another developer before grading', async () => {
    vi.mocked(findAssessment).mockResolvedValue(row);
    await expect(ownedAssessment(row.id, 2)).rejects.toMatchObject({status:403});
  });
  it('refuses a changed PR version', async () => {
    vi.mocked(findAssessment).mockResolvedValue(row);
    vi.mocked(getPullRequestHead).mockResolvedValue({...head,headSha:'new'});
    await expect(ownedAssessment(row.id, 1)).rejects.toMatchObject({status:409});
  });
  it('preserves passing result when publication fails', async () => {
    vi.mocked(findAssessment).mockResolvedValue({...row,passed:true});
    vi.mocked(getPullRequestHead).mockResolvedValue(head);
    vi.mocked(consumeAttempt).mockResolvedValue(true);
    vi.mocked(recordAttempt).mockResolvedValue(undefined);
    vi.mocked(publishCheck).mockRejectedValue(new Error('GitHub unavailable'));
    expect(await submitAttempt(row.id,1,answers(9))).toMatchObject({passed:true,checkPublished:false});
  });
  it('republishes stored passing result without spending an attempt', async () => {
    vi.mocked(findAssessment).mockResolvedValue({...row,passed:true});
    vi.mocked(getPullRequestHead).mockResolvedValue(head);
    vi.mocked(publishCheck).mockResolvedValue(123);
    const count = vi.mocked(consumeAttempt).mock.calls.length;
    expect(await publishPassingAssessment(row.id,1)).toEqual({passed:true,checkPublished:true});
    expect(vi.mocked(consumeAttempt).mock.calls.length).toBe(count);
  });
});
