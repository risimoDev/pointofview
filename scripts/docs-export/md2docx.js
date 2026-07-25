const fs = require('fs');
const path = require('path');
const d = require('docx');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell,
  WidthType, BorderStyle, ShadingType, PageNumber, Header, Footer, PageBreak, LevelFormat,
  convertMillimetersToTwip, TabStopType,
} = d;

const BRAND = '17836F';
const BRAND_LIGHT = 'E7F2F0';
const INK = '1B2429';
const MUTED = '6A757C';
const RULE = 'C9D3D1';
const SERIF = 'Cambria';
const SANS = 'Calibri';
const MONO = 'Consolas';

const PAGE_W = convertMillimetersToTwip(210);
const MARGIN = convertMillimetersToTwip(20);
const CONTENT_W = PAGE_W - MARGIN * 2;

// ---------- inline markdown ----------
function inline(text, base = {}) {
  const runs = [];
  // strip markdown links, keep the label
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0, m;
  const push = (t, extra) => { if (t) runs.push(new TextRun({ text: t, font: SANS, ...base, ...extra })); };
  while ((m = re.exec(text)) !== null) {
    push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) push(tok.slice(2, -2), { bold: true });
    else push(tok.slice(1, -1), { font: MONO, size: (base.size || 21) - 2, color: '3E4C52' });
    last = m.index + tok.length;
  }
  push(text.slice(last));
  return runs.length ? runs : [new TextRun({ text: '', font: SANS, ...base })];
}

// ---------- blocks ----------
const para = (text, opts = {}) => new Paragraph({
  children: inline(text, { size: opts.size || 21, color: opts.color || INK }),
  spacing: { after: opts.after ?? 140, line: 276 },
  alignment: opts.align,
  ...(opts.indent ? { indent: opts.indent } : {}),
  keepNext: opts.keepNext,
});

function heading(text, level) {
  const cfg = {
    1: { size: 30, color: BRAND, before: 0, after: 200, hl: HeadingLevel.HEADING_1 },
    2: { size: 25, color: INK, before: 320, after: 150, hl: HeadingLevel.HEADING_2 },
    3: { size: 22, color: BRAND, before: 240, after: 110, hl: HeadingLevel.HEADING_3 },
    4: { size: 21, color: INK, before: 200, after: 90, hl: HeadingLevel.HEADING_4 },
  }[level];
  return new Paragraph({
    heading: cfg.hl,
    spacing: { before: cfg.before, after: cfg.after },
    keepNext: true,
    ...(level === 1 ? { border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: BRAND, space: 6 } } } : {}),
    children: inline(text, { size: cfg.size, color: cfg.color, bold: true }),
  });
}

function tableBlock(rows) {
  const cols = rows[0].length;
  // proportional widths from content length
  const weights = new Array(cols).fill(0);
  rows.forEach(r => r.forEach((c, i) => { weights[i] = Math.max(weights[i], Math.min(c.length, 60)); }));
  const sum = weights.reduce((a, b) => a + b, 0) || cols;
  let widths = weights.map(w => Math.max(Math.round(CONTENT_W * w / sum), Math.round(CONTENT_W * 0.07)));
  const diff = CONTENT_W - widths.reduce((a, b) => a + b, 0);
  widths[widths.length - 1] += diff;

  const border = { style: BorderStyle.SINGLE, size: 4, color: RULE };
  const mkCell = (text, i, isHead) => new TableCell({
    width: { size: widths[i], type: WidthType.DXA },
    margins: { top: 70, bottom: 70, left: 110, right: 110 },
    shading: isHead ? { type: ShadingType.CLEAR, fill: BRAND_LIGHT, color: 'auto' } : undefined,
    children: [new Paragraph({
      spacing: { before: 10, after: 10, line: 252 },
      children: inline(text, { size: 18, color: isHead ? INK : INK, bold: isHead }),
    })],
  });

  return new Table({
    columnWidths: widths,
    width: { size: CONTENT_W, type: WidthType.DXA },
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
    rows: rows.map((r, ri) => new TableRow({
      tableHeader: ri === 0,
      cantSplit: true,
      children: r.map((c, i) => mkCell(c, i, ri === 0)),
    })),
  });
}

function codeBlock(lines) {
  return lines.map((l, i) => new Paragraph({
    spacing: { before: i === 0 ? 120 : 0, after: i === lines.length - 1 ? 160 : 0, line: 240 },
    shading: { type: ShadingType.CLEAR, fill: 'F4F6F6', color: 'auto' },
    indent: { left: 220, right: 220 },
    children: [new TextRun({ text: l || ' ', font: MONO, size: 17, color: '2E3A40' })],
  }));
}

function parse(md, opts) {
  const lines = md.split(/\r?\n/);
  const out = [];
  let i = 0;
  let firstH1seen = false;
  let h2dropped = !opts.skipFirstH2;

  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      out.push(...codeBlock(buf));
      continue;
    }

    if (/^\s*$/.test(line)) { i++; continue; }

    if (/^---+\s*$/.test(line)) {
      out.push(new Paragraph({
        spacing: { before: 60, after: 180 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 2 } },
        children: [new TextRun({ text: '', size: 2 })],
      }));
      i++; continue;
    }

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const lvl = h[1].length;
      const text = h[2].trim();
      if (lvl === 1 && !firstH1seen && opts.skipFirstH1) { firstH1seen = true; i++; continue; }
      if (lvl === 2 && !h2dropped) { h2dropped = true; i++; continue; }
      if (lvl === 1 && firstH1seen) out.push(new Paragraph({ children: [new PageBreak()] }));
      if (lvl === 1) firstH1seen = true;
      out.push(heading(text, lvl));
      i++; continue;
    }

    // table
    if (/^\|/.test(line) && i + 1 < lines.length && /^\|[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
      const rows = [];
      const cells = l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(s => s.trim());
      rows.push(cells(line));
      i += 2;
      while (i < lines.length && /^\|/.test(lines[i])) { rows.push(cells(lines[i])); i++; }
      const cols = rows[0].length;
      rows.forEach(r => { while (r.length < cols) r.push(''); r.length = cols; });
      out.push(tableBlock(rows));
      out.push(new Paragraph({ spacing: { after: 180 }, children: [new TextRun({ text: '', size: 4 })] }));
      continue;
    }

    // lists
    const bullet = line.match(/^(\s*)[-*]\s+(.*)$/);
    const numbered = line.match(/^(\s*)(\d+)[.)]\s+(.*)$/);
    if (bullet || numbered) {
      const items = [];
      const isNum = !!numbered;
      while (i < lines.length) {
        const b = lines[i].match(/^(\s*)[-*]\s+(.*)$/);
        const n = lines[i].match(/^(\s*)(\d+)[.)]\s+(.*)$/);
        if (!b && !n) {
          // continuation line
          if (items.length && /^\s{2,}\S/.test(lines[i])) { items[items.length - 1].text += ' ' + lines[i].trim(); i++; continue; }
          break;
        }
        const mm = b || n;
        const indent = Math.min(Math.floor(mm[1].length / 2), 2);
        items.push({ text: (b ? b[2] : n[3]).trim(), indent });
        i++;
      }
      // each ordered list gets its own reference so numbering restarts at 1
      let ref = 'bul-list';
      if (isNum) { ref = `num-list-${opts.numRefs.length}`; opts.numRefs.push(ref); }
      items.forEach((it, idx) => out.push(new Paragraph({
        numbering: { reference: ref, level: it.indent },
        spacing: { after: idx === items.length - 1 ? 150 : 60, line: 270 },
        children: inline(it.text, { size: 21, color: INK }),
      })));
      continue;
    }

    // paragraph (join wrapped lines)
    const buf = [line.trim()];
    i++;
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^[#|\-*`]/.test(lines[i]) && !/^\d+[.)]\s/.test(lines[i])) {
      buf.push(lines[i].trim()); i++;
    }
    out.push(para(buf.join(' ')));
  }
  return out;
}

function coverPage(meta) {
  const kids = [
    new Paragraph({ spacing: { before: 1200, after: 0 }, children: [new TextRun({ text: 'BZK-VIZIAI', font: SERIF, size: 30, bold: true, color: BRAND, characterSpacing: 40 })] }),
    new Paragraph({
      spacing: { before: 60, after: 500 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: BRAND, space: 8 } },
      children: [new TextRun({ text: 'Видеоаналитика производственной безопасности', font: SANS, size: 20, color: MUTED })],
    }),
    new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: meta.title, font: SERIF, size: 54, bold: true, color: INK })] }),
    new Paragraph({ spacing: { after: 700 }, children: [new TextRun({ text: meta.subtitle, font: SANS, size: 24, color: MUTED })] }),
  ];
  meta.facts.forEach(([k, v]) => {
    kids.push(new Paragraph({
      spacing: { after: 70 },
      tabStops: [{ type: TabStopType.LEFT, position: 2600 }],
      children: [
        new TextRun({ text: k, font: SANS, size: 19, color: MUTED }),
        new TextRun({ text: '\t' + v, font: SANS, size: 19, color: INK }),
      ],
    }));
  });
  kids.push(new Paragraph({
    spacing: { before: 900 },
    border: { top: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 8 } },
    children: [new TextRun({ text: meta.note, font: SANS, size: 17, color: MUTED, italics: true })],
  }));
  kids.push(new Paragraph({ children: [new PageBreak()] }));
  return kids;
}

function build(mdPath, outPath, meta) {
  let md = fs.readFileSync(mdPath, 'utf8');
  (meta.replace || []).forEach(([a, b]) => { md = md.split(a).join(b); });
  if (meta.drop) {
    const pats = meta.drop.map(p => new RegExp(p));
    md = md.split(/\r?\n/).filter(l => !pats.some(p => p.test(l))).join('\n');
  }
  const numRefs = [];
  const body = parse(md, { skipFirstH1: true, skipFirstH2: !!meta.skipFirstH2, numRefs });

  const doc = new Document({
    creator: 'BZK-VIZIAI',
    title: meta.title,
    description: meta.subtitle,
    styles: {
      default: {
        document: { run: { font: SANS, size: 21, color: INK }, paragraph: { spacing: { line: 276 } } },
        heading1: { run: { font: SERIF, size: 30, bold: true, color: BRAND } },
        heading2: { run: { font: SERIF, size: 25, bold: true, color: INK } },
        heading3: { run: { font: SANS, size: 22, bold: true, color: BRAND } },
        heading4: { run: { font: SANS, size: 21, bold: true, color: INK } },
      },
    },
    numbering: {
      config: [
        {
          reference: 'bul-list',
          levels: [0, 1, 2].map(l => ({
            level: l, format: LevelFormat.BULLET, text: ['•', '–', '·'][l], alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 340 + l * 320, hanging: 220 } } },
          })),
        },
        ...numRefs.map(ref => ({
          reference: ref,
          levels: [0, 1, 2].map(l => ({
            level: l, format: LevelFormat.DECIMAL, text: `%${l + 1}.`, alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 380 + l * 320, hanging: 260 } } },
          })),
        })),
      ],
    },
    sections: [
      {
        properties: {
          page: { margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN } },
          titlePage: true,
        },
        headers: {
          default: new Header({
            children: [new Paragraph({
              spacing: { after: 200 },
              border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE, space: 4 } },
              tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W }],
              children: [
                new TextRun({ text: 'BZK-VIZIAI', font: SANS, size: 16, bold: true, color: BRAND }),
                new TextRun({ text: '\t' + meta.running, font: SANS, size: 16, color: MUTED }),
              ],
            })],
          }),
          first: new Header({ children: [new Paragraph({ children: [] })] }),
        },
        footers: {
          default: new Footer({
            children: [new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 120 },
              children: [
                new TextRun({ text: '', font: SANS, size: 16, color: MUTED }),
                new TextRun({ children: [PageNumber.CURRENT], font: SANS, size: 16, color: MUTED }),
                new TextRun({ text: ' / ', font: SANS, size: 16, color: MUTED }),
                new TextRun({ children: [PageNumber.TOTAL_PAGES], font: SANS, size: 16, color: MUTED }),
              ],
            })],
          }),
          first: new Footer({ children: [new Paragraph({ children: [] })] }),
        },
        children: [...coverPage(meta), ...body],
      },
    ],
  });

  return Packer.toBuffer(doc).then(buf => { fs.writeFileSync(outPath, buf); console.log('written', outPath, buf.length); });
}

module.exports = { build };

// Regenerates docs/commercial/word/*.docx from the markdown sources.
//   npm install docx && node scripts/docs-export/md2docx.js scripts/docs-export/jobs.json
// Paths in jobs.json are resolved relative to the jobs file.
if (require.main === module) {
  const jobsFile = path.resolve(process.argv[2]);
  const base = path.dirname(jobsFile);
  const jobs = JSON.parse(fs.readFileSync(jobsFile, 'utf8'));
  (async () => {
    for (const j of jobs) await build(path.resolve(base, j.src), path.resolve(base, j.out), j);
  })();
}
