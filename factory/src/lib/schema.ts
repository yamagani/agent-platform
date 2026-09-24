import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import type { ChangeRequest } from "../types";

// The schema lives at the repo root (schemas/factory-request.schema.json), one level
// above this package, so the contract has exactly one copy regardless of who reads it.
const SCHEMA_PATH = join(__dirname, "..", "..", "..", "schemas", "factory-request.schema.json");

let validator: ValidateFunction | undefined;

function getValidator(): ValidateFunction {
  if (!validator) {
    const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    validator = ajv.compile(schema);
  }
  return validator;
}

export interface SchemaValidationError {
  path: string;
  message: string;
}

export type SchemaValidationResult =
  | { valid: true; request: ChangeRequest }
  | { valid: false; errors: SchemaValidationError[] };

/**
 * Validates a parsed request.yaml document against the factory-request schema and
 * fails with line-level (JSON-pointer) errors rather than guessing at intent — the
 * intake stage's whole job per docs/02-spec-to-pr-factory.md §7.
 */
export function validateChangeRequest(candidate: unknown): SchemaValidationResult {
  const validate = getValidator();
  const valid = validate(candidate);
  if (valid) {
    return { valid: true, request: candidate as ChangeRequest };
  }
  const errors: SchemaValidationError[] = (validate.errors ?? []).map((e) => ({
    path: e.instancePath || "/",
    message: e.message ?? "invalid",
  }));
  return { valid: false, errors };
}
