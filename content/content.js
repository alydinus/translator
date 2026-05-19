// content/content.js
(function () {
  if (window.__gtEnhancedLoaded) return;
  window.__gtEnhancedLoaded = true;

  // ── Shadow DOM setup ────────────────────────────────────────────────────────
  const host = document.createElement('div');
  host.id = 'gt-enhanced-root';
  const shadow = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    #gt-popup {
      position: fixed;
      z-index: 2147483647;
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 4px 24px rgba(0,0,0,.18);
      padding: 14px 16px 12px;
      min-width: 220px;
      max-width: 340px;
      font-family: 'Google Sans', Roboto, sans-serif;
      font-size: 14px;
      color: #202124;
      display: none;
      border: 1px solid #e0e0e0;
    }
    #gt-popup.visible { display: block; }
    .gt-original {
      font-size: 12px;
      color: #5f6368;
      font-style: italic;
      margin-bottom: 6px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .gt-translation {
      font-size: 18px;
      font-weight: 600;
      color: #1a73e8;
      margin-bottom: 4px;
      word-break: break-word;
    }
    .gt-lang {
      font-size: 11px;
      color: #9aa0a6;
      margin-bottom: 10px;
    }
    .gt-actions {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .gt-btn-save {
      flex: 1;
      background: #1a73e8;
      color: #fff;
      border: none;
      border-radius: 6px;
      padding: 6px 12px;
      font-size: 13px;
      cursor: pointer;
      transition: background .15s;
    }
    .gt-btn-save:hover { background: #1557b0; }
    .gt-btn-save:disabled { background: #9aa0a6; cursor: default; }
    .gt-btn-close {
      background: none;
      border: none;
      color: #5f6368;
      font-size: 18px;
      cursor: pointer;
      padding: 2px 6px;
      border-radius: 4px;
      line-height: 1;
    }
    .gt-btn-close:hover { background: #f1f3f4; }
    .gt-loader {
      display: flex;
      align-items: center;
      gap: 8px;
      color: #9aa0a6;
      font-size: 13px;
    }
    .gt-spinner {
      width: 16px; height: 16px;
      border: 2px solid #e0e0e0;
      border-top-color: #1a73e8;
      border-radius: 50%;
      animation: spin .7s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .gt-saved-badge {
      font-size: 12px;
      color: #188038;
      font-weight: 500;
    }
  `;

  const popup = document.createElement('div');
  popup.id = 'gt-popup';
  popup.innerHTML = `
    <div class="gt-original"></div>
    <div class="gt-content">
      <div class="gt-loader">
        <div class="gt-spinner"></div>
        <span>Переводим...</span>
      </div>
    </div>
    <div class="gt-actions" style="display:none">
      <button class="gt-btn-save">♡ Сохранить</button>
      <button class="gt-btn-close">✕</button>
    </div>
  `;

  shadow.appendChild(style);
  shadow.appendChild(popup);
  document.documentElement.appendChild(host);

  // ── State ───────────────────────────────────────────────────────────────────
  let lastTranslation = null;
  let debounceTimer = null;
  let lastSelectedText = '';
  let currentTargetLang = 'ru';

  // ── Exposed for context menu injection ──────────────────────────────────────
  window.__gtShowToast = (original, translation) => {
    showResult(original, translation, 'unknown', { x: window.innerWidth / 2, y: 80 });
  };

  window.__gtTranslatePage = async () => {
    const { targetLang } = await chrome.storage.local.get({ targetLang: 'ru' });
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      { acceptNode: n => {
          const skip = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT'];
          if (skip.includes(n.parentElement?.tagName)) return NodeFilter.FILTER_REJECT;
          if (!n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
      }}
    );
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) nodes.push(node);

    // Batch in groups of 10 to avoid huge requests
    for (let i = 0; i < nodes.length; i += 10) {
      const batch = nodes.slice(i, i + 10);
      await Promise.all(batch.map(async (n) => {
        try {
          const text = n.nodeValue.trim();
          if (text.length < 2 || text.length > 4000) return;
          const resp = await chrome.runtime.sendMessage({ type: 'TRANSLATE', text, targetLang });
          if (resp?.ok) n.nodeValue = resp.translation;
        } catch { /* skip node on error */ }
      }));
    }
  };

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function getEl(selector) { return shadow.querySelector(selector); }

  function positionPopup(x, y) {
    const margin = 12;
    const w = popup.offsetWidth || 260;
    const h = popup.offsetHeight || 140;
    let left = Math.min(x, window.innerWidth - w - margin);
    let top  = y + 16;
    if (top + h > window.innerHeight - margin) top = y - h - 16;
    popup.style.left = Math.max(margin, left) + 'px';
    popup.style.top  = Math.max(margin, top)  + 'px';
  }

  function showLoader(text, pos) {
    getEl('.gt-original').textContent = text.length > 60 ? text.slice(0, 60) + '…' : text;
    getEl('.gt-content').innerHTML = `
      <div class="gt-loader"><div class="gt-spinner"></div><span>Переводим...</span></div>`;
    getEl('.gt-actions').style.display = 'none';
    popup.classList.add('visible');
    positionPopup(pos.x, pos.y);
  }

  function showResult(text, translation, lang, pos) {
    lastTranslation = { original: text, translation, sourceLang: lang };
    getEl('.gt-original').textContent = text.length > 60 ? text.slice(0, 60) + '…' : text;
    getEl('.gt-content').innerHTML = `
      <div class="gt-translation">${escHtml(translation)}</div>
      <div class="gt-lang">${lang !== 'unknown' ? escHtml(lang).toUpperCase() + ' → RU' : ''}</div>`;
    const actions = getEl('.gt-actions');
    actions.style.display = 'flex';
    const saveBtn = getEl('.gt-btn-save');
    saveBtn.textContent = '♡ Сохранить';
    saveBtn.disabled = false;
    saveBtn.style.display = '';
    popup.classList.add('visible');
    positionPopup(pos.x, pos.y);
  }

  function hidePopup() {
    popup.classList.remove('visible');
    lastTranslation = null;
  }

  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ── Selection listener ──────────────────────────────────────────────────────
  document.addEventListener('mouseup', (e) => {
    const text = window.getSelection()?.toString().trim() ?? '';
    if (text === lastSelectedText) return;
    lastSelectedText = text;

    clearTimeout(debounceTimer);
    if (text.length < 2 || text.length > 500) { hidePopup(); return; }

    const pos = { x: e.clientX, y: e.clientY };
    showLoader(text, pos);

    debounceTimer = setTimeout(async () => {
      try {
        const { targetLang } = await chrome.storage.local.get({ targetLang: 'ru' });
        currentTargetLang = targetLang;
        const resp = await chrome.runtime.sendMessage({ type: 'TRANSLATE', text, targetLang });
        if (resp?.ok) {
          showResult(text, resp.translation, resp.detectedLanguage, pos);
        } else {
          getEl('.gt-content').innerHTML =
            `<div style="color:#d93025;font-size:13px">${escHtml(resp?.error ?? 'Ошибка перевода')}</div>`;
          getEl('.gt-actions').style.display = 'flex';
          getEl('.gt-btn-save').style.display = 'none';
        }
      } catch (err) {
        getEl('.gt-content').innerHTML =
          `<div style="color:#d93025;font-size:13px">${escHtml(err.message)}</div>`;
      }
    }, 300);
  });

  document.addEventListener('mousedown', (e) => {
    if (!shadow.contains(e.target)) hidePopup();
  });

  // ── Save button / close button ──────────────────────────────────────────────
  shadow.addEventListener('click', async (e) => {
    if (e.target.classList.contains('gt-btn-close')) {
      hidePopup();
      return;
    }
    if (e.target.classList.contains('gt-btn-save') && lastTranslation) {
      const btn = e.target;
      btn.disabled = true;
      btn.textContent = '...';
      try {
        const resp = await chrome.runtime.sendMessage({
          type: 'SAVE_WORD',
          word: {
            ...lastTranslation,
            targetLang: currentTargetLang,
            context: window.getSelection()?.toString().trim() ?? '',
            source: location.hostname
          }
        });
        if (resp?.ok) {
          btn.style.display = 'none';
          getEl('.gt-content').insertAdjacentHTML('beforeend',
            '<div class="gt-saved-badge">✓ Сохранено</div>');
        } else {
          btn.textContent = '✗ Ошибка';
          btn.disabled = false;
        }
      } catch {
        btn.textContent = '✗ Ошибка';
        btn.disabled = false;
      }
    }
  });
})();
