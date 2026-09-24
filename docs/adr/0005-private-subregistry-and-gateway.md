# ADR 0005 — Private MCP subregistry plus a gateway

**Status:** accepted

## Context
Agents need internal tools. Pointing them at servers directly means no central allowlist,
no audit, no credential control, and a tool count that eats the context window.

## Decision
Run a private subregistry mirroring the public MCP registry and implementing the same
OpenAPI surface, with org fields in `server.json`'s `_meta`. Put a gateway in front of all
remote servers for OAuth, allowlisting, audit and credential exchange.

## Rationale
Subregistry is an officially supported pattern rather than a workaround, so host apps
consume it through the standard interface. The protocol itself is moving toward gateways —
routing headers exist so a gateway can route and meter without parsing bodies.

## Consequences
Servers must use Streamable HTTP (HTTP+SSE is deprecated), implement OAuth 2.1 with PKCE,
RFC 9728 discovery and RFC 8707 audience validation, and must not forward received tokens
upstream. The gateway performs credential exchange, never passthrough.
