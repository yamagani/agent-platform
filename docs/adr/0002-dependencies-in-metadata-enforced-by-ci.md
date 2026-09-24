# ADR 0002 — Declare dependencies in `metadata`, enforce them in CI

**Status:** accepted

## Context
A skill often needs an MCP server, a local binary, or an entitlement. No skill or plugin
manifest format has a `requires:` key. Without one, a skill that needs something silently
half-works on machines that lack it.

## Decision
Declare dependencies as `x-requires-*` keys inside `metadata`, and make CI the enforcer.
A declared MCP server that does not resolve in the private registry fails the build.

## Rationale
Dependency declaration is rigorous where there is a registry and a package-manager mental
model, and informal where the artifact is prose. Putting the declaration in a machine-
checkable place and gating merges on it is what moves skills from the second category to
the first.

## Consequences
An unmet entitlement means **install but disable**, with the reason surfaced by
`agents doctor` — never install something that will fail confusingly at call time.
