import {
  assertMatchingMarketDates,
  calculateStockWeights,
  parseTaifexConstituents,
  parseTaifexDataDate,
  rocDateToIso,
  validateTaifexConstituents,
  type CompanyInfo,
  type LimitQuote,
  type StockWeightRow,
} from './stock-weights.ts';

const URLS = {
  companies: 'https://openapi.twse.com.tw/v1/opendata/t187ap03_L',
  index: 'https://openapi.twse.com.tw/v1/exchangeReport/MI_INDEX',
  limits: 'https://openapi.twse.com.tw/v1/exchangeReport/TWT84U',
  taifex: 'https://www.taifex.com.tw/cht/2/weightedPropertion',
} as const;

const CACHE_DURATION_MS = 15 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 45_000;
const MAX_REQUEST_ATTEMPTS = 3;

export type WeightsPayload = {
  dataDate: string;
  taifexDataDate: string;
  companyDataDate: string;
  generatedAt: string;
  stale: boolean;
  rows: StockWeightRow[];
  meta: {
    taiexClose: number;
    totalMarketCap: number;
    divisorEstimate: number;
    constituentCount: number;
    pricedConstituentCount: number;
    missingConstituentCount: number;
    missingLimitCountInTop100: number;
    referenceAdjustmentCountInTop100: number;
  };
  warnings: string[];
};

type JsonRecord = Record<string, unknown>;

let cache: { payload: WeightsPayload; expiresAt: number } | null = null;
let inFlight: Promise<WeightsPayload> | null = null;

function textField(row: JsonRecord, key: string) {
  const value = row[key];
  return typeof value === 'string' ? value.trim() : '';
}

function numberField(row: JsonRecord, key: string) {
  const normalized = textField(row, key).replaceAll(',', '');
  if (!normalized || normalized === '--') return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function mostCommonDate(dates: string[]) {
  const counts = new Map<string, number>();
  for (const date of dates) {
    if (date) counts.set(date, (counts.get(date) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
}

async function fetchOfficial<T>(
  url: string,
  readBody: (response: Response) => Promise<T>,
) {
  const source = `${new URL(url).hostname}${new URL(url).pathname}`;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json, text/html;q=0.9, */*;q=0.8' },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await readBody(response);
    } catch (error: unknown) {
      const detail = controller.signal.aborted
        ? `下載超過 ${REQUEST_TIMEOUT_MS / 1000} 秒`
        : error instanceof Error
          ? error.message
          : '未知錯誤';
      lastError = new Error(
        `${source} 第 ${attempt}/${MAX_REQUEST_ATTEMPTS} 次下載失敗：${detail}。`,
      );
    } finally {
      clearTimeout(timeout);
    }

    if (attempt < MAX_REQUEST_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }

  throw lastError ?? new Error(`${source} 下載失敗。`);
}

async function fetchJson(url: string) {
  const body: unknown = await fetchOfficial(url, (response) =>
    response.json(),
  );
  if (!Array.isArray(body)) {
    throw new Error(`${new URL(url).pathname} 回傳格式不是陣列。`);
  }
  return body as JsonRecord[];
}

async function fetchText(url: string) {
  return fetchOfficial(url, (response) => response.text());
}

function parseLimits(rows: JsonRecord[]) {
  return rows
    .map((row): LimitQuote | null => {
      const code = textField(row, 'Code');
      const dataDate = rocDateToIso(textField(row, 'LastTradingDay'));
      if (!code || !dataDate) return null;

      return {
        code,
        previousClose: numberField(row, 'PreviousDayPrice'),
        referencePrice: numberField(row, 'TodayOpeningRefPrice'),
        limitUp: numberField(row, 'TodayLimitUp'),
        limitDown: numberField(row, 'TodayLimitDown'),
        dataDate,
      };
    })
    .filter((row): row is LimitQuote => row !== null);
}

function parseCompanies(rows: JsonRecord[]) {
  return rows
    .map((row): CompanyInfo | null => {
      const code = textField(row, '公司代號');
      const reportDate = rocDateToIso(textField(row, '出表日期'));
      if (!code || !reportDate) return null;

      const issuedShares = numberField(
        row,
        '已發行普通股數或TDR原股發行股數',
      );
      const privateShares = numberField(row, '私募股數') ?? 0;
      const indexShares =
        issuedShares !== null &&
        privateShares >= 0 &&
        privateShares < issuedShares
          ? issuedShares - privateShares
          : null;

      return {
        code,
        indexShares,
        reportDate,
      };
    })
    .filter((row): row is CompanyInfo => row !== null);
}

async function loadFreshPayload(): Promise<WeightsPayload> {
  const [taifexHtml, limitRows, companyRows, indexRows] = await Promise.all([
    fetchText(URLS.taifex),
    fetchJson(URLS.limits),
    fetchJson(URLS.companies),
    fetchJson(URLS.index),
  ]);
  const constituents = parseTaifexConstituents(taifexHtml);
  validateTaifexConstituents(constituents);

  const taifexDataDate = parseTaifexDataDate(taifexHtml);
  if (!taifexDataDate) {
    throw new Error('TAIFEX 頁面找不到資料日期。');
  }

  const limits = parseLimits(limitRows);
  const companies = parseCompanies(companyRows);
  const dataDate = mostCommonDate(limits.map((row) => row.dataDate));
  const companyDataDate = mostCommonDate(
    companies.map((row) => row.reportDate),
  );
  if (!dataDate || !companyDataDate) {
    throw new Error('TWSE 資料日期缺漏。');
  }

  const taiexRow = indexRows.find(
    (row) => textField(row, '指數') === '發行量加權股價指數',
  );
  if (!taiexRow) {
    throw new Error('TWSE 指數資料找不到發行量加權股價指數。');
  }
  const taiexDate = rocDateToIso(textField(taiexRow, '日期'));
  const taiexClose = numberField(taiexRow, '收盤指數');
  if (!taiexDate || taiexClose === null || taiexClose <= 0) {
    throw new Error('TWSE 加權指數日期或收盤指數無效。');
  }
  assertMatchingMarketDates(dataDate, taiexDate);

  const calculation = calculateStockWeights({
    constituents,
    limits,
    companies,
    taiexClose,
  });
  const warnings: string[] = [];
  if (calculation.missingConstituentCount > 0) {
    warnings.push(
      `${calculation.missingConstituentCount} 檔成分股因股本或昨收缺漏，未納入權重母體。`,
    );
  }
  if (calculation.missingLimitCountInTop100 > 0) {
    warnings.push(
      `前 100 大有 ${calculation.missingLimitCountInTop100} 檔缺少漲跌停價，貢獻點數顯示為空值。`,
    );
  }
  if (companyDataDate !== dataDate) {
    warnings.push(
      `公司股本資料日期為 ${companyDataDate}，市場資料日期為 ${dataDate}。`,
    );
  }

  return {
    dataDate,
    taifexDataDate,
    companyDataDate,
    generatedAt: new Date().toISOString(),
    stale: false,
    rows: calculation.rows,
    meta: {
      taiexClose,
      totalMarketCap: calculation.totalMarketCap,
      divisorEstimate: calculation.divisorEstimate,
      constituentCount: constituents.length,
      pricedConstituentCount: calculation.pricedConstituentCount,
      missingConstituentCount: calculation.missingConstituentCount,
      missingLimitCountInTop100: calculation.missingLimitCountInTop100,
      referenceAdjustmentCountInTop100: calculation.rows.filter(
        (row) => row.hasReferenceAdjustment,
      ).length,
    },
    warnings,
  };
}

export async function getWeightsPayload(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cache && cache.expiresAt > now) {
    return cache.payload;
  }
  if (inFlight) return inFlight;

  inFlight = loadFreshPayload()
    .then((payload) => {
      cache = { payload, expiresAt: Date.now() + CACHE_DURATION_MS };
      return payload;
    })
    .catch((error: unknown) => {
      if (!cache) throw error;
      const message =
        error instanceof Error ? error.message : '官方資料更新失敗。';
      return {
        ...cache.payload,
        stale: true,
        warnings: [
          ...cache.payload.warnings,
          `本次更新失敗，沿用上次成功資料：${message}`,
        ],
      };
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}
