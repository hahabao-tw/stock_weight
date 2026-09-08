'use client';

import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AlertTriangle,
  BarChart3,
  Contrast,
  Database,
  Moon,
  RefreshCw,
  Search,
  Sun,
  Type,
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
import {
  DEFAULT_DESKTOP_FONT_SIZE,
  getDefaultFontSize,
  getNextThemeMode,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  normalizeFontSize,
  normalizeThemeMode,
  type ThemeMode,
} from '@/lib/ui-preferences';

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

const themeLabels: Record<ThemeMode, string> = {
  light: '日間',
  dark: '夜間',
  contrast: '高對比',
};

function applyThemeMode(mode: ThemeMode) {
  const root = document.documentElement;
  root.classList.toggle('dark', mode === 'dark');
  root.classList.toggle('high-contrast', mode === 'contrast');
  root.dataset.themeMode = mode;
}

function applyFontSize(size: number) {
  document.documentElement.style.setProperty('--user-font-size', `${size}px`);
}

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

function getWeightsUrl(forceRefresh: boolean) {
  const staticDataUrl = document.querySelector<HTMLMetaElement>(
    'meta[name="stock-weight-data-url"]',
  )?.content;
  if (staticDataUrl) {
    const url = new URL(staticDataUrl, window.location.href);
    if (forceRefresh) url.searchParams.set('v', String(Date.now()));
    return url.toString();
  }
  return forceRefresh ? '/api/weights?refresh=1' : '/api/weights';
}

export default function Home() {
  const [query, setQuery] = useState('');
  const [selectedCodes, setSelectedCodes] = useState<Set<string>>(new Set());
  const [payload, setPayload] = useState<WeightsPayload | null>(null);
  const [refreshing, setRefreshing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fontSizeSliderRef = useRef<HTMLInputElement>(null);
  const fontSizeOutputRef = useRef<HTMLOutputElement>(null);
  const themeModeRef = useRef<ThemeMode>('light');
  const themeButtonRef = useRef<HTMLButtonElement>(null);
  const themeModeLabelRef = useRef<HTMLSpanElement>(null);

  const loadWeights = useCallback(
    async (forceRefresh: boolean, signal?: AbortSignal) => {
      try {
        const response = await fetch(getWeightsUrl(forceRefresh), {
          cache: 'no-store',
          signal,
        });
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
    const prefersDark = window.matchMedia(
      '(prefers-color-scheme: dark)',
    ).matches;
    const isMobile = window.matchMedia('(max-width: 639px)').matches;
    let savedTheme: string | null = null;
    let savedFontSize: string | null = null;

    try {
      savedTheme = window.localStorage.getItem('stock-weight-theme');
      savedFontSize = window.localStorage.getItem('stock-weight-font-size');
    } catch {
      // Storage may be unavailable in privacy mode; the controls still work.
    }

    const themeMode = normalizeThemeMode(savedTheme, prefersDark);
    const defaultFontSize = getDefaultFontSize(isMobile);
    const fontSize = savedFontSize
      ? normalizeFontSize(savedFontSize, defaultFontSize)
      : defaultFontSize;

    applyThemeMode(themeMode);
    applyFontSize(fontSize);
    themeModeRef.current = themeMode;
    if (themeModeLabelRef.current) {
      themeModeLabelRef.current.textContent = themeLabels[themeMode];
    }
    themeButtonRef.current?.setAttribute(
      'aria-label',
      `目前${themeLabels[themeMode]}模式，切換顯示模式`,
    );
    if (fontSizeSliderRef.current) {
      fontSizeSliderRef.current.value = String(fontSize);
    }
    if (fontSizeOutputRef.current) {
      fontSizeOutputRef.current.value = String(fontSize);
      fontSizeOutputRef.current.textContent = String(fontSize);
    }
  }, []);

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

  function changeFontSize(event: ChangeEvent<HTMLInputElement>) {
    const nextValue = normalizeFontSize(event.currentTarget.value);
    applyFontSize(nextValue);
    if (fontSizeOutputRef.current) {
      fontSizeOutputRef.current.value = String(nextValue);
      fontSizeOutputRef.current.textContent = String(nextValue);
    }
    try {
      window.localStorage.setItem('stock-weight-font-size', String(nextValue));
    } catch {
      // Keep the current-session setting when storage is unavailable.
    }
  }

  function toggleTheme() {
    const nextMode = getNextThemeMode(themeModeRef.current);
    applyThemeMode(nextMode);
    themeModeRef.current = nextMode;
    if (themeModeLabelRef.current) {
      themeModeLabelRef.current.textContent = themeLabels[nextMode];
    }
    themeButtonRef.current?.setAttribute(
      'aria-label',
      `目前${themeLabels[nextMode]}模式，切換顯示模式`,
    );
    try {
      window.localStorage.setItem('stock-weight-theme', nextMode);
    } catch {
      // Keep the current-session setting when storage is unavailable.
    }
  }

  const statusLabel = refreshing
    ? '更新中'
    : error && !payload
      ? '讀取失敗'
      : payload?.stale
        ? '沿用快取'
        : '已同步';

  return (
    <main className="market-shell min-h-screen bg-background text-foreground">
      <div className="market-atmosphere" aria-hidden="true">
        <span className="energy-orb energy-orb-one" />
        <span className="energy-orb energy-orb-two" />
        <span className="energy-beam" />
      </div>

      <header className="hud-header sticky top-0 z-50 border-b border-border">
        <div className="mx-auto flex max-w-[1800px] items-center justify-between gap-2 px-2 py-2 sm:gap-4 sm:px-4">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <span className="hud-emblem grid size-10 shrink-0 place-items-center bg-primary text-primary-foreground">
              <BarChart3 className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="hud-kicker hidden text-[10px] font-semibold uppercase sm:block">
                TAIEX IMPACT // TOP 100
              </p>
              <h1 className="title-type truncate text-base font-bold tracking-wide sm:text-lg">
                加權指數權值表
              </h1>
              <p className="truncate text-[11px] text-muted-foreground sm:text-xs">
                前 100 大 · 漲跌停貢獻點數估算
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <div className="mr-1 hidden items-center gap-2 text-xs text-muted-foreground md:flex">
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
            <Button
              ref={themeButtonRef}
              variant="outline"
              size="lg"
              className="fx-button h-11 min-w-11 px-2 sm:px-3"
              onClick={toggleTheme}
              aria-label="目前日間模式，切換顯示模式"
              title="切換日間、夜間或高對比模式"
            >
              <Sun
                className="theme-icon theme-icon-light size-5"
                aria-hidden="true"
              />
              <Moon
                className="theme-icon theme-icon-dark size-5"
                aria-hidden="true"
              />
              <Contrast
                className="theme-icon theme-icon-contrast size-5"
                aria-hidden="true"
              />
              <span ref={themeModeLabelRef} className="hidden sm:inline">
                日間
              </span>
            </Button>
          </div>
        </div>
      </header>

      <div className="relative z-10 mx-auto max-w-[1800px] px-2 py-3 sm:px-4 sm:py-4">
        <section className="mb-3 grid gap-2 xl:grid-cols-[minmax(340px,1fr)_auto]">
          <div className="hud-panel flex flex-col justify-between gap-2 border bg-card p-2 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
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
                  className="hud-input h-11 bg-background/70 pl-9 pr-9"
                />
                {query ? (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    className="icon-reaction absolute right-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center text-muted-foreground hover:text-foreground"
                    aria-label="清除搜尋"
                  >
                    <X className="size-3.5" />
                  </button>
                ) : null}
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                <span className="md:hidden">
                  市場資料 {formatDate(payload?.dataDate)} ·{' '}
                </span>
                權重每日重算 · 單位：億元／點
              </p>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 sm:flex sm:items-end">
              <div className="font-size-control min-w-0 sm:w-52">
                <div className="mb-1 flex items-center gap-1.5">
                  <Type className="size-3.5 text-primary" aria-hidden="true" />
                  <label
                    htmlFor="font-size-slider"
                    className="text-xs font-semibold"
                  >
                    字級
                  </label>
                  <output
                    ref={fontSizeOutputRef}
                    htmlFor="font-size-slider"
                    className="numeric-type ml-auto text-xs font-bold text-primary"
                  >
                    {DEFAULT_DESKTOP_FONT_SIZE}
                  </output>
                </div>
                <input
                  ref={fontSizeSliderRef}
                  id="font-size-slider"
                  type="range"
                  min={MIN_FONT_SIZE}
                  max={MAX_FONT_SIZE}
                  step="1"
                  defaultValue={DEFAULT_DESKTOP_FONT_SIZE}
                  onChange={changeFontSize}
                  className="luxury-range"
                  aria-label={`調整字級，範圍 ${MIN_FONT_SIZE} 至 ${MAX_FONT_SIZE}`}
                />
                <div className="numeric-type flex justify-between text-[10px] text-muted-foreground">
                  <span>{MIN_FONT_SIZE}</span>
                  <span>{MAX_FONT_SIZE}</span>
                </div>
              </div>
              <Button
                variant="outline"
                size="lg"
                className="fx-button h-11 px-3"
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
            className="impact-console grid min-w-[450px] grid-cols-[minmax(180px,1fr)_140px_140px] overflow-hidden border text-white max-xl:min-w-0 max-sm:grid-cols-2"
            aria-label="已選股票貢獻合計"
            aria-live="polite"
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
                    className="micro-action text-xs text-white/60 hover:text-white"
                  >
                    清除
                  </button>
                ) : null}
              </div>
              <p
                className="company-name mt-1 truncate text-sm font-semibold"
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
            <div className="impact-stat impact-stat-up border-l border-white/10 p-3 max-sm:border-l-0 max-sm:border-t">
              <span className="text-xs text-white/55">全數漲停</span>
              <p
                className={`mt-0.5 font-mono text-lg font-bold tabular-nums ${
                  totalUp >= 0 ? 'text-market-up' : 'text-market-down'
                }`}
              >
                {formatSigned(totalUp)}
              </p>
            </div>
            <div className="impact-stat impact-stat-down border-l border-white/10 p-3 max-sm:border-t">
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
            className="alert-hud mb-3 flex items-start gap-2 border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            role="alert"
          >
            <AlertTriangle
              className="mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            <span>{error}</span>
          </div>
        ) : null}

        {payload?.warnings.length ? (
          <div className="alert-hud mb-3 flex items-start gap-2 border border-amber-400/50 bg-amber-100/70 px-3 py-2 text-xs text-amber-950 dark:border-amber-600/60 dark:bg-amber-950/50 dark:text-amber-100">
            <AlertTriangle
              className="mt-0.5 size-3.5 shrink-0"
              aria-hidden="true"
            />
            <span>{payload.warnings.join('；')}</span>
          </div>
        ) : null}

        <section className="hud-panel table-panel overflow-hidden border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-2 py-2 sm:px-3">
            <div>
              <h2 className="section-title text-sm font-bold">權值排行</h2>
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {payload
                  ? `顯示 ${visibleRows.length}／${rows.length} 檔 · 加權昨收 ${decimalFormatter.format(payload.meta.taiexClose)}`
                  : '正在整理官方市場資料…'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {payload ? (
                <Badge
                  variant="outline"
                  className="hud-chip text-muted-foreground"
                >
                  成分日期 {formatDate(payload.taifexDataDate)}
                </Badge>
              ) : null}
              <Badge
                variant="outline"
                className="hud-chip text-muted-foreground"
              >
                貢獻點數為估算值
              </Badge>
            </div>
          </div>

          <Table className="market-table w-max border-collapse text-sm leading-5 [&_td]:border-r [&_td]:px-1.5 [&_td:last-child]:border-r-0 [&_th]:border-r [&_th]:px-1.5 [&_th:last-child]:border-r-0">
            <TableHeader className="market-table-head sticky top-0 z-10 bg-table-header">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-11 text-center">排名</TableHead>
                <TableHead className="w-14">代碼</TableHead>
                <TableHead className="w-24">公司名稱</TableHead>
                <TableHead className="w-20 text-right text-market-up-strong">
                  漲停影響
                </TableHead>
                <TableHead className="w-20 text-right text-market-down-strong">
                  跌停影響
                </TableHead>
                <TableHead className="w-20 text-right">市值</TableHead>
                <TableHead className="w-20 text-right">大盤比重</TableHead>
                <TableHead className="w-20 text-right">累加比重</TableHead>
                <TableHead className="w-20 text-right">昨收／基準</TableHead>
                <TableHead className="w-16 text-right">漲停價</TableHead>
                <TableHead className="w-16 text-right">跌停價</TableHead>
                <TableHead className="selection-rail sticky right-0 z-20 w-12 border-l text-center">
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
                        className="market-row h-12"
                      >
                        <TableCell className="text-center font-mono text-muted-foreground">
                          {row.rank}
                        </TableCell>
                        <TableCell className="font-mono font-bold text-code">
                          {row.code}
                        </TableCell>
                        <TableCell className="company-name font-semibold">
                          {row.name}
                        </TableCell>
                        <TableCell
                          className={`impact-number impact-number-up text-right font-mono font-bold tabular-nums ${contributionClass(row.upContribution)}`}
                        >
                          {formatSigned(row.upContribution)}
                        </TableCell>
                        <TableCell
                          className={`impact-number impact-number-down text-right font-mono font-bold tabular-nums ${contributionClass(row.downContribution)}`}
                        >
                          {formatSigned(row.downContribution)}
                        </TableCell>
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
                              ? `前一日收盤 ${priceFormatter.format(row.rawPreviousClose)}；今日開盤競價基準 ${formatNullable(row.referencePrice)}，表內依基準價顯示`
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
                        <TableCell className="text-right font-mono tabular-nums text-market-down-strong">
                          {formatNullable(row.limitDown)}
                        </TableCell>
                        <TableCell className="selection-rail sticky right-0 border-l text-center">
                          <Checkbox
                            className="hud-checkbox"
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
                  className="fx-button mt-3"
                  onClick={refreshWeights}
                >
                  重新讀取
                </Button>
              </div>
            </div>
          ) : null}

          <footer className="terminal-footer space-y-1 border-t px-3 py-3 text-xs leading-5 text-muted-foreground">
            <p>
              市值與權重依「已發行普通股數－私募股數」×
              前一日收盤每日重算；TAIFEX 清單每月底更新。
            </p>
            <p>
              貢獻點數＝個股權重 × 加權昨收 ×（漲跌停價 ÷
              昨收基準－1）。＊表示除權息等事件調整過基準價。
            </p>
            <p>
              資料來源：
              <a
                className="terminal-link underline-offset-2 hover:text-foreground hover:underline"
                href="https://www.taifex.com.tw/cht/2/weightedPropertion"
                target="_blank"
                rel="noreferrer"
              >
                TAIFEX
              </a>
              {' · '}
              <a
                className="terminal-link underline-offset-2 hover:text-foreground hover:underline"
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
