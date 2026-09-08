import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldDeployEveningData } from '../lib/deployment-data.ts';

test('晚間資料日期相同時略過部署', () => {
  assert.equal(shouldDeployEveningData('2026-09-07', '2026-09-07'), false);
});

test('晚間資料日期不同時執行部署', () => {
  assert.equal(shouldDeployEveningData('2026-09-08', '2026-09-07'), true);
});

test('缺少資料日期時拒絕判斷', () => {
  assert.throws(
    () => shouldDeployEveningData('', '2026-09-07'),
    /資料日期缺漏/,
  );
  assert.throws(
    () => shouldDeployEveningData('2026-09-08', ''),
    /資料日期缺漏/,
  );
});
