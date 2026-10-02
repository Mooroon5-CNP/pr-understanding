# Architecture

The website is a separate Next.js application deployed on Vercel. Neon PostgreSQL persists assessment versions and attempts. Existing application source and deployment workflows do not need to change.

## Integration boundaries

| Boundary | Responsibility |
| --- | --- |
| GitHub OAuth | Authenticate the person attempting the quiz. |
| GitHub App | Read installed repositories and PR changes; publish `developer-understanding` checks. |
| App backend | Author authorization, repository allowlist, freshness verification and deterministic grading. |
| Generative API | Produce explanation and QCM questions from bounded PR context. |
| PostgreSQL | Keep answer keys and attempts private and cache assessments by PR version. |
| GitHub protection settings | Enforce a successful check before merging into `main`. |

## Assessment flow

1. The authenticated author requests assessment of a repository and PR.
2. The server verifies repository policy, installation access, PR author, open state and target branch.
3. The server fetches PR changes and records both head and base versions.
4. A generative provider returns structured educational content and ten QCM questions. Its output is validated; arbitrary generated HTML is not executed.
5. The backend persists the answer key and sends only public question fields to the browser.
6. A submission is graded on the server after rechecking identity and PR freshness.
7. A score greater than 80% is eligible for a successful GitHub check on the assessed commit. The app never merges a PR itself.

## Version and enforcement rules

Passing an old assessment does not validate a new commit. The backend compares the live PR with the recorded head/base before accepting results, and PR webhooks publish pending checks for changed PR versions. A push to `main` does not invalidate all open PRs automatically. Require branches to be up to date before merging: refreshing a branch changes its head and triggers reassessment. Reopening an assessment also checks its live head/base. Without up-to-date branch enforcement, this MVP cannot reliably prevent reuse after a base update. Keep webhook delivery working and test both paths before enforcement.

Use a ruleset/protection that requires the exact check name from the expected GitHub App. Maintain existing CI requirements. Direct pushes, admin bypasses and any emergency bypass users must be handled in GitHub settings. Merge queues need separate integration and are outside this initial implementation unless tested explicitly.

## Trust and cost

Correct answers, App private keys, OAuth secrets, session secrets and model keys remain on the server. Code changes are untrusted model input. A quiz is a learning check; it does not prove unaided human comprehension.

Generation is cached per assessed PR version. Retaking the same assessment uses deterministic grading and does not require another model call. Serverless request duration and model latency limit the size of supported PRs; a durable job queue is the next step if generation repeatedly times out. Keep API budgets and usage limits configured with the provider.
