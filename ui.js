/*
 * Addiction Solitaire: drawing the board and handling taps.
 *
 * The rules live in game.js. Each line of the game is drawn as a column, top
 * to bottom, so the board fits a phone held upright.
 *
 * Every card is a <button> that stays on the page for the whole game. Its
 * position comes from two CSS variables, --col and --row, so moving a card
 * just means changing those two numbers; style.css animates the slide.
 */
(() => {
  'use strict';

  const G = window.Addiction;

  const boardEl = document.getElementById('board');
  const statusEl = document.getElementById('status');
  const shufflesLeftEl = document.getElementById('shuffles-left');
  const newGameBtn = document.getElementById('new-game');
  const shuffleBtn = document.getElementById('shuffle');
  const overlayEl = document.getElementById('overlay');
  const overlayTitle = document.getElementById('overlay-title');
  const overlayText = document.getElementById('overlay-text');

  const STATUS_TEXT = {
    playing: 'Addiction Solitaire',
    stuck: 'No moves left',
    lost: 'No more moves',
    won: 'Solved!',
  };
  const CONFIRM_MS = 2500; // how long "Tap again" waits for the second tap

  let state = G.newGame();
  let selected = null; // a 2 waiting for the player to pick a gap
  let targets = []; // the gaps that 2 can go to
  let prompt = null; // temporary message in the top bar
  let confirming = null; // the button waiting for its second tap
  let confirmTimer = 0;
  let shuffleTimer = 0;

  const slotEls = [];
  const cardEls = new Map();

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
    const left = state.shufflesLeft;
    shufflesLeftEl.textContent = left === 1 ? '1 shuffle left' : `${left} shuffles left`;
    shuffleBtn.disabled = left === 0 || status === 'won';
    statusEl.textContent = prompt || STATUS_TEXT[status];
    statusEl.classList.toggle('prompt', prompt !== null);
    document.body.dataset.status = status;
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

  function showOverlay(title, text) {
    overlayTitle.textContent = title;
    overlayText.textContent = text;
    overlayEl.hidden = false;
  }

  function hideOverlay() {
    overlayEl.hidden = true;
  }

  // ---------- Game actions ----------

  function clearSelection() {
    if (selected !== null) prompt = null;
    selected = null;
    targets = [];
  }

  function moveCard(card, slot) {
    clearSelection();
    if (!G.move(state, card, slot)) return;
    const el = cardEls.get(card);
    el.classList.add('lifted');
    setTimeout(() => el.classList.remove('lifted'), 400);
    render();
    afterChange();
  }

  // Shows the win or lose panel once the cards have finished moving.
  function afterChange() {
    const game = state;
    const status = G.status(state);
    if (status === 'won') {
      boardEl.classList.add('won');
      setTimeout(() => game === state && showOverlay('You won!', 'All 48 cards are in place.'), 1200);
    } else if (status === 'lost') {
      const left = G.CARDS_IN_PLAY - G.cardsInPlace(state.board);
      const text = `You had ${left} ${left === 1 ? 'card' : 'cards'} left.`;
      setTimeout(() => game === state && showOverlay('No more moves', text), 500);
    }
  }

  function startNewGame() {
    endConfirm();
    hideOverlay();
    clearSelection();
    state = G.newGame();
    boardEl.classList.remove('won');
    animateDeal();
    render();
    afterChange();
  }

  function shuffleBoard() {
    clearSelection();
    animateDeal();
    G.shuffle(state);
    render();
    afterChange();
  }

  // "Are you sure?" without a pop-up: the first tap turns the button into
  // "Tap again" for a moment, and only a second tap goes through.
  function confirmed(button, message) {
    if (confirming === button) {
      endConfirm();
      return true;
    }
    endConfirm();
    confirming = button;
    button.dataset.label = button.textContent;
    button.textContent = 'Tap again';
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
    confirming.textContent = confirming.dataset.label;
    confirming.classList.remove('confirming');
    confirming = null;
    prompt = null;
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

  newGameBtn.addEventListener('click', () => {
    clearSelection();
    const status = G.status(state);
    const inProgress = state.moves > 0 && (status === 'playing' || status === 'stuck');
    if (inProgress && !confirmed(newGameBtn, 'Start a new game?')) return render();
    startNewGame();
  });

  shuffleBtn.addEventListener('click', () => {
    clearSelection();
    if (state.shufflesLeft === 0) return render();
    const status = G.status(state);
    if (status === 'won') return render();
    if (status === 'playing' && !confirmed(shuffleBtn, 'You still have moves')) return render();
    endConfirm();
    shuffleBoard();
  });

  overlayEl.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'new-game') startNewGame();
    else if (action === 'close') hideOverlay();
  });

  // ---------- Start ----------

  buildBoard();
  render();
  afterChange();

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
