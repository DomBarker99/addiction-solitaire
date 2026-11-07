#!/usr/bin/env node
/*
 * Builds the bank of deals that can be won without a single shuffle.
 *
 * For each deal number it deals the cards exactly like the app does
 * (game.js dealFromSeed), searches for a winning sequence of moves, and then
 * replays that sequence with the real rules before accepting the deal.
 *
 *   node tools/make-deals.js --from 1 --to 20000 [--workers N] [--budget 2000000]
 *
 * Output (stdout), one JSON line per winnable deal:
 *   {"seed":17,"nodes":48211,"length":163,"fp":"9f3a61c2"}
 * nodes  = positions the solver looked at (a rough difficulty measure)
 * length = moves in the winning line it found
 * fp     = fingerprint of the dealt board, to check other devices deal the same layout
 * Then a final {"done":true,...} summary line. Progress goes to stderr.
 *
 * tools/deals-job.yaml runs this on the Kubernetes cluster.
 *
 * Turning that output into deals.js (the file the app loads):
 *   node tools/make-deals.js bank deals-raw.jsonl [--count 10000]
 * re-deals every deal on this machine, checks its fingerprint matches, and keeps
 * the lowest `count` deal numbers.
 */
'use strict';

const path = require('path');
const os = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const G = require(process.env.GAME_JS || path.join(__dirname, '..', 'game.js'));

// ---------- Solver ----------

// Zobrist hashing: every (slot, card) pair gets a random number; a position's
// hash is all of its pairs XORed together, so a move updates it in two steps.
// Two 26-bit halves keep the XORs in 32-bit maths and fit one exact 52-bit number.
const HALF = 67108864; // 2^26
const zRand = G.seededRandom(0xc0ffee);
const Z_HI = new Int32Array(52 * 52);
const Z_LO = new Int32Array(52 * 52);
for (let i = 0; i < Z_HI.length; i++) {
  Z_HI[i] = Math.floor(zRand() * HALF);
  Z_LO[i] = Math.floor(zRand() * HALF);
}

// Depth-first search for a win with no shuffles. Moves that extend an in-place
// run are tried first. Positions already seen are skipped.
// Returns { result: 'won' | 'impossible' | 'unknown', nodes, moves }.
function solve(startBoard, budget) {
  const board = Int8Array.from(startBoard, (c) => (c === null ? -1 : c));
  const pos = new Int8Array(52).fill(-1);
  let hi = 0;
  let lo = 0;
  for (let s = 0; s < 52; s++) {
    const c = board[s];
    if (c < 0) continue;
    pos[c] = s;
    hi ^= Z_HI[s * 52 + c];
    lo ^= Z_LO[s * 52 + c];
  }
  const seen = new Set([hi * HALF + lo]);
  const line = []; // card, slot, card, slot, ...
  const runs = new Int8Array(4);
  let nodes = 0;
  let outOfBudget = false;

  function runLength(l) {
    const start = l * 13;
    let n = 0;
    while (n < 13) {
      const c = board[start + n];
      if (c < 0 || (n === 0 ? c % 13 !== 1 : c !== board[start + n - 1] + 1)) break;
      n++;
    }
    return n;
  }

  function search() {
    let total = 0;
    for (let l = 0; l < 4; l++) total += runs[l] = runLength(l);
    if (total === 48) return true;
    if (++nodes > budget) {
      outOfBudget = true;
      return false;
    }
    const first = [];
    const later = [];
    for (let s = 0; s < 52; s++) {
      if (board[s] !== -1) continue;
      const p = s % 13;
      if (p === 0) {
        // Any 2 not already heading a line can go here.
        for (let suit = 0; suit < 4; suit++) {
          const c = suit * 13 + 1;
          if (pos[c] % 13 !== 0) first.push(c, s);
        }
        continue;
      }
      const left = board[s - 1];
      if (left < 0 || left % 13 === 12) continue; // after a gap or a King: dead
      if (runs[(s / 13) | 0] === p) first.push(left + 1, s);
      else later.push(left + 1, s);
    }
    const moves = first.concat(later);
    for (let i = 0; i < moves.length; i += 2) {
      const c = moves[i];
      const to = moves[i + 1];
      const from = pos[c];
      const zf = from * 52 + c;
      const zt = to * 52 + c;
      board[from] = -1;
      board[to] = c;
      pos[c] = to;
      hi ^= Z_HI[zf] ^ Z_HI[zt];
      lo ^= Z_LO[zf] ^ Z_LO[zt];
      const key = hi * HALF + lo;
      if (!seen.has(key)) {
        seen.add(key);
        line.push(c, to);
        if (search()) return true;
        line.length -= 2;
      }
      hi ^= Z_HI[zf] ^ Z_HI[zt];
      lo ^= Z_LO[zf] ^ Z_LO[zt];
      board[to] = -1;
      board[from] = c;
      pos[c] = from;
      if (outOfBudget) return false;
    }
    return false;
  }

  const won = search();
  const moves = [];
  for (let i = 0; i < line.length; i += 2) moves.push([line[i], line[i + 1]]);
  return { result: won ? 'won' : outOfBudget ? 'unknown' : 'impossible', nodes, moves };
}

// FNV-1a fingerprint of a board, as 8 hex digits.
function fingerprint(board) {
  let h = 0x811c9dc5;
  for (const c of board) {
    h ^= c === null ? 0 : c + 1;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// Solve deal `seed`, then prove the answer by replaying it with the real rules.
function checkDeal(seed, budget) {
  const deal = G.dealFromSeed(seed);
  const answer = solve(deal.board, budget);
  const out = { seed, result: answer.result, nodes: answer.nodes, fp: fingerprint(deal.board) };
  if (answer.result === 'won') {
    const replay = G.dealFromSeed(seed);
    for (const [card, slot] of answer.moves) {
      if (!G.move(replay, card, slot)) throw new Error(`deal ${seed}: solver move ${card}->${slot} is illegal`);
    }
    if (!G.isWon(replay.board)) throw new Error(`deal ${seed}: solver line does not win`);
    out.length = answer.moves.length;
  }
  return out;
}

module.exports = { solve, fingerprint, checkDeal };

// ---------- Parallel runner ----------

function parseArgs(argv) {
  const args = { from: 1, to: 1000, workers: os.availableParallelism(), budget: 2000000 };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    if (!(key in args)) throw new Error(`unknown option ${argv[i]}`);
    args[key] = Number(argv[i + 1]);
  }
  return args;
}

function runMain() {
  const args = parseArgs(process.argv.slice(2));
  const total = args.to - args.from + 1;
  const counts = { won: 0, impossible: 0, unknown: 0 };
  const started = Date.now();
  let next = args.from;
  let finished = 0;
  let running = args.workers;

  const progress = () => {
    const secs = (Date.now() - started) / 1000;
    const eta = finished ? Math.round((secs / finished) * (total - finished)) : 0;
    process.stderr.write(
      `${finished}/${total} checked | winnable ${counts.won} | impossible ${counts.impossible} | ` +
        `undecided ${counts.unknown} | ${secs.toFixed(0)}s elapsed, ~${eta}s left\n`,
    );
  };
  const timer = setInterval(progress, 10000);

  for (let w = 0; w < args.workers; w++) {
    const worker = new Worker(__filename, { workerData: { budget: args.budget } });
    const feed = () => {
      if (next <= args.to) worker.postMessage(next++);
      else worker.postMessage(null);
    };
    worker.on('message', (msg) => {
      if (msg.ready) return feed();
      finished++;
      counts[msg.result]++;
      if (msg.result === 'won') {
        process.stdout.write(JSON.stringify({ seed: msg.seed, nodes: msg.nodes, length: msg.length, fp: msg.fp }) + '\n');
      }
      feed();
    });
    worker.on('error', (err) => {
      console.error(err);
      process.exitCode = 1;
    });
    worker.on('exit', () => {
      if (--running > 0) return;
      clearInterval(timer);
      progress();
      const seconds = Math.round((Date.now() - started) / 1000);
      process.stdout.write(JSON.stringify({ done: true, ...args, ...counts, seconds }) + '\n');
    });
  }
}

// Writes deals.js from the job's output.
function writeBank(rawFile, count) {
  const fs = require('fs');
  const lines = fs.readFileSync(rawFile, 'utf8').split('\n');
  const summary = lines.map((l) => (l.startsWith('{"done"') ? JSON.parse(l) : null)).find(Boolean);
  const deals = lines.filter((l) => l.startsWith('{"seed"')).map((l) => JSON.parse(l));
  for (const d of deals) {
    const fp = fingerprint(G.dealFromSeed(d.seed).board);
    if (fp !== d.fp) throw new Error(`deal ${d.seed} deals differently here (${fp} vs ${d.fp})`);
  }
  deals.sort((a, b) => a.seed - b.seed);
  if (deals.length < count) throw new Error(`only ${deals.length} winnable deals, wanted ${count}`);
  const kept = deals.slice(0, count);
  const seeds = kept.map((d) => d.seed);
  const rows = [];
  for (let i = 0; i < seeds.length; i += 20) rows.push('    ' + seeds.slice(i, i + 20).join(', ') + ',');
  const out = [
    '/*',
    ` * ${seeds.length} deal numbers that can be won without a single shuffle.`,
    ' *',
    ' * Each one was dealt with game.js (dealFromSeed), solved by tools/make-deals.js,',
    ' * and the winning line replayed with the real rules before it was accepted.',
    summary
      ? ` * Checked deals ${summary.from}-${summary.to} (search limit ${summary.budget} positions):` +
        ` ${summary.won} winnable, ${summary.impossible} impossible, ${summary.unknown} undecided.`
      : ' *',
    ` * Built ${new Date().toISOString().slice(0, 10)}. Regenerate with: node tools/make-deals.js bank <raw output>`,
    ' */',
    '(function (root) {',
    '  const DEALS = [',
    ...rows,
    '  ];',
    "  if (typeof module === 'object' && module.exports) module.exports = DEALS;",
    '  else root.ADDICTION_DEALS = DEALS;',
    "})(typeof window !== 'undefined' ? window : globalThis);",
    '',
  ].join('\n');
  const target = path.join(__dirname, '..', 'deals.js');
  fs.writeFileSync(target, out);
  const nodes = kept.map((d) => d.nodes).sort((a, b) => a - b);
  console.log(
    `wrote ${target}: ${seeds.length} deals (numbers ${seeds[0]}-${seeds[seeds.length - 1]}), ` +
      `solver effort median ${nodes[nodes.length >> 1]}, max ${nodes[nodes.length - 1]}`,
  );
}

function runWorker() {
  parentPort.on('message', (seed) => {
    if (seed === null) return process.exit(0);
    parentPort.postMessage(checkDeal(seed, workerData.budget));
  });
  parentPort.postMessage({ ready: true });
}

if (!isMainThread) runWorker();
else if (require.main === module && process.argv[2] === 'bank') {
  const countAt = process.argv.indexOf('--count');
  writeBank(process.argv[3], countAt > 0 ? Number(process.argv[countAt + 1]) : 10000);
} else if (require.main === module) runMain();
