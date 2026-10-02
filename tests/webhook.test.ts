import { createHmac } from 'node:crypto';
import { beforeEach, expect, test, vi } from 'vitest';
const mocks=vi.hoisted(()=>({publish:vi.fn(),head:vi.fn(),passed:vi.fn(),lock:vi.fn()}));
vi.mock('@/lib/github',()=>({
  isRepositoryAllowed:(owner:string,repo:string)=>owner==='org'&&repo==='app',
  getPullRequestHead:mocks.head,publishCheck:mocks.publish,
  verifyWebhookSignature:(body:string,signature:string)=>signature===`sha256=${createHmac('sha256','test-secret').update(body).digest('hex')}`
}));
vi.mock('@/lib/db',()=>({withCheckLock:mocks.lock,hasPassingAssessment:mocks.passed}));
import {POST} from '@/app/api/webhooks/github/route';
const sha='a'.repeat(40);
function request(signed=true){const body=JSON.stringify({action:'synchronize',number:1,repository:{owner:{login:'org'},name:'app'},pull_request:{head:{sha},base:{ref:'main'},state:'open'}});return new Request('https://app.test/api/webhooks/github',{method:'POST',headers:{'x-github-event':'pull_request','x-hub-signature-256':signed?`sha256=${createHmac('sha256','test-secret').update(body).digest('hex')}`:'bad'},body});}
beforeEach(()=>{vi.clearAllMocks();process.env.APP_URL='https://app.test';mocks.lock.mockImplementation(async(_key,cb)=>cb());mocks.head.mockResolvedValue({headSha:sha,baseSha:'b'.repeat(40),baseRef:'main',state:'open',authorId:1});mocks.passed.mockResolvedValue(false);mocks.publish.mockResolvedValue(1);});
test('webhook rejects altered signatures before accessing GitHub',async()=>{expect((await POST(request(false))).status).toBe(401);expect(mocks.head).not.toHaveBeenCalled();});
test('unpassed PR gets pending check under publication lock',async()=>{expect((await POST(request())).status).toBe(200);expect(mocks.lock).toHaveBeenCalled();expect(mocks.publish).toHaveBeenCalledWith(expect.objectContaining({status:'in_progress',headSha:sha}));});
test('replayed delivery preserves a passing assessment for the current version',async()=>{mocks.passed.mockResolvedValue(true);await POST(request());expect(mocks.publish).toHaveBeenCalledWith(expect.objectContaining({status:'completed',conclusion:'success'}));});
test('out-of-order webhook does not reset the newer head',async()=>{mocks.head.mockResolvedValue({headSha:'c'.repeat(40),state:'open',baseRef:'main'});await POST(request());expect(mocks.publish).not.toHaveBeenCalled();});
test('ambiguous or unavailable PR validation blocks check and requests delivery retry',async()=>{mocks.head.mockRejectedValue(new Error('duplicate'));expect((await POST(request())).status).toBe(503);expect(mocks.publish).toHaveBeenCalledWith(expect.objectContaining({conclusion:'failure'}));});
