# Addiction Solitaire

Two solitaire games, laid out so you can play with the phone held upright:

- **Addiction** (also known as Gaps or Montana).
- **Solitaire**: the regular kind (Klondike), Draw 1 or Draw 3.

It's a web app that installs like a regular app on Android and iPhone and works offline. On the home screen it's called Addiction; switch games from its ☰ menu.

**Play:** https://dombarker99.github.io/addiction-solitaire/

## Install it on a phone

- **Android (Chrome):** open the link, tap **⋮ → Install app**. On some versions it's **Add to home screen → Install**. The app then shows up in the app drawer like any other app.
- **iPhone (Safari):** open the link, tap **Share → Add to Home Screen**.

Once installed, it opens full screen, stays upright and works without internet. Updates arrive on their own the next time it's opened with a connection.

## How to play

### Addiction

The 52 cards are dealt into 4 columns of 13, then the Aces are taken out, leaving 4 gaps.

- A gap takes the card one rank higher, in the same suit, than the card **above** it. A gap under the 5♥ takes the 6♥.
- A gap at the top of a column takes any 2.
- Nothing can go under a King or under another gap.
- You win when every column runs 2 → King in one suit. The bottom slot stays empty.
- Stuck? You get **3 shuffles** per game. A shuffle keeps every card that's already in order from the top of its column and re-deals everything else, gaps included.

Tap a card to send it to its gap, or drag it there. If a 2 could go into more than one gap, the choices light up and you tap the one you want.

These are the rules from [cardgames.io/addiction](https://cardgames.io/addiction/), turned on their side: their rows are columns here.

### Solitaire

The usual Klondike: 7 columns of 1 to 7 cards with the top one face up, and the other 24 cards in the stock.

- Build the 4 foundations (top left) up by suit, from Ace to King. You win when all 52 cards are there.
- In the columns, put a card on one rank higher in the other color: a red 6 on a black 7. A run moves together. Only a King goes into an empty column.
- Tap the stock (top right) to turn over 1 card, or 3 with **Draw 3** in the menu. Only the top card can be played. When the stock runs out, tap its outline to turn the cards back over, as often as you like.

Tap a card to send it to the best place for it (home to a foundation if it can go), or drag it where you want. When every card is face up, **Finish** plays the rest out for you.

## Features

- **Two games in one app.** The ☰ menu switches between them, and the app opens on the one you played last. Each keeps its own game in progress.
- **Every Addiction deal can be won without shuffling.** New games come from a bank of 10,000 deals that a solver has proven winnable (see [The deal bank](#the-deal-bank)). A phone never repeats a deal until it has played all of them. Solitaire deals at random for now.
- **Undo**, as many times as you like, including Addiction's shuffles and every tap on Solitaire's stock. Each Addiction deal's shuffles are fixed, so undoing a shuffle and shuffling again gives the same result.
- **"No more moves"** in Solitaire only when nothing you could do would ever get another card home, turned over or out of the stock.
- **Menu (☰)** pauses the game (the board is hidden and the clock stops) and has New game, Game, Theme, Sound and Timer settings, plus Draw 1 or 3 in Solitaire. Leaving the app pauses it too.
- **Themes:** Classic green felt, or two Mickey Mouse themes drawn in the style of his first cartoon (1928), with bigger, bolder numbers. The theme applies to both games.
  - **Mickey film:** black-and-white film. In Addiction every column is a strip of film and every card a frame; in Solitaire the face-down cards are a silent film's title cards.
  - **Mickey tickets:** a night at the picture house, with a velvet curtain and marquee bulbs. Every card is an admission ticket.
- **Timer** starts with the first move and can be hidden.
- **Sounds:** card slides or wood knocks on every move, a riffle on shuffles, and a sad trombone when you lose. They can be turned off.
- **Win animations** take turns: a classic bouncing-card cascade, then confetti.
- **Auto-save:** each game, its timer and undo history, and the settings survive the phone closing the app.

## How it's built

Plain HTML, CSS and JavaScript. There are no frameworks and no build step, so every file can be read as it is.

| File | What it does |
| --- | --- |
| `index.html` | Addiction's page (and the page the app opens): top bar, board, bottom bar, menu, win/lose panel |
| `game.js` | Addiction's rules, numbered deals, shuffles and undo. No drawing code |
| `ui.js` | Draws Addiction's board. Taps, drags, Undo, Shuffle |
| `addiction.css` | Addiction's tiles. Every card is positioned by two CSS variables |
| `deals.js` | The 10,000 winnable Addiction deal numbers (generated) |
| `klondike/` | Solitaire: its page, rules (`rules.js`), table (`ui.js`) and cards (`style.css`) |
| `shell.js` | Shared by both games: menu and pause, game switcher, settings, timer, win/lose panel, auto-save |
| `cards.js` | Shared: card names, suits and the seeded random numbers behind numbered deals |
| `style.css` | Shared: the felt, bars, buttons, menu and panels. The themes start at the end of this file |
| `audio.js` | Sounds |
| `celebrate.js` | Win animations |
| `manifest.json` | Makes it installable: name, icons, full screen, portrait |
| `sw.js` | Service worker: lets both games open without internet |
| `icons/` | App icons (`icon.svg` is the source), and the mouse drawn for the Mickey themes |
| `fonts/` | The lettering the Mickey themes use |
| `sounds/` | Sound clips |
| `tools/` | The solver that builds `deals.js`, and a Kubernetes job to run it |
| `tests/` | Rules tests and browser tests |

## Running it locally

Double-click `index.html` to play in a browser. Solitaire is `klondike/index.html`, or switch from the menu.

To try it on phones on the same Wi-Fi, run this in the project folder:

```sh
python3 -m http.server 8000
```

Then open `http://<your computer's IP>:8000` on the phone. Installing and offline mode need HTTPS, so they only work on the published site.

## Tests

You need Node.js 20 or newer and Google Chrome.

```sh
npm install
npm test            # rules tests, then browser tests on a local copy (~90 s)
npm run test:live   # browser tests against the published site
```

The browser tests drive Chrome as a Galaxy S26, two iPhones, a desktop and a sideways phone. For both games they check the layout, taps, drags, undo, menu and pause, timer, settings, switching games, themes, auto-save, winning, losing, offline mode, opening straight from the files and installability, and save screenshots to a temporary folder.

## Publishing

GitHub Pages publishes the `main` branch. Every push goes live in about a minute, and installed copies pick it up the next time they're opened with internet. Run `npm test` before pushing.

## The deal bank

This is Addiction's; Solitaire doesn't have one yet. `deals.js` lists 10,000 deal numbers. `game.js` turns a deal number into the same layout on every device. Every number in the bank was solved with no shuffles by `tools/make-deals.js`, which replays the winning moves with the real rules before accepting a deal.

The current bank came from checking deals 1–20,000, with the solver allowed to explore up to 2 million positions per deal. Of those, 11,204 could be won, 5,523 couldn't, and 3,273 were too deep to decide. The 10,000 lowest-numbered winnable deals were kept.

To rebuild it:

```sh
node tools/make-deals.js --from 1 --to 20000 > deals-raw.jsonl   # uses every CPU core; ~25 min on a 10-core Mac
node tools/make-deals.js bank deals-raw.jsonl --count 10000      # checks the results and writes deals.js
```

`tools/deals-job.yaml` runs the first step on a Kubernetes cluster instead. The instructions are at the top of that file.

## Credits

- Card and wood sounds: [Kenney](https://kenney.nl), *Casino Audio* and *Impact Sounds*, released into the public domain (CC0).
- Addiction's rules as played on [cardgames.io](https://cardgames.io/addiction/).
- The Mickey themes' lettering: [Lilita One](https://fonts.google.com/specimen/Lilita+One) by Juan Montoreano, under the SIL Open Font License (`fonts/OFL.txt`).
- The mouse in the Mickey themes was drawn for this game, after the Mickey Mouse of *Steamboat Willie* (1928), which has been in the public domain in the United States since 2024. This game isn't made or endorsed by Disney.
