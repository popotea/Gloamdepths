// ===== 簡易音效(WebAudio 合成,不需音檔) =====
const SFX = (() => {
  let ctx = null;
  function ac() {
    if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { } }
    if (ctx && ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function beep(freq, dur, type = 'square', vol = 0.08, slide = 0) {
    const c = ac(); if (!c) return;
    try {
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.value = freq;
      if (slide) o.frequency.linearRampToValueAtTime(freq + slide, c.currentTime + dur);
      g.gain.value = vol;
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
      o.connect(g); g.connect(c.destination);
      o.start(); o.stop(c.currentTime + dur);
    } catch (e) { }
  }
  return {
    unlock() { ac(); },
    mine()   { beep(180 + Math.random() * 60, 0.06, 'square', 0.05); },
    break_() { beep(120, 0.15, 'sawtooth', 0.08, -60); },
    hit()    { beep(260, 0.08, 'square', 0.07, -80); },
    hurt()   { beep(110, 0.25, 'sawtooth', 0.1, -40); },
    pickup() { beep(660, 0.08, 'sine', 0.07, 220); },
    craft()  { beep(440, 0.12, 'triangle', 0.09, 120); },
    place()  { beep(300, 0.08, 'triangle', 0.07); },
    eat()    { beep(500, 0.1, 'sine', 0.07, -150); },
    deposit(){ beep(520, 0.15, 'sine', 0.09, 260); },
    shoot()  { beep(880, 0.07, 'sine', 0.06, -300); },
    boom()   { beep(70, 0.4, 'sawtooth', 0.14, -30); },
    wave()   { beep(90, 0.6, 'sawtooth', 0.12, 30); },
    win()    { beep(523, 0.15, 'triangle', 0.1); setTimeout(() => beep(659, 0.15, 'triangle', 0.1), 150); setTimeout(() => beep(784, 0.3, 'triangle', 0.1), 300); },
    lose()   { beep(220, 0.3, 'sawtooth', 0.1, -80); setTimeout(() => beep(160, 0.5, 'sawtooth', 0.1, -60), 250); },
  };
})();
