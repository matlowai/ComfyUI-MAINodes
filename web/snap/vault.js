// The vault on the page (U79): a private take on an install with privacy on is kept encrypted with its recipe inside;
// its lock badge says so ("🔒 kept encrypted", "(locked)" while the vault is), and a click opens the vault sheet: unlock
// with the passphrase (behind snap-gate the sign-in password, which unlocks it at sign-in anyway), set the vault up on a
// solo install, make a recovery key (shown once, kept nowhere), and the honest limits. Nothing here works where privacy
// is off: the server answers {vault: "off"} and the badge stays the plain private lock (SNAP-R37).
// SNAP-R96 kept encrypted at its own path · SNAP-R97 reading needs the key, lock forgets · SNAP-R99 a lost passphrase:
// an admin or the recovery key, else lost, said before asking · see docs/snap/SNAP_RULES.md
import { api } from "../../../scripts/api.js";
import * as T from "./takes.js";

const h = (tag, props = {}, ...kids) => { const el = Object.assign(document.createElement(tag), props); el.append(...kids.flat().filter((k) => k != null)); return el; };
const LOSS = "If you lose your passphrase and there is no admin and no recovery key, your private takes are gone for good.";
let known = null;

export async function status() {
  const r = await api.fetchApi("/mainodes/snap/vault/status");
  known = r.ok ? await r.json() : { vault: "off" };
  return known;
}
const post = async (what, body = {}) => (await api.fetchApi(`/mainodes/snap/vault/${what}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();

// the words a private take's lock says
export function badgeText(t) {
  if (!t.kept_encrypted) return { text: "🔒 private", title: `Private take (it loads a private file or has a Cast LoRA row on): exports leave it out${t.metadata === false ? "; its files were saved without the recipe inside" : ""}` };
  return t.locked
    ? { text: "🔒 kept encrypted (locked)", title: "Saved encrypted with its full recipe. The vault is locked: click to unlock (or sign in) and see it." }
    : { text: "🔒 kept encrypted", title: `Saved encrypted with its full recipe${t.metadata === false ? " (Save metadata was off: no recipe in its files)" : ""}; exports leave it out unless you include it. Click for the vault.` };
}
export function badge(t) {
  const { text, title } = badgeText(t);
  const el = h("span", { className: "snap-take-lock", textContent: text, title });
  if (t.kept_encrypted) Object.assign(el, { role: "button", tabIndex: 0, onclick: (e) => { e.stopPropagation(); open(el); } });
  return el;
}

// the vault sheet, over the Snap view the badge sits in
export async function open(from) {
  const host = from?.closest(".snap-root") ?? document.querySelector(".snap-root") ?? document.body;
  const s = await status();
  const close = () => { sheet.remove(); };
  const say = h("p", { className: "snap-quiet", role: "status" });
  const pass = h("input", { type: "password", placeholder: "passphrase", autocomplete: "current-password" });
  const body = h("div", { className: "snap-vault-body" });
  const done = async (r) => {
    if (r.error) { say.textContent = r.error; return; }
    await T.reopen();
    close();
  };
  if (s.vault === "locked") {
    body.append(h("p", { textContent: "Your private takes are kept encrypted, and the vault is locked." }), pass,
      h("button", { className: "snap-primary", textContent: "Unlock", onclick: async () => done(await post("unlock", { passphrase: pass.value })) }));
  } else if (s.vault === "none") {
    const again = h("input", { type: "password", placeholder: "the passphrase again", autocomplete: "new-password" });
    const rec = h("input", { type: "checkbox" });
    body.append(h("p", { textContent: "Private takes on this install are saved encrypted with their full recipe. Choose the passphrase that opens them." }), pass, again,
      h("label", {}, rec, " Make a recovery key too (shown once; write it down)"), h("p", { className: "snap-quiet", textContent: LOSS }),
      h("button", { className: "snap-primary", textContent: "Set up the vault", onclick: async () => {
        if (pass.value !== again.value) { say.textContent = "The two passphrases differ."; return; }
        const r = await post("setup", { passphrase: pass.value, recovery: rec.checked });
        if (r.recovery_key) body.replaceChildren(h("p", { textContent: r.said }), h("pre", { className: "snap-vault-key", textContent: r.recovery_key }), h("button", { className: "snap-primary", textContent: "I wrote it down", onclick: () => done(r) }));
        else done(r);
      } }));
  } else if (s.vault === "unlocked") {
    body.append(h("p", { textContent: "The vault is unlocked: your private takes open here, and they stay encrypted on disk." }),
      s.recovery ? h("p", { className: "snap-quiet", textContent: "You have a recovery key." }) : h("button", { className: "snap-primary", textContent: "Make a recovery key", onclick: async () => {
        const r = await post("recovery_key");
        if (r.error) { say.textContent = r.error; return; }
        body.replaceChildren(h("p", { textContent: r.said }), h("pre", { className: "snap-vault-key", textContent: r.recovery_key }), h("button", { className: "snap-primary", textContent: "I wrote it down", onclick: close }));
      } }),
      s.escrow?.length ? h("p", { className: "snap-quiet", textContent: `An admin can reset your passphrase (${s.escrow.length} admin${s.escrow.length === 1 ? "" : "s"}).` }) : h("p", { className: "snap-quiet", textContent: LOSS }),
      h("button", { className: "snap-primary", textContent: "Lock now", onclick: async () => { await post("lock"); await T.reopen(); close(); } }));
  } else {
    body.append(h("p", { textContent: "This install doesn't keep private takes encrypted." }));
  }
  const sheet = h("div", { className: "snap-sheet snap-vault-sheet", role: "dialog", ariaLabel: "Vault" },
    h("header", {}, h("b", { textContent: "🔒 Vault" }), h("span", { className: "snap-spacer" }), h("button", { className: "snap-x", textContent: "×", title: "close (Esc)", onclick: close })),
    body, say, s.limits ? h("p", { className: "snap-quiet snap-vault-limits", textContent: s.limits }) : null);
  sheet.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Escape") close(); if (e.key === "Enter" && e.target === pass) body.querySelector(".snap-primary")?.click(); });
  host.append(sheet);
  pass.focus();
  return sheet;
}
