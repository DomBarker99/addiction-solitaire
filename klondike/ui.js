/*
 * Solitaire (Klondike): the table. Draws the cards and handles taps, drags,
 * Undo and Finish.
 *
 * The rules are in rules.js, in this folder. Everything around the table
 * (the menu and pause, the timer, settings, the win/lose panel, auto-save)
 * is shared with the other games and lives in ../shell.js.
 *
 * Layout, for a phone held upright:
 *   top row:  the 4 foundations on the left, the waste, then the stock on the right
 *   below:    the 7 columns, each fanned downwards
 * Every card is a <button> that stays on the page for the whole game. This
 * file works out where each card goes, in pixels, and puts it there with the
 * CSS variables --x and --y; style.css animates the slide. Long columns
 * squeeze their cards closer together so the table always fits the screen.
 *
 * Tapping a card sends it to the best place for it (see bestTarget in
 * rules.js); dragging lets you choose. Tapping the stock turns cards over.
 */
(() => {
  'use strict';

  if (window.Shell.redirecting) return; // another game opens instead (see ../shell.js)

  const K = window.Klondike;
  const C = window.Cards;
  const Sound = window.Sound;

  const $ = (id) => document.getElementById(id);
  const boardEl = $('board');
  const undoBtn = $('undo');
  const finishBtn = $('finish');
  const menuEl = $('menu');
  const drawNoteEl = $('draw-note');

  const STATUS_TEXT = { lost: 'No more moves', won: 'Solved!' };
  const DRAG_START_PX = 8; // a finger has to move this far before a tap becomes a drag
  const FINISH_STEP_MS = 110; // time between cards when Finish plays the game out

  // ---------- State ----------

  let state; // the game itself (see rules.js)
  let geometry = null; // card size and where the piles are (see measure())
  let drag = null; // the cards being dragged, if any
  let ignoreNextClick = false;
  let finishing = false; // Finish is playing the cards out
  let dealTimer = 0;
  let started = false; // cards only animate once the page has drawn them the first time

  const cardEls = new Map(); // card number -> its <button>
  const spotEls = {}; // pile name -> the outline shown when that pile is empty
  const liftTimers = new Map();

  // What the shared parts (shell.js) need to know about this game.
  const app = window.Shell.create({
    saveKey: 'klondike-solitaire',
    saveVersion: 1,
    bank: [], // no bank of winnable deals yet: any deal
    current: () => state,
    status: () => K.status(state),
    moved: () => state.history.length > 0,
    restore(saved) {
      const restored = K.restore(saved);
      if (!restored || K.isWon(restored)) return false;
      state = restored;
      return true;
    },
    deal,
    render,
    cancel: cancelDrag,
    undo: undoLast,
    statusText: (status) => STATUS_TEXT[status] || `Solitaire · Draw ${state.draw}`,
    dealNote: () => (state.seed === null ? '' : `Deal #${state.seed}`),
    lostText() {
      const left = 52 - K.cardsHome(state);
      return `You had ${left} ${left === 1 ? 'card' : 'cards'} left.`;
    },
    wonText: (time) => `All 52 cards are in place${time}.`,
    celebrationCards: () => [...cardEls].map(([card, el]) => ({ card, el })),
    onDeal: gatherCards,
    renderMenu,
  });

  const drawSetting = () => (app.settings.draw === 3 ? 3 : 1);

  // Deal number `number`, turning over as many cards as the Draw setting
  // says. Now and then a Draw 3 deal has nothing at all to do; those are skipped.
  function deal(number) {
    finishing = false;
    let n = number;
    let dealt = K.dealFromSeed(n, drawSetting());
    while (K.status(dealt) === 'lost') {
      n = (n + 1) >>> 0;
      dealt = K.dealFromSeed(n, drawSetting());
    }
    state = dealt;
  }

  // ---------- Where everything goes ----------

  // The card size and pile positions for the board's current size.
  function measure() {
    const width = boardEl.clientWidth;
    const height = boardEl.clientHeight;
    const gap = Math.max(3, Math.round(width * 0.012));
    let cardW = (width - gap * 6) / 7;
    let cardH = cardW * 1.4;
    // A very short screen: smaller cards, so even a long column fits.
    const tallest = (height - gap * 3) / 4.6;
    if (cardH > tallest) {
      cardH = tallest;
      cardW = cardH / 1.4;
    }
    const left = (width - (cardW * 7 + gap * 6)) / 2;
    return {
      cardW,
      cardH,
      gap,
      height,
      x: (column) => left + column * (cardW + gap), // the left edge of a column
      columnsTop: cardH + gap * 3,
    };
  }

  // How far apart a column's cards are. Face-down cards only show a sliver;
  // face-up ones show their rank and suit. A long column squeezes both.
  function columnSteps(c) {
    const g = geometry;
    const column = state.columns[c];
    const hidden = state.hidden[c];
    let down = g.cardH * 0.12;
    let up = g.cardH * 0.3;
    const faceUpBelowTop = Math.max(0, column.length - hidden - 1);
    const needed = hidden * down + faceUpBelowTop * up;
    const room = g.height - g.columnsTop - g.cardH;
    if (needed > room) {
      down *= room / needed;
      up *= room / needed;
    }
    return { down, up };
  }

  // Top-left corner of each pile's outline.
  function spotPosition(name) {
    const g = geometry;
    if (name === 'stock') return [g.x(6), 0];
    if (name[0] === 'f') return [g.x(Number(name[1])), 0];
    return [g.x(Number(name[1])), g.columnsTop];
  }

  // ---------- Drawing ----------

  function buildBoard() {
    const piles = ['stock', 'f0', 'f1', 'f2', 'f3', 'c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6'];
    for (const name of piles) {
      const el = document.createElement('div');
      el.className = name === 'stock' ? 'spot stock' : 'spot';
      el.dataset.pile = name;
      if (name === 'stock') {
        el.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.4-5.7M20 4v5h-5" /></svg>';
      } else {
        el.textContent = name[0] === 'f' ? 'A' : 'K'; // what can start the pile
      }
      boardEl.append(el);
      spotEls[name] = el;
    }
    for (let card = 0; card < 52; card++) {
      const suit = C.SUITS[C.suitOf(card)].name;
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `card down ${C.isRed(card) ? 'red' : 'black'}`;
      el.dataset.card = card;
      el.innerHTML =
        `<span class="face"><span class="corner"><span class="rank">${C.rankLabel(card)}</span>` +
        `<svg class="suit" aria-hidden="true"><use href="#suit-${suit}"></use></svg></span>` +
        `<svg class="pip" aria-hidden="true"><use href="#suit-${suit}"></use></svg></span>` +
        '<span class="back"></span>';
      boardEl.append(el);
      cardEls.set(card, el);
    }
  }

  // `under`: another card sits exactly on top of this one (in the stock, the
  // waste or a foundation), so it drops its shadow; a pile of 24 shadows
  // would add up to a dark smudge.
  function place(card, x, y, z, faceUp, under = false) {
    const el = cardEls.get(card);
    el.style.setProperty('--x', `${x}px`);
    el.style.setProperty('--y', `${y}px`);
    el.style.setProperty('--z', z);
    el.classList.toggle('under', under);
    if (el.classList.contains('down') === faceUp) {
      el.classList.toggle('down', !faceUp);
      if (started && !boardEl.classList.contains('dealing')) turnOver(el);
    }
    el.setAttribute('aria-label', faceUp ? C.cardName(card) : 'Face-down card');
  }

  // The table and the buttons under it. shell.js draws the top bar.
  function render() {
    if (!geometry) geometry = measure();
    const g = geometry;
    boardEl.style.setProperty('--card-w', `${g.cardW}px`);
    boardEl.style.setProperty('--card-h', `${g.cardH}px`);
    const targets = drag && drag.moving ? drag.targets : [];

    for (const [name, el] of Object.entries(spotEls)) {
      const [x, y] = spotPosition(name);
      el.style.setProperty('--x', `${x}px`);
      el.style.setProperty('--y', `${y}px`);
      el.classList.toggle('target', targets.includes(name) && K.pile(state, name).length === 0);
    }
    spotEls.stock.classList.toggle('recycle', state.stock.length === 0 && state.waste.length > 0);

    state.stock.forEach((card, i) => place(card, g.x(6), 0, i + 1, false, i < state.stock.length - 1));

    // Draw 1 keeps the waste in one pile next to the stock. Draw 3 fans out
    // the cards from the last tap, left to right, on top of the older ones.
    const fan = state.draw === 3 ? Math.min(K.wasteFan(state), state.waste.length) : 0;
    const fanStep = (g.cardW + g.gap) / 2;
    const wasteX = (i) => (state.draw === 1 ? g.x(5) : g.x(4) + Math.max(0, i - (state.waste.length - fan)) * fanStep);
    state.waste.forEach((card, i) => {
      const under = i < state.waste.length - 1 && wasteX(i + 1) === wasteX(i);
      place(card, wasteX(i), 0, i + 1, true, under);
    });

    state.foundations.forEach((foundation, f) => {
      foundation.forEach((card, i) => place(card, g.x(f), 0, i + 1, true, i < foundation.length - 1));
    });

    state.columns.forEach((column, c) => {
      const steps = columnSteps(c);
      let y = g.columnsTop;
      column.forEach((card, i) => {
        const faceUp = i >= state.hidden[c];
        place(card, g.x(c), y, i + 1, faceUp);
        y += faceUp ? steps.up : steps.down;
      });
    });

    // While dragging, the top card of each pile it could go on lights up.
    for (const [card, el] of cardEls) {
      const where = K.find(state, card);
      const pile = K.pile(state, where.pile);
      el.classList.toggle('target', targets.includes(where.pile) && where.index === pile.length - 1);
    }

    const status = K.status(state);
    undoBtn.disabled = state.history.length === 0 || status === 'won' || finishing;
    finishBtn.disabled = finishing || !K.canAutoFinish(state);
    finishBtn.classList.toggle('ready', !finishBtn.disabled);
  }

  function renderMenu() {
    for (const button of menuEl.querySelectorAll('[data-draw]')) {
      button.setAttribute('aria-checked', String(Number(button.dataset.draw) === drawSetting()));
    }
    drawNoteEl.hidden = drawSetting() === state.draw;
    drawNoteEl.textContent = `Draw ${drawSetting()} starts with your next game.`;
  }

  // Raise cards above the others while they slide.
  function lift(cards) {
    for (const card of cards) {
      const el = cardEls.get(card);
      el.classList.add('lifted');
      clearTimeout(liftTimers.get(card));
      liftTimers.set(card, setTimeout(() => el.classList.remove('lifted'), 350));
    }
  }

  function shake(cards) {
    for (const card of cards) {
      const el = cardEls.get(card);
      el.classList.remove('shake');
      void el.offsetWidth; // restart the animation if it is already running
      el.classList.add('shake');
    }
  }

  function turnOver(el) {
    el.classList.remove('turning');
    void el.offsetWidth;
    el.classList.add('turning');
  }

  // A new deal: every card jumps to the stock face down, then flies out to
  // its place, column by column, the way a person deals.
  function gatherCards() {
    const g = geometry;
    boardEl.classList.remove('dealing');
    boardEl.classList.add('instant');
    for (const el of cardEls.values()) {
      el.style.setProperty('--x', `${g.x(6)}px`);
      el.style.setProperty('--y', '0px');
      el.style.setProperty('--delay', '0ms');
      el.classList.add('down');
      el.classList.remove('turning', 'shake', 'lifted', 'target');
    }
    void boardEl.offsetWidth; // jump now, before the deal starts
    boardEl.classList.remove('instant');
    boardEl.classList.add('dealing');
    state.columns.forEach((column, c) =>
      column.forEach((card, row) => cardEls.get(card).style.setProperty('--delay', `${(row * 7 + c) * 18}ms`)),
    );
    clearTimeout(dealTimer);
    dealTimer = setTimeout(() => boardEl.classList.remove('dealing'), 1300);
  }

  // ---------- Game actions ----------

  function tapStock() {
    const turned = K.draw(state);
    if (!turned) return;
    lift(turned.draw ? state.waste.slice(-turned.draw) : state.stock);
    Sound.play('move');
    app.changed();
  }

  function moveCards(card, to) {
    const run = K.runFrom(state, card);
    if (!K.move(state, card, to)) return false;
    lift(run);
    Sound.play('move');
    app.changed();
    return true;
  }

  function undoLast() {
    if (app.celebrating || finishing || K.status(state) === 'won' || !state.history.length) return;
    cancelDrag();
    app.endConfirm();
    app.hideOverlay();
    const undone = K.undo(state);
    if (undone.draw) lift(state.stock.slice(-undone.draw));
    else if (undone.recycle) lift(state.waste);
    else lift(K.pile(state, undone.from).slice(-undone.count));
    Sound.play('move');
    app.changed({ quiet: true });
  }

  // Plays the cards out one at a time, then the game is won.
  function finish() {
    if (finishing || !K.canAutoFinish(state)) return;
    app.endConfirm();
    finishing = true;
    const game = state;
    const step = () => {
      if (state !== game) return; // a new game started meanwhile
      if (app.paused) return setTimeout(step, 250); // wait while the menu is open
      const next = K.finishMove(state);
      if (!next) {
        finishing = false;
        return app.render();
      }
      if (next.draw) {
        K.draw(state);
      } else {
        lift([next.card]);
        K.move(state, next.card, next.to);
        Sound.play('move');
      }
      if (K.isWon(state)) finishing = false;
      app.changed();
      if (finishing) setTimeout(step, next.draw ? FINISH_STEP_MS / 2 : FINISH_STEP_MS);
    };
    step();
  }

  // ---------- Taps ----------

  function tapCard(card) {
    const where = K.find(state, card);
    if (where.pile === 'stock') return tapStock();
    if (where.pile[0] === 'f') return; // foundation cards come back down by dragging
    if (where.pile === 'waste') card = state.waste[state.waste.length - 1]; // any of the fan means its top card
    const run = K.runFrom(state, card);
    if (!run) return shake([card]); // face down
    const to = K.bestTarget(state, card);
    if (to) moveCards(card, to);
    else shake(run);
  }

  boardEl.addEventListener('click', (event) => {
    if (ignoreNextClick || finishing || app.celebrating || K.status(state) === 'won') return;
    app.endConfirm();
    const cardEl = event.target.closest('.card');
    const spotEl = event.target.closest('.spot');
    if (cardEl) tapCard(Number(cardEl.dataset.card));
    else if (spotEl && spotEl.dataset.pile === 'stock') tapStock();
    app.render();
  });

  boardEl.addEventListener('animationend', (event) => {
    const el = event.target.closest('.card');
    if (!el) return;
    if (event.animationName === 'shake') el.classList.remove('shake');
    if (event.animationName === 'turn') el.classList.remove('turning');
  });

  finishBtn.addEventListener('click', finish);
  undoBtn.addEventListener('click', undoLast);

  // ---------- Dragging ----------

  // Which pile is under a point on the screen: a foundation in the top row,
  // or a column anywhere below it. null for anywhere else.
  function pileAt(x, y) {
    const box = boardEl.getBoundingClientRect();
    const g = geometry;
    const column = Math.floor((x - box.left - g.x(0) + g.gap / 2) / (g.cardW + g.gap));
    const top = y - box.top;
    if (column < 0 || column > 6 || top < 0) return null;
    if (top < g.cardH + g.gap * 1.5) return column < 4 ? `f${column}` : null;
    return `c${column}`;
  }

  // Where dragged cards were dropped: a pile they can go on, under the middle
  // of the first card or else under the finger.
  function dropTarget(event) {
    const box = drag.els[0].getBoundingClientRect();
    const under = [pileAt(box.left + box.width / 2, box.top + box.height / 2), pileAt(event.clientX, event.clientY)];
    return under.find((name) => name && drag.targets.includes(name)) || null;
  }

  boardEl.addEventListener('pointerdown', (event) => {
    if (drag || finishing || app.paused || app.celebrating || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const el = event.target.closest('.card');
    if (!el || K.status(state) === 'won') return;
    let card = Number(el.dataset.card);
    if (K.find(state, card).pile === 'waste') card = state.waste[state.waste.length - 1];
    const run = K.runFrom(state, card);
    if (!run) return; // face down, or under another card
    drag = { card, run, els: run.map((c) => cardEls.get(c)), grabbed: el, id: event.pointerId, x: event.clientX, y: event.clientY, moving: false };
  });

  boardEl.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moving) {
      if (Math.hypot(dx, dy) < DRAG_START_PX) return;
      drag.moving = true;
      app.endConfirm();
      drag.targets = K.targetsFor(state, drag.card);
      try {
        drag.grabbed.setPointerCapture(drag.id);
      } catch (error) {
        // The pointer may already be gone; the drag still finishes on pointerup.
      }
      for (const el of drag.els) el.classList.add('dragging');
      app.render();
    }
    for (const el of drag.els) el.style.transform = `translate(calc(var(--x) + ${dx}px), calc(var(--y) + ${dy}px))`;
  });

  // Puts dragged cards back where they were (they slide), e.g. when the menu opens.
  function cancelDrag() {
    if (!drag) return;
    for (const el of drag.els) {
      el.classList.remove('dragging');
      el.style.transform = '';
    }
    drag = null;
  }

  function endDrag(event, cancelled) {
    if (!drag || event.pointerId !== drag.id) return;
    if (!drag.moving) {
      drag = null; // just a tap: the click handler takes it from here
      return;
    }
    ignoreNextClick = true;
    setTimeout(() => (ignoreNextClick = false), 0);
    const { card, run } = drag;
    const to = cancelled ? null : dropTarget(event);
    cancelDrag();
    lift(run);
    if (!to || !moveCards(card, to)) app.render();
  }

  boardEl.addEventListener('pointerup', (event) => endDrag(event, false));
  boardEl.addEventListener('pointercancel', (event) => endDrag(event, true));

  // ---------- Menu ----------

  // The Draw setting. If no move has been made yet it applies straight away;
  // otherwise from the next game.
  menuEl.addEventListener('click', (event) => {
    const button = event.target.closest('[data-draw]');
    if (!button) return;
    app.settings.draw = Number(button.dataset.draw);
    app.saveSettings();
    if (!state.history.length && state.draw !== drawSetting()) {
      deal(state.seed);
      app.changed();
    }
    renderMenu();
  });

  // ---------- Start ----------

  // A new screen size (or the bars around the board changing): new positions, no slide.
  new ResizeObserver(() => {
    geometry = measure();
    if (!state) return;
    boardEl.classList.add('instant');
    app.render();
    void boardEl.offsetWidth;
    boardEl.classList.remove('instant');
  }).observe(boardEl);

  // The first drawing jumps straight into place: no slides, no cards turning over.
  boardEl.classList.add('instant');
  buildBoard();
  app.start();
  void boardEl.offsetWidth;
  boardEl.classList.remove('instant');
  started = true;
})();
