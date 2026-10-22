# Changelog

## 0.9.0

- Ships as a profile plugin bundle: `dsh.bundle` + `cordis.patch.yml`, so `dsh plugin add` registers the loader row by itself.
- Declares `engines.dsh` and an icon, the two fields a plugin market index requires.

## 0.8.6

- Debug surface: `window.__dshBusyLight` exposes `{ version, model }` for the current render.

## 0.8.5

- A finished Session whose subagents still run is demoted to a muted context row instead of showing green.

## 0.8.4

- Clicking a main Session no longer orphans its running subagents: they keep a muted parent row as their top.

## 0.8.3

- Favicon takeover survives the shell recreating its icon links (observer + re-adoption on every breath).

## 0.8.2

- The overflow row is a real entry: `还有 N 个会话 ▾` expands, `收起 ▴` collapses.

## 0.8.0

- Strict tree: main Sessions share a baseline, subagents indent under their parent with trunk lines.

## 0.7.0

- The board is draggable; its seat is remembered in `localStorage`.

## 0.6.0

- Tab decoration: status-aware title prefix and breathing favicon badge, root Sessions only.

## 0.1.0

- First panel: running / waiting / unread chips, click to open, six-row collapse.
