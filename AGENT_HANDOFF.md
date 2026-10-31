# Timeline UI refresh

Requested: preserve chat layout, center the first node and graph, mark the newest message in the actual open chat, keep expanded messages onscreen, add a portrait header, and toggle the panel from the chat top bar.

Branch: staging. Baseline: see parent of the UI refresh commit. No preexisting uncommitted changes were present. No merge to main, push, deployment, or live installation change is authorized or performed.

Implemented in index.js, tl_view.js, tl_style.css:
- Floating panel no longer overrides #sheld geometry.
- Symmetric graph space centers the root, with auto margins for smaller charts.
- Only the open file's latest message gets the glow; other chat endpoints do not. You are here returns to that file and scrolls to its marker.
- Selected message appears in a bounded, scrollable card below the graph, independent of graph zoom and node coordinates.
- Theme-based compact controls, portrait header, focus outlines, and constrained hover previews.
- Top-bar button closes either presentation when already open.

Verification: all 10 existing model tests passed; JavaScript syntax and git diff whitespace checks passed. Source self-review completed. No independent reviewer was used (routine task, no phase workflow). Browser/live SillyTavern visual checks are pending; local Playwright is not installed. Existing tests validate chart data, not rendered geometry.

## NEXT ACTION
Verify visually in SillyTavern with a branched chat: compare chat geometry before/after opening, toggle the top-bar button twice, check root centering and current marker, open a bottom/right message, zoom, and use You are here. Check narrow screens and pop-out mode. Do not push or deploy without owner authorization.

## Follow-up: family filtering and chat switches

Removed shared-opening inference: familyOf now follows saved main_chat and bookmark_link relationships transitively in both directions. Separate chats sharing even identical text remain separate without a saved link. Older imported/copied branches without relationship metadata will appear as separate chats rather than guessed branches.

CHAT_CHANGED now reloads a visible timeline using the newly open chat, preserves pop-out presentation, and invalidates outstanding loads when hidden. Changing active files clears expanded-node and selected-message state, including when the new chat is empty.

Verification: 11 model tests pass, including a new regression covering independent identical chats, siblings, grandchildren, and checkpoint links. Syntax checks and diff whitespace checks pass. Live chat-switch and visual verification still pending. Changes remain on staging; no main merge, push, or deployment.

NEXT ACTION: Verify switching between an independent chat and a saved branch while the timeline is docked and popped out. Confirm that old asynchronous loads do not replace the new chat, and that imported branches without metadata remain separate as intended.

## Owner-authorized integration and publication

Owner explicitly requested merging all work and pushing. The default branch is master (there is no main branch). Refreshed origin; master was an ancestor of staging. Fast-forwarded master from 03f7434 to 802113c, including all eight staging commits. Reviewed the changes from this session and publication file list; private fixture chats and browser outputs remain ignored. Re-ran all 11 model tests successfully, checked JavaScript syntax, and checked whitespace. Live UI verification remains pending; this is not a claim of browser validation.

NEXT ACTION: Push master and staging to origin after saving this record, then verify remote refs. Do not deploy or modify a live installation; that was not requested.

## Startup repair

Live read-only inspection found the installed extension at data/default-user/extensions/SillyTavern-TimelinesPlus on the local running SillyTavern. index.js hardcoded the older SillyTavern-Timelines folder for timeline.html. Verified HTTP 404 at that old URL and HTTP 200 at the actual Plus URL. Changed template resolution to new URL('./timeline.html', import.meta.url).href so installation folder names do not matter. All 11 model tests, syntax, and whitespace checks pass. This diagnosis is HTTP/source verified, not browser verified.

NEXT ACTION: Validate startup after refreshing SillyTavern. Keep chat data untouched. Publication of this follow-up is separate from the previous completed push.

## Compact dock, message viewers, and navigation

Current work on staging, based on 041657b. Owner requested flush right docking, a smaller docked reader, a vertical pop-out reader, double-click collapse, larger zoom, alternating branch directions, a saved scroll-to-zoom toggle, icon toolbar, square inline portrait, maximum zoom on You are here, and no hover previews while the reader is open.

Implemented:
- Dock sits at top/right/bottom zero, square corners, 420px wide, without overriding chat geometry. Pop out remains an explicit alternate presentation; Dock toolbar action returns to the edge.
- Docked reader capped at the smaller of 190px or 24% of panel height. Pop-out reader occupies a right-hand column; narrow screens use a small bottom reader.
- Double-click toggles the clicked run's expanded state. Single-click still selects a message and expands its run where applicable; delayed slightly to distinguish double-click.
- Maximum zoom increased from 2.5 to 5; You are here restores the actual open chat, zooms to 5, and centers its current node. Wheel zoom anchors to the pointer and is off by default; checkbox persists in extension settings.
- Fork lanes alternate positive/negative around the main path. Header portrait is 32px square, aligned with icon controls. Icons have labels for accessibility and title tooltips. Hover previews are suppressed whenever a message viewer is selected.

Verified: 12 model tests pass, including lane alternation; syntax and whitespace checks pass. Added tests/browser-smoke.mjs and dev/ui-fixture.html using only synthetic data. Isolated headless Chromium smoke checks pass for edge alignment, unchanged chat geometry, square portrait, expand/collapse via double-click, docked reader cap, hover suppression, 5x current-node focus, wheel toggle, pop-out side reader, narrow viewport, and no page errors. Used existing cached Node Playwright and Chromium through PLAYWRIGHT_MODULE and PLAYWRIGHT_EXECUTABLE; Python Playwright is not installed. Verified all chosen icon names exist in the installed SillyTavern Font Awesome CSS. Screenshot visually inspected using synthetic data. No live chat/browser verification performed.

NEXT ACTION: Present the staging change for owner review. Do not merge this UI follow-up to master, push, or deploy without owner authorization. Installed copy remains at 041657b; refreshing it will not show this new UI yet.

## UI follow-up approved for merge and push

Owner explicitly requested merging to the main branch and pushing. The repository default is master. Origin refreshed with no new divergence; clean working copy and fast-forward integration available. Previous verification remains valid: 12 passing model tests, passing isolated browser smoke checks, JavaScript syntax and whitespace checks. Integration includes startup repair 041657b and UI follow-up 4b83d5d.

NEXT ACTION: Fast-forward master and staging to this record, push both to origin, and verify remote refs. Installed copy remains at 041657b; this authorization is for merge/push, not live deployment.
