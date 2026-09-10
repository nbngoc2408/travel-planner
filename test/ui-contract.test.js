const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');
const styles = fs.readFileSync(path.join(ROOT, 'public/styles.css'), 'utf8');
const index = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
const server = fs.readFileSync(path.join(ROOT, 'src/server.js'), 'utf8');

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

test('landing markup keeps its primary actions balanced and localized', () => {
  assert.equal((index.match(/<button\b/g) || []).length, (index.match(/<\/button>/g) || []).length);
  assert.match(index, /class="skip-link" href="#top"/);
  assert.match(index, /<main id="top" tabindex="-1">/);
  assert.doesNotMatch(index, /TRIP PLANNER|YOUR WAY/);
  assert.match(index, /LẬP KẾ HOẠCH · THEO CÁCH CỦA BẠN/);
});

test('user-facing authentication and fallback errors are localized', () => {
  assert.match(server, /Email hoặc mật khẩu không đúng/);
  assert.match(server, /Đã có lỗi xảy ra\. Vui lòng thử lại\./);
  assert.match(server, /Nội dung JSON không hợp lệ'\), \{ status: 400 \}/);
  assert.doesNotMatch(server, /Email or password is incorrect|Authentication required|Something went wrong|Missing fields|Destination not found|Please log in|Review not found|Method not allowed|Trip not found/);
});
