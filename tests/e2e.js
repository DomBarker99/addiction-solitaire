/*
 * Browser tests. Drives the installed Google Chrome pretending to be a Galaxy S26,
 * iPhones, a desktop and a sideways phone, and checks layout, taps, drags, undo,
 * the menu and pause, timer, settings, auto-save, wins, losses, offline mode and
 * installability.
 *
 *   npm run test:browser      serves this repo on a random local port and tests it
 *   npm run test:live         tests the published site
 *   node tests/e2e.js <url>   tests any other copy
 *
 * Screenshots are saved to a temporary folder printed at the end: look at them.
 */
const fs = require('fs');
const os = require('os');
const http = require('http');
const path = require('path');
const assert = require('assert/strict');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'addiction-solitaire-e2e-'));
const DEALS = require('../deals.js');
let BASE = process.argv[2] || null; // the site under test; a local server if not given

// A tiny static file server for the repo, so the tests need nothing else installed.
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
};
function serveRepo() {
  const server = http.createServer((req, res) => {
    let file = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (file.endsWith('/')) file += 'index.html';
    file = path.join(ROOT, file);
    if (!file.startsWith(ROOT)) return res.writeHead(403).end();
    fs.readFile(file, (error, data) => {
      if (error) return res.writeHead(404).end();
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 16; SM-S941U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36';
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const DEVICES = {
  'galaxy-s26-app': { viewport: { width: 384, height: 780 }, deviceScaleFactor: 2.8125, isMobile: true, hasTouch: true, userAgent: ANDROID_UA },
  'galaxy-s26-tab': { viewport: { width: 384, height: 690 }, deviceScaleFactor: 2.8125, isMobile: true, hasTouch: true, userAgent: ANDROID_UA },
  'iphone-17': { viewport: { width: 402, height: 790 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA },
  'iphone-se': { viewport: { width: 375, height: 600 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPHONE_UA },
  desktop: { viewport: { width: 1280, height: 820 } },
  'phone-sideways': { viewport: { width: 780, height: 384 }, deviceScaleFactor: 2.8125, isMobile: true, hasTouch: true, userAgent: ANDROID_UA },
};
const phone = DEVICES['galaxy-s26-app'];

const id = (suit, rank) => suit * 13 + rank - 1;
function solvedBoard() {
  const b = [];
  for (let line = 0; line < 4; line++) {
    for (let pos = 0; pos < 12; pos++) b.push(id(line, pos + 2));
    b.push(null);
  }
  return b;
}

// Before the page's scripts: record sounds, optionally force the first deal's layout.
function hooks(page, forced) {
  return page.addInitScript((forced) => {
    window.__sounds = [];
    let sound;
    Object.defineProperty(window, 'Sound', {
      configurable: true,
      get: () => sound,
      set(v) {
        sound = v;
        const real = v.play;
        v.play = (kind) => {
          window.__sounds.push(kind);
          return real(kind);
        };
      },
    });
    if (!forced) return;
    let api;
    Object.defineProperty(window, 'Addiction', {
      configurable: true,
      get: () => api,
      set(v) {
        api = v;
        const real = v.dealFromSeed;
        let used = false;
        v.dealFromSeed = (seed) => {
          const s = real(seed);
          if (used) return s;
          used = true;
          s.board = forced.board.slice();
          s.shufflesLeft = forced.shufflesLeft;
          return s;
        };
      },
    });
  }, forced || null);
}

const readBoard = (page) =>
  page.evaluate(() => {
    const board = new Array(52).fill(null);
    document.querySelectorAll('.card').forEach((el) => (board[Number(el.dataset.slot)] = Number(el.dataset.card)));
    return board;
  });
const text = (page, sel) => page.locator(sel).innerText();
const wait = (page, ms) => page.waitForTimeout(ms);
const cardSlot = (page, card) => page.locator(`.card[data-card="${card}"]`).getAttribute('data-slot').then(Number);
const sounds = (page) => page.evaluate(() => window.__sounds.slice());
const findMove = (page, { twos = false } = {}) =>
  page.evaluate((twos) => {
    const G = window.Addiction;
    const board = new Array(52).fill(null);
    document.querySelectorAll('.card').forEach((el) => (board[Number(el.dataset.slot)] = Number(el.dataset.card)));
    for (const card of board) {
      if (card === null || (!twos && G.rankOf(card) === 2)) continue;
      const t = G.targetsFor(board, card);
      if (t.length === 1) return { card, to: t[0], from: board.indexOf(card) };
    }
    return null;
  }, twos);
const center = (page, sel) =>
  page.locator(sel).evaluate((el) => {
    const r = (el.querySelector('.face') || el).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push(['PASS', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n')[0]]);
  }
}

async function freshPage(browser, device, forced, opts = {}) {
  const context = await browser.newContext({ ...device, serviceWorkers: 'block', ...opts });
  const page = await context.newPage();
  page.errors = [];
  page.on('console', (m) => m.type() === 'error' && page.errors.push(m.text()));
  page.on('pageerror', (e) => page.errors.push(e.message));
  await hooks(page, forced);
  await page.goto(BASE);
  await wait(page, 250);
  return { context, page };
}

(async () => {
  let server = null;
  if (!BASE) {
    server = await serveRepo();
    BASE = `http://127.0.0.1:${server.address().port}/`;
  }
  console.log(`Testing ${BASE}`);
  const browser = await chromium.launch({ channel: 'chrome' });

  // ---------- Layout on each screen ----------
  for (const [name, device] of Object.entries(DEVICES)) {
    const { context, page } = await freshPage(browser, device);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    await check(`${name}: no errors`, async () => assert.deepEqual(page.errors, []));
    if (name === 'phone-sideways') {
      await check(`${name}: "turn upright" hint`, async () => assert.ok(await page.locator('.rotate-hint').isVisible()));
    } else {
      const m = await page.evaluate(() => {
        const r = (sel) => document.querySelector(sel).getBoundingClientRect();
        const slots = [...document.querySelectorAll('.slot')].map((e) => e.getBoundingClientRect());
        const face = document.querySelector('.card .face');
        return {
          scrollH: document.documentElement.scrollHeight,
          innerH: innerHeight,
          scrollW: document.documentElement.scrollWidth,
          innerW: innerWidth,
          top: Math.min(...slots.map((s) => s.top)),
          bottom: Math.max(...slots.map((s) => s.bottom)),
          header: r('.topbar').bottom,
          footer: r('.bottombar').top,
          tileH: r('.card').height,
          font: parseFloat(getComputedStyle(face).fontSize),
          menu: r('#menu-button').width,
          timer: document.getElementById('timer').innerText,
        };
      });
      await check(`${name}: fits, nothing scrolls (tile ${m.tileH.toFixed(0)}px, text ${m.font.toFixed(1)}px)`, async () => {
        assert.ok(m.scrollH <= m.innerH && m.scrollW <= m.innerW, JSON.stringify(m));
        assert.ok(m.top >= m.header - 0.5 && m.bottom <= m.footer + 0.5, JSON.stringify(m));
        assert.ok(m.tileH >= 36 && m.font >= 16, JSON.stringify(m));
        assert.ok(m.menu >= 40 && m.timer === '0:00', JSON.stringify(m));
      });
    }
    await context.close();
  }

  // ---------- Playing: tap, undo, timer, shuffle ----------
  {
    const { context, page } = await freshPage(browser, phone);
    await check('deal comes from the winnable bank', async () => {
      await page.tap('#menu-button');
      await wait(page, 300);
      const note = await text(page, '#deal-number');
      const n = Number(note.match(/#(\d+)/)[1]);
      assert.ok(DEALS.includes(n), note);
      assert.match(note, /can be won without shuffling/);
      await page.tap('.menu-panel [data-action="resume"]');
      await wait(page, 300);
    });

    let first;
    await check('tap: card slides to its gap, plays a sound, starts the clock', async () => {
      first = await findMove(page);
      assert.ok(first, 'deal has a normal move');
      assert.ok(await page.locator('#undo').isDisabled());
      await page.tap(`.card[data-card="${first.card}"]`);
      await wait(page, 300);
      assert.equal(await cardSlot(page, first.card), first.to);
      assert.ok((await sounds(page)).includes('move'));
      assert.ok(await page.locator('#undo').isEnabled());
      await wait(page, 1300);
      assert.notEqual(await text(page, '#timer'), '0:00');
    });

    await check('undo puts the card back', async () => {
      await page.tap('#undo');
      await wait(page, 300);
      assert.equal(await cardSlot(page, first.card), first.from);
      assert.ok(await page.locator('#undo').isDisabled());
    });

    await check('a card that cannot move shakes', async () => {
      const board = await readBoard(page);
      const stuck = await page.evaluate((b) => b.find((c) => c !== null && window.Addiction.targetsFor(b, c).length === 0), board);
      await page.tap(`.card[data-card="${stuck}"]`);
      assert.ok(await page.locator(`.card[data-card="${stuck}"]`).evaluate((el) => el.classList.contains('shake')));
    });

    await check('shuffle asks first; undoing it and shuffling again gives the same layout', async () => {
      const before = await readBoard(page);
      await page.tap('#shuffle');
      assert.equal(await text(page, '#shuffle .label'), 'Tap again');
      await page.tap('#shuffle');
      await wait(page, 900);
      assert.equal(await text(page, '#shuffles-left'), '2');
      assert.ok((await sounds(page)).includes('shuffle'));
      const shuffled = await readBoard(page);
      assert.notDeepEqual(shuffled, before);
      await page.tap('#undo');
      await wait(page, 900);
      assert.deepEqual(await readBoard(page), before);
      assert.equal(await text(page, '#shuffles-left'), '3');
      await page.tap('#shuffle');
      await page.tap('#shuffle');
      await wait(page, 900);
      assert.deepEqual(await readBoard(page), shuffled);
    });

    await check('menu pauses: board hidden, clock frozen; resume restarts it', async () => {
      // make a move so the clock is running
      const mv = await findMove(page, { twos: true });
      if (mv) await page.tap(`.card[data-card="${mv.card}"]`);
      await wait(page, 1200);
      await page.tap('#menu-button');
      await wait(page, 350);
      assert.ok(await page.locator('#menu').isVisible());
      assert.ok(await page.evaluate(() => document.body.classList.contains('paused')));
      assert.equal(await page.locator('#board').evaluate((el) => getComputedStyle(el).visibility), 'hidden');
      const t1 = await page.evaluate(() => document.getElementById('timer').textContent);
      await wait(page, 2200);
      const t2 = await page.evaluate(() => document.getElementById('timer').textContent);
      assert.equal(t1, t2, 'clock frozen while paused');
      await page.screenshot({ path: path.join(OUT, 'menu.png') });
      await page.tap('.menu-panel [data-action="resume"]');
      await wait(page, 2200);
      assert.ok(await page.locator('#menu').isHidden());
      assert.notEqual(await text(page, '#timer'), t2, 'clock running again');
    });

    await check('settings: wood sound and timer off are remembered, and the game comes back paused after a reload', async () => {
      await page.tap('#menu-button');
      await wait(page, 300);
      await page.tap('[data-sound="wood"]');
      await page.tap('#timer-switch');
      assert.equal(await page.locator('[data-sound="wood"]').getAttribute('aria-checked'), 'true');
      assert.ok(await page.locator('#timer').isHidden());
      await page.tap('.menu-panel [data-action="resume"]');
      await wait(page, 300);
      const board = await readBoard(page);
      const history = await page.evaluate(() => JSON.parse(localStorage.getItem('addiction-solitaire')).game.history.length);
      await page.reload();
      await wait(page, 500);
      assert.deepEqual(await readBoard(page), board);
      assert.ok(await page.locator('#menu').isVisible(), 'comes back paused');
      assert.equal(await page.locator('[data-sound="wood"]').getAttribute('aria-checked'), 'true');
      assert.ok(await page.locator('#timer').isHidden());
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('addiction-solitaire')).game.history.length), history);
      await page.tap('.menu-panel [data-action="resume"]');
      await wait(page, 300);
      assert.ok(await page.locator('#undo').isEnabled(), 'undo history survived');
      await page.tap('#menu-button');
      await wait(page, 300);
      await page.tap('#timer-switch');
      await page.tap('[data-sound="card"]');
      await page.tap('.menu-panel [data-action="resume"]');
      await wait(page, 300);
    });

    await check('leaving the app pauses it', async () => {
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await wait(page, 300);
      assert.ok(await page.locator('#menu').isVisible());
      await page.evaluate(() => delete document.hidden);
      await page.tap('.menu-panel [data-action="resume"]');
      await wait(page, 300);
    });

    await check('new game from the menu (two taps) deals a different bank deal', async () => {
      await page.tap('#menu-button');
      await wait(page, 300);
      const before = Number((await text(page, '#deal-number')).match(/#(\d+)/)[1]);
      await page.tap('#menu-new-game');
      assert.equal(await text(page, '#menu-new-game .label'), 'Tap again to start over');
      await page.tap('#menu-new-game');
      await wait(page, 900);
      assert.ok(await page.locator('#menu').isHidden());
      assert.equal(await text(page, '#shuffles-left'), '3');
      assert.equal(await text(page, '#timer'), '0:00');
      assert.ok(await page.locator('#undo').isDisabled());
      await page.tap('#menu-button');
      await wait(page, 300);
      const after = Number((await text(page, '#deal-number')).match(/#(\d+)/)[1]);
      assert.notEqual(after, before);
      assert.ok(DEALS.includes(after));
      await page.tap('.menu-panel [data-action="resume"]');
      await wait(page, 300);
    });

    await check('drag with a finger: drop on its gap moves it; drop elsewhere slides back', async () => {
      const cdp = await context.newCDPSession(page);
      const touchDrag = async (from, to) => {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
        for (let i = 1; i <= 8; i++) {
          const x = from.x + ((to.x - from.x) * i) / 8;
          const y = from.y + ((to.y - from.y) * i) / 8;
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      };
      let mv = await findMove(page);
      for (let i = 0; !mv && i < 10; i++) {
        await page.tap('#menu-button');
        await wait(page, 300);
        await page.tap('#menu-new-game');
        await page.tap('#menu-new-game');
        await wait(page, 900);
        mv = await findMove(page);
      }
      assert.ok(mv, 'found a deal with a normal move');
      // Wrong place first: drop it on its own column's top slot (not its gap).
      const start = await center(page, `.card[data-card="${mv.card}"]`);
      const wrong = await center(page, `.slot[data-slot="${mv.to === 0 ? 13 : 0}"]`);
      await touchDrag(start, wrong);
      await wait(page, 400);
      assert.equal(await cardSlot(page, mv.card), mv.from, 'slid back');
      const right = await center(page, `.slot[data-slot="${mv.to}"]`);
      await touchDrag(await center(page, `.card[data-card="${mv.card}"]`), right);
      await wait(page, 400);
      assert.equal(await cardSlot(page, mv.card), mv.to, 'dropped into its gap');
      assert.ok((await sounds(page)).includes('move'));
    });

    await check('no page errors while playing', async () => assert.deepEqual(page.errors, []));
    await context.close();
  }

  // ---------- Mouse drag on a computer ----------
  {
    const { context, page } = await freshPage(browser, DEVICES.desktop);
    await check('drag with a mouse works too', async () => {
      const mv = await findMove(page);
      assert.ok(mv);
      const a = await center(page, `.card[data-card="${mv.card}"]`);
      const b = await center(page, `.slot[data-slot="${mv.to}"]`);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps: 10 });
      await page.mouse.up();
      await wait(page, 400);
      assert.equal(await cardSlot(page, mv.card), mv.to);
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('addiction-solitaire')).game.history.length), 1, 'counted once');
    });
    await context.close();
  }

  // ---------- Fixed positions ----------
  async function scenario(name, forced, fn) {
    const { context, page } = await freshPage(browser, phone, forced);
    await check(name, () => fn(page));
    await context.close();
  }

  {
    const b = solvedBoard();
    b[50] = null;
    b[51] = id(3, 13);
    await scenario('win: celebration (tap skips), "You won!" with the time; animations alternate', { board: b, shufflesLeft: 3 }, async (page) => {
      const before = await page.evaluate(() => JSON.parse(localStorage.getItem('addiction-solitaire')).nextCelebration);
      await page.tap(`.card[data-card="${id(3, 13)}"]`);
      await page.waitForSelector('canvas.celebration', { timeout: 3000 });
      await wait(page, 1200);
      await page.screenshot({ path: path.join(OUT, `win-${before}.png`) });
      await page.mouse.click(200, 300);
      await page.waitForSelector('#overlay:not([hidden])', { timeout: 3000 });
      assert.equal(await text(page, '#overlay-title'), 'You won!');
      assert.match(await text(page, '#overlay-text'), /All 48 cards are in place in \d+:\d\d\./);
      assert.ok(await page.locator('#overlay-undo').isHidden());
      assert.ok(await page.locator('#undo').isDisabled());
      const after = await page.evaluate(() => JSON.parse(localStorage.getItem('addiction-solitaire')).nextCelebration);
      assert.equal(before, 'cascade');
      assert.equal(after, 'confetti');
      assert.equal(await page.locator('.card[style*="hidden"]').count(), 0, 'cards are back after the cascade');
    });
  }

  {
    // One move left (K clubs), and after it nothing can move and no shuffles remain.
    const b = solvedBoard();
    [b[0], b[1]] = [b[1], b[0]];
    b[50] = null;
    b[51] = id(3, 13);
    await scenario('lose: womp plays, panel offers Undo, and Undo brings the game back', { board: b, shufflesLeft: 0 }, async (page) => {
      await page.tap(`.card[data-card="${id(3, 13)}"]`);
      await page.waitForSelector('#overlay:not([hidden])', { timeout: 3000 });
      assert.equal(await text(page, '#overlay-title'), 'No more moves');
      assert.equal(await text(page, '#overlay-text'), 'You had 12 cards left.');
      assert.ok((await sounds(page)).includes('lose'));
      assert.ok(await page.locator('#overlay-undo').isVisible());
      await page.screenshot({ path: path.join(OUT, 'lost.png') });
      await page.tap('#overlay-undo');
      await wait(page, 400);
      assert.ok(await page.locator('#overlay').isHidden());
      assert.equal(await cardSlot(page, id(3, 13)), 51);
      assert.equal(await text(page, '#status'), 'Addiction Solitaire');
    });
  }

  {
    const b = solvedBoard();
    [b[0], b[1]] = [b[1], b[0]];
    await scenario('stuck: says so, Shuffle lights up and needs one tap', { board: b, shufflesLeft: 3 }, async (page) => {
      assert.equal(await text(page, '#status'), 'No moves left');
      await page.screenshot({ path: path.join(OUT, 'stuck.png') });
      await page.tap('#shuffle', { force: true });
      await wait(page, 900);
      assert.equal(await text(page, '#shuffles-left'), '2');
    });
  }

  {
    const b = solvedBoard();
    b[12] = id(2, 2); b[26] = null;
    b[25] = id(3, 2); b[39] = null;
    await scenario('a 2 with two gaps: highlight, pick one', { board: b, shufflesLeft: 3 }, async (page) => {
      await page.tap(`.card[data-card="${id(2, 2)}"]`);
      assert.equal(await text(page, '#status'), 'Tap a gap for this 2');
      await page.tap('.slot[data-slot="39"]');
      await wait(page, 400);
      assert.equal(await cardSlot(page, id(2, 2)), 39);
    });
  }

  // ---------- Install + offline ----------
  {
    const context = await browser.newContext({ ...phone });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(BASE);
    await check('service worker installs, game opens offline with sounds and deals', async () => {
      await page.evaluate(() => navigator.serviceWorker.ready);
      await page.reload();
      await context.setOffline(true);
      await page.reload();
      await wait(page, 400);
      assert.equal(await page.locator('.card').count(), 48);
      assert.ok(await page.evaluate(() => window.ADDICTION_DEALS.length > 0));
      const cached = await page.evaluate(async () => {
        const keys = await caches.keys();
        const c = await caches.open(keys.find((k) => k.startsWith('addiction-')));
        return Boolean(await c.match('sounds/riffle.wav')) && Boolean(await c.match('deals.js'));
      });
      assert.ok(cached, 'sounds and deals are saved for offline');
      await context.setOffline(false);
      assert.deepEqual(errors, []);
    });
    await context.close();
  }
  {
    const profile = path.join(OUT, 'chrome-profile');
    const context = await chromium.launchPersistentContext(profile, { channel: 'chrome', ...phone });
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(BASE);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    const cdp = await context.newCDPSession(page);
    await check('Chrome: valid manifest, no installability errors', async () => {
      const manifest = await cdp.send('Page.getAppManifest');
      assert.deepEqual(manifest.errors, []);
      const res = await cdp.send('Page.getInstallabilityErrors');
      assert.deepEqual(res.installabilityErrors, [], JSON.stringify(res.installabilityErrors));
    });
    await context.close();
  }

  await browser.close();
  if (server) server.close();
  for (const r of results) console.log(r.join('  '));
  const failed = results.filter((r) => r[0] === 'FAIL').length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  console.log(`Screenshots: ${OUT}`);
  process.exit(failed ? 1 : 0);
})();
