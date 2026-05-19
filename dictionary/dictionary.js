// dictionary/dictionary.js
let allWords = [];
let deleteTarget = null;

async function send(msg) {
  return chrome.runtime.sendMessage(msg);
}

async function loadWords() {
  const resp = await send({ type: 'GET_WORDS' });
  allWords = resp?.words ?? [];
  document.getElementById('word-count').textContent = allWords.length;
  renderWords();
}

function renderWords() {
  const query = document.getElementById('search-input').value.trim().toLowerCase();
  const sort  = document.getElementById('sort-select').value;

  let words = query
    ? allWords.filter(w =>
        w.original?.toLowerCase().includes(query) ||
        w.translation?.toLowerCase().includes(query))
    : [...allWords];

  if (sort === 'date-asc')  words.sort((a, b) => a.savedAt - b.savedAt);
  else if (sort === 'date-desc') words.sort((a, b) => b.savedAt - a.savedAt);
  else if (sort === 'alpha') words.sort((a, b) =>
    (a.original ?? '').localeCompare(b.original ?? ''));

  const list = document.getElementById('word-list');
  if (!words.length) {
    list.innerHTML = `<div class="empty">${query ? 'Ничего не найдено' : 'Словарь пуст'}</div>`;
    return;
  }

  list.innerHTML = words.map(w => {
    const date = w.savedAt ? new Date(w.savedAt).toLocaleDateString('ru-RU') : '';
    const ctx  = w.context ? `<div class="word-context">${escHtml(w.context)}</div>` : '';
    return `
      <div class="word-card" data-id="${escAttr(w.id)}">
        <div class="word-info">
          <div class="word-original">${escHtml(w.original)}</div>
          <div class="word-translation">${escHtml(w.translation)}</div>
          <div class="word-meta">${escHtml(w.sourceLang?.toUpperCase() ?? '')} → ${escHtml(w.targetLang?.toUpperCase() ?? 'RU')} · ${escHtml(w.source ?? '')} · ${escHtml(date)}</div>
          ${ctx}
        </div>
        <button class="btn-delete" data-id="${escAttr(w.id)}" title="Удалить">🗑</button>
      </div>`;
  }).join('');
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escAttr(s) {
  return String(s ?? '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function exportCSV() {
  const header = 'original,translation,sourceLang,targetLang,source,savedAt,context\n';
  const rows = allWords.map(w =>
    [w.original, w.translation, w.sourceLang, w.targetLang, w.source,
      w.savedAt ? new Date(w.savedAt).toISOString() : '', w.context]
    .map(v => `"${String(v ?? '').replace(/"/g, '""')}"`)
    .join(',')
  );
  download('dictionary.csv', 'text/csv;charset=utf-8', '﻿' + header + rows.join('\n'));
}

function exportJSON() {
  download('dictionary.json', 'application/json', JSON.stringify(allWords, null, 2));
}

function download(filename, mime, content) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ── Event listeners ───────────────────────────────────────────────────────────
document.getElementById('search-input').addEventListener('input', renderWords);
document.getElementById('sort-select').addEventListener('change', renderWords);
document.getElementById('btn-export-csv').addEventListener('click', exportCSV);
document.getElementById('btn-export-json').addEventListener('click', exportJSON);

document.getElementById('word-list').addEventListener('click', (e) => {
  const btn = e.target.closest('.btn-delete');
  if (btn) {
    deleteTarget = btn.dataset.id;
    document.getElementById('confirm-modal').classList.remove('hidden');
  }
});

document.getElementById('modal-confirm').addEventListener('click', async () => {
  if (!deleteTarget) return;
  document.getElementById('modal-confirm').disabled = true;
  await send({ type: 'DELETE_WORD', wordId: deleteTarget });
  allWords = allWords.filter(w => w.id !== deleteTarget);
  deleteTarget = null;
  document.getElementById('confirm-modal').classList.add('hidden');
  document.getElementById('modal-confirm').disabled = false;
  document.getElementById('word-count').textContent = allWords.length;
  renderWords();
});

document.getElementById('modal-cancel').addEventListener('click', () => {
  deleteTarget = null;
  document.getElementById('confirm-modal').classList.add('hidden');
});

loadWords();
