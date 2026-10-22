# dsh-busy-light

[简体中文](./README.md) | **English**

A "busy light" board for the DSH Web GUI: who is running, who is waiting on you, who just finished — one glance, one click to jump there.

![panel with several Sessions](verify/shot-multi.png)

## What it does

- **One row per Session**, coloured by state:
  - 🔵 **breathing blue** — running
  - 🟠 **steady amber with a tag** — blocked on you (`待审批` approval / `待回答` question / `待确认` plan review); the loudest thing on screen
  - 🟢 **steady green** — finished in the background and unread; cleared the moment you open that Session, no timer
  - ⚪ **muted grey** — a context row: the parent of subagents, or a finished Session whose subagents still run. Not a completion, no breathing, no tab count
- **Strict tree alignment**: main Sessions share one baseline, subagents hang off their parent as an indented branch with trunk lines and the label they were created with (same label as the sidebar)
- **No false completions**: when a Session's turn ends while its subagents still work, its row is demoted to a muted context row instead of turning green
- **Collapse**: six rows by default, then an expandable `还有 N 个会话 ▾` row and a `收起 ▴` back
- **Drag anywhere** on the board; the seat is stored in `localStorage` and clamped to the viewport on resize
- **Click any row** to open that Session (a subagent row opens its parent)
- **Browser tab**: a status prefix on the title (root Sessions only) and a breathing badge on the favicon, re-adopted if the shell replaces the icons and restored exactly when idle

## Install

Requires a DSH build that supports Web client plugins (`dsh.client.platform: "web"`).

### From npm (once published)

```bash
dsh plugin --profile web add dsh-busy-light
```

### From git

```bash
dsh plugin --profile web add git+https://github.com/alain-zhu/dsh-busy-light.git
```

### From a local checkout

```bash
dsh plugin --profile web add link:D:/path/to/dsh-busy-light
```

**Installing registers the plugin.** The package declares `dsh.bundle` (`cordis.patch.yml` inserts its own loader row), so `dsh plugin add` appends it to the profile's `dsh.profile.bundles` and applies the patch — no manual `cordis.patch.yml` edit. Restart `dsh web` and hard-refresh. Check the tooltip for `· v0.9.0` and the console for `[dsh-busy-light] v0.9.0`.

Only hosts that do not reconcile bundles need the manual row in `~/.dsh/profiles/web/cordis.patch.yml`:

```yaml
- insert:
    - id: dsh-busy-light
      name: dsh-busy-light
```

`lib/` ships built: no build step and no runtime dependency. Host compatibility is declared through `engines.dsh` (`>=0.1.0-rc.5`).

## How a row is chosen

| State | Rule | Look |
|---|---|---|
| `running` | `status.running`, or `summary.running` for a subagent row | breathing blue |
| `waiting` | `pendingInteraction.kind` ∈ `approval` / `question` / `plan-review` | amber + tag + fast pulse |
| `done` | `completionUnread` — the Session stopped while not in the main view | steady green |
| `context` | parent of subagents; or a finished parent whose subtree still has `running`/`waiting` | muted grey |

Tree structure outranks state grouping; state only orders siblings (`waiting` → `running` → `done` → `context`).

## Public surface it relies on

- Client plugin protocol: `dsh.client.platform: "web"` plus `exports["./client"]`, entry through `window.__ModuleLoader__.load`
- Slot: `shell.overlay`
- Kit hooks: `useSessions`, `useSessionStatus`
- Navigation: `ctx.inject(['uiWorkspace'])` then `openSession`

No cordis dependency and no React dependency of its own (React comes from the host), so `npm install` needs no extra flags.

## Development

```bash
node verify/smoke.mjs      # pure model: tree, demotion, collapse, tab prefix
node verify/render.mjs     # jsdom: full render, clicks, drag, favicon self-heal
node verify/browser.mjs    # real Chromium: screenshots + interaction assertions (Playwright)
```

Open `verify/preview.html` directly to switch states by hand while restyling.
At runtime, `window.__dshBusyLight.model` holds the row model behind any render.

## Compatibility

Verified against the 2026-10 snapshot for the host services listed above. The plugin only reads state and writes the title, favicon and `localStorage`; it never intercepts Session execution.

## License

MIT
