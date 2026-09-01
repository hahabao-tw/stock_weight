'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Database,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { StockWeightRow } from '@/lib/stock-weights';

type WeightsPayload = {
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

const decimalFormatter = new Intl.NumberFormat('zh-TW', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const priceFormatter = new Intl.NumberFormat('zh-TW', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function formatDate(value?: string) {
  return value ? value.replaceAll('-', '/') : '—';
}

function formatNullable(value: number | null, formatter = priceFormatter) {
  return value === null ? '—' : formatter.format(value);
}

function formatSigned(value: number | null) {
  if (value === null) return '—';
  const normalized = Math.abs(value) < 0.005 ? 0 : value;
  return `${normalized > 0 ? '+' : ''}${decimalFormatter.format(normalized)}`;
}

function contributionClass(value: number | null) {
  if (value === null || Math.abs(value) < 0.005) return 'text-muted-foreground';
  return value > 0 ? 'text-market-up-strong' : 'text-market-down-strong';
}

function isWeightsPayload(value: unknown): value is WeightsPayload {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<WeightsPayload>;
  return (
    typeof candidate.dataDate === 'string' &&
    Array.isArray(candidate.rows) &&
    candidate.rows.length === 100 &&
    !!candidate.meta &&
    Array.isArray(candidate.warnings)
  );
}

function getErrorMessage(value: unknown) {
  if (value && typeof value === 'object' && 'error' in value) {
    const message = (value as { error?: unknown }).error;
    if (typeof message === 'string') return message;
  }
  return '資料格式不完整，請稍後再試。';
}

export default function Home() {
  const [query, setQuery] = useState('');
  const [selectedCodes, setSelectedCodes] = useState<Set<string>>(new Set());
  const [payload, setPayload] = useState<WeightsPayload | null>(null);
  const [refreshing, setRefreshing] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadWeights = useCallback(
    async (forceRefresh: boolean, signal?: AbortSignal) => {
      try {
        const response = await fetch(
          forceRefresh ? '/api/weights?refresh=1' : '/api/weights',
          { cache: 'no-store', signal },
        );
        const body: unknown = await response.json();
        if (!response.ok) throw new Error(getErrorMessage(body));
        if (!isWeightsPayload(body)) {
          throw new Error('官方資料未完整產生前 100 大。');
        }

        setPayload(body);
        const validCodes = new Set(body.rows.map((row) => row.code));
        setSelectedCodes(
          (current) =>
            new Set([...current].filter((code) => validCodes.has(code))),
        );
      } catch (requestError: unknown) {
        if (
          requestError instanceof DOMException &&
          requestError.name === 'AbortError'
        ) {
          return;
        }
        setError(
          requestError instanceof Error
            ? requestError.message
            : '無法取得官方市場資料。',
        );
      } finally {
        if (!signal?.aborted) setRefreshing(false);
      }
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    const requestTimer = window.setTimeout(() => {
      void loadWeights(false, controller.signal);
    }, 0);
    return () => {
      window.clearTimeout(requestTimer);
      controller.abort();
    };
  }, [loadWeights]);

  const rows = useMemo(() => payload?.rows ?? [], [payload]);
  const visibleRows = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return rows;
    return rows.filter(
      (row) =>
        row.code.includes(keyword) || row.name.toLowerCase().includes(keyword),
    );
  }, [query, rows]);

  const selectedRows = useMemo(
    () => rows.filter((row) => selectedCodes.has(row.code)),
    [rows, selectedCodes],
  );
  const totalUp = selectedRows.reduce(
    (sum, row) => sum + (row.upContribution ?? 0),
    0,
  );
  const totalDown = selectedRows.reduce(
    (sum, row) => sum + (row.downContribution ?? 0),
    0,
  );

  function toggleRow(code: string, checked: boolean) {
    setSelectedCodes((current) => {
      const next = new Set(current);
      if (checked) next.add(code);
      else next.delete(code);
      return next;
    });
  }

  function refreshWeights() {
    setRefreshing(true);
    setError(null);
    void loadWeights(true);
  }

  const statusLabel = refreshing
    ? '更新中'
    : error && !payload
      ? '讀取失敗'
      : payload?.stale
        ? '沿用快取'
        : '已同步';

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-[1800px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm">
              <BarChart3 className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold tracking-tight sm:text-lg">
                加權指數權值表
              </h1>
              <p className="truncate text-xs text-muted-foreground">
                前 100 大 · 漲跌停貢獻點數估算
              </p>
            </div>
          </div>
          <div className="hidden items-center gap-2 text-xs text-muted-foreground md:flex">
            <Database className="size-3.5" aria-hidden="true" />
            <span>市場資料 {formatDate(payload?.dataDate)}</span>
            <Badge
              className={
                error && !payload
                  ? 'bg-destructive/10 text-destructive'
                  : 'bg-status-fresh text-status-fresh-foreground'
              }
            >
              {statusLabel}
            </Badge>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1800px] px-4 py-4 sm:px-6 sm:py-5">
        <section className="mb-4 grid gap-3 xl:grid-cols-[minmax(340px,1fr)_auto]">
          <div className="flex flex-col justify-between gap-3 rounded-xl border bg-card p-3 shadow-sm sm:flex-row sm:items-center">
            <div className="relative w-full max-w-md">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="輸入股票代碼或公司名稱"
                aria-label="搜尋股票"
                className="h-9 bg-background pl-9 pr-9"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="清除搜尋"
                >
                  <X className="size-3.5" />
                </button>
              ) : null}
            </div>
            <div className="flex items-center justify-between gap-3 sm:justify-end">
              <div className="text-xs leading-5 text-muted-foreground">
                <span className="block md:hidden">
                  市場資料 {formatDate(payload?.dataDate)}
                </span>
                <span>權重每日重算 · 單位：億元／點</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={refreshing}
                onClick={refreshWeights}
              >
                <RefreshCw
                  data-icon="inline-start"
                  className={refreshing ? 'animate-spin' : undefined}
                />
                更新
              </Button>
            </div>
          </div>

          <aside
            className="grid min-w-[450px] grid-cols-[minmax(180px,1fr)_140px_140px] overflow-hidden rounded-xl border bg-ink text-white shadow-sm max-xl:min-w-0 max-sm:grid-cols-2"
            aria-label="已選股票貢獻合計"
          >
            <div className="border-white/10 p-3 max-sm:col-span-2 sm:border-r">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-white/60">
                  已選 {selectedRows.length} 檔
                </span>
                {selectedRows.length ? (
                  <button
                    type="button"
                    onClick={() => setSelectedCodes(new Set())}
                    className="text-xs text-white/60 hover:text-white"
                  >
                    清除
                  </button>
                ) : null}
              </div>
              <p
                className="mt-1 truncate text-sm font-semibold"
                title={selectedRows
                  .map((row) => `${row.code} ${row.name}`)
                  .join('、')}
              >
                {selectedRows.length
                  ? selectedRows
                      .map((row) => `${row.code} ${row.name}`)
                      .join('、')
                  : '從表格右側勾選股票'}
              </p>
            </div>
            <div className="border-l border-white/10 p-3 max-sm:border-l-0 max-sm:border-t">
              <span className="text-xs text-white/55">全數漲停</span>
              <p
                className={`mt-0.5 font-mono text-lg font-bold tabular-nums ${
                  totalUp >= 0 ? 'text-market-up' : 'text-market-down'
                }`}
              >
                {formatSigned(totalUp)}
              </p>
            </div>
            <div className="border-l border-white/10 p-3 max-sm:border-t">
              <span className="text-xs text-white/55">全數跌停</span>
              <p
                className={`mt-0.5 font-mono text-lg font-bold tabular-nums ${
                  totalDown > 0 ? 'text-market-up' : 'text-market-down'
                }`}
              >
                {formatSigned(totalDown)}
              </p>
            </div>
          </aside>
        </section>

        {error ? (
          <div
            className="mb-3 flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            role="alert"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        ) : null}

        {payload?.warnings.length ? (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>{payload.warnings.join('；')}</span>
          </div>
        ) : null}

        <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
            <div>
              <h2 className="text-sm font-bold">權值排行</h2>
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {payload
                  ? `顯示 ${visibleRows.length}／${rows.length} 檔 · 加權昨收 ${decimalFormatter.format(payload.meta.taiexClose)}`
                  : '正在整理官方市場資料…'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {payload ? (
                <Badge variant="outline" className="text-muted-foreground">
                  成分日期 {formatDate(payload.taifexDataDate)}
                </Badge>
              ) : null}
              <Badge variant="outline" className="text-muted-foreground">
                貢獻點數為估算值
              </Badge>
            </div>
          </div>

          <Table className="min-w-[1450px] text-xs">
            <TableHeader className="sticky top-0 z-10 bg-table-header">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-14 text-center">排名</TableHead>
                <TableHead className="w-20">代碼</TableHead>
                <TableHead className="w-32">公司名稱</TableHead>
                <TableHead className="text-right">市值</TableHead>
                <TableHead className="text-right">占大盤比重</TableHead>
                <TableHead className="text-right">累加比重</TableHead>
                <TableHead className="text-right">昨收</TableHead>
                <TableHead className="text-right">漲停價</TableHead>
                <TableHead className="text-right">漲停貢獻</TableHead>
                <TableHead className="text-right">跌停價</TableHead>
                <TableHead className="text-right">跌停貢獻</TableHead>
                <TableHead className="sticky right-0 z-20 w-16 bg-table-header text-center">
                  選取
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!payload && refreshing
                ? Array.from({ length: 8 }, (_, index) => (
                    <TableRow key={index} className="h-12">
                      {Array.from({ length: 12 }, (__, cellIndex) => (
                        <TableCell key={cellIndex}>
                          <Skeleton className="ml-auto h-4 w-14" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                : visibleRows.map((row) => {
                    const checked = selectedCodes.has(row.code);
                    return (
                      <TableRow
                        key={row.code}
                        data-state={checked ? 'selected' : undefined}
                        className="h-12"
                      >
                        <TableCell className="text-center font-mono text-muted-foreground">
                          {row.rank}
                        </TableCell>
                        <TableCell className="font-mono font-bold text-code">
                          {row.code}
                        </TableCell>
                        <TableCell className="font-semibold">{row.name}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {decimalFormatter.format(row.marketCap)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {row.weight.toFixed(4)}%
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                          {row.cumulativeWeight.toFixed(4)}%
                        </TableCell>
                        <TableCell
                          className="text-right font-mono font-semibold tabular-nums"
                          title={
                            row.hasReferenceAdjustment
                              ? `今日開盤競價基準價 ${formatNullable(row.referencePrice)}，與昨收不同`
                              : undefined
                          }
                        >
                          {priceFormatter.format(row.previousClose)}
                          {row.hasReferenceAdjustment ? (
                            <sup className="ml-0.5 text-amber-600">＊</sup>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-market-up-strong">
                          {formatNullable(row.limitUp)}
                        </TableCell>
                        <TableCell
                          className={`text-right font-mono font-bold tabular-nums ${contributionClass(row.upContribution)}`}
                        >
                          {formatSigned(row.upContribution)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-market-down-strong">
                          {formatNullable(row.limitDown)}
                        </TableCell>
                        <TableCell
                          className={`text-right font-mono font-bold tabular-nums ${contributionClass(row.downContribution)}`}
                        >
                          {formatSigned(row.downContribution)}
                        </TableCell>
                        <TableCell className="sticky right-0 bg-card text-center [tr[data-state=selected]_&]:bg-muted">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(value) =>
                              toggleRow(row.code, value === true)
                            }
                            aria-label={`選取 ${row.code} ${row.name}`}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
            </TableBody>
          </Table>

          {payload && visibleRows.length === 0 ? (
            <div className="grid min-h-48 place-items-center px-4 text-center">
              <div>
                <p className="text-sm font-semibold">找不到符合的股票</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  請檢查股票代碼或公司名稱
                </p>
              </div>
            </div>
          ) : null}

          {!payload && !refreshing ? (
            <div className="grid min-h-48 place-items-center px-4 text-center">
              <div>
                <p className="text-sm font-semibold">尚未取得市場資料</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={refreshWeights}
                >
                  重新讀取
                </Button>
              </div>
            </div>
          ) : null}

          <footer className="space-y-1 border-t bg-muted/25 px-4 py-3 text-[11px] leading-5 text-muted-foreground">
            <p>
              市值與權重依「已發行普通股數－私募股數」× 昨收每日重算；TAIFEX 清單每月底更新。
            </p>
            <p>
              貢獻點數＝指數有效股數 ×（漲跌停價－昨收）÷ 估算指數除數。＊若開盤競價基準價與昨收不同，漲停貢獻未必為正值。
            </p>
            <p>
              資料來源：
              <a
                className="underline-offset-2 hover:text-foreground hover:underline"
                href="https://www.taifex.com.tw/cht/2/weightedPropertion"
                target="_blank"
                rel="noreferrer"
              >
                TAIFEX
              </a>
              {' · '}
              <a
                className="underline-offset-2 hover:text-foreground hover:underline"
                href="https://openapi.twse.com.tw/"
                target="_blank"
                rel="noreferrer"
              >
                TWSE OpenAPI
              </a>
            </p>
          </footer>
        </section>
      </div>
    </main>
  );
}
