import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";

export interface RepoRef {
  owner: string;
  repo: string;
}

export interface GithubClient {
  /** Manifest-style files at repo root, read for the recon stage. */
  listRootFiles(ref: RepoRef): Promise<string[]>;
  readFile(ref: RepoRef, path: string): Promise<string | null>;
  /** Idempotent: returns the existing PR if one already exists for `branch`. */
  openPullRequest(
    ref: RepoRef,
    input: { branch: string; base: string; title: string; body: string; files: Array<{ path: string; content: string }> },
  ): Promise<{ branch: string; prNumber: number; prUrl: string }>;
}

/**
 * A GitHub App installation token is minted here, at call time, never cached across
 * a stage boundary — see docs/02-spec-to-pr-factory.md §10 and ADR 0008. For local
 * development a plain PAT in GITHUB_TOKEN is accepted too: it is far easier to get a
 * demo running with a token than with a registered GitHub App, and the real pipeline
 * (lib/factory-stack.ts) wires the App-auth path by default.
 */
export async function createGithubClient(): Promise<GithubClient> {
  const octokit = await buildOctokit();
  return new OctokitGithubClient(octokit);
}

async function buildOctokit(): Promise<Octokit> {
  const pat = process.env.GITHUB_TOKEN;
  if (pat) return new Octokit({ auth: pat });

  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
  const installationId = process.env.GITHUB_APP_INSTALLATION_ID;
  if (!appId || !privateKey || !installationId) {
    throw new Error(
      "no GitHub credentials: set GITHUB_TOKEN for local use, or GITHUB_APP_ID / " +
        "GITHUB_APP_PRIVATE_KEY / GITHUB_APP_INSTALLATION_ID for the deployed pipeline",
    );
  }
  const auth = createAppAuth({ appId, privateKey, installationId: Number(installationId) });
  const installationAuth = await auth({ type: "installation" });
  return new Octokit({ auth: installationAuth.token });
}

const MANIFEST_CANDIDATES = [
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "Gemfile",
  "Cargo.toml",
];

class OctokitGithubClient implements GithubClient {
  constructor(private readonly octokit: Octokit) {}

  async listRootFiles(ref: RepoRef): Promise<string[]> {
    const { data } = await this.octokit.repos.getContent({ owner: ref.owner, repo: ref.repo, path: "" });
    if (!Array.isArray(data)) return [];
    return data.map((entry) => entry.name);
  }

  async readFile(ref: RepoRef, path: string): Promise<string | null> {
    try {
      const { data } = await this.octokit.repos.getContent({ owner: ref.owner, repo: ref.repo, path });
      if (Array.isArray(data) || data.type !== "file" || !data.content) return null;
      return Buffer.from(data.content, "base64").toString("utf8");
    } catch (err: unknown) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async openPullRequest(
    ref: RepoRef,
    input: { branch: string; base: string; title: string; body: string; files: Array<{ path: string; content: string }> },
  ): Promise<{ branch: string; prNumber: number; prUrl: string }> {
    const existing = await this.findOpenPr(ref, input.branch);
    if (existing) return existing;

    const base = await this.octokit.repos.getBranch({ owner: ref.owner, repo: ref.repo, branch: input.base });
    const baseSha = base.data.commit.sha;

    await this.createBranchIfMissing(ref, input.branch, baseSha);

    for (const file of input.files) {
      await this.putFile(ref, input.branch, file.path, file.content);
    }

    const pr = await this.octokit.pulls.create({
      owner: ref.owner,
      repo: ref.repo,
      head: input.branch,
      base: input.base,
      title: input.title,
      body: input.body,
    });
    return { branch: input.branch, prNumber: pr.data.number, prUrl: pr.data.html_url };
  }

  /** Publisher idempotency: a retried publish must not open a duplicate PR — see
   * docs/02-spec-to-pr-factory.md §10. */
  private async findOpenPr(
    ref: RepoRef,
    branch: string,
  ): Promise<{ branch: string; prNumber: number; prUrl: string } | null> {
    const { data } = await this.octokit.pulls.list({
      owner: ref.owner,
      repo: ref.repo,
      head: `${ref.owner}:${branch}`,
      state: "all",
    });
    const found = data[0];
    return found ? { branch, prNumber: found.number, prUrl: found.html_url } : null;
  }

  private async createBranchIfMissing(ref: RepoRef, branch: string, baseSha: string): Promise<void> {
    try {
      await this.octokit.git.createRef({ owner: ref.owner, repo: ref.repo, ref: `refs/heads/${branch}`, sha: baseSha });
    } catch (err: unknown) {
      if (!isAlreadyExists(err)) throw err;
    }
  }

  private async putFile(ref: RepoRef, branch: string, path: string, content: string): Promise<void> {
    let sha: string | undefined;
    try {
      const existing = await this.octokit.repos.getContent({ owner: ref.owner, repo: ref.repo, path, ref: branch });
      if (!Array.isArray(existing.data) && existing.data.type === "file") sha = existing.data.sha;
    } catch (err: unknown) {
      if (!isNotFound(err)) throw err;
    }
    await this.octokit.repos.createOrUpdateFileContents({
      owner: ref.owner,
      repo: ref.repo,
      path,
      branch,
      message: `factory: write ${path}`,
      content: Buffer.from(content, "utf8").toString("base64"),
      sha,
    });
  }
}

function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && "status" in err && (err as { status: unknown }).status === 404;
}

function isAlreadyExists(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    (err as { status: unknown }).status === 422
  );
}

/** Stands in for GitHub in `npm run demo`: no network call, no repo is touched. */
export class FixtureGithubClient implements GithubClient {
  constructor(private readonly files: Record<string, string>) {}

  async listRootFiles(): Promise<string[]> {
    return Object.keys(this.files);
  }

  async readFile(_ref: RepoRef, path: string): Promise<string | null> {
    return this.files[path] ?? null;
  }

  async openPullRequest(
    _ref: RepoRef,
    input: { branch: string; base: string; title: string; body: string; files: Array<{ path: string; content: string }> },
  ): Promise<{ branch: string; prNumber: number; prUrl: string }> {
    return { branch: input.branch, prNumber: 0, prUrl: `(dry run — no PR opened) branch ${input.branch} <- ${input.base}` };
  }
}
