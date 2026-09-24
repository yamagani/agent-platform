/* eslint-disable no-console */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LocalArtifactStore } from "../src/lib/artifacts";
import { FixtureGithubClient, createGithubClient, type GithubClient } from "../src/lib/github";
import { createAnalystModel } from "../src/lib/llm";
import { InMemoryRunStore } from "../src/lib/runStore";
import { runIntake } from "../src/stages/intake";
import { runRecon } from "../src/stages/recon";
import { runAnalyst } from "../src/stages/analyst";
import { runPublisher } from "../src/stages/publisher";
import type { AnswerToQuestion, RunRef } from "../src/types";

/**
 * Runs Phase 1 end to end — intake, recon, analyst, a simulated Gate A, publisher —
 * against local fixtures, with no AWS account and no GitHub write access required.
 * This is the fastest way to see the pipeline actually work; `npm run deploy` stands
 * up the same stage functions for real, behind a webhook and a state machine.
 *
 * Recon reads a real repo if GITHUB_TOKEN/GITHUB_OWNER/GITHUB_REPO are set (useful to
 * sanity-check recon against something real); publishing is ALWAYS a dry run here —
 * this script never pushes a branch or opens a PR, regardless of credentials.
 */
async function main() {
  const run: RunRef = { runId: `demo-${randomUUID().slice(0, 8)}`, revision: "1", repo: resolveRepo() };
  const artifacts = new LocalArtifactStore(join(__dirname, "..", "demo-output"));
  const runs = new InMemoryRunStore();

  console.log(`\n=== run ${run.runId} ===\n`);

  console.log("-> intake");
  const requestYaml = readFileSync(join(__dirname, "..", "fixtures", "sample-request.yaml"), "utf8");
  const intake = runIntake({ requestYaml, repo: run.repo });
  await artifacts.put(run, "intake", "intake.json", JSON.stringify(intake, null, 2));
  await runs.putStage(run, "intake", { status: "SUCCEEDED" });
  console.log(`   ${intake.request.metadata.title}`);

  console.log("-> recon");
  const github = await resolveRecondGithubClient();
  const repoFacts = await runRecon({ owner: run.repo.owner, repo: run.repo.name }, github);
  await artifacts.put(run, "recon", "repo-facts.json", JSON.stringify(repoFacts, null, 2));
  await runs.putStage(run, "recon", { status: "SUCCEEDED" });
  console.log(`   languages: ${repoFacts.languages.join(", ") || "(none detected)"}`);

  const model = createAnalystModel();
  console.log(`-> analyst (${process.env.FACTORY_LLM_PROVIDER ?? "mock"})`);
  let requirements = await runAnalyst({ request: intake.request, repoFacts }, model);
  await artifacts.put(run, "analyst", "requirements.md", requirements.markdown);

  console.log("-> Gate A");
  if (requirements.openQuestions.length > 0) {
    console.log(`   ${requirements.openQuestions.length} open question(s) — simulating a "revise" decision with demo answers`);
    const answers: AnswerToQuestion[] = requirements.openQuestions.map((q) => ({
      id: q.id,
      answer: "[demo answer] assume current scale, no special handling needed",
    }));
    console.log("-> analyst (revise loop — intake and recon are not rerun)");
    requirements = await runAnalyst({ request: intake.request, repoFacts, priorAnswers: answers }, model);
    await artifacts.put(run, "analyst", "requirements.md", requirements.markdown);
  }
  console.log("   approved (auto-approved for the demo)");

  console.log("-> publisher (dry run — no branch pushed, no PR opened)");
  const result = await runPublisher(run, intake.request, requirements, new FixtureGithubClient({}));

  console.log(`\n=== done ===`);
  console.log(`branch:  ${result.branch}`);
  console.log(`base:    ${intake.request.spec.targetBranch}`);
  console.log(`PR (dry run): ${result.prUrl}`);
  console.log(`\nartifacts written under demo-output/runs/${run.runId}/${run.revision}/`);
}

function resolveRepo(): { owner: string; name: string } {
  return { owner: process.env.GITHUB_OWNER ?? "demo-org", name: process.env.GITHUB_REPO ?? "sample-billing-service" };
}

async function resolveRecondGithubClient(): Promise<GithubClient> {
  if (process.env.GITHUB_TOKEN && process.env.GITHUB_OWNER && process.env.GITHUB_REPO) {
    console.log("   (recon reading the real repo — GITHUB_TOKEN is set)");
    return createGithubClient();
  }
  const files = JSON.parse(readFileSync(join(__dirname, "..", "fixtures", "sample-repo-files.json"), "utf8"));
  return new FixtureGithubClient(files);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
