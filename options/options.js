// options/options.js
(async () => {
  const { translationApiKey, targetLang = 'ru' } =
    await chrome.storage.local.get(['translationApiKey', 'targetLang']);

  if (translationApiKey) {
    document.getElementById('api-key').value = translationApiKey;
  }
  document.getElementById('default-lang').value = targetLang;

  function showStatus(id, message, durationMs = 2500) {
    const el = document.getElementById(id);
    el.textContent = message;
    setTimeout(() => { el.textContent = ''; }, durationMs);
  }

  document.getElementById('btn-save-key').addEventListener('click', async () => {
    const key = document.getElementById('api-key').value.trim();
    if (!key) {
      showStatus('status-key', '⚠ Введите API ключ');
      return;
    }
    await chrome.storage.local.set({ translationApiKey: key });
    showStatus('status-key', '✓ Ключ сохранён');
  });

  document.getElementById('btn-save-lang').addEventListener('click', async () => {
    const lang = document.getElementById('default-lang').value;
    await chrome.storage.local.set({ targetLang: lang });
    showStatus('status-lang', '✓ Сохранено');
  });
})();
