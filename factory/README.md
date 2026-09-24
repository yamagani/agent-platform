# Spec-to-PR Factory — Phase 1

A working slice of the design in [`../docs/02-spec-to-pr-factory.md`](../docs/02-spec-to-pr-factory.md):
**intake → recon → analyst → Gate A → publisher**, on AWS serverless. It proves the
riskiest integration in the whole design — webhook → orchestration → human gate → PR —
per that doc's own Phase 1 acceptance criteria (§13), and is useful standalone as a
requirements clarifier even before a single line of generated code exists.

Everything else in the full design (the coder/tester loop, the two-project CodeBuild
containment, the revision DAG, Cognito + AppSync + a React run UI) is real, load-bearing
design for later phases — it just isn't code yet. Where this implementation simplifies
something from the docs, the code says so in a comment, with a pointer to the doc section
and the reason it's deferred rather than wrong.

## Try it in 30 seconds — no AWS account needed

```bash
npm install
npm run demo
```

This runs all four stages in-process against a bundled sample repo and request, using a
deterministic mock model (no Bedrock call, no AWS credentials). It writes every artifact
under `demo-output/runs/<runId>/1/<stage>/` — open `requirements.md` there to see what the
analyst produced — and prints the branch name and PR body the publisher *would* create.
**The demo never pushes to GitHub or calls a real model**, regardless of what's in `.env`.

Point recon at a real repo instead of the fixture (still a dry-run publish):

```bash
GITHUB_TOKEN=ghp_xxx GITHUB_OWNER=your-org GITHUB_REPO=your-repo npm run demo
```

Use the real model instead of the mock:

```bash
FACTORY_LLM_PROVIDER=bedrock AWS_REGION=us-east-1 npm run demo
```

## Deploying the real pipeline

Requires an AWS account with CDK bootstrapped (`npx cdk bootstrap`) and, if you want the
analyst to call a real model, Bedrock model access enabled for the model in
`BEDROCK_MODEL_ID` (`.env.example`).

```bash
npm install
npm run build
npm run deploy
```

This creates: an S3 artifact bucket, a DynamoDB table, a Step Functions Standard state
machine, an HTTP API, an SNS topic for Gate A notifications, and two Secrets Manager
secrets (empty — you fill them in next). Note the `ApiEndpoint`, `GithubSecretArn` and
`ApiTokenSecretArn` values CDK prints.

### 1. Fill in the GitHub secret

Simplest path, a personal access token with repo read/write:

```bash
aws secretsmanager put-secret-value --secret-id <GithubSecretArn> --secret-string '{
  "githubToken": "ghp_xxx",
  "githubWebhookSecret": "choose-a-random-string-and-reuse-it-in-step-3"
}'
```

For production, register a GitHub App instead (short-lived, repo-scoped installation
tokens — see `docs/adr/0008-codebuild-for-repo-stages-two-projects.md` for why a standing
PAT is worth replacing) and put `githubAppId` / `githubAppPrivateKey` /
`githubAppInstallationId` in the same secret instead of `githubToken`.

### 2. Read the operator API token

```bash
aws secretsmanager get-secret-value --secret-id <ApiTokenSecretArn> --query SecretString --output text
```

This bearer token gates `POST /runs` and gate decisions — see the note in
`lib/factory-stack.ts` on why Phase 1 uses one shared token instead of the Cognito-backed
surface in `docs/02-spec-to-pr-factory.md` §9.

### 3. Point a webhook at the API, or skip it

Either register a GitHub App / repo webhook for `push` events at
`<ApiEndpoint>/webhooks/github` with the same secret as `githubWebhookSecret` above, **or**
skip webhooks entirely and start runs directly:

```bash
curl -X POST <ApiEndpoint>/runs \
  -H "Authorization: Bearer <api-token>" \
  -H "Content-Type: application/json" \
  -d '{"owner":"your-org","repo":"your-repo","requestYaml":"<contents of .factory/request.yaml>"}'
```

### 4. Decide Gate A

The SNS notification (subscribe an email at deploy time with
`cdk deploy -c gateNotifyEmail=you@example.com`) includes the decision call:

```bash
curl -X POST <ApiEndpoint>/runs/<runId>/gates/A/decision \
  -H "Authorization: Bearer <api-token>" \
  -H "Content-Type: application/json" \
  -d '{"decision":"approve","decidedBy":"you@example.com"}'
```

or, to send it back for another pass — intake and recon are not rerun:

```bash
  -d '{"decision":"revise","decidedBy":"you@example.com","answers":[{"id":"OQ1","answer":"..."}]}'
```

## Layout

```
bin/factory.ts            CDK app entry
lib/factory-stack.ts       the whole stack: storage, secrets, Lambdas, state machine, HTTP API
src/types.ts               the artifact shapes every stage passes to the next (ADR 0006)
src/stages/*.ts            pure stage functions — no AWS SDK calls, easy to unit test
src/lib/*.ts               S3/DynamoDB/GitHub/Bedrock/schema adapters the stages are given
src/handlers/*.ts          thin Lambda wrappers: adapt an event, call a stage, store the result
scripts/demo.ts            runs the stage functions locally against fixtures
test/*.test.ts             node:test unit tests for the pure stage functions
```

The `src/stages/*` / `src/handlers/*` split is the point: a stage function takes typed
input and an injected client (`GithubClient`, `AnalystModel`) and returns typed output —
nothing in it knows whether it's running in Lambda or in `npm run demo`. That's what makes
both `lib/factory-stack.ts` and `scripts/demo.ts` thin wiring around the same logic.

## What's deliberately not here yet

- **Architect, Planner, Coder, Tester, Reviewer stages, Gates B/C.** Phase 1 stops at a
  requirements-only PR by design (`docs/02-spec-to-pr-factory.md` §13).
- **CodeBuild / the two-project network split.** Nothing generates or runs arbitrary code
  yet, so there's nothing to contain. Recon reads the repo through the GitHub API instead
  of cloning it — see the comment in `src/stages/recon.ts`.
- **The revision DAG and reprocess-from-any-stage model** (`docs/02` §3 / ADR 0007). With
  one linear stage sequence there's only one thing to revise; this becomes real once an
  Architect stage exists to reprocess into.
- **Cognito + AppSync + a run UI** (`docs/02` §9). One bearer-token API stands in.
- **Pulling the skill pack from the Agent Platform's S3 release** (ADR 0009). The
  analyst's prompt is inlined in `src/lib/llm.ts` rather than compiled from a plugin —
  worth wiring up once the platform side of this repo has something to publish.
