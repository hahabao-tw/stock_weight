export const MIN_FONT_SIZE = 6;
export const MAX_FONT_SIZE = 30;
export const DEFAULT_FONT_SIZE = 16;

export type ThemeMode = 'light' | 'dark' | 'contrast';

export function normalizeFontSize(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_FONT_SIZE;
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(parsed)));
}

export function normalizeThemeMode(
  value: string | null,
  prefersDark: boolean,
): ThemeMode {
  if (value === 'light' || value === 'dark' || value === 'contrast') {
    return value;
  }
  return prefersDark ? 'dark' : 'light';
}

export function getNextThemeMode(current: ThemeMode): ThemeMode {
  if (current === 'light') return 'dark';
  if (current === 'dark') return 'contrast';
  return 'light';
}
