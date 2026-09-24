# ADR 0006 — Factory agents communicate through artifacts, not conversation

**Status:** accepted · **Applies to:** Spec-to-PR Factory

## Context
A multi-stage agent pipeline can either pass accumulated conversation forward, or pass
named artifacts. Passing conversation is easier to build and is what most demos do.

## Decision
Each stage is a pure function of (skill pack version, model version, input artifacts, repo
facts). No stage receives a previous stage's transcript.

## Rationale
Four properties fall out of this and out of nothing else: genuine context isolation,
cheap reprocessing of any single stage, reproducible and auditable runs, and Step Functions
payloads that stay far below the 256 KB state limit because states carry pointers.

## Consequences
Every stage must define an output schema, and a stage's prompt is assembled deterministically
rather than inherited. If a future change makes one agent "just pass its context" to the
next, that is this design being abandoned, not an optimisation.
