const test = require('node:test');
const assert = require('node:assert/strict');
const plannerInputs = require('../public/planner-inputs');

test('date range helpers remain timezone-safe and derive inclusive trip duration', () => {
  assert.equal(plannerInputs.isDate('2026-09-15'), true);
  assert.equal(plannerInputs.formatDisplayDate('2026-09-15'), '15/09/2026');
  assert.equal(plannerInputs.durationLabel('2026-09-15', '2026-09-17'), '3 ngày · 2 đêm');
  assert.equal(plannerInputs.durationLabel('2026-09-30', '2026-10-02'), '3 ngày · 2 đêm');
  assert.equal(plannerInputs.durationLabel('2026-09-15', '2026-09-15'), '1 ngày · 0 đêm');
  assert.equal(plannerInputs.durationLabel('2026-09-17', '2026-09-15'), '');
  assert.equal(plannerInputs.addDays('2026-09-30', 2), '2026-10-02');
  assert.equal(plannerInputs.addDays('2026-01-01', -1), '2025-12-31');
});

test('budget input accepts common separators and keeps a numeric VND value', () => {
  for (const input of ['4000000', '4.000.000', '4,000,000']) {
    const result = plannerInputs.normalizeBudgetInput(input);
    assert.equal(result.value, 4000000);
    assert.equal(result.display, '4.000.000');
    assert.equal(result.error, '');
  }
  assert.equal(plannerInputs.formatBudget(500000), '500.000');
  assert.equal(plannerInputs.formatBudget(12500000), '12.500.000');
  assert.equal(plannerInputs.formatBudget(100000000), '100.000.000');
  assert.deepEqual(plannerInputs.normalizeBudgetInput(''), { value: 0, digits: '', display: '', error: '' });
});

test('budget input rejects unsafe, negative, and arbitrary mixed values with user-facing errors', () => {
  assert.match(plannerInputs.normalizeBudgetInput('-4000000').error, /không thể là số âm/);
  assert.match(plannerInputs.normalizeBudgetInput('4 triệu abc').error, /Chỉ nhập số tiền/);
  assert.match(plannerInputs.normalizeBudgetInput('999999999999999999999').error, /quá lớn/);
});
