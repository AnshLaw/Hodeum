// Gate 2 check: is Hodeum's highlight on the control UIA says it should be?
//   node cdp.mjs overlay > overlay.json
//   powershell -File uia-find.ps1 -Window '^Settings$' -Name '^Colors$' > uia.json
//   node compare.mjs overlay.json uia.json [maxErrorPx=10]
// Both files hold physical screen px. Precise highlights must match every edge within maxErrorPx;
// broad highlights (padded on purpose) must contain the element. Exit 0 = pass, 1 = fail.
import { readFileSync } from "node:fs";

const DEFAULT_MAX_ERROR_PX = 10;
const read = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
const [overlayPath, uiaPath, maxArg] = process.argv.slice(2);
if (!overlayPath || !uiaPath) {
  console.error("usage: node compare.mjs <overlay.json> <uia.json> [maxErrorPx]");
  process.exit(2);
}
const maxError = Number(maxArg ?? DEFAULT_MAX_ERROR_PX);
const overlay = read(overlayPath);
const uia = read(uiaPath);
const elements = Array.isArray(uia.elements) ? uia.elements : [uia.elements];
const highlights = (overlay?.primitives ?? []).filter((p) => p.kind === "highlight");
if (!highlights.length) {
  console.log(JSON.stringify({ pass: false, reason: "Hodeum drew no highlight", overlay }));
  process.exit(1);
}

const edges = (r) => ({ left: r.x, top: r.y, right: r.x + r.width, bottom: r.y + r.height });
function edgeError(a, b) {
  const [ea, eb] = [edges(a), edges(b)];
  return Math.max(...["left", "top", "right", "bottom"].map((k) => Math.abs(ea[k] - eb[k])));
}
const contains = (outer, inner) => {
  const [o, i] = [edges(outer), edges(inner)];
  return o.left <= i.left && o.top <= i.top && o.right >= i.right && o.bottom >= i.bottom;
};

const results = highlights.map((h) => {
  const scored = elements.map((e) => ({ element: e.name, bounds: e.bounds, errorPx: edgeError(h.bounds, e.bounds), contained: contains(h.bounds, e.bounds) }));
  const best = scored.sort((x, y) => x.errorPx - y.errorPx)[0];
  const pass = h.emphasis === "precise" ? best.errorPx <= maxError : best.contained;
  return { label: h.label, emphasis: h.emphasis, highlight: h.bounds, best, pass };
});
const pass = results.every((r) => r.pass);
console.log(JSON.stringify({ pass, maxErrorPx: maxError, results }, null, 2));
process.exit(pass ? 0 : 1);
