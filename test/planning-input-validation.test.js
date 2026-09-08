const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePlanningInputs } = require('../src/server');

test('server planning validation keeps dates canonical and budget/traveler values safe', () => {
  assert.deepEqual(validatePlanningInputs({ startDate: '2026-09-15', endDate: '2026-09-17', travelers: 2, targetBudget: 4000000 }), {
    startDate: '2026-09-15', endDate: '2026-09-17', travelers: 2, targetBudget: 4000000
  });
  assert.deepEqual(validatePlanningInputs({ startDate: '2026-09-15', endDate: '2026-09-15' }).targetBudget, 0);
  assert.throws(() => validatePlanningInputs({ startDate: '2026-09-17', endDate: '2026-09-15' }), /Ngày về phải từ ngày đi trở đi/);
  assert.throws(() => validatePlanningInputs({ startDate: '2026-09-15', endDate: '2026-09-17', targetBudget: -1 }), /không âm/);
  assert.throws(() => validatePlanningInputs({ startDate: '2026-09-15', endDate: '2026-09-17', travelers: 13 }), /1–12/);
});
