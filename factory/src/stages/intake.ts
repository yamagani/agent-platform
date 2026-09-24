import { parse as parseYaml } from "yaml";
import { validateChangeRequest } from "../lib/schema";
import type { IntakeArtifact } from "../types";

export class IntakeValidationError extends Error {
  constructor(public readonly errors: Array<{ path: string; message: string }>) {
    super(`request.yaml failed schema validation:\n${errors.map((e) => `  ${e.path}: ${e.message}`).join("\n")}`);
    this.name = "IntakeValidationError";
  }
}

/**
 * Stage 0 — Intake. Validates .factory/request.yaml against the schema and fails fast
 * with line-level errors rather than guessing (docs/02-spec-to-pr-factory.md §7).
 * A parse or schema failure throws; the caller (Lambda handler or demo script) decides
 * how to surface that as a stage failure.
 */
export function runIntake(input: { requestYaml: string; repo: { owner: string; name: string } }): IntakeArtifact {
  let candidate: unknown;
  try {
    candidate = parseYaml(input.requestYaml);
  } catch (err) {
    throw new IntakeValidationError([{ path: "/", message: `not valid YAML: ${(err as Error).message}` }]);
  }

  const result = validateChangeRequest(candidate);
  if (!result.valid) throw new IntakeValidationError(result.errors);

  return { request: result.request, repo: input.repo, validatedAt: new Date().toISOString() };
}
