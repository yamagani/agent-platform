import type { GithubClient, RepoRef } from "../lib/github";
import type { RepoFactsArtifact } from "../types";

interface ManifestRule {
  file: string;
  language: string;
  framework?: (content: string) => string | undefined;
  testCommand: string;
}

const RULES: ManifestRule[] = [
  {
    file: "package.json",
    language: "JavaScript/TypeScript",
    framework: (content) => {
      const pkg = safeJson(content);
      const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
      if (deps.next) return "Next.js";
      if (deps.react) return "React";
      if (deps.express) return "Express";
      return undefined;
    },
    testCommand: "npm test",
  },
  { file: "pyproject.toml", language: "Python", testCommand: "pytest" },
  { file: "requirements.txt", language: "Python", testCommand: "pytest" },
  { file: "go.mod", language: "Go", testCommand: "go test ./..." },
  { file: "pom.xml", language: "Java", testCommand: "mvn test" },
  { file: "build.gradle", language: "Java/Kotlin", testCommand: "./gradlew test" },
  { file: "Gemfile", language: "Ruby", testCommand: "bundle exec rspec" },
  { file: "Cargo.toml", language: "Rust", testCommand: "cargo test" },
];

/**
 * Stage 1 — Recon, deliberately simplified for Phase 1: a Lambda reading the repo
 * through the GitHub API rather than a CodeBuild clone. Good enough to hand the
 * analyst real languages/frameworks/test-command context; a real clone-and-inspect
 * recon (needed once the coder stage exists) is Phase 3, per docs/02 §13, and reuses
 * the `factory-prepare` CodeBuild project already designed for that in ADR 0008.
 *
 * Every field returned here is repo-derived and therefore UNTRUSTED — see
 * docs/02-spec-to-pr-factory.md §11. Callers must keep treating it as data, not
 * instructions, exactly like retrieved knowledge-service content.
 */
export async function runRecon(ref: RepoRef, github: GithubClient): Promise<RepoFactsArtifact> {
  const rootFiles = await github.listRootFiles(ref);
  const languages = new Set<string>();
  const frameworks = new Set<string>();
  const manifestFiles: string[] = [];
  let suggestedTestCommand: string | null = null;

  for (const rule of RULES) {
    if (!rootFiles.includes(rule.file)) continue;
    manifestFiles.push(rule.file);
    languages.add(rule.language);
    suggestedTestCommand ??= rule.testCommand;
    if (rule.framework) {
      const content = await github.readFile(ref, rule.file);
      const framework = content ? rule.framework(content) : undefined;
      if (framework) frameworks.add(framework);
    }
  }

  const notes: string[] = [];
  if (manifestFiles.length === 0) {
    notes.push("no recognized manifest file at repo root — language/framework detection skipped");
  }

  return {
    provenance: "untrusted-repo-content",
    languages: [...languages],
    frameworks: [...frameworks],
    manifestFiles,
    suggestedTestCommand,
    moduleMap: rootFiles,
    notes,
  };
}

function safeJson(content: string): { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | undefined {
  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}
