import { requireEnv } from "../lib/env";
import { createGithubClient } from "../lib/github";
import { DynamoRunStore } from "../lib/runStore";
import { applyGithubEnv } from "../lib/secrets";
import { runPublisher } from "../stages/publisher";
import type { IntakeArtifact, RequirementsArtifact, RunRef } from "../types";

const runs = new DynamoRunStore(requireEnv("TABLE_NAME"));

interface Event {
  run: RunRef;
  intake: IntakeArtifact;
  requirements: RequirementsArtifact;
}

/** Step Functions task: Publisher (Phase 1 shape — requirements-only PR). */
export const handler = async (event: Event) => {
  await applyGithubEnv();
  const github = await createGithubClient();
  const result = await runPublisher(event.run, event.intake.request, event.requirements, github);
  await runs.putStage(event.run, "publisher", { status: "SUCCEEDED", ...result });
  return result;
};
