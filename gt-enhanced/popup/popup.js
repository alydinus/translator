// popup/popup.js
let lastResult = null;

async function send(message) {
  return chrome.runtime.sendMessage(message);
}

async function init() {
  await refreshAuth();
  await checkApiKey();
  await loadDictionaryCount();
  setupListeners();
}

async function refreshAuth() {
  const resp = await send({ type: 'GET_USER' });
  renderAuth(resp?.user ?? null);
}

function renderAuth(user) {
  const signin  = document.getElementById('btn-signin');
  const avatar  = document.getElementById('user-avatar');
  const signout = document.getElementById('btn-signout');

  if (user) {
    signin.classList.add('hidden');
    signout.classList.remove('hidden');
    if (user.photoURL) {
      avatar.src = user.photoURL;
      avatar.classList.remove('hidden');
    }
  } else {
    signin.classList.remove('hidden');
    avatar.classList.add('hidden');
    signout.classList.add('hidden');
  }
}

async function checkApiKey() {
  const { translationApiKey } = await chrome.storage.local.get('translationApiKey');
  const banner = document.getElementById('banner-no-key');
  if (!translationApiKey) {
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}

async function loadDictionaryCount() {
  const resp  = await send({ type: 'GET_WORDS' });
  const count = resp?.words?.length ?? 0;
  document.getElementById('btn-dictionary').textContent = `📖 Словарь (${count})`;
}

function setupListeners() {
  document.getElementById('btn-translate').addEventListener('click', doTranslate);

  document.getElementById('btn-swap').addEventListener('click', () => {
    const src = document.getElementById('select-source');
    const tgt = document.getElementById('select-target');
    if (src.value === 'auto') return;
    [src.value, tgt.value] = [tgt.value, src.value];
  });

  document.getElementById('btn-signin').addEventListener('click', async () => {
    const resp = await send({ type: 'SIGN_IN' });
    if (resp?.ok) {
      renderAuth(resp.user);
      await loadDictionaryCount();
    } else {
      alert('Ошибка входа: ' + (resp?.error ?? 'Неизвестная ошибка'));
    }
  });

  document.getElementById('btn-signout').addEventListener('click', async () => {
    await send({ type: 'SIGN_OUT' });
    renderAuth(null);
    await loadDictionaryCount();
  });

  document.getElementById('btn-save-result').addEventListener('click', async () => {
    if (!lastResult) return;
    const btn = document.getElementById('btn-save-result');
    btn.disabled = true;
    const resp = await send({ type: 'SAVE_WORD', word: lastResult });
    btn.textContent = resp?.ok ? '✓ Сохранено' : '✗ Ошибка';
    if (resp?.ok) await loadDictionaryCount();
  });

  document.getElementById('btn-dictionary').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('dictionary/dictionary.html') });
  });

  document.getElementById('btn-translate-page').addEventListener('click', async () => {
    const btn = document.getElementById('btn-translate-page');
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    btn.textContent = '⏳ Переводим...';
    btn.disabled = true;
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/content.js'] });
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => window.__gtTranslatePage?.()
      });
    } finally {
      btn.textContent = '🌐 Перевести страницу';
      btn.disabled = false;
    }
  });

  document.getElementById('btn-options').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  document.getElementById('btn-open-options').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  document.getElementById('input-text').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) doTranslate();
  });
}

async function doTranslate() {
  const text = document.getElementById('input-text').value.trim();
  if (!text) return;

  const targetLang  = document.getElementById('select-target').value;
  const btn         = document.getElementById('btn-translate');
  const resultArea  = document.getElementById('result-area');
  const resultText  = document.getElementById('result-text');

  btn.disabled = true;
  btn.textContent = 'Переводим...';
  resultArea.classList.add('hidden');

  const resp = await send({ type: 'TRANSLATE', text, targetLang });
  btn.disabled = false;
  btn.textContent = 'Перевести';

  if (resp?.ok) {
    lastResult = {
      original: text,
      translation: resp.translation,
      sourceLang: resp.detectedLanguage,
      targetLang
    };
    resultText.textContent = resp.translation;
    const saveBtn = document.getElementById('btn-save-result');
    saveBtn.textContent = '♡ В словарь';
    saveBtn.disabled = false;
    resultArea.classList.remove('hidden');
  } else {
    resultText.textContent = '⚠ ' + (resp?.error ?? 'Ошибка перевода');
    resultArea.classList.remove('hidden');
  }
}

init();
