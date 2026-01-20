import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import ProgramMap from "./ProgramMap.jsx";
import * as XLSX from "xlsx";
import "./index.css";

const params = new URLSearchParams(window.location.search);
const initialId = params.get("id") || "EGCP";

const COURSES_TEMPLATE_BASE = BLOB_URL + "/courses";

// --- Detect mobile device
function isMobileDevice() {
  return /Mobi|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );
}

// --- helpers (from your current file) ---
function sortTerms(labels) {
  const seasonRank = { "Fall": 1, "Spr": 2, "Spring": 2, "Sum": 3, "Summer": 3, "Win": 4, "Winter": 4 };
  const parse = (s) => {
    const m = String(s).match(/year\s*(\d+)|(\d+)/i);
    const year = m ? Number(m[1] || m[2]) : Number.MAX_SAFE_INTEGER;
    const seasonMatch = String(s).match(/Fall|Aut(?:umn)?|Spr(?:ing)?|Sum(?:mer)?|Win(?:ter)?/i);
    const seasonKey = seasonMatch ? seasonMatch[0].toLowerCase() : "";
    const norm = seasonKey ? seasonKey[0].toUpperCase() + seasonKey.slice(1) : "";
    return { year, seasonScore: seasonRank[norm] ?? 99 };
  };
  return [...labels].sort((a, b) => {
    const A = parse(a), B = parse(b);
    if (A.year !== B.year) return A.year - B.year;
    return A.seasonScore - B.seasonScore;
  });
}

function normalizeCourses(rows) {
  return rows.map(r => ({
    id: r.id,
    code: r.code,
    title: r.title,
    units: Number(r.units) || 0,
    term: r.term,
    row: (r.row ?? r.rows),
    category: r.category,
    prereqs: toIdArray(r.prereqs),
    coreqs: toIdArray(r.coreqs),
    offering: r.offering,
    notes: r.notes ?? ""
  }));
}

function assignRowsByOrder(courses) {
  const counters = new Map();
  return courses.map(c => {
    const rowNum = Number(c.row);
    if (Number.isFinite(rowNum)) return { ...c, row: rowNum };
    const key = String(c.term);
    const idx = counters.get(key) ?? 0;
    counters.set(key, idx + 1);
    return { ...c, row: idx };
  });
}

function buildTermsAndIndexCourses(courses) {
  const labels = courses.map(c =>
    (typeof c.term === "string" && c.term) ? c.term : `Term ${Number(c.term) || 0}`
  );
  const uniq = Array.from(new Set(labels));
  const ordered = sortTerms(uniq);
  const idxOf = new Map(ordered.map((lbl, i) => [lbl, i]));
  const indexedCourses = courses.map(c => {
    const label = (typeof c.term === "string" && c.term) ? c.term : `Term ${Number(c.term) || 0}`;
    return { ...c, term: idxOf.get(label) ?? 0 };
  });
  const termsProp = ordered.map((label, i) => ({ id: `t${i+1}`, label }));
  return { courses: indexedCourses, terms: termsProp };
}

async function loadExcel(path) {
  const response = await fetch(path);
  const data = await response.arrayBuffer();
  const workbook = XLSX.read(data, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
}

function toIdArray(v) {
  if (Array.isArray(v)) return v.map(String);
  if (v == null || v === "") return [];
  if (typeof v === "number") return [String(v)];
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch (_) {}
    return v.split(/[;,]\s*/).map(s => s.trim()).filter(Boolean);
  }
  return [];
}

// --- New App component with program switch ---
function App({ initialId, cwid }) {
  const [programId, setProgramId] = useState(initialId);
  const [courses, setCourses] = useState([]);
  const [terms, setTerms] = useState([]);

  useEffect(() => {
    async function loadProgram(id) {
      const url = `${COURSES_TEMPLATE_BASE}/${id}.xlsx`;
      let raw = await loadExcel(url);
      const normalized = normalizeCourses(raw);
      let { courses, terms } = buildTermsAndIndexCourses(normalized);
      courses = assignRowsByOrder(courses);
      setCourses(courses);
      setTerms(terms);
    }
    loadProgram(programId);
  }, [programId]);

  return (
    <div className="w-screen h-screen flex flex-col">
      <div className="p-2 border-b flex gap-2 items-center">
        <label className="font-semibold">Program: </label>
        <select
          value={programId}
          onChange={(e) => {
            const id = e.target.value;
            setProgramId(id);
            const params = new URLSearchParams(window.location.search);
            params.set("id", id);
            window.history.replaceState({}, "", `?${params.toString()}`);
          }}
          className="border rounded p-1"
        >
          <option value="EGCP">Comp. Eng. (EGCP)</option>
          <option value="CPEI">Comp. Eng. BS-MS (CPEI)</option>
          <option value="EGEE">EE (EGEE)</option>
          {/*
          <option value="EGME">ME (EGME)</option>
          */}
        </select>
      </div>
      <div className="flex-1">
        {courses.length > 0 && terms.length > 0 && (
          <ProgramMap
            programId={programId}
            coursesProp={courses}
            termsProp={terms}
            studentId={cwid}
          />
        )}
      </div>
    </div>
  );
}

// --- Entry point ---
if (isMobileDevice()) {
  document.body.innerHTML = `
    <div style="background:white;color:black;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center;padding:20px;">
      <h1>CourseFlow only works on desktops.<br/>Mobile devices are not supported.</h1>
    </div>
  `;
} else {
  ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <App initialId={initialId} />
    </React.StrictMode>
  );
}
