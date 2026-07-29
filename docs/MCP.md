# MCP interface

`bin/strudel-mcp` is a dependency-free MCP stdio server (newline-delimited
JSON-RPC 2.0: `initialize`, `tools/list`, `tools/call`, `ping`) wrapping the
same `/api/v2` chokepoint as the GUI and CLI.

Register in a Claude Code project (`.mcp.json`):

```json
{
  "mcpServers": {
    "strudel": {
      "command": "/Users/bowei/CactusStrudel/bin/strudel-mcp"
    }
  }
}
```

## Tools

Read: `strudel_status`, `strudel_doctor`, `strudel_list_pieces`,
`strudel_get_piece`, `strudel_play_url`, `strudel_operation_readback`,
`strudel_agent_settings`.

Mutating (named as such in their descriptions): `strudel_generate`,
`strudel_preview`, `strudel_promote` (idempotent: promoting the already-
current revision is a receipt-free no-op), and `strudel_brain` — note the
Brain model can itself archive/restore pieces, render previews, and launch
paid generations through its own tool set.

Guarded: `strudel_score` requires `acting_for_bowei: true` — an agent may
set it only when relaying Bowei's explicit scoring instruction, because the
0-10 rating is his ear-truth channel. Agent Settings Apply is deliberately
NOT exposed over MCP at all.

## Posture

- The runtime is loopback-only and unauthenticated; MCP adds no privilege
  beyond what any local process already has via HTTP.
- Idempotency keys are auto-derived (`mcp-<uuid>`) for generate/preview/
  brain/score unless the caller pins one; retries with the caller's own key
  reconcile through `strudel_operation_readback`. Promote needs no key: it
  is naturally idempotent on the current-revision pointer.
- Calls are processed serially over stdio: a long render blocks subsequent
  tool calls until it returns (known v1 limitation).
- Tool results return the runtime's receipts verbatim as JSON text.
