import {
    buildFlow,
    displayFileName,
    normalizeMessageText,
    previewText,
    queryFragments,
    textMatchesFragments,
} from './tl_model.js';

/**
 * @param {HTMLElement} root
 * @param {object} handlers
 */
export function mountTimeline(root, handlers) {
    const state = {
        chats: {},
        metas: {},
        activeFile: null,
        activeDepth: 0,
        query: '',
        loadingLabel: '',
        detail: null,
        matchCursor: 0,
        scrollTo: null,
        openSwipes: null,
        userColor: handlers.userColor || '',
        charColor: handlers.charColor || '',
    };

    root.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            handlers.onClose?.();
            return;
        }
        if (event.ctrlKey && event.shiftKey && (event.key === 'F' || event.key === 'f')) {
            event.preventDefault();
            root.querySelector('.tlp-search')?.focus();
        }
    });

    function update(partial) {
        if (partial.chats) {
            state.chats = partial.chats;
        }
        if (partial.metas) {
            state.metas = partial.metas;
        }
        if (Object.prototype.hasOwnProperty.call(partial, 'activeFile') && partial.activeFile) {
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
        if (partial.scrollToActive) {
            state.scrollTo = state.activeDepth;
        }
        render();
    }

    function destroy() {
        root.replaceChildren();
    }

    function flow() {
        return buildFlow(state.chats, state.activeFile, state.metas);
    }

    function render() {
        const search = root.querySelector('.tlp-search');
        const hadSearchFocus = search && document.activeElement === search;
        const selectionStart = search?.selectionStart ?? null;
        const flowScroll = root.querySelector('.tlp-flow')?.scrollTop || 0;
        const picture = flow();
        const fragments = queryFragments(state.query);
        const matches = picture.spine
            .map((row, index) => ({ row, index }))
            .filter(({ row }) => rowMatches(row, fragments));

        root.replaceChildren();
        if (state.userColor) {
            root.style.setProperty('--tlp-user', state.userColor);
        }
        if (state.charColor) {
            root.style.setProperty('--tlp-char', state.charColor);
        }
        root.append(renderHeader(picture, fragments, matches));
        const body = el('div', 'tlp-body');
        body.append(renderFlow(picture, fragments, matches));
        body.append(renderDetail());
        root.append(body);

        const nextSearch = root.querySelector('.tlp-search');
        if (hadSearchFocus && nextSearch) {
            nextSearch.focus();
            if (selectionStart !== null) {
                nextSearch.setSelectionRange(selectionStart, selectionStart);
            }
        }
        const scroller = root.querySelector('.tlp-flow');
        if (scroller) {
            if (state.scrollTo !== null) {
                const target = scroller.querySelector(`[data-depth="${state.scrollTo}"]`);
                target?.scrollIntoView({ block: 'center' });
                state.scrollTo = null;
            } else {
                scroller.scrollTop = flowScroll;
            }
        }
    }

    function renderHeader(picture, fragments, matches) {
        const header = el('div', 'tlp-header');
        const search = document.createElement('input');
        search.className = 'tlp-search text_pole';
        search.type = 'search';
        search.placeholder = 'Search this chat';
        search.value = state.query;
        search.addEventListener('input', () => {
            state.query = search.value;
            state.matchCursor = 0;
            const first = matchesFor(flow())[0];
            state.scrollTo = first === undefined ? null : first;
            render();
        });
        header.append(search);

        const status = el('div', 'tlp-status');
        if (!state.activeFile) {
            status.textContent = 'No chat is open.';
        } else if (fragments.length && matches.length === 0) {
            status.textContent = 'No messages in this chat match.';
        } else if (fragments.length) {
            status.textContent = `${matches.length} matching ${matches.length === 1 ? 'message' : 'messages'}.`;
        } else {
            const forkCount = picture.forks.length;
            const name = displayFileName(state.activeFile);
            status.textContent = forkCount
                ? `${name} · ${picture.spine.length} messages · ${forkCount} ${forkCount === 1 ? 'fork' : 'forks'}`
                : `${name} · ${picture.spine.length} messages`;
            if (state.loadingLabel) {
                status.textContent = `${status.textContent}. ${state.loadingLabel}`;
            }
        }
        header.append(status);

        const tools = el('div', 'tlp-tools');
        tools.append(button('Previous fork', () => stepFork(picture, -1)));
        tools.append(button('Next fork', () => stepFork(picture, 1)));
        if (fragments.length) {
            tools.append(button('Previous match', () => stepMatch(matches, -1)));
            tools.append(button('Next match', () => stepMatch(matches, 1)));
        }
        tools.append(button('Close', () => handlers.onClose?.()));
        header.append(tools);

        const picker = document.createElement('select');
        picker.className = 'tlp-file text_pole';
        const related = el('optgroup');
        related.label = 'This chat and its forks';
        for (const file of picture.related) {
            related.append(option(file, file === state.activeFile));
        }
        picker.append(related);
        if (picture.others.length) {
            const others = el('optgroup');
            others.label = 'Other chats, not connected by text';
            for (const file of picture.others) {
                others.append(option(file, false));
            }
            picker.append(others);
        }
        picker.addEventListener('change', () => switchFile(picker.value, null));
        header.append(picker);
        return header;
    }

    function renderFlow(picture, fragments) {
        const scroller = el('div', 'tlp-flow');
        if (!picture.spine.length) {
            const empty = el('p', 'tlp-empty');
            empty.textContent = state.loadingLabel || 'This chat has no messages yet.';
            scroller.append(empty);
            return scroller;
        }

        const byAnchor = new Map();
        for (const fork of picture.forks) {
            const list = byAnchor.get(fork.anchor) || [];
            list.push(fork);
            byAnchor.set(fork.anchor, list);
        }

        picture.spine.forEach((row, index) => {
            scroller.append(renderRow(row, byAnchor.get(index) || [], fragments));
        });
        const trailing = byAnchor.get(picture.spine.length) || [];
        if (trailing.length) {
            const tail = el('div', 'tlp-flow-row is-tail');
            tail.append(el('div', 'tlp-card tlp-card-tail'));
            const side = el('div', 'tlp-forks');
            for (const fork of trailing) {
                side.append(forkCard(fork));
            }
            tail.append(side);
            scroller.append(tail);
        }
        return scroller;
    }

    function renderRow(row, forks, fragments) {
        const wrap = el('div', 'tlp-flow-row');
        wrap.dataset.depth = String(row.depth);
        const selected = state.detail && state.detail.file === state.activeFile && state.detail.depth === row.depth;
        const current = row.depth === state.activeDepth;
        const dim = fragments.length > 0 && !rowMatches(row, fragments) && forks.length === 0;
        const card = el('button', `tlp-card${current ? ' is-current' : ''}${selected ? ' is-selected' : ''}${dim ? ' is-dim' : ''}${row.isUser ? ' is-user' : ''}`);
        card.type = 'button';
        card.dataset.depth = String(row.depth);
        const who = el('div', 'tlp-who');
        who.textContent = `${row.name} · ${row.depth + 1}`;
        const text = el('div', 'tlp-card-text');
        text.textContent = row.preview || 'Empty message';
        card.append(who, text);
        if (row.swipeCount > 0) {
            const swipes = el('div', 'tlp-swipe-note');
            swipes.textContent = row.swipeCount === 1 ? '1 other swipe' : `${row.swipeCount} other swipes`;
            card.append(swipes);
        }
        card.addEventListener('click', () => {
            state.detail = { file: state.activeFile, depth: row.depth };
            state.openSwipes = state.openSwipes === row.depth ? null : row.depth;
            render();
        });
        wrap.append(card);

        const side = el('div', 'tlp-forks');
        for (const fork of forks) {
            side.append(forkCard(fork));
        }
        if (state.openSwipes === row.depth) {
            side.append(swipeList(row.depth));
        }
        wrap.append(side);
        return wrap;
    }

    function forkCard(fork) {
        const card = el('button', `tlp-fork tlp-fork-${fork.kind}`);
        card.type = 'button';
        const title = el('div', 'tlp-who');
        title.textContent = forkTitle(fork);
        card.append(title);
        if (fork.preview) {
            const text = el('div', 'tlp-card-text');
            text.textContent = fork.preview;
            card.append(text);
        }
        const hint = el('div', 'tlp-swipe-note');
        hint.textContent = `${displayFileName(fork.file)} · ${fork.otherLength} messages`;
        card.append(hint);
        card.addEventListener('click', () => {
            const depth = fork.kind === 'continues' ? fork.anchor : Math.min(fork.anchor, Math.max(0, fork.otherLength - 1));
            switchFile(fork.file, depth);
        });
        return card;
    }

    function swipeList(depth) {
        const message = state.chats[state.activeFile]?.[depth];
        const box = el('div', 'tlp-swipes');
        const swipes = Array.isArray(message?.swipes) ? message.swipes : [];
        swipes.forEach((text, swipeId) => {
            if (normalizeMessageText(text) === normalizeMessageText(message?.mes)) {
                return;
            }
            const row = el('div', 'tlp-swipe');
            const label = el('div', 'tlp-card-text');
            label.textContent = `Swipe ${swipeId + 1}. ${previewText(text, 160)}`;
            const actions = el('div', 'tlp-actions');
            actions.append(button('Fork this swipe', () => handlers.onFork?.(state.activeFile, depth, swipeId)));
            row.append(label, actions);
            box.append(row);
        });
        return box;
    }

    function renderDetail() {
        const aside = el('aside', 'tlp-detail');
        const detail = state.detail;
        if (!detail) {
            const note = el('p', 'tlp-empty');
            note.textContent = 'The column on the left is this chat, one message at a time. A card on the right is another file that splits off at that message. Select a message to read it and to open, fork, edit, or checkpoint it.';
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
        actions.append(button('Open', () => handlers.onOpen?.(detail.file, detail.depth)));
        actions.append(button('Fork', () => handlers.onFork?.(detail.file, detail.depth, null)));
        actions.append(button('Edit', () => handlers.onEdit?.(detail.file, detail.depth)));
        actions.append(button('Checkpoint', () => handlers.onCheckpoint?.(detail.file, detail.depth)));
        if (detail.file !== state.activeFile) {
            actions.append(button('Delete chat', () => handlers.onDelete?.(detail.file)));
        }
        aside.append(heading, fileLine, actions, body);
        return aside;
    }

    function switchFile(file, depth) {
        const messages = state.chats[file] || [];
        state.activeFile = file;
        state.activeDepth = depth === null || depth === undefined
            ? Math.max(0, messages.length - 1)
            : depth;
        state.detail = { file, depth: state.activeDepth };
        state.scrollTo = state.activeDepth;
        state.openSwipes = null;
        render();
    }

    function stepFork(picture, direction) {
        if (!picture.forks.length) {
            return;
        }
        const anchors = [...new Set(picture.forks.map(fork => fork.anchor))].sort((a, b) => a - b);
        const here = state.scrollDepth ?? state.activeDepth;
        const next = direction > 0
            ? anchors.find(anchor => anchor > here)
            : [...anchors].reverse().find(anchor => anchor < here);
        const target = next === undefined ? anchors[direction > 0 ? 0 : anchors.length - 1] : next;
        state.scrollTo = Math.min(target, Math.max(0, picture.spine.length - 1));
        state.scrollDepth = target;
        render();
    }

    function stepMatch(matches, direction) {
        if (!matches.length) {
            return;
        }
        state.matchCursor = (state.matchCursor + direction + matches.length) % matches.length;
        const depth = matches[state.matchCursor].row.depth;
        state.scrollTo = depth;
        state.detail = { file: state.activeFile, depth };
        render();
    }

    function matchesFor(picture) {
        const fragments = queryFragments(state.query);
        return picture.spine.filter(row => rowMatches(row, fragments)).map(row => row.depth);
    }

    function rowMatches(row, fragments) {
        if (!fragments.length) {
            return true;
        }
        if (textMatchesFragments(row.preview, fragments)) {
            return true;
        }
        const message = state.chats[state.activeFile]?.[row.depth];
        if (message && textMatchesFragments(message.mes, fragments)) {
            return true;
        }
        return Array.isArray(message?.swipes) && message.swipes.some(swipe => textMatchesFragments(swipe, fragments));
    }

    return { update, destroy };
}

function forkTitle(fork) {
    const name = displayFileName(fork.file);
    if (fork.kind === 'ends') {
        return `${name} stops here`;
    }
    if (fork.kind === 'diverges') {
        return `${name} splits here`;
    }
    if (fork.kind === 'continues') {
        return `${name} keeps going`;
    }
    if (fork.kind === 'linked') {
        return `${name} is linked, but the text does not line up`;
    }
    return `${name} matches this chat`;
}

function option(file, selected) {
    const node = document.createElement('option');
    node.value = file;
    node.textContent = displayFileName(file);
    node.selected = selected;
    return node;
}

function el(tag, className) {
    const node = document.createElement(tag);
    if (className) {
        node.className = className;
    }
    return node;
}

function button(label, onClick) {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'menu_button tlp-button';
    node.textContent = label;
    node.addEventListener('click', (event) => {
        event.stopPropagation();
        onClick();
    });
    return node;
}

