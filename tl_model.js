/**
 * Branch index and preset graph geometry for the timeline.
 * No SillyTavern imports, no Cytoscape, no Dagre.
 * Depth is the message index. A segment is a run of depths where the same
 * set of files still agrees on the text.
 */

export const GRAPH_WINDOW = 80;
export const GRAPH_SEGMENT_LIMIT = 250;
export const PAGE_SIZE = 40;

/**
 * @param {unknown} mes
 * @returns {string}
 */
export function normalizeMessageText(mes) {
    return String(mes ?? '').replace(/\r\n/g, '\n');
}

/**
 * @param {string} query
 * @returns {string[]}
 */
export function queryFragments(query) {
    const parts = String(query ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    return [...new Set(parts)];
}

/**
 * @param {string} text
 * @param {string[]} fragments lowercased
 * @returns {boolean}
 */
export function textMatchesFragments(text, fragments) {
    if (!fragments.length) {
        return true;
    }
    const hay = String(text ?? '').toLowerCase();
    return fragments.every(fragment => hay.includes(fragment));
}

/**
 * @param {string} fileName
 * @returns {string}
 */
export function displayFileName(fileName) {
    return String(fileName ?? '').replace(/\.jsonl$/i, '');
}

/**
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
export function previewText(text, max = 90) {
    const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
    if (flat.length <= max) {
        return flat;
    }
    return `${flat.slice(0, max - 1).trimEnd()}…`;
}

/**
 * @param {object|null|undefined} message
 * @param {Set<string>} fileSet
 * @returns {string|null}
 */
function liveBookmarkName(message, fileSet) {
    const link = message?.extra?.bookmark_link;
    if (!link || typeof link !== 'string') {
        return null;
    }
    const asFile = link.endsWith('.jsonl') ? link : `${link}.jsonl`;
    if (!fileSet.has(asFile) && !fileSet.has(link)) {
        return null;
    }
    return link;
}

/**
 * @param {Record<string, object[]>} chats
 * @returns {{ segments: object[], byId: Map<string, object>, roots: object[] }}
 */
export function buildTimeline(chats) {
    const source = chats && typeof chats === 'object' ? chats : {};
    const fileSet = new Set(
        Object.keys(source).filter(name => Array.isArray(source[name]) && source[name].length > 0),
    );
    /** @type {object[]} */
    const segments = [];
    let nextId = 0;

    /** @type {{ files: string[], depth: number, parentId: string|null }[]} */
    const queue = [];
    if (fileSet.size > 0) {
        queue.push({ files: [...fileSet], depth: 0, parentId: null });
    }

    while (queue.length > 0) {
        const job = queue.shift();
        const alive = job.files.filter(file => job.depth < source[file].length);
        if (alive.length === 0) {
            continue;
        }

        /** @type {Map<string, string[]>} */
        const groups = new Map();
        for (const file of alive) {
            const key = normalizeMessageText(source[file][job.depth]?.mes);
            const list = groups.get(key);
            if (list) {
                list.push(file);
            } else {
                groups.set(key, [file]);
            }
        }

        for (const group of groups.values()) {
            let end = job.depth + 1;
            const bookmarkAtStart = liveBookmarkName(source[group[0]][job.depth], fileSet);
            if (!bookmarkAtStart) {
                while (group.every(file => end < source[file].length)) {
                    const text = normalizeMessageText(source[group[0]][end]?.mes);
                    const agreed = group.every(file => normalizeMessageText(source[file][end]?.mes) === text);
                    if (!agreed) {
                        break;
                    }
                    end += 1;
                    if (liveBookmarkName(source[group[0]][end - 1], fileSet)) {
                        break;
                    }
                }
            }

            const head = source[group[0]][job.depth];
            const tail = source[group[0]][end - 1];
            const checkpointName = liveBookmarkName(tail, fileSet);
            let swipeMessages = 0;
            for (let depth = job.depth; depth < end; depth += 1) {
                const anySwipe = group.some(file => {
                    const swipes = source[file][depth]?.swipes;
                    return Array.isArray(swipes) && swipes.length > 1;
                });
                if (anySwipe) {
                    swipeMessages += 1;
                }
            }

            const segment = {
                id: `s${nextId}`,
                parentId: job.parentId,
                childIds: [],
                files: group.slice(),
                depthStart: job.depth,
                depthEnd: end,
                lane: 0,
                preview: previewText(head?.mes),
                tailPreview: previewText(tail?.mes),
                headName: head?.name || '',
                checkpoint: checkpointName
                    ? { name: checkpointName, depth: end - 1, sourceFile: group[0] }
                    : null,
                swipeMessages,
            };
            nextId += 1;
            segments.push(segment);

            const cont = group.filter(file => end < source[file].length);
            if (cont.length > 0) {
                queue.push({ files: cont, depth: end, parentId: segment.id });
            }
        }
    }

    const roots = assignLanes(segments, null);
    const byId = new Map(segments.map(segment => [segment.id, segment]));
    return { segments, byId, roots };
}

/**
 * @param {object[]} segments
 * @param {string|null} activeFile
 * @returns {object[]} roots, active file first
 */
function assignLanes(segments, activeFile) {
    const children = new Map();
    const roots = [];
    for (const segment of segments) {
        if (!segment.parentId) {
            roots.push(segment);
        } else {
            const list = children.get(segment.parentId);
            if (list) {
                list.push(segment);
            } else {
                children.set(segment.parentId, [segment]);
            }
        }
    }

    const rank = (segment) => {
        const current = activeFile && segment.files.includes(activeFile) ? 0 : 1;
        return [current, segment.files[0] || ''];
    };
    const byRank = (a, b) => {
        const [aCurrent, aName] = rank(a);
        const [bCurrent, bName] = rank(b);
        if (aCurrent !== bCurrent) {
            return aCurrent - bCurrent;
        }
        return aName.localeCompare(bName);
    };
    for (const list of children.values()) {
        list.sort(byRank);
    }
    roots.sort(byRank);

    let cursor = 0;
    const place = (segment) => {
        const kids = children.get(segment.id) || [];
        segment.childIds = kids.map(kid => kid.id);
        if (kids.length === 0) {
            segment.lane = cursor;
            cursor += 1;
            return;
        }
        for (const kid of kids) {
            place(kid);
        }
        segment.lane = kids[0].lane;
    };
    for (const root of roots) {
        place(root);
    }
    return roots;
}

/**
 * Re-rank with the open chat on the spine. `buildTimeline` does not know
 * which file is open, so the view calls this before painting.
 * @param {{ segments: object[] }} timeline
 * @param {string|null} activeFile
 */
export function preferActiveFile(timeline, activeFile) {
    if (!timeline) {
        return timeline;
    }
    timeline.roots = assignLanes(timeline.segments, activeFile);
    return timeline;
}

/**
 * @param {object} segment
 * @returns {string}
 */
export function segmentKey(segment) {
    return `${segment.depthStart}|${segment.files.slice().sort().join('|')}`;
}

/**
 * @param {{ segments: object[], byId: Map<string, object> }} timeline
 * @param {string|null} file
 * @param {number} depth
 * @returns {object|null}
 */
export function segmentAt(timeline, file, depth) {
    if (!timeline || !file) {
        return null;
    }
    let found = null;
    for (const segment of timeline.segments) {
        if (segment.files.includes(file) && depth >= segment.depthStart && depth < segment.depthEnd) {
            if (!found || segment.depthStart >= found.depthStart) {
                found = segment;
            }
        }
    }
    return found;
}

/**
 * @param {{ segments: object[], byId: Map<string, object> }} timeline
 * @returns {object[]}
 */
export function preorder(timeline) {
    if (!timeline) {
        return [];
    }
    /** @type {object[]} */
    const out = [];
    const walk = (segment) => {
        out.push(segment);
        for (const childId of segment.childIds) {
            const child = timeline.byId.get(childId);
            if (child) {
                walk(child);
            }
        }
    };
    for (const root of timeline.roots) {
        walk(root);
    }
    return out;
}

/**
 * Branch points: a segment whose parent has another child, or a checkpoint.
 * @param {{ segments: object[], byId: Map<string, object> }} timeline
 * @returns {object[]}
 */
export function branchPoints(timeline) {
    return preorder(timeline).filter(segment => {
        if (segment.checkpoint) {
            return true;
        }
        if (!segment.parentId) {
            return timeline.roots.length > 1;
        }
        const parent = timeline.byId.get(segment.parentId);
        return Boolean(parent && parent.childIds.length > 1);
    });
}

/**
 * @param {{ segments: object[], byId: Map<string, object> }} timeline
 * @param {string|null} file
 * @param {number} depth
 * @param {number} direction -1 or 1
 * @returns {object|null}
 */
export function neighborBranch(timeline, file, depth, direction) {
    const points = branchPoints(timeline);
    if (points.length === 0) {
        return null;
    }
    const here = segmentAt(timeline, file, depth);
    const index = here ? points.findIndex(point => point.id === here.id) : -1;
    if (index === -1) {
        if (direction > 0) {
            return points.find(point => point.depthStart > depth) || null;
        }
        for (let i = points.length - 1; i >= 0; i -= 1) {
            if (points[i].depthEnd <= depth) {
                return points[i];
            }
        }
        return null;
    }
    const next = index + direction;
    if (next < 0 || next >= points.length) {
        return null;
    }
    return points[next];
}

/**
 * @param {object} segment
 * @param {Record<string, object[]>} chats
 * @param {string[]} fragments
 * @returns {number[]}
 */
export function matchingDepths(segment, chats, fragments) {
    if (!fragments.length) {
        return [];
    }
    /** @type {number[]} */
    const hits = [];
    const file = segment.files[0];
    const messages = chats[file] || [];
    for (let depth = segment.depthStart; depth < segment.depthEnd; depth += 1) {
        const message = messages[depth];
        if (!message) {
            continue;
        }
        const parts = [normalizeMessageText(message.mes)];
        if (Array.isArray(message.swipes)) {
            for (const swipe of message.swipes) {
                parts.push(normalizeMessageText(swipe));
            }
        }
        if (parts.some(part => textMatchesFragments(part, fragments))) {
            hits.push(depth);
        }
    }
    return hits;
}

/**
 * @param {{ segments: object[], byId: Map<string, object>, roots: object[] }} timeline
 * @param {Record<string, object[]>} chats
 * @param {string} query
 * @returns {Set<string>|null} segment ids to show, or null when the query is empty
 */
export function visibleSegmentIds(timeline, chats, query) {
    const fragments = queryFragments(query);
    if (!fragments.length || !timeline) {
        return null;
    }
    /** @type {Set<string>} */
    const visible = new Set();
    for (const segment of timeline.segments) {
        if (matchingDepths(segment, chats, fragments).length > 0) {
            let current = segment;
            while (current) {
                visible.add(current.id);
                current = current.parentId ? timeline.byId.get(current.parentId) : null;
            }
        }
    }
    return visible;
}

/**
 * File to act on for a shared segment: the open chat when it is one of them.
 * @param {object} segment
 * @param {string|null} activeFile
 * @returns {string}
 */
export function actionFile(segment, activeFile) {
    if (activeFile && segment.files.includes(activeFile)) {
        return activeFile;
    }
    return segment.files[0];
}

/**
 * Preset Cytoscape elements for a depth window. One node per distinct text
 * at a depth, one edge per distinct hop. Positions are the layout.
 *
 * @param {Record<string, object[]>} chats
 * @param {number} depthStart inclusive
 * @param {number} depthEnd exclusive
 * @param {{ xGap?: number, yGap?: number }} [options]
 * @returns {{ nodes: object[], edges: object[], depthStart: number, depthEnd: number }}
 */
export function graphElements(chats, depthStart, depthEnd, options = {}) {
    const xGap = options.xGap ?? 72;
    const yGap = options.yGap ?? 36;
    const source = chats && typeof chats === 'object' ? chats : {};
    const start = Math.max(0, depthStart | 0);
    const end = Math.max(start, depthEnd | 0);

    /** @type {Map<string, string>} */
    const nodeAt = new Map();
    /** @type {object[]} */
    const nodes = [];
    /** @type {Map<string, object>} */
    const edges = new Map();
    /** @type {Map<number, Map<string, number>>} */
    const laneAtDepth = new Map();

    const files = Object.keys(source).filter(name => Array.isArray(source[name]));

    for (let depth = start; depth < end; depth += 1) {
        for (const file of files) {
            const message = source[file][depth];
            if (!message) {
                continue;
            }
            const text = normalizeMessageText(message.mes);
            const nodeKey = `${depth}\u0000${text}`;
            if (!nodeAt.has(nodeKey)) {
                const lanes = laneAtDepth.get(depth) || new Map();
                laneAtDepth.set(depth, lanes);
                const lane = lanes.size;
                lanes.set(nodeKey, lane);
                const id = `n${nodes.length}`;
                nodeAt.set(nodeKey, id);
                nodes.push({
                    group: 'nodes',
                    data: {
                        id,
                        depth,
                        msg: text,
                        name: message.name || '',
                        is_user: Boolean(message.is_user),
                        is_system: Boolean(message.is_system),
                        files: [file],
                    },
                    position: {
                        x: lane * xGap,
                        y: (depth - start) * yGap,
                    },
                });
            } else {
                const id = nodeAt.get(nodeKey);
                const node = nodes.find(item => item.data.id === id);
                if (node && !node.data.files.includes(file)) {
                    node.data.files.push(file);
                }
            }

            if (depth === start) {
                continue;
            }
            const previous = source[file][depth - 1];
            if (!previous) {
                continue;
            }
            const previousKey = `${depth - 1}\u0000${normalizeMessageText(previous.mes)}`;
            const sourceId = nodeAt.get(previousKey);
            const targetId = nodeAt.get(nodeKey);
            if (!sourceId || !targetId) {
                continue;
            }
            const edgeKey = `${sourceId}->${targetId}`;
            if (!edges.has(edgeKey)) {
                edges.set(edgeKey, {
                    group: 'edges',
                    data: {
                        id: `e${edges.size}`,
                        source: sourceId,
                        target: targetId,
                    },
                });
            }
        }
    }

    return {
        nodes,
        edges: [...edges.values()],
        depthStart: start,
        depthEnd: end,
    };
}

/**
 * @param {object} segment
 * @param {number} activeDepth
 * @param {string|null} activeFile
 * @returns {{ depthStart: number, depthEnd: number, windowed: boolean }}
 */
export function graphRangeForSegment(segment, activeDepth, activeFile) {
    const length = segment.depthEnd - segment.depthStart;
    if (length <= GRAPH_SEGMENT_LIMIT) {
        return { depthStart: segment.depthStart, depthEnd: segment.depthEnd, windowed: false };
    }
    const inside = activeFile
        && segment.files.includes(activeFile)
        && activeDepth >= segment.depthStart
        && activeDepth < segment.depthEnd;
    const anchor = inside ? activeDepth : segment.depthEnd - 1;
    let depthEnd = Math.min(segment.depthEnd, anchor + 1);
    let depthStart = Math.max(segment.depthStart, depthEnd - GRAPH_WINDOW);
    depthEnd = Math.min(segment.depthEnd, depthStart + GRAPH_WINDOW);
    return { depthStart, depthEnd, windowed: true };
}

/**
 * @param {{ depthStart: number, depthEnd: number }} range
 * @param {number} direction
 * @param {number} boundStart
 * @param {number} boundEnd
 * @returns {{ depthStart: number, depthEnd: number }}
 */
/**
 * One chat drawn as a spine, with the other chats that actually belong to it
 * hanging off the turn where they split. A file that shares a prefix and then
 * stops is a fork, even though it has no messages of its own after the split.
 * Unrelated chats are returned in `others` and are not drawn on the spine.
 *
 * @param {Record<string, object[]>} chats
 * @param {string|null} activeFile
 * @param {Record<string, {mainChat?: string|null}>} [metas]
 * @returns {{ spine: object[], forks: object[], others: string[], related: string[] }}
 */
/**
 * Files that belong on this chat's flowchart, and files that are a different story.
 * @param {Record<string, object[]>} chats
 * @param {string|null} activeFile
 * @param {Record<string, {mainChat?: string|null}>} [metas]
 * @returns {{ related: string[], others: string[] }}
 */
export function familyOf(chats, activeFile, metas = {}) {
    const source = chats && typeof chats === 'object' ? chats : {};
    const names = Object.keys(source).filter(name => Array.isArray(source[name]) && source[name].length > 0);
    if (!activeFile || !source[activeFile]?.length) {
        return { related: [], others: names };
    }
    const stemToFile = new Map(names.map(name => [displayFileName(name), name]));
    const resolveFile = (raw) => {
        if (!raw || typeof raw !== 'string') return null;
        if (names.includes(raw)) return raw;
        const withExt = raw.endsWith('.jsonl') ? raw : `${raw}.jsonl`;
        if (names.includes(withExt)) return withExt;
        return stemToFile.get(raw) || stemToFile.get(displayFileName(raw)) || null;
    };
    // A shared greeting is not evidence of a fork. Follow saved links in
    // both directions, including siblings and branches of branches.
    const links = new Map(names.map(file => [file, new Set()]));
    for (const file of names) {
        const targets = [metas?.[file]?.mainChat,
            ...source[file].map(message => message?.extra?.bookmark_link)];
        for (const target of targets) {
            const other = resolveFile(target);
            if (!other) continue;
            links.get(file).add(other);
            links.get(other).add(file);
        }
    }
    const related = new Set([activeFile]);
    for (const file of related) {
        for (const other of links.get(file) || []) related.add(other);
    }
    return {
        related: [...related],
        others: names.filter(name => !related.has(name)).sort(),
    };
}

/**
 * Top-down flowchart for one family. A run with no split is one node.
 * A file that shares the run and then stops becomes its own branch, so a
 * fork is visible on the parent even when it has no later messages.
 *
 * @param {Record<string, object[]>} chats
 * @param {string|null} activeFile
 * @param {Record<string, {mainChat?: string|null}>} [metas]
 */
export function buildChart(chats, activeFile, metas = {}) {
    const source = chats && typeof chats === 'object' ? chats : {};
    const { related, others } = familyOf(source, activeFile, metas);
    /** @type {object[]} */
    const nodes = [];
    if (!related.length) {
        return { nodes, roots: [], others, related };
    }
    let nextId = 0;
    /** @type {{ files: string[], depth: number, parentId: string|null }[]} */
    const queue = [{ files: related.slice(), depth: 0, parentId: null }];
    const textAt = (file, depth) => normalizeMessageText(source[file][depth]?.mes);

    while (queue.length) {
        const job = queue.shift();
        const alive = job.files.filter(file => job.depth < source[file].length);
        if (!alive.length) {
            continue;
        }
        /** @type {Map<string, string[]>} */
        const groups = new Map();
        for (const file of alive) {
            const key = textAt(file, job.depth);
            const list = groups.get(key);
            if (list) {
                list.push(file);
            } else {
                groups.set(key, [file]);
            }
        }
        for (const group of groups.values()) {
            let end = job.depth + 1;
            while (group.every(file => end < source[file].length)) {
                const text = textAt(group[0], end);
                if (!group.every(file => textAt(file, end) === text)) {
                    break;
                }
                end += 1;
            }
            const head = source[group[0]][job.depth];
            const tail = source[group[0]][end - 1];
            const node = {
                id: `n${nextId}`,
                kind: 'run',
                parentId: job.parentId,
                childIds: [],
                files: group.slice(),
                depthStart: job.depth,
                depthEnd: end,
                preview: previewText(head?.mes, 220),
                tailPreview: previewText(tail?.mes, 220),
                headName: head?.name || '',
                tailName: tail?.name || '',
            };
            nextId += 1;
            nodes.push(node);
            const ended = group.filter(file => source[file].length === end);
            const cont = group.filter(file => source[file].length > end);
            if (cont.length && ended.length) {
                for (const file of ended) {
                    nodes.push({
                        id: `n${nextId}`,
                        kind: 'end',
                        parentId: node.id,
                        childIds: [],
                        files: [file],
                        depthStart: end - 1,
                        depthEnd: end,
                        preview: previewText(source[file][end - 1]?.mes, 220),
                        tailPreview: '',
                        headName: source[file][end - 1]?.name || '',
                        tailName: '',
                    });
                    nextId += 1;
                }
            }
            if (cont.length) {
                queue.push({ files: cont, depth: end, parentId: node.id });
            }
        }
    }

    const byId = new Map(nodes.map(node => [node.id, node]));
    for (const node of nodes) {
        node.childIds = nodes.filter(child => child.parentId === node.id).map(child => child.id);
        node.childIds.sort((a, b) => {
            const left = byId.get(a);
            const right = byId.get(b);
            const leftActive = activeFile && left.files.includes(activeFile) ? 0 : 1;
            const rightActive = activeFile && right.files.includes(activeFile) ? 0 : 1;
            if (leftActive !== rightActive) {
                return leftActive - rightActive;
            }
            if (left.kind !== right.kind) {
                return left.kind === 'run' ? -1 : 1;
            }
            return (left.files[0] || '').localeCompare(right.files[0] || '');
        });
    }
    const roots = nodes.filter(node => !node.parentId);
    return { nodes, roots, byId, others, related };
}

/**
 * Places the collapsed (or partly expanded) chart on a shared message-number grid.
 * y is the message index. x is the branch column. Expanding one run adds dots
 * on their own rows and leaves every other dot where it was.
 *
 * @param {object} chart
 * @param {Record<string, object[]>} chats
 * @param {Iterable<string>} [expanded]
 * @param {string|null} [activeFile]
 */
export function layoutChart(chart, chats, expanded = [], activeFile = null) {
    const expandedSet = expanded instanceof Set ? expanded : new Set(expanded || []);
    const laneOf = new Map();
    let cursor = 1;
    const walk = (node, lane) => {
        laneOf.set(node.id, lane);
        let keptRun = false;
        const children = [];
        for (const id of node.childIds || []) {
            const child = chart.byId.get(id);
            if (!child) continue;
            if (!keptRun && child.kind === 'run') {
                keptRun = true;
                children.push([child, lane]);
            } else {
                const next = Math.ceil(cursor / 2) * (cursor % 2 ? 1 : -1);
                cursor += 1;
                children.push([child, next]);
            }
        }
        for (const [child, next] of children) walk(child, next);
    };
    for (const root of chart.roots || []) {
        walk(root, 0);
    }

    /** @type {Map<string, object>} */
    const dotAt = new Map();
    /** @type {object[]} */
    const dots = [];
    const addDot = (segment, depth) => {
        const key = `${segment.id}:${depth}`;
        if (dotAt.has(key)) return dotAt.get(key);
        const file = activeFile && segment.files.includes(activeFile) ? activeFile : segment.files[0];
        const message = chats?.[file]?.[depth];
        const dot = {
            key,
            segmentId: segment.id,
            depth,
            lane: laneOf.get(segment.id) || 0,
            file,
            name: message?.name || segment.headName || '',
            isUser: Boolean(message?.is_user),
            preview: previewText(message?.mes ?? segment.preview, 140),
            text: message?.mes || '',
            kind: segment.kind,
            files: segment.files,
        };
        dotAt.set(key, dot);
        dots.push(dot);
        return dot;
    };

    /** @type {{from: string, to: string}[]} */
    const edges = [];
    const link = (from, to) => {
        if (from && to && from !== to) edges.push({ from, to });
    };

    for (const segment of chart.nodes || []) {
        if (segment.kind === 'end') {
            addDot(segment, segment.depthStart);
            continue;
        }
        const depths = new Set([segment.depthStart, segment.depthEnd - 1]);
        if (expandedSet.has(segment.id)) {
            for (let depth = segment.depthStart; depth < segment.depthEnd; depth += 1) {
                depths.add(depth);
            }
        }
        const ordered = [...depths].sort((a, b) => a - b);
        let previous = null;
        for (const depth of ordered) {
            const dot = addDot(segment, depth);
            if (previous) link(previous.key, dot.key);
            previous = dot;
        }
    }

    for (const segment of chart.nodes || []) {
        if (!segment.parentId) continue;
        const parent = chart.byId.get(segment.parentId);
        if (!parent) continue;
        link(`${parent.id}:${parent.depthEnd - 1}`, `${segment.id}:${segment.depthStart}`);
    }

    const depths = [...new Set(dots.map(dot => dot.depth))].sort((a, b) => a - b);
    const rowOf = new Map(depths.map((depth, index) => [depth, index]));
    for (const dot of dots) {
        dot.row = rowOf.get(dot.depth);
    }

    return { dots, edges, laneCount: Math.max(cursor, 1), rowCount: depths.length };
}

export function buildFlow(chats, activeFile, metas = {}) {
    const source = chats && typeof chats === 'object' ? chats : {};
    const names = Object.keys(source).filter(name => Array.isArray(source[name]) && source[name].length > 0);
    const { related: relatedList, others } = familyOf(source, activeFile, metas);
    if (!activeFile || !source[activeFile]?.length) {
        return { spine: [], forks: [], others: names, related: [] };
    }
    const related = new Set(relatedList);
    const active = source[activeFile];
    const textAt = (file, depth) => normalizeMessageText(source[file][depth]?.mes);

    const spine = active.map((message, depth) => ({
        depth,
        name: message?.name || (message?.is_user ? 'You' : 'Character'),
        isUser: Boolean(message?.is_user),
        preview: previewText(message?.mes, 280),
        swipeCount: Array.isArray(message?.swipes)
            ? message.swipes.filter(swipe => normalizeMessageText(swipe) !== normalizeMessageText(message?.mes)).length
            : 0,
    }));

    /** @type {object[]} */
    const forks = [];
    for (const file of related) {
        if (file === activeFile) {
            continue;
        }
        const messages = source[file];
        let shared = 0;
        const limit = Math.min(active.length, messages.length);
        while (shared < limit && textAt(activeFile, shared) === textAt(file, shared)) {
            shared += 1;
        }
        if (shared === 0) {
            forks.push({
                anchor: 0,
                file,
                kind: 'linked',
                preview: previewText(messages[0]?.mes, 160),
                otherLength: messages.length,
            });
            continue;
        }
        if (shared < messages.length && shared < active.length) {
            forks.push({
                anchor: shared,
                file,
                kind: 'diverges',
                preview: previewText(messages[shared]?.mes, 160),
                otherLength: messages.length,
            });
        } else if (shared === messages.length && messages.length < active.length) {
            forks.push({
                anchor: messages.length - 1,
                file,
                kind: 'ends',
                preview: '',
                otherLength: messages.length,
            });
        } else if (shared === active.length && messages.length > active.length) {
            forks.push({
                anchor: active.length,
                file,
                kind: 'continues',
                preview: previewText(messages[active.length]?.mes, 160),
                otherLength: messages.length,
            });
        } else {
            forks.push({
                anchor: Math.max(0, active.length - 1),
                file,
                kind: 'same',
                preview: '',
                otherLength: messages.length,
            });
        }
    }

    forks.sort((a, b) => a.anchor - b.anchor || a.file.localeCompare(b.file));
    return { spine, forks, others, related: [...related] };
}

export function shiftGraphRange(range, direction, boundStart, boundEnd) {
    const span = Math.max(1, range.depthEnd - range.depthStart);
    let depthStart = range.depthStart + (direction * span);
    if (depthStart < boundStart) {
        depthStart = boundStart;
    }
    let depthEnd = depthStart + span;
    if (depthEnd > boundEnd) {
        depthEnd = boundEnd;
        depthStart = Math.max(boundStart, depthEnd - span);
    }
    return { depthStart, depthEnd };
}
