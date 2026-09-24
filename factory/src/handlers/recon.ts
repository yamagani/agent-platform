import { S3ArtifactStore } from "../lib/artifacts";
import { requireEnv } from "../lib/env";
import { createGithubClient } from "../lib/github";
import { DynamoRunStore } from "../lib/runStore";
import { applyGithubEnv } from "../lib/secrets";
import { runRecon } from "../stages/recon";
import type { RunRef } from "../types";

const artifacts = new S3ArtifactStore(requireEnv("ARTIFACT_BUCKET"));
const runs = new DynamoRunStore(requireEnv("TABLE_NAME"));

interface Event {
  run: RunRef;
}

/** Step Functions task: Recon. Phase 1 reads the repo through the GitHub API — see
 * src/stages/recon.ts for why, and what a Phase 3 CodeBuild-based recon adds. */
export const handler = async (event: Event) => {
  await applyGithubEnv();
  const github = await createGithubClient();
  const repoFacts = await runRecon({ owner: event.run.repo.owner, repo: event.run.repo.name }, github);
  const stored = await artifacts.put(event.run, "recon", "repo-facts.json", JSON.stringify(repoFacts, null, 2));
  await runs.putStage(event.run, "recon", { status: "SUCCEEDED", artifactKey: stored.key, sha256: stored.sha256 });
  return repoFacts;
};
