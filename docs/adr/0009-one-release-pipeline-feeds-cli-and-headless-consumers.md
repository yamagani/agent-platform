# ADR 0009 — One release pipeline feeds both the CLI and headless consumers

**Status:** accepted

## Context
`01-agent-platform.md` describes a sync CLI that resolves plugins onto developer machines
via a registry. `02-spec-to-pr-factory.md` separately describes factory stages pulling a
"pinned skill-pack release" from a signed S3 artifact store. Left implicit, these read as
two independent distribution mechanisms with no defined relationship between them — a real
gap, because a pin recorded in a factory run record is only meaningful if it names the same
content a developer's lockfile would pin.

## Decision
One release pipeline, triggered on tag or merge-to-main, compiles and validates each changed
plugin, signs the result, and publishes the same build to two addresses: the CLI-resolvable
registry, and a versioned, content-addressed object in
`s3://agent-platform-releases/<plugin>/<version>/`. Headless consumers — the Spec-to-PR
Factory, or any other CI job — pull the S3 object directly and unpack it read-only. They
never run the mutable sync pipeline: they have no lockfile to drift, no developer-written
file to avoid clobbering, and no machine to leave half-applied.

## Rationale
A single build producing two addresses is cheaper and safer than two builds that could
diverge. It is also what makes the factory's own traceability claim true rather than
aspirational: "the pin is recorded in the run record, so an artifact can always be traced to
the exact standards that produced it" only holds if the pinned version names one signed
artifact, not one of two builds that happen to share a version number.

## Consequences
Plugins version with semver; a major bump is a breaking change, and CI blocks the merge
unless every declared `x-requires-agent` / `x-requires-mcp` consumer range across the
marketplace still resolves against it. The adapter compiler gains a `headless` target
alongside the developer-tool targets.
