import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { requireEnv } from "./env";

const client = new SecretsManagerClient({});
let cachedToken: string | undefined;

async function loadApiToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  const res = await client.send(new GetSecretValueCommand({ SecretId: requireEnv("API_TOKEN_SECRET_ARN") }));
  if (!res.SecretString) throw new Error("API token secret has no string value");
  cachedToken = res.SecretString;
  return cachedToken;
}

/**
 * A single shared bearer token gates POST /runs and gate decisions — deliberately
 * simple for Phase 1 (see the note in lib/factory-stack.ts on why this isn't Cognito
 * yet). Retrieve the token with:
 *   aws secretsmanager get-secret-value --secret-id <ApiTokenSecretArn> --query SecretString --output text
 */
export async function requireBearerToken(event: APIGatewayProxyEventV2): Promise<{ ok: true } | { ok: false; statusCode: number; body: string }> {
  const header = event.headers.authorization ?? event.headers.Authorization;
  const presented = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
  const expected = await loadApiToken();
  if (!presented || presented !== expected) {
    return { ok: false, statusCode: 401, body: JSON.stringify({ error: "missing or invalid bearer token" }) };
  }
  return { ok: true };
}
