import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { requireBearerToken } from "../lib/auth";
import { startRun } from "../lib/startRun";

interface Body {
  owner: string;
  repo: string;
  requestYaml: string;
}

/**
 * POST /runs — starts a run without a GitHub webhook at all. This is the fastest path
 * to trying the deployed pipeline: no App registration, no push event, just a repo and
 * a request.yaml body. "A run can also be started from the UI" per docs/02 §10 — this
 * is that path's API, ahead of any UI existing.
 */
export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const auth = await requireBearerToken(event);
  if (!auth.ok) return { statusCode: auth.statusCode, body: auth.body };

  let body: Body;
  try {
    body = JSON.parse(event.body ?? "{}");
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "body must be JSON" }) };
  }
  if (!body.owner || !body.repo || !body.requestYaml) {
    return { statusCode: 400, body: JSON.stringify({ error: "owner, repo and requestYaml are required" }) };
  }

  const run = await startRun({ owner: body.owner, name: body.repo }, body.requestYaml);
  return { statusCode: 202, body: JSON.stringify({ runId: run.runId }) };
};
