import { S3ArtifactStore } from "../lib/artifacts";
import { requireEnv } from "../lib/env";
import { DynamoRunStore } from "../lib/runStore";
import { runIntake } from "../stages/intake";
import type { RunRef } from "../types";

const artifacts = new S3ArtifactStore(requireEnv("ARTIFACT_BUCKET"));
const runs = new DynamoRunStore(requireEnv("TABLE_NAME"));

interface Event {
  run: RunRef;
  requestYaml: string;
}

/** Step Functions task: Intake. See src/stages/intake.ts for the pure logic. */
export const handler = async (event: Event) => {
  const intake = runIntake({ requestYaml: event.requestYaml, repo: event.run.repo });
  const stored = await artifacts.put(event.run, "intake", "intake.json", JSON.stringify(intake, null, 2));
  await runs.putStage(event.run, "intake", { status: "SUCCEEDED", artifactKey: stored.key, sha256: stored.sha256 });
  return intake;
};
