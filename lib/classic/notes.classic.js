// v3.22.5-firefox FIX-3b: IIFE idempoten — semua content script satu extension
// berbagi satu isolated world. Tanpa IIFE, const/function top-level dari
// bundle lain dengan nama sama (SESSION_KEY, loadSession, evaluate, dst)
// menyebabkan SyntaxError redeclarasi atau silent override lintas bundle.
(function () {
  if (globalThis.__RF_LIB_NOTES__) return; // idempoten: sudah pernah dimuat
// lib/notes.js — RecallNote: floating note helpers (zero dependencies)
// Safe pure module — mirip lib/tape.js tapi untuk catatan bebas (markdown/plain)
function toPlainText(text) { return String(text || ''); }
function toMarkdown(text) { const s = String(text || '').trim(); if (!s) return ''; return s; }
const SESSION_KEY = 'notesSession';
const PIN_KEY = 'notesPin';
async function loadSession() {
  try { const r = await browser.storage.local.get([SESSION_KEY, PIN_KEY]); return { text: r[SESSION_KEY] || '', pinned: !!r[PIN_KEY] }; } catch (e) { return { text: '', pinned: false }; }
}
async function saveSession(text) { try { await browser.storage.local.set({ [SESSION_KEY]: text }); } catch (e) {} }
async function savePinState(pinned) { try { await browser.storage.local.set({ [PIN_KEY]: !!pinned }); } catch (e) {} }
function selfTest() { return { ok: true }; }

// v3.22.4: registrasi global untuk content script Firefox
globalThis.__RF_LIB_NOTES__ = { loadSession, savePinState, saveSession, selfTest, toMarkdown, toPlainText };
try { window.__RF_LIB_NOTES__ = globalThis.__RF_LIB_NOTES__; } catch (e) {}

})();
