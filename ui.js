/*
 * Addiction Solitaire: the screen. Draws the board and handles taps, drags,
 * the menu (which pauses the game), the timer, undo, settings and auto-save.
 *
 * Rules live in game.js, sounds in audio.js, win animations in celebrate.js,
 * and the bank of deal numbers that can be won without shuffling in deals.js.
 *
 * Each line of the game is drawn as a column, top to bottom, so the board fits
 * a phone held upright. Every card is a <button> that stays on the page for the
 * whole game. Its position comes from two CSS variables, --col and --row, so
 * moving a card just means changing those numbers; style.css animates the slide.
 */
(() => {
  'use strict';

  const G = window.Addiction;
  const Sound = window.Sound;
  const Celebrate = window.Celebrate;
  const DEALS = window.ADDICTION_DEALS || [];
  const WINNABLE = new Set(DEALS);

  const $ = (id) => document.getElementById(id);
  const boardEl = $('board');
  const statusEl = $('status');
  const timerEl = $('timer');
  const undoBtn = $('undo');
  const shuffleBtn = $('shuffle');
  const shufflesLeftEl = $('shuffles-left');
  const menuEl = $('menu');
  const menuNewGameBtn = $('menu-new-game');
  const timerSwitch = $('timer-switch');
  const dealNumberEl = $('deal-number');
  const overlayEl = $('overlay');
  const overlayTitle = $('overlay-title');
  const overlayText = $('overlay-text');
  const overlayUndoBtn = $('overlay-undo');
  const overlayNewGameBtn = $('overlay-new-game');

  const SAVE_KEY = 'addiction-solitaire';
  const STATUS_TEXT = {
    playing: 'Addiction Solitaire',
    stuck: 'No moves left',
    lost: 'No more moves',
    won: 'Solved!',
  };
  const CONFIRM_MS = 2500; // how long "Tap again" waits for the second tap
  const DRAG_START_PX = 8; // a finger has to move this far before a tap becomes a drag

  // ---------- State ----------

  let state; // the game itself (see game.js)
  let settings = { sound: 'card', timer: true };
  let dealOrder = { seed: randomSeed(), next: 0 }; // which bank deal comes next on this device
  let nextCelebration = 'cascade';
  let clockBefore = 0; // ms on the clock before the current run
  let clockStarted = null; // when the clock last started running, or null if stopped
  let paused = false;
  let celebrating = false;
  let selected = null; // a 2 waiting for the player to pick a gap
  let targets = []; // gaps to highlight
  let prompt = null; // temporary message in the top bar
  let confirming = null; // the button waiting for its second tap
  let confirmTimer = 0;
  let shuffleTimer = 0;
  let drag = null; // the card being dragged, if any
  let ignoreNextClick = false;

  const slotEls = [];
  const cardEls = new Map();

  function randomSeed() {
    if (window.crypto && crypto.getRandomValues) return crypto.getRandomValues(new Uint32Array(1))[0];
    return Math.floor(Math.random() * 4294967296);
  }

  const inProgress = () => {
    const status = G.status(state);
    return status === 'playing' || status === 'stuck';
  };

  // ---------- Deals ----------

  // The next deal number. Bank deals come in an order shuffled once per device,
  // so none repeats until all of them have been played.
  function nextDealNumber() {
    if (!DEALS.length) return randomSeed(); // no bank: any deal
    if (dealOrder.next >= DEALS.length) dealOrder = { seed: randomSeed(), next: 0 };
    const order = [...DEALS.keys()];
    const random = G.seededRandom(dealOrder.seed);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    return DEALS[order[dealOrder.next++]];
  }

  // ---------- Timer ----------

  const clockMs = () => clockBefore + (clockStarted === null ? 0 : performance.now() - clockStarted);

  function startClock() {
    if (clockStarted === null && !paused && inProgress()) clockStarted = performance.now();
  }

  function stopClock() {
    if (clockStarted === null) return;
    clockBefore += performance.now() - clockStarted;
    clockStarted = null;
  }

  function formatTime(ms) {
    const total = Math.floor(ms / 1000);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor(total / 60) % 60;
    const seconds = String(total % 60).padStart(2, '0');
    return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
  }

  setInterval(() => {
    const text = formatTime(clockMs());
    if (timerEl.textContent !== text) timerEl.textContent = text;
  }, 250);

  // ---------- Saving ----------

  function save() {
    try {
      localStorage.setItem(
        SAVE_KEY,
        JSON.stringify({
          version: 1,
          game: state,
          clock: Math.round(clockMs()),
          settings,
          dealOrder,
          nextCelebration,
        }),
      );
    } catch (error) {
      // Storage full or blocked: the game still works, it just won't be remembered.
    }
  }

  function loadSaved() {
    try {
      return JSON.parse(localStorage.getItem(SAVE_KEY)) || null;
    } catch (error) {
      return null;
    }
  }

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
        `<span class="face"><span class="rank">${G.rankLabel(card)}</span>` +
        `<svg class="suit" aria-hidden="true"><use href="#suit-${suit.name}"></use></svg></span>`;
      boardEl.append(el);
      cardEls.set(card, el);
    }
  }

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
    statusEl.textContent = prompt || STATUS_TEXT[status];
    statusEl.classList.toggle('prompt', prompt !== null);
    document.body.dataset.status = status;
    timerEl.hidden = !settings.timer;
    timerEl.textContent = formatTime(clockMs());
  }

  function renderMenu() {
    for (const button of menuEl.querySelectorAll('[data-sound]')) {
      button.setAttribute('aria-checked', String(button.dataset.sound === settings.sound));
    }
    timerSwitch.setAttribute('aria-checked', String(settings.timer));
    dealNumberEl.textContent =
      state.seed === null ? '' : `Deal #${state.seed}` + (WINNABLE.has(state.seed) ? ' · can be won without shuffling' : '');
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

  function showOverlay(title, text, { canUndo = false } = {}) {
    overlayTitle.textContent = title;
    overlayText.textContent = text;
    overlayUndoBtn.hidden = !canUndo;
    overlayNewGameBtn.classList.toggle('primary', !canUndo);
    overlayEl.hidden = false;
  }

  function hideOverlay() {
    overlayEl.hidden = true;
  }

  // ---------- "Tap again" confirmations ----------

  // The first tap turns the button into "Tap again" for a moment; only a
  // second tap goes through. Returns true on the second tap.
  function confirmed(button, message, label = 'Tap again') {
    if (confirming === button) {
      endConfirm();
      return true;
    }
    endConfirm();
    confirming = button;
    const labelEl = button.querySelector('.label');
    button.dataset.label = labelEl.textContent;
    labelEl.textContent = label;
    button.classList.add('confirming');
    prompt = message;
    confirmTimer = setTimeout(() => {
      endConfirm();
      render();
    }, CONFIRM_MS);
    return false;
  }

  function endConfirm() {
    clearTimeout(confirmTimer);
    if (!confirming) return;
    confirming.querySelector('.label').textContent = confirming.dataset.label;
    confirming.classList.remove('confirming');
    confirming = null;
    prompt = null;
  }

  // ---------- Game actions ----------

  function clearSelection() {
    if (selected !== null) prompt = null;
    selected = null;
    targets = [];
  }

  // After anything changes the game: timer, screen, save, and the end of the game.
  function afterChange({ quiet = false } = {}) {
    if (!inProgress()) stopClock();
    else if (state.history.length) startClock(); // the clock starts with the first move
    render();
    save();
    const status = G.status(state);
    const game = state;
    if (status === 'won') celebrate(game);
    else if (status === 'lost' && !quiet) {
      setTimeout(() => {
        if (game === state && G.status(state) === 'lost') showLost({ womp: true });
      }, 450);
    }
  }

  function moveCard(card, slot) {
    clearSelection();
    if (!G.move(state, card, slot)) return false;
    lift(card);
    Sound.play('move');
    afterChange();
    return true;
  }

  function shuffleBoard() {
    clearSelection();
    animateDeal();
    G.shuffle(state);
    Sound.play('shuffle');
    afterChange();
  }

  function undoLast() {
    if (celebrating || G.status(state) === 'won' || !state.history.length) return;
    clearSelection();
    endConfirm();
    hideOverlay();
    const undone = G.undo(state);
    if (undone.board) {
      animateDeal();
      Sound.play('shuffle');
    } else {
      lift(undone.card);
      Sound.play('move');
    }
    afterChange({ quiet: true });
  }

  function startNewGame() {
    endConfirm();
    hideOverlay();
    clearSelection();
    state = G.dealFromSeed(nextDealNumber());
    clockBefore = 0;
    clockStarted = null;
    boardEl.classList.remove('won');
    animateDeal();
    Sound.play('shuffle');
    if (paused) closeMenu();
    afterChange();
  }

  function showLost({ womp }) {
    if (womp) Sound.play('lose');
    const left = G.CARDS_IN_PLAY - G.cardsInPlace(state.board);
    showOverlay('No more moves', `You had ${left} ${left === 1 ? 'card' : 'cards'} left.`, {
      canUndo: state.history.length > 0,
    });
  }

  function celebrate(game) {
    celebrating = true;
    boardEl.classList.add('won');
    const kind = nextCelebration;
    nextCelebration = kind === 'cascade' ? 'confetti' : 'cascade';
    save();
    const time = settings.timer ? ` in ${formatTime(clockMs())}` : '';
    const cards = [...cardEls].map(([card, el]) => ({ card, el }));
    setTimeout(() => {
      Celebrate.run(kind, cards).then(() => {
        celebrating = false;
        if (game === state) showOverlay('You won!', `All 48 cards are in place${time}.`);
      });
    }, 350); // let the last card land first
  }

  // ---------- Menu and pause ----------

  function openMenu() {
    if (celebrating || paused) return;
    clearSelection();
    endConfirm();
    paused = true;
    stopClock();
    document.body.classList.add('paused');
    renderMenu();
    menuEl.hidden = false;
    void menuEl.offsetWidth; // so the slide-in animates
    menuEl.classList.add('open');
    render();
    save();
  }

  function closeMenu() {
    if (!paused) return;
    endConfirm();
    paused = false;
    document.body.classList.remove('paused');
    menuEl.classList.remove('open');
    setTimeout(() => {
      if (!paused) menuEl.hidden = true;
    }, 230);
    if (state.history.length) startClock();
    render();
  }

  $('menu-button').addEventListener('click', openMenu);

  menuEl.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action], [data-sound], #timer-switch');
    if (!target) return;
    if (target.dataset.action === 'resume') closeMenu();
    else if (target.dataset.action === 'new-game') {
      if (inProgress() && state.history.length && !confirmed(menuNewGameBtn, null, 'Tap again to start over')) return;
      startNewGame();
    } else if (target.dataset.sound) {
      settings.sound = target.dataset.sound;
      Sound.setStyle(settings.sound);
      Sound.play('move'); // a sample of the new sound
      renderMenu();
      save();
    } else if (target === timerSwitch) {
      settings.timer = !settings.timer;
      renderMenu();
      render();
      save();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (paused) closeMenu();
    else if (!overlayEl.hidden) hideOverlay();
    else openMenu();
  });

  // Leaving the app pauses it (and saves); the menu is waiting on return.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    if (inProgress() && state.history.length && !paused && !celebrating) openMenu();
    else save();
  });
  window.addEventListener('pagehide', save);

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
      prompt = 'Tap a gap for this 2';
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
    endConfirm();
    const cardEl = event.target.closest('.card');
    const slotEl = event.target.closest('.slot');
    if (cardEl) tapCard(Number(cardEl.dataset.card));
    else if (slotEl) tapSlot(Number(slotEl.dataset.slot));
    else clearSelection();
    render();
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
    if (drag || paused || celebrating || (event.pointerType === 'mouse' && event.button !== 0)) return;
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
      endConfirm();
      clearSelection();
      targets = G.targetsFor(state.board, drag.card);
      drag.targets = targets;
      try {
        drag.el.setPointerCapture(drag.id);
      } catch (error) {
        // The pointer may already be gone; the drag still finishes on pointerup.
      }
      drag.el.classList.add('dragging');
      render();
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
    if (!legal.includes(slot) || !moveCard(card, slot)) render();
  }

  boardEl.addEventListener('pointerup', (event) => endDrag(event, false));
  boardEl.addEventListener('pointercancel', (event) => endDrag(event, true));

  // ---------- Buttons ----------

  undoBtn.addEventListener('click', undoLast);

  shuffleBtn.addEventListener('click', () => {
    clearSelection();
    const status = G.status(state);
    if (state.shufflesLeft === 0 || status === 'won' || celebrating) return render();
    if (status === 'playing' && !confirmed(shuffleBtn, 'You still have moves')) return render();
    endConfirm();
    shuffleBoard();
  });

  overlayEl.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'undo') undoLast();
    else if (action === 'new-game') startNewGame();
    else if (action === 'close') hideOverlay();
  });

  // ---------- Start ----------

  const saved = loadSaved();
  if (saved) {
    const s = saved.settings || {};
    if (['off', 'wood', 'card'].includes(s.sound)) settings.sound = s.sound;
    if (typeof s.timer === 'boolean') settings.timer = s.timer;
    const order = saved.dealOrder || {};
    if (Number.isInteger(order.seed) && Number.isInteger(order.next) && order.next >= 0) dealOrder = order;
    if (saved.nextCelebration === 'confetti') nextCelebration = 'confetti';
  }
  Sound.setStyle(settings.sound);

  const restored = saved && G.restore(saved.game);
  if (restored && G.status(restored) !== 'won') {
    state = restored;
    clockBefore = Number.isFinite(saved.clock) ? saved.clock : 0;
  } else {
    state = G.dealFromSeed(nextDealNumber());
  }

  buildBoard();
  render();
  save();
  if (inProgress() && state.history.length) openMenu(); // a game in progress comes back paused
  else if (G.status(state) === 'lost') showLost({ womp: false });

  // Offline support. Browsers only allow this over https:// (or on localhost),
  // so it quietly does nothing when the page is opened another way.
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((error) => {
        console.warn('Offline support is unavailable:', error);
      });
    });
  }
})();
