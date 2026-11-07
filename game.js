/*
 * Addiction Solitaire: the rules.
 *
 * This file only knows about the game. It never touches the page; ui.js draws
 * whatever this file says the board looks like.
 *
 * Rules (the same as cardgames.io/addiction):
 *   - Deal all 52 cards into 4 lines of 13 slots, then take the 4 Aces out.
 *     That leaves 4 gaps.
 *   - A gap takes the card one rank higher, in the same suit, than the card
 *     just before it in the line. Nothing can go after a King or after another
 *     gap. The first slot of a line takes any 2.
 *   - You win when every line runs 2 through King in one suit. The last slot of
 *     each line stays empty.
 *   - You get 3 shuffles per game. A shuffle keeps every card that is already in
 *     place (a 2 in the first slot, then its suit in order) and randomly
 *     re-deals everything else, gaps included, into the remaining slots.
 *
 * The classic game draws each line as a row. ui.js draws each line as a column
 * instead, so the board fits a phone held upright. The rules don't change,
 * only the direction: "the card before the gap" is the card above it.
 *
 * Deals are numbered: dealFromSeed(n) always produces the same layout, on every
 * phone. deals.js lists deal numbers that a solver has proven can be won without
 * a single shuffle (see tools/make-deals.js). A deal's shuffles are numbered too,
 * so undoing a shuffle and shuffling again gives the same result.
 */
(function (root) {
  'use strict';

  const LINES = 4;
  const LINE_LENGTH = 13;
  const SLOT_COUNT = LINES * LINE_LENGTH; // 52
  const CARDS_IN_PLAY = 48; // 52 minus the four Aces
  const SHUFFLES_PER_GAME = 3;

  // Cards are the numbers 0-51. Each suit gets a block of 13 numbers, Ace
  // first, so `card + 1` is always the next rank up in the same suit.
  const SUITS = [
    { name: 'spades', red: false },
    { name: 'hearts', red: true },
    { name: 'diamonds', red: true },
    { name: 'clubs', red: false },
  ];
  const RANK_LABELS = [null, 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const RANK_NAMES = [null, 'Ace', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'Jack', 'Queen', 'King'];

  const suitOf = (card) => Math.floor(card / 13);
  const rankOf = (card) => (card % 13) + 1; // 1 = Ace ... 13 = King
  const rankLabel = (card) => RANK_LABELS[rankOf(card)];
  const cardName = (card) => `${RANK_NAMES[rankOf(card)]} of ${SUITS[suitOf(card)].name}`;

  // Slots are the numbers 0-51: line 0 is slots 0-12, line 1 is 13-25, and so on.
  const lineOf = (slot) => Math.floor(slot / LINE_LENGTH);
  const posOf = (slot) => slot % LINE_LENGTH; // 0 = first slot of the line

  // Fisher-Yates shuffle, in place. `random` returns a number in [0, 1).
  function shuffleArray(items, random = Math.random) {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }

  // Small, fast pseudo-random generator (mulberry32). The same seed gives the
  // same sequence of numbers on every device, which is what makes deal numbers work.
  // Changing this (or shuffleArray) would change every numbered deal and break deals.js.
  function seededRandom(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Combines two numbers into one seed (used for "deal n, shuffle k").
  const mixSeeds = (a, b) =>
    (Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b + 0x632be5ab) | 0, 0xc2b2ae35)) >>> 0;

  // A fresh game. `board` has one entry per slot: a card, or null for a gap.
  // `history` is what Undo walks back through.
  function newGame(random = Math.random) {
    const deck = shuffleArray([...Array(SLOT_COUNT).keys()], random);
    return {
      board: deck.map((card) => (rankOf(card) === 1 ? null : card)),
      shufflesLeft: SHUFFLES_PER_GAME,
      moves: 0,
      seed: null,
      history: [],
    };
  }

  // Deal number `seed`: always the same layout.
  function dealFromSeed(seed) {
    const state = newGame(seededRandom(seed));
    state.seed = seed;
    return state;
  }

  // Is `card` the one that comes right after `prev` (same suit, one rank up)?
  const follows = (card, prev) =>
    card !== null &&
    prev !== null &&
    suitOf(card) === suitOf(prev) &&
    rankOf(card) === rankOf(prev) + 1;

  // How many cards at the start of `line` are already in place.
  function inPlaceCount(board, line) {
    const start = line * LINE_LENGTH;
    let count = 0;
    while (count < LINE_LENGTH) {
      const card = board[start + count];
      const ok =
        count === 0
          ? card !== null && rankOf(card) === 2
          : follows(card, board[start + count - 1]);
      if (!ok) break;
      count++;
    }
    return count;
  }

  // One true/false per slot: true if the slot holds a card that is in place.
  // Shuffles never move those cards.
  function lockedSlots(board) {
    const locked = new Array(SLOT_COUNT).fill(false);
    for (let line = 0; line < LINES; line++) {
      const count = inPlaceCount(board, line);
      for (let pos = 0; pos < count; pos++) locked[line * LINE_LENGTH + pos] = true;
    }
    return locked;
  }

  function cardsInPlace(board) {
    let total = 0;
    for (let line = 0; line < LINES; line++) total += inPlaceCount(board, line);
    return total;
  }

  const isWon = (board) => cardsInPlace(board) === CARDS_IN_PLAY;

  // The gaps `card` could move into right now. Usually none or one; a 2 can
  // have several.
  function targetsFor(board, card) {
    if (rankOf(card) === 2) {
      return board.flatMap((c, slot) => (c === null && posOf(slot) === 0 ? [slot] : []));
    }
    const prevSlot = board.indexOf(card - 1); // same suit, one rank lower
    if (prevSlot === -1 || posOf(prevSlot) === LINE_LENGTH - 1) return [];
    return board[prevSlot + 1] === null ? [prevSlot + 1] : [];
  }

  // Moves `card` into the gap at `slot`. Returns { card, from, to }, or null
  // if that move isn't allowed.
  function move(state, card, slot) {
    if (!targetsFor(state.board, card).includes(slot)) return null;
    const from = state.board.indexOf(card);
    state.board[from] = null;
    state.board[slot] = card;
    state.moves++;
    (state.history ||= []).push({ card, from, to: slot });
    return { card, from, to: slot };
  }

  // Can any card move? A gap in a first slot can always take a 2. Any other
  // gap can be filled unless the slot before it is a King or another gap.
  function hasMoves(board) {
    return board.some((card, slot) => {
      if (card !== null) return false;
      if (posOf(slot) === 0) return true;
      const prev = board[slot - 1];
      return prev !== null && rankOf(prev) !== 13;
    });
  }

  // The random numbers for this game's next shuffle. For a numbered deal they
  // depend only on the deal and which shuffle it is (1st, 2nd, 3rd).
  function shuffleRandom(state) {
    if (state.seed == null) return Math.random;
    const shuffleNumber = SHUFFLES_PER_GAME - state.shufflesLeft + 1;
    return seededRandom(mixSeeds(state.seed, shuffleNumber));
  }

  // Uses up one shuffle. Returns false if there are none left.
  function shuffle(state, random = shuffleRandom(state)) {
    if (state.shufflesLeft <= 0) return false;
    (state.history ||= []).push({ board: state.board.slice() });
    const locked = lockedSlots(state.board);
    const open = [];
    for (let slot = 0; slot < SLOT_COUNT; slot++) if (!locked[slot]) open.push(slot);
    const cards = open.map((slot) => state.board[slot]).filter((card) => card !== null);
    const spots = shuffleArray(open.slice(), random);
    for (const slot of open) state.board[slot] = null;
    cards.forEach((card, i) => {
      state.board[spots[i]] = card;
    });
    state.shufflesLeft--;
    state.moves++;
    return true;
  }

  // Takes back the last move or shuffle. Returns what was undone (a move looks
  // like { card, from, to }; a shuffle like { board }), or null if there is nothing to undo.
  function undo(state) {
    const last = state.history && state.history.pop();
    if (!last) return null;
    if (last.board) {
      state.board = last.board.slice();
      state.shufflesLeft++;
    } else {
      state.board[last.to] = null;
      state.board[last.from] = last.card;
    }
    state.moves--;
    return last;
  }

  // 'won', 'playing', 'stuck' (no moves, but shuffles left) or 'lost'.
  function status(state) {
    if (isWon(state.board)) return 'won';
    if (hasMoves(state.board)) return 'playing';
    return state.shufflesLeft > 0 ? 'stuck' : 'lost';
  }

  // Checks a board: 48 different cards (no Aces) and 4 gaps.
  function isValidBoard(board) {
    if (!Array.isArray(board) || board.length !== SLOT_COUNT) return false;
    const cards = board.filter((c) => c !== null);
    return (
      cards.length === CARDS_IN_PLAY &&
      new Set(cards).size === CARDS_IN_PLAY &&
      cards.every((c) => Number.isInteger(c) && c >= 0 && c < SLOT_COUNT && rankOf(c) !== 1)
    );
  }

  // Rebuilds a game from saved data, or returns null if the data doesn't make sense.
  function restore(saved) {
    if (!saved || !isValidBoard(saved.board)) return null;
    const { shufflesLeft, moves, seed, history } = saved;
    if (!Number.isInteger(shufflesLeft) || shufflesLeft < 0 || shufflesLeft > SHUFFLES_PER_GAME) return null;
    if (!Array.isArray(history) || !Number.isInteger(moves)) return null;
    const okEntry = (h) =>
      h && (h.board ? isValidBoard(h.board) : [h.card, h.from, h.to].every(Number.isInteger));
    if (!history.every(okEntry)) return null;
    return {
      board: saved.board.slice(),
      shufflesLeft,
      moves,
      seed: Number.isInteger(seed) ? seed : null,
      history: history.map((h) => (h.board ? { board: h.board.slice() } : { card: h.card, from: h.from, to: h.to })),
    };
  }

  const api = {
    LINES,
    LINE_LENGTH,
    SLOT_COUNT,
    CARDS_IN_PLAY,
    SHUFFLES_PER_GAME,
    SUITS,
    suitOf,
    rankOf,
    rankLabel,
    cardName,
    lineOf,
    posOf,
    seededRandom,
    newGame,
    dealFromSeed,
    inPlaceCount,
    lockedSlots,
    cardsInPlace,
    isWon,
    targetsFor,
    move,
    hasMoves,
    shuffle,
    undo,
    status,
    isValidBoard,
    restore,
  };

  if (typeof module === 'object' && module.exports) module.exports = api; // for tests in Node
  else root.Addiction = api;
})(typeof window !== 'undefined' ? window : globalThis);
