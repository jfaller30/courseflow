// src/tests/genNotes_docx.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import JSZip from "jszip";
import { generateAdvisingDoc } from "../docx/genNotes";

async function toArrayBuffer(x) {
  // Node Buffer
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(x)) {
    return x.buffer.slice(x.byteOffset, x.byteOffset + x.byteLength);
  }

  // Uint8Array / typed arrays
  if (x && ArrayBuffer.isView(x)) {
    return x.buffer.slice(x.byteOffset, x.byteOffset + x.byteLength);
  }

  // ArrayBuffer already
  if (x instanceof ArrayBuffer) return x;

  // Blob with arrayBuffer()
  if (x && typeof x.arrayBuffer === "function") return await x.arrayBuffer();

  // Blob-like without arrayBuffer (jsdom sometimes)
  if (typeof Blob !== "undefined" && x instanceof Blob) {
    return await new Response(x).arrayBuffer();
  }

  throw new TypeError(
    `Unsupported docx output type: ${Object.prototype.toString.call(x)}`
  );
}

async function docxToDocumentXmlText(docxOut) {
  const ab = await toArrayBuffer(docxOut);
  const u8 = new Uint8Array(ab); // safest input type for JSZip
  const zip = await JSZip.loadAsync(u8);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) throw new Error("word/document.xml not found in generated docx");
  return xml;
}

function expectXmlToContain(xml, needle) {
  expect(xml).toContain(needle);
}

describe("Gen Notes (.docx) generation (EGCP + CPEI only)", () => {
  let confirmSpy;

  beforeEach(() => {
    globalThis.confirm = globalThis.confirm ?? (() => true);
    confirmSpy = vi.spyOn(globalThis, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    confirmSpy?.mockRestore();
  });

  it("EGCP: includes planned courses, excludes struck courses, includes notes bullets", async () => {
    const coursesProp = [
      { id: "c1", code: "CPSC 120", units: 3 },
      { id: "c2", code: "MATH 150A", units: 4 },
      { id: "c3", code: "PHYS 225", units: 4 },
    ];

    const labels = {
      c1: "Fall",
      c2: "Spr",
      c3: "__strike__", // should not appear
    };

    const out = await generateAdvisingDoc({
      programId: "EGCP",
      labels,
      coursesProp,
      returnType: "buffer",
    });

    const xml = await docxToDocumentXmlText(out);

    // Header/title
    expectXmlToContain(xml, "University");
    expectXmlToContain(xml, "Computer Engineering Advising Notes");

    // Courses: included/excluded
    expectXmlToContain(xml, "CPSC 120");
    expectXmlToContain(xml, "MATH 150A");
    expect(xml).not.toContain("PHYS 225");

    // Notes bullets (signature lines from genNotes.js)
    expectXmlToContain(xml, "New Prereqs/Coreqs (not in catalog yet):");
    expectXmlToContain(xml, "Repeat Policy");
  });

  it("EGCP: Spring mode still includes planned courses", async () => {
    // In your implementation, confirm() false selects Spring mode
    confirmSpy.mockReturnValue(false);

    const coursesProp = [
      { id: "a", code: "EGEC 450", units: 3 },
      { id: "b", code: "EGEC 471", units: 3 },
    ];

    const labels = {
      a: "Fall",
      b: "Spr",
    };

    const out = await generateAdvisingDoc({
      programId: "EGCP",
      labels,
      coursesProp,
      returnType: "buffer",
    });

    const xml = await docxToDocumentXmlText(out);

    expectXmlToContain(xml, "Computer Engineering Advising Notes");
    expectXmlToContain(xml, "EGEC 450");
    expectXmlToContain(xml, "EGEC 471");
  });

  it("CPEI: includes Summer/Winter sections only if those terms have courses", async () => {
    const coursesProp = [
      { id: "s1", code: "CPSC 481", units: 3 },
      { id: "w1", code: "CPSC 485", units: 3 },
    ];

    const labels = {
      s1: "Sum",
      w1: "Win",
    };

    const out = await generateAdvisingDoc({
      programId: "CPEI",
      labels,
      coursesProp,
      returnType: "buffer",
    });

    const xml = await docxToDocumentXmlText(out);

    // Title mapping for CPEI
    expectXmlToContain(xml, "BS-MS Computer Engineering Advising Notes");

    // Sections and course presence
    expectXmlToContain(xml, "Summer");
    expectXmlToContain(xml, "Winter");
    expectXmlToContain(xml, "CPSC 481");
    expectXmlToContain(xml, "CPSC 485");
  });
});
