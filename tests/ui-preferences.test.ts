import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_DESKTOP_FONT_SIZE,
  DEFAULT_MOBILE_FONT_SIZE,
  getDefaultFontSize,
  getNextThemeMode,
  normalizeFontSize,
  normalizeThemeMode,
} from '../lib/ui-preferences.ts';

test('未儲存字級時依桌機與手機套用不同預設值', () => {
  assert.equal(getDefaultFontSize(false), DEFAULT_DESKTOP_FONT_SIZE);
  assert.equal(getDefaultFontSize(true), DEFAULT_MOBILE_FONT_SIZE);
  assert.equal(DEFAULT_DESKTOP_FONT_SIZE, 30);
  assert.equal(DEFAULT_MOBILE_FONT_SIZE, 12);
});

test('字級限制在 6 至 30，無效值回到指定預設值', () => {
  assert.equal(normalizeFontSize(3), 6);
  assert.equal(normalizeFontSize(18.6), 19);
  assert.equal(normalizeFontSize(48), 30);
  assert.equal(normalizeFontSize('not-a-number'), DEFAULT_DESKTOP_FONT_SIZE);
  assert.equal(normalizeFontSize('not-a-number', 12), 12);
});

test('主題依日間、夜間、高對比循環', () => {
  assert.equal(getNextThemeMode('light'), 'dark');
  assert.equal(getNextThemeMode('dark'), 'contrast');
  assert.equal(getNextThemeMode('contrast'), 'light');
});

test('舊主題設定仍有效，未知值依系統偏好處理', () => {
  assert.equal(normalizeThemeMode('contrast', false), 'contrast');
  assert.equal(normalizeThemeMode('dark', false), 'dark');
  assert.equal(normalizeThemeMode('unknown', true), 'dark');
  assert.equal(normalizeThemeMode(null, false), 'light');
});
