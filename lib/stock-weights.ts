export type TaifexConstituent = {
  sourceRank: number;
  code: string;
  name: string;
  officialWeight: number;
};

export type LimitQuote = {
  code: string;
  previousClose: number | null;
  referencePrice: number | null;
  limitUp: number | null;
  limitDown: number | null;
  dataDate: string;
};

export type CompanyInfo = {
  code: string;
  indexShares: number | null;
  reportDate: string;
};

export type StockWeightRow = {
  rank: number;
  code: string;
  name: string;
  marketCap: number;
  weight: number;
  cumulativeWeight: number;
  previousClose: number;
  rawPreviousClose: number;
  referencePrice: number | null;
  limitUp: number | null;
  upContribution: number | null;
  limitDown: number | null;
  downContribution: number | null;
  hasReferenceAdjustment: boolean;
  officialMonthlyWeight: number;
};

export type CalculationResult = {
  rows: StockWeightRow[];
  totalMarketCap: number;
  divisorEstimate: number;
  pricedConstituentCount: number;
  missingConstituentCount: number;
  missingLimitCountInTop100: number;
};

const stripTags = (value: string) => value.replace(/<[^>]*>/g, '');

function decodeHtml(value: string) {
  const namedEntities: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };

  return value.replace(
    /&(#(?:x[0-9a-f]+|\d+)|[a-z]+);/gi,
    (entity, key: string) => {
      if (key.startsWith('#x')) {
        return String.fromCodePoint(Number.parseInt(key.slice(2), 16));
      }
      if (key.startsWith('#')) {
        return String.fromCodePoint(Number.parseInt(key.slice(1), 10));
      }
      return namedEntities[key.toLowerCase()] ?? entity;
    },
  );
}

export function parseTaifexConstituents(html: string) {
  const rows: TaifexConstituent[] = [];
  const rowPattern =
    /<td\b[^>]*headers\s*=\s*rank_([ab])[^>]*>([\s\S]*?)<\/td>\s*<td\b[^>]*headers\s*=\s*name_\1[^>]*>([\s\S]*?)<\/td>\s*<td\b[^>]*headers\s*=\s*name_\1[^>]*>([\s\S]*?)<\/td>\s*<td\b[^>]*headers\s*=\s*propertion_\1[^>]*>([\s\S]*?)<\/td>/gi;

  for (const match of html.matchAll(rowPattern)) {
    const sourceRank = Number.parseInt(
      stripTags(match[2]).replaceAll(',', '').trim(),
      10,
    );
    const code = stripTags(match[3]).trim();
    const name = decodeHtml(stripTags(match[4]).trim());
    const officialWeight = Number.parseFloat(
      stripTags(match[5]).replace('%', '').trim(),
    );

    if (
      Number.isInteger(sourceRank) &&
      code.length > 0 &&
      name.length > 0 &&
      Number.isFinite(officialWeight)
    ) {
      rows.push({ sourceRank, code, name, officialWeight });
    }
  }

  const uniqueRows = new Map<string, TaifexConstituent>();
  for (const row of rows) {
    const key = `${row.sourceRank}:${row.code}`;
    const existing = uniqueRows.get(key);
    if (!existing) {
      uniqueRows.set(key, row);
      continue;
    }
    if (
      existing.name !== row.name ||
      existing.officialWeight !== row.officialWeight
    ) {
      throw new Error(`TAIFEX 重複列內容不一致：排名 ${row.sourceRank}`);
    }
  }

  return [...uniqueRows.values()].sort(
    (left, right) => left.sourceRank - right.sourceRank,
  );
}

export function parseTaifexDataDate(html: string) {
  const match = html.match(
    /資料日期\s*[:：]\s*(\d{4})\/(\d{1,2})\/(\d{1,2})/,
  );
  if (!match) return null;

  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

export function validateTaifexConstituents(
  constituents: TaifexConstituent[],
  minimumCount = 900,
) {
  if (constituents.length < minimumCount) {
    throw new Error(
      `TAIFEX 成分股僅解析到 ${constituents.length} 檔，低於安全門檻 ${minimumCount} 檔。`,
    );
  }

  const codes = new Set<string>();
  const ranks = new Set<number>();
  for (const row of constituents) {
    if (codes.has(row.code)) {
      throw new Error(`TAIFEX 成分股代碼重複：${row.code}`);
    }
    if (ranks.has(row.sourceRank)) {
      throw new Error(`TAIFEX 成分股排名重複：${row.sourceRank}`);
    }
    codes.add(row.code);
    ranks.add(row.sourceRank);
  }
}

export function rocDateToIso(value: string) {
  const match = value.trim().match(/^(\d{3})(\d{2})(\d{2})$/);
  if (!match) return null;

  const year = Number.parseInt(match[1], 10) + 1911;
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function assertMatchingMarketDates(
  limitDataDate: string,
  indexDataDate: string,
) {
  if (limitDataDate !== indexDataDate) {
    throw new Error(
      `TWSE 跨來源日期不一致：漲跌停資料 ${limitDataDate}、指數資料 ${indexDataDate}。`,
    );
  }
}

export function calculateStockWeights({
  constituents,
  limits,
  companies,
  taiexClose,
  topCount = 100,
}: {
  constituents: TaifexConstituent[];
  limits: LimitQuote[];
  companies: CompanyInfo[];
  taiexClose: number;
  topCount?: number;
}): CalculationResult {
  if (!Number.isFinite(taiexClose) || taiexClose <= 0) {
    throw new Error('加權指數昨收無效，無法估算指數除數。');
  }

  const limitByCode = new Map(limits.map((row) => [row.code, row]));
  const companyByCode = new Map(companies.map((row) => [row.code, row]));
  const pricedRows: Array<{
    constituent: TaifexConstituent;
    quote: LimitQuote;
    marketCapRaw: number;
  }> = [];

  for (const constituent of constituents) {
    const quote = limitByCode.get(constituent.code);
    const indexShares = companyByCode.get(constituent.code)?.indexShares;
    if (
      !quote ||
      quote.previousClose === null ||
      quote.previousClose <= 0 ||
      indexShares === null ||
      indexShares === undefined ||
      indexShares <= 0
    ) {
      continue;
    }

    const marketCapRaw = indexShares * quote.previousClose;
    if (!Number.isFinite(marketCapRaw) || marketCapRaw <= 0) continue;

    pricedRows.push({
      constituent,
      quote,
      marketCapRaw,
    });
  }

  const coverage = pricedRows.length / constituents.length;
  if (coverage < 0.95) {
    throw new Error(
      `可計算市值的成分股覆蓋率僅 ${(coverage * 100).toFixed(1)}%，已停止輸出以避免失真。`,
    );
  }
  if (pricedRows.length < topCount) {
    throw new Error(
      `可計算市值的成分股只有 ${pricedRows.length} 檔，不足前 ${topCount} 大。`,
    );
  }

  const totalMarketCapRaw = pricedRows.reduce(
    (total, row) => total + row.marketCapRaw,
    0,
  );
  const divisorEstimate = totalMarketCapRaw / taiexClose;
  let cumulativeWeight = 0;

  const rows = pricedRows
    .sort((left, right) => right.marketCapRaw - left.marketCapRaw)
    .slice(0, topCount)
    .map((item, index): StockWeightRow => {
      const weight = (item.marketCapRaw / totalMarketCapRaw) * 100;
      cumulativeWeight += weight;
      const { quote } = item;
      const priceBasis =
        quote.referencePrice !== null && quote.referencePrice > 0
          ? quote.referencePrice
          : quote.previousClose!;
      const upContribution =
        quote.limitUp === null
          ? null
          : (item.marketCapRaw *
              ((quote.limitUp - priceBasis) / priceBasis)) /
            divisorEstimate;
      const downContribution =
        quote.limitDown === null
          ? null
          : (item.marketCapRaw *
              ((quote.limitDown - priceBasis) / priceBasis)) /
            divisorEstimate;

      return {
        rank: index + 1,
        code: item.constituent.code,
        name: item.constituent.name,
        marketCap: item.marketCapRaw / 100_000_000,
        weight,
        cumulativeWeight,
        previousClose: priceBasis,
        rawPreviousClose: quote.previousClose!,
        referencePrice: quote.referencePrice,
        limitUp: quote.limitUp,
        upContribution,
        limitDown: quote.limitDown,
        downContribution,
        hasReferenceAdjustment:
          Math.abs(priceBasis - quote.previousClose!) > 0.000_001,
        officialMonthlyWeight: item.constituent.officialWeight,
      };
    });

  return {
    rows,
    totalMarketCap: totalMarketCapRaw / 100_000_000,
    divisorEstimate,
    pricedConstituentCount: pricedRows.length,
    missingConstituentCount: constituents.length - pricedRows.length,
    missingLimitCountInTop100: rows.filter(
      (row) => row.limitUp === null || row.limitDown === null,
    ).length,
  };
}
