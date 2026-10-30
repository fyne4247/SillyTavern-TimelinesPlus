import { buildChart, displayFileName, layoutChart, previewText } from './tl_model.js';

const COL = 46;
const ROW = 36;

/**
 * Rank-aligned flowchart. Hover previews. Click opens a bubble with the
 * message and the chat actions. No swipe list and no side reading panel.
 *
 * @param {HTMLElement} root
 * @param {object} handlers
 */
export function mountTimeline(root, handlers) {
    const state = {
        chats: {},
        metas: {},
        activeFile: null,
        activeDepth: 0,
        loadingLabel: '',
        /** @type {Set<string>} */
        expanded: new Set(),
        bubbleKey: null,
        zoom: 1,
        popped: false,
        showFaces: false,
        userAvatar: '',
        charAvatar: '',
        userColor: '',
        charColor: '',
        hover: null,
    };

    root.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            if (state.bubbleKey) {
                state.bubbleKey = null;
                render();
                return;
            }
            handlers.onClose?.();
        }
    });

    function update(partial) {
        if (partial.chats) state.chats = partial.chats;
        if (partial.metas) state.metas = partial.metas;
        if (partial.activeFile) state.activeFile = partial.activeFile;
        if (Object.prototype.hasOwnProperty.call(partial, 'activeDepth')) state.activeDepth = partial.activeDepth;
        if (Object.prototype.hasOwnProperty.call(partial, 'loadingLabel')) state.loadingLabel = partial.loadingLabel;
        if (Object.prototype.hasOwnProperty.call(partial, 'popped')) state.popped = Boolean(partial.popped);
        if (Object.prototype.hasOwnProperty.call(partial, 'showFaces')) state.showFaces = Boolean(partial.showFaces);
        if (partial.userAvatar !== undefined) state.userAvatar = partial.userAvatar || '';
        if (partial.charAvatar !== undefined) state.charAvatar = partial.charAvatar || '';
        if (partial.userColor) state.userColor = partial.userColor;
        if (partial.charColor) state.charColor = partial.charColor;
        render();
    }

    function destroy() {
        root.replaceChildren();
    }

    function picture() {
        const chart = buildChart(state.chats, state.activeFile, state.metas);
        const placed = layoutChart(chart, state.chats, state.expanded, state.activeFile);
        return { chart, ...placed };
    }

    function render() {
        const scroll = root.querySelector('.tlp-stage');
        const left = scroll?.scrollLeft || 0;
        const top = scroll?.scrollTop || 0;
        const drawn = picture();
        root.replaceChildren();
        root.classList.add('tlp-root');
        if (state.userColor) root.style.setProperty('--tlp-user', state.userColor);
        if (state.charColor) root.style.setProperty('--tlp-char', state.charColor);
        root.append(renderBar(drawn));
        root.append(renderStage(drawn));
        if (state.hover) root.append(renderHover(state.hover));
        const stage = root.querySelector('.tlp-stage');
        if (stage) {
            stage.scrollLeft = left;
            stage.scrollTop = top;
        }
    }

    function renderBar(drawn) {
        const bar = el('div', 'tlp-header');
        const status = el('div', 'tlp-status');
        const forks = (drawn.chart.nodes || []).filter(node => node.kind === 'end' || (node.childIds || []).length > 1).length;
        status.textContent = state.activeFile
            ? `${displayFileName(state.activeFile)}${state.loadingLabel ? ` · ${state.loadingLabel}` : ''}${forks ? ` · ${forks} forks` : ''}`
            : 'No chat is open.';
        bar.append(status);
        const tools = el('div', 'tlp-tools');
        tools.append(button('Zoom out', () => setZoom(state.zoom / 1.2)));
        tools.append(button('Zoom in', () => setZoom(state.zoom * 1.2)));
        tools.append(button('Show all', () => fit(drawn)));
        tools.append(button('Expand all', () => {
            for (const node of drawn.chart.nodes || []) {
                if (node.kind === 'run' && node.depthEnd - node.depthStart > 2) state.expanded.add(node.id);
            }
            render();
        }));
        tools.append(button('Collapse all', () => {
            state.expanded.clear();
            state.bubbleKey = null;
            render();
        }));
        tools.append(button(state.popped ? 'Dock' : 'Pop out', () => {
            if (state.popped) handlers.onDock?.();
            else handlers.onPopout?.();
        }));
        tools.append(button('Close', () => handlers.onClose?.()));
        bar.append(tools);
        if ((drawn.chart.others || []).length) {
            const picker = document.createElement('select');
            picker.className = 'tlp-file text_pole';
            const here = el('optgroup');
            here.label = 'On this chart';
            for (const file of drawn.chart.related || []) here.append(option(file, file === state.activeFile));
            const away = el('optgroup');
            away.label = 'Other chats';
            for (const file of drawn.chart.others) away.append(option(file, false));
            picker.append(here, away);
            picker.addEventListener('change', () => {
                state.activeFile = picker.value;
                state.activeDepth = Math.max(0, (state.chats[picker.value] || []).length - 1);
                state.expanded.clear();
                state.bubbleKey = null;
                render();
            });
            bar.append(picker);
        }
        return bar;
    }

    function renderStage(drawn) {
        const stage = el('div', 'tlp-stage');
        const maxDepth = drawn.dots.reduce((max, dot) => Math.max(max, dot.depth), 0);
        const maxLane = drawn.dots.reduce((max, dot) => Math.max(max, dot.lane), 0);
        const boardW = (maxLane + 1) * COL + 28;
        const boardH = (maxDepth + 1) * ROW + 28;
        const sizer = el('div', 'tlp-sizer');
        sizer.style.width = `${boardW * state.zoom}px`;
        sizer.style.height = `${boardH * state.zoom}px`;
        const board = el('div', 'tlp-board');
        board.style.width = `${boardW}px`;
        board.style.height = `${boardH}px`;
        board.style.transform = `scale(${state.zoom})`;
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'tlp-wires');
        svg.setAttribute('width', String(boardW));
        svg.setAttribute('height', String(boardH));
        const byKey = new Map(drawn.dots.map(dot => [dot.key, dot]));
        for (const edge of drawn.edges) {
            const from = byKey.get(edge.from);
            const to = byKey.get(edge.to);
            if (!from || !to) continue;
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', String(center(from).x));
            line.setAttribute('y1', String(center(from).y));
            line.setAttribute('x2', String(center(to).x));
            line.setAttribute('y2', String(center(to).y));
            svg.appendChild(line);
        }
        board.append(svg);
        for (const dot of drawn.dots) {
            board.append(renderDot(dot, drawn));
        }
        if (state.bubbleKey) {
            const dot = byKey.get(state.bubbleKey);
            if (dot) board.append(renderBubble(dot));
        }
        sizer.append(board);
        stage.append(sizer);
        if (!drawn.dots.length) {
            const empty = el('p', 'tlp-empty');
            empty.textContent = state.loadingLabel || 'This chat has no messages yet.';
            stage.append(empty);
        }
        return stage;
    }

    function renderDot(dot) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `tlp-dot${dot.isUser ? ' is-user' : ''}${dot.kind === 'end' ? ' is-end' : ''}${dot.depth === state.activeDepth ? ' is-current' : ''}`;
        button.style.left = `${dot.lane * COL + 8}px`;
        button.style.top = `${dot.depth * ROW + 4}px`;
        button.title = '';
        const orb = el('span', 'tlp-orb');
        const face = dot.isUser ? state.userAvatar : state.charAvatar;
        if (state.showFaces && face) {
            orb.style.backgroundImage = `url("${face}")`;
            orb.classList.add('has-face');
        }
        const num = el('span', 'tlp-num');
        num.textContent = String(dot.depth + 1);
        button.append(orb, num);
        button.addEventListener('mouseenter', () => {
            state.hover = { text: dot.preview || 'Empty message', name: dot.name, depth: dot.depth };
            const existing = root.querySelector('.tlp-hover');
            existing?.remove();
            root.append(renderHover(state.hover));
        });
        button.addEventListener('mouseleave', () => {
            state.hover = null;
            root.querySelector('.tlp-hover')?.remove();
        });
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            openDot(dot);
        });
        return button;
    }

    function renderBubble(dot) {
        const bubble = el('div', 'tlp-bubble');
        const top = dot.depth * ROW + 4;
        const left = dot.lane * COL + COL;
        bubble.style.top = `${top}px`;
        bubble.style.left = `${left}px`;
        const who = el('div', 'tlp-who');
        who.textContent = `${dot.name || (dot.isUser ? 'You' : 'Character')} · ${dot.depth + 1}`;
        if (dot.kind === 'end') who.textContent += ` · ${displayFileName(dot.file)} stops here`;
        const body = el('div', 'tlp-bubble-text');
        body.textContent = dot.text || dot.preview || '';
        const actions = el('div', 'tlp-actions');
        actions.append(button('Open', () => handlers.onOpen?.(dot.file, dot.depth)));
        actions.append(button('Fork', () => handlers.onFork?.(dot.file, dot.depth, null)));
        actions.append(button('Edit', () => handlers.onEdit?.(dot.file, dot.depth)));
        actions.append(button('Checkpoint', () => handlers.onCheckpoint?.(dot.file, dot.depth)));
        actions.append(button('Close', () => {
            state.bubbleKey = null;
            render();
        }));
        bubble.append(who, body, actions);
        bubble.addEventListener('click', (event) => event.stopPropagation());
        return bubble;
    }

    function renderHover(hover) {
        const tip = el('div', 'tlp-hover');
        tip.textContent = hover.name ? `${hover.name} · ${hover.depth + 1} — ${hover.text}` : hover.text;
        return tip;
    }

    function openDot(dot) {
        const { chart } = picture();
        const segment = chart.byId.get(dot.segmentId);
        if (segment?.kind === 'run' && segment.depthStart === dot.depth && segment.depthEnd - segment.depthStart > 2) {
            state.expanded.add(segment.id);
        } else if (segment?.kind === 'run' && dot.depth === segment.depthEnd - 1) {
            const child = (segment.childIds || []).map(id => chart.byId.get(id)).find(node => node?.kind === 'run');
            if (child && child.depthEnd - child.depthStart > 2) state.expanded.add(child.id);
        }
        state.bubbleKey = `${dot.segmentId}:${dot.depth}`;
        state.hover = null;
        render();
    }

    function setZoom(value) {
        state.zoom = Math.min(2.5, Math.max(0.2, value));
        render();
    }

    function fit(drawn) {
        const stage = root.querySelector('.tlp-stage');
        const maxDepth = drawn.dots.reduce((max, dot) => Math.max(max, dot.depth), 0);
        const maxLane = drawn.dots.reduce((max, dot) => Math.max(max, dot.lane), 0);
        const boardW = (maxLane + 1) * COL + 28;
        const boardH = (maxDepth + 1) * ROW + 28;
        const width = stage?.clientWidth || root.clientWidth || 400;
        const height = stage?.clientHeight || 500;
        state.zoom = Math.min(1.4, Math.max(0.08, Math.min(width / boardW, height / boardH)));
        render();
        const next = root.querySelector('.tlp-stage');
        if (next) {
            next.scrollLeft = 0;
            next.scrollTop = 0;
        }
    }

    return { update, destroy };
}

function center(dot) {
    return { x: dot.lane * COL + 8 + 9, y: dot.depth * ROW + 4 + 9 };
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
    if (className) node.className = className;
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
