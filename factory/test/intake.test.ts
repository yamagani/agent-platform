import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { IntakeValidationError, runIntake } from "../src/stages/intake";

const repo = { owner: "demo-org", name: "sample-billing-service" };

test("runIntake accepts the bundled sample request", () => {
  const requestYaml = readFileSync(join(__dirname, "..", "fixtures", "sample-request.yaml"), "utf8");
  const result = runIntake({ requestYaml, repo });
  assert.equal(result.request.metadata.title, "Add refund reconciliation report");
  assert.equal(result.repo.owner, "demo-org");
});

test("runIntake rejects a request missing required fields, with a path-level error", () => {
  const badYaml = "apiVersion: factory/v1\nkind: ChangeRequest\nmetadata:\n  title: too short\n";
  assert.throws(
    () => runIntake({ requestYaml: badYaml, repo }),
    (err: unknown) => {
      assert.ok(err instanceof IntakeValidationError);
      assert.ok(err.errors.length > 0);
      return true;
    },
  );
});

test("runIntake rejects invalid YAML without throwing a raw parser exception", () => {
  assert.throws(() => runIntake({ requestYaml: "not: [valid", repo }), IntakeValidationError);
});
