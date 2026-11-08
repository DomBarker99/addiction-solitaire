/*
 * Service worker: lets the installed app open without internet.
 *
 * When installed it saves a copy of every file below. After that, each request
 * tries the network first, so updates show up right away, and falls back to
 * the saved copy when there is no connection or the network takes more than
 * 3 seconds.
 *
 * If you add or rename a file, add it to FILES and change VERSION.
 */
const VERSION = 'v3';
const CACHE = `addiction-${VERSION}`;
const FILES = [
  './',
  'index.html',
  'style.css',
  'addiction.css',
  'shell.js',
  'cards.js',
  'game.js',
  'deals.js',
  'audio.js',
  'celebrate.js',
  'ui.js',
  'klondike/',
  'klondike/index.html',
  'klondike/style.css',
  'klondike/rules.js',
  'klondike/ui.js',
  'manifest.json',
  'sounds/card-1.wav',
  'sounds/card-2.wav',
  'sounds/card-3.wav',
  'sounds/card-4.wav',
  'sounds/wood-1.wav',
  'sounds/wood-2.wav',
  'sounds/wood-3.wav',
  'sounds/wood-4.wav',
  'sounds/riffle.wav',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];
const NETWORK_TIMEOUT_MS = 3000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(FILES))
      .then(() => self.skipWaiting()),
  );
});

// Throw away copies saved by older versions. Only this app's own copies: all
// of a GitHub account's Pages sites share one web address and so one set of
// saved copies, and another site's offline copy isn't ours to delete.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key.startsWith('addiction-') && key !== CACHE).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(networkFirst(request));
});

function fromCache(request) {
  return caches
    .match(request, { ignoreSearch: true })
    .then((hit) => hit || (request.mode === 'navigate' ? caches.match('index.html') : undefined));
}

function networkFirst(request) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (response) => {
      if (done || !response) return;
      done = true;
      resolve(response);
    };

    // Slow network: answer from the saved copy instead of making her wait.
    const timer = setTimeout(() => fromCache(request).then(finish), NETWORK_TIMEOUT_MS);

    fetch(request.url, { cache: 'no-cache' })
      .then((response) => {
        clearTimeout(timer);
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        finish(response);
      })
      .catch(() => {
        clearTimeout(timer);
        fromCache(request).then((hit) => finish(hit || Response.error()));
      });
  });
}
