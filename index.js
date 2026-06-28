// == TavernHelper Script ==
// name: 分支页面暂存器
// author: Codex
// version: v0.33
// description: 将未读分支页面原文保存到指定世界书的关闭条目中，并在酒馆助手面板内按当前酒馆渲染规则预览。

(function () {
  'use strict';

  const SCRIPT_NAME = '分支页面暂存器';
  const SCRIPT_VERSION = 'v0.33';
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
  let floatingButtonPosition = null;
  let minimizedButtonPosition = null;
  let floatingGuardObserver = null;
  let floatingGuardTimers = [];
  let floatingRepairTimer = null;
  let bootRetryTimer = null;
  let stoppingInstance = false;

  const DEFAULT_SETTINGS = {
    worldbookName: '分支页面暂存库',
    lastSelectedUid: null,
    theme: 'dark',
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

  function stopInstance() {
    if (stoppingInstance) return;
    stoppingInstance = true;
    clearFloatingButtonGuard();
    removeOwnedDom();
    const host = getHostWindow();
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
      if (st && st.characters && st.characterId !== undefined && st.characters[st.characterId]) {
        return st.characters[st.characterId].name || '';
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
    const html = stripMarkdownFenceBlocks(preserveParagraphsInHtml(renderRawToHtml(raw)));
    return {
      html,
      warnings: makeRenderWarnings(raw, html),
      prose: isMostlyProseHtml(html),
    };
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
        box-shadow: 0 18px 48px rgba(0, 0, 0, 0.38);
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
        gap: 5px;
        margin-top: 7px;
      }
      .th-branch-window-actions {
        display: none;
        align-items: center;
        gap: 6px;
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
      .th-branch-item span {
        overflow: hidden;
        color: var(--th-branch-subtle);
        font-size: 12px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .th-branch-read-toggle,
      .th-branch-delete-toggle {
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
      .th-branch-preview-card img,
      .th-branch-preview-card video,
      .th-branch-preview-card iframe {
        max-width: 100%;
      }
      .th-branch-preview-empty {
        color: var(--th-branch-muted);
        text-align: center;
        padding: 40px 10px;
      }
      @media (max-width: 820px) {
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
          overflow: auto;
          -webkit-overflow-scrolling: touch;
          padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 96px);
          scroll-padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 96px);
        }
        @supports (height: 100dvh) {
          .th-branch-panel {
            height: 100dvh !important;
            max-height: 100dvh !important;
          }
        }
        .th-branch-sidebar {
          display: block;
          overflow: visible;
          border-right: 0;
          border-bottom: 1px solid var(--th-branch-soft-border);
        }
        .th-branch-head {
          position: sticky;
          top: 0;
          z-index: 5;
          padding: 10px;
          background: var(--th-branch-sidebar-bg);
          box-shadow: 0 1px 0 var(--th-branch-soft-border);
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
        .th-branch-btn,
        .th-branch-read-toggle,
        .th-branch-delete-toggle {
          min-height: 38px;
        }
        .th-branch-worldbook {
          padding: 10px;
        }
        .th-branch-list {
          max-height: 34vh;
          min-height: 96px;
          overflow: auto;
          border-bottom: 1px solid var(--th-branch-soft-border);
          -webkit-overflow-scrolling: touch;
        }
        .th-branch-main {
          display: block;
          overflow: visible;
        }
        .th-branch-editor {
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
      }
      @media (max-height: 560px) {
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
    const options = worldbooks.map((name) => `<option value="${escapeAttr(name)}"${name === settings.worldbookName ? ' selected' : ''}>${escapeHtml(name)}</option>`).join('');
    const versionLabel = getVersionLabel();
    const versionDetail = getVersionDetail();
    return `
      <div class="th-branch-panel" data-mode="edit" data-theme="${escapeAttr(theme)}">
        <aside class="th-branch-sidebar">
          <header class="th-branch-head">
            <div>
              <div class="th-branch-title">分支页面暂存器 <span class="th-branch-version">${escapeHtml(versionLabel)}</span></div>
              <div class="th-branch-update-line">${escapeHtml(versionDetail)}</div>
              <div class="th-branch-theme-switch" aria-label="主题">
                <button type="button" class="th-branch-theme-btn" data-action="theme" data-theme-value="dark" aria-pressed="${theme === 'dark' ? 'true' : 'false'}">黑</button>
                <button type="button" class="th-branch-theme-btn" data-action="theme" data-theme-value="light" aria-pressed="${theme === 'light' ? 'true' : 'false'}">白</button>
                <button type="button" class="th-branch-theme-btn" data-action="theme" data-theme-value="green" aria-pressed="${theme === 'green' ? 'true' : 'false'}">绿</button>
              </div>
            </div>
            <div class="th-branch-window-actions">
              <button type="button" class="th-branch-close" data-action="minimize-panel" title="返回酒馆" aria-label="返回酒馆">×</button>
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
      dark: { border: '#77c0a6', background: '#1f6ed4', color: '#ffffff', shadow: 'rgba(0, 0, 0, 0.34)' },
      light: { border: '#3d8e70', background: '#2f7ed8', color: '#ffffff', shadow: 'rgba(30, 44, 38, 0.16)' },
      green: { border: '#91c788', background: '#2f6f59', color: '#ffffff', shadow: 'rgba(33, 60, 42, 0.24)' },
    };
    const colors = themes[value] || themes.dark;
    const mobile = isMobileViewport();
    const size = mobile ? 56 : 52;
    const right = mobile ? 14 : 16;
    const bottom = mobile ? 112 : 164;
    const radius = mobile ? 16 : 15;
    const vertical = mobile ? 'top:calc(env(safe-area-inset-top, 0px) + 18px);bottom:auto;' : `bottom:calc(env(safe-area-inset-bottom, 0px) + ${bottom}px);`;
    return `position:fixed;right:${right}px;${vertical}z-index:2147483647;width:${size}px;height:${size}px;padding:0;border-radius:${radius}px;border:1px solid ${colors.border};background:${colors.background};color:${colors.color};box-shadow:0 10px 26px ${colors.shadow};font-size:22px;line-height:${size - 2}px;text-align:center;font-weight:900;cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;visibility:visible;opacity:1;pointer-events:auto;`;
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
    if (!button || button.dataset.thBranchFloatingDragBound === 'true') return;
    button.dataset.thBranchFloatingDragBound = 'true';
    let active = false;
    let pointerId = null;
    let moved = false;
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
      button.addEventListener('pointerdown', (event) => {
        if (event.button !== undefined && event.button !== 0) return;
        begin(event.clientX, event.clientY, event.pointerId);
        if (event.cancelable) event.preventDefault();
        try {
          button.setPointerCapture(event.pointerId);
        } catch (error) {
          // Pointer capture is optional here.
        }
      });
      doc.addEventListener('pointermove', (event) => {
        if (!active || (pointerId !== null && event.pointerId !== pointerId)) return;
        move(event.clientX, event.clientY);
        if (event.cancelable) event.preventDefault();
      }, { passive: false });
      doc.addEventListener('pointerup', (event) => {
        if (!active || (pointerId !== null && event.pointerId !== pointerId)) return;
        finish(event);
      }, { passive: false });
      doc.addEventListener('pointercancel', (event) => {
        if (!active || (pointerId !== null && event.pointerId !== pointerId)) return;
        active = false;
        pointerId = null;
        button.style.cursor = 'grab';
      }, { passive: true });
    } else {
      button.addEventListener('touchstart', (event) => {
        const touch = event.changedTouches && event.changedTouches[0];
        if (!touch) return;
        begin(touch.clientX, touch.clientY, touch.identifier);
        if (event.cancelable) event.preventDefault();
      }, { passive: false });
      doc.addEventListener('touchmove', (event) => {
        if (!active) return;
        const touches = Array.from(event.changedTouches || []);
        const touch = touches.find((item) => item.identifier === pointerId) || touches[0];
        if (!touch) return;
        move(touch.clientX, touch.clientY);
        if (event.cancelable) event.preventDefault();
      }, { passive: false });
      doc.addEventListener('touchend', (event) => {
        if (!active) return;
        finish(event);
      }, { passive: false });
      doc.addEventListener('touchcancel', () => {
        active = false;
        pointerId = null;
        button.style.cursor = 'grab';
      }, { passive: true });
    }

    button.addEventListener('click', (event) => {
      if (Date.now() < suppressClickUntil) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (!getHostWindow().PointerEvent) action(event);
    });
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

  function isMobileLikeViewport() {
    const host = getHostWindow();
    try {
      if (host.matchMedia && host.matchMedia('(pointer: coarse)').matches) return true;
    } catch (error) {
      // Continue with viewport fallback.
    }
    return (host.innerWidth || getHostDocument().documentElement.clientWidth || 9999) <= 820;
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
    syncOverlayViewport($panel.closest('.th-branch-overlay'));
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
    setMode($panel, 'reader');
    const preview = $panel.find('[data-preview]')[0];
    if (preview) preview.scrollTop = 0;
    const list = $panel.find('[data-list]')[0];
    if (isMobileLikeViewport() && list && typeof list.scrollIntoView === 'function') {
      try {
        list.scrollIntoView({ block: 'start', behavior: 'smooth' });
      } catch (error) {
        list.scrollIntoView();
      }
    }
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

  function renderPreview($panel, raw, title) {
    const result = renderRawResult(raw);
    const safeTitle = title || String($panel.find('[data-field="title"]').val() || '').trim() || '未命名暂存';
    const warningHtml = result.warnings.length
      ? `<div class="th-branch-render-warning">${result.warnings.map(escapeHtml).join('<br>')}</div>`
      : '';
    const cardClass = result.prose ? 'th-branch-preview-card th-branch-prose' : 'th-branch-preview-card';
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
      <div class="${cardClass}">${result.html}</div>
      ${readerBottomHtml}`);
  }

  function fillEditorFromEntry($panel, entry) {
    const meta = getEntryMeta(entry);
    $panel.data('selectedUid', entry.uid);
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
          const detail = [formatDate(meta.savedAt), meta.characterName, meta.chatTitle].filter(Boolean).join(' / ');
          const isRead = Boolean(meta.readAt);
          const readDetail = isRead ? `已读 ${formatDate(meta.readAt)}` : '未读';
          return `
            <div class="th-branch-item" data-uid="${escapeAttr(entry.uid)}" aria-current="${current ? 'true' : 'false'}">
              <div class="th-branch-item-top">
                <button type="button" class="th-branch-open" data-action="open-stash" data-uid="${escapeAttr(entry.uid)}">
                  <strong>${escapeHtml(meta.title)}</strong>
                </button>
                <div class="th-branch-item-actions">
                  <button type="button" class="th-branch-read-toggle" data-action="toggle-read" data-uid="${escapeAttr(entry.uid)}" aria-pressed="${isRead ? 'true' : 'false'}">${isRead ? '已读' : '标记已读'}</button>
                  <button type="button" class="th-branch-delete-toggle" data-action="delete-stash" data-uid="${escapeAttr(entry.uid)}">删除</button>
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
    $panel.find('[data-field="title"]').val('');
    $panel.find('[data-field="raw"]').val('');
    $panel.find('[data-preview]').html('<div class="th-branch-preview-empty">保存或选择一个暂存页后在这里预览</div>');
    setMode($panel, 'edit');
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
      $panel.find('[data-field="title"]').val('');
      $panel.find('[data-field="raw"]').val('');
      $panel.find('[data-preview]').html('<div class="th-branch-preview-empty">保存或选择一个暂存页后在这里预览</div>');
      setMode($panel, 'edit');
      saveSettings(getPanelSettings($panel));
    }
    await refreshList($panel);
    setStatus($panel, '已删除');
  }

  function startNewEntry($panel) {
    $panel.removeData('selectedUid');
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
      renderPreview($panel, raw);
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
      existing.textContent = '暂';
      existing.title = '打开分支页面暂存器';
      existing.setAttribute('aria-label', '打开分支页面暂存器');
      existing.dataset.thBranchStashVersion = SCRIPT_VERSION;
      existing.style.cssText = getFloatingButtonStyle(loadSettings().theme);
      applyFloatingButtonPosition(existing);
      existing.style.display = activeOverlay ? 'none' : '';
      if (!activeOverlay) ensureFloatingButtonInViewport(existing);
      bindFloatingButtonDrag(existing, () => openPanel().catch((error) => notify('error', error.message || String(error))));
      if (existing.parentNode !== widget) widget.appendChild(existing);
      return;
    }
    const button = doc.createElement('button');
    button.id = FLOATING_BUTTON_ID;
    button.type = 'button';
    button.textContent = '暂';
    button.title = '打开分支页面暂存器';
    button.setAttribute('aria-label', '打开分支页面暂存器');
    button.dataset.thBranchStashVersion = SCRIPT_VERSION;
    button.style.cssText = getFloatingButtonStyle(loadSettings().theme);
    applyFloatingButtonPosition(button);
    button.style.display = activeOverlay ? 'none' : '';
    bindFloatingButtonDrag(button, () => openPanel().catch((error) => notify('error', error.message || String(error))));
    widget.appendChild(button);
    if (!activeOverlay) ensureFloatingButtonInViewport(button);
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
        const buttonStale = button && button.dataset.thBranchStashVersion !== SCRIPT_VERSION;
        const buttonHiddenWithoutPanel = button && !activeOverlay && button.style.display === 'none';
        let buttonInvisible = false;
        let buttonOutside = false;
        if (deep && button && !activeOverlay) {
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
        scheduleLightRepair();
      });
      observer.observe(doc.body, { childList: true, subtree: true });
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
    } catch (error) {
      console.warn(`[${SCRIPT_NAME}] 注册按钮失败，使用浮动按钮`, error);
      injectFallbackButton();
      installFloatingButtonGuard();
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
