/*
 * Solitaire (Klondike): the rules.
 *
 * This file only knows about the game. It never touches the page; ui.js (in
 * this folder) draws whatever this file says the table looks like.
 *
 * Rules (the game most phones simply call Solitaire):
 *   - 28 cards are dealt into 7 columns: 1 card in the first, 2 in the
 *     second, up to 7 in the last. Only the top card of each column is face up.
 *     The other 24 cards are the stock, face down.
 *   - Tapping the stock turns cards over onto the waste: 1 at a time (Draw 1,
 *     the default) or 3 at a time (Draw 3). Only the top card of the waste can
 *     be played. When the stock runs out, the waste turns back over to make a
 *     new stock, as often as you like.
 *   - The 4 foundations are built up by suit, Ace to King. You win when all
 *     52 cards are on them.
 *   - Columns are built down in alternating colors: a red 6 on a black 7.
 *     A run of face-up cards moves together. Only a King, or a run that starts
 *     with one, can go into an empty column.
 *   - When a column's face-down card is uncovered, it turns face up.
 *   - A card on a foundation can come back down onto a column.
 *
 * Piles are named 'stock', 'waste', 'f0' to 'f3' (the foundations) and 'c0'
 * to 'c6' (the columns, left to right). Each pile is an array of cards with
 * its bottom card first and its top card last. Cards are numbered as in
 * cards.js.
 *
 * Deals are numbered like Addiction's: dealFromSeed(n) always gives the same
 * layout, on every phone.
 */
(function (root) {
  'use strict';

  const C = typeof module === 'object' && module.exports ? require('../cards.js') : root.Cards;

  const COLUMNS = 7;
  const PILES = ['stock', 'waste', 'f0', 'f1', 'f2', 'f3', 'c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6'];

  const isColumn = (name) => name[0] === 'c';
  const isFoundation = (name) => name[0] === 'f';
  const numberOf = (name) => Number(name.slice(1)); // 'c3' -> 3

  // A fresh game. `hidden` says how many cards at the bottom of each column
  // are face down. `history` is what Undo walks back through.
  function newGame(random = Math.random, draw = 1) {
    const deck = C.shuffleArray([...Array(52).keys()], random);
    const columns = [[], [], [], [], [], [], []];
    // Dealt the way a person deals: one card to each column, left to right,
    // then again starting one column further along, and so on.
    let next = 0;
    for (let row = 0; row < COLUMNS; row++) {
      for (let col = row; col < COLUMNS; col++) columns[col].push(deck[next++]);
    }
    return {
      seed: null,
      draw,
      stock: deck.slice(next),
      waste: [],
      foundations: [[], [], [], []],
      columns,
      hidden: columns.map((column) => column.length - 1),
      moves: 0,
      history: [],
    };
  }

  // Deal number `seed`: always the same layout. `draw` is 1 or 3.
  function dealFromSeed(seed, draw = 1) {
    const state = newGame(C.seededRandom(seed), draw);
    state.seed = seed;
    return state;
  }

  function pile(state, name) {
    if (name === 'stock') return state.stock;
    if (name === 'waste') return state.waste;
    return isFoundation(name) ? state.foundations[numberOf(name)] : state.columns[numberOf(name)];
  }

  // Where `card` is: { pile, index }.
  function find(state, card) {
    for (const name of PILES) {
      const index = pile(state, name).indexOf(card);
      if (index !== -1) return { pile: name, index };
    }
    return null;
  }

  function isFaceUp(state, card) {
    const where = find(state, card);
    if (!where || where.pile === 'stock') return false;
    if (isColumn(where.pile)) return where.index >= state.hidden[numberOf(where.pile)];
    return true;
  }

  // The cards that move if `card` is picked up: it and everything on top of
  // it. null if it can't be picked up (face down, in the stock, or not the
  // top card of the waste or a foundation).
  function runFrom(state, card) {
    const where = find(state, card);
    if (!where || where.pile === 'stock') return null;
    const cards = pile(state, where.pile);
    if (isColumn(where.pile)) {
      return where.index < state.hidden[numberOf(where.pile)] ? null : cards.slice(where.index);
    }
    return where.index === cards.length - 1 ? [card] : null;
  }

  // Can `card` go on this foundation? An Ace starts one; then the same suit, one rank up.
  function fitsFoundation(foundation, card) {
    if (!foundation.length) return C.rankOf(card) === 1;
    const top = foundation[foundation.length - 1];
    return C.suitOf(card) === C.suitOf(top) && C.rankOf(card) === C.rankOf(top) + 1;
  }

  // Can `card` (with any cards on top of it) go on this column? A King starts
  // an empty column; otherwise one rank lower than the top card, in the other color.
  function fitsColumn(column, card) {
    if (!column.length) return C.rankOf(card) === 13;
    const top = column[column.length - 1];
    return C.rankOf(card) === C.rankOf(top) - 1 && C.isRed(card) !== C.isRed(top);
  }

  // The piles `card` could move to right now.
  function targetsFor(state, card) {
    const run = runFrom(state, card);
    if (!run) return [];
    const from = find(state, card).pile;
    const targets = [];
    if (run.length === 1 && !isFoundation(from)) {
      state.foundations.forEach((foundation, f) => {
        if (fitsFoundation(foundation, card)) targets.push(`f${f}`);
      });
    }
    state.columns.forEach((column, c) => {
      if (`c${c}` !== from && fitsColumn(column, card)) targets.push(`c${c}`);
    });
    return targets;
  }

  // Where a tap sends `card`: home to a foundation if it can go, otherwise
  // onto a column with cards in it, otherwise into an empty column. null if
  // there's nowhere useful.
  function bestTarget(state, card) {
    const targets = targetsFor(state, card);
    const home = targets.find(isFoundation);
    if (home) return home;
    const onto = targets.find((name) => pile(state, name).length > 0);
    if (onto) return onto;
    const empty = targets.find(isColumn);
    if (!empty) return null;
    // A King that already heads a column gains nothing from moving to another empty one.
    const where = find(state, card);
    return isColumn(where.pile) && where.index === 0 ? null : empty;
  }

  // Moves `card`, and any cards on top of it, to pile `to`. Returns what
  // happened, or null if that move isn't allowed.
  function move(state, card, to) {
    if (!targetsFor(state, card).includes(to)) return null;
    const { pile: from, index } = find(state, card);
    const source = pile(state, from);
    const run = source.splice(index);
    pile(state, to).push(...run);
    // The card underneath turns face up.
    let flipped = false;
    if (isColumn(from) && source.length && state.hidden[numberOf(from)] === source.length) {
      state.hidden[numberOf(from)]--;
      flipped = true;
    }
    state.moves++;
    const entry = { card, from, to, count: run.length, flipped };
    state.history.push(entry);
    return entry;
  }

  // A tap on the stock: turns over the next card (or 3), or, when the stock
  // is empty, turns the waste back over into a new stock. Returns what
  // happened, or null if both are empty.
  function draw(state) {
    let entry;
    if (state.stock.length) {
      const count = Math.min(state.draw, state.stock.length);
      for (let i = 0; i < count; i++) state.waste.push(state.stock.pop());
      entry = { draw: count };
    } else if (state.waste.length) {
      entry = { recycle: state.waste.length };
      state.stock = state.waste.reverse(); // the first card turned over is on top again
      state.waste = [];
    } else {
      return null;
    }
    state.moves++;
    state.history.push(entry);
    return entry;
  }

  // Takes back the last move or tap on the stock. Returns what was undone,
  // or null if there is nothing to undo.
  function undo(state) {
    const last = state.history.pop();
    if (!last) return null;
    if (last.draw) {
      for (let i = 0; i < last.draw; i++) state.stock.push(state.waste.pop());
    } else if (last.recycle) {
      state.waste = state.stock.reverse();
      state.stock = [];
    } else {
      const run = pile(state, last.to).splice(-last.count);
      if (last.flipped) state.hidden[numberOf(last.from)]++;
      pile(state, last.from).push(...run);
    }
    state.moves--;
    return last;
  }

  const cardsHome = (state) => state.foundations.reduce((total, foundation) => total + foundation.length, 0);
  const isWon = (state) => cardsHome(state) === 52;

  // ---------- Is there anything left to do? ----------

  // Every card that will be on top of the waste at some point as the stock
  // is gone through, without playing any of them. In Draw 3 that's only
  // every third card.
  function stockCards(state) {
    const seen = new Set();
    let stock = state.stock.slice();
    let waste = state.waste.slice();
    if (waste.length) seen.add(waste[waste.length - 1]);
    // The rest of this time through, then once more from the start.
    for (let pass = 0; pass < 2; pass++) {
      while (stock.length) {
        const count = Math.min(state.draw, stock.length);
        for (let i = 0; i < count; i++) waste.push(stock.pop());
        seen.add(waste[waste.length - 1]);
      }
      stock = waste.reverse();
      waste = [];
    }
    return [...seen];
  }

  const goesHome = (state, card) => state.foundations.some((foundation) => fitsFoundation(foundation, card));

  // Does moving the run that starts at card `index` of column `c` surely
  // achieve something? Yes if it uncovers a face-down card, or a card that
  // can then go home. Moving a card from one 7 to another of the same color,
  // back and forth, doesn't count. Emptying a column only helps if a King can
  // then use it; the full search (canProgress) works that out.
  function freesSomething(state, c, index) {
    if (index === 0) return false;
    if (index === state.hidden[c]) return true;
    return goesHome(state, state.columns[c][index - 1]);
  }

  // Could a card come down from a foundation and then take a card that's
  // waiting for it? (A 5 of hearts comes down so a black 4 can go on it.)
  function couldTake(state, card) {
    const wanted = (other) => C.rankOf(other) === C.rankOf(card) - 1 && C.isRed(other) !== C.isRed(card);
    if (stockCards(state).some(wanted)) return true;
    return state.columns.some((column, c) => {
      for (let i = state.hidden[c]; i < column.length; i++) {
        if (wanted(column[i]) && freesSomething(state, c, i)) return true;
      }
      return false;
    });
  }

  // The quick check: is there a move that surely gets somewhere (a card goes
  // home, a face-down card turns over, or a card leaves the stock)? When this
  // says no, status() runs the full search before calling the game lost.
  function hasUsefulMove(state) {
    const fits = (card) => goesHome(state, card) || state.columns.some((column) => fitsColumn(column, card));
    if (stockCards(state).some(fits)) return true;
    for (let c = 0; c < COLUMNS; c++) {
      const column = state.columns[c];
      if (!column.length) continue;
      if (goesHome(state, column[column.length - 1])) return true;
      for (let i = state.hidden[c]; i < column.length; i++) {
        const canMove = state.columns.some((other, d) => d !== c && fitsColumn(other, column[i]));
        if (canMove && freesSomething(state, c, i)) return true;
      }
    }
    return state.foundations.some((foundation) => {
      const top = foundation[foundation.length - 1];
      return foundation.length > 0 && state.columns.some((column) => fitsColumn(column, top)) && couldTake(state, top);
    });
  }

  // The full search, for when the quick check finds nothing: tries every
  // sequence of moves, including bringing cards down from the foundations
  // and moving runs back and forth, until one gets somewhere: more cards
  // home than now, a face-down card turned over, or a card from the stock
  // that can be played. There are only so many ways to move cards around
  // without getting anywhere, so it always finishes; if it ever passes
  // `limit` positions it stops and answers yes, to be safe.
  //
  // It only moves column and foundation cards. The stock doesn't need
  // searching: which of its cards can be reached doesn't change, and
  // playing one already counts as getting somewhere.
  let lastSearch = { key: null, answer: false }; // status() is asked often; search each table once
  function canProgress(state, limit = 3000) {
    const key = state.draw + JSON.stringify([state.stock, state.waste, state.foundations, state.columns, state.hidden]);
    if (lastSearch.key === key) return lastSearch.answer;
    lastSearch = { key, answer: searchForProgress(state, limit) };
    return lastSearch.answer;
  }

  function searchForProgress(state, limit) {
    const { hidden } = state; // can't change: turning a card over ends the search
    const fromStock = stockCards(state);
    const startHome = cardsHome(state);
    // In a search position, piles 0-6 are the columns and 7-10 the foundations.
    const isHome = (p) => p >= COLUMNS;
    const fits = (pileCards, p, card) => (isHome(p) ? fitsFoundation(pileCards, card) : fitsColumn(pileCards, card));
    const takesStockCard = (pileCards, p) => fromStock.some((card) => fits(pileCards, p, card));
    // Positions that only differ in the order of the columns, or of the
    // foundations, count as the same.
    const keyOf = (piles) =>
      piles.slice(0, COLUMNS).map((pile) => pile.join(',')).sort().join('|') +
      '/' +
      piles.slice(COLUMNS).map((pile) => pile[pile.length - 1] ?? '').sort().join(',');

    const start = { piles: [...state.columns, ...state.foundations].map((pile) => pile.slice()), home: startHome };
    const seen = new Set([keyOf(start.piles)]);
    const queue = [start];
    for (let q = 0; q < queue.length; q++) {
      const { piles, home } = queue[q];
      for (let from = 0; from < piles.length; from++) {
        const source = piles[from];
        // Column cards can move with whatever is on them; a foundation's top card can come down.
        const first = isHome(from) ? source.length - 1 : hidden[from];
        for (let i = Math.max(first, 0); i < source.length; i++) {
          const card = source[i];
          const turnsCardOver = !isHome(from) && i === hidden[from] && i > 0;
          for (let to = 0; to < piles.length; to++) {
            if (to === from || (isHome(to) && (isHome(from) || i !== source.length - 1))) continue;
            if (!fits(piles[to], to, card)) continue;
            if (i === 0 && !isHome(from) && !piles[to].length) continue; // a whole column moving to an empty one
            const newHome = home + (isHome(to) ? 1 : 0) - (isHome(from) ? 1 : 0);
            if (turnsCardOver || newHome > startHome) return true;
            const next = piles.slice();
            next[from] = source.slice(0, i);
            next[to] = piles[to].concat(source.slice(i));
            if (takesStockCard(next[from], from) || takesStockCard(next[to], to)) return true;
            const key = keyOf(next);
            if (seen.has(key)) continue;
            if (seen.size >= limit) return true;
            seen.add(key);
            queue.push({ piles: next, home: newHome });
          }
        }
      }
    }
    return false;
  }

  // 'won', 'playing' or 'lost' (nothing left can ever get anywhere).
  function status(state) {
    if (isWon(state)) return 'won';
    return hasUsefulMove(state) || canProgress(state) ? 'playing' : 'lost';
  }

  // ---------- Finishing a game that's as good as won ----------

  // The next step of playing out the cards: the lowest card that can go
  // home, or else a tap on the stock. null when neither is possible.
  function finishMove(state) {
    const tops = state.columns.filter((column) => column.length).map((column) => column[column.length - 1]);
    if (state.waste.length) tops.push(state.waste[state.waste.length - 1]);
    let best = null;
    for (const card of tops) {
      const f = state.foundations.findIndex((foundation) => fitsFoundation(foundation, card));
      if (f !== -1 && (!best || C.rankOf(card) < C.rankOf(best.card))) best = { card, to: `f${f}` };
    }
    if (best) return best;
    return state.stock.length || state.waste.length ? { draw: true } : null;
  }

  function clone(state) {
    return {
      ...state,
      stock: state.stock.slice(),
      waste: state.waste.slice(),
      foundations: state.foundations.map((foundation) => foundation.slice()),
      columns: state.columns.map((column) => column.slice()),
      hidden: state.hidden.slice(),
      history: [],
    };
  }

  // Can the game be finished just by sending cards home? Only offered once
  // every column card is face up, and in Draw 3 only once the stock is empty,
  // so it never gives away the order of cards that are still face down.
  function canAutoFinish(state) {
    if (isWon(state) || state.hidden.some((count) => count > 0)) return false;
    if (state.draw === 3 && state.stock.length) return false;
    const copy = clone(state);
    let idle = 0; // taps on the stock since a card last went home
    while (!isWon(copy)) {
      const step = finishMove(copy);
      if (!step) return false;
      if (step.draw) {
        if (++idle > 2 * (copy.stock.length + copy.waste.length) + 2) return false;
        draw(copy);
      } else {
        idle = 0;
        move(copy, step.card, step.to);
      }
    }
    return true;
  }

  // How many cards on top of the waste came from the last tap on the stock
  // and haven't been played yet. Draw 3 shows those fanned out.
  function wasteFan(state) {
    let played = 0;
    for (let i = state.history.length - 1; i >= 0; i--) {
      const entry = state.history[i];
      if (entry.draw) return Math.max(0, entry.draw - played);
      if (entry.recycle) return 0;
      if (entry.from === 'waste') played++;
    }
    return 0;
  }

  // ---------- Saved games ----------

  const isCardList = (list) => Array.isArray(list) && list.every((c) => Number.isInteger(c) && c >= 0 && c < 52);

  // Checks a table: all 52 cards once each, foundations built up by suit,
  // face-up column cards in proper runs, and every column topped by a face-up card.
  function isValidTable(t) {
    if (t.draw !== 1 && t.draw !== 3) return false;
    if (!isCardList(t.stock) || !isCardList(t.waste)) return false;
    if (!Array.isArray(t.foundations) || t.foundations.length !== 4 || !t.foundations.every(isCardList)) return false;
    if (!Array.isArray(t.columns) || t.columns.length !== COLUMNS || !t.columns.every(isCardList)) return false;
    if (!Array.isArray(t.hidden) || t.hidden.length !== COLUMNS) return false;
    const all = [t.stock, t.waste, ...t.foundations, ...t.columns].flat();
    if (all.length !== 52 || new Set(all).size !== 52) return false;
    const builtUp = (foundation) => foundation.every((card, i) => fitsFoundation(foundation.slice(0, i), card));
    if (!t.foundations.every(builtUp)) return false;
    return t.columns.every((column, c) => {
      const count = t.hidden[c];
      if (!Number.isInteger(count) || count < 0 || count > column.length) return false;
      if (column.length && count === column.length) return false;
      for (let i = count + 1; i < column.length; i++) if (!fitsColumn(column.slice(0, i), column[i])) return false;
      return true;
    });
  }

  function isValidEntry(h) {
    if (!h || typeof h !== 'object') return false;
    if ('draw' in h) return [1, 2, 3].includes(h.draw);
    if ('recycle' in h) return Number.isInteger(h.recycle) && h.recycle >= 1 && h.recycle <= 24;
    return (
      Number.isInteger(h.card) &&
      PILES.includes(h.from) &&
      h.from !== 'stock' &&
      PILES.includes(h.to) &&
      (isColumn(h.to) || isFoundation(h.to)) &&
      Number.isInteger(h.count) &&
      h.count >= 1 &&
      h.count <= 13 &&
      typeof h.flipped === 'boolean' &&
      (!h.flipped || isColumn(h.from))
    );
  }

  // Rebuilds a game from saved data, or returns null if the data doesn't make sense.
  function restore(saved) {
    if (!saved || typeof saved !== 'object' || !isValidTable(saved)) return null;
    const { seed, moves, history } = saved;
    if (!Number.isInteger(moves) || !Array.isArray(history) || !history.every(isValidEntry)) return null;
    const state = {
      seed: Number.isInteger(seed) ? seed : null,
      draw: saved.draw,
      stock: saved.stock.slice(),
      waste: saved.waste.slice(),
      foundations: saved.foundations.map((foundation) => foundation.slice()),
      columns: saved.columns.map((column) => column.slice()),
      hidden: saved.hidden.slice(),
      moves,
      history: history.map((h) => ({ ...h })),
    };
    // Undoing everything has to go through proper tables all the way back to
    // a fresh deal, or Undo could make a mess of the table later.
    const copy = { ...clone(state), history: state.history.map((h) => ({ ...h })) };
    try {
      while (copy.history.length) {
        undo(copy);
        if (!isValidTable(copy)) return null;
      }
    } catch (error) {
      return null;
    }
    const fresh =
      copy.stock.length === 24 &&
      copy.waste.length === 0 &&
      copy.foundations.every((foundation) => foundation.length === 0) &&
      copy.columns.every((column, c) => column.length === c + 1 && copy.hidden[c] === c);
    return fresh && isValidTable(copy) ? state : null;
  }

  const api = {
    COLUMNS,
    PILES,
    newGame,
    dealFromSeed,
    pile,
    find,
    isFaceUp,
    runFrom,
    fitsFoundation,
    fitsColumn,
    targetsFor,
    bestTarget,
    move,
    draw,
    undo,
    cardsHome,
    isWon,
    stockCards,
    hasUsefulMove,
    canProgress,
    status,
    finishMove,
    canAutoFinish,
    wasteFan,
    isValidTable,
    restore,
  };

  if (typeof module === 'object' && module.exports) module.exports = api; // for tests in Node
  else root.Klondike = api;
})(typeof window !== 'undefined' ? window : globalThis);
