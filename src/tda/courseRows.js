import { normCode, isPassingGrade } from "./textUtils";

// Escape a string for safe use inside a RegExp constructor.
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// --- unified low-level parser: TERM + COURSE + UNITS + GRADE/IP ---
// Exported so other parsers (GE, substitutions, etc.) can reuse the exact
// same definition of a "real" transcript row.
export function parseTdaCourseRows(txt) {
  const rows = [];
  if (!txt) return rows;

  let s = String(txt)
    .replace(/[\u2212\u2012\u2013\u2014\u2015]/g, "-") // unicode dashes → '-'
    .replace(/\u00AD/g, "")                          // soft hyphen
    // kill advisory "TAKE ==> ..." chunks so they never look like rows
    .replace(/TAKE\s*={2,}[^.\n]+/gi, " ");

  // TERM   DEPT  NUM   UNITS          GRADE/IP
  // FA22   CPSC 120A   2.0            A
  // SP25   EGEC 401    3.0            IP
  // IMPORTANT: text extraction often inserts extra whitespace/newlines
  // between dept/number (e.g., "POSC\n100" or "CPSC   121A").
  // Be permissive about separators so we don't miss valid rows.
  const rowRx =
    /\b(FA|SP|SS|WI)\s*(\d{2})\s+([A-Z]{2,6})[-\s]*?(\d{3,4}[A-Z]?L?|[A-Z]{2,6})\s+(\d+(?:\s*\.\s*\d+)?)\s+([+\-]?\s*[A-F]\s*[+\-]?|CR|P|IP)\b/gi;

  let m;
  while ((m = rowRx.exec(s)) !== null) {
    const term = `${m[1]}${m[2]}`; // e.g. "FA22"
    const dept = m[3];
    const num  = m[4];
    const units = parseFloat(m[5].replace(/\s+/g, ""));
    let grade = m[6].toUpperCase().replace(/\s+/g, ""); // "B -" → "B-"

    // normalize "+C" -> "C+"
    if (/^\+[A-F]$/.test(grade)) grade = grade.slice(1) + "+";

    rows.push({
      term,
      code: normCode(`${dept} ${num}`),
      units,
      grade, // "A", "B+", "CR", "IP", etc.
    });
  }

  return rows;
}

export function parseTdaPassedCodes(txt) {
  const passed = new Set();

  // first, normal course rows
  const rows = parseTdaCourseRows(stripCoursesNotApplied(txt));
  for (const r of rows) {
    if (r.grade === "IP") continue; // IP is handled separately

    // count A–D (with +/-), CR, or P as passing
    if (r.grade === "CR" || r.grade === "P" || isPassingGrade(r.grade)) {
      passed.add(r.code);
    }
  }

  // then overlay substitutions like "*CIST 4B SUBS CPSC 131*"
  // BUT only if the substitute label actually appears elsewhere in the TDA
  // (e.g., "WValleyC: CIST 4B"). This avoids false positives across files.
  const subs = parseTdaSubstitutionMap(txt);
  for (const [target, fromLabel] of Object.entries(subs)) {
    const usedRx = new RegExp(`:\\s*${escapeRegExp(fromLabel)}\\b`, "i");
    if (usedRx.test(String(txt))) {
      passed.add(target);
    }
  }

  return passed;
}

export function parseTdaIpCodes(txt) {
  const ip = new Set();
  const rows = parseTdaCourseRows(txt);
  for (const r of rows) {
    if (r.grade === "IP") {
      ip.add(r.code);
    }
  }
  return ip;
}

// Parse substitution hints like "*CIST 4B SUBS CPSC 131*"
// Returns an object mapping the target requirement code → the substitute label.
// Example: { "CPSC 131": "CIST 4B" }
export function parseTdaSubstitutionMap(txt) {
  const out = {};
  if (!txt) return out;
  const s = String(txt);
  const rx = /\*([^*]*?)\s+SUBS\s+([A-Z]{2,6})\s?(\d{3}[A-Z]?L?)\*/gi;
  let m;
  while ((m = rx.exec(s)) !== null) {
    const fromLabel = m[1].trim();                    // "CIST 4B"
    const dept = m[2];
    const num = m[3];
    const target = normCode(`${dept} ${num}`);        // "CPSC 131"
    if (fromLabel) out[target] = fromLabel;
  }
  return out;
}

/// Strip the trailing "COURSES NOT SPECIFICALLY APPLIED..." section.
//
// NOTE: we no longer actually strip anything here, because the
// "COURSEWORK FROM ..." transcript lives after that header in
// the newer TDAs and we *do* want to see that.
//
function stripCoursesNotApplied(txt) {
  if (!txt) return "";
  // Keep the full TDA text; downstream logic will ignore
  // "TAKE ==>" advisory rows and similar noise.
  return String(txt);
}