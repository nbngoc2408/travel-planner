const state = {
  user: null,
  destinations: [],
  places: [],
  placeRatings: {},
  destinationRatings: {},
  services: [],
  reviews: [],
  reviewPreview: { total: 0, ratingSummary: { average: null, count: 0 } },
  reviewBrowse: { items: [], loading: false, error: '', filters: null, pagination: null, ratingSummary: { average: null, count: 0 }, ratingDistribution: {} },
  plans: [],
  route: { view: 'home' },
  routeStatus: 'ready',
  activeTrip: null,
  plannerOpen: false,
  step: 0,
  draft: {},
  generated: null,
  itineraryBaseline: null,
  generatedSignature: null,
  editingPlanId: null,
  reviewRating: 5,
  reviewDraft: null,
  reviewModalOpen: false,
  reviewDetail: null,
  reviewReturnDetail: null,
  reviewEditingId: null,
  pendingReviewContext: null,
  tripSearch: '',
  tripFilter: 'all',
  placeSearch: '',
  placeVisibleCount: 12,
  pendingPath: null,
  replanOpen: false,
  replanDraft: null,
  replanPreview: null,
  resetConfirmOpen: false,
  inspirationResolution: null,
  inspirationInput: '',
  itineraryView: 'detailed',
  activeItineraryDay: 0,
  datePickerOpen: false,
  datePickerMonth: null,
  datePickerPhase: 'start',
  budgetInputValue: null,
  budgetInputError: '',
  toastTimer: null
};

const $ = (selector) => document.querySelector(selector);
const plannerInputs = window.PinkTripPlannerInputs;
const money = (value) => new Intl.NumberFormat('vi-VN').format(Math.round(value || 0)) + ' ₫';
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const formatDate = (value) => {
  if (!plannerInputs?.isDate(value)) return 'Chưa rõ ngày';
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(value + 'T00:00:00Z'));
};
const intensityLabel = (value) => ({ relaxed: 'Thảnh thơi', balanced: 'Cân bằng', packed: 'Nhiều trải nghiệm' }[value] || 'Cân bằng');
const dateValue = (date) => plannerInputs.canonicalDate(date.getFullYear(), date.getMonth() + 1, date.getDate());
const categoryLabels = { nature: 'Thiên nhiên', beach: 'Biển', food: 'Ẩm thực', culture: 'Văn hóa', photography: 'Nhiếp ảnh', experience: 'Trải nghiệm', photo: 'Nhiếp ảnh', activity: 'Trải nghiệm' };
let lastMenuTrigger = null;
let lastAuthTrigger = null;
let lastModalTrigger = null;
let itineraryScrollFrame = null;
let itineraryNormalizeTimer = null;
let itineraryMutationVersion = 0;

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options,
    body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Không thể thực hiện yêu cầu');
  return data;
}

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => element.classList.remove('show'), 2800);
}

function clone(value) {
  return window.PinkTripItineraryState.clone(value);
}

function establishItineraryBaseline({ itinerary = state.generated?.itinerary, budget = state.generated?.budget } = {}) {
  state.itineraryBaseline = window.PinkTripItineraryState.createBaseline({ itinerary, budget });
}

function destination(id) {
  return state.destinations.find((item) => item.id === id);
}

function place(id) {
  return state.places.find((item) => item.id === id);
}

function normalizeCategory(category) {
  return ({ photo: 'photography', activity: 'experience' }[category] || category);
}

function placeCategories(item = {}) {
  return [...new Set([...(Array.isArray(item.categories) ? item.categories : []), item.category]
    .filter(Boolean)
    .map(normalizeCategory))];
}

function refreshPlans() {
  return api('/api/plans').then((result) => {
    state.plans = result.plans;
    return state.plans;
  });
}

async function refreshReviewData() {
  const [reviews, places, destinations] = await Promise.all([api('/api/reviews?page=1&pageSize=3&sort=newest'), api('/api/places'), api('/api/destinations')]);
  state.reviews = reviews.reviews;
  state.reviewPreview = { total: reviews.pagination?.total || 0, ratingSummary: reviews.ratingSummary || { average: null, count: 0 } };
  state.places = places.places;
  state.placeRatings = places.ratingSummaries || {};
  state.destinationRatings = destinations.ratingSummaries || {};
}

function defaultDraft(destinationId = state.destinations[0]?.id) {
  const start = new Date();
  start.setDate(start.getDate() + 7);
  const end = new Date(start);
  end.setDate(end.getDate() + 2);
  return {
    title: 'Một chuyến đi thật vừa vặn',
    destinationId,
    startDate: dateValue(start),
    endDate: dateValue(end),
    travelers: 2,
    targetBudget: 4000000,
    accommodationLevel: 'comfort',
    intensity: 'balanced',
    interests: ['nature', 'beach'],
    selectedPlaceIds: [],
    stepTwoPlaceIds: [],
    inspirationItems: []
  };
}

function syncBudgetInput(value = state.draft?.targetBudget) {
  state.budgetInputValue = plannerInputs.formatBudget(value, { empty: true });
  state.budgetInputError = '';
}

function budgetInputValue() {
  return state.budgetInputValue === null ? plannerInputs.formatBudget(state.draft?.targetBudget, { empty: true }) : state.budgetInputValue;
}

function dateValidationMessage() {
  if (!plannerInputs.isDate(state.draft?.startDate)) return 'Chọn ngày đi để tiếp tục.';
  if (!plannerInputs.isDate(state.draft?.endDate)) return 'Chọn ngày về để tiếp tục.';
  if (plannerInputs.compareDates(state.draft.endDate, state.draft.startDate) < 0) return 'Ngày về phải từ ngày đi trở đi.';
  return '';
}

function budgetValidationMessage() {
  if (state.budgetInputError) return state.budgetInputError;
  const value = state.draft?.targetBudget;
  if (value === null || value === undefined || !Number.isFinite(Number(value)) || Number(value) < 0) return 'Nhập ngân sách bằng số dương hoặc để trống nếu chưa muốn đặt mục tiêu.';
  return '';
}

function tripDurationText() {
  return plannerInputs.durationLabel(state.draft?.startDate, state.draft?.endDate);
}

function calendarMonthValue() {
  return plannerInputs.monthStart(state.datePickerMonth || state.draft?.startDate || dateValue(new Date()));
}

function calendarMonthParts() {
  return plannerInputs.parseDate(calendarMonthValue()) || plannerInputs.parseDate(dateValue(new Date()));
}

function calendarMonthLabel() {
  const parts = calendarMonthParts();
  return `Tháng ${parts.month}, ${parts.year}`;
}

function openDatePicker(role = 'start') {
  state.datePickerPhase = role === 'end' ? 'end' : 'start';
  state.datePickerMonth = plannerInputs.monthStart(role === 'end' ? (state.draft.endDate || state.draft.startDate) : (state.draft.startDate || state.draft.endDate || dateValue(new Date())));
  state.datePickerOpen = true;
  renderPlanner();
  requestAnimationFrame(() => document.querySelector('.calendar-day[aria-current="date"], .calendar-day.is-selected')?.focus());
}

function closeDatePicker(restoreFocus = false) {
  if (!state.datePickerOpen) return;
  const active = document.activeElement;
  const focusRole = active?.dataset?.dateRole || state.datePickerPhase || 'start';
  state.datePickerOpen = false;
  renderPlanner();
  if (restoreFocus) document.querySelector('[data-action="open-date-picker"][data-date-role="' + focusRole + '"]')?.focus();
}

function selectDate(value) {
  if (!plannerInputs.isDate(value)) return;
  if (state.datePickerPhase === 'end' && plannerInputs.isDate(state.draft.startDate)) {
    if (plannerInputs.compareDates(value, state.draft.startDate) < 0) {
      state.draft.startDate = value;
      state.draft.endDate = '';
      state.datePickerPhase = 'end';
    } else {
      state.draft.endDate = value;
      state.datePickerPhase = 'start';
    }
  } else {
    state.draft.startDate = value;
    if (state.draft.endDate && plannerInputs.compareDates(state.draft.endDate, value) < 0) state.draft.endDate = '';
    state.datePickerPhase = 'end';
  }
  state.datePickerMonth = plannerInputs.monthStart(value);
  if (state.draft.startDate && state.draft.endDate && !dateValidationMessage()) state.datePickerOpen = false;
  renderPlanner();
}

function moveCalendarMonth(offset) {
  const parts = calendarMonthParts();
  const month = new Date(Date.UTC(parts.year, parts.month - 1 + Number(offset), 1));
  state.datePickerMonth = plannerInputs.canonicalDate(month.getUTCFullYear(), month.getUTCMonth() + 1, 1);
  renderPlanner();
  requestAnimationFrame(() => document.querySelector('.calendar-day.is-selected, .calendar-day')?.focus());
}

function calendarDates() {
  const parts = calendarMonthParts();
  const first = plannerInputs.canonicalDate(parts.year, parts.month, 1);
  const firstWeekday = new Date(Date.UTC(parts.year, parts.month - 1, 1)).getUTCDay();
  const mondayOffset = (firstWeekday + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => plannerInputs.addDays(first, index - mondayOffset));
}

function renderCalendar() {
  const start = state.draft.startDate;
  const end = state.draft.endDate;
  const today = dateValue(new Date());
  const weekdayLabels = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
  const days = calendarDates();
  const dayButtons = days.map((value) => {
    const parts = plannerInputs.parseDate(value);
    const currentMonth = parts.month === calendarMonthParts().month;
    const isStart = value === start;
    const isEnd = value === end;
    const inRange = start && end && plannerInputs.compareDates(value, start) >= 0 && plannerInputs.compareDates(value, end) <= 0;
    const classes = ['calendar-day'];
    if (!currentMonth) classes.push('is-muted');
    if (value === today) classes.push('is-today');
    if (inRange) classes.push('is-in-range');
    if (isStart) classes.push('is-start');
    if (isEnd) classes.push('is-end');
    const stateLabel = isStart && isEnd ? 'Ngày đi và ngày về' : isStart ? 'Ngày đi' : isEnd ? 'Ngày về' : inRange ? 'Trong khoảng chuyến đi' : '';
    return '<button class="' + classes.join(' ') + '" type="button" data-action="select-date" data-date="' + value + '" aria-label="' + escapeHtml(plannerInputs.formatDisplayDate(value) + (stateLabel ? ' · ' + stateLabel : '')) + '" ' + (value === today ? 'aria-current="date" ' : '') + (isStart || isEnd ? 'aria-pressed="true"' : '') + '>' + parts.day + '</button>';
  }).join('');
  return '<div class="date-picker-popover" role="dialog" aria-label="Chọn khoảng ngày" data-date-picker><div class="date-picker-summary"><div><span>Ngày đi</span><strong>' + escapeHtml(plannerInputs.formatDisplayDate(start) || 'Chưa chọn') + '</strong></div><span class="date-picker-arrow" aria-hidden="true">→</span><div><span>Ngày về</span><strong>' + escapeHtml(plannerInputs.formatDisplayDate(end) || 'Chưa chọn') + '</strong></div></div><div class="calendar-header"><button class="icon-button" type="button" data-action="date-prev-month" aria-label="Tháng trước">←</button><strong aria-live="polite">' + calendarMonthLabel() + '</strong><button class="icon-button" type="button" data-action="date-next-month" aria-label="Tháng sau">→</button></div><div class="calendar-weekdays" aria-hidden="true">' + weekdayLabels.map((label) => '<span>' + label + '</span>').join('') + '</div><div class="calendar-grid" role="grid" aria-label="Lịch ' + escapeHtml(calendarMonthLabel()) + '">' + dayButtons + '</div><div class="calendar-footer"><span><i class="calendar-legend-dot"></i> Hôm nay</span><span>' + (state.datePickerPhase === 'end' ? 'Chọn ngày về' : 'Chọn ngày đi') + '</span><button class="text-button" type="button" data-action="close-date-picker">Đóng</button></div></div>';
}

function renderDateRangeControl() {
  const start = state.draft.startDate;
  const end = state.draft.endDate;
  const dateError = dateValidationMessage();
  const duration = tripDurationText();
  const open = state.datePickerOpen;
  const startLabel = plannerInputs.formatDisplayDate(start) || 'Chọn ngày đi';
  const endLabel = plannerInputs.formatDisplayDate(end) || 'Chọn ngày về';
  return '<div class="field date-range-field field-span' + (dateError ? ' has-error' : '') + '"><div class="date-range-heading"><label id="trip-dates-label">Thời gian chuyến đi</label><span class="field-optional">Chọn một khoảng ngày</span></div><div class="date-range-inputs"><button class="date-trigger ' + (start ? 'has-value' : '') + '" type="button" data-action="open-date-picker" data-date-role="start" aria-label="Ngày đi: ' + escapeHtml(startLabel) + '" aria-expanded="' + open + '" aria-controls="trip-date-picker"><span class="date-trigger-label">Ngày đi</span><strong>' + escapeHtml(startLabel) + '</strong><span class="date-trigger-icon" aria-hidden="true">▦</span></button><span class="date-range-arrow" aria-hidden="true">→</span><button class="date-trigger ' + (end ? 'has-value' : '') + '" type="button" data-action="open-date-picker" data-date-role="end" aria-label="Ngày về: ' + escapeHtml(endLabel) + '" aria-expanded="' + open + '" aria-controls="trip-date-picker"><span class="date-trigger-label">Ngày về</span><strong>' + escapeHtml(endLabel) + '</strong><span class="date-trigger-icon" aria-hidden="true">▦</span></button></div><div class="date-range-meta" aria-live="polite"><strong>' + escapeHtml(duration || 'Chọn đủ hai ngày để xem thời lượng') + '</strong><span>' + (duration ? 'Khoảng thời gian được tính tự động' : 'Ngày về có thể trùng ngày đi cho chuyến trong ngày') + '</span></div>' + (dateError ? '<p class="field-error" id="trip-date-error" role="alert">' + escapeHtml(dateError) + '</p>' : '') + (open ? renderCalendar().replace('data-date-picker', 'id="trip-date-picker" data-date-picker') : '') + '</div>';
}

function renderBudgetControl() {
  const error = budgetValidationMessage();
  const target = Number(state.draft.targetBudget) || 0;
  const travelers = Math.max(1, Number(state.draft.travelers) || 1);
  const perPerson = target ? Math.round(target / travelers) : 0;
  return '<div class="field budget-field' + (error ? ' has-error' : '') + '"><label for="trip-budget">Ngân sách chuyến đi <span class="optional">(không bắt buộc)</span></label><div class="budget-input-wrap"><span class="budget-prefix" aria-hidden="true">₫</span><input id="trip-budget" type="text" inputmode="numeric" autocomplete="off" data-budget-input data-draft="targetBudget" value="' + escapeHtml(budgetInputValue()) + '" placeholder="4.000.000" aria-describedby="trip-budget-help trip-budget-person trip-budget-error" ' + (error ? 'aria-invalid="true"' : '') + '><span class="budget-currency" aria-hidden="true">VND</span></div><small class="field-hint" id="trip-budget-help">Tổng ngân sách mục tiêu cho cả chuyến. Để trống hoặc nhập 0 nếu bạn chưa muốn đặt mục tiêu.</small><small class="budget-per-person" id="trip-budget-person">' + (perPerson ? '≈ ' + money(perPerson) + ' / người · ' + travelers + ' người' : 'Ngân sách này là mục tiêu của cả chuyến, không phải chi phí ước tính.') + '</small><p class="field-error" id="trip-budget-error" role="alert" ' + (error ? '' : 'hidden') + '>' + escapeHtml(error) + '</p></div>';
}

function updateBudgetPerPersonText() {
  const target = Number(state.draft.targetBudget) || 0;
  const travelers = Math.max(1, Number(state.draft.travelers) || 1);
  const element = $('#trip-budget-person');
  if (element) element.textContent = target ? '≈ ' + money(Math.round(target / travelers)) + ' / người · ' + travelers + ' người' : 'Ngân sách này là mục tiêu của cả chuyến, không phải chi phí ước tính.';
}

function updateBudgetErrorState() {
  const field = $('.budget-field');
  const input = $('#trip-budget');
  const error = $('#trip-budget-error');
  const message = budgetValidationMessage();
  field?.classList.toggle('has-error', Boolean(message));
  if (input) {
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
    input.setAttribute('aria-describedby', 'trip-budget-help trip-budget-person trip-budget-error');
  }
  if (error) {
    error.hidden = !message;
    error.textContent = message;
  }
}

function handleBudgetInput(target) {
  const before = target.value;
  const caret = Number.isInteger(target.selectionStart) ? target.selectionStart : before.length;
  const digitsBeforeCaret = before.slice(0, caret).replace(/\D/g, '').length;
  const normalized = plannerInputs.normalizeBudgetInput(before);
  state.budgetInputError = normalized.error;
  if (!normalized.error) {
    state.draft.targetBudget = normalized.value;
    state.budgetInputValue = normalized.display;
    const nextValue = normalized.display;
    target.value = nextValue;
    let nextCaret = nextValue.length;
    if (digitsBeforeCaret < normalized.digits.length) {
      let seen = 0;
      nextCaret = 0;
      while (nextCaret < nextValue.length && seen < digitsBeforeCaret) {
        if (/\d/.test(nextValue[nextCaret])) seen += 1;
        nextCaret += 1;
      }
    }
    target.setSelectionRange(nextCaret, nextCaret);
  } else {
    state.budgetInputValue = before;
  }
  updateBudgetPerPersonText();
  updateBudgetErrorState();
}

function renderStepOne() {
  return '<div class="step-panel"><h3>Chuyến đi này có gì đặc biệt?</h3><p>Cho PinkTrip biết vài điều cơ bản để bắt đầu sắp xếp.</p><div class="form-grid"><div class="field"><label for="trip-title">Tên chuyến đi</label><input id="trip-title" data-draft="title" value="' + escapeHtml(state.draft.title) + '" placeholder="Ví dụ: Cuối tuần ở biển"></div><div class="field"><label for="trip-destination">Điểm đến</label><select id="trip-destination" data-draft="destinationId">' + state.destinations.map((item) => '<option value="' + item.id + '" ' + (item.id === state.draft.destinationId ? 'selected' : '') + '>' + escapeHtml(item.name) + ' · ' + escapeHtml(item.province) + '</option>').join('') + '</select></div>' + renderDateRangeControl() + '<div class="field"><label for="trip-travelers">Số người</label><input id="trip-travelers" type="number" min="1" max="12" inputmode="numeric" data-draft="travelers" value="' + escapeHtml(state.draft.travelers) + '"><small class="field-hint">Từ 1 đến 12 người</small></div>' + renderBudgetControl() + '<div class="field"><label for="trip-intensity">Nhịp điệu</label><select id="trip-intensity" data-draft="intensity"><option value="relaxed" ' + (state.draft.intensity === 'relaxed' ? 'selected' : '') + '>Thảnh thơi</option><option value="balanced" ' + (state.draft.intensity === 'balanced' ? 'selected' : '') + '>Cân bằng</option><option value="packed" ' + (state.draft.intensity === 'packed' ? 'selected' : '') + '>Nhiều trải nghiệm</option></select></div></div></div>';
}

function draftSignature() {
  return JSON.stringify({ destinationId: state.draft.destinationId, startDate: state.draft.startDate, endDate: state.draft.endDate, travelers: Number(state.draft.travelers) || 1, targetBudget: Number(state.draft.targetBudget) || 0, intensity: state.draft.intensity, selectedPlaceIds: [...(state.draft.selectedPlaceIds || [])].sort(), inspirationItems: (state.draft.inspirationItems || []).map((item) => item.mappingId).sort() });
}

function parseRoute(path = window.location.pathname, search = window.location.search) {
  if (path === '/dashboard') return { view: 'dashboard' };
  if (path === '/trips') return { view: 'trips' };
  if (path === '/trips/new') return { view: 'new' };
  if (path === '/reviews') {
    const params = new URLSearchParams(search);
    const rating = params.get('rating');
    return {
      view: 'reviews',
      reviewFilters: {
        destinationId: params.get('destinationId') || '',
        placeId: params.get('placeId') || '',
        rating: rating ? Number(rating) : '',
        sort: params.get('sort') || 'newest',
        page: Math.max(1, Number(params.get('page') || 1) || 1)
      }
    };
  }
  const edit = path.match(/^\/trips\/([^/]+)\/edit$/);
  if (edit) return { view: 'edit', planId: decodeURIComponent(edit[1]) };
  const detail = path.match(/^\/trips\/([^/]+)$/);
  return detail ? { view: 'detail', planId: decodeURIComponent(detail[1]) } : { view: 'home' };
}

function isProtected(route) {
  return ['dashboard', 'trips', 'new', 'detail', 'edit'].includes(route.view);
}

function tripStatus(plan) {
  const today = dateValue(new Date());
  if (plan.endDate < today) return { id: 'past', label: 'Đã qua' };
  if (plan.startDate > today) return { id: 'upcoming', label: 'Sắp tới' };
  return { id: 'ongoing', label: 'Đang diễn ra' };
}

function sortTrips(plans) {
  const rank = { ongoing: 0, upcoming: 1, past: 2 };
  return [...plans].sort((a, b) => {
    const as = tripStatus(a).id;
    const bs = tripStatus(b).id;
    return rank[as] - rank[bs] || (as === 'past' ? b.startDate.localeCompare(a.startDate) : a.startDate.localeCompare(b.startDate));
  });
}

function renderNavigation() {
  const isTrips = window.location.pathname.startsWith('/trips');
  const isReviews = state.route.view === 'reviews';
  const isEditor = ['new', 'edit'].includes(state.route.view);
  const createActive = isEditor ? ' active' : '';
  $('#primary-nav').innerHTML = state.user
    ? '<a href="/dashboard" data-route ' + (state.route.view === 'dashboard' ? 'aria-current="page"' : '') + '>Tổng quan</a>'
      + '<a href="/trips" data-route ' + (isTrips && !isEditor ? 'aria-current="page"' : '') + '>Chuyến đi của tôi</a>'
      + '<button class="nav-create' + createActive + '" type="button" data-action="new-trip" ' + (isEditor ? 'aria-current="page"' : '') + '>Tạo chuyến đi</button>'
    : '<a href="#discover">Khám phá</a><a href="#how">Cách hoạt động</a><a href="/reviews" data-route ' + (isReviews ? 'aria-current="page"' : '') + '>Trải nghiệm</a>';
  $('#mobile-nav-links').innerHTML = state.user
    ? '<a href="/dashboard" data-route data-action="close-menu" ' + (state.route.view === 'dashboard' ? 'aria-current="page"' : '') + '>Tổng quan <span>↗</span></a>'
      + '<a href="/trips" data-route data-action="close-menu" ' + (isTrips && !isEditor ? 'aria-current="page"' : '') + '>Chuyến đi của tôi <span>↗</span></a>'
      + '<button type="button" data-action="new-trip" ' + (isEditor ? 'aria-current="page"' : '') + '>Tạo chuyến đi <span>↗</span></button>'
    : '<a href="#discover" data-action="close-menu">Khám phá điểm đến <span>↗</span></a><a href="#how" data-action="close-menu">Cách PinkTrip hoạt động <span>↗</span></a><a href="/reviews" data-route data-action="close-menu" ' + (isReviews ? 'aria-current="page"' : '') + '>Trải nghiệm du lịch <span>↗</span></a>';
}

function renderAccount() {
  const name = state.user?.name || '';
  const firstName = name.split(' ')[0] || '';
  const initials = name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  $('#account-actions').innerHTML = state.user
    ? '<span class="account-user"><span class="account-avatar" aria-hidden="true">' + escapeHtml(initials) + '</span><span class="user-greeting">' + escapeHtml(firstName) + '</span></span><button class="text-button" data-action="logout">Đăng xuất</button>'
    : '<button class="text-button" data-action="login">Đăng nhập</button><button class="button button-dark button-small" data-action="register">Tạo tài khoản</button>';
  $('#mobile-account-actions').innerHTML = state.user
    ? '<span class="account-user mobile-account-user"><span class="account-avatar" aria-hidden="true">' + escapeHtml(initials) + '</span><span class="user-greeting">' + escapeHtml(name) + '</span></span><button class="button button-dark" data-action="logout">Đăng xuất</button>'
    : '<button class="button button-primary" data-action="register">Tạo tài khoản</button><button class="button button-ghost" data-action="login">Đăng nhập</button>';
}

function renderDestinations() {
  $('#destination-grid').innerHTML = state.destinations.map((item) => '<button class="destination-card" type="button" style="background-image:url(' + item.image + ')" data-action="select-destination" data-id="' + item.id + '" aria-label="Lên kế hoạch chuyến đi đến ' + escapeHtml(item.name) + '"><span class="dest-top"><span>' + escapeHtml(item.province) + '</span><span>' + escapeHtml(item.weather.split('·')[0]) + '</span></span><span><strong>' + escapeHtml(item.name) + '</strong><small>' + escapeHtml(item.tags.join(' · ')) + '</small></span><span class="dest-arrow" aria-hidden="true">↗</span></button>').join('');
}

function renderDashboardOverview() {
  const plan = sortTrips(state.plans).find((item) => tripStatus(item).id !== 'past') || state.plans[0];
  const target = $('#dashboard-content');
  let html = '<div class="app-page-heading"><div><div class="kicker">TỔNG QUAN</div><h1>Chào ' + escapeHtml(state.user.name.split(' ')[0]) + ', mình đi đâu tiếp?</h1><p>' + (state.plans.length ? 'Bạn đang có ' + state.plans.length + ' chuyến đi được lưu.' : 'Bắt đầu một ý tưởng nhỏ cho chuyến đi tiếp theo.') + '</p></div><div class="app-page-actions"><a class="button button-ghost" href="/trips" data-route>Xem tất cả chuyến đi</a><button class="button button-primary" data-action="new-trip">Tạo chuyến đi <span>↗</span></button></div></div>';
  if (!plan) {
    target.innerHTML = html + '<div class="empty-plans"><h2>Chưa có chuyến đi nào</h2><p>Chọn một điểm đến, PinkTrip sẽ giúp bạn xếp lịch trình.</p><button class="button button-primary" data-action="new-trip">Tạo chuyến đi đầu tiên <span>↗</span></button></div>';
    return;
  }
  const status = tripStatus(plan);
  html += '<section class="overview-feature"><div><span class="card-eyebrow">' + status.label + ' · ' + escapeHtml(plan.destination?.name || 'Chuyến đi') + '</span><h2>' + escapeHtml(plan.title) + '</h2><p>' + formatDate(plan.startDate) + ' → ' + formatDate(plan.endDate) + ' · ' + plan.travelers + ' người · ' + intensityLabel(plan.intensity) + '</p><div class="overview-feature-actions"><a class="button button-primary button-small" href="/trips/' + encodeURIComponent(plan.id) + '" data-route>Xem chuyến đi</a><a class="button button-ghost button-small" href="/trips/' + encodeURIComponent(plan.id) + '/edit" data-route>Tiếp tục chỉnh sửa</a></div></div><div class="overview-feature-image" style="background-image:url(' + (plan.destination?.image || '') + ')" role="img" aria-label="' + escapeHtml(plan.destination?.name || 'Điểm đến') + '"></div></section>';
  target.innerHTML = html;
}

function renderTripCard(plan) {
  const status = tripStatus(plan);
  const destinationName = plan.destination?.name || 'Điểm đến';
  return '<article class="trip-card"><a class="trip-card-main" href="/trips/' + encodeURIComponent(plan.id) + '" data-route aria-label="Xem chi tiết chuyến đi ' + escapeHtml(plan.title) + '"><div class="trip-card-image" style="background-image:url(' + (plan.destination?.image || '') + ')" role="img" aria-label="' + escapeHtml(destinationName) + '"></div><div class="trip-card-body"><div class="trip-card-topline"><span class="status-badge status-' + status.id + '">' + status.label + '</span><span class="card-eyebrow">' + escapeHtml(destinationName) + '</span></div><h2>' + escapeHtml(plan.title) + '</h2><p class="trip-dates">' + formatDate(plan.startDate) + ' → ' + formatDate(plan.endDate) + '</p><dl class="trip-meta"><div><dt>Người đi</dt><dd>' + plan.travelers + ' người</dd></div><div><dt>Nhịp điệu</dt><dd>' + intensityLabel(plan.intensity) + '</dd></div><div><dt>Ngân sách</dt><dd>' + money(plan.budget?.total) + '</dd></div></dl></div></a><footer class="trip-card-actions"><a class="button button-ghost button-small" href="/trips/' + encodeURIComponent(plan.id) + '/edit" data-route>Chỉnh sửa</a><button class="text-button danger-action" type="button" data-action="delete-plan" data-id="' + plan.id + '" aria-label="Xóa chuyến đi ' + escapeHtml(plan.title) + '">Xóa</button></footer></article>';
}

function renderTripsPage() {
  const target = $('#trips-content');
  const query = state.tripSearch.trim().toLocaleLowerCase('vi-VN');
  const plans = sortTrips(state.plans).filter((plan) => (!query || (plan.title + ' ' + (plan.destination?.name || '')).toLocaleLowerCase('vi-VN').includes(query)) && (state.tripFilter === 'all' || tripStatus(plan).id === state.tripFilter));
  const filters = [['all', 'Tất cả'], ['upcoming', 'Sắp tới'], ['ongoing', 'Đang diễn ra'], ['past', 'Đã qua']].map(([id, label]) => '<button type="button" class="filter-tab ' + (state.tripFilter === id ? 'active' : '') + '" data-action="filter-trips" data-filter="' + id + '" aria-pressed="' + (state.tripFilter === id) + '">' + label + '</button>').join('');
  let html = '<div class="app-page-heading"><div><div class="kicker">MY TRIPS</div><h1>Chuyến đi của tôi</h1><p>Lưu lại những hành trình đang chờ và những nơi bạn đã đi qua.</p></div><button class="button button-primary" data-action="new-trip">Tạo chuyến đi <span>↗</span></button></div><div class="trip-toolbar"><label class="search-field" for="trip-search"><span class="sr-only">Tìm chuyến đi</span><span aria-hidden="true">⌕</span><input id="trip-search" type="search" data-trip-search value="' + escapeHtml(state.tripSearch) + '" placeholder="Tìm theo tên hoặc điểm đến"></label><div class="filter-tabs" role="group" aria-label="Lọc chuyến đi">' + filters + '</div></div>';
  html += plans.length ? '<div class="trips-grid' + (plans.length === 1 ? ' single-trip' : '') + '">' + plans.map(renderTripCard).join('') + '</div>' : '<div class="empty-plans"><h2>' + (state.plans.length ? 'Không tìm thấy chuyến đi phù hợp' : 'Chưa có chuyến đi nào') + '</h2><p>' + (state.plans.length ? 'Thử một từ khóa hoặc bộ lọc khác nhé.' : 'Bản kế hoạch đầu tiên của bạn đang chờ được tạo.') + '</p>' + (state.plans.length ? '<button class="button button-ghost" data-action="clear-trip-filters">Xóa bộ lọc</button>' : '<button class="button button-primary" data-action="new-trip">Tạo chuyến đi đầu tiên <span>↗</span></button>') + '</div>';
  target.innerHTML = html;
}

function timelineGap(item, nextItem) {
  const minutes = nextItem ? Math.max(0, timeToMinutes(nextItem.startTime) - timeToMinutes(item.endTime)) : 0;
  return minutes ? '<p class="timeline-gap"><span aria-hidden="true">↓</span> Khoảng chuyển tiếp ' + minutes + ' phút</p>' : '';
}

function timelineTime(item, { editable = false, dayIndex = 0 } = {}) {
  const start = editable
    ? '<input class="inline-input" type="text" inputmode="numeric" pattern="([01]\\d|2[0-3]):[0-5]\\d" data-item-field="startTime" data-day="' + dayIndex + '" data-item="' + item.id + '" value="' + escapeHtml(item.startTime) + '" aria-label="Giờ bắt đầu ' + escapeHtml(item.title) + '">'
    : '<time datetime="' + escapeHtml(item.startTime) + '"><strong>' + escapeHtml(item.startTime) + '</strong></time>';
  return '<div class="timeline-time">' + start + '<span>đến ' + escapeHtml(item.endTime) + '</span></div>';
}

function readonlyDay(day, index, protectedItemIds = new Set(), workspace = '') {
  const summary = summarizeDay(day);
  const items = summary.items;
  const protectedIds = protectedItemIds instanceof Set ? protectedItemIds : new Set();
  const content = items.length
    ? items.map((item, itemIndex) => '<div class="timeline-item timeline-item-readonly' + (protectedIds.has(item.id) ? ' timeline-item-protected' : '') + (itemIndex < items.length - 1 ? ' has-next' : '') + '">' + timelineTime(item) + '<div class="timeline-rail" aria-hidden="true"><span></span></div><div class="timeline-item-copy"><strong>' + escapeHtml(item.title) + '</strong><small>' + escapeHtml(categoryLabels[item.category] || item.category || 'Điểm dừng') + (item.areaLabel ? ' · ' + escapeHtml(item.areaLabel) : '') + ' · ' + item.durationMinutes + ' phút · ' + money(item.estimatedCost) + '/người</small>' + (protectedIds.has(item.id) ? '<span class="timeline-item-status">Đã hoàn thành · giữ nguyên</span>' : '') + '</div>' + timelineGap(item, items[itemIndex + 1]) + '</div>').join('')
    : '<p class="empty-day-message">Chưa có hoạt động nào trong ngày này.</p>';
  return '<section class="timeline-day"' + (workspace ? ' id="' + workspace + '-day-' + index + '" data-itinerary-day="' + index + '"' : '') + '><h3>NGÀY ' + (index + 1) + ' · ' + formatDate(day.date) + '</h3>' + renderDaySummary(summary) + content + '</section>';
}

function budgetStatus(budget, targetBudget) {
  if (!targetBudget) return 'Chưa đặt ngân sách mục tiêu.';
  return budget.isOverBudget ? 'Vượt mục tiêu ' + money(Math.abs(budget.remaining)) + '.' : 'Còn lại ' + money(budget.remaining) + ' trong mục tiêu.';
}

function budgetLines(budget) {
  return [['Di chuyển', budget.transportation], ['Lưu trú', budget.accommodation], ['Ăn uống', budget.food], ['Vé & điểm đến', budget.attractions], ['Hoạt động', budget.activities], ['Khác', budget.miscellaneous]]
    .map(([label, value]) => '<div class="budget-line"><span>' + label + '</span><strong>' + money(value) + '</strong></div>').join('');
}

function renderBudget(budget, targetBudget, days) {
  const budgetData = budget || {};
  return '<aside class="budget-panel"><h3>Ngân sách dự kiến</h3><div class="budget-total">' + money(budgetData.total) + '</div><small>' + money(budgetData.perPerson) + ' mỗi người' + (days ? ' · ' + days + ' ngày' : '') + '</small><div class="budget-breakdown">' + budgetLines(budgetData) + '</div><div class="budget-status ' + (budgetData.isOverBudget ? 'over' : 'ok') + '"><strong>' + budgetStatus(budgetData, targetBudget) + '</strong><span>' + (budgetData.isOverBudget ? 'Bạn có thể bớt điểm dừng hoặc điều chỉnh mục tiêu.' : 'Dự toán đang nằm trong khoảng bạn chọn.') + '</span></div></aside>';
}

function itineraryStats(days = []) {
  const summaries = summarizeItinerary(days);
  const items = summaries.days.flatMap((day) => day.items);
  const activeDays = summaries.activeDays;
  const average = activeDays ? Math.round((items.length / activeDays) * 10) / 10 : 0;
  return { items, activeDays, average, days: summaries.days };
}

function summarizeDay(day = {}) {
  return window.PinkTripItineraryState.summarizeDay(day);
}

function summarizeItinerary(days = []) {
  return window.PinkTripItineraryState.summarizeItinerary(days);
}

function activityLabel(count) {
  return count + ' hoạt động';
}

function dayRoute(day = {}) {
  return summarizeDay(day).route;
}

function dayStops(day = {}) {
  const titles = summarizeDay(day).items.map((item) => item.title);
  if (!titles.length) return '';
  return titles.slice(0, 3).join(' · ') + (titles.length > 3 ? ' · …' : '');
}

function renderDaySummary(summary) {
  if (!summary.hasActivities) return '<p class="day-summary is-empty">Ngày này chưa có hoạt động.</p>';
  const pieces = ['<strong>' + activityLabel(summary.count) + '</strong>'];
  if (summary.timeRange) pieces.push('<span>' + escapeHtml(summary.timeRange) + '</span>');
  if (summary.route) pieces.push('<span class="day-summary-route">' + escapeHtml(summary.routeLabel) + ': ' + escapeHtml(summary.route) + '</span>');
  return '<p class="day-summary">' + pieces.join(' <span aria-hidden="true">·</span> ') + '</p>';
}

function dayOverviewSummary(summary) {
  if (!summary.hasActivities) return 'Ngày này chưa có hoạt động';
  return activityLabel(summary.count) + (summary.timeRange ? ' · ' + summary.timeRange : '');
}

function renderDayNavigator(days, workspace) {
  const active = Math.min(Math.max(0, Number(state.activeItineraryDay) || 0), Math.max(0, days.length - 1));
  return '<nav class="itinerary-day-nav" aria-label="Đi tới ngày trong lịch trình"><button class="itinerary-nav-chip" type="button" data-action="jump-itinerary-overview" data-workspace="' + workspace + '">Tổng quan</button><div class="itinerary-nav-scroll">' + days.map((day, index) => {
    const summary = summarizeDay(day);
    return '<button class="itinerary-nav-chip ' + (index === active ? 'active' : '') + '" type="button" data-action="jump-itinerary-day" data-workspace="' + workspace + '" data-day-index="' + index + '" aria-current="' + (index === active ? 'step' : 'false') + '" aria-label="Ngày ' + (index + 1) + (summary.hasActivities ? ', ' + activityLabel(summary.count) : ', chưa có hoạt động') + '">Ngày ' + (index + 1) + '</button>';
  }).join('') + '</div></nav>';
}

function renderItineraryActions() {
  return '<div class="itinerary-sticky-actions"><div><strong>Lịch trình của bạn</strong><span>Đặt lại chỉ hoàn tác các chỉnh sửa chưa lưu về lịch trình đã lưu gần nhất.</span></div><div class="itinerary-primary-actions"><button class="button button-ghost button-small" type="button" data-action="open-replan">Điều chỉnh</button><button class="button button-ghost button-small itinerary-reset" type="button" data-action="reset-itinerary">Đặt lại lịch trình</button><button class="button button-primary button-small" type="button" data-action="save-plan">Lưu chuyến đi <span>✓</span></button></div></div>';
}

function renderItineraryOverview({ destination, startDate, endDate, travelers, intensity, budget, days, workspace, editable = false }) {
  const stats = itineraryStats(days);
  const intensityText = intensityLabel(intensity);
  const metrics = [
    ['Ngày đi', days.length + ' ngày'],
    ['Hoạt động', activityLabel(stats.items.length)],
    ['Trung bình', stats.average + ' hoạt động/ngày'],
    ['Ngân sách', money(budget?.total)]
  ];
  return '<section class="itinerary-workspace" id="' + workspace + '-overview"><div class="itinerary-overview-head"><div><span class="kicker">TỔNG QUAN CHUYẾN ĐI</span><h3>' + escapeHtml(destination?.name || 'Chuyến đi của bạn') + '</h3><p>' + formatDate(startDate) + ' → ' + formatDate(endDate) + ' · ' + travelers + ' người · ' + intensityText + '</p></div><div class="itinerary-view-toggle" role="group" aria-label="Mật độ hiển thị lịch trình">' + (editable ? '<button class="view-toggle ' + (state.itineraryView === 'detailed' ? 'active' : '') + '" type="button" data-action="set-itinerary-view" data-view="detailed" aria-pressed="' + (state.itineraryView === 'detailed') + '">Chi tiết</button><button class="view-toggle ' + (state.itineraryView === 'compact' ? 'active' : '') + '" type="button" data-action="set-itinerary-view" data-view="compact" aria-pressed="' + (state.itineraryView === 'compact') + '">Thu gọn</button>' : '<span class="itinerary-readonly-label">Chế độ xem</span>') + '</div></div><div class="itinerary-metrics">' + metrics.map(([label, value]) => '<div><small>' + label + '</small><strong>' + value + '</strong></div>').join('') + '</div><div class="itinerary-shape" aria-labelledby="' + workspace + '-shape-heading"><div><div><span class="kicker">NHỊP ĐỘ TỪNG NGÀY</span><h4 id="' + workspace + '-shape-heading">Toàn cảnh hành trình</h4></div><p>' + (stats.activeDays ? stats.activeDays + ' ngày có lịch · ' + activityLabel(stats.items.length) : 'Chưa có hoạt động nào') + '</p></div><div class="day-overview-list">' + days.map((day, index) => { const summary = summarizeDay(day); const stops = dayStops(day); return '<button class="day-overview-card ' + (index === Math.min(Math.max(0, Number(state.activeItineraryDay) || 0), Math.max(0, days.length - 1)) ? 'active' : '') + '" type="button" data-action="jump-itinerary-day" data-workspace="' + workspace + '" data-day-index="' + index + '"><span class="day-overview-label">Ngày ' + (index + 1) + ' · ' + formatDate(day.date) + '</span><strong>' + escapeHtml(dayOverviewSummary(summary)) + '</strong>' + (stops ? '<small>' + escapeHtml(stops) + '</small>' : '') + (summary.route ? '<em>' + escapeHtml(summary.routeLabel + ': ' + summary.route) + '</em>' : '') + '</button>'; }).join('') + '</div></div></section>';
}

function renderTripDetail() {
  const target = $('#trips-content');
  if (state.routeStatus === 'loading') {
    target.innerHTML = '<div class="page-state"><h1>Đang mở hành trình…</h1><p>PinkTrip đang sắp xếp lại lịch trình đã lưu.</p></div>';
    return;
  }
  if (!state.activeTrip) {
    target.innerHTML = '<div class="page-state"><h1>Không tìm thấy chuyến đi này</h1><p>Chuyến đi có thể đã bị xóa hoặc không thuộc tài khoản của bạn.</p><a class="button button-primary" href="/trips" data-route>Về My Trips</a></div>';
    return;
  }
  const plan = state.activeTrip;
  const status = tripStatus(plan);
  const services = state.services.filter((item) => item.destinationId === plan.destinationId).slice(0, 3);
  const servicesHtml = services.length ? '<section class="detail-services"><h2>Gợi ý quanh ' + escapeHtml(plan.destination?.name || 'điểm đến') + '</h2><div class="services-grid">' + services.map(serviceCard).join('') + '</div></section>' : '';
  const days = plan.days || [];
  target.innerHTML = '<a class="back-link" href="/trips" data-route>← Tất cả chuyến đi</a><section class="trip-detail-hero"><div class="trip-detail-copy"><div class="trip-card-topline"><span class="status-badge status-' + status.id + '">' + status.label + '</span><span class="card-eyebrow">' + escapeHtml(plan.destination?.name || 'Điểm đến') + '</span></div><h1>' + escapeHtml(plan.title) + '</h1><p>' + formatDate(plan.startDate) + ' → ' + formatDate(plan.endDate) + '</p><dl class="detail-meta"><div><dt>Người đi</dt><dd>' + plan.travelers + ' người</dd></div><div><dt>Nhịp điệu</dt><dd>' + intensityLabel(plan.intensity) + '</dd></div><div><dt>Ngân sách</dt><dd>' + money(plan.budget?.total) + '</dd></div></dl><div class="detail-actions"><a class="button button-primary" href="/trips/' + encodeURIComponent(plan.id) + '/edit" data-route>Chỉnh sửa lịch trình <span>↗</span></a><button class="button button-ghost" data-action="open-review" data-destination-id="' + plan.destinationId + '">Chia sẻ trải nghiệm</button><button class="text-button danger-action" data-action="delete-plan" data-id="' + plan.id + '">Xóa chuyến đi</button></div></div><div class="trip-detail-image" style="background-image:url(' + (plan.destination?.image || '') + ')" role="img" aria-label="' + escapeHtml(plan.destination?.name || 'Điểm đến') + '"></div></section>' + renderItineraryOverview({ destination: plan.destination, startDate: plan.startDate, endDate: plan.endDate, travelers: plan.travelers, intensity: plan.intensity, budget: plan.budget, days, workspace: 'detail' }) + renderDayNavigator(days, 'detail') + '<section class="detail-content"><div><div class="detail-section-heading"><div><div class="kicker">LỊCH TRÌNH ĐÃ LƯU</div><h2>Từng ngày, thật rõ ràng.</h2></div><p>Chọn một ngày để đi thẳng đến lịch trình chi tiết.</p></div><div class="timeline-list">' + days.map((day, index) => readonlyDay(day, index, new Set(), 'detail')).join('') + '</div>' + servicesHtml + '</div>' + renderBudget(plan.budget, plan.targetBudget, days.length) + '</section>';
}

function serviceCard(item) {
  return '<article class="service-card"><img src="' + item.image + '" alt="' + escapeHtml(item.name) + '"><div><h3>' + escapeHtml(item.name) + '</h3><p>' + escapeHtml(item.description) + '</p><small>' + escapeHtml(item.type) + ' · ' + item.priceRange + ' · ★ ' + item.rating + '</small></div></article>';
}

function renderServices() {
  const section = $('#services-section');
  const id = state.generated?.destination?.id || state.draft.destinationId;
  section.classList.toggle('hidden', !state.generated || !['home', 'edit', 'new'].includes(state.route.view));
  $('#services-grid').innerHTML = state.services.filter((item) => item.destinationId === id).map(serviceCard).join('');
}

function ratingSummaryFor(placeId) {
  return state.placeRatings[placeId] || { average: null, count: 0 };
}

function ratingText(summary) {
  return summary?.count ? '★ ' + Number(summary.average).toFixed(1) + ' (' + summary.count + ')' : 'Chưa có đánh giá';
}

function reviewLocation(review) {
  return review.placeId ? place(review.placeId)?.name || 'Địa điểm đã ghé' : destination(review.destinationId)?.name || 'PinkTrip';
}

function ensureReviewDraft(context = {}) {
  const requestedDestination = context.destinationId || state.reviewDraft?.destinationId || state.draft.destinationId || state.destinations[0]?.id || '';
  const availablePlaces = state.places.filter((item) => item.destinationId === requestedDestination);
  const requestedPlace = context.placeId ?? state.reviewDraft?.placeId ?? '';
  const requestedRating = Number(context.rating ?? state.reviewDraft?.rating ?? state.reviewRating ?? 5);
  state.reviewDraft = {
    destinationId: requestedDestination,
    placeId: availablePlaces.some((item) => item.id === requestedPlace) ? requestedPlace : '',
    rating: Number.isInteger(requestedRating) && requestedRating >= 1 && requestedRating <= 5 ? requestedRating : 5,
    text: context.text ?? state.reviewDraft?.text ?? ''
  };
  state.reviewRating = state.reviewDraft.rating;
  return state.reviewDraft;
}

function renderRatingControl(draft) {
  return '<fieldset class="field"><legend>Đánh giá <span aria-hidden="true">*</span></legend><div class="stars-input" role="radiogroup" aria-label="Chọn số sao. Dùng phím mũi tên để thay đổi.">' + [1, 2, 3, 4, 5].map((rating) => '<button type="button" class="' + (rating <= draft.rating ? 'active' : '') + '" data-action="review-star" data-rating="' + rating + '" role="radio" aria-checked="' + (rating === draft.rating) + '" tabindex="' + (rating === draft.rating ? '0' : '-1') + '" aria-label="' + rating + ' sao">★</button>').join('') + '</div><small class="field-hint" data-rating-message aria-live="polite">' + draft.rating + ' trên 5 sao</small></fieldset>';
}

function updateRatingControl(form, rating) {
  form?.querySelectorAll('[data-action="review-star"]').forEach((button) => {
    const selected = Number(button.dataset.rating) === rating;
    button.classList.toggle('active', Number(button.dataset.rating) <= rating);
    button.setAttribute('aria-checked', String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  const message = form?.querySelector('[data-rating-message]');
  if (message) message.textContent = rating + ' trên 5 sao';
}

function renderReviewForm({ modal = false } = {}) {
  const draft = ensureReviewDraft();
  const prefix = modal ? 'modal-review' : 'review';
  const destinationName = destination(draft.destinationId)?.name || 'điểm đến';
  const availablePlaces = state.places.filter((item) => item.destinationId === draft.destinationId);
  const title = state.reviewEditingId ? 'Chỉnh sửa đánh giá' : 'Chia sẻ một điều nhỏ';
  return '<form class="review-form' + (modal ? ' review-modal-form' : '') + '" data-form="review" data-review-mode="' + (modal ? 'modal' : 'inline') + '"><h3>' + title + '</h3><p class="review-form-intro">Chia sẻ điều bạn thích, một mẹo nhỏ hoặc điều cần lưu ý cho người đi sau.</p><div class="field"><label for="' + prefix + '-destination">Điểm đến</label><select id="' + prefix + '-destination" name="destinationId" data-review-field="destinationId" required>' + state.destinations.map((item) => '<option value="' + item.id + '" ' + (item.id === draft.destinationId ? 'selected' : '') + '>' + escapeHtml(item.name) + '</option>').join('') + '</select></div><div class="field"><label for="' + prefix + '-place">Địa điểm cụ thể <span class="optional">(không bắt buộc)</span></label><select id="' + prefix + '-place" name="placeId" data-review-field="placeId"><option value="">Đánh giá chung về ' + escapeHtml(destinationName) + '</option>' + availablePlaces.map((item) => '<option value="' + item.id + '" ' + (item.id === draft.placeId ? 'selected' : '') + '>' + escapeHtml(item.name) + '</option>').join('') + '</select><small class="field-hint">Chỉ hiện địa điểm thuộc ' + escapeHtml(destinationName) + '.</small></div>' + renderRatingControl(draft) + '<div class="field"><label for="' + prefix + '-text">Chia sẻ trải nghiệm</label><textarea id="' + prefix + '-text" name="text" data-review-field="text" required minlength="2" placeholder="Điều gì khiến bạn nhớ nhất? Có mẹo nào hữu ích không?">' + escapeHtml(draft.text) + '</textarea></div><div class="error-message" data-review-error aria-live="polite"></div><div class="review-form-actions">' + (modal ? '<button class="button button-ghost" type="button" data-action="close-review-modal">Hủy</button>' : '') + '<button class="button button-dark" type="submit">' + (state.reviewEditingId ? 'Lưu thay đổi' : 'Đăng đánh giá') + ' <span>↗</span></button></div></form>';
}

function reviewPath(filters = {}) {
  const params = new URLSearchParams();
  if (filters.destinationId) params.set('destinationId', filters.destinationId);
  if (filters.placeId) params.set('placeId', filters.placeId);
  if (filters.rating) params.set('rating', filters.rating);
  if (filters.sort && filters.sort !== 'newest') params.set('sort', filters.sort);
  if (Number(filters.page) > 1) params.set('page', String(filters.page));
  const query = params.toString();
  return '/reviews' + (query ? '?' + query : '');
}

function reviewExcerpt(text, length = 170) {
  const characters = Array.from(String(text || ''));
  return characters.length > length ? characters.slice(0, length).join('') + '…' : characters.join('');
}

function findReview(id) {
  return [...(state.reviewDetail?.reviews || []), ...(state.reviewBrowse.items || []), ...state.reviews]
    .find((item) => item.id === id);
}

function renderReviewCard(review, { compact = false, preview = false } = {}) {
  const own = state.user?.id && review.userId === state.user.id;
  const location = reviewLocation(review);
  const text = preview ? reviewExcerpt(review.text) : String(review.text || '');
  const more = preview && text !== String(review.text || '')
    ? '<button class="text-button review-read-more" type="button" data-action="view-review-target" data-destination-id="' + escapeHtml(review.destinationId) + '"' + (review.placeId ? ' data-place-id="' + escapeHtml(review.placeId) + '"' : '') + '>Đọc thêm</button>'
    : '';
  return '<article class="review-card' + (compact ? ' compact' : '') + (preview ? ' review-preview-card' : '') + '"><div class="review-card-top"><div class="stars" aria-label="' + review.rating + ' trên 5 sao">' + '★'.repeat(review.rating) + '☆'.repeat(5 - review.rating) + '</div><time datetime="' + escapeHtml(review.createdAt || '') + '">' + (review.createdAt ? formatDate(review.createdAt.slice(0, 10)) : '') + '</time></div><blockquote>“' + escapeHtml(text) + '”</blockquote>' + more + '<cite>' + escapeHtml(review.authorName || 'Khách du lịch') + ' · ' + escapeHtml(location) + '</cite>' + (own ? '<div class="review-card-actions"><button class="text-button" type="button" data-action="edit-review" data-id="' + review.id + '">Chỉnh sửa</button><button class="text-button danger-action" type="button" data-action="delete-review" data-id="' + review.id + '">Xóa</button></div>' : '') + '</article>';
}

function renderReviews() {
  const grid = $('#reviews-grid');
  const total = state.reviewPreview.total || 0;
  const hasReviews = state.reviews.length > 0;
  grid.classList.toggle('hidden', !hasReviews);
  grid.innerHTML = hasReviews ? state.reviews.map((review) => renderReviewCard(review, { preview: true })).join('') : '';
  const wrap = $('#review-form-wrap');
  wrap.classList.remove('hidden');
  if (!hasReviews) {
    wrap.innerHTML = '<div class="review-empty review-preview-empty"><strong>Chưa có chia sẻ nào.</strong><span>Hãy là người đầu tiên kể lại điều đáng nhớ trong chuyến đi của bạn.</span><button class="button button-primary button-small" type="button" data-action="open-review">Viết đánh giá <span>↗</span></button></div>';
    return;
  }
  wrap.innerHTML = '<div class="review-preview-actions"><a class="button button-ghost" href="/reviews" data-route>Xem tất cả ' + total + ' đánh giá <span>→</span></a><button class="button button-dark" type="button" data-action="open-review">Chia sẻ trải nghiệm</button></div>';
}

function renderReviewModal() {
  if (!state.reviewModalOpen) return;
  $('#modal-root').innerHTML = '<div class="modal-backdrop"><section class="modal review-modal" role="dialog" aria-modal="true" aria-labelledby="review-modal-title"><button class="modal-close" type="button" data-action="close-review-modal" aria-label="Đóng cửa sổ">×</button><div class="kicker">TRẢI NGHIỆM THẬT</div><h2 id="review-modal-title">' + (state.reviewEditingId ? 'Cập nhật đánh giá' : 'Chia sẻ trải nghiệm') + '</h2><p>Đánh giá có thể dành cho cả điểm đến hoặc một nơi bạn đã ghé.</p>' + renderReviewForm({ modal: true }) + '</section></div>';
  requestAnimationFrame(() => $('#modal-review-destination')?.focus());
}

function renderPlaceReviewModal() {
  const detail = state.reviewDetail;
  if (!detail) return;
  const max = Math.max(1, ...Object.values(detail.ratingDistribution || {}));
  const distribution = [5, 4, 3, 2, 1].map((rating) => '<div class="rating-distribution-row"><span>' + rating + ' ★</span><span class="rating-bar"><span style="width:' + (((detail.ratingDistribution || {})[rating] || 0) / max * 100) + '%"></span></span><strong>' + ((detail.ratingDistribution || {})[rating] || 0) + '</strong></div>').join('');
  const summary = detail.ratingSummary || { average: null, count: 0 };
  const total = detail.pagination?.total || summary.count || 0;
  const reviewsHtml = detail.reviews.length ? detail.reviews.map((review) => renderReviewCard(review, { compact: true, preview: true })).join('') : '<div class="review-empty"><strong>Chưa có chia sẻ nào cho địa điểm này.</strong><span>Hãy là người đầu tiên chia sẻ kinh nghiệm thực tế.</span></div>';
  $('#modal-root').innerHTML = '<div class="modal-backdrop"><section class="modal place-review-modal" role="dialog" aria-modal="true" aria-labelledby="place-review-title"><button class="modal-close" type="button" data-action="close-place-reviews" aria-label="Đóng cửa sổ">×</button><div class="kicker">GÓC NHÌN CỘNG ĐỒNG</div><h2 id="place-review-title">' + escapeHtml(detail.place.name) + '</h2><p>' + escapeHtml(detail.place.description) + '</p><div class="place-rating-summary"><strong>' + (summary.count ? Number(summary.average).toFixed(1) : '—') + '</strong><div><span aria-label="Điểm đánh giá">★</span><small>' + (summary.count ? summary.count + ' đánh giá' : 'Chưa có đánh giá') + '</small></div></div>' + (summary.count ? '<div class="rating-distribution" aria-label="Phân bố đánh giá">' + distribution + '</div>' : '') + '<div class="place-review-modal-actions"><button class="button button-primary" type="button" data-action="open-review" data-destination-id="' + detail.place.destinationId + '" data-place-id="' + detail.place.id + '">Viết đánh giá <span>↗</span></button>' + (total ? '<button class="button button-ghost" type="button" data-action="view-all-reviews" data-destination-id="' + detail.place.destinationId + '" data-place-id="' + detail.place.id + '">Xem tất cả ' + total + ' đánh giá <span>→</span></button>' : '') + '</div><div class="place-review-list">' + reviewsHtml + '</div></section></div>';
  requestAnimationFrame(() => $('.place-review-modal .modal-close')?.focus());
}

function reviewScope(filters) {
  const selectedPlace = filters.placeId ? place(filters.placeId) : null;
  const selectedDestination = filters.destinationId ? destination(filters.destinationId) : null;
  if (selectedPlace) return { title: 'Đánh giá về ' + selectedPlace.name, description: 'Những chia sẻ của người đã ghé ' + selectedPlace.name + '.', destinationId: selectedPlace.destinationId, placeId: selectedPlace.id };
  if (selectedDestination) return { title: 'Đánh giá về ' + selectedDestination.name, description: 'Tất cả trải nghiệm tại ' + selectedDestination.name + ', gồm cả những nơi cụ thể người đi trước đã ghé.', destinationId: selectedDestination.id, placeId: '' };
  return { title: 'Đánh giá & trải nghiệm', description: 'Những điều người đi trước đã chia sẻ để bạn chọn hành trình tự tin hơn.', destinationId: '', placeId: '' };
}

function renderRatingSummary(summary, distribution) {
  if (!summary?.count) return '';
  const max = Math.max(1, ...Object.values(distribution || {}));
  const rows = [5, 4, 3, 2, 1].map((rating) => '<div class="rating-distribution-row"><span>' + rating + ' ★</span><span class="rating-bar"><span style="width:' + (((distribution || {})[rating] || 0) / max * 100) + '%"></span></span><strong>' + ((distribution || {})[rating] || 0) + '</strong></div>').join('');
  return '<section class="reviews-summary" aria-label="Tóm tắt đánh giá"><div><strong>' + Number(summary.average).toFixed(1) + '</strong><span aria-hidden="true">★</span><small>' + summary.count + ' đánh giá</small></div><div class="rating-distribution">' + rows + '</div></section>';
}

function renderReviewPagination(pagination) {
  if (!pagination || pagination.totalPages <= 1) return '';
  const pages = Array.from({ length: pagination.totalPages }, (_, index) => index + 1).filter((page, _, all) => all.length <= 7 || page === 1 || page === all.length || Math.abs(page - pagination.page) <= 1);
  let previousPage = null;
  const buttons = pages.map((page) => {
    const gap = previousPage && page - previousPage > 1 ? '<span class="pagination-ellipsis" aria-hidden="true">…</span>' : '';
    previousPage = page;
    return gap + '<button class="pagination-page ' + (page === pagination.page ? 'active' : '') + '" type="button" data-action="review-page" data-page="' + page + '"' + (page === pagination.page ? ' aria-current="page"' : '') + ' aria-label="Trang ' + page + '">' + page + '</button>';
  }).join('');
  return '<nav class="review-pagination" aria-label="Phân trang đánh giá"><button class="button button-ghost button-small" type="button" data-action="review-page" data-page="' + (pagination.page - 1) + '"' + (pagination.page === 1 ? ' disabled' : '') + '>← Trước</button><div class="pagination-pages">' + buttons + '</div><button class="button button-ghost button-small" type="button" data-action="review-page" data-page="' + (pagination.page + 1) + '"' + (pagination.page === pagination.totalPages ? ' disabled' : '') + '>Sau →</button></nav>';
}

function renderReviewPage() {
  const target = $('#reviews-content');
  const browse = state.reviewBrowse;
  const filters = state.route.reviewFilters || browse.filters || { destinationId: '', placeId: '', rating: '', sort: 'newest', page: 1 };
  const scope = reviewScope(filters);
  const availablePlaces = state.places.filter((item) => !filters.destinationId || item.destinationId === filters.destinationId);
  if (browse.loading) {
    target.innerHTML = '<div class="page-state"><h1>Đang mở những trải nghiệm…</h1><p>PinkTrip đang gom những chia sẻ phù hợp.</p></div>';
    return;
  }
  if (browse.error) {
    target.innerHTML = '<div class="page-state"><h1>Chưa thể mở đánh giá</h1><p>' + escapeHtml(browse.error) + '</p><a class="button button-primary" href="/reviews" data-route>Thử lại</a></div>';
    return;
  }
  const placeOptions = '<option value="">Tất cả địa điểm</option>' + availablePlaces.map((item) => '<option value="' + item.id + '" ' + (filters.placeId === item.id ? 'selected' : '') + '>' + escapeHtml(item.name) + '</option>').join('');
  const ratingOptions = [['', 'Tất cả số sao'], ['5', '5 sao'], ['4', '4 sao'], ['3', '3 sao'], ['2', '2 sao'], ['1', '1 sao']]
    .map(([value, label]) => '<option value="' + value + '" ' + (String(filters.rating) === value ? 'selected' : '') + '>' + label + '</option>').join('');
  const sortOptions = [['newest', 'Mới nhất'], ['highest', 'Đánh giá cao nhất'], ['lowest', 'Đánh giá thấp nhất'], ['oldest', 'Cũ nhất']]
    .map(([value, label]) => '<option value="' + value + '" ' + (filters.sort === value ? 'selected' : '') + '>' + label + '</option>').join('');
  const results = browse.items.length
    ? '<div class="review-list">' + browse.items.map((review) => renderReviewCard(review)).join('') + '</div>'
    : '<div class="review-empty reviews-page-empty"><strong>Chưa có đánh giá phù hợp.</strong><span>' + (scope.placeId ? 'Hãy là người đầu tiên chia sẻ về địa điểm này.' : 'Thử đổi bộ lọc hoặc chia sẻ một trải nghiệm của bạn.') + '</span><button class="button button-primary button-small" type="button" data-action="open-review"' + (scope.destinationId ? ' data-destination-id="' + scope.destinationId + '"' : '') + (scope.placeId ? ' data-place-id="' + scope.placeId + '"' : '') + '>Viết đánh giá <span>↗</span></button></div>';
  target.innerHTML = '<button class="back-link review-back" type="button" data-action="reviews-back">← Quay lại</button><div class="app-page-heading review-page-heading"><div><div class="kicker">GÓC NHÌN CỘNG ĐỒNG</div><h1>' + escapeHtml(scope.title) + '</h1><p>' + escapeHtml(scope.description) + '</p></div><button class="button button-primary" type="button" data-action="open-review"' + (scope.destinationId ? ' data-destination-id="' + scope.destinationId + '"' : '') + (scope.placeId ? ' data-place-id="' + scope.placeId + '"' : '') + '>Viết đánh giá <span>↗</span></button></div>' + renderRatingSummary(browse.ratingSummary, browse.ratingDistribution) + '<section class="review-filters" aria-label="Lọc đánh giá"><div class="field"><label for="review-filter-destination">Điểm đến</label><select id="review-filter-destination" data-review-filter="destinationId"><option value="">Tất cả điểm đến</option>' + state.destinations.map((item) => '<option value="' + item.id + '" ' + (filters.destinationId === item.id ? 'selected' : '') + '>' + escapeHtml(item.name) + '</option>').join('') + '</select></div><div class="field"><label for="review-filter-place">Địa điểm</label><select id="review-filter-place" data-review-filter="placeId">' + placeOptions + '</select></div><div class="field"><label for="review-filter-rating">Số sao</label><select id="review-filter-rating" data-review-filter="rating">' + ratingOptions + '</select></div><div class="field"><label for="review-filter-sort">Sắp xếp</label><select id="review-filter-sort" data-review-filter="sort">' + sortOptions + '</select></div></section><div class="review-results-heading"><strong>' + (browse.pagination?.total || 0) + ' đánh giá</strong><span>' + (browse.pagination?.totalPages > 1 ? 'Trang ' + browse.pagination.page + ' / ' + browse.pagination.totalPages : 'Hiển thị mới nhất') + '</span></div>' + results + renderReviewPagination(browse.pagination);
}

async function loadReviewBrowse(filters) {
  state.reviewBrowse = { ...state.reviewBrowse, loading: true, error: '', filters };
  render();
  const params = new URLSearchParams({ page: String(filters.page || 1), pageSize: '10', sort: filters.sort || 'newest' });
  if (filters.destinationId) params.set('destinationId', filters.destinationId);
  if (filters.placeId) params.set('placeId', filters.placeId);
  if (filters.rating) params.set('rating', String(filters.rating));
  try {
    const result = await api('/api/reviews?' + params.toString());
    if (state.route.view !== 'reviews') return;
    const nextFilters = {
      destinationId: result.filters.destinationId || '',
      placeId: result.filters.placeId || '',
      rating: result.filters.rating || '',
      sort: result.filters.sort,
      page: result.pagination.page
    };
    if (reviewPath(nextFilters) !== window.location.pathname + window.location.search) {
      history.replaceState({}, '', reviewPath(nextFilters));
      state.route = { view: 'reviews', reviewFilters: nextFilters };
    }
    state.reviewBrowse = { ...result, items: result.reviews, loading: false, error: '', filters: nextFilters };
  } catch (error) {
    if (state.route.view === 'reviews') state.reviewBrowse = { ...state.reviewBrowse, loading: false, error: error.message, filters };
  }
}

function navigateReviews(filters) {
  state.reviewDetail = null;
  state.reviewModalOpen = false;
  $('#modal-root').innerHTML = '';
  return navigate(reviewPath(filters));
}

function openReview(context = {}) {
  if (!state.user) {
    state.pendingReviewContext = { ...context };
    return openAuth('login');
  }
  lastModalTrigger = document.activeElement;
  state.reviewReturnDetail = state.reviewDetail;
  state.reviewDetail = null;
  state.reviewEditingId = context.reviewId || null;
  state.reviewDraft = null;
  ensureReviewDraft(context);
  state.reviewModalOpen = true;
  renderReviewModal();
}

function closeReviewModal(restoreFocus = true, returnToPlaceDetail = true) {
  state.reviewModalOpen = false;
  state.reviewEditingId = null;
  $('#modal-root').innerHTML = '';
  const returnDetail = returnToPlaceDetail ? state.reviewReturnDetail : null;
  state.reviewReturnDetail = null;
  if (returnDetail) {
    state.reviewDetail = returnDetail;
    renderPlaceReviewModal();
    return;
  }
  if (restoreFocus && lastModalTrigger instanceof HTMLElement) lastModalTrigger.focus();
}

async function openPlaceReviews(placeId) {
  const selectedPlace = place(placeId);
  if (!selectedPlace) return;
  lastModalTrigger = document.activeElement;
  try {
    const result = await api('/api/reviews?placeId=' + encodeURIComponent(placeId) + '&page=1&pageSize=3&sort=newest');
    state.reviewDetail = { place: selectedPlace, ...result };
    renderPlaceReviewModal();
  } catch (error) { toast(error.message); }
}

function closePlaceReviews(restoreFocus = true) {
  state.reviewDetail = null;
  $('#modal-root').innerHTML = '';
  if (restoreFocus && lastModalTrigger instanceof HTMLElement) lastModalTrigger.focus();
}

function editReview(id) {
  const review = findReview(id);
  if (!review) return;
  openReview({ reviewId: review.id, destinationId: review.destinationId, placeId: review.placeId || '', rating: review.rating, text: review.text });
}

async function deleteReview(id) {
  if (!window.confirm('Xóa đánh giá này?')) return;
  try {
    await api('/api/reviews/' + encodeURIComponent(id), { method: 'DELETE' });
    await refreshReviewData();
    if (state.reviewDetail) await openPlaceReviews(state.reviewDetail.place.id);
    else if (state.route.view === 'reviews') {
      const filters = state.route.reviewFilters || state.reviewBrowse.filters;
      await loadReviewBrowse(filters);
      render();
    } else render();
    toast('Đã xóa đánh giá');
  } catch (error) { toast(error.message); }
}

function filteredPlaces() {
  const places = state.places.filter((item) => item.destinationId === state.draft.destinationId);
  const interests = new Set((state.draft.interests || []).map(normalizeCategory));
  const query = state.placeSearch.trim().toLocaleLowerCase('vi-VN');
  return places.filter((item) => (!interests.size || placeCategories(item).some((category) => interests.has(category)))
    && (!query || [item.name, item.description, item.areaLabel, item.area].filter(Boolean).join(' ').toLocaleLowerCase('vi-VN').includes(query)));
}

function pickerCard(item, action = 'toggle-place') {
  const selected = (state.draft.selectedPlaceIds || []).includes(item.id);
  const label = placeCategories(item).map((category) => categoryLabels[category] || category).join(' · ');
  const summary = ratingSummaryFor(item.id);
  const ratingLabel = summary.count ? 'Xem ' + summary.count + ' đánh giá, trung bình ' + Number(summary.average).toFixed(1) + ' sao cho ' + item.name : 'Xem đánh giá cho ' + item.name;
  return '<article class="picker-card ' + (selected ? 'selected' : '') + '"><button class="picker-select" type="button" data-action="' + action + '" data-id="' + item.id + '" aria-pressed="' + selected + '" aria-label="' + (selected ? 'Bỏ chọn ' : 'Thêm ') + escapeHtml(item.name) + '"><span class="picker-img" style="background-image:url(' + item.image + ')"></span><span class="picker-body"><strong>' + escapeHtml(item.name) + '</strong><span class="place-area">' + escapeHtml(item.areaLabel || '') + '</span><span class="picker-description">' + escapeHtml(item.description) + '</span><span class="picker-foot"><span>' + escapeHtml(label) + ' · ' + item.recommendedDurationMinutes + ' phút · ' + money(item.estimatedCost) + '</span><span class="selected-pill">' + (selected ? '✓ Đã chọn' : 'Thêm +') + '</span></span></span></button><button class="rating-link" type="button" data-action="open-place-reviews" data-id="' + item.id + '" aria-label="' + escapeHtml(ratingLabel) + '">' + ratingText(summary) + '<span aria-hidden="true">↗</span></button></article>';
}

function renderStepTwo() {
  const candidates = filteredPlaces();
  const all = state.places.filter((item) => item.destinationId === state.draft.destinationId);
  const selected = all.filter((item) => (state.draft.selectedPlaceIds || []).includes(item.id));
  const interests = [['nature', '🌿', 'Thiên nhiên'], ['beach', '◒', 'Biển'], ['food', '⌁', 'Ẩm thực'], ['culture', '⌂', 'Văn hóa'], ['photography', '⊙', 'Nhiếp ảnh'], ['experience', '✦', 'Trải nghiệm']];
  const visibleCandidates = candidates.slice(0, state.placeVisibleCount);
  const resultHtml = candidates.length
    ? visibleCandidates.map((item) => pickerCard(item)).join('') + (visibleCandidates.length < candidates.length ? '<div class="place-picker-actions"><button class="button button-ghost" type="button" data-action="load-more-places">Xem thêm ' + Math.min(12, candidates.length - visibleCandidates.length) + ' địa điểm <span>↓</span></button></div>' : '')
    : '<div class="empty-filter-state"><strong>Không tìm thấy địa điểm phù hợp với các sở thích đã chọn.</strong><span>Hãy thử thay đổi hoặc xóa bớt bộ lọc.</span><button class="button button-ghost button-small" data-action="clear-interests">Xóa bộ lọc</button></div>';
  const selectedNames = selected.slice(0, 6).map((item) => item.name);
  if (selected.length > selectedNames.length) selectedNames.push('và ' + (selected.length - selectedNames.length) + ' địa điểm khác');
  const selectedSummary = selected.length ? '<div class="selected-summary" aria-live="polite"><strong>' + selected.length + ' địa điểm đã chọn</strong><span>' + escapeHtml(selectedNames.join(' · ')) + '</span></div>' : '<div class="selected-summary is-empty" aria-live="polite"><strong>Chưa chọn địa điểm</strong><span>Chọn ít nhất một nơi để PinkTrip tạo lịch trình.</span></div>';
  return '<div class="step-panel"><h3>Điều gì làm bạn muốn đi?</h3><p>Chọn sở thích để lọc gợi ý, tìm nhanh theo tên và lưu các nơi bạn thật sự muốn ghé.</p><div class="choice-grid">' + interests.map(([id, icon, label]) => '<button class="choice ' + ((state.draft.interests || []).map(normalizeCategory).includes(id) ? 'selected' : '') + '" type="button" data-action="toggle-interest" data-interest="' + id + '" aria-pressed="' + ((state.draft.interests || []).map(normalizeCategory).includes(id)) + '"><b aria-hidden="true">' + icon + '</b><small>' + label + '</small></button>').join('') + '</div>' + selectedSummary + '<label class="place-search" for="place-search"><span aria-hidden="true">⌕</span><span class="sr-only">Tìm địa điểm</span><input id="place-search" type="search" data-place-search value="' + escapeHtml(state.placeSearch) + '" placeholder="Tìm theo tên hoặc khu vực"></label><div class="place-picker"><div class="recommendation-note">' + candidates.length + ' / ' + all.length + ' địa điểm phù hợp tại ' + escapeHtml(destination(state.draft.destinationId)?.name) + '</div>' + resultHtml + '</div></div>';
}

function platformLabel(value) {
  return ({ tiktok: 'TikTok', youtube: 'YouTube', instagram: 'Instagram', google_maps: 'Google Maps', other: 'Link du lịch' }[value] || 'Link du lịch');
}

function isSupportedUrlShape(value) {
  try {
    const url = new URL(String(value || '').trim());
    return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname);
  } catch { return false; }
}

function renderInspirationStep() {
  const result = state.inspirationResolution;
  const selectedIds = state.draft.selectedPlaceIds || [];
  const inspirationItems = state.draft.inspirationItems || [];
  let resultHtml = '';
  if (result?.status === 'loading') resultHtml = '<div class="inspiration-status is-loading" role="status">Đang tìm địa điểm…</div>';
  if (result?.status === 'unsupported') resultHtml = '<div class="inspiration-status is-neutral" role="status"><strong>Chưa tìm thấy địa điểm từ liên kết này.</strong><span>Kiểm tra lại liên kết hoặc thử một liên kết khác.</span></div>';
  if (result?.status === 'error') resultHtml = '<div class="inspiration-status is-error" role="alert">' + escapeHtml(result.message) + '</div>';
  if (result?.status === 'unavailable') resultHtml = '<div class="inspiration-status is-neutral" role="status"><strong>Đã tìm thấy ' + escapeHtml(result.resolved?.name || 'địa điểm này') + '.</strong><span>Địa điểm này hiện chưa khả dụng để thêm vào chuyến đi.</span></div>';
  if (result?.status === 'mismatch') resultHtml = '<div class="inspiration-status is-mismatch" role="status"><strong>' + escapeHtml(result.place?.name || 'Địa điểm này') + ' thuộc ' + escapeHtml(result.destination?.name || result.destination?.province || 'điểm đến khác') + '.</strong><span>Địa điểm này không nằm trong điểm đến hiện tại của chuyến đi, nên chưa thể thêm vào lịch trình.</span></div>';
  if (result?.status === 'matched') {
    const item = result.place;
    const rating = ratingSummaryFor(item.id);
    const alreadyAdded = inspirationItems.some((entry) => entry.placeId === item.id);
    const alreadySelected = selectedIds.includes(item.id);
    const label = placeCategories(item).map((category) => categoryLabels[category] || category).join(' · ');
    resultHtml = '<article class="inspiration-match"><div class="inspiration-match-image" style="background-image:url(' + escapeHtml(item.image) + ')"></div><div class="inspiration-match-copy"><span class="inspiration-platform">' + escapeHtml(platformLabel(result.mapping?.platform)) + '</span><h4>' + escapeHtml(item.name) + '</h4><p>' + escapeHtml(result.destination?.name || item.areaLabel || '') + ' · ' + escapeHtml(label) + '</p><small>' + escapeHtml(ratingText(rating)) + '</small><p class="inspiration-match-note">' + (alreadyAdded || alreadySelected ? 'Địa điểm này đã có trong chuyến đi của bạn.' : 'Đã tìm thấy địa điểm cho chuyến đi của bạn.') + '</p><button class="button button-primary button-small" type="button" data-action="add-inspiration" ' + (alreadyAdded || alreadySelected ? 'disabled' : '') + '>' + (alreadyAdded || alreadySelected ? '✓ Đã chọn' : 'Thêm vào chuyến đi') + '</button></div></article>';
  }
  const added = inspirationItems.map((entry) => {
    const item = place(entry.placeId);
    return item ? '<li><span><strong>' + escapeHtml(item.name) + '</strong><small>' + escapeHtml(platformLabel(entry.platform)) + ' · thêm từ link</small></span><button type="button" class="text-button" data-action="remove-inspiration" data-id="' + escapeHtml(entry.mappingId) + '" aria-label="Xóa ' + escapeHtml(item.name) + ' khỏi danh sách cảm hứng">Xóa</button></li>' : '';
  }).join('');
  const addedHtml = inspirationItems.length ? '<section class="inspiration-added" aria-labelledby="inspiration-added-heading"><div><span class="kicker">ĐÃ THÊM TỪ LINK · ' + inspirationItems.length + '</span><h4 id="inspiration-added-heading">Nơi bạn muốn ghé</h4></div><ul>' + added + '</ul></section>' : '';
  const canResolve = isSupportedUrlShape(state.inspirationInput);
  const inlineError = state.inspirationInput && !canResolve ? 'Vui lòng dán một đường link hợp lệ.' : '';
  return '<div class="step-panel inspiration-panel"><div class="inspiration-heading"><span class="kicker">TÙY CHỌN</span><h3>Thêm nơi bạn muốn ghé</h3><p>Dán liên kết từ TikTok, YouTube, Instagram hoặc Google Maps để tìm địa điểm cho chuyến đi.</p></div><form class="inspiration-form" data-form="inspiration" novalidate><label class="field" for="inspiration-url"><span>Dán liên kết</span><input id="inspiration-url" name="url" type="text" inputmode="url" autocomplete="url" value="' + escapeHtml(state.inspirationInput) + '" placeholder="Dán liên kết tại đây…" data-inspiration-url aria-describedby="inspiration-help inspiration-validation inspiration-result"></label><button class="button button-primary" type="submit" data-inspiration-submit ' + (canResolve ? '' : 'disabled') + '>Tìm địa điểm <span>→</span></button></form><p class="inspiration-validation" id="inspiration-validation" role="alert" ' + (inlineError ? '' : 'hidden') + '>' + inlineError + '</p><p class="inspiration-help" id="inspiration-help">Bạn có thể tiếp tục bất cứ lúc nào mà không cần thêm liên kết.</p><div id="inspiration-result">' + resultHtml + '</div>' + addedHtml + '</div>';
}

function timeToMinutes(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
}

function minutesToTime(total) {
  return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
}

function updateItemField(item, field, value) {
  if (field === 'startTime' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value))) return;
  item[field] = field === 'durationMinutes' ? Math.max(30, Number(value) || 30) : value;
  if (field === 'startTime' || field === 'durationMinutes') item.endTime = minutesToTime(timeToMinutes(item.startTime) + (Number(item.durationMinutes) || 120));
}

function editorDay(day, dayIndex) {
  const summary = summarizeDay(day);
  const items = summary.items;
  const compact = state.itineraryView === 'compact';
  const itemHtml = items.map((item, index) => {
    if (compact) return '<div class="timeline-item compact-item' + (index < items.length - 1 ? ' has-next' : '') + '">' + timelineTime(item) + '<div class="timeline-rail" aria-hidden="true"><span></span></div><div class="timeline-item-copy"><strong>' + escapeHtml(item.title) + '</strong><small>' + escapeHtml(item.areaLabel || categoryLabels[item.category] || 'Điểm dừng') + ' · ' + item.durationMinutes + ' phút</small></div>' + timelineGap(item, items[index + 1]) + '</div>';
    const dayOptions = (state.generated?.itinerary || []).map((entry, targetIndex) => '<option value="' + targetIndex + '" ' + (targetIndex === dayIndex ? 'selected' : '') + '>Ngày ' + (targetIndex + 1) + '</option>').join('');
    return '<div class="timeline-item editable-item' + (index < items.length - 1 ? ' has-next' : '') + '" data-day="' + dayIndex + '" data-index="' + index + '">' + timelineTime(item, { editable: true, dayIndex }) + '<div class="timeline-rail" aria-hidden="true"><span></span></div><div class="timeline-item-copy"><strong>' + escapeHtml(item.title) + '</strong><small>' + escapeHtml(categoryLabels[item.category] || item.category || 'Điểm dừng') + (item.areaLabel ? ' · ' + escapeHtml(item.areaLabel) : '') + ' · ' + money(item.estimatedCost) + '/người</small><label class="duration-control">Thời lượng <input class="duration-input" type="number" min="30" step="15" data-item-field="durationMinutes" data-day="' + dayIndex + '" data-item="' + item.id + '" value="' + item.durationMinutes + '" aria-label="Thời lượng ' + escapeHtml(item.title) + '"> phút</label></div><div class="timeline-controls"><button class="icon-button" type="button" data-action="move-item" data-day="' + dayIndex + '" data-index="' + index + '" data-direction="up" aria-label="Đưa ' + escapeHtml(item.title) + ' lên">↑</button><button class="icon-button" type="button" data-action="move-item" data-day="' + dayIndex + '" data-index="' + index + '" data-direction="down" aria-label="Đưa ' + escapeHtml(item.title) + ' xuống">↓</button><select class="move-select" data-action="move-item-to-day" data-day="' + dayIndex + '" data-index="' + index + '" aria-label="Di chuyển ' + escapeHtml(item.title) + ' sang ngày khác"><option value="">Di chuyển đến…</option>' + dayOptions + '</select><button class="icon-button" type="button" data-action="remove-item" data-day="' + dayIndex + '" data-index="' + index + '" aria-label="Xóa ' + escapeHtml(item.title) + '">×</button></div>' + timelineGap(item, items[index + 1]) + '</div>';
  }).join('');
  return '<section class="timeline-day editable-day' + (compact ? ' is-compact' : '') + '" id="editor-day-' + dayIndex + '" data-itinerary-day="' + dayIndex + '" data-drop-day="' + dayIndex + '"><h4>NGÀY ' + (dayIndex + 1) + ' · ' + formatDate(day.date) + '</h4>' + renderDaySummary(summary) + (itemHtml || '<p class="empty-day-message">Chuyển một hoạt động từ ngày khác để bắt đầu.</p>') + (compact && items.length ? '<p class="compact-day-hint">Chuyển sang Chi tiết để đổi giờ, thời lượng hoặc thứ tự.</p>' : '') + '</section>';
}

function renderPlanner() {
  const target = $('#planner-card');
  if (state.route.view === 'edit' && state.routeStatus === 'loading') {
    target.innerHTML = '<div class="planner-invite"><div><div class="kicker">ĐANG MỞ BẢN NHÁP</div><h3>PinkTrip đang chuẩn bị lịch trình của bạn.</h3></div></div>';
    return;
  }
  if (!state.plannerOpen) {
    target.innerHTML = '<div class="planner-invite"><div><div class="kicker">SẴN SÀNG CHƯA?</div><h3>Hãy để chuyến đi bắt đầu từ một ý thích.</h3><p>Chọn điểm đến, ngày đi và nhịp độ. PinkTrip sẽ tạo cho bạn một bản nháp để tiếp tục chỉnh sửa.</p></div><button class="button button-primary" data-action="new-trip">Bắt đầu <span>↗</span></button></div>';
    return;
  }
  const nav = '<div class="planner-steps">' + ['Thông tin', 'Điểm đến', 'Cảm hứng', 'Lịch trình'].map((item, index) => '<span class="planner-step ' + (index === state.step ? 'active ' : '') + (index < state.step ? 'done' : '') + '">' + String(index + 1).padStart(2, '0') + ' ' + item + '</span>').join('') + '</div>';
  let content = '';
  if (state.step === 0) {
    content = renderStepOne();
  } else if (state.step === 1) {
    content = renderStepTwo();
  } else if (state.step === 2) {
    content = renderInspirationStep();
  } else if (state.step === 3 && state.generated) {
    const other = state.places.filter((item) => item.destinationId === state.generated.destination.id && !(state.draft.selectedPlaceIds || []).includes(item.id)).slice(0, 3);
    content = '<div class="step-panel itinerary-editor-panel">' + renderItineraryOverview({ destination: state.generated.destination, startDate: state.draft.startDate, endDate: state.draft.endDate, travelers: state.draft.travelers, intensity: state.draft.intensity, budget: state.generated.budget, days: state.generated.itinerary, workspace: 'editor', editable: true }) + renderDayNavigator(state.generated.itinerary, 'editor') + renderItineraryActions() + '<div class="editor-toolbar"><div><strong>' + (state.itineraryView === 'compact' ? 'Tóm tắt lịch trình' : 'Chỉnh sửa lịch trình') + '</strong><span>' + (state.itineraryView === 'compact' ? 'Xem nhịp di chuyển trong ngày. Chuyển sang Chi tiết khi cần chỉnh sửa.' : 'Chọn ngày đích để di chuyển, hoặc dùng ↑ ↓ để đổi thứ tự.') + '</span></div></div><div class="result-grid"><div><div class="timeline-list">' + state.generated.itinerary.map(editorDay).join('') + '</div><section class="add-stop-section"><h4>Muốn thêm một điểm dừng?</h4><p>Thêm vào lựa chọn rồi PinkTrip sẽ xếp lại bản nháp.</p><div class="place-picker">' + other.map((item) => pickerCard(item, 'add-stop')).join('') + '</div></section></div>' + renderBudget(state.generated.budget, state.draft.targetBudget, state.generated.itinerary.length) + '</div></div>';
  }
  const nextLabel = state.step === 2 ? 'Tiếp tục không thêm link' : state.step === 1 ? 'Tiếp tục' : 'Tiếp tục';
  const footerActions = state.step === 3
    ? ''
    : '<button class="button button-primary button-small" type="button" data-action="next-step">' + nextLabel + ' <span>→</span></button>';
  target.innerHTML = nav + content + '<div class="planner-actions"><button class="button button-ghost button-small" type="button" data-action="prev-step" ' + (state.step === 0 ? 'disabled' : '') + '>← Quay lại</button><div>' + footerActions + '</div></div>';
}

function renderRouteVisibility() {
  const landing = $('#landing-content');
  const active = ['home', 'new', 'edit'].includes(state.route.view);
  landing.classList.toggle('hidden', !active);
  landing.classList.toggle('editor-route', ['new', 'edit'].includes(state.route.view));
  $('#dashboard').classList.toggle('hidden', state.route.view !== 'dashboard');
  $('#trips-view').classList.toggle('hidden', !['trips', 'detail'].includes(state.route.view));
  $('#reviews-view').classList.toggle('hidden', state.route.view !== 'reviews');
}

function render() {
  renderRouteVisibility();
  renderNavigation();
  renderAccount();
  renderDestinations();
  renderPlanner();
  renderServices();
  renderReviews();
  if (state.route.view === 'dashboard') renderDashboardOverview();
  if (state.route.view === 'trips') renderTripsPage();
  if (state.route.view === 'detail') renderTripDetail();
  if (state.route.view === 'reviews') renderReviewPage();
  if (state.replanOpen) renderReplanModal();
  if (state.resetConfirmOpen) renderResetConfirmation();
  if (state.reviewModalOpen) renderReviewModal();
  if (state.reviewDetail) renderPlaceReviewModal();
}

function setMenu(open, trigger) {
  const menu = $('#mobile-nav');
  const toggle = $('.menu-toggle');
  if (open) {
    lastMenuTrigger = trigger || document.activeElement;
    menu.classList.add('is-open');
    menu.setAttribute('aria-hidden', 'false');
    toggle.setAttribute('aria-expanded', 'true');
    document.body.classList.add('menu-open');
    requestAnimationFrame(() => menu.querySelector('.mobile-nav-links a, .mobile-nav-links button, .menu-close')?.focus());
  } else {
    menu.classList.remove('is-open');
    menu.setAttribute('aria-hidden', 'true');
    toggle.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('menu-open');
    if (lastMenuTrigger instanceof HTMLElement) lastMenuTrigger.focus();
  }
}

function openAuth(mode) {
  const login = mode === 'login';
  lastAuthTrigger = document.activeElement;
  lastModalTrigger = lastAuthTrigger;
  $('#modal-root').innerHTML = '<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="auth-title"><button class="modal-close" type="button" data-action="close-modal" aria-label="Đóng cửa sổ">×</button><div class="kicker">PINKTRIP</div><h2 id="auth-title">' + (login ? 'Chào mừng trở lại.' : 'Bắt đầu hành trình.') + '</h2><p>' + (login ? 'Đăng nhập để xem những chuyến đi đã lưu.' : 'Tạo tài khoản để lưu lịch trình của riêng bạn.') + '</p><form data-form="auth"><input type="hidden" name="mode" value="' + mode + '">' + (login ? '' : '<div class="field"><label for="auth-name">Tên của bạn</label><input id="auth-name" name="name" required autocomplete="name" placeholder="Ví dụ: Minh Anh"></div>') + '<div class="field"><label for="auth-email">Email</label><input id="auth-email" name="email" type="email" required autocomplete="email" placeholder="you@example.com"></div><div class="field"><label for="auth-password">Mật khẩu</label><input id="auth-password" name="password" minlength="8" type="password" required autocomplete="' + (login ? 'current-password' : 'new-password') + '" placeholder="Tối thiểu 8 ký tự"></div><div class="error-message" data-auth-error aria-live="polite"></div><button class="button button-primary" type="submit" style="width:100%">' + (login ? 'Đăng nhập' : 'Tạo tài khoản') + ' <span>↗</span></button></form><div class="modal-switch">' + (login ? 'Chưa có tài khoản?' : 'Đã có tài khoản?') + ' <button type="button" data-action="' + (login ? 'register' : 'login') + '">' + (login ? 'Đăng ký' : 'Đăng nhập') + '</button></div></section></div>';
  requestAnimationFrame(() => $('#modal-root input:not([type="hidden"])')?.focus());
}

function loadPlanIntoEditor(plan) {
  state.editingPlanId = plan.id;
  state.plannerOpen = true;
  state.step = 3;
  state.draft = { title: plan.title, destinationId: plan.destinationId, startDate: plan.startDate, endDate: plan.endDate, travelers: plan.travelers, targetBudget: plan.targetBudget, accommodationLevel: plan.accommodationLevel || 'comfort', intensity: plan.intensity || 'balanced', interests: plan.interests || [], selectedPlaceIds: plan.selectedPlaceIds || [], stepTwoPlaceIds: (plan.selectedPlaceIds || []).filter((id) => !(plan.inspirationItems || []).some((item) => item.placeId === id)), inspirationItems: plan.inspirationItems || [] };
  syncBudgetInput(state.draft.targetBudget);
  state.datePickerOpen = false;
  state.datePickerMonth = state.draft.startDate;
  state.generated = { destination: plan.destination, itinerary: clone(plan.days || []), budget: clone(plan.budget || {}) };
  establishItineraryBaseline({ itinerary: plan.days || [], budget: plan.budget || {} });
  state.generatedSignature = draftSignature();
  state.placeSearch = '';
  state.placeVisibleCount = 12;
  state.inspirationResolution = null;
  state.inspirationInput = '';
  state.itineraryView = 'detailed';
  state.activeItineraryDay = 0;
}

async function applyRoute({ scroll = true } = {}) {
  const route = parseRoute();
  if (isProtected(route) && !state.user) {
    state.pendingPath = window.location.pathname;
    history.replaceState({}, '', '/');
    state.route = { view: 'home' };
    render();
    openAuth('login');
    return;
  }
  const previous = state.route;
  state.route = route;
  state.activeTrip = null;
  if (route.view === 'detail' || route.view === 'edit') {
    state.routeStatus = 'loading';
    render();
    try {
      const result = await api('/api/plans/' + encodeURIComponent(route.planId));
      const expected = route.view === 'edit' ? '/trips/' + encodeURIComponent(route.planId) + '/edit' : '/trips/' + encodeURIComponent(route.planId);
      if (window.location.pathname !== expected) return;
      state.activeTrip = result.plan;
      if (route.view === 'edit') loadPlanIntoEditor(result.plan);
      state.routeStatus = 'ready';
    } catch {
      state.routeStatus = 'error';
      if (route.view === 'edit') {
        history.replaceState({}, '', '/trips');
        state.route = { view: 'trips' };
      }
    }
  } else if (route.view === 'reviews') {
    state.routeStatus = 'ready';
    state.plannerOpen = false;
    state.reviewDetail = null;
    await loadReviewBrowse(route.reviewFilters);
  } else {
    state.routeStatus = 'ready';
    if (route.view === 'new') {
      state.plannerOpen = true;
      state.editingPlanId = null;
      if (previous.view !== 'new' && !state.draft.destinationId) { state.draft = defaultDraft(); syncBudgetInput(state.draft.targetBudget); }
    } else if (route.view === 'home') {
      state.plannerOpen = false;
      state.generated = null;
      state.generatedSignature = null;
      state.editingPlanId = null;
    } else {
      state.plannerOpen = false;
    }
  }
  render();
  if (scroll) requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

function navigate(path, options = {}) {
  if (window.location.pathname !== path) history[options.replace ? 'replaceState' : 'pushState']({}, '', path);
  return applyRoute(options);
}

async function generate() {
  try {
    state.generated = await api('/api/plans/generate', { method: 'POST', body: state.draft });
    establishItineraryBaseline();
    state.generatedSignature = draftSignature();
    render();
  } catch (error) {
    toast(error.message);
  }
}

function startNewTrip(id) {
  if (!state.user) {
    openAuth('register');
    return;
  }
  state.plannerOpen = true;
  state.step = 0;
  state.editingPlanId = null;
  state.generated = null;
  state.itineraryBaseline = null;
  state.generatedSignature = null;
  state.draft = defaultDraft(id);
  syncBudgetInput(state.draft.targetBudget);
  state.datePickerOpen = false;
  state.datePickerMonth = state.draft.startDate;
  state.placeSearch = '';
  state.placeVisibleCount = 12;
  state.inspirationResolution = null;
  state.inspirationInput = '';
  state.itineraryView = 'detailed';
  state.activeItineraryDay = 0;
  navigate('/trips/new', { scroll: false });
  requestAnimationFrame(() => $('#planner').scrollIntoView({ behavior: 'smooth' }));
}

async function persistCurrentPlan() {
  const payload = { ...state.draft, days: clone(state.generated.itinerary), budget: clone(state.generated.budget), regenerate: false };
  const result = state.editingPlanId
    ? await api('/api/plans/' + encodeURIComponent(state.editingPlanId), { method: 'PUT', body: payload })
    : await api('/api/plans', { method: 'POST', body: payload });
  state.activeTrip = result.plan;
  state.generated.itinerary = clone(result.plan.days || []);
  state.generated.budget = clone(result.plan.budget || {});
  establishItineraryBaseline({ itinerary: result.plan.days || [], budget: result.plan.budget || {} });
  await refreshPlans();
  return result.plan;
}

async function savePlan() {
  if (!state.generated?.itinerary) return toast('Hãy tạo lịch trình trước khi lưu');
  try {
    const plan = await persistCurrentPlan();
    state.plannerOpen = false;
    state.editingPlanId = null;
    state.replanOpen = false;
    $('#modal-root').innerHTML = '';
    toast('Đã lưu chuyến đi của bạn ✦');
    await navigate('/trips/' + encodeURIComponent(plan.id));
  } catch (error) {
    toast(error.message);
  }
}

function jumpToItineraryDay(workspace, dayIndex) {
  state.activeItineraryDay = Math.max(0, Number(dayIndex) || 0);
  const selector = '#' + workspace + '-day-' + state.activeItineraryDay;
  render();
  requestAnimationFrame(() => document.querySelector(selector)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

function jumpToItineraryOverview(workspace) {
  state.activeItineraryDay = 0;
  render();
  requestAnimationFrame(() => document.querySelector('#' + workspace + '-overview')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

function syncActiveItineraryDay() {
  itineraryScrollFrame = null;
  const workspace = ['edit', 'new'].includes(state.route.view) ? 'editor' : 'detail';
  const days = [...document.querySelectorAll('[data-itinerary-day][id^="' + workspace + '-day-"]')];
  if (!days.length) return;
  const marker = 180;
  const atDocumentEnd = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 8;
  const current = atDocumentEnd ? days[days.length - 1] : days.reduce((closest, day) => {
    const top = day.getBoundingClientRect().top;
    if (top <= marker) return day;
    return closest || day;
  }, null);
  const next = Number(current?.dataset.itineraryDay);
  if (!Number.isInteger(next) || next === state.activeItineraryDay) return;
  state.activeItineraryDay = next;
  document.querySelectorAll('[data-action="jump-itinerary-day"]').forEach((button) => {
    if (Number(button.dataset.dayIndex) !== next) return;
    button.classList.add('active');
    button.setAttribute('aria-current', 'step');
  });
  document.querySelectorAll('[data-action="jump-itinerary-day"]').forEach((button) => {
    if (Number(button.dataset.dayIndex) === next) return;
    button.classList.remove('active');
    button.setAttribute('aria-current', 'false');
  });
}

function scheduleItineraryScrollSync() {
  if (itineraryScrollFrame !== null) return;
  itineraryScrollFrame = requestAnimationFrame(syncActiveItineraryDay);
}

function renderResetConfirmation() {
  $('#modal-root').innerHTML = '<div class="modal-backdrop"><section class="modal reset-modal" role="dialog" aria-modal="true" aria-labelledby="reset-itinerary-title" aria-describedby="reset-itinerary-description"><button class="modal-close" type="button" data-action="cancel-reset-itinerary" aria-label="Đóng cửa sổ">×</button><div class="kicker">HOÀN TÁC CHỈNH SỬA</div><h2 id="reset-itinerary-title">Đặt lại lịch trình?</h2><p id="reset-itinerary-description">Những thay đổi chưa lưu về giờ, thời lượng, thứ tự và ngày sẽ được hoàn tác. Lịch trình trở về phiên bản đã lưu gần nhất.</p><div class="modal-actions"><button class="button button-ghost" type="button" data-action="cancel-reset-itinerary">Hủy</button><button class="button button-primary" type="button" data-action="confirm-reset-itinerary">Đặt lại</button></div></section></div>';
  requestAnimationFrame(() => $('[data-action="confirm-reset-itinerary"]')?.focus());
}

function openResetConfirmation() {
  if (!state.generated?.itinerary || !state.itineraryBaseline) return toast('Chưa có phiên bản lịch trình để khôi phục');
  lastModalTrigger = document.activeElement;
  state.resetConfirmOpen = true;
  renderResetConfirmation();
}

function closeResetConfirmation(restoreFocus = true) {
  state.resetConfirmOpen = false;
  $('#modal-root').innerHTML = '';
  if (restoreFocus && lastModalTrigger instanceof HTMLElement) lastModalTrigger.focus();
}

function confirmResetItinerary() {
  const restored = window.PinkTripItineraryState.restoreBaseline(state.itineraryBaseline);
  if (!restored || !state.generated) return closeResetConfirmation();
  clearTimeout(itineraryNormalizeTimer);
  itineraryMutationVersion += 1;
  const activeDay = Math.min(Math.max(0, state.activeItineraryDay), Math.max(0, restored.itinerary.length - 1));
  state.generated.itinerary = restored.itinerary;
  state.generated.budget = restored.budget;
  state.activeItineraryDay = activeDay;
  closeResetConfirmation(false);
  renderPlanner();
  requestAnimationFrame(() => {
    document.querySelector('.itinerary-editor-panel [data-action="reset-itinerary"]')?.focus();
    document.querySelector('#editor-day-' + activeDay)?.scrollIntoView({ block: 'nearest' });
  });
  toast('Đã khôi phục lịch trình đã lưu.');
}

async function deletePlan(id) {
  const plan = state.plans.find((item) => item.id === id) || state.activeTrip;
  if (!window.confirm('Xóa “' + (plan?.title || 'chuyến đi này') + '”?')) return;
  try {
    await api('/api/plans/' + encodeURIComponent(id), { method: 'DELETE' });
    await refreshPlans();
    toast('Đã xóa chuyến đi');
    if (state.route.view === 'detail') await navigate('/trips');
    else render();
  } catch (error) {
    toast(error.message);
  }
}

function moveCandidate(fromDay, index, toDay, toIndex = null) {
  const candidate = clone(state.generated.itinerary);
  const source = candidate[Number(fromDay)];
  const target = candidate[Number(toDay)];
  if (!source || !target || !source.items[Number(index)]) return candidate;
  const item = source.items.splice(Number(index), 1)[0];
  let insertion = toIndex === null ? target.items.length : Number(toIndex);
  insertion = Math.max(0, Math.min(insertion, target.items.length));
  target.items.splice(insertion, 0, item);
  return candidate;
}

async function normalizeEditor(candidate, selectedIds = state.draft.selectedPlaceIds) {
  const requestVersion = ++itineraryMutationVersion;
  const result = await api('/api/plans/recalculate', {
    method: 'POST',
    body: { itinerary: candidate, ...state.draft, selectedPlaceIds: selectedIds }
  });
  if (requestVersion !== itineraryMutationVersion) return;
  state.generated.itinerary = result.itinerary;
  state.generated.budget = result.budget;
  renderPlanner();
}

function scheduleEditorNormalization(delay = 300) {
  clearTimeout(itineraryNormalizeTimer);
  itineraryNormalizeTimer = setTimeout(() => {
    itineraryNormalizeTimer = null;
    if (!state.generated?.itinerary) return;
    normalizeEditor(clone(state.generated.itinerary)).catch((error) => toast(error.message));
  }, delay);
}

async function moveItem(fromDay, index, toDay, toIndex = null) {
  try {
    await normalizeEditor(moveCandidate(fromDay, index, toDay, toIndex));
  } catch (error) {
    toast(error.message);
  }
}

function replanTypes() {
  return [['late-start', 'Bắt đầu muộn'], ['bad-weather', 'Thời tiết xấu'], ['place-unavailable', 'Địa điểm đóng cửa'], ['transport-delay', 'Di chuyển bị trễ'], ['activity-overrun', 'Hoạt động kéo dài hơn dự kiến'], ['rest', 'Muốn nghỉ thêm'], ['skip', 'Bỏ qua địa điểm'], ['other', 'Khác']];
}

function currentItems() {
  return (state.generated?.itinerary || []).flatMap((day, dayIndex) => (day.items || []).map((item) => ({ item, dayIndex })));
}

function defaultReplanDraft() {
  const first = currentItems()[0];
  return { type: 'late-start', dayIndex: first?.dayIndex || 0, availableFrom: '11:00', delayMinutes: 60, itemId: first?.item.id || '', completedItemIds: [] };
}

function replanOptions() {
  const draft = state.replanDraft;
  const options = draft.type === 'late-start' || draft.type === 'rest' || draft.type === 'activity-overrun'
    ? '<div class="field"><label for="replan-time">Có thể tiếp tục từ</label><input id="replan-time" type="time" data-replan-field="availableFrom" value="' + escapeHtml(draft.availableFrom || '11:00') + '" required><small class="field-hint">Các hoạt động sau thời điểm này sẽ được sắp xếp lại.</small></div>'
    : '';
  const delay = draft.type === 'transport-delay' ? '<div class="field"><label for="replan-delay">Trễ khoảng bao lâu?</label><input id="replan-delay" type="number" min="15" step="15" data-replan-field="delayMinutes" value="' + (draft.delayMinutes || 60) + '" required><small class="field-hint">Số phút chậm trễ sẽ được cộng vào ngày bị ảnh hưởng.</small></div>' : '';
  const item = ['place-unavailable', 'skip'].includes(draft.type)
    ? '<div class="field"><label for="replan-item">Địa điểm bị ảnh hưởng</label><select id="replan-item" data-replan-field="itemId" required><option value="">Chọn một địa điểm</option>' + currentItems().map(({ item: entry, dayIndex }) => '<option value="' + entry.id + '" ' + (entry.id === draft.itemId ? 'selected' : '') + '>' + escapeHtml(entry.title) + ' · Ngày ' + (dayIndex + 1) + '</option>').join('') + '</select></div>'
    : '';
  return options + delay + item;
}

function replanCompletedItems() {
  const items = currentItems();
  return items.length ? '<fieldset class="completed-list" aria-describedby="completed-activities-hint"><legend><span class="replan-section-index" aria-hidden="true">1</span>Hoạt động đã hoàn thành</legend><p class="completed-list-hint" id="completed-activities-hint">Chọn những hoạt động bạn đã hoàn thành. PinkTrip sẽ giữ nguyên chúng khi điều chỉnh lịch trình.</p><div>' + items.map(({ item }) => '<label class="completed-row" for="replan-completed-' + escapeHtml(item.id) + '"><input id="replan-completed-' + escapeHtml(item.id) + '" type="checkbox" data-replan-completed="' + escapeHtml(item.id) + '" ' + (state.replanDraft.completedItemIds.includes(item.id) ? 'checked' : '') + '><span class="completed-row-copy"><span class="completed-row-title">' + escapeHtml(item.title) + '</span><span class="completed-row-note">Được giữ nguyên</span></span></label>').join('') + '</div></fieldset>' : '';
}

function renderReplanModal() {
  if (!state.replanOpen) return;
  const draft = state.replanDraft || defaultReplanDraft();
  state.replanDraft = draft;
  const typeOptions = replanTypes().map(([id, label]) => '<option value="' + id + '" ' + (draft.type === id ? 'selected' : '') + '>' + label + '</option>').join('');
  let body = '<form data-form="replan">' + replanCompletedItems() + '<section class="replan-disruption" aria-labelledby="replan-disruption-heading"><div class="replan-section-heading"><span class="replan-section-index" aria-hidden="true">2</span><h3 id="replan-disruption-heading">Điều gì đã thay đổi?</h3></div><p class="replan-section-hint">Thông tin này giúp PinkTrip sắp xếp lại phần lịch trình còn lại.</p><div class="field"><label for="replan-type">Thay đổi</label><select id="replan-type" data-replan-field="type">' + typeOptions + '</select></div><div class="field"><label for="replan-day">Ngày bị ảnh hưởng</label><select id="replan-day" data-replan-field="dayIndex">' + (state.generated?.itinerary || []).map((day, index) => '<option value="' + index + '" ' + (index === Number(draft.dayIndex) ? 'selected' : '') + '>Ngày ' + (index + 1) + ' · ' + formatDate(day.date) + '</option>').join('') + '</select></div>' + replanOptions() + '</section><div class="field"><label for="replan-note">Ghi chú thêm <span class="optional">(không bắt buộc)</span></label><textarea id="replan-note" data-replan-field="note" placeholder="Ví dụ: Ưu tiên nghỉ ngơi và tránh di chuyển xa"></textarea></div><div class="error-message" id="replan-error" aria-live="polite"></div><button class="button button-primary" type="submit">Tạo phương án mới <span>↗</span></button></form>';
  if (state.replanPreview) {
    const changes = state.replanPreview.changes || [];
    const protectedItems = currentItems().filter(({ item }) => draft.completedItemIds.includes(item.id));
    const protectedIds = new Set(protectedItems.map(({ item }) => item.id));
    const protectedSummary = protectedItems.length ? '<section class="protected-summary" aria-labelledby="protected-summary-heading"><div><span class="protected-summary-icon" aria-hidden="true">✓</span><h3 id="protected-summary-heading">Được giữ nguyên</h3></div><p>' + protectedItems.map(({ item }) => escapeHtml(item.title)).join(' · ') + '</p></section>' : '';
    body = '<div class="replan-preview"><div class="preview-intro"><strong>Phương án dựa trên lịch trình hiện tại</strong><span>PinkTrip giữ nguyên những hoạt động đã hoàn thành và chỉ sắp xếp phần còn lại.</span></div>' + protectedSummary + '<div class="change-summary"><h3>Thay đổi dự kiến</h3>' + changes.map((change) => '<div class="change-row"><span class="change-icon" aria-hidden="true">' + (change.kind === 'removed' ? '!' : change.kind === 'moved' ? '↗' : change.kind === 'time' ? '◷' : '✓') + '</span><span>' + escapeHtml(change.title) + ': ' + (change.kind === 'removed' ? (change.reason === 'unavailable' ? 'địa điểm không còn hoạt động' : change.reason === 'skipped' ? 'bỏ qua theo yêu cầu' : 'chưa có chỗ phù hợp') : change.kind === 'moved' ? 'Ngày ' + (change.fromDay + 1) + ' → Ngày ' + (change.toDay + 1) : change.kind === 'time' ? (change.fromTime || '') + ' → ' + change.toTime : 'giữ nguyên') + '</span></div>').join('') + '</div><div class="preview-budget"><span>Ngân sách dự kiến sau điều chỉnh</span><strong>' + money(state.replanPreview.budget?.total) + '</strong><small>' + money(state.replanPreview.budget?.perPerson) + ' mỗi người</small></div><div class="preview-itinerary"><h3>Lịch trình xem trước</h3>' + (state.replanPreview.days || []).map((day, index) => readonlyDay(day, index, protectedIds)).join('') + '</div><div class="preview-actions"><button class="button button-ghost" type="button" data-action="cancel-replan">Giữ lịch trình hiện tại</button><button class="button button-primary" type="button" data-action="apply-replan">Áp dụng lịch trình mới</button></div></div>';
  }
  $('#modal-root').innerHTML = '<div class="modal-backdrop replan-backdrop"><section class="modal replan-modal" role="dialog" aria-modal="true" aria-labelledby="replan-title"><button class="modal-close" type="button" data-action="close-replan" aria-label="Đóng cửa sổ">×</button><div class="kicker">ĐIỀU CHỈNH LỊCH TRÌNH</div><h2 id="replan-title">Có thay đổi trong chuyến đi?</h2><p>' + (state.replanPreview ? 'Xem lại đề xuất trước khi áp dụng vào lịch trình hiện tại.' : 'Cho PinkTrip biết điều gì xảy ra. Phương án sẽ chỉ thay đổi phần còn lại.') + '</p>' + body + '</section></div>';
}

function openReplan() {
  lastModalTrigger = document.activeElement;
  state.replanOpen = true;
  state.replanPreview = null;
  state.replanDraft = defaultReplanDraft();
  renderReplanModal();
  requestAnimationFrame(() => $('#replan-type')?.focus());
}

function closeReplan(restoreFocus = true) {
  state.replanOpen = false;
  state.replanPreview = null;
  state.replanDraft = null;
  $('#modal-root').innerHTML = '';
  if (restoreFocus && lastModalTrigger instanceof HTMLElement) lastModalTrigger.focus();
}

async function submitReplan() {
  try {
    const result = await api('/api/plans/replan', {
      method: 'POST',
      body: { planId: state.editingPlanId || undefined, currentItinerary: clone(state.generated.itinerary), ...state.draft, disruption: state.replanDraft }
    });
    state.replanPreview = result;
    renderReplanModal();
    requestAnimationFrame(() => $('.preview-actions button')?.focus());
  } catch (error) {
    const errorBox = $('#replan-error');
    if (errorBox) errorBox.textContent = error.message;
    else toast(error.message);
  }
}

async function applyReplan() {
  const preview = state.replanPreview;
  if (!preview) return;
  state.generated.itinerary = clone(preview.days);
  state.generated.budget = clone(preview.budget);
  state.draft.selectedPlaceIds = [...(preview.selectedPlaceIds || state.draft.selectedPlaceIds)];
  const shouldPersist = Boolean(state.editingPlanId);
  closeReplan(false);
  if (shouldPersist) {
    try {
      await persistCurrentPlan();
      toast('Đã áp dụng và lưu lịch trình mới ✦');
    } catch (error) {
      toast(error.message);
    }
  } else {
    toast('Đã áp dụng vào bản nháp. Hãy bấm Lưu chuyến đi để lưu lại.');
  }
  renderPlanner();
}

async function handleAction(target) {
  const action = target.dataset.action;
  if (action === 'open-date-picker') return openDatePicker(target.dataset.dateRole);
  if (action === 'close-date-picker') return closeDatePicker(true);
  if (action === 'select-date') return selectDate(target.dataset.date);
  if (action === 'date-prev-month') return moveCalendarMonth(-1);
  if (action === 'date-next-month') return moveCalendarMonth(1);
  if (action === 'toggle-menu') return setMenu(true, target);
  if (action === 'close-menu') return setMenu(false);
  if (action === 'close-modal') return closeAuth();
  if (action === 'close-replan' || action === 'cancel-replan') return closeReplan();
  if (action === 'close-review-modal') return closeReviewModal();
  if (action === 'close-place-reviews') return closePlaceReviews();
  if (action === 'apply-replan') return applyReplan();
  if (action === 'jump-itinerary-day') return jumpToItineraryDay(target.dataset.workspace, target.dataset.dayIndex);
  if (action === 'jump-itinerary-overview') return jumpToItineraryOverview(target.dataset.workspace);
  if (action === 'set-itinerary-view') {
    state.itineraryView = target.dataset.view === 'compact' ? 'compact' : 'detailed';
    return renderPlanner();
  }
  if (action === 'reset-itinerary') return openResetConfirmation();
  if (action === 'cancel-reset-itinerary') return closeResetConfirmation();
  if (action === 'confirm-reset-itinerary') return confirmResetItinerary();
  if (['login', 'register', 'logout', 'new-trip'].includes(action) && $('#mobile-nav').classList.contains('is-open')) setMenu(false);
  if (action === 'login' || action === 'register') return openAuth(action);
  if (action === 'new-trip') return startNewTrip(target.dataset.id);
  if (action === 'select-destination') return startNewTrip(target.dataset.id);
  if (action === 'open-review') return openReview({ destinationId: target.dataset.destinationId, placeId: target.dataset.placeId });
  if (action === 'open-place-reviews') return openPlaceReviews(target.dataset.id);
  if (action === 'view-all-reviews' || action === 'view-review-target') {
    return navigateReviews({ destinationId: target.dataset.destinationId || '', placeId: target.dataset.placeId || '', rating: '', sort: 'newest', page: 1 });
  }
  if (action === 'review-page') {
    const filters = state.route.reviewFilters || state.reviewBrowse.filters;
    return navigateReviews({ ...filters, page: Math.max(1, Number(target.dataset.page) || 1) });
  }
  if (action === 'reviews-back') {
    if (window.history.length > 1) return window.history.back();
    return navigate('/');
  }
  if (action === 'edit-review') return editReview(target.dataset.id);
  if (action === 'delete-review') return deleteReview(target.dataset.id);
  if (action === 'review-star') {
    state.reviewRating = Number(target.dataset.rating);
    ensureReviewDraft({ rating: state.reviewRating });
    updateRatingControl(target.closest('.review-form'), state.reviewRating);
    return;
  }
  if (action === 'toggle-interest') {
    const id = normalizeCategory(target.dataset.interest);
    state.draft.interests = state.draft.interests.includes(id) ? state.draft.interests.filter((item) => normalizeCategory(item) !== id) : [...state.draft.interests, id];
    state.placeVisibleCount = 12;
    return renderPlanner();
  }
  if (action === 'clear-interests') {
    state.draft.interests = [];
    state.placeVisibleCount = 12;
    return renderPlanner();
  }
  if (action === 'load-more-places') {
    state.placeVisibleCount += 12;
    return renderPlanner();
  }
  if (action === 'toggle-place' || action === 'add-stop') {
    const id = target.dataset.id;
    state.draft.selectedPlaceIds = state.draft.selectedPlaceIds.includes(id) ? state.draft.selectedPlaceIds.filter((item) => item !== id) : [...state.draft.selectedPlaceIds, id];
    if (action === 'toggle-place') state.draft.stepTwoPlaceIds = (state.draft.stepTwoPlaceIds || []).includes(id) ? state.draft.stepTwoPlaceIds.filter((item) => item !== id) : [...(state.draft.stepTwoPlaceIds || []), id];
    if (action === 'add-stop') return generate();
    return renderPlanner();
  }
  if (action === 'add-inspiration') {
    const result = state.inspirationResolution;
    if (!result?.place || !result?.mapping) return;
    if (!(state.draft.inspirationItems || []).some((item) => item.placeId === result.place.id)) {
      state.draft.inspirationItems = [...(state.draft.inspirationItems || []), { mappingId: result.mapping.id, placeId: result.place.id, sourceUrl: result.normalizedUrl, platform: result.mapping.platform }];
      if (!state.draft.selectedPlaceIds.includes(result.place.id)) state.draft.selectedPlaceIds = [...state.draft.selectedPlaceIds, result.place.id];
    }
    state.inspirationResolution = null;
    state.inspirationInput = '';
    return renderPlanner();
  }
  if (action === 'remove-inspiration') {
    const item = (state.draft.inspirationItems || []).find((entry) => entry.mappingId === target.dataset.id);
    state.draft.inspirationItems = (state.draft.inspirationItems || []).filter((entry) => entry.mappingId !== target.dataset.id);
    if (item && !(state.draft.stepTwoPlaceIds || []).includes(item.placeId)) state.draft.selectedPlaceIds = state.draft.selectedPlaceIds.filter((id) => id !== item.placeId);
    return renderPlanner();
  }
  if (action === 'next-step') {
    if (!String(state.draft.title || '').trim()) return toast('Hãy nhập tên chuyến đi.');
    const dateError = dateValidationMessage();
    if (dateError) return toast(dateError);
    const travelers = Number(state.draft.travelers);
    if (!Number.isInteger(travelers) || travelers < 1 || travelers > 12) return toast('Số người cần nằm trong khoảng 1–12.');
    const budgetError = budgetValidationMessage();
    if (budgetError) return toast(budgetError);
    if (state.step === 1 && !state.draft.selectedPlaceIds.length) return toast('Hãy chọn ít nhất một địa điểm để tạo lịch trình');
    state.step += 1;
    if (state.step === 3) return state.generated && state.generatedSignature === draftSignature() ? renderPlanner() : generate();
    return renderPlanner();
  }
  if (action === 'prev-step') {
    state.step = Math.max(0, state.step - 1);
    return renderPlanner();
  }
  if (action === 'regenerate') return generate();
  if (action === 'save-plan') return savePlan();
  if (action === 'delete-plan') return deletePlan(target.dataset.id);
  if (action === 'filter-trips') {
    state.tripFilter = target.dataset.filter;
    return renderTripsPage();
  }
  if (action === 'clear-trip-filters') {
    state.tripSearch = '';
    state.tripFilter = 'all';
    return renderTripsPage();
  }
  if (action === 'logout') {
    await api('/api/auth/logout', { method: 'POST' });
    state.user = null;
    state.plans = [];
    toast('Đã đăng xuất');
    return navigate('/', { replace: true });
  }
  if (action === 'open-replan') return openReplan();
  if (action === 'move-item') {
    const day = Number(target.dataset.day);
    const index = Number(target.dataset.index);
    const next = target.dataset.direction === 'up' ? index - 1 : index + 1;
    if (next >= 0 && next < state.generated.itinerary[day].items.length) return moveItem(day, index, day, next);
    return;
  }
  if (action === 'remove-item') {
    const day = Number(target.dataset.day);
    const index = Number(target.dataset.index);
    const item = state.generated.itinerary[day]?.items[index];
    const candidate = clone(state.generated.itinerary);
    candidate[day].items.splice(index, 1);
    try {
      await normalizeEditor(candidate);
    } catch (error) {
      toast(error.message);
    }
  }
}

document.addEventListener('click', async (event) => {
  if (state.datePickerOpen && !event.target.closest('.date-range-field')) closeDatePicker();
  const link = event.target.closest('[data-route]');
  if (link) {
    event.preventDefault();
    if ($('#mobile-nav').classList.contains('is-open')) setMenu(false);
    await navigate(link.getAttribute('href'));
    return;
  }
  const target = event.target.closest('[data-action]');
  if (!target || target.tagName === 'SELECT') return;
  await handleAction(target);
});

document.addEventListener('input', (event) => {
  const target = event.target;
  if (target.dataset.tripSearch !== undefined) {
    state.tripSearch = target.value;
    return renderTripsPage();
  }
  if (target.dataset.placeSearch !== undefined) {
    const caret = target.selectionStart;
    state.placeSearch = target.value;
    state.placeVisibleCount = 12;
    renderPlanner();
    return requestAnimationFrame(() => {
      const input = $('#place-search');
      input?.focus();
      if (input && Number.isInteger(caret)) input.setSelectionRange(caret, caret);
    });
  }
  if (target.dataset.budgetInput !== undefined) {
    handleBudgetInput(target);
    return;
  }
  const field = target.dataset.draft;
  if (field) {
    state.draft[field] = target.type === 'number' ? Number(target.value) : target.value;
    if (field === 'travelers') updateBudgetPerPersonText();
  }
  const reviewField = target.dataset.reviewField;
  if (reviewField) {
    ensureReviewDraft();
    state.reviewDraft[reviewField] = reviewField === 'rating' ? Number(target.value) : target.value;
  }
  const itemField = target.dataset.itemField;
  if (itemField && state.generated) {
    const item = state.generated.itinerary[Number(target.dataset.day)]?.items.find((entry) => entry.id === target.dataset.item);
    if (item) {
      updateItemField(item, itemField, target.value);
      scheduleEditorNormalization();
    }
  }
  const replanField = target.dataset.replanField;
  if (replanField && state.replanDraft) state.replanDraft[replanField] = replanField === 'dayIndex' || replanField === 'delayMinutes' ? Number(target.value) : target.value;
  if (target.dataset.inspirationUrl !== undefined) {
    state.inspirationInput = target.value;
    const submit = target.closest('form')?.querySelector('[data-inspiration-submit]');
    const valid = isSupportedUrlShape(target.value);
    if (submit) submit.disabled = !valid;
    const validation = target.closest('.inspiration-panel')?.querySelector('#inspiration-validation');
    if (validation) {
      validation.hidden = !target.value || valid;
      validation.textContent = valid || !target.value ? '' : 'Vui lòng dán một đường link hợp lệ.';
    }
  }
});

document.addEventListener('change', (event) => {
  const target = event.target;
  if (target.dataset.reviewFilter) {
    const filters = { ...(state.route.reviewFilters || state.reviewBrowse.filters || {}) };
    const field = target.dataset.reviewFilter;
    filters[field] = field === 'rating' ? (target.value ? Number(target.value) : '') : target.value;
    if (field === 'destinationId') filters.placeId = '';
    return navigateReviews({ ...filters, page: 1 });
  }
  if (target.dataset.budgetInput !== undefined) {
    const normalized = plannerInputs.normalizeBudgetInput(target.value);
    if (!normalized.error) {
      state.draft.targetBudget = normalized.value;
      state.budgetInputValue = normalized.display;
      state.budgetInputError = '';
      target.value = normalized.display;
    }
    updateBudgetPerPersonText();
    updateBudgetErrorState();
    return;
  }
  const field = target.dataset.draft;
  if (field) {
    state.draft[field] = target.type === 'number' ? Number(target.value) : target.value;
    if (field === 'travelers') updateBudgetPerPersonText();
    if (field === 'destinationId') {
      state.draft.selectedPlaceIds = [];
      state.draft.stepTwoPlaceIds = [];
      state.draft.inspirationItems = [];
      state.inspirationResolution = null;
      state.placeSearch = '';
      state.placeVisibleCount = 12;
    }
  }
  const reviewField = target.dataset.reviewField;
  if (reviewField) {
    ensureReviewDraft();
    state.reviewDraft[reviewField] = target.value;
    if (reviewField === 'destinationId') state.reviewDraft.placeId = '';
    if (reviewField === 'destinationId' || reviewField === 'placeId') {
      if (state.reviewModalOpen) renderReviewModal();
      else renderReviews();
    }
  }
  const itemField = target.dataset.itemField;
  if (itemField && state.generated) {
    scheduleEditorNormalization(0);
    return;
  }
  if (target.dataset.action === 'move-item-to-day' && target.value !== '') {
    const fromDay = Number(target.dataset.day);
    const index = Number(target.dataset.index);
    const toDay = Number(target.value);
    if (fromDay !== toDay) moveItem(fromDay, index, toDay);
    target.value = '';
  }
  const replanField = target.dataset.replanField;
  if (replanField && state.replanDraft) {
    state.replanDraft[replanField] = replanField === 'dayIndex' ? Number(target.value) : target.value;
    if (replanField === 'type') renderReplanModal();
  }
  if (target.dataset.replanCompleted && state.replanDraft) {
    const id = target.dataset.replanCompleted;
    state.replanDraft.completedItemIds = target.checked ? [...new Set([...state.replanDraft.completedItemIds, id])] : state.replanDraft.completedItemIds.filter((itemId) => itemId !== id);
  }
});

document.addEventListener('submit', async (event) => {
  const form = event.target;
  if (!form.dataset.form) return;
  event.preventDefault();
  if (form.dataset.form === 'replan') return submitReplan();
  if (form.dataset.form === 'inspiration') {
    const url = new FormData(form).get('url');
    state.inspirationInput = String(url || '');
    if (!isSupportedUrlShape(url)) {
      state.inspirationResolution = { status: 'error', message: 'Vui lòng dán một đường link hợp lệ.' };
      renderPlanner();
      return;
    }
    state.inspirationResolution = { status: 'loading' };
    renderPlanner();
    try {
      state.inspirationResolution = await api('/api/inspiration/resolve', { method: 'POST', body: { url, destinationId: state.draft.destinationId } });
    } catch (error) {
      state.inspirationResolution = { status: 'error', message: error.message };
    }
    renderPlanner();
    return;
  }
  const data = Object.fromEntries(new FormData(form));
  if (form.dataset.form === 'auth') {
    try {
      const result = await api('/api/auth/' + data.mode, { method: 'POST', body: data });
      state.user = result.user;
      state.draft = defaultDraft();
      syncBudgetInput(state.draft.targetBudget);
      $('#modal-root').innerHTML = '';
      await refreshPlans();
      const pending = state.pendingPath;
      const pendingReview = state.pendingReviewContext;
      state.pendingPath = null;
      state.pendingReviewContext = null;
      toast(data.mode === 'login' ? 'Chào mừng trở lại ✦' : 'Tài khoản đã sẵn sàng ✦');
      if (pending) await navigate(pending);
      else if (pendingReview) {
        render();
        openReview(pendingReview);
      }
      else render();
    } catch (error) {
      form.querySelector('[data-auth-error]').textContent = error.message;
    }
    return;
  }
  if (form.dataset.form === 'review') {
    ensureReviewDraft();
    data.rating = state.reviewDraft.rating;
    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton) submitButton.disabled = true;
    try {
      const endpoint = state.reviewEditingId ? '/api/reviews/' + encodeURIComponent(state.reviewEditingId) : '/api/reviews';
      const method = state.reviewEditingId ? 'PUT' : 'POST';
      await api(endpoint, { method, body: data });
      const message = state.reviewEditingId ? 'Đã cập nhật đánh giá' : 'Cảm ơn bạn đã chia sẻ ✦';
      const wasModal = state.reviewModalOpen;
      const returnPlaceId = state.reviewReturnDetail?.place?.id;
      state.reviewDraft = null;
      state.reviewEditingId = null;
      if (wasModal) closeReviewModal(false, false);
      await refreshReviewData();
      if (returnPlaceId) await openPlaceReviews(returnPlaceId);
      else if (state.route.view === 'reviews') {
        const filters = { ...(state.route.reviewFilters || state.reviewBrowse.filters || {}) };
        if (filters.sort === 'newest') filters.page = 1;
        await loadReviewBrowse(filters);
        render();
      } else render();
      toast(message);
    } catch (error) {
      const errorBox = form.querySelector('[data-review-error]');
      if (errorBox) errorBox.textContent = error.message;
      else toast(error.message);
    } finally {
      if (form.isConnected && submitButton) submitButton.disabled = false;
    }
  }
});

function closeAuth() {
  $('#modal-root').innerHTML = '';
  state.pendingReviewContext = null;
  if (lastAuthTrigger instanceof HTMLElement) lastAuthTrigger.focus();
}

document.addEventListener('keydown', (event) => {
  if (event.target.matches('.calendar-day') && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
    event.preventDefault();
    const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
    const nextDate = plannerInputs.addDays(event.target.dataset.date, offset);
    const nextButton = document.querySelector('.calendar-day[data-date="' + nextDate + '"]');
    if (nextButton) nextButton.focus();
    else {
      state.datePickerMonth = plannerInputs.monthStart(nextDate);
      renderPlanner();
      requestAnimationFrame(() => document.querySelector('.calendar-day[data-date="' + nextDate + '"]')?.focus());
    }
    return;
  }
  if (event.key === 'Escape') {
    if ($('#mobile-nav').classList.contains('is-open')) setMenu(false);
    if (state.datePickerOpen) closeDatePicker(true);
    else if (state.resetConfirmOpen) closeResetConfirmation();
    else if (state.replanOpen) closeReplan();
    else if (state.reviewModalOpen) closeReviewModal();
    else if (state.reviewDetail) closePlaceReviews();
    else if ($('#modal-root').children.length) closeAuth();
  }
  if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[role="button"][data-action]')) {
    event.preventDefault();
    event.target.click();
  }
  if (event.target.matches('[data-action="review-star"][role="radio"]') && ['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const buttons = [...event.target.closest('.stars-input').querySelectorAll('[data-action="review-star"]')];
    const currentIndex = buttons.indexOf(event.target);
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (currentIndex + (event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 1) + buttons.length) % buttons.length;
    buttons[nextIndex].focus();
    buttons[nextIndex].click();
  }
  if (event.key === 'Tab' && $('#mobile-nav').classList.contains('is-open')) {
    const focusable = [...$('#mobile-nav').querySelectorAll('button:not([tabindex="-1"]),a[href]')];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  if (event.key === 'Tab' && $('#modal-root').children.length) {
    const focusable = [...$('#modal-root').querySelectorAll('button:not([disabled]),input,select,textarea,a[href]')];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (first && event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (last && !event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});

window.addEventListener('popstate', () => applyRoute({ scroll: false }));
window.addEventListener('scroll', scheduleItineraryScrollSync, { passive: true });

async function boot() {
  try {
    const [me, destinations, places, services, reviews] = await Promise.all([api('/api/auth/me'), api('/api/destinations'), api('/api/places'), api('/api/services'), api('/api/reviews?page=1&pageSize=3&sort=newest')]);
    state.user = me.user;
    state.destinations = destinations.destinations;
    state.destinationRatings = destinations.ratingSummaries || {};
    state.places = places.places;
    state.placeRatings = places.ratingSummaries || {};
    state.services = services.services;
    state.reviews = reviews.reviews;
    state.reviewPreview = { total: reviews.pagination?.total || 0, ratingSummary: reviews.ratingSummary || { average: null, count: 0 } };
    state.draft = defaultDraft();
    syncBudgetInput(state.draft.targetBudget);
    if (state.user) await refreshPlans();
    await applyRoute({ scroll: false });
  } catch (error) {
    toast(error.message);
  }
}

boot();
