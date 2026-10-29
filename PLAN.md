# Plan: tree first, canvas on demand

`HANDOFF.md` describes the extension as it was: one Cytoscape node per message, laid out by Dagre 0.8.5. That layout is recursive in the length of the chat and throws once a path is about 1,400 messages deep. Shared branches also multiply edges, so a shorter chat with many copies freezes before it crashes.

This plan uses both of the earlier options together.

- **The tree (option B) is the timeline.** It is what opens. A run of messages with no fork is one row. Branches indent downward. The open chat is already on screen.
- **The canvas (option A) is a closer look.** It draws one depth window with a preset layout: column is the branch lane, row is the message index. Dagre is not loaded. The canvas never sees the whole archive unless that archive is already a small window.

Both views read the same index. A segment row and a canvas node are the same messages.

## What has to be true

- The open chat paints before the other files finish downloading.
- A 1,500-message chat with no forks is one row, not 1,500 nodes.
- A 2,000-message path cannot reach Dagre, because Dagre is gone.
- Edges in the canvas are one per distinct pair of messages, not one per chat file that shares them.
- Reloading after a new message refetches the file that changed. It does not throw away every other file, and it does not stack a second graph on the first.
- Fork, open, edit, and checkpoint call SillyTavern. The tree does not grow its own chat format.

## The index

Input is `{ "File.jsonl": [message, ...] }`. Message text is compared with newlines normalized. The same text at the same depth is the same branch. The same text at two depths stays two branches.

The builder walks a queue, not a recursive call per message:

1. Group the files by the text at the current depth.
2. Extend each group forward while every file in the group still has the same next line, and while the line just included is not a live checkpoint.
3. That run is a **segment**: start depth, end depth, the files that share it, a short preview, a checkpoint name if the last message has a live `extra.bookmark_link`.
4. Files that still have messages after the run are queued as children.

A dead checkpoint link (the target file is not in the set) does not split the run.

Lanes are assigned after the segments exist. The first child keeps the parent lane. The next sibling takes the next free lane. The open chat's branch sorts first, so the current path is the spine. Lanes are for the canvas. The tree indents by nesting, which is easier to read than a wide grid of dots.

Search is the old fragment search: whitespace-separated pieces, all must match, order does not matter. A segment matches when any message or swipe in it matches. Ancestors of a match stay visible so the branch still has a trunk.

The in-memory cache key is `file name + file size + mtime` from `/api/characters/chats`. The open chat is not taken from that cache. `getContext().chat` is the copy on screen, including unsaved lines. `/tl r` drops the cache.

There is no disk cache of message bodies. SillyTavern already stores the files.

## The tree

Top to bottom only. Nothing rotates.

```text
Papa Branch 2 · you are here
└─ messages 1–1009 · shared by 3 chats
   ├─ messages 1010–1116 · Papa Branch 2
   └─ messages 1010–1030 · Compiled and Bad Ending
      ├─ rest of Compiled
      └─ rest of Bad Ending
```

Compiled and Bad Ending stay together past the first fork. The index follows the text, so it does not invent a three-way split where two files still agree.

A segment row shows the range, the count, who shares it, the first line, and whether the cursor is inside it. Expanding it shows a page of message rows (40 at a time), not the whole run as DOM. Each message row can open its swipes. Swipes stay in the tree. They are not sprayed onto the canvas.

Actions on a message, using the file that is actually open when the segment is shared:

| Button | What it calls |
| --- | --- |
| Open | `navigateToMessage(file, depth)` |
| Fork | `navigateToMessage(file, depth, swipeId, true)` |
| Edit | Open, then SillyTavern's `.mes_edit` on that message |
| Checkpoint | Open, then `createNewBookmark(depth, { forceName })` |
| Delete chat | `POST /api/chats/delete`, after a confirm that names the file. Refuses the chat that is open. |

Previous branch and next branch step between segments that have a sibling or a checkpoint. That is the useful step size on a long chat. Previous message and next message still exist inside an expanded page.

Keyboard, while the tree is focused: up and down move rows, left collapses, right expands, Enter opens the row's end message. Escape closes the canvas if it is open, otherwise the modal. Ctrl+Shift+F focuses search.

## The canvas

A segment offers **Graph** when it is at most 250 messages. Longer runs offer a window of 80 ending at the cursor, or at the end of the segment, with previous and next window.

Positions are computed in `graphElements`:

```text
y = (depth - windowStart) * gap
x = lane * gap
```

Cytoscape's layout name is `preset`. One node per distinct text at a depth. One edge per distinct (parent text, child text). `hideEdgesOnViewport` and `textureOnViewport` are on. Min zoom is low enough to fit the window. The curve is straight. Clicking a node selects that message in the detail panel.

The Cytoscape instance is destroyed before a new one is created, including when the tree re-renders.

Dagre, cytoscape-dagre, Tippy, Popper, and the context-menu plugin are not loaded. The settings that only existed to tune Dagre (ranker, curve, separations, alignment, spacing factor) are gone.

## Loading

1. Build the index from the open chat and paint the tree. The status line says the other chats are still loading.
2. Fetch the remaining files a few at a time. Each arrival rebuilds the index and keeps the expanded page if that file and depth still sit inside a segment.
3. The full-screen loader is not used for this. The tree is the thing on screen while files arrive.

Group chats keep the old endpoint (`/api/chats/group/get`) and do not drop a metadata header.

## What this branch does not do

- A disk copy of the segment index. Reopen still refetches files whose size or mtime changed, and skips the rest.
- Swipe nodes on the canvas. Swipes are listed under the message.
- Deleting a group chat, or deleting the chat that is currently open.
- An inline editor. Edit hands the message to SillyTavern.
- Drawing every message of every file on the canvas. The button will not offer that for a long run.

## Checks

`node --test tests/timeline-model.test.mjs` builds the index from the local fixtures in `fixtures/chats/` (gitignored copies of Papa, Rabbit, and Luna) and from synthetic chains.

- Papa's three long files share one segment through the fork, then three tails.
- Luna's single file is one segment, including past the old Dagre crash depth.
- Ten identical copies of a chat produce one segment and, in a graph window, one edge per hop.
- A 2,000-message chain builds one segment and does not throw.
- Checkpoint links split a run only when the target file is present.
