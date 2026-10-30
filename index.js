import { getContext } from '../../../extensions.js';
import { event_types, eventSource, getThumbnailUrl, user_avatar } from '../../../../script.js';
import { power_user } from '../../../power-user.js';
import { createNewBookmark } from '../../../bookmarks.js';
import { registerSlashCommand } from '../../../slash-commands.js';
import { closeModal, navigateToMessage } from './tl_utils.js';
import { mountTimeline } from './tl_view.js';

// Resolve assets beside this module, regardless of the installation folder name.
const timelineTemplateUrl = new URL('./timeline.html', import.meta.url).href;

const cache = new Map();
let view = null;
let loadToken = 0;
let listenersBound = false;
/** @type {{ chats: Record<string, object[]>, metas: Record<string, {mainChat: string|null}>, token: number }} */
let session = { chats: {}, metas: {}, token: 0 };

function activeFileName(context) {
    const chatId = context?.chatId;
    if (!chatId) {
        return null;
    }
    if (context.groupId) {
        return String(chatId);
    }
    return String(chatId).endsWith('.jsonl') ? String(chatId) : `${chatId}.jsonl`;
}

function ensureDock() {
    let dock = document.getElementById('tlpDock');
    if (!dock) {
        dock = document.createElement('div');
        dock.id = 'tlpDock';
        dock.hidden = true;
        document.body.appendChild(dock);
    }
    return dock;
}

function rootNode() {
    return document.getElementById('tlpRoot');
}

function showDock() {
    const dock = ensureDock();
    const root = rootNode();
    if (root) dock.appendChild(root);
    dock.hidden = false;
    document.body.classList.add('tlp-dock-open');
    const modal = document.getElementById('timelinesModal');
    if (modal) modal.style.display = 'none';
    view?.update({ popped: false, ...faceOptions() });
}

function showPopout() {
    const modal = document.getElementById('timelinesModal');
    const shell = document.getElementById('networkContainer');
    const root = rootNode();
    if (!modal || !shell || !root) return;
    document.body.appendChild(modal);
    shell.appendChild(root);
    modal.style.display = 'block';
    ensureDock().hidden = true;
    document.body.classList.remove('tlp-dock-open');
    view?.update({ popped: true });
}

function hideTimeline() {
    const dock = document.getElementById('tlpDock');
    if (dock) dock.hidden = true;
    document.body.classList.remove('tlp-dock-open');
    closeModal();
}

function showModal() {
    const modal = document.getElementById('timelinesModal');
    if (!modal) {
        console.error('Timelines: modal not found');
        return;
    }
    document.body.appendChild(modal);
    modal.style.display = 'block';
    modal.onclick = (event) => {
        if (event.target === modal) {
            closeModal();
        }
    };
}

function colors() {
    return {
        userColor: power_user?.quote_text_color || '',
        charColor: power_user?.main_text_color || '',
    };
}

function faceOptions() {
    const context = getContext();
    const character = context.characters?.[context.characterId];
    let userAvatar = '';
    let charAvatar = '';
    try {
        if (user_avatar) userAvatar = getThumbnailUrl('persona', user_avatar);
        if (character?.avatar) charAvatar = getThumbnailUrl('avatar', character.avatar);
    } catch (error) {
        console.warn('Timelines: avatar lookup failed', error);
    }
    return {
        showFaces: timelineSettings().showNodeFaces === true,
        userAvatar,
        charAvatar,
    };
}

function formatMessage(message, depth) {
    const context = getContext();
    if (typeof context.messageFormatting === 'function') {
        return context.messageFormatting(
            message.mes,
            message.name,
            Boolean(message.is_system),
            Boolean(message.is_user),
            depth,
        );
    }
    return String(message?.mes ?? '');
}

function ensureView() {
    if (view) {
        return view;
    }
    const root = document.getElementById('tlpRoot');
    view = mountTimeline(root, {
        formatMessage,
        onClose: () => hideTimeline(),
        onPopout: () => showPopout(),
        onDock: () => {
            showDock();
            view?.update({ popped: false });
        },
        onOpen: async (file, depth) => {
            hideTimeline();
            await navigateToMessage(file, depth);
        },
        onFork: async (file, depth, swipeId) => {
            hideTimeline();
            await navigateToMessage(file, depth, swipeId ?? -1, true);
        },
        onEdit: async (file, depth) => {
            hideTimeline();
            await navigateToMessage(file, depth);
            const message = document.querySelector(`#chat [mesid="${depth}"]`);
            message?.querySelector('.mes_edit')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        },
        onCheckpoint: async (file, depth) => {
            const name = window.prompt('Checkpoint name');
            if (!name) {
                return;
            }
            hideTimeline();
            await navigateToMessage(file, depth);
            await createNewBookmark(depth, { forceName: name });
        },
        onDelete: async (file) => {
            const context = getContext();
            if (context.groupId && !context.characterId) {
                toastr.warning('Deleting a group chat from the timeline is not available.');
                return;
            }
            if (file === activeFileName(context)) {
                toastr.warning('The open chat stays. Switch chats, then delete this file.');
                return;
            }
            const confirmed = window.confirm(`Delete chat file "${file}"? This cannot be undone.`);
            if (!confirmed) {
                return;
            }
            const avatar = context.characters?.[context.characterId]?.avatar;
            const response = await fetch('/api/chats/delete', {
                method: 'POST',
                headers: context.getRequestHeaders(),
                body: JSON.stringify({ avatar_url: avatar, chatfile: file }),
            });
            if (!response.ok) {
                toastr.error('The chat file was not deleted.');
                return;
            }
            cache.delete(file);
            delete session.chats[file];
            view.update({
                chats: session.chats,
                loadingLabel: '',
                ...colors(),
            });
            toastr.success(`Deleted ${file}`);
        },
    });
    return view;
}

async function fetchChatList(context) {
    if (!context.characterId) {
        const group = context.groups?.find(item => item.id === context.groupId);
        return (group?.chats || []).map(file_name => ({ file_name, file_size: '', last_mes: '' }));
    }
    const avatar = context.characters?.[context.characterId]?.avatar;
    if (!avatar) {
        return [];
    }
    const response = await fetch('/api/characters/chats', {
        method: 'POST',
        headers: context.getRequestHeaders(),
        body: JSON.stringify({ avatar_url: avatar }),
    });
    if (!response.ok) {
        return [];
    }
    const data = await response.json();
    return Array.isArray(data) ? data : [];
}

async function fetchChat(context, fileName) {
    const isGroup = !context.characterId && context.groupId;
    const endpoint = isGroup ? '/api/chats/group/get' : '/api/chats/get';
    const body = isGroup
        ? { id: fileName }
        : {
            ch_name: context.characters[context.characterId].name,
            file_name: String(fileName).replace(/\.jsonl$/i, ''),
            avatar_url: context.characters[context.characterId].avatar,
        };
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: context.getRequestHeaders(),
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        return null;
    }
    const data = await response.json();
    if (!Array.isArray(data)) {
        return null;
    }
    let mainChat = null;
    if (!isGroup) {
        const header = data.shift();
        mainChat = header?.chat_metadata?.main_chat || null;
    }
    return { messages: data, mainChat };
}

async function pool(items, limit, worker) {
    let cursor = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            const index = cursor;
            cursor += 1;
            await worker(items[index]);
        }
    });
    await Promise.all(runners);
}

function bindListeners() {
    if (listenersBound) {
        return;
    }
    listenersBound = true;
    const dropActiveCache = () => {
        const context = getContext();
        const file = activeFileName(context);
        if (file) {
            cache.delete(file);
        }
    };
    eventSource.on(event_types.CHAT_CHANGED, () => {
        dropActiveCache();
        const dock = document.getElementById('tlpDock');
        const modal = document.getElementById('timelinesModal');
        const popped = modal?.style.display === 'block';
        if ((dock && !dock.hidden) || popped) {
            openTimeline(false);
            if (popped) showPopout();
        } else {
            // Invalidate requests from the previous chat, even while hidden.
            loadToken += 1;
        }
    });
    eventSource.on(event_types.MESSAGE_EDITED, dropActiveCache);
    eventSource.on(event_types.MESSAGE_DELETED, dropActiveCache);
    eventSource.on(event_types.MESSAGE_UPDATED, dropActiveCache);
    eventSource.on(event_types.MESSAGE_SWIPED, dropActiveCache);
    eventSource.on(event_types.CHAT_DELETED, (name) => {
        if (!name) {
            return;
        }
        const file = String(name).endsWith('.jsonl') ? String(name) : `${name}.jsonl`;
        cache.delete(file);
        cache.delete(String(name));
    });
}

/**
 * @param {boolean} reload
 * @returns {Promise<void>}
 */
async function openTimeline(reload) {
    bindListeners();
    const token = ++loadToken;
    session = { chats: {}, metas: {}, token };
    if (reload) {
        cache.clear();
    }

    const context = getContext();
    const file = activeFileName(context);
    const live = Array.isArray(context.chat) ? context.chat : [];
    if (file && live.length > 0) {
        session.chats[file] = live;
        session.metas[file] = { mainChat: context.chatMetadata?.main_chat || null };
    }

    showDock();
    const mounted = ensureView();
    const depth = Math.max(0, live.length - 1);
    mounted.update({
        chats: session.chats,
        metas: session.metas,
        activeFile: file,
        activeDepth: depth,
        loadingLabel: 'Loading other chats…',
        popped: false,
        ...colors(),
        ...faceOptions(),
    });

    let list = [];
    try {
        list = await fetchChatList(context);
    } catch (error) {
        console.error(error);
        mounted.update({
            chats: session.chats,
            metas: session.metas,
            loadingLabel: 'The chat list could not be loaded.',
            ...colors(),
        });
        return;
    }
    if (token !== loadToken) {
        return;
    }

    const pending = list.filter(item => item?.file_name && item.file_name !== file);
    if (pending.length === 0) {
        mounted.update({ chats: session.chats, metas: session.metas, loadingLabel: '', ...colors() });
        return;
    }

    let done = 0;
    await pool(pending, 4, async (item) => {
        if (token !== loadToken) {
            return;
        }
        const stamp = `${item.file_size || ''}|${item.last_mes || ''}`;
        const cached = cache.get(item.file_name);
        let loaded = cached && stamp !== '|' && cached.stamp === stamp ? cached : null;
        if (!loaded) {
            try {
                const fetched = await fetchChat(getContext(), item.file_name);
                if (fetched) {
                    loaded = { stamp, messages: fetched.messages, mainChat: fetched.mainChat };
                    cache.set(item.file_name, loaded);
                }
            } catch (error) {
                console.error(error);
            }
        }
        if (!loaded || token !== loadToken) {
            return;
        }
        session.chats[item.file_name] = loaded.messages;
        session.metas[item.file_name] = { mainChat: loaded.mainChat || null };
        done += 1;
        mounted.update({
            chats: session.chats,
            metas: session.metas,
            loadingLabel: done < pending.length ? `Loaded ${done} of ${pending.length} other chats` : '',
            ...colors(),
        });
    });
}

function slashCommandHandler(_, reload) {
    openTimeline(reload === 'r');
}

const TOP_BAR_ID = 'extensionTopBar';
const TOP_BAR_NAME_ID = 'extensionTopBarChatName';
const TOP_BAR_BUTTON_ID = 'tlp-topbar-button';
const WAND_BUTTON_ID = 'tlp-wand-button';

function timelineSettings() {
    const settings = getContext().extensionSettings;
    if (!settings.timeline || typeof settings.timeline !== 'object') {
        settings.timeline = {};
    }
    if (typeof settings.timeline.showTopBarButton !== 'boolean') {
        settings.timeline.showTopBarButton = true;
    }
    if (typeof settings.timeline.showNodeFaces !== 'boolean') {
        settings.timeline.showNodeFaces = false;
    }
    return settings.timeline;
}

function placeTopBarButton() {
    const enabled = timelineSettings().showTopBarButton !== false;
    const existing = document.getElementById(TOP_BAR_BUTTON_ID);
    if (!enabled) {
        existing?.remove();
        return false;
    }
    const topBar = document.getElementById(TOP_BAR_ID);
    if (!topBar) {
        return false;
    }
    let button = existing;
    if (!button) {
        button = document.createElement('i');
        button.id = TOP_BAR_BUTTON_ID;
        button.className = 'fa-fw fa-solid fa-code-branch right_menu_button';
        button.title = 'Timeline';
        button.tabIndex = 0;
        button.setAttribute('role', 'button');
        button.addEventListener('click', () => {
            if (button.classList.contains('not-in-chat')) {
                return;
            }
            const dock = document.getElementById('tlpDock');
            const modal = document.getElementById('timelinesModal');
            if ((dock && !dock.hidden) || modal?.style.display === 'block') hideTimeline();
            else openTimeline(false);
        });
        button.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') {
                return;
            }
            event.preventDefault();
            button.click();
        });
    }
    const context = getContext();
    button.classList.toggle('not-in-chat', !(context.characterId || context.groupId));
    const chatName = document.getElementById(TOP_BAR_NAME_ID);
    const anchor = chatName?.parentElement === topBar ? chatName : null;
    if (button.parentElement !== topBar || button.nextElementSibling !== anchor) {
        topBar.insertBefore(button, anchor);
    }
    return true;
}

function placeWandButton() {
    if (document.getElementById(WAND_BUTTON_ID)) {
        return true;
    }
    const menu = document.getElementById('extensionsMenu');
    if (!menu) {
        return false;
    }
    const item = document.createElement('div');
    item.id = WAND_BUTTON_ID;
    item.className = 'list-group-item flex-container flexGap5';
    const icon = document.createElement('div');
    icon.className = 'fa-solid fa-code-branch extensionsMenuExtensionButton';
    const label = document.createElement('span');
    label.textContent = 'Timeline';
    item.append(icon, label);
    item.addEventListener('click', () => openTimeline(false));
    menu.appendChild(item);
    return true;
}

function installEntryPoints() {
    placeWandButton();
    if (timelineSettings().showTopBarButton === false) {
        document.getElementById(TOP_BAR_BUTTON_ID)?.remove();
        return;
    }
    if (placeTopBarButton()) {
        return;
    }
    const sheld = document.getElementById('sheld');
    if (!sheld || sheld.dataset.tlpTopBarWatch === '1') {
        return;
    }
    sheld.dataset.tlpTopBarWatch = '1';
    const observer = new MutationObserver(() => {
        if (placeTopBarButton()) {
            observer.disconnect();
        }
    });
    observer.observe(sheld, { childList: true, subtree: true });
}

jQuery(async () => {
    const settingsHtml = await $.get(timelineTemplateUrl);
    const getContainer = () => $(document.getElementById('timelines_container') ?? document.getElementById('extensions_settings'));
    getContainer().append(settingsHtml);
    $('#show_timeline_view').on('click', () => openTimeline(false));
    $('#tl_top_bar_button').prop('checked', timelineSettings().showTopBarButton);
    $('#tl_top_bar_button').on('input', () => {
        timelineSettings().showTopBarButton = $('#tl_top_bar_button').prop('checked');
        getContext().saveSettingsDebounced();
        placeTopBarButton();
    });
    $('#tl_node_faces').prop('checked', timelineSettings().showNodeFaces);
    $('#tl_node_faces').on('input', () => {
        timelineSettings().showNodeFaces = $('#tl_node_faces').prop('checked');
        getContext().saveSettingsDebounced();
        view?.update(faceOptions());
    });
    registerSlashCommand('tl', slashCommandHandler, [], '/tl Show the timeline. "/tl r" reloads every chat file.', false, true);
    installEntryPoints();
    eventSource.on(event_types.APP_READY, installEntryPoints);
    eventSource.on(event_types.CHAT_CHANGED, placeTopBarButton);
});
