# Frozen web-Gemini path

This directory preserves the former `gf` browser-scraping path and its
dedicated Chrome launcher. CactusStrudel v3 does not call it.

The live generation path is now one direct native CLIProxy `/v1/responses`
boundary, selected through durable generation profiles. It does not require
debug port 9222, Gemini page scraping, AGY, a router, or a compatibility shim.

## Files

- `gf`              — original zsh wrapper that called `gemini-fetch.ts` then `auto-render.ts`
- `gemini-fetch.ts` — TypeScript scraper that drove headless Chrome through the Gemini UI
- `gemini-fetch.ts.bak.*` — historical PROMPT_BASE snapshots from each guideline edit

Do not move these files back into the active tree as an incident workaround.
The v2 source, matching GUI snapshot, and Git tag are the complete rollback
evidence if historical comparison is needed.
