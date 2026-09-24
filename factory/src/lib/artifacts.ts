import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { RunRef } from "../types";

export interface StoredArtifact {
  key: string;
  sha256: string;
}

/**
 * Artifacts are content-hashed and keyed by runs/<runId>/<revision>/<stage>/<artifact>,
 * per docs/02-spec-to-pr-factory.md §8. One interface, two backends: S3 for the
 * deployed pipeline, the local filesystem for `npm run demo` — the stage functions
 * that call this never know which one they're talking to.
 */
export interface ArtifactStore {
  put(run: RunRef, stage: string, name: string, body: string | Buffer): Promise<StoredArtifact>;
  get(run: RunRef, stage: string, name: string): Promise<string>;
}

function keyFor(run: RunRef, stage: string, name: string): string {
  return `runs/${run.runId}/${run.revision}/${stage}/${name}`;
}

function sha256(body: string | Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}

export class S3ArtifactStore implements ArtifactStore {
  constructor(
    private readonly bucket: string,
    private readonly client = new S3Client({}),
  ) {}

  async put(run: RunRef, stage: string, name: string, body: string | Buffer): Promise<StoredArtifact> {
    const key = keyFor(run, stage, name);
    const hash = sha256(body);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        Metadata: { sha256: hash },
      }),
    );
    return { key, sha256: hash };
  }

  async get(run: RunRef, stage: string, name: string): Promise<string> {
    const key = keyFor(run, stage, name);
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const body = await res.Body?.transformToString("utf8");
    if (body === undefined) throw new Error(`empty artifact body at ${key}`);
    return body;
  }
}

/** Writes under ./demo-output/ instead of S3. Same key layout, so a demo run's output
 * tree reads exactly like the S3 prefix it stands in for. */
export class LocalArtifactStore implements ArtifactStore {
  constructor(private readonly rootDir: string) {}

  async put(run: RunRef, stage: string, name: string, body: string | Buffer): Promise<StoredArtifact> {
    const key = keyFor(run, stage, name);
    const path = join(this.rootDir, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
    return { key, sha256: sha256(body) };
  }

  async get(run: RunRef, stage: string, name: string): Promise<string> {
    const key = keyFor(run, stage, name);
    return readFile(join(this.rootDir, key), "utf8");
  }
}
