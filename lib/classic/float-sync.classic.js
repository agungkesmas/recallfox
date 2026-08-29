// v3.22.5-firefox FIX-3b: IIFE idempoten — semua content script satu extension
// berbagi satu isolated world. Tanpa IIFE, const/function top-level dari
// bundle lain dengan nama sama (SESSION_KEY, loadSession, evaluate, dst)
// menyebabkan SyntaxError redeclarasi atau silent override lintas bundle.
(function () {
  if (globalThis.__RF_LIB_FLOATSYNC__) return; // idempoten: sudah pernah dimuat
// lib/float-sync.js — Cross-tab sync for floating note/tape (v3.21.16)
const NOTE_FLOAT_KEY = 'floatNoteState';
const TAPE_FLOAT_KEY = 'floatTapeState';

async function saveFloatState(kind, state) {
  const key = kind === 'tape' ? TAPE_FLOAT_KEY : NOTE_FLOAT_KEY;
  try { await browser.storage.local.set({ [key]: { ...state, kind, updatedAt: Date.now() } }); } catch(e){}
}
async function loadFloatState(kind) {
  const key = kind === 'tape' ? TAPE_FLOAT_KEY : NOTE_FLOAT_KEY;
  try { const r = await browser.storage.local.get([key]); return r[key] || null; } catch(e){ return null; }
}
async function clearFloatState(kind) {
  const key = kind === 'tape' ? TAPE_FLOAT_KEY : NOTE_FLOAT_KEY;
  try { await browser.storage.local.remove([key]); } catch(e){}
}
// legacy compat
const FLOAT_KEY = NOTE_FLOAT_KEY;

// v3.22.4: registrasi global untuk content script Firefox
globalThis.__RF_LIB_FLOATSYNC__ = { FLOAT_KEY, NOTE_FLOAT_KEY, TAPE_FLOAT_KEY, clearFloatState, loadFloatState, saveFloatState };
try { window.__RF_LIB_FLOATSYNC__ = globalThis.__RF_LIB_FLOATSYNC__; } catch (e) {}

})();
