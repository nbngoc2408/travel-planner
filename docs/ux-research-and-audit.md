# PinkTrip — UX research, audit, and iteration record

Date: 2026-09-10
Scope: public landing page, authentication, trip builder, editable itinerary, saved trips, trip details, reviews, responsive behavior, accessibility, and failure/empty/loading states.

## Method

The audit combined live browser inspection at mobile and desktop widths, keyboard and interaction checks, source review, API/data checks, and comparison with current commerce, social, travel-planning, and public design-system patterns. Open Design was checked first but is not configured in this workspace, so the in-app browser and direct UI implementation were used for the design pass.

## Products and patterns reviewed

| Reference | Observed pattern | PinkTrip decision |
| --- | --- | --- |
| [Amazon search and shopping](https://www.aboutamazon.com/news/retail/amazon-makes-it-easier-to-search-and-shop) | Persistent search, clear result count, filter hierarchy, ratings near decisions, one primary card action | Adopt search/filter/result feedback and nearby social proof; reject marketplace density and promotion noise |
| [Amazon keyboard accessibility](https://digprjsurvey.amazon.com/csad/help/node/TNVfdg1IAagUonImNs) | Visible keyboard path and operable controls | Adopt semantic controls, predictable focus, modal focus containment, and non-color selection cues |
| [Shopee search guidance](https://help.shopee.vn/portal/4/article/79283-%5BTh%C3%A0nh-vi%C3%AAn-m%E1%BB%9Bi%5D-C%C3%A1ch-T%C3%ACm-Ki%E1%BA%BFm-S%E1%BA%A3n-Ph%E1%BA%A9m-C%E1%BA%A7n-Mua-Tr%C3%AAn-Shopee?previousPage=other+articles) | Search plus explicit filters; empty/error states point to a next action | Adopt recoverable zero-result and error states; reject flash-sale urgency |
| [Lazada Vietnam](https://www.lazada.vn/) | Strong visual action priority and scannable cards | Adopt card hierarchy; reject dense banners, countdowns, and competing calls to action |
| [Meta account switching](https://about.fb.com/news/2022/09/accounts-center-facebook-and-instagram/) and Instagram sign-in | Focused sign-in surface and clear account alternative | Adopt a single focused auth modal, explicit mode switch, loading state, and destination-aware continuation |
| [Airbnb search](https://www.airbnb.com/help/article/252) and [filters](https://www.airbnb.com/help/article/479) | Decompose the travel query into where/when/who; progressive detail; one obvious search action | Adopt destination/date/traveler grouping and progressive trip steps |
| [Airbnb itinerary places](https://www.airbnb.com/help/article/4192) | Saved places feed a trip plan | Adopt explicit place selection with visible selected count and review context |
| [Wanderlog](https://wanderlog.com/) and [Wanderlog Help](https://help.wanderlog.com/hc/en-us) | Day-by-day itinerary, route context, places/lists, costs, and saved state are separated but connected | Adopt day navigation, compact/detailed views, editable activities, budget summary, reset baseline, and visible save state |
| [TripIt](https://www.tripit.com/web/free) | A trip should read as one coherent source of truth | Adopt a single trip detail surface and a focused “My Trips” library |
| [Booking.com ranking disclosure](https://www.booking.com/content/how_we_work.en-gb.html) | Explain why content is shown and keep ranking understandable | Adopt plain-language recommendation/result counts rather than opaque personalization claims |
| [Google Maps saved trips](https://support.google.com/maps/answer/10271256) | Saved places and trip context remain recoverable | Adopt undo for item removal and a clear reset-to-baseline action |
| [Nielsen Norman Group: progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) | Show essential choices first and reveal advanced work at the right time | Adopt a four-step builder and contextual replan flow; reject putting every setting on the first screen |
| [W3C forms guidance](https://www.w3.org/WAI/tutorials/forms/) | Labels, instructions, errors, and grouping must be programmatic | Adopt connected labels/errors, semantic fieldsets, `aria-invalid`, live regions, and ordered step semantics |
| [Material snackbars](https://m2.material.io/components/snackbars/android) and [bottom sheets](https://m1.material.io/components/bottom-sheets.html) | Brief status with at most one recovery action; mobile actions remain reachable | Adopt an undo snackbar and persistent mobile step actions; avoid stacking multiple transient actions |
| [Android touch target guidance](https://support.google.com/accessibility/android/answer/7101858?hl=en) | Interactive targets should be comfortably tappable | Retain or raise 44px minimum targets for mobile controls |
| [GOV.UK button guidance](https://design-system.service.gov.uk/components/button/) and [patterns](https://design-system.service.gov.uk/patterns/) | Button hierarchy reflects consequence; destructive actions need precise confirmation | Adopt explicit safe/destructive labels and app-controlled alert dialogs |

## Principles adopted

1. Keep the next task visible. On mobile, long selection and planning steps retain a reachable action area.
2. Preserve context across transitions. Every wizard transition returns focus and scroll to the new step heading.
3. Make system state explicit. Generation, normalization, replanning, authentication, review submission, saving, dirty state, and saved state have visible feedback and duplicate-action protection.
4. Make recovery local. Removing an activity offers immediate undo; resetting edits and permanent deletion use precise, separate confirmation language.
5. Keep choice signals redundant. Selected places use shape, text, check marks, and `aria-pressed`, not color alone.
6. Reduce dead ends. Empty search/filter states include an action that clears the actual cause; empty dashboards contain one primary next step.
7. Keep PinkTrip calm. The visual system remains editorial and travel-focused rather than importing marketplace urgency or social-feed mechanics.

## Patterns deliberately rejected

- Promotion grids, countdowns, artificial urgency, and multiple competing primary actions from commerce products.
- Infinite social feeds, public engagement counters, and notification pressure from social products.
- A decorative map without trustworthy coordinates or routing data. PinkTrip keeps route text and day structure rather than inventing geographic precision.
- A mobile bottom navigation bar. The current authenticated information architecture has only a few top-level destinations and the existing compact header/menu remains clearer without another persistent layer.
- Forced onboarding overlays. Contextual helper text and optional inspiration/replan flows are sufficient.
- Auto-saving every itinerary keystroke. Explicit save status protects user intent and avoids implying persistence before the server accepts changes.

## Baseline audit

No P0 data-loss, security, or fully blocking navigation defect was found.

### P1 — high impact

- Wizard steps inherited the previous page scroll position, often opening a new step with its heading and instructions above the viewport.
- The step-two continuation action could be more than a screen away on mobile when browsing a long catalog.
- The itinerary stacked header, day navigation, and action controls near the top, leaving too little reading space on small screens.
- Generation, save, replan, sign-in, and review submission did not consistently prevent repeated submission or communicate progress.
- Trip and review deletion relied on the browser's native confirmation prompt, which broke visual consistency and offered weaker focus control.

### P2 — important polish and clarity

- Empty dashboard repeated the same create CTA and showed “view all” when there were no trips.
- Wizard step status depended too heavily on color and was not represented as an ordered progress structure.
- The itinerary did not clearly distinguish unsaved edits from a saved baseline; reset appeared actionable even when nothing had changed.
- Activity removal had no local undo.
- Some customer-facing place descriptions, notes, and area labels mixed English into the Vietnamese interface.
- Review filters lacked a direct clear action, including on a zero-result screen.
- Page title stayed fixed across SPA routes.
- Modal background content was not inert even though focus trapping existed.
- A place search with zero results offered to clear interests but left the search query in place.
- Starting account creation from “create trip” did not retain the user's intended destination after authentication.

## Iteration 1 changes

- Added semantic ordered step progress with completed/current markers.
- Added per-field step-one validation, associated inline errors, and focused recovery.
- Added scroll/focus restoration on every builder transition.
- Added mobile persistent builder actions and moved itinerary actions to the bottom on small screens.
- Added loading and duplicate-action guards for generation, itinerary normalization, replanning, saving, authentication, and review submission.
- Added explicit draft/dirty/saved itinerary status and disabled reset when there is nothing to restore.
- Added one-action undo after activity removal.
- Replaced native deletion prompts with accessible app alert dialogs that default focus to the safe choice.
- Made modal background regions inert and locked background scrolling.
- Simplified the empty dashboard and improved zero-result recovery for places and reviews.
- Preserved the create-trip destination through registration; ordinary sign-in now lands on the dashboard.
- Added route-specific document titles and reduced-motion behavior.
- Standardized visible catalog descriptions, notes, item names, and “day trip” labels in Vietnamese.

## Iteration 2 changes

The second critique concentrated on states that only appeared after exercising realistic data and long journeys:

- Kept the active day visible in the horizontal navigator and stopped day jumps from rebuilding the whole editor, preserving focus and scroll context on a ten-day trip.
- Raised compact/detailed toggles, day chips, and inline time fields to a 44px minimum touch target.
- Refined the mobile itinerary action tray into two secondary actions plus one full-width primary action, while retaining the saved/unsaved status.
- Fixed review-filter clearing when the current route contained a query string.
- Made the mobile menu background inert and restored focus on close, matching the modal behavior.
- Added a skip link and focusable main region; removed the temporary visual outline from programmatically focused step headings.
- Localized service types, authentication/fallback errors, destination weather, and the remaining catalog descriptions.
- Removed a duplicated fallback phrase in replan change summaries and verified the safe choice receives initial focus in reset/delete dialogs.

## Final verification

- `npm run lint`, `npm test`, and `npm run build` pass; 39 automated tests cover planning math, persistence, ownership, long trips, data quality, error copy, and critical UI contracts.
- Responsive browser checks pass at 375, 390, 430, 768, 1024, 1280, and 1440px with no horizontal overflow. A 430px touch-target audit found no visible interactive control below 44px.
- A complete browser journey passed: register/sign in, retain selected destination, create/generate/save/reopen/edit/reset/undo/replan, review create/edit/filter/delete, log out/in, and handle missing resources and invalid credentials.
- A ten-day plan with 40 selected places, 39 scheduled activities, and 11 navigation chips rendered in both detailed and compact views. Jumping to day 10 revealed and retained the active chip.
- Keyboard checks passed for date selection, Escape dismissal, modal focus wrapping/restoration, mobile menu dismissal, and the skip link. Modal background regions are inert while overlays are open.
- Browser console remained free of errors and warnings during the final journeys. JSON parsing, source scans, `git diff --check`, server-error localization, and the final clean-room audit pass.

No meaningful P0, P1, or important P2 issue identified in the audited scope remains open. A real map continues to be deliberately omitted until PinkTrip has trustworthy coordinate and routing data.

## Pre-commit risk review

A separate review before commit found and resolved four regression risks:

- Overlapping itinerary recalculation requests could discard the latest inline edit. Requests now share a context/version guard, permit the newest request to win, and invalidate safely when the user resets or leaves the editor.
- Smooth scrolling could briefly mark “Tổng quan” and a day as active at the same time. Overview/day state is now mutually exclusive, including after scroll synchronization settles.
- A nested review/delete dialog could overwrite the original focus-return target. Place-review focus now has its own preserved trigger and returns to the originating rating control.
- Mobile spacing depended on the CSS `:has()` selector. The planner now applies an explicit state class, reducing browser-compatibility risk.

Targeted browser smoke tests confirmed mutually exclusive navigation state, restored focus after nested dialogs, unlocked background content after modal-to-page navigation, and successful itinerary recalculation with visible dirty state.

## Visual evidence

- [Landing page — desktop](screenshots/pinktrip-home-desktop.jpg)
- [Landing page — mobile](screenshots/pinktrip-home-mobile.jpg)
- [Place selection — mobile](screenshots/pinktrip-planner-mobile.jpg)
- [Ten-day itinerary editor — mobile](screenshots/pinktrip-long-editor-mobile.jpg)
