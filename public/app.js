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
  pendingPath: null,
  replanOpen: false,
  replanDraft: null,
  replanPreview: null,
  toastTimer: null
};

const $ = (selector) => document.querySelector(selector);
const money = (value) => new Intl.NumberFormat('vi-VN').format(Math.round(value || 0)) + 'đ';
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const formatDate = (value) => new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value + 'T00:00:00'));
const intensityLabel = (value) => ({ relaxed: 'Thảnh thơi', balanced: 'Cân bằng', packed: 'Nhiều trải nghiệm' }[value] || 'Cân bằng');
const dateValue = (date) => date.toISOString().slice(0, 10);
const categoryLabels = { nature: 'Thiên nhiên', beach: 'Biển', food: 'Ẩm thực', culture: 'Văn hóa', photography: 'Nhiếp ảnh', experience: 'Trải nghiệm', photo: 'Nhiếp ảnh', activity: 'Trải nghiệm' };
let lastMenuTrigger = null;
let lastAuthTrigger = null;
let lastModalTrigger = null;

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
  return JSON.parse(JSON.stringify(value));
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
    selectedPlaceIds: []
  };
}

function draftSignature() {
  return JSON.stringify({ destinationId: state.draft.destinationId, startDate: state.draft.startDate, endDate: state.draft.endDate, intensity: state.draft.intensity, selectedPlaceIds: [...(state.draft.selectedPlaceIds || [])].sort() });
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

function readonlyDay(day, index) {
  const items = day.items || [];
  const content = items.length
    ? items.map((item) => '<div class="timeline-item timeline-item-readonly"><div class="time"><strong>' + escapeHtml(item.startTime) + '</strong><small>đến ' + escapeHtml(item.endTime) + '</small></div><div><strong>' + escapeHtml(item.title) + '</strong><small>' + escapeHtml(categoryLabels[item.category] || item.category || 'Điểm dừng') + ' · ' + item.durationMinutes + ' phút · ' + money(item.estimatedCost) + '/người</small></div></div>').join('')
    : '<p class="empty-day-message">Chưa có hoạt động nào trong ngày này.</p>';
  return '<section class="timeline-day"><h3>NGÀY ' + (index + 1) + ' · ' + formatDate(day.date) + '</h3>' + content + '</section>';
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
  target.innerHTML = '<a class="back-link" href="/trips" data-route>← Tất cả chuyến đi</a><section class="trip-detail-hero"><div class="trip-detail-copy"><div class="trip-card-topline"><span class="status-badge status-' + status.id + '">' + status.label + '</span><span class="card-eyebrow">' + escapeHtml(plan.destination?.name || 'Điểm đến') + '</span></div><h1>' + escapeHtml(plan.title) + '</h1><p>' + formatDate(plan.startDate) + ' → ' + formatDate(plan.endDate) + '</p><dl class="detail-meta"><div><dt>Người đi</dt><dd>' + plan.travelers + ' người</dd></div><div><dt>Nhịp điệu</dt><dd>' + intensityLabel(plan.intensity) + '</dd></div><div><dt>Ngân sách</dt><dd>' + money(plan.budget?.total) + '</dd></div></dl><div class="detail-actions"><a class="button button-primary" href="/trips/' + encodeURIComponent(plan.id) + '/edit" data-route>Chỉnh sửa lịch trình <span>↗</span></a><button class="button button-ghost" data-action="open-review" data-destination-id="' + plan.destinationId + '">Chia sẻ trải nghiệm</button><button class="text-button danger-action" data-action="delete-plan" data-id="' + plan.id + '">Xóa chuyến đi</button></div></div><div class="trip-detail-image" style="background-image:url(' + (plan.destination?.image || '') + ')" role="img" aria-label="' + escapeHtml(plan.destination?.name || 'Điểm đến') + '"></div></section><section class="detail-content"><div><div class="detail-section-heading"><div><div class="kicker">LỊCH TRÌNH ĐÃ LƯU</div><h2>Từng ngày, thật rõ ràng.</h2></div><p>Hãy xem lại hành trình trước khi tiếp tục tinh chỉnh.</p></div><div class="timeline-list">' + (plan.days || []).map(readonlyDay).join('') + '</div>' + servicesHtml + '</div>' + renderBudget(plan.budget, plan.targetBudget, (plan.days || []).length) + '</section>';
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
  if (!interests.size) return places;
  return places.filter((item) => interests.has(normalizeCategory(item.category)));
}

function pickerCard(item, action = 'toggle-place') {
  const selected = (state.draft.selectedPlaceIds || []).includes(item.id);
  const label = categoryLabels[item.category] || item.category || 'Điểm dừng';
  const summary = ratingSummaryFor(item.id);
  const ratingLabel = summary.count ? 'Xem ' + summary.count + ' đánh giá, trung bình ' + Number(summary.average).toFixed(1) + ' sao cho ' + item.name : 'Xem đánh giá cho ' + item.name;
  return '<article class="picker-card ' + (selected ? 'selected' : '') + '"><button class="picker-select" type="button" data-action="' + action + '" data-id="' + item.id + '" aria-pressed="' + selected + '" aria-label="' + (selected ? 'Bỏ chọn ' : 'Thêm ') + escapeHtml(item.name) + '"><span class="picker-img" style="background-image:url(' + item.image + ')"></span><span class="picker-body"><strong>' + escapeHtml(item.name) + '</strong><span class="picker-description">' + escapeHtml(item.description) + '</span><span class="picker-foot"><span>' + escapeHtml(label) + ' · ' + item.recommendedDurationMinutes + ' phút · ' + money(item.estimatedCost) + '</span><span class="selected-pill">' + (selected ? '✓ Đã chọn' : item.hiddenGem ? 'Hidden gem · Thêm +' : 'Thêm +') + '</span></span></span></button><button class="rating-link" type="button" data-action="open-place-reviews" data-id="' + item.id + '" aria-label="' + escapeHtml(ratingLabel) + '">' + ratingText(summary) + '<span aria-hidden="true">↗</span></button></article>';
}

function renderStepTwo() {
  const candidates = filteredPlaces();
  const all = state.places.filter((item) => item.destinationId === state.draft.destinationId);
  const selected = all.filter((item) => (state.draft.selectedPlaceIds || []).includes(item.id));
  const interests = [['nature', '🌿', 'Thiên nhiên'], ['beach', '◒', 'Biển'], ['food', '⌁', 'Ẩm thực'], ['culture', '⌂', 'Văn hóa'], ['photography', '⊙', 'Nhiếp ảnh'], ['experience', '✦', 'Trải nghiệm']];
  const resultHtml = candidates.length
    ? candidates.map((item) => pickerCard(item)).join('')
    : '<div class="empty-filter-state"><strong>Không tìm thấy địa điểm phù hợp với các sở thích đã chọn.</strong><span>Hãy thử thay đổi hoặc xóa bớt bộ lọc.</span><button class="button button-ghost button-small" data-action="clear-interests">Xóa bộ lọc</button></div>';
  const selectedSummary = selected.length ? '<div class="selected-summary" aria-live="polite"><strong>' + selected.length + ' địa điểm đã chọn</strong><span>' + escapeHtml(selected.map((item) => item.name).join(' · ')) + '</span></div>' : '<div class="selected-summary is-empty" aria-live="polite"><strong>Chưa chọn địa điểm</strong><span>Chọn ít nhất một nơi để PinkTrip tạo lịch trình.</span></div>';
  return '<div class="step-panel"><h3>Điều gì làm bạn muốn đi?</h3><p>Chọn sở thích để lọc gợi ý, sau đó chọn những nơi bạn thật sự muốn ghé.</p><div class="choice-grid">' + interests.map(([id, icon, label]) => '<button class="choice ' + ((state.draft.interests || []).map(normalizeCategory).includes(id) ? 'selected' : '') + '" type="button" data-action="toggle-interest" data-interest="' + id + '" aria-pressed="' + ((state.draft.interests || []).map(normalizeCategory).includes(id)) + '"><b aria-hidden="true">' + icon + '</b><small>' + label + '</small></button>').join('') + '</div>' + selectedSummary + '<div class="place-picker"><div class="recommendation-note">Gợi ý cho ' + escapeHtml(destination(state.draft.destinationId)?.name) + ' · ' + candidates.length + '/' + all.length + ' địa điểm đang hiển thị</div>' + resultHtml + '</div></div>';
}

function timeToMinutes(value) {
  const match = String(value || '').match(/^(\\d{1,2}):(\\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
}

function minutesToTime(total) {
  return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
}

function updateItemField(item, field, value) {
  item[field] = field === 'durationMinutes' ? Math.max(30, Number(value) || 30) : value;
  if (field === 'startTime' || field === 'durationMinutes') item.endTime = minutesToTime(timeToMinutes(item.startTime) + (Number(item.durationMinutes) || 120));
}

function editorDay(day, dayIndex) {
  const items = day.items || [];
  const itemHtml = items.map((item, index) => {
    const dayOptions = (state.generated?.itinerary || []).map((entry, targetIndex) => '<option value="' + targetIndex + '" ' + (targetIndex === dayIndex ? 'selected' : '') + '>Ngày ' + (targetIndex + 1) + '</option>').join('');
    return '<div class="timeline-item editable-item" data-day="' + dayIndex + '" data-index="' + index + '"><div class="time"><input class="inline-input" type="time" data-item-field="startTime" data-day="' + dayIndex + '" data-item="' + item.id + '" value="' + escapeHtml(item.startTime) + '" aria-label="Giờ bắt đầu ' + escapeHtml(item.title) + '"><small>đến ' + escapeHtml(item.endTime) + '</small></div><div class="timeline-item-copy"><strong>' + escapeHtml(item.title) + '</strong><small>' + escapeHtml(categoryLabels[item.category] || item.category || 'Điểm dừng') + ' · ' + money(item.estimatedCost) + '/người</small><label class="duration-control">Thời lượng <input class="duration-input" type="number" min="30" step="15" data-item-field="durationMinutes" data-day="' + dayIndex + '" data-item="' + item.id + '" value="' + item.durationMinutes + '" aria-label="Thời lượng ' + escapeHtml(item.title) + '"> phút</label></div><div class="timeline-controls"><button class="icon-button" type="button" data-action="move-item" data-day="' + dayIndex + '" data-index="' + index + '" data-direction="up" aria-label="Đưa ' + escapeHtml(item.title) + ' lên">↑</button><button class="icon-button" type="button" data-action="move-item" data-day="' + dayIndex + '" data-index="' + index + '" data-direction="down" aria-label="Đưa ' + escapeHtml(item.title) + ' xuống">↓</button><select class="move-select" data-action="move-item-to-day" data-day="' + dayIndex + '" data-index="' + index + '" aria-label="Di chuyển ' + escapeHtml(item.title) + ' sang ngày khác"><option value="">Di chuyển đến…</option>' + dayOptions + '</select><button class="icon-button danger-icon" type="button" data-action="remove-item" data-day="' + dayIndex + '" data-index="' + index + '" aria-label="Xóa ' + escapeHtml(item.title) + '">×</button></div></div>';
  }).join('');
  return '<section class="timeline-day editable-day" data-drop-day="' + dayIndex + '"><h4>NGÀY ' + (dayIndex + 1) + ' · ' + formatDate(day.date) + '</h4>' + (itemHtml || '<p class="empty-day-message">Chưa có hoạt động nào trong ngày này. Bạn vẫn có thể chuyển điểm dừng vào đây.</p>') + '</section>';
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
  const nav = '<div class="planner-steps">' + ['Thông tin', 'Điểm đến', 'Lịch trình'].map((item, index) => '<span class="planner-step ' + (index === state.step ? 'active ' : '') + (index < state.step ? 'done' : '') + '">' + String(index + 1).padStart(2, '0') + ' ' + item + '</span>').join('') + '</div>';
  let content = '';
  if (state.step === 0) {
    content = '<div class="step-panel"><h3>Chuyến đi này có gì đặc biệt?</h3><p>Cho PinkTrip biết vài điều cơ bản để bắt đầu sắp xếp.</p><div class="form-grid"><div class="field"><label for="trip-title">Tên chuyến đi</label><input id="trip-title" data-draft="title" value="' + escapeHtml(state.draft.title) + '" placeholder="Ví dụ: Cuối tuần ở biển"></div><div class="field"><label for="trip-destination">Điểm đến</label><select id="trip-destination" data-draft="destinationId">' + state.destinations.map((item) => '<option value="' + item.id + '" ' + (item.id === state.draft.destinationId ? 'selected' : '') + '>' + escapeHtml(item.name) + ' · ' + escapeHtml(item.province) + '</option>').join('') + '</select></div><div class="field"><label for="trip-start">Ngày bắt đầu</label><input id="trip-start" type="date" data-draft="startDate" value="' + state.draft.startDate + '"></div><div class="field"><label for="trip-end">Ngày kết thúc</label><input id="trip-end" type="date" data-draft="endDate" value="' + state.draft.endDate + '"></div><div class="field"><label for="trip-travelers">Số người</label><input id="trip-travelers" type="number" min="1" max="12" data-draft="travelers" value="' + state.draft.travelers + '"></div><div class="field"><label for="trip-budget">Ngân sách cả chuyến</label><div class="money-wrap"><input id="trip-budget" type="number" min="0" step="100000" data-draft="targetBudget" value="' + state.draft.targetBudget + '"><span>VND</span></div></div><div class="field"><label for="trip-intensity">Nhịp điệu</label><select id="trip-intensity" data-draft="intensity"><option value="relaxed" ' + (state.draft.intensity === 'relaxed' ? 'selected' : '') + '>Thảnh thơi</option><option value="balanced" ' + (state.draft.intensity === 'balanced' ? 'selected' : '') + '>Cân bằng</option><option value="packed" ' + (state.draft.intensity === 'packed' ? 'selected' : '') + '>Nhiều trải nghiệm</option></select></div></div></div>';
  } else if (state.step === 1) {
    content = renderStepTwo();
  } else if (state.step === 2 && state.generated) {
    const other = state.places.filter((item) => item.destinationId === state.generated.destination.id && !(state.draft.selectedPlaceIds || []).includes(item.id)).slice(0, 3);
    content = '<div class="step-panel"><div class="trip-summary"><div><small>ĐIỂM ĐẾN</small><strong>' + escapeHtml(state.generated.destination.name) + '</strong></div><div><small>NHỊP ĐIỆU</small><strong>' + intensityLabel(state.draft.intensity) + '</strong></div><div><small>ĐỊA ĐIỂM</small><strong>' + state.draft.selectedPlaceIds.length + ' đã chọn</strong></div></div><div class="editor-toolbar"><div><strong>Lịch trình hiện tại</strong><span>Chọn ngày đích để di chuyển, hoặc dùng ↑ ↓ để đổi thứ tự.</span></div><button class="button button-ghost button-small" type="button" data-action="open-replan">Có thay đổi?</button></div><div class="result-grid"><div><div class="timeline-list">' + state.generated.itinerary.map(editorDay).join('') + '</div><section class="add-stop-section"><h4>Muốn thêm một điểm dừng?</h4><p>Thêm vào lựa chọn rồi PinkTrip sẽ xếp lại bản nháp.</p><div class="place-picker">' + other.map((item) => pickerCard(item, 'add-stop')).join('') + '</div></section></div>' + renderBudget(state.generated.budget, state.draft.targetBudget, state.generated.itinerary.length) + '</div></div>';
  }
  const nextLabel = state.step === 1 ? 'Tạo lịch trình' : 'Tiếp tục';
  const footerActions = state.step === 2
    ? '<button class="button button-ghost button-small" type="button" data-action="regenerate">↻ Xếp lại</button><button class="button button-primary button-small" type="button" data-action="save-plan">Lưu chuyến đi <span>✓</span></button>'
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
  $('#modal-root').innerHTML = '<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="auth-title"><button class="modal-close" type="button" data-action="close-modal" aria-label="Đóng cửa sổ">×</button><div class="kicker">PINKTRIP</div><h2 id="auth-title">' + (login ? 'Chào mừng trở lại.' : 'Bắt đầu hành trình.') + '</h2><p>' + (login ? 'Đăng nhập để xem những chuyến đi đã lưu.' : 'Tạo tài khoản demo để lưu lịch trình của riêng bạn.') + '</p><form data-form="auth"><input type="hidden" name="mode" value="' + mode + '">' + (login ? '' : '<div class="field"><label for="auth-name">Tên của bạn</label><input id="auth-name" name="name" required autocomplete="name" placeholder="Ví dụ: Minh Anh"></div>') + '<div class="field"><label for="auth-email">Email</label><input id="auth-email" name="email" type="email" required autocomplete="email" placeholder="you@example.com"></div><div class="field"><label for="auth-password">Mật khẩu</label><input id="auth-password" name="password" minlength="8" type="password" required autocomplete="' + (login ? 'current-password' : 'new-password') + '" placeholder="Tối thiểu 8 ký tự"></div><div class="error-message" data-auth-error aria-live="polite"></div><button class="button button-primary" type="submit" style="width:100%">' + (login ? 'Đăng nhập' : 'Tạo tài khoản') + ' <span>↗</span></button></form><div class="modal-switch">' + (login ? 'Chưa có tài khoản?' : 'Đã có tài khoản?') + ' <button type="button" data-action="' + (login ? 'register' : 'login') + '">' + (login ? 'Đăng ký' : 'Đăng nhập') + '</button></div></section></div>';
  requestAnimationFrame(() => $('#modal-root input:not([type="hidden"])')?.focus());
}

function loadPlanIntoEditor(plan) {
  state.editingPlanId = plan.id;
  state.plannerOpen = true;
  state.step = 2;
  state.draft = { title: plan.title, destinationId: plan.destinationId, startDate: plan.startDate, endDate: plan.endDate, travelers: plan.travelers, targetBudget: plan.targetBudget, accommodationLevel: plan.accommodationLevel || 'comfort', intensity: plan.intensity || 'balanced', interests: plan.interests || [], selectedPlaceIds: plan.selectedPlaceIds || [] };
  state.generated = { destination: plan.destination, itinerary: clone(plan.days || []), budget: clone(plan.budget || {}) };
  state.generatedSignature = draftSignature();
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
      if (previous.view !== 'new' && !state.draft.destinationId) state.draft = defaultDraft();
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
  state.generatedSignature = null;
  state.draft = defaultDraft(id);
  navigate('/trips/new', { scroll: false });
  requestAnimationFrame(() => $('#planner').scrollIntoView({ behavior: 'smooth' }));
}

async function persistCurrentPlan() {
  const payload = { ...state.draft, days: clone(state.generated.itinerary), budget: clone(state.generated.budget), regenerate: false };
  const result = state.editingPlanId
    ? await api('/api/plans/' + encodeURIComponent(state.editingPlanId), { method: 'PUT', body: payload })
    : await api('/api/plans', { method: 'POST', body: payload });
  state.activeTrip = result.plan;
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
  const result = await api('/api/plans/recalculate', {
    method: 'POST',
    body: { itinerary: candidate, ...state.draft, selectedPlaceIds: selectedIds }
  });
  state.generated.itinerary = result.itinerary;
  state.generated.budget = result.budget;
  renderPlanner();
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
  return items.length ? '<fieldset class="field completed-list"><legend>Đã hoàn thành (giữ nguyên)</legend><div>' + items.map(({ item }) => '<label><input type="checkbox" data-replan-completed="' + item.id + '" ' + (state.replanDraft.completedItemIds.includes(item.id) ? 'checked' : '') + '> <span>' + escapeHtml(item.title) + '</span></label>').join('') + '</div></fieldset>' : '';
}

function renderReplanModal() {
  if (!state.replanOpen) return;
  const draft = state.replanDraft || defaultReplanDraft();
  state.replanDraft = draft;
  const typeOptions = replanTypes().map(([id, label]) => '<option value="' + id + '" ' + (draft.type === id ? 'selected' : '') + '>' + label + '</option>').join('');
  let body = '<form data-form="replan"><div class="field"><label for="replan-type">Điều gì đã thay đổi?</label><select id="replan-type" data-replan-field="type">' + typeOptions + '</select></div><div class="field"><label for="replan-day">Ngày bị ảnh hưởng</label><select id="replan-day" data-replan-field="dayIndex">' + (state.generated?.itinerary || []).map((day, index) => '<option value="' + index + '" ' + (index === Number(draft.dayIndex) ? 'selected' : '') + '>Ngày ' + (index + 1) + ' · ' + formatDate(day.date) + '</option>').join('') + '</select></div>' + replanOptions() + replanCompletedItems() + '<div class="field"><label for="replan-note">Ghi chú thêm <span class="optional">(không bắt buộc)</span></label><textarea id="replan-note" data-replan-field="note" placeholder="Ví dụ: Ưu tiên nghỉ ngơi và tránh di chuyển xa"></textarea></div><div class="error-message" id="replan-error" aria-live="polite"></div><button class="button button-primary" type="submit">Tạo phương án mới <span>↗</span></button></form>';
  if (state.replanPreview) {
    const changes = state.replanPreview.changes || [];
    body = '<div class="replan-preview"><div class="preview-intro"><strong>Phương án dựa trên lịch trình hiện tại</strong><span>PinkTrip giữ nguyên những hoạt động đã hoàn thành và chỉ sắp xếp phần còn lại.</span></div><div class="change-summary"><h3>Thay đổi dự kiến</h3>' + changes.map((change) => '<div class="change-row"><span class="change-icon" aria-hidden="true">' + (change.kind === 'removed' ? '!' : change.kind === 'moved' ? '↗' : change.kind === 'time' ? '◷' : '✓') + '</span><span>' + escapeHtml(change.title) + ': ' + (change.kind === 'removed' ? (change.reason === 'unavailable' ? 'địa điểm không còn hoạt động' : change.reason === 'skipped' ? 'bỏ qua theo yêu cầu' : 'chưa có chỗ phù hợp') : change.kind === 'moved' ? 'Ngày ' + (change.fromDay + 1) + ' → Ngày ' + (change.toDay + 1) : change.kind === 'time' ? (change.fromTime || '') + ' → ' + change.toTime : 'giữ nguyên') + '</span></div>').join('') + '</div><div class="preview-budget"><span>Ngân sách dự kiến sau điều chỉnh</span><strong>' + money(state.replanPreview.budget?.total) + '</strong><small>' + money(state.replanPreview.budget?.perPerson) + ' mỗi người</small></div><div class="preview-itinerary"><h3>Lịch trình xem trước</h3>' + (state.replanPreview.days || []).map(readonlyDay).join('') + '</div><div class="preview-actions"><button class="button button-ghost" type="button" data-action="cancel-replan">Giữ lịch trình hiện tại</button><button class="button button-primary" type="button" data-action="apply-replan">Áp dụng lịch trình mới</button></div></div>';
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
  if (action === 'toggle-menu') return setMenu(true, target);
  if (action === 'close-menu') return setMenu(false);
  if (action === 'close-modal') return closeAuth();
  if (action === 'close-replan' || action === 'cancel-replan') return closeReplan();
  if (action === 'close-review-modal') return closeReviewModal();
  if (action === 'close-place-reviews') return closePlaceReviews();
  if (action === 'apply-replan') return applyReplan();
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
    return renderPlanner();
  }
  if (action === 'clear-interests') {
    state.draft.interests = [];
    return renderPlanner();
  }
  if (action === 'toggle-place' || action === 'add-stop') {
    const id = target.dataset.id;
    state.draft.selectedPlaceIds = state.draft.selectedPlaceIds.includes(id) ? state.draft.selectedPlaceIds.filter((item) => item !== id) : [...state.draft.selectedPlaceIds, id];
    if (action === 'add-stop') return generate();
    return renderPlanner();
  }
  if (action === 'next-step') {
    if (!state.draft.title || state.draft.endDate < state.draft.startDate) return toast('Hãy kiểm tra tên chuyến đi và ngày đi');
    if (state.step === 1 && !state.draft.selectedPlaceIds.length) return toast('Hãy chọn ít nhất một địa điểm để tạo lịch trình');
    state.step += 1;
    if (state.step === 2) return state.generated && state.generatedSignature === draftSignature() ? renderPlanner() : generate();
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
    const oldSelected = [...state.draft.selectedPlaceIds];
    if (item?.placeId) state.draft.selectedPlaceIds = oldSelected.filter((id) => id !== item.placeId);
    try {
      await normalizeEditor(candidate, state.draft.selectedPlaceIds);
    } catch (error) {
      state.draft.selectedPlaceIds = oldSelected;
      toast(error.message);
    }
  }
}

document.addEventListener('click', async (event) => {
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
  const field = target.dataset.draft;
  if (field) state.draft[field] = target.type === 'number' ? Number(target.value) : target.value;
  const reviewField = target.dataset.reviewField;
  if (reviewField) {
    ensureReviewDraft();
    state.reviewDraft[reviewField] = reviewField === 'rating' ? Number(target.value) : target.value;
  }
  const itemField = target.dataset.itemField;
  if (itemField && state.generated) {
    const item = state.generated.itinerary[Number(target.dataset.day)]?.items.find((entry) => entry.id === target.dataset.item);
    if (item) updateItemField(item, itemField, target.value);
  }
  const replanField = target.dataset.replanField;
  if (replanField && state.replanDraft) state.replanDraft[replanField] = replanField === 'dayIndex' || replanField === 'delayMinutes' ? Number(target.value) : target.value;
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
  const field = target.dataset.draft;
  if (field) {
    state.draft[field] = target.type === 'number' ? Number(target.value) : target.value;
    if (field === 'destinationId') state.draft.selectedPlaceIds = [];
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
    const item = state.generated.itinerary[Number(target.dataset.day)]?.items.find((entry) => entry.id === target.dataset.item);
    if (item) updateItemField(item, itemField, target.value);
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
  const data = Object.fromEntries(new FormData(form));
  if (form.dataset.form === 'auth') {
    try {
      const result = await api('/api/auth/' + data.mode, { method: 'POST', body: data });
      state.user = result.user;
      state.draft = defaultDraft();
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
  if (event.key === 'Escape') {
    if ($('#mobile-nav').classList.contains('is-open')) setMenu(false);
    if (state.replanOpen) closeReplan();
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
    if (state.user) await refreshPlans();
    await applyRoute({ scroll: false });
  } catch (error) {
    toast(error.message);
  }
}

boot();
