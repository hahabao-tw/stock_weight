import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';

import { shouldDeployEveningData } from '../lib/deployment-data.ts';

const PUBLISHED_DATA_URL =
  'https://hahabao-tw.github.io/stock_weight/data/weights.json';
const GENERATED_DATA_PATH = path.join(
  process.cwd(),
  'pages-dist',
  'data',
  'weights.json',
);
const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 15_000;

function readDataDate(payload: unknown, source: string): string {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('dataDate' in payload) ||
    typeof payload.dataDate !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(payload.dataDate)
  ) {
    throw new Error(`${source} 缺少有效的 dataDate。`);
  }

  return payload.dataDate;
}

async function fetchPublishedData(): Promise<unknown> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const url = new URL(PUBLISHED_DATA_URL);
      url.searchParams.set('deployment-check', Date.now().toString());
      const response = await fetch(url, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(`無法讀取已發布資料：${String(lastError)}`);
}

async function writeDecision(shouldDeploy: boolean): Promise<void> {
  const output = `should_deploy=${shouldDeploy}\n`;

  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, output, 'utf8');
  } else {
    process.stdout.write(output);
  }
}

if (process.env.EVENING_RUN !== 'true') {
  await writeDecision(true);
  console.log('非晚間排程，照常發布。');
} else {
  const generatedPayload = JSON.parse(
    await readFile(GENERATED_DATA_PATH, 'utf8'),
  ) as unknown;
  const publishedPayload = await fetchPublishedData();
  const generatedDataDate = readDataDate(generatedPayload, '本次產生資料');
  const publishedDataDate = readDataDate(publishedPayload, '已發布資料');
  const shouldDeploy = shouldDeployEveningData(
    generatedDataDate,
    publishedDataDate,
  );

  await writeDecision(shouldDeploy);
  console.log(
    shouldDeploy
      ? `資料日期由 ${publishedDataDate} 更新為 ${generatedDataDate}，執行發布。`
      : `資料日期仍為 ${generatedDataDate}，略過晚間發布。`,
  );
}
