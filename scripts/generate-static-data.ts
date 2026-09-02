import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { getWeightsPayload } from '../lib/official-market-data.ts';

const outputRoot = path.resolve(process.cwd(), 'pages-dist');
const dataDirectory = path.join(outputRoot, 'data');

const payload = await getWeightsPayload(true);
if (payload.stale) {
  throw new Error('官方資料更新失敗，不以舊快取發布 GitHub Pages。');
}
if (payload.rows.length !== 100) {
  throw new Error(`靜態資料只有 ${payload.rows.length} 檔，拒絕發布。`);
}

await mkdir(dataDirectory, { recursive: true });
await Promise.all([
  writeFile(
    path.join(dataDirectory, 'weights.json'),
    `${JSON.stringify(payload)}\n`,
    'utf8',
  ),
  writeFile(path.join(outputRoot, '.nojekyll'), '', 'utf8'),
]);

console.log(`已產生 ${payload.dataDate} 的 ${payload.rows.length} 檔靜態資料。`);
