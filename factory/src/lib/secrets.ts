import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

export interface GithubSecret {
  /** Simplest path: a PAT. Fine for trying the factory out; ADR 0008 / docs/02 §10 call
   * for a GitHub App in production because installation tokens are short-lived and
   * repo-scoped where a PAT is a standing credential — swap to the app* fields below
   * once you've registered one. */
  githubToken?: string;
  githubAppId?: string;
  githubAppPrivateKey?: string;
  githubAppInstallationId?: string;
  githubWebhookSecret: string;
}

const client = new SecretsManagerClient({});
let cached: GithubSecret | undefined;

/** Memoized per warm Lambda execution environment — one Secrets Manager read per
 * cold start, not per invocation. */
export async function loadGithubSecret(): Promise<GithubSecret> {
  if (cached) return cached;
  const arn = process.env.GITHUB_SECRET_ARN;
  if (!arn) throw new Error("GITHUB_SECRET_ARN is not set");
  const res = await client.send(new GetSecretValueCommand({ SecretId: arn }));
  if (!res.SecretString) throw new Error(`secret ${arn} has no string value`);
  cached = JSON.parse(res.SecretString) as GithubSecret;
  return cached;
}

/** Populates the env vars src/lib/github.ts reads, from whichever credential shape
 * the secret holds. Call once at the top of any handler that talks to GitHub. */
export async function applyGithubEnv(): Promise<void> {
  const secret = await loadGithubSecret();
  if (secret.githubToken) {
    process.env.GITHUB_TOKEN = secret.githubToken;
    return;
  }
  if (secret.githubAppId && secret.githubAppPrivateKey && secret.githubAppInstallationId) {
    process.env.GITHUB_APP_ID = secret.githubAppId;
    process.env.GITHUB_APP_PRIVATE_KEY = secret.githubAppPrivateKey;
    process.env.GITHUB_APP_INSTALLATION_ID = secret.githubAppInstallationId;
    return;
  }
  throw new Error("factory/github secret has neither githubToken nor a full githubApp* triple set");
}
