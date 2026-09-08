(function attachPlannerInputs(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PinkTripPlannerInputs = factory();
}(typeof window !== 'undefined' ? window : globalThis, function plannerInputs() {
  const MAX_SAFE_BUDGET = Number.MAX_SAFE_INTEGER;

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function parseDate(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return { year, month, day };
  }

  function canonicalDate(year, month, day) {
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    return Number.isNaN(date.valueOf()) ? '' : date.toISOString().slice(0, 10);
  }

  function dateFromParts(parts) {
    return parts ? canonicalDate(parts.year, parts.month, parts.day) : '';
  }

  function isDate(value) {
    return Boolean(parseDate(value));
  }

  function compareDates(left, right) {
    return String(left || '').localeCompare(String(right || ''));
  }

  function addDays(value, offset) {
    const parts = parseDate(value);
    if (!parts) return '';
    const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + Number(offset || 0)));
    return date.toISOString().slice(0, 10);
  }

  function daysInMonth(year, month) {
    return new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  }

  function monthStart(value) {
    const parts = parseDate(value) || parseDate(`${value}-01`);
    return parts ? canonicalDate(parts.year, parts.month, 1) : '';
  }

  function daysBetween(startDate, endDate) {
    const start = parseDate(startDate);
    const end = parseDate(endDate);
    if (!start || !end || compareDates(endDate, startDate) < 0) return null;
    const startMs = Date.UTC(start.year, start.month - 1, start.day);
    const endMs = Date.UTC(end.year, end.month - 1, end.day);
    return Math.floor((endMs - startMs) / 86400000) + 1;
  }

  function formatDisplayDate(value) {
    const parts = parseDate(value);
    return parts ? `${pad(parts.day)}/${pad(parts.month)}/${parts.year}` : '';
  }

  function formatBudget(value, { empty = false } = {}) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) return '';
    if (empty && amount === 0) return '';
    return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Math.round(amount));
  }

  function normalizeBudgetInput(raw) {
    const value = String(raw ?? '');
    const trimmed = value.trim();
    if (!trimmed) return { value: 0, digits: '', display: '', error: '' };
    if (trimmed.includes('-')) return { value: null, digits: '', display: value, error: 'Ngân sách không thể là số âm.' };
    const invalidCharacters = trimmed.replace(/[0-9.,\s]/g, '');
    if (invalidCharacters) return { value: null, digits: '', display: value, error: 'Chỉ nhập số tiền, không nhập chữ hoặc ký hiệu khác.' };
    const digits = trimmed.replace(/[^0-9]/g, '');
    if (!digits) return { value: 0, digits: '', display: '', error: '' };
    const normalized = digits.replace(/^0+(?=\d)/, '');
    const amount = Number(normalized);
    if (!Number.isSafeInteger(amount) || amount > MAX_SAFE_BUDGET) return { value: null, digits: normalized, display: value, error: 'Ngân sách quá lớn. Hãy nhập một số tiền hợp lý hơn.' };
    return { value: amount, digits: normalized, display: formatBudget(amount), error: '' };
  }

  function durationLabel(startDate, endDate) {
    const days = daysBetween(startDate, endDate);
    if (!days) return '';
    return `${days} ngày · ${Math.max(0, days - 1)} đêm`;
  }

  return {
    MAX_SAFE_BUDGET,
    addDays,
    canonicalDate,
    compareDates,
    daysBetween,
    daysInMonth,
    dateFromParts,
    durationLabel,
    formatBudget,
    formatDisplayDate,
    isDate,
    monthStart,
    normalizeBudgetInput,
    parseDate
  };
}));
