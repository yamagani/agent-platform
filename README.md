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
| `docs/diagrams/` | Rendered architecture diagrams (PNG + PDF) |

## Status

Design stage. No implementation code in this repository yet. Every document here states
its open questions at the end; those are the things that should be answered before the
matching phase starts.
