// One spring integrator for everything that settles in the Snap view (UX_SPEC section 3).
// Parametrized like Apple's springs: response (s) and damping ratio; mass 1, so k = (2π/response)², c = 4πζ/response.
// Fixed 1/120 s substeps; retargeting keeps velocity, so every motion can be interrupted by a hand.

export const SPRINGS = {
  drop: { response: 0.35, damping: 1 },
  throw: { response: 0.3, damping: 0.8 },
  reflow: { response: 0.3, damping: 1 },
  shadow: { response: 0.15, damping: 0.86 },
  view: { response: 0.3, damping: 1 }, // reads as done by ~320 ms (UX_SPEC 5); the survey's 0.5 s settled at ~950 ms
  fade: { response: 0.1, damping: 1 },  // reduced motion: the view switch is a ~150 ms cross-fade, nothing flies
};

const reduced = matchMedia("(prefers-reduced-motion: reduce)");
export const reducedMotion = () => reduced.matches;
const STEP = 1 / 120, MAX_DT = 0.25; // past MAX_DT (a hidden tab's paused frames) a spring resumes instead of jumping

// a spring over a flat array of numbers (x, y, scale... animated together so they arrive together)
// `eps` is the rest precision per axis in that axis' units: 0.5 for pixels, ~0.002 for opacity or scale
export class Spring {
  constructor(value, params = SPRINGS.drop, eps = 0.5) {
    this.eps = value.map((_, i) => (Array.isArray(eps) ? eps[i] : eps));
    this.x = [...value];
    this.v = this.x.map(() => 0);
    this.to = [...value];
    this.tune(params);
  }

  tune({ response, damping }) {
    if (reducedMotion()) { response = Math.min(response, 0.2); damping = 1; }
    this.k = (2 * Math.PI / response) ** 2;
    this.c = 4 * Math.PI * damping / response;
  }

  // retarget mid-flight; velocity (units/s) is kept unless given (a throw hands over the pointer's velocity)
  set(to, { velocity, params } = {}) {
    this.to = [...to];
    if (velocity) this.v = [...velocity];
    if (params) this.tune(params);
  }

  jump(to) { this.x = [...to]; this.to = [...to]; this.v = this.v.map(() => 0); }

  // advance dt seconds; true when at rest on every axis (distance < eps and speed < 4·eps per second). A long frame
  // advances by its real time up to MAX_DT, so a busy machine slows a switch less (G6, F-M02: with a 64 ms cap a 300 ms
  // switch read ~480 ms under full CPU load, ~400 ms with this); fixed substeps keep any dt stable
  step(dt) {
    for (let t = Math.min(dt, MAX_DT); t > 1e-6; t -= STEP) {
      const h = Math.min(STEP, t);
      for (let i = 0; i < this.x.length; i++) {
        const a = -this.k * (this.x[i] - this.to[i]) - this.c * this.v[i];
        this.v[i] += a * h;
        this.x[i] += this.v[i] * h;
      }
    }
    const rest = this.x.every((x, i) => Math.abs(this.v[i]) < 4 * this.eps[i] && Math.abs(x - this.to[i]) < this.eps[i]);
    if (rest) this.jump(this.to);
    return rest;
  }
}

// one rAF loop for all running springs; each entry calls `apply(values)` per frame and `done()` at rest
const running = new Map();
let last = 0, frame = 0;

function tick(now) {
  const dt = last ? (now - last) / 1000 : 1 / 60;
  last = now;
  for (const [key, a] of running) {
    try {
      const rest = a.spring.step(dt);
      a.apply(a.spring.x);
      if (rest) { running.delete(key); a.done?.(); }
    } catch (e) { // one broken callback must not stop every other animation
      running.delete(key);
      reportError(e);
    }
  }
  frame = running.size ? requestAnimationFrame(tick) : (last = 0);
}

export function animate(key, spring, apply, done) {
  running.set(key, { spring, apply, done });
  if (!frame) frame = requestAnimationFrame(tick);
}

export function stop(key) { running.delete(key); }

// where a throw would come to rest with UIScrollView's normal deceleration (0.998 per ms)
export const project = (pos, velocity) => pos + (velocity / 1000) * 0.998 / (1 - 0.998);
