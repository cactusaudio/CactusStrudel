# MCP interface

`bin/cactus-mcp` is a dependency-free MCP stdio server (newline-delimited
JSON-RPC 2.0: `initialize`, `tools/list`, `tools/call`, `ping`) wrapping the
same `/api/v2` chokepoint as the GUI and CLI.

Register in a Claude Code project (`.mcp.json`):

```json
{
  "mcpServers": {
    "cactus-strudel": {
      "command": "/Users/bowei/CactusStrudel/bin/cactus-mcp"
    }
  }
}
```

## Tools

Read: `cactus_status`, `cactus_doctor`, `cactus_list_pieces`,
`cactus_get_piece`, `cactus_play_url`, `cactus_operation_readback`,
`cactus_agent_settings`.

Mutating (named as such in their descriptions): `cactus_generate`,
`cactus_preview`, `cactus_promote` (idempotent: promoting the already-
current revision is a receipt-free no-op), and `cactus_brain` — note the
Brain model can itself archive/restore pieces, render previews, and launch
paid generations through its own tool set.

Guarded: `cactus_score` requires `acting_for_bowei: true` — an agent may
set it only when relaying Bowei's explicit scoring instruction, because the
0-10 rating is his ear-truth channel. Agent Settings Apply is deliberately
NOT exposed over MCP at all.

## Posture

- The runtime is loopback-only and unauthenticated; MCP adds no privilege
  beyond what any local process already has via HTTP.
- Idempotency keys are auto-derived (`mcp-<uuid>`) for generate/preview/
  brain/score unless the caller pins one; retries with the caller's own key
  reconcile through `cactus_operation_readback`. Promote needs no key: it
  is naturally idempotent on the current-revision pointer.
- Calls are processed serially over stdio: a long render blocks subsequent
  tool calls until it returns (known v1 limitation).
- Tool results return the runtime's receipts verbatim as JSON text.
