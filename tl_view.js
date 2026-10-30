import { buildChart, displayFileName, layoutChart } from './tl_model.js';

const COL = 46;
const ROW = 36;
const MAX_ZOOM = 5;

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
        scrollZoom: false,
        userAvatar: '',
        charAvatar: '',
        userColor: '',
        charColor: '',
        hover: null,
    };

    let clickTimer = null;

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
        clearTimeout(clickTimer);
        if (partial.scrollZoom !== undefined) state.scrollZoom = Boolean(partial.scrollZoom);
        if (partial.chats) state.chats = partial.chats;
        if (partial.metas) state.metas = partial.metas;
        if (Object.prototype.hasOwnProperty.call(partial, 'activeFile')) {
            if (partial.activeFile !== state.openFile) {
                state.expanded.clear();
                state.bubbleKey = null;
                state.hover = null;
            }
            state.activeFile = partial.activeFile;
            state.openFile = partial.activeFile;
        }
        if (Object.prototype.hasOwnProperty.call(partial, 'activeDepth')) state.activeDepth = state.openDepth = partial.activeDepth;
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
        clearTimeout(clickTimer);
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
        root.classList.toggle('is-popped', state.popped);
        root.classList.toggle('has-message', drawn.dots.some(dot => dot.key === state.bubbleKey));
        if (state.userColor) root.style.setProperty('--tlp-user', state.userColor);
        if (state.charColor) root.style.setProperty('--tlp-char', state.charColor);
        root.append(renderBar(drawn));
        root.append(renderStage(drawn));
        const selected = drawn.dots.find(dot => dot.key === state.bubbleKey);
        if (selected) root.append(renderBubble(selected));
        if (state.hover && !state.bubbleKey) root.append(renderHover(state.hover));
        const stage = root.querySelector('.tlp-stage');
        if (stage) {
            stage.scrollLeft = left;
            stage.scrollTop = top;
        }
    }

    function renderBar(drawn) {
        const bar = el('div', 'tlp-header');
        if (state.charAvatar) {
            const portrait = el('img', 'tlp-portrait');
            portrait.src = state.charAvatar;
            portrait.alt = '';
            bar.append(portrait);
        }
        const status = el('div', 'tlp-status');
        const forks = (drawn.chart.nodes || []).filter(node => node.kind === 'end' || (node.childIds || []).length > 1).length;
        status.textContent = state.activeFile
            ? `${displayFileName(state.activeFile)}${state.loadingLabel ? ` · ${state.loadingLabel}` : ''}${forks ? ` · ${forks} forks` : ''}`
            : 'No chat is open.';
        bar.append(status);
        const tools = el('div', 'tlp-tools');
        tools.append(toolButton('Zoom out', () => setZoom(state.zoom / 1.2)));
        tools.append(toolButton('Zoom in', () => setZoom(state.zoom * 1.2)));
        tools.append(toolButton('Show all', () => fit(drawn)));
        tools.append(toolButton('Expand all', () => {
            for (const node of drawn.chart.nodes || []) {
                if (node.kind === 'run' && node.depthEnd - node.depthStart > 2) state.expanded.add(node.id);
            }
            render();
        }));
        tools.append(toolButton('Collapse all', () => {
            state.expanded.clear();
            state.bubbleKey = null;
            render();
        }));
        tools.append(toolButton(state.popped ? 'Dock' : 'Pop out', () => {
            if (state.popped) handlers.onDock?.();
            else handlers.onPopout?.();
        }));
        tools.append(toolButton('Close', () => handlers.onClose?.()));
        tools.append(toolButton('You are here', () => {
            state.activeFile = state.openFile;
            state.activeDepth = state.openDepth;
            state.zoom = MAX_ZOOM;
            render();
            root.querySelector('.tlp-dot.is-current')?.scrollIntoView({ block: 'center', inline: 'center' });
        }));
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
        const maxRow = drawn.dots.reduce((max, dot) => Math.max(max, dot.row || 0), 0);
        const maxLane = drawn.dots.reduce((max, dot) => Math.max(max, Math.abs(dot.lane)), 0);
        const boardW = maxLane * 2 * COL + 32;
        const boardH = (maxRow + 1) * ROW + 36;
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
            line.setAttribute('x1', String(center(from, maxLane).x));
            line.setAttribute('y1', String(center(from).y));
            line.setAttribute('x2', String(center(to, maxLane).x));
            line.setAttribute('y2', String(center(to).y));
            svg.appendChild(line);
        }
        board.append(svg);
        for (const dot of drawn.dots) {
            board.append(renderDot(dot, maxLane));
        }

        sizer.append(board);
        stage.append(sizer);
        bindDrag(stage);
        stage.addEventListener('wheel', (event) => {
            if (!state.scrollZoom || !event.deltaY) return;
            event.preventDefault();
            setZoom(state.zoom * Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * 0.003), event);
        }, { passive: false });
        if (!drawn.dots.length) {
            const empty = el('p', 'tlp-empty');
            empty.textContent = state.loadingLabel || 'This chat has no messages yet.';
            stage.append(empty);
        }
        return stage;
    }

    function renderDot(dot, maxLane) {
        const current = dot.depth === state.openDepth && dot.files.includes(state.openFile);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `tlp-dot${dot.isUser ? ' is-user' : ''}${current ? ' is-current' : ''}`;
        button.style.left = `${(dot.lane + maxLane) * COL + 8}px`;
        button.style.top = `${dot.row * ROW + 4}px`;
        button.setAttribute('aria-label', `${dot.name || 'Message'}, message ${dot.depth + 1}${current ? ', You are here' : ''}`);
        if (current) button.setAttribute('aria-current', 'true');
        const orb = el('span', 'tlp-orb');
        const face = dot.isUser ? state.userAvatar : state.charAvatar;
        if (state.showFaces && face) {
            orb.style.backgroundImage = `url("${face}")`;
            orb.classList.add('has-face');
        }
        const num = el('span', 'tlp-num');
        num.textContent = String(dot.depth + 1);
        button.append(orb, num);
        button.addEventListener('mouseenter', (event) => {
            if (state.bubbleKey) return;
            state.hover = { text: dot.preview || 'Empty message', name: dot.name, depth: dot.depth };
            const existing = root.querySelector('.tlp-hover');
            existing?.remove();
            root.append(renderHover(state.hover, event));
        });
        button.addEventListener('mouseleave', () => {
            state.hover = null;
            root.querySelector('.tlp-hover')?.remove();
        });
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            clearTimeout(clickTimer);
            if (event.detail === 0) openDot(dot);
            else clickTimer = setTimeout(() => openDot(dot), 280);
        });
        button.addEventListener('dblclick', (event) => {
            event.stopPropagation();
            clearTimeout(clickTimer);
            const { chart } = picture();
            const segment = chart.byId.get(dot.segmentId);
            if (segment?.kind !== 'run') return;
            if (state.expanded.has(segment.id)) state.expanded.delete(segment.id);
            else state.expanded.add(segment.id);
            state.bubbleKey = null;
            state.hover = null;
            render();
        });
        return button;
    }

    function renderBubble(dot) {
        const bubble = el('div', 'tlp-bubble');
        bubble.setAttribute('role', 'region');
        bubble.setAttribute('aria-label', 'Selected message');
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

    function renderHover(hover, event) {
        const tip = el('div', 'tlp-hover');
        tip.textContent = hover.name ? `${hover.name} · ${hover.depth + 1} — ${hover.text}` : hover.text;
        if (event) {
            tip.style.left = `${Math.max(8, Math.min(event.clientX + 14, window.innerWidth - 260))}px`;
            tip.style.top = `${Math.max(8, Math.min(event.clientY + 14, window.innerHeight - 160))}px`;
        }
        return tip;
    }

    function bindDrag(stage) {
        let drag = null;
        stage.addEventListener('pointerdown', (event) => {
            if (event.button !== 0) return;
            if (event.target.closest('.tlp-dot, .tlp-bubble, .tlp-button, .tlp-file')) return;
            drag = {
                id: event.pointerId,
                x: event.clientX,
                y: event.clientY,
                left: stage.scrollLeft,
                top: stage.scrollTop,
            };
            stage.classList.add('is-dragging');
            stage.setPointerCapture(event.pointerId);
        });
        stage.addEventListener('pointermove', (event) => {
            if (!drag || drag.id !== event.pointerId) return;
            stage.scrollLeft = drag.left - (event.clientX - drag.x);
            stage.scrollTop = drag.top - (event.clientY - drag.y);
        });
        const end = (event) => {
            if (!drag || (event && drag.id !== event.pointerId)) return;
            drag = null;
            stage.classList.remove('is-dragging');
        };
        stage.addEventListener('pointerup', end);
        stage.addEventListener('pointercancel', end);
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

    function setZoom(value, event) {
        const stage = root.querySelector('.tlp-stage');
        const board = root.querySelector('.tlp-board');
        const stageRect = stage?.getBoundingClientRect();
        const rect = board?.getBoundingClientRect();
        const x = event ? event.clientX - stageRect.left : (stage?.clientWidth || 0) / 2;
        const y = event ? event.clientY - stageRect.top : (stage?.clientHeight || 0) / 2;
        const localX = rect ? ((stageRect.left + x) - rect.left) / state.zoom : 0;
        const localY = rect ? ((stageRect.top + y) - rect.top) / state.zoom : 0;
        state.zoom = Math.min(MAX_ZOOM, Math.max(0.08, value));
        state.hover = null;
        render();
        const next = root.querySelector('.tlp-stage');
        const nextBoard = root.querySelector('.tlp-board')?.getBoundingClientRect();
        if (next && nextBoard) {
            const bounds = next.getBoundingClientRect();
            next.scrollLeft += nextBoard.left - bounds.left + localX * state.zoom - x;
            next.scrollTop += nextBoard.top - bounds.top + localY * state.zoom - y;
        }
    }

    function fit(drawn) {
        const stage = root.querySelector('.tlp-stage');
        const maxRow = drawn.dots.reduce((max, dot) => Math.max(max, dot.row || 0), 0);
        const maxLane = drawn.dots.reduce((max, dot) => Math.max(max, Math.abs(dot.lane)), 0);
        const boardW = maxLane * 2 * COL + 32;
        const boardH = (maxRow + 1) * ROW + 36;
        const width = stage?.clientWidth || root.clientWidth || 400;
        const height = stage?.clientHeight || 500;
        state.zoom = Math.min(1.4, Math.max(0.08, Math.min(Math.max(1, width - 24) / boardW, Math.max(1, height - 48) / boardH)));
        render();
        const next = root.querySelector('.tlp-stage');
        if (next) {
            next.scrollLeft = 0;
            next.scrollTop = 0;
        }
    }

    return { update, destroy };
}

function center(dot, maxLane = 0) {
    return { x: (dot.lane + maxLane) * COL + 8 + 8, y: (dot.row || 0) * ROW + 4 + 9 };
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

function toolButton(label, onClick) {
    const icons = {
        'Zoom out': 'fa-magnifying-glass-minus', 'Zoom in': 'fa-magnifying-glass-plus',
        'Show all': 'fa-expand', 'Expand all': 'fa-angles-down',
        'Collapse all': 'fa-angles-up', 'Dock': 'fa-right-to-bracket',
        'Pop out': 'fa-up-right-from-square', 'Close': 'fa-xmark',
        'You are here': 'fa-location-crosshairs',
    };
    const node = button(label, onClick);
    node.classList.add('tlp-icon-button');
    node.title = label;
    node.setAttribute('aria-label', label);
    const icon = el('i', `fa-solid ${icons[label]}`);
    icon.setAttribute('aria-hidden', 'true');
    node.replaceChildren(icon);
    return node;
}
