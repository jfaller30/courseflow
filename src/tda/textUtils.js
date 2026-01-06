// --- TDA import helpers ---
// Normalize course codes between TDA and your sheet (e.g., "EGEC-180" ⇄ "EGEC 180")
export const normCode = (s="") => {
  let t = String(s).toUpperCase();

  // normalize dashes / whitespace to single spaces
  t = t.replace(/[-\s]+/g, " ").trim();

  // insert missing space between dept+number when extraction glues them (e.g., POLSC1)
  t = t.replace(/^([A-Z]{2,6})\s*(\d)/, "$1 $2");

  // canonical aliases seen on some TDAs
  if (/^POLSC\s*0*1$/.test(t)) return "POSC 100";

  return t;
};

// Normalize quirks (unicode minus, weird whitespace, soft hyphens)
export function normalizeText(s = "") {
  const str = String(s)
    // fix common ligatures (e.g., certiﬁed -> certified)
    .replace(/\uFB00/g, "ff")
    .replace(/\uFB01/g, "fi")
    .replace(/\uFB02/g, "fl")
    .replace(/\uFB03/g, "ffi")
    .replace(/\uFB04/g, "ffl")
    .replace(/\uFB05/g, "ft")
    .replace(/\uFB06/g, "st")
    // unicode dashes/minus to hyphen
    .replace(/[\u2212\u2012\u2013\u2014\u2015]/g, "-")
    // soft hyphen
    .replace(/\u00AD/g, "");

  // normalize whitespace *after* ligature replacement
  return str.replace(/\s+/g, " ").trim();
}

// Normalize like "CPSC 120A/L" → "CPSC 120A/L", "CPSC 120a" → "CPSC 120A"
export const parseDeptNumPart = (code = "") => {
  const m = /^([A-Z]{2,5})\s+(\d{3})([A-Z]?)(?:\/L)?$/i.exec(normCode(code));
  if (!m) return null;
  const dept = m[1];
  const num = m[2];
  const part = m[3]?.toUpperCase() || ""; // "", "A", or "L"
  return { dept, num, part, base: `${dept} ${num}` };
};

// Equivalency map for combined vs parts
export const EQUIV = {
  "CPSC 120": { combined: "CPSC 120", parts: ["CPSC 120A", "CPSC 120L"] },
  "CPSC 121": { combined: "CPSC 121", parts: ["CPSC 121A", "CPSC 121L"] },
};

// Includes placeholders sometimes used on flowcharts
export const isPlaceholderAL = (code) => {
  const n = normCode(code);
  return n === "CPSC 120A/L" || n === "CPSC 121A/L";
};

// Passing grades (C- or better)
export const isPassingGrade = (g="") => {
  // Some TDAs show "+C" instead of "C+". Normalize that.
  const s = String(g).toUpperCase().replace(/\s+/g, "").replace(/^\+/, "");
  if (/^\+[A-F]$/.test(String(g).toUpperCase().replace(/\s+/g, ""))) {
    // handled above by stripping leading '+'
  }
  // Treat A/B/C (with optional +/-) as passing; D/F are not.
  return /^(A|B|C)(\+|-)?$/.test(s) || s === "CR" || s === "P";
};
