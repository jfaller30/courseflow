// src/tests/checkPlan.test.js
import { describe, it, expect } from "vitest";
import { checkPlan } from "../graph/checkPlan";

describe("Check button logic (checkPlan) — EGCP", () => {
  it("flags missing prereqs, same-term prereqs, and offering mismatch", () => {
    const map = {
      A: { id: "A", code: "EGEC 451", prereqs: ["B", "D"], coreqs: [], offering: "Spring Only" },
      B: { id: "B", code: "CPSC 131", prereqs: [], coreqs: [], offering: "" },       // will be missing
      D: { id: "D", code: "EGEC 280", prereqs: [], coreqs: [], offering: "" },       // will be same-term prereq
      C: { id: "C", code: "EGEC 446", prereqs: [], coreqs: [], offering: "Spring Only" },
    };

    // insertion order matters for output order
    const labels = {
      A: "Fall",  // course scheduled
      D: "Fall",  // satisfied prereq, but same-term
      C: "Fall",  // offering mismatch (Spr Only)
      // B intentionally omitted => missing prereq
    };

    const problems = checkPlan({ labels, map });

    expect(problems).toEqual([
        "EGEC 451: missing prereq(s) → CPSC 131",
        'EGEC 451: prereq EGEC 280 is also labeled "Fall"',
        'EGEC 451: labeled "Fall" but offering is "Spring Only"',
        'EGEC 446: labeled "Fall" but offering is "Spring Only"'
    ]);
  });

  it("does not enforce offering constraints for In Prog./Com. College/__strike__", () => {
    const map = {
      X: { id: "X", code: "EGEC 350", prereqs: [], coreqs: [], offering: "Fall Only" },
    };

    const labels = {
      X: "In Prog.", // offering check should be skipped
    };

    const problems = checkPlan({ labels, map });
    expect(problems).toEqual([]);
  });
});

describe("Check button logic (checkPlan) — CPEI", () => {
  it("allows satisfied prereqs and permits struck prereqs as satisfied", () => {
    const map = {
      G1: { id: "G1", code: "EGEC 471", prereqs: ["G0"], coreqs: [], offering: "Spring Only" },
      G0: { id: "G0", code: "EGEC 450", prereqs: [], coreqs: [], offering: "Fall Only" },
      Z:  { id: "Z",  code: "EGEC 595", prereqs: ["G0"], coreqs: [], offering: "Fall Only" },
    };

    const labels = {
      G0: "Fall",
      G1: "Spr",        // prereq satisfied and not same-term
      Z: "__strike__",  // struck courses skip offering and are treated as satisfied when referenced
    };

    const problems = checkPlan({ labels, map });
    expect(problems).toEqual([]);
  });
});
