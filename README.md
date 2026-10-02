# PR Understanding

An independent app that helps the author understand a GitHub pull request, then grades a ten-question quiz before publishing the `developer-understanding` check. **Strictly more than 80% is required: 9/10 or 10/10.** The author merges in GitHub once this check and the other repository requirements pass.

No CNP portal changes or CI files in existing application repositories are needed. Merge enforcement requires GitHub branch protection/ruleset settings on those repositories.

## Stack

- Next.js and TypeScript, deployable to Vercel.
- Neon PostgreSQL for persistent assessments and attempts.
- GitHub OAuth for sign-in; GitHub App for PR access, checks and webhooks.
- An OpenAI-compatible generative API supplied by you.
- Backend QCM grading: no AI call for calculating scores or retries.

Correct answers are stored privately. Assessments are cached for an exact repository, PR, head SHA, base SHA and author. New code requires reassessment. Five attempts per author per rolling hour limit repeated submissions; ten new generations per author per hour limit API spend. The app does not merge PRs automatically. Passing quiz results can be republished through a separate button if GitHub publication fails, without consuming another quiz attempt.

## Local setup

Use Node.js 22 or newer and npm.

```bash
npm install
cp .env.example .env.local
```

Fill in the variables below, then run:

```bash
npm run db:setup
npm run dev
```

Open `http://localhost:3000`. `npm run db:setup` applies the initial `db/schema.sql` without dropping tables. This is a bootstrap script, not a migration manager for future schema changes.

```bash
npm test
npm run typecheck
npm run build
```

Local tests do not simulate a passing production check. Without real credentials, sign-in, PR fetching, generation and check publication cannot operate.

## 1. Provision a free persistent database

1. Create a project on [Neon](https://neon.com/).
2. Choose its Free plan and a region near your Vercel deployment.
3. Copy the PostgreSQL connection string into `DATABASE_URL` in `.env.local` and Vercel. Keep SSL enabled.
4. Run `npm run db:setup` once against that database.

Free-plan limits can change: consult [Neon pricing](https://neon.com/pricing). The answer key resides in `assessments.content`; never expose the database connection string or give the browser direct table access.

## 2. Register GitHub OAuth

Register an OAuth App in GitHub developer settings:

| Setting | Value |
| --- | --- |
| Homepage URL | Your production `APP_URL` |
| Authorization callback URL | `https://YOUR-DOMAIN/api/auth/callback` |
| Client ID | `GITHUB_CLIENT_ID` |
| Client secret | `GITHUB_CLIENT_SECRET` |

For local development, use a separate OAuth App with callback `http://localhost:3000/api/auth/callback`. Generate a random `SESSION_SECRET` of at least 32 characters. Changing it invalidates existing sessions. Sign-in authenticates identity; repository access is performed by the separately installed GitHub App.

## 3. Register the GitHub App

Register a GitHub App under the owning account/organization. Set its homepage to `APP_URL` and its webhook URL to `https://YOUR-DOMAIN/api/webhooks/github`. Set a strong webhook secret and copy it to `GITHUB_WEBHOOK_SECRET`.

Repository permissions:

| Permission | Access |
| --- | --- |
| Contents | Read-only |
| Pull requests | Read-only |
| Checks | Read and write |
| Metadata | Read-only, granted by GitHub |

Subscribe to **Pull request** events. Opening, reopening, editing or updating a PR publishes a pending check unless the exact current version already has a stored passing result. Replayed events preserve that result. Webhooks never execute repository code. Target-branch pushes do not trigger broad invalidation in this MVP: require branches to be up to date before merging as described below.

Copy the App ID into `GITHUB_APP_ID`. Generate a private key, and store its full PEM value in `GITHUB_APP_PRIVATE_KEY`. Escaped `\n` newlines are supported; do not commit the key. Install this App in the organization with access to selected repositories. OAuth access alone is insufficient to write the check.

## 4. Configure your model

Set `GENERATIVE_API_KEY`, `GENERATIVE_MODEL` and `GENERATIVE_API_BASE_URL`. The base URL defaults to `https://api.openai.com/v1`; use another provider if it supports the compatible chat-completions request used in `src/lib/generator.ts`.

The model produces structured explanations and ten QCM questions. PRs over 100 changed files or the 60,000-character context limit are rejected rather than silently truncating code; split these changes into smaller PRs. Binary files and omitted or truncated GitHub patches are also rejected; this MVP cannot assess those changes. Confirm this limitation is acceptable before making the check mandatory. The backend validates its output and grades answers deterministically. Jev is not required. Configure usage budgets with your model provider; generation cost is separate from free hosting/database allowances. Repository code is sent to that provider, so choose one approved by your team.

## 5. Create the new repository and deploy

Create a **new** GitHub repository such as `pr-understanding`, then push this project there. Do not replace an existing application repository. If starting from the delivered archive, extract it first and initialize Git in the extracted project directory.

```bash
git init
git add .
git commit -m "Add independent PR understanding app"
git branch -M main
git remote add origin https://github.com/YOUR-OWNER/pr-understanding.git
git push -u origin main
```

Import that repository into Vercel with the Next.js preset. Add all `.env.example` variables as production environment variables, set `APP_URL` to the stable production URL and redeploy. Update both GitHub callback and webhook URLs to that same domain. Do not use a rotating preview URL for production OAuth or webhooks.

[Vercel Hobby](https://vercel.com/docs/plans/hobby) is limited to personal, noncommercial use. Its [Git integration](https://vercel.com/docs/git) cannot deploy a private GitHub organization repository to Hobby. For an eligible student project, use a public standalone repository or an eligible personally owned repository; otherwise choose a suitable plan/provider. Public app source does not make target repository code public. Hosting and database quotas still apply.

Disable any deployment protection that prevents GitHub reaching the production webhook, or configure the provider's supported webhook access mechanism. Keep the rest of the website authenticated. Generation runs within a serverless request, so a slow provider or large PR can hit runtime limits; failed generation must be retried and never grants validation.

## 6. Pilot and require validation before merging

First test on one repository, before enabling a required check:

1. Add that repository to the app allowlist and GitHub App installation access.
2. Open a PR targeting `main`, sign in as its author and submit its URL in this app.
3. Verify a score of 8/10 fails and 9/10 passes; verify the check appears in GitHub.
4. Push another commit and confirm the previous result does not validate the new version.
5. Push to `main`, confirm GitHub blocks the outdated branch, then update the PR branch and complete its new assessment. Also test editing the PR base.
6. Confirm webhook deliveries succeed in GitHub App settings.

Then create a ruleset or branch protection rule targeting `main`:

- Require a pull request before merging.
- Require status check **`developer-understanding`**, with this GitHub App as the expected source.
- Preserve the existing CI check requirements.
- **Require the branch to be up to date before merging.** This is essential: a check belongs to the head commit and cannot itself prevent reuse after `main` changes. Updating the branch changes its head and requires a new quiz. If your plan/settings cannot enforce this, do not use this MVP as an enforced merge gate.
- Restrict direct pushes and avoid routine bypass permissions, including administrator bypass where configurable.

The check must have appeared recently to select it in GitHub's settings. Do not enable it before the app works, or all merges will remain blocked. A skipped/neutral check can satisfy some GitHub required-check configurations; this app should publish actual success only for a passing assessment and failure/pending for other states.

The app rejects a head commit shared by another open PR to `main`, because GitHub checks attach to commits rather than PRs. Give each open PR its own head commit. Check publication is serialized in PostgreSQL; temporary contention requests a retry and does not bypass validation.

GitHub plans determine protection availability. See [protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) and [organization rulesets](https://docs.github.com/en/organizations/managing-organization-settings/creating-rulesets-for-repositories-in-your-organization). This MVP targets ordinary PR merges into `main`; merge queues require additional event/check support before use.

## Add another repository later

**No application code or CI workflow changes in that repository are required.** All three steps below are necessary:

1. **Policy:** append its exact `owner/repository` to the comma-separated `ALLOWED_REPOSITORIES` environment variable in Vercel. Redeploy for environment changes to take effect. Example: append `Mooroon5-CNP/new-application`.
2. **Access:** open the GitHub App installation settings, choose Configure, and grant access to that repository. For another organization, the organization owner must allow/install the same App there.
3. **Enforcement:** repeat the pilot above and add the required `developer-understanding` check to that repository's `main` protection, or extend an organization ruleset that already targets it.

To opt in an entire organization, set `ALLOWED_ORGANIZATIONS=Mooroon5-CNP` (or a comma-separated list). This intentionally permits current and future repositories in those organizations; GitHub App installation permissions still restrict actual access. To cover future repositories automatically, install the App with **All repositories** access and use a ruleset targeting all desired repositories, where your GitHub plan supports it. Keep organization-wide access empty if you prefer explicit onboarding.

To remove a repository, first decide how its merge protection should work after removal. Remove or replace the required check if necessary, then remove it from the app policy and App installation. Removing access while the check stays required blocks merging.

The initial exact allowlist in `.env.example` includes the eight previously identified CNP repositories. It is configuration, not automatic installation or protection setup.

## Project notes

See [architecture](docs/ARCHITECTURE.md) and [delivery tasks](docs/TASKS.md) for boundaries, agent ownership and rollout acceptance. A quiz supports learning but cannot establish whether answers were completed without outside assistance.
