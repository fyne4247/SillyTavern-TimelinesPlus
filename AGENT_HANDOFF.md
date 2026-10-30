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
