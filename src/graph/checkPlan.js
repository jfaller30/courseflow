// src/graph/checkPlan.js

// Labels that count as “scheduled / planned / taken”
const SEASONALS = new Set(["Fall", "Spr", "Sum", "Win", "Com. College", "In Prog."]);

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

/**
 * Returns an array of human-readable problems.
 * Same checks as the UI "Check" button:
 *  1) prereq/coreq must be satisfied (labeled or struck)
 *  2) prereq cannot be in the same label term as the course
 *  3) offering constraints
 */
export function checkPlan({ labels, map }) {
  const problems = [];

  // 1) prereq/coreq must be satisfied (labeled or struck)
  for (const [courseId, lbl] of Object.entries(labels)) {
    if (!SEASONALS.has(lbl)) continue;

    const prereqs = map[courseId]?.prereqs || [];
    const coreqs = map[courseId]?.coreqs || [];

    const isSatisfied = (pid) => {
      const pl = labels[pid];
      return SEASONALS.has(pl) || pl === "__strike__";
    };

    const unmetPre = prereqs.filter((pid) => !isSatisfied(pid));
    const unmetCo = coreqs.filter((pid) => !isSatisfied(pid));

    if (unmetPre.length || unmetCo.length) {
      const courseCode = map[courseId]?.code || courseId;
      const fmt = (ids) => ids.map((pid) => map[pid]?.code || pid).join(", ");
      const lines = [];
      if (unmetPre.length) lines.push(`prereq(s) → ${fmt(unmetPre)}`);
      if (unmetCo.length) lines.push(`coreq(s) → ${fmt(unmetCo)}`);
      problems.push(`${courseCode}: missing ${lines.join(" | ")}`);
    }
  }

  // 2) prereq cannot be in same label term as the course
  for (const [courseId, lbl] of Object.entries(labels)) {
    if (!SEASONALS.has(lbl)) continue;

    const prereqs = map[courseId]?.prereqs || [];
    if (!prereqs.length) continue;

    const courseCode = map[courseId]?.code || courseId;

    for (const pid of prereqs) {
      const preLbl = labels[pid];
      if (SEASONALS.has(preLbl) && preLbl === lbl) {
        const preCode = map[pid]?.code || pid;
        problems.push(`${courseCode}: prereq ${preCode} is also labeled "${lbl}"`);
      }
    }
  }

  // 3) offering constraints
  for (const [courseId, lbl] of Object.entries(labels)) {
    if (!lbl) continue;
    if (lbl === "In Prog." || lbl === "Com. College" || lbl === "__strike__") continue;

    const course = map[courseId];
    if (!course) continue;

    const allowed = parseOffering(course.offering);
    if (allowed.size === 0) continue;

    if (!allowed.has(lbl)) {
      const courseCode = course.code || courseId;
      problems.push(`${courseCode}: labeled "${lbl}" but offering is "${course.offering}"`);
    }
  }

  return problems;
}
