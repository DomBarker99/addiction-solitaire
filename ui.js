/*
 * Addiction Solitaire: the board. Draws the cards and handles taps, drags,
 * Undo and Shuffle.
 *
 * Rules live in game.js and the bank of deal numbers that can be won without
 * shuffling in deals.js. Everything around the board (the menu and pause, the
 * timer, settings, the win/lose panel, auto-save) is shared with the other
 * games and lives in shell.js.
 *
 * Each line of the game is drawn as a column, top to bottom, so the board fits
 * a phone held upright. Every card is a <button> that stays on the page for the
 * whole game. Its position comes from two CSS variables, --col and --row, so
 * moving a card just means changing those numbers; addiction.css animates the slide.
 */
(() => {
  'use strict';

  if (window.Shell.redirecting) return; // another game opens instead (see shell.js)

  const G = window.Addiction;
  const Sound = window.Sound;
  const DEALS = window.ADDICTION_DEALS || [];
  const WINNABLE = new Set(DEALS);

  const $ = (id) => document.getElementById(id);
  const boardEl = $('board');
  const undoBtn = $('undo');
  const shuffleBtn = $('shuffle');
  const shufflesLeftEl = $('shuffles-left');

  const STATUS_TEXT = {
    playing: 'Addiction Solitaire',
    stuck: 'No moves left',
    lost: 'No more moves',
    won: 'Solved!',
  };
  const DRAG_START_PX = 8; // a finger has to move this far before a tap becomes a drag

  // ---------- State ----------

  let state; // the game itself (see game.js)
  let selected = null; // a 2 waiting for the player to pick a gap
  let targets = []; // gaps to highlight
  let shuffleTimer = 0;
  let drag = null; // the card being dragged, if any
  let ignoreNextClick = false;

  const slotEls = [];
  const cardEls = new Map();

  // What the shared parts (shell.js) need to know about this game.
  const app = window.Shell.create({
    saveKey: 'addiction-solitaire',
    saveVersion: 2, // version 1 also held the settings, which shell.js now keeps for every game
    bank: DEALS,
    current: () => state,
    status: () => G.status(state),
    moved: () => state.history.length > 0,
    restore(saved) {
      const restored = G.restore(saved);
      if (!restored || G.status(restored) === 'won') return false;
      state = restored;
      return true;
    },
    deal(number) {
      state = G.dealFromSeed(number);
    },
    render,
    cancel: clearSelection,
    undo: undoLast,
    statusText: (status) => STATUS_TEXT[status],
    dealNote: () =>
      state.seed === null ? '' : `Deal #${state.seed}` + (WINNABLE.has(state.seed) ? ' · can be won without shuffling' : ''),
    lostText() {
      const left = G.CARDS_IN_PLAY - G.cardsInPlace(state.board);
      return `You had ${left} ${left === 1 ? 'card' : 'cards'} left.`;
    },
    wonText: (time) => `All 48 cards are in place${time}.`,
    celebrationCards: () => [...cardEls].map(([card, el]) => ({ card, el })),
    onDeal() {
      boardEl.classList.remove('won');
      animateDeal();
    },
    onWin() {
      boardEl.classList.add('won');
    },
  });

  // ---------- Drawing ----------

  function setPosition(el, slot) {
    el.style.setProperty('--col', G.lineOf(slot));
    el.style.setProperty('--row', G.posOf(slot));
  }

  function buildBoard() {
    for (let slot = 0; slot < G.SLOT_COUNT; slot++) {
      const el = document.createElement('div');
      el.className = 'slot';
      el.dataset.slot = slot;
      el.innerHTML = '<span class="face"></span>';
      setPosition(el, slot);
      boardEl.append(el);
      slotEls.push(el);
    }
    for (let card = 0; card < G.SLOT_COUNT; card++) {
      if (G.rankOf(card) === 1) continue; // Aces are never in play
      const suit = G.SUITS[G.suitOf(card)];
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `card ${suit.red ? 'red' : 'black'}`;
      el.dataset.card = card;
      el.setAttribute('aria-label', G.cardName(card));
      el.innerHTML =
        `<span class="face"><span class="rank${G.rankOf(card) === 10 ? ' ten' : ''}">${G.rankLabel(card)}</span>` +
        `<svg class="suit" aria-hidden="true"><use href="#suit-${suit.name}"></use></svg></span>`;
      boardEl.append(el);
      cardEls.set(card, el);
    }
  }

  // The board and the buttons under it. shell.js draws the top bar.
  function render() {
    const status = G.status(state);
    state.board.forEach((card, slot) => {
      slotEls[slot].classList.toggle('target', targets.includes(slot));
      slotEls[slot].classList.toggle('filled', card !== null);
      if (card === null) return;
      const el = cardEls.get(card);
      setPosition(el, slot);
      el.dataset.slot = slot;
      el.classList.toggle('selected', card === selected);
    });
    shufflesLeftEl.textContent = state.shufflesLeft;
    shuffleBtn.disabled = state.shufflesLeft === 0 || status === 'won';
    undoBtn.disabled = state.history.length === 0 || status === 'won';
  }

  // Raise a card above the others while it slides.
  function lift(card) {
    const el = cardEls.get(card);
    el.classList.add('lifted');
    setTimeout(() => el.classList.remove('lifted'), 400);
  }

  function shake(card) {
    const el = cardEls.get(card);
    el.classList.remove('shake');
    void el.offsetWidth; // restart the animation if it is already running
    el.classList.add('shake');
  }

  // Slower, scattered slide for a new deal or a shuffle.
  function animateDeal() {
    boardEl.classList.add('shuffling');
    cardEls.forEach((el) => el.style.setProperty('--delay', `${Math.round(Math.random() * 160)}ms`));
    clearTimeout(shuffleTimer);
    shuffleTimer = setTimeout(() => boardEl.classList.remove('shuffling'), 800);
  }

  // ---------- Game actions ----------

  function clearSelection() {
    if (selected !== null) app.setPrompt(null);
    selected = null;
    targets = [];
  }

  function moveCard(card, slot) {
    clearSelection();
    if (!G.move(state, card, slot)) return false;
    lift(card);
    Sound.play('move');
    app.changed();
    return true;
  }

  function shuffleBoard() {
    clearSelection();
    animateDeal();
    G.shuffle(state);
    Sound.play('shuffle');
    app.changed();
  }

  function undoLast() {
    if (app.celebrating || G.status(state) === 'won' || !state.history.length) return;
    clearSelection();
    app.endConfirm();
    app.hideOverlay();
    const undone = G.undo(state);
    if (undone.board) {
      animateDeal();
      Sound.play('shuffle');
    } else {
      lift(undone.card);
      Sound.play('move');
    }
    app.changed({ quiet: true });
  }

  // ---------- Taps ----------

  function tapCard(card) {
    if (G.status(state) === 'won') return;
    if (card === selected) return clearSelection(); // tap the chosen 2 again to cancel
    clearSelection();
    const options = G.targetsFor(state.board, card);
    if (options.length === 0) return shake(card);
    // A 2 waits for you to pick its gap if it has a choice, or if it is
    // already at the top of a column (moving it would strand what's under it).
    const isTwo = G.rankOf(card) === 2;
    if (isTwo && (options.length > 1 || G.posOf(state.board.indexOf(card)) === 0)) {
      selected = card;
      targets = options;
      app.setPrompt('Tap a gap for this 2');
      return;
    }
    moveCard(card, options[0]);
  }

  function tapSlot(slot) {
    if (selected !== null && targets.includes(slot)) moveCard(selected, slot);
    else clearSelection();
  }

  boardEl.addEventListener('click', (event) => {
    if (ignoreNextClick) return; // the end of a drag, not a tap
    app.endConfirm();
    const cardEl = event.target.closest('.card');
    const slotEl = event.target.closest('.slot');
    if (cardEl) tapCard(Number(cardEl.dataset.card));
    else if (slotEl) tapSlot(Number(slotEl.dataset.slot));
    else clearSelection();
    app.render();
  });

  boardEl.addEventListener('animationend', (event) => {
    if (event.animationName === 'shake') event.target.closest('.card')?.classList.remove('shake');
  });

  // ---------- Dragging ----------

  // Which slot is under a point on the screen (or -1).
  function slotAt(x, y) {
    const box = boardEl.getBoundingClientRect();
    const col = Math.floor(((x - box.left) / box.width) * G.LINES);
    const row = Math.floor(((y - box.top) / box.height) * G.LINE_LENGTH);
    if (col < 0 || col >= G.LINES || row < 0 || row >= G.LINE_LENGTH) return -1;
    return col * G.LINE_LENGTH + row;
  }

  boardEl.addEventListener('pointerdown', (event) => {
    if (drag || app.paused || app.celebrating || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const el = event.target.closest('.card');
    if (!el || G.status(state) === 'won') return;
    drag = { card: Number(el.dataset.card), el, id: event.pointerId, x: event.clientX, y: event.clientY, moving: false };
  });

  boardEl.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moving) {
      if (Math.hypot(dx, dy) < DRAG_START_PX) return;
      drag.moving = true;
      app.endConfirm();
      clearSelection();
      targets = G.targetsFor(state.board, drag.card);
      drag.targets = targets;
      try {
        drag.el.setPointerCapture(drag.id);
      } catch (error) {
        // The pointer may already be gone; the drag still finishes on pointerup.
      }
      drag.el.classList.add('dragging');
      app.render();
    }
    drag.el.style.transform = `translate(calc(var(--col) * 100% + ${dx}px), calc(var(--row) * 100% + ${dy}px))`;
  });

  function endDrag(event, cancelled) {
    if (!drag || event.pointerId !== drag.id) return;
    const { card, el, moving, targets: legal } = drag;
    drag = null;
    if (!moving) return; // just a tap: the click handler takes it from here
    ignoreNextClick = true;
    setTimeout(() => (ignoreNextClick = false), 0);
    el.classList.remove('dragging');
    el.style.transform = ''; // back to its slot, or on to the new one, with a slide
    targets = [];
    lift(card);
    const slot = cancelled ? -1 : slotAt(event.clientX, event.clientY);
    if (!legal.includes(slot) || !moveCard(card, slot)) app.render();
  }

  boardEl.addEventListener('pointerup', (event) => endDrag(event, false));
  boardEl.addEventListener('pointercancel', (event) => endDrag(event, true));

  // ---------- Buttons ----------

  undoBtn.addEventListener('click', undoLast);

  shuffleBtn.addEventListener('click', () => {
    clearSelection();
    const status = G.status(state);
    if (state.shufflesLeft === 0 || status === 'won' || app.celebrating) return app.render();
    if (status === 'playing' && !app.confirmed(shuffleBtn, 'You still have moves')) return app.render();
    app.endConfirm();
    shuffleBoard();
  });

  // ---------- Start ----------

  buildBoard();
  app.start();
})();
