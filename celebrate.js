/*
 * Win celebrations, drawn on a full-screen <canvas> laid over the game:
 *   'cascade'  - cards jump off the board one after another and bounce away,
 *                leaving trails, like classic Windows Solitaire.
 *   'confetti' - two bursts of confetti from the bottom corners, then a shower.
 * ui.js alternates between them. A tap skips to the end.
 *
 *   Celebrate.run('cascade', [{ card, el }, ...]).then(() => ...)
 */
(() => {
  'use strict';

  const G = window.Addiction;
  const STEP = 1000 / 60; // physics runs at 60 steps a second on any screen

  // Suit shapes, the same drawings as the sprites in index.html (100x100 box).
  const SUIT_PATHS = {
    spades:
      'M50 5C44 20 8 41 8 62c0 14 11 22 22 22 8 0 14-4 17-9-1 9-5 15-13 20h32c-8-5-12-11-13-20 3 5 9 9 17 9 11 0 22-8 22-22C92 41 56 20 50 5Z',
    hearts:
      'M50 90C46 86 9 61 5 37 2 19 14 7 29 7c10 0 17 6 21 15 4-9 11-15 21-15 15 0 27 12 24 30C91 61 54 86 50 90Z',
    diamonds: 'M50 4c9 17 21 32 36 46-15 14-27 29-36 46-9-17-21-32-36-46C29 36 41 21 50 4Z',
    clubs:
      'M50 8a19 19 0 1 1 0 38a19 19 0 1 1 0-38ZM27 38a19 19 0 1 1 0 38a19 19 0 1 1 0-38Z' +
      'M73 38a19 19 0 1 1 0 38a19 19 0 1 1 0-38ZM50 38a12 12 0 1 1 0 24a12 12 0 1 1 0-24Z' +
      'M47 55c0 18-5 31-13 40h32c-8-9-13-22-13-40Z',
  };

  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // A full-screen canvas. Tapping it ends the celebration early.
  function makeLayer() {
    const canvas = document.createElement('canvas');
    canvas.className = 'celebration';
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    document.body.append(canvas);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    return { canvas, ctx, width, height, dpr };
  }

  // Runs `step` 60 times a second and `draw` once per screen frame until
  // `step` returns false, the time limit passes, or the player taps.
  function animate(layer, { step, draw, maxMs }) {
    return new Promise((resolve) => {
      let last = performance.now();
      const start = last;
      let backlog = 0;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        layer.canvas.classList.add('fade');
        setTimeout(() => {
          layer.canvas.remove();
          resolve();
        }, 450);
      };
      layer.canvas.addEventListener('pointerdown', finish);
      const frame = (now) => {
        if (done) return;
        backlog += Math.min(now - last, 100);
        last = now;
        let more = true;
        while (backlog >= STEP && more) {
          more = step();
          backlog -= STEP;
        }
        draw();
        if (!more || now - start > maxMs) finish();
        else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  }

  // A picture of one card, drawn once and reused every frame.
  function cardPicture(card, width, height, dpr) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(width * dpr);
    canvas.height = Math.ceil(height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const radius = Math.min(7, height / 6);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(0.5, 0.5, width - 1, height - 1, radius);
    else ctx.rect(0.5, 0.5, width - 1, height - 1);
    ctx.fillStyle = '#fffdf7';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.stroke();

    const suit = G.SUITS[G.suitOf(card)];
    ctx.fillStyle = suit.red ? '#c41e3a' : '#1d1d1f';
    const size = Math.round(Math.min(height * 0.52, width * 0.36));
    ctx.font = `700 ${size}px system-ui, -apple-system, Roboto, 'Helvetica Neue', Arial, sans-serif`;
    ctx.textBaseline = 'middle';
    const label = G.rankLabel(card);
    const labelWidth = ctx.measureText(label).width;
    const suitSize = size * 0.9;
    const gap = size * 0.12;
    const x = (width - (labelWidth + gap + suitSize)) / 2;
    ctx.fillText(label, x, height / 2 + size * 0.05);
    ctx.save();
    ctx.translate(x + labelWidth + gap, height / 2 - suitSize / 2);
    ctx.scale(suitSize / 100, suitSize / 100);
    ctx.fill(new Path2D(SUIT_PATHS[suit.name]));
    ctx.restore();
    return canvas;
  }

  // ---------- Bouncing cards ----------

  function cascade(cards) {
    const layer = makeLayer();
    const { ctx, width, height, dpr } = layer;
    const scale = height / 800; // so it looks the same on small and big screens
    const gravity = 0.55 * scale;
    // Kings leave first, then Queens, and so on up the columns.
    const queue = cards
      .map(({ card, el }) => {
        const face = el.querySelector('.face') || el;
        return { card, el, rect: face.getBoundingClientRect() };
      })
      .sort((a, b) => b.rect.top - a.rect.top || a.rect.left - b.rect.left);
    const flying = [];
    let tick = 0;

    const launch = () => {
      const { card, el, rect } = queue.shift();
      el.style.visibility = 'hidden';
      const direction = Math.random() < 0.5 ? -1 : 1;
      flying.push({
        picture: cardPicture(card, rect.width, rect.height, dpr),
        x: rect.left,
        y: rect.top,
        w: rect.width,
        h: rect.height,
        vx: direction * (2.5 + Math.random() * 4.5) * scale * 1.4,
        vy: -(2 + Math.random() * 7) * scale,
      });
    };

    return animate(layer, {
      maxMs: 12000,
      step() {
        if (queue.length && tick % 7 === 0) launch(); // a new card every ~0.12 s
        tick++;
        for (const c of flying) {
          c.vy += gravity;
          c.x += c.vx;
          c.y += c.vy;
          if (c.y + c.h > height) {
            c.y = height - c.h;
            c.vy = -c.vy * 0.78;
          }
        }
        for (let i = flying.length - 1; i >= 0; i--) {
          const c = flying[i];
          if (c.x > width || c.x + c.w < 0) flying.splice(i, 1);
        }
        return queue.length > 0 || flying.length > 0;
      },
      draw() {
        // No clearing: every frame leaves a copy behind, which makes the trails.
        for (const c of flying) ctx.drawImage(c.picture, c.x, c.y, c.w, c.h);
      },
    });
  }

  // ---------- Confetti ----------

  const COLORS = ['#ffd54a', '#ffffff', '#e5484d', '#4aa3ff', '#7be08a', '#ff8fc7', '#b38cff'];

  function confetti() {
    const layer = makeLayer();
    const { ctx, width, height } = layer;
    const scale = height / 800;
    const pieces = [];
    const piece = (x, y, vx, vy) =>
      pieces.push({
        x,
        y,
        vx,
        vy,
        size: (6 + Math.random() * 6) * Math.max(scale, 0.8),
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        spin: Math.random() * Math.PI * 2,
        spinSpeed: (Math.random() - 0.5) * 0.3,
        flutter: Math.random() * Math.PI * 2,
      });
    // Two bursts from the bottom corners...
    for (let i = 0; i < 110; i++) {
      const left = i % 2 === 0;
      piece(
        left ? width * 0.04 : width * 0.96,
        height * 0.92,
        (left ? 1 : -1) * (2 + Math.random() * 7) * scale * 1.3,
        -(9 + Math.random() * 9) * scale,
      );
    }
    let tick = 0;

    return animate(layer, {
      maxMs: 6500,
      step() {
        tick++;
        // ...then a shower from the top.
        if (tick > 30 && tick < 120 && tick % 2 === 0) {
          piece(Math.random() * width, -20, (Math.random() - 0.5) * 2 * scale, (1 + Math.random() * 2) * scale);
        }
        for (const p of pieces) {
          p.vy += 0.22 * scale;
          p.vx *= 0.985;
          p.vy *= 0.985;
          p.x += p.vx + Math.sin(p.flutter) * 0.6;
          p.y += p.vy;
          p.spin += p.spinSpeed;
          p.flutter += 0.12;
        }
        for (let i = pieces.length - 1; i >= 0; i--) if (pieces[i].y > height + 30) pieces.splice(i, 1);
        return pieces.length > 0 || tick < 120;
      },
      draw() {
        ctx.clearRect(0, 0, width, height);
        for (const p of pieces) {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.spin);
          ctx.scale(1, Math.cos(p.flutter)); // tumbling
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size * 0.3, p.size, p.size * 0.6);
          ctx.restore();
        }
      },
    });
  }

  window.Celebrate = {
    // kind: 'cascade' or 'confetti'. cards: [{ card, el }] for the cascade.
    // Resolves when the animation is over; hidden cards are shown again.
    run(kind, cards) {
      if (reducedMotion()) return Promise.resolve();
      const done = kind === 'cascade' ? cascade(cards) : confetti();
      return done.then(() => {
        for (const { el } of cards) el.style.visibility = '';
      });
    },
  };
})();
