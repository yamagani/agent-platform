import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type { RunRef } from "../types";

/**
 * Single DynamoDB table, per docs/02-spec-to-pr-factory.md §8:
 *   PK=RUN#<runId>  SK=META                   status, revision, repo
 *   PK=RUN#<runId>  SK=STAGE#<stage>           status, artifact keys, timestamps
 *   PK=RUN#<runId>  SK=GATE#<gateId>           taskToken, status, decision
 *
 * Phase 1 only needs enough of this to make Gate A work and a run inspectable —
 * the GSI1 dashboard-query and reprocess-DAG columns from the full design are not
 * populated here yet.
 */
export interface RunStore {
  putStage(run: RunRef, stage: string, fields: Record<string, unknown>): Promise<void>;
  openGate(run: RunRef, gateId: string, taskToken: string): Promise<void>;
  getGateTaskToken(run: RunRef, gateId: string): Promise<string | undefined>;
  recordGateDecision(run: RunRef, gateId: string, fields: Record<string, unknown>): Promise<void>;
}

export class DynamoRunStore implements RunStore {
  private readonly doc: DynamoDBDocumentClient;

  constructor(
    private readonly tableName: string,
    client = new DynamoDBClient({}),
  ) {
    this.doc = DynamoDBDocumentClient.from(client);
  }

  async putStage(run: RunRef, stage: string, fields: Record<string, unknown>): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `RUN#${run.runId}`,
          SK: `STAGE#${stage}`,
          revision: run.revision,
          updatedAt: new Date().toISOString(),
          ...fields,
        },
      }),
    );
  }

  async openGate(run: RunRef, gateId: string, taskToken: string): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `RUN#${run.runId}`,
          SK: `GATE#${gateId}`,
          taskToken,
          status: "OPEN",
          openedAt: new Date().toISOString(),
        },
      }),
    );
  }

  async getGateTaskToken(run: RunRef, gateId: string): Promise<string | undefined> {
    const res = await this.doc.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: `RUN#${run.runId}`, SK: `GATE#${gateId}` },
      }),
    );
    return res.Item?.taskToken as string | undefined;
  }

  async recordGateDecision(run: RunRef, gateId: string, fields: Record<string, unknown>): Promise<void> {
    await this.doc.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: `RUN#${run.runId}`, SK: `GATE#${gateId}` },
        UpdateExpression: "SET #s = :status, decidedAt = :now, decision = :fields",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: {
          ":status": "DECIDED",
          ":now": new Date().toISOString(),
          ":fields": fields,
        },
      }),
    );
  }
}

/** In-process store for `npm run demo` — a single run, never persisted, gate token
 * is just an object reference instead of a real Step Functions task token. */
export class InMemoryRunStore implements RunStore {
  private readonly stages = new Map<string, Record<string, unknown>>();
  private readonly gates = new Map<string, { taskToken: string; decision?: Record<string, unknown> }>();

  async putStage(run: RunRef, stage: string, fields: Record<string, unknown>): Promise<void> {
    this.stages.set(`${run.runId}#${stage}`, fields);
  }

  async openGate(run: RunRef, gateId: string, taskToken: string): Promise<void> {
    this.gates.set(`${run.runId}#${gateId}`, { taskToken });
  }

  async getGateTaskToken(run: RunRef, gateId: string): Promise<string | undefined> {
    return this.gates.get(`${run.runId}#${gateId}`)?.taskToken;
  }

  async recordGateDecision(run: RunRef, gateId: string, fields: Record<string, unknown>): Promise<void> {
    const entry = this.gates.get(`${run.runId}#${gateId}`);
    if (entry) entry.decision = fields;
  }
}
