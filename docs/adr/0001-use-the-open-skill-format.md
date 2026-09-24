# ADR 0001 — Use the open Agent Skills format, not a house format

**Status:** accepted

## Context
Skills could be stored in any format we like. A bespoke format would let us add fields we
want (notably dependency declaration, see ADR 0002).

## Decision
Author every skill as `SKILL.md` in the published open Agent Skills format.

## Rationale
The spec is open, has a reference validator, and has multi-vendor adoption. Every format we
invent is a format we must write tooling for, and a reason every future integration costs
extra. The fields we need that the spec lacks fit in its own `metadata` extension point.

## Consequences
We inherit the spec's constraints, including `metadata` being a flat string→string map.
Structured dependency data is therefore encoded as delimited strings and validated by CI
rather than by the format itself.
