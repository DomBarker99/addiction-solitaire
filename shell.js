/*
 * The parts every game shares: the top bar (status and timer), the menu that
 * pauses the game, the game switcher, settings, the "Tap again"
 * confirmations, the win/lose panel, the win animations and auto-save.
 *
 * Each game's page loads this file first, in its <head>, and says which game it is:
 *   <script src="shell.js" data-game="addiction"></script>
 * That's early enough to jump straight to the game played last time (see
 * `redirecting` below). Later, the game's own ui.js draws its board and calls
 *   const app = Shell.create({ ...what only the game knows... });
 *   app.start();
 * See create() for the list of things a game tells the shell.
 *
 * Saved data (localStorage). Every game on this web address shares it, so
 * each key is named after the game:
 *   'solitaire-settings'   { version: 1, sound, timer, theme, lastGame, draw }
 *   'addiction-solitaire'  Addiction's game in progress  } { version, game, clock,
 *   'klondike-solitaire'   Solitaire's game in progress  }   dealOrder, nextCelebration }
 */
(() => {
  'use strict';

  const script = document.currentScript;
  const GAME = script.dataset.game; // the game on this page
  const ROOT = new URL('./', script.src); // the app's folder, whichever folder this page is in

  // The games, and the page each one lives on (relative to ROOT).
  const GAMES = [
    { id: 'addiction', page: 'index.html' },
    { id: 'klondike', page: 'klondike/index.html' },
  ];
  const START_GAME = 'addiction'; // index.html, the page the installed app opens

  // The looks to choose from in the menu. `bar` is the colour phones give
  // their own status bar, to match the top of the page. The looks themselves
  // are at the end of style.css and of each game's own stylesheet.
  const THEMES = [
    { id: 'classic', bar: '#0b5530' },
    { id: 'film', bar: '#161616' },
    { id: 'tickets', bar: '#101010' },
  ];

  const SETTINGS_KEY = 'solitaire-settings';
  const ADDICTION_SAVE_KEY = 'addiction-solitaire'; // its version 1 also held the settings
  const CONFIRM_MS = 2500; // how long "Tap again" waits for the second tap

  const pageUrl = (id) => new URL(GAMES.find((g) => g.id === id).page, ROOT).href;

  // ---------- Saved data ----------

  function read(key) {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch (error) {
      return null;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      // Storage full or blocked: everything still works, it just won't be remembered.
    }
  }

  // Sound, timer, theme and the game played last are shared by every game. A game
  // can keep its own preferences here too (Solitaire keeps `draw`). Before
  // Solitaire was added, Addiction kept sound and timer in its own save, so
  // the first time they're picked up from there.
  function loadSettings() {
    let saved = read(SETTINGS_KEY) || (read(ADDICTION_SAVE_KEY) || {}).settings;
    if (!saved || typeof saved !== 'object') saved = {};
    const settings = { ...saved, version: 1 };
    if (!['off', 'wood', 'card'].includes(settings.sound)) settings.sound = 'card';
    if (typeof settings.timer !== 'boolean') settings.timer = true;
    if (!THEMES.some((t) => t.id === settings.theme)) settings.theme = 'classic';
    if (!GAMES.some((g) => g.id === settings.lastGame)) settings.lastGame = null;
    return settings;
  }

  const settings = loadSettings();

  // Puts the chosen look on the page: <html data-theme="film">. This file
  // loads in the <head>, so it's there before anything is drawn.
  function applyTheme() {
    document.documentElement.dataset.theme = settings.theme;
    const bar = document.querySelector('meta[name="theme-color"]');
    if (bar) bar.content = THEMES.find((t) => t.id === settings.theme).bar;
  }
  applyTheme();

  // The installed app always opens index.html (Addiction). If another game was
  // played last, go straight to it. Only the start page does this, so a link
  // to a particular game always opens that game. The rest of this page still
  // loads while the browser moves on, so the game's ui.js checks
  // Shell.redirecting and doesn't start.
  const redirecting = GAME === START_GAME && settings.lastGame !== null && settings.lastGame !== GAME;
  if (redirecting) location.replace(pageUrl(settings.lastGame));

  function randomSeed() {
    if (window.crypto && crypto.getRandomValues) return crypto.getRandomValues(new Uint32Array(1))[0];
    return Math.floor(Math.random() * 4294967296);
  }

  function formatTime(ms) {
    const total = Math.floor(ms / 1000);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor(total / 60) % 60;
    const seconds = String(total % 60).padStart(2, '0');
    return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
  }

  /*
   * Connects a game to the shell. `game` tells the shell:
   *   saveKey, saveVersion    where its game in progress is saved, and in which format
   *   bank                    deal numbers to deal from, or [] for any deal
   *   current()               the game's state (saved as `game`)
   *   status()                'playing', 'stuck' (no moves, but help is left), 'lost' or 'won'
   *   moved()                 true once the player has made a move in this deal
   *   restore(saved)          take over a saved game; return false if it can't
   *   deal(number)            start deal `number`
   *   render()                draw the board and the game's own buttons
   *   cancel()                drop anything half-done, like a picked card
   *   undo()                  what the lose panel's Undo button does
   *   statusText(status)      the top bar's text
   *   dealNote()              the line at the bottom of the menu
   *   lostText(), wonText(time)   the panel's text when the game is lost or won
   *   celebrationCards()      [{ card, el }] for the bouncing-card cascade
   *   onDeal(), onWin()       optional: effects on the board
   *   renderMenu()            optional: show the game's own settings in the menu
   * It returns `app`, which the game uses to talk back to the shell.
   */
  function create(game) {
    const Sound = window.Sound;
    const Celebrate = window.Celebrate;
    const $ = (id) => document.getElementById(id);
    const statusEl = $('status');
    const timerEl = $('timer');
    const menuEl = $('menu');
    const menuNewGameBtn = $('menu-new-game');
    const timerSwitch = $('timer-switch');
    const dealNumberEl = $('deal-number');
    const overlayEl = $('overlay');
    const overlayTitle = $('overlay-title');
    const overlayText = $('overlay-text');
    const overlayUndoBtn = $('overlay-undo');
    const overlayNewGameBtn = $('overlay-new-game');

    let dealOrder = { seed: randomSeed(), next: 0 }; // which bank deal comes next on this device
    let nextCelebration = 'cascade';
    let clockBefore = 0; // ms on the clock before the current run
    let clockStarted = null; // when the clock last started running, or null if stopped
    let paused = false;
    let celebrating = false;
    let prompt = null; // temporary message in the top bar
    let confirming = null; // the button waiting for its second tap
    let confirmTimer = 0;

    const inProgress = () => {
      const status = game.status();
      return status === 'playing' || status === 'stuck';
    };

    // ---------- Deals ----------

    // The next deal number. Bank deals come in an order shuffled once per
    // device, so none repeats until all of them have been played.
    function nextDealNumber() {
      const bank = game.bank;
      if (!bank.length) return randomSeed(); // no bank: any deal
      if (dealOrder.next >= bank.length) dealOrder = { seed: randomSeed(), next: 0 };
      const order = [...bank.keys()];
      const random = window.Cards.seededRandom(dealOrder.seed);
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      return bank[order[dealOrder.next++]];
    }

    // ---------- Timer ----------

    const clockMs = () => clockBefore + (clockStarted === null ? 0 : performance.now() - clockStarted);

    function startClock() {
      if (clockStarted === null && !paused && inProgress()) clockStarted = performance.now();
    }

    function stopClock() {
      if (clockStarted === null) return;
      clockBefore += performance.now() - clockStarted;
      clockStarted = null;
    }

    function showTime() {
      const text = formatTime(clockMs());
      if (timerEl.textContent !== text) timerEl.textContent = text;
    }

    // ---------- Saving ----------

    function save() {
      write(game.saveKey, {
        version: game.saveVersion,
        game: game.current(),
        clock: Math.round(clockMs()),
        dealOrder,
        nextCelebration,
      });
    }

    const saveSettings = () => write(SETTINGS_KEY, settings);

    // ---------- Drawing ----------

    function render() {
      game.render();
      const status = game.status();
      statusEl.textContent = prompt || game.statusText(status);
      statusEl.classList.toggle('prompt', prompt !== null);
      document.body.dataset.status = status;
      timerEl.hidden = !settings.timer;
      timerEl.textContent = formatTime(clockMs());
    }

    function renderMenu() {
      for (const button of menuEl.querySelectorAll('[data-sound]')) {
        button.setAttribute('aria-checked', String(button.dataset.sound === settings.sound));
      }
      for (const button of menuEl.querySelectorAll('[data-switch]')) {
        button.setAttribute('aria-checked', String(button.dataset.switch === GAME));
      }
      for (const button of menuEl.querySelectorAll('[data-set-theme]')) {
        button.setAttribute('aria-checked', String(button.dataset.setTheme === settings.theme));
      }
      timerSwitch.setAttribute('aria-checked', String(settings.timer));
      dealNumberEl.textContent = game.dealNote();
      if (game.renderMenu) game.renderMenu();
    }

    function showOverlay(title, text, { canUndo = false } = {}) {
      overlayTitle.textContent = title;
      overlayText.textContent = text;
      overlayUndoBtn.hidden = !canUndo;
      overlayNewGameBtn.classList.toggle('primary', !canUndo);
      overlayEl.hidden = false;
    }

    function hideOverlay() {
      overlayEl.hidden = true;
    }

    // ---------- "Tap again" confirmations ----------

    // The first tap turns the button into "Tap again" for a moment; only a
    // second tap goes through. Returns true on the second tap.
    function confirmed(button, message, label = 'Tap again') {
      if (confirming === button) {
        endConfirm();
        return true;
      }
      endConfirm();
      confirming = button;
      const labelEl = button.querySelector('.label');
      button.dataset.label = labelEl.textContent;
      labelEl.textContent = label;
      button.classList.add('confirming');
      prompt = message;
      confirmTimer = setTimeout(() => {
        endConfirm();
        render();
      }, CONFIRM_MS);
      return false;
    }

    function endConfirm() {
      clearTimeout(confirmTimer);
      if (!confirming) return;
      confirming.querySelector('.label').textContent = confirming.dataset.label;
      confirming.classList.remove('confirming');
      confirming = null;
      prompt = null;
    }

    // ---------- After a move, a new game, a win or a loss ----------

    // After anything changes the game: timer, screen, save, and the end of the game.
    function changed({ quiet = false } = {}) {
      if (!inProgress()) stopClock();
      else if (game.moved()) startClock(); // the clock starts with the first move
      render();
      save();
      const status = game.status();
      const current = game.current();
      if (status === 'won') celebrate(current);
      else if (status === 'lost' && !quiet) {
        setTimeout(() => {
          if (current === game.current() && game.status() === 'lost') showLost({ womp: true });
        }, 450);
      }
    }

    function newGame() {
      endConfirm();
      hideOverlay();
      game.cancel();
      game.deal(nextDealNumber());
      clockBefore = 0;
      clockStarted = null;
      if (game.onDeal) game.onDeal();
      Sound.play('shuffle');
      if (paused) closeMenu();
      changed();
    }

    function showLost({ womp }) {
      if (womp) Sound.play('lose');
      showOverlay('No more moves', game.lostText(), { canUndo: game.moved() });
    }

    function celebrate(current) {
      celebrating = true;
      if (game.onWin) game.onWin();
      const kind = nextCelebration;
      nextCelebration = kind === 'cascade' ? 'confetti' : 'cascade';
      save();
      const time = settings.timer ? ` in ${formatTime(clockMs())}` : '';
      const cards = game.celebrationCards();
      setTimeout(() => {
        Celebrate.run(kind, cards).then(() => {
          celebrating = false;
          if (current === game.current()) showOverlay('You won!', game.wonText(time));
        });
      }, 350); // let the last card land first
    }

    // ---------- Menu and pause ----------

    function openMenu() {
      if (celebrating || paused) return;
      game.cancel();
      endConfirm();
      paused = true;
      stopClock();
      document.body.classList.add('paused');
      renderMenu();
      menuEl.hidden = false;
      void menuEl.offsetWidth; // so the slide-in animates
      menuEl.classList.add('open');
      render();
      save();
    }

    function closeMenu() {
      if (!paused) return;
      endConfirm();
      paused = false;
      document.body.classList.remove('paused');
      menuEl.classList.remove('open');
      setTimeout(() => {
        if (!paused) menuEl.hidden = true;
      }, 230);
      if (game.moved()) startClock();
      render();
    }

    // Opens another game. This one is saved first and comes back paused.
    function switchTo(id) {
      if (id === GAME || !GAMES.some((g) => g.id === id)) return;
      settings.lastGame = id;
      saveSettings();
      save();
      location.replace(pageUrl(id));
    }

    // ---------- Start ----------

    function start() {
      const saved = read(game.saveKey);
      if (saved) {
        const order = saved.dealOrder || {};
        if (Number.isInteger(order.seed) && Number.isInteger(order.next) && order.next >= 0) dealOrder = order;
        if (saved.nextCelebration === 'confetti') nextCelebration = 'confetti';
      }
      Sound.setStyle(settings.sound);
      if (saved && game.restore(saved.game)) clockBefore = Number.isFinite(saved.clock) ? saved.clock : 0;
      else game.deal(nextDealNumber());
      settings.lastGame = GAME;
      saveSettings();
      setInterval(showTime, 250);

      $('menu-button').addEventListener('click', openMenu);

      menuEl.addEventListener('click', (event) => {
        const target = event.target.closest('[data-action], [data-sound], [data-switch], [data-set-theme], #timer-switch');
        if (!target) return;
        if (target.dataset.action === 'resume') closeMenu();
        else if (target.dataset.action === 'new-game') {
          if (inProgress() && game.moved() && !confirmed(menuNewGameBtn, null, 'Tap again to start over')) return;
          newGame();
        } else if (target.dataset.sound) {
          settings.sound = target.dataset.sound;
          Sound.setStyle(settings.sound);
          Sound.play('move'); // a sample of the new sound
          renderMenu();
          saveSettings();
        } else if (target === timerSwitch) {
          settings.timer = !settings.timer;
          renderMenu();
          render();
          saveSettings();
        } else if (target.dataset.switch) {
          switchTo(target.dataset.switch);
        } else if (THEMES.some((t) => t.id === target.dataset.setTheme)) {
          settings.theme = target.dataset.setTheme;
          applyTheme();
          renderMenu();
          saveSettings();
        }
      });

      overlayEl.addEventListener('click', (event) => {
        const action = event.target.closest('[data-action]')?.dataset.action;
        if (action === 'undo') game.undo();
        else if (action === 'new-game') newGame();
        else if (action === 'close') hideOverlay();
      });

      document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        if (paused) closeMenu();
        else if (!overlayEl.hidden) hideOverlay();
        else openMenu();
      });

      // Leaving the app pauses it (and saves); the menu is waiting on return.
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) return;
        if (inProgress() && game.moved() && !paused && !celebrating) openMenu();
        else save();
      });
      window.addEventListener('pagehide', save);

      render();
      save();
      if (inProgress() && game.moved()) openMenu(); // a game in progress comes back paused
      else if (game.status() === 'lost') showLost({ womp: false });

      // Offline support. Browsers only allow this over https:// (or on localhost),
      // so it quietly does nothing when the page is opened another way.
      if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
        window.addEventListener('load', () => {
          navigator.serviceWorker.register(new URL('sw.js', ROOT).href).catch((error) => {
            console.warn('Offline support is unavailable:', error);
          });
        });
      }
    }

    return {
      settings,
      start,
      render,
      changed,
      confirmed,
      endConfirm,
      hideOverlay,
      saveSettings,
      setPrompt(text) {
        prompt = text;
      },
      get paused() {
        return paused;
      },
      get celebrating() {
        return celebrating;
      },
    };
  }

  window.Shell = { redirecting, create };
})();
