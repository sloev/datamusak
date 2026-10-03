// Builds the vector basemap (coastlines + borders) from Natural Earth (world-atlas), so the map
// needs no tile server or API key: Denmark at 1:10m, the Nordics at 1:50m, the world at 1:110m.
// Output: assets/map/coast.json — { lines: [[lon,lat,lon,lat,…], …], borders: [...] }. Run: npm run map
import fs from 'node:fs';
import { feature, mesh } from 'topojson-client';

const load = (f) => JSON.parse(fs.readFileSync(`node_modules/world-atlas/${f}`, 'utf8'));
const DK = [7.0, 54.0, 16.0, 58.2];
const NORDIC = [-6.0, 50.0, 35.0, 72.0];
const inBox = ([x, y], b) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];

function rings(geo) {
  const out = [];
  const add = (g) => {
    if (g.type === 'Polygon') out.push(...g.coordinates);
    else if (g.type === 'MultiPolygon') g.coordinates.forEach((p) => out.push(...p));
    else if (g.type === 'LineString') out.push(g.coordinates);
    else if (g.type === 'MultiLineString') out.push(...g.coordinates);
    else if (g.type === 'FeatureCollection') g.features.forEach((f) => add(f.geometry));
    else if (g.type === 'Feature') add(g.geometry);
  };
  add(geo);
  return out;
}

// keep the runs of a line that are inside (or outside) a box
function clip(lines, box, keepInside) {
  const out = [];
  for (const line of lines) {
    let run = [];
    for (const p of line) {
      if (inBox(p, box) === keepInside) run.push(p);
      else {
        if (run.length > 1) out.push(run);
        run = [];
      }
    }
    if (run.length > 1) out.push(run);
  }
  return out;
}

// Douglas–Peucker
function simplify(line, tol) {
  if (line.length < 3) return line;
  const keep = new Uint8Array(line.length);
  keep[0] = keep[line.length - 1] = 1;
  const stack = [[0, line.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = line[a];
    const [bx, by] = line[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-12;
    let max = 0;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((line[i][0] - ax) * dy - (line[i][1] - ay) * dx) / len;
      if (d > max) [max, idx] = [d, i];
    }
    if (max > tol) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return line.filter((_, i) => keep[i]);
}

const pack = (lines, tol, digits) =>
  lines
    .map((l) => simplify(l, tol))
    .filter((l) => l.length > 1)
    .map((l) => l.flatMap(([x, y]) => [+x.toFixed(digits), +y.toFixed(digits)]));

const land10 = load('land-10m.json');
const land50 = load('land-50m.json');
const land110 = load('land-110m.json');
const c50 = load('countries-50m.json');

const coast = [
  ...pack(clip(rings(feature(land10, land10.objects.land)), DK, true), 0.004, 3),
  ...pack(clip(clip(rings(feature(land50, land50.objects.land)), NORDIC, true), DK, false), 0.02, 2),
  ...pack(clip(rings(feature(land110, land110.objects.land)), NORDIC, false), 0.08, 1),
];
const borders = pack(clip(rings(mesh(c50, c50.objects.countries, (a, b) => a !== b)), NORDIC, true), 0.02, 2);

const out = JSON.stringify({ lines: coast, borders });
fs.writeFileSync('assets/map/coast.json', out);
console.log(`assets/map/coast.json ${(out.length / 1024).toFixed(0)} KB, ${coast.length} coast lines, ${borders.length} borders`);
