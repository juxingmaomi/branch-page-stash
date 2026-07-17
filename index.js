// == TavernHelper Script ==
// name: 分支页面暂存器
// author: Codex
// version: v0.47
// description: 将未读分支页面原文保存到指定世界书的关闭条目中，并在酒馆助手面板内按当前酒馆渲染规则预览。

(function () {
  'use strict';

  const SCRIPT_NAME = '分支页面暂存器';
  const SCRIPT_VERSION = 'v0.47';
  const BUTTON_NAME = '分支暂存';
  const GLOBAL_INSTANCE_KEY = '__th_branch_page_stash_instance_v1__';
  const INSTANCE_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const STORAGE_KEY = 'th_branch_page_stash_settings_v1';
  const STYLE_ID = 'th-branch-page-stash-style-v1';
  const WIDGET_ID = 'th-branch-stash-widget';
  const FLOATING_BUTTON_ID = 'th-branch-stash-floating-button';
  const MINIMIZED_BUTTON_ID = 'th-branch-stash-minimized-button';
  const ENTRY_PREFIX = '[分支暂存] ';
  const EXTRA_KEY = 'thBranchPageStash';
  const PREVIEW_FRAME_MESSAGE_TYPE = 'th-branch-stash-preview-height';
  const MESSAGE_STASH_ROW_CLASS = 'th-branch-message-stash-row';
  const MESSAGE_STASH_BUTTON_CLASS = 'th-branch-message-stash-button';
  const MESSAGE_MARKER_FOOTER_CLASS = 'th-message-marker-footer';
  const MAX_MESSAGE_STASH_BUTTONS = 5;
  let floatingButtonPosition = null;
  let minimizedButtonPosition = null;
  let floatingGuardObserver = null;
  let floatingGuardTimers = [];
  let floatingRepairTimer = null;
  let floatingButtonDragCleanup = null;
  let floatingButtonDragTarget = null;
  let bootRetryTimer = null;
  let previewFrameMessageHandler = null;
  let messageButtonScanTimer = null;
  let messageButtonClickHandler = null;
  let messageButtonEventBindings = [];
  let stoppingInstance = false;

  const DEFAULT_SETTINGS = {
    worldbookName: '分支页面暂存库',
    lastSelectedUid: null,
    theme: 'dark',
    floatingButtonHidden: false,
  };

  function getHostWindow() {
    try {
      if (window.top && window.top.document) return window.top;
    } catch (error) {
      // Fall back to the current frame when the top document is not accessible.
    }
    return window;
  }

  function getWindowArea(targetWindow) {
    try {
      const doc = targetWindow.document;
      const width = targetWindow.innerWidth || doc.documentElement.clientWidth || doc.body && doc.body.clientWidth || 0;
      const height = targetWindow.innerHeight || doc.documentElement.clientHeight || doc.body && doc.body.clientHeight || 0;
      return Math.max(0, width) * Math.max(0, height);
    } catch (error) {
      return 0;
    }
  }

  function getHostDocument() {
    return getHostWindow().document || document;
  }

  function getOwnerFrameName() {
    try {
      return String(window && window.name || '').trim();
    } catch (error) {
      return '';
    }
  }

  function clearFloatingButtonGuard() {
    floatingGuardTimers.forEach((timer) => clearTimeout(timer));
    floatingGuardTimers = [];
    if (floatingRepairTimer) {
      clearTimeout(floatingRepairTimer);
      floatingRepairTimer = null;
    }
    if (floatingGuardObserver) {
      floatingGuardObserver.disconnect();
      floatingGuardObserver = null;
    }
    if (bootRetryTimer) {
      clearTimeout(bootRetryTimer);
      bootRetryTimer = null;
    }
  }

  function clearFloatingButtonDrag() {
    if (typeof floatingButtonDragCleanup === 'function') {
      try {
        floatingButtonDragCleanup();
      } catch (error) {
        console.warn(`[${SCRIPT_NAME}] 清理悬浮按钮拖动监听失败`, error);
      }
    }
    floatingButtonDragCleanup = null;
    floatingButtonDragTarget = null;
  }

  function removeOwnedDom() {
    const doc = getHostDocument();
    [WIDGET_ID, STYLE_ID, FLOATING_BUTTON_ID, MINIMIZED_BUTTON_ID].forEach((id) => {
      const node = doc.getElementById(id);
      if (node) node.remove();
    });
    if (doc.body) {
      if (doc.body.dataset.thBranchFloatingGuardVersion === SCRIPT_VERSION) {
        delete doc.body.dataset.thBranchFloatingGuardVersion;
      }
      if (doc.body.dataset.thBranchFloatingGuard === 'true') {
        delete doc.body.dataset.thBranchFloatingGuard;
      }
    }
  }

  function clearMessageStashButtons() {
    const doc = getHostDocument();
    if (messageButtonScanTimer) {
      clearTimeout(messageButtonScanTimer);
      messageButtonScanTimer = null;
    }
    messageButtonEventBindings.forEach(({ source, eventName, handler }) => {
      if (source && typeof source.removeListener === 'function') source.removeListener(eventName, handler);
    });
    messageButtonEventBindings = [];
    if (messageButtonClickHandler) {
      doc.removeEventListener('click', messageButtonClickHandler, true);
      messageButtonClickHandler = null;
    }
    doc.querySelectorAll(`.${MESSAGE_STASH_BUTTON_CLASS}`).forEach((node) => node.remove());
    doc.querySelectorAll(`.${MESSAGE_STASH_ROW_CLASS}`).forEach((node) => {
      node.classList.remove(MESSAGE_STASH_ROW_CLASS);
      if (!node.children.length) node.remove();
    });
  }

  function stopInstance() {
    if (stoppingInstance) return;
    stoppingInstance = true;
    clearFloatingButtonGuard();
    clearFloatingButtonDrag();
    clearMessageStashButtons();
    removeOwnedDom();
    const host = getHostWindow();
    if (previewFrameMessageHandler) {
      host.removeEventListener('message', previewFrameMessageHandler);
      previewFrameMessageHandler = null;
    }
    if (host[GLOBAL_INSTANCE_KEY] && host[GLOBAL_INSTANCE_KEY].instanceId === INSTANCE_ID) {
      delete host[GLOBAL_INSTANCE_KEY];
    }
  }

  function claimGlobalInstance() {
    const host = getHostWindow();
    const previous = host[GLOBAL_INSTANCE_KEY];
    if (previous && previous.instanceId !== INSTANCE_ID && typeof previous.stop === 'function') {
      try {
        previous.stop();
      } catch (error) {
        console.warn(`[${SCRIPT_NAME}] 清理旧浮窗实例失败`, error);
      }
    }
    host[GLOBAL_INSTANCE_KEY] = {
      instanceId: INSTANCE_ID,
      version: SCRIPT_VERSION,
      ownerFrameName: getOwnerFrameName(),
      stop: stopInstance,
    };
  }

  function get$() {
    const host = getHostWindow();
    return host.jQuery || host.$ || window.jQuery || window.$;
  }

  function notify(type, message) {
    const host = getHostWindow();
    const toastr = host.toastr || window.toastr;
    if (toastr && typeof toastr[type] === 'function') {
      toastr[type](message);
      return;
    }
    if (type === 'error') console.error(`[${SCRIPT_NAME}] ${message}`);
    else console.log(`[${SCRIPT_NAME}] ${message}`);
  }

  function getLoaderInfo() {
    const host = getHostWindow();
    return host.__TH_BRANCH_PAGE_STASH_LOADER__ || window.__TH_BRANCH_PAGE_STASH_LOADER__ || null;
  }

  function getVersionLabel() {
    const loader = getLoaderInfo();
    if (!loader) return SCRIPT_VERSION;
    const sourceMap = {
      latest: 'GitHub最新',
      fallback: '固定回退',
      pinned: '固定版本',
      manual: '手动版本',
    };
    const source = sourceMap[loader.source] || 'GitHub入口';
    const tag = loader.loadedTag || loader.tag || SCRIPT_VERSION;
    return `${tag} · ${source}`;
  }

  function getVersionDetail() {
    const loader = getLoaderInfo();
    if (!loader) return `当前版本：${SCRIPT_VERSION}`;
    const sourceMap = {
      latest: '已从 GitHub 最新 Release 加载',
      fallback: 'GitHub 最新版本查询失败，已加载备用版本',
      pinned: '已加载固定版本',
      manual: '已按入口壳手动版本号加载',
    };
    const source = sourceMap[loader.source] || '已通过 GitHub 入口加载';
    const tag = loader.loadedTag || loader.tag || SCRIPT_VERSION;
    return `当前版本：${tag}；${source}`;
  }

  function helper(name) {
    const host = getHostWindow();
    return host[name] || window[name];
  }

  async function callHelper(name, ...args) {
    const fn = helper(name);
    if (typeof fn !== 'function') {
      throw new Error(`缺少酒馆助手接口：${name}`);
    }
    return await fn(...args);
  }

  function loadSettings() {
    try {
      return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'));
    } catch (error) {
      return Object.assign({}, DEFAULT_SETTINGS);
    }
  }

  function saveSettings(settings) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.assign({}, DEFAULT_SETTINGS, settings || {})));
  }

  function normalizeTheme(theme) {
    const value = String(theme || '').toLowerCase();
    return ['dark', 'light', 'green'].includes(value) ? value : DEFAULT_SETTINGS.theme;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
  }

  function sanitizeWorldbookName(value) {
    return String(value || '').trim();
  }

  function makeId() {
    const host = getHostWindow();
    if (host.crypto && host.crypto.randomUUID) return host.crypto.randomUUID();
    return `stash-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function formatDate(value) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return new Date().toLocaleString();
    return date.toLocaleString();
  }

  function getCharacterName() {
    const host = getHostWindow();
    try {
      const st = host.SillyTavern || host;
      const context = st && typeof st.getContext === 'function' ? st.getContext() : null;
      const sources = [context, st, host].filter(Boolean);
      const ids = [];
      const collections = [];
      for (const source of sources) {
        if (source.characterId !== undefined) ids.push(source.characterId);
        if (source.this_chid !== undefined) ids.push(source.this_chid);
        if (source.character_id !== undefined) ids.push(source.character_id);
        if (source.characters) collections.push(source.characters);
      }
      for (const collection of collections) {
        for (const id of ids) {
          const character = collection && collection[id];
          if (character && character.name) return String(character.name).trim();
        }
      }
      for (const source of sources) {
        const directName = source.characterName || source.name2 || source.currentCharacterName;
        if (directName) return String(directName).trim();
        if (source.character && source.character.name) return String(source.character.name).trim();
      }
    } catch (error) {
      console.warn(`[${SCRIPT_NAME}] 获取角色名失败`, error);
    }
    return '';
  }

  function getChatTitle() {
    const host = getHostWindow();
    try {
      if (host.SillyTavern && typeof host.SillyTavern.getCurrentChatId === 'function') {
        return String(host.SillyTavern.getCurrentChatId() || '').split(/[\\/]/).pop().replace(/\.(jsonl?|txt)$/i, '');
      }
    } catch (error) {
      console.warn(`[${SCRIPT_NAME}] 获取聊天名失败`, error);
    }
    return '';
  }

  function getWorldbookNamesSafe() {
    try {
      const fn = helper('getWorldbookNames');
      return typeof fn === 'function' ? fn() || [] : [];
    } catch (error) {
      console.warn(`[${SCRIPT_NAME}] 获取世界书列表失败`, error);
      return [];
    }
  }

  function getGlobalWorldbookNamesSafe() {
    try {
      const fn = helper('getGlobalWorldbookNames');
      return typeof fn === 'function' ? fn() || [] : [];
    } catch (error) {
      return [];
    }
  }

  function isStashEntry(entry) {
    if (!entry) return false;
    if (entry.extra && entry.extra[EXTRA_KEY]) return true;
    return String(entry.name || '').startsWith(ENTRY_PREFIX);
  }

  function getEntryMeta(entry) {
    const extra = entry && entry.extra && entry.extra[EXTRA_KEY] ? entry.extra[EXTRA_KEY] : {};
    const name = String(entry && entry.name || '');
    return {
      id: extra.id || `uid-${entry && entry.uid}`,
      title: extra.title || name.replace(ENTRY_PREFIX, '') || '未命名暂存',
      savedAt: extra.savedAt || '',
      readAt: extra.readAt || '',
      characterName: extra.characterName || '',
      chatTitle: extra.chatTitle || '',
      version: extra.version || '',
    };
  }

  function buildEntryPayload(title, raw, previousEntry) {
    const now = new Date().toISOString();
    const previousMeta = previousEntry ? getEntryMeta(previousEntry) : {};
    const id = previousMeta.id && !String(previousMeta.id).startsWith('uid-') ? previousMeta.id : makeId();
    return {
      name: `${ENTRY_PREFIX}${title}`,
      enabled: false,
      content: raw,
      probability: 0,
      strategy: {
        type: 'selective',
        keys: [`__TH_BRANCH_STASH_NEVER_${id}__`],
        keys_secondary: { logic: 'and_any', keys: [] },
        scan_depth: 1,
      },
      position: {
        type: 'at_depth',
        role: 'system',
        depth: 0,
        order: 100000,
      },
      recursion: {
        prevent_incoming: true,
        prevent_outgoing: true,
        delay_until: null,
      },
      effect: {
        sticky: null,
        cooldown: null,
        delay: null,
      },
      extra: Object.assign({}, previousEntry && previousEntry.extra || {}, {
        [EXTRA_KEY]: {
          id,
          title,
          savedAt: now,
          readAt: previousMeta.readAt || '',
          characterName: getCharacterName(),
          chatTitle: getChatTitle(),
          version: SCRIPT_VERSION,
        },
      }),
    };
  }

  async function ensureWorldbook(name) {
    const worldbookName = sanitizeWorldbookName(name);
    if (!worldbookName) throw new Error('请先填写目标世界书');
    const names = getWorldbookNamesSafe();
    if (names.includes(worldbookName)) return false;
    await callHelper('createWorldbook', worldbookName, []);
    return true;
  }

  async function getWorldbookEntries(name) {
    const worldbookName = sanitizeWorldbookName(name);
    if (!worldbookName) return [];
    return await callHelper('getWorldbook', worldbookName);
  }

  async function getStashEntries(name) {
    const entries = await getWorldbookEntries(name);
    return entries
      .filter(isStashEntry)
      .sort((a, b) => {
        const ma = getEntryMeta(a);
        const mb = getEntryMeta(b);
        return String(mb.savedAt || '').localeCompare(String(ma.savedAt || '')) || Number(b.uid || 0) - Number(a.uid || 0);
      });
  }

  async function createStashEntry(worldbookName, title, raw) {
    await ensureWorldbook(worldbookName);
    const payload = buildEntryPayload(title, raw, null);
    const result = await callHelper('createWorldbookEntries', worldbookName, [payload], { render: 'debounced' });
    const entry = result && result.new_entries && result.new_entries[0];
    return entry || payload;
  }

  function getTavernContext() {
    const host = getHostWindow();
    const api = host.SillyTavern || window.SillyTavern;
    if (api && typeof api.getContext === 'function') return api.getContext();
    return null;
  }

  function getRawMessage(messageId) {
    const context = getTavernContext();
    const message = context && Array.isArray(context.chat) ? context.chat[messageId] : null;
    if (!message || typeof message.mes !== 'string') {
      throw new Error(`没有找到第 ${messageId} 层的原文`);
    }
    return message;
  }

  function normalizeSceneTitle(value) {
    const template = getHostDocument().createElement('template');
    template.innerHTML = String(value || '');
    return String(template.content.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function getMessageTitle(raw, messageId) {
    const pattern = /<Scene_Title\b[^>]*>([\s\S]*?)<\/Scene_Title\s*>/gi;
    for (const match of String(raw || '').matchAll(pattern)) {
      const title = normalizeSceneTitle(match[1]);
      if (title) return title;
    }
    return `第 ${messageId} 层`;
  }

  function isGenerationInProgress(messageId) {
    const context = getTavernContext();
    const processor = context && context.streamingProcessor;
    return Boolean(processor && !processor.isFinished && Number(messageId) === Number(context.chat.length - 1));
  }

  async function saveMessageToStash(messageId, button) {
    if (button.dataset.saving === 'true') return;
    if (isGenerationInProgress(messageId)) {
      notify('info', '这一层还在生成，请生成完成后再暂存');
      return;
    }

    const settings = loadSettings();
    const worldbookName = sanitizeWorldbookName(settings.worldbookName);
    if (!worldbookName) throw new Error('请先在分支页面暂存器中选择世界书');

    const message = getRawMessage(messageId);
    const raw = message.mes;
    if (!raw.trim()) throw new Error(`第 ${messageId} 层没有可保存的内容`);
    const title = getMessageTitle(raw, messageId);

    button.dataset.saving = 'true';
    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i><span>保存中</span>';
    try {
      const entry = await createStashEntry(worldbookName, title, raw);
      settings.lastSelectedUid = entry && entry.uid || settings.lastSelectedUid;
      saveSettings(settings);

      const panel = getHostDocument().querySelector('.th-branch-panel');
      const $ = get$();
      if (panel && $) await refreshWorldbookOptions($(panel));
      notify('success', `已将「${title}」保存到「${worldbookName}」`);
    } finally {
      button.dataset.saving = 'false';
      button.disabled = false;
      button.innerHTML = '<i class="fa-solid fa-box-archive" aria-hidden="true"></i><span>暂存本层</span>';
    }
  }

  function isAssistantMessageElement(messageElement) {
    const messageId = Number(messageElement && messageElement.getAttribute('mesid'));
    if (!Number.isInteger(messageId) || messageId < 0) return false;
    try {
      const message = getRawMessage(messageId);
      return !message.is_user && !message.is_system;
    } catch (error) {
      return messageElement.getAttribute('is_user') === 'false' && messageElement.getAttribute('is_system') !== 'true';
    }
  }

  function getLatestAssistantMessageIds() {
    const context = getTavernContext();
    const chat = context && Array.isArray(context.chat) ? context.chat : [];
    const ids = [];
    for (let index = chat.length - 1; index >= 0 && ids.length < MAX_MESSAGE_STASH_BUTTONS; index -= 1) {
      const message = chat[index];
      if (!message || message.is_user || message.is_system || typeof message.mes !== 'string') continue;
      ids.push(index);
    }
    return ids;
  }

  function removeMessageStashButton(button) {
    const parent = button && button.parentElement;
    if (button) button.remove();
    if (parent && parent.classList.contains(MESSAGE_STASH_ROW_CLASS)) {
      parent.classList.remove(MESSAGE_STASH_ROW_CLASS);
      if (!parent.children.length) parent.remove();
    }
  }

  function attachMessageStashButton(messageElement) {
    if (!isAssistantMessageElement(messageElement)) return;
    const doc = getHostDocument();
    const messageBlock = messageElement.querySelector('.mes_block');
    if (!messageBlock) return;

    let footer = Array.from(messageBlock.children).find((child) => child.classList && child.classList.contains(MESSAGE_MARKER_FOOTER_CLASS));
    if (!footer) {
      footer = doc.createElement('div');
      footer.className = `${MESSAGE_MARKER_FOOTER_CLASS} ${MESSAGE_STASH_ROW_CLASS}`;
      footer.setAttribute('aria-label', '楼层操作');
      messageBlock.appendChild(footer);
    }

    let button = messageBlock.querySelector(`.${MESSAGE_STASH_BUTTON_CLASS}`);
    if (!button) {
      button = doc.createElement('button');
      button.type = 'button';
      button.className = MESSAGE_STASH_BUTTON_CLASS;
      button.title = '将这一层的完整原文保存到分支页面暂存器';
      button.setAttribute('aria-label', '暂存本层完整原文');
      button.innerHTML = '<i class="fa-solid fa-box-archive" aria-hidden="true"></i><span>暂存本层</span>';
    }
    if (button.parentElement !== footer || footer.firstChild !== button) footer.insertBefore(button, footer.firstChild);
  }

  function injectMessageStashButtons() {
    const doc = getHostDocument();
    const allowedIds = new Set(getLatestAssistantMessageIds());
    doc.querySelectorAll(`#chat .${MESSAGE_STASH_BUTTON_CLASS}`).forEach((button) => {
      const messageElement = button.closest('.mes');
      const messageId = Number(messageElement && messageElement.getAttribute('mesid'));
      if (!allowedIds.has(messageId)) removeMessageStashButton(button);
    });

    allowedIds.forEach((messageId) => {
      const messageElement = doc.querySelector(`#chat .mes[mesid="${messageId}"]`);
      if (messageElement) attachMessageStashButton(messageElement);
    });
  }

  function scheduleMessageButtonScan(delay = 40) {
    if (messageButtonScanTimer) clearTimeout(messageButtonScanTimer);
    messageButtonScanTimer = setTimeout(() => {
      messageButtonScanTimer = null;
      injectMessageStashButtons();
    }, delay);
  }

  function installMessageStashButtons() {
    clearMessageStashButtons();
    const doc = getHostDocument();
    messageButtonClickHandler = (event) => {
      const button = event.target && event.target.closest && event.target.closest(`.${MESSAGE_STASH_BUTTON_CLASS}`);
      if (!button) return;
      const messageElement = button.closest('.mes');
      const messageId = Number(messageElement && messageElement.getAttribute('mesid'));
      if (!Number.isInteger(messageId)) return;
      event.preventDefault();
      event.stopPropagation();
      saveMessageToStash(messageId, button).catch((error) => {
        console.error(error);
        notify('error', `暂存失败：${error.message || error}`);
      });
    };
    doc.addEventListener('click', messageButtonClickHandler, true);
    injectMessageStashButtons();

    const context = getTavernContext();
    const source = context && context.eventSource;
    const events = context && context.eventTypes;
    if (source && events && typeof source.on === 'function') {
      const bind = (eventName, delay) => {
        if (!eventName) return;
        const handler = () => scheduleMessageButtonScan(delay);
        source.on(eventName, handler);
        messageButtonEventBindings.push({ source, eventName, handler });
      };
      bind(events.CHARACTER_MESSAGE_RENDERED, 20);
      bind(events.CHAT_CHANGED, 120);
      bind(events.MORE_MESSAGES_LOADED, 80);
      bind(events.MESSAGE_DELETED, 40);
    }
  }

  async function updateStashEntry(worldbookName, uid, title, raw) {
    const numericUid = Number(uid);
    if (!Number.isFinite(numericUid)) throw new Error('没有选中要更新的暂存页');
    let updatedEntry = null;
    await callHelper('updateWorldbookWith', worldbookName, (entries) => {
      return entries.map((entry) => {
        if (Number(entry.uid) !== numericUid) return entry;
        updatedEntry = Object.assign({}, entry, buildEntryPayload(title, raw, entry), { uid: entry.uid });
        return updatedEntry;
      });
    }, { render: 'debounced' });
    if (!updatedEntry) throw new Error('没有找到要更新的暂存页');
    return updatedEntry;
  }

  async function deleteStashEntry(worldbookName, uid) {
    const numericUid = Number(uid);
    if (!Number.isFinite(numericUid)) throw new Error('没有选中要删除的暂存页');
    await callHelper('deleteWorldbookEntries', worldbookName, (entry) => Number(entry.uid) === numericUid && isStashEntry(entry), { render: 'debounced' });
  }

  async function setStashReadStatus(worldbookName, uid, isRead) {
    const numericUid = Number(uid);
    if (!Number.isFinite(numericUid)) throw new Error('没有选中要标记的暂存页');
    let updatedEntry = null;
    await callHelper('updateWorldbookWith', worldbookName, (entries) => {
      return entries.map((entry) => {
        if (Number(entry.uid) !== numericUid || !isStashEntry(entry)) return entry;
        const extra = Object.assign({}, entry.extra || {});
        const meta = Object.assign({}, extra[EXTRA_KEY] || getEntryMeta(entry));
        meta.readAt = isRead ? new Date().toISOString() : '';
        meta.readVersion = SCRIPT_VERSION;
        extra[EXTRA_KEY] = meta;
        updatedEntry = Object.assign({}, entry, { extra });
        return updatedEntry;
      });
    }, { render: 'debounced' });
    if (!updatedEntry) throw new Error('没有找到要标记的暂存页');
    return updatedEntry;
  }

  function looksLikeRenderedHtml(value) {
    const text = String(value || '').trim();
    if (!text) return false;
    return /<(?:div|section|article|aside|main|header|footer|details|summary|table|ul|ol|li|p|span|style|iframe|img|svg|canvas|audio|video)\b[\s\S]*>/i.test(text);
  }

  function decodeHtmlEntities(value) {
    const doc = getHostDocument();
    const textarea = doc.createElement('textarea');
    textarea.innerHTML = String(value || '');
    return textarea.value;
  }

  function collectUnknownTags(value) {
    const text = decodeHtmlEntities(value);
    const htmlTags = new Set([
      'a', 'abbr', 'address', 'area', 'article', 'aside', 'audio', 'b', 'bdi', 'bdo', 'blockquote', 'br', 'button',
      'canvas', 'caption', 'cite', 'code', 'col', 'colgroup', 'data', 'datalist', 'dd', 'del', 'details', 'dfn',
      'dialog', 'div', 'dl', 'dt', 'em', 'embed', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2',
      'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'i', 'iframe', 'img', 'input', 'ins', 'kbd', 'label', 'legend', 'li',
      'main', 'map', 'mark', 'menu', 'meter', 'nav', 'object', 'ol', 'optgroup', 'option', 'output', 'p', 'picture',
      'pre', 'progress', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'script', 'section', 'select', 'slot', 'small',
      'source', 'span', 'strong', 'style', 'sub', 'summary', 'sup', 'svg', 'table', 'tbody', 'td', 'template',
      'textarea', 'tfoot', 'th', 'thead', 'time', 'tr', 'track', 'u', 'ul', 'var', 'video', 'wbr',
    ]);
    const found = new Map();
    const tagPattern = /<\/?\s*([A-Za-z_\u4e00-\u9fa5][\w:.\-\u4e00-\u9fa5]*)\b[^>]*>/g;
    let match;
    while ((match = tagPattern.exec(text))) {
      const rawName = String(match[1] || '').trim();
      if (!rawName) continue;
      const name = rawName.toLowerCase();
      if (htmlTags.has(name)) continue;
      if (name.includes('-')) continue;
      found.set(name, rawName);
    }
    return Array.from(found.values()).slice(0, 8);
  }

  function makeRenderWarnings(raw, html) {
    const tags = collectUnknownTags(html);
    if (!tags.length) return [];
    const rawTags = new Set(collectUnknownTags(raw).map((tag) => tag.toLowerCase()));
    const likelyRegexTags = tags.filter((tag) => rawTags.has(tag.toLowerCase()) || /[A-Z_\u4e00-\u9fa5]/.test(tag));
    if (!likelyRegexTags.length) return [];
    return [`可能还有未渲染标签：${likelyRegexTags.join('、')}。如果这些本来应该变成状态栏或卡片，请确认对应酒馆正则已经开启。`];
  }

  function isMostlyProseHtml(html) {
    const text = String(html || '');
    const complexCount = (text.match(/<(?:div|section|article|details|table|style|iframe|svg|canvas|audio|video)\b/gi) || []).length;
    const paragraphCount = (text.match(/<(?:p|br)\b/gi) || []).length;
    return complexCount <= 1 && paragraphCount < 3;
  }

  function scoreRenderedText(value) {
    const text = String(value || '');
    let score = 0;
    score += (text.match(/<(?:div|section|article|details|table|style|iframe|svg|canvas|audio|video)\b/gi) || []).length * 8;
    score += (text.match(/class=["'][^"']+["']/gi) || []).length * 3;
    score += (text.match(/<\/(?:Slate|content|status_dashboard|disclaimer|Scene_NO|Scene_Title|Location|Ti|We)>/gi) || []).length * -5;
    score += (text.match(/<(?:Slate|content|status_dashboard|disclaimer|Scene_NO|Scene_Title|Location|Ti|We)\b/gi) || []).length * -4;
    score += Math.min(20, Math.floor(text.length / 900));
    return score;
  }

  function isMarkdownFenceText(value) {
    return /^`{3,}\s*[A-Za-z0-9_-]*\s*$/.test(String(value || '').trim());
  }

  function cleanMarkdownFenceLines(value) {
    return String(value || '')
      .split(/\r?\n/)
      .filter((line) => !isMarkdownFenceText(line))
      .join('\n');
  }

  function renderPlainTextBlocks(text) {
    const value = cleanMarkdownFenceLines(text).trim();
    if (!value) return '';
    return value
      .split(/\n{2,}/)
      .filter((block) => !isMarkdownFenceText(block))
      .map((block) => `<p>${escapeHtml(block.trim()).replace(/\n/g, '<br>')}</p>`)
      .join('');
  }

  function stripMarkdownFenceBlocks(html) {
    const template = getHostDocument().createElement('template');
    template.innerHTML = String(html || '');
    const walk = (node) => {
      Array.from(node.childNodes || []).forEach((child) => {
        if (child.nodeType === 3) {
          const cleaned = cleanMarkdownFenceLines(child.nodeValue);
          if (!cleaned.trim()) {
            child.remove();
          } else if (cleaned !== child.nodeValue) {
            child.nodeValue = cleaned;
          }
          return;
        }
        if (child.nodeType !== 1) return;
        if (['SCRIPT', 'STYLE', 'TEXTAREA', 'PRE', 'CODE'].includes(child.tagName)) return;
        walk(child);
        if (!child.querySelector('*') && !child.textContent.trim() && ['P', 'SPAN'].includes(child.tagName)) {
          child.remove();
          return;
        }
        if (isMarkdownFenceText(child.textContent) && !child.querySelector('*')) {
          child.remove();
        }
      });
    };
    walk(template.content);
    return template.innerHTML;
  }

  function preserveParagraphsInHtml(html) {
    const template = getHostDocument().createElement('template');
    template.innerHTML = String(html || '');
    const walk = (node) => {
      Array.from(node.childNodes || []).forEach((child) => {
        if (child.nodeType === 3) {
          const raw = cleanMarkdownFenceLines(child.nodeValue);
          if (!raw.trim()) {
            child.remove();
            return;
          }
          if (raw.includes('\n') && raw.trim()) {
            const holder = getHostDocument().createElement('span');
            holder.innerHTML = renderPlainTextBlocks(raw);
            child.replaceWith(...Array.from(holder.childNodes));
          } else if (raw !== child.nodeValue) {
            child.nodeValue = raw;
          }
          return;
        }
        if (child.nodeType !== 1) return;
        if (['SCRIPT', 'STYLE', 'TEXTAREA', 'PRE', 'CODE'].includes(child.tagName)) return;
        walk(child);
      });
    };
    walk(template.content);
    return template.innerHTML;
  }

  function tryRegexRender(source, regexFn, characterName) {
    const variants = [];
    const sources = ['ai_output', 'world_info', 'slash_command'];
    const depths = [undefined, 0, 1, 2, 3, 999];
    sources.forEach((sourceType) => {
      depths.forEach((depth) => {
        try {
          const option = {};
          if (characterName) option.character_name = characterName;
          if (Number.isFinite(depth)) option.depth = depth;
          const text = regexFn(source, sourceType, 'display', option);
          variants.push({ text, score: scoreRenderedText(text), sourceType, depth });
        } catch (error) {
          // Some regex pipelines reject a source/depth combination; skip it.
        }
      });
    });
    variants.sort((a, b) => b.score - a.score);
    return variants.length ? variants[0].text : source;
  }

  function shouldUseIsolatedPreview(value) {
    const text = String(value || '');
    return /<script\b/i.test(text) && /(?:<!doctype\s+html|<html\b|<head\b|<body\b)/i.test(text);
  }

  function renderRawToHtml(raw) {
    let text = String(raw || '');
    const characterName = getCharacterName();
    try {
      const regexFn = helper('formatAsTavernRegexedString');
      if (typeof regexFn === 'function') {
        text = tryRegexRender(text, regexFn, characterName);
      }
    } catch (error) {
      console.warn(`[${SCRIPT_NAME}] 正则渲染失败`, error);
    }
    if (looksLikeRenderedHtml(text)) {
      if (shouldUseIsolatedPreview(text)) return cleanMarkdownFenceLines(text).trim();
      return preserveParagraphsInHtml(text);
    }
    try {
      const displayFn = helper('formatAsDisplayedMessage');
      if (typeof displayFn === 'function') {
        return displayFn(text);
      }
    } catch (error) {
      console.warn(`[${SCRIPT_NAME}] 显示格式渲染失败`, error);
    }
    return renderPlainTextBlocks(text);
  }

  function renderRawResult(raw) {
    const rendered = renderRawToHtml(raw);
    const isolated = shouldUseIsolatedPreview(rendered);
    const parts = isolated ? splitIsolatedPreviewContent(rendered) : null;
    const html = isolated
      ? parts.documentHtml
      : stripMarkdownFenceBlocks(preserveParagraphsInHtml(rendered));
    const proseHtml = isolated && parts.prose
      ? renderHostProseBlocks(parts.prose)
      : '';
    return {
      html,
      proseHtml,
      warnings: makeRenderWarnings(raw, `${proseHtml}${html}`),
      prose: isMostlyProseHtml(html),
      isolated,
    };
  }

  function splitIsolatedPreviewContent(value) {
    const source = cleanMarkdownFenceLines(value).trim();
    const documentStart = source.search(/(?:<!doctype\s+html|<html\b)/i);
    if (documentStart < 0) return { prose: '', documentHtml: source };
    return {
      prose: source.slice(0, documentStart).trim(),
      documentHtml: source.slice(documentStart).trim(),
    };
  }

  function renderHostProseBlocks(value) {
    const text = cleanMarkdownFenceLines(value).trim();
    if (!text) return '';
    if (/<(?:p|div|section|article|blockquote|pre|table|ul|ol)\b/i.test(text)) {
      return stripMarkdownFenceBlocks(preserveParagraphsInHtml(text));
    }
    const containsMarkup = /<[A-Za-z][^>]*>/.test(text);
    return text
      .split(/(?:\r?\n\s*){2,}|(?:\s*<br\s*\/?\s*>\s*){2,}/gi)
      .map((block) => block.trim())
      .filter(Boolean)
      .map((block) => {
        const content = containsMarkup ? block : escapeHtml(block);
        return `<p>${content.replace(/\r?\n/g, '<br>')}</p>`;
      })
      .join('');
  }

  function buildIsolatedPreviewDocument(html, frameId) {
    const bridge = `
      <script>
        (() => {
          const frameId = ${JSON.stringify(frameId)};
          let scheduled = false;
          const reportHeight = () => {
            if (scheduled) return;
            scheduled = true;
            requestAnimationFrame(() => {
              scheduled = false;
              const body = document.body;
              const root = document.documentElement;
              const bodyHeight = body ? Math.ceil(body.getBoundingClientRect().height) : 0;
              const rootHeight = root ? Math.ceil(root.getBoundingClientRect().height) : 0;
              parent.postMessage({
                type: '${PREVIEW_FRAME_MESSAGE_TYPE}',
                frameId,
                height: Math.max(120, bodyHeight, rootHeight),
              }, '*');
            });
          };
          document.addEventListener('DOMContentLoaded', reportHeight);
          window.addEventListener('load', reportHeight);
          if (typeof ResizeObserver === 'function') {
            const observer = new ResizeObserver(reportHeight);
            if (document.body) observer.observe(document.body);
            else document.addEventListener('DOMContentLoaded', () => observer.observe(document.body), { once: true });
          } else {
            const mutationObserver = new MutationObserver(reportHeight);
            mutationObserver.observe(document.documentElement, { childList: true, subtree: true });
          }
          [0, 120, 350, 900].forEach((delay) => setTimeout(reportHeight, delay));
        })();
      <\/script>`;
    const source = cleanMarkdownFenceLines(html).trim();
    if (/<\/body\s*>/i.test(source)) {
      return source.replace(/<\/body\s*>(?![\s\S]*<\/body\s*>)/i, `${bridge}</body>`);
    }
    return `${source}${bridge}`;
  }

  function ensurePreviewFrameMessageHandler() {
    if (previewFrameMessageHandler) return;
    const host = getHostWindow();
    previewFrameMessageHandler = (event) => {
      const data = event && event.data;
      if (!data || data.type !== PREVIEW_FRAME_MESSAGE_TYPE || !data.frameId) return;
      const frames = Array.from(getHostDocument().querySelectorAll('.th-branch-preview-document-frame'));
      const frame = frames.find((item) => item.dataset.previewFrameId === String(data.frameId));
      if (!frame || event.source !== frame.contentWindow) return;
      const height = Math.max(120, Math.min(6000, Number(data.height) || 0));
      const nextHeight = `${height}px`;
      if (frame.style.height !== nextHeight) frame.style.height = nextHeight;
    };
    host.addEventListener('message', previewFrameMessageHandler);
  }

  function injectStyle() {
    const doc = getHostDocument();
    let style = doc.getElementById(STYLE_ID);
    if (!style) {
      style = doc.createElement('style');
      style.id = STYLE_ID;
      doc.head.appendChild(style);
    }
    style.textContent = `
      #${WIDGET_ID} {
        position: fixed;
        inset: auto 0 0 auto;
        z-index: 2147483645;
        pointer-events: none;
      }
      #${WIDGET_ID} > #${FLOATING_BUTTON_ID},
      #${WIDGET_ID} > #${MINIMIZED_BUTTON_ID},
      #${WIDGET_ID} > .th-branch-overlay {
        pointer-events: auto;
      }
      .th-branch-overlay {
        position: fixed;
        inset: 0;
        z-index: 2147483645;
        display: block;
        box-sizing: border-box;
        padding: 0;
        overflow: hidden;
        overscroll-behavior: contain;
        background: rgba(8, 12, 18, 0.62);
      }
      .th-branch-overlay.th-branch-minimized {
        display: none;
      }
      .th-branch-panel {
        --th-branch-panel-bg: #151b22;
        --th-branch-sidebar-bg: #111820;
        --th-branch-editor-bg: #151d26;
        --th-branch-preview-bg: #10161d;
        --th-branch-card-bg: rgba(255, 255, 255, 0.045);
        --th-branch-input-bg: #0f151c;
        --th-branch-item-bg: #17212b;
        --th-branch-item-active-bg: #203429;
        --th-branch-button-bg: #22303c;
        --th-branch-icon-bg: #1e2833;
        --th-branch-text: #eef3ef;
        --th-branch-muted: #aeb9b3;
        --th-branch-subtle: #9aacaa;
        --th-branch-border: rgba(130, 150, 165, 0.28);
        --th-branch-soft-border: rgba(130, 150, 165, 0.18);
        --th-branch-accent: #77c0a6;
        --th-branch-accent-bg: #2f6f59;
        --th-branch-readerbar-bg: rgba(16, 22, 29, 0.96);
        --th-branch-overlay-bg: rgba(8, 12, 18, 0.62);
        --th-branch-warning-bg: rgba(244, 196, 95, 0.12);
        --th-branch-warning-text: #ffe3a3;
        --th-branch-danger-border: rgba(196, 112, 112, 0.45);
        --th-branch-danger-text: #ffd2d2;
        position: absolute;
        left: max(6px, calc((100vw - 1180px) / 2));
        right: max(6px, calc((100vw - 1180px) / 2));
        top: max(6px, calc((100vh - 820px) / 2));
        bottom: max(6px, calc((100vh - 820px) / 2));
        box-sizing: border-box;
        width: auto;
        height: auto;
        max-width: none;
        max-height: none;
        min-width: 0;
        min-height: 0;
        display: grid;
        grid-template-columns: minmax(240px, 300px) minmax(0, 1fr);
        overflow: hidden;
        border: 1px solid var(--th-branch-border);
        border-radius: 8px;
        background: var(--th-branch-panel-bg);
        color: var(--th-branch-text);
        box-shadow: none;
        font-family: "Microsoft YaHei", "PingFang SC", sans-serif;
      }
      @supports (height: 100dvh) {
        .th-branch-panel {
          top: max(6px, calc((100dvh - 820px) / 2));
          bottom: max(6px, calc((100dvh - 820px) / 2));
        }
      }
      .th-branch-panel[data-theme="light"] {
        --th-branch-panel-bg: #f6f7f4;
        --th-branch-sidebar-bg: #edf0eb;
        --th-branch-editor-bg: #f9faf7;
        --th-branch-preview-bg: #ffffff;
        --th-branch-card-bg: #ffffff;
        --th-branch-input-bg: #ffffff;
        --th-branch-item-bg: #ffffff;
        --th-branch-item-active-bg: #e6f3ed;
        --th-branch-button-bg: #edf1ee;
        --th-branch-icon-bg: #ffffff;
        --th-branch-text: #202725;
        --th-branch-muted: #5f6f68;
        --th-branch-subtle: #6d7975;
        --th-branch-border: rgba(74, 92, 84, 0.26);
        --th-branch-soft-border: rgba(74, 92, 84, 0.16);
        --th-branch-accent: #3d8e70;
        --th-branch-accent-bg: #3d8e70;
        --th-branch-readerbar-bg: rgba(249, 250, 247, 0.96);
        --th-branch-overlay-bg: rgba(28, 34, 31, 0.34);
        --th-branch-warning-bg: rgba(159, 106, 22, 0.12);
        --th-branch-warning-text: #754f0c;
        --th-branch-danger-border: rgba(161, 52, 52, 0.38);
        --th-branch-danger-text: #9b2525;
      }
      .th-branch-panel[data-theme="green"] {
        --th-branch-panel-bg: #18231d;
        --th-branch-sidebar-bg: #132019;
        --th-branch-editor-bg: #1b2921;
        --th-branch-preview-bg: #101a14;
        --th-branch-card-bg: rgba(226, 238, 219, 0.07);
        --th-branch-input-bg: #0f1913;
        --th-branch-item-bg: #1d2d23;
        --th-branch-item-active-bg: #294332;
        --th-branch-button-bg: #26392e;
        --th-branch-icon-bg: #203127;
        --th-branch-text: #ecf4e8;
        --th-branch-muted: #bfd0bd;
        --th-branch-subtle: #a8beb0;
        --th-branch-border: rgba(155, 183, 152, 0.26);
        --th-branch-soft-border: rgba(155, 183, 152, 0.16);
        --th-branch-accent: #91c788;
        --th-branch-accent-bg: #4e8057;
        --th-branch-readerbar-bg: rgba(19, 32, 25, 0.96);
        --th-branch-overlay-bg: rgba(7, 18, 12, 0.58);
        --th-branch-warning-bg: rgba(244, 196, 95, 0.12);
        --th-branch-warning-text: #ffe3a3;
        --th-branch-danger-border: rgba(210, 130, 130, 0.42);
        --th-branch-danger-text: #ffd8d8;
      }
      .th-branch-sidebar,
      .th-branch-main {
        min-height: 0;
        overflow: hidden;
      }
      .th-branch-sidebar {
        display: flex;
        flex-direction: column;
        border-right: 1px solid var(--th-branch-soft-border);
        background: var(--th-branch-sidebar-bg);
      }
      .th-branch-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 14px;
        border-bottom: 1px solid var(--th-branch-soft-border);
      }
      .th-branch-title {
        font-size: 16px;
        font-weight: 800;
      }
      .th-branch-version {
        display: inline-block;
        color: var(--th-branch-muted);
        font-size: 12px;
        font-weight: 700;
        margin-left: 4px;
      }
      .th-branch-update-line {
        margin-top: 4px;
        color: var(--th-branch-muted);
        font-size: 12px;
        line-height: 1.35;
      }
      .th-branch-theme-switch {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 5px;
        margin-top: 7px;
      }
      .th-branch-window-actions {
        display: none;
        align-items: center;
        gap: 6px;
      }
      .th-branch-mobile-main-head {
        display: none;
      }
      .th-branch-mobile-head-action {
        display: inline-grid;
        place-items: center;
        width: 40px;
        height: 40px;
        min-width: 40px;
        padding: 0;
        border: 1px solid var(--th-branch-border);
        border-radius: 7px;
        background: var(--th-branch-button-bg);
        color: var(--th-branch-text);
        font-size: 17px;
        cursor: pointer;
      }
      .th-branch-close {
        display: inline-grid;
        place-items: center;
        width: 34px;
        height: 34px;
        border: 1px solid var(--th-branch-accent);
        border-radius: 8px;
        background: var(--th-branch-accent-bg);
        color: #ffffff;
        font-size: 22px;
        line-height: 1;
        font-weight: 800;
        cursor: pointer;
      }
      .th-branch-theme-btn {
        min-width: 30px;
        min-height: 24px;
        border: 1px solid var(--th-branch-border);
        border-radius: 999px;
        background: var(--th-branch-button-bg);
        color: var(--th-branch-muted);
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
      }
      .th-branch-theme-btn[aria-pressed="true"] {
        border-color: var(--th-branch-accent);
        background: var(--th-branch-accent-bg);
        color: #ffffff;
      }
      .th-branch-float-toggle {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        min-height: 24px;
        padding: 0 8px;
        border: 1px solid var(--th-branch-border);
        border-radius: 6px;
        background: var(--th-branch-button-bg);
        color: var(--th-branch-muted);
        font: inherit;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
      }
      .th-branch-float-toggle[aria-pressed="true"] {
        border-color: var(--th-branch-accent);
        color: var(--th-branch-text);
      }
      .th-branch-icon {
        width: 30px;
        height: 30px;
        border: 1px solid var(--th-branch-border);
        border-radius: 6px;
        background: var(--th-branch-icon-bg);
        color: var(--th-branch-text);
        cursor: pointer;
      }
      .th-branch-worldbook {
        display: grid;
        gap: 8px;
        padding: 12px;
        border-bottom: 1px solid var(--th-branch-soft-border);
      }
      .th-branch-worldbook label,
      .th-branch-field label {
        color: var(--th-branch-muted);
        font-size: 12px;
        font-weight: 700;
      }
      .th-branch-row {
        display: flex;
        gap: 8px;
        min-width: 0;
      }
      .th-branch-input,
      .th-branch-select,
      .th-branch-textarea {
        width: 100%;
        border: 1px solid var(--th-branch-border);
        border-radius: 6px;
        background: var(--th-branch-input-bg);
        color: var(--th-branch-text);
        outline: none;
      }
      .th-branch-input,
      .th-branch-select {
        min-height: 34px;
        padding: 6px 9px;
      }
      .th-branch-textarea {
        min-height: 180px;
        resize: vertical;
        padding: 10px;
        line-height: 1.55;
        font-family: Consolas, "Microsoft YaHei", monospace;
      }
      .th-branch-list {
        flex: 1 1 auto;
        min-height: 0;
        overflow: auto;
        padding: 8px;
      }
      .th-branch-item {
        width: 100%;
        display: grid;
        gap: 5px;
        margin-bottom: 8px;
        padding: 10px;
        border: 1px solid var(--th-branch-soft-border);
        border-radius: 7px;
        background: var(--th-branch-item-bg);
        color: var(--th-branch-text);
        text-align: left;
      }
      .th-branch-item[aria-current="true"] {
        border-color: var(--th-branch-accent);
        background: var(--th-branch-item-active-bg);
      }
      .th-branch-item-top {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 8px;
      }
      .th-branch-item-actions {
        display: flex;
        flex: 0 0 auto;
        gap: 6px;
      }
      .th-branch-item-actions i {
        display: none;
      }
      .th-branch-open {
        min-width: 0;
        border: 0;
        background: transparent;
        color: inherit;
        padding: 0;
        text-align: left;
        cursor: pointer;
      }
      .th-branch-item strong {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 13px;
      }
      .th-branch-character-line {
        display: block;
        margin-top: 3px;
        overflow: hidden;
        color: var(--th-branch-muted);
        font-size: 12px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .th-branch-item span {
        overflow: hidden;
        color: var(--th-branch-subtle);
        font-size: 12px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .th-branch-read-toggle,
      .th-branch-delete-toggle {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        min-height: 26px;
        border: 1px solid var(--th-branch-border);
        border-radius: 999px;
        background: var(--th-branch-button-bg);
        color: var(--th-branch-muted);
        padding: 3px 8px;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
      }
      .th-branch-read-toggle[aria-pressed="true"] {
        border-color: var(--th-branch-accent);
        background: var(--th-branch-accent-bg);
        color: #ffffff;
      }
      .th-branch-delete-toggle {
        border-color: var(--th-branch-danger-border);
        color: var(--th-branch-danger-text);
      }
      .th-branch-read-badge {
        color: var(--th-branch-accent);
        font-weight: 700;
      }
      .th-branch-main {
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
      }
      .th-branch-panel[data-mode="reader"] .th-branch-main {
        grid-template-rows: minmax(0, 1fr);
      }
      .th-branch-panel[data-mode="reader"] .th-branch-editor {
        display: none !important;
      }
      .th-branch-panel[data-mode="immersive"] {
        grid-template-columns: minmax(0, 1fr);
      }
      .th-branch-panel[data-mode="immersive"] .th-branch-sidebar,
      .th-branch-panel[data-mode="immersive"] .th-branch-editor {
        display: none !important;
      }
      .th-branch-panel[data-mode="immersive"] .th-branch-main {
        grid-template-rows: minmax(0, 1fr);
      }
      .th-branch-panel[data-mode="immersive"] .th-branch-preview {
        padding: clamp(10px, 2.2dvw, 24px);
      }
      .th-branch-panel[data-mode="immersive"] .th-branch-preview-card,
      .th-branch-panel[data-mode="immersive"] .th-branch-render-warning {
        max-width: min(880px, 100%);
      }
      .th-branch-editor {
        display: grid;
        gap: 10px;
        padding: 14px;
        border-bottom: 1px solid var(--th-branch-soft-border);
        background: var(--th-branch-editor-bg);
      }
      .th-branch-field {
        display: grid;
        gap: 6px;
      }
      .th-branch-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
      }
      .th-branch-btn {
        min-height: 34px;
        border: 1px solid var(--th-branch-border);
        border-radius: 6px;
        background: var(--th-branch-button-bg);
        color: var(--th-branch-text);
        padding: 6px 11px;
        font-weight: 700;
        cursor: pointer;
      }
      .th-branch-btn.primary {
        border-color: var(--th-branch-accent);
        background: var(--th-branch-accent-bg);
      }
      .th-branch-btn.danger {
        border-color: var(--th-branch-danger-border);
        color: var(--th-branch-danger-text);
      }
      .th-branch-status {
        min-width: 0;
        color: var(--th-branch-muted);
        font-size: 12px;
      }
      .th-branch-preview {
        min-height: 0;
        overflow: auto;
        padding: 18px;
        background: var(--th-branch-preview-bg);
      }
      .th-branch-readerbar {
        position: sticky;
        top: -18px;
        z-index: 3;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin: -18px -18px 18px;
        padding: 12px 18px;
        border-bottom: 1px solid var(--th-branch-soft-border);
        background: var(--th-branch-readerbar-bg);
        backdrop-filter: blur(8px);
      }
      .th-branch-readerbar strong {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .th-branch-readerbar-actions {
        display: flex;
        flex: 0 0 auto;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 8px;
      }
      .th-branch-readerbottom {
        max-width: 820px;
        margin: 14px auto 0;
        padding: 12px;
        border: 1px solid var(--th-branch-soft-border);
        border-radius: 6px;
        background: var(--th-branch-card-bg);
      }
      .th-branch-readerbottom-actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 8px;
      }
      .th-branch-current-read-state {
        margin-bottom: 8px;
        color: var(--th-branch-muted);
        font-size: 12px;
        font-weight: 700;
      }
      .th-branch-bottom-read-toggle[aria-pressed="true"] {
        border-color: var(--th-branch-accent);
        background: var(--th-branch-accent-bg);
        color: #ffffff;
      }
      .th-branch-btn[disabled] {
        cursor: not-allowed;
        opacity: 0.48;
      }
      .th-branch-panel:not([data-mode="immersive"]) .th-branch-list-return {
        display: none;
      }
      .th-branch-panel[data-mode="immersive"] .th-branch-immersive-enter {
        display: none;
      }
      .th-branch-preview-card {
        max-width: 820px;
        margin: 0 auto;
        padding: 18px;
        border: 1px solid var(--th-branch-soft-border);
        border-left: 5px solid var(--th-branch-accent);
        border-radius: 6px;
        background: var(--th-branch-card-bg);
        line-height: 1.65;
        color: var(--th-branch-text);
        overflow-wrap: anywhere;
      }
      .th-branch-render-warning {
        max-width: 820px;
        margin: 0 auto 12px;
        padding: 10px 12px;
        border: 1px solid rgba(244, 196, 95, 0.38);
        border-left: 5px solid #f4c45f;
        border-radius: 6px;
        background: var(--th-branch-warning-bg);
        color: var(--th-branch-warning-text);
        font-size: 13px;
        line-height: 1.5;
      }
      .th-branch-preview-card.th-branch-prose {
        white-space: pre-wrap;
      }
      .th-branch-preview-card slate,
      .th-branch-preview-card content,
      .th-branch-preview-card status_dashboard,
      .th-branch-preview-card disclaimer,
      .th-branch-preview-card start_atmosphere {
        display: block;
      }
      .th-branch-preview-card p {
        margin: 0 0 0.9em;
        overflow-wrap: anywhere;
      }
      .th-branch-preview-card p:last-child {
        margin-bottom: 0;
      }
      .th-branch-host-prose {
        margin-bottom: 18px;
      }
      .th-branch-host-prose p {
        text-indent: 2em;
      }
      .th-branch-preview-card :where(img, video, iframe) {
        max-width: 100%;
      }
      .th-branch-preview-document {
        width: 100%;
        max-width: 820px;
        margin: 0 auto;
        overflow: hidden;
        border: 1px solid var(--th-branch-soft-border);
        border-left: 5px solid var(--th-branch-accent);
        border-radius: 6px;
        background: transparent;
      }
      .th-branch-preview-document-frame {
        display: block;
        width: 100%;
        height: 240px;
        min-height: 120px;
        border: 0;
        background: transparent;
      }
      .th-branch-preview-empty {
        color: var(--th-branch-muted);
        text-align: center;
        padding: 40px 10px;
      }
      .${MESSAGE_STASH_ROW_CLASS} {
        display: flex;
        align-items: center;
        justify-content: flex-start;
        width: 100%;
        min-height: 34px;
        margin-top: 8px;
        padding: 3px 8px 3px 0;
        box-sizing: border-box;
      }
      .${MESSAGE_STASH_BUTTON_CLASS} {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        height: 28px;
        min-height: 28px;
        padding: 0 9px;
        border: 1px solid var(--SmartThemeBorderColor, rgba(128, 128, 128, 0.45));
        border-radius: 6px;
        background: var(--black30a, rgba(0, 0, 0, 0.18));
        color: var(--SmartThemeBodyColor, inherit);
        font: inherit;
        font-size: 12px;
        line-height: 1;
        cursor: pointer;
      }
      .${MESSAGE_MARKER_FOOTER_CLASS} > .${MESSAGE_STASH_BUTTON_CLASS} {
        margin-right: auto;
      }
      .${MESSAGE_STASH_BUTTON_CLASS}:hover {
        filter: brightness(1.12);
      }
      .${MESSAGE_STASH_BUTTON_CLASS}:disabled {
        cursor: wait;
        opacity: 0.6;
      }
      @media (max-width: 820px) {
        .${MESSAGE_STASH_BUTTON_CLASS} {
          height: 32px;
          min-height: 32px;
          padding: 0 10px;
        }
        .th-branch-overlay {
          display: block;
          padding: 0;
          overflow: hidden;
        }
        .th-branch-panel {
          position: fixed !important;
          inset: 0 !important;
          width: 100vw !important;
          height: 100vh !important;
          max-width: 100vw !important;
          max-height: 100vh !important;
          border-radius: 0;
          min-height: 0;
          display: block;
          overflow: hidden;
          -webkit-overflow-scrolling: touch;
          padding: 0;
        }
        @supports (height: 100dvh) {
          .th-branch-panel {
            height: 100dvh !important;
            max-height: 100dvh !important;
          }
        }
        .th-branch-sidebar {
          display: flex;
          width: 100%;
          height: 100%;
          min-height: 0;
          overflow: hidden;
          flex-direction: column;
          border-right: 0;
          border-bottom: 0;
        }
        .th-branch-head {
          position: relative;
          z-index: 6;
          flex: 0 0 auto;
          padding: calc(env(safe-area-inset-top, 0px) + 10px) 10px 10px;
          background: var(--th-branch-sidebar-bg);
          box-shadow: none;
        }
        .th-branch-head > div:first-child {
          min-width: 0;
        }
        .th-branch-title {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 15px;
        }
        .th-branch-version,
        .th-branch-update-line,
        .th-branch-theme-switch {
          display: none;
        }
        .th-branch-panel.th-branch-mobile-settings-open .th-branch-update-line {
          display: block;
        }
        .th-branch-panel.th-branch-mobile-settings-open .th-branch-theme-switch {
          display: flex;
        }
        .th-branch-window-actions {
          display: flex;
        }
        .th-branch-close {
          width: 44px;
          height: 44px;
          min-width: 44px;
          min-height: 44px;
          border-radius: 10px;
          font-size: 28px;
        }
        .th-branch-icon {
          width: 40px;
          height: 40px;
          min-width: 40px;
          min-height: 40px;
          font-size: 18px;
        }
        .th-branch-theme-btn,
        .th-branch-float-toggle,
        .th-branch-btn,
        .th-branch-read-toggle,
        .th-branch-delete-toggle {
          min-height: 38px;
        }
        .th-branch-worldbook {
          flex: 0 0 auto;
          padding: 10px;
        }
        .th-branch-worldbook > label {
          display: none;
        }
        .th-branch-worldbook .th-branch-select,
        .th-branch-worldbook .th-branch-input {
          min-height: 40px;
        }
        .th-branch-worldbook .th-branch-row {
          display: none;
        }
        .th-branch-panel.th-branch-mobile-settings-open .th-branch-worldbook .th-branch-row {
          display: flex;
        }
        .th-branch-list {
          flex: 1 1 auto;
          max-height: none;
          min-height: 0;
          overflow: auto;
          padding: 8px 10px calc(env(safe-area-inset-bottom, 0px) + 16px);
          border-bottom: 0;
          -webkit-overflow-scrolling: touch;
          overscroll-behavior: contain;
        }
        .th-branch-main {
          display: none;
          width: 100%;
          height: 100%;
          min-height: 0;
          overflow: hidden;
          flex-direction: column;
          background: var(--th-branch-preview-bg);
        }
        .th-branch-panel[data-mobile-view="list"] .th-branch-sidebar {
          display: flex;
        }
        .th-branch-panel[data-mobile-view="list"] .th-branch-main {
          display: none;
        }
        .th-branch-panel[data-mobile-view="reader"] .th-branch-sidebar,
        .th-branch-panel[data-mobile-view="edit"] .th-branch-sidebar {
          display: none;
        }
        .th-branch-panel[data-mobile-view="reader"] .th-branch-main,
        .th-branch-panel[data-mobile-view="edit"] .th-branch-main {
          display: flex;
        }
        .th-branch-mobile-main-head {
          display: grid;
          grid-template-columns: 92px minmax(0, 1fr) 92px;
          align-items: center;
          gap: 8px;
          flex: 0 0 auto;
          min-height: 56px;
          padding: calc(env(safe-area-inset-top, 0px) + 6px) 10px 6px;
          border-bottom: 1px solid var(--th-branch-soft-border);
          background: var(--th-branch-sidebar-bg);
        }
        .th-branch-mobile-heading {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 15px;
          font-weight: 800;
          text-align: center;
        }
        .th-branch-mobile-main-actions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 6px;
        }
        .th-branch-panel[data-mobile-view="edit"] .th-branch-mobile-edit-action {
          display: none;
        }
        .th-branch-editor {
          flex: 1 1 auto;
          min-height: 0;
          overflow: auto;
          padding: 12px 10px calc(env(safe-area-inset-bottom, 0px) + 18px);
          -webkit-overflow-scrolling: touch;
          overscroll-behavior: contain;
        }
        .th-branch-panel[data-mobile-view="reader"] .th-branch-editor {
          display: none !important;
        }
        .th-branch-panel[data-mobile-view="edit"] .th-branch-editor {
          display: grid !important;
        }
        .th-branch-actions {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          align-items: stretch;
        }
        .th-branch-actions .th-branch-status {
          grid-column: 1 / -1;
        }
        .th-branch-actions [data-action="immersive-mode"] {
          display: none;
        }
        .th-branch-preview {
          display: none;
          flex: 1 1 auto;
          min-height: 0;
          overflow: auto;
          padding: 12px 10px calc(env(safe-area-inset-bottom, 0px) + 18px);
          -webkit-overflow-scrolling: touch;
          overscroll-behavior: contain;
        }
        .th-branch-panel[data-mobile-view="reader"] .th-branch-preview {
          display: block;
        }
        .th-branch-panel[data-mobile-view="edit"] .th-branch-preview {
          display: none;
        }
        .th-branch-readerbar {
          display: none;
        }
        .th-branch-readerbar-actions {
          gap: 6px;
        }
        .th-branch-readerbottom {
          margin-top: 12px;
          padding: 10px;
        }
        .th-branch-readerbottom-actions {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          gap: 8px;
        }
        .th-branch-readerbottom-actions .th-branch-btn {
          width: 100%;
        }
        .th-branch-btn {
          min-height: 32px;
          padding: 5px 9px;
        }
        .th-branch-item {
          margin-bottom: 7px;
          padding: 11px 10px;
        }
        .th-branch-item-top {
          align-items: start;
        }
        .th-branch-item-actions {
          gap: 4px;
        }
        .th-branch-read-toggle,
        .th-branch-delete-toggle {
          display: inline-grid;
          place-items: center;
          width: 38px;
          min-width: 38px;
          height: 38px;
          min-height: 38px;
          padding: 0;
          border-radius: 7px;
        }
        .th-branch-item-action-label {
          display: none;
        }
        .th-branch-item-actions i {
          display: inline-block;
        }
        .th-branch-preview-card,
        .th-branch-preview-document,
        .th-branch-render-warning,
        .th-branch-readerbottom {
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
        }
      }
      @media (min-width: 821px) and (max-height: 560px) {
        .th-branch-panel {
          grid-template-rows: minmax(0, auto) minmax(0, 1fr);
        }
        .th-branch-textarea {
          min-height: 110px;
        }
        .th-branch-editor {
          gap: 8px;
          padding: 10px;
        }
        .th-branch-preview {
          padding: 12px;
        }
        .th-branch-readerbar {
          top: -12px;
          margin: -12px -12px 12px;
          padding: 10px 12px;
        }
      }
    `;
  }

  function buildPanelHtml(settings) {
    const worldbooks = getWorldbookNamesSafe();
    const theme = normalizeTheme(settings.theme);
    const floatingButtonHidden = Boolean(settings.floatingButtonHidden);
    const options = worldbooks.map((name) => `<option value="${escapeAttr(name)}"${name === settings.worldbookName ? ' selected' : ''}>${escapeHtml(name)}</option>`).join('');
    const versionLabel = getVersionLabel();
    const versionDetail = getVersionDetail();
    return `
      <div class="th-branch-panel" data-mode="edit" data-mobile-view="list" data-has-selection="false" data-theme="${escapeAttr(theme)}">
        <aside class="th-branch-sidebar">
          <header class="th-branch-head">
            <div>
              <div class="th-branch-title">分支页面暂存器 <span class="th-branch-version">${escapeHtml(versionLabel)}</span></div>
              <div class="th-branch-update-line">${escapeHtml(versionDetail)}</div>
              <div class="th-branch-theme-switch" aria-label="外观设置">
                <button type="button" class="th-branch-theme-btn" data-action="theme" data-theme-value="dark" aria-pressed="${theme === 'dark' ? 'true' : 'false'}">黑</button>
                <button type="button" class="th-branch-theme-btn" data-action="theme" data-theme-value="light" aria-pressed="${theme === 'light' ? 'true' : 'false'}">白</button>
                <button type="button" class="th-branch-theme-btn" data-action="theme" data-theme-value="green" aria-pressed="${theme === 'green' ? 'true' : 'false'}">绿</button>
                <button type="button" class="th-branch-float-toggle" data-action="toggle-floating-button" aria-pressed="${floatingButtonHidden ? 'true' : 'false'}" title="${floatingButtonHidden ? '恢复猫猫浮窗' : '隐藏猫猫浮窗'}"><i class="fa-solid ${floatingButtonHidden ? 'fa-eye' : 'fa-eye-slash'}" aria-hidden="true"></i><span>${floatingButtonHidden ? '显示浮窗' : '隐藏浮窗'}</span></button>
              </div>
            </div>
            <div class="th-branch-window-actions">
              <button type="button" class="th-branch-mobile-head-action" data-action="new-entry" title="新建暂存" aria-label="新建暂存"><i class="fa-solid fa-plus" aria-hidden="true"></i></button>
              <button type="button" class="th-branch-mobile-head-action" data-action="toggle-mobile-settings" title="设置" aria-label="设置"><i class="fa-solid fa-gear" aria-hidden="true"></i></button>
              <button type="button" class="th-branch-close" data-action="minimize-panel" title="返回酒馆" aria-label="返回酒馆"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
            </div>
          </header>
          <section class="th-branch-worldbook">
            <label>目标世界书</label>
            <select class="th-branch-select" data-field="worldbookSelect">
              <option value="">选择世界书</option>
              ${options}
            </select>
            <div class="th-branch-row">
              <input class="th-branch-input" data-field="worldbookName" value="${escapeAttr(settings.worldbookName)}" placeholder="分支页面暂存库">
              <button type="button" class="th-branch-icon" data-action="refresh-worldbooks" title="刷新">↻</button>
            </div>
          </section>
          <div class="th-branch-list" data-list>
            <div class="th-branch-preview-empty">选择世界书后显示暂存页</div>
          </div>
        </aside>
        <main class="th-branch-main">
          <header class="th-branch-mobile-main-head">
            <button type="button" class="th-branch-mobile-head-action" data-action="return-list" title="返回列表" aria-label="返回列表"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i></button>
            <strong class="th-branch-mobile-heading" data-mobile-heading>暂存内容</strong>
            <div class="th-branch-mobile-main-actions">
              <button type="button" class="th-branch-mobile-head-action th-branch-mobile-edit-action" data-action="edit-mode" title="编辑" aria-label="编辑"><i class="fa-solid fa-pencil" aria-hidden="true"></i></button>
              <button type="button" class="th-branch-mobile-head-action" data-action="minimize-panel" title="返回酒馆" aria-label="返回酒馆"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
            </div>
          </header>
          <section class="th-branch-editor">
            <div class="th-branch-field">
              <label>标题</label>
              <input class="th-branch-input" data-field="title" placeholder="例如：江宁分支 699">
            </div>
            <div class="th-branch-field">
              <label>原始页面</label>
              <textarea class="th-branch-textarea" data-field="raw" placeholder="把还没看完的分支页面原文粘贴到这里"></textarea>
            </div>
            <div class="th-branch-actions">
              <button type="button" class="th-branch-btn primary" data-action="save-new">保存并渲染</button>
              <button type="button" class="th-branch-btn" data-action="update">更新选中</button>
              <button type="button" class="th-branch-btn" data-action="preview">仅预览</button>
              <button type="button" class="th-branch-btn" data-action="immersive-mode">进入阅读</button>
              <span class="th-branch-status" data-status></span>
            </div>
          </section>
          <section class="th-branch-preview" data-preview>
            <div class="th-branch-preview-empty">保存或选择一个暂存页后在这里预览</div>
          </section>
        </main>
      </div>`;
  }

  function getPanelSettings($panel) {
    const settings = loadSettings();
    settings.worldbookName = sanitizeWorldbookName($panel.find('[data-field="worldbookName"]').val()) || DEFAULT_SETTINGS.worldbookName;
    settings.lastSelectedUid = $panel.data('selectedUid') || settings.lastSelectedUid || null;
    settings.theme = normalizeTheme($panel.attr('data-theme'));
    return settings;
  }

  function setPanelTheme($panel, theme) {
    const nextTheme = normalizeTheme(theme);
    $panel.attr('data-theme', nextTheme);
    $panel.find('[data-action="theme"]').attr('aria-pressed', 'false');
    $panel.find(`[data-theme-value="${nextTheme}"]`).attr('aria-pressed', 'true');
    saveSettings(getPanelSettings($panel));
    const button = getHostDocument().getElementById(FLOATING_BUTTON_ID);
    if (button) {
      button.style.cssText = getFloatingButtonStyle(nextTheme);
      applyFloatingButtonPosition(button);
    }
    const minimizedButton = getHostDocument().getElementById(MINIMIZED_BUTTON_ID);
    if (minimizedButton) {
      minimizedButton.style.cssText = getMinimizedButtonStyle(nextTheme);
      applyMinimizedButtonPosition(minimizedButton);
    }
  }

  function ensureWidgetContainer() {
    const doc = getHostDocument();
    let widget = doc.getElementById(WIDGET_ID);
    if (widget && widget.dataset.thBranchStashVersion !== SCRIPT_VERSION && !hasActiveOverlay(widget)) {
      widget.remove();
      widget = null;
    }
    if (!widget) {
      widget = doc.createElement('div');
      widget.id = WIDGET_ID;
      widget.dataset.panelOpen = 'false';
      doc.body.appendChild(widget);
    }
    widget.dataset.thBranchStashVersion = SCRIPT_VERSION;
    widget.dataset.thBranchStashInstance = INSTANCE_ID;
    return widget;
  }

  function hasActiveOverlay(widget) {
    if (!widget) return false;
    const overlay = widget.querySelector('.th-branch-overlay');
    return Boolean(overlay && !overlay.classList.contains('th-branch-minimized'));
  }

  function syncWidgetOpenState(widget) {
    if (!widget) return false;
    const active = hasActiveOverlay(widget);
    widget.dataset.panelOpen = active ? 'true' : 'false';
    return active;
  }

  function getViewportSize() {
    const host = getHostWindow();
    const doc = getHostDocument();
    const visual = host.visualViewport;
    return {
      width: visual && visual.width || host.innerWidth || doc.documentElement.clientWidth || 800,
      height: visual && visual.height || host.innerHeight || doc.documentElement.clientHeight || 600,
    };
  }

  function isMobileViewport() {
    return getViewportSize().width <= 820;
  }

  function getFloatingButtonStyle(theme) {
    const value = normalizeTheme(theme);
    const themes = {
      dark: { border: '#77c0a6', background: '#1f6ed4', color: '#ffffff' },
      light: { border: '#3d8e70', background: '#2f7ed8', color: '#ffffff' },
      green: { border: '#91c788', background: '#2f6f59', color: '#ffffff' },
    };
    const colors = themes[value] || themes.dark;
    const mobile = isMobileViewport();
    const size = mobile ? 56 : 52;
    const right = mobile ? 14 : 16;
    const bottom = mobile ? 112 : 164;
    const radius = mobile ? 16 : 15;
    const vertical = mobile ? 'top:calc(env(safe-area-inset-top, 0px) + 18px);bottom:auto;' : `bottom:calc(env(safe-area-inset-bottom, 0px) + ${bottom}px);`;
    return `position:fixed;right:${right}px;${vertical}z-index:2147483647;width:${size}px;height:${size}px;padding:0;border-radius:${radius}px;border:1px solid ${colors.border};background:${colors.background};color:${colors.color};box-shadow:none;font-size:22px;line-height:${size - 2}px;text-align:center;font-weight:900;cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;visibility:visible;opacity:1;pointer-events:auto;`;
  }

  function ensureFloatingButtonInViewport(button) {
    if (!button || button.style.display === 'none' || !button.isConnected) return;
    const viewport = getViewportSize();
    const rect = button.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const outside = rect.right < 8 || rect.bottom < 8 || rect.left > viewport.width - 8 || rect.top > viewport.height - 8;
    if (!outside) return;
    floatingButtonPosition = null;
    button.style.cssText = getFloatingButtonStyle(loadSettings().theme);
  }

  function getMinimizedButtonStyle(theme) {
    return getFloatingButtonStyle(theme);
  }

  function removeMinimizedButton() {
    const button = getHostDocument().getElementById(MINIMIZED_BUTTON_ID);
    if (button) button.remove();
  }

  function showFloatingButton() {
    if (loadSettings().floatingButtonHidden) {
      hideFloatingButton();
      return;
    }
    let button = getHostDocument().getElementById(FLOATING_BUTTON_ID);
    if (!button) {
      injectFallbackButton();
      button = getHostDocument().getElementById(FLOATING_BUTTON_ID);
    }
    if (button) {
      button.style.cssText = getFloatingButtonStyle(loadSettings().theme);
      applyFloatingButtonPosition(button);
      button.style.display = '';
      button.style.visibility = 'visible';
      button.style.opacity = '1';
      button.style.pointerEvents = 'auto';
      ensureFloatingButtonInViewport(button);
    }
  }

  function hideFloatingButton() {
    const button = getHostDocument().getElementById(FLOATING_BUTTON_ID);
    if (button) button.style.display = 'none';
  }

  function syncFloatingButtonToggle($panel, hidden) {
    if (!$panel || !$panel.length) return;
    const isHidden = Boolean(hidden);
    $panel.find('[data-action="toggle-floating-button"]')
      .attr('aria-pressed', isHidden ? 'true' : 'false')
      .attr('title', isHidden ? '恢复猫猫浮窗' : '隐藏猫猫浮窗')
      .html(`<i class="fa-solid ${isHidden ? 'fa-eye' : 'fa-eye-slash'}" aria-hidden="true"></i><span>${isHidden ? '显示浮窗' : '隐藏浮窗'}</span>`);
  }

  function setFloatingButtonHidden($panel, hidden) {
    const settings = getPanelSettings($panel);
    settings.floatingButtonHidden = Boolean(hidden);
    saveSettings(settings);
    syncFloatingButtonToggle($panel, settings.floatingButtonHidden);
    if (settings.floatingButtonHidden) {
      hideFloatingButton();
      setStatus($panel, '猫猫浮窗已隐藏，可从酒馆助手备用按钮打开');
      return;
    }
    const widget = getHostDocument().getElementById(WIDGET_ID);
    if (!hasActiveOverlay(widget)) showFloatingButton();
    setStatus($panel, '猫猫浮窗将在返回酒馆后显示');
  }

  function applyFloatingButtonPosition(button) {
    if (!button || !floatingButtonPosition) return;
    button.style.left = `${floatingButtonPosition.left}px`;
    button.style.top = `${floatingButtonPosition.top}px`;
    button.style.right = 'auto';
    button.style.bottom = 'auto';
  }

  function restoreMinimizedPanel($overlay) {
    if (!$overlay || !$overlay.length) return;
    removeMinimizedButton();
    $overlay.removeClass('th-branch-minimized');
    hideFloatingButton();
    const widget = getHostDocument().getElementById(WIDGET_ID);
    if (widget) widget.dataset.panelOpen = 'true';
    syncOverlayViewport($overlay);
    const panel = $overlay.find('.th-branch-panel')[0];
    if (panel && typeof panel.focus === 'function') panel.focus();
  }

  function applyMinimizedButtonPosition(button) {
    if (!button || !minimizedButtonPosition) return;
    button.style.left = `${minimizedButtonPosition.left}px`;
    button.style.top = `${minimizedButtonPosition.top}px`;
    button.style.right = 'auto';
    button.style.bottom = 'auto';
  }

  function bindMinimizedButtonDrag(button) {
    if (!button || button.dataset.dragBound === 'true') return;
    button.dataset.dragBound = 'true';
    let dragging = false;
    let moved = false;
    let activeTouchId = null;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    let suppressClickUntil = 0;

    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

    const viewportSize = () => {
      const host = getHostWindow();
      const doc = getHostDocument();
      return {
        width: host.innerWidth || doc.documentElement.clientWidth || 800,
        height: host.innerHeight || doc.documentElement.clientHeight || 600,
      };
    };

    const beginDrag = (clientX, clientY) => {
      const rect = button.getBoundingClientRect();
      dragging = true;
      moved = false;
      startX = clientX;
      startY = clientY;
      startLeft = rect.left;
      startTop = rect.top;
      button.style.left = `${rect.left}px`;
      button.style.top = `${rect.top}px`;
      button.style.right = 'auto';
      button.style.bottom = 'auto';
      button.style.cursor = 'grabbing';
    };

    const moveDrag = (clientX, clientY) => {
      if (!dragging) return;
      const dx = clientX - startX;
      const dy = clientY - startY;
      if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
      const viewport = viewportSize();
      const maxLeft = Math.max(8, viewport.width - button.offsetWidth - 8);
      const maxTop = Math.max(8, viewport.height - button.offsetHeight - 8);
      const left = clamp(startLeft + dx, 8, maxLeft);
      const top = clamp(startTop + dy, 8, maxTop);
      button.style.left = `${left}px`;
      button.style.top = `${top}px`;
      minimizedButtonPosition = { left, top };
    };

    const finishDrag = () => {
      if (!dragging) return false;
      dragging = false;
      activeTouchId = null;
      button.style.cursor = 'grab';
      if (moved) {
        button.dataset.dragged = 'true';
        suppressClickUntil = Date.now() + 350;
        setTimeout(() => {
          button.dataset.dragged = 'false';
        }, 360);
      }
      return moved;
    };

    if (getHostWindow().PointerEvent) {
      button.addEventListener('pointerdown', (event) => {
        if (event.button !== undefined && event.button !== 0) return;
        activeTouchId = event.pointerId;
        beginDrag(event.clientX, event.clientY);
        try {
          button.setPointerCapture(event.pointerId);
        } catch (error) {
          // Ignore browsers that do not support pointer capture in this context.
        }
      });
      button.addEventListener('pointermove', (event) => {
        if (!dragging || event.pointerId !== activeTouchId) return;
        moveDrag(event.clientX, event.clientY);
      });
      const finishPointer = (event) => {
        if (!dragging || event.pointerId !== activeTouchId) return;
        finishDrag();
        try {
          button.releasePointerCapture(event.pointerId);
        } catch (error) {
          // Ignore release failures after pointer cancellation.
        }
      };
      button.addEventListener('pointerup', finishPointer);
      button.addEventListener('pointercancel', finishPointer);
    }

    button.addEventListener('touchstart', (event) => {
      const touch = event.changedTouches && event.changedTouches[0];
      if (!touch) return;
      activeTouchId = touch.identifier;
      beginDrag(touch.clientX, touch.clientY);
      event.preventDefault();
    }, { passive: false });

    button.addEventListener('touchmove', (event) => {
      if (!dragging) return;
      const touches = Array.from(event.changedTouches || []);
      const touch = touches.find((item) => item.identifier === activeTouchId) || touches[0];
      if (!touch) return;
      moveDrag(touch.clientX, touch.clientY);
      event.preventDefault();
    }, { passive: false });

    button.addEventListener('touchend', (event) => {
      if (!dragging) return;
      const wasMoved = finishDrag();
      event.preventDefault();
      if (!wasMoved) button.click();
    }, { passive: false });

    button.addEventListener('touchcancel', () => {
      finishDrag();
    }, { passive: true });

    button.addEventListener('mousedown', (event) => {
      if (event.button !== 0 || dragging) return;
      beginDrag(event.clientX, event.clientY);
      const doc = getHostDocument();
      const onMove = (moveEvent) => moveDrag(moveEvent.clientX, moveEvent.clientY);
      const onUp = () => {
        finishDrag();
        doc.removeEventListener('mousemove', onMove);
        doc.removeEventListener('mouseup', onUp);
      };
      doc.addEventListener('mousemove', onMove);
      doc.addEventListener('mouseup', onUp);
    });

    button.addEventListener('click', (event) => {
      if (Date.now() < suppressClickUntil || button.dataset.dragged === 'true') {
        event.preventDefault();
        event.stopPropagation();
      }
    }, true);
  }

  function bindFloatingButtonDrag(button, action) {
    if (!button) return;
    if (floatingButtonDragTarget === button && typeof floatingButtonDragCleanup === 'function') return;
    clearFloatingButtonDrag();
    button.dataset.thBranchFloatingDragBound = 'true';
    let active = false;
    let pointerId = null;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    let suppressClickUntil = 0;
    const removers = [];
    let mouseMoveHandler = null;
    let mouseUpHandler = null;

    const listen = (target, eventName, handler, options) => {
      target.addEventListener(eventName, handler, options);
      removers.push(() => target.removeEventListener(eventName, handler, options));
    };

    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const viewportSize = () => {
      const host = getHostWindow();
      const doc = getHostDocument();
      return {
        width: host.innerWidth || doc.documentElement.clientWidth || 800,
        height: host.innerHeight || doc.documentElement.clientHeight || 600,
      };
    };
    const begin = (clientX, clientY, id) => {
      const rect = button.getBoundingClientRect();
      active = true;
      pointerId = id == null ? null : id;
      moved = false;
      startX = clientX;
      startY = clientY;
      startLeft = rect.left;
      startTop = rect.top;
      button.style.left = `${rect.left}px`;
      button.style.top = `${rect.top}px`;
      button.style.right = 'auto';
      button.style.bottom = 'auto';
      button.style.cursor = 'grabbing';
    };
    const move = (clientX, clientY) => {
      if (!active) return;
      const dx = clientX - startX;
      const dy = clientY - startY;
      if (Math.abs(dx) + Math.abs(dy) > 5) moved = true;
      const viewport = viewportSize();
      const left = clamp(startLeft + dx, 8, Math.max(8, viewport.width - button.offsetWidth - 8));
      const top = clamp(startTop + dy, 8, Math.max(8, viewport.height - button.offsetHeight - 8));
      button.style.left = `${left}px`;
      button.style.top = `${top}px`;
      floatingButtonPosition = { left, top };
    };
    const finish = (event) => {
      if (!active) return;
      active = false;
      pointerId = null;
      button.style.cursor = 'grab';
      if (moved) {
        suppressClickUntil = Date.now() + 420;
        if (event && event.cancelable) event.preventDefault();
        return;
      }
      suppressClickUntil = Date.now() + 420;
      action(event);
    };

    const doc = getHostDocument();
    if (getHostWindow().PointerEvent) {
      const onPointerDown = (event) => {
        if (event.button !== undefined && event.button !== 0) return;
        begin(event.clientX, event.clientY, event.pointerId);
        if (event.cancelable) event.preventDefault();
        try {
          button.setPointerCapture(event.pointerId);
        } catch (error) {
          // Pointer capture is optional here.
        }
      };
      const onPointerMove = (event) => {
        if (!active || (pointerId !== null && event.pointerId !== pointerId)) return;
        move(event.clientX, event.clientY);
        if (event.cancelable) event.preventDefault();
      };
      const onPointerUp = (event) => {
        if (!active || (pointerId !== null && event.pointerId !== pointerId)) return;
        finish(event);
        try {
          button.releasePointerCapture(event.pointerId);
        } catch (error) {
          // Ignore release failures after pointer cancellation.
        }
      };
      const onPointerCancel = (event) => {
        if (!active || (pointerId !== null && event.pointerId !== pointerId)) return;
        active = false;
        pointerId = null;
        button.style.cursor = 'grab';
      };
      listen(button, 'pointerdown', onPointerDown);
      listen(button, 'pointermove', onPointerMove, { passive: false });
      listen(button, 'pointerup', onPointerUp, { passive: false });
      listen(button, 'pointercancel', onPointerCancel, { passive: true });
    } else {
      const onTouchStart = (event) => {
        const touch = event.changedTouches && event.changedTouches[0];
        if (!touch) return;
        begin(touch.clientX, touch.clientY, touch.identifier);
        if (event.cancelable) event.preventDefault();
      };
      const onTouchMove = (event) => {
        if (!active) return;
        const touches = Array.from(event.changedTouches || []);
        const touch = touches.find((item) => item.identifier === pointerId) || touches[0];
        if (!touch) return;
        move(touch.clientX, touch.clientY);
        if (event.cancelable) event.preventDefault();
      };
      const onTouchEnd = (event) => {
        if (!active) return;
        finish(event);
      };
      const onTouchCancel = () => {
        active = false;
        pointerId = null;
        button.style.cursor = 'grab';
      };
      const onMouseDown = (event) => {
        if (event.button !== 0 || active) return;
        begin(event.clientX, event.clientY, null);
        mouseMoveHandler = (moveEvent) => move(moveEvent.clientX, moveEvent.clientY);
        mouseUpHandler = (upEvent) => {
          finish(upEvent);
          if (mouseMoveHandler) doc.removeEventListener('mousemove', mouseMoveHandler);
          if (mouseUpHandler) doc.removeEventListener('mouseup', mouseUpHandler);
          mouseMoveHandler = null;
          mouseUpHandler = null;
        };
        doc.addEventListener('mousemove', mouseMoveHandler);
        doc.addEventListener('mouseup', mouseUpHandler);
      };
      listen(button, 'touchstart', onTouchStart, { passive: false });
      listen(button, 'touchmove', onTouchMove, { passive: false });
      listen(button, 'touchend', onTouchEnd, { passive: false });
      listen(button, 'touchcancel', onTouchCancel, { passive: true });
      listen(button, 'mousedown', onMouseDown);
    }

    const onClick = (event) => {
      if (Date.now() < suppressClickUntil) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (!getHostWindow().PointerEvent) action(event);
    };
    listen(button, 'click', onClick);

    floatingButtonDragTarget = button;
    floatingButtonDragCleanup = () => {
      active = false;
      pointerId = null;
      removers.splice(0).forEach((remove) => remove());
      if (mouseMoveHandler) doc.removeEventListener('mousemove', mouseMoveHandler);
      if (mouseUpHandler) doc.removeEventListener('mouseup', mouseUpHandler);
      mouseMoveHandler = null;
      mouseUpHandler = null;
      delete button.dataset.thBranchFloatingDragBound;
    };
  }

  function minimizePanel($panel) {
    const $overlay = $panel.closest('.th-branch-overlay');
    if (!$overlay.length) return;
    const widget = getHostDocument().getElementById(WIDGET_ID);
    if (widget) widget.dataset.panelOpen = 'false';
    $overlay.addClass('th-branch-minimized');
    injectFallbackButton();
    showFloatingButton();
  }

  function bindTapAction(node, action) {
    if (!node || node.dataset.thBranchTapBound === 'true') return;
    node.dataset.thBranchTapBound = 'true';
    let lastTouchAt = 0;
    let lastRunAt = 0;
    const run = (event) => {
      const now = Date.now();
      if (now - lastRunAt < 420) {
        if (event && event.cancelable) event.preventDefault();
        return;
      }
      lastRunAt = now;
      if (event && event.cancelable) event.preventDefault();
      action(event);
    };
    node.addEventListener('touchend', (event) => {
      lastTouchAt = Date.now();
      run(event);
    }, { passive: false });
    node.addEventListener('pointerup', (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      lastTouchAt = Date.now();
      run(event);
    });
    node.addEventListener('click', (event) => {
      if (Date.now() - lastTouchAt < 450) {
        event.preventDefault();
        return;
      }
      action(event);
    });
  }

  function setStatus($panel, text) {
    $panel.find('[data-status]').text(text || '');
  }

  function getTargetWorldbook($panel) {
    return sanitizeWorldbookName($panel.find('[data-field="worldbookName"]').val());
  }

  function setMode($panel, mode) {
    const nextMode = ['reader', 'immersive'].includes(mode) ? mode : 'edit';
    $panel.attr('data-mode', nextMode);
    setMobileView($panel, nextMode === 'edit' ? 'edit' : 'reader');
    syncOverlayViewport($panel.closest('.th-branch-overlay'));
  }

  function getMobileHeading($panel, view) {
    if (view === 'list') return '暂存列表';
    if (view === 'edit') return $panel.attr('data-has-selection') === 'true' ? '编辑暂存' : '新建暂存';
    return String($panel.find('[data-field="title"]').val() || '').trim() || '阅读暂存';
  }

  function setMobileView($panel, view, heading) {
    const nextView = ['reader', 'edit'].includes(view) ? view : 'list';
    if (nextView !== 'list') $panel.removeClass('th-branch-mobile-settings-open');
    $panel.attr('data-mobile-view', nextView);
    $panel.find('[data-mobile-heading]').text(heading || getMobileHeading($panel, nextView));
  }

  function syncOverlayViewport(overlayLike) {
    const node = overlayLike && (overlayLike.jquery ? overlayLike[0] : overlayLike);
    if (!node) return;
    node.classList.remove('th-branch-compact');
  }

  function bindOverlayViewport($overlay) {
    syncOverlayViewport($overlay);
    const cleanup = () => {};
    $overlay.data('cleanupViewport', cleanup);
    return cleanup;
  }

  function getSelectedStashEntry($panel) {
    const uid = Number($panel.data('selectedUid'));
    if (!Number.isFinite(uid)) return null;
    const entries = $panel.data('entries') || [];
    return entries.find((item) => Number(item.uid) === uid) || null;
  }

  function buildReaderBottomHtml($panel) {
    const uid = Number($panel.data('selectedUid'));
    const hasSelected = Number.isFinite(uid);
    const entry = getSelectedStashEntry($panel);
    const meta = entry ? getEntryMeta(entry) : {};
    const isRead = Boolean(meta.readAt);
    const readText = hasSelected
      ? isRead ? `已读 ${formatDate(meta.readAt)}` : '未读'
      : '保存后可标记已读';
    return `
      <div class="th-branch-readerbottom">
        <div class="th-branch-current-read-state" data-current-read-state>${escapeHtml(readText)}</div>
        <div class="th-branch-readerbottom-actions">
          <button type="button" class="th-branch-btn th-branch-bottom-read-toggle" data-action="toggle-current-read" aria-pressed="${isRead ? 'true' : 'false'}"${hasSelected ? '' : ' disabled'}>${isRead ? '取消已读' : '标记已读'}</button>
          <button type="button" class="th-branch-btn primary" data-action="return-list">返回列表</button>
        </div>
      </div>`;
  }

  function updateCurrentReadControls($panel, entry) {
    const meta = entry ? getEntryMeta(entry) : {};
    const isRead = Boolean(meta.readAt);
    const readText = isRead ? `已读 ${formatDate(meta.readAt)}` : '未读';
    $panel.find('[data-current-read-state]').text(readText);
    $panel.find('[data-action="toggle-current-read"]')
      .prop('disabled', false)
      .attr('aria-pressed', isRead ? 'true' : 'false')
      .text(isRead ? '取消已读' : '标记已读');
  }

  function returnToList($panel) {
    $panel.removeData('renderCache');
    setMode($panel, 'reader');
    setMobileView($panel, 'list');
    const preview = $panel.find('[data-preview]')[0];
    if (preview) preview.scrollTop = 0;
    const list = $panel.find('[data-list]')[0];
    if (list) list.scrollTop = 0;
    setStatus($panel, '已返回列表');
  }

  async function toggleCurrentReadStatus($panel) {
    const uid = Number($panel.data('selectedUid'));
    if (!Number.isFinite(uid)) {
      setStatus($panel, '请先保存或选择一个暂存页');
      return;
    }
    const buttonIsRead = String($panel.find('[data-action="toggle-current-read"]').attr('aria-pressed')) === 'true';
    try {
      setStatus($panel, buttonIsRead ? '取消已读中...' : '标记已读中...');
      const updatedEntry = await setStashReadStatus(getTargetWorldbook($panel), uid, !buttonIsRead);
      if (updatedEntry) {
        const meta = getEntryMeta(updatedEntry);
        $panel.find('[data-field="title"]').val(meta.title || '');
        updateCurrentReadControls($panel, updatedEntry);
      }
      await refreshList($panel);
      setStatus($panel, buttonIsRead ? '已改为未读' : '已标记已读');
    } catch (error) {
      console.error(error);
      setStatus($panel, `标记失败：${error.message || error}`);
      notify('error', `标记失败：${error.message || error}`);
    }
  }

  function renderPreview($panel, raw, title, force = false) {
    const cached = $panel.data('renderCache');
    const result = !force && cached && cached.raw === raw
      ? cached.result
      : renderRawResult(raw);
    if (!cached || cached.raw !== raw || cached.result !== result) {
      $panel.data('renderCache', { raw, result });
    }
    const safeTitle = title || String($panel.find('[data-field="title"]').val() || '').trim() || '未命名暂存';
    $panel.find('[data-mobile-heading]').text(safeTitle);
    const warningHtml = result.warnings.length
      ? `<div class="th-branch-render-warning">${result.warnings.map(escapeHtml).join('<br>')}</div>`
      : '';
    const cardClass = result.prose ? 'th-branch-preview-card th-branch-prose' : 'th-branch-preview-card';
    const frameId = result.isolated ? makeId() : '';
    const previewHtml = result.isolated
      ? `${result.proseHtml ? `<div class="th-branch-preview-card th-branch-host-prose">${result.proseHtml}</div>` : ''}<div class="th-branch-preview-document"><iframe class="th-branch-preview-document-frame" data-preview-frame-id="${escapeAttr(frameId)}" title="${escapeAttr(safeTitle)}" sandbox="allow-scripts"></iframe></div>`
      : `<div class="${cardClass}">${result.html}</div>`;
    const readerBottomHtml = buildReaderBottomHtml($panel);
    $panel.find('[data-preview]').html(`
      <div class="th-branch-readerbar">
        <strong>${escapeHtml(safeTitle)}</strong>
        <div class="th-branch-readerbar-actions">
          <button type="button" class="th-branch-btn" data-action="new-entry">新建</button>
          <button type="button" class="th-branch-btn" data-action="edit-mode">编辑</button>
          <button type="button" class="th-branch-btn th-branch-list-return" data-action="return-list">返回列表</button>
          <button type="button" class="th-branch-btn th-branch-immersive-enter" data-action="immersive-mode">阅读</button>
        </div>
      </div>
      ${warningHtml}
      ${previewHtml}
      ${readerBottomHtml}`);
    if (result.isolated) {
      ensurePreviewFrameMessageHandler();
      const frame = $panel.find(`.th-branch-preview-document-frame[data-preview-frame-id="${frameId}"]`)[0];
      if (frame) frame.srcdoc = buildIsolatedPreviewDocument(result.html, frameId);
    }
  }

  function fillEditorFromEntry($panel, entry) {
    const meta = getEntryMeta(entry);
    $panel.data('selectedUid', entry.uid);
    $panel.attr('data-has-selection', 'true');
    $panel.find('[data-field="title"]').val(meta.title || '');
    $panel.find('[data-field="raw"]').val(entry.content || '');
    renderPreview($panel, entry.content || '', meta.title || '');
    setMode($panel, 'reader');
    saveSettings(getPanelSettings($panel));
  }

  async function refreshList($panel) {
    const worldbookName = getTargetWorldbook($panel);
    const $list = $panel.find('[data-list]');
    if (!worldbookName) {
      $list.html('<div class="th-branch-preview-empty">请先选择目标世界书</div>');
      return [];
    }
    setStatus($panel, '读取中...');
    try {
      const entries = await getStashEntries(worldbookName);
      const globalNames = getGlobalWorldbookNamesSafe();
      const isGlobal = globalNames.includes(worldbookName);
      const selectedUid = Number($panel.data('selectedUid') || loadSettings().lastSelectedUid);
      if (!entries.length) {
        $list.html(`<div class="th-branch-preview-empty">${isGlobal ? '这个世界书当前全局开启，但暂存条目仍会保持关闭。' : '这个世界书里还没有暂存页。'}</div>`);
      } else {
        $list.html(entries.map((entry) => {
          const meta = getEntryMeta(entry);
          const current = Number(entry.uid) === selectedUid;
          const characterLine = meta.characterName ? `角色卡：${meta.characterName}` : '';
          const detail = [formatDate(meta.savedAt), meta.chatTitle].filter(Boolean).join(' / ');
          const isRead = Boolean(meta.readAt);
          const readDetail = isRead ? `已读 ${formatDate(meta.readAt)}` : '未读';
          return `
            <div class="th-branch-item" data-uid="${escapeAttr(entry.uid)}" aria-current="${current ? 'true' : 'false'}">
              <div class="th-branch-item-top">
                <button type="button" class="th-branch-open" data-action="open-stash" data-uid="${escapeAttr(entry.uid)}">
                  <strong>${escapeHtml(meta.title)}</strong>
                  ${characterLine ? `<div class="th-branch-character-line">${escapeHtml(characterLine)}</div>` : ''}
                </button>
                <div class="th-branch-item-actions">
                  <button type="button" class="th-branch-read-toggle" data-action="toggle-read" data-uid="${escapeAttr(entry.uid)}" aria-pressed="${isRead ? 'true' : 'false'}" title="${isRead ? '取消已读' : '标记已读'}" aria-label="${isRead ? '取消已读' : '标记已读'}"><i class="fa-solid ${isRead ? 'fa-check' : 'fa-check-double'}" aria-hidden="true"></i><span class="th-branch-item-action-label">${isRead ? '已读' : '标记已读'}</span></button>
                  <button type="button" class="th-branch-delete-toggle" data-action="delete-stash" data-uid="${escapeAttr(entry.uid)}" title="删除" aria-label="删除"><i class="fa-solid fa-trash-can" aria-hidden="true"></i><span class="th-branch-item-action-label">删除</span></button>
                </div>
              </div>
              <span>${escapeHtml(detail || `uid ${entry.uid}`)} · <span class="th-branch-read-badge">${escapeHtml(readDetail)}</span></span>
            </div>`;
        }).join(''));
      }
      setStatus($panel, isGlobal ? '已读取；目标世界书当前全局开启' : `已读取 ${entries.length} 个暂存页`);
      $panel.data('entries', entries);
      return entries;
    } catch (error) {
      $list.html('<div class="th-branch-preview-empty">读取失败，世界书可能不存在</div>');
      setStatus($panel, `读取失败：${error.message || error}`);
      $panel.data('entries', []);
      return [];
    }
  }

  async function refreshWorldbookOptions($panel) {
    const settings = getPanelSettings($panel);
    const names = getWorldbookNamesSafe();
    const $select = $panel.find('[data-field="worldbookSelect"]');
    $select.html(`<option value="">选择世界书</option>${names.map((name) => `<option value="${escapeAttr(name)}"${name === settings.worldbookName ? ' selected' : ''}>${escapeHtml(name)}</option>`).join('')}`);
    await refreshList($panel);
  }

  async function saveNew($panel) {
    const worldbookName = getTargetWorldbook($panel);
    const raw = String($panel.find('[data-field="raw"]').val() || '').trim();
    const title = String($panel.find('[data-field="title"]').val() || '').trim() || `暂存 ${new Date().toLocaleString()}`;
    if (!raw) {
      setStatus($panel, '请先粘贴原始页面');
      return;
    }
    setStatus($panel, '保存中...');
    const createdBook = await ensureWorldbook(worldbookName);
    const entry = await createStashEntry(worldbookName, title, raw);
    $panel.data('selectedUid', entry.uid || null);
    $panel.attr('data-has-selection', 'true');
    saveSettings(getPanelSettings($panel));
    renderPreview($panel, raw, title);
    setMode($panel, 'reader');
    await refreshWorldbookOptions($panel);
    setStatus($panel, createdBook ? '已新建世界书并保存' : '已保存到世界书关闭条目');
    notify('success', '暂存页已保存。');
  }

  async function updateSelected($panel) {
    const worldbookName = getTargetWorldbook($panel);
    const uid = $panel.data('selectedUid');
    const raw = String($panel.find('[data-field="raw"]').val() || '').trim();
    const title = String($panel.find('[data-field="title"]').val() || '').trim() || `暂存 ${new Date().toLocaleString()}`;
    if (!uid) {
      setStatus($panel, '请先在左侧选择一个暂存页');
      return;
    }
    if (!raw) {
      setStatus($panel, '原始页面不能为空');
      return;
    }
    setStatus($panel, '更新中...');
    await updateStashEntry(worldbookName, uid, title, raw);
    saveSettings(getPanelSettings($panel));
    renderPreview($panel, raw, title);
    setMode($panel, 'reader');
    await refreshList($panel);
    setStatus($panel, '已更新选中暂存页');
    notify('success', '暂存页已更新。');
  }

  async function deleteSelected($panel) {
    const worldbookName = getTargetWorldbook($panel);
    const uid = $panel.data('selectedUid');
    if (!uid) {
      setStatus($panel, '请先在左侧选择一个暂存页');
      return;
    }
    if (!confirm('确定删除这个暂存页吗？')) return;
    setStatus($panel, '删除中...');
    await deleteStashEntry(worldbookName, uid);
    $panel.removeData('selectedUid');
    $panel.attr('data-has-selection', 'false');
    $panel.find('[data-field="title"]').val('');
    $panel.find('[data-field="raw"]').val('');
    $panel.find('[data-preview]').html('<div class="th-branch-preview-empty">保存或选择一个暂存页后在这里预览</div>');
    setMode($panel, 'edit');
    setMobileView($panel, 'list');
    saveSettings(getPanelSettings($panel));
    await refreshList($panel);
    setStatus($panel, '已删除');
  }

  async function deleteEntryFromList($panel, uid) {
    const numericUid = Number(uid);
    if (!Number.isFinite(numericUid)) {
      setStatus($panel, '没有选中要删除的暂存页');
      return;
    }
    if (!confirm('确定删除这个暂存页吗？')) return;
    setStatus($panel, '删除中...');
    await deleteStashEntry(getTargetWorldbook($panel), numericUid);
    if (Number($panel.data('selectedUid')) === numericUid) {
      $panel.removeData('selectedUid');
      $panel.attr('data-has-selection', 'false');
      $panel.find('[data-field="title"]').val('');
      $panel.find('[data-field="raw"]').val('');
      $panel.find('[data-preview]').html('<div class="th-branch-preview-empty">保存或选择一个暂存页后在这里预览</div>');
      setMode($panel, 'edit');
      setMobileView($panel, 'list');
      saveSettings(getPanelSettings($panel));
    }
    await refreshList($panel);
    setStatus($panel, '已删除');
  }

  function startNewEntry($panel) {
    $panel.removeData('renderCache');
    $panel.removeData('selectedUid');
    $panel.attr('data-has-selection', 'false');
    $panel.find('.th-branch-item').attr('aria-current', 'false');
    $panel.find('[data-field="title"]').val('');
    $panel.find('[data-field="raw"]').val('');
    $panel.find('[data-preview]').html('<div class="th-branch-preview-empty">粘贴新的分支页面后点击保存并渲染</div>');
    setMode($panel, 'edit');
    saveSettings(getPanelSettings($panel));
    setStatus($panel, '已准备新建暂存页');
  }

  function bindPanel($panel) {
    const $ = get$();

    $panel.on('click', '[data-action="minimize-panel"]', () => {
      minimizePanel($panel);
    });

    $panel.on('click', '[data-action="theme"]', function () {
      setPanelTheme($panel, this.dataset.themeValue);
    });

    $panel.on('click', '[data-action="toggle-floating-button"]', function () {
      const isHidden = String($(this).attr('aria-pressed')) === 'true';
      setFloatingButtonHidden($panel, !isHidden);
    });

    $panel.on('click', '[data-action="toggle-mobile-settings"]', () => {
      $panel.toggleClass('th-branch-mobile-settings-open');
    });

    $panel.on('change', '[data-field="worldbookSelect"]', async function () {
      const value = String($(this).val() || '');
      if (value) {
        $panel.find('[data-field="worldbookName"]').val(value);
        $panel.removeData('selectedUid');
        saveSettings(getPanelSettings($panel));
        await refreshList($panel);
      }
    });

    $panel.on('change blur', '[data-field="worldbookName"]', async () => {
      $panel.removeData('selectedUid');
      saveSettings(getPanelSettings($panel));
      await refreshList($panel);
    });

    $panel.on('click', '[data-action="refresh-worldbooks"]', async () => {
      await refreshWorldbookOptions($panel);
    });

    $panel.on('click', '[data-action="new-entry"]', () => {
      startNewEntry($panel);
    });

    $panel.on('click', '[data-action="edit-mode"]', () => {
      setMode($panel, 'edit');
      setStatus($panel, '已进入编辑模式');
    });

    $panel.on('click', '[data-action="reader-mode"]', () => {
      const raw = String($panel.find('[data-field="raw"]').val() || '');
      if (raw.trim()) {
        renderPreview($panel, raw);
      }
      setMode($panel, 'reader');
      setStatus($panel, '已显示阅读列表');
    });

    $panel.on('click', '[data-action="return-list"]', () => {
      returnToList($panel);
    });

    $panel.on('click', '[data-action="immersive-mode"]', () => {
      const raw = String($panel.find('[data-field="raw"]').val() || '');
      if (!raw.trim()) {
        setStatus($panel, '请先粘贴或选择一个暂存页');
        return;
      }
      renderPreview($panel, raw);
      setMode($panel, 'immersive');
      setStatus($panel, '已进入沉浸阅读');
    });

    $panel.on('click', '[data-action="open-stash"]', function () {
      const uid = Number(this.dataset.uid);
      const entries = $panel.data('entries') || [];
      const entry = entries.find((item) => Number(item.uid) === uid);
      if (!entry) return;
      $panel.find('.th-branch-item').attr('aria-current', 'false');
      $(this).closest('.th-branch-item').attr('aria-current', 'true');
      fillEditorFromEntry($panel, entry);
      setStatus($panel, '已打开暂存页');
    });

    $panel.on('click', '[data-action="toggle-read"]', async function () {
      const uid = Number(this.dataset.uid);
      const isRead = String($(this).attr('aria-pressed')) === 'true';
      try {
        setStatus($panel, isRead ? '取消已读中...' : '标记已读中...');
        const updatedEntry = await setStashReadStatus(getTargetWorldbook($panel), uid, !isRead);
        if (Number($panel.data('selectedUid')) === uid && updatedEntry) {
          const meta = getEntryMeta(updatedEntry);
          $panel.find('[data-field="title"]').val(meta.title || '');
          updateCurrentReadControls($panel, updatedEntry);
        }
        await refreshList($panel);
        setStatus($panel, isRead ? '已改为未读' : '已标记已读');
      } catch (error) {
        console.error(error);
        setStatus($panel, `标记失败：${error.message || error}`);
        notify('error', `标记失败：${error.message || error}`);
      }
    });

    $panel.on('click', '[data-action="toggle-current-read"]', async () => {
      await toggleCurrentReadStatus($panel);
    });

    $panel.on('click', '[data-action="delete-stash"]', async function () {
      try {
        await deleteEntryFromList($panel, this.dataset.uid);
      } catch (error) {
        console.error(error);
        setStatus($panel, `删除失败：${error.message || error}`);
        notify('error', `删除失败：${error.message || error}`);
      }
    });

    $panel.on('click', '[data-action="preview"]', () => {
      const raw = String($panel.find('[data-field="raw"]').val() || '');
      if (!raw.trim()) {
        setStatus($panel, '请先粘贴原始页面');
        return;
      }
      renderPreview($panel, raw, '', true);
      setMode($panel, 'reader');
      setStatus($panel, '已预览');
    });

    $panel.on('click', '[data-action="save-new"]', async () => {
      try {
        await saveNew($panel);
      } catch (error) {
        console.error(error);
        setStatus($panel, `保存失败：${error.message || error}`);
        notify('error', `保存失败：${error.message || error}`);
      }
    });

    $panel.on('click', '[data-action="update"]', async () => {
      try {
        await updateSelected($panel);
      } catch (error) {
        console.error(error);
        setStatus($panel, `更新失败：${error.message || error}`);
        notify('error', `更新失败：${error.message || error}`);
      }
    });

    $panel.on('click', '[data-action="delete"]', async () => {
      try {
        await deleteSelected($panel);
      } catch (error) {
        console.error(error);
        setStatus($panel, `删除失败：${error.message || error}`);
        notify('error', `删除失败：${error.message || error}`);
      }
    });
  }

  async function openPanel() {
    const $ = get$();
    if (!$) {
      alert('没有找到 jQuery，无法打开分支暂存器。');
      return;
    }
    injectStyle();
    removeMinimizedButton();
    const widget = ensureWidgetContainer();
    const existingOverlay = widget.querySelector('.th-branch-overlay');
    if (existingOverlay) {
      const $existingOverlay = $(existingOverlay);
      if ($existingOverlay.hasClass('th-branch-minimized')) {
        restoreMinimizedPanel($existingOverlay);
      } else {
        hideFloatingButton();
        const panel = $existingOverlay.find('.th-branch-panel')[0];
        if (panel && typeof panel.focus === 'function') panel.focus();
      }
      return;
    }
    const settings = loadSettings();
    const $overlay = $(`<div class="th-branch-overlay"></div>`);
    const $panel = $(buildPanelHtml(settings));
    $overlay.append($panel);
    $overlay.on('click', (event) => {
      if (event.target === $overlay[0]) {
        minimizePanel($panel);
      }
    });
    widget.appendChild($overlay[0]);
    widget.dataset.panelOpen = 'true';
    hideFloatingButton();
    bindOverlayViewport($overlay);
    bindPanel($panel);
    await refreshList($panel);
  }

  function injectFallbackButton() {
    const doc = getHostDocument();
    const widget = ensureWidgetContainer();
    const activeOverlay = syncWidgetOpenState(widget);
    const settings = loadSettings();
    const shouldShow = !activeOverlay && !settings.floatingButtonHidden;
    removeMinimizedButton();
    let existing = doc.getElementById(FLOATING_BUTTON_ID);
    if (existing && existing.dataset.thBranchStashVersion !== SCRIPT_VERSION) {
      const rect = existing.getBoundingClientRect();
      if (rect.width && rect.height) {
        floatingButtonPosition = { left: rect.left, top: rect.top };
      }
      existing.remove();
      existing = null;
    }
    if (existing) {
      existing.type = 'button';
      existing.textContent = '🐱';
      existing.title = '打开分支页面暂存器';
      existing.setAttribute('aria-label', '打开分支页面暂存器');
      existing.dataset.thBranchStashVersion = SCRIPT_VERSION;
      existing.style.cssText = getFloatingButtonStyle(settings.theme);
      applyFloatingButtonPosition(existing);
      existing.style.display = shouldShow ? '' : 'none';
      if (shouldShow) ensureFloatingButtonInViewport(existing);
      bindFloatingButtonDrag(existing, () => openPanel().catch((error) => notify('error', error.message || String(error))));
      if (existing.parentNode !== widget) widget.appendChild(existing);
      return;
    }
    const button = doc.createElement('button');
    button.id = FLOATING_BUTTON_ID;
    button.type = 'button';
    button.textContent = '🐱';
    button.title = '打开分支页面暂存器';
    button.setAttribute('aria-label', '打开分支页面暂存器');
    button.dataset.thBranchStashVersion = SCRIPT_VERSION;
    button.style.cssText = getFloatingButtonStyle(settings.theme);
    applyFloatingButtonPosition(button);
    button.style.display = shouldShow ? '' : 'none';
    bindFloatingButtonDrag(button, () => openPanel().catch((error) => notify('error', error.message || String(error))));
    widget.appendChild(button);
    if (shouldShow) ensureFloatingButtonInViewport(button);
  }

  function installFloatingButtonGuard() {
    const doc = getHostDocument();
    if (!doc || !doc.body) return;
    if (floatingGuardObserver && doc.body.dataset.thBranchFloatingGuardVersion === SCRIPT_VERSION) return;
    clearFloatingButtonGuard();
    if (doc.body) {
      doc.body.dataset.thBranchFloatingGuard = 'true';
      doc.body.dataset.thBranchFloatingGuardVersion = SCRIPT_VERSION;
    }

    const repairFloatingButton = (deep = false) => {
      try {
        const widget = doc.getElementById(WIDGET_ID);
        const button = doc.getElementById(FLOATING_BUTTON_ID);
        const activeOverlay = syncWidgetOpenState(widget);
        const floatingButtonHidden = Boolean(loadSettings().floatingButtonHidden);
        const buttonStale = button && button.dataset.thBranchStashVersion !== SCRIPT_VERSION;
        const buttonHiddenWithoutPanel = button && !activeOverlay && !floatingButtonHidden && button.style.display === 'none';
        let buttonInvisible = false;
        let buttonOutside = false;
        if (deep && button && !activeOverlay && !floatingButtonHidden) {
          const style = getHostWindow().getComputedStyle ? getHostWindow().getComputedStyle(button) : null;
          buttonInvisible = !!style && (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0);
          const rect = button.getBoundingClientRect();
          const viewport = getViewportSize();
          buttonOutside = !rect.width || !rect.height || rect.right < 8 || rect.bottom < 8 || rect.left > viewport.width - 8 || rect.top > viewport.height - 8;
        }
        if (buttonOutside) floatingButtonPosition = null;
        if (!button || buttonStale || buttonHiddenWithoutPanel || buttonInvisible || buttonOutside) {
          injectFallbackButton();
        }
      } catch (error) {
        console.warn(`[${SCRIPT_NAME}] 重建悬浮入口失败`, error);
      }
    };

    const scheduleLightRepair = () => {
      if (floatingRepairTimer) return;
      floatingRepairTimer = setTimeout(() => {
        floatingRepairTimer = null;
        repairFloatingButton(false);
      }, 360);
    };

    [900, 2200, 5200, 9000, 15000].forEach((delay) => {
      const timer = setTimeout(() => {
        try {
          repairFloatingButton(true);
        } catch (error) {
          console.warn(`[${SCRIPT_NAME}] 重建悬浮入口失败`, error);
        }
      }, delay);
      floatingGuardTimers.push(timer);
    });
    try {
      const Observer = getHostWindow().MutationObserver || window.MutationObserver;
      if (!Observer || !doc.body) return;
      const observer = new Observer(() => {
        const widget = doc.getElementById(WIDGET_ID);
        if (widget) observer.observe(widget, { childList: true });
        const activeOverlay = hasActiveOverlay(widget);
        const button = doc.getElementById(FLOATING_BUTTON_ID);
        if (!widget || (!activeOverlay && !button)) scheduleLightRepair();
      });
      observer.observe(doc.body, { childList: true });
      const widget = doc.getElementById(WIDGET_ID);
      if (widget) observer.observe(widget, { childList: true });
      floatingGuardObserver = observer;
    } catch (error) {
      console.warn(`[${SCRIPT_NAME}] 悬浮入口守护启动失败`, error);
    }
  }

  function register() {
    claimGlobalInstance();
    const hostDoc = getHostDocument();
    if (!hostDoc.head || !hostDoc.body) {
      if (!bootRetryTimer) {
        bootRetryTimer = setTimeout(() => {
          bootRetryTimer = null;
          register();
        }, 120);
      }
      return;
    }
    injectStyle();
    try {
      const handler = () => openPanel().catch((error) => {
        console.error(error);
        notify('error', `打开失败：${error.message || error}`);
      });
      let registered = false;
      if (typeof appendInexistentScriptButtons === 'function') {
        appendInexistentScriptButtons([{ name: BUTTON_NAME, visible: true }]);
      }
      if (typeof eventOnButton === 'function') {
        eventOnButton(BUTTON_NAME, handler);
        registered = true;
      }
      if (typeof getButtonEvent === 'function' && typeof eventOn === 'function') {
        eventOn(getButtonEvent(BUTTON_NAME), handler);
        registered = true;
      }
      injectFallbackButton();
      installFloatingButtonGuard();
      installMessageStashButtons();
    } catch (error) {
      console.warn(`[${SCRIPT_NAME}] 注册按钮失败，使用浮动按钮`, error);
      injectFallbackButton();
      installFloatingButtonGuard();
      installMessageStashButtons();
    }
  }

  window.addEventListener('pagehide', stopInstance, { once: true });
  window.addEventListener('unload', stopInstance, { once: true });

  const initialDocument = getHostDocument();
  if (initialDocument.readyState === 'loading') {
    initialDocument.addEventListener('DOMContentLoaded', register, { once: true });
  } else {
    register();
  }
})();
