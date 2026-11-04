// The signed-in account on a snap-gate install (U77): who is signed in and their rating cap, from the gate's GET /gate/me
// (any other answer: no gate, and Snap shows nothing), with a sign-out link. When the gate locks an idle session it
// answers 401 {locked: true}; Snap then shows a small "Locked: sign in again" card over the page, which keeps all its
// work: signing in happens in a small window, and the card goes once the gate answers again.
// SNAP-R34 the account in the top bar, the lock keeps the page · see docs/SNAP_RULES.md
import { api } from "../../../scripts/api.js";

const SHOWN = { pg: "PG", mature: "Mature", adult: "Adult" };
let me = null, lockedCard = null, popup = null, onLock = () => {};

export async function load() {
  const r = await fetch("/gate/me", { credentials: "same-origin", cache: "no-store" });
  me = r.ok ? await r.json() : null;
  return me;
}
export const account = () => me;
export const capShown = () => (me ? SHOWN[me.max_rating] ?? me.max_rating : null);
// a cap below Adult: the gate already hides what is above it, so Snap doesn't ask about SFW only
export const belowAdult = () => !!me && me.max_rating !== "adult";

// every request the page makes goes through api.fetchApi: a 401 that says locked shows the card (installed only behind a gate)
export function watchLock(show) {
  onLock = show;
  const fetchApi = api.fetchApi.bind(api);
  api.fetchApi = async (...args) => {
    const r = await fetchApi(...args);
    if (r.status === 401) r.clone().json().then((j) => j?.locked && locked(), () => {});
    return r;
  };
}

function locked() {
  if (lockedCard) return;
  lockedCard = onLock({
    signIn: () => { popup = window.open(`/gate/login?idle=1&next=${encodeURIComponent("/gate/me")}`, "snap-sign-in", "width=440,height=560"); },
  });
  // the card asks the gate again every few seconds while it shows: 401 until the person signs in, then it goes
  const check = setInterval(async () => {
    if (!(await load())) return;
    clearInterval(check);
    popup?.close();
    lockedCard.remove();
    lockedCard = null;
  }, 3000);
}
