import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertMatchingMarketDates,
  calculateStockWeights,
  parseTaifexConstituents,
  parseTaifexDataDate,
  rocDateToIso,
  validateTaifexConstituents,
  type CompanyInfo,
  type LimitQuote,
  type TaifexConstituent,
} from '../lib/stock-weights.ts';

const htmlRow = ({
  side,
  rank,
  code,
  name,
  weight,
}: {
  side: 'a' | 'b';
  rank: string;
  code: string;
  name: string;
  weight: string;
}) => `
  <td headers=rank_${side}>${rank}</td>
  <td headers=name_${side}>${code}</td>
  <td headers=name_${side}><span>${name}</span></td>
  <td headers=propertion_${side}>${weight}%</td>`;

const constituent = (
  code: string,
  sourceRank: number,
  officialWeight = 1,
): TaifexConstituent => ({
  code,
  name: `公司${code}`,
  sourceRank,
  officialWeight,
});

const company = (code: string, indexShares: number): CompanyInfo => ({
  code,
  indexShares,
  reportDate: '2026-08-31',
});

const quote = (
  code: string,
  overrides: Partial<LimitQuote> = {},
): LimitQuote => ({
  code,
  previousClose: 100,
  referencePrice: 100,
  limitUp: 110,
  limitDown: 90,
  dataDate: '2026-08-31',
  ...overrides,
});

test('解析 TAIFEX 千分位排名，並合併內容完全相同的重複表格', () => {
  const table = [
    htmlRow({
      side: 'a',
      rank: '1',
      code: '2330',
      name: '台積電',
      weight: '41.4777',
    }),
    htmlRow({
      side: 'b',
      rank: '1,000',
      code: '1474',
      name: '弘裕',
      weight: '0.0009',
    }),
  ].join('');
  const rows = parseTaifexConstituents(`${table}${table}`);

  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.sourceRank), [1, 1000]);
  assert.equal(rows[1].code, '1474');
});

test('拒絕同排名卻不同股票的 TAIFEX 清單', () => {
  const rows = [constituent('2330', 1), constituent('2454', 1)];
  assert.throws(
    () => validateTaifexConstituents(rows, 2),
    /排名重複：1/,
  );
});

test('解析 TAIFEX 與民國日期，拒絕不存在的日期', () => {
  assert.equal(
    parseTaifexDataDate('資料日期：\n 2026/8/31<br>'),
    '2026-08-31',
  );
  assert.equal(rocDateToIso('1150831'), '2026-08-31');
  assert.equal(rocDateToIso('1150230'), null);
});

test('跨來源交易日期不同時停止輸出', () => {
  assert.throws(
    () => assertMatchingMarketDates('2026-08-31', '2026-08-28'),
    /跨來源日期不一致/,
  );
});

test('每日市值排名、累加權重與貢獻點數依估算除數計算', () => {
  const result = calculateStockWeights({
    constituents: [constituent('A', 2), constituent('B', 1), constituent('C', 3)],
    companies: [company('A', 1000), company('B', 500), company('C', 100)],
    limits: [quote('A'), quote('B'), quote('C')],
    taiexClose: 10_000,
    topCount: 3,
  });

  assert.deepEqual(result.rows.map((row) => row.code), ['A', 'B', 'C']);
  assert.equal(result.totalMarketCap, 0.0016);
  assert.equal(result.divisorEstimate, 16);
  assert.equal(result.rows[0].weight, 62.5);
  assert.equal(result.rows[1].cumulativeWeight, 93.75);
  assert.equal(result.rows[0].upContribution, 625);
  assert.equal(result.rows[0].downContribution, -625);
});

test('漲跌停跳動單位造成不對稱時，不強制取絕對值', () => {
  const result = calculateStockWeights({
    constituents: [constituent('A', 1)],
    companies: [company('A', 1000)],
    limits: [
      quote('A', {
        previousClose: 999,
        referencePrice: 999,
        limitUp: 1095,
        limitDown: 900,
      }),
    ],
    taiexClose: 10_000,
    topCount: 1,
  });

  assert.ok(result.rows[0].upContribution! > 0);
  assert.ok(result.rows[0].downContribution! < 0);
  assert.notEqual(
    result.rows[0].upContribution,
    Math.abs(result.rows[0].downContribution!),
  );
});

test('開盤競價基準低於昨收時，漲停貢獻可為負值並標記調整', () => {
  const result = calculateStockWeights({
    constituents: [constituent('A', 1)],
    companies: [company('A', 1000)],
    limits: [
      quote('A', {
        previousClose: 100,
        referencePrice: 80,
        limitUp: 88,
        limitDown: 72,
      }),
    ],
    taiexClose: 10_000,
    topCount: 1,
  });

  assert.equal(result.rows[0].hasReferenceAdjustment, true);
  assert.ok(result.rows[0].upContribution! < 0);
});

test('缺少漲跌停價時保留股票，但貢獻顯示空值', () => {
  const result = calculateStockWeights({
    constituents: [constituent('A', 1)],
    companies: [company('A', 1000)],
    limits: [quote('A', { limitUp: null, limitDown: null })],
    taiexClose: 10_000,
    topCount: 1,
  });

  assert.equal(result.rows[0].upContribution, null);
  assert.equal(result.rows[0].downContribution, null);
  assert.equal(result.missingLimitCountInTop100, 1);
});

test('可計算市值覆蓋率低於 95% 時拒絕輸出', () => {
  const constituents = Array.from({ length: 20 }, (_, index) =>
    constituent(String(index), index + 1),
  );
  const companies = constituents
    .slice(0, 18)
    .map((row) => company(row.code, 1000));
  const limits = constituents.slice(0, 18).map((row) => quote(row.code));

  assert.throws(
    () =>
      calculateStockWeights({
        constituents,
        companies,
        limits,
        taiexClose: 10_000,
        topCount: 1,
      }),
    /覆蓋率僅 90.0%/,
  );
});
