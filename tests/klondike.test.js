/*
 * Rules tests for Solitaire (klondike/rules.js).   node --test tests/klondike.test.js
 *
 * Cards are written the way you'd say them, '10♥', and columns bottom card first.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../klondike/rules.js');
const Cards = require('../cards.js');

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const card = (text) => '♠♥♦♣'.indexOf(text.slice(-1)) * 13 + RANKS.indexOf(text.slice(0, -1));
const cards = (text) => text.split(' ').filter(Boolean).map(card);
// 'A♠ 2♠ ... 7♠' for a foundation built up to `rank`.
const upTo = (suit, rank) => RANKS.slice(0, rank).map((r) => r + suit).join(' ');
const NONE = ['', '', '', '', '', '', ''];

// A table to test on. `hidden` says how many cards at the bottom of each column are face down.
function table({ stock = '', waste = '', foundations = ['', '', '', ''], columns = NONE, hidden = [0, 0, 0, 0, 0, 0, 0], draw = 1 } = {}) {
  return {
    seed: 1,
    draw,
    stock: cards(stock),
    waste: cards(waste),
    foundations: foundations.map(cards),
    columns: columns.map(cards),
    hidden: hidden.slice(),
    moves: 0,
    history: [],
  };
}
const columnsOf = (...list) => [...list, ...NONE].slice(0, 7);

test('a deal: 7 columns of 1 to 7 cards, only the top one face up, and 24 in the stock', () => {
  const s = K.dealFromSeed(123);
  assert.deepEqual(
    s.columns.map((column) => column.length),
    [1, 2, 3, 4, 5, 6, 7],
  );
  assert.deepEqual(s.hidden, [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(s.stock.length, 24);
  assert.equal(s.waste.length, 0);
  assert.ok(s.foundations.every((foundation) => foundation.length === 0));
  assert.equal(s.draw, 1);
  assert.equal(K.dealFromSeed(123, 3).draw, 3);
  assert.ok(K.isValidTable(s));
  assert.equal(K.status(s), 'playing');
});

test('deal numbers always give the same layout', () => {
  // If this fails, dealing has changed (cards.js, or newGame here), and any
  // bank of winnable Solitaire deals would no longer match.
  const s = K.dealFromSeed(1);
  assert.deepEqual(s.columns, [[24], [44, 41], [23, 6, 34], [10, 29, 11, 8], [43, 35, 3, 14, 45], [31, 22, 49, 4, 38, 7], [50, 40, 33, 27, 30, 21, 16]]);
  assert.deepEqual(s.stock, [12, 1, 36, 37, 25, 47, 2, 17, 39, 9, 15, 5, 20, 19, 42, 18, 51, 28, 13, 46, 48, 26, 0, 32]);
  assert.deepEqual(K.dealFromSeed(1), K.dealFromSeed(1));
  assert.deepEqual(K.dealFromSeed(1, 3).columns, s.columns, 'Draw 3 deals the same cards');
  assert.notDeepEqual(K.dealFromSeed(2).columns, s.columns);
});

test('Draw 1 turns over one card; Draw 3 turns over three, the third one on top', () => {
  const one = table({ stock: '2♠ 3♠ 4♠ 5♠' }); // 5♠ is on top
  assert.deepEqual(K.draw(one), { draw: 1 });
  assert.deepEqual(one.waste, cards('5♠'));
  assert.deepEqual(one.stock, cards('2♠ 3♠ 4♠'));

  const three = table({ stock: '2♠ 3♠ 4♠ 5♠', draw: 3 });
  assert.deepEqual(K.draw(three), { draw: 3 });
  assert.deepEqual(three.waste, cards('5♠ 4♠ 3♠'));
  assert.deepEqual(K.draw(three), { draw: 1 }, 'only one card was left');
  assert.deepEqual(three.waste, cards('5♠ 4♠ 3♠ 2♠'));
});

test('an empty stock turns the waste back over, in the same order, as often as you like', () => {
  const s = table({ stock: '2♠ 3♠ 4♠' });
  K.draw(s);
  K.draw(s);
  K.draw(s);
  assert.deepEqual(s.waste, cards('4♠ 3♠ 2♠'));
  assert.deepEqual(K.draw(s), { recycle: 3 });
  assert.deepEqual(s.stock, cards('2♠ 3♠ 4♠'), '4♠ comes up first again');
  assert.deepEqual(s.waste, []);
  for (let pass = 0; pass < 5; pass++) {
    K.draw(s);
    K.draw(s);
    K.draw(s);
    assert.ok(K.draw(s).recycle);
  }
  assert.equal(K.draw(table()), null, 'nothing in either');
});

test('in Draw 3 only every third card of the stock can be reached without playing', () => {
  const byNumber = (a, b) => a - b;
  const three = table({ draw: 3, stock: '2♠ 3♠ 4♠ 5♠ 6♠ 7♠' });
  assert.deepEqual(K.stockCards(three).sort(byNumber), cards('2♠ 5♠').sort(byNumber));
  const one = table({ draw: 1, stock: '2♠ 3♠ 4♠' });
  assert.deepEqual(K.stockCards(one).sort(byNumber), cards('2♠ 3♠ 4♠').sort(byNumber));
});

test('foundations take an Ace first, then the same suit one rank up', () => {
  const s = table({ waste: '2♥ A♥', columns: columnsOf('3♥') });
  assert.deepEqual(K.targetsFor(s, card('A♥')), ['f0', 'f1', 'f2', 'f3']);
  assert.ok(K.move(s, card('A♥'), 'f2'));
  assert.deepEqual(K.targetsFor(s, card('2♥')), ['f2']);
  K.move(s, card('2♥'), 'f2');
  assert.deepEqual(K.targetsFor(s, card('3♥')), ['f2']);
  assert.equal(K.fitsFoundation(cards('A♥ 2♥'), card('3♦')), false);
  assert.equal(K.fitsFoundation(cards('A♥ 2♥'), card('4♥')), false);
  assert.equal(K.fitsFoundation([], card('2♥')), false);
});

test('columns: one rank lower in the other color, and only a King in an empty column', () => {
  assert.ok(K.fitsColumn(cards('7♠'), card('6♥')));
  assert.ok(!K.fitsColumn(cards('7♦'), card('6♥')), 'same color');
  assert.ok(!K.fitsColumn(cards('7♠'), card('5♥')), 'not one lower');
  assert.ok(K.fitsColumn([], card('K♣')));
  assert.ok(!K.fitsColumn([], card('Q♣')));
  const s = table({ waste: '6♥', columns: columnsOf('7♠', '7♦', '8♥') });
  assert.deepEqual(K.targetsFor(s, card('6♥')), ['c0']);
});

test('a run of face-up cards moves together, and the card it uncovers turns face up', () => {
  const s = table({ columns: columnsOf('Q♣ J♠ 9♦ 8♠ 7♥', '10♣'), hidden: [2, 0, 0, 0, 0, 0, 0] });
  assert.deepEqual(K.runFrom(s, card('8♠')), cards('8♠ 7♥'));
  assert.equal(K.runFrom(s, card('J♠')), null, 'face down');
  assert.deepEqual(K.targetsFor(s, card('9♦')), ['c1']);
  assert.deepEqual(K.move(s, card('9♦'), 'c1'), { card: card('9♦'), from: 'c0', to: 'c1', count: 3, flipped: true });
  assert.deepEqual(s.columns[1], cards('10♣ 9♦ 8♠ 7♥'));
  assert.deepEqual(s.columns[0], cards('Q♣ J♠'));
  assert.equal(s.hidden[0], 1);
  assert.ok(K.isFaceUp(s, card('J♠')));
  assert.ok(!K.isFaceUp(s, card('Q♣')));
  assert.equal(K.move(s, card('8♠'), 'c0'), null, 'not allowed: 8♠ on J♠');
});

test('only the top card of the waste or a foundation can be picked up, and never a face-down card', () => {
  const s = table({ stock: 'K♠', waste: '5♥ 6♣', foundations: ['A♦ 2♦', '', '', ''], columns: columnsOf('3♠ 3♣'), hidden: [1, 0, 0, 0, 0, 0, 0] });
  assert.equal(K.runFrom(s, card('5♥')), null, 'under the 6♣');
  assert.deepEqual(K.runFrom(s, card('6♣')), [card('6♣')]);
  assert.equal(K.runFrom(s, card('A♦')), null, 'under the 2♦');
  assert.deepEqual(K.runFrom(s, card('2♦')), [card('2♦')]);
  assert.equal(K.runFrom(s, card('K♠')), null, 'in the stock');
  assert.equal(K.runFrom(s, card('3♠')), null, 'face down');
  assert.deepEqual(K.targetsFor(s, card('3♠')), []);
});

test('a foundation card can come back down onto a column, but not onto another foundation', () => {
  const s = table({ foundations: [upTo('♦', 5), '', '', ''], columns: columnsOf('6♠', '6♣') });
  assert.deepEqual(K.targetsFor(s, card('5♦')), ['c0', 'c1']);
  K.move(s, card('5♦'), 'c1');
  assert.deepEqual(s.columns[1], cards('6♣ 5♦'));
  assert.deepEqual(s.foundations[0], cards(upTo('♦', 4)));
  assert.deepEqual(K.targetsFor(table({ foundations: ['A♠', '', '', ''] }), card('A♠')), []);
});

test('a tap sends a card home if it can go, otherwise onto a column', () => {
  const s = table({ waste: '5♥', foundations: [upTo('♥', 4), '', '', ''], columns: columnsOf('6♠') });
  assert.equal(K.bestTarget(s, card('5♥')), 'f0', 'home beats the 6♠');
  const t = table({ waste: '5♥', columns: columnsOf('6♦', '6♠', '6♣') });
  assert.equal(K.bestTarget(t, card('5♥')), 'c1', 'the first column it fits');
  const kings = table({ waste: 'K♥', columns: columnsOf('Q♠') });
  assert.equal(K.bestTarget(kings, card('K♥')), 'c1', 'a King goes to the first empty column');
  assert.equal(K.bestTarget(table({ waste: '9♥', columns: columnsOf('Q♠') }), card('9♥')), null);
});

test('a tap leaves a King that already heads a column where it is', () => {
  const s = table({ columns: columnsOf('K♠ Q♥') });
  assert.equal(K.targetsFor(s, card('K♠')).length, 6, 'dragging it is still allowed');
  assert.equal(K.bestTarget(s, card('K♠')), null);
  const t = table({ columns: columnsOf('5♣ K♠'), hidden: [1, 0, 0, 0, 0, 0, 0] });
  assert.equal(K.bestTarget(t, card('K♠')), 'c1', 'worth it: the 5♣ turns over');
});

test('undo takes back each tap on the stock and each move, turning cards back face down', () => {
  const s = K.dealFromSeed(7);
  const dealt = JSON.stringify(s);
  for (let i = 0; i < 30; i++) K.draw(s); // all 24, a recycle, and 5 more
  assert.equal(s.stock.length, 19);
  K.undo(s);
  assert.equal(s.stock.length, 20, 'the last card went back');
  // A move that turns a card over, then undo it.
  const m = table({ columns: columnsOf('3♣ 9♦', '10♠'), hidden: [1, 0, 0, 0, 0, 0, 0] });
  K.move(m, card('9♦'), 'c1');
  assert.equal(m.hidden[0], 0);
  assert.deepEqual(K.undo(m), { card: card('9♦'), from: 'c0', to: 'c1', count: 1, flipped: true });
  assert.deepEqual(m.columns, table({ columns: columnsOf('3♣ 9♦', '10♠') }).columns);
  assert.equal(m.hidden[0], 1);
  assert.equal(K.undo(m), null, 'nothing left to undo');
  while (s.history.length) K.undo(s);
  assert.equal(JSON.stringify(s), dealt);
});

test('Draw 3 fans out the cards from the last tap that have not been played yet', () => {
  const s = table({ draw: 3, stock: '2♣ 3♣ 4♣ 9♠ 10♠ 5♥', columns: columnsOf('6♣') });
  assert.equal(K.wasteFan(s), 0);
  K.draw(s); // 5♥ 10♠ 9♠, with 9♠ on top
  assert.equal(K.wasteFan(s), 3);
  const t = table({ draw: 3, stock: '2♣ 3♣ 4♣ 9♠ 10♠ 5♥', columns: columnsOf('6♣', '10♦') });
  K.draw(t);
  K.move(t, card('9♠'), 'c1');
  assert.equal(K.wasteFan(t), 2, 'one played');
  K.draw(t);
  assert.equal(K.wasteFan(t), 3, 'a new tap');
  K.undo(t);
  assert.equal(K.wasteFan(t), 2, 'undone');
  K.draw(t);
  K.draw(t);
  assert.ok(t.history[t.history.length - 1].recycle);
  assert.equal(K.wasteFan(t), 0, 'after turning the waste over');
});

test('no more moves: nothing from the stock fits and nothing in the columns gets anywhere', () => {
  // Every column has a red card on a face-down one; the stock holds two black 9s.
  const lost = {
    stock: '9♣ 9♠',
    columns: columnsOf('A♠ 5♥', 'A♣ 8♦', 'A♥ J♥', 'A♦ 3♥', '2♠ 6♦', '2♣ 4♦', '3♠ 2♥'),
    hidden: [1, 1, 1, 1, 1, 1, 1],
  };
  const s = table(lost);
  assert.ok(!K.hasUsefulMove(s));
  assert.ok(!K.canProgress(s));
  assert.equal(K.status(s), 'lost');
  assert.equal(K.status(table({ ...lost, stock: '9♣ 9♠ 7♣' })), 'playing', 'the 7♣ fits on the 8♦');
  // Draw 3 with 4 cards: the 3rd from the bottom and the top card never come up.
  assert.equal(K.status(table({ ...lost, draw: 3, stock: '9♣ 9♠ 7♣ 9♦' })), 'lost', 'in Draw 3 the 7♣ never comes up');
  assert.equal(K.status(table({ ...lost, draw: 3, stock: '9♣ 7♣ 9♠ 9♦' })), 'playing', 'here it does');
});

test('moving a card back and forth between two of the same rank and color does not count', () => {
  const s = table({
    stock: '9♣',
    columns: columnsOf('A♠ 6♠ 5♥', 'A♣ 6♣', 'A♥ J♥', 'A♦ 3♥', '2♠ 6♦', '2♣ 4♦', '3♠ 2♥'),
    hidden: [1, 1, 1, 1, 1, 1, 1],
  });
  assert.deepEqual(K.targetsFor(s, card('5♥')), ['c1'], 'it can move...');
  assert.equal(K.status(s), 'lost', '...but it gets nowhere');
});

test('bringing cards down from the foundations so a stock card can be played counts as a move', () => {
  // 7♣ comes down onto the 8♦, then 6♣ onto the 7♥, then the 5♥ from the stock goes on it.
  const s = table({
    stock: '5♥',
    foundations: [upTo('♣', 7), '', '', ''],
    columns: columnsOf('A♠ 8♦', 'A♥ 7♥', 'A♦ J♥', '2♠ 3♥', '2♥ 4♦', '2♦ 9♥', '3♠ 10♥'),
    hidden: [1, 1, 1, 1, 1, 1, 1],
  });
  assert.ok(!K.hasUsefulMove(s), 'the quick check misses it');
  assert.ok(K.canProgress(s), 'the full search finds it');
  assert.equal(K.status(s), 'playing');
});

test('Finish is offered once every column card is face up, and plays the game out', () => {
  const runs = columnsOf('K♠ Q♥ J♠ 10♥', 'K♥ Q♠ J♥ 10♠', 'K♦ Q♣ J♦ 10♣', 'K♣ Q♦ J♣ 10♦');
  const homes = [upTo('♠', 8), upTo('♥', 9), upTo('♦', 9), upTo('♣', 9)];
  const s = table({ stock: '9♠', foundations: homes, columns: runs });
  assert.ok(K.isValidTable(s));
  assert.ok(K.canAutoFinish(s));
  let steps = 0;
  while (!K.isWon(s) && steps++ < 100) {
    const step = K.finishMove(s);
    if (step.draw) K.draw(s);
    else assert.ok(K.move(s, step.card, step.to));
  }
  assert.ok(K.isWon(s));
  assert.equal(K.status(s), 'won');
  assert.ok(!K.canAutoFinish(s), 'nothing left to finish');

  assert.ok(!K.canAutoFinish(table({ stock: '9♠', foundations: homes, columns: runs, hidden: [1, 0, 0, 0, 0, 0, 0] })), 'a card is still face down');
  assert.ok(!K.canAutoFinish(table({ draw: 3, stock: '9♠', foundations: homes, columns: runs })), 'Draw 3: the stock must be empty');
  assert.ok(K.canAutoFinish(table({ draw: 3, waste: '9♠', foundations: homes, columns: runs })));
});

test('random play keeps the table valid, and undoing everything gets back to the deal', () => {
  const random = Cards.seededRandom(99);
  for (let seed = 1; seed <= 30; seed++) {
    for (const draw of [1, 3]) {
      const s = K.dealFromSeed(seed, draw);
      const dealt = JSON.stringify(s);
      for (let step = 0; step < 250; step++) {
        const r = random();
        if (r < 0.1) K.undo(s);
        else if (r < 0.45) K.draw(s);
        else {
          const moves = [];
          for (let c = 0; c < 52; c++) for (const to of K.targetsFor(s, c)) moves.push([c, to]);
          if (moves.length) {
            const [c, to] = moves[Math.floor(random() * moves.length)];
            assert.ok(K.move(s, c, to));
          }
        }
        assert.ok(K.isValidTable(s), `deal ${seed}, draw ${draw}, step ${step}`);
        assert.equal(s.moves, s.history.length);
        const status = K.status(s);
        if (status === 'lost') assert.ok(!K.canAutoFinish(s));
        if (K.canAutoFinish(s)) assert.equal(status, 'playing');
      }
      while (s.history.length) K.undo(s);
      assert.equal(JSON.stringify(s), dealt);
    }
  }
});

test('save and restore round-trip through JSON; bad data is refused', () => {
  const s = K.dealFromSeed(5, 3);
  const random = Cards.seededRandom(3);
  for (let step = 0; step < 120; step++) {
    const moves = [];
    for (let c = 0; c < 52; c++) for (const to of K.targetsFor(s, c)) moves.push([c, to]);
    if (moves.length && random() < 0.5) K.move(s, ...moves[Math.floor(random() * moves.length)]);
    else K.draw(s);
  }
  const saved = JSON.parse(JSON.stringify(s));
  const restored = K.restore(saved);
  assert.deepEqual(restored, s);
  while (restored.history.length) K.undo(restored);
  assert.deepEqual(restored, K.dealFromSeed(5, 3), 'undo still works all the way back');

  assert.equal(K.restore(null), null);
  assert.equal(K.restore({ ...saved, draw: 2 }), null);
  const pileWithCards = saved.stock.length ? 'stock' : 'waste';
  assert.equal(K.restore({ ...saved, [pileWithCards]: saved[pileWithCards].slice(1) }), null, 'a card missing');
  assert.equal(K.restore({ ...saved, hidden: saved.columns.map((column) => column.length) }), null, 'a column with no face-up card');
  assert.equal(K.restore({ ...saved, history: saved.history.slice(1) }), null, "history that doesn't lead back to the deal");
  const lastMove = saved.history.findLastIndex((h) => h.from && h.from[0] === 'c' && !h.flipped);
  const forged = saved.history.map((h, i) => (i === lastMove ? { ...h, flipped: true } : h));
  assert.equal(K.restore({ ...saved, history: forged }), null, 'a move that claims it turned a card over');
  assert.equal(K.restore({ ...saved, history: [{ nonsense: true }] }), null);
  assert.equal(K.restore({ ...saved, moves: 'many' }), null);
});
