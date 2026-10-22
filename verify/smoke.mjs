/**
 * Hermetic smoke test for dsh-busy-light's browser half.
 *
 * Loads lib/client.js with a fake module loader, fake React and a fake slot
 * registry, then drives the exported model over every state the real
 * SessionListState + SessionStatusSnapshot can produce: blue running chips,
 * amber waiting chips for approval/question/plan-review, green chips driven by
 * `completionUnread` (cleared when the user opens the Session), ordering,
 * overflow, the tab prefix, and style/registration wiring.
 *
 * No DOM, no browser, no DSH server.
 *
 * Run: node dsh-busy-light/verify/smoke.mjs
 */
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const bundlePath = join(here, '..', 'lib', 'client.js');

// --- fake browser -----------------------------------------------------------

let captured;
globalThis.window = {
  __ModuleLoader__: { load: (entry) => { captured = entry; } },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  addEventListener() {},
  removeEventListener() {},
  innerWidth: 1280,
  innerHeight: 800,
};

const appendedStyles = [];
globalThis.document = {
  documentElement: { dataset: {} },
  querySelector: (selector) =>
    appendedStyles.find((style) => `style[data-plugin-css="${style.dataset.pluginCss}"]` === selector) ?? null,
  querySelectorAll: () => [],
  createElement: () => ({ dataset: {}, textContent: '' }),
  head: { appendChild: (element) => appendedStyles.push(element) },
};

const createElement = (type, props, ...children) => ({
  type,
  props: props ?? {},
  children: children.flat(Infinity),
});
const fakeRequire = (id) => {
  if (id === 'react') return { createElement, useState: () => [0, () => {}], useEffect: () => {} };
  throw new Error(`unexpected require(${id})`);
};

// --- load the plugin bundle -------------------------------------------------

await import(pathToFileURL(bundlePath).href);
assert.ok(captured, 'window.__ModuleLoader__.load was never called');
assert.equal(captured.id, 'dsh-busy-light', 'bundle id must equal the package name / loader entry id');
assert.equal(typeof captured.factory, 'function');

const plugin = captured.factory(fakeRequire);
assert.deepEqual(Object.keys(plugin).sort(), ['apply', 'inject'], 'test surface stays non-enumerable');
assert.equal(typeof plugin.apply, 'function');
assert.deepEqual(
  plugin.inject,
  ['slots'],
  'inject must name only services that certainly exist (a pending fiber bricks the whole Web boot)',
);
assert.equal(typeof plugin.__test, 'object', '__test surface is attached');

// --- apply: register into shell.overlay -------------------------------------

let injectedKey;
let injectedServices;
const registrations = [];
const ctx = {
  slots: {
    inject: (key, callback) => { injectedKey = key; callback(); },
    register: (spec, Component) => { registrations.push({ spec, Component }); },
  },
  inject: (services, callback) => {
    injectedServices = services;
    callback({ effect: (fn) => { fn(); return () => {} } });
  },
};

plugin.apply(ctx);
assert.equal(injectedKey, 'shell.overlay', 'must wait on the shell.overlay declaration');
assert.deepEqual(injectedServices, ['uiWorkspace'], 'chip navigation is injected, never required');
assert.equal(registrations.length, 1);
const { spec, Component } = registrations[0];
assert.equal(spec.name, 'shell.overlay');
assert.equal(spec.id, 'dsh-busy-light', 'additive list id — must not shadow a shipped occupant');
assert.equal(typeof spec.order, 'number');
assert.equal(typeof Component, 'function');

assert.equal(appendedStyles.length, 1, 'stylesheet injected once');
assert.match(appendedStyles[0].textContent, /dsh-busy-light-chip/);
plugin.apply(ctx);
assert.equal(appendedStyles.length, 1, 'stylesheet injection is idempotent across HMR reloads');

// --- model -------------------------------------------------------------------

const { buildModel, tabPrefix, stripTitlePrefix } = plugin.__test;

const row = (id, title, running, sub = false, projectionValues = undefined, parentId = undefined) => ({
  id,
  displayTitle: title,
  running,
  ...(sub ? { origin: 'subagent' } : {}),
  ...(projectionValues === undefined ? {} : { projectionValues }),
  ...(parentId === undefined ? {} : { parentId }),
});
const stateOf = (rows) => ({
  ids: rows.map((r) => r.id),
  byId: Object.fromEntries(rows.map((r) => [r.id, r])),
  phase: 'ready',
  projectionsBySession: {},
});
const statusMap = (entries) => new Map(Object.entries(entries));
const pending = (kind, sessionId) => ({ key: `${kind}:1`, kind, sessionId });

// Empty / missing snapshot degrades to the idle pill.
for (const empty of [undefined, null, {}, stateOf([])]) {
  const model = buildModel(empty, undefined);
  assert.equal(model.chips.length, 0, 'no chips without Sessions');
  assert.equal(model.busy, false);
  assert.equal(tabPrefix(model.waiting.length, model.running.length, model.done.length), '', 'idle tab keeps the shell title');
}

const A = row('s-a', '会话 A', true);
const B = row('s-b', '会话 B', true);

// Two Sessions run: two named, breathing chips.
let model = buildModel(stateOf([A, B]), undefined);
assert.equal(model.busy, true);
assert.equal(model.running.length, 2);
assert.deepEqual(model.chips.map((c) => [c.id, c.state]), [['s-a', 'running'], ['s-b', 'running']]);
assert.deepEqual(model.chips.map((c) => c.label), ['会话 A', '会话 B'], 'each chip carries its Session name');
assert.equal(tabPrefix(0, model.running.length, 0), '🔵2 · ');

// A finishes in the background: it stays green until the user opens it.
model = buildModel(
  stateOf([row('s-a', '会话 A', false), B]),
  statusMap({ 's-a': { running: false, completionUnread: true } }),
);
assert.equal(model.busy, true);
assert.deepEqual(model.chips.map((c) => [c.id, c.state]), [['s-b', 'running'], ['s-a', 'done']], 'running chips first');
assert.equal(tabPrefix(0, model.running.length, model.done.length), '🔵1 🟢1 · ');

// The user opens A: the green chip and the tab count disappear immediately.
model = buildModel(
  stateOf([row('s-a', '会话 A', false), B]),
  statusMap({ 's-a': { running: false, completionUnread: false } }),
);
assert.deepEqual(model.chips.map((c) => [c.id, c.state]), [['s-b', 'running']], 'viewed completion clears at once');
assert.equal(tabPrefix(0, model.running.length, model.done.length), '🔵1 · ');

// Both finish unviewed: two green chips, green tab, no timer involved.
model = buildModel(
  stateOf([row('s-a', '会话 A', false), row('s-b', '会话 B', false)]),
  statusMap({
    's-a': { running: false, completionUnread: true },
    's-b': { running: false, completionUnread: true },
  }),
);
assert.equal(model.busy, false);
assert.deepEqual(model.chips.map((c) => c.state), ['done', 'done']);
assert.equal(tabPrefix(0, 0, model.done.length), '🟢2 · ');

// A new run clears only the chip it restarts.
model = buildModel(
  stateOf([A, row('s-b', '会话 B', false)]),
  statusMap({ 's-a': { running: true }, 's-b': { running: false, completionUnread: true } }),
);
assert.deepEqual(model.chips.map((c) => [c.id, c.state]), [['s-a', 'running'], ['s-b', 'done']]);
assert.equal(tabPrefix(0, model.running.length, model.done.length), '🔵1 🟢1 · ');

// Ordering follows the Host list, and labels fall back to the id.
model = buildModel({
  ids: ['s-b', 's-a'],
  byId: { 's-a': row('s-a', '', true), 's-b': row('s-b', '会话 B', true) },
  phase: 'ready',
  projectionsBySession: {},
}, undefined);
assert.deepEqual(model.chips.map((c) => c.id), ['s-b', 's-a'], 'Host list order wins');
assert.equal(model.chips[1].label, 's-a', 'missing displayTitle falls back to the id');

// A Session that disappears takes its chip with it.
model = buildModel(stateOf([]), statusMap({ 's-a': { running: true } }));
assert.equal(model.running.length + model.done.length, 0, 'vanished Session leaves no ghost chip');

// Subagents are marked, not hidden, and named by their creation label.
model = buildModel(stateOf([A, row('s-child', '会话 A：周报提纲', true, true, {
  subagent: { label: '抓取发布说明' },
}, 's-a')]), undefined);
assert.deepEqual(model.chips.map((c) => c.id), ['s-a', 's-child'], 'a running subagent follows its Session');
assert.equal(model.chips[1].sub, true);
assert.equal(model.chips[1].nested, true, 'the subagent nests under its parent');
assert.equal(model.chips[1].showParent, false, 'the nested chip needs no parent word');
assert.equal(model.chips[1].label, '抓取发布说明', 'a subagent shows the label the sidebar shows, not an inherited title');
assert.deepEqual(model.tab, { waiting: 0, running: 1, done: 0 }, 'the tab counts root Sessions only');
assert.equal(tabPrefix(model.tab.waiting, model.tab.running, model.tab.done), '🔵1 · ', 'a subagent never doubles the tab count');

// The tree outranks the state split: a waiting parent still holds its running child.
model = buildModel(
  stateOf([row('s-a', '会话 A', true), row('s-child', '会话 A：周报提纲', true, true, {
    subagent: { label: '抓取发布说明' },
  }, 's-a')]),
  statusMap({ 's-a': { running: true, pendingInteraction: pending('question', 's-a') } }),
);
assert.deepEqual(model.chips.map((c) => [c.id, c.state]), [['s-a', 'waiting'], ['s-child', 'running']], 'the child never steps out of the tree');
assert.equal(model.chips[1].nested, true, 'a child nests even when the parent waits');
assert.deepEqual(model.tab, { waiting: 1, running: 0, done: 0 }, 'the nested child does not restate the tab');

// A subagent whose Session left the board keeps that Session as a muted context row.
model = buildModel(stateOf([row('s-a', '会话 A', false), row('s-child', '会话 A：周报提纲', true, true, {
  subagent: { label: '抓取发布说明' },
}, 's-a')]), undefined);
assert.deepEqual(model.chips.map((c) => [c.id, c.state]), [['s-a', 'context'], ['s-child', 'running']], 'a child never floats without its top');
assert.equal(model.chips[0].context, true, 'the ancestor is context, not a light');
assert.equal(model.chips[1].nested, true);
assert.equal(model.chips[1].showParent, false, 'the context row serves as the parent');
assert.deepEqual(model.tab, { waiting: 0, running: 0, done: 0 }, 'a context row is no Session state');

// The same fallback holds when the parent was finished first and the user viewed it.
model = buildModel(
  stateOf([row('s-a', '会话 A', false), row('s-child', '会话 A：周报提纲', true, true, {
    subagent: { label: '抓取发布说明' },
  }, 's-a')]),
  statusMap({ 's-a': { running: false, completionUnread: false } }),
);
assert.deepEqual(model.chips.map((c) => c.state), ['context', 'running'], 'viewing the parent does not orphan the tree');

// Once the child stops, the parent's completion is real again and both turn green.
model = buildModel(
  stateOf([
    row('s-a', '会话 A', false),
    row('s-child', '会话 A：周报提纲', false, true, { subagent: { label: '抓取发布说明' } }, 's-a'),
  ]),
  statusMap({
    's-a': { running: false, completionUnread: true },
    's-child': { running: false, completionUnread: true },
  }),
);
assert.deepEqual(model.chips.map((c) => [c.id, c.state]), [['s-a', 'done'], ['s-child', 'done']], 'a settled tree shows green');
assert.equal(model.chips[1].nested, true);
assert.deepEqual(model.tab, { waiting: 0, running: 0, done: 1 }, 'the tree counts as one completed root');

model = buildModel(stateOf([A, row('s-child', '子任务', true, true)]), undefined);
assert.equal(model.chips[1].label, '子任务', 'a subagent without a label keeps its display title');
assert.equal(model.chips[1].showParent, false, 'a subagent without a parent row shows no parent word');

// Overflow collapses into one summary chip.
const many = Array.from({ length: 8 }, (_, i) => row(`s-${i}`, `会话 ${i}`, true));
model = buildModel(stateOf(many), undefined);
assert.equal(model.chips.length, 6, 'chips stay capped');
assert.equal(model.hidden, 2);
assert.equal(model.total, 8, 'the model knows the whole tree');
model = buildModel(stateOf(many), undefined, true);
assert.equal(model.chips.length, 8, 'expanding lifts the cap');
assert.equal(model.hidden, 0);
assert.equal(model.expanded, true);
assert.equal(tabPrefix(model.tab.waiting, model.tab.running, model.tab.done), '🔵8 · ', 'the tab still counts every Session');

// --- waiting on the user -----------------------------------------------------

const paused = row('s-a', '会话 A', false);
const streaming = row('s-b', '会话 B', true);

// Waiting leads, outranks running and is never shown as finished.
model = buildModel(
  stateOf([paused, streaming]),
  statusMap({ 's-a': { running: false, pendingInteraction: pending('approval', 's-a') } }),
);
assert.equal(model.busy, true, 'a waiting Session keeps the light on');
assert.deepEqual(model.chips.map((c) => [c.id, c.state, c.pending]), [
  ['s-a', 'waiting', '待审批'],
  ['s-b', 'running', undefined],
], 'waiting chips lead and carry their interaction word');
assert.equal(tabPrefix(model.waiting.length, model.running.length, model.done.length), '🟠1 🔵1 · ');

// A Session that was running keeps its identity when it blocks (no done chip).
model = buildModel(
  stateOf([row('s-a', '会话 A', true), streaming]),
  statusMap({ 's-a': { running: true, pendingInteraction: pending('question', 's-a') } }),
);
assert.deepEqual(model.chips.map((c) => [c.id, c.state, c.pending]), [
  ['s-a', 'waiting', '待回答'],
  ['s-b', 'running', undefined],
]);

// Plan review has its own word too.
model = buildModel(
  stateOf([paused, streaming]),
  statusMap({ 's-a': { running: false, pendingInteraction: pending('plan-review', 's-a') } }),
);
assert.equal(model.chips[0].pending, '待确认');

// Unknown interaction kinds are ignored (the shell does not surface them either).
model = buildModel(
  stateOf([paused, streaming]),
  statusMap({ 's-a': { running: false, pendingInteraction: pending('mystery', 's-a') } }),
);
assert.equal(model.waiting.length, 0);
assert.equal(model.chips.length, 1, 'an unhandled kind leaves the Session invisible');

// Answering the interaction returns the Session to plain running.
model = buildModel(
  stateOf([A, streaming]),
  statusMap({ 's-a': { running: true } }),
);
assert.equal(model.waiting.length, 0);
assert.deepEqual(model.chips.map((c) => [c.id, c.state]), [['s-a', 'running'], ['s-b', 'running']]);

// Tab prefix round-trips over the shell-owned base title, including the old hue set.
const base = 'Session — DeepSeek Harness';
for (const [w, r, d] of [[0, 0, 0], [3, 0, 0], [0, 3, 0], [0, 0, 2], [1, 3, 1], [2, 12, 4]]) {
  const prefix = tabPrefix(w, r, d);
  assert.equal(stripTitlePrefix(prefix + base), base, `prefix ${JSON.stringify(prefix)} strips cleanly`);
}
assert.equal(stripTitlePrefix('🟡3 🟢1 · ' + base), base, 'prefixes written by the previous palette strip too');
assert.equal(stripTitlePrefix(base), base, 'a bare title is untouched');

console.log('smoke: OK — running/waiting/unread chips, order, overflow, tab prefix, registration verified');
