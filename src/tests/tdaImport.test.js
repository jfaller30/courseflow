// tests/tdaImport.test.js
import { describe, it, expect } from "vitest";
import { parseTdaEvidenceFromHtml } from "../tda/htmlEvidence";
import { TDA_FIXTURES } from "./tda_fixtures";

function sortArr(a) {
  return [...a].sort((x, y) => String(x).localeCompare(String(y)));
}

function setToSortedArray(maybeSet) {
  if (!maybeSet) return [];
  if (Array.isArray(maybeSet)) return sortArr(maybeSet);
  if (maybeSet instanceof Set) return sortArr([...maybeSet]);
  // defensive: allow object maps, etc.
  return sortArr(Object.keys(maybeSet));
}

function normalizeGeExpectation(geExpect) {
  // Allow partial assertions: user can provide only some keys.
  // We'll compare those keys only.
  return geExpect ?? null;
}

describe("parseTdaEvidenceFromHtml synthetic fixtures", () => {
  for (const fx of TDA_FIXTURES) {
    it(fx.name, () => {
      const ev = parseTdaEvidenceFromHtml(fx.html);

      // ---- passed / ip sets ----
      if (fx.expect.passed) {
        expect(setToSortedArray(ev.passed)).toEqual(sortArr(fx.expect.passed));
      }
      if (fx.expect.ip) {
        expect(setToSortedArray(ev.ip)).toEqual(sortArr(fx.expect.ip));
      }

      // ---- subs mapping ----
      if (fx.expect.subs) {
        expect(ev.subs ?? {}).toEqual(fx.expect.subs);
      }

      // ---- tech electives ----
      if (fx.expect.tech) {
        const tech = ev.tech ?? {};
        if (fx.expect.tech.completed) {
          expect(setToSortedArray(tech.completed)).toEqual(sortArr(fx.expect.tech.completed));
        }
        if (fx.expect.tech.ip) {
          expect(setToSortedArray(tech.ip)).toEqual(sortArr(fx.expect.tech.ip));
        }
      }

      // ---- GE ----
      const geExp = normalizeGeExpectation(fx.expect.ge);
      if (geExp) {
        const ge = ev.ge ?? {};
        if (typeof geExp.isModern === "boolean") {
          expect(ge.isModern).toBe(geExp.isModern);
        }
        if (geExp.items) {
          // compare only specified slots
          for (const [slot, expectedItem] of Object.entries(geExp.items)) {
            const actual = ge.items?.[slot];
            expect(actual).toBeTruthy();

            // Allow null code for CSU CERT case
            if ("code" in expectedItem) expect(actual.code ?? null).toBe(expectedItem.code ?? null);
            if ("status" in expectedItem) expect(actual.status).toBe(expectedItem.status);
            if ("note" in expectedItem) expect(actual.note ?? null).toBe(expectedItem.note ?? null);
          }
        }
      }
    });
  }
});
