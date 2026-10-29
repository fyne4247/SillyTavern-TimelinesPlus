import {
    GRAPH_WINDOW,
    PAGE_SIZE,
    actionFile,
    buildTimeline,
    displayFileName,
    graphElements,
    graphRangeForSegment,
    matchingDepths,
    neighborBranch,
    preferActiveFile,
    previewText,
    queryFragments,
    segmentAt,
    segmentKey,
    shiftGraphRange,
    visibleSegmentIds,
} from './tl_model.js';

/**
 * Mount the timeline into `root`. The caller owns SillyTavern.
 * `update` replaces chats, the cursor, and the loading note, then paints.
 *
 * @param {HTMLElement} root
 * @param {object} handlers
 * @param {function} [handlers.onOpen]
 * @param {function} [handlers.onFork]
 * @param {function} [handlers.onEdit]
 * @param {function} [handlers.onCheckpoint]
 * @param {function} [handlers.onDelete]
 * @param {function} [handlers.onClose]
 * @param {function} [handlers.formatMessage]
 * @param {function} [handlers.cytoscape]
 * @param {string} [handlers.userColor]
 * @param {string} [handlers.charColor]
 */
export function mountTimeline(root, handlers) {
    const state = {
        chats: {},
        timeline: null,
        activeFile: null,
        activeDepth: 0,
        query: '',
        loadingLabel: '',
        /** @type {Set<string>} */
        expandedKeys: new Set(),
        /** @type {Map<string, number>} */
        pageOffset: new Map(),
        detail: null,
        graph: null,
        cy: null,
        userColor: handlers.userColor || '',
        charColor: handlers.charColor || '',
    };

    const onKeyDown = (event) => {
        if (event.key === 'Escape') {
            if (state.graph) {
                event.preventDefault();
                state.graph = null;
                render();
                return;
            }
            handlers.onClose?.();
            return;
        }
        if (event.ctrlKey && event.shiftKey && (event.key === 'F' || event.key === 'f')) {
            event.preventDefault();
            root.querySelector('.tlp-search')?.focus();
            return;
        }
        const target = event.target;
        if (!(target instanceof HTMLElement) || !target.classList.contains('tlp-row')) {
            return;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const rows = [...root.querySelectorAll('.tlp-row')];
            const index = rows.indexOf(target);
            const next = rows[index + (event.key === 'ArrowDown' ? 1 : -1)];
            next?.focus();
        } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
            event.preventDefault();
            const key = target.getAttribute('data-key');
            if (!key) {
                return;
            }
            if (event.key === 'ArrowRight') {
                state.expandedKeys.add(key);
            } else {
                state.expandedKeys.delete(key);
            }
            render();
            root.querySelector(`[data-key="${CSS.escape(key)}"]`)?.focus();
            return;
        } else if (event.key === 'Enter') {
            event.preventDefault();
            target.querySelector('[data-act="open-end"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }
    };
    root.addEventListener('keydown', onKeyDown);

    function update(partial) {
        if (partial.chats) {
            state.chats = partial.chats;
        }
        if (Object.prototype.hasOwnProperty.call(partial, 'activeFile')) {
            state.activeFile = partial.activeFile;
        }
        if (Object.prototype.hasOwnProperty.call(partial, 'activeDepth')) {
            state.activeDepth = partial.activeDepth;
        }
        if (Object.prototype.hasOwnProperty.call(partial, 'loadingLabel')) {
            state.loadingLabel = partial.loadingLabel;
        }
        if (partial.userColor) {
            state.userColor = partial.userColor;
        }
        if (partial.charColor) {
            state.charColor = partial.charColor;
        }
        if (partial.expandActive && state.activeFile) {
            const timeline = preferActiveFile(
                rebuild(),
                state.activeFile,
            );
            const here = segmentAt(timeline, state.activeFile, state.activeDepth);
            if (here) {
                state.expandedKeys.add(segmentKey(here));
                const offset = Math.floor((state.activeDepth - here.depthStart) / PAGE_SIZE) * PAGE_SIZE;
                state.pageOffset.set(segmentKey(here), offset);
            }
        }
        render();
    }

    function rebuild() {
        return buildTimeline(state.chats);
    }

    function destroy() {
        destroyGraph();
        root.removeEventListener('keydown', onKeyDown);
        root.replaceChildren();
    }

    function destroyGraph() {
        if (state.cy) {
            state.cy.destroy();
            state.cy = null;
        }
    }

    function render() {
        const search = root.querySelector('.tlp-search');
        const hadSearchFocus = search && document.activeElement === search;
        const selectionStart = search?.selectionStart ?? null;
        const treeScroll = root.querySelector('.tlp-tree')?.scrollTop || 0;
        destroyGraph();

        state.timeline = preferActiveFile(buildTimeline(state.chats), state.activeFile);
        const fragments = queryFragments(state.query);
        const visible = visibleSegmentIds(state.timeline, state.chats, state.query);

        root.replaceChildren();
        if (state.userColor) {
            root.style.setProperty('--tlp-user', state.userColor);
        }
        if (state.charColor) {
            root.style.setProperty('--tlp-char', state.charColor);
        }

        root.append(renderHeader(fragments, visible));
        if (state.graph) {
            root.append(renderGraph());
        } else {
            const body = el('div', 'tlp-body');
            body.append(renderTree(visible, fragments));
            body.append(renderDetail());
            root.append(body);
        }

        const nextSearch = root.querySelector('.tlp-search');
        if (hadSearchFocus && nextSearch) {
            nextSearch.focus();
            if (selectionStart !== null) {
                nextSearch.setSelectionRange(selectionStart, selectionStart);
            }
        }
        const nextTree = root.querySelector('.tlp-tree');
        if (nextTree) {
            nextTree.scrollTop = treeScroll;
        }
    }

    function renderHeader(fragments, visible) {
        const header = el('div', 'tlp-header');
        const search = document.createElement('input');
        search.className = 'tlp-search text_pole';
        search.type = 'search';
        search.placeholder = 'Search messages';
        search.value = state.query;
        search.addEventListener('input', () => {
            state.query = search.value;
            render();
        });
        header.append(search);

        const status = el('div', 'tlp-status');
        const matchCount = visible ? visible.size : null;
        if (fragments.length && matchCount === 0) {
            status.textContent = 'No messages match.';
        } else if (fragments.length) {
            status.textContent = `${matchCount} matching ${matchCount === 1 ? 'branch' : 'branches'}.`;
        } else {
            status.textContent = state.loadingLabel || '';
        }
        header.append(status);

        const tools = el('div', 'tlp-tools');
        tools.append(button('Previous branch', () => stepBranch(-1)));
        tools.append(button('Next branch', () => stepBranch(1)));
        tools.append(button('Close', () => handlers.onClose?.()));
        header.append(tools);
        return header;
    }

    function stepBranch(direction) {
        const point = neighborBranch(state.timeline, state.activeFile, state.activeDepth, direction);
        if (!point) {
            return;
        }
        const file = actionFile(point, state.activeFile);
        state.detail = { file, depth: point.depthStart, swipeId: null };
        state.expandedKeys.add(segmentKey(point));
        state.graph = null;
        render();
        const row = root.querySelector(`[data-key="${CSS.escape(segmentKey(point))}"]`);
        row?.scrollIntoView({ block: 'nearest' });
        row?.focus();
    }

    function renderTree(visible, fragments) {
        const tree = el('div', 'tlp-tree');
        tree.setAttribute('role', 'tree');
        if (!state.timeline.roots.length) {
            const empty = el('p', 'tlp-empty');
            empty.textContent = 'This character has no chat messages yet.';
            tree.append(empty);
            return tree;
        }
        for (const rootSegment of state.timeline.roots) {
            appendSegment(tree, rootSegment, 0, visible, fragments);
        }
        return tree;
    }

    function appendSegment(parent, segment, depth, visible, fragments) {
        if (visible && !visible.has(segment.id)) {
            return;
        }
        const key = segmentKey(segment);
        const expanded = state.expandedKeys.has(key) || (fragments.length > 0 && visible?.has(segment.id) && matchingDepths(segment, state.chats, fragments).length > 0);
        const here = state.activeFile
            && segment.files.includes(state.activeFile)
            && state.activeDepth >= segment.depthStart
            && state.activeDepth < segment.depthEnd;

        const block = el('div', `tlp-segment${here ? ' is-current' : ''}`);
        block.style.setProperty('--tlp-nest', String(depth));

        const row = el('div', 'tlp-row');
        row.tabIndex = 0;
        row.setAttribute('role', 'treeitem');
        row.setAttribute('data-key', key);
        row.setAttribute('aria-expanded', expanded ? 'true' : 'false');

        const twist = button(expanded ? 'Collapse' : 'Expand', () => {
            if (state.expandedKeys.has(key)) {
                state.expandedKeys.delete(key);
            } else {
                state.expandedKeys.add(key);
            }
            render();
        }, 'tlp-expand');
        twist.textContent = expanded ? '▾' : '▸';
        twist.title = expanded ? 'Hide messages' : 'Show messages';
        twist.setAttribute('aria-label', twist.title);
        row.append(twist);

        const main = el('div', 'tlp-row-main');
        const title = el('div', 'tlp-title');
        const count = segment.depthEnd - segment.depthStart;
        const rangeLabel = document.createElement('span');
        rangeLabel.textContent = `Messages ${segment.depthStart + 1}–${segment.depthEnd}`;
        title.append(rangeLabel);
        const meta = el('span', 'tlp-meta');
        meta.textContent = count === 1 ? '1 message' : `${count} messages`;
        title.append(meta);
        if (here) {
            const badge = el('span', 'tlp-badge');
            badge.textContent = 'You are here';
            title.append(badge);
        }
        if (segment.checkpoint) {
            const badge = el('span', 'tlp-badge tlp-badge-check');
            badge.textContent = `Checkpoint ${displayFileName(segment.checkpoint.name)}`;
            title.append(badge);
        }
        if (segment.swipeMessages > 0) {
            const badge = el('span', 'tlp-meta');
            badge.textContent = segment.swipeMessages === 1 ? '1 message with swipes' : `${segment.swipeMessages} messages with swipes`;
            title.append(badge);
        }
        main.append(title);

        const preview = el('div', 'tlp-preview');
        preview.textContent = segment.preview || 'Empty message';
        main.append(preview);

        const files = el('div', 'tlp-files');
        if (segment.files.length === 1) {
            files.textContent = displayFileName(segment.files[0]);
        } else {
            files.textContent = `Shared by ${segment.files.length} chats: ${segment.files.map(displayFileName).join(', ')}`;
        }
        main.append(files);
        row.append(main);

        const actions = el('div', 'tlp-actions');
        const file = actionFile(segment, state.activeFile);
        const endDepth = segment.depthEnd - 1;
        actions.append(button('Open', () => openAt(file, endDepth), '', 'open-end'));
        actions.append(button('Fork', () => handlers.onFork?.(file, endDepth, null)));
        const range = graphRangeForSegment(segment, state.activeDepth, state.activeFile);
        const graphLabel = range.windowed ? `Graph last ${GRAPH_WINDOW}` : 'Graph';
        actions.append(button(graphLabel, () => {
            state.graph = {
                depthStart: range.depthStart,
                depthEnd: range.depthEnd,
                boundStart: segment.depthStart,
                boundEnd: segment.depthEnd,
            };
            render();
        }));
        row.append(actions);
        block.append(row);

        if (expanded) {
            block.append(renderMessages(segment, fragments));
        }

        parent.append(block);
        for (const childId of segment.childIds) {
            const child = state.timeline.byId.get(childId);
            if (child) {
                appendSegment(block, child, depth + 1, visible, fragments);
            }
        }
    }

    function renderMessages(segment, fragments) {
        const wrap = el('div', 'tlp-messages');
        const key = segmentKey(segment);
        const file = actionFile(segment, state.activeFile);
        const messages = state.chats[file] || [];
        const hits = fragments.length ? matchingDepths(segment, state.chats, fragments) : null;
        /** @type {number[]} */
        let depths;
        if (hits) {
            depths = hits.slice(0, PAGE_SIZE);
            if (hits.length > PAGE_SIZE) {
                const note = el('div', 'tlp-meta');
                note.textContent = `${hits.length} matches in this branch. Showing the first ${PAGE_SIZE}.`;
                wrap.append(note);
            }
        } else {
            const total = segment.depthEnd - segment.depthStart;
            const offset = Math.min(state.pageOffset.get(key) || 0, Math.max(0, total - 1));
            const start = segment.depthStart + offset;
            const end = Math.min(segment.depthEnd, start + PAGE_SIZE);
            depths = [];
            for (let depth = start; depth < end; depth += 1) {
                depths.push(depth);
            }
            if (total > PAGE_SIZE) {
                const bar = el('div', 'tlp-pager');
                const page = Math.floor(offset / PAGE_SIZE) + 1;
                const pages = Math.ceil(total / PAGE_SIZE);
                const label = el('span', 'tlp-meta');
                label.textContent = `Page ${page} of ${pages}`;
                bar.append(label);
                bar.append(button('Previous page', () => {
                    state.pageOffset.set(key, Math.max(0, offset - PAGE_SIZE));
                    render();
                }));
                bar.append(button('Next page', () => {
                    state.pageOffset.set(key, Math.min(offset + PAGE_SIZE, (pages - 1) * PAGE_SIZE));
                    render();
                }));
                const cursorInside = state.activeFile
                    && segment.files.includes(state.activeFile)
                    && state.activeDepth >= segment.depthStart
                    && state.activeDepth < segment.depthEnd;
                if (cursorInside) {
                    bar.append(button('Current message', () => {
                        const local = Math.max(0, state.activeDepth - segment.depthStart);
                        state.pageOffset.set(key, Math.floor(local / PAGE_SIZE) * PAGE_SIZE);
                        state.expandedKeys.add(key);
                        render();
                    }));
                }
                wrap.append(bar);
            }
        }

        for (const depth of depths) {
            const message = messages[depth];
            if (!message) {
                continue;
            }
            wrap.append(renderMessageRow(file, depth, message, segment));
        }
        return wrap;
    }

    function renderMessageRow(file, depth, message, segment) {
        const row = el('div', `tlp-message${depth === state.activeDepth && file === state.activeFile ? ' is-current' : ''}`);
        const who = el('div', `tlp-who${message.is_user ? ' is-user' : ''}`);
        who.textContent = message.name || (message.is_user ? 'You' : 'Character');
        const body = el('button', 'tlp-message-text');
        body.type = 'button';
        body.textContent = `${depth + 1}. ${previewText(message.mes, 140) || 'Empty message'}`;
        body.addEventListener('click', () => {
            state.detail = { file, depth, swipeId: null };
            render();
        });
        const actions = el('div', 'tlp-actions');
        actions.append(button('Open', () => openAt(file, depth)));
        actions.append(button('Fork', () => handlers.onFork?.(file, depth, null)));
        row.append(who, body, actions);

        const swipes = Array.isArray(message.swipes) ? message.swipes : [];
        const extras = swipes
            .map((text, swipeId) => ({ text, swipeId }))
            .filter(item => String(item.text ?? '') !== String(message.mes ?? ''));
        if (extras.length > 0) {
            const list = el('div', 'tlp-swipes');
            for (const item of extras) {
                const swipeRow = el('div', 'tlp-swipe');
                const label = el('div', 'tlp-preview');
                label.textContent = `Swipe ${item.swipeId + 1}. ${previewText(item.text, 120)}`;
                const swipeActions = el('div', 'tlp-actions');
                swipeActions.append(button('Fork swipe', () => handlers.onFork?.(file, depth, item.swipeId)));
                swipeRow.append(label, swipeActions);
                list.append(swipeRow);
            }
            row.append(list);
        }
        if (state.detail && state.detail.file === file && state.detail.depth === depth && state.detail.segmentId === segment.id) {
            row.classList.add('is-selected');
        }
        return row;
    }

    function renderDetail() {
        const aside = el('aside', 'tlp-detail');
        const detail = state.detail;
        if (!detail) {
            const note = el('p', 'tlp-empty');
            note.textContent = 'Select a message to read it here. Open, fork, edit, and checkpoint use the chat file named on the button.';
            aside.append(note);
            return aside;
        }
        const message = state.chats[detail.file]?.[detail.depth];
        if (!message) {
            const note = el('p', 'tlp-empty');
            note.textContent = 'That message is not loaded.';
            aside.append(note);
            return aside;
        }
        const heading = el('div', 'tlp-title');
        heading.textContent = `${message.name || 'Message'} · ${detail.depth + 1}`;
        const fileLine = el('div', 'tlp-files');
        fileLine.textContent = displayFileName(detail.file);
        const body = el('div', 'tlp-detail-body');
        if (handlers.formatMessage) {
            try {
                body.innerHTML = handlers.formatMessage(message, detail.depth);
            } catch {
                body.textContent = message.mes || '';
            }
        } else {
            body.textContent = message.mes || '';
        }
        const actions = el('div', 'tlp-actions tlp-detail-actions');
        actions.append(button('Open', () => openAt(detail.file, detail.depth)));
        actions.append(button('Fork', () => handlers.onFork?.(detail.file, detail.depth, detail.swipeId ?? null)));
        actions.append(button('Edit', () => handlers.onEdit?.(detail.file, detail.depth)));
        actions.append(button('Checkpoint', () => handlers.onCheckpoint?.(detail.file, detail.depth)));
        if (detail.file !== state.activeFile) {
            actions.append(button('Delete chat', () => handlers.onDelete?.(detail.file)));
        }
        aside.append(heading, fileLine, actions, body);
        return aside;
    }

    function renderGraph() {
        const wrap = el('div', 'tlp-graph');
        const bar = el('div', 'tlp-graph-bar');
        const label = el('span', 'tlp-meta');
        label.textContent = `Messages ${state.graph.depthStart + 1}–${state.graph.depthEnd}`;
        bar.append(label);
        bar.append(button('Previous window', () => {
            const next = shiftGraphRange(state.graph, -1, state.graph.boundStart, state.graph.boundEnd);
            state.graph = { ...state.graph, ...next };
            render();
        }));
        bar.append(button('Next window', () => {
            const next = shiftGraphRange(state.graph, 1, state.graph.boundStart, state.graph.boundEnd);
            state.graph = { ...state.graph, ...next };
            render();
        }));
        bar.append(button('Back to tree', () => {
            state.graph = null;
            render();
        }));
        wrap.append(bar);

        const host = el('div', 'tlp-cy');
        wrap.append(host);

        const built = graphElements(state.chats, state.graph.depthStart, state.graph.depthEnd);
        queueMicrotask(() => {
            if (!host.isConnected || typeof handlers.cytoscape !== 'function') {
                return;
            }
            const instance = handlers.cytoscape({
                container: host,
                elements: [...built.nodes, ...built.edges],
                layout: { name: 'preset', fit: true, padding: 24 },
                minZoom: 0.05,
                maxZoom: 2.5,
                hideEdgesOnViewport: true,
                textureOnViewport: true,
                style: graphStyle(state.userColor, state.charColor),
            });
            if (!instance) {
                const note = el('p', 'tlp-empty');
                note.textContent = 'The graph library has not finished loading.';
                wrap.append(note);
                return;
            }
            state.cy = instance;
            state.cy.on('tap', 'node', (event) => {
                const data = event.target.data();
                const file = actionFile({ files: data.files }, state.activeFile);
                state.detail = { file, depth: data.depth, swipeId: null };
                const existing = bar.querySelector('.tlp-graph-pick');
                existing?.remove();
                const pick = el('span', 'tlp-graph-pick');
                pick.textContent = `${data.name || 'Message'} ${data.depth + 1} selected. Back to the tree keeps this selection.`;
                bar.append(pick);
            });
        });
        return wrap;
    }

    function openAt(file, depth) {
        state.detail = { file, depth, swipeId: null };
        handlers.onOpen?.(file, depth);
    }

    return { update, destroy };
}

/**
 * @param {string} [userColor]
 * @param {string} [charColor]
 * @returns {object[]}
 */
export function graphStyle(userColor, charColor) {
    const user = userColor || 'var(--tlp-user, #8fb4d4)';
    const character = charColor || 'var(--tlp-char, #d8d2c8)';
    return [
        {
            selector: 'node',
            style: {
                width: 18,
                height: 18,
                'background-color': character,
                label: '',
            },
        },
        {
            selector: 'node[?is_user]',
            style: { 'background-color': user },
        },
        {
            selector: 'edge',
            style: {
                width: 1.5,
                'line-color': '#8a8175',
                'curve-style': 'straight',
                'target-arrow-shape': 'triangle',
                'target-arrow-color': '#8a8175',
                'arrow-scale': 0.7,
            },
        },
    ];
}

/**
 * @param {string} tag
 * @param {string} className
 * @returns {HTMLElement}
 */
function el(tag, className) {
    const node = document.createElement(tag);
    node.className = className;
    return node;
}

/**
 * @param {string} label
 * @param {function} onClick
 * @param {string} [className]
 * @param {string} [act]
 * @returns {HTMLButtonElement}
 */
function button(label, onClick, className = '', act = '') {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = `menu_button tlp-button ${className}`.trim();
    node.textContent = label;
    if (act) {
        node.dataset.act = act;
    }
    node.addEventListener('click', (event) => {
        event.stopPropagation();
        onClick();
    });
    return node;
}
