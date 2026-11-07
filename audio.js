/*
 * Sounds: a card slide or a wood knock when a card moves, a riffle when the
 * cards are dealt or shuffled, and a sad trombone when the game is lost.
 *
 * The card and wood clips in sounds/ come from Kenney (kenney.nl), "Casino
 * Audio" and "Impact Sounds", released as CC0 (public domain). The trombone is
 * generated in code below.
 *
 * Phones only allow sound after the first touch, so the audio system is
 * started ("unlocked") on the first tap. ui.js just calls Sound.play('move').
 */
(() => {
  'use strict';

  const CLIPS = {
    card: { files: ['sounds/card-1.wav', 'sounds/card-2.wav', 'sounds/card-3.wav', 'sounds/card-4.wav'], volume: 1 },
    wood: { files: ['sounds/wood-1.wav', 'sounds/wood-2.wav', 'sounds/wood-3.wav', 'sounds/wood-4.wav'], volume: 1 },
    riffle: { files: ['sounds/riffle.wav'], volume: 0.9 },
  };

  let style = 'card'; // 'off', 'wood' or 'card'
  let ctx = null; // the Web Audio context, created on the first tap
  let master = null;
  const raw = {}; // clip name -> downloaded file data, fetched straight away
  const decoded = {}; // clip name -> sounds ready to play

  // Download the clips now (no sound needs to play for that). A page opened
  // straight from a file (file://) isn't allowed to download them, so it skips
  // this and uses plain <audio> tags instead (see playWithAudioTag).
  const canDownload = location.protocol !== 'file:';
  for (const [name, clip] of Object.entries(CLIPS)) {
    raw[name] = Promise.all(
      clip.files.map((file) =>
        canDownload
          ? fetch(file)
              .then((response) => (response.ok ? response.arrayBuffer() : null))
              .catch(() => null)
          : null,
      ),
    );
  }

  function unlock() {
    if (!ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.8;
      master.connect(ctx.destination);
      for (const name of Object.keys(CLIPS)) {
        decoded[name] = raw[name].then((datas) =>
          Promise.all(
            datas.map((data) =>
              data
                ? new Promise((resolve) => ctx.decodeAudioData(data, resolve, () => resolve(null)))
                : null,
            ),
          ).then((buffers) => buffers.filter(Boolean)),
        );
      }
    }
    if (ctx.state === 'suspended') ctx.resume();
  }
  for (const type of ['pointerdown', 'touchend', 'keydown']) {
    window.addEventListener(type, unlock, { capture: true, passive: true });
  }

  const pick = (list) => list[Math.floor(Math.random() * list.length)];

  function playClip(name, rate = 1) {
    const clip = CLIPS[name];
    if (!ctx) return playWithAudioTag(clip);
    decoded[name].then((buffers) => {
      if (!buffers.length) return playWithAudioTag(clip);
      const source = ctx.createBufferSource();
      source.buffer = pick(buffers);
      source.playbackRate.value = rate;
      const gain = ctx.createGain();
      gain.gain.value = clip.volume;
      source.connect(gain).connect(master);
      source.start();
    });
  }

  // Fallback when Web Audio can't load the files (for example file:// on a Mac).
  function playWithAudioTag(clip) {
    const audio = new Audio(pick(clip.files));
    audio.volume = Math.min(1, clip.volume * 0.8);
    audio.play().catch(() => {});
  }

  // "Womp womp womp wommmp": four falling trombone notes, the last one wobbling
  // and sagging. A sawtooth through a resonant low-pass filter that opens and
  // closes on each note imitates a trombone with a plunger mute.
  function womp() {
    if (!ctx) return;
    const out = ctx.createGain();
    out.gain.value = 0.55;
    out.connect(master);
    const notes = [
      { f: 233.1, len: 0.42 }, // B flat
      { f: 220.0, len: 0.42 }, // A
      { f: 207.7, len: 0.42 }, // A flat
      { f: 196.0, len: 1.55, last: true }, // G, held
    ];
    let t = ctx.currentTime + 0.05;
    for (const n of notes) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(n.f * 1.03, t); // slide into the note
      osc.frequency.exponentialRampToValueAtTime(n.f, t + 0.06);

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 7;
      filter.frequency.setValueAtTime(250, t);
      filter.frequency.exponentialRampToValueAtTime(1300, t + 0.09);
      filter.frequency.exponentialRampToValueAtTime(420, t + (n.last ? 0.9 : 0.34));

      const amp = ctx.createGain();
      amp.gain.setValueAtTime(0.0001, t);
      amp.gain.exponentialRampToValueAtTime(0.5, t + 0.03);
      amp.gain.setValueAtTime(0.5, t + n.len - 0.12);
      amp.gain.exponentialRampToValueAtTime(0.0001, t + n.len);

      if (n.last) {
        const lfo = ctx.createOscillator(); // the wobble
        const depth = ctx.createGain();
        lfo.frequency.value = 5.2;
        depth.gain.setValueAtTime(0, t);
        depth.gain.linearRampToValueAtTime(6, t + 0.35);
        lfo.connect(depth).connect(osc.frequency);
        lfo.start(t);
        lfo.stop(t + n.len);
        osc.frequency.setValueAtTime(n.f, t + n.len - 0.45); // the sag at the end
        osc.frequency.exponentialRampToValueAtTime(n.f * 0.94, t + n.len);
      }

      osc.connect(filter).connect(amp).connect(out);
      osc.start(t);
      osc.stop(t + n.len + 0.02);
      t += n.len + 0.05;
    }
  }

  // kind: 'move', 'shuffle' or 'lose'. Does nothing when sound is off.
  function play(kind) {
    if (style === 'off') return;
    if (kind === 'move') playClip(style, 0.96 + Math.random() * 0.08);
    else if (kind === 'shuffle') playClip('riffle');
    else if (kind === 'lose') womp();
  }

  window.Sound = {
    play,
    setStyle(value) {
      style = value;
    },
  };
})();
