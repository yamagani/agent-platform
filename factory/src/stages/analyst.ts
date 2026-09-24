import type { AnalystModel } from "../lib/llm";
import type { AnswerToQuestion, ChangeRequest, RepoFactsArtifact, RequirementsArtifact } from "../types";

/**
 * Stage 2 — Analyst. A pure function of its inputs: the change request, the (untrusted)
 * repo facts, and — on a Gate A revise loop — the user's answers to the previous open
 * questions. It never receives a transcript of how it got here (ADR 0006).
 */
export async function runAnalyst(
  input: { request: ChangeRequest; repoFacts: RepoFactsArtifact; priorAnswers?: AnswerToQuestion[] },
  model: AnalystModel,
): Promise<RequirementsArtifact> {
  return model.draftRequirements(input);
}
