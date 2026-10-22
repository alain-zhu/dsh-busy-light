/**
 * Real-browser check for dsh-busy-light's preview harness.
 *
 * Opens verify/preview.html in headless Chromium, drives the fake Session
 * roster through the interesting states, asserts chips, the waiting state, the
 * tab title, the favicon takeover/restore, and refreshes the screenshots here.
 *
 * Run: node dsh-busy-light/verify/browser.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const requireHere = createRequire(import.meta.url);

let chromium;
for (const specifier of [
  'playwright',
  'D:/project/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright',
]) {
  try {
    ({ chromium } = requireHere(specifier));
    break;
  } catch {}
}
if (chromium === undefined) {
  console.log('browser: skipped — playwright is unavailable');
  process.exit(0);
}

const fileUrl = pathToFileURL(join(here, 'preview.html')).href;
const shot = name => join(here, name);

/** Newest browser this machine actually downloaded; the bundled version may lag. */
function findBrowser() {
  const base = process.env.LOCALAPPDATA === undefined
    ? undefined
    : join(process.env.LOCALAPPDATA, 'ms-playwright');
  if (base === undefined || !existsSync(base)) return undefined;
  const candidates = [];
  for (const name of readdirSync(base)) {
    if (name.startsWith('chromium_headless_shell-')) {
      candidates.push(join(base, name, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'));
    } else if (name.startsWith('chromium-')) {
      candidates.push(join(base, name, 'chrome-win64', 'chrome.exe'));
    }
  }
  return candidates.find(existsSync);
}

let browser;
let launchError;
try {
  browser = await chromium.launch();
} catch (error) {
  launchError = error;
}
if (browser === undefined) {
  const executablePath = findBrowser();
  if (executablePath !== undefined) {
    try {
      browser = await chromium.launch({ executablePath });
    } catch (error) {
      launchError = error;
    }
  }
}
if (browser === undefined) {
  // Missing download, or Chromium's debugging pipe (a named pipe) refused by a
  // confined sandbox: report it and let the other suites stand in.
  const message = String(launchError);
  if (/EPERM|spawn|Executable doesn't exist/i.test(message)) {
    console.log('browser: skipped — Chromium is unavailable or blocked (sandbox / missing download)');
    process.exit(0);
  }
  throw launchError;
}
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const pageErrors = [];
page.on('pageerror', (error) => { pageErrors.push(String(error)); });

const chips = () => page.locator('.dsh-busy-light-chip');
const chipStates = () => chips().evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-state')));
const chipLabels = () => chips().evaluateAll((nodes) => nodes.map((node) => node.querySelector('.dsh-busy-light-label').textContent.trim()));
const chipTags = () => chips().evaluateAll((nodes) => nodes.map((node) => node.querySelector('.dsh-busy-light-tag')?.textContent ?? null));
const lightState = () => page.locator('.dsh-busy-light').getAttribute('data-busy');

/** Shape of the icon links while the light owns the tab. */
const iconLinks = () => page.evaluate(() => [...document.querySelectorAll('link[rel~="icon"]')].map((link) => ({
  owned: link.hasAttribute('data-dsh-busy-light'),
  type: link.getAttribute('type'),
  href: link.getAttribute('href'),
  media: link.getAttribute('media'),
})));

try {
  await page.goto(fileUrl);
  await page.waitForSelector('.dsh-busy-light');
  await page.waitForTimeout(120);

  // Resting: one green pill, untouched tab title and icons.
  assert.equal(await lightState(), 'false');
  assert.deepEqual(await chipLabels(), ['已完成']);
  assert.equal(await page.title(), 'dsh-busy-light preview', 'idle keeps the shell title');
  const idleIcons = await iconLinks();
  assert.deepEqual(idleIcons.map((link) => link.owned), [false, false], 'idle leaves the brand icons alone');
  await page.screenshot({ path: shot('shot-idle.png') });

  // Three Sessions run: three named blue breathing chips + 🔵3 in the tab.
  await page.click('[data-preset="three"]');
  await page.waitForTimeout(150);
  assert.equal(await lightState(), 'true');
  assert.deepEqual(await chipStates(), ['running', 'running', 'running']);
  assert.deepEqual(await chipLabels(), [
    '会话 A：周报提纲',
    '会话 B：依赖升级',
    '会话 C：补齐测试',
  ], 'each chip names its Session');
  assert.match(await page.title(), /^🔵3 · dsh-busy-light preview$/, 'tab carries the running count');

  // The stack is left-aligned: every chip shares its left edge, right edges vary.
  const chipBoxes = await chips().evaluateAll((nodes) => nodes.map((node) => {
    const rect = node.getBoundingClientRect();
    return { left: Math.round(rect.left), right: Math.round(rect.right) };
  }));
  assert.equal(new Set(chipBoxes.map((box) => box.left)).size, 1, 'chips share their left edge');
  assert.ok(new Set(chipBoxes.map((box) => box.right)).size > 1, 'right edges are free to differ');

  // Chips navigate: clicking one asks the shell to open that Session.
  await chips().nth(1).click();
  assert.deepEqual(
    await page.evaluate(() => window.__dshOpenLog.slice()),
    ['s-b'],
    'clicking a chip opens its Session',
  );

  // Breathing: the core must actually animate, not just carry an animation name.
  const breathe = async (state) => {
    const samples = [];
    for (let index = 0; index < 5; index += 1) {
      samples.push(await page.evaluate((wanted) => {
        const core = document.querySelector(`.dsh-busy-light-chip[data-state="${wanted}"] .dsh-busy-light-core`);
        const style = getComputedStyle(core);
        return {
          name: style.animationName,
          duration: style.animationDuration,
          frame: style.transform + '|' + style.opacity,
        };
      }, state));
      await page.waitForTimeout(110);
    }
    return samples;
  };
  const runningBreath = await breathe('running');
  assert.ok(runningBreath.every((sample) => sample.name.includes('dsh-busy-light-breathe')), 'the running core breathes');
  assert.ok(new Set(runningBreath.map((sample) => sample.frame)).size > 1, 'the running breath changes over time');

  const busyIcons = await iconLinks();
  assert.equal(busyIcons.length, 2, 'both shell icon links exist');
  assert.deepEqual(busyIcons.map((link) => link.owned), [true, true], 'the light takes over every icon candidate');
  assert.deepEqual(busyIcons.map((link) => link.type), ['image/png', 'image/png']);
  assert.deepEqual(
    busyIcons.map((link) => link.href.startsWith('data:image/png')),
    [true, true],
    'the tab icon is the drawn state badge',
  );
  // The shell may recreate its icon links (navigation, theme sync): re-adopt them.
  await page.evaluate(() => {
    for (const link of [...document.querySelectorAll('link[rel~="icon"]')]) link.remove();
    const fresh = document.createElement('link');
    fresh.rel = 'icon';
    fresh.type = 'image/svg+xml';
    fresh.href = '/favicon.svg';
    document.head.appendChild(fresh);
  });
  await page.waitForTimeout(150);
  const adopted = await iconLinks();
  assert.equal(adopted.length, 1, 'only the recreated link remains');
  assert.equal(adopted[0].owned, true, 'a recreated icon link is re-adopted');
  assert.ok(adopted[0].href.startsWith('data:image/png'), 'the badge is painted onto the new link');
  await page.evaluate((originals) => {
    for (const link of [...document.querySelectorAll('link[rel~="icon"]')]) link.remove();
    for (const item of originals) {
      const link = document.createElement('link');
      link.rel = 'icon';
      if (item.type !== null) link.type = item.type;
      if (item.media !== null) link.setAttribute('media', item.media);
      link.href = item.href;
      document.head.appendChild(link);
    }
  }, idleIcons.map((link) => ({ href: link.href, type: link.type, media: link.media })));
  await page.waitForTimeout(150);
  assert.deepEqual((await iconLinks()).map((link) => link.owned), [true, true], 'the recreated pair is owned again');
  await page.screenshot({ path: shot('shot-multi.png') });

  // A Session blocks on approval: amber, leading, with its interaction word.
  await page.click('[data-preset="waitingApproval"]');
  await page.waitForTimeout(200);
  assert.deepEqual(await chipStates(), ['waiting', 'running', 'running'], 'the waiting chip leads and is its own state');
  assert.deepEqual(await chipTags(), ['待审批', null, null], 'the chip names the pending interaction');
  assert.equal(await page.locator('.dsh-busy-light').getAttribute('data-pending'), 'true');
  const waitingBreath = await breathe('waiting');
  assert.ok(waitingBreath.every((sample) => sample.name.includes('dsh-busy-light-breathe')), 'the waiting core breathes');
  assert.ok(new Set(waitingBreath.map((sample) => sample.frame)).size > 1, 'the waiting breath changes over time');
  assert.equal(waitingBreath[0].duration, '0.9s', 'waiting breathes faster than running');
  assert.equal(runningBreath[0].duration, '1.2s', 'running keeps the calmer period');
  assert.match(await page.title(), /^🟠1 🔵2 · /, 'waiting is counted before running');
  await page.screenshot({ path: shot('shot-waiting.png') });

  // A finishes in the background: green chip that waits for the user.
  await page.click('[data-preset="oneDone"]');
  await page.waitForTimeout(200);
  assert.deepEqual(await chipStates(), ['running', 'done'], 'background completions turn green');
  assert.match(await page.title(), /^🔵1 🟢1 · /, 'tab counts running and finished separately');
  await page.screenshot({ path: shot('shot-partial.png') });

  // Every finished Session is unread: green board.
  await page.click('[data-preset="allDone"]');
  await page.waitForTimeout(200);
  assert.equal(await lightState(), 'false');
  assert.deepEqual(await chipStates(), ['done', 'done', 'done']);
  assert.match(await page.title(), /^🟢3 · /);
  assert.deepEqual((await iconLinks()).map((link) => link.owned), [true, true], 'a green badge still owns the tab');
  await page.screenshot({ path: shot('shot-done.png') });

  // Clicking a green chip opens (and thus acknowledges) that Session.
  await chips().first().click();
  await page.waitForTimeout(120);
  assert.deepEqual(
    await page.evaluate(() => window.__dshOpenLog.slice()),
    ['s-b', 's-a'],
    'the green chip navigates to its Session',
  );
  assert.deepEqual(await chipStates(), ['done', 'done'], 'the viewed completion leaves the board');
  assert.match(await page.title(), /^🟢2 · /, 'the tab count follows the acknowledgement');

  // The user views them: chips and tab state clear immediately, icons restore.
  await page.click('[data-preset="viewDone"]');
  await page.waitForTimeout(200);
  assert.deepEqual(await chipLabels(), ['已完成'], 'viewing the finished Sessions clears the board');
  assert.equal(await page.title(), 'dsh-busy-light preview', 'the tab prefix is dropped');
  const restoredIcons = await iconLinks();
  assert.deepEqual(restoredIcons.map((link) => link.owned), [false, false], 'brand icons are restored');
  assert.deepEqual(restoredIcons.map((link) => link.type), ['image/svg+xml', 'image/svg+xml']);
  assert.deepEqual(
    restoredIcons.map((link) => link.href),
    [idleIcons[0].href, idleIcons[1].href],
    'the original hrefs come back byte for byte',
  );

  // A subagent chip carries the label the sidebar uses, not the inherited title.
  await page.click('[data-preset="subagent"]');
  await page.waitForTimeout(150);
  assert.deepEqual(
    await chipLabels(),
    ['会话 A：周报提纲', '↳ 抓取发布说明'],
    'the subagent chip shows its own label',
  );
  assert.deepEqual(await chipStates(), ['running', 'running']);
  const subBoxes = await chips().evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().left)));
  assert.ok(subBoxes[1] > subBoxes[0], 'the subagent chip nests under its Session');
  assert.equal(await chips().nth(1).getAttribute('data-nested'), 'true');
  assert.match(await page.title(), /^🔵1 · /, 'the tab counts the root Session only, not its subagent');
  await page.screenshot({ path: shot('shot-subagent.png') });

  // The tree outranks the state split: a waiting parent keeps its running child nested.
  await page.click('[data-preset="pendingParent"]');
  await page.waitForTimeout(150);
  assert.deepEqual(await chipStates(), ['waiting', 'running'], 'the child never steps out of the tree');
  assert.deepEqual(await chipLabels(), ['会话 A：周报提纲', '↳ 抓取发布说明']);
  assert.equal(await chips().nth(1).getAttribute('data-nested'), 'true', 'a waiting parent still holds its child');
  assert.match(await page.title(), /^🟠1 · /, 'only the root Session is counted');

  // The reported bug: view the finished parent, its running subagent keeps its top.
  await page.click('[data-preset="parentDoneChildRunning"]');
  await page.waitForTimeout(150);
  assert.deepEqual(await chipStates(), ['context', 'running'], 'a finished parent never shows green while its subagent still runs');
  const openedBeforeView = await page.evaluate(() => window.__dshOpenLog.length);
  await chips().first().click();
  await page.waitForTimeout(200);
  assert.deepEqual(await chipStates(), ['context', 'running'], 'viewing the parent keeps the tree');
  assert.equal(await chips().nth(1).getAttribute('data-nested'), 'true', 'the subagent never floats without its top');
  assert.equal(await page.evaluate(() => window.__dshOpenLog.length), openedBeforeView + 1, 'the view came from that row');
  await page.screenshot({ path: shot('shot-context.png') });

  // Eight running Sessions: chips cap, tab keeps the full count.
  await page.click('[data-preset="many"]');
  await page.waitForTimeout(150);
  assert.equal(await chips().count(), 7, 'six chips plus the overflow chip');
  assert.match((await chipLabels()).at(-1), /^还有 2 个会话 ▾$/, 'overflow states the remainder');
  assert.match(await page.title(), /^🔵8 · /, 'the tab still counts every Session');

  // The overflow row is a way in, not a dead end: it expands the tree.
  await chips().last().click();
  await page.waitForTimeout(150);
  assert.equal(await chips().count(), 9, 'expanding shows every Session plus a collapse row');
  assert.match((await chipLabels()).at(-1), /^收起/, 'the expanded board offers a way back');
  assert.equal(await page.locator('.dsh-busy-light').getAttribute('data-expanded'), 'true');
  await page.screenshot({ path: shot('shot-expanded.png') });
  const openedBeforeExpandClick = await page.evaluate(() => window.__dshOpenLog.length);
  await chips().nth(7).click();
  await page.waitForTimeout(150);
  assert.equal(
    await page.evaluate(() => window.__dshOpenLog.length),
    openedBeforeExpandClick + 1,
    'a row revealed by expanding still opens its Session',
  );
  await chips().last().click();
  await page.waitForTimeout(150);
  assert.equal(await chips().count(), 7, 'collapsing returns to the compact seat');
  assert.equal(await page.locator('.dsh-busy-light').getAttribute('data-expanded'), 'false');

  // Dark theme stays legible.
  await page.click('[data-preset="three"]');
  await page.waitForTimeout(150);
  await page.click('[data-theme-toggle]');
  await page.waitForTimeout(150);
  await page.screenshot({ path: shot('shot-dark.png') });

  // The board is draggable: drag it away, then find it there again after a reload.
  const boardBox = () => page.evaluate(() => {
    const rect = document.querySelector('.dsh-busy-light').getBoundingClientRect();
    return { left: Math.round(rect.left), top: Math.round(rect.top) };
  });
  const beforeDrag = await boardBox();
  const grab = await page.locator('.dsh-busy-light-chip').first().boundingBox();
  const openedBeforeDrag = await page.evaluate(() => window.__dshOpenLog.length);
  await page.mouse.move(grab.x + grab.width / 2, grab.y + grab.height / 2);
  await page.mouse.down();
  await page.mouse.move(grab.x + grab.width / 2 - 180, grab.y + grab.height / 2 - 140, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(120);
  const afterDrag = await boardBox();
  assert.equal(afterDrag.left, beforeDrag.left - 180, 'a drag moves the board horizontally');
  assert.equal(afterDrag.top, beforeDrag.top - 140, 'a drag moves the board vertically');
  assert.equal(
    await page.evaluate(() => window.__dshOpenLog.length),
    openedBeforeDrag,
    'a drag never opens the Session under the pointer',
  );
  const storedSeat = await page.evaluate(() => {
    try {
      return localStorage.getItem('dsh-busy-light:position');
    } catch {
      return null;
    }
  });
  assert.ok(storedSeat !== null, 'the seat is stored');
  await page.reload();
  await page.waitForTimeout(400);
  const restoredSeat = await boardBox();
  assert.equal(restoredSeat.left, afterDrag.left, 'the seat survives a reload (left)');
  assert.equal(restoredSeat.top, afterDrag.top, 'the seat survives a reload (top)');

  assert.deepEqual(pageErrors, [], `the preview must not throw: ${pageErrors.join('; ')}`);
  console.log('browser: OK — running/waiting/unread chips, nesting, dragging, tab prefix, favicon takeover and restore verified');
} finally {
  await browser.close();
}
