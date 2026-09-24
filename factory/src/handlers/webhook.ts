import { createHmac, timingSafeEqual } from "node:crypto";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { createGithubClient } from "../lib/github";
import { applyGithubEnv, loadGithubSecret } from "../lib/secrets";
import { startRun } from "../lib/startRun";

const REQUEST_PATH = ".factory/request.yaml";

interface PushPayload {
  ref: string;
  repository: { name: string; owner: { login: string }; default_branch: string };
  commits: Array<{ added: string[]; modified: string[] }>;
}

/**
 * POST /webhooks/github. Verifies X-Hub-Signature-256 with a constant-time comparison
 * before any processing (docs/02-spec-to-pr-factory.md §10) — an invalid signature
 * never reaches JSON.parse, let alone GitHub API calls. Reacts to a push that touches
 * `.factory/request.yaml` on the repo's default branch and starts a run.
 */
export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const rawBody = event.isBase64Encoded ? Buffer.from(event.body ?? "", "base64").toString("utf8") : (event.body ?? "");

  const secret = await loadGithubSecret();
  if (!verifySignature(rawBody, event.headers["x-hub-signature-256"], secret.githubWebhookSecret)) {
    return { statusCode: 401, body: JSON.stringify({ error: "invalid signature" }) };
  }

  if (event.headers["x-github-event"] !== "push") {
    return { statusCode: 202, body: JSON.stringify({ ignored: event.headers["x-github-event"] ?? "unknown event" }) };
  }

  const payload: PushPayload = JSON.parse(rawBody);
  if (payload.ref !== `refs/heads/${payload.repository.default_branch}`) {
    return { statusCode: 202, body: JSON.stringify({ ignored: "not the default branch" }) };
  }
  const touchedRequestFile = payload.commits.some((c) => c.added.includes(REQUEST_PATH) || c.modified.includes(REQUEST_PATH));
  if (!touchedRequestFile) {
    return { statusCode: 202, body: JSON.stringify({ ignored: `no commit touched ${REQUEST_PATH}` }) };
  }

  const owner = payload.repository.owner.login;
  const repo = payload.repository.name;

  await applyGithubEnv();
  const github = await createGithubClient();
  const requestYaml = await github.readFile({ owner, repo }, REQUEST_PATH);
  if (!requestYaml) {
    return { statusCode: 422, body: JSON.stringify({ error: `${REQUEST_PATH} not found at HEAD` }) };
  }

  const run = await startRun({ owner, name: repo }, requestYaml);
  return { statusCode: 202, body: JSON.stringify({ runId: run.runId }) };
};

function verifySignature(rawBody: string, header: string | undefined, secret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(rawBody, "utf8").digest("hex"), "utf8");
  const actual = Buffer.from(header.slice("sha256=".length), "utf8");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
