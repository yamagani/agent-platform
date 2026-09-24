import { S3ArtifactStore } from "../lib/artifacts";
import { requireEnv } from "../lib/env";
import { createAnalystModel } from "../lib/llm";
import { DynamoRunStore } from "../lib/runStore";
import { runAnalyst } from "../stages/analyst";
import type { AnswerToQuestion, ChangeRequest, IntakeArtifact, RepoFactsArtifact, RunRef } from "../types";

const artifacts = new S3ArtifactStore(requireEnv("ARTIFACT_BUCKET"));
const runs = new DynamoRunStore(requireEnv("TABLE_NAME"));
const model = createAnalystModel();

interface Event {
  run: RunRef;
  intake: IntakeArtifact;
  repoFacts: RepoFactsArtifact;
  /** Present only on a Gate A "revise" loop. */
  gateADecision?: { decision: "approve" | "revise"; answers?: AnswerToQuestion[] };
}

/** Step Functions task: Analyst. On a revise loop this re-runs with the user's
 * answers as an extra input — never by rerunning intake or recon (docs/02 §2). */
export const handler = async (event: Event) => {
  const request: ChangeRequest = event.intake.request;
  const requirements = await runAnalyst(
    { request, repoFacts: event.repoFacts, priorAnswers: event.gateADecision?.answers },
    model,
  );
  const stored = await artifacts.put(event.run, "analyst", "requirements.json", JSON.stringify(requirements, null, 2));
  await artifacts.put(event.run, "analyst", "requirements.md", requirements.markdown);
  await runs.putStage(event.run, "analyst", { status: "SUCCEEDED", artifactKey: stored.key, sha256: stored.sha256 });
  return requirements;
};
