// Writes a small valid PDF (Helvetica text, correct xref) for the end-to-end test. With `bytes`, a second page carries
// a noise image (random RGB, stored uncompressed) sized so the whole file is about that many bytes: it does not
// compress, so it travels in ceil(bytes / 1,900,544) parts.
// node make-pdf.mjs <out.pdf> [title] [bytes]
import { writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

export function makePdf(title = 'Daylight Share test PDF', lines = [], { bytes = 0 } = {}) {
  const esc = (s) => s.replace(/[\\()]/g, (c) => '\\' + c);
  const text = [`BT /F1 22 Tf 72 720 Td (${esc(title)}) Tj ET`,
    ...lines.map((l, i) => `BT /F1 12 Tf 72 ${680 - i * 18} Td (${esc(l)}) Tj ET`)].join('\n');
  const stream = (dict, data) => {
    const body = Buffer.isBuffer(data) ? data : Buffer.from(data, 'latin1');
    return [Buffer.from(`<< ${dict} /Length ${body.length} >>\nstream\n`, 'latin1'), body, Buffer.from('\nendstream', 'latin1')];
  };
  // A side of `side` pixels gives 3 * side^2 bytes of image; 1,200 bytes cover the rest of the file.
  const side = bytes > 0 ? Math.max(1, Math.floor(Math.sqrt(Math.max(0, bytes - 1200) / 3))) : 0;
  const pages = side ? '[3 0 R 7 0 R]' : '[3 0 R]';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids ${pages} /Count ${side ? 2 : 1} >>`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    stream('', text),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Title (${esc(title)}) /Producer (Daylight Share e2e) >>`,
  ];
  if (side) {
    objs.push(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 8 0 R /Resources << /XObject << /Im1 9 0 R >> >> >>',
      stream('', 'q 468 0 0 468 72 252 cm /Im1 Do Q'),
      stream(`/Type /XObject /Subtype /Image /Width ${side} /Height ${side} /ColorSpace /DeviceRGB /BitsPerComponent 8`,
        randomBytes(3 * side * side)),
    );
  }
  const parts = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  let length = parts[0].length;
  const push = (b) => { parts.push(b); length += b.length; };
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(length);
    push(Buffer.from(`${i + 1} 0 obj\n`, 'latin1'));
    for (const b of Array.isArray(o) ? o : [Buffer.from(o, 'latin1')]) push(b);
    push(Buffer.from('\nendobj\n', 'latin1'));
  });
  const xref = length;
  let tail = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) tail += `${String(off).padStart(10, '0')} 00000 n \n`;
  tail += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  push(Buffer.from(tail, 'latin1'));
  return Buffer.concat(parts);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  writeFileSync(process.argv[2], makePdf(process.argv[3], ['Sent from a test phone through the relay.',
    'If you can read this in the Daylight Reader, the PDF path works.'], { bytes: Number(process.argv[4] || 0) }));
}
