import { describe, it, expect } from "vitest";
import { parseGeFromTda } from "../tda/geParser";

// Build a minimal TDA text blob that geParser can slice.
// IMPORTANT: use headers that match the regexes in geParser.js
function mkModernTdaText({ sec3uRows = [], secZRows = [] } = {}) {
  return [
    "CATALOG YEAR Fall 2024",
    "",
    "GE 3U EXPLORATIONS IN ARTS/HUMANITIES",
    ...sec3uRows,
    "",
    "GE AREA Z: CULTURAL DIVERSITY",
    ...secZRows,
    "",
    "GE 6 ETHNIC STUDIES", // boundary header so slicing stops
    ""
  ].join("\n");
}

describe("parseGeFromTda: 3U/Z merge + advisor-review note", () => {
  it("3U complete, Z missing => tentative with note '3U=<course>; Z=Needed'", () => {
    const txt = mkModernTdaText({
      sec3uRows: ["FA24 MUS 355 3.0 A"],
      secZRows: [],
    });

    const ge = parseGeFromTda(txt);
    const rec = ge.items["3U/Z"];

    expect(ge.isModern).toBe(true);
    expect(rec.status).toBe("tentative");
    expect(rec.code).toBe("MUS 355");
    expect(rec.note).toBe("3U=MUS 355; Z=Needed");
  });

  it("3U complete, Z complete different course => tentative with both codes", () => {
    const txt = mkModernTdaText({
      sec3uRows: ["FA24 MUS 355 3.0 A"],
      secZRows: ["SP25 HIST 110B 3.0 B+"],
    });

    const ge = parseGeFromTda(txt);
    const rec = ge.items["3U/Z"];

    expect(rec.status).toBe("tentative");
    expect(rec.note).toBe("3U=MUS 355; Z=HIST 110B");
  });

  it("3U complete, Z complete same course => complete (no review note)", () => {
    const txt = mkModernTdaText({
      sec3uRows: ["FA24 MUS 355 3.0 A"],
      secZRows: ["FA24 MUS 355 3.0 A"],
    });

    const ge = parseGeFromTda(txt);
    const rec = ge.items["3U/Z"];

    expect(rec.status).toBe("complete");
    expect(rec.code).toBe("MUS 355");
    expect(rec.note ?? null).toBe(null);
  });

  it("3U IP, Z missing => tentative with '3U=<course>; Z=Needed'", () => {
    const txt = mkModernTdaText({
      sec3uRows: ["SP25 MUS 355 3.0 IP"],
      secZRows: [],
    });

    const ge = parseGeFromTda(txt);
    const rec = ge.items["3U/Z"];

    expect(rec.status).toBe("tentative");
    expect(rec.code).toBe("MUS 355");
    expect(rec.note).toBe("3U=MUS 355; Z=Needed");
  });

  it("3U missing, Z IP => tentative with '3U=Needed; Z=<course>'", () => {
    const txt = mkModernTdaText({
      sec3uRows: [],
      secZRows: ["SP25 HIST 110B 3.0 IP"],
    });

    const ge = parseGeFromTda(txt);
    const rec = ge.items["3U/Z"];

    expect(rec.status).toBe("tentative");
    expect(rec.code).toBe("HIST 110B");
    expect(rec.note).toBe("3U=Needed; Z=HIST 110B");
  });
});
