# ADR 0007 — Step Functions Standard, with reprocess modelled as a new revision

**Status:** accepted · **Applies to:** Spec-to-PR Factory

## Context
The pipeline pauses for human approval, sometimes for days. It also needs users to be able
to redo a stage long after a run completed.

## Decision
Orchestrate with Step Functions **Standard** workflows and `.waitForTaskToken` for gates.
Model user-initiated reprocessing as a **new run revision** that reuses earlier artifacts by
reference, not as `RedriveExecution`.

## Rationale
Express workflows cap at 5 minutes and cannot hold an approval. Standard allows a year, and
the task token lives as long as the execution, so gates need no separate expiry handling.
Native redrive applies only to FAILED/ABORTED/TIMED_OUT executions, only within 14 days, and
only under 24,999 history events — none of which fits "redo the design of a successful run
from last month". Redrive is kept for infrastructure failures only.

## Consequences
Runs form a small DAG of revisions and the artifact store is append-only, which makes "what
did we approve, and what changed after" a diff. Inner coder/tester retry loops live inside a
single CodeBuild job rather than as states, to protect the 25,000-event history limit.
