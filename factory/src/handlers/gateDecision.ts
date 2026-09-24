import { SendTaskFailureCommand, SendTaskSuccessCommand, SFNClient } from "@aws-sdk/client-sfn";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { requireBearerToken } from "../lib/auth";
import { requireEnv } from "../lib/env";
import { DynamoRunStore } from "../lib/runStore";
import type { AnswerToQuestion } from "../types";

const runs = new DynamoRunStore(requireEnv("TABLE_NAME"));
const sfn = new SFNClient({});

interface DecisionBody {
  decision: "approve" | "revise";
  note?: string;
  answers?: AnswerToQuestion[];
  decidedBy: string;
}

/**
 * POST /runs/{runId}/gates/{gateId}/decision — the human side of a .waitForTaskToken
 * gate. This is intentionally a plain API-key-authenticated Lambda for Phase 1, not
 * the Cognito + AppSync + React surface in docs/02 §9 — that fuller surface is worth
 * building once more than one gate exists and a run list is worth looking at.
 */
export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const auth = await requireBearerToken(event);
  if (!auth.ok) return { statusCode: auth.statusCode, body: auth.body };

  const runId = event.pathParameters?.runId;
  const gateId = event.pathParameters?.gateId;
  if (!runId || !gateId) {
    return { statusCode: 400, body: JSON.stringify({ error: "runId and gateId are required path parameters" }) };
  }

  let body: DecisionBody;
  try {
    body = JSON.parse(event.body ?? "{}");
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "body must be JSON" }) };
  }
  if (body.decision !== "approve" && body.decision !== "revise") {
    return { statusCode: 400, body: JSON.stringify({ error: 'decision must be "approve" or "revise"' }) };
  }

  // repo is not needed to look up a gate's task token, so a placeholder is fine here.
  const run = { runId, revision: "current", repo: { owner: "", name: "" } };
  const taskToken = await runs.getGateTaskToken(run, gateId);
  if (!taskToken) {
    return { statusCode: 404, body: JSON.stringify({ error: `no open gate ${gateId} for run ${runId}` }) };
  }

  const decidedBy = body.decidedBy || "unknown";
  const decisionRecord = { decision: body.decision, note: body.note, answers: body.answers, decidedBy, decidedAt: new Date().toISOString() };

  await runs.recordGateDecision(run, gateId, decisionRecord);

  try {
    await sfn.send(new SendTaskSuccessCommand({ taskToken, output: JSON.stringify(decisionRecord) }));
  } catch (err) {
    // The most common cause here is a stale/expired task token — surface that plainly
    // rather than as a generic 500.
    await sfn.send(new SendTaskFailureCommand({ taskToken, error: "GateDecisionFailed", cause: String(err) })).catch(() => {});
    return { statusCode: 409, body: JSON.stringify({ error: `could not resume run: ${String(err)}` }) };
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true, runId, gateId, decision: decisionRecord.decision }) };
};
