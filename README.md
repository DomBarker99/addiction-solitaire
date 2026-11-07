# Addiction Solitaire

Addiction Solitaire (also known as Gaps or Montana), laid out so you can play with the phone held upright. It's a web app that installs like a regular app on Android and iPhone and works offline.

**Play:** https://dombarker99.github.io/addiction-solitaire/

## Install it on a phone

- **Android (Chrome):** open the link, tap **⋮ → Install app**. On some versions it's **Add to home screen → Install**. The app then shows up in the app drawer like any other app.
- **iPhone (Safari):** open the link, tap **Share → Add to Home Screen**.

Once installed, it opens full screen, stays upright and works without internet. Updates arrive on their own the next time it's opened with a connection.

## How to play

The 52 cards are dealt into 4 columns of 13, then the Aces are taken out, leaving 4 gaps.

- A gap takes the card one rank higher, in the same suit, than the card **above** it. A gap under the 5♥ takes the 6♥.
- A gap at the top of a column takes any 2.
- Nothing can go under a King or under another gap.
- You win when every column runs 2 → King in one suit. The bottom slot stays empty.
- Stuck? You get **3 shuffles** per game. A shuffle keeps every card that's already in order from the top of its column and re-deals everything else, gaps included.

Tap a card to send it to its gap, or drag it there. If a 2 could go into more than one gap, the choices light up and you tap the one you want.

These are the rules from [cardgames.io/addiction](https://cardgames.io/addiction/), turned on their side: their rows are columns here.

## Features

- **Every deal can be won without shuffling.** New games come from a bank of 10,000 deals that a solver has proven winnable (see [The deal bank](#the-deal-bank)). A phone never repeats a deal until it has played all of them.
- **Undo**, as many times as you like, including shuffles. Each deal's shuffles are fixed, so undoing a shuffle and shuffling again gives the same result.
- **Menu (☰)** pauses the game (the board is hidden and the clock stops) and has New game, Sound and Timer settings. Leaving the app pauses it too.
- **Timer** starts with the first move and can be hidden.
- **Sounds:** card slides or wood knocks on every move, a riffle on shuffles, and a sad trombone when you lose. They can be turned off.
- **Win animations** take turns: a classic bouncing-card cascade, then confetti.
- **Auto-save:** the game, timer, undo history and settings survive the phone closing the app.

## How it's built

Plain HTML, CSS and JavaScript. There are no frameworks and no build step, so every file can be read as it is.

| File | What it does |
| --- | --- |
| `index.html` | The page: top bar, board, bottom bar, menu, win/lose panel |
| `style.css` | Layout and look. Every card is positioned by two CSS variables |
| `game.js` | The rules, numbered deals, shuffles and undo. No drawing code |
| `ui.js` | Draws the board. Taps, drags, menu, timer, undo, auto-save |
| `audio.js` | Sounds |
| `celebrate.js` | Win animations |
| `deals.js` | The 10,000 winnable deal numbers (generated) |
| `manifest.json` | Makes it installable: name, icons, full screen, portrait |
| `sw.js` | Service worker: lets it open without internet |
| `icons/` | App icons. `icon.svg` is the source |
| `sounds/` | Sound clips |
| `tools/` | The solver that builds `deals.js`, and a Kubernetes job to run it |
| `tests/` | Rules tests and browser tests |

## Running it locally

Double-click `index.html` to play in a browser.

To try it on phones on the same Wi-Fi, run this in the project folder:

```sh
python3 -m http.server 8000
```

Then open `http://<your computer's IP>:8000` on the phone. Installing and offline mode need HTTPS, so they only work on the published site.

## Tests

You need Node.js 20 or newer and Google Chrome.

```sh
npm install
npm test            # rules tests, then browser tests on a local copy (~35 s)
npm run test:live   # browser tests against the published site
```

The browser tests drive Chrome as a Galaxy S26, two iPhones, a desktop and a sideways phone. They check the layout, taps, drags, undo, menu and pause, timer, settings, auto-save, winning, losing, offline mode and installability, and save screenshots to a temporary folder.

## Publishing

GitHub Pages publishes the `main` branch. Every push goes live in about a minute, and installed copies pick it up the next time they're opened with internet. Run `npm test` before pushing.

## The deal bank

`deals.js` lists 10,000 deal numbers. `game.js` turns a deal number into the same layout on every device. Every number in the bank was solved with no shuffles by `tools/make-deals.js`, which replays the winning moves with the real rules before accepting a deal.

The current bank came from checking deals 1–20,000, with the solver allowed to explore up to 2 million positions per deal. Of those, 11,204 could be won, 5,523 couldn't, and 3,273 were too deep to decide. The 10,000 lowest-numbered winnable deals were kept.

To rebuild it:

```sh
node tools/make-deals.js --from 1 --to 20000 > deals-raw.jsonl   # uses every CPU core; ~25 min on a 10-core Mac
node tools/make-deals.js bank deals-raw.jsonl --count 10000      # checks the results and writes deals.js
```

`tools/deals-job.yaml` runs the first step on a Kubernetes cluster instead. The instructions are at the top of that file.

## Credits

- Card and wood sounds: [Kenney](https://kenney.nl), *Casino Audio* and *Impact Sounds*, released into the public domain (CC0).
- Rules as played on [cardgames.io](https://cardgames.io/addiction/).
