(() => {
  'use strict';

  const CHANNEL = '__ENTRY_LOG_CONSOLE__';
  const STORAGE_KEY = 'entryLogConsole.height';
  const DEFAULT_HEIGHT = 260;
  const MIN_HEIGHT = 96;
  const MAX_HEIGHT_RATIO = 0.75;

  const levels = ['all', 'log', 'info', 'warn', 'error', 'debug'];
  const state = {
    entries: [],
    filter: 'all',
    query: '',
    height: readHeight(),
    collapsed: false,
  };

  const injectScript = () => {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('injected.js');
    script.onload = () => script.remove();
    (document.documentElement || document.head).appendChild(script);
  };

  const ready = (callback) => {
    if (document.body) {
      callback();
    } else {
      document.addEventListener('DOMContentLoaded', callback, { once: true });
    }
  };

  const ui = {};

  ready(() => {
    injectScript();
    buildPanel();
    render();
  });

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.channel !== CHANNEL) {
      return;
    }

    const payload = event.data.payload || {};
    if (payload.type === 'entry') {
      addEntry(payload);
    } else if (payload.type === 'clear') {
      clearEntries();
    }
  });

  function buildPanel() {
    ui.root = document.createElement('section');
    ui.root.id = 'entry-log-console';
    ui.root.style.height = `${state.height}px`;

    const resize = document.createElement('div');
    resize.className = 'entry-log-resize';
    resize.title = '출력 패널 높이 조절';
    ui.root.appendChild(resize);

    const header = document.createElement('div');
    header.className = 'entry-log-header';
    ui.root.appendChild(header);

    const brand = document.createElement('div');
    brand.className = 'entry-log-brand';
    header.appendChild(brand);

    const icon = document.createElement('img');
    icon.src = chrome.runtime.getURL('icon.png');
    icon.alt = '';
    brand.appendChild(icon);

    const name = document.createElement('span');
    name.textContent = 'Entry Log Console';
    brand.appendChild(name);

    const tabs = document.createElement('div');
    tabs.className = 'entry-log-tabs';
    header.appendChild(tabs);

    levels.forEach((level) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.level = level;
      button.textContent = labelFor(level);
      button.addEventListener('click', () => {
        state.filter = level;
        render();
      });
      tabs.appendChild(button);
    });

    const tools = document.createElement('div');
    tools.className = 'entry-log-tools';
    header.appendChild(tools);

    ui.search = document.createElement('input');
    ui.search.type = 'search';
    ui.search.placeholder = '검색...';
    ui.search.autocomplete = 'off';
    ['keydown', 'keyup', 'keypress'].forEach((type) => {
      ui.search.addEventListener(type, (event) => {
        event.stopPropagation();
        event.stopImmediatePropagation();
      });
    });
    ui.search.addEventListener('input', () => {
      state.query = ui.search.value.trim().toLowerCase();
      renderList();
    });
    tools.appendChild(ui.search);

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'entry-log-icon-button';
    clear.title = '전체 삭제';
    clear.setAttribute('aria-label', '전체 삭제');
    clear.textContent = '⌫';
    clear.addEventListener('click', clearEntries);
    tools.appendChild(clear);

    ui.toggle = document.createElement('button');
    ui.toggle.type = 'button';
    ui.toggle.className = 'entry-log-icon-button';
    ui.toggle.title = '접기/펼치기';
    ui.toggle.setAttribute('aria-label', '접기/펼치기');
    ui.toggle.textContent = '×';
    ui.toggle.addEventListener('click', () => {
      state.collapsed = !state.collapsed;
      ui.root.classList.toggle('is-collapsed', state.collapsed);
      ui.toggle.textContent = state.collapsed ? '▴' : '×';
    });
    tools.appendChild(ui.toggle);

    ui.list = document.createElement('div');
    ui.list.className = 'entry-log-list';
    ui.root.appendChild(ui.list);

    document.body.appendChild(ui.root);
    setupResize(resize);
  }

  function addEntry(payload) {
    const level = payload.level;
    const normalized = String(level || 'log').toLowerCase();
    state.entries.push({
      id: Date.now() + Math.random(),
      level: levels.includes(normalized) ? normalized : 'log',
      message: stringify(payload.message),
      objectId: payload.objectId ? String(payload.objectId) : '',
      objectName: payload.objectName ? String(payload.objectName) : '',
      sceneId: payload.sceneId ? String(payload.sceneId) : '',
      sceneName: payload.sceneName ? String(payload.sceneName) : '',
      time: new Date(),
    });

    if (state.entries.length > 1000) {
      state.entries.splice(0, state.entries.length - 1000);
    }

    render();
    ui.list.scrollTop = ui.list.scrollHeight;
  }

  function clearEntries() {
    state.entries = [];
    render();
  }

  function render() {
    if (!ui.root) {
      return;
    }

    ui.root.querySelectorAll('.entry-log-tabs button').forEach((button) => {
      const level = button.dataset.level;
      const count = level === 'all'
        ? state.entries.length
        : state.entries.filter((entry) => entry.level === level).length;
      button.classList.toggle('is-active', state.filter === level);
      button.innerHTML = `${labelFor(level)} <span>${count}</span>`;
    });

    renderList();
  }

  function renderList() {
    const entries = state.entries.filter((entry) => {
      const matchesLevel = state.filter === 'all' || entry.level === state.filter;
      const haystack = `${entry.level} ${entry.message} ${entry.sceneName} ${entry.objectName}`.toLowerCase();
      return matchesLevel && (!state.query || haystack.includes(state.query));
    });

    ui.list.replaceChildren();

    if (!entries.length) {
      const empty = document.createElement('div');
      empty.className = 'entry-log-empty';
      empty.textContent = state.entries.length ? '검색 결과가 없습니다' : '출력이 비어 있습니다';
      ui.list.appendChild(empty);
      return;
    }

    entries.forEach((entry) => {
      const row = document.createElement('article');
      row.className = `entry-log-row entry-log-${entry.level}`;
      row.tabIndex = 0;
      row.title = '이 로그가 발생한 장면과 오브젝트로 이동';
      row.addEventListener('click', () => navigateToEntry(entry));
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          navigateToEntry(entry);
        }
      });

      const meta = document.createElement('div');
      meta.className = 'entry-log-meta';
      meta.textContent = timeText(entry.time);
      row.appendChild(meta);

      const badge = document.createElement('strong');
      badge.className = 'entry-log-badge';
      badge.textContent = `[${entry.level}]`;
      row.appendChild(badge);

      const origin = document.createElement('span');
      origin.className = 'entry-log-origin';
      origin.textContent = `-- [${originText(entry)}]`;
      row.appendChild(origin);

      const message = document.createElement('pre');
      message.className = 'entry-log-message';
      message.textContent = entry.message;
      row.appendChild(message);

      ui.list.appendChild(row);
    });
  }

  function setupResize(handle) {
    let startY = 0;
    let startHeight = 0;

    const onMove = (event) => {
      const maxHeight = Math.max(MIN_HEIGHT, Math.round(window.innerHeight * MAX_HEIGHT_RATIO));
      const next = Math.min(maxHeight, Math.max(MIN_HEIGHT, startHeight + startY - event.clientY));
      state.height = next;
      ui.root.style.height = `${next}px`;
    };

    const onUp = () => {
      localStorage.setItem(STORAGE_KEY, String(state.height));
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    handle.addEventListener('mousedown', (event) => {
      startY = event.clientY;
      startHeight = ui.root.getBoundingClientRect().height;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      event.preventDefault();
    });
  }

  function labelFor(level) {
    return level === 'all' ? '전체' : level.toUpperCase();
  }

  function originText(entry) {
    const scene = entry.sceneName || '장면 알 수 없음';
    const object = entry.objectName || '오브젝트 알 수 없음';
    return `${scene} / ${object}`;
  }

  function navigateToEntry(entry) {
    window.postMessage({
      channel: CHANNEL,
      payload: {
        type: 'navigate',
        sceneId: entry.sceneId,
        sceneName: entry.sceneName,
        objectId: entry.objectId,
        objectName: entry.objectName,
      },
    }, '*');
  }

  function timeText(date) {
    return date.toLocaleTimeString('ko-KR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  function stringify(value) {
    if (typeof value === 'string') {
      return value;
    }

    try {
      return JSON.stringify(value, null, 2);
    } catch (_) {
      return String(value);
    }
  }

  function readHeight() {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    if (Number.isFinite(saved) && saved >= MIN_HEIGHT) {
      return saved;
    }
    return DEFAULT_HEIGHT;
  }
})();
