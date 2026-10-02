CREATE TABLE IF NOT EXISTS assessments (
  id uuid PRIMARY KEY,
  owner text NOT NULL,
  repo text NOT NULL,
  pr_number integer NOT NULL CHECK (pr_number > 0),
  head_sha text NOT NULL,
  base_sha text NOT NULL,
  author_id bigint NOT NULL,
  status text NOT NULL CHECK (status IN ('building', 'ready', 'error')),
  content jsonb,
  passed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner, repo, pr_number, head_sha, base_sha, author_id)
);
CREATE TABLE IF NOT EXISTS assessment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES assessments(id),
  author_id bigint NOT NULL,
  correct integer NOT NULL,
  total integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS assessment_rate_limits (
  author_id bigint PRIMARY KEY,
  attempted_at timestamptz[] NOT NULL
);
-- These tables contain private answer keys. Access only with backend credentials.
CREATE TABLE IF NOT EXISTS generation_rate_limits (
  author_id bigint PRIMARY KEY,
  generated_at timestamptz[] NOT NULL
);
CREATE TABLE IF NOT EXISTS check_publication_locks (
 owner text NOT NULL, repo text NOT NULL, head_sha text NOT NULL,
 token uuid NOT NULL, expires_at timestamptz NOT NULL, PRIMARY KEY(owner,repo,head_sha)
);
