import assert from "node:assert/strict";
import { test } from "node:test";
import { FixtureGithubClient } from "../src/lib/github";
import { runRecon } from "../src/stages/recon";

test("runRecon detects language and framework from package.json", async () => {
  const github = new FixtureGithubClient({
    "package.json": JSON.stringify({ dependencies: { express: "^4.19.0" } }),
  });
  const facts = await runRecon({ owner: "demo-org", repo: "sample" }, github);

  assert.deepEqual(facts.languages, ["JavaScript/TypeScript"]);
  assert.deepEqual(facts.frameworks, ["Express"]);
  assert.equal(facts.suggestedTestCommand, "npm test");
  assert.equal(facts.provenance, "untrusted-repo-content");
});

test("runRecon notes when no manifest file is recognized", async () => {
  const github = new FixtureGithubClient({ "README.md": "hello" });
  const facts = await runRecon({ owner: "demo-org", repo: "sample" }, github);

  assert.deepEqual(facts.manifestFiles, []);
  assert.equal(facts.suggestedTestCommand, null);
  assert.ok(facts.notes.length > 0);
});
