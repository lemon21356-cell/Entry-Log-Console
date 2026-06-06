(() => {
  'use strict';

  const CHANNEL = '__ENTRY_LOG_CONSOLE__';
  const LOG_VALUES = ['log', 'info', 'warn', 'error', 'debug'];
  const LOG_OPTIONS = LOG_VALUES.map((value) => [`[${value}]`, value]);
  const PATCH_FLAG = '__entryLogConsolePatched__';
  let currentSceneName = '';

  waitForEntry();

  function waitForEntry() {
    const timer = setInterval(() => {
      if (window.Entry && window.Entry.block) {
        clearInterval(timer);
        patchEntry();
      }
    }, 120);
  }

  function patchEntry() {
    if (window.Entry[PATCH_FLAG]) {
      return;
    }
    window.Entry[PATCH_FLAG] = true;

    patchDefinitions();
    patchBlockFunction('dialog');
    patchBlockFunction('dialog_time');
    patchSceneTracking();
    patchBlockMenuRefresh();

    window.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'l') {
        post({ type: 'clear' });
      }
    });
  }

  function patchDefinitions() {
    ['dialog', 'dialog_time'].forEach((name) => {
      const block = window.Entry.block[name];
      if (!block) {
        return;
      }

      addLogOptions(block.params);
      addLogOptions(block?.syntax?.py?.[0]?.textParams);
    });
  }

  function addLogOptions(params) {
    if (!Array.isArray(params)) {
      return;
    }

    params.forEach((param) => {
      if (!param || param.type !== 'Dropdown' || !Array.isArray(param.options)) {
        return;
      }

      const optionValues = new Set(param.options.map((option) => option && option[1]));
      LOG_OPTIONS.forEach((option) => {
        if (!optionValues.has(option[1])) {
          param.options.push(option);
        }
      });
    });
  }

  function patchBlockFunction(blockName) {
    const block = window.Entry.block[blockName];
    if (!block || typeof block.func !== 'function' || block.__entryLogConsoleFuncPatched) {
      return;
    }

    const original = block.func;
    block.__entryLogConsoleFuncPatched = true;

    block.func = function patchedDialog(sprite, script) {
      const mode = readMode(blockName, script);
      if (LOG_VALUES.includes(mode)) {
        const objectInfo = getObjectInfo(sprite);
        const sceneInfo = getSceneInfo(objectInfo.object);
        const message = readMessage(script);
        post({
          type: 'entry',
          level: mode,
          message,
          objectId: objectInfo.id,
          objectName: objectInfo.name,
          sceneId: sceneInfo.id,
          sceneName: sceneInfo.name,
        });
        return script.callReturn();
      }

      return original.apply(this, arguments);
    };
  }

  function patchSceneTracking() {
    const sceneApi = window.Entry?.scene;
    if (!sceneApi || sceneApi.__entryLogConsoleScenePatched) {
      currentSceneName = getCurrentSceneName();
      return;
    }

    sceneApi.__entryLogConsoleScenePatched = true;
    currentSceneName = getCurrentSceneName();

    ['selectScene', 'changeScene', 'loadScene'].forEach((methodName) => {
      const original = sceneApi[methodName];
      if (typeof original !== 'function') {
        return;
      }

      sceneApi[methodName] = function patchedSceneMethod(sceneLike) {
        const result = original.apply(this, arguments);
        const resolved = normalizeSceneName(sceneLike) || getCurrentSceneName();
        if (resolved) {
          currentSceneName = resolved;
        }
        return result;
      };
    });

    window.Entry?.addEventListener?.('selectScene', (sceneLike) => {
      const resolved = normalizeSceneName(sceneLike) || getCurrentSceneName();
      if (resolved) {
        currentSceneName = resolved;
      }
    });

    window.addEventListener('message', (event) => {
      if (event.source !== window || !event.data || event.data.channel !== CHANNEL) {
        return;
      }

      const payload = event.data.payload || {};
      if (payload.type === 'navigate') {
        navigateToLogTarget(payload);
      }
    });
  }

  function patchBlockMenuRefresh() {
    setTimeout(() => {
      try {
        const playground = window.Entry.playground;
        if (playground?.blockMenu?.banClass) {
          playground.blockMenu.banClass = [];
        }
        playground?.setBlockMenu?.();
      } catch (_) {
        // The editor may not be fully initialized yet. Existing blocks still work.
      }
    }, 700);
  }

  function readMode(blockName, script) {
    const key = blockName === 'dialog_time' ? 'OPTION' : 'OPTION';
    try {
      return String(script.getField(key, script)).toLowerCase();
    } catch (_) {
      return '';
    }
  }

  function readMessage(script) {
    let value = '';
    try {
      value = script.getValue('VALUE', script);
    } catch (_) {
      value = '';
    }

    if (value === '') {
      return ' ';
    }
    if (typeof value === 'boolean') {
      return value ? 'True' : 'False';
    }
    if (window.Entry?.convertToRoundedDecimals) {
      return window.Entry.convertToRoundedDecimals(`${value}`, 3);
    }
    return `${value}`;
  }

  function getObjectInfo(sprite) {
    const object = sprite?.parent || sprite?.object || findObjectById(sprite?.id) || {};
    const selectedObject =
      window.Entry?.container?.selectedObject ||
      window.Entry?.playground?.object ||
      window.Entry?.stage?.selectedObject;

    const fallback = object?.id ? object : selectedObject || object;

    return {
      object: fallback,
      id: fallback?.id || object?.id || sprite?.id || '',
      name:
        fallback?.name ||
        fallback?.sprite?.name ||
        object?.name ||
        object?.sprite?.name ||
        sprite?.name ||
        '',
    };
  }

  function getSceneInfo(object) {
    const objectScene = object?.scene || object?.sceneId;
    const objectSceneId = typeof objectScene === 'string' ? objectScene : objectScene?.id || objectScene?._id;
    const selectedScene = window.Entry?.scene?.selectedScene || window.Entry?.scene?.getSelectedScene?.();
    const selectedSceneName = selectedScene?.name || selectedScene?.title;

    if (objectScene?.name || objectScene?.title) {
      return {
        id: objectScene.id || objectScene._id || '',
        name: objectScene.name || objectScene.title,
      };
    }

    if (objectSceneId) {
      const found = getSceneList().find((scene) => scene?.id === objectSceneId || scene?._id === objectSceneId);
      if (found?.name || found?.title) {
        return {
          id: found.id || found._id || objectSceneId,
          name: found.name || found.title,
        };
      }
    }

    return {
      id: selectedScene?.id || selectedScene?._id || '',
      name: selectedSceneName || selectedObjectSceneName() || currentSceneName || '',
    };
  }

  function getCurrentSceneName() {
    const entryScene = window.Entry?.scene;
    const candidates = [
      currentSceneName,
      entryScene?.selectedScene,
      entryScene?._selectedScene,
      entryScene?.currentScene,
      entryScene?._currentScene,
      entryScene?.selectedSceneId,
      entryScene?._selectedSceneId,
      entryScene?.currentSceneId,
      entryScene?._currentSceneId,
      entryScene?.getSelectedScene?.(),
      entryScene?.getCurrentScene?.(),
      window.Entry?.stage?.selectedScene,
      window.Entry?.stage?.currentScene,
      window.Entry?.container?.getCurrentObjects?.()?.[0]?.scene,
    ];

    for (const scene of candidates) {
      const resolved = normalizeSceneName(scene);
      if (resolved) {
        return resolved;
      }
    }

    return getCurrentSceneNameFromDom();
  }

  function findSceneById(sceneId) {
    if (!sceneId) {
      return '';
    }
    const scenes = getSceneList();
    const found = scenes.find((scene) => scene?.id === sceneId || scene?._id === sceneId);
    return found?.name || found?.title || '';
  }

  function findObjectById(objectId) {
    if (!objectId) {
      return null;
    }

    return getObjectList().find((object) => object?.id === objectId || object?._id === objectId) || null;
  }

  function findObjectByName(objectName) {
    if (!objectName) {
      return null;
    }

    return getObjectList().find((object) => {
      const name = object?.name || object?.sprite?.name;
      return name === objectName;
    }) || null;
  }

  function getObjectList() {
    const container = window.Entry?.container;
    const candidates = [
      container?.objects_,
      container?.objects,
      container?.getObjects?.(),
      container?.getAllObjects?.(),
      window.Entry?.objects,
    ];

    for (const list of candidates) {
      if (Array.isArray(list)) {
        return list;
      }
    }

    return [];
  }

  function navigateToLogTarget(payload) {
    const object = findObjectById(payload.objectId) || findObjectByName(payload.objectName);
    const sceneId = payload.sceneId || object?.scene || object?.sceneId;
    const scene = findSceneObject(sceneId, payload.sceneName);

    if (scene) {
      selectScene(scene);
      currentSceneName = scene.name || scene.title || currentSceneName;
    }

    setTimeout(() => {
      const target = object || findObjectById(payload.objectId) || findObjectByName(payload.objectName);
      if (target) {
        selectObject(target);
      }
    }, 80);
  }

  function findSceneObject(sceneId, sceneName) {
    const scenes = getSceneList();
    return scenes.find((scene) => scene?.id === sceneId || scene?._id === sceneId) ||
      scenes.find((scene) => scene?.name === sceneName || scene?.title === sceneName) ||
      null;
  }

  function selectScene(scene) {
    const sceneApi = window.Entry?.scene;
    const sceneId = scene?.id || scene?._id;

    [
      [sceneApi, 'selectScene', scene],
      [sceneApi, 'selectScene', sceneId],
      [sceneApi, 'changeScene', scene],
      [sceneApi, 'changeScene', sceneId],
      [sceneApi, 'loadScene', scene],
      [sceneApi, 'loadScene', sceneId],
    ].some(callEntryMethod);

    clickSceneDom(scene);
  }

  function selectObject(object) {
    const container = window.Entry?.container;
    const objectId = object?.id || object?._id;

    [
      [container, 'selectObject', object],
      [container, 'selectObject', objectId],
      [container, 'setSelectedObject', object],
      [container, 'setSelectedObject', objectId],
      [container, 'selectObjectById', objectId],
      [window.Entry?.playground, 'selectObject', object],
      [window.Entry, 'dispatchEvent', 'selectObject', object],
    ].some(callEntryMethod);

    clickObjectDom(object);
  }

  function clickSceneDom(scene) {
    const name = scene?.name || scene?.title || '';
    const id = scene?.id || scene?._id || '';
    clickMatchingDom('[class*="scene"], [class*="Scene"]', name, id);
  }

  function clickObjectDom(object) {
    const name = object?.name || object?.sprite?.name || '';
    const id = object?.id || object?._id || '';
    clickMatchingDom('[class*="object"], [class*="Object"], [data-id]', name, id);
  }

  function clickMatchingDom(selector, name, id) {
    const elements = Array.from(document.querySelectorAll(selector));
    const target = elements.find((element) => {
      const text = String(element.textContent || '').replace(/\s+/g, ' ').trim();
      return (id && (element.dataset?.id === id || element.id === id)) || (name && text.includes(name));
    });

    target?.dispatchEvent?.(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  }

  function callEntryMethod([target, methodName, ...args]) {
    if (!target || typeof target[methodName] !== 'function' || args.some((arg) => arg === undefined || arg === null || arg === '')) {
      return false;
    }

    try {
      target[methodName](...args);
      return true;
    } catch (_) {
      return false;
    }
  }

  function normalizeSceneName(sceneLike) {
    if (!sceneLike) {
      return '';
    }

    if (typeof sceneLike === 'string') {
      const found = findSceneById(sceneLike);
      if (found) {
        return found;
      }
      return /장면\s*\d+|scene\s*\d+/i.test(sceneLike) ? sanitizeSceneText(sceneLike) : '';
    }

    if (sceneLike?.name || sceneLike?.title) {
      return sceneLike.name || sceneLike.title;
    }

    if (sceneLike?.id || sceneLike?._id) {
      return findSceneById(sceneLike.id || sceneLike._id);
    }

    return '';
  }

  function getSceneList() {
    if (window.Entry?.scene?.getScenes) {
      return window.Entry.scene.getScenes() || [];
    }
    if (window.Entry?.scenes) {
      return Array.isArray(window.Entry.scenes)
        ? window.Entry.scenes
        : Object.values(window.Entry.scenes);
    }
    return [];
  }

  function getCurrentSceneNameFromDom() {
    const selectors = [
      '.entrySceneElementWorkspace.selected',
      '.entrySceneElementWorkspace.on',
      '.entrySceneElementWorkspace.active',
      '[class*="scene"][class*="selected"]',
      '[class*="Scene"][class*="selected"]',
      '[class*="scene"][class*="active"]',
      '[class*="Scene"][class*="active"]',
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      const text = sanitizeSceneText(element?.textContent);
      if (text) {
        return text;
      }
    }

    const sceneTabs = Array.from(document.querySelectorAll('[class*="scene"], [class*="Scene"]'))
      .filter((element) => {
        const className = String(element.className || '');
        return /(selected|active|on|current)/i.test(className) || element.getAttribute('aria-selected') === 'true';
      });

    for (const element of sceneTabs) {
      const text = sanitizeSceneText(element.textContent);
      if (text) {
        return text;
      }
    }

    return '';
  }

  function sanitizeSceneText(text) {
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    if (!value) {
      return '';
    }

    const match = value.match(/장면\s*\d+|scene\s*\d+/i);
    return match ? match[0] : value.length <= 30 ? value : '';
  }

  function selectedObjectSceneName() {
    const selectedObject =
      window.Entry?.container?.selectedObject ||
      window.Entry?.playground?.object ||
      window.Entry?.stage?.selectedObject;
    const scene = selectedObject?.scene;

    if (scene?.name || scene?.title) {
      return scene.name || scene.title;
    }

    if (typeof scene === 'string') {
      return findSceneById(scene);
    }

    return '';
  }

  function post(payload) {
    window.postMessage({ channel: CHANNEL, payload }, '*');
  }
})();
