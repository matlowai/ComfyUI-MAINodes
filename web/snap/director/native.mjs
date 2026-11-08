// SNAP-R19: compose new tools before tools.js constructs its name map; never append afterward. · SNAP-R272 native planning.
import { api } from "../../../../scripts/api.js";
import * as W from "../world.js";
import * as I from "../instructions.js";
import * as S from "../slots.js";
import * as P from "../proposals.js";
import * as T from "../takes.js";
import * as ACC from "../account.js";
import { createNativeHost } from "./host.mjs";
import { createDirectorService } from "./service.mjs";

export function directorTools(getTools) {
  // getTools is a lazy callback: TOOLS is still in its temporal dead zone during composition.
  return createDirectorService(createNativeHost({ api, W, I, S, P, T, ACC,
    fetch: (...args) => globalThis.fetch(...args), origin: globalThis.location.origin,
    catalogueURL: new URL("./strategies.json", import.meta.url).href, getTools }));
}
