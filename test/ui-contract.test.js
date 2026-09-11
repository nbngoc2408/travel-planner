const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');
const styles = fs.readFileSync(path.join(ROOT, 'public/styles.css'), 'utf8');
const index = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
const server = fs.readFileSync(path.join(ROOT, 'src/server.js'), 'utf8');
const dayNavigation = require(path.join(ROOT, 'public/itinerary-navigation.js'));

test('day navigator has one exclusive current location for overview and every day', () => {
  for (const selected of [null, 0, 1, 2]) {
    const navigation = dayNavigation.navigationState(selected, 3);
    const selectedCount = Number(navigation.overviewActive) + [0, 1, 2].filter((index) => index === navigation.activeDay).length;
    assert.equal(selectedCount, 1);
  }
  assert.deepEqual(dayNavigation.navigationState(null, 3), { activeDay: null, overviewActive: true });
  assert.deepEqual(dayNavigation.navigationState(1, 3), { activeDay: 1, overviewActive: false });
  assert.equal(dayNavigation.activeDayIndex(-1, 3), null);
  assert.equal(dayNavigation.activeDayIndex(3, 3), null);
  assert.equal(dayNavigation.activeDayIndex(1, 0), null);
});

test('day navigator source keeps overview, reset, and replan state valid', () => {
  assert.match(index, /<script src="\/itinerary-navigation\.js"><\/script>/);
  assert.match(app, /activeItineraryDay: null/);
  assert.match(app, /const navigation = dayNavigation\.navigationState\(state\.activeItineraryDay, days\.length\)/);
  assert.match(app, /navigation\.overviewActive \? 'location' : 'false'/);
  assert.match(app, /state\.activeItineraryDay = null;\n  updateItineraryOverviewNavigation/);
  assert.match(app, /const activeDay = dayNavigation\.activeDayIndex\(state\.activeItineraryDay, restored\.itinerary\.length\)/);
  assert.match(app, /state\.activeItineraryDay = dayNavigation\.activeDayIndex\(state\.activeItineraryDay, preview\.days\.length\)/);
  assert.match(app, /function revealItineraryChip\(chip\)/);
  assert.match(app, /const dayCount = document\.querySelectorAll\('\[data-itinerary-day\]\[id\^="/);
  assert.match(app, /const activeDay = dayNavigation\.activeDayIndex\(Number\(dayIndex\), dayCount\);/);
  assert.match(app, /if \(activeDay === null\) return;/);
  assert.match(app, /event\.detail > 0 && target\.classList\.contains\('itinerary-nav-chip'\)\) target\.blur\(\);/);
  assert.match(app, /function pauseItineraryScrollSync\(\)/);
  assert.match(app, /if \(itineraryScrollSyncPaused\) return;/);
  assert.match(app, /workspace === 'editor' && window\.matchMedia\('\(min-width: 768px\)'\)\.matches \? 240 : 180/);
  assert.match(app, /window\.addEventListener\('scrollend', resumeItineraryScrollSync/);
  assert.doesNotMatch(app, /active \? 'step' : 'false'/);
  assert.match(styles, /\.itinerary-nav-chip:hover:not\(\[aria-current="location"\]\)/);
  assert.match(styles, /\.itinerary-nav-chip\.active,\.itinerary-nav-chip\[aria-current="location"\]/);
  assert.match(styles, /@media \(min-width:768px\)\{\.itinerary-editor-panel \.timeline-day\{scroll-margin-top:220px\}\}/);
  assert.doesNotMatch(styles, /body\{min-width:320px/);
});

test('critical planning states remain explicit and recoverable', () => {
  assert.match(app, /aria-label="Tiến trình tạo chuyến đi"/);
  assert.match(app, /Có thay đổi chưa lưu/);
  assert.match(app, /Đã đồng bộ với bản đã lưu/);
  assert.match(app, /actionLabel: 'Hoàn tác'/);
  assert.match(app, /data-action="clear-place-filters"/);
  assert.match(app, /role="alertdialog"/);
  assert.match(app, /window\.location\.pathname \+ window\.location\.search !== path/);
  assert.match(app, /function updateItineraryNavigation\(/);
  assert.match(app, /function updateItineraryOverviewNavigation\(/);
  assert.match(app, /requestContext !== itineraryRequestContext \|\| requestVersion !== itineraryMutationVersion/);
  assert.match(app, /function resetItineraryNormalization\(/);
  assert.doesNotMatch(app, /function normalizeEditor\([\s\S]*?if \(state\.itineraryBusy\) return;/);
  assert.match(app, /action === 'skip-to-content'/);
  assert.match(app, /function navigateReviews\([\s\S]*?setOverlayState\(false\);[\s\S]*?return navigate\(reviewPath\(filters\)\)/);
  assert.match(app, /openPlaceReviews\(placeId, \{ preserveTrigger = false \} = \{\}\)/);
  assert.match(app, /restoreFocus && placeReviewTrigger instanceof HTMLElement/);
  assert.doesNotMatch(app, /window\.confirm\s*\(/);
});

test('responsive controls retain reachable actions and reduced-motion support', () => {
  assert.match(styles, /\.planner-card\.has-persistent-actions\{padding-bottom:108px\}/);
  assert.match(styles, /\.planner-actions-persistent\{position:fixed/);
  assert.match(styles, /\.itinerary-editor-panel>\.itinerary-sticky-actions\{top:auto;bottom:/);
  assert.match(styles, /\.review-read-more\{min-height:44px/);
  assert.match(styles, /\.pagination-pages\{justify-content:flex-start;gap:4px;overflow-x:auto/);
  assert.match(styles, /\.toast button\{min-height:44px/);
  assert.match(styles, /@media \(prefers-reduced-motion:reduce\)/);
  assert.match(styles, /#planner-card\{scroll-margin-top:88px\}/);
});

test('replan selectors use an accessible responsive picker instead of browser popups', () => {
  assert.match(app, /function replanSelectOptions\(/);
  assert.match(app, /function renderReplanPicker\(/);
  assert.match(app, /function positionReplanPicker\(/);
  assert.match(app, /const previousModalScrollTop = document\.querySelector\('\.replan-modal'\)\?\.scrollTop \|\| 0/);
  assert.match(app, /nextModal\.scrollTop = modalScrollTop/);
  assert.match(app, /role="listbox"/);
  assert.match(app, /role="option" aria-selected=/);
  assert.match(app, /data-action="select-replan-option"/);
  assert.match(app, /state\.replanOpen && state\.replanPicker/);
  assert.match(app, /window\.addEventListener\('resize', \(\) => \{ if \(state\.replanPicker\) positionReplanPicker\(\); \}\)/);
  assert.doesNotMatch(app, /<select id="replan-(type|day|item)"/);
  assert.match(styles, /\.replan-select-trigger\{[^}]*min-height:52px/);
  assert.match(styles, /\.replan-picker-dialog\{[^}]*position:fixed/);
  assert.match(styles, /\.replan-picker-option\{[^}]*min-height:52px/);
  assert.match(styles, /\.replan-picker-option\[aria-selected="true"\]/);
  assert.match(styles, /\.replan-picker-backdrop\{display:flex;align-items:flex-end/);
  assert.match(styles, /env\(safe-area-inset-bottom\)/);
  assert.match(styles, /\.replan-modal\{overflow-anchor:none\}/);
});

test('mobile day-move control uses an accessible picker and stays touch-sized', () => {
  assert.match(app, /movePicker: null/);
  assert.match(app, /function renderMoveDayPicker\(/);
  assert.match(app, /data-action="open-move-day-picker"/);
  assert.match(app, /data-action="select-move-day-option"/);
  assert.match(app, /role="listbox" aria-label="Ngày đích"/);
  assert.doesNotMatch(app, /<select class="move-select"/);
  assert.match(app, /data-short-label="N' \+ \(dayIndex \+ 1\) \+ '"/);
  assert.match(styles, /\.move-select\{min-width:0\}/);
  assert.match(styles, /\.move-select-trigger\{display:flex;align-items:center;justify-content:space-between/);
  assert.match(styles, /\.timeline-controls \.icon-button\{flex:0 0 44px\}/);
  assert.match(styles, /@media \(min-width:768px\) and \(max-width:1023px\)\{\s*\.editable-item \.timeline-controls\{grid-column:1\/-1;grid-row:2/);
});

test('landing markup keeps its primary actions balanced and localized', () => {
  assert.equal((index.match(/<button\b/g) || []).length, (index.match(/<\/button>/g) || []).length);
  assert.match(index, /class="skip-link" href="#top"/);
  assert.match(index, /<main id="top" tabindex="-1">/);
  assert.doesNotMatch(index, /TRIP PLANNER|YOUR WAY/);
  assert.match(index, /LẬP KẾ HOẠCH · THEO CÁCH CỦA BẠN/);
});

test('landing hero artwork keeps the rotated postcard inside its mobile frame', () => {
  assert.match(styles, /@media \(max-width:767px\)\{\s*\.hero-art\{height:clamp\(410px,96vw,470px\);min-height:410px\}\s*\}/);
});

test('user-facing authentication and fallback errors are localized', () => {
  assert.match(server, /Email hoặc mật khẩu không đúng/);
  assert.match(server, /Đã có lỗi xảy ra\. Vui lòng thử lại\./);
  assert.match(server, /Nội dung JSON không hợp lệ'\), \{ status: 400 \}/);
  assert.doesNotMatch(server, /Email or password is incorrect|Authentication required|Something went wrong|Missing fields|Destination not found|Please log in|Review not found|Method not allowed|Trip not found/);
});
