// Rules tests for game.js and the deal bank. Run: npm run test:rules
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../game.js');

const id = (suit, rank) => suit * 13 + rank - 1; // suit 0..3, rank 1..13
const S = 0, H = 1, D = 2, C = 3;

// Solved board: line n holds suit n, 2..K, then a gap.
function solvedBoard() {
  const board = [];
  for (let line = 0; line < 4; line++) {
    for (let pos = 0; pos < 12; pos++) board.push(id(line, pos + 2));
    board.push(null);
  }
  return board;
}

// Seeded RNG (mulberry32) so random tests are repeatable.
function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function checkBoard(board) {
  assert.equal(board.length, 52);
  const cards = board.filter((c) => c !== null);
  assert.equal(cards.length, 48, 'always 48 cards');
  assert.equal(new Set(cards).size, 48, 'no duplicates');
  assert.ok(cards.every((c) => G.rankOf(c) !== 1), 'no aces');
}

test('card numbering', () => {
  assert.equal(G.rankOf(id(H, 1)), 1);
  assert.equal(G.rankOf(id(H, 13)), 13);
  assert.equal(G.suitOf(id(D, 7)), D);
  assert.equal(G.cardName(id(H, 12)), 'Queen of hearts');
  assert.equal(G.rankLabel(id(C, 10)), '10');
});

test('new game: 48 cards, 4 gaps, no aces, 3 shuffles', () => {
  for (let seed = 1; seed < 200; seed++) {
    const s = G.newGame(rng(seed));
    checkBoard(s.board);
    assert.equal(s.board.filter((c) => c === null).length, 4);
    assert.equal(s.shufflesLeft, 3);
    assert.equal(s.moves, 0);
  }
});

test('solved board is won and has no moves', () => {
  const s = { board: solvedBoard(), shufflesLeft: 0, moves: 0 };
  assert.equal(G.cardsInPlace(s.board), 48);
  assert.ok(G.isWon(s.board));
  assert.ok(!G.hasMoves(s.board));
  assert.equal(G.status(s), 'won');
});

test('a gap takes the next card of the same suit only', () => {
  const b = solvedBoard();
  // Line 0: 2S 3S 4S 5S ... ; open a gap after 4S by swapping 5S with the gap at the end.
  b[3] = null; b[12] = id(S, 5); // slot 3 is now a gap after 4S
  assert.deepEqual(G.targetsFor(b, id(S, 5)), [3]);
  assert.deepEqual(G.targetsFor(b, id(H, 5)), [], 'wrong suit');
  assert.deepEqual(G.targetsFor(b, id(S, 6)), [], '6S follows 5S, which is not before a gap');
  const s = { board: b, shufflesLeft: 3, moves: 0 };
  assert.equal(G.move(s, id(H, 5), 3), null, 'illegal move refused');
  assert.deepEqual(G.move(s, id(S, 5), 3), { card: id(S, 5), from: 12, to: 3 });
  assert.equal(s.moves, 1);
  assert.ok(G.isWon(s.board));
});

test('nothing goes after a King, after a gap, or past the end of a line', () => {
  const b = solvedBoard();
  // Kings sit at pos 11; the gaps at pos 12 are dead.
  assert.ok(!G.hasMoves(b));
  // King at the end of a line: the card after it has no slot.
  const b2 = solvedBoard();
  b2[11] = null; b2[12] = id(S, 13); // KS moved to the last slot, gap at pos 11 after QS
  assert.deepEqual(G.targetsFor(b2, id(S, 13)), [11]);
  // Gap after a gap: make line 1 pos 4 and 5 gaps.
  const b3 = solvedBoard();
  const a = b3[13 + 4], c = b3[13 + 5];
  b3[13 + 4] = null; b3[13 + 5] = null; b3[12] = a; b3[25] = c; // put them in the end gaps
  // slot 13+5 is after a gap -> nothing can fill it; slot 13+4 takes 6H.
  assert.deepEqual(G.targetsFor(b3, a), [13 + 4]);
  assert.deepEqual(G.targetsFor(b3, c), [], '7H cannot go after a gap');
});

test('2s go into first-slot gaps, including from another first slot', () => {
  const b = solvedBoard();
  // Swap line 2's 2D out to the end of line 0, leaving a first-slot gap at slot 26.
  b[26] = null; b[12] = id(D, 2);
  assert.deepEqual(G.targetsFor(b, id(D, 2)), [26]);
  assert.deepEqual(G.targetsFor(b, id(S, 2)), [26], 'a 2 already first can still switch lines');
  assert.ok(G.hasMoves(b));
  assert.deepEqual(G.targetsFor(b, id(H, 3)), [], '3H follows 2H, which has no gap after it');
});

test('in-place counting stops at the first break', () => {
  const b = solvedBoard();
  [b[5], b[6]] = [b[6], b[5]]; // swap 7S and 8S in line 0
  assert.equal(G.inPlaceCount(b, 0), 5);
  assert.equal(G.cardsInPlace(b), 5 + 36);
  const locked = G.lockedSlots(b);
  assert.equal(locked.filter(Boolean).length, 41);
  assert.ok(locked[4] && !locked[5] && !locked[6] && !locked[12]);
  // A line that doesn't start with a 2 has nothing in place.
  const b2 = solvedBoard();
  [b2[0], b2[1]] = [b2[1], b2[0]];
  assert.equal(G.inPlaceCount(b2, 0), 0);
});

test('stuck and lost', () => {
  const b = solvedBoard();
  [b[0], b[1]] = [b[1], b[0]]; // line 0 broken, all gaps still after Kings
  const s = { board: b, shufflesLeft: 3, moves: 0 };
  assert.equal(G.status(s), 'stuck');
  s.shufflesLeft = 0;
  assert.equal(G.status(s), 'lost');
  assert.equal(G.shuffle(s), false, 'no shuffle when none are left');
});

test('shuffle keeps in-place cards, re-deals the rest, uses one shuffle', () => {
  const r = rng(42);
  for (let round = 0; round < 500; round++) {
    const s = G.newGame(r);
    // Play some random legal moves first so there is progress to protect.
    for (let i = 0; i < 30; i++) {
      const moves = [];
      for (let card = 0; card < 52; card++) {
        if (G.rankOf(card) === 1) continue;
        for (const t of G.targetsFor(s.board, card)) moves.push([card, t]);
      }
      if (!moves.length) break;
      const [card, t] = moves[Math.floor(r() * moves.length)];
      G.move(s, card, t);
    }
    const before = s.board.slice();
    const locked = G.lockedSlots(before);
    const left = s.shufflesLeft;
    assert.equal(G.shuffle(s, r), true);
    checkBoard(s.board);
    assert.equal(s.shufflesLeft, left - 1);
    for (let slot = 0; slot < 52; slot++) if (locked[slot]) assert.equal(s.board[slot], before[slot]);
    assert.ok(G.cardsInPlace(s.board) >= G.cardsInPlace(before), 'a shuffle never loses progress');
  }
});

test('gaps land in random places after a shuffle', () => {
  const r = rng(7);
  const seen = new Set();
  for (let i = 0; i < 300; i++) {
    const s = G.newGame(r);
    G.shuffle(s, r);
    s.board.forEach((c, slot) => c === null && seen.add(slot));
  }
  assert.ok(seen.size > 45, `gaps should be able to land almost anywhere (saw ${seen.size} slots)`);
});

test('random play keeps the board valid and status consistent', () => {
  const r = rng(2026);
  const tally = { won: 0, lost: 0 };
  let longest = 0;
  for (let game = 0; game < 3000; game++) {
    const s = G.newGame(r);
    let steps = 0;
    for (;;) {
      checkBoard(s.board);
      const st = G.status(s);
      // hasMoves must agree with an exhaustive search for legal moves.
      const moves = [];
      for (let card = 0; card < 52; card++) {
        if (G.rankOf(card) === 1) continue;
        for (const t of G.targetsFor(s.board, card)) moves.push([card, t]);
      }
      assert.equal(G.hasMoves(s.board), moves.length > 0);
      if (st === 'won' || st === 'lost') { tally[st]++; break; }
      if (st === 'stuck') { assert.ok(G.shuffle(s, r)); continue; }
      // Greedy-ish: prefer moves that add an in-place card; avoid pointless 2 swaps.
      const useful = moves.filter(([card, t]) => !(G.rankOf(card) === 2 && G.posOf(s.board.indexOf(card)) === 0));
      const pool = useful.length ? useful : moves;
      const beforeInPlace = G.cardsInPlace(s.board);
      const [card, t] = pool[Math.floor(r() * pool.length)];
      const wasFirstTwo = G.rankOf(card) === 2 && G.posOf(s.board.indexOf(card)) === 0;
      assert.ok(G.move(s, card, t));
      if (!wasFirstTwo) assert.ok(G.cardsInPlace(s.board) >= beforeInPlace, 'only moving a first-slot 2 can undo progress');
      if (++steps > 5000) assert.fail('game never ended');
    }
    longest = Math.max(longest, steps);
  }
  console.log(`  random play: ${tally.won} won / ${tally.lost} lost of 3000, longest game ${longest} moves`);
  assert.equal(tally.won + tally.lost, 3000);
});

// ---------- Numbered deals, undo, save/restore ----------

test('deal numbers always give the same layout', () => {
  const a = G.dealFromSeed(12345);
  const b = G.dealFromSeed(12345);
  assert.deepEqual(a.board, b.board);
  assert.equal(a.seed, 12345);
  assert.notDeepEqual(G.dealFromSeed(12346).board, a.board);
  checkBoard(a.board);
  // Pin the layout of one deal: if dealing code ever changes, deals.js would be invalid.
  assert.deepEqual(G.dealFromSeed(1).board.slice(0, 13), [24, 44, 23, 10, 43, 31, 50, 41, 6, 29, 35, 22, 40]);
});

test('undo takes back moves one at a time, back to the deal', () => {
  const r = rng(99);
  for (let round = 0; round < 200; round++) {
    const s = G.dealFromSeed(1000 + round);
    const original = s.board.slice();
    const snapshots = [];
    for (let i = 0; i < 40; i++) {
      const st = G.status(s);
      if (st === 'won' || st === 'lost') break;
      snapshots.push({ board: s.board.slice(), shufflesLeft: s.shufflesLeft, moves: s.moves });
      if (st === 'stuck' || (s.shufflesLeft > 0 && r() < 0.05)) { assert.ok(G.shuffle(s)); continue; }
      const moves = [];
      for (let card = 0; card < 52; card++) {
        if (G.rankOf(card) === 1) continue;
        for (const t of G.targetsFor(s.board, card)) moves.push([card, t]);
      }
      const [card, t] = moves[Math.floor(r() * moves.length)];
      G.move(s, card, t);
    }
    while (snapshots.length) {
      const expected = snapshots.pop();
      assert.ok(G.undo(s));
      assert.deepEqual({ board: s.board, shufflesLeft: s.shufflesLeft, moves: s.moves }, expected);
    }
    assert.equal(G.undo(s), null, 'nothing left to undo');
    assert.deepEqual(s.board, original);
  }
});

test('undoing a shuffle and shuffling again gives the same result', () => {
  for (let seed = 1; seed < 100; seed++) {
    const s = G.dealFromSeed(seed);
    G.shuffle(s);
    const first = s.board.slice();
    G.undo(s);
    assert.equal(s.shufflesLeft, 3);
    G.shuffle(s);
    assert.deepEqual(s.board, first);
    // The 2nd shuffle differs from the 1st (different shuffle number).
    const t = G.dealFromSeed(seed);
    G.shuffle(t);
    G.shuffle(t);
    assert.notDeepEqual(t.board, first);
  }
});

test('save and restore round-trips through JSON; bad data is refused', () => {
  const s = G.dealFromSeed(777);
  G.shuffle(s);
  const moves = [];
  for (let card = 0; card < 52; card++) {
    if (G.rankOf(card) === 1) continue;
    for (const t of G.targetsFor(s.board, card)) moves.push([card, t]);
  }
  if (moves.length) G.move(s, ...moves[0]);
  const back = G.restore(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(back, s);
  assert.equal(G.restore(null), null);
  assert.equal(G.restore({ ...s, board: s.board.slice(1) }), null);
  assert.equal(G.restore({ ...s, shufflesLeft: 9 }), null);
  const dup = s.board.slice();
  dup[dup.indexOf(null)] = dup.find((c) => c !== null);
  assert.equal(G.restore({ ...s, board: dup }), null, 'duplicate card');
  assert.equal(G.restore({ ...s, history: [{ card: 'x' }] }), null);
});

test('deals.js: 10,000 different deal numbers, and a sample really can be won', () => {
  const DEALS = require('../deals.js');
  const { checkDeal } = require('../tools/make-deals.js');
  assert.equal(DEALS.length, 10000);
  assert.equal(new Set(DEALS).size, 10000);
  assert.ok(DEALS.every((n) => Number.isInteger(n) && n > 0));
  for (const seed of [DEALS[0], DEALS[4999], DEALS[9999]]) {
    assert.equal(checkDeal(seed, 2000000).result, 'won', `deal ${seed}`);
  }
});
