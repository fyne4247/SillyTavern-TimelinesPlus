# Timelines handoff

This is a read of the extension as it was on `master` (`03f7434`, version 1.2.0). The `staging` branch replaces that UI. `PLAN.md` is the current design. `dagre.js`, `tl_node_data.js`, `tl_graph.js`, and `tl_style.js` are not in `staging`.

The repo is a fork of [SillyTavern/SillyTavern-Timelines](https://github.com/SillyTavern/SillyTavern-Timelines). Behavior below is from that older source, plus timings run locally against the Dagre 0.8.5 that shipped with it.

The short version: opening the timeline on a long or heavily branched character blocks the browser on a synchronous graph layout. Past roughly 1,200–1,400 messages in one path, that layout throws `RangeError: Maximum call stack size exceeded` in the Dagre shipped with this repo. Building the data is cheap next to that. A render cache would not remove the crash.

## What the extension is

Timelines draws every chat of the current character (or group) as one directed graph.

- One node per distinct message text at a given depth. Depth is the message index in the file. The same text at the same index in several files becomes one node. The same text at two different indexes stays two nodes, so the graph stays a DAG even when a quick reply is reused.
- A root node stands for the character. It is not a message.
- Swipes are extra nodes, hidden until a long-press, the toolbar button, or the auto-expand setting.
- Checkpoints (older name: bookmarks) are messages whose `extra.bookmark_link` still points at a chat file that exists. The path from that node back toward the root is painted in a color hashed from the message text.
- The picture is a Cytoscape canvas laid out by Dagre. Default direction follows the viewport: left-to-right when the window is wider than it is tall, top-to-bottom otherwise. A toolbar button flips it.

SillyTavern loads `index.js` and `tl_style.css` from `manifest.json`. `index.js` then injects the libraries and the modal markup.

The script path is hardcoded:

```text
scripts/extensions/third-party/SillyTavern-Timelines/
```

The folder on disk has to be named `SillyTavern-Timelines`, or the Cytoscape, Dagre, and Tippy tags 404. This checkout is named `SillyTavern-TimelinesPlus`. That only matters if SillyTavern is pointed at this directory under the Plus name.

Requires SillyTavern `>= 1.10.4` (see `README.md`). The host is expected to provide `getContext`, `openCharacterChat`, `createBranch`, `eventSource`, `showdown`, `toastr`, and jQuery.

## What happens when you press Show Timeline

`#show_timeline_view` and the slash command `/tl` both call `onTimelineButtonClick` in `index.js`. `/tl r` clears `lastContext` first so the next open refetches.

1. `showLoader()` runs.
2. `updateTimelineDataIfNeeded()` runs. If `lastContext` is empty or its `characterId` differs, it fetches every chat for the character and builds a Cytoscape element list. The result is kept on `lastTimelineData`. A fresh `layout` object is filled from settings (Dagre, default ranker `tight-tree`, default rank direction `LR`).
3. The loader is hidden. `await delay(1)` is there so the spinner does not stick when nothing was fetched (commit `31bbf3a`).
4. The modal is moved from `.timelines-modal-storage` onto `document.body` and shown.
5. If step 2 rebuilt data, `renderCytoscapeDiagram` styles the elements, constructs Cytoscape (this runs Dagre once), and binds events. The first `render` event then calls `setGraphOrientationBasedOnViewport`, which runs Dagre a second time.
6. After 500 ms the search box is focused and `zoomToCurrentChatNode` pans to whatever node has the same text as the last message of the open chat.

The expensive part, the layout, starts after the loader is gone. A multi-second layout is a frozen tab. Chrome will offer to kill the page. A layout that overflows the stack is an exception thrown out of the click handler, with the modal already open.

Opening again for the same character reuses `lastTimelineData` and the existing Cytoscape instance, so the second open is cheap until something sets `lastContext = null`. These do that:

- Any Timelines setting change (`onInputChange`).
- `CHARACTER_MESSAGE_RENDERED`, `USER_MESSAGE_RENDERED`, `CHAT_DELETED`, `MESSAGE_SWIPED`.
- `/tl r`.
- The listener registered as `event_types.CHATLOADED`. That name is flagged in the source as possibly wrong. Current SillyTavern uses `CHAT_CHANGED`. If the constant is missing, this listener does nothing.

Those listeners are attached inside `setupEventHandlers`, which runs on every rebuild, and they are never removed. A rebuild also calls `cytoscape({ container })` again without `cy.destroy()`. The old graph, its canvas, and its listeners stay alive. The second open after any chat activity is a second full fetch plus a second full layout, on top of the first graph.

`lastContext` stores the `characterId` from that visit. It does not store the open chat file or the message count. Switching chats on the same character does not, by itself, refresh the graph.

## How the graph is built

`fetchData` (`tl_node_data.js`) POSTs the character avatar to `/api/characters/chats`. That response is a list of chat descriptors (`file_name`, and whatever else the server sends, typically a message count and a last-message preview). The extension only reads `file_name`.

`prepareData` then, one file after another, POSTs `/api/chats/get` (or `/api/chats/group/get` for a group) with `cache: 'no-cache'`. For a solo character the first array element is chat metadata and is discarded. The rest is the message list. Files that fail the request are skipped.

There is no parallelism and no use of the descriptor list to skip unchanged files.

`convertToCytoscapeElements` then:

1. `preprocessChatSessions` transposes files into buckets by message index.
2. `buildGraph` walks those buckets.
   - Messages in a bucket are grouped by the full string `message.mes` (newlines normalized, and the message object is mutated).
   - Each distinct string becomes a node via `createNode`. The node keeps the full text, the depth, user/character/system flags, a send date, and a map of `{file_name: {messageId, length}}` for every file that contains it.
   - Each file in the group also emits an edge from that file's previous node to this node. The edge is emitted even when another file in the group already emitted the same parent and the same child. Ten copies of one chat become ten parallel edges on every hop, and ten attempts to insert the same node id.
   - Swipe texts (except on depth 0, the greeting) are deduped and stored on the parent as `storedSwipes`. They are not added to the graph yet. Greeting alternates are left as normal nodes, matching the UI where first-message swipes are alternate greetings.
3. `postprocessNodes` returns its input unchanged.

Cytoscape  (the bundle in `cytoscape.min.js`) refuses a second element with an id that already exists. It logs `Can not create second element with ID ...` and continues. The duplicate node inserts are dropped. The duplicate edges have unique ids (`edge${keyCounter}`), so they stay. A character with many saved branches of one long chat produces a skinny graph with a thick bundle of edges along the shared prefix.

Checkpoints: `createNode` treats a message as a checkpoint when `extra.bookmark_link` is set, or when an old system line contains `Bookmark created! Click here to open the bookmark chat`. If `bookmarkName.jsonl` is not in the fetched set, the link is dropped. The checkpoint color is `generateUniqueColor(text)` where `text` is the message body. The README says the color comes from the checkpoint name. The code hashes the message.

`setupStylesAndData` (`tl_style.js`) then walks every checkpoint and paints the path to the previous checkpoint or the root. Each step does `Object.values(rawData).find(...)` over the whole element list. With a handful of checkpoints this is tens of milliseconds (measured: 20,000 elements, 10 checkpoints, depth 1,500, about 36 ms). It becomes a real cost only when a long path is searched through a huge parallel-edge list. It is not the open-time failure.

## How it is drawn and used

`initializeCytoscape` mounts Cytoscape on `#timelinesDiagramDiv` with the Dagre layout from settings. Plugins registered on every init: `cytoscapeDagre`, `cytoscapeContextMenus`, `cytoscapePopper`. Nothing in this repo ever builds a context menu. The context-menu script and CSS are unused.

Default style (`tl_style.js` plus settings):

- Nodes are 25×25 ellipses. User and character colors come from settings, or from the SillyTavern theme when "Use UI Theme" is on.
- A node with swipes gets a double border (and, if scaling is on, a logarithmic size bump).
- A checkpoint node gets a thick border. Edges along its path use the hashed color and a width that grows slightly toward the root.
- Edges default to Cytoscape's `taxi` curve, aimed rightward until the orientation flip sets them downward.
- The root can show the character avatar.

`cy.ready` fills `#legendDiv` with one row per character name and one row per checkpoint color, unless the legend is off. Hover and click on a row dim everything else by setting `opacity` on every element.

Interactions wired in `setupEventHandlers`:

| Gesture | Result |
| --- | --- |
| Hover a node | After 250 ms, a Tippy with the speaker and the first ~100 characters. Connected edges get an underlay. |
| Click a node | Full info panel: name, date, swipe count, one button row per containing chat (previous, next, open, branch), then the message rendered through Showdown. |
| Click the same node again | Panel closes. |
| Double-click | Opens the first chat in the node's map at that message. A swipe on a non-last message creates a branch, because SillyTavern only exposes swipes on the last message. |
| Long-press | Inserts or removes that node's stored swipe nodes, then runs Dagre again. |
| Click an edge | Pans to the endpoint farther from the click and opens its panel. |
| Click the background | Closes the panel and clears highlights. |
| Toolbar | Rotate, toggle all swipes, reload, zoom to fit, zoom to current chat. |
| Search | Fragment search (whitespace-separated pieces, all must match, order ignored). Matches are undimmed and the viewport fits them. Ctrl+Shift+F focuses the box. Escape closes the modal. |

The full-info actions call `navigateToMessage` in `tl_utils.js`. That opens the chat with `openCharacterChat`, forces hidden messages visible (SillyTavern lazy-loads the transcript), scrolls to `mesid`, and optionally calls `createBranch` from SillyTavern's `bookmarks.js`. Swipe changes on the last message are applied in `goToSwipe` by rewriting `swipe_id`, `mes`, `send_date`, and `extra`, then `addOneMessage` and a debounced save. Branching and swiping write chat files. Everything else in the modal is a view.

`zoomToCurrentChatNode` selects every node whose full `msg` equals the live chat's last message. Merged endings and short repeated lines ("Okay.", "...") select more than one node. The flash class `NoticeMe` is applied to the whole collection.

Min zoom defaults to 0.1 and max zoom to 3. A thousand ranks at the default 50 px separation is on the order of 75,000 px. Fitting that into the modal wants a zoom near 0.02, which the min zoom will not allow. The user cannot zoom out to the whole timeline. That is a navigation bug sitting on top of the layout cost.

The modal (`tl_style.css`) is a fixed 90vw × 90vh layer with `backdrop-filter: blur(...)`. That blur is paid on every composite while the canvas is also redrawing. It makes a heavy frame heavier. It is not what overflows the stack.

## File guide

### Extension source

`manifest.json`
SillyTavern manifest. Display name "Timelines", `loading_order` 9, entry `index.js`, stylesheet `tl_style.css`, version 1.2.0, `auto_update` true, homepage pointed at the upstream repo.

`index.js` (~1,850 lines)
The application. Loads vendor assets by injecting tags. Owns settings, the modal lifecycle, Cytoscape setup, tooltips, the legend, search, hotkeys, and the slash command.

Settings live in `extension_settings.timeline` and are mirrored onto the controls in `timeline.html`. Defaults worth knowing when reading a bug: node 25×25, rank separation 50, ranker `tight-tree`, curve `taxi`, align `UL`, swipes collapsed, avatar as root, legend on, custom colors (not the UI theme), min zoom 0.1, max zoom 3, zoom-to-current 1.0, GPU acceleration on for the info panel.

Important functions:

- `loadSettings` / `onInputChange` — persist settings. Every change nulls `lastContext`, so the next open refetches and rebuilds.
- `onTimelineButtonClick` / `slashCommandHandler` — open and reload.
- `updateTimelineDataIfNeeded` — the fetch gate and the Dagre options object.
- `renderCytoscapeDiagram` / `initializeCytoscape` — style, construct, bind.
- `setupEventHandlers` — DOM and Cytoscape listeners, and the second layout via the `render` event.
- `toggleSwipes` / `refreshLayout` / `fixRootNodePosition` — swipe nodes and a manual nudge so the root sits next to the first greeting instead of far from a wide rank. `fixRootNodePosition` assumes at least one edge leaves the root.
- `makeTippy` / `makeNodeTippy` / `makeTapTippy` / `formatNodeMessage` — hover card and the click panel. `formatNodeMessage` builds a new Showdown converter per call and runs it on the full message when the panel opens.
- `createLegend` / `highlight` helpers / `performTextSearch` — dim-everything highlighting. Search and legend both call `cy.elements().style(...)`, which restyles the whole graph.
- `zoomToCurrentChatNode` / `flashNode` / `filterElementsAndPad`.
- `processTimelinesHotkeys` — only while the modal is visible. The comment in the function is right that SillyTavern's own keydown handler has often already run, so arrow keys can still change swipes in the chat underneath.

`tl_node_data.js`
Fetch plus graph construction, as above. Also the seeded RNG (`cyrb128` + `sfc32`) used for checkpoint colors.

`tl_style.js`
Cytoscape stylesheet factory, checkpoint path painting, and the dim/undim helpers. Reads `power_user` colors when "Use UI Theme" is on. Checkpoint border color in that mode is hardcoded gold.

`tl_graph.js`
Orientation toggle (`LR` / `TB`) and the fragment search used by the box. `setOrientation` always calls `cy.layout(layout).run()`. `getNodeDepth` walks parents one at a time and is not called anywhere else in the repo.

`tl_utils.js`
`navigateToMessage`, `goToSwipe`, modal open/close, Tippy cleanup, `closeOpenDrawers`. The drawer helper looks for `.openDrawer`, which this extension does not use. A comment in the file already questions whether the call does anything.

`timeline.html`
The settings drawer (tooltips, style, color, zoom, spacing, ranker, shape, curve, alignment, reset) and the modal skeleton: close, rotate, expand swipes, reload, zoom-to-fit, zoom-to-current, search box, `#timelinesDiagramDiv`, `#legendDiv`. Injected into `#timelines_container` or, failing that, `#extensions_settings`.

`tl_style.css`
Modal, toolbar buttons, legend, search field, Tippy panel. The graph itself is drawn by Cytoscape on a canvas, not by this CSS.

`README.md`
User-facing description of merge-by-text, swipes, checkpoints, and the gestures. A few details disagree with the code (checkpoint color source, above).

### Vendored libraries

These are loaded on every SillyTavern page once the extension is installed, not only when the modal opens.

| File | Role |
| --- | --- |
| `cytoscape.min.js` (361 KB) | Graph, canvas, hit testing, zoom. Global `cytoscape`. |
| `dagre.js` (323 KB, unminified, version 0.8.5) | Layered layout. Global `dagre`. This is the file that freezes and crashes. |
| `cytoscape-dagre.js` and `cytoscape-dagre.min.js` | Adapter. `index.js` loads the minified one after `dagre.js`. The unminified adapter is unused. |
| `cytoscape-popper.min.js` | Positioning for Tippy. Used. |
| `tippy.umd.min.js`, `tippy.css` | Tooltips and the info panel. Used. |
| `light.min.css`, `material.min.css`, `light-border.min.css`, `translucent.min.css` | Tippy themes. Loaded. The extension does not pass a `theme` option into `tippy()`, so the panel look comes mainly from `tl_style.css`. |
| `cytoscape-context-menus.min.js`, `cytoscape-context-menus.min.css` | Loaded and `cytoscape.use`'d. No menu is created. |
| `LICENSE` | MIT. |

## Why a big chat freezes or crashes

Measured with Node 26 on this machine, calling the vendored `dagre.layout` the same way `cytoscape-dagre.js` does: multigraph, `rankdir: 'LR'`, `ranker: 'tight-tree'`, `acyclicer: 'greedy'`, node size 25×25, the default separations. Numbers are one layout. The extension runs two of them on every fresh open, and then Cytoscape still has to style and paint.

Longest path is what overflows. `tight-tree` is implemented as `longestPath` plus a feasible tree (`dagre.js` around the `tightTreeRanker` function). `longestPath` is a recursive DFS:

```javascript
function dfs(v) {
  // ...
  var rank = _.min(_.map(g.outEdges(v), function(e) {
    return dfs(e.w) - g.edge(e).minlen;
  }));
  // ...
}
```

One stack frame chain per rank. A chat is a chain of ranks, one per message, plus the root.

| Graph | Nodes | Edges | Result |
| --- | ---: | ---: | --- |
| One chat, 800 messages | 800 | 799 | 0.6 s |
| One chat, 1,000 messages | 1,000 | 999 | 0.9 s |
| One chat, 1,200 messages | 1,200 | 1,199 | 1.5 s |
| One chat, 1,400 messages | 1,400 | 1,399 | **crash**, `Maximum call stack size exceeded` |
| One chat, 2,000 or 3,000 messages | | | **crash**, same error |
| 1,000 ranks, 10 parallel edges per hop | 1,000 | 9,990 | 10.5 s |
| 800 ranks, 30 parallel edges per hop | 800 | ~24,000 | 21.5 s |
| 1,200 ranks, 20 parallel edges per hop | 1,200 | ~24,000 | 26.5 s |
| 8 chats, shared 200, then 600 each | 5,001 | 6,400 | 8.5 s |
| 8 chats, shared 200, then 900 each | 7,401 | 8,800 | 22.0 s |
| 20 chats, shared 100, then 900 each | 18,101 | 20,000 | 41.8 s |
| 800 messages, 3 swipes expanded on each | 3,197 | 3,196 | 9.4 s |
| 800 messages, 8 swipes expanded on each | 7,192 | 7,191 | 26.8 s |

The crash cutoff moved with the JS stack. In this Node it sits between 1,200 and 1,400 ranks. A browser's stack is the same kind of limit, not a different algorithm, so a timeline deeper than about a thousand messages is in the band where the tab either locks for seconds or throws. Parallel edges, which the builder creates once per chat that shares a prefix, multiply the time well before the stack dies. Ten saved branches of a 1,000-message chat are enough for a layout that Chrome will report as a hung page, and the extension does that layout twice.

Swipes are not drawn until expanded, but Expand Swipes, or a long-press on a busy node followed by `refreshLayout`, sends those extra nodes through the same Dagre.

### What was measured and is not the crash

A stand-in for `buildGraph` (group by full message string, count duplicate node pushes and parallel edges, keep swipe texts):

| Input | Text volume | Unique nodes | Duplicate node inserts | Edges | Time |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 chat × 1,000 msgs × 800 chars × 2 swipes | 1.6 MB | 1,000 | 0 | 1,000 | 4 ms |
| 10 × 1,000 × 800 × 2, 30% shared prefix | 16 MB | 7,300 | 2,700 | 10,000 | 22 ms |
| 20 × 1,500 × 1,500 × 3 | 81 MB | 21,450 | 8,550 | 30,000 | 111 ms |
| 40 × 2,000 × 2,000 × 4 | 288 MB | 56,600 | 23,400 | 80,000 | 301 ms |

Constructing the element list is not the multi-second stall. Fetching and `JSON.parse` of every file still happens on the main thread, sequentially, before the layout, and a character whose chats add up to tens or hundreds of megabytes can spike memory there. The layout is what turns a "large but normal" roleplay into a frozen tab. The duplicate-node `console.error` spam during Cytoscape init (one error per extra copy of a shared message) adds more main-thread work on those same branched characters. DevTools makes that spam much worse.

### Other defects that show up once a graph does open

- Two layouts per open, and the spinner is already hidden.
- No `cy.destroy()`, and event listeners accumulate. A retry after a freeze is more expensive than the first attempt.
- Edges are not deduped. Nodes are deduped only by Cytoscape rejecting them.
- `taxi` edges are the slow curve style, and pan/zoom keeps every element live. `hideEdgesOnViewport` and `textureOnViewport` are off.
- Min zoom 0.1 hides most of a long timeline.
- Search, legend hover, and an empty search on focus restyle every element.
- `zoomToCurrentChatNode` and the info panel's previous/next buttons scan the whole graph with a JS predicate per element.
- Clicking a node runs Showdown on the entire message.
- `reload` calls the slash handler (async, not awaited) and then `refreshLayout()` on the old graph immediately.
- `fixRootNodePosition` throws if the root has no outgoing edge.
- `groupMessagesByContent` uses the raw message as an object key and mutates `message.mes`.
- Checkpoint painting and legend selectors assume colors and names do not contain characters that break a Cytoscape attribute selector.

## What already exists for fork / edit / checkpoint

The info panel can already open a message and create an unnamed branch (`createBranch` in SillyTavern). It cannot rename a checkpoint, create one, edit message text, or delete a chat. Those stay in the main UI. `navigateToMessage` is the piece worth keeping: it knows about lazy-loaded transcripts and about swipes only existing on the last message.
