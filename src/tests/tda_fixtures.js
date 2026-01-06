// tests/tda_fixtures.js
// Synthetic "TDA-like" HTML fixtures with known ground truth for your importer.
// These intentionally match what your parser *actually reads* in tda/htmlEvidence.js.

function esc(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function makeTranscriptTable(rows, { className = "completedCourses", withTbody = true } = {}) {
  const trHtml = rows
    .map((r) => {
      const cls = r.rowClass ? ` class="${esc(r.rowClass)}"` : "";
      const cells = [
        r.term ?? "",
        r.course ?? "",
        r.units ?? "",
        r.grade ?? "",
        r.status ?? "",
      ].map((c) => `<td>${esc(c)}</td>`).join("");
      return `<tr${cls}>${cells}</tr>`;
    })
    .join("\n");

  if (withTbody) {
    return `<table class="${esc(className)}"><tbody>\n${trHtml}\n</tbody></table>`;
  }
  return `<table class="${esc(className)}">\n${trHtml}\n</table>`;
}

function makeRequirementPanelGE6({
  include = true,
  completeSignal = "Requirement Complete", // alternative: class includes Status_OK
  includeCertVisibleText = false,
  includeCertAttr = true,
  includeCourseRow = false,
  courseRow = { term: "WI25", course: "ETHS 101", units: "3.0", grade: "A", status: "" },
} = {}) {
  if (!include) return "";

  const reqClass = completeSignal === "Status_OK" ? "requirement Status_OK" : "requirement";
  const headerText = "GE AREA 6 ETHNIC STUDIES";

  const certText = includeCertVisibleText ? "WI25 F CSU CERT" : "";

  const subreq = includeCertAttr
    ? `<div class="subrequirement" pseudo="F CSU CERT"></div>`
    : `<div class="subrequirement"></div>`;

  const localCourseTable = includeCourseRow
    ? makeTranscriptTable(
        [
          {
            term: courseRow.term,
            course: courseRow.course,
            units: courseRow.units,
            grade: courseRow.grade,
            status: courseRow.status ?? "",
          },
        ],
        { className: "completedCourses", withTbody: true }
      )
    : "";

  // Include completion signal in textContent so the overlay triggers reqComplete
  const completionText =
    completeSignal === "Status_OK"
      ? "Sub-Requirement Complete"
      : completeSignal;

  return `
    <div class="${reqClass}">
      <div class="reqHeader">${esc(headerText)}</div>
      <div class="reqStatus">${esc(completionText)}</div>
      <div class="reqBody">${esc(certText)}</div>
      ${subreq}
      ${localCourseTable}
    </div>
  `;
}

function makeHtmlDoc({ tables = [], bodyTextBlocks = [], requirementPanels = [] } = {}) {
  const textHtml = bodyTextBlocks.length
    ? `<div id="tdoText" style="white-space:pre-wrap">${esc(bodyTextBlocks.join("\n\n"))}</div>`
    : "";

  return `<!doctype html>
<html>
  <head><meta charset="utf-8"></head>
  <body>
    ${tables.join("\n\n")}
    ${textHtml}
    ${requirementPanels.join("\n\n")}
  </body>
</html>`;
}

/**
 * 20 fixtures covering:
 * - transcript parsing robustness (spacing/case/NBSP)
 * - grade normalization and pass/fail logic
 * - IP detection via grade/status/class
 * - nested table false-positive avoidance
 * - multi-table union
 * - no-tbody fallback
 * - substitution parsing from visible text
 * - GE modern slot parsing from visible text
 * - TECHNICAL ELECTIVES parsing from visible text
 * - GE Area 6 overlay via DOM attributes (F CSU CERT)
 */
export const TDA_FIXTURES = [
  {
    name: "01_basic_pass",
    html: makeHtmlDoc({
      tables: [
        makeTranscriptTable([
          { term: "FA24", course: "CPSC 120", units: "3.0", grade: "A" },
        ]),
      ],
    }),
    expect: { passed: ["CPSC 120"], ip: [] },
  },

  {
    name: "02_course_no_space",
    html: makeHtmlDoc({
      tables: [
        makeTranscriptTable([
          { term: "FA24", course: "CPSC120A", units: "3.0", grade: "B+" },
        ]),
      ],
    }),
    expect: { passed: ["CPSC 120A"], ip: [] },
  },

  {
    name: "03_lowercase_term_and_dept",
    html: makeHtmlDoc({
      tables: [
        makeTranscriptTable([
          { term: "fa24", course: "cpsc 121", units: "3.0", grade: "B+" },
        ]),
      ],
    }),
    expect: { passed: ["CPSC 121"], ip: [] },
  },

  {
    name: "04_nbsp_whitespace_noise",
    html: `<!doctype html><html><body>
      <table class="completedCourses"><tbody>
        <tr><td>FA24</td><td>CPSC&nbsp;120</td><td>3.0</td><td> A </td><td></td></tr>
      </tbody></table>
    </body></html>`,
    expect: { passed: ["CPSC 120"], ip: [] },
  },

  {
    name: "05_grade_plusC_normalized",
    html: makeHtmlDoc({
      tables: [
        makeTranscriptTable([
          { term: "SP25", course: "MATH 150A", units: "4.0", grade: "+C" },
        ]),
      ],
    }),
    expect: { passed: ["MATH 150A"], ip: [] },
  },

  {
    name: "06_grade_with_spaces_B_minus",
    html: makeHtmlDoc({
      tables: [
        makeTranscriptTable([
          { term: "SP25", course: "PHYS 225", units: "4.0", grade: "B -" },
        ]),
      ],
    }),
    expect: { passed: ["PHYS 225"], ip: [] },
  },

  {
    name: "07_CR_and_P_are_passing",
    html: makeHtmlDoc({
      tables: [
        makeTranscriptTable([
          { term: "FA23", course: "CHEM 111A", units: "3.0", grade: "CR" },
          { term: "SP24", course: "CHEM 111B", units: "3.0", grade: "P" },
        ]),
      ],
    }),
    expect: { passed: ["CHEM 111A", "CHEM 111B"], ip: [] },
  },

  {
    name: "08_non_passing_grade_not_counted",
    html: makeHtmlDoc({
      tables: [
        makeTranscriptTable([
          { term: "FA23", course: "CPSC 131", units: "3.0", grade: "D" },
          { term: "SP24", course: "CPSC 131", units: "3.0", grade: "F" },
        ]),
      ],
    }),
    expect: { passed: [], ip: [] },
  },

  {
    name: "09_IP_via_grade_column",
    html: makeHtmlDoc({
      tables: [
        makeTranscriptTable([
          { term: "FA24", course: "CPSC 240", units: "3.0", grade: "IP" },
        ]),
      ],
    }),
    expect: { passed: [], ip: ["CPSC 240"] },
  },

  {
    name: "10_IP_via_status_column",
    html: makeHtmlDoc({
      tables: [
        makeTranscriptTable([
          { term: "SP25", course: "CPSC 323", units: "3.0", grade: "", status: "IP" },
        ]),
      ],
    }),
    expect: { passed: [], ip: ["CPSC 323"] },
  },

  {
    name: "11_IP_via_row_class",
    html: makeHtmlDoc({
      tables: [
        makeTranscriptTable([
          { term: "SP25", course: "MATH 338", units: "3.0", grade: "", status: "", rowClass: "takenCourse ip" },
        ]),
      ],
    }),
    expect: { passed: [], ip: ["MATH 338"] },
  },

  {
    name: "12_ignore_header_row",
    html: makeHtmlDoc({
      tables: [
        makeTranscriptTable([
          { term: "TERM", course: "COURSE", units: "UNITS", grade: "GRADE" },
          { term: "FA24", course: "CPSC 120", units: "3.0", grade: "A" },
        ]),
      ],
    }),
    expect: { passed: ["CPSC 120"], ip: [] },
  },

  {
    name: "13_ignore_non_course_row",
    html: makeHtmlDoc({
      tables: [
        makeTranscriptTable([
          { term: "FA24", course: "TAKE => CPSC 131", units: "0.0", grade: "A" },
          { term: "FA24", course: "CPSC 131", units: "3.0", grade: "B" },
        ]),
      ],
    }),
    expect: { passed: ["CPSC 131"], ip: [] },
  },

  {
    name: "14_nested_table_guard",
    html: `<!doctype html><html><body>
      <table class="completedCourses"><tbody>
        <tr><td>FA24</td><td>CPSC 120</td><td>3.0</td><td>A</td><td></td></tr>
        <tr>
          <td colspan="5">
            <table class="completedCourses"><tbody>
              <tr><td>FA24</td><td>CPSC 999</td><td>3.0</td><td>A</td><td></td></tr>
            </tbody></table>
          </td>
        </tr>
      </tbody></table>
    </body></html>`,
    expect: { passed: ["CPSC 120"], ip: [] }, // CPSC 999 should NOT be counted
  },

  {
    name: "15_multiple_transcript_tables_union",
    html: makeHtmlDoc({
      tables: [
        makeTranscriptTable([{ term: "FA24", course: "CPSC 120", units: "3.0", grade: "A" }]),
        makeTranscriptTable([{ term: "SP25", course: "CPSC 121", units: "3.0", grade: "B" }]),
      ],
    }),
    expect: { passed: ["CPSC 120", "CPSC 121"], ip: [] },
  },

  {
    name: "16_no_tbody_fallback",
    html: makeHtmlDoc({
      tables: [
        makeTranscriptTable(
          [{ term: "FA24", course: "MATH 150A", units: "4.0", grade: "A" }],
          { withTbody: false }
        ),
      ],
    }),
    expect: { passed: ["MATH 150A"], ip: [] },
  },

  {
    name: "17_substitution_map_from_visible_text",
    html: makeHtmlDoc({
      tables: [
        makeTranscriptTable([{ term: "FA24", course: "CIST 4B", units: "3.0", grade: "A" }]),
      ],
      bodyTextBlocks: [
        "*CIST 4B SUBS CPSC 131*",
      ],
    }),
    expect: {
      passed: [],
      ip: [],
      subs: { "CPSC 131": "CIST 4B" },
    },
  },

  {
    name: "18_modern_GE_slot_1C_from_visible_text",
    html: makeHtmlDoc({
      tables: [
        makeTranscriptTable([{ term: "FA24", course: "COMM 100", units: "3.0", grade: "A" }]),
      ],
      bodyTextBlocks: [
        "GE 1C ORAL COMMUNICATION",
        "FA24 COMM 100 3.0 A",
      ],
    }),
    expect: {
      passed: ["COMM 100"],
      ip: [],
      ge: { isModern: true, items: { "1C": { code: "COMM 100", status: "complete" } } },
    },
  },

  {
    name: "19_tech_electives_completed_and_ip",
    html: makeHtmlDoc({
      tables: [
        makeTranscriptTable([
          { term: "FA24", course: "CPSC 481", units: "3.0", grade: "A" },
          { term: "SP25", course: "CPSC 485", units: "3.0", grade: "IP" },
        ]),
      ],
      bodyTextBlocks: [
        "TECHNICAL ELECTIVES",
        "FA24 CPSC 481 3.0 A",
        "SP25 CPSC 485 3.0 IP",
        "GRADE POINT", // end marker
      ],
    }),
    expect: {
      passed: ["CPSC 481"],
      ip: ["CPSC 485"],
      tech: { completed: ["CPSC 481"], ip: ["CPSC 485"] },
    },
  },

  {
    name: "20_GE6_overlay_CSU_CERT_attribute_only",
    html: makeHtmlDoc({
      tables: [
        // no transcript row for Area 6 on purpose
        makeTranscriptTable([{ term: "FA24", course: "CPSC 120", units: "3.0", grade: "A" }]),
      ],
      requirementPanels: [
        makeRequirementPanelGE6({
          include: true,
          completeSignal: "Requirement Complete",
          includeCertVisibleText: false,
          includeCertAttr: true,
          includeCourseRow: false,
        }),
      ],
      bodyTextBlocks: [
        // Include the header so GE parser chooses schema; overlay will fill items["6"] regardless.
        "GE AREA 6 ETHNIC STUDIES",
      ],
    }),
    expect: {
      passed: ["CPSC 120"],
      ip: [],
      ge: { items: { "6": { code: null, status: "complete", note: "F CSU CERT" } } },
    },
  },
];
