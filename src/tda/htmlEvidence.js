import { normalizeText, normCode, isPassingGrade } from "./textUtils";
import { parseTdaSubstitutionMap } from "./courseRows";
import { parseGeFromTda } from "./geParser";
import { parseTechElectives, sliceSection } from "./techElectives";

// Term tokens used by the HTML transcript tables.
const TERM_RX = /^(FA|SP|SS|WI)\d{2}$/i;

// Course code like "CPSC 120A" or "MATH 150A" (HTML sometimes omits the space)
const COURSE_RX = /^([A-Z]{2,6})\s*(\d{3,4}[A-Z]?L?)$/i;

function cleanCellText(s) {
  return String(s || "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract transcript rows from a TDA HTML export.
 *
 * The HTML is much more structured than PDF text extraction: each transcript
 * entry appears as a small table whose first row begins with a term token
 * (FA24/SP25/...). We only trust these rows for passed/IP evidence.
 */
export function parseTdaCourseRowsFromHtml(htmlString) {
  const rows = [];
  if (!htmlString) return rows;

  const doc = new DOMParser().parseFromString(String(htmlString), "text/html");
  let tables = Array.from(doc.querySelectorAll("table.completedCourses"));
  // Fallback: if the export variant doesn't use the standard class, scan all tables.
  if (!tables.length) tables = Array.from(doc.querySelectorAll("table"));

  const completedTables = Array.from(doc.querySelectorAll("table.completedCourses"));
  if (completedTables.length) {
    tables = completedTables.filter((t) => !t.parentElement?.closest("table.completedCourses"));
  } else {
    tables = Array.from(doc.querySelectorAll("table"));
  }

  for (const table of tables) {
    // IMPORTANT: Avoid rows from nested tables (e.g., "selectcourses" lists) which can
    // otherwise cause false positives (like marking a course complete just because it
    // appears in a "TAKE=> ..." options list).
    // Using :scope limits the selection to direct rows of this completedCourses table.
    /*
    let trs = Array.from(table.querySelectorAll(":scope > tbody > tr"));
    if (!trs.length) trs = Array.from(table.querySelectorAll(":scope > thead > tr"))
      .concat(Array.from(table.querySelectorAll(":scope > tbody > tr")));
    if (!trs.length) trs = Array.from(table.rows);
    if (!trs.length) continue;
    */

    // Collect ONLY direct rows for THIS table (avoid nested tables).
    let trs = [];

    // thead rows (if present)
    if (table.tHead) trs.push(...Array.from(table.tHead.rows));

    // tbody rows (0+ tbodies)
    for (const tb of Array.from(table.tBodies || [])) {
      trs.push(...Array.from(tb.rows));
    }

    // Fallback: table with direct <tr> but no thead/tbody
    if (!trs.length) {
      trs = Array.from(table.querySelectorAll("tr"))
        .filter((tr) => tr.closest("table") === table); // critical: exclude nested rows
    }

    if (!trs.length) continue;

    for (const tr of trs) {
      /*
      // const cells = Array.from(tr.querySelectorAll("th,td")).map((c) =>
      const cells = Array.from(tr.querySelectorAll(":scope > th, :scope > td")).map((c) =>
        cleanCellText(c.textContent)
      );
      */

      const cells = Array.from(tr.children)
        .filter((el) => el.tagName === "TD" || el.tagName === "TH")
        .map((c) => cleanCellText(c.textContent));

      if (cells.length < 4) continue;

      // Expected layout (commonly):
      //   [0]=TERM, [1]=COURSE, [2]=UNITS, [3]=GRADE, [4]=STATUS/CCODE (optional)
      const term = cells[0];
      if (!TERM_RX.test(term)) continue;

      const cm = COURSE_RX.exec(cells[1] || "");
      if (!cm) continue;

      const code = normCode(`${cm[1]} ${cm[2]}`);

      // Units are often "0.0" for IP or for some transcript imports.
      // We still keep the row even if units parses to 0.
      const units = parseFloat(String(cells[2] || "").replace(/\s+/g, ""));

      // Some HTML variants put IP in a dedicated status/ccode column
      // and leave the grade column blank.
      const gradeCell = (cells[3] || "").toUpperCase().replace(/\s+/g, "");
      const statusCell = (cells[4] || "").toUpperCase().replace(/\s+/g, "");

      // Also detect IP via the <tr> class list (often "takenCourse ip")
      const trHasIpClass =
        tr.classList && (tr.classList.contains("ip") || tr.classList.contains("inprog"));

      let grade = gradeCell;
      if (statusCell === "IP" || trHasIpClass) grade = "IP";

      // Normalize "+C" -> "C+" (seen occasionally in exports)
      if (/^\+[A-F]$/.test(grade)) grade = grade.slice(1) + "+";

      rows.push({
        term,
        code,
        units: Number.isFinite(units) ? units : 0,
        grade,
        // keep raw status/ccode around for debugging & optional UI
        status: statusCell,
      });
    }
  }

  return rows;
}

/**
 * Evidence model for HTML-based TDA imports.
 *
 * We still reuse your existing GE + tech-elective parsing (which expects a
 * big normalized text blob), but we switch transcript evidence (passed/IP)
 * to the HTML table structure for much higher accuracy.
 */
export function parseTdaEvidenceFromHtml(htmlString) {
  const doc = new DOMParser().parseFromString(String(htmlString || ""), "text/html");
  const visibleText = doc?.body?.innerText || doc?.body?.textContent || "";

  // Normalize similar to the PDF pipeline so downstream slicers keep working.
  const normText = normalizeText(visibleText);

  // 1) Transcript rows (strongest evidence)
  const rows = parseTdaCourseRowsFromHtml(htmlString);

  // 2) Passed/IP sets derived only from transcript rows
  const passed = new Set();
  const ip = new Set();
  for (const r of rows) {
    if (!r?.code) continue;
    if (r.grade === "IP") {
      ip.add(r.code);
      continue;
    }
    if (r.grade === "CR" || r.grade === "P" || isPassingGrade(r.grade)) {
      passed.add(r.code);
    }
  }

  // 3) Substitutions (if present in the export text)
  const subs = parseTdaSubstitutionMap(normText);

  // 4) GE evidence (text-based slicer)
  // NOTE: We keep the text slicer because it's working well for most slots,
  // but we overlay a *tiny* HTML-structure fix for GE Area 6 certification
  // rows ("F CSU CERT"). Those rows don't contain a real course code and can
  // move around in the export, so the DOM is the safest signal.
  const ge = parseGeFromTda(normText);
  // Convenience handle: parseGeFromTda returns { isModern, items: {...} }
  // Downstream code reads ge.items, so overlays must write into that map.
  const geItems = ge?.items || (ge.items = {});

  // ---- HTML overlay: GE Area 6 (Ethnic Studies) CSU CERT ----
  // If Area 6 is satisfied via CSU certification (e.g., "WI25 F CSU CERT"),
  // the text slicer can miss it depending on how innerText is flattened.
  // Use the requirement panel itself as the source of truth.
  try {
    const req6 = Array.from(doc.querySelectorAll("div.requirement")).find((r) => {
      const t = normalizeText(r.textContent || "");
      return /\bGE\s+(?:AREA\s+)?6\b/i.test(t) && /ETHNIC\s+STUD/i.test(t);
    });

    if (req6) {
      const classStr = String(req6.getAttribute("class") || "");
      const txt = normalizeText(req6.textContent || "");

      // Requirement/Panel completion signals used by different TDA exports.
      const reqComplete =
        /\bStatus_OK\b/i.test(classStr) ||
        /Sub-Requirement\s+Complete/i.test(txt) ||
        /Requirement\s+(?:Complete|Fulfilled)/i.test(txt);

      // Prefer real course rows (rare for Area 6 cert cases, but possible)
      if (reqComplete) {
        let filled = false;
        const localTables = Array.from(req6.querySelectorAll("table.completedCourses"));
        for (const t of localTables) {
          // const trs = Array.from(t.querySelectorAll(":scope > tbody > tr"));
          const trs = Array.from(t.tBodies?.[0]?.rows || []).filter((tr) => tr.closest("table") === t);
          for (const tr of trs) {
            /*
            // const cells = Array.from(tr.querySelectorAll("th,td")).map((c) =>
            const cells = Array.from(tr.querySelectorAll(":scope > th, :scope > td")).map((c) =>
              cleanCellText(c.textContent)
            );
            */

            const cells = Array.from(tr.children)
              .filter((el) => el.tagName === "TD" || el.tagName === "TH")
              .map((c) => cleanCellText(c.textContent));

            if (cells.length < 4) continue;
            const term = cells[0];
            if (!TERM_RX.test(term)) continue;
            const cm = COURSE_RX.exec(cells[1] || "");
            if (!cm) continue;
            const code = normCode(`${cm[1]} ${cm[2]}`);
            const gradeCell = (cells[3] || "").toUpperCase().replace(/\s+/g, "");
            const statusCell = (cells[4] || "").toUpperCase().replace(/\s+/g, "");
            const trHasIpClass =
              tr.classList && (tr.classList.contains("ip") || tr.classList.contains("inprog"));
            let grade = gradeCell;
            if (statusCell === "IP" || trHasIpClass) grade = "IP";
            if (/^\+[A-F]$/.test(grade)) grade = grade.slice(1) + "+";

            if (grade === "IP") {
              geItems["6"] = { code, status: "IP" };
              filled = true;
              break;
            }
            if (grade === "CR" || grade === "P" || isPassingGrade(grade)) {
              geItems["6"] = { code, status: "complete" };
              filled = true;
              break;
            }
          }
          if (filled) break;
        }

        // If there isn't a course row, accept CSU CERT rows.
        // IMPORTANT: Some TDA HTML exports do NOT render "F CSU CERT" as visible
        // text in the completedCourses table; instead it can live only in the
        // subrequirement's attributes (e.g., pseudolist="...\"F CSU CERT\"...").
        // So we check both visible text and the DOM attributes.
        if (!filled) {
          // 1) Visible text (most common)
          const hasCertInText = /\bF\s*CSU\s*CERT\b/i.test(txt);

          // 2) Attribute-only (pseudolist/pseudo)
          let hasCertInAttrs = false;
          const subreqs = Array.from(req6.querySelectorAll("div.subrequirement"));
          for (const sr of subreqs) {
            const pseudo = String(sr.getAttribute("pseudo") || "");
            const pseudolist = String(sr.getAttribute("pseudolist") || "");
            if (/F\s*CSU\s*CERT/i.test(pseudo) || /F\s*CSU\s*CERT/i.test(pseudolist)) {
              hasCertInAttrs = true;
              break;
            }
          }

          // 3) Course-cell equals "F CSU CERT" (seen in some variants)
          let hasCertInCourseCell = false;
          if (!hasCertInText && !hasCertInAttrs) {
            for (const t of Array.from(req6.querySelectorAll("table.completedCourses"))) {
              for (const tr of Array.from(t.querySelectorAll(":scope > tbody > tr"))) {
                const courseCell = cleanCellText(tr.querySelector("td.course")?.textContent || "");
                if (/^F\s*CSU\s*CERT$/i.test(courseCell)) {
                  hasCertInCourseCell = true;
                  break;
                }
              }
              if (hasCertInCourseCell) break;
            }
          }

          if (hasCertInText || hasCertInAttrs || hasCertInCourseCell) {
            geItems["6"] = { code: null, status: "complete", note: "F CSU CERT" };
          }
        }
      }
    }
  } catch {
    // best-effort; never fail import due to GE6 overlay
  }
  // ----------------------------------------------------

  // 5) Technical electives evidence
  const teSection = sliceSection(
    normText,
    "TECHNICAL ELECTIVES",
    ["GRADE POINT", "UPPER-DIVISION", "GRADUATION REQUIREMENT"]
  );

  const teClean = teSection
    .replace(/\*{1,3}[^\n*]{0,250}\*{1,3}/g, " ")
    .replace(/CSUN:\s.*?(?=(?:\b[A-Z]{2,6}\s?\d{3,4}[A-Z]?L?\b)|\bIP\b|$)/gi, " ");

  const tech = parseTechElectives(teClean);

  // Graduation Requirement (GRADGOV)
  // IMPORTANT:
  // Do NOT infer POSC 100 completion from generic strings like "F CSU CERT" or "POLSC1".
  // Those tokens can appear in other areas (e.g., GE Area 6) and cause false positives.
  // Instead, only mark POSC 100 complete if the GRADGOV requirement itself is satisfied.
  try {
    const gradGovReq = Array.from(doc.querySelectorAll("div.requirement")).find((r) => {
      const t = r.querySelector(".reqTitle")?.textContent || "";
      return /\[\s*GRADGOV\s*\]/i.test(t) || /\bGRADGOV\b/i.test(t);
    });

    if (gradGovReq) {
      const classStr = String(gradGovReq.getAttribute("class") || "");
      const reqComplete = /\bStatus_OK\b/i.test(classStr) ||
        /Requirement\s+Complete/i.test(gradGovReq.textContent || "") ||
        /Requirement\s+Fulfilled/i.test(gradGovReq.textContent || "");

      if (reqComplete) {
        // 1) Prefer explicit transcript evidence inside the requirement.
        // Some exports include a completedCourses table inside the subrequirement.
        const localTables = Array.from(gradGovReq.querySelectorAll("table.completedCourses"));
        let foundViaTable = false;
        for (const t of localTables) {
          // const trs = Array.from(t.querySelectorAll(":scope > tbody > tr"));
          const trs = Array.from(t.tBodies?.[0]?.rows || []).filter((tr) => tr.closest("table") === t);
          for (const tr of trs) {
            const cells = Array.from(tr.querySelectorAll("td")).map((c) => cleanCellText(c.textContent));
            if (cells.length < 4) continue;
            const cm = COURSE_RX.exec(cells[1] || "");
            if (!cm) continue;
            const code = normCode(`${cm[1]} ${cm[2]}`);
            if (code !== "POSC 100") continue;
            const gradeCell = (cells[3] || "").toUpperCase().replace(/\s+/g, "");
            const statusCell = (cells[4] || "").toUpperCase().replace(/\s+/g, "");
            let grade = gradeCell;
            const trHasIpClass = tr.classList && (tr.classList.contains("ip") || tr.classList.contains("inprog"));
            if (statusCell === "IP" || trHasIpClass) grade = "IP";
            if (/^\+[A-F]$/.test(grade)) grade = grade.slice(1) + "+";

            if (grade === "IP") ip.add("POSC 100");
            else if (grade === "CR" || grade === "P" || isPassingGrade(grade)) passed.add("POSC 100");
            foundViaTable = true;
          }
        }

        // 2) If the requirement is complete but there's no course row, it can be met via certification.
        if (!foundViaTable) {
          const txt = normalizeText(gradGovReq.textContent || "");
          const metRx = /M\s*E\s*T\s*with\s*a\s+CSU\s+cert/i;
          const certRx = /\b(?:POLSC\s*1|POLSC1|F\s*CSU\s*CERT)\b/i;
          if (metRx.test(txt) || certRx.test(txt)) {
            passed.add("POSC 100");
          }
        }
      }
    }
  } catch {
    // Best-effort only; never crash import due to GRADGOV heuristics.
  }

  return {
    rawText: visibleText,
    normText,
    rows,
    passed,
    ip,
    subs,
    ge,
    tech,
  };
}
