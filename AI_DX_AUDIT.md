# AI-First DX Audit — Fear & Greed vs S&P 500

## Executive Summary
The project began as a single 1,475-line HTML file with ~1,260 daily data points
hardcoded inline and a manually downloaded Nasdaq CSV as the price source — opaque to
an AI agent (you'd have to scroll past 1,250 data rows to find the logic) and impossible
to keep current without hand edits. It has been restructured into a small, self-describing
static project with live data sources and a hands-off daily refresh. The codebase is now
easy for an AI agent to load, reason about, and modify.

## What changed (before → after)

### Documentation
- **CLAUDE.md (new):** project purpose, data flow, how to run, and — most importantly —
  the **non-obvious data-source gotchas** (CNN's 418 bot-block without `cnn.com` headers;
  Yahoo's 429 on `query1` from datacenter IPs; the ~5-year history cap). These are the
  exact things an AI would otherwise rediscover by trial and error.
- **README.md (new):** one-screen human guide to preview and deploy.

### Naming & code clarity
- Data records use explicit keys: `{ d, fg, sp500 }`. The old field `spy` was renamed to
  `sp500` to match the actual series now plotted (the index, not the ETF), so the name no
  longer misleads.
- `scripts/fetch-data.js` is small and linear with a `// design notes` header explaining
  the header/host workarounds, so the *why* is visible at the point of use.
- The hardcoded reference date in `draw()` was replaced with "the last available date,"
  removing a value that would silently rot.

### Folder & module structure
- Logic, data, fetch script, and CI are now separate files with intention-revealing paths
  (`index.html`, `data.json`, `scripts/fetch-data.js`, `.github/workflows/update-data.yml`).
  An agent can predict where to look without reading everything.
- The ~1,260-row inline `DATA` array was removed entirely — the single biggest source of
  noise in the original file.

## Prioritized action plan (status)

| Priority | Action | Impact | Effort | Status |
|----------|--------|--------|--------|--------|
| 1 | Extract hardcoded data → `data.json` via fetch script | High | Med | ✅ done |
| 2 | Replace manual CSV with a live, keyless price source (^GSPC) | High | Low | ✅ done |
| 3 | Add CLAUDE.md capturing data-source gotchas | High | Low | ✅ done |
| 4 | Daily auto-update via GitHub Action | High | Low | ✅ done |
| 5 | README for human onboarding | Med | Low | ✅ done |

## Notes for future agents
Everything important lives in `CLAUDE.md`. The one rule that matters most: **data comes
from `data.json`; never inline it into `index.html` again.**
