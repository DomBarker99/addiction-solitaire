/*
 * Cards: the numbering every game in this app uses, and the seeded random
 * numbers that turn a deal number into the same layout on every phone.
 *
 * Cards are the numbers 0-51. Each suit gets a block of 13 numbers, Ace
 * first: card = suit * 13 + rank - 1, with Ace = rank 1 and King = rank 13.
 *
 * Solitaire (klondike/rules.js) and the win animations (celebrate.js) use this
 * file. Addiction (game.js) keeps its own copy of the same code on purpose:
 * its bank of winnable deals depends on that code, so nothing changed here
 * can break it.
 *
 * Changing seededRandom or shuffleArray changes what every numbered Solitaire
 * deal looks like.
 */
(function (root) {
  'use strict';

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
  const isRed = (card) => SUITS[suitOf(card)].red;
  const rankLabel = (card) => RANK_LABELS[rankOf(card)];
  const cardName = (card) => `${RANK_NAMES[rankOf(card)]} of ${SUITS[suitOf(card)].name}`;

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

  const api = { SUITS, suitOf, rankOf, isRed, rankLabel, cardName, shuffleArray, seededRandom };

  if (typeof module === 'object' && module.exports) module.exports = api; // for tests in Node
  else root.Cards = api;
})(typeof window !== 'undefined' ? window : globalThis);
