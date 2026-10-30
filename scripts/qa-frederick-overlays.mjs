/** Read-only review overlays for the refreshed 84 Frederick demo. Outputs only under diag/. */
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';

GlobalWorkerOptions.workerSrc = new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).href;
const root = process.env.BUILD_PROJECTS_ROOT;
if (!root) throw new Error('Set BUILD_PROJECTS_ROOT to the read-only refreshed demos directory');
const folder = readdirSync(root).find((n) => n.startsWith('84 Frederick demo'));
if (!folder) throw new Error('84 Frederick demo missing');
const base = join(root, folder);
const project = JSON.parse(readFileSync(join(base, 'project.json'), 'utf8')).project;
const out = 'diag/qa-frederick';
mkdirSync(out, { recursive: true });
const colours = { walls: '#ec1c24', rooms: '#00a5ff', unknown: '#8b5cf6', doors: '#ffd000', windows: '#ff8c00', ceilings: '#00a86b', symbols: '#ff00c8', trades: '#bc6c25', demolition: '#c70000', pipes: '#00c6ff' };
const sheets = project.sheets.filter((s) => !s.superseded && project.measurements.some((m) => m.sheetId === s.id && colours[m.source ?? 'unknown']));
const types = new Map(project.types.map((t) => [t.id, t]));
const docs = new Map();
const index = [];
for (const sheet of sheets) {
  if (!docs.has(sheet.docId)) {
    const data = new Uint8Array(readFileSync(join(base, 'drawings', `${sheet.docId}.pdf`)));
    docs.set(sheet.docId, await getDocument({ data, verbosity: 0 }).promise);
  }
  const page = await docs.get(sheet.docId).getPage(sheet.page);
  const viewport = page.getViewport({ scale: 1 });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext('2d');
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  const measurements = project.measurements.filter((m) => m.sheetId === sheet.id && colours[m.source ?? 'unknown']);
  for (const [i, m] of measurements.entries()) {
    const type = types.get(m.typeId);
    const colour = colours[m.source ?? 'unknown'];
    ctx.save();
    ctx.strokeStyle = colour;
    ctx.fillStyle = colour;
    ctx.lineWidth = m.source === 'pipes' ? 3 : 4;
    ctx.globalAlpha = 0.78;
    if (m.points.length > 1) {
      ctx.beginPath();
      ctx.moveTo(...m.points[0]);
      for (const p of m.points.slice(1)) ctx.lineTo(...p);
      if (type?.kind === 'area') ctx.closePath();
      ctx.stroke();
    } else if (m.points[0]) {
      const [x, y] = m.points[0];
      ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
    const xs = m.points.map((p) => p[0]), ys = m.points.map((p) => p[1]);
    index.push({ sheet: sheet.name, index: i + 1, id: m.id, source: m.source ?? 'unknown', type: type?.name,
      points: m.points, statedLength: m.statedLength, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
  }
  writeFileSync(join(out, `${sheet.name}.png`), await canvas.encode('png'));
  console.log(`${sheet.name}: ${measurements.length} overlays, ${Math.round(viewport.width)}x${Math.round(viewport.height)}`);
}
writeFileSync(join(out, 'index.json'), JSON.stringify(index, null, 2));
if (index.length !== project.measurements.length)
  throw new Error(`Only ${index.length}/${project.measurements.length} measurements rendered; inspect superseded sheets or new sources`);
console.log(`Rendered all ${index.length} measurements`);
