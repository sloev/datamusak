// Fetch data whose providers block browsers and write it as static JSON for the data branch
// (see .github/workflows/data-mirror.yml). Usage: node scripts/mirror-data.mjs <out dir>
import { mkdir, writeFile } from 'node:fs/promises';

const out = process.argv[2] || 'out';
await mkdir(out, { recursive: true });

const r = await fetch('https://api.energidataservice.dk/dataset/PowerSystemRightNow?limit=60&sort=Minutes1UTC%20DESC');
if (!r.ok) throw new Error(`Energi Data Service: HTTP ${r.status}`);
const { records } = await r.json();
if (!records?.length) throw new Error('Energi Data Service: no records');
await writeFile(`${out}/grid.json`, JSON.stringify({ fetchedAt: new Date().toISOString(), records }));
console.log(`grid.json: ${records.length} records, newest ${records[0].Minutes1UTC}`);
