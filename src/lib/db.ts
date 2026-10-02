import { neon } from '@neondatabase/serverless';
import type { GeneratedAssessment } from './generator';

export type AssessmentRow = {
  id: string; owner: string; repo: string; pr_number: number;
  head_sha: string; base_sha: string; author_id: number | string;
  status: 'building' | 'ready' | 'error'; content: GeneratedAssessment | null;
  passed: boolean;
};
function client() {
  if (!process.env.DATABASE_URL) throw new Error('Database is not configured');
  return neon(process.env.DATABASE_URL);
}
export async function findAssessment(id: string): Promise<AssessmentRow | null> {
  const rows = await client().query('SELECT * FROM assessments WHERE id = $1', [id]);
  return (rows[0] as AssessmentRow) ?? null;
}
export async function reserveAssessment(input: Omit<AssessmentRow, 'status' | 'content' | 'passed'>) {
  const sql = client();
  const args = [input.id, input.owner, input.repo, input.pr_number, input.head_sha, input.base_sha, input.author_id];
  const inserted = await sql.query(`INSERT INTO assessments (id,owner,repo,pr_number,head_sha,base_sha,author_id,status)
    VALUES ($1,$2,$3,$4,$5,$6,$7,'building') ON CONFLICT DO NOTHING RETURNING *`, args);
  if (inserted[0]) return { row: inserted[0] as AssessmentRow, created: true };
  const rows = await sql.query(`SELECT * FROM assessments WHERE owner=$1 AND repo=$2 AND pr_number=$3
    AND head_sha=$4 AND base_sha=$5 AND author_id=$6`, args.slice(1));
  return { row: rows[0] as AssessmentRow, created: false };
}
export async function saveContent(id: string, content: GeneratedAssessment) {
  await client().query("UPDATE assessments SET content=$2::jsonb,status='ready',updated_at=now() WHERE id=$1", [id, JSON.stringify(content)]);
}
export async function markError(id: string) {
  await client().query("UPDATE assessments SET status='error',updated_at=now() WHERE id=$1", [id]);
}
export async function claimRetry(id: string): Promise<boolean> {
  const rows = await client().query("UPDATE assessments SET status='building',updated_at=now() WHERE id=$1 AND (status='error' OR (status='building' AND updated_at < now() - interval '5 minutes')) RETURNING id", [id]);
  return rows.length === 1;
}
export async function consumeAttempt(authorId: number): Promise<boolean> {
  // An atomic row update serializes concurrent requests and keeps a rolling hour window.
  const rows = await client().query(`INSERT INTO assessment_rate_limits (author_id,attempted_at)
    VALUES ($1, ARRAY[now()]) ON CONFLICT (author_id) DO UPDATE
    SET attempted_at = ARRAY(SELECT t FROM unnest(assessment_rate_limits.attempted_at) t
      WHERE t > now() - interval '1 hour') || now()
    WHERE cardinality(ARRAY(SELECT t FROM unnest(assessment_rate_limits.attempted_at) t
      WHERE t > now() - interval '1 hour')) < 5 RETURNING author_id`, [authorId]);
  return rows.length === 1;
}
export async function recordAttempt(row: AssessmentRow, correct: number, total: number, passed: boolean) {
  const sql = client();
  await sql.transaction([
    sql.query('INSERT INTO assessment_attempts (assessment_id,author_id,correct,total) VALUES ($1,$2,$3,$4)', [row.id, row.author_id, correct, total]),
    sql.query('UPDATE assessments SET passed = passed OR $2 WHERE id=$1', [row.id, passed]),
  ]);
}
export async function consumeGeneration(authorId: number): Promise<boolean> {
  const rows = await client().query(`INSERT INTO generation_rate_limits (author_id,generated_at)
    VALUES ($1, ARRAY[now()]) ON CONFLICT (author_id) DO UPDATE
    SET generated_at = ARRAY(SELECT t FROM unnest(generation_rate_limits.generated_at) t
      WHERE t > now() - interval '1 hour') || now()
    WHERE cardinality(ARRAY(SELECT t FROM unnest(generation_rate_limits.generated_at) t
      WHERE t > now() - interval '1 hour')) < 10 RETURNING author_id`, [authorId]);
  return rows.length === 1;
}
export async function withCheckLock<T>(key: {owner:string;repo:string;headSha:string}, callback:()=>Promise<T>):Promise<T> {
 const token=crypto.randomUUID();
 const values=[key.owner.toLowerCase(),key.repo.toLowerCase(),key.headSha,token];
 const rows=await client().query(`INSERT INTO check_publication_locks(owner,repo,head_sha,token,expires_at)
 VALUES($1,$2,$3,$4,now()+interval '5 minutes') ON CONFLICT(owner,repo,head_sha) DO UPDATE
 SET token=EXCLUDED.token,expires_at=EXCLUDED.expires_at WHERE check_publication_locks.expires_at<now() RETURNING token`,values);
 if(!rows.length) throw new Error('Check publication is busy; retry shortly');
 try{return await callback();}finally{await client().query('DELETE FROM check_publication_locks WHERE owner=$1 AND repo=$2 AND head_sha=$3 AND token=$4',values);}
}
export async function hasPassingAssessment(key:{owner:string;repo:string;number:number;headSha:string;baseSha:string;authorId:number}) {
 const rows=await client().query('SELECT id FROM assessments WHERE owner=$1 AND repo=$2 AND pr_number=$3 AND head_sha=$4 AND base_sha=$5 AND author_id=$6 AND passed=true LIMIT 1',[key.owner.toLowerCase(),key.repo.toLowerCase(),key.number,key.headSha,key.baseSha,key.authorId]);
 return rows.length>0;
}
