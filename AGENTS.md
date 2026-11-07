# Notes for coding agents

Read `README.md` first for what the game is, how to run it and how it's published. This file covers what isn't obvious from the code.

## Ground rules

- **`main` is production.** GitHub Pages publishes every push in about a minute, and people who installed the app get the new version the next time they open it. Run `npm test` and look at the screenshots it saves before pushing. Don't push half-finished work.
- **No frameworks, bundlers or build step.** Use classic `<script>` tags, not ES modules: double-clicking `index.html` (a `file://` page) has to keep working. That also rules out `fetch` for anything the game needs in order to start, which is why the deal bank is `deals.js` and not JSON.
- **Keep the code readable for a beginner:** plain names, and comments that explain why.
- **This repo is public.** Don't commit personal details, infrastructure details (cluster names, hostnames, IPs) or credentials.

## Map

- `game.js`: rules only, no DOM. Exposes `window.Addiction` in the browser and `module.exports` in Node.
  - Cards are 0–51 (`suit * 13 + rank - 1`, with Ace = rank 1).
  - Slots are 0–51 (`line * 13 + pos`).
  - The rules talk about **lines**; `ui.js` draws each line as a **column**, with `pos` 0 at the top.
- `ui.js`: everything on screen. Rendering, taps, drags (pointer events), menu and pause, timer, undo, the "Tap again" confirmations, auto-save, picking the next deal, and the win/lose panels.
- `audio.js`: `Sound.play('move' | 'shuffle' | 'lose')` and `Sound.setStyle('off' | 'wood' | 'card')`.
  - Uses Web Audio, unlocked on the first touch, and falls back to `<audio>` on `file://`.
  - The losing "womp womp womp wommmp" is generated in code; there's no clip for it.
- `celebrate.js`: `Celebrate.run('cascade' | 'confetti', cards)` returns a Promise. It draws on a full-screen canvas, and a tap skips it.
- `deals.js`: `window.ADDICTION_DEALS`, the generated bank of winnable deal numbers. Don't edit it by hand.
- `sw.js`: network-first service worker that falls back to the saved copy after 3 seconds or when offline.
- `tools/make-deals.js`: the solver, its parallel runner, and the `bank` subcommand that writes `deals.js`. `tools/deals-job.yaml` runs the same thing on Kubernetes.
- `tests/game.test.js`: rules tests, using `node:test`.
- `tests/e2e.js`: browser tests using `playwright-core` and the installed Google Chrome. It serves the repo itself on a random port.

## Things that break silently

- **Dealing is frozen.** What deal number N looks like depends on:
  - `seededRandom`;
  - `shuffleArray`;
  - the deck order in `newGame`;
  - the card and slot numbering.

  Changing any of these invalidates every number in `deals.js`. The numbers would still deal, but they'd no longer be guaranteed winnable. `tests/game.test.js` pins deal #1's layout to catch this. If dealing really has to change, rebuild the bank (see README).
- **Shuffles are seeded per deal** with `mixSeeds(seed, shuffleNumber)`, so undoing a shuffle and shuffling again gives the same layout. Keep it that way, or Undo becomes a free re-roll.
- **The service worker's file list.**
  - Adding, renaming or removing a file the app loads means updating `FILES` in `sw.js` and bumping `VERSION`.
  - If a file in the list is missing, the install step fails and offline mode quietly stops working.
- **Saved games.**
  - `localStorage['addiction-solitaire']` holds `{ version: 1, game, clock, settings, dealOrder, nextCelebration }`, and `game` is checked by `Addiction.restore()`.
  - Changing that shape needs a new version number and code to convert old saves; otherwise players lose the game they're in the middle of.
- **App identity.** Changing `name`, `short_name` or the icons in `manifest.json` makes Android ask players to approve an "app update", so don't change them casually.
- **`.nojekyll` must stay.** It tells GitHub Pages to publish the files as they are.

## Decisions already made

Don't undo any of these without asking the owner.

- **Rules:** the full-deck cardgames.io version: 4 × 13, Aces out, 2s first, 3 shuffles, and a shuffle re-deals every card that isn't in order, gaps included, at random. It's not MobilityWare's Ace-to-6 version.
- **Layout:** 4 columns × 13 rows of flat tiles, locked upright. Sideways phones get a "turn upright" message.
- **Color:** green felt. A navy background was tried and rejected.
- **Tap and drag:**
  - Tapping sends a card straight to its gap, and dragging works too. Both are always on.
  - A 2 that has several gaps to choose from, or that is already at the top of a column, waits for the player to pick a gap.
- **Confirmations:** Shuffle asks "Tap again" when moves remain, and New game asks when a game is in progress. There are no pop-up dialogs.
- **Undo:** unlimited, and it covers shuffles.
- **Menu and pause:** the ☰ menu pauses the game (board hidden, clock stopped). Leaving the app pauses it too, and a saved game in progress reopens paused.
- **Timer:** starts on the first move. Hiding it doesn't stop it.
- **Sounds:**
  - Card (the default), Wood, or Off.
  - A riffle on shuffles and new deals, and the generated sad trombone on a loss.
  - The clips are Kenney CC0 sounds stored as WAV, so they play with no delay.
- **Winning:** the animations alternate, bouncing-card cascade first, then confetti. The win panel shows the time when the timer is on.
- **New game button:** it lives in the menu and on the win/lose panels, not in the bottom bar.
- **Picking deals:** new games come from the bank in an order shuffled once per device, and nothing repeats until every deal has been played.

## Testing

```sh
npm install
npm test            # rules tests + browser tests (~35 s)
npm run test:live   # after pushing: browser tests against the published site
```

The browser run prints the folder where it saved screenshots, so look at them for anything visual. The tests can only check that a sound was triggered, not hear it, so ask the owner to listen on a phone.

## Rebuilding the deal bank

See README → *The deal bank*. Doing it locally takes about 25 minutes on a 10-core Mac.

`tools/deals-job.yaml` runs the solver on a Kubernetes cluster. Ask the owner which cluster to use, and keep its details out of this repo. Delete the job's namespace once you have the results, and ask the owner first, because that can't be undone.

The raw output of the last run is kept outside the repo, in `~/Desktop/Agents/addiction-solitaire-deals/`. It records how much searching each deal needed, which could feed a difficulty setting later.
