// Writes small but valid PDFs for the tests (text pages; optional incompressible filler to make them large).
import { randomBytes } from 'node:crypto';

export function makePdf({ pages = 1, text = 'Hello Daylight', fillerBytes = 0 } = {}) {
  const objs = [];
  const add = (body) => { objs.push(body); return objs.length; };
  const catalog = add(null);
  const pagesObj = add(null);
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids = [];
  for (let i = 0; i < pages; i++) {
    const content = `BT /F1 18 Tf 40 740 Td (${text} - page ${i + 1}) Tj ET`;
    const c = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${c} 0 R >>`));
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  const parts = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  let offset = parts[0].length;
  const offsets = [];
  const push = (b) => { parts.push(b); offset += b.length; };
  objs.forEach((body, i) => { offsets.push(offset); push(Buffer.from(`${i + 1} 0 obj\n${body}\nendobj\n`, 'latin1')); });
  if (fillerBytes > 0) {
    // An unreferenced stream object of random bytes: valid PDF, and it doesn't compress.
    const n = objs.length + 1;
    offsets.push(offset);
    push(Buffer.from(`${n} 0 obj\n<< /Length ${fillerBytes} >>\nstream\n`, 'latin1'));
    push(randomBytes(fillerBytes));
    push(Buffer.from('\nendstream\nendobj\n', 'latin1'));
  }
  const xref = offset;
  let x = `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) x += `${String(o).padStart(10, '0')} 00000 n \n`;
  x += `trailer\n<< /Size ${offsets.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  push(Buffer.from(x, 'latin1'));
  return new Uint8Array(Buffer.concat(parts));
}
