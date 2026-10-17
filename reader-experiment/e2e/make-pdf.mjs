// Writes a small valid one-page PDF (Helvetica text, correct xref) for the end-to-end test.
// node make-pdf.mjs <out.pdf> [title]
import { writeFileSync } from 'node:fs';

export function makePdf(title = 'Daylight Share test PDF', lines = []) {
  const esc = (s) => s.replace(/[\\()]/g, (c) => '\\' + c);
  const body = [`BT /F1 22 Tf 72 720 Td (${esc(title)}) Tj ET`,
    ...lines.map((l, i) => `BT /F1 12 Tf 72 ${680 - i * 18} Td (${esc(l)}) Tj ET`)].join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(body, 'latin1')} >>\nstream\n${body}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Title (${esc(title)}) /Producer (Daylight Share e2e) >>`,
  ];
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${objs.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  writeFileSync(process.argv[2], makePdf(process.argv[3], ['Sent from a test phone through the relay.', 'If you can read this in the Daylight Reader, the PDF path works.']));
}
