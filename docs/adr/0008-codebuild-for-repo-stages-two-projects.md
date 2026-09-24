# ADR 0008 — CodeBuild for repository stages, split into two projects

**Status:** accepted · **Applies to:** Spec-to-PR Factory

## Context
Reasoning stages only read artifacts and call a model. Repository stages must clone, install
dependencies, and run a test suite — work that routinely exceeds Lambda's 15-minute ceiling.
Generated code is untrusted and must not run with credentials or network access.

## Decision
Reasoning stages run on Lambda (container image). Repository stages run on CodeBuild,
invoked `.sync`, split across two projects: `factory-prepare` (egress allowed, holds the
source token) and `factory-execute` (VPC with no NAT or IGW, no source credentials,
write-only to its own S3 prefix).

## Rationale
CodeBuild exists to clone, install and test; it has a 36-hour ceiling, per-minute billing
with nothing idle between runs, and build logs without extra plumbing. Fargate becomes
preferable only for custom long-lived networking. The two-project split is the containment
boundary: generated code never executes anywhere that can reach the network or push.

## Consequences
Dependency installation and test execution are separate phases with separate roles, which
costs one artifact handoff and buys the main security property of the system.

`factory-prepare` still has a narrower problem even with the two-project split: it holds a
push-capable GitHub token *and* it runs dependency installation, which executes
repo-authored code (npm/pip postinstall hooks, setup.py, build scripts). An "egress allowed
to package registries" network policy does not close this — the standard exfiltration
pattern publishes the token to the very registry that's allowlisted, as a matter of course.
The mitigation is credential hygiene, not network policy: the buildspec fetches the
installation token only for the `git clone` phase, via a short-lived credential helper, then
explicitly scrubs it — process environment, `.git-credentials`, git config — before the
install phase runs. No repo-authored code ever executes while the token is reachable in the
same process tree. Blast radius is bounded further by the token itself: GitHub App
installation tokens are repo-scoped and expire in about an hour regardless.
