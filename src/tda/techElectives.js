import { normCode } from "./textUtils";

// ==== NEW: TECHNICAL ELECTIVES handling ====
// helper: grab just the TECHNICAL ELECTIVES section
export const sliceSection = (s, startKey, endKeys=[]) => {
    const S = s.indexOf(startKey);
    if (S < 0) return "";
    let E = s.length;
    for (const key of endKeys) {
        const k = s.indexOf(key, S + startKey.length);
        if (k >= 0) E = Math.min(E, k);
    }
    return s.slice(S, E);
};

// parse course codes in a section into {completed:Set, ip:Set}
export const parseTechElectives = (secText) => {
    const completed = new Set(), ip = new Set();
    if (!secText) return { completed, ip };
    // Allow: 3–4 digit numbers, optional space, optional trailing letter/L
    const codeRx = /\b([A-Z]{2,6})\s?(\d{3,4}[A-Z]?L?)\b/gi;
    const matches = Array.from(secText.matchAll(codeRx));
    for (let i = 0; i < matches.length; i++) {
        const m = matches[i];
        const code = normCode(`${m[1]} ${m[2]}`);
        const start = m.index ?? 0;
        const end = i + 1 < matches.length ? (matches[i + 1].index ?? secText.length) : secText.length;
        const win = secText.slice(start, end); // <-- bounded to next course code

        // If this slice begins with an articulation/equals fragment, skip
        if (/^\s*[-=]/.test(win)) continue;

        // IP strictly within this row-slice
        if (/\bIP\b/.test(win)) { ip.add(code); continue; }

        // Completed: needs a units number and a passing grade token within the slice
        const hasUnits = /\b\d(?:\s*\.\s*\d)?\b/.test(win);
        const gradeTok = (win.match(/\b([ABC]\s*[+\-]?|CR)\b/i)?.[1] || "").toUpperCase().replace(/\s+/g, "");
        const pass = gradeTok === "CR" || /^(A|B|C)(\+|-)?$/.test(gradeTok);
        if (hasUnits && pass) completed.add(code);
    }
    return { completed, ip };
};