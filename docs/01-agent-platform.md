# Agent Platform — implementation spec

**Status:** design approved, ready to build · **Audience:** implementing engineers

A single source of truth for AI-agent skills, instructions and prompts, distributed to
developer machines with version pinning and drift control, plus one governed knowledge
endpoint so developers can ask internal questions from inside their agent.

---

## 1. Two planes, built separately

Everything here is either **a durable instruction we version** or **a fact that changes
without us**. Those need opposite mechanisms, and mixing them is the expensive mistake:
baking wiki content into synced skills produces artefacts that are stale on arrival and
carry no page-level permissions.

**Static plane** — skills, instructions, prompts. Version-controlled, pinned, reviewed like
code, written to disk by a CLI.

**Dynamic plane** — internal knowledge and tool access. Never written to disk; behind one
MCP endpoint the static plane points at.

The developer's agent is the only place the two meet.

---

## 2. Repository and artifact model

One org repo structured as a plugin marketplace, one plugin per owning team, CODEOWNERS
per plugin.

```
agent-platform/
  .claude-plugin/marketplace.json
  plugins/<team>/
    .claude-plugin/plugin.json
    skills/<name>/SKILL.md        # <500 lines; detail in references/
    instructions/<name>.md        # SOURCE form — compiled per tool
    prompts/*.md
    mcp/servers.json              # by registry name only
    evals/<case>/prompt.md + graders/*.md
  schema/
  tools/agents-cli/
```

Author skills in the **open Agent Skills format** (`SKILL.md`, YAML frontmatter, required
`name` matching the directory and `description`). Do not invent a house format — the open
spec has multi-vendor adoption and a reference validator.

Instructions are a **source form, not a deliverable**. Never hand-write the per-tool files;
they disagree within weeks. Compile them (§5).

**Context budget:** a skill's name and description load into every session for every
installed skill — roughly 50–100 tokens each, permanently. A platform that installs 80
skills on every machine has spent the budget before the developer types anything.

---

## 3. Manifest and dependency declaration

Neither `SKILL.md` nor any plugin manifest has a `requires:` key. The spec does give
`metadata`, a string→string map declared as the vendor extension point. Use it, encode
structure as comma-separated strings, and let CI enforce.

```yaml
metadata:
  x-owner: "team-payments"
  x-channel: "stable"
  x-requires-mcp: "com.acme/ledger@^2, com.acme/ask-internal@^1"
  x-requires-bin: "kubectl>=1.30, acme-cli>=4"
  x-requires-entitlement: "okta:grp-payments-eng"
  x-requires-agent: "claude-code>=2.1.269, copilot>=1.40"
  x-surfaces: "claude-code, copilot, kiro"
```

| Key | Enforced by | When unmet |
|---|---|---|
| `x-requires-mcp` | CI resolve + CLI at install | install disabled, reason in `agents doctor` |
| `x-requires-bin` | CLI probe at sync | warn, install anyway, flag |
| `x-requires-entitlement` | CLI against IdP claims | **install but disable** |
| `x-requires-agent` | compiler | adapter refuses to emit |
| `x-surfaces` | compiler | skipped for other targets |
| `x-channel` | CLI channel selection | not offered on narrower channels |
| `x-owner` | CI | PR fails |

**A declared MCP server that does not resolve in the private registry fails the build.**
That one check keeps the dependency graph honest as team count grows.

---

## 4. Sync CLI contract

The three things a naive sync tool lacks: a lockfile, a state manifest, and a clean
uninstall. Without a lockfile every machine takes HEAD, so one bad commit breaks the org
simultaneously. Without a state manifest the tool cannot tell a file it wrote from one the
developer wrote.

Pipeline: `resolve → verify → compile → apply → record`.

```
~/.agents/
  skills/ instructions/ prompts/ mcp/registry.json
  agents.lock     # pinned plugin@version + SHA
  state.json      # every written path + hash + owning plugin
~/.agents-local/  # the developer's own — never touched
```

| Command | Does |
|---|---|
| `agents sync` | full pipeline; `--channel`, `--dry-run`, `--only` |
| `agents status` | installed versions, pending updates, drift report |
| `agents doctor` | every declared dependency probe — the support-ticket deflector |
| `agents pin <p>@<v>` | freeze one plugin |
| `agents add / remove` | opt-in plugins |
| `agents uninstall` | removes exactly the paths in `state.json` |

Behavioural requirements: fail soft (compile to a temp tree, atomic swap; keep last good
state when the registry is unreachable); never overwrite a drifted file without `--force`;
verify commit signature or archive hash before writing anything. Exit codes: `0` clean,
`3` drift, `4` unmet dependency, `5` source unreachable.

---

## 5. Tool adapters

`~/.agents/skills/` is a real cross-client convention, so skills are nearly free to
distribute. **Instructions have no such convention** — every tool reads its own path in its
own format. The adapter layer pays that cost once.

| Target | Path | Mechanism |
|---|---|---|
| any `.agents`-aware | `~/.agents/skills/` | canonical |
| Claude Code | `~/.claude/skills/<name>` | symlink |
| Copilot | `.github/instructions/*.instructions.md` (`applyTo:`) | generated, managed block |
| Kiro | `.kiro/steering/*.md` (`inclusion:`) | generated |
| Cursor | `.cursor/rules/*.mdc` | generated |
| Codex · Gemini | `AGENTS.md` root + nested | generated, managed block |

Three traps already paid for by others: **Kiro CLI ignores `inclusion:`** and loads every
steering file unconditionally, so keep emitted files small. **Codex caps combined AGENTS.md
at 32 KiB** and concatenates root-to-cwd. **Cursor ignores `.md`** under `.cursor/rules/` —
only `.mdc` is read, and the wrong extension fails silently.

---

## 6. Knowledge service

Do not hand developers a raw Confluence MCP server. A full Atlassian server exposes on the
order of a hundred tools, all of whose schemas sit in context from session start, and
Confluence's native search is keyword matching, which is not what "how do I get a dev cert"
needs.

One internal service, four tools, hard cap: `ask_internal`, `search_docs`, `get_doc`,
`report_gap`. The last one records questions the corpus could not answer — that is the
documentation backlog, generated by real demand.

Retrieval requirements:

- **Per-user delegated OAuth**, not a service account.
- **Evaluate ancestor restrictions.** Confluence viewing needs product plus space access
  plus every applicable page restriction, and restrictions inherit to descendants. A page's
  own restriction response is not sufficient. This is the most commonly missed detail.
- **Authorize before rerank**, never after generation. If a user may not read a document,
  the retriever must never return it, and rejected content must not reach context or logs.
- **Reconcile, don't just listen** — webhooks fire on direct edits but not reliably on
  inherited permission changes via a parent.
- **Fail closed** when authorization state is unknown.
- **Treat retrieved content as untrusted data**, delimited with provenance, never as
  instructions.

---

## 7. MCP registry and gateway

Run a **private subregistry**: a downstream mirror implementing the same OpenAPI surface as
the public MCP registry, with org fields in `server.json`'s `_meta` under a namespaced key
(approval status, required entitlement, scan date). Mirror rather than depend live — the
public registry is still in preview.

A **gateway** in front of remote servers for central OAuth, allowlisting, audit and
credential brokering. Protocol constraints for server authors: **Streamable HTTP only**
(HTTP+SSE is deprecated); OAuth 2.1 with PKCE, RFC 9728 protected-resource metadata and
RFC 8707 resource indicators are a MUST, and a server must not forward a received token
upstream — the gateway performs credential *exchange*.

---

## 8. Governance

A CLI a developer runs is a CLI a developer can skip, so anything that must not drift goes
through **MDM/managed policy**, not sync.

| Platform | Path |
|---|---|
| macOS | `/Library/Application Support/ClaudeCode/managed-settings.json` |
| Linux / WSL | `/etc/claude-code/managed-settings.json` |
| Windows | `C:\Program Files\ClaudeCode\managed-settings.json` (not ProgramData) |

Enforce `allowedMcpServers` / `allowManagedMcpServersOnly` / `deniedMcpServers`,
`blockedMarketplaces`, `strictKnownMarketplaces`, `disableSideloadFlags`,
`strictPluginOnlyCustomization`. Everything else stays voluntary — mandating more than the
security-relevant minimum is how a platform gets routed around.

---

## 9. CI, evaluation, telemetry

CI gates per PR: schema validation, dependency resolution against the registry, emitted-size
check, CODEOWNERS review.

Evaluate behaviourally. A skill that reads well and never fires is worthless. Run cases
with the plugin loaded *and* unloaded and gate on the **delta**, not the absolute score, or
you ship skills that pass because the model would have coped anyway. Mock the MCP servers
and commit the recordings.

There is **no built-in per-skill usage dashboard** in this ecosystem. Budget for building
it: emit `skill_activated`, `sync_result`, `ask_internal_query{hit|miss}`, `gateway_call`.
The four questions to answer are which skills fire, which never fire, which questions come
back empty, and whether sessions using a skill end in a merged PR.

---

## 10. Delivery phases

1. **Backbone** — marketplace repo, manifest schemas, CLI with lockfile and state manifest,
   adapters for the two most-used agents.
   *Accept when:* a pinned version installs identically on two machines; a hand-edited
   managed file is reported not clobbered; removing a skill upstream removes its files;
   `agents uninstall` leaves nothing behind.
2. **Governance** — subregistry, gateway, managed settings via MDM, CI and evals, channels.
   *Accept when:* an unapproved MCP server cannot install on a managed machine; a bad commit
   reaches only the beta group.
3. **Knowledge** — ACL-aware ingestion, the four-tool server, gap backlog.
   *Accept when:* a restricted page provably never surfaces, including restriction inherited
   from an ancestor; every answer carries source and last-modified.
4. **Measurement** — per-skill telemetry, standing review that deletes skills that never fire.

---

## 11. Settled decisions

See `adr/`. In short: no house skill format; no hand-written per-tool instruction files; no
wiki content baked into skills; no service-account Confluence access; no SSE transport; no
raw third-party MCP servers outside the registry allowlist.

## 12. Open questions

- The real agent mix across developers, which decides adapter priority.
- Confluence permission topology — mostly open, or heavily space-restricted. This changes
  the retrieval architecture more than any other input.
- Who operates the gateway, and which system is authoritative for entitlement groups.
