# Notes for coding agents

Read `README.md` first for what the games are, how to run them and how they're published. This file covers what isn't obvious from the code.

## Ground rules

- **`main` is production.** GitHub Pages publishes every push in about a minute, and people who installed the app get the new version the next time they open it. Run `npm test` and look at the screenshots it saves before pushing. Don't push half-finished work.
- **No frameworks, bundlers or build step.** Use classic `<script>` tags, not ES modules: double-clicking `index.html` (a `file://` page) has to keep working. That also rules out `fetch` for anything the game needs in order to start, which is why the deal bank is `deals.js` and not JSON.
- **Keep the code readable for a beginner:** plain names, and comments that explain why.
- **This repo is public.** Don't commit personal details, infrastructure details (cluster names, hostnames, IPs) or credentials.

## Map

One app, two games: Addiction, and Solitaire (Klondike). More games can be added the same way (see below).

- **Addiction** stays at the top level, because `index.html` is the page the installed app opens.
  - `game.js`: rules only, no DOM. Exposes `window.Addiction` in the browser and `module.exports` in Node.
    - Cards are 0–51 (`suit * 13 + rank - 1`, with Ace = rank 1).
    - Slots are 0–51 (`line * 13 + pos`).
    - The rules talk about **lines**; `ui.js` draws each line as a **column**, with `pos` 0 at the top.
  - `ui.js`: the board. Rendering, taps, drags (pointer events), Undo and Shuffle.
  - `addiction.css`: the tiles.
  - `deals.js`: `window.ADDICTION_DEALS`, the generated bank of winnable deal numbers. Don't edit it by hand.
- **Solitaire** lives in `klondike/`: `index.html`, `rules.js`, `ui.js`, `style.css`.
  - `rules.js`: rules only, no DOM. Exposes `window.Klondike` and `module.exports`.
    - Cards are numbered as in Addiction (`cards.js`).
    - Piles are named `'stock'`, `'waste'`, `'f0'`–`'f3'` (foundations) and `'c0'`–`'c6'` (columns). Each is an array, bottom card first.
    - `hidden[c]` is how many cards at the bottom of column `c` are face down.
  - `ui.js`: the table. It works out each card's position in pixels and sets it with `--x`/`--y`, squeezing long columns so the table always fits.
- **Shared by every game:**
  - `shell.js`: the top bar, the ☰ menu and pause, the game switcher, settings, the timer, the "Tap again" confirmations, the win/lose panel, alternating win animations, auto-save and picking the next deal. Each game's `ui.js` calls `Shell.create({...})` with what only the game knows; the comment above `create()` lists it.
  - `cards.js`: card names and suits, and the seeded random numbers Solitaire deals with.
  - `style.css`: the felt, the bars and buttons, the menu and the panels.
  - `audio.js`: `Sound.play('move' | 'shuffle' | 'lose')` and `Sound.setStyle('off' | 'wood' | 'card')`.
    - Uses Web Audio, unlocked on the first touch, and falls back to `<audio>` on `file://`.
    - The losing "womp womp womp wommmp" is generated in code; there's no clip for it.
  - `celebrate.js`: `Celebrate.run('cascade' | 'confetti', cards)` returns a Promise. It draws on a full-screen canvas, and a tap skips it.
  - `sw.js`: network-first service worker that falls back to the saved copy after 3 seconds or when offline. One service worker covers every game.
  - `manifest.json`, `icons/`, `sounds/`.
- `tools/make-deals.js`: Addiction's solver, its parallel runner, and the `bank` subcommand that writes `deals.js`. `tools/deals-job.yaml` runs the same thing on Kubernetes.
- `tests/game.test.js`, `tests/klondike.test.js`: rules tests, using `node:test`.
- `tests/e2e.js`: browser tests for both games, using `playwright-core` and the installed Google Chrome. It serves the repo itself on a random port.

### Adding another game

1. Make a folder with `index.html`, `rules.js`, `ui.js` and `style.css`. Copy `klondike/index.html` for the frame and change the board, the bottom-bar buttons and the game's own menu settings.
2. Keep `rules.js` free of DOM code so it can be tested in Node. In `ui.js`, stop at once if `Shell.redirecting` is true, then call `Shell.create`.
3. Add the game to `GAMES` in `shell.js`, and a `data-switch` button to the Game setting in every page's menu.
4. Add its files to `FILES` in `sw.js` and bump `VERSION`.
5. Save its game under its own key. Shared preferences go in `app.settings`.
6. Write rules tests in `tests/<game>.test.js`, and add the file to `test:rules` in `package.json`. Add a browser section to `tests/e2e.js`.

## Things that break silently

- **Dealing is frozen.**
  - What Addiction's deal number N looks like depends on:
    - `seededRandom`;
    - `shuffleArray`;
    - the deck order in `newGame`;
    - the card and slot numbering.

    Changing any of these invalidates every number in `deals.js`. The numbers would still deal, but they'd no longer be guaranteed winnable. `tests/game.test.js` pins deal #1's layout to catch this. If dealing really has to change, rebuild the bank (see README).
  - `game.js` keeps its own copy of `seededRandom` and `shuffleArray` on purpose, so that nothing changed in `cards.js` can touch Addiction's deals.
  - Solitaire's deals depend on the copies in `cards.js` and on the dealing order in `klondike/rules.js`. There's no Solitaire bank yet, but keep them fixed so one can be built. `tests/klondike.test.js` pins its deal #1.
  - The order deals come out of the bank also uses `cards.js`'s `seededRandom`.
- **Shuffles are seeded per deal** with `mixSeeds(seed, shuffleNumber)`, so undoing a shuffle and shuffling again gives the same layout. Keep it that way, or Undo becomes a free re-roll.
- **The service worker's file list.**
  - Adding, renaming or removing a file the app loads means updating `FILES` in `sw.js` and bumping `VERSION`.
  - If a file in the list is missing, the install step fails and offline mode quietly stops working.
  - `tests/e2e.js` checks that every file the pages load is in the list. It can't see files loaded from JavaScript, like the sounds.
  - It deletes only its own old caches, the ones named `addiction-…`. Every Pages site on the same GitHub account shares one web address, so they all share one set of caches. The same goes for localStorage.
- **Saved data** (localStorage):
  - `'solitaire-settings'`: `{ version: 1, sound, timer, lastGame, draw }`, shared by every game.
  - `'addiction-solitaire'`: Addiction's game, `{ version: 2, game, clock, dealOrder, nextCelebration }`. `game` is checked by `Addiction.restore()`.
    - Version 1, from before Solitaire, also held `settings`. `shell.js` picks those up when there's no `solitaire-settings` yet, so keep that code.
  - `'klondike-solitaire'`: Solitaire's game, the same shape, version 1. `Klondike.restore()` checks that undoing the whole history leads back to a fresh deal.
  - Name every key after its game, because every site on the account shares the same storage.
  - Changing a shape needs a new version number and code to convert old saves; otherwise players lose the game they're in the middle of.
- **The start page jumps to the last game played.** `shell.js` loads in each page's `<head>` and, on `index.html`, moves straight on to the game played last. The rest of that page still loads while the browser moves on. So every game's `ui.js` must stop when `Shell.redirecting` is true, or it would save over the choice.
- **Pages in a folder.**
  - `klondike/index.html` reaches the shared files with `../`.
  - `shell.js` and `audio.js` work out paths from where they themselves are (`document.currentScript`), so they work from any folder.
  - Links between games point at `…/index.html` rather than the folder, so they also work on `file://`.
- **App identity.** Changing `name`, `short_name` or the icons in `manifest.json` makes Android ask players to approve an "app update", so don't change them casually. Every page links the same manifest, so the games install and update as one app.
- **`.nojekyll` must stay.** It tells GitHub Pages to publish the files as they are.

## Decisions already made

Don't undo any of these without asking the owner.

- **One app for every game.** The owner chose this over a separate Solitaire app.
  - The ☰ menu has a Game switcher (Addiction / Solitaire), and the app reopens on the game played last.
  - The home-screen name stays "Addiction", to keep things simple.
  - Sound and timer settings apply to every game.
- **Addiction rules:** the full-deck cardgames.io version: 4 × 13, Aces out, 2s first, 3 shuffles, and a shuffle re-deals every card that isn't in order, gaps included, at random. It's not MobilityWare's Ace-to-6 version.
- **Solitaire rules:** Klondike.
  - Draw 1 by default, with Draw 3 in the menu. A change applies from the next game, or straight away if no move has been made yet.
  - As many passes through the stock as you like.
  - No scoring: just the timer.
  - Cards on the foundations can come back down to the columns.
- **Layout:**
  - Locked upright. Sideways phones get a "turn upright" message.
  - Addiction is 4 columns × 13 rows of flat tiles.
  - Solitaire puts the foundations, waste and stock along the top and 7 fanned columns below. Rank and suit sit along the top edge of each card so they show when cards overlap.
- **Color:** green felt. A navy background was tried and rejected.
- **Tap and drag:** both are always on, in every game.
  - In Addiction, tapping sends a card straight to its gap. A 2 that has several gaps to choose from, or that is already at the top of a column, waits for the player to pick a gap.
  - In Solitaire, tapping sends a card home if it can go there, otherwise onto a column (a King to the first empty one).
    - Dragging lets the player choose, and moves whole runs.
    - Foundation cards come back down by dragging only.
    - Tapping anywhere on the waste plays its top card.
    - Once the stock is empty, tapping its outline turns the waste back over.
- **Confirmations:** Shuffle asks "Tap again" when moves remain, and New game asks when a game is in progress. There are no pop-up dialogs.
- **Undo:** unlimited, and it covers Addiction's shuffles and every tap on Solitaire's stock.
- **Menu and pause:** the ☰ menu pauses the game (board hidden, clock stopped). Leaving the app pauses it too, and a saved game in progress reopens paused.
- **Timer:** starts on the first move. Hiding it doesn't stop it.
- **Sounds:**
  - Card (the default), Wood, or Off.
  - A riffle on shuffles and new deals, and the generated sad trombone on a loss.
  - The clips are Kenney CC0 sounds stored as WAV, so they play with no delay.
- **Winning:**
  - The animations alternate, bouncing-card cascade first, then confetti. The win panel shows the time when the timer is on.
  - In Solitaire, Finish lights up once every column card is face up (in Draw 3, once the stock is empty too) and plays the cards out.
- **Losing in Solitaire:** "No more moves" (with the sad trombone) only when nothing can ever get anywhere again: no card can go home, turn over or leave the stock, whatever is moved around first. `canProgress` in `klondike/rules.js` works this out.
- **New game button:** it lives in the menu and on the win/lose panels, not in the bottom bar.
- **Picking deals:**
  - Addiction's new games come from the bank in an order shuffled once per device, and nothing repeats until every deal has been played.
  - Solitaire deals at random for now. It skips the rare Draw 3 deal that has nothing to do from the start. A bank of winnable Solitaire deals is a possible next step.

## Testing

```sh
npm install
npm test            # rules tests + browser tests (~70 s)
npm run test:live   # after pushing: browser tests against the published site
```

The browser run prints the folder where it saved screenshots, so look at them for anything visual. The tests can only check that a sound was triggered, not hear it, so ask the owner to listen on a phone.

## Rebuilding the deal bank

This covers Addiction's bank; Solitaire doesn't have one yet. See README → *The deal bank*. Doing it locally takes about 25 minutes on a 10-core Mac.

`tools/deals-job.yaml` runs the solver on a Kubernetes cluster. Ask the owner which cluster to use, and keep its details out of this repo. Delete the job's namespace once you have the results, and ask the owner first, because that can't be undone.

The raw output of the last run is kept outside the repo, in `~/Desktop/Agents/addiction-solitaire-deals/`. It records how much searching each deal needed, which could feed a difficulty setting later.
