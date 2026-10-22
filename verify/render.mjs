/**
 * DOM smoke test for dsh-busy-light's browser half.
 *
 * Runs the plugin component under jsdom with a tiny React hook runtime and
 * drives real SessionListState + SessionStatusSnapshot transitions:
 *   - one blue chip per running Session
 *   - a Session blocked on approval turns amber, leads the stack, carries its
 *     interaction word, and is never shown as finished
 *   - a background completion stays green until `completionUnread` clears
 *     (the user opens it) — there is no timer
 *   - the browser-tab prefix and the favicon takeover (all shell icon links are
 *     rewritten while active and restored when the light idles)
 *
 * Run: node dsh-busy-light/verify/render.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const bundlePath = join(here, '..', 'lib', 'client.js');

// jsdom lives in the harness checkout, not in this profile.
const requireFromPlugins = createRequire(join(here, '..', 'package.json'));
let JSDOM;
try {
  ({ JSDOM } = requireFromPlugins('jsdom'));
} catch {
  try {
    ({ JSDOM } = requireFromPlugins('D:/project/deepseek-harness/node_modules/jsdom'));
  } catch {
    console.log('render: skipped — jsdom is unavailable');
    process.exit(0);
  }
}

const dom = new JSDOM(
  `<!doctype html><html><head><title>DeepSeek Harness</title>
   <link rel="icon" type="image/svg+xml" href="/favicon.svg" media="(prefers-color-scheme: light)">
   <link rel="icon" type="image/svg+xml" href="/favicon-dark.svg" media="(prefers-color-scheme: dark)">
   </head><body><div id="root"></div></body></html>`,
  { url: 'http://127.0.0.1:3080/' },
);
const { window } = dom;
window.matchMedia = (query) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  dispatchEvent() { return false; },
});
// The state favicon falls back to an SVG data URL when canvas is unavailable.
window.HTMLCanvasElement.prototype.getContext = () => null;

globalThis.window = window;
globalThis.document = window.document;
globalThis.MutationObserver = window.MutationObserver;
globalThis.Image = window.Image;
globalThis.matchMedia = window.matchMedia;

// --- tiny React hook runtime ------------------------------------------------

const slots = [];
let slotIndex = 0;
let queued = [];
const cleanups = [];

const createElement = (type, props, ...children) => {
  if (typeof type === 'function') return type(props ?? {});
  const node = document.createElement(type);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (key === 'key' || value === undefined || value === null || value === false) continue;
    if (key === 'className') node.setAttribute('class', value);
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, String(value));
  }
  const add = (child) => {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) { child.forEach(add); return; }
    node.appendChild(child instanceof window.Node ? child : document.createTextNode(String(child)));
  };
  children.forEach(add);
  return node;
};

function useEffect(fn, deps) {
  const index = slotIndex++;
  const previous = slots[index];
  const changed = previous === undefined || previous.deps === undefined || deps === undefined
    || deps.length !== previous.deps.length
    || deps.some((dep, i) => !Object.is(dep, previous.deps[i]));
  slots[index] = { deps };
  queued.push(changed ? { index, fn } : null);
}

const stateSlots = [];
function useState(initial) {
  const index = slotIndex++;
  if (!(index in stateSlots)) stateSlots[index] = typeof initial === 'function' ? initial() : initial;
  const set = (next) => {
    const value = typeof next === 'function' ? next(stateSlots[index]) : next;
    if (Object.is(value, stateSlots[index])) return;
    stateSlots[index] = value;
    render(currentState, currentStatuses);
  };
  return [stateSlots[index], set];
}

let currentState;
let currentStatuses = new Map();
let Component = null;
const root = document.getElementById('root');

function render(state, statuses) {
  currentState = state ?? currentState;
  currentStatuses = statuses ?? new Map();
  slotIndex = 0;
  queued = [];
  root.replaceChildren(createElement('div', {},
    createElement(() => Component({
      useSessions: (select) => select(currentState),
      useSessionStatus: (select) => select(currentStatuses),
    }), {})));
  for (const item of queued.splice(0)) {
    if (item === null) continue;
    const previous = cleanups[item.index];
    if (typeof previous === 'function') previous();
    const cleanup = item.fn();
    cleanups[item.index] = typeof cleanup === 'function' ? cleanup : undefined;
  }
}

// --- load the plugin bundle -------------------------------------------------

let captured;
window.__ModuleLoader__ = { load: (entry) => { captured = entry; } };
await import(pathToFileURL(bundlePath).href);
assert.ok(captured, 'window.__ModuleLoader__.load was never called');

const plugin = captured.factory((id) => {
  if (id === 'react') return { createElement, useEffect, useState };
  throw new Error(`unexpected require(${id})`);
});
const opened = [];
plugin.apply({
  slots: {
    inject: (key, callback) => callback(),
    register: (spec, component) => { Component = component; },
  },
  inject: (services, callback) => {
    callback({
      effect: (fn) => { fn(); return () => {} },
      uiWorkspace: { openSession: (sessionId) => { opened.push(sessionId); } },
    });
  },
});
assert.equal(typeof Component, 'function');

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const chips = () => [...root.querySelectorAll('.dsh-busy-light-chip')];
const states = () => chips().map((chip) => chip.getAttribute('data-state'));
const labels = () => chips().map((chip) => chip.querySelector('.dsh-busy-light-label').textContent);
const tags = () => chips().map((chip) => chip.querySelector('.dsh-busy-light-tag')?.textContent);
const stateOf = (rows) => ({
  ids: rows.map((row) => row.id),
  byId: Object.fromEntries(rows.map((row) => [row.id, row])),
  phase: 'ready',
  projectionsBySession: {},
});
const session = (id, displayTitle, running, extra = {}) => ({ id, displayTitle, running, ...extra });
const statusMap = (entries) => new Map(Object.entries(entries));
const pending = (kind, sessionId) => ({ key: `${kind}:1`, kind, sessionId });
const icons = () => [...document.querySelectorAll('link[rel~="icon"]')];

// --- two Sessions running ---------------------------------------------------
render(stateOf([session('s-a', '会话 A：周报提纲', true), session('s-b', '会话 B：依赖升级', true)]));
await tick();

assert.equal(root.querySelector('.dsh-busy-light').getAttribute('data-busy'), 'true');
assert.deepEqual(states(), ['running', 'running'], 'one breathing chip per running Session');
assert.deepEqual(labels(), ['会话 A：周报提纲', '会话 B：依赖升级'], 'chips carry their Session names');
assert.equal(document.title, '🔵2 · DeepSeek Harness', 'tab shows the running count');

const shellIcons = icons();
assert.deepEqual(
  shellIcons.map((link) => [link.hasAttribute('data-dsh-busy-light'), link.getAttribute('type'), link.getAttribute('href').slice(0, 22)]),
  [[true, 'image/png', 'data:image/svg+xml,%3C'], [true, 'image/png', 'data:image/svg+xml,%3C']],
  'every candidate icon link is taken over, so the browser must repaint the tab',
);

// --- the shell keeps owning the base title ----------------------------------
document.title = '会话 B — DeepSeek Harness';
await tick();
assert.equal(document.title, '🔵2 · 会话 B — DeepSeek Harness', 'the prefix survives shell title rewrites');

// --- A blocks on approval ---------------------------------------------------
render(
  stateOf([session('s-a', '会话 A：周报提纲', false), session('s-b', '会话 B：依赖升级', true)]),
  statusMap({ 's-a': { running: false, pendingInteraction: pending('approval', 's-a') } }),
);
await tick();
assert.deepEqual(states(), ['waiting', 'running'], 'a waiting Session leads with a distinct state');
assert.deepEqual(tags(), ['待审批', undefined], 'the chip names the pending interaction');
assert.deepEqual(labels(), ['会话 A：周报提纲', '会话 B：依赖升级']);
assert.equal(document.title, '🟠1 🔵1 · 会话 B — DeepSeek Harness', 'waiting is counted first');
assert.equal(root.querySelector('.dsh-busy-light').getAttribute('data-pending'), 'true');

// --- answering it returns A to running --------------------------------------
render(
  stateOf([session('s-a', '会话 A：周报提纲', true), session('s-b', '会话 B：依赖升级', true)]),
  statusMap({ 's-a': { running: true } }),
);
await tick();
assert.deepEqual(states(), ['running', 'running']);
assert.deepEqual(tags(), [undefined, undefined]);
assert.equal(document.title, '🔵2 · 会话 B — DeepSeek Harness');

// --- A finishes in the background -------------------------------------------
render(
  stateOf([session('s-a', '会话 A：周报提纲', false), session('s-b', '会话 B：依赖升级', true)]),
  statusMap({ 's-a': { running: false, completionUnread: true } }),
);
await tick();
assert.deepEqual(states(), ['running', 'done'], 'the background completion turns green in place');
assert.deepEqual(labels(), ['会话 B：依赖升级', '会话 A：周报提纲'], 'running chips stay first');
assert.equal(document.title, '🔵1 🟢1 · 会话 B — DeepSeek Harness');

// The green chip is not on a timer: re-rendering does not drop it.
const stalledState = stateOf([session('s-a', '会话 A：周报提纲', false), session('s-b', '会话 B：依赖升级', true)]);
const stalledStatuses = statusMap({ 's-a': { running: false, completionUnread: true } });
for (let i = 0; i < 5; i += 1) render(stalledState, stalledStatuses);
await tick();
assert.deepEqual(states(), ['running', 'done'], 'the finished chip waits for the user, not for a clock');

// --- the user opens A: completionUnread clears, chip disappears at once ------
render(
  stateOf([session('s-a', '会话 A：周报提纲', false), session('s-b', '会话 B：依赖升级', true)]),
  statusMap({ 's-a': { running: false, completionUnread: false } }),
);
await tick();
assert.deepEqual(states(), ['running'], 'viewed completion clears immediately');
assert.equal(document.title, '🔵1 · 会话 B — DeepSeek Harness');

// --- both finish, both viewed -> idle, icons restored ------------------------
render(
  stateOf([session('s-a', '会话 A：周报提纲', true), session('s-b', '会话 B：依赖升级', true)]),
  statusMap({ 's-a': { running: true }, 's-b': { running: true } }),
);
await tick();
assert.deepEqual(states(), ['running', 'running']);
render(
  stateOf([session('s-a', '会话 A：周报提纲', false), session('s-b', '会话 B：依赖升级', false)]),
  statusMap({ 's-a': { running: false, completionUnread: true }, 's-b': { running: false, completionUnread: true } }),
);
await tick();
assert.deepEqual(states(), ['done', 'done']);
assert.equal(document.title, '🟢2 · 会话 B — DeepSeek Harness');
assert.deepEqual(icons().map((link) => link.hasAttribute('data-dsh-busy-light')), [true, true], 'green badge owns the tab');

render(
  stateOf([session('s-a', '会话 A：周报提纲', false), session('s-b', '会话 B：依赖升级', false)]),
  statusMap({ 's-a': { running: false, completionUnread: false }, 's-b': { running: false, completionUnread: false } }),
);
await tick();
assert.equal(chips().length, 1, 'only the resting pill remains');
assert.deepEqual(labels(), ['已完成']);
assert.equal(document.title, '会话 B — DeepSeek Harness', 'the tab prefix is dropped');
assert.deepEqual(
  icons().map((link) => [link.hasAttribute('data-dsh-busy-light'), link.getAttribute('type'), link.getAttribute('href')]),
  [[false, 'image/svg+xml', '/favicon.svg'], [false, 'image/svg+xml', '/favicon-dark.svg']],
  'brand icons are restored, untouched',
);

// --- the shell replacing its icon links must not steal the badge --------------
render(
  stateOf([session('s-a', '会话 A：周报提纲', true)]),
  statusMap({ 's-a': { running: true } }),
);
await tick();
const shellIcon = document.createElement('link');
shellIcon.rel = 'icon';
shellIcon.type = 'image/svg+xml';
shellIcon.href = '/favicon.svg';
document.head.appendChild(shellIcon);
for (const link of icons()) if (link !== shellIcon) link.remove();
await tick();
assert.equal(shellIcon.hasAttribute('data-dsh-busy-light'), true, 'a recreated icon link is re-adopted');
assert.match(shellIcon.getAttribute('href'), /^data:image/, 'the badge is painted onto the new link');
assert.match(document.title, /^🔵1 · /, 'the prefix survives the same rewrite');

// --- subagents are marked, named and nested like the sidebar ----------------
render(stateOf([
  session('s-a', '会话 A：周报提纲', true),
  session('s-child', '会话 A：周报提纲', true, {
    origin: 'subagent',
    parentId: 's-a',
    projectionValues: { subagent: { mode: 'continuable', label: '抓取发布说明', seq: 1 } },
  }),
]));
await tick();
assert.equal(labels()[1], '↳ 抓取发布说明', 'a subagent shows its own label, not the inherited title');
assert.equal(chips()[1].getAttribute('data-nested'), 'true', 'a shown parent nests its subagent');
assert.equal(chips()[1].querySelector('.dsh-busy-light-parent'), null, 'nesting needs no parent word');

// A subagent whose Session left the board keeps a muted context top row.
render(stateOf([
  session('s-a', '会话 A：周报提纲', false),
  session('s-child', '会话 A：周报提纲', true, {
    origin: 'subagent',
    parentId: 's-a',
    projectionValues: { subagent: { mode: 'continuable', label: '抓取发布说明', seq: 1 } },
  }),
]));
await tick();
assert.deepEqual(states(), ['context', 'running'], 'the tree keeps a top even when the parent is not lit');
assert.equal(chips()[1].getAttribute('data-nested'), 'true', 'the context row still holds the subagent');
assert.match(chips()[0].getAttribute('title'), /子代理仍在运行/, 'the context row explains itself');
chips()[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
assert.equal(opened.at(-1), 's-a', 'the context row opens its Session');

// The reported bug: viewing the finished parent must not orphan a running subagent.
const brokenTree = stateOf([
  session('s-a', '会话 A：周报提纲', false),
  session('s-child', '会话 A：周报提纲', true, {
    origin: 'subagent',
    parentId: 's-a',
    projectionValues: { subagent: { mode: 'continuable', label: '抓取发布说明', seq: 1 } },
  }),
]);
render(brokenTree, statusMap({ 's-a': { running: false, completionUnread: true } }));
await tick();
assert.deepEqual(states(), ['context', 'running'], 'a finished parent never shows green while its subagent still runs');
render(brokenTree, statusMap({ 's-a': { running: false, completionUnread: false } }));
await tick();
assert.deepEqual(states(), ['context', 'running'], 'viewing the parent does not orphan the tree');
assert.equal(chips()[1].getAttribute('data-nested'), 'true', 'the subagent stays nested after the parent is viewed');

// --- chips navigate to their Session ---------------------------------------
render(
  stateOf([session('s-a', '会话 A：周报提纲', false)]),
  statusMap({ 's-a': { running: false, completionUnread: true } }),
);
await tick();
const target = chips()[0];
assert.equal(target.tagName, 'BUTTON', 'chips are real buttons');
target.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
assert.equal(opened.at(-1), 's-a', 'clicking a chip opens that Session');

// --- dragging moves and remembers the board --------------------------------
render(stateOf([session('s-a', '会话 A', true)]));
await tick();
const board = document.querySelector('.dsh-busy-light');
const pointer = (type, x, y) => board.dispatchEvent(new window.MouseEvent(type, {
  bubbles: true, clientX: x, clientY: y,
}));
pointer('pointerdown', 0, 0);
window.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: 110, clientY: 90 }));
window.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, clientX: 110, clientY: 90 }));
assert.equal(board.style.left, '110px', 'a drag moves the board horizontally');
assert.equal(board.style.top, '90px', 'a drag moves the board vertically');
assert.equal(JSON.parse(window.localStorage.getItem('dsh-busy-light:position')).x, 110, 'the seat is remembered');

// The drag must not also open the Session that was under the pointer.
const openedBeforeDragClick = opened.length;
chips()[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
assert.equal(opened.length, openedBeforeDragClick, 'the click after a drag is swallowed');

// A plain click (no movement) still navigates.
render(stateOf([session('s-a', '会话 A', false)]), statusMap({ 's-a': { running: false, completionUnread: true } }));
await tick();
chips()[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
assert.equal(opened.at(-1), 's-a', 'a click without movement still opens the Session');

// --- the overflow row expands the tree instead of hiding it -----------------
const eight = Array.from({ length: 8 }, (_, index) => session(`s-${index}`, `会话 ${index}`, true));
render(stateOf(eight));
await tick();
assert.equal(chips().length, 7, 'six rows plus the overflow row');
assert.equal(labels().at(-1), '还有 2 个会话 ▾', 'the overflow row says how many are hidden');
const openedBeforeExpand = opened.length;
chips().at(-1).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick();
assert.equal(chips().length, 9, 'expanding shows all eight rows plus the collapse row');
assert.equal(labels().at(-1), '收起 ▴');
assert.equal(document.querySelector('.dsh-busy-light').getAttribute('data-expanded'), 'true');
assert.equal(opened.length, openedBeforeExpand, 'expanding never opens a Session');
chips().at(-1).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick();
assert.equal(chips().length, 7, 'collapsing returns to six rows plus overflow');
assert.equal(document.querySelector('.dsh-busy-light').getAttribute('data-expanded'), 'false');

console.log('render: OK — running/waiting/unread chips, navigation, dragging, overflow expansion, tab prefix and favicon takeover verified under jsdom');
// The breathing favicon interval keeps jsdom's event loop alive on purpose; the
// assertions are done, so end the process instead of waiting for it.
process.exit(0);
