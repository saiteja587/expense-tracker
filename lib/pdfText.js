// Text lines from a PDF, read in the browser (the file never leaves the
// phone). Uses pdf.js v3; the worker runs on the main thread, so there's no
// separate worker file to serve. Password-protected statements (bank PDFs
// are often locked with your DOB or customer ID) need the password.
export async function pdfLines(file, password) {
  const pdfjs = await import("pdfjs-dist/build/pdf");
  await import("pdfjs-dist/build/pdf.worker.entry"); // sets globalThis.pdfjsWorker
  const data = new Uint8Array(await file.arrayBuffer());
  let doc;
  try {
    doc = await pdfjs.getDocument({ data, password: password || undefined, isEvalSupported: false }).promise;
  } catch (e) {
    if (e?.name === "PasswordException") {
      const err = new Error(password ? "Wrong password for this PDF." : "This PDF is password-protected.");
      err.needsPassword = true;
      throw err;
    }
    throw new Error("Couldn't read that PDF.");
  }
  const lines = [];
  for (let p = 1; p <= Math.min(doc.numPages, 60); p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    // Group text pieces into rows by their vertical position, then left→right.
    const rows = new Map();
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const y = Math.round(it.transform[5] / 3) * 3;
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({ x: it.transform[4], s: it.str });
    }
    [...rows.entries()].sort((a, b) => b[0] - a[0]).forEach(([, parts]) => {
      lines.push(parts.sort((a, b) => a.x - b.x).map((q) => q.s.trim()).join(" "));
    });
  }
  await doc.destroy();
  return lines;
}
