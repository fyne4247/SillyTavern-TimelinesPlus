import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
    GRAPH_WINDOW,
    buildChart,
    familyOf,
    buildFlow,
    buildTimeline,
    graphElements,
    layoutChart,
    graphRangeForSegment,
    neighborBranch,
    preferActiveFile,
    queryFragments,
    segmentAt,
    visibleSegmentIds,
} from '../tl_model.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(here, '..', 'fixtures', 'chats');

/**
 * @param {string} filePath
 * @returns {object[]}
 */
function readChat(filePath) {
    const messages = [];
    const raw = fs.readFileSync(filePath, 'utf8');
    for (const line of raw.split(/\n/)) {
        if (!line.trim()) {
            continue;
        }
        const row = JSON.parse(line);
        if (row && Object.prototype.hasOwnProperty.call(row, 'mes')) {
            messages.push(row);
        }
    }
    return messages;
}

/**
 * @param {string} dir
 * @returns {Record<string, object[]>}
 */
function readDir(dir) {
    /** @type {Record<string, object[]>} */
    const chats = {};
    for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith('.jsonl')) {
            continue;
        }
        chats[name] = readChat(path.join(dir, name));
    }
    return chats;
}

function chain(length, label = 'a', swipes = 0) {
    return Array.from({ length }, (_, depth) => ({
        mes: `${label}-${depth}`,
        name: depth % 2 === 0 ? 'Bot' : 'User',
        is_user: depth % 2 === 1,
        swipes: swipes > 0 ? [`${label}-${depth}`, `${label}-${depth}-alt`] : undefined,
    }));
}

test('a long chain is one segment and does not throw', () => {
    const chats = { 'long.jsonl': chain(2000) };
    const timeline = buildTimeline(chats);
    assert.equal(timeline.segments.length, 1);
    assert.equal(timeline.segments[0].depthStart, 0);
    assert.equal(timeline.segments[0].depthEnd, 2000);
    const graph = graphElements(chats, 0, 2000);
    assert.equal(graph.nodes.length, 2000);
    assert.equal(graph.edges.length, 1999);
    assert.equal(new Set(graph.nodes.map(node => node.data.id)).size, 2000);
});

test('identical copies share one segment and one edge per hop', () => {
    const body = chain(100);
    /** @type {Record<string, object[]>} */
    const chats = {};
    for (let i = 0; i < 10; i += 1) {
        chats[`copy-${i}.jsonl`] = body.map(message => ({ ...message }));
    }
    const timeline = buildTimeline(chats);
    assert.equal(timeline.segments.length, 1);
    assert.equal(timeline.segments[0].files.length, 10);
    const graph = graphElements(chats, 0, 100);
    assert.equal(graph.nodes.length, 100);
    assert.equal(graph.edges.length, 99);
});

test('a fork splits into a shared stem and one tail per file', () => {
    const stem = chain(10, 'stem');
    const chats = {
        'a.jsonl': stem.concat(chain(4, 'a')),
        'b.jsonl': stem.map(message => ({ ...message })).concat(chain(2, 'b')),
    };
    const timeline = buildTimeline(chats);
    assert.equal(timeline.segments.length, 3);
    const shared = timeline.segments.find(segment => segment.files.length === 2);
    assert.ok(shared);
    assert.equal(shared.depthStart, 0);
    assert.equal(shared.depthEnd, 10);
    assert.equal(shared.childIds.length, 2);
});

test('a dead checkpoint link does not split, a live one does', () => {
    const messages = chain(6);
    messages[2] = {
        ...messages[2],
        extra: { bookmark_link: 'missing-chat' },
    };
    const dead = buildTimeline({ 'main.jsonl': messages });
    assert.equal(dead.segments.length, 1);

    const liveMessages = chain(6);
    liveMessages[2] = {
        ...liveMessages[2],
        extra: { bookmark_link: 'side.jsonl' },
    };
    const live = buildTimeline({
        'main.jsonl': liveMessages,
        'side.jsonl': chain(1, 'side'),
    });
    const mainSegments = live.segments.filter(segment => segment.files.includes('main.jsonl') && segment.files.length === 1);
    const checkpoint = live.segments.find(segment => segment.checkpoint);
    assert.ok(checkpoint);
    assert.equal(checkpoint.depthEnd, 3);
    assert.equal(checkpoint.checkpoint.name, 'side.jsonl');
    assert.ok(mainSegments.some(segment => segment.depthStart === 3));
});

test('fragment search keeps the ancestor of a hit', () => {
    const chats = {
        'a.jsonl': [
            { mes: 'hello there' },
            { mes: 'unique lantern phrase' },
        ],
    };
    const timeline = buildTimeline(chats);
    assert.deepEqual(queryFragments('  Lantern   phrase lantern '), ['lantern', 'phrase']);
    const visible = visibleSegmentIds(timeline, chats, 'lantern phrase');
    assert.equal(visible.size, 1);
    const miss = visibleSegmentIds(timeline, chats, 'lantern missing');
    assert.equal(miss.size, 0);
});

test('graph window stays inside a long segment and neighbor branch walks forks', () => {
    const stem = chain(10, 'stem');
    const chats = {
        'a.jsonl': stem.concat(chain(400, 'a')),
        'b.jsonl': stem.map(message => ({ ...message })).concat(chain(5, 'b')),
    };
    const timeline = preferActiveFile(buildTimeline(chats), 'a.jsonl');
    const current = segmentAt(timeline, 'a.jsonl', 200);
    assert.ok(current);
    const range = graphRangeForSegment(current, 200, 'a.jsonl');
    assert.equal(range.windowed, true);
    assert.equal(range.depthEnd - range.depthStart, GRAPH_WINDOW);
    assert.ok(range.depthStart <= 200 && 200 < range.depthEnd);

    const next = neighborBranch(timeline, 'a.jsonl', 0, 1);
    assert.ok(next);
    assert.ok(next.depthStart >= 10 || next.files.length === 1);
});

test('collapsed chart keeps message numbers on shared rows', () => {
    const stem = chain(10, 'stem');
    const chats = {
        'parent.jsonl': stem.concat(chain(5, 'more')),
        'branch.jsonl': stem.map(message => ({ ...message })),
    };
    const chart = buildChart(chats, 'parent.jsonl', { 'branch.jsonl': { mainChat: 'parent' } });
    const collapsed = layoutChart(chart, chats, [], 'parent.jsonl');
    const rows = new Map();
    for (const dot of collapsed.dots) {
        const list = rows.get(dot.depth) || [];
        list.push(dot);
        rows.set(dot.depth, list);
    }
    assert.ok(rows.get(0)?.length);
    assert.ok(rows.get(9)?.some(dot => dot.kind === 'end'));
    assert.ok(rows.get(9)?.some(dot => dot.kind === 'run'));
    assert.equal(rows.get(9).every(dot => dot.depth === 9), true);
    const packedStart = collapsed.dots.find(dot => dot.depth === 0).row;
    const packedShared = collapsed.dots.find(dot => dot.depth === 9 && dot.kind === 'run').row;
    assert.equal(packedShared, packedStart + 1);
    const endLane = rows.get(9).find(dot => dot.kind === 'end').lane;
    const sharedLane = rows.get(9).find(dot => dot.kind === 'run').lane;
    assert.notEqual(endLane, sharedLane);

    const tail = chart.nodes.find(node => node.kind === 'run' && node.depthStart === 10);
    const expanded = layoutChart(chart, chats, [tail.id], 'parent.jsonl');
    const endAfter = expanded.dots.find(dot => dot.kind === 'end');
    assert.equal(endAfter.depth, 9);
    assert.equal(endAfter.lane, endLane);
    assert.equal(endAfter.row, expanded.dots.find(dot => dot.depth === 9 && dot.kind === 'run').row);
    const row10 = expanded.dots.find(dot => dot.depth === 10).row;
    const row12 = expanded.dots.find(dot => dot.depth === 12).row;
    assert.equal(row12, row10 + 2);
    assert.ok(expanded.dots.some(dot => dot.depth === 12 && dot.lane === sharedLane));
    assert.equal(expanded.dots.filter(dot => dot.depth === 12).every(dot => dot.lane === sharedLane), true);
});

test('a branch that stops is still a fork on the longer chat', () => {
    const stem = chain(10, 'stem');
    const chats = {
        'parent.jsonl': stem.concat(chain(5, 'more')),
        'branch.jsonl': stem.map(message => ({ ...message })),
        'unrelated.jsonl': chain(4, 'other'),
    };
    const flow = buildFlow(chats, 'parent.jsonl', {
        'branch.jsonl': { mainChat: 'parent' },
    });
    assert.deepEqual(flow.others, ['unrelated.jsonl']);
    const ended = flow.forks.find(fork => fork.file === 'branch.jsonl');
    assert.ok(ended);
    assert.equal(ended.kind, 'ends');
    assert.equal(ended.anchor, 9);

    const fromBranch = buildFlow(chats, 'branch.jsonl', { 'branch.jsonl': { mainChat: 'parent' } });
    const cont = fromBranch.forks.find(fork => fork.file === 'parent.jsonl');
    assert.equal(cont.kind, 'continues');
    assert.equal(cont.anchor, 10);
});

test('a real split hangs off the first message that differs', () => {
    const stem = chain(4, 'stem');
    const chats = {
        'parent.jsonl': stem.concat(chain(3, 'parent')),
        'fork.jsonl': stem.map(message => ({ ...message })).concat(chain(2, 'fork')),
    };
    const flow = buildFlow(chats, 'parent.jsonl', { 'fork.jsonl': { mainChat: 'parent' } });
    const fork = flow.forks.find(item => item.file === 'fork.jsonl');
    assert.equal(fork.kind, 'diverges');
    assert.equal(fork.anchor, 4);
    assert.match(fork.preview, /^fork-0/);
});

test('Papa, Rabbit, and Luna fixtures', () => {
    if (!fs.existsSync(fixtureRoot)) {
        return;
    }
    const papa = readDir(path.join(fixtureRoot, 'Papa'));
    const papaTimeline = buildTimeline(papa);
    const papaShared = papaTimeline.segments.filter(segment => segment.files.length === 3);
    assert.equal(papaShared.length, 1);
    assert.equal(papaShared[0].depthEnd, 1009);
    assert.equal(papaShared[0].childIds.length, 2);
    const papaFiles = new Set(papaTimeline.segments.flatMap(segment => segment.files));
    assert.equal(papaFiles.size, 3);
    assert.ok(papaTimeline.segments.length < 20);

    const luna = readDir(path.join(fixtureRoot, 'Luna Walcott-Fisher'));
    const lunaTimeline = buildTimeline(luna);
    assert.equal(lunaTimeline.segments.length, 1);
    assert.ok(lunaTimeline.segments[0].depthEnd > 1400);

    const rabbit = readDir(path.join(fixtureRoot, 'Rabbit'));
    const rabbitTimeline = buildTimeline(rabbit);
    assert.ok(rabbitTimeline.segments.length > 1);
    const rabbitGraph = graphElements(rabbit, 0, 40);
    const edgeKeys = new Set(rabbitGraph.edges.map(edge => `${edge.data.source}->${edge.data.target}`));
    assert.equal(edgeKeys.size, rabbitGraph.edges.length);
});


test('shared greetings do not connect independent chats; saved links connect the whole family', () => {
    const chats = Object.fromEntries(['parent', 'branch', 'sibling', 'grandchild', 'independent'].map(name => [`${name}.jsonl`, chain(3, 'same')]));
    const metas = {
        'branch.jsonl': { mainChat: 'parent' },
        'sibling.jsonl': { mainChat: 'parent.jsonl' },
        'grandchild.jsonl': { mainChat: 'branch' },
    };
    assert.deepEqual(familyOf(chats, 'independent.jsonl', metas).related, ['independent.jsonl']);
    assert.deepEqual(new Set(familyOf(chats, 'grandchild.jsonl', metas).related), new Set(['parent.jsonl', 'branch.jsonl', 'sibling.jsonl', 'grandchild.jsonl']));
    chats['independent.jsonl'][1].extra = { bookmark_link: 'parent' };
    assert.equal(familyOf(chats, 'independent.jsonl', metas).related.length, 5);
});
