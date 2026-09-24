import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { requireEnv } from "../lib/env";
import { DynamoRunStore } from "../lib/runStore";
import type { RequirementsArtifact, RunRef } from "../types";

const runs = new DynamoRunStore(requireEnv("TABLE_NAME"));
const sns = new SNSClient({});
const topicArn = process.env.NOTIFY_TOPIC_ARN;
const decisionApiBase = process.env.DECISION_API_BASE_URL;

interface Event {
  run: RunRef;
  requirements: RequirementsArtifact;
  /** Injected by the state machine via JsonPath.taskToken — see lib/factory-stack.ts. */
  taskToken: string;
}

/**
 * Step Functions task, .waitForTaskToken pattern: Gate A opening. Stores the task
 * token so a later, out-of-band call to gateDecision.ts can resume the execution —
 * the token lives as long as the execution, so there is no separate expiry to manage
 * beyond the state's own HeartbeatSeconds (docs/02-spec-to-pr-factory.md §3).
 * This handler returns immediately; the state stays paused until that call happens.
 */
export const handler = async (event: Event) => {
  await runs.openGate(event.run, "A", event.taskToken);

  if (topicArn) {
    const decisionUrl = decisionApiBase
      ? `${decisionApiBase}/runs/${event.run.runId}/gates/A/decision`
      : "(set DECISION_API_BASE_URL to include the decision endpoint here)";
    await sns.send(
      new PublishCommand({
        TopicArn: topicArn,
        Subject: `Gate A open — ${event.run.runId}`,
        Message: [
          `Requirements are ready for review on run ${event.run.runId}.`,
          "",
          event.requirements.markdown,
          "",
          `Decide at: POST ${decisionUrl}`,
          `{ "decision": "approve" }  or  { "decision": "revise", "note": "...", "answers": [{ "id": "OQ1", "answer": "..." }] }`,
        ].join("\n"),
      }),
    );
  }
};
