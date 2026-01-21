import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  normCode,  parseDeptNumPart,
  EQUIV,
  isPlaceholderAL,
} from "./tda/textUtils";
import { parseTdaEvidenceFromHtml } from "./tda/htmlEvidence";
import { generateAdvisingDoc } from "./docx/genNotes";
import { 
  NODE,
  rectFor,
  trackRouter
} from "./graph/trackRouter";
import { checkPlan } from "./graph/checkPlan";

// NOTE: PDF import removed in favor of HTML-based imports for reliability.

/* ============================================================================
   CONFIG / CONSTANTS
============================================================================ */

// Labels that count as “scheduled / planned / taken”
const SEASONALS = new Set(["Fall", "Spr", "Sum", "Win", "Com. College", "In Prog."]);

// Program display names
const programNames = {
  EGCP: "Comp. Eng.",
  EGEE: "EE",
  CPEI: "Comp. Eng. BS-MS",
  EGME: "ME"
};

// Node category colors (tailwind classes)
// Default (fallback) colors. These are overridden at runtime by the Vercel Blob JSON.
const CAT_DEFAULT = {
  ME: "fill-teal-100 stroke-teal-400",
  ECE: "fill-red-100 stroke-red-400",
  CS: "fill-green-100 stroke-green-400",
  GE: "fill-blue-100 stroke-blue-400",
  "Tech Elective": "fill-fuchsia-100 stroke-fuchsia-400",
  "Sci & Math": "fill-amber-100 stroke-amber-400",
  Grad: "fill-slate-100 stroke-slate-400",
  Other: "fill-orange-100 stroke-orange-400"
};

// Legend chip styles
// Default (fallback) legend styles. These are overridden at runtime by the Vercel Blob JSON.
const CAT_LEGEND_DEFAULT = {
  ME: { bg: "bg-teal-100", border: "border-teal-400", text: "text-teal-800" },
  ECE: { bg: "bg-red-100", border: "border-red-400", text: "text-red-800" },
  CS: { bg: "bg-green-100", border: "border-green-400", text: "text-green-800" },
  GE: { bg: "bg-blue-100", border: "border-blue-400", text: "text-blue-800" },
  "Tech Elective": { bg: "bg-fuchsia-100", border: "border-fuchsia-400", text: "text-fuchsia-800" },
  "Sci & Math": { bg: "bg-amber-100", border: "border-amber-400", text: "text-amber-900" },
  Grad: { bg: "bg-slate-100", border: "border-slate-400", text: "text-slate-800" },
  Other: { bg: "bg-orange-100", border: "border-orange-400", text: "text-orange-800" }
};

// Allow specific GE courses to be struck by TDA import (exceptions)
const ALLOW_GE = new Set(["ENGL 101", "POSC 100"]);

// Used to detect if some node is a *specific course* vs a generic GE placeholder
const COURSE_CODE_RX = /\b([A-Z]{2,6})[-\s]?(\d{3,4}[A-Z]?L?)\b/;

/* ============================================================================
   SMALL UI HELPERS
============================================================================ */

function Legend({ present, catLegend }) {
  const entries = Object.entries(catLegend || {}).filter(([label]) => !present || present.has(label));
  if (!entries.length) return null;

  return (
    <div className="flex flex-wrap items-center gap-3" role="list" aria-label="Category legend">
      {entries.map(([label, cls]) => (
        <div key={label} role="listitem" className="flex items-center gap-2">
          <span aria-hidden="true" className={["inline-block w-4 h-4 rounded-md border", cls.bg, cls.border].join(" ")} />
          <span className={["text-xs font-medium", cls.text].join(" ")}>{label}</span>
        </div>
      ))}
    </div>
  );
}

const truncate = (s = "", n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/* ============================================================================
   FLOWCHART NODE IDENTIFICATION
============================================================================ */

function nodeLabel(n) {
  return (
    n.code ||
    n.title ||
    n.name ||
    n.shortTitle ||
    n.displayName ||
    n.subtitle ||
    ""
  );
}

function normLoose(s) {
  return (s || "").replace(/[\s-]+/g, "").toUpperCase();
}

// Dedicated ENGL-101 / POSC-100 boxes (exclude from generic GE matching)
function isExcludedFixedGeNode(n) {
  const lbl = normLoose(nodeLabel(n));
  return lbl.includes("ENGL101") || lbl.includes("POSC100");
}

// Detect a generic “GE placeholder” box (not a specific course box)
function isGenericGeNode(n) {
  if (isExcludedFixedGeNode(n)) return false;
  const lbl = nodeLabel(n);

  if (/\bGE\b/i.test(lbl) || /General\s*Ed/i.test(lbl)) return true;
  if (COURSE_CODE_RX.test(lbl)) return false;
  return false;
}

// Only strike non-GE / non-Tech Elective, except whitelisted GE nodes
function isEligibleFlowCourse(c) {
  if (!c) return false;
  const code = normCode(c.code || c.id);
  if (ALLOW_GE.has(code)) return true;
  return c.category !== "GE" && c.category !== "Tech Elective";
}

/* ============================================================================
   EQUIVALENCY / MATCHING HELPERS (CPSC 120/121 etc.)
============================================================================ */

// "IP" match logic that handles combined-vs-parts (120 vs 120A/L)
function isIpMatch(flowCode, ipSet) {
  const n = normCode(flowCode);
  const parsed = parseDeptNumPart(n);
  if (!parsed) return false;

  const key = `${parsed.dept} ${parsed.num}`;
  const eq = EQUIV[key];

  // normal: direct
  if (!eq) return ipSet.has(n);

  // flow shows combined or placeholder (e.g. "CPSC 120" or "CPSC 120A/L")
  if (parsed.part === "" || isPlaceholderAL(n)) {
    return ipSet.has(eq.combined) || ipSet.has(eq.parts[0]) || ipSet.has(eq.parts[1]);
  }

  // flow shows a part (A or L): part OR combined implies IP
  const thisPart = `${parsed.dept} ${parsed.num}${parsed.part}`;
  return ipSet.has(thisPart) || ipSet.has(eq.combined);
}

// Passed match that handles combined-vs-parts
function isSatisfiedWithEquivs(flowCode, passedSet) {
  const n = normCode(flowCode);
  const parsed = parseDeptNumPart(n);
  if (!parsed) return false;

  const key = `${parsed.dept} ${parsed.num}`;
  const eq = EQUIV[key];

  if (!eq) return passedSet.has(n);

  // flow shows combined (e.g. "CPSC 120") -> combined OR both parts
  if (parsed.part === "" && !isPlaceholderAL(n)) {
    return passedSet.has(eq.combined) ||
      (passedSet.has(eq.parts[0]) && passedSet.has(eq.parts[1]));
  }

  // flow shows placeholder "CPSC 120A/L"
  if (isPlaceholderAL(n)) {
    return passedSet.has(eq.combined) ||
      (passedSet.has(eq.parts[0]) && passedSet.has(eq.parts[1]));
  }

  // flow shows part -> that part OR combined
  const thisPart = `${parsed.dept} ${parsed.num}${parsed.part}`;
  return passedSet.has(thisPart) || passedSet.has(eq.combined);
}

// Parse dept & number like "EGEC 280"
function parseDeptNum(code = "") {
  const m = /^([A-Z]{2,5})\s+(\d{3}[A-Z]?L?)$/i.exec(normCode(code));
  return m ? { dept: m[1], num: m[2] } : null;
}

// For EGEC ### on chart, allow EGCP/EGEE ### in TDA
function egecAlternates(code = "") {
  const dn = parseDeptNum(code);
  if (!dn || dn.dept !== "EGEC") return [];
  return [
    normCode(`EGCP ${dn.num}`),
    normCode(`EGEE ${dn.num}`),
    normCode(`EGCE ${dn.num}`),
    normCode(`EGME ${dn.num}`),
  ];
}

/* ============================================================================
   OFFERING CHECK HELPERS
============================================================================ */

const normalizeSeason = (s = "") => {
  const t = String(s).trim().toLowerCase();
  if (!t) return "";
  if (t.startsWith("fa")) return "Fall";
  if (t.startsWith("sp") || t.startsWith("sr")) return "Spr";
  if (t.startsWith("su")) return "Sum";
  if (t.startsWith("wi")) return "Win";
  if (t.startsWith("com")) return "Com. College";
  if (t.startsWith("in")) return "In Prog.";
  return "";
};

const parseOffering = (off) => {
  if (!off) return new Set();
  const toks = String(off)
    .split(/[^A-Za-z]+/)
    .map(normalizeSeason)
    .filter(Boolean);
  return new Set(toks);
};

/* ============================================================================
   MAIN COMPONENT
============================================================================ */

export default function ProgramMap({ programId = "EGCP", termsProp, coursesProp }) {
  /* ----------------------------
     React state
  ---------------------------- */
  const [focus, setFocus] = useState(null);

  // labels: courseId -> "Fall" | "Spr" | "In Prog." | "__strike__" | ...
  const [labels, setLabels] = useState({});
  // notes: courseId -> string
  const [notes, setNotes] = useState({});

  // inline editor: { id, value, x, y, w, h } or null
  const [editor, setEditor] = useState(null);

  // Excel file handle (optional)
  const [fileHandle, setFileHandle] = useState(null);


  /* ----------------------------
    Category color configuration (Vercel Blob)
    - We keep defaults in code (CAT_DEFAULT / CAT_LEGEND_DEFAULT)
    - We fetch an override JSON from Vercel Blob at runtime
    - If the fetch fails or JSON is incomplete, we fall back to defaults
  ---------------------------- */
  const CATEGORY_COLORS_URL = BLOB_URL + "/configs/categoryColors.json";

  // Loaded JSON (shape: { [category]: { node: string, legend: {bg,border,text} } })
  const [catCfg, setCatCfg] = useState(null);

  // Load config once on mount
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // Optional cache-bust so updates propagate quickly even if a CDN caches the URL.
        const url = `${CATEGORY_COLORS_URL}?v=${Date.now()}`;

        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`Category colors fetch failed: HTTP ${res.status}`);

        const json = await res.json();
        if (!cancelled) setCatCfg(json);
      } catch (e) {
        console.warn("Failed to load categoryColors.json from Blob; using defaults.", e);
        if (!cancelled) setCatCfg(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Derived runtime CAT map used by nodes (merged with defaults for safety)
  const CAT = useMemo(() => {
    if (!catCfg) return CAT_DEFAULT;
    const out = { ...CAT_DEFAULT };
    for (const [k, v] of Object.entries(catCfg)) {
      if (v?.node) out[k] = v.node;
    }
    return out;
  }, [catCfg]);

  // Derived runtime legend styles (merged with defaults for safety)
  const CAT_LEGEND = useMemo(() => {
    if (!catCfg) return CAT_LEGEND_DEFAULT;
    const out = { ...CAT_LEGEND_DEFAULT };
    for (const [k, v] of Object.entries(catCfg)) {
      if (v?.legend) out[k] = v.legend;
    }
    return out;
  }, [catCfg]);

  /* ----------------------------
     Derived data
  ---------------------------- */
  const map = useMemo(
    () => Object.fromEntries(coursesProp.map((c) => [c.id, c])),
    [coursesProp]
  );

  const usedCategories = useMemo(
    () => new Set(coursesProp.map((c) => c.category).filter(Boolean)),
    [coursesProp]
  );

  const programLabel = programNames[programId] || "Program";

  const width = termsProp.length * NODE.gapX + 2 * NODE.colPadSide;
  const height = Math.max(
    700,
    (1 + Math.max(0, ...coursesProp.map((c) => c.row))) * (NODE.height + NODE.gapY) +
      NODE.colPadTop +
      80
  );

  /* ============================================================================
     EXCEL SAVE/LOAD HELPERS
  ============================================================================ */

  const buildRows = () =>
    coursesProp.map((c) => ({
      programId,
      courseId: c.id,
      label: labels[c.id] ?? "",
      note: notes[c.id] ?? "",
    }));

  const applyRows = (rows) => {
    const newLabels = {};
    const newNotes = {};
    for (const r of rows) {
      if (String(r.programId) !== String(programId)) continue;
      if (r.label) newLabels[r.courseId] = String(r.label);
      if (r.note) newNotes[r.courseId] = String(r.note);
    }
    setLabels((prev) => ({ ...prev, ...newLabels }));
    setNotes((prev) => ({ ...prev, ...newNotes }));
  };

  const makeWorkbook = () => {
    const ws = XLSX.utils.json_to_sheet(buildRows());
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "FlowState");
    return wb;
  };

  const workbookToBlob = (wb) =>
    new Blob([XLSX.write(wb, { bookType: "xlsx", type: "array" })], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

  const writeToHandle = async (handle, blob) => {
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
  };

  const saveExcel = async () => {
    try {
      const wb = makeWorkbook();
      const blob = workbookToBlob(wb);

      // If we don't already have a handle, prompt once (Save As…) and store it.
      let handle = fileHandle;
      if (!handle) {
        if (!("showSaveFilePicker" in window)) {
          // Fallback to download if API not supported
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `flowstate_${programId}.xlsx`;
          a.click();
          URL.revokeObjectURL(url);
          alert("Downloaded flowstate file ✅");
          return;
        }

        handle = await window.showSaveFilePicker({
          suggestedName: `flowstate_${programId}.xlsx`,
          types: [
            {
              description: "Excel Workbook",
              accept: {
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
              },
            },
          ],
        });

        setFileHandle(handle); // ✅ key change
      }

      // Optional: ensure we have write permission (some browsers require this)
      if (handle.requestPermission) {
        const perm = await handle.requestPermission({ mode: "readwrite" });
        if (perm !== "granted") return;
      }

      await writeToHandle(handle, blob);
      alert("Saved ✅");
    } catch (e) {
      // If user cancels the picker, you'll land here too; that's fine.
      console.error("Save failed:", e);
      alert("Save failed. See console for details.");
    }
  };

  const loadExcelFromPicker = async () => {
    try {
      if (!("showOpenFilePicker" in window)) {
        alert("Your browser doesn’t support direct file open. Use Chrome/Edge for best results.");
        return;
      }

      const [handle] = await window.showOpenFilePicker({
        types: [
          {
            description: "Excel Workbook",
            accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] },
          },
        ],
      });

      setFileHandle(handle);

      const file = await handle.getFile();
      const ab = await file.arrayBuffer();
      const wb = XLSX.read(ab, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet);

      // Reset first, then apply
      setLabels({});
      setNotes({});
      setEditor(null);
      setFocus(null);
      applyRows(rows);
    } catch (e) {
      console.error("Load failed:", e);
    }
  };

  /* ============================================================================
     UI: LABEL CYCLING + INLINE NOTES EDITOR
  ============================================================================ */

  const nextLabel = (cur) => {
    if (cur === "Fall") return "Spr";
    if (cur === "Spr") return "In Prog.";
    if (cur === "In Prog.") return "Com. College";
    if (cur === "Com. College") return "Sum";
    if (cur === "Sum") return "Win";
    return cur === "Win" ? null : "Fall";
  };

  const cycleLabel = (id) => {
    setLabels((prev) => {
      const cur = prev[id] ?? null;
      const nxt = nextLabel(cur);
      if (nxt == null) {
        const { [id]: _omit, ...rest } = prev;
        return rest;
      }
      return { ...prev, [id]: nxt };
    });
  };

  const openEditor = (courseRect, id) => {
    const padding = 12;
    const x = courseRect.x + padding;
    const y = courseRect.y + padding;
    const w = courseRect.w - 2 * padding;
    const h = courseRect.h - 2 * padding;
    setEditor({ id, value: notes[id] ?? "", x, y, w, h });
  };

  const saveEditor = () => {
    if (!editor) return;
    const val = editor.value.trim();
    setNotes((prev) => {
      if (!val) {
        const { [editor.id]: _omit, ...rest } = prev;
        return rest;
      }
      return { ...prev, [editor.id]: val };
    });
    setEditor(null);
  };

  /* ============================================================================
     VALIDATION: CHECK PREREQS/COREQS + OFFERINGS
  ============================================================================ */

  const checkAllLabeledReqs = () => {
    const problems = checkPlan({ labels, map });
    if (!problems.length) alert("All checks passed ✅");
    else alert(problems.join("\n"));
  };


  /* ============================================================================
     DOCX: GENERATE ADVISING NOTES
  ============================================================================ */

  const genNotes = async () => {
    try {
      const blob = await generateAdvisingDoc({ programId, labels, notes, coursesProp });

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const today = new Date();
      const dateStr = `${today.getMonth() + 1}-${today.getDate()}-${today.getFullYear().toString().slice(-2)}`;
      a.href = url;
      a.download = `Advising ${dateStr}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (err) {
      console.error("Gen Notes failed:", err);
      alert("Gen Notes failed. See console for details.");
    }
  };

  /* ============================================================================
     TDA IMPORT
     - This uses *local* accumulators then does ONE setLabels/setNotes at the end.
  ============================================================================ */

  const fileInputRef = useRef(null);

  const importFromTDA = async () => {
    try {
      // Reset state first (fast + avoids merging old notes)
      setLabels({});
      setNotes({});
      setEditor(null);
      setFocus(null);

      if (!fileInputRef.current) return;

      const pick = await new Promise((resolve) => {
        fileInputRef.current.onchange = () => resolve(fileInputRef.current.files?.[0] || null);
        fileInputRef.current.click();
      });
      if (!pick) return;

      // 1) Read & parse
      // Prefer HTML exports: they preserve table structure and make transcript
      // rows (especially IP) far more reliable than PDF text extraction.
      const lower = pick.name.toLowerCase();
      const isHtml = lower.endsWith(".html") || lower.endsWith(".htm");

      let ev;
      if (isHtml) {
        const html = await pick.text();
        ev = parseTdaEvidenceFromHtml(html);
      } else {
        alert(
          "Please import an HTML TDA export (.html/.htm)\n\n" +
          "Tip: In the TDA portal, open the audit in the HTML view, then use your browser's Save Page As…"
        );
        return;
      }

      const allText = ev.normText;
      const passed = ev.passed;
      const ip = ev.ip;
      const subsMap = ev.subs;
      const geParsed = ev.ge;
      const tech = ev.tech;

      // --- Accumulators ---
      const nextLabels = {};
      const nextNotes = {};

      // 3) Apply IP to flow nodes

      const ipMatchedCodes = new Set();
      for (const c of coursesProp) {
        const flowCode = normCode(c.code || c.id);

        if (isIpMatch(flowCode, ip)) {
          nextLabels[c.id] = "In Prog.";
          ipMatchedCodes.add(flowCode);
          continue;
        }

        const alts = egecAlternates(flowCode);
        if (alts.length && alts.some((a) => ip.has(a))) {
          nextLabels[c.id] = "In Prog.";
          ipMatchedCodes.add(alts.find((a) => ip.has(a)));
        }
      }

      // 5) Tech electives (from evidence model)
      const teCompleted = tech?.completed || new Set();
      const teIp = tech?.ip || new Set();

      const techNodes = coursesProp.filter((c) => c.category === "Tech Elective");
      const isUnused = (id) => !nextNotes[id] && !nextLabels[id] && labels[id] !== "__strike__";
      const unusedIds = techNodes.map((t) => t.id).filter(isUnused);

      let teIdx = 0;
      for (const code of teCompleted) {
        if (teIdx >= unusedIds.length) break;
        const id = unusedIds[teIdx++];
        nextNotes[id] = code;
        nextLabels[id] = "__strike__";
      }
      for (const code of teIp) {
        if (teIdx >= unusedIds.length) break;
        const id = unusedIds[teIdx++];
        nextNotes[id] = code;
        nextLabels[id] = "In Prog.";
      }

      // 6) GE placeholders
      const geMap = geParsed.items;

      const targetCats = geParsed.isModern
        ? ["1C", "3A", "3B", "4B", "6", "3U/Z"]
        : ["A.1", "C.1", "C.2", "D.2", "F", "C.3/Z"];

      const geNodes = coursesProp.filter((c) => c.category === "GE");
      const genericGeNodes = geNodes.filter(isGenericGeNode);

      // Some flowcharts use *labeled* GE boxes (e.g., "GE 6", "GE 1C") instead
      // of a pile of identical "GE" placeholders. If we only "fill in order",
      // a satisfied Area 6 can end up assigned to the wrong box.
      const geLabeledBuckets = {};
      for (const cat of targetCats) geLabeledBuckets[cat] = [];
      for (const n of geNodes) {
        const lbl = String(n.label || n.code || n.id || "");
        for (const cat of targetCats) {
          // Match patterns like "GE 6", "GE Area 6", "GE 1C" (case-insensitive)
          const rx = new RegExp(
            `\\bGE\\b[^\\w]?\\s*(?:AREA\\s*)?${cat.replace("/", "\\/")}(?:\\b|\\s)`,
            "i"
          );
          if (rx.test(lbl)) {
            geLabeledBuckets[cat].push(n.id);
            break;
          }
        }
      }

      // Only fill empty GE placeholders (don’t clobber manually set)
      const openGeIds = genericGeNodes
        .map((n) => n.id)
        .filter((id) => !nextNotes[id] && !nextLabels[id]);

      const wants = { complete: [], IP: [], tentative: [], missing: [] };
      for (const cat of targetCats) {
        const rec = geMap[cat] || { code: null, status: null };
        if (rec.status === "complete") {
          // If a GE area is satisfied without a specific course code (e.g.
          // "MET with a CSU certified course"), prefer the parser's note.
          // Otherwise fall back to label/completed.
          const code =
            rec.code ??
            rec.note ??
            (/\bwaived\b/i.test(rec.label || "") ? "Waived" : (rec.label || "Completed"));
          wants.complete.push({ cat, code });
        } else if (rec.status === "IP" && rec.code) {
          wants.IP.push({ cat, code: rec.code });
        } else if (rec.status === "tentative") {
          const code = rec.code ?? rec.note ?? rec.label ?? "Completed";
          wants.tentative.push({ cat, code, note: rec.note || null });
        } else {
          wants.missing.push({ cat });
        }
      }

      const consumeGe = () => openGeIds.shift();

      // Prefer a specifically-labeled GE node for the category (if available);
      // otherwise fall back to the generic pool.
      const consumeGeForCat = (cat) => {
        const bucket = geLabeledBuckets[cat] || [];
        // pick the first unused id
        while (bucket.length) {
          const id = bucket.shift();
          if (id && !nextNotes[id] && !nextLabels[id]) return id;
        }
        return consumeGe();
      };

      // Completed GE: strike + note
      for (const it of wants.complete) {
        const id = consumeGeForCat(it.cat);
        if (!id) break;
        nextNotes[id] = it.code ? `${it.code} (${it.cat})` : `${it.cat} (Waived)`;
        nextLabels[id] = "__strike__";
      }

      // IP GE: label + note
      for (const it of wants.IP) {
        const id = consumeGeForCat(it.cat);
        if (!id) break;
        nextNotes[id] = `${it.code} (${it.cat})`;
        nextLabels[id] = "In Prog.";
      }

      // Tentative GE: label + explicit review note
      for (const it of wants.tentative) {
        const id = consumeGeForCat(it.cat);
        if (!id) break;
        /*
        const review = it.note ? ` — Review: ${it.note}` : " — Review";
        nextNotes[id] = `${it.code} (${it.cat})${review}`;
        nextLabels[id] = "Review";
        */
        nextNotes[id] = it.note || "";
        nextLabels[id] = "Review";
      }

      // Missing GE: just the category tag
      for (const it of wants.missing) {
        const id = consumeGeForCat(it.cat);
        if (!id) break;
        nextNotes[id] = `${it.cat}`;
      }

      // 7) Strike completed major/non-GE/non-TE nodes
      const toStrikeIds = [];

      for (const c of coursesProp.filter(isEligibleFlowCourse)) {
        const flowCode = normCode(c.code || c.id);

        if (isSatisfiedWithEquivs(flowCode, passed)) {
          toStrikeIds.push(c.id);
          continue;
        }

        if (passed.has(flowCode)) {
          toStrikeIds.push(c.id);
          continue;
        }

        const alts = egecAlternates(flowCode);
        if (alts.length && alts.some((a) => passed.has(a))) {
          toStrikeIds.push(c.id);
          continue;
        }
      }

      for (const id of toStrikeIds) nextLabels[id] = "__strike__";

      // 8) Apply substitution notes on struck nodes (don’t overwrite existing note)
      if (subsMap && Object.keys(subsMap).length) {
        const struckSet = new Set(toStrikeIds);
        for (const c of coursesProp.filter(isEligibleFlowCourse)) {
          if (!struckSet.has(c.id)) continue;
          const flowCode = normCode(c.code || c.id);
          const subLabel = subsMap[flowCode];
          if (subLabel && !nextNotes[c.id]) {
            nextNotes[c.id] = subLabel;
          }
        }
      }

      // 9) Commit in ONE shot
      setLabels(nextLabels);
      setNotes(nextNotes);

      // 9) Commit in ONE shot
      setLabels(nextLabels);
      setNotes(nextNotes);

      // Count everything we actually struck so the alert matches
      const totalStruck = Object.values(nextLabels).filter((v) => v === "__strike__").length;

      alert(
        `Imported TDA - Struck: ${totalStruck}\n\n` +
        `NOTE: Import doesn't always work reliably\n` +
        `Please double-check that the import is correct`
      );
    } catch (err) {
      console.error("Import failed:", err);
      alert("Import failed. Check console for details.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  /* ============================================================================
     FOCUS MODE: EDGE COMPUTATION
  ============================================================================ */

  const parents = new Set();
  const children = new Set();

  if (focus && map[focus]) {
    for (const p of map[focus].prereqs || []) parents.add(p);
    for (const c of map[focus].coreqs || []) parents.add(c);

    for (const c of coursesProp) {
      const pre = c.prereqs || [];
      const co = c.coreqs || [];
      if (pre.includes(focus) || co.includes(focus)) children.add(c.id);
    }
  }

  const isActiveId = (id) => !focus || id === focus || parents.has(id) || children.has(id);

  const edges = [];
  if (focus && map[focus]) {
    const target = map[focus];

    // Incoming edges
    const incoming = [
      ...(target.prereqs || []).map((id) => ({ id, type: "prereq" })),
      ...(target.coreqs || []).map((id) => ({ id, type: "coreq" })),
    ]
      .map((r) => ({ ...r, from: map[r.id] }))
      .filter((r) => !!r.from);

    const adjSameRowIn = incoming.filter(
      (r) => r.from.row === target.row && Math.abs(target.term - r.from.term) === 1
    );

    incoming.forEach((r) => {
      const inAdj = r.from.row === target.row && Math.abs(target.term - r.from.term) === 1;
      const idx = inAdj ? adjSameRowIn.findIndex((q) => q.id === r.id) : -1;
      let obstacles = [];

      if (r.from.row !== target.row) {
        const lo = Math.min(r.from.term, target.term);
        const hi = Math.max(r.from.term, target.term);
        obstacles = coursesProp.filter((cc) => cc.term > lo && cc.term < hi).map(rectFor);
      }

      edges.push({ dir: "into", from: r.from, to: target, type: r.type, idx, n: inAdj ? adjSameRowIn.length : 0, obstacles });
    });

    // Outgoing edges
    const outsRaw = coursesProp
      .filter((c) => (c.prereqs || []).includes(focus) || (c.coreqs || []).includes(focus))
      .flatMap((to) => {
        const isPrereq = (to.prereqs || []).includes(focus);
        const isCoreq = (to.coreqs || []).includes(focus);
        const types = [];
        if (isPrereq) types.push("prereq");
        if (isCoreq && !isPrereq) types.push("coreq");
        return types.map((type) => ({ to, type }));
      });

    const adjSameRowOut = outsRaw.filter(
      (r) => r.to.row === target.row && Math.abs(r.to.term - target.term) === 1
    );

    outsRaw.forEach((r) => {
      const inAdj = r.to.row === target.row && Math.abs(r.to.term - target.term) === 1;
      const idx = inAdj ? adjSameRowOut.findIndex((q) => q.to.id === r.to.id && q.type === r.type) : -1;

      let obstacles = [];
      if (r.to.row !== target.row) {
        const lo = Math.min(target.term, r.to.term);
        const hi = Math.max(target.term, r.to.term);
        obstacles = coursesProp.filter((cc) => cc.term > lo && cc.term < hi).map(rectFor);
      }

      edges.push({ dir: "out", from: target, to: r.to, type: r.type, idx, n: inAdj ? adjSameRowOut.length : 0, obstacles });
    });
  }

  /* ============================================================================
     RENDER
  ============================================================================ */

  return (
    <div className="w-screen min-h-[100svh] bg-white text-slate-900 flex flex-col">
      {/* Top bar */}
      <div className="p-3 border-b flex items-center justify-between gap-3">
        <div className="font-semibold text-sm">
          <img src="/courseflow_logo_horz.png" width="200" alt="CourseFlow" />
          {programLabel} Interactive Flowchart
        </div>

        <Legend present={usedCategories} catLegend={CAT_LEGEND} />

        <div className="flex items-center gap-2">
          <button className="px-2 py-1 border rounded" onClick={() => window.location.reload()}>New</button>
          <button className="px-2 py-1 border rounded" onClick={checkAllLabeledReqs}>Check</button>
          <button className="px-2 py-1 border rounded" onClick={genNotes}>Gen Notes</button>
          <button className="px-2 py-1 border rounded" onClick={loadExcelFromPicker}>Load</button>
          <button className="px-2 py-1 border rounded" onClick={saveExcel}>Save</button>

          <button className="px-2 py-1 border rounded" onClick={importFromTDA}>Import</button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".html,.htm"
            style={{ display: "none" }}
          />

          <button
            className="px-2 py-1 border rounded"
            onClick={() => window.open("/CourseFlow_Handout.pdf", "_blank")}
          >
            Help
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div className="relative flex-1 overflow-hidden cursor-grab select-none">
        <svg
          className="absolute inset-0"
          width="100%"
          height="100%"
          viewBox={`0 0 ${width} ${height}`}
          overflow="visible"
        >
          <g>
            {/* Click-away: clear focus and close editor */}
            <rect
              x="0"
              y="0"
              width={width}
              height={height}
              fill="transparent"
              onClick={(e) => {
                e.stopPropagation();
                setFocus(null);
                if (editor) setEditor(null);
              }}
            />

            {/* Column headers */}
            {termsProp.map((t, i) => {
              const x = i * NODE.gapX + NODE.colPadSide;
              return (
                <g key={t.id}>
                  <rect rx="12" ry="12" x={x} y={0} width={NODE.width} height={50} className="fill-slate-50 stroke-slate-800" />
                  <text x={x + NODE.width / 2} y={32} textAnchor="middle" className="font-semibold fill-slate-800 text-[24px]">
                    {t.label}
                  </text>
                </g>
              );
            })}

            {/* Course nodes */}
            {coursesProp.map((c) => {
              const r = rectFor(c);
              const fx = Math.round(r.x), fy = Math.round(r.y), fw = Math.round(r.w), fh = Math.round(r.h);
              const tx = fx + 16;
              const ty = fy + 16;
              const active = isActiveId(c.id);

              return (
                <g key={c.id}>
                  <rect
                    x={fx}
                    y={fy}
                    rx="14"
                    ry="14"
                    width={fw}
                    height={fh}
                    className={`stroke-2 ${CAT[c.category]} ${focus && !active ? "opacity-35" : "opacity-100"}`}
                  />

                  {/* base text */}
                  <text x={tx} y={ty} className="fill-slate-900" style={{ fontSize: 22, lineHeight: 1.2 }} dominantBaseline="text-before-edge">
                    <tspan className="font-semibold">{c.code}</tspan>
                    <tspan x={tx} dy={24}>{truncate(c.title, 28)}</tspan>
                    <tspan x={tx} dy={24}>{c.units} unit{c.units === 1 ? "" : "s"}</tspan>
                    {c.offering && (
                      <tspan className="fill-red-700 font-semibold" x={tx} dy={24}>
                        {c.offering} Only
                      </tspan>
                    )}
                    {c.notes && (
                      <tspan className="fill-red-700 font-semibold" x={tx} dy={24}>
                        {truncate(c.notes, 28)}
                      </tspan>
                    )}
                  </text>

                  {/* user note (top-right) */}
                  {notes[c.id] && (
                    <text
                      x={fx + fw - 10}
                      y={fy + 24}
                      textAnchor="end"
                      className="fill-red-700 font-semibold"
                      style={{ fontSize: 22 }}
                    >
                      {notes[c.id]}
                    </text>
                  )}

                  {/* label (bottom-right) */}
                  {labels[c.id] && labels[c.id] !== "__strike__" && (
                    <text
                      x={fx + fw - 10}
                      y={fy + fh - 10}
                      textAnchor="end"
                      className="fill-red-700 font-semibold"
                      style={{ fontSize: 22 }}
                    >
                      {labels[c.id]}
                    </text>
                  )}

                  {/* strike line */}
                  {labels[c.id] === "__strike__" && (
                    <line
                      x1={fx + 6}
                      y1={fy + 6}
                      x2={fx + fw - 6}
                      y2={fy + fh - 6}
                      className="stroke-red-700"
                      strokeWidth={4}
                      strokeLinecap="round"
                      pointerEvents="none"
                    />
                  )}

                  {/* hitbox */}
                  <rect
                    x={r.x}
                    y={r.y}
                    width={r.w}
                    height={r.h}
                    fill="transparent"
                    onClick={(e) => {
                      e.stopPropagation();

                      // Alt+Click → inline note editor
                      if (e.altKey) {
                        openEditor(r, c.id);
                        return;
                      }

                      // Ctrl+Click → cycle schedule label
                      if (e.ctrlKey) {
                        cycleLabel(c.id);
                        return;
                      }

                      // Click → focus toggle (prereqs/coreqs)
                      setFocus((f) => (f === c.id ? null : c.id));
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();

                      // Right click → toggle strike
                      setLabels((prev) => {
                        const cur = prev[c.id];
                        if (cur === "__strike__") {
                          const { [c.id]: _omit, ...rest } = prev;
                          return rest;
                        }
                        return { ...prev, [c.id]: "__strike__" };
                      });
                    }}
                    style={{ cursor: "pointer" }}
                  />
                </g>
              );
            })}

            {/* Arrow marker */}
            <defs>
              <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" className="fill-slate-400" />
              </marker>
            </defs>

            {/* Edges (only when focus is active) */}
            {focus &&
              edges.map((e, i) => (
                <path
                  key={i}
                  d={trackRouter(e.from, e.to, e.type, e.idx, e.n, e.obstacles)}
                  className={`stroke-[2] fill-none ${e.dir === "out" ? "stroke-sky-600" : "stroke-slate-700"}`}
                  strokeDasharray={e.type === "coreq" ? "6 6" : undefined}
                  markerEnd="url(#arrow)"
                  pointerEvents="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
          </g>
        </svg>

        {/* Inline editor overlay */}
        {editor && (
          <div className="absolute inset-0 flex items-center justify-center z-50" onClick={(e) => e.stopPropagation()}>
            <div className="w-[400px] h-[250px] bg-white/95 border rounded-lg shadow p-2 flex flex-col">
              <textarea
                className="flex-1 w-full outline-none resize-none text-sm"
                value={editor.value}
                onChange={(e) => setEditor({ ...editor, value: e.target.value })}
                autoFocus
                placeholder="Type note for this course…"
              />
              <div className="mt-2 flex gap-2 justify-end">
                <button className="px-2 py-1 border rounded" onClick={() => setEditor(null)}>Cancel</button>
                <button className="px-2 py-1 border rounded bg-slate-900 text-white" onClick={saveEditor}>Save</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}