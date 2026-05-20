// background/service-worker.js
// Uses Firebase REST API directly — no Firebase SDK (CDN imports blocked by MV3 CSP)
import { firebaseConfig } from '../firebase/firebase-config.js';

// ── Constants ─────────────────────────────────────────────────────────────────
const API_KEY       = firebaseConfig.apiKey;
const PROJECT_ID    = firebaseConfig.projectId;
const FS_BASE       = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const TOKEN_REFRESH = `https://securetoken.googleapis.com/v1/token?key=${API_KEY}`;
const SIGN_IN_URL   = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${API_KEY}`;

// ── Auth state ────────────────────────────────────────────────────────────────
// { uid, email, displayName, photoURL, idToken, refreshToken, expiresAt }
let currentUser = null;

(async () => {
  const { gtAuthUser } = await chrome.storage.local.get('gtAuthUser');
  if (gtAuthUser) { currentUser = gtAuthUser; await maybeRefreshToken(); }
})();

async function maybeRefreshToken() {
  if (!currentUser?.refreshToken) return;
  if (currentUser.expiresAt && Date.now() < currentUser.expiresAt - 60_000) return;
  const res = await fetch(TOKEN_REFRESH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(currentUser.refreshToken)}`
  });
  const d = await res.json();
  if (d.id_token) {
    currentUser.idToken      = d.id_token;
    currentUser.refreshToken = d.refresh_token;
    currentUser.expiresAt    = Date.now() + parseInt(d.expires_in, 10) * 1000;
    await chrome.storage.local.set({ gtAuthUser: currentUser });
  }
}

async function getIdToken() {
  await maybeRefreshToken();
  return currentUser?.idToken;
}

// ── Context menu ──────────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'translate-selection',
    title: 'Перевести "%s"',
    contexts: ['selection']
  });
  chrome.contextMenus.create({
    id: 'save-to-dictionary',
    title: 'Добавить "%s" в словарь',
    contexts: ['selection']
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const text = info.selectionText?.trim();
  if (!text) return;
  if (info.menuItemId === 'translate-selection') {
    const result = await translateText(text);
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (t, tr) => window.__gtShowToast?.(t, tr),
      args: [text, result.translation]
    });
  }
  if (info.menuItemId === 'save-to-dictionary') {
    const result = await translateText(text);
    await handleSaveWord({
      original: text,
      translation: result.translation,
      sourceLang: result.detectedLanguage,
      source: new URL(tab.url).hostname
    });
  }
});

// ── Message handler ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      switch (message.type) {
        case 'TRANSLATE': {
          const r = await translateText(message.text, message.targetLang);
          sendResponse({ ok: true, ...r });
          break;
        }
        case 'SAVE_WORD': {
          const r = await handleSaveWord(message.word);
          sendResponse({ ok: true, ...r });
          break;
        }
        case 'GET_USER':
          sendResponse({
            ok: true,
            user: currentUser
              ? { uid: currentUser.uid, email: currentUser.email,
                  displayName: currentUser.displayName, photoURL: currentUser.photoURL }
              : null
          });
          break;
        case 'SIGN_IN': {
          const u = await signInWithGoogle();
          sendResponse({ ok: true, user: { uid: u.uid, email: u.email,
            displayName: u.displayName, photoURL: u.photoURL } });
          break;
        }
        case 'SIGN_OUT':
          await signOutUser();
          sendResponse({ ok: true });
          break;
        case 'GET_WORDS':
          sendResponse({ ok: true, words: await getWords() });
          break;
        case 'DELETE_WORD':
          await deleteWord(message.wordId);
          sendResponse({ ok: true });
          break;
        default:
          sendResponse({ ok: false, error: 'Unknown message type' });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message });
    }
  })();
  return true; // keep channel open for async sendResponse
});

// ── Translation API ───────────────────────────────────────────────────────────
async function translateText(text, targetLang = 'ru') {
  const cacheKey = `${text}::${targetLang}`;
  const cached = await chrome.storage.session.get(cacheKey);
  if (cached[cacheKey]) return cached[cacheKey];

  const { translationApiKey } = await chrome.storage.local.get('translationApiKey');
  if (!translationApiKey) throw new Error('API ключ не настроен. Откройте Настройки.');

  const res = await fetch(
    `https://translation.googleapis.com/language/translate/v2?key=${translationApiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: text, target: targetLang, format: 'text' })
    }
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);

  const result = {
    translation: data.data.translations[0].translatedText,
    detectedLanguage: data.data.translations[0].detectedSourceLanguage || 'unknown'
  };
  await chrome.storage.session.set({ [cacheKey]: result });
  return result;
}

// ── Firestore REST helpers ────────────────────────────────────────────────────
function toFsValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string')  return { stringValue: v };
  if (typeof v === 'number')  return { integerValue: String(Math.round(v)) };
  if (typeof v === 'boolean') return { booleanValue: v };
  return { stringValue: String(v) };
}

function fromFsDoc(doc) {
  const result = { id: doc.name.split('/').pop() };
  for (const [k, v] of Object.entries(doc.fields ?? {})) {
    if      (v.stringValue   !== undefined) result[k] = v.stringValue;
    else if (v.integerValue  !== undefined) result[k] = parseInt(v.integerValue, 10);
    else if (v.booleanValue  !== undefined) result[k] = v.booleanValue;
    else if (v.timestampValue !== undefined) result[k] = new Date(v.timestampValue).getTime();
    else result[k] = null;
  }
  return result;
}

async function fsRequest(path, method = 'GET', body = null) {
  const idToken = await getIdToken();
  const res = await fetch(`${FS_BASE}/${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${idToken}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : null
  });
  if (method === 'DELETE') return null;
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data;
}

// ── Dictionary ────────────────────────────────────────────────────────────────
async function handleSaveWord(word) {
  if (currentUser) {
    const fields = {};
    for (const [k, v] of Object.entries(word)) fields[k] = toFsValue(v);
    fields.savedAt     = { integerValue: String(Date.now()) };
    fields.reviewCount = { integerValue: '0' };
    fields.lastReviewAt = { nullValue: null };
    const data = await fsRequest(
      `users/${currentUser.uid}/dictionary`,
      'POST',
      { fields }
    );
    return { id: data.name.split('/').pop(), synced: true };
  } else {
    const { localDictionary = [] } = await chrome.storage.local.get('localDictionary');
    const entry = { ...word, id: crypto.randomUUID(), savedAt: Date.now() };
    localDictionary.push(entry);
    await chrome.storage.local.set({ localDictionary });
    return { id: entry.id, synced: false };
  }
}

async function getWords() {
  if (currentUser) {
    const data = await fsRequest(
      `users/${currentUser.uid}/dictionary?orderBy=savedAt+desc&pageSize=200`
    );
    return (data.documents ?? []).map(fromFsDoc);
  } else {
    const { localDictionary = [] } = await chrome.storage.local.get('localDictionary');
    return [...localDictionary].sort((a, b) => b.savedAt - a.savedAt);
  }
}

async function deleteWord(wordId) {
  if (currentUser) {
    await fsRequest(`users/${currentUser.uid}/dictionary/${wordId}`, 'DELETE');
  } else {
    const { localDictionary = [] } = await chrome.storage.local.get('localDictionary');
    await chrome.storage.local.set({
      localDictionary: localDictionary.filter(w => w.id !== wordId)
    });
  }
}

// ── Google Sign-In via chrome.identity ───────────────────────────────────────
async function signInWithGoogle() {
  const manifest     = chrome.runtime.getManifest();
  const clientId     = manifest.oauth2.client_id;
  const redirectUri  = `https://${chrome.runtime.id}.chromiumapp.org`;

  const authUrl = new URL('https://accounts.google.com/o/oauth2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('response_type', 'token');
  authUrl.searchParams.set('scope', 'openid email profile');
  authUrl.searchParams.set('redirect_uri', redirectUri);

  const redirectUrl = await chrome.identity.launchWebAuthFlow({
    url: authUrl.toString(),
    interactive: true
  });

  const params      = new URLSearchParams(new URL(redirectUrl).hash.slice(1));
  const accessToken = params.get('access_token');
  if (!accessToken) throw new Error('No access_token in redirect URL');

  // Exchange Google access_token for Firebase id_token + refresh_token
  const res = await fetch(SIGN_IN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      postBody: `access_token=${encodeURIComponent(accessToken)}&providerId=google.com`,
      requestUri: redirectUri,
      returnIdpCredential: true,
      returnSecureToken: true
    })
  });
  const d = await res.json();
  if (d.error) throw new Error(d.error.message);

  currentUser = {
    uid: d.localId, email: d.email, displayName: d.displayName, photoURL: d.photoUrl,
    idToken: d.idToken, refreshToken: d.refreshToken,
    expiresAt: Date.now() + parseInt(d.expiresIn, 10) * 1000
  };
  await chrome.storage.local.set({ gtAuthUser: currentUser });
  return currentUser;
}

async function signOutUser() {
  currentUser = null;
  await chrome.storage.local.remove('gtAuthUser');
}
