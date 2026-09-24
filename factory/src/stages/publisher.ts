import type { GithubClient, RepoRef } from "../lib/github";
import type { ChangeRequest, PublisherResult, RequirementsArtifact, RunRef } from "../types";

/**
 * Stage 9 — Publisher, Phase 1 shape: opens a PR containing only the approved
 * requirements document (docs/02-spec-to-pr-factory.md §13, Phase 1 accept criteria).
 * The branch name is derived from the run id — the model never chooses the push
 * target — and the call is idempotent by construction: GithubClient.openPullRequest
 * looks up an existing PR for the branch before creating anything (§10).
 */
export async function runPublisher(
  run: RunRef,
  request: ChangeRequest,
  requirements: RequirementsArtifact,
  github: GithubClient,
): Promise<PublisherResult> {
  const ref: RepoRef = { owner: run.repo.owner, repo: run.repo.name };
  const branch = `${request.spec.branchPrefix}${run.runId}`;

  const body = [
    `Requirements clarified and approved at Gate A for run \`${run.runId}\` (revision \`${run.revision}\`).`,
    "",
    "This PR carries the requirements document only — Phase 1 of the factory stops here.",
    "Design, code, tests and review land in later phases once those stages exist.",
    "",
    `Requested by: ${request.metadata.requestedBy}`,
  ].join("\n");

  return github.openPullRequest(ref, {
    branch,
    base: request.spec.targetBranch,
    title: `[factory] ${request.metadata.title}`,
    body,
    files: [{ path: `.factory/runs/${run.runId}/requirements.md`, content: requirements.markdown }],
  });
}
