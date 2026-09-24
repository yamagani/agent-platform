# ADR 0004 — Instructions are compiled per tool from one source

**Status:** accepted

## Context
`~/.agents/skills/` is a genuine cross-client convention, so skills distribute almost for
free. Instructions have no equivalent: Copilot, Kiro, Cursor, Codex and Gemini each read a
different path in a different format with different activation semantics.

## Decision
Write one source instruction file per subject. Compile it into each target's native form.
Never hand-maintain the per-tool files.

## Rationale
Hand-maintained parallel files disagree within weeks, and the disagreement is invisible
until someone's agent gives different advice than their colleague's.

## Consequences
The compiler owns per-tool quirks: Kiro CLI ignores `inclusion:` frontmatter, Codex caps
combined AGENTS.md at 32 KiB, Cursor reads only `.mdc`. Generated files carry a managed
block so user content in the same file survives, plus a `DO NOT EDIT — source:` header.
