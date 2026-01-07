import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
} from "docx";

// Convert a human-authored DOCX into HTML we can traverse to rebuild bullets.
// This lets advising-note defaults live in per-program .docx files.
// Works in the browser and in Vitest/jsdom.
import mammoth from "mammoth/mammoth.browser";

/* ============================================================================
   Small utilities
============================================================================ */

const RED = "C00000";

/** Sum units across rows (ignores non-numeric). */
const sumUnits = (rows) =>
  (rows || []).reduce((acc, r) => acc + (Number.isFinite(r.units) ? r.units : 0), 0);

/** Safer string conversion */
const s = (v) => (v == null ? "" : String(v));

/** Hyperlink run */
const link = (url, label = url) =>
  new ExternalHyperlink({
    link: url,
    children: [new TextRun({ text: label, underline: {}, color: "0000EE" })],
  });

/** Common paragraph creators */
const para = (text, opts = {}) => new Paragraph({ text: s(text), ...opts });

const paraRuns = (children, opts = {}) => new Paragraph({ children, ...opts });

/** Bullet paragraph (level 0 by default) */
const bullet = (children, level = 0) =>
  new Paragraph({
    bullet: { level },
    children: Array.isArray(children) ? children : [children],
  });

/* ============================================================================
   Notes bullets
   Prefer per-program Word templates (editable by advisors) stored at:
     public/notes/<PROGRAM>.docx
   Example: public/notes/EGCP.docx, public/notes/CPEI.docx
============================================================================ */

const NOTES_TEMPLATE_BASE = BLOB_URL + "/notes";

// Cache parsed bullets so repeated "Gen Notes" clicks don't re-fetch/re-parse.
const NOTES_CACHE = new Map();

const isProbablyUrl = (t) => /^https?:\/\//i.test(t);
const isProbablyEmail = (t) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);

/**
 * Convert a DOM node subtree to docx TextRuns/ExternalHyperlinks.
 * Keeps <strong> as bold and <a href> as clickable links.
 */
function domToRuns(node, inherited = {}) {
  const runs = [];

  const walk = (n, style) => {
    if (!n) return;

    // Text node
    if (n.nodeType === 3) {
      const t = (n.nodeValue || "").replace(/\s+/g, " ");
      if (t.trim().length) runs.push(new TextRun({ text: t, ...style }));
      return;
    }

    // Element node
    if (n.nodeType !== 1) return;
    const tag = n.tagName.toLowerCase();

    if (tag === "strong" || tag === "b") {
      Array.from(n.childNodes).forEach((c) => walk(c, { ...style, bold: true }));
      return;
    }

    if (tag === "a") {
      const href = n.getAttribute("href") || "";
      const label = (n.textContent || href).trim();
      if (href) {
        runs.push(link(href, label));
      } else if (label) {
        runs.push(new TextRun({ text: label, ...style }));
      }
      return;
    }

    // Default: recurse
    Array.from(n.childNodes).forEach((c) => walk(c, style));
  };

  walk(node, inherited);
  return runs;
}

/**
 * Loads bullets from a per-program .docx and returns an array of Paragraphs.
 * If the template is missing or fails to parse, returns null.
 */
async function makeNotesBulletsFromTemplate(programId) {
  if (!programId) return null;

  if (NOTES_CACHE.has(programId)) return NOTES_CACHE.get(programId);

  const url = `${NOTES_TEMPLATE_BASE}/${programId}.docx`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();

    const { value: html } = await mammoth.convertToHtml({ arrayBuffer });
    const dom = new DOMParser().parseFromString(html || "", "text/html");

    const out = [];

    // Mammoth typically produces <ul><li>..., but handle the simpler case too.
    const walkList = (listEl, depth) => {
      const items = Array.from(listEl.children).filter((c) => c.tagName?.toLowerCase() === "li");
      for (const li of items) {
        // Create a shallow clone of the LI that excludes nested lists,
        // so the parent bullet text doesn't include child bullets.
        const liClone = li.cloneNode(true);
        Array.from(liClone.querySelectorAll("ul,ol")).forEach((n) => n.remove());

        const runs = domToRuns(liClone, {});
        // If mammoth didn't preserve hyperlinks, make bare URLs/emails clickable.
        // (Split by spaces and re-build runs.)
        const textOnly = liClone.textContent?.trim() || "";
        if (!runs.length && textOnly) {
          const parts = textOnly.split(/(\s+)/);
          for (const part of parts) {
            const p = part.trim();
            if (!p) {
              runs.push(new TextRun({ text: part }));
            } else if (isProbablyUrl(p)) {
              runs.push(link(p, p));
            } else if (isProbablyEmail(p)) {
              runs.push(link(`mailto:${p}`, p));
            } else {
              runs.push(new TextRun({ text: part }));
            }
          }
        }

        out.push(bullet(runs.length ? runs : [new TextRun({ text: textOnly })], depth));

        const childList = li.querySelector(":scope > ul, :scope > ol");
        if (childList) walkList(childList, depth + 1);
      }
    };

    const topLists = Array.from(dom.body.querySelectorAll("ul,ol"));
    if (topLists.length) {
      // Only treat top-level lists as the notes section; ignore nested lists
      // that are already handled by recursion.
      for (const listEl of topLists) {
        if (listEl.closest("li")) continue;
        walkList(listEl, 0);
      }
    } else {
      // Fallback: treat paragraphs/lines as level-0 bullets.
      const paras = Array.from(dom.body.querySelectorAll("p"));
      for (const p of paras) {
        const txt = (p.textContent || "").trim();
        if (txt) out.push(bullet([new TextRun({ text: txt })], 0));
      }
    }

    if (!out.length) return null;
    NOTES_CACHE.set(programId, out);
    return out;
  } catch (e) {
    // Missing template or parse error: fall back to the hard-coded bullets.
    return null;
  }
}

function makeNotesBulletsFixed() {
  return [
    // • ADD NOTES HERE
    bullet([new TextRun({ text: "ADD NOTES HERE" })], 0)
  ];
}

/**
 * Public entry: use per-program templates when available.
 */
async function makeNotesBullets(programId) {
  return (await makeNotesBulletsFromTemplate(programId)) || makeNotesBulletsFixed();
}

/* ============================================================================
   Schedule table builders
============================================================================ */

/**
 * Builds a 4-column table:
 *   [Left Term Course | Units] [Right Term Course | Units]
 * Used for (Fall vs Spring) and optionally (Summer vs Winter).
 */
function makeScheduleTable(leftTitle, leftRows, rightTitle, rightRows) {
  const headerRow = new TableRow({
    children: [
      new TableCell({
        columnSpan: 2,
        children: [
          paraRuns([new TextRun({ text: leftTitle, bold: true })], {
            alignment: AlignmentType.CENTER,
            spacing: { after: 60 },
          }),
        ],
      }),
      new TableCell({
        columnSpan: 2,
        children: [
          paraRuns([new TextRun({ text: rightTitle, bold: true })], {
            alignment: AlignmentType.CENTER,
            spacing: { after: 60 },
          }),
        ],
      }),
    ],
  });

  const th = (label) =>
    new TableCell({
      children: [
        paraRuns([new TextRun({ text: label, bold: true })], { alignment: AlignmentType.CENTER }),
      ],
    });

  const subHeaderRow = new TableRow({
    children: [th("Course"), th("Units"), th("Course"), th("Units")],
  });

  const n = Math.max(leftRows.length, rightRows.length);

  const bodyRows = Array.from({ length: n }, (_, i) => {
    const L = leftRows[i] || { code: "", units: "" };
    const R = rightRows[i] || { code: "", units: "" };

    return new TableRow({
      children: [
        new TableCell({ children: [para(L.code || "")] }),
        new TableCell({ children: [para(L.units || "")] }),
        new TableCell({ children: [para(R.code || "")] }),
        new TableCell({ children: [para(R.units || "")] }),
      ],
    });
  });

  const totalsRow = new TableRow({
    children: [
      new TableCell({ children: [paraRuns([new TextRun({ text: "Total", bold: true })])] }),
      new TableCell({ children: [para(`${sumUnits(leftRows)}`)] }),
      new TableCell({ children: [paraRuns([new TextRun({ text: "Total", bold: true })])] }),
      new TableCell({ children: [para(`${sumUnits(rightRows)}`)] }),
    ],
  });

  return new Table({
    // total = 9,160 twips (< 9,360), fits portrait w/ 1" margins
    columnWidths: [3700, 880, 3700, 880],
    layout: TableLayoutType.FIXED,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: "cccccc" },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: "cccccc" },
      left: { style: BorderStyle.SINGLE, size: 1, color: "cccccc" },
      right: { style: BorderStyle.SINGLE, size: 1, color: "cccccc" },
      insideH: { style: BorderStyle.SINGLE, size: 1, color: "eeeeee" },
      insideV: { style: BorderStyle.SINGLE, size: 1, color: "eeeeee" },
    },
    rows: [headerRow, subHeaderRow, ...bodyRows, totalsRow],
  });
}

/* ============================================================================
   Public API
============================================================================ */

/**
 * Generate the advising notes document as a Blob.
 * Reads *planned* courses from labels (non-struck).
 *
 * @param {Object} args
 * @param {string} args.programId
 * @param {Object<string,string>} args.labels   courseId -> "Fall" | "Spr" | "Sum" | "Win" | ...
 * @param {Array<Object>} args.coursesProp
 * @returns {Promise<Blob|undefined>}
 */
export async function generateAdvisingDoc({ programId, labels, coursesProp, returnType = "blob" }) {
  // Choose left vs right schedule columns (Fall vs Spring)
  const which = window.confirm("Generate notes for Fall? (Cancel for Spring)") ? "Fall" : "Spring";
  const isSpring = which.toLowerCase().startsWith("s");

  // Gather planned courses from labels
  const bySem = { Fall: [], Spr: [], Sum: [], Win: [] };
  for (const c of coursesProp || []) {
    const sem = labels?.[c.id];
    if (!sem || sem === "__strike__") continue;
    if (!bySem[sem]) continue; // ignore other labels
    bySem[sem].push({ code: c.code || c.id, units: Number(c.units) || 0 });
  }

  // Sort courses alphabetically per term (optional)
  Object.values(bySem).forEach((arr) => arr.sort((a, b) => String(a.code).localeCompare(String(b.code))));

  // Select which term goes on left/right
  const leftTitle = isSpring ? "Spring" : "Fall";
  const rightTitle = isSpring ? "Fall" : "Spring";
  const leftRows = isSpring ? bySem.Spr : bySem.Fall;
  const rightRows = isSpring ? bySem.Fall : bySem.Spr;

  const PROGRAM_TITLES = {
    EGCP: "Computer Engineering",
    CPEI: "BS-MS Computer Engineering",
    EGEE: "Electrical Engineering",
    EGME: "Mechanical Engineering",
    EGCE: "Civil Engineering",
    CPSC: "Computer Science"
  };

  const programTitle =
    PROGRAM_TITLES[programId] ?? `${programId} Program`;

  const doc = new Document({
    sections: [
      {
        children: [
          // Header
          paraRuns([new TextRun({ text: "University", bold: true, size: 32 })], {
            alignment: AlignmentType.CENTER,
          }),
          paraRuns([new TextRun({ text: `${programTitle} Advising Notes` })], {
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 },
          }),

          // Student info
          paraRuns([new TextRun({ text: "Name:", bold: true }), new TextRun({ text: " " })]),
          paraRuns([new TextRun({ text: "Date: ", bold: true }), new TextRun({ text: new Date().toLocaleDateString() })]),
          paraRuns([new TextRun({ text: "Student ID:", bold: true }), new TextRun({ text: " " })]),

          // Schedule
          paraRuns([new TextRun({ text: "Tentative Schedule:", bold: true, underline: {} })], { spacing: { before: 200 } }),
          makeScheduleTable(leftTitle, leftRows, rightTitle, rightRows),

          ...(bySem.Sum.length || bySem.Win.length
            ? [para(" "), makeScheduleTable("Summer", bySem.Sum, "Winter", bySem.Win)]
            : []),

          para(" "),

          // Notes
          paraRuns([new TextRun({ text: "Notes:", bold: true, underline: {} })], { spacing: { before: 200 } }),
          ...(await makeNotesBullets(programId)),
        ]
      },
    ],
  });

  // Always wrap as a Blob for the UI.
  // Works in browsers and Vitest (jsdom), and the bytes will be a real DOCX zip.
  if (returnType === "buffer") {
    return await Packer.toBuffer(doc);;
  } else {
    return await Packer.toBlob(doc);
  }
}
