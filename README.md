# agent-platform

Design repository for two related systems.

1. **Agent Platform** — how organisation-owned AI-agent skills, instructions, prompts and
   MCP connectors are authored, governed, distributed to developer machines, and connected
   to internal knowledge under existing permissions.
2. **Spec-to-PR Factory** — a serverless pipeline that turns a requirements spec in a
   customer repository into a reviewed, tested pull request, using the Agent Platform as
   its source of skills, instructions and tools.

The second is a consumer of the first. Nothing in the factory defines its own prompts or
tool access; it pulls a pinned release from the platform like any other client.

## Contents

| Path | What it is |
|---|---|
| `docs/01-agent-platform.md` | Implementation spec for the platform: repo model, manifest schema, sync CLI contract, adapters, knowledge service, governance |
| `docs/02-spec-to-pr-factory.md` | Architecture for the AWS serverless spec-to-PR pipeline |
| `docs/adr/` | Architecture decision records — the decisions that are settled and why |
| `schemas/factory-request.schema.json` | The request format a customer repo supplies |
| `docs/diagrams/` | Architecture diagrams, embedded in the two docs above (platform: PNG + PDF; factory: SVG) |
| `factory/` | Working Phase 1 implementation of the Spec-to-PR Factory (see `factory/README.md`) |

## Status

Design stage for the Agent Platform (`docs/01-agent-platform.md`) — no code yet. The
Spec-to-PR Factory has a working Phase 1 slice in `factory/`: intake → recon → analyst →
Gate A → publisher, deployable as real AWS serverless infrastructure or runnable locally
with no AWS account at all (`cd factory && npm install && npm run demo`). Everything past
Phase 1 — the coder/tester loop, CodeBuild containment, the revision DAG, the full human-
in-the-loop surface — is still design, not code; `factory/README.md` says exactly what's
simplified and why. Every document here states its open questions at the end; those are
the things that should be answered before the matching phase starts.
