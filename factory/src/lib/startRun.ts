import { randomUUID } from "node:crypto";
import { StartExecutionCommand, SFNClient } from "@aws-sdk/client-sfn";
import { requireEnv } from "./env";
import type { RunRef } from "../types";

const sfn = new SFNClient({});

/**
 * Starts one Standard execution. The run id doubles as the Step Functions execution
 * name, so "look up the execution for run X" is never a separate index.
 */
export async function startRun(repo: { owner: string; name: string }, requestYaml: string): Promise<RunRef> {
  const run: RunRef = { runId: randomUUID(), revision: "1", repo };
  await sfn.send(
    new StartExecutionCommand({
      stateMachineArn: requireEnv("STATE_MACHINE_ARN"),
      name: run.runId,
      input: JSON.stringify({ run, requestYaml }),
    }),
  );
  return run;
}
