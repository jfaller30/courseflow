import { normalizeText } from "./textUtils";
import { parseTdaCourseRows, parseTdaSubstitutionMap } from "./courseRows";
import { parseGeFromTda } from "./geParser";
import { parseTechElectives, sliceSection } from "./techElectives";

/**
 * Evidence model: parse raw TDA text once into high-confidence facts.
 *
 * The goal is to keep "what the file says" separate from "how the flowchart applies it".
 * - Transcript rows (TERM + course + units + grade/IP) are the only source of passed/IP.
 * - GE parsing uses sliced blocks + transcript rows + a small whitelist of phrases (waived/MET).
 * - Tech electives are parsed only from the TECHNICAL ELECTIVES section.
 */
export function parseTdaEvidence(rawText) {
  // const normText = normalizeText(rawText);
  const raw = String(rawText || "");
  const norm = normalizeText(raw);

  // 1) Transcript rows: strongest evidence
  const rows = parseTdaCourseRows(raw);

  // 2) Passed/IP sets derived only from transcript rows
  const passed = new Set();
  const ip = new Set();
  for (const r of rows) {
    if (!r?.code) continue;
    if (r.grade === "IP") {
      ip.add(r.code);
      continue;
    }
    // treat CR/P and A-D(+/-) as passing
    if (r.grade === "CR" || r.grade === "P" || /^[A-D](\+|-)?$/.test(r.grade)) {
      passed.add(r.code);
    }
  }

  // 3) Substitutions (for notes + optional overlay in ProgramMap)
  const subs = parseTdaSubstitutionMap(norm);

  // 4) GE evidence (uses normalized text + its own slicing rules)
  const ge = parseGeFromTda(norm);

  // 5) Technical electives evidence
  const teSection = sliceSection(
    norm,
    "TECHNICAL ELECTIVES",
    ["GRADE POINT", "UPPER-DIVISION", "GRADUATION REQUIREMENT"]
  );

  // Keep TE parsing intentionally simple; remove noisy annotations that confuse matching.
  const teClean = teSection
    // remove *...* noise but don't cross lines
    .replace(/\*{1,3}[^\n*]{0,250}\*{1,3}/g, " ")
    // remove CSU certification blurb fragments (noisy)
    .replace(/CSUN:\s.*?(?=(?:\b[A-Z]{2,6}\s?\d{3,4}[A-Z]?L?\b)|\bIP\b|$)/gi, " ");

  const tech = parseTechElectives(teClean);

  return {
    rawText: raw,
    normText: norm,
    rows,
    passed,
    ip,
    subs,
    ge,
    tech,
  };
}