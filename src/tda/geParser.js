import { isPassingGrade, normalizeText } from "./textUtils";
import { parseTdaCourseRows } from "./courseRows";

// Helper
const fmtSide = (label, rec) => {
  if (rec && rec.code) return `${label}=${rec.code}`;
  return `${label}=Needed`;
};

// Local normalizer (avoid pulling extra deps into the parser)
const normCourse = (c) => String(c || "").replace(/\s+/g, " ").trim().toUpperCase();
const isMeaningfulStatus = (s) => s === "complete" || s === "IP";

// ======== GE parsing helpers (old vs new TDA) ========
const GE_SCHEMAS = {
    old: {
        // 6 slots: A.1, C.1, C.2, (C.3/Z), D.2, F
        keys: ["A.1", "C.1", "C.2", "C.3/Z", "D.2", "F"],
        headers: {
        "A.1": /GE\s+A\.1\s+ORAL COMMUNICATION/i,
        "C.1": /GE\s+C\.1\s+INTRODUCTION TO ARTS/i,
        "C.2": /GE\s+C\.2\s+INTRODUCTION TO HUMANITIES/i,
        "C.3": /GE\s+C\.3\s+EXPLORATIONS IN THE ARTS\/HUMANITIES/i,
        "D.2": /GE\s+D\.2\s+AMERICAN HISTORY, INSTITUTIONS AND VALUES/i,
        "F": /\bF\.\s+ETHNIC STUDIES\b/i,
        "Z": /\bZ\.\s+CULTURAL DIVERSITY\b/i,
        // --- boundary-only (don’t parse, just stop slices) ---
        "_D.1": /GE\s+D\.1\s+INTRODUCTION TO THE SOCIAL SCIENCES/i,
        "_UDGE": /GENERAL EDUCATION UPPER DIVISION\/RESIDENCE UNITS/i
        }
    },
    modern: {
        // 6 slots: 1C, 3A, 3B, 4B, 6, (3U/Z)
        keys: ["1C", "3A", "3B", "4B", "6", "3U/Z"],
        headers: {
        "1C": /GE\s+1C\s+ORAL COMMUNICATION/i,
        "3A": /GE\s+3A\s+INTRODUCTION TO ARTS/i,
        "3B": /GE\s+3B\s+INTRODUCTION TO HUMANITIES/i,
        "4B": /GE\s+4B\s+AMERICAN HISTORY.*VALUES/i,
        "6": /\bGE\s+(?:AREA\s+)?6\b.*ETHNIC\s+STUDIES\b/i,
        "3U": /GE\s+3U\s+EXPLORATIONS IN ARTS\/HUMANITIES/i,
        "Z": /\bGE\s+AREA\s+Z:?\s+CULTURAL DIVERSITY\b|\bGE\s+Z\.?\s+CULTURAL DIVERSITY\b/i,
        // --- boundary-only (don’t parse, just stop slices) ---
        "_5A": /\bGE\s+5A\b|\bGE\s+AREA\s+5\b/i,
        "_5B": /\bGE\s+5B\b/i,
        "_5C": /\bGE\s+5C\b/i,
        "_2U5U": /\bGE\s+(?:AREA\s+)?2U5U\b/i,
        "_4A": /\bGE\s+4A\s+INTRO TO SOCIAL & BEHAVIORAL SCI/i,
        "_4U": /\bGE\s+(?:AREA\s+)?4U\b/i,
        "_UDGE": /GENERAL EDUCATION UPPER DIVISION\/RESIDENCE UNITS/i
        }
    }
};

// extract text window between one header and the next
function sliceByHeader(allText, headerRx, followingHeaders) {
    if (!headerRx || typeof headerRx.exec !== "function") return "";
    headerRx.lastIndex = 0;
    const m = headerRx.exec(allText);
    if (!m) return "";
    const start = m.index;

    // Find the *first* following header that occurs AFTER this header.
    // NOTE: Many header regexes appear multiple times in a TDA (e.g., summary + detail).
    // Using plain rx.exec(allText) only finds the first occurrence anywhere, which can be
    // *before* start and causes the slice to run to EOF (false positives).
    let end = allText.length;

    const nextIndexAfter = (rx, fromIdx) => {
        if (!rx) return null;
        const flags = rx.flags.includes("g") ? rx.flags : rx.flags + "g";
        const rg = new RegExp(rx.source, flags);
        rg.lastIndex = Math.max(0, fromIdx);
        const mm = rg.exec(allText);
        return mm ? mm.index : null;
    };

    for (const rx of (followingHeaders || [])) {
        const idx = nextIndexAfter(rx, start + 1);
        if (idx !== null && idx > start && idx < end) end = idx;
    }

    return allText.slice(start, end);
}

// From a section window, pick the first course + status
// Return: { code: 'DEPT 123', status: 'IP'|'complete'|null }
function pickCourseStatus(sectionText) {
    if (!sectionText) return { code: null, status: null };

    // IMPORTANT: Some TDAs indicate completion with an asterisk-wrapped note like:
    // "***MET with a CSU certified course***" (e.g., GE 4B in TDA_New_4).
    // If we strip *...* first, we would delete the signal. So detect it on the
    // raw section text BEFORE removing asterisk-wrapped notes.
    const raw = String(sectionText);
    const rawN = normalizeText(raw);
    // Some TDAs insert spaces between letters ("M E T"), use ligatures, or
    // otherwise mangle "certified" (e.g., "certi ed"). So we key off the
    // stable prefix "cert" instead of requiring the full word.
    const metRx = /M\s*E\s*T\s*with\s*a\s+CSU\s+cert/i;
    if (metRx.test(rawN)) {
        return { code: null, status: "complete", note: "CSU Cert. Course" };
    }

    // If the audit explicitly says this requirement is UNFULFILLED, prefer that signal.
    // BUT: "Requirement Unfulfilled" can appear elsewhere in the page (collapsed panels,
    // adjacent requirements, etc.). Only trust it when it appears near the *top* of the
    // sliced section.
    const head = raw.slice(0, 600);
    const unfulfilledRx = /Requirement\s+Unfulfilled/i;
    const fulfilledRx = /Requirement\s+Fulfilled/i;
    const isUnfulfilled = unfulfilledRx.test(head) && !fulfilledRx.test(head);


    // IMPORTANT:
    // Many of the regressions you've been seeing come from "course-code" regex
    // matches inside advisory lists (TAKE==>, requirement descriptions, etc.).
    // Here we ONLY trust *real transcript rows* (TERM + DEPT + NUM + UNITS + GRADE/IP)
    // using the shared row parser.

    // Remove inline *...* notes but never across line breaks; some TDAs use long *** notes
    // and the old regex could delete real transcript rows that follow.
    const s = raw
        .replace(/\*{1,3}[^\n*]{0,200}\*{1,3}/g, " ")
        .replace(/TAKE\s*={2,}[\s\S]*$/i, " ");

    // Parse only real rows inside this section window.
    const rows = parseTdaCourseRows(s);

    const r = rows[0];
    // If there are no transcript rows, fall back to metadata signals.
    if (!r) {
      // Special case: area met by CSU certification rows that don't include a real course code.
      // Examples:
      //   "SP23 C2 CSU CERT 5.0 A ..."
      //   "FA23 F CSU CERT 3.0 A ..." (GE Area 6)
      // Extraction sometimes collapses spaces (e.g. "FA23F CSU CERT").
      // Restrict to area tokens that are actually GE areas to avoid false positives.
      const sN = normalizeText(s);
      const certRx = /\b(?:FA|SP|SU|WI|SS)?\s*\d{0,2}\s*([ABC]\d|F)\s*CSU\s*CERT\b/i;
      const certMatch = sN.match(certRx) || sN.match(/\b([ABC]\d|F)\s*CSU\s*CERT\b/i);
      if (certMatch) {
        return { code: null, status: "complete", note: `${certMatch[1]} CSU CERT` };
      }

      if (/\bwaived\b/i.test(s)) return { code: null, status: "complete", note: "Waived" };

      // Only after we've checked the known "completion without a course" signals,
      // apply the UNFULFILLED override.
      if (isUnfulfilled) return { code: null, status: null };
      return { code: null, status: null };
    }

    if (r.grade === "IP") return { code: r.code, status: "IP" };
    if (r.grade === "CR" || r.grade === "P" || isPassingGrade(r.grade)) {
      // Some exports include "Requirement Unfulfilled" even when a row is present
      // (e.g., in hidden/collapsed markup). A passing row wins.
      return { code: r.code, status: "complete" };
    }

    // If the section is explicitly UNFULFILLED, a non-passing grade should not mark
    // the requirement as complete.
    if (isUnfulfilled) return { code: r.code, status: null };

    return { code: r.code, status: null };
}

// Parse GE assignments from TDA text
export function parseGeFromTda(allText) {
    // choose schema by marker
    // "Modern" GE (1C/3A/3B/4B/6/3U/Z) shows up across multiple catalog years
    // (e.g., Spring 2026) and not all exports include the same header fragments.
    // So use a broader, content-based detection rather than keying off a single
    // catalog-year string.
    const isModern =
        /\bGE\s+1C\b/i.test(allText) ||
        /\bGE\s+3A\b/i.test(allText) ||
        /\bGE\s+3B\b/i.test(allText) ||
        /\bGE\s+4B\b/i.test(allText) ||
        /\bGE\s+(?:AREA\s+)?6\b/i.test(allText) ||
        /\bGE\s+3U\b/i.test(allText) ||
        /\bGE\s+(?:AREA\s+)?Z\b/i.test(allText) ||
        /CATALOG YEAR\s*Fall\s*2025/i.test(allText);
    const schema = isModern ? GE_SCHEMAS.modern : GE_SCHEMAS.old;

    // build ordered header list for slicing
    const hdrList = Object.values(schema.headers);
    const out = {};

    if (isModern) {
        // keep the actual section text around so we can reuse it in fallbacks
        const sections = {};

        // 1C, 3A, 3B, 4B, 6
        for (const k of ["1C", "3A", "3B", "4B", "6"]) {
        const sec = sliceByHeader(
            allText,
            schema.headers[k],
            hdrList.filter((r) => r !== schema.headers[k])
        );
        sections[k] = sec;

        out[k] = pickCourseStatus(sec);
        }

        // 3U/Z merged
        const sec3U = sliceByHeader(
        allText,
        schema.headers["3U"],
        hdrList.filter((r) => r !== schema.headers["3U"])
        );
        const secZ = sliceByHeader(
        allText,
        schema.headers["Z"],
        hdrList.filter((r) => r !== schema.headers["Z"])
        );
        const u = pickCourseStatus(sec3U);
        const z = pickCourseStatus(secZ);

        const hasU = isMeaningfulStatus(u.status);
        const hasZ = isMeaningfulStatus(z.status);
        const hasBoth = hasU && hasZ;
        const mismatch =
          hasBoth &&
          u.code && z.code &&
          normCourse(u.code) !== normCourse(z.code);

        // If only one side has any meaningful status (complete/IP) and the other
        // side is empty/unfulfilled, we can't assume the course will satisfy both
        // categories. Flag for advisor review.
        const unilateral = (hasU && !hasZ) || (!hasU && hasZ);

        // Default behavior (backwards compatible)
        let code = (u.status ? u.code : null) || (z.status ? z.code : null);
        let status =
          u.status === "IP" || z.status === "IP"
            ? "IP"
            : u.status || z.status || null;
        let note = u.note || z.note || null;

        // Option 2: if 3U and Z are different (or only one side is in-play), flag for advisor review.
        if (mismatch || unilateral) {
          status = "tentative";
          code = code || u.code || z.code || null;
          // note = `3U=${u.code || u.note || ""}; Z=${z.code || z.note || ""}`;
          note = `${fmtSide("3U", u)}; ${fmtSide("Z", z)}`;
        }

        out["3U/Z"] = { code, status, note };

        // ---------- SAFE FALLBACK JUST FOR AREA 6 ----------
        // If Area 6 is still empty, parse ONLY real transcript rows within
        // the GE 6 section. This catches cases where extraction breaks
        // spacing/newlines and avoids matching advisory text.
        if (!out["6"] || !out["6"].status) {
          const sec6 =
            sections["6"] ||
            sliceByHeader(
              allText,
              schema.headers["6"],
              hdrList.filter((r) => r !== schema.headers["6"])
            );

          const rows6 = parseTdaCourseRows(sec6);
          const r = rows6[0];
          if (r) {
            if (r.grade === "IP") out["6"] = { code: r.code, status: "IP" };
            else if (r.grade === "CR" || r.grade === "P" || isPassingGrade(r.grade)) {
              out["6"] = { code: r.code, status: "complete" };
            }
          }
        }
        // ---------------------------------------------------
    } else {
        // old: A.1, C.1, C.2, (C.3/Z), D.2, F
        for (const k of ["A.1", "C.1", "C.2", "D.2", "F"]) {
        const hdr = schema.headers[k];
        const sec = sliceByHeader(
            allText,
            hdr,
            hdrList.filter((r) => r !== hdr)
        );
        out[k] = pickCourseStatus(sec);
        }
        const secC3 = sliceByHeader(allText, schema.headers["C.3"], hdrList.filter(r => r !== schema.headers["C.3"]));
        const secZ  = sliceByHeader(allText, schema.headers["Z"],   hdrList.filter(r => r !== schema.headers["Z"]));
        const c3 = pickCourseStatus(secC3);
        const z  = pickCourseStatus(secZ);

        const hasC3 = isMeaningfulStatus(c3.status);
        const hasZ = isMeaningfulStatus(z.status);
        const hasBoth = hasC3 && hasZ;
        const mismatch =
          hasBoth &&
          c3.code && z.code &&
          normCourse(c3.code) !== normCourse(z.code);

        // If only one side has any meaningful status (complete/IP) and the other
        // side is empty/unfulfilled, we can't assume the course will satisfy both
        // categories. Flag for advisor review.
        const unilateral = (hasC3 && !hasZ) || (!hasC3 && hasZ);

        // Prefer the Z course if it actually has a status; otherwise fall back to C.3
        let code =
          (z.status ? z.code : null) ||
          (c3.status ? c3.code : null) ||
          null;

        let status =
          (c3.status === "IP" || z.status === "IP")
            ? "IP"
            : (c3.status || z.status || null);

        let note = c3.note || z.note || null;

        // Option 2: if C.3 and Z are different (or only one side is in-play), flag for advisor review.
        if (mismatch || unilateral) {
          status = "tentative";
          code = code || c3.code || z.code || null;
          // note = `C.3=${c3.code || c3.note || ""}; Z=${z.code || z.note || ""}`;
          note = `${fmtSide("C.3", c3)}; ${fmtSide("Z", z)}`;
        }

        out["C.3/Z"] = { code, status, note };

    }

    return { isModern, items: out };
}