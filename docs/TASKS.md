# Delivery tasks

This project is independent of the CNP portal and the application repositories. Agent ownership below describes the implementation split, not GitHub issue assignments.

| Owner | Task | Acceptance |
| --- | --- | --- |
| Main agent | Project scaffold, integration and delivery | Next.js project builds, environment checks are clear, and source is ready for a new repository. |
| GitHub/auth agent | OAuth, sessions, GitHub App client and webhooks | Signed-in GitHub identity; validated webhook signatures; repository access restrictions; checks published with installation tokens. |
| Assessment agent | Database, generation and grading | Private answer key; ten validated questions; author-only attempts; strictly greater than 80%; head/base freshness checks. |
| UI agent | PR lookup, explanation and quiz screens | User can select a repository, enter PR number or URL, study changes and submit answers without receiving the answer key. |
| Security review agent | Review identity, freshness, publication races and retry paths | Reviewed fixes to per-head locks, duplicate-head rejection, generation leases and check retry. |
| Documentation agent | Setup and repository onboarding | A developer can provision Neon, register GitHub integrations, deploy and add another repository using README alone. |

## Phase 1 — implementation

- [x] Integrate agent contributions and run automated verification (27 tests and production build).
- [x] Confirm no answer key is present in public assessment responses.
- [x] Confirm 8/10 fails and 9/10 passes.
- [x] Confirm wrong authors and obsolete PR versions are rejected.
- [x] Confirm model failure never produces a successful check in isolated backend tests.

## Phase 2 — account configuration

- [ ] Create a new repository for this project and publish the source.
- [ ] Create a Neon Free project and apply `db/schema.sql`.
- [ ] Register GitHub OAuth and GitHub App credentials.
- [ ] Supply a generative model API key.
- [ ] Deploy the website and set production callback/webhook URLs.

These steps require the account owner and real credentials. Local verification does not establish that GitHub, the database or the model work in production.

## Phase 3 — pilot before enforcement

- [ ] Install the GitHub App on one pilot repository.
- [ ] Open a real PR and verify explanation, quiz, failed attempt and passing attempt.
- [ ] Push a new commit and confirm prior validation cannot authorize it.
- [ ] Update `main` and verify the freshness policy.
- [ ] Enable the required check only after the pilot succeeds.
- [ ] Add the remaining repositories using the README onboarding procedure.

## Future work

- Review generated-question quality with the team.
- Add durable background generation if PR size/traffic exceeds serverless request limits.
- Add operational alerts and retention policies appropriate to the deployed usage.
- Consider Jev only for a measured question-quality/classification use case; deterministic QCM grading requires no AI.

## Verification limits

The production build and 27 isolated tests pass. A local HTTP smoke test returned 200 for the home/health pages, 403 for cross-origin assessment creation and 401 for an unsigned webhook. Real OAuth, Neon, model generation and GitHub check delivery still require a configured pilot. Browser visual verification was unavailable in the execution environment.
