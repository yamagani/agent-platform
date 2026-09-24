# Architecture decision records

Decisions that are settled. Raise one again only with evidence against it, not with a
preference.

| ADR | Decision | Applies to |
|---|---|---|
| [0001](0001-use-the-open-skill-format.md) | Use the open Agent Skills format, not a house format | Platform |
| [0002](0002-dependencies-in-metadata-enforced-by-ci.md) | Declare dependencies in `metadata`, enforce in CI | Platform |
| [0003](0003-lockfile-and-state-manifest.md) | Sync CLI keeps a lockfile and a state manifest | Platform |
| [0004](0004-compile-instructions-per-tool.md) | Instructions compiled per tool from one source | Platform |
| [0005](0005-private-subregistry-and-gateway.md) | Private MCP subregistry plus a gateway | Platform |
| [0006](0006-agents-communicate-through-artifacts.md) | Agents communicate through artifacts, not conversation | Factory |
| [0007](0007-step-functions-standard-and-explicit-reprocess.md) | Step Functions Standard; reprocess as a new revision | Factory |
| [0008](0008-codebuild-for-repo-stages-two-projects.md) | CodeBuild for repo stages, split into two projects | Factory |
