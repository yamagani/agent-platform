# ADR 0003 — The sync CLI keeps a lockfile and a state manifest

**Status:** accepted

## Context
A `git pull`-based sync always takes HEAD, and a tool that copies files cannot tell its own
output from a developer's edits. Both are well-documented dotfiles-manager failure modes:
simultaneous org-wide breakage, silent clobbering, and orphaned files after a deletion.

## Decision
`agents.lock` pins plugin versions per machine. `state.json` records every written path
with a content hash and its owning plugin.

## Rationale
These two files are what make staged rollout, drift detection and clean uninstall possible.
Nothing else in the CLI needs to be clever if these exist; nothing else can be safe if they
do not.

## Consequences
Sync becomes a five-stage pipeline (resolve, verify, compile, apply, record) and the record
stage is load-bearing rather than bookkeeping. `~/.agents-local/` exists as an explicitly
unmanaged layer so user content never competes with org content.
