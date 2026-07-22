// popup/popup.js — RecallFox v3 task-based UI
// Wired to the new DOM structure but reuses the same backend lib functions.

import {
  getVault,
  addItem,
  updateItem,
  deleteItem,
  incrementUseCount,
  addBundle,
  updateBundle,
  reassignToBundle,
  deleteBundle,
  saveSettings,
  getNotes,
  addNote,
  updateNote,
  deleteNote,
  toggleNotePin,
  getNoteGroups
} from '../lib/storage.js';
import { searchItems, extractVariables, fillVariables } from '../lib/search.js';
import { AI_TOOLS, groupByRegion, matchCurrentTool, getEffectiveTools, getVisibleTools } from '../lib/ai-tools.js';
import { getAllToppings, buildFinalPrompt } from '../lib/toppings.js';
import { getNextPrayerIncludingSunnah, getLastPassedPrayer, getSunnahPrayers, formatCountdown, to12Hour } from '../lib/salahtime.js';
import { dbToPercent, percentToDb, formatPercent, MIN_DB, MAX_DB } from '../lib/volume.js';
import { getUpcomingFasts, formatHijriDate, parseHijriString, HIJRI_MONTHS, getSunnahFast } from '../lib/islamicCalendar.js';
import { getQuranStatus, getExerciseStatus, logQuranPages, logExerciseDone, snoozeExercise, getHabits } from '../lib/habits.js';
import { getUserBlocklist, addUserBlocklistEntry, removeUserBlocklistEntry } from '../lib/storage.js';
// v3.7: Import untuk halaman Backup & Tanya AI yang lebih kaya
import { getProviderList, getProviderInfo, chatWithFallback, isAssistantConfigured, buildSystemPrompt } from '../lib/assistant.js';
import { manualBackupWithTimestamp, getBackupMetadata, restoreFromFile } from '../lib/autobackup.js';
// v3.11.34: Shared clipboard format helper — supaya sidebar/batch/preview-modal
// semua pakai format yang sama persis.
import { buildScreenshotCaption, buildBatchCaption, writeScreenshotToClipboard, buildCompositeImage } from '../lib/copy-format.js';
// v3.4: Helper untuk hapus selector dari elementBlockerRules (per-domain picker list)
async function removeElementBlockerSelector(domain, selector) {
  try {
    const vault = await getVault();
    const rules = Array.isArray(vault.settings.elementBlockerRules) ? vault.settings.elementBlockerRules : [];
    const rule = rules.find(r => r.domain === domain);
    if (!rule) return { ok: false, error: 'rule_not_found' };
    rule.selectors = rule.selectors.filter(s => s !== selector);
    // Kalau selectors kosong dan rule ini bukan preset, hapus rule-nya
    if (rule.selectors.length === 0 && !rule.isPreset) {
      const idx = rules.indexOf(rule);
      if (idx >= 0) rules.splice(idx, 1);
    }
    await saveSettings({ elementBlockerRules: rules });
    // Broadcast update ke semua tab
    try {
      const tabs = await browser.tabs.query({});
      for (const t of tabs) {
        browser.tabs.sendMessage(t.id, { type: 'EB_RULES_UPDATED' }).catch(() => {});
      }
    } catch (e) {}
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
// v3.4: Toggle floating Guardian panel
async function setGuardianFloatingEnabled(enabled) {
  await saveSettings({ contentGuardShowFloating: !!enabled });
  // Broadcast ke semua tab supaya panel langsung update
  try {
    const tabs = await browser.tabs.query({});
    for (const t of tabs) {
      browser.tabs.sendMessage(t.id, { type: 'CG_SETTINGS_UPDATED' }).catch(() => {});
    }
  } catch (e) {}
}

// ============ State ============
let currentVault = null;
let currentNotes = [];
let currentChip = 'all';
let currentQuery = '';
let currentView = 'home';
let editingId = null;
let editingNoteId = null;
let pendingInjectItem = null;
let editorToppings = [];
let allToppingsCache = [];
let prayerPendingLocation = null;
let prayerGeocodeTimer = null;
let prayerTimesCache = null;
let noteSaveTimer = null;
let attachSelected = new Set();
// v3.7.2 (Issue 5): filter grup catatan aktif ('' = semua, atau nama grup spesifik)
let currentNoteGroup = '';

// ============ Helpers ============
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}
function escAttr(s) { return esc(s); }
function timeAgo(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60) return 'Baru saja';
  if (diff < 3600) return Math.floor(diff / 60) + ' menit lalu';
  if (diff < 86400) return Math.floor(diff / 3600) + ' jam lalu';
  if (diff < 86400 * 2) return 'Kemarin';
  return Math.floor(diff / 86400) + ' hari lalu';
}

// ============ Icons ============
const ICONS = {
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82A1.65 1.65 0 0 0 4.6 12H4a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 5.4 6.6l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H10a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  dots: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>',
  zap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  clipA: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.4 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.2-9.19a4 4 0 0 1 5.65 5.66l-9.2 9.19a2 2 0 0 1-2.82-2.83l8.49-8.48"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4h6l-1 7 4 3v2H6v-2l4-3z"/><path d="M12 16v5"/></svg>',
  mosque: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2c.6 1.8 2 3 3.5 3.6C17 6.2 18 7.4 18 9H6c0-1.6 1-2.8 2.5-3.4C10 5 11.4 3.8 12 2z"/><path d="M4 21v-8h16v8"/><path d="M2 21h20M10 21v-4a2 2 0 0 1 4 0v4"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>',
  moonstar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13A8 8 0 1 1 11 4a6.5 6.5 0 0 0 9 9z"/><path d="M18 2l.7 1.8L20.5 4.5l-1.8.7L18 7l-.7-1.8-1.8-.7 1.8-.7z"/></svg>',
  vol: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  eyeoff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="2" y1="2" x2="22" y2="22"/></svg>',
  spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z"/><path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/></svg>',
  archive: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5" rx="1"/><line x1="10" y1="12" x2="14" y2="12"/></svg>',
  kb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01M9 14h6"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>',
  // v3.11.7-fix (code quality): Tambah icon cloud untuk tool Sync Cloud (sebelumnya pakai fallback emoji)
  cloud: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>'
};

const TYPE = {
  prompt: { label: 'Prompt', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-3.5-.7L4 20l1-4.1A8.4 8.4 0 1 1 21 11.5z"/></svg>' },
  context: { label: 'Konteks', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>' },
  snapshot: { label: 'Snapshot', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-3.5-.7L4 20l1-4.1A8.4 8.4 0 1 1 21 11.5z"/><circle cx="12" cy="11.5" r="1"/><circle cx="16" cy="11.5" r="1"/><circle cx="8" cy="11.5" r="1"/></svg>' },
  screenshot: { label: 'Media', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>' },
  link: { label: 'Link', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>' },
  bundle: { label: 'Bundle', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3.3 8.3 12 13l8.7-4.7M12 22V13"/></svg>' }
};

// ============ Toast ============
function toast(msg, ok) {
  if (ok === undefined) ok = true;
  const t = document.createElement('div');
  t.className = 'toast' + (ok ? ' ok' : ' err');
  t.innerHTML = '<span class="tk">' + (ok ? ICONS.check : ICONS.trash) + '</span>' + esc(msg);
  $('#toasts').appendChild(t);
  setTimeout(function () { t.classList.add('out'); setTimeout(function () { t.remove(); }, 280); }, 1900);
}

// ============ Sheet / Page helpers ============
function openSheet(title, sub, build) {
  $('#sheetHd').innerHTML = '<div><div>' + title + '</div>' + (sub ? '<div class="sh-sub">' + sub + '</div>' : '') + '</div>';
  const b = $('#sheetBody'); b.innerHTML = ''; build(b);
  $('#scrim').classList.add('show'); $('#sheet').classList.add('show');
}
function closeSheet() { $('#scrim').classList.remove('show'); $('#sheet').classList.remove('show'); }
function openPage(title, foot) {
  $('#pageTitle').textContent = title;
  $('#pageSaveState').textContent = '';
  $('#pageFoot').style.display = foot ? 'flex' : 'none';
  $('#pageFoot').innerHTML = foot || '';
  // v3.11.36 (Sesi 2, Issue dari Google Doc): Set .page.top dinamis = bottom of strip,
  // supaya jadwal shalat (strip) tetap terlihat saat user di editor catatan / halaman alat.
  // User feedback: "saat edit atau tambah catatan... waktu shalat harus tetap keliatan ya.
  // karena saya sering seharian pake edit atau tambah catatan terbuka... buat nyatet waktu kerja."
  // Sebelumnya: .page top:0 (menutupi header+cmd+strip) → countdown shalat hilang.
  // Sekarang: .page top = posisi bottom strip relatif ke popup. Hitung via getBoundingClientRect
  // supaya adaptif terhadap tinggi header/cmd/strip yang bervariasi (cmd hanya di home view).
  try {
    const strip = document.querySelector('.strip');
    const popup = document.getElementById('popup');
    const page = document.getElementById('page');
    if (strip && popup && page) {
      const stripRect = strip.getBoundingClientRect();
      const popupRect = popup.getBoundingClientRect();
      const offset = Math.round(stripRect.bottom - popupRect.top);
      // Sanity check: offset harus masuk akal (50-200px). Kalau 0/negatif, fallback ke 95px.
      page.style.top = (offset > 0 && offset < 250) ? offset + 'px' : '95px';
    }
  } catch (e) {
    // Fallback: biarkan CSS default (95px)
    console.warn('[RecallFox] openPage: gagal hitung offset strip, pakai 95px', e.message);
  }
  $('#page').classList.add('in');
}
function closePage() { $('#page').classList.remove('in'); }

// ============ Theme ============
function applyTheme(theme) {
  let actual = theme;
  if (theme === 'auto') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    actual = prefersDark ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', actual);
  document.body.setAttribute('data-theme', actual);
  $('#themeBtn').innerHTML = actual === 'dark' ? ICONS.sun : ICONS.moon;
}
async function initTheme() {
  const vault = await getVault();
  applyTheme(vault.settings.theme || 'auto');
  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', async () => {
      const v = await getVault();
      if (v.settings.theme === 'auto' || !v.settings.theme) applyTheme('auto');
    });
  } catch (e) {}
}
async function toggleTheme() {
  const vault = await getVault();
  const currentActual = document.documentElement.getAttribute('data-theme') || 'light';
  const next = currentActual === 'dark' ? 'light' : 'dark';
  await saveSettings({ theme: next });
  applyTheme(next);
}

// ============ AI context detection ============
let currentAiDomain = null;
async function detectAiContext() {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab || !tab.url) return;
    const matched = matchCurrentTool(tab.url);
    if (matched) {
      currentAiDomain = matched;
      $('#ctxBadge').innerHTML = '<span class="dot"></span>' + matched.name + ' · siap sisip';
    } else {
      currentAiDomain = null;
      const count = currentVault?.items?.length || 0;
      $('#ctxBadge').innerHTML = '<span class="dot"></span>Vault · ' + count + ' item';
    }
  } catch (e) {}
}

// ============ Status strip ============
async function updatePrayerStrip() {
  const s = currentVault?.settings || {};
  const stripPrayer = $('#stripPrayer');
  const stripLoc = $('#stripLoc');

  if (!s.prayerEnabled || typeof s.prayerLatitude !== 'number') {
    stripPrayer.innerHTML = '🕌 <b>Setup shalat</b>';
    if (stripLoc) stripLoc.textContent = 'Waktu Shalat — belum diaktifkan';
    renderPrayerGrid(null);
    return;
  }

  let times = s.prayerCachedTimes;
  const today = new Date().toISOString().slice(0, 10);
  if (times && times.date && times.date !== today) times = null;

  if (!times || !times.timings) {
    stripPrayer.innerHTML = '🕌 <b>Memuat…</b>';
    try {
      const res = await browser.runtime.sendMessage({ type: 'PRAYER_FETCH' });
      if (res?.ok && res.times) {
        currentVault.settings.prayerCachedTimes = res.times;
        times = res.times;
      } else {
        stripPrayer.innerHTML = '🕌 <b>Gagal muat</b>';
        return;
      }
    } catch (e) {
      stripPrayer.innerHTML = '🕌 <b>Gagal muat</b>';
      return;
    }
  }

  prayerTimesCache = times;
  const next = getNextPrayerIncludingSunnah(times.timings);
  if (!next) { stripPrayer.innerHTML = '🕌 <b>—</b>'; return; }

  const fmt = s.prayerTimeFormat === '12h' ? to12Hour : (t) => t;
  const countdown = formatCountdown(next.minutesUntil);
  const dayLabel = next.isToday ? '' : ' (besok)';
  const sunnahBadge = next.isSunnah ? '🌟 ' : '';
  const color = next.minutesUntil <= 2 ? 'var(--danger)' : (next.minutesUntil < 10 ? 'var(--amber)' : 'var(--green)');

  stripPrayer.innerHTML = '🕌 <b>' + sunnahBadge + next.name + ' ' + fmt(next.time) + '</b> <span style="color:' + color + ';font-weight:600">−' + countdown + dayLabel + '</span>';
  if (stripLoc) stripLoc.textContent = 'Waktu Shalat · ' + (s.prayerLocation || 'Lokasi');

  renderPrayerGrid(times);
}

function renderPrayerGrid(times) {
  const grid = $('#prayGrid');
  if (!grid) return;
  if (!times || !times.timings) { grid.innerHTML = '<div style="font-size:11px;color:var(--muted);padding:8px 0">Aktifkan dari tab Alat → Waktu Shalat</div>'; return; }
  const s = currentVault?.settings || {};
  const fmt = s.prayerTimeFormat === '12h' ? to12Hour : (t) => t;
  const next = getNextPrayerIncludingSunnah(times.timings);
  const rows = [
    ['Subuh', times.timings.Fajr, 'Fajr'],
    ['Terbit', times.timings.Sunrise, 'Sunrise'],
    ['Dzuhur', times.timings.Dhuhr, 'Dhuhr'],
    ['Ashar', times.timings.Asr, 'Asr'],
    ['Magrib', times.timings.Maghrib, 'Maghrib'],
    ['Isya', times.timings.Isha, 'Isha']
  ];
  grid.innerHTML = rows.map(function (r) {
    const isNext = next && next.key === r[2];
    return '<div class="pray-cell' + (isNext ? ' next' : '') + '"><div class="n">' + r[0] + '</div><div class="t">' + fmt(r[1]) + '</div></div>';
  }).join('');
}

async function updateHabitsStrip() {
  const s = currentVault?.settings || {};
  const quranEl = $('#habitQuran');
  const gymEl = $('#habitGym');
  const stripQuran = $('#stripQuran');

  let qDone = false, eDone = false;
  let qCount = 0, eCount = 0;

  if (s.quranEnabled !== false) {
    try {
      const q = await getQuranStatus(s);
      qDone = q.isComplete; qCount = q.todayPages || 0;
    } catch (e) {}
  }
  if (s.exerciseEnabled !== false) {
    try {
      const ex = await getExerciseStatus(s);
      eDone = ex.todayCount > 0 && !ex.isDue; eCount = ex.todayCount || 0;
    } catch (e) {}
  }

  if (quranEl) {
    quranEl.classList.toggle('done', qDone);
    quranEl.innerHTML = '📖 Ngaji ' + (qDone ? '<span>✓ ' + qCount + ' hal</span>' : '<span>' + qCount + ' hal</span>');
  }
  if (gymEl) {
    gymEl.classList.toggle('done', eDone);
    gymEl.innerHTML = '🏃 Olahraga' + (eDone ? ' ✓' : '');
  }
  if (stripQuran) {
    const done = (qDone ? 1 : 0) + (eDone ? 1 : 0);
    const total = (s.quranEnabled !== false ? 1 : 0) + (s.exerciseEnabled !== false ? 1 : 0);
    stripQuran.textContent = done + '/' + (total || 2);
  }

  // v3.11.5 (Issue 2): Render pintasan web ngaji & olahraga
  renderShortcuts('quranShortcutsRow', s.quranShortcuts, '📖');
  renderShortcuts('exerciseShortcutsRow', s.exerciseShortcuts, '🏃');
}

// v3.11.5 (Issue 2): Render pintasan web di strip-detail
// Container: #quranShortcutsRow or #exerciseShortcutsRow
// Shortcuts: array of { name, url, emoji } — maksimal 6
function renderShortcuts(containerId, shortcuts, defaultEmoji) {
  const container = $('#' + containerId);
  if (!container) return;
  if (!Array.isArray(shortcuts) || shortcuts.length === 0) {
    container.innerHTML = '';
    container.style.display = 'none';
    return;
  }
  container.style.display = '';
  const list = shortcuts.slice(0, 6);  // maksimal 6 pintasan
  container.innerHTML = list.map((sc, i) => {
    const emoji = sc.emoji || defaultEmoji;
    const name = esc(sc.name || 'Web');
    const url = esc(sc.url || '#');
    return '<button class="shortcut-btn" data-url="' + url + '" title="' + esc(sc.name || '') + ' — ' + url + '">'
      + '<span class="shortcut-ic">' + emoji + '</span>'
      + '<span class="shortcut-name">' + name + '</span>'
      + '</button>';
  }).join('');
  container.querySelectorAll('.shortcut-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const url = btn.dataset.url;
      if (!url || url === '#') return;
      try {
        await browser.tabs.create({ url });
        toast('🌐 Membuka ' + (btn.querySelector('.shortcut-name')?.textContent || 'web'));
      } catch (err) {
        toast('Gagal buka: ' + err.message, false);
      }
    });
  });
}

async function updateFastStrip() {
  const fastEl = $('#stripFast');
  const fastNote = $('#fastNote');
  try {
    const cachedHijri = currentVault?.settings?.prayerCachedTimes?.hijri;
    const hijriToday = cachedHijri ? parseHijriString(cachedHijri) : null;
    if (!hijriToday) {
      if (fastEl) fastEl.innerHTML = '🌙 <b>—</b>';
      if (fastNote) fastNote.textContent = '🌙 Aktifkan Waktu Shalat untuk lihat jadwal puasa.';
      return;
    }
    const fasts = getUpcomingFasts(hijriToday, new Date(), 14);
    if (fasts && fasts.length > 0) {
      const f = fasts[0];
      const label = f.name || 'Puasa sunnah';
      const days = f.daysAhead;
      const dayStr = days === 0 ? 'hari ini' : (days === 1 ? 'besok' : days + ' hari lagi');
      if (fastEl) fastEl.innerHTML = '🌙 <b>' + label + '</b>';
      if (fastNote) fastNote.innerHTML = '🌙 Puasa sunnah berikutnya: <b>' + esc(label) + '</b> (' + dayStr + ')';
    } else {
      if (fastEl) fastEl.innerHTML = '🌙 <b>—</b>';
      if (fastNote) fastNote.textContent = '🌙 Tidak ada puasa sunnah dalam 14 hari ke depan.';
    }
  } catch (e) {
    if (fastEl) fastEl.innerHTML = '🌙 <b>—</b>';
    if (fastNote) fastNote.textContent = '🌙 Memuat jadwal puasa…';
  }
}

// ============ Vault rendering ============
function getVaultItems() {
  if (!currentVault) return [];
  const items = currentVault.items || [];
  const bundles = (currentVault.bundles || []).map(b => ({
    id: b.id, type: 'bundle', title: b.name || 'Bundle', tags: ['bundle'],
    uses: b.useCount || 0, _bundle: b
  }));
  return [...items, ...bundles];
}

// v3.7.2 (Issue 1): tambah chip "Arsip" untuk lihat item yang diarsipkan.
const CHIPS = [['all', 'Semua'], ['prompt', 'Prompt'], ['context', 'Konteks'], ['snapshot', 'Snapshot'], ['screenshot', 'Media'], ['link', 'Link'], ['bundle', 'Bundle'], ['archive', 'Arsip']];
function chipCount(c) {
  const items = getVaultItems();
  if (c === 'all') {
    // Hitung item non-archived + bundle non-archived
    return items.filter(i => !i.archived && !(i._bundle && i._bundle.archived)).length;
  }
  if (c === 'archive') {
    return items.filter(i => i.archived || (i._bundle && i._bundle.archived)).length;
  }
  return items.filter(i => i.type === c && !i.archived).length;
}
function renderChips() {
  const items = getVaultItems();
  // v3.9.0 (Issue 6): tambah data-cat untuk styling ribbon warna per kategori
  $('#chips').innerHTML = CHIPS.map(function (c) {
    const n = chipCount(c[0]);
    if (c[0] !== 'all' && c[0] !== 'archive' && n === 0) return '';
    return '<button class="chip' + (currentChip === c[0] ? ' on' : '') + '" data-chip="' + c[0] + '" data-cat="' + c[0] + '">' + c[1] + '<span class="n">' + n + '</span></button>';
  }).join('');
  $$('#chips .chip').forEach(ch => ch.addEventListener('click', () => { currentChip = ch.dataset.chip; updateBatchModeBtnVisibility(); renderVault(); }));
  const visibleItemsForMeta = items.filter(i => !i.archived && !(i._bundle && i._bundle.archived));
  const favs = visibleItemsForMeta.filter(i => i.favorite).length;
  const uses = visibleItemsForMeta.reduce((a, b) => a + (b.useCount || b.uses || 0), 0);
  $('#vaultMeta').textContent = visibleItemsForMeta.length + ' item · ★ ' + favs + ' · ↑ ' + uses;
  if (!currentAiDomain) $('#ctxBadge').innerHTML = '<span class="dot"></span>Vault · ' + visibleItemsForMeta.length + ' item';
}

// v3.7.2 (Issue 4): Searchable text untuk satu item — gabungan field yang relevan.
// Termasuk screenshot source.url, source.title, linkUrl, dan bundle item titles.
// v3.10.2 (Issue 4 fix): Lebih komprehensif — tambah screenshotMode, fileName,
//   gdriveFileUrl, bundle note titles/bodies (noteIds), inlinePrompt, nama bundle,
//   dll. Memastikan user bisa cari "github" di link apapun, cari teks di catatan
//   bundle, cari nama bundle, dst. Sesuai catatan Issue #4: harus bisa cari teks
//   di Prompt, Konteks, Link, Bundle, Snapshot, Shot, sampai arsip.
function searchableTextFor(it) {
  if (!it) return '';
  const parts = [it.title || '', it.type || ''];
  if (Array.isArray(it.tags)) parts.push(it.tags.join(' '));
  if (it.body) parts.push(it.body);
  if (it.linkUrl) parts.push(it.linkUrl);
  if (it.linkTitle) parts.push(it.linkTitle);
  if (it.category) parts.push(it.category);
  // v3.7.2 (Issue 4): screenshot metadata
  if (it.source) {
    if (it.source.url) parts.push(it.source.url);
    if (it.source.title) parts.push(it.source.title);
    if (it.source.domain) parts.push(it.source.domain);
  }
  // v3.10.2 (Issue 4 fix): Field tambahan untuk screenshot — mode, gdrive link
  if (it.screenshotMode) parts.push(it.screenshotMode);
  if (it.gdriveFileUrl) parts.push(it.gdriveFileUrl);
  if (it.gdriveFileId) parts.push(it.gdriveFileId);
  // v3.10.2 (Issue 4 fix): Snapshot metadata
  if (it.snapshotDomain) parts.push(it.snapshotDomain);
  if (it.snapshotMessageCount) parts.push(String(it.snapshotMessageCount));
  // v3.7.2 (Issue 4): bundle — sertakan judul semua item anggota
  if (it._bundle) {
    const bd = it._bundle;
    if (bd.name) parts.push(bd.name);
    if (bd.note) parts.push(bd.note);
    if (bd.inlinePrompt) parts.push(bd.inlinePrompt);
    const memberTitles = (bd.injectOrder || bd.itemIds || [])
      .map(iid => currentVault.items.find(i => i.id === iid))
      .filter(Boolean)
      .map(i => i.title || '');
    parts.push(memberTitles.join(' '));
    // v3.10.2 (Issue 4 fix): Sertakan juga body item anggota (bukan cuma title)
    // sehingga user bisa cari teks di dalam item bundle.
    const memberBodies = (bd.injectOrder || bd.itemIds || [])
      .map(iid => currentVault.items.find(i => i.id === iid))
      .filter(Boolean)
      .map(i => (i.body || '') + ' ' + (i.linkUrl || '') + ' ' + (i.linkTitle || ''));
    parts.push(memberBodies.join(' '));
    // v3.10.2 (Issue 4 fix): Sertakan juga title + body catatan bundle (noteIds)
    const noteIds = Array.isArray(bd.noteIds) ? bd.noteIds : [];
    const noteTexts = noteIds
      .map(nid => currentNotes.find(n => n.id === nid))
      .filter(Boolean)
      .map(n => (n.title || '') + ' ' + (n.body || ''));
    parts.push(noteTexts.join(' '));
  }
  return parts.join(' ').toLowerCase();
}

// ============================================================================
// v3.11.11 (Issue #1): Batch mode untuk screenshot — select multiple + copy sekaligus
// User feedback: "saya kan sedang sering melakukan beberapa kali screnshot dan paste
// dalam keseharian bekerja. apakah bisa dipilih beberapa di menu ini dan kopinya sekalian
// baik gambar maupun keterangannya sekaligus? tapi kamu pikirkan formatnya yang sangat
// rapih sehingga ketika dipaste tu orang atau ai bacanya ngerti."
// ============================================================================
// v3.11.14 (Sesi terakhir): Generalisasi batch mode — support SEMUA tipe item
// (prompt, context, link, bundle, snapshot, screenshot, archive).
// User feedback: "toggle batch itu sudah ada di batch select media. tinggal tiru aja.
// selarasin di menu lainnya juga misal prompt, link, bundle dan arsip"
// ============================================================================
let vaultBatchMode = false;
const vaultBatchSelected = new Set();

// v3.11.14: Chip yang support batch mode (semua chip kecuali 'all')
// v3.11.15: Sekarang chip 'all' JUGA support batch — user bisa pilih multiple item
// dari berbagai tipe sekaligus. Tombol yang tampil disesuaikan dengan tipe item terpilih.
const BATCH_SUPPORTED_CHIPS = new Set(['all', 'prompt', 'context', 'link', 'bundle', 'snapshot', 'screenshot', 'archive']);

function updateBatchModeBtnVisibility() {
  // v3.11.14: Tombol batch tampil untuk SEMUA chip yang support batch (bukan hanya screenshot)
  // v3.11.15: Sekarang juga tampil di chip 'all'
  const btn = $('#batchModeBtn');
  if (!btn) return;
  const supported = BATCH_SUPPORTED_CHIPS.has(currentChip);
  btn.style.display = supported ? '' : 'none';
  // Update title sesuai chip aktif
  const chipLabel = CHIPS.find(c => c[0] === currentChip)?.[1] || 'item';
  btn.title = 'Mode batch: pilih multiple ' + chipLabel.toLowerCase() + ' untuk aksi sekaligus';
  // Kalau keluar dari chip yang support batch saat batch mode aktif, exit otomatis
  if (!supported && vaultBatchMode) {
    exitVaultBatchMode();
  }
  // v3.11.14: Update tombol-tombol di batch bar sesuai chip aktif
  updateVaultBatchBarButtons();
}

// v3.11.14: Tampilkan/sembunyikan tombol di vaultBatchBar sesuai chip aktif.
// - Screenshot: Copy + Keterangan, Copy Gambar Saja, Hapus
// - Prompt/Context/Link/Snapshot: Copy Teks, Hapus
// - Bundle: Copy Bundle, Hapus
// - Archive: Unarsip, Hapus permanen
// v3.11.15: Di chip 'all', tampilkan tombol berdasarkan TIPE ITEM yang terpilih.
// Jika multiple tipe terpilih, tampilkan semua tombol yang relevant.
function updateVaultBatchBarButtons() {
  const bar = $('#vaultBatchBar');
  if (!bar) return;
  const copyCaptionBtn = $('#vaultBatchCopy');        // Copy + Keterangan (screenshot only)
  const copyImgBtn = $('#vaultBatchCopyImg');         // Copy Gambar Saja (screenshot only)
  const copyMetaBtn = $('#vaultBatchCopyMeta');       // Copy Teks Saja (screenshot only, text-only)
  const copyTextBtn = $('#vaultBatchCopyText');       // Copy Teks (prompt/context/link/snapshot)
  const copyBundleBtn = $('#vaultBatchCopyBundle');   // Copy Bundle (bundle only)
  const unarchiveBtn = $('#vaultBatchUnarchive');     // Unarsip (archive only)
  const deleteBtn = $('#vaultBatchDelete');           // Hapus (semua)

  // Reset semua
  [copyCaptionBtn, copyImgBtn, copyMetaBtn, copyTextBtn, copyBundleBtn, unarchiveBtn, deleteBtn].forEach(b => {
    if (b) b.style.display = 'none';
  });

  // v3.11.15: Di chip 'all', tentukan tipe item yang terpilih
  let selectedTypes = new Set();
  if (currentChip === 'all' && vaultBatchSelected.size > 0) {
    for (const id of vaultBatchSelected) {
      const item = currentVault?.items?.find(i => i.id === id);
      if (item) selectedTypes.add(item.type);
      // Cek juga bundle
      const bundle = currentVault?.bundles?.find(b => b.id === id);
      if (bundle) selectedTypes.add('bundle');
    }
  } else {
    selectedTypes.add(currentChip === 'archive' ? 'archive' : currentChip);
  }

  // Tentukan tombol yang tampil berdasarkan tipe terpilih
  const hasScreenshot = selectedTypes.has('screenshot');
  const hasBundle = selectedTypes.has('bundle');
  const hasArchive = selectedTypes.has('archive');
  const hasText = ['prompt', 'context', 'link', 'snapshot'].some(t => selectedTypes.has(t));

  if (currentChip === 'archive' || hasArchive) {
    if (unarchiveBtn) unarchiveBtn.style.display = '';
  }
  if (hasScreenshot) {
    if (copyCaptionBtn) copyCaptionBtn.style.display = '';
    if (copyImgBtn) copyImgBtn.style.display = '';
    if (copyMetaBtn) copyMetaBtn.style.display = '';
  }
  if (hasBundle) {
    if (copyBundleBtn) copyBundleBtn.style.display = '';
  }
  if (hasText) {
    if (copyTextBtn) copyTextBtn.style.display = '';
  }
  // Hapus selalu tampil (untuk semua tipe)
  if (deleteBtn) deleteBtn.style.display = '';

  // Update tombol delete label untuk archive
  if (deleteBtn) {
    if (currentChip === 'archive') {
      deleteBtn.textContent = '🗑️ Hapus Permanen';
      deleteBtn.title = 'Hapus permanen item terpilih dari vault';
    } else {
      deleteBtn.textContent = '🗑️ Hapus';
      deleteBtn.title = 'Hapus item terpilih dari vault';
    }
  }
}

function toggleVaultBatchMode() {
  vaultBatchMode = !vaultBatchMode;
  vaultBatchSelected.clear();
  const bar = $('#vaultBatchBar');
  if (bar) bar.style.display = vaultBatchMode ? 'flex' : 'none';
  if (!vaultBatchMode) {
    document.querySelectorAll('.vault-batch-check').forEach(c => c.checked = false);
  }
  renderList();
  updateVaultBatchCount();
  const chipLabel = CHIPS.find(c => c[0] === currentChip)?.[1] || 'item';
  toast(vaultBatchMode ? '☑️ Mode batch aktif — klik ' + chipLabel.toLowerCase() + ' untuk pilih' : 'Mode batch dimatikan');
}

function exitVaultBatchMode() {
  if (!vaultBatchMode) return;
  toggleVaultBatchMode();
}

function updateVaultBatchCount() {
  const countEl = $('#vaultBatchCount');
  if (countEl) countEl.textContent = vaultBatchSelected.size + ' dipilih';
  // v3.11.15: Update tombol batch bar setelah count berubah — penting untuk chip 'all'
  // dimana tombol yang tampil tergantung tipe item terpilih.
  try { updateVaultBatchBarButtons(); } catch (e) {}
}

// v3.11.14: Helper — dapatkan label tipe untuk pesan toast/dialog
function _batchItemTypeLabel() {
  const chipLabel = CHIPS.find(c => c[0] === currentChip)?.[1] || 'item';
  return chipLabel.toLowerCase();
}

// v3.11.14: Copy text untuk prompt/context/link/snapshot — format rapi
// Sama seperti injectBundle tapi untuk multiple item, dipisah ---
async function vaultBatchCopyTextAction() {
  if (vaultBatchSelected.size === 0) {
    toast('Pilih minimal 1 item dulu');
    return;
  }
  const ids = Array.from(vaultBatchSelected);
  const items = ids.map(id => currentVault.items.find(i => i.id === id)).filter(Boolean);
  if (items.length === 0) {
    toast('Tidak ada item valid terpilih', false);
    return;
  }
  toast('📋 Menyalin ' + items.length + ' item...');
  const parts = items.map(it => {
    const T = TYPE[it.type] || { label: it.type };
    const header = '## ' + (it.title || it.type) + ' [' + T.label + ']';
    if (it.type === 'link') return header + '\n' + (it.linkUrl || it.body || '');
    return header + '\n' + (it.body || '');
  });
  const fullText = parts.join('\n\n---\n\n');
  try {
    await navigator.clipboard.writeText(fullText);
    toast('✓ ' + items.length + ' item tersalin ke clipboard');
  } catch (e) {
    try {
      await browser.runtime.sendMessage({ type: 'COPY_TO_CLIPBOARD', text: fullText });
      toast('✓ ' + items.length + ' item tersalin ke clipboard');
    } catch (e2) {
      toast('⚠ Gagal menyalin: ' + e2.message, false);
    }
  }
}

// v3.11.36 (Sesi 2, Issue dari Google Doc): Batch copy TEKS METADATA saja (tanpa gambar)
// untuk multiple screenshot. Format = buildBatchCaption.textPlain (sudah ada di copy-format.js).
// User feedback: paste gambar+teks bersamaan tidak reliable → text-only lebih universal.
// Tidak fetch blob gambar → cepat, bisa untuk ratusan screenshot.
async function vaultBatchCopyMetaAction() {
  if (vaultBatchSelected.size === 0) {
    toast('Pilih minimal 1 screenshot dulu');
    return;
  }
  const ids = Array.from(vaultBatchSelected);
  const items = ids.map(id => currentVault.items.find(i => i.id === id))
    .filter(i => i && i.type === 'screenshot');
  if (items.length === 0) {
    toast('Tidak ada screenshot valid terpilih', false);
    return;
  }
  toast('📝 Menyalin teks metadata ' + items.length + ' screenshot...');
  // dataUrl = null → textPlain tetap lengkap (📸, Sumber, Waktu, Mode, 📝 Catatan)
  const screenshots = items.map(item => ({ item, dataUrl: null }));
  const cap = buildBatchCaption(screenshots);
  if (!cap.textPlain) { toast('Tidak ada metadata untuk disalin', false); return; }
  try {
    await navigator.clipboard.writeText(cap.textPlain);
    toast('✓ Teks metadata ' + items.length + ' screenshot tersalin (paste ke WA/Gemini/AI chat)');
  } catch (e) {
    console.warn('[RecallFox] vaultBatchCopyMetaAction failed:', e.message);
    try {
      // Fallback: delegate ke background (utk konteks tanpa clipboard permission)
      await browser.runtime.sendMessage({ type: 'COPY_TO_CLIPBOARD', text: cap.textPlain });
      toast('✓ Teks metadata ' + items.length + ' screenshot tersalin');
    } catch (e2) {
      toast('⚠ Gagal menyalin: ' + e2.message, false);
    }
  }
}

// v3.11.14: Copy bundle — gabungkan semua bundle terpilih jadi 1 teks
async function vaultBatchCopyBundleAction() {
  if (vaultBatchSelected.size === 0) {
    toast('Pilih minimal 1 bundle dulu');
    return;
  }
  const ids = Array.from(vaultBatchSelected);
  const bundles = ids.map(id => currentVault.bundles.find(b => b.id === id)).filter(Boolean);
  if (bundles.length === 0) {
    toast('Tidak ada bundle valid terpilih', false);
    return;
  }
  toast('📋 Menyalin ' + bundles.length + ' bundle...');
  const parts = bundles.map(bundle => {
    const items = (bundle.injectOrder || bundle.itemIds || [])
      .map(iid => currentVault.items.find(i => i.id === iid))
      .filter(Boolean);
    const noteIds = Array.isArray(bundle.noteIds) ? bundle.noteIds : [];
    const notes = noteIds.map(nid => currentNotes.find(n => n.id === nid)).filter(Boolean);
    const sections = [];
    sections.push('# 📦 Bundle: ' + (bundle.name || 'Bundle tanpa nama'));
    if (bundle.inlinePrompt && bundle.inlinePrompt.trim()) {
      sections.push('## Prompt Cepat [Prompt]\n' + bundle.inlinePrompt.trim());
    }
    for (const i of items) {
      const T = TYPE[i.type] || { label: i.type };
      const header = '## ' + (i.title || i.type) + ' [' + T.label + ']';
      if (i.type === 'link') sections.push(header + '\n' + (i.linkUrl || i.body || ''));
      else sections.push(header + '\n' + (i.body || ''));
    }
    for (const n of notes) {
      sections.push('## ' + (n.title || 'Catatan') + ' [Catatan]\n' + (n.body || ''));
    }
    return sections.join('\n\n');
  });
  const fullText = parts.join('\n\n---\n\n');
  try {
    await navigator.clipboard.writeText(fullText);
    toast('✓ ' + bundles.length + ' bundle tersalin ke clipboard');
  } catch (e) {
    try {
      await browser.runtime.sendMessage({ type: 'COPY_TO_CLIPBOARD', text: fullText });
      toast('✓ ' + bundles.length + ' bundle tersalin ke clipboard');
    } catch (e2) {
      toast('⚠ Gagal menyalin: ' + e2.message, false);
    }
  }
}

// v3.11.14: Unarsip — keluarkan item dari arsip (untuk chip 'archive')
async function vaultBatchUnarchiveAction() {
  if (vaultBatchSelected.size === 0) {
    toast('Pilih minimal 1 item dulu');
    return;
  }
  const ids = Array.from(vaultBatchSelected);
  const typeLabel = _batchItemTypeLabel();
  if (!confirm('Keluarkan ' + ids.length + ' ' + typeLabel + ' dari arsip?')) return;
  toast('📦 Mengeluarkan ' + ids.length + ' ' + typeLabel + ' dari arsip...');
  let ok = 0, fail = 0;
  for (const id of ids) {
    try {
      // Cek apakah id adalah item atau bundle
      const item = currentVault.items.find(i => i.id === id);
      const bundle = currentVault.bundles.find(b => b.id === id);
      if (item) {
        await updateItem(id, { archived: false });
        ok++;
      } else if (bundle) {
        await updateBundle(id, { archived: false });
        ok++;
      } else {
        fail++;
      }
    } catch (e) {
      console.warn('Unarsip failed for', id, e.message);
      fail++;
    }
  }
  vaultBatchSelected.clear();
  vaultBatchMode = false;
  const bar = $('#vaultBatchBar');
  if (bar) bar.style.display = 'none';
  await refreshVault();
  renderList();
  toast('✓ ' + ok + ' item dikeluarkan dari arsip' + (fail > 0 ? ' (' + fail + ' gagal)' : ''));
}

async function vaultBatchCopyAction(withCaption) {
  if (vaultBatchSelected.size === 0) {
    toast('Pilih minimal 1 screenshot dulu');
    return;
  }
  const ids = Array.from(vaultBatchSelected);
  toast(withCaption ? '📋 Menyalin ' + ids.length + ' screenshot + keterangan...' : '🖼️ Menyalin ' + ids.length + ' gambar...');

  // v3.11.34: Lakukan clipboard.write LANGSUNG di popup context (bukan delegate
  // ke background → inject ke active tab yang sering gagal).
  // Format SAMA PERSIS dengan preview modal — via lib/copy-format.js.
  try {
    // Kumpulkan screenshot + dataUrl
    const screenshots = [];
    for (const id of ids) {
      const item = currentVault.items.find(i => i.id === id);
      if (!item || item.type !== 'screenshot') continue;
      let dataUrl = null;
      try {
        const res = await browser.runtime.sendMessage({ type: 'GET_SCREENSHOT_BLOB', id });
        if (res?.ok && res.dataUrl) dataUrl = res.dataUrl;
      } catch (e) {}
      screenshots.push({ item, dataUrl });
    }
    if (screenshots.length === 0) {
      toast('Tidak ada screenshot valid terpilih', false);
      return;
    }

    // v3.11.38: Limit max 9 gambar per batch (3x3 grid)
    if (screenshots.length > 9) {
      toast('Maksimal 9 gambar per batch. Pilih ≤ 9 screenshot.', false);
      return;
    }

    // v3.11.38: Build composite image (grid + numbering) untuk batch
    // 1 gambar = original (tanpa label), 2+ gambar = composite grid + nomor
    let compositeBlob = null;
    let compositeDataUrl = null;
    if (screenshots.length === 1) {
      // Single screenshot — pakai original dataUrl (tanpa label)
      compositeDataUrl = screenshots[0]?.dataUrl || null;
    } else {
      // Multiple screenshots — build composite grid image
      toast('🔨 Membuat gambar gabungan ' + screenshots.length + ' screenshot...');
      const compositeResult = await buildCompositeImage(screenshots);
      if (compositeResult.blob) {
        compositeBlob = compositeResult.blob;
        // Convert blob ke dataUrl untuk writeScreenshotToClipboard
        compositeDataUrl = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(compositeResult.blob);
        });
      }
    }

    if (withCaption) {
      // Build batch caption (format sama dengan preview modal, dengan numbering 1, 2, 3...)
      const cap = buildBatchCaption(screenshots);
      // v3.11.38: Pakai composite image (bukan screenshots[0] saja)
      const result = await writeScreenshotToClipboard(
        compositeDataUrl,
        cap.textPlain,
        cap.textHtml
      );
      if (result.ok) {
        const label = screenshots.length > 1
          ? '✓ ' + screenshots.length + ' gambar digabung jadi 1 — paste ke Google Docs/Gmail/WhatsApp'
          : (result.message || ('✓ 1 screenshot tersalin'));
        toast(label);
      } else {
        // Fallback: text-only
        try {
          await navigator.clipboard.writeText(cap.textPlain);
          toast('✓ ' + screenshots.length + ' screenshot tersalin (text-only — gambar tidak ikut)');
        } catch (e2) {
          toast('Gagal copy: ' + e2.message, false);
        }
      }
    } else {
      // Image only — v3.11.38: pakai composite image (bukan screenshot pertama saja)
      if (!compositeDataUrl) {
        toast('Gambar tidak ditemukan', false);
        return;
      }
      if (screenshots.length === 1) {
        // Single — copy original tanpa label
        const result = await writeScreenshotToClipboard(compositeDataUrl, '', '');
        if (result.ok) {
          toast(result.message || '✓ Gambar tersalin');
        } else {
          toast('Gagal copy gambar: ' + (result.error || ''), false);
        }
      } else {
        // Multiple — copy composite PNG blob langsung
        if (compositeBlob && typeof ClipboardItem !== 'undefined') {
          try {
            const item = new ClipboardItem({ 'image/png': compositeBlob });
            await navigator.clipboard.write([item]);
            toast('✓ ' + screenshots.length + ' gambar digabung jadi 1 — paste ke Google Docs/Gmail/WhatsApp');
          } catch (e) {
            console.warn('[RecallFox] Composite clipboard write failed:', e.message);
            // Fallback: pakai compositeDataUrl via writeScreenshotToClipboard
            const result = await writeScreenshotToClipboard(compositeDataUrl, '', '');
            if (result.ok) {
              toast('✓ ' + screenshots.length + ' gambar gabungan tersalin');
            } else {
              toast('Gagal copy gambar: ' + (result.error || ''), false);
            }
          }
        } else {
          // Fallback: pakai writeScreenshotToClipboard
          const result = await writeScreenshotToClipboard(compositeDataUrl, '', '');
          if (result.ok) {
            toast('✓ ' + screenshots.length + ' gambar gabungan tersalin');
          } else {
            toast('Gagal copy gambar: ' + (result.error || ''), false);
          }
        }
      }
    }
  } catch (e) {
    console.warn('[RecallFox] Batch copy exception:', e.message);
    toast('Error: ' + e.message, false);
  }
}

// v3.11.25 (Sesi 15): Fallback copy text-only di popup context (tidak butuh tab aktif).
// Copy markdown rapi dengan metadata screenshot. Tidak ada gambar (hanya teks).
// User feedback: "kenapa fungsi batch kopi ini jadi tidak aktif? tolong perbaiki
// tanpa merusak yang sudah ada."
async function _vaultBatchCopyTextFallback(ids, withCaption) {
  const items = ids.map(id => currentVault.items.find(i => i.id === id)).filter(i => i && i.type === 'screenshot');
  if (items.length === 0) {
    toast('Tidak ada screenshot valid terpilih', false);
    return;
  }
  const now = new Date();
  const dateStr = now.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
  const parts = [
    '# Screenshot Bundle — RecallFox',
    'Tanggal: ' + dateStr + ' · Total: ' + items.length + ' screenshot',
    ''
  ];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const pageTitle = item.source?.title || item.title || 'screenshot';
    const pageUrl = item.source?.url || '';
    const capturedAt = item.source?.capturedAt || item.createdAt || now.toISOString();
    const modeLabel = item.screenshotMode === 'visible' ? 'Viewport' : (item.screenshotMode === 'selection' ? 'Area' : (item.screenshotMode === 'entire' ? 'Seluruh halaman' : '-'));
    const dims = (item.screenshotWidth || 0) + '×' + (item.screenshotHeight || 0) + ' px';
    const tags = Array.isArray(item.tags) ? item.tags.join(', ') : (item.tags || '');
    const capturedDate = new Date(capturedAt).toLocaleString('id-ID', { dateStyle: 'full', timeStyle: 'short' });
    const num = i + 1;
    parts.push('## ' + num + '. ' + pageTitle);
    if (pageUrl) parts.push('**Sumber:** ' + pageUrl);
    parts.push('**Waktu:** ' + capturedDate);
    parts.push('**Mode:** ' + modeLabel + ' · ' + dims);
    if (tags) parts.push('**Tag:** ' + tags);
    // v3.11.25 (Sesi 15, Issue #3): Tampilkan annotation note kalau ada
    if (item.annotationNote) parts.push('**Catatan Anotasi:** ' + item.annotationNote);
    parts.push('');
    parts.push('[📸 Gambar ' + num + ' — ' + dims + ']');
    parts.push('');
    if (i < items.length - 1) parts.push('---');
  }
  const fullText = parts.join('\n');
  try {
    await navigator.clipboard.writeText(fullText);
    toast('✓ ' + items.length + ' screenshot tersalin (text-only fallback — gambar tidak ikut)');
  } catch (e) {
    toast('⚠ Gagal copy: ' + e.message + '. Coba buka halaman web http(s) dulu, lalu klik copy lagi.', false);
  }
}

// v3.11.13 (Sesi 12): Batch delete screenshot — bersih-bersih vault gampang.
// v3.11.14: Generalisasi untuk SEMUA tipe item (prompt, link, bundle, archive, dll).
// User feedback Sesi 12: "sudah bagus fitur batch nya harusnya ada batch delete juga,
// jadi bersih bersihnya gampang. apakah bisa ditambahkan?"
async function vaultBatchDeleteAction() {
  if (vaultBatchSelected.size === 0) {
    toast('Pilih minimal 1 item dulu');
    return;
  }
  const ids = Array.from(vaultBatchSelected);
  const typeLabel = _batchItemTypeLabel();
  // Konfirmasi supaya tidak salah hapus
  const isArchive = currentChip === 'archive';
  const confirmMsg = isArchive
    ? 'Hapus ' + ids.length + ' ' + typeLabel + ' permanen dari vault?\n\nItem di arsip akan dihapus permanen. Tidak bisa di-undo.'
    : 'Hapus ' + ids.length + ' ' + typeLabel + ' dari vault?\n\nItem akan dihapus permanen. Tidak bisa di-undo.';
  if (!confirm(confirmMsg)) {
    return;
  }
  toast('🗑️ Menghapus ' + ids.length + ' ' + typeLabel + '...');
  try {
    const res = await browser.runtime.sendMessage({
      type: 'DELETE_ITEMS_BATCH',
      ids
    });
    if (res?.ok) {
      toast('✓ ' + (res.deleted || ids.length) + ' ' + typeLabel + ' dihapus' + (res.failed ? ' (' + res.failed + ' gagal)' : ''));
      vaultBatchSelected.clear();
      vaultBatchMode = false;
      const bar = $('#vaultBatchBar');
      if (bar) bar.style.display = 'none';
      await refreshVault();
      // Re-render supaya checkbox hilang
      renderList();
    } else {
      toast('Gagal: ' + (res?.error || 'unknown'), false);
    }
  } catch (e) {
    toast('Error: ' + e.message, false);
  }
}

function visibleItems() {
  const items = getVaultItems();
  // v3.7.2 (Issue 1): chip 'archive' menampilkan hanya item yang diarsipkan.
  // Chip 'all' dan tipe lain menyembunyikan item yang diarsipkan.
  let vi;
  if (currentChip === 'archive') {
    vi = items.filter(i => i.archived || (i._bundle && i._bundle.archived));
  } else if (currentChip === 'all') {
    vi = items.filter(i => !i.archived && !(i._bundle && i._bundle.archived));
  } else {
    vi = items.filter(i => i.type === currentChip && !i.archived);
  }
  if (currentQuery && !currentQuery.startsWith('>')) {
    const q = currentQuery.toLowerCase();
    vi = vi.filter(i => searchableTextFor(i).indexOf(q) >= 0);
  }
  return vi;
}
function renderList() {
  const list = $('#list');
  if (currentQuery && !currentQuery.startsWith('>')) {
    list.style.display = 'none';
    return;
  }
  list.style.display = '';
  const vi = visibleItems();
  if (!vi.length) {
    list.innerHTML = '<div class="empty"><div class="big">🦊</div>Tidak ada item di filter ini.<br><span style="font-size:11px">Blok teks di halaman → klik kanan → Simpan ke RecallFox.</span></div>';
    return;
  }
  list.innerHTML = vi.map(function (it) {
    const T = TYPE[it.type] || { label: it.type, icon: '' };
    const tagsStr = Array.isArray(it.tags) ? it.tags.join(', ') : (it.tags || '');
    const vars = it.body ? extractVariables(it.body).length : 0;
    const fav = it.favorite ? '<span class="fav">★</span>' : '';
    // v3.7.2 (Issue 1): indikator arsip
    const arch = it.archived ? '<span class="fav" title="Diarsipkan" style="color:var(--muted)">📦</span>' : '';
    const uses = it.useCount || it.uses || 0;
    // v3.7.1-FIX: Untuk Link: 3 tombol (Salin, Buka, Sisipkan).
    // Untuk Bundle: 2 tombol (Salin, Sisipkan jika AI).
    // Untuk Screenshot: 2 tombol (Lihat, Download).
    // Untuk tipe lain: CTA pill tunggal.
    let ctaHtml = '';
    if (it.type === 'link') {
      ctaHtml =
        '<span class="cta-pill" data-link-action="copy">' + ICONS.copy + 'Salin ↵</span>'
        + '<button class="link-mini-btn" data-link-action="open" title="Buka link di tab baru">' + ICONS.spark + '</button>'
        + (currentAiDomain ? '<button class="link-mini-btn" data-link-action="inject" title="Sisipkan URL ke chat AI">' + ICONS.zap + '</button>' : '');
    } else if (it.type === 'bundle') {
      ctaHtml =
        '<span class="cta-pill" data-bundle-action="copy">' + ICONS.copy + 'Salin ↵</span>'
        + (currentAiDomain ? '<button class="link-mini-btn" data-bundle-action="inject" title="Sisipkan semua item ke chat AI">' + ICONS.zap + '</button>' : '');
    } else if (it.type === 'screenshot') {
      ctaHtml =
        '<span class="cta-pill" data-shot-action="view">' + ICONS.image + 'Lihat ↵</span>'
        + '<button class="link-mini-btn" data-shot-action="download" title="Download gambar">' + ICONS.download + '</button>';
    } else {
      const cta = currentAiDomain ? ICONS.zap + 'Sisipkan ↵' : ICONS.copy + 'Salin ↵';
      ctaHtml = '<span class="cta-pill">' + cta + '</span>';
    }
    // v3.11.11 (Issue #1): Tambah checkbox batch mode kalau batch mode aktif + item=screenshot
    // v3.11.14: Generalisasi — checkbox muncul untuk SEMUA tipe item saat batch mode aktif.
    // Termasuk prompt, context, link, bundle, snapshot, screenshot, dan archive.
    let batchCheckboxHtml = '';
    if (vaultBatchMode) {
      const checked = vaultBatchSelected.has(it.id) ? ' checked' : '';
      batchCheckboxHtml = '<input type="checkbox" class="vault-batch-check" data-id="' + it.id + '"' + checked + ' style="width:16px;height:16px;cursor:pointer;accent-color:var(--primary);flex-shrink:0;margin-right:4px">';
    }
    return '<div class="item" data-id="' + it.id + '" tabindex="0">'
      + batchCheckboxHtml
      + '<div class="item-ic t-' + it.type + '">' + T.icon + '</div>'
      + '<div class="item-main">'
      + '<div class="item-title">' + fav + arch + esc(it.title) + (vars ? ' <span title="' + vars + ' variabel" style="font-size:10px">⚙️</span>' : '') + '</div>'
      + '<div class="item-meta">' + T.label + ' · ' + esc(tagsStr) + (uses ? ' · <span class="uses">' + uses + '× dipakai</span>' : '') + '</div>'
      + '</div>'
      + '<div class="item-cta">'
      + ctaHtml
      + '<button class="morebtn" data-more="' + it.id + '" title="Aksi lainnya">' + ICONS.dots + '</button>'
      + '</div></div>';
  }).join('');
  bindItemClicks();
  // v3.11.11 (Issue #1) + v3.11.12 (Sesi 11, Issue #2): Bind batch checkbox handlers.
  // V3.11.12: HANYA bind change handler untuk checkbox itself.
  // Click handler untuk toggle via item body dipindah ke bindItemClicks (return early
  // kalau batch mode aktif) — supaya tidak double-trigger dengan primaryAction (buka viewer).
  if (vaultBatchMode) {
    document.querySelectorAll('.vault-batch-check').forEach(cb => {
      cb.addEventListener('change', (e) => {
        e.stopPropagation();
        const id = cb.dataset.id;
        if (cb.checked) vaultBatchSelected.add(id);
        else vaultBatchSelected.delete(id);
        updateVaultBatchCount();
      });
      // Click di checkbox jangan propagate ke item (supaya tidak trigger primaryAction)
      cb.addEventListener('click', (e) => {
        e.stopPropagation();
      });
    });
  }
}
function bindItemClicks() {
  $$('#list .item').forEach(el => {
    el.addEventListener('click', e => {
      // v3.11.12 (Sesi 11, Issue #2): Fix klik checkbox malah buka gambar viewer.
      // User feedback: "ketika klik centang untuk memilih daftar gambar, eh malah
      // buka gambarnya jg jadinya kebanyakan tab."
      // Root cause: bindItemClicks punya click handler yang buka screenshot viewer.
      // Saya tambah click handler untuk toggle checkbox. Karena kedua handler di elemen
      // yang sama, klik item = toggle checkbox DAN buka viewer.
      // Fix: kalau batch mode aktif, return early — biar handler checkbox (di renderList)
      // yang handle. Click di luar checkbox saat batch mode = tidak buka viewer.
      if (vaultBatchMode) {
        // Cek apakah yang diklik adalah checkbox atau tombol aksi (data-* action)
        // Kalau ya, biar handler masing-masing yang handle (stopPropagation sudah ada)
        // Kalau bukan, return early — tidak buka viewer saat batch mode aktif
        const isActionBtn = e.target.closest('[data-link-action],[data-bundle-action],[data-shot-action],.morebtn,.vault-batch-check');
        if (!isActionBtn) {
          // Klik di area item (bukan tombol aksi) — toggle checkbox kalau ada
          const cb = el.querySelector('.vault-batch-check');
          if (cb) {
            cb.checked = !cb.checked;
            if (cb.checked) vaultBatchSelected.add(cb.dataset.id);
            else vaultBatchSelected.delete(cb.dataset.id);
            updateVaultBatchCount();
          }
          return; // JANGAN buka viewer
        }
        // Kalau klik tombol aksi, biar handler di bawah yang handle
      }
      // v3.6: Cek apakah user klik tombol aksi Link khusus (data-link-action)
      const linkBtn = e.target.closest('[data-link-action]');
      if (linkBtn) {
        e.stopPropagation();
        const action = linkBtn.dataset.linkAction;
        const it = findItem(el.dataset.id);
        if (!it) return;
        if (action === 'copy') copyLinkToClipboard(it);
        else if (action === 'open') openLinkInNewTab(it);
        else if (action === 'inject') injectLinkToChat(it);
        return;
      }
      // v3.7.1-FIX: Tombol aksi Bundle (data-bundle-action)
      const bundleBtn = e.target.closest('[data-bundle-action]');
      if (bundleBtn) {
        e.stopPropagation();
        const action = bundleBtn.dataset.bundleAction;
        const it = findItem(el.dataset.id);
        if (!it) return;
        if (action === 'copy') { injectBundle(it.id); return; }
        else if (action === 'inject') {
          // Sisipkan semua teks item bundle ke chat AI
          // v3.10.2 (Issue 3 + 5 fix): Sertakan juga catatan (bundle.noteIds)
          // dan inline prompt — sebelumnya hanya item teks.
          const bundle = currentVault.bundles.find(b => b.id === it.id);
          if (bundle) {
            const items = (bundle.injectOrder || bundle.itemIds || []).map(iid => currentVault.items.find(i => i.id === iid)).filter(Boolean);
            const textItems = items.filter(i => i.type !== 'link');
            const noteIds = Array.isArray(bundle.noteIds) ? bundle.noteIds : [];
            const notes = noteIds.map(nid => currentNotes.find(n => n.id === nid)).filter(Boolean);
            const parts = [];
            // Inline prompt di awal kalau ada
            if (bundle.inlinePrompt && bundle.inlinePrompt.trim()) {
              parts.push('## ' + (bundle.name || 'Prompt Cepat') + ' [Prompt]\n' + bundle.inlinePrompt.trim());
            }
            for (const i of textItems) {
              parts.push('## ' + (i.title || i.type) + '\n' + (i.body || ''));
            }
            for (const n of notes) {
              parts.push('## ' + (n.title || 'Catatan') + ' [Catatan]\n' + (n.body || ''));
            }
            if (parts.length > 0) {
              const text = parts.join('\n\n---\n\n');
              doInject(text, it.id);
            } else { toast('Bundle tidak punya item teks/catatan', false); }
          }
          return;
        }
      }
      // v3.7.1-FIX: Tombol aksi Screenshot (data-shot-action)
      const shotBtn = e.target.closest('[data-shot-action]');
      if (shotBtn) {
        e.stopPropagation();
        const action = shotBtn.dataset.shotAction;
        const it = findItem(el.dataset.id);
        if (!it) return;
        if (action === 'view') openScreenshotViewer(it.id);
        else if (action === 'download') downloadScreenshot(it.id);
        return;
      }
      if (e.target.closest('.morebtn')) return;
      primaryAction(el.dataset.id);
    });
    el.addEventListener('keydown', e => { if (e.key === 'Enter') primaryAction(el.dataset.id); });
  });
  $$('#list .morebtn').forEach(b => {
    b.addEventListener('click', e => { e.stopPropagation(); itemSheet(b.dataset.more); });
  });
}
function findItem(id) {
  const items = getVaultItems();
  return items.find(i => String(i.id) === String(id));
}
async function primaryAction(id) {
  const it = findItem(id);
  if (!it) return;
  if (it.type === 'link') {
    // v3.6: Tombol "Salin" untuk Link harus SALIN URL, bukan buka link.
    // Untuk buka link, sediakan tombol terpisah "Buka" (openLinkInNewTab).
    await copyLinkToClipboard(it);
    return;
  }
  if (it.type === 'bundle') {
    await injectBundle(it.id);
    return;
  }
  if (it.type === 'screenshot') {
    openScreenshotViewer(it.id);
    return;
  }
  // prompt / context / snapshot
  const vars = extractVariables(it.body || '');
  const finalBody = await buildFinalPrompt(it.body || '', it.toppings || []);
  if (vars.length > 0) {
    pendingInjectItem = { ...it, body: finalBody };
    openVarsModal(vars);
  } else {
    await doInject(finalBody, it.id);
  }
}

// v3.6: Helper untuk salin URL Link ke clipboard (bukan buka link)
async function copyLinkToClipboard(it) {
  if (!it) return;
  const url = it.linkUrl || it.body || '';
  if (!url) { toast('Link ini tidak punya URL', false); return; }
  try {
    await navigator.clipboard.writeText(url);
    await incrementUseCount(it.id);
    toast('📋 URL disalin: ' + url.slice(0, 40) + (url.length > 40 ? '…' : ''));
  } catch (e) {
    // Fallback: pakai background script
    try {
      await browser.runtime.sendMessage({ type: 'COPY_TO_CLIPBOARD', text: url });
      await incrementUseCount(it.id);
      toast('📋 URL disalin');
    } catch (e2) {
      toast('⚠ Gagal salin: ' + e2.message, false);
    }
  }
}

// v3.6: Helper untuk buka link di tab baru
async function openLinkInNewTab(it) {
  if (!it) return;
  const url = it.linkUrl || it.body || '';
  if (!url) { toast('Link ini tidak punya URL', false); return; }
  try {
    await browser.tabs.create({ url });
    await incrementUseCount(it.id);
    toast('🔗 Membuka ' + (it.title || url).slice(0, 30) + '…');
  } catch (e) {
    toast('⚠ Gagal buka: ' + e.message, false);
  }
}

// v3.6: Helper untuk inject URL Link ke chat AI aktif
async function injectLinkToChat(it) {
  if (!it) return;
  const url = it.linkUrl || it.body || '';
  if (!url) { toast('Link ini tidak punya URL', false); return; }
  // Bangun teks yang akan di-inject: judul + URL
  const title = it.title || '';
  const injectText = title ? (title + '\n' + url) : url;
  // Pakai doInject yang sudah ada — sama seperti prompt/context
  await doInject(injectText, it.id);
}
async function doInject(body, itemId) {
  const settings = currentVault?.settings || {};
  const mode = settings.injectMode || 'append';
  try {
    const res = await browser.runtime.sendMessage({ type: 'INJECT_TO_ACTIVE_TAB', text: body, mode });
    if (itemId) await incrementUseCount(itemId);
    if (res?.ok) {
      toast('⚡ Disisipkan' + (currentAiDomain ? ' ke ' + currentAiDomain.name : ''));
      if (!document.body.classList.contains('rf-sidebar-body')) setTimeout(() => window.close(), 700);
    } else {
      // v3.7.1-FIX: Benar-benar salin ke clipboard, bukan cuma pesan toast
      try {
        await navigator.clipboard.writeText(body);
        toast('📋 Disalin ke clipboard');
      } catch (clipErr) {
        try {
          await browser.runtime.sendMessage({ type: 'COPY_TO_CLIPBOARD', text: body });
          toast('📋 Disalin ke clipboard');
        } catch (e2) {
          toast('⚠ Gagal menyisipkan dan menyalin', false);
        }
      }
      if (!document.body.classList.contains('rf-sidebar-body')) setTimeout(() => window.close(), 900);
    }
  } catch (e) {
    // v3.7.1-FIX: Saat inject gagal total, fallback ke clipboard
    try {
      await navigator.clipboard.writeText(body);
      if (itemId) await incrementUseCount(itemId);
      toast('📋 Disalin ke clipboard');
    } catch (clipErr) {
      try {
        await browser.runtime.sendMessage({ type: 'COPY_TO_CLIPBOARD', text: body });
        if (itemId) await incrementUseCount(itemId);
        toast('📋 Disalin ke clipboard');
      } catch (e2) {
        if (itemId) await incrementUseCount(itemId);
        toast('⚠ Gagal: ' + e.message, false);
      }
    }
  }
  await refreshVault();
}
async function injectBundle(id) {
  const bundle = currentVault.bundles.find(b => b.id === id);
  if (!bundle) return;
  const items = (bundle.injectOrder || bundle.itemIds || []).map(iid => currentVault.items.find(i => i.id === iid)).filter(Boolean);
  // v3.10.2 (Issue 3 + 5 fix): Sertakan catatan yang tercentang (bundle.noteIds)
  // ke teks bundle saat disalin/disisipkan — sebelumnya noteIds diabaikan.
  const noteIds = Array.isArray(bundle.noteIds) ? bundle.noteIds : [];
  const notes = noteIds.map(nid => currentNotes.find(n => n.id === nid)).filter(Boolean);
  if (items.length === 0 && notes.length === 0) { toast('Bundle kosong', false); return; }
  // v3.7.1-FIX: Bundle sekarang salin semua konten ke clipboard, bukan buka link di tab baru
  const allParts = items.map(i => {
    const header = '## ' + (i.title || i.type) + ' [' + (TYPE[i.type]?.label || i.type) + ']';
    if (i.type === 'link') return header + '\n' + (i.linkUrl || i.body || '');
    return header + '\n' + (i.body || '');
  });
  // v3.10.2 (Issue 3 + 5 fix): Tambahkan catatan sebagai section terpisah
  for (const n of notes) {
    const noteTitle = n.title || 'Catatan';
    allParts.push('## ' + noteTitle + ' [Catatan]\n' + (n.body || ''));
  }
  // v3.10.2 (Issue 3 + 5 fix): Tambahkan inline prompt kalau ada
  if (bundle.inlinePrompt && bundle.inlinePrompt.trim()) {
    allParts.unshift('## ' + (bundle.inlinePromptItemId ? (bundle.name || 'Prompt Inline') : 'Prompt Cepat') + ' [Prompt]\n' + bundle.inlinePrompt.trim());
  }
  const fullText = allParts.join('\n\n---\n\n');
  try {
    await navigator.clipboard.writeText(fullText);
    for (const i of items) await incrementUseCount(i.id);
    toast('📋 Bundle disalin ke clipboard (' + (items.length + notes.length) + ' anggota)');
  } catch (e) {
    try {
      await browser.runtime.sendMessage({ type: 'COPY_TO_CLIPBOARD', text: fullText });
      for (const i of items) await incrementUseCount(i.id);
      toast('📋 Bundle disalin ke clipboard (' + (items.length + notes.length) + ' anggota)');
    } catch (e2) {
      toast('⚠ Gagal menyalin bundle', false);
    }
  }
  if (!document.body.classList.contains('rf-sidebar-body')) setTimeout(() => window.close(), 700);
}
function openScreenshotViewer(id) {
  browser.runtime.sendMessage({ type: 'GET_SCREENSHOT_BLOB', id }).then(res => {
    if (res?.ok && res.dataUrl) {
      const w = window.open('');
      if (w) {
        const item = currentVault.items.find(i => i.id === id);
        w.document.write('<!DOCTYPE html><title>' + esc(item?.title || 'Screenshot') + '</title><body style="margin:0;background:#0c0a09;display:flex;align-items:center;justify-content:center;min-height:100vh;"><img src="' + res.dataUrl + '" style="max-width:100%;max-height:100vh;" /></body>');
      }
    } else {
      toast('Gagal memuat gambar', false);
    }
  });
}

// v3.11.25 (Sesi 15, Issue #3): Sheet untuk edit catatan anotasi screenshot.
// User feedback: "tolong di bagian kotak merah itu ditambahkan catatan untuk
// menjelaskan anotasi yang sudah dibuatnya. jadi ketika dipaste tu hasilnya
// sudah ada kterangannya apa yang di anotasi."
function openAnnotationNoteSheet(id) {
  const it = currentVault.items.find(i => i.id === id);
  if (!it) { toast('Item tidak ditemukan', false); return; }
  openSheet('📝 Catatan Anotasi', 'Tulis penjelasan anotasi — ikut saat copy screenshot', b => {
    b.innerHTML = '<div class="sheet-form">'
      + '<div class="hintbox" style="font-size:11px;line-height:1.55">Catatan ini akan ikut saat Anda copy screenshot (tunggal maupun batch). Format: <b>**Catatan Anotasi:**</b> teks Anda. Cocok untuk menjelaskan panah, kotak, atau text yang sudah Anda tambahkan di anotasi.</div>'
      + '<div><label>Judul Screenshot</label><input class="f" value="' + esc(it.title || '') + '" readonly style="background:var(--surface-2)"></div>'
      + '<div><label>Catatan Anotasi <span class="field-hint">(opsional — kosongkan untuk hapus)</span></label>'
      +   '<textarea class="f" id="annotNote" rows="5" placeholder="mis. Panah merah menunjukkan tombol login yang error. Kotak kuning menunjukkan pesan error 500.">'
      + esc(it.annotationNote || '')
      + '</textarea></div>'
      + '<div class="btn-row"><button class="btn btn-g" id="annotCancel">Batal</button>'
      +   '<button class="btn btn-p" id="annotSave">' + ICONS.check + 'Simpan</button></div></div>';
    b.querySelector('#annotCancel').addEventListener('click', closeSheet);
    b.querySelector('#annotSave').addEventListener('click', async () => {
      const note = b.querySelector('#annotNote').value.trim();
      await updateItem(id, { annotationNote: note || undefined });
      closeSheet();
      await refreshVault();
      toast(note ? '✓ Catatan anotasi disimpan' : '✓ Catatan anotasi dihapus');
    });
  });
}
function renderVault() { renderChips(); renderList(); }

// ============ Item sheet (⋯ menu) ============
function itemSheet(id) {
  const it = findItem(id);
  if (!it) return;
  const T = TYPE[it.type] || { label: it.type };
  const vars = it.body ? extractVariables(it.body).length : 0;
  openSheet(esc(it.title), T.label + (vars ? ' · ' + vars + ' variabel' : ''), b => {
    const isAi = !!currentAiDomain;
    const primaryLabel = it.type === 'link' ? 'Buka link di tab baru' : (it.type === 'bundle' ? 'Salin bundle ke clipboard' : (it.type === 'screenshot' ? 'Lihat screenshot' : (isAi ? 'Sisipkan ke chat' : 'Salin ke clipboard')));
    const primaryIcon = it.type === 'link' ? ICONS.spark : (it.type === 'bundle' ? ICONS.archive : (isAi ? ICONS.zap : ICONS.copy));
    b.innerHTML =
      '<button class="act" data-a="primary">' + primaryIcon + '<div>' + primaryLabel + '<div class="ad">Sama dengan klik baris — 1 klik</div></div></button>'
      + (it.type === 'prompt' || it.type === 'context' ? '<button class="act" data-a="attach">' + ICONS.clipA + '<div>Sisipkan dengan lampiran<div class="ad">Prompt + link referensi sekaligus</div></div></button>' : '')
      + '<button class="act" data-a="edit">' + ICONS.edit + '<div>Edit judul, isi, tag…</div></button>'
      + '<button class="act" data-a="fav">' + ICONS.star + '<div>' + (it.favorite ? 'Hapus dari favorit' : 'Jadikan favorit') + '</div></button>'
      // v3.7.2 (Issue 1): Arsipkan / Unarsipkan — item tetap tersimpan, hanya disembunyikan dari list default.
      + (it.type !== 'bundle' ? '<button class="act" data-a="archive">' + ICONS.archive + '<div>' + (it.archived ? 'Keluarkan dari arsip' : 'Arsipkan item') + '<div class="ad">Disembunyikan dari list utama tanpa dihapus</div></div></button>' : '')
      // v3.7.2 (Issue 1): Tambah/Pindah ke Bundle — assign ulang screenshot/prompt/dll ke bundle lain.
      + (it.type !== 'bundle' ? '<button class="act" data-a="bundle">' + ICONS.clipA + '<div>Tambah / pindah ke Bundle<div class="ad">Reassign item ke sesi troubleshooting lain</div></div></button>' : '<button class="act" data-a="editbundle">' + ICONS.edit + '<div>Edit bundle<div class="ad">Ubah nama, tambah / hapus anggota</div></div></button>')
      + (it.type === 'screenshot' ? '<button class="act" data-a="dl">' + ICONS.download + '<div>Download gambar</div></button>' : '')
      // v3.11.6 (Issue 1 dari Google Doc): Tombol Salin Gambar & Salin + Keterangan
      // untuk item screenshot di Vault. Sebelumnya cuma ada "Lihat" dan "Download".
      // User bilang: "masih lihat dan download bukan seperti ini baik ikon maupun fungsinya"
      + (it.type === 'screenshot' ? '<button class="act" data-a="copy-img">' + ICONS.copy + '<div>📋 Salin Gambar<div class="ad">Salin gambar saja ke clipboard</div></div></button>' : '')
      + (it.type === 'screenshot' ? '<button class="act" data-a="copy-bundle">' + ICONS.clipA + '<div>📦 Salin + Keterangan<div class="ad">Gambar + URL, judul, waktu, mode</div></div></button>' : '')
      // v3.11.36 (Sesi 2, Issue dari Google Doc): Tombol Salin Teks Metadata (text-only)
      // User feedback: "di chat ai maupun wa, paste itu kadang gambarnya doang, teksnya ga
      // ngikut, atau sebaliknya di gemini teks nya doang gambarnya ga ngikut. oleh karena
      // itu tolong tambahkan kopi teks metadatanya doang bisa?"
      // Solusi: navigator.clipboard.writeText(textPlain) — text-only, paste ke mana saja.
      + (it.type === 'screenshot' ? '<button class="act" data-a="copy-meta">' + ICONS.copy + '<div>📝 Salin Teks Metadata<div class="ad">Teks saja (URL, judul, waktu) — paste ke WA/Gemini/AI chat</div></div></button>' : '')
      // v3.11.25 (Sesi 15, Issue #3): Tambah catatan anotasi untuk screenshot
      + (it.type === 'screenshot' ? '<button class="act" data-a="annot-note">' + ICONS.edit + '<div>📝 Catatan Anotasi<div class="ad">Tulis penjelasan anotasi — ikut saat copy</div></div></button>' : '')
      + '<button class="act danger" data-a="del">' + ICONS.trash + '<div>Hapus item</div></button>';
    b.querySelectorAll('.act').forEach(a => a.addEventListener('click', () => {
      const k = a.dataset.a;
      if (k === 'primary') { closeSheet(); primaryAction(it.id); }
      else if (k === 'attach') { closeSheet(); openAttachModal(it.id); }
      else if (k === 'edit') { closeSheet(); openEditorSheet(it.id); }
      else if (k === 'editbundle') { closeSheet(); openBundleEditorSheet(it.id); }
      else if (k === 'fav') { toggleFav(it.id).then(() => { closeSheet(); toast(it.favorite ? '★ Dihapus dari favorit' : '★ Jadikan favorit'); }); }
      else if (k === 'archive') { toggleArchive(it.id).then(() => { closeSheet(); toast(it.archived ? '📦 Dikeluarkan dari arsip' : '📦 Diarsipkan'); }); }
      else if (k === 'bundle') { closeSheet(); openReassignBundleSheet(it.id); }
      else if (k === 'dl') { closeSheet(); downloadScreenshot(it.id); }
      // v3.11.6: Handler Salin Gambar & Salin + Keterangan untuk item screenshot
      else if (k === 'copy-img') { closeSheet(); copyScreenshotToClipboard(it.id, false); }
      else if (k === 'copy-bundle') { closeSheet(); copyScreenshotToClipboard(it.id, true); }
      // v3.11.36: Handler Salin Teks Metadata (text-only, no image)
      else if (k === 'copy-meta') { closeSheet(); copyScreenshotMetaToClipboard(it.id); }
      // v3.11.25 (Sesi 15, Issue #3): Handler untuk catatan anotasi
      else if (k === 'annot-note') { closeSheet(); openAnnotationNoteSheet(it.id); }
      else if (k === 'del') {
        b.innerHTML = '<div class="confirmstrip"><span style="flex:1">Hapus <b>' + esc((it.title || '').slice(0, 24)) + '</b>?</span>'
          + '<button class="btn btn-g" data-c="0">Batal</button><button class="btn btn-d" data-c="1">Hapus</button></div>';
        b.querySelector('[data-c="0"]').addEventListener('click', closeSheet);
        b.querySelector('[data-c="1"]').addEventListener('click', async () => {
          if (it._bundle) await deleteBundle(it.id); else await deleteItem(it.id);
          closeSheet(); await refreshVault(); toast('Item dihapus');
        });
      }
    }));
  });
}
async function toggleFav(id) {
  const it = currentVault.items.find(i => i.id === id);
  if (!it) return;
  await updateItem(id, { favorite: !it.favorite });
  await refreshVault();
}
// v3.7.2 (Issue 1): Toggle arsip — item tetap tersimpan, hanya disembunyikan dari list default.
async function toggleArchive(id) {
  const it = currentVault.items.find(i => i.id === id);
  if (!it) return;
  await updateItem(id, { archived: !it.archived });
  await refreshVault();
}
// v3.7.2 (Issue 1): Sheet untuk reassign item ke bundle lain (atau lepas dari bundle).
function openReassignBundleSheet(itemId) {
  const it = currentVault.items.find(i => i.id === itemId);
  if (!it) { toast('Item tidak ditemukan', false); return; }
  const bundles = currentVault.bundles || [];
  openSheet('📦 Tambah / pindah ke Bundle', 'Pilih bundle tujuan — item akan ditambahkan. Bundel lain tidak terpengaruh.', b => {
    if (!bundles.length) {
      b.innerHTML = '<div class="empty"><div class="big">📦</div>Belum ada bundle.<br><button class="btn btn-p" id="rbNew" style="margin-top:8px">Buat bundle pertama</button></div>';
      $('#rbNew')?.addEventListener('click', () => { closeSheet(); saveBundleSheet(); });
      return;
    }
    b.innerHTML = '<div class="sheet-form">'
      + '<div class="hintbox" style="margin-bottom:8px">Item: <b>' + esc((it.title || '').slice(0, 50)) + '</b></div>'
      + '<div class="picklist">' + bundles.map(bd => {
          const isMember = (bd.itemIds || []).includes(itemId);
          return '<label class="pickrow"><input type="checkbox" value="' + bd.id + '"' + (isMember ? ' checked' : '') + '><span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(bd.name || 'Bundle') + '</span><span class="pt-type">' + (bd.itemIds || []).length + ' item</span></label>';
        }).join('') + '</div>'
      + '<div class="btn-row"><button class="btn btn-g" id="rbCancel">Batal</button><button class="btn btn-p" id="rbSave">' + ICONS.check + 'Simpan perubahan</button></div></div>';
    const boxes = [...b.querySelectorAll('input[type=checkbox]')];
    $('#rbCancel').addEventListener('click', closeSheet);
    $('#rbSave').addEventListener('click', async () => {
      for (const box of boxes) {
        const bid = box.value;
        const wasMember = (currentVault.bundles.find(x => x.id === bid)?.itemIds || []).includes(itemId);
        if (box.checked && !wasMember) {
          await reassignToBundle(bid, itemId, 'add');
        } else if (!box.checked && wasMember) {
          await reassignToBundle(bid, itemId, 'remove');
        }
      }
      closeSheet();
      await refreshVault();
      toast('📦 Keanggotaan bundle diperbarui ✓');
    });
  });
}
// v3.7.2 (Issue 1): Bundle editor — ubah nama, tambah / hapus anggota, arsipkan bundle.
// v3.10.2 (Issue 5 fix): Selaraskan dengan Buat Bundle — tambah section Catatan,
//   filter "Catatan", field Warna, field Prompt cepat inline, checkbox "Simpan
//   sebagai item Prompt". Catatan yang tercentang sekarang diteruskan ke
//   updateBundle({ noteIds }) sehingga konsisten dengan addBundle.
function openBundleEditorSheet(bundleId) {
  const bd = currentVault.bundles.find(b => b.id === bundleId);
  if (!bd) { toast('Bundle tidak ditemukan', false); return; }
  // v3.9.0 (Issue 2): Sort by type + add filter chips + color badges
  const TYPE_ORDER = { prompt: 1, context: 2, link: 3, screenshot: 4, snapshot: 5 };
  const allCandidates = (currentVault?.items || []).filter(i =>
    ['prompt', 'context', 'link', 'screenshot', 'snapshot'].includes(i.type) && !i.archived
  ).sort((a, c) => (TYPE_ORDER[a.type] || 99) - (TYPE_ORDER[c.type] || 99) ||
                    (a.title || '').localeCompare(c.title || ''));
  // v3.10.2 (Issue 5 fix): Catatan candidates — selaras dengan Buat Bundle
  const noteCandidates = (currentNotes || []).filter(n => !n.archived);

  openSheet('📦 Edit Bundle', 'Filter per tipe, centang anggota + catatan, simpan', b => {
    b.innerHTML = '<div class="sheet-form">'
      + '<div><label>Nama Bundle</label><input class="f" id="ebName" value="' + esc(bd.name || '') + '" placeholder="mis. Riset kompetitor…"></div>'
      // v3.10.2 (Issue 5 fix): Tambah field Warna label (sebelumnya hanya di Buat Bundle)
      + '<div><label>Warna label <span class="field-hint">(opsional, untuk sort visual)</span></label>'
      +   '<select class="f" id="ebColor">'
      +     '<option value=""' + ((bd.color || '') === '' ? ' selected' : '') + '>— Tanpa warna —</option>'
      +     '<option value="orange"' + (bd.color === 'orange' ? ' selected' : '') + '>🟠 Oranye</option>'
      +     '<option value="green"' + (bd.color === 'green' ? ' selected' : '') + '>🟢 Hijau</option>'
      +     '<option value="blue"' + (bd.color === 'blue' ? ' selected' : '') + '>🔵 Biru</option>'
      +     '<option value="purple"' + (bd.color === 'purple' ? ' selected' : '') + '>🟣 Ungu</option>'
      +     '<option value="pink"' + (bd.color === 'pink' ? ' selected' : '') + '>🩷 Merah Muda</option>'
      +     '<option value="red"' + (bd.color === 'red' ? ' selected' : '') + '>🔴 Merah</option>'
      +   '</select></div>'
      // v3.10.2 (Issue 5 fix): Tambah Prompt cepat inline (sebelumnya hanya di Buat Bundle)
      + '<div><label>Prompt cepat <span class="field-hint">(opsional — tulis prompt langsung tanpa bikin item dulu)</span></label>'
      +   '<input class="f" id="ebInlineTitle" placeholder="Judul prompt (opsional)" style="margin-bottom:4px" value="' + esc(bd.inlinePromptItemId ? (bd.name || '') + ' — inline' : '') + '">'
      +   '<textarea class="f" id="ebInlinePrompt" rows="3" placeholder="Tulis prompt cepat — akan di-inject sebagai prompt tambahan saat bundle dipakai...">' + esc(bd.inlinePrompt || '') + '</textarea>'
      +   '<label class="checkrow" style="display:flex;align-items:center;gap:6px;font-size:11px;margin-top:4px">'
      +     '<input type="checkbox" id="ebSaveAsPrompt"' + (bd.inlinePromptItemId ? ' checked' : '') + '> Simpan juga sebagai item Prompt tersendiri'
      +   '</label></div>'
      // v3.9.0 (Issue 2): Filter chips per tipe — sekarang + chip "Catatan"
      + '<div><label>Filter per tipe <span class="field-hint">(klik untuk filter)</span></label>'
      +   '<div class="eb-filters" style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px">'
      +     '<button class="chip eb-filter on" data-cat="all" style="font-size:10.5px;padding:3px 9px">Semua</button>'
      +     '<button class="chip eb-filter" data-cat="prompt" style="font-size:10.5px;padding:3px 9px;border-left:3px solid var(--primary)">💬 Prompt</button>'
      +     '<button class="chip eb-filter" data-cat="context" style="font-size:10.5px;padding:3px 9px;border-left:3px solid var(--violet)">📋 Konteks</button>'
      +     '<button class="chip eb-filter" data-cat="link" style="font-size:10.5px;padding:3px 9px;border-left:3px solid #0891b2">🔗 Link</button>'
      +     '<button class="chip eb-filter" data-cat="screenshot" style="font-size:10.5px;padding:3px 9px;border-left:3px solid var(--green)">🖼️ Media</button>'
      +     '<button class="chip eb-filter" data-cat="snapshot" style="font-size:10.5px;padding:3px 9px;border-left:3px solid var(--amber)">📸 Snapshot</button>'
      +     '<button class="chip eb-filter" data-cat="note" style="font-size:10.5px;padding:3px 9px;border-left:3px solid #ca8a04">📝 Catatan</button>'
      +   '</div></div>'
      + '<div><label>Anggota <span class="field-hint" id="ebCount">' + ((bd.itemIds || []).length + (bd.noteIds || []).length) + ' dipilih</span></label>'
      +   '<div class="picklist" id="ebList"></div></div>'
      // v3.11.7-fix (Issue #2): btn-row pakai 3 tombol flex:1 yang merata — HAPUS spacer
      // style="flex:1" yang bikin tombol Simpan terdorong ke kanan ekstrim di sidebar lebar.
      // Layout: [Arsipkan] [Batal] [Simpan] — semua flex:1, gap konsisten.
      + '<div class="btn-row"><button class="btn btn-g" id="ebArchive">' + ICONS.archive + (bd.archived ? 'Keluarkan' : 'Arsipkan') + '</button>'
      +   '<button class="btn btn-g" id="ebCancel">Batal</button><button class="btn btn-p" id="ebSave">' + ICONS.check + 'Simpan</button></div></div>';

    // v3.9.0 (Issue 2): Render list with filter + track checked items in a Set
    // v3.10.2 (Issue 5 fix): + track checked notes in a Set
    const listBox = b.querySelector('#ebList');
    let activeFilter = 'all';
    b._checkedSet = new Set(bd.itemIds || []);
    b._checkedNotes = new Set(bd.noteIds || []);

    function renderList() {
      let html = '';
      // Items
      const filtered = activeFilter === 'all' || activeFilter === 'note'
        ? allCandidates
        : allCandidates.filter(it => it.type === activeFilter);
      for (const it of filtered) {
        const T = TYPE[it.type] || { icon: '', label: it.type };
        const checked = b._checkedSet.has(it.id) ? ' checked' : '';
        html += '<label class="pickrow"><input type="checkbox" value="' + it.id + '" data-kind="item"' + checked + '>'
          + '<span class="item-ic t-' + it.type + '" style="width:18px;height:18px;font-size:11px;flex-shrink:0">' + T.icon + '</span>'
          + '<span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(it.title) + '</span>'
          + '<span class="pt-type" style="font-size:10px;color:#888">' + T.label + '</span></label>';
      }
      // v3.10.2 (Issue 5 fix): Notes section — IDENTIK dengan Buat Bundle
      if ((activeFilter === 'all' || activeFilter === 'note') && noteCandidates.length > 0) {
        html += '<div style="margin-top:8px;padding-top:6px;border-top:1px dashed #ccc;font-size:11px;color:#666">— Catatan (Notepad) —</div>';
        for (const n of noteCandidates) {
          const noteTitle = n.title || (n.body || '').slice(0, 50) || 'Catatan';
          const checked = b._checkedNotes.has(n.id) ? ' checked' : '';
          html += '<label class="pickrow"><input type="checkbox" value="' + n.id + '" data-kind="note"' + checked + '>'
            + '<span class="item-ic t-note" style="width:18px;height:18px;font-size:11px;flex-shrink:0">📝</span>'
            + '<span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(noteTitle) + '</span>'
            + '<span class="pt-type" style="font-size:10px;color:#888">catatan</span></label>';
        }
      }
      listBox.innerHTML = html;
      // Bind change handlers
      listBox.querySelectorAll('input[type=checkbox]').forEach(cb => {
        cb.addEventListener('change', () => {
          if (cb.dataset.kind === 'note') {
            if (cb.checked) b._checkedNotes.add(cb.value);
            else b._checkedNotes.delete(cb.value);
          } else {
            if (cb.checked) b._checkedSet.add(cb.value);
            else b._checkedSet.delete(cb.value);
          }
          b.querySelector('#ebCount').textContent = (b._checkedSet.size + b._checkedNotes.size) + ' dipilih';
        });
      });
    }
    renderList();

    // Filter chip handlers
    b.querySelectorAll('.eb-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        b.querySelectorAll('.eb-filter').forEach(c => c.classList.remove('on'));
        btn.classList.add('on');
        activeFilter = btn.dataset.cat;
        renderList();
      });
    });

    $('#ebCancel').addEventListener('click', closeSheet);
    $('#ebSave').addEventListener('click', async () => {
      const name = ($('#ebName').value || '').trim() || 'Bundle tanpa nama';
      const ids = Array.from(b._checkedSet || []);
      const noteIds = Array.from(b._checkedNotes || []);
      // v3.10.2 (Issue 5 fix): Ambil juga warna, inline prompt, saveAsPrompt
      const color = $('#ebColor')?.value || '';
      const inlinePrompt = ($('#ebInlinePrompt')?.value || '').trim();
      const inlineTitle = ($('#ebInlineTitle')?.value || '').trim();
      const saveAsPrompt = $('#ebSaveAsPrompt')?.checked || false;
      if (ids.length + noteIds.length < 1 && !inlinePrompt) { toast('Pilih minimal 1 item/catatan ATAU tulis prompt cepat inline', false); return; }
      // v3.10.2 (Issue 5 fix): Pass noteIds, color, inlinePrompt, saveAsPrompt ke updateBundle
      await updateBundle(bd.id, {
        name,
        itemIds: ids,
        injectOrder: ids,
        noteIds,
        color,
        inlinePrompt,
        inlineTitle,
        saveAsPrompt
      });
      closeSheet();
      await refreshVault();
      toast('Bundle diperbarui ✓ · ' + (ids.length + noteIds.length) + ' anggota'
            + (inlinePrompt ? ' + 1 prompt inline' : ''));
    });
    $('#ebArchive').addEventListener('click', async () => {
      await updateBundle(bd.id, { archived: !bd.archived });
      closeSheet();
      await refreshVault();
      toast(bd.archived ? '📦 Dikeluarkan dari arsip' : '📦 Bundle diarsipkan');
    });
  });
}
async function downloadScreenshot(id) {
  const item = currentVault.items.find(i => i.id === id);
  if (!item) return;
  const res = await browser.runtime.sendMessage({ type: 'DOWNLOAD_SCREENSHOT', id, title: item.title, format: item.screenshotFormat || 'png' });
  if (res?.ok) toast('🖼️ Download dimulai'); else toast('Gagal download: ' + (res?.error || ''), false);
}

// v3.11.6 (Issue 1 dari Google Doc): Salin screenshot dari Vault ke clipboard.
// withCaption=false → salin gambar saja (image/png)
// withCaption=true  → salin gambar + keterangan (image/png + text/html + text/plain)
// Karena popup/sidebar tidak bisa akses navigator.clipboard.write dengan image
// langsung di Firefox (perlu user gesture & secure context yang berbeda),
// v3.11.34: Direct clipboard.write dari popup context.
// SEBELUMNYA (v3.11.32-): delegate ke background → inject content script ke
// active tab → clipboard.write di active tab. Ini sering gagal karena:
//   1. User gesture dari klik popup hilang saat message ke background
//   2. Active tab bisa about:blank / moz-extension: / restricted URL
//   3. Content script clipboard permission berbeda dari popup context
//   → fallback ke download file → user lihat "malah di download"
//
// FIX v3.11.34: lakukan clipboard.write langsung di popup context. Popup punya
// `clipboardWrite` permission (lihat manifest.json), jadi navigator.clipboard.write
// jalan tanpa perlu inject ke active tab.
//
// Format text/html + text/plain di-build via lib/copy-format.js — SAMA PERSIS
// dengan yang dipakai preview modal (overlay.js) dan batch copy.
async function copyScreenshotToClipboard(id, withCaption) {
  const item = currentVault.items.find(i => i.id === id);
  if (!item) { toast('Item tidak ditemukan', false); return; }
  try {
    toast(withCaption ? '📦 Menyalin gambar + keterangan…' : '📋 Menyalin gambar…');

    // Ambil screenshot blob (data URL) dari storage.local
    let dataUrl = null;
    try {
      const res = await browser.runtime.sendMessage({ type: 'GET_SCREENSHOT_BLOB', id });
      if (res?.ok && res.dataUrl) dataUrl = res.dataUrl;
    } catch (e) {
      console.warn('[RecallFox] GET_SCREENSHOT_BLOB failed:', e.message);
    }

    if (withCaption) {
      // Build caption (📸 + 🔗 + 🕒 + 📝 + 🔧) — sama persis dengan preview modal
      const cap = buildScreenshotCaption(item, dataUrl);
      const result = await writeScreenshotToClipboard(dataUrl, cap.textPlain, cap.textHtml);
      if (result.ok) {
        toast(result.message || '✓ Gambar + keterangan tersalin');
      } else {
        // Fallback terakhir: download file (jarang terjadi)
        if (dataUrl) {
          try {
            const a = document.createElement('a');
            a.href = dataUrl;
            a.download = 'screenshot-' + Date.now() + '.png';
            document.body.appendChild(a);
            a.click();
            a.remove();
            toast('✓ Gambar di-download + keterangan disalin (clipboard tidak support)');
            // Tetap copy text
            try { await navigator.clipboard.writeText(cap.textPlain); } catch (e) {}
          } catch (e) {
            toast('Gagal salin: ' + (result.error || e.message), false);
          }
        } else {
          toast('Gagal salin: ' + (result.error || 'no_dataurl'), false);
        }
      }
    } else {
      // Image only — tanpa caption
      if (!dataUrl) { toast('Gambar tidak ditemukan di storage', false); return; }
      const result = await writeScreenshotToClipboard(dataUrl, '', '');
      if (result.ok) {
        toast(result.message || '✓ Gambar tersalin');
      } else {
        // Fallback: download
        try {
          const a = document.createElement('a');
          a.href = dataUrl;
          a.download = 'screenshot-' + Date.now() + '.png';
          document.body.appendChild(a);
          a.click();
          a.remove();
          toast('✓ Gambar di-download (clipboard tidak support)');
        } catch (e) {
          toast('Gagal salin: ' + (result.error || e.message), false);
        }
      }
    }
  } catch (e) {
    toast('Error: ' + e.message, false);
  }
}

// v3.11.36 (Sesi 2, Issue dari Google Doc): Salin Teks Metadata saja (tanpa gambar).
// User feedback: paste gambar+teks bersamaan tidak reliable antar aplikasi (AI chat,
// WhatsApp, Gemini). Solusi: copy text-only via navigator.clipboard.writeText.
// Format sama persis dengan textPlain dari buildScreenshotCaption (field yang sudah
// ada di lib/copy-format.js, tidak perlu fungsi baru). Cepat karena tidak fetch blob.
async function copyScreenshotMetaToClipboard(id) {
  const item = currentVault.items.find(i => i.id === id);
  if (!item) { toast('Item tidak ditemukan', false); return; }
  try {
    toast('📝 Menyalin teks metadata…');
    // dataUrl = null → textPlain tetap lengkap (📸, Sumber, Waktu, Mode, 📝 Catatan)
    const cap = buildScreenshotCaption(item, null);
    if (!cap.textPlain) { toast('Tidak ada metadata untuk disalin', false); return; }
    await navigator.clipboard.writeText(cap.textPlain);
    toast('✓ Teks metadata tersalin (paste ke WA/Gemini/AI chat)');
  } catch (e) {
    console.warn('[RecallFox] copyScreenshotMetaToClipboard failed:', e.message);
    toast('Gagal salin teks: ' + e.message, false);
  }
}

// ============ Editor sheet (add / edit item) ============
async function openEditorSheet(id) {
  editingId = id || null;
  const it = id ? findItem(id) : null;
  const title = it ? 'Edit item' : 'Item baru';
  const sub = it ? (TYPE[it.type]?.label || it.type) : 'Pilih tipe di bawah';
  openSheet(title, sub, b => {
    const type = it?.type || 'prompt';
    const isLink = type === 'link';
    const isShot = type === 'screenshot';
    b.innerHTML = '<div class="sheet-form">'
      + '<div><label>Tipe</label><select class="f" id="fType">' + [
        ['prompt', '💬 Prompt'], ['context', '📋 Konteks'], ['snapshot', '📸 Snapshot'],
        ['screenshot', '🖼️ Screenshot'], ['link', '🔗 Link']
      ].map(o => '<option value="' + o[0] + '"' + (o[0] === type ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></div>'
      + '<div><label>Judul</label><input class="f" id="fTitle" value="' + esc(it?.title || '') + '" placeholder="Judul singkat…"></div>'
      + (isLink ? '<div><label>URL</label><input class="f" id="fUrl" value="' + esc(it?.linkUrl || it?.body || '') + '" placeholder="https://..."></div>' : '')
      + (isShot ? '' : '<div><label>Isi <span class="field-hint">— pakai {{nama}} untuk variabel</span></label><textarea class="f" id="fBody" rows="4" placeholder="Isi prompt / konteks…">' + esc(it?.body || '') + '</textarea><div class="varchips" id="fVars"></div>'
        // v3.10.0 (Issue 5): Compose + Parafrase — tersedia di semua edit item (kecuali screenshot)
        + '<div style="display:flex;gap:6px;margin-top:6px">'
        +   '<button class="btn btn-g" id="fCompose" title="AI generate body dari judul — bisa diulang" style="flex:1;padding:6px 8px;font-size:11px">✨ Compose dengan AI</button>'
        +   '<button class="btn btn-g" id="fParafrase" title="AI parafrase body yang sudah ada — bisa diulang" style="flex:1;padding:6px 8px;font-size:11px">🔄 Parafrase</button>'
        + '</div></div>')
      + '<div><label>Tag <span class="field-hint">(pisah koma)</span></label><input class="f" id="fTags" value="' + esc(it ? (Array.isArray(it.tags) ? it.tags.join(', ') : (it.tags || '')) : '') + '" placeholder="coding, review"></div>'
      + (type === 'prompt' ? '<div><button class="toppick-btn" id="fTopBtn">' + ICONS.plus + 'Pilih topping <span class="field-hint" style="display:inline">(opsional)</span></button><div class="topchips" id="fTops"></div></div>' : '')
      + '<div class="btn-row"><button class="btn btn-g" id="fCancel">Batal</button><button class="btn btn-p" id="fSave">' + ICONS.check + 'Simpan</button></div></div>';

    // Variable detection
    const body = b.querySelector('#fBody');
    const varsEl = b.querySelector('#fVars');
    if (body) body.addEventListener('input', () => {
      const found = []; let m; const re = /\{\{(\w+)\}\}/g;
      while ((m = re.exec(body.value))) { if (found.indexOf(m[1]) < 0) found.push(m[1]); }
      if (varsEl) varsEl.innerHTML = found.length ? '<span style="font-size:10px;color:var(--muted);align-self:center">Variabel:</span>' + found.map(v => '<span class="varchip">{{' + v + '}}</span>').join('') : '';
    });
    if (body) body.dispatchEvent(new Event('input'));

    // Toppings
    if (type === 'prompt') {
      getAllToppings().then(tops => {
        editorToppings = [...(it?.toppings || [])];
        const topsEl = b.querySelector('#fTops');
        topsEl.innerHTML = tops.map(t => '<button class="topchip' + (editorToppings.includes(t.id) ? ' on' : '') + '" data-t="' + esc(t.id) + '">' + esc(t.emoji || '') + ' ' + esc(t.name) + '</button>').join('');
        b.querySelector('#fTopBtn').addEventListener('click', () => topsEl.classList.toggle('show'));
        topsEl.querySelectorAll('.topchip').forEach(ch => ch.addEventListener('click', () => {
          ch.classList.toggle('on');
          const tid = ch.dataset.t;
          if (editorToppings.includes(tid)) editorToppings = editorToppings.filter(x => x !== tid);
          else editorToppings.push(tid);
        }));
      });
    }

    b.querySelector('#fCancel').addEventListener('click', closeSheet);
    b.querySelector('#fSave').addEventListener('click', () => saveEditorSheet(it));

    // v3.10.0 (Issue 5): Compose + Parafrase untuk semua edit item
    const composeBtn = b.querySelector('#fCompose');
    const parafraseBtn = b.querySelector('#fParafrase');
    if (composeBtn) composeBtn.addEventListener('click', async () => {
      const titleVal = ($('#fTitle').value || '').trim();
      if (!titleVal) { toast('Isi judul dulu, lalu klik Compose'); return; }
      const orig = composeBtn.textContent;
      composeBtn.textContent = '⏳ Composing...';
      composeBtn.disabled = true;
      try {
        const { isAssistantConfigured, chatWithFallback } = await import('../lib/assistant.js');
        if (!(await isAssistantConfigured())) { toast('Setup AI Assistant dulu di Pengaturan'); return; }
        const sys = 'Anda adalah asisten yang menulis konten efektif. Berdasarkan judul dari user, tulis isi yang lengkap dan siap pakai. Maksimal 300 kata. Jawab HANYA isinya saja, tanpa penjelasan tambahan.';
        let acc = '';
        const resp = await chatWithFallback(
          [{ role: 'system', content: sys }, { role: 'user', content: 'Judul: "' + titleVal + '"\n\nTulis isi lengkap berdasarkan judul ini.' }],
          { onToken: (t) => { acc += t; if (body) { body.value = acc; body.dispatchEvent(new Event('input')); } } }
        );
        if (!acc && resp?.content && body) { body.value = resp.content; body.dispatchEvent(new Event('input')); }
        toast('✨ Isi di-generate. Klik lagi untuk varian lain.');
      } catch (e) { toast('Gagal compose: ' + e.message); }
      finally { composeBtn.textContent = orig; composeBtn.disabled = false; }
    });
    if (parafraseBtn) parafraseBtn.addEventListener('click', async () => {
      if (!body || !body.value.trim()) { toast('Isi body dulu, lalu klik Parafrase'); return; }
      const orig = parafraseBtn.textContent;
      parafraseBtn.textContent = '⏳ Parafrase...';
      parafraseBtn.disabled = true;
      try {
        const { isAssistantConfigured, chatWithFallback } = await import('../lib/assistant.js');
        if (!(await isAssistantConfigured())) { toast('Setup AI Assistant dulu di Pengaturan'); return; }
        const sys = 'Anda adalah asisten yang memparafrase teks agar lebih efektif, jelas, dan rapi. Pertahankan semua informasi penting. Bisa lebih panjang atau lebih pendek sesuai kebutuhan. Jawab HANYA teks hasil parafrase, tanpa penjelasan.';
        let acc = '';
        const resp = await chatWithFallback(
          [{ role: 'system', content: sys }, { role: 'user', content: 'Teks asli:\n\n' + body.value + '\n\nParafrase agar lebih efektif.' }],
          { onToken: (t) => { acc += t; body.value = acc; body.dispatchEvent(new Event('input')); } }
        );
        if (!acc && resp?.content) { body.value = resp.content; body.dispatchEvent(new Event('input')); }
        toast('🔄 Parafrase selesai. Klik lagi untuk varian lain.');
      } catch (e) { toast('Gagal parafrase: ' + e.message); }
      finally { parafraseBtn.textContent = orig; parafraseBtn.disabled = false; }
    });

    setTimeout(() => b.querySelector('#fTitle')?.focus(), 120);
  });
}
async function saveEditorSheet(existing) {
  const type = $('#fType').value;
  const title = ($('#fTitle').value || '').trim();
  const tagsRaw = ($('#fTags').value || '').trim();
  const tags = tagsRaw ? tagsRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
  const bodyEl = $('#fBody'); const body = bodyEl ? bodyEl.value : '';
  const urlEl = $('#fUrl'); const url = urlEl ? urlEl.value.trim() : '';

  if (type === 'link') {
    if (!url) { toast('URL wajib untuk Link', false); return; }
    const linkTitle = title || url;
    if (existing) await updateItem(existing.id, { type, title: linkTitle, tags, body: url, linkUrl: url, linkTitle });
    else await addItem({ type, title: linkTitle, tags, body: url, linkUrl: url, linkTitle });
  } else if (type === 'screenshot') {
    if (!existing) { toast('Screenshot baru pakai tombol Shot', false); return; }
    await updateItem(existing.id, { type, title: title || existing.title, tags, body: existing.body || '' });
  } else {
    if (!title && !body) { closeSheet(); return; }
    const patch = { type, title: title || body.slice(0, 60), tags, body };
    if (type === 'prompt') patch.toppings = [...editorToppings];
    if (existing) await updateItem(existing.id, patch);
    else await addItem(patch);
  }
  closeSheet();
  await refreshVault();
  toast(existing ? 'Perubahan disimpan ✓' : 'Item ditambahkan ✓');
}

// ============ Type-specific save sheets (hero triggers) ============
function savePromptSheet() {
  openSheet('💬 Simpan Prompt', 'Field Prompt saja — toppings & variabel muncul saat relevan', b => {
    b.innerHTML = '<div class="sheet-form">'
      + '<div><label>Judul</label><input class="f" id="pT" placeholder="mis. Review kode Go idiomatic…" autofocus></div>'
      // v3.9.0 (Issue 4): Tombol Compose dengan AI — judul singkat → body panjang
      + '<div style="display:flex;gap:6px;margin-bottom:6px">'
      +   '<button class="btn btn-g" id="pCompose" title="AI generate body lengkap dari judul — bisa diulang sampai pas" style="flex:1;padding:6px 8px;font-size:11px">✨ Compose dengan AI</button>'
      +   '<button class="btn btn-g" id="pParafrase" title="AI parafrase body yang sudah ada — bisa diulang" style="flex:1;padding:6px 8px;font-size:11px">🔄 Parafrase</button>'
      + '</div>'
      + '<div><label>Tag <span class="field-hint">(pisah koma)</span></label><input class="f" id="pTag" placeholder="golang, review"></div>'
      + '<div><label>Isi Prompt <span class="field-hint">— pakai {{nama}} untuk variabel</span></label>'
      + '<textarea class="f" id="pBody" rows="4" placeholder="Kamu adalah reviewer senior. Tinjau kode {{bahasa}} berikut…"></textarea>'
      + '<div class="varchips" id="pVars"></div></div>'
      + '<div><button class="toppick-btn" id="pTopBtn">' + ICONS.plus + 'Pilih topping <span class="field-hint" style="display:inline">(opsional)</span></button>'
      + '<div class="topchips" id="pTops"></div></div>'
      + '<div class="btn-row"><button class="btn btn-g" id="pCancel">Batal</button><button class="btn btn-p" id="pSave">' + ICONS.check + 'Simpan Prompt</button></div></div>';
    const body = b.querySelector('#pBody'); const varsEl = b.querySelector('#pVars');
    body.addEventListener('input', () => {
      const found = []; let m; const re = /\{\{(\w+)\}\}/g;
      while ((m = re.exec(body.value))) { if (found.indexOf(m[1]) < 0) found.push(m[1]); }
      varsEl.innerHTML = found.length ? '<span style="font-size:10px;color:var(--muted);align-self:center">Variabel:</span>' + found.map(v => '<span class="varchip">{{' + v + '}}</span>').join('') : '';
    });

    // v3.9.0 (Issue 4): Compose dengan AI — judul singkat → body lengkap. Bisa diulang.
    b.querySelector('#pCompose').addEventListener('click', async () => {
      const btn = b.querySelector('#pCompose');
      const title = ($('#pT').value || '').trim();
      if (!title) { toast('Isi judul dulu, lalu klik Compose'); return; }
      const orig = btn.textContent;
      btn.textContent = '⏳ AI composing...';
      btn.disabled = true;
      try {
        const { isAssistantConfigured, chatWithFallback, buildSystemPrompt } = await import('../lib/assistant.js');
        if (!(await isAssistantConfigured())) {
          toast('Setup AI Assistant dulu di Pengaturan (Groq gratis)');
          return;
        }
        const sys = 'Anda adalah asisten yang menulis prompt AI yang efektif. Berdasarkan judul singkat dari user, tulis body prompt lengkap yang siap pakai. Body harus: (1) jelas peran AI, (2) instruksi spesifik, (3) format output yang diharapkan. Gunakan {{variabel}} untuk parameter yang bisa diganti. Maksimal 200 kata. Jawab HANYA body prompt-nya saja, tanpa penjelasan tambahan.';
        const userMsg = 'Judul: "' + title + '"\n\nTulis body prompt lengkap berdasarkan judul ini.';
        let acc = '';
        const resp = await chatWithFallback(
          [{ role: 'system', content: sys }, { role: 'user', content: userMsg }],
          { onToken: (t) => { acc += t; body.value = acc; body.dispatchEvent(new Event('input')); } }
        );
        if (!acc && resp?.content) body.value = resp.content;
        body.dispatchEvent(new Event('input'));
        toast('✨ Body di-generate. Klik lagi untuk varian lain, atau edit manual.');
      } catch (e) {
        toast('Gagal compose: ' + e.message);
      } finally {
        btn.textContent = orig;
        btn.disabled = false;
      }
    });
    // v3.9.0 (Issue 4): Parafrase body yang sudah ada — bisa diulang sampai pas
    b.querySelector('#pParafrase').addEventListener('click', async () => {
      const btn = b.querySelector('#pParafrase');
      const currentBody = body.value.trim();
      if (!currentBody) { toast('Isi body dulu, lalu klik Parafrase'); return; }
      const orig = btn.textContent;
      btn.textContent = '⏳ AI parafrase...';
      btn.disabled = true;
      try {
        const { isAssistantConfigured, chatWithFallback } = await import('../lib/assistant.js');
        if (!(await isAssistantConfigured())) {
          toast('Setup AI Assistant dulu di Pengaturan (Groq gratis)');
          return;
        }
        const sys = 'Anda adalah asisten yang memparafrase prompt AI agar lebih efektif. Pertahankan semua instruksi penting, tetapi perbaiki: kejelasan, struktur, dan efektivitas. Bisa lebih panjang atau lebih pendek sesuai kebutuhan. Jawab HANYA prompt hasil parafrase, tanpa penjelasan.';
        const userMsg = 'Prompt asli:\n\n' + currentBody + '\n\nParafrase agar lebih efektif.';
        let acc = '';
        const resp = await chatWithFallback(
          [{ role: 'system', content: sys }, { role: 'user', content: userMsg }],
          { onToken: (t) => { acc += t; body.value = acc; body.dispatchEvent(new Event('input')); } }
        );
        if (!acc && resp?.content) body.value = resp.content;
        body.dispatchEvent(new Event('input'));
        toast('🔄 Parafrase selesai. Klik lagi untuk varian lain.');
      } catch (e) {
        toast('Gagal parafrase: ' + e.message);
      } finally {
        btn.textContent = orig;
        btn.disabled = false;
      }
    });

    getAllToppings().then(tops => {
      const topsEl = b.querySelector('#pTops');
      topsEl.innerHTML = tops.map(t => '<button class="topchip" data-t="' + esc(t.id) + '">' + esc(t.emoji || '') + ' ' + esc(t.name) + '</button>').join('');
      b.querySelector('#pTopBtn').addEventListener('click', () => topsEl.classList.toggle('show'));
      const selected = [];
      topsEl.querySelectorAll('.topchip').forEach(ch => ch.addEventListener('click', () => {
        ch.classList.toggle('on');
        const tid = ch.dataset.t;
        if (selected.includes(tid)) selected.splice(selected.indexOf(tid), 1); else selected.push(tid);
      }));
      b.querySelector('#pSave').addEventListener('click', async () => {
        const found = []; let m; const re = /\{\{(\w+)\}\}/g;
        while ((m = re.exec(body.value))) { if (found.indexOf(m[1]) < 0) found.push(m[1]); }
        const t = ($('#pT').value || '').trim() || 'Prompt tanpa judul';
        const tg = ($('#pTag').value || '').trim() || 'baru';
        await addItem({ type: 'prompt', title: t, tags: tg.split(',').map(s => s.trim()).filter(Boolean), body: body.value, toppings: selected, useCount: 0 });
        closeSheet(); await refreshVault(); toast('Prompt disimpan ✓' + (found.length ? ' · ' + found.length + ' variabel' : '') + (selected.length ? ' · ' + selected.length + ' topping' : ''));
      });
    });
    b.querySelector('#pCancel').addEventListener('click', closeSheet);
    setTimeout(() => b.querySelector('#pT').focus(), 120);
  });
}
function saveKonteksSheet() {
  // v3.7.1-FIX: Form konteks diperkaya — tujuan, auto-grab halaman, template
  const TUJUAN_OPTIONS = [
    ['system', 'Instruksi Sistem (system prompt)'],
    ['project', 'Konteks Proyek (stack, arsitektur)'],
    ['domain', 'Pengetahuan Domain (konsep, istilah)'],
    ['reference', 'Referensi (dokumen, spesifikasi)'],
    ['instruction', 'Instruksi Kerja (SOP, checklist)'],
    ['custom', 'Lainnya (bebas)']
  ];
  const tujuanOpts = TUJUAN_OPTIONS.map(o => '<option value="' + o[0] + '">' + o[1] + '</option>').join('');

  openSheet('📋 Simpan Konteks', 'Konteks adalah informasi dasar yang dibutuhkan AI', b => {
    b.innerHTML = '<div class="sheet-form">'
      + '<div><label>Tujuan <span class="field-hint">membantu AI memahami peran konteks ini</span></label><select class="f" id="cTujuan">' + tujuanOpts + '</select></div>'
      + '<div><label>Judul</label><input class="f" id="cT" placeholder="mis. Konteks proyek POS kasir…"></div>'
      + '<div><label>Tag <span class="field-hint">(pisah koma)</span></label><input class="f" id="cTag" placeholder="pos, arsitektur"></div>'
      // v3.11.11 (Issue #2): Perjelas UX "Ambil dari halaman aktif".
      // User bingung: "fitur ambil konten ini kyknya eror karena loading terus tanpa
      // menghasilkan apa apa. kamu cek logika awal bangun 'simpan konteks' dan apa sih
      // ambil konten tu? baru perbaiki alogaritma nya dan caranya berinteraksi dengan
      // pengguna."
      // Fix: tambah hintbox penjelasan apa itu "Ambil Konten" + expected behavior.
      + '<div class="hintbox" style="margin:0 0 6px;font-size:11px;line-height:1.5">'
      +   '<b>💡 Ambil dari halaman aktif</b> = ekstrak teks utama dari tab yang sedang dibuka (mis. artikel Wikipedia, dokumentasi, blog). Hasilnya otomatis dimasukkan ke field Konteks di bawah. Bisa diklik berkali-kali untuk gabungkan beberapa halaman.'
      + '</div>'
      + '<div style="display:flex;gap:6px;margin-bottom:4px">'
      +   '<button class="btn btn-g" id="cGrabPage" style="flex:1;padding:6px 8px;font-size:11px" title="Ekstrak teks utama dari tab aktif → masukkan ke field Konteks">' + ICONS.spark + ' Ambil dari halaman aktif</button>'
      +   '<button class="btn btn-g" id="cAiSummarize" style="flex:1;padding:6px 8px;font-size:11px" title="AI meringkas halaman aktif jadi 200-300 kata">🤖 Ringkas dengan AI</button>'
      +   '<button class="btn btn-g" id="cFromTemplate" style="flex:1;padding:6px 8px;font-size:11px" title="Pilih template konteks siap pakai">📄 Dari template</button>'
      + '</div>'
      + '<div><label>Konteks</label><textarea class="f" id="cBody" rows="6" placeholder="Proyek ini pakai React + TypeScript, state Zustand…\n\nTujuan: ...\nStack: ...\nKonvensi: ..."></textarea>'
      // v3.10.0 (Issue 5): Compose + Parafrase untuk konteks
      + '<div style="display:flex;gap:6px;margin-top:6px">'
      +   '<button class="btn btn-g" id="cCompose" title="AI generate konteks dari judul — bisa diulang" style="flex:1;padding:6px 8px;font-size:11px">✨ Compose dengan AI</button>'
      +   '<button class="btn btn-g" id="cParafrase" title="AI parafrase konteks — bisa diulang" style="flex:1;padding:6px 8px;font-size:11px">🔄 Parafrase</button>'
      + '</div></div>'
      + '<div class="btn-row"><button class="btn btn-g" id="cCancel">Batal</button><button class="btn btn-p" id="cSave">' + ICONS.check + 'Simpan Konteks</button></div></div>';

    // v3.8.1 (Issue #4): "Ambil dari halaman aktif" — sekarang ROBUST.
    // Sebelumnya handler GET_PAGE_CONTEXT tidak ada di content script → tombol gagal diam-diam.
    // Sekarang: coba kirim ke content script dulu, kalau gagal fallback ke background
    // via browser.scripting.executeScript on-demand. Plus dapat body text halaman (bukan hanya metadata).
    let _lastPageContext = null; // cache untuk tombol AI summarize
    b.querySelector('#cGrabPage').addEventListener('click', async () => {
      const btn = b.querySelector('#cGrabPage');
      const orig = btn.textContent;
      btn.textContent = '⏳ Mengambil...';
      btn.disabled = true;
      try {
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        if (!tabs[0]) { toast('Tidak ada tab aktif', false); return; }
        const tab = tabs[0];
        const title = tab.title || '';
        const url = tab.url || '';

        // Cek apakah URL http(s) — bukan about:, moz-extension:, dll
        if (!url || !/^https?:\/\//.test(url)) {
          toast('Halaman ini tidak bisa diambil kontennya (URL: ' + (url || 'kosong') + ')', false);
          return;
        }

        // v3.9.0 (Issue 3): Isi metadata (title, URL, tag) SEGERA — UX instant
        const bodyEl = $('#cBody');
        const titleEl = $('#cT');
        const tagEl = $('#cTag');
        if (titleEl && !titleEl.value.trim()) titleEl.value = title.slice(0, 60) || 'Konteks dari halaman';
        if (tagEl && !tagEl.value.trim() && url) {
          try { tagEl.value = new URL(url).hostname.replace(/^www\./, '').split('.')[0]; } catch (e) {}
        }
        // Update tombol: tahap 2 — ambil konten
        btn.textContent = '⏳ Ambil konten...';

        // Strategi 1: kirim ke content script (jika ter-inject) — cepat
        let pageContent = '';
        let ctxMeta = null;
        try {
          const res = await browser.tabs.sendMessage(tab.id, { type: 'GET_PAGE_CONTEXT', maxLen: 8000 });
          if (res?.ok && res.text) {
            pageContent = res.text;
            ctxMeta = res.meta || null;
          }
        } catch (e) {
          // Content script belum ter-inject — fallback via background
        }

        // Strategi 2: fallback via background (inject on-demand)
        if (!pageContent) {
          try {
            const res = await browser.runtime.sendMessage({ type: 'GET_PAGE_CONTEXT_VIA_BG', maxLen: 8000 });
            if (res?.ok && res.text) {
              pageContent = res.text;
              ctxMeta = res.meta || null;
            }
          } catch (e) {}
        }

        // Cache untuk tombol AI summarize
        _lastPageContext = { title, url, text: pageContent, meta: ctxMeta };

        // v3.9.0 (Issue 3): Isi body — metadata (title/tag) sudah diisi di tahap 1
        if (bodyEl) {
          // Append mode (bukan replace) — biar user bisa pakai tombol berkali-kali
          const existing = bodyEl.value.trim();
          const newBlock = '[Halaman: ' + title + ']\n[URL: ' + url + ']'
            + (pageContent ? '\n\n' + pageContent : '');
          bodyEl.value = existing ? (existing + '\n\n---\n\n' + newBlock) : newBlock;
        }

        // Toast jujur — kasih tahu kalau konten kosong
        if (pageContent) {
          const wc = ctxMeta?.wordCount || pageContent.split(/\s+/).length;
          toast('📋 Halaman diambil (' + wc + ' kata, ' + pageContent.length + ' char)');
        } else {
          toast('⚠️ Hanya metadata (konten halaman tidak bisa diakses)', false);
        }
      } catch (e) {
        toast('Gagal mengambil info halaman: ' + e.message, false);
      } finally {
        btn.textContent = orig;
        btn.disabled = false;
      }
    });

    // v3.8.1 (Issue #4): Tombol "Ringkas dengan AI" — pakai AI Assistant yang sudah ada
    // untuk meringkas halaman aktif jadi konteks ringkas (200-300 kata).
    // v3.9.0 (Issue 3): Smooth-kan — pakai async wait yang benar (bukan setTimeout fixed).
    b.querySelector('#cAiSummarize').addEventListener('click', async () => {
      const btn = b.querySelector('#cAiSummarize');
      const orig = btn.textContent;
      btn.textContent = '⏳ AI meringkas...';
      btn.disabled = true;
      try {
        // v3.9.0 (Issue 3): Kalau belum ada context ter-cache, ambil dulu (await proper)
        if (!_lastPageContext || !_lastPageContext.text) {
          // Trigger tombol Ambil dari halaman aktif secara programatik dan tunggu selesai
          const grabBtn = b.querySelector('#cGrabPage');
          // Click tombol grab dan tunggu handler async-nya selesai dengan polling state
          grabBtn.click();
          // Polling _lastPageContext sampai terisi atau timeout 10s
          const startTime = Date.now();
          while ((!_lastPageContext || !_lastPageContext.text) && Date.now() - startTime < 10000) {
            await new Promise(r => setTimeout(r, 100));
          }
        }
        if (!_lastPageContext || !_lastPageContext.text) {
          toast('Ambil konten halaman dulu sebelum AI meringkas', false);
          return;
        }

        // Cek AI Assistant terkonfigurasi
        const { isAssistantConfigured } = await import('../lib/assistant.js');
        const configured = await isAssistantConfigured();
        if (!configured) {
          toast('AI Assistant belum dikonfigurasi. Set API key di Settings dulu.', false);
          return;
        }

        const { chatWithFallback } = await import('../lib/assistant.js');
        const sysPrompt = 'Anda adalah asisten yang ahli meringkas halaman web menjadi konteks padat untuk AI lain. ' +
                          'Ringkas halaman berikut menjadi 200-300 kata, fokus pada: ' +
                          '(1) topik utama, (2) poin-poin penting, (3) data/angka kunci, (4) kesimpulan. ' +
                          'Gunakan Bahasa Indonesia. Format markdown ringkas. Jangan tambahkan komentar meta.';
        const userPrompt = 'Halaman: ' + _lastPageContext.title + '\nURL: ' + _lastPageContext.url +
                          '\n\nKonten halaman:\n' + _lastPageContext.text.slice(0, 6000);

        const result = await chatWithFallback([
          { role: 'system', content: sysPrompt },
          { role: 'user', content: userPrompt }
        ]);

        if (result?.content) {
          const bodyEl = $('#cBody');
          const existing = bodyEl.value.trim();
          const summaryBlock = '## 📋 Ringkasan AI: ' + _lastPageContext.title + '\n\n' + result.content +
                              '\n\n---\n[Sumber: ' + _lastPageContext.url + ']';
          bodyEl.value = existing ? (existing + '\n\n---\n\n' + summaryBlock) : summaryBlock;
          toast('✨ AI selesai meringkas (' + result.content.length + ' char)');
        } else {
          toast('AI tidak memberikan respons', false);
        }
      } catch (e) {
        toast('Gagal AI summarize: ' + e.message, false);
        console.warn('[RecallFox] AI summarize error:', e);
      } finally {
        btn.textContent = orig;
        btn.disabled = false;
      }
    });

    // v3.7.1-FIX: Template konteks
    b.querySelector('#cFromTemplate').addEventListener('click', () => {
      const templates = [
        { label: 'Konteks Proyek', text: '## Proyek: [NAMA]\n\n### Stack\n- Frontend: \n- Backend: \n- Database: \n\n### Arsitektur\n\n### Konvensi\n- Naming: \n- Struktur folder: \n' },
        { label: 'Instruksi Sistem', text: 'Kamu adalah asisten ahli dalam bidang [DOMAIN].\n\n### Aturan\n1. Selalu jawab dalam Bahasa Indonesia.\n2. Gunakan format yang terstruktur.\n3. Berikan contoh ketika menjelaskan konsep.\n\n### Batasan\n- Jangan membuat informasi yang tidak diminta.\n' },
        { label: 'Referensi Dokumen', text: '## Dokumen Referensi\n\n### Sumber\n- Judul: \n- URL: \n- Tanggal: \n\n### Ringkasan\n\n### Poin Penting\n1. \n2. \n3. \n' },
        { label: 'SOP / Checklist', text: '## SOP: [NAMA PROSES]\n\n### Tujuan\n\n### Langkah-langkah\n1. [ ] \n2. [ ] \n3. [ ] \n\n### Catatan\n\n' }
      ];
      let html = '<div style="padding:8px 0">' + templates.map((t, i) => '<button class="act" data-tpl="' + i + '" style="margin-bottom:4px"><div>' + t.label + '</div></button>').join('') + '</div>';
      const existing = b.querySelector('.tpl-picker');
      if (existing) existing.remove();
      const div = document.createElement('div');
      div.className = 'tpl-picker';
      div.innerHTML = html;
      b.querySelector('.sheet-form').insertBefore(div, b.querySelector('#cBody').parentElement);
      div.querySelectorAll('[data-tpl]').forEach(btn => btn.addEventListener('click', () => {
        const tpl = templates[parseInt(btn.dataset.tpl)];
        if (tpl && $('#cBody')) {
          $('#cBody').value = tpl.text;
          div.remove();
          toast('Template "' + tpl.label + '" dimuat');
        }
      }));
    });

    b.querySelector('#cCancel').addEventListener('click', closeSheet);

    // v3.10.0 (Issue 5): Compose + Parafrase untuk konteks
    const cComposeBtn = b.querySelector('#cCompose');
    const cParafraseBtn = b.querySelector('#cParafrase');
    if (cComposeBtn) cComposeBtn.addEventListener('click', async () => {
      const titleVal = ($('#cT').value || '').trim();
      if (!titleVal) { toast('Isi judul dulu, lalu klik Compose'); return; }
      const orig = cComposeBtn.textContent;
      cComposeBtn.textContent = '⏳ Composing...';
      cComposeBtn.disabled = true;
      try {
        const { isAssistantConfigured, chatWithFallback } = await import('../lib/assistant.js');
        if (!(await isAssistantConfigured())) { toast('Setup AI Assistant dulu di Pengaturan'); return; }
        const sys = 'Anda adalah asisten yang menulis konteks proyek yang efektif untuk AI. Berdasarkan judul, tulis konteks lengkap dengan: Tujuan, Stack/Teknologi, Konvensi, Catatan penting. Maksimal 300 kata. Jawab HANYA konteksnya.';
        let acc = '';
        const cBodyEl = $('#cBody');
        const resp = await chatWithFallback(
          [{ role: 'system', content: sys }, { role: 'user', content: 'Judul: "' + titleVal + '"\n\nTulis konteks lengkap.' }],
          { onToken: (t) => { acc += t; if (cBodyEl) cBodyEl.value = acc; } }
        );
        if (!acc && resp?.content && cBodyEl) cBodyEl.value = resp.content;
        toast('✨ Konteks di-generate. Klik lagi untuk varian lain.');
      } catch (e) { toast('Gagal compose: ' + e.message); }
      finally { cComposeBtn.textContent = orig; cComposeBtn.disabled = false; }
    });
    if (cParafraseBtn) cParafraseBtn.addEventListener('click', async () => {
      const cBodyEl = $('#cBody');
      if (!cBodyEl || !cBodyEl.value.trim()) { toast('Isi konteks dulu, lalu klik Parafrase'); return; }
      const orig = cParafraseBtn.textContent;
      cParafraseBtn.textContent = '⏳ Parafrase...';
      cParafraseBtn.disabled = true;
      try {
        const { isAssistantConfigured, chatWithFallback } = await import('../lib/assistant.js');
        if (!(await isAssistantConfigured())) { toast('Setup AI Assistant dulu di Pengaturan'); return; }
        const sys = 'Parafrase teks berikut agar lebih jelas, rapi, dan efektif. Pertahankan semua informasi penting. Jawab HANYA teks hasil parafrase.';
        let acc = '';
        const resp = await chatWithFallback(
          [{ role: 'system', content: sys }, { role: 'user', content: 'Teks asli:\n\n' + cBodyEl.value + '\n\nParafrase.' }],
          { onToken: (t) => { acc += t; cBodyEl.value = acc; } }
        );
        if (!acc && resp?.content) cBodyEl.value = resp.content;
        toast('🔄 Parafrase selesai. Klik lagi untuk varian lain.');
      } catch (e) { toast('Gagal parafrase: ' + e.message); }
      finally { cParafraseBtn.textContent = orig; cParafraseBtn.disabled = false; }
    });

    b.querySelector('#cSave').addEventListener('click', async () => {
      const t = ($('#cT').value || '').trim() || 'Konteks tanpa judul';
      const tg = ($('#cTag').value || '').trim() || 'baru';
      const tujuan = ($('#cTujuan')?.value || 'custom');
      const bodyVal = $('#cBody').value;
      // Jika tujuan dipilih, prepends header ke body
      const tujuanLabel = TUJUAN_OPTIONS.find(o => o[0] === tujuan);
      const finalBody = tujuan !== 'custom' ? '[Tujuan: ' + (tujuanLabel ? tujuanLabel[1] : tujuan) + ']\n\n' + bodyVal : bodyVal;
      await addItem({ type: 'context', title: t, tags: tg.split(',').map(s => s.trim()).filter(Boolean), body: finalBody, contextPurpose: tujuan, useCount: 0 });
      closeSheet(); await refreshVault(); toast('Konteks disimpan ✓' + (tujuan !== 'custom' ? ' · ' + tujuanLabel[1] : ''));
    });
    setTimeout(() => b.querySelector('#cT').focus(), 120);
  });
}
async function saveLinkSheet() {
  let autoUrl = '', autoTitle = '';
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]) { autoUrl = tabs[0].url || ''; autoTitle = tabs[0].title || ''; }
  } catch (e) {}
  openSheet('🔗 Simpan Link', 'URL & judul terisi otomatis dari tab aktif', b => {
    b.innerHTML = '<div class="sheet-form">'
      + '<div><label>URL <span class="field-hint">⚡ auto-fill dari tab aktif</span></label><input class="f" id="lUrl" value="' + esc(autoUrl) + '"></div>'
      + '<div><label>Judul <span class="field-hint">⚡ auto-fill dari title halaman</span></label><input class="f" id="lT" value="' + esc(autoTitle) + '"></div>'
      + '<div><label>Tag <span class="field-hint">(pisah koma)</span></label><input class="f" id="lTag" placeholder="referensi, riset"></div>'
      + '<div class="btn-row"><button class="btn btn-g" id="lCancel">Batal</button><button class="btn btn-p" id="lSave">' + ICONS.check + 'Simpan Link</button></div></div>';
    b.querySelector('#lCancel').addEventListener('click', closeSheet);
    b.querySelector('#lSave').addEventListener('click', async () => {
      const url = ($('#lUrl').value || '').trim();
      if (!url) { toast('URL wajib', false); return; }
      const t = ($('#lT').value || '').trim() || url;
      const tg = ($('#lTag').value || '').trim() || 'link';
      await addItem({ type: 'link', title: t, tags: tg.split(',').map(s => s.trim()).filter(Boolean), body: url, linkUrl: url, linkTitle: t, useCount: 0 });
      closeSheet(); await refreshVault(); toast('Link disimpan ✓');
    });
  });
}
function saveBundleSheet() {
  openSheet('📦 Buat Bundle', 'Pilih item + catatan, tambah prompt cepat inline (opsional)', b => {
    // v3.8.1 (Issue #5a): Bundle sekarang dukung CATATAN sebagai anggota.
    // v3.8.1 (Issue #5d): Item di-sort per tipe + badge warna (bukan cuma teks).
    // Sertakan juga screenshot & snapshot (v3.7.2 Issue 1).
    // v3.10.2 (Issue 3 fix): Tambah filter per tipe — selaras dengan Edit Bundle.
    const TYPE_ORDER = { prompt: 1, context: 2, link: 3, screenshot: 4, snapshot: 5 };
    const itemCandidates = (currentVault?.items || []).filter(i =>
      ['prompt', 'context', 'link', 'screenshot', 'snapshot'].includes(i.type) && !i.archived
    ).sort((a, c) => (TYPE_ORDER[a.type] || 99) - (TYPE_ORDER[c.type] || 99) ||
                       (a.title || '').localeCompare(c.title || ''));
    const noteCandidates = (currentNotes || []).filter(n => !n.archived);

    b.innerHTML = '<div class="sheet-form">'
      + '<div><label>Nama Bundle</label><input class="f" id="bT" placeholder="mis. Riset kompetitor…"></div>'
      + '<div><label>Warna label <span class="field-hint">(opsional, untuk sort visual)</span></label>'
      +   '<select class="f" id="bColor">'
      +     '<option value="">— Tanpa warna —</option>'
      +     '<option value="orange">🟠 Oranye</option>'
      +     '<option value="green">🟢 Hijau</option>'
      +     '<option value="blue">🔵 Biru</option>'
      +     '<option value="purple">🟣 Ungu</option>'
      +     '<option value="pink">🩷 Merah Muda</option>'
      +     '<option value="red">🔴 Merah</option>'
      +   '</select></div>'
      + '<div><label>Prompt cepat <span class="field-hint">(opsional — tulis prompt langsung tanpa bikin item dulu)</span></label>'
      +   '<input class="f" id="bInlineTitle" placeholder="Judul prompt (opsional)" style="margin-bottom:4px">'
      +   '<textarea class="f" id="bInlinePrompt" rows="3" placeholder="Tulis prompt cepat — akan di-inject sebagai prompt tambahan saat bundle dipakai..."></textarea>'
      +   '<label class="checkrow" style="display:flex;align-items:center;gap:6px;font-size:11px;margin-top:4px">'
      +     '<input type="checkbox" id="bSaveAsPrompt"> Simpan juga sebagai item Prompt tersendiri (default: mati)'
      +   '</label></div>'
      // v3.10.2 (Issue 3 fix): Filter chips per tipe — IDENTIK dengan Edit Bundle
      + '<div><label>Filter per tipe <span class="field-hint">(klik untuk filter)</span></label>'
      +   '<div class="eb-filters" style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px">'
      +     '<button class="chip eb-filter on" data-cat="all" style="font-size:10.5px;padding:3px 9px">Semua</button>'
      +     '<button class="chip eb-filter" data-cat="prompt" style="font-size:10.5px;padding:3px 9px;border-left:3px solid var(--primary)">💬 Prompt</button>'
      +     '<button class="chip eb-filter" data-cat="context" style="font-size:10.5px;padding:3px 9px;border-left:3px solid var(--violet)">📋 Konteks</button>'
      +     '<button class="chip eb-filter" data-cat="link" style="font-size:10.5px;padding:3px 9px;border-left:3px solid #0891b2">🔗 Link</button>'
      +     '<button class="chip eb-filter" data-cat="screenshot" style="font-size:10.5px;padding:3px 9px;border-left:3px solid var(--green)">🖼️ Media</button>'
      +     '<button class="chip eb-filter" data-cat="snapshot" style="font-size:10.5px;padding:3px 9px;border-left:3px solid var(--amber)">📸 Snapshot</button>'
      +     '<button class="chip eb-filter" data-cat="note" style="font-size:10.5px;padding:3px 9px;border-left:3px solid #ca8a04">📝 Catatan</button>'
      +   '</div></div>'
      + '<div><label>Pilih item <span class="field-hint" id="bCount">0 dipilih</span></label>'
      +   '<div class="picklist" id="bList"></div></div>'
      + '<div class="btn-row"><button class="btn btn-g" id="bCancel">Batal</button><button class="btn btn-p" id="bSave">' + ICONS.check + 'Buat Bundle</button></div></div>';

    // v3.10.2 (Issue 3 fix): Render list dengan filter, tracking checked via Set
    const listBox = b.querySelector('#bList');
    let activeFilter = 'all';
    // Set untuk track item + note yang tercentang (id unik jadi tidak tabrakan)
    b._checkedItems = new Set();
    b._checkedNotes = new Set();

    function renderList() {
      let html = '';
      // Items (filter sesuai activeFilter, "all" = tampilkan semua)
      const filteredItems = activeFilter === 'all' || activeFilter === 'note'
        ? itemCandidates
        : itemCandidates.filter(it => it.type === activeFilter);
      for (const it of filteredItems) {
        const T = TYPE[it.type] || { icon: '', label: it.type };
        const checked = b._checkedItems.has(it.id) ? ' checked' : '';
        html += '<label class="pickrow"><input type="checkbox" value="' + it.id + '" data-kind="item"' + checked + '>'
          + '<span class="item-ic t-' + it.type + '" style="width:18px;height:18px;font-size:11px;flex-shrink:0">' + T.icon + '</span>'
          + '<span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(it.title) + '</span>'
          + '<span class="pt-type" style="font-size:10px;color:#888">' + T.label + '</span></label>';
      }
      // Notes (tampil kalau filter = all atau note)
      if ((activeFilter === 'all' || activeFilter === 'note') && noteCandidates.length > 0) {
        html += '<div style="margin-top:8px;padding-top:6px;border-top:1px dashed #ccc;font-size:11px;color:#666">— Catatan (Notepad) —</div>';
        for (const n of noteCandidates) {
          const noteTitle = n.title || (n.body || '').slice(0, 50) || 'Catatan';
          const checked = b._checkedNotes.has(n.id) ? ' checked' : '';
          html += '<label class="pickrow"><input type="checkbox" value="' + n.id + '" data-kind="note"' + checked + '>'
            + '<span class="item-ic t-note" style="width:18px;height:18px;font-size:11px;flex-shrink:0">📝</span>'
            + '<span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(noteTitle) + '</span>'
            + '<span class="pt-type" style="font-size:10px;color:#888">catatan</span></label>';
        }
      }
      listBox.innerHTML = html;
      // Bind change handlers
      listBox.querySelectorAll('input[type=checkbox]').forEach(cb => {
        cb.addEventListener('change', () => {
          if (cb.dataset.kind === 'note') {
            if (cb.checked) b._checkedNotes.add(cb.value);
            else b._checkedNotes.delete(cb.value);
          } else {
            if (cb.checked) b._checkedItems.add(cb.value);
            else b._checkedItems.delete(cb.value);
          }
          b.querySelector('#bCount').textContent = (b._checkedItems.size + b._checkedNotes.size) + ' dipilih';
        });
      });
    }
    renderList();

    // Filter chip handlers
    b.querySelectorAll('.eb-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        b.querySelectorAll('.eb-filter').forEach(c => c.classList.remove('on'));
        btn.classList.add('on');
        activeFilter = btn.dataset.cat;
        renderList();
      });
    });

    b.querySelector('#bCancel').addEventListener('click', closeSheet);
    b.querySelector('#bSave').addEventListener('click', async () => {
      const totalChecked = b._checkedItems.size + b._checkedNotes.size;
      const inlinePrompt = (b.querySelector('#bInlinePrompt')?.value || '').trim();
      const saveAsPrompt = b.querySelector('#bSaveAsPrompt')?.checked || false;
      // Validasi: minimal 2 item ATAU ada inlinePrompt
      if (totalChecked < 2 && !inlinePrompt) {
        toast('Pilih minimal 2 item ATAU tulis prompt cepat inline', false);
        return;
      }
      const name = (b.querySelector('#bT')?.value || '').trim() || 'Bundle tanpa nama';
      const color = b.querySelector('#bColor')?.value || '';
      const itemIds = Array.from(b._checkedItems);
      const noteIds = Array.from(b._checkedNotes);
      const inlineTitle = (b.querySelector('#bInlineTitle')?.value || '').trim();
      // v3.8.1: addBundle sekarang terima opts { color, noteIds, inlinePrompt, inlineTitle, saveAsPrompt }
      await addBundle(name, itemIds, {
        color,
        noteIds,
        inlinePrompt,
        inlineTitle,
        saveAsPrompt
      });
      closeSheet(); await refreshVault();
      toast('Bundle "' + name + '" dibuat ✓ · ' + (itemIds.length + noteIds.length) + ' anggota'
            + (inlinePrompt ? ' + 1 prompt inline' : '')
            + (saveAsPrompt ? ' (prompt disimpan juga)' : ''));
    });
  });
}
async function snapshotFlow() {
  if (!currentAiDomain) { toast('📸 Snapshot hanya aktif di halaman AI', false); return; }
  toast('Menganalisis percakapan…');
  try {
    const res = await browser.runtime.sendMessage({ type: 'QUICK_SNAPSHOT' });
    if (res?.ok) {
      await refreshVault();
      toast('📸 Snapshot tersimpan ✓');
      if (!document.body.classList.contains('rf-sidebar-body')) setTimeout(() => window.close(), 800);
    } else {
      const err = res?.error || 'gagal';
      let msg = 'Gagal';
      if (err === 'no_active_tab') msg = 'Tidak ada tab aktif';
      else if (err.includes('Could not establish connection')) msg = 'Bukan halaman AI';
      else msg = 'Error: ' + String(err).slice(0, 40);
      toast(msg, false);
    }
  } catch (e) { toast('Error: ' + e.message, false); }
}
async function doShot(mode) {
  // mode: 'entire' | 'visible' | 'selection' | 'upload' | undefined (shows picker)
  // Guard against accidental event-object args (defensive: doShot must never
  // receive a PointerEvent — if it does, treat as undefined to show picker)
  if (mode && typeof mode !== 'string') mode = undefined;

  // v3.8.1 (Issue #3): Mode 'upload' → buka form upload manual
  if (mode === 'upload') {
    saveScreenshotManualSheet();
    return;
  }

  // v3.11.7-fix (Issue #1): Kalau tidak ada mode spesifik, tampilkan picker
  // dengan pilihan mode + tingkat kompresi (sedikit/sedang/tinggi/lossless).
  // Default kompresi = "high" (JPEG q60) supaya upload GDrive berhasil.
  if (!mode) {
    openShotPickerSheet();
    return;
  }

  const modeLabel = mode === 'selection' ? 'area' : mode === 'visible' ? 'viewport' : mode === 'entire' ? 'full page' : 'picker';
  toast('🖼️ Menangkap (' + modeLabel + ')…');
  try {
    const res = await browser.runtime.sendMessage({ type: 'CAPTURE_SCREENSHOT', mode });
    if (res?.ok) {
      toast('Tersimpan — siap PDF/JPG ✓');
      if (!document.body.classList.contains('rf-sidebar-body')) setTimeout(() => window.close(), 700);
    } else {
      const err = res?.error || 'gagal';
      let msg = 'Gagal';
      if (err === 'no_active_tab') msg = 'Tidak ada tab aktif';
      else if (err === 'not_http_page') msg = 'Bukan halaman web';
      else msg = 'Error: ' + String(err).slice(0, 40);
      toast(msg, false);
    }
  } catch (e) { toast('Error: ' + e.message, false); }
}

// v3.11.7-fix2 (Sesi 7, Issue #2): Shot picker sheet — SIMPLIFIED jadi 2 klik saja.
// User feedback: "harusnya tidak jauh dari dua kali klik saja misal mau ganti kualitas,
// terus langsung saja pilih salah satu dari Bagian Seluruh, Seleksi Terlihat, Halaman Area.
// Tombol Batal dan Tangkap hilangkan saja, misal tidak jadi screenshot tinggal klik area
// lain. atau ketika sudah mau selection area yang mau di screenshot tinggal pencet esc."
//
// Flow sekarang (2 klik):
//   1. Klik tombol Shot (di hero tiles atau alat)
//   2. Klik salah satu mode (Visible/Entire/Selection) → LANGSUNG capture pakai
//      kompresi yang sedang dipilih di dropdown
//
// Untuk ganti kompresi: tinggal ubah dropdown dulu, lalu klik mode. Tidak perlu tombol
// "Tangkap" terpisah. Tidak ada tombol "Batal" — ESC di sheet bawah bisa tutup sheet,
// atau klik di luar sheet (di scrim).
function openShotPickerSheet() {
  const s = currentVault?.settings || {};
  const currentComp = s.screenshotCompression || 'lossless';
  openSheet('🖼️ Tangkap Layar', 'Pilih mode tangkap · ESC atau klik luar untuk batal', b => {
    b.innerHTML = '<div class="sheet-form">'
      + '<div><label>Mode tangkap <span class="field-hint">(klik untuk langsung capture)</span></label>'
      +   '<div class="shot-mode-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:4px">'
      +     '<button class="btn btn-g shot-mode-btn" data-mode="visible" style="padding:10px 4px;font-size:11px;line-height:1.3">📱<br>Bagian Terlihat</button>'
      +     '<button class="btn btn-g shot-mode-btn" data-mode="entire" style="padding:10px 4px;font-size:11px;line-height:1.3">📄<br>Seluruh Halaman</button>'
      +     '<button class="btn btn-g shot-mode-btn" data-mode="selection" style="padding:10px 4px;font-size:11px;line-height:1.3">✂️<br>Seleksi Area</button>'
      +   '</div></div>'
      + '<div><label>Tingkat kompresi <span class="field-hint">(ubah dulu sebelum pilih mode)</span></label>'
      +   '<select class="f" id="shotComp" style="margin-top:4px">'
      +     '<option value="high"' + (currentComp === 'high' ? ' selected' : '') + '>Tinggi (JPEG q60) — recommended, ~200-800KB</option>'
      +     '<option value="medium"' + (currentComp === 'medium' ? ' selected' : '') + '>Sedang (JPEG q75) — ~500KB-1.5MB</option>'
      +     '<option value="low"' + (currentComp === 'low' ? ' selected' : '') + '>Sedikit (JPEG q90) — ~1-3MB</option>'
      +     '<option value="lossless"' + (currentComp === 'lossless' ? ' selected' : '') + '>Lossless (PNG) — besar, kualitas terbaik</option>'
      +   '</select></div>'
      + '<div class="hintbox" style="font-size:10.5px">💡 <b>Tinggi</b> = upload GDrive selalu berhasil (di bawah limit Apps Script ~10MB). <b>Lossless</b> = kualitas terbaik tapi ukuran besar. Klik mode di atas untuk langsung capture — tidak perlu tombol lain.</div>'
      + '</div>';

    // v3.11.7-fix2: HAPUS tombol "Batal" dan "Tangkap". Klik mode = langsung capture.
    // User bisa batal dengan: (1) ESC keyboard (closeSheet sudah handle), (2) klik di
    // scrim (area di luar sheet, closeSheet sudah handle via scrim click handler).
    // Untuk selection mode, ESC selama selection overlay juga batal capture (sudah ada).

    b.querySelectorAll('.shot-mode-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const selectedMode = btn.dataset.mode;
        const comp = b.querySelector('#shotComp').value;
        // Save compression ke settings supaya captureFullPage pakai compression baru
        if (comp !== currentComp) {
          await saveSettings({ screenshotCompression: comp });
        }
        closeSheet();
        // Trigger shot dengan mode terpilih — langsung capture, tanpa konfirmasi tambahan
        doShot(selectedMode);
      });
    });
  });
}

// v3.8.1 (Issue #3): Upload manual screenshot — untuk screenshot dari luar web
// (desktop, aplikasi lain, file PNG/JPG existing). User bisa:
//   - Klik "Pilih file" → file picker
//   - Paste dari clipboard (Ctrl+V)
//   - Drag & drop file ke area dropzone
// Setelah simpan, item masuk ke vault + sync ke GDrive (jika aktif).
function saveScreenshotManualSheet() {
  openSheet('🖼️ Upload Screenshot Manual', 'Pilih file gambar, paste dari clipboard, atau drag & drop', b => {
    b.innerHTML = '<div class="sheet-form">'
      + '<div><label>Judul <span class="field-hint">(opsional — kosongkan untuk pakai filename)</span></label>'
      +   '<input class="f" id="shT" placeholder="mis. Bukti transfer bank..."></div>'
      + '<div><label>Tag <span class="field-hint">(pisah koma)</span></label>'
      +   '<input class="f" id="shTag" placeholder="bukti, keuangan"></div>'
      // Dropzone
      + '<div id="shDropzone" style="border:2px dashed #c0c0c0;border-radius:8px;padding:24px;text-align:center;color:#666;cursor:pointer;margin:8px 0;transition:all 0.2s">'
      +   '<div style="font-size:32px;margin-bottom:8px">📷</div>'
      +   '<div style="font-weight:600;color:#333">Klik untuk pilih file</div>'
      +   '<div style="font-size:11px;margin-top:4px">atau drag & drop, atau paste (Ctrl+V)</div>'
      +   '<div style="font-size:10px;margin-top:4px;color:#999">Format: PNG, JPG, JPEG, GIF, WEBP (max 10MB)</div>'
      + '</div>'
      + '<input type="file" id="shFileInput" accept="image/*" style="display:none">'
      // Preview
      + '<div id="shPreview" style="display:none;margin:8px 0">'
      +   '<img id="shPreviewImg" style="max-width:100%;max-height:200px;border-radius:6px;border:1px solid #ddd">'
      +   '<div style="font-size:11px;color:#666;margin-top:4px" id="shPreviewMeta"></div>'
      + '</div>'
      + '<div class="btn-row"><button class="btn btn-g" id="shCancel">Batal</button>'
      +   '<button class="btn btn-p" id="shSave" disabled>' + ICONS.check + 'Simpan Screenshot</button></div></div>';

    let _dataUrl = null;
    let _filename = '';

    const dropzone = b.querySelector('#shDropzone');
    const fileInput = b.querySelector('#shFileInput');

    // Klik dropzone → trigger file picker
    dropzone.addEventListener('click', () => fileInput.click());

    // File picker change
    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (file) await _handleFile(file);
    });

    // Drag & drop
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.style.borderColor = '#FF7139';
      dropzone.style.background = '#FFF4E6';
    });
    dropzone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dropzone.style.borderColor = '#c0c0c0';
      dropzone.style.background = '';
    });
    dropzone.addEventListener('drop', async (e) => {
      e.preventDefault();
      dropzone.style.borderColor = '#c0c0c0';
      dropzone.style.background = '';
      const file = e.dataTransfer.files[0];
      if (file) await _handleFile(file);
    });

    // Paste from clipboard
    async function _pasteHandler(e) {
      const items = e.clipboardData?.items || [];
      for (const it of items) {
        if (it.type.startsWith('image/')) {
          const file = it.getAsFile();
          if (file) {
            await _handleFile(file);
            e.preventDefault();
            break;
          }
        }
      }
    }
    document.addEventListener('paste', _pasteHandler);

    // Cleanup paste handler saat sheet ditutup — pakai MutationObserver pada scrim
    // (jangan override closeSheet global, itu bisa break flow lain)
    const _cleanupPaste = () => {
      document.removeEventListener('paste', _pasteHandler);
    };
    // Pasang observer ke tombol Cancel & Save (yang panggil closeSheet)
    b.querySelector('#shCancel').addEventListener('click', _cleanupPaste);
    // Save button cleanup setelah sukses (closeSheet dipanggil di handler save)
    // Plus observer pada scrim class change sebagai fallback
    const scrim = $('#scrim');
    if (scrim) {
      const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.attributeName === 'class' && !scrim.classList.contains('show')) {
            _cleanupPaste();
            observer.disconnect();
            break;
          }
        }
      });
      observer.observe(scrim, { attributes: true, attributeFilter: ['class'] });
    }

    async function _handleFile(file) {
      if (!file.type.startsWith('image/')) {
        toast('File bukan gambar: ' + file.type, false);
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast('File terlalu besar (max 10MB)', false);
        return;
      }
      try {
        // Baca sebagai data URL
        const reader = new FileReader();
        const dataUrl = await new Promise((resolve, reject) => {
          reader.onloadend = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        _dataUrl = dataUrl;
        _filename = file.name;
        // Preview
        const previewImg = b.querySelector('#shPreviewImg');
        const previewMeta = b.querySelector('#shPreviewMeta');
        const previewBox = b.querySelector('#shPreview');
        previewImg.src = dataUrl;
        const sizeKb = (file.size / 1024).toFixed(1);
        previewMeta.textContent = '📎 ' + file.name + ' · ' + sizeKb + ' KB · ' + file.type;
        previewBox.style.display = '';
        // Enable save button
        b.querySelector('#shSave').disabled = false;
        // Auto-fill title kalau kosong
        const titleEl = b.querySelector('#shT');
        if (!titleEl.value.trim()) {
          titleEl.value = file.name.replace(/\.[^.]+$/, '').slice(0, 60);
        }
        toast('📋 Gambar dimuat — klik Simpan untuk menyimpan');
      } catch (e) {
        toast('Gagal membaca file: ' + e.message, false);
      }
    }

    b.querySelector('#shCancel').addEventListener('click', closeSheet);
    b.querySelector('#shSave').addEventListener('click', async () => {
      if (!_dataUrl) { toast('Pilih file dulu', false); return; }
      const title = (b.querySelector('#shT').value || '').trim() || _filename || 'Screenshot Upload';
      const tags = (b.querySelector('#shTag').value || '').trim();
      const tagList = tags ? tags.split(',').map(s => s.trim()).filter(Boolean) : ['upload'];

      const btn = b.querySelector('#shSave');
      const orig = btn.textContent;
      btn.textContent = '⏳ Menyimpan...';
      btn.disabled = true;
      try {
        const result = await browser.runtime.sendMessage({
          type: 'SAVE_UPLOADED_SCREENSHOT',
          title,
          dataUrl: _dataUrl,
          source: {
            kind: 'upload',
            url: '',
            title: _filename || title,
            filename: _filename,
            uploadedAt: new Date().toISOString()
          }
        });
        if (result?.ok) {
          closeSheet(); await refreshVault();
          toast('🖼️ Screenshot upload disimpan ✓');
        } else {
          toast('Gagal simpan: ' + (result?.error || 'unknown'), false);
          btn.textContent = orig;
          btn.disabled = false;
        }
      } catch (e) {
        toast('Error: ' + e.message, false);
        btn.textContent = orig;
        btn.disabled = false;
      }
    });
  });
}

// ============ AI Tools launcher ============
function aiToolsSheet() {
  openSheet('Alat AI', 'Pilih alat AI — buka di tab baru', b => {
    // v3.11.1 (Issue 4): Pakai effective tools (built-in + custom + pinned/hidden flags)
    const customizations = (currentVault?.settings?.aiToolsCustomizations) || {};
    const effectiveTools = getEffectiveTools(customizations);
    const visible = effectiveTools.filter(t => !t.hidden);
    const pinned = visible.filter(t => t.pinned);
    const others = visible.filter(t => !t.pinned);
    const row = (t) => '<button class="act" data-url="' + esc(t.url) + '" data-name="' + esc(t.name) + '">'
      + '<span style="font-size:18px;flex:none;width:24px;text-align:center">' + (t.emoji || '🤖') + '</span>'
      + '<div style="flex:1"><div>' + esc(t.name) + (t.custom ? ' <span style="font-size:9px;background:var(--violet-soft);color:var(--violet);padding:1px 5px;border-radius:4px;font-weight:700;margin-left:4px">CUSTOM</span>' : '') + (t.pinned ? ' <span style="color:var(--amber)">⭐</span>' : '') + '</div>'
      + '<div class="ad">' + esc(t.url) + '</div></div>'
      + '<span class="ad">Buka →</span></button>';
    let html = '';
    // v3.11.1: Tombol "Kelola Situs AI" di paling atas
    html += '<button class="act" id="aiManageBtn" style="background:var(--primary-soft);border:1px dashed var(--primary);margin-bottom:8px">'
      + '<span style="font-size:18px;flex:none;width:24px;text-align:center">⚙️</span>'
      + '<div style="flex:1"><div style="color:var(--primary);font-weight:700">Kelola Situs AI</div>'
      + '<div class="ad">Pin / sembunyikan / tambah situs custom</div></div>'
      + '<span class="ad">' + visible.length + ' aktif →</span></button>';
    if (pinned.length) html += '<div class="sec-label" style="padding:4px 10px">⭐ Sering dipakai (' + pinned.length + ')</div>' + pinned.map(row).join('');
    const groups = groupByRegion(others);
    for (const [region, tools] of Object.entries(groups)) {
      if (!tools.length) continue;
      const regionLabel = { local: '🇮🇩 LOKAL', west: '🌍 BARAT', china: '🇨🇳 CHINA' }[region] || region.toUpperCase();
      html += '<div class="sec-label" style="padding:8px 10px 4px">' + regionLabel + ' (' + tools.length + ')</div>' + tools.map(row).join('');
    }
    b.innerHTML = html;
    // Bind "Kelola Situs AI" button
    const manageBtn = b.querySelector('#aiManageBtn');
    if (manageBtn) manageBtn.addEventListener('click', () => {
      closeSheet();
      setTimeout(() => toolPage('aimanage'), 80);
    });
    // Bind AI tool rows
    b.querySelectorAll('.act[data-url]').forEach(a => a.addEventListener('click', async () => {
      closeSheet();
      await browser.tabs.create({ url: a.dataset.url });
      toast('⚡ ' + a.dataset.name + ' dibuka');
    }));
  });
}

// ============ Add item menu ============
function addItemMenu() {
  openSheet('Tambah Item Baru', 'Pilih tipe — form selalu spesifik', b => {
    const opts = [
      ['💬 Prompt', savePromptSheet], ['📋 Konteks', saveKonteksSheet], ['🔗 Link', saveLinkSheet],
      ['📦 Bundle', saveBundleSheet], ['📸 Snapshot', snapshotFlow],
      ['🖼️ Screenshot (pilih mode)', () => doShot()],
      ['✂️ Screenshot area', () => doShot('selection')],
      ['📱 Screenshot viewport', () => doShot('visible')],
      ['📄 Screenshot seluruh halaman', () => doShot('entire')],
      ['📤 Upload gambar (manual)', () => doShot('upload')],   // v3.8.1 Issue #3
      ['📝 Catatan', () => { setView('notes'); newNote(); }]
    ];
    b.innerHTML = opts.map((o, i) => '<button class="act" data-i="' + i + '">' + o[0] + '</button>').join('');
    b.querySelectorAll('.act').forEach(a => a.addEventListener('click', () => { closeSheet(); setTimeout(opts[a.dataset.i][1], 80); }));
    b.insertAdjacentHTML('beforeend', '<div class="sheet-note">💡 Screenshot punya 4 mode: <b>area</b> (seret kotak), <b>viewport</b> (bagian terlihat), <b>seluruh halaman</b> (scroll-stitch), <b>upload manual</b> (file dari disk / paste clipboard).</div>');
  });
}

// ============ Command palette ============
const COMMANDS = [
  { k: 'prompt', t: 'Simpan Prompt baru', s: 'Form khusus: judul, isi, toppings, variabel', run: savePromptSheet },
  { k: 'konteks', t: 'Simpan Konteks baru', s: 'Form khusus: judul, tag, konteks', run: saveKonteksSheet },
  { k: 'link', t: 'Simpan Link tab aktif', s: 'URL & judul auto-fill', run: saveLinkSheet },
  { k: 'bundle', t: 'Buat Bundle', s: 'Gabungkan beberapa item', run: saveBundleSheet },
  { k: 'catatan', t: 'Catatan Baru', s: 'Scratchpad auto-save · tab Catatan', run: () => { setView('notes'); newNote(); } },
  { k: 'snap', t: 'Snapshot percakapan AI', s: 'Simpan chat sebagai item', run: snapshotFlow },
  { k: 'shot', t: 'Screenshot halaman', s: 'Tangkap → PDF/JPG/PNG', run: () => doShot() },
  { k: 'shot-area', t: 'Screenshot area (seret kotak)', s: 'Seleksi area spesifik — ideal cuplikan UI', run: () => doShot('selection') },
  { k: 'shot-visible', t: 'Screenshot viewport', s: 'Hanya bagian terlihat', run: () => doShot('visible') },
  { k: 'shot-full', t: 'Screenshot seluruh halaman', s: 'Scroll-stitch penuh', run: () => doShot('entire') },
  { k: 'cache', t: 'Clear Cache', s: 'Bersihkan data (dengan konfirmasi)', run: () => toolPage('cache') },
  { k: 'shalat', t: 'Buka Waktu Shalat', s: 'Jadwal + countdown', run: () => toolPage('shalat') },
  { k: 'volume', t: 'Volume Booster', s: 'Perbesar volume hingga 600%', run: () => toolPage('volume') },
  { k: 'tema', t: 'Ganti tema', s: 'Terang / gelap', run: toggleTheme },
  { k: 'ai', t: 'Pindah AI Tool', s: 'Buka AI tool lain', run: aiToolsSheet },
  { k: 'alat', t: 'Buka tab Alat', s: 'Semua alat dalam satu tempat', run: () => setView('tools') }
];
function renderSearch() {
  // v3.11.1: Defensive — kalau search bar tidak ada (sidebar mode), skip
  const searchEl = $('#search');
  if (!searchEl) return;
  const q = currentQuery.trim(); const has = q.length > 0;
  $('#list').style.display = has ? 'none' : '';
  const cr = $('#cmdres'); cr.style.display = has ? '' : 'none';
  if (!has) { renderList(); return; }
  const cmdMode = q.startsWith('>');
  if (cmdMode) {
    const cq = q.slice(1).toLowerCase();
    const cs = COMMANDS.filter(c => c.k.indexOf(cq) >= 0 || c.t.toLowerCase().indexOf(cq) >= 0);
    cr.innerHTML = cs.length
      ? '<div class="sec-label">Perintah</div>' + cs.map(c => '<div class="cmd-item" data-cmd="' + c.k + '"><div class="ci">' + ICONS.zap + '</div><div><div class="ct">' + esc(c.t) + '</div><div class="cs">' + esc(c.s) + '</div></div><kbd>↵</kbd></div>').join('')
      : '<div class="empty"><div class="big">😶</div>Perintah tidak ditemukan.</div>';
    cr.querySelectorAll('.cmd-item').forEach(el => el.addEventListener('click', () => { const c = COMMANDS.find(x => x.k === el.dataset.cmd); c.run(); clearSearch(); }));
  } else {
    const nq = q.toLowerCase();
    const cs2 = COMMANDS.filter(c => c.k.indexOf(nq) >= 0 || c.t.toLowerCase().indexOf(nq) >= 0).slice(0, 3);
    // v3.7.2 (Issue 4): Cari di SEMUA tipe item (prompt, konteks, link, bundle, snapshot, screenshot)
    // termasuk body, tags, linkUrl, source.url, source.title, dan bundle member titles.
    const its = getVaultItems().filter(i => searchableTextFor(i).indexOf(nq) >= 0);
    // v3.7.2 (Issue 4): Cari juga di catatan (title + body + group).
    const noteHits = (currentNotes || []).filter(n => {
      const text = ((n.title || '') + ' ' + (n.body || '') + ' ' + (n.group || '') + ' note catatan').toLowerCase();
      return text.indexOf(nq) >= 0;
    }).slice(0, 5);
    let h = '';
    if (cs2.length) h += '<div class="sec-label">Perintah</div>' + cs2.map(c => '<div class="cmd-item" data-cmd="' + c.k + '"><div class="ci">' + ICONS.zap + '</div><div><div class="ct">' + esc(c.t) + '</div><div class="cs">' + esc(c.s) + '</div></div></div>').join('');
    if (its.length) h += '<div class="sec-label">Item · ' + its.length + ' (semua tipe + arsip)</div>' + its.map(it => {
      const T = TYPE[it.type] || { label: it.type, icon: '' };
      const tagsStr = Array.isArray(it.tags) ? it.tags.join(', ') : (it.tags || '');
      // v3.10.0 (Issue 4): Tampilkan badge Arsip jika item di-arsipkan
      const archiveBadge = it.archived ? ' <span style="font-size:9px;background:#fef3c7;color:#92400e;padding:1px 5px;border-radius:3px;margin-left:4px;font-weight:700">ARSIP</span>' : '';
      return '<div class="cmd-item" data-item="' + it.id + '"><div class="item-ic t-' + it.type + '" style="width:28px;height:28px">' + T.icon + '</div><div><div class="ct" style="font-size:12.5px">' + esc(it.title) + archiveBadge + '</div><div class="cs">' + T.label + ' · ' + esc(tagsStr) + '</div></div></div>';
    }).join('');
    if (noteHits.length) h += '<div class="sec-label">Catatan · ' + noteHits.length + '</div>' + noteHits.map(n => {
      const title = n.title || (n.body || '').slice(0, 60) || '(kosong)';
      const group = n.group ? ' · 📁 ' + esc(n.group) : '';
      return '<div class="cmd-item" data-note="' + n.id + '"><div class="item-ic t-context" style="width:28px;height:28px">📝</div><div><div class="ct" style="font-size:12.5px">' + esc(title) + '</div><div class="cs">Catatan' + group + ' · ' + timeAgo(n.updatedAt || n.createdAt) + '</div></div></div>';
    }).join('');
    if (!its.length && !cs2.length && !noteHits.length) h = '<div class="empty"><div class="big">🔍</div>Tidak ada hasil untuk "' + esc(q) + '".</div>';
    cr.innerHTML = h;
    cr.querySelectorAll('[data-cmd]').forEach(el => el.addEventListener('click', () => { COMMANDS.find(c => c.k === el.dataset.cmd).run(); clearSearch(); }));
    cr.querySelectorAll('[data-item]').forEach(el => el.addEventListener('click', () => { primaryAction(el.dataset.item); clearSearch(); }));
    cr.querySelectorAll('[data-note]').forEach(el => el.addEventListener('click', () => { setView('notes'); setTimeout(() => openNoteEditor(el.dataset.note), 60); clearSearch(); }));
  }
}
function clearSearch() {
  // v3.11.1: Defensive — kalau search input tidak ada, just reset state
  const searchEl = $('#search');
  if (searchEl) searchEl.value = '';
  currentQuery = '';
  // v3.10.2 (Issue 4 fix): Sembunyikan tombol clear (X) setelah input dikosongkan
  const clearBtn = $('#searchClear');
  if (clearBtn) clearBtn.style.display = 'none';
  renderSearch();
}

// ============ View switcher ============
function setView(v) {
  currentView = v;
  $('#tabHome').classList.toggle('on', v === 'home');
  $('#tabNotes').classList.toggle('on', v === 'notes');
  $('#tabTools').classList.toggle('on', v === 'tools');
  $('#vaultView').classList.toggle('hide', v !== 'home');
  $('#notesView').classList.toggle('hide', v !== 'notes');
  $('#toolsView').classList.toggle('hide', v !== 'tools');
  const homeOnly = (v === 'home');
  // v3.11.1: cmdWrap (search bar) sudah dihapus — ganti dengan quickActions
  // v3.11.3: quickActions juga sudah dihapus — biar lega (user request).
  // Sekarang cuma tiles + strip yang toggle di home view.
  const cmdWrap = $('#cmdWrap');
  if (cmdWrap) cmdWrap.style.display = homeOnly ? 'flex' : 'none';
  document.querySelector('.tiles').style.display = homeOnly ? 'grid' : 'none';
  // v3.11.7-fix (Issue #6): Strip jadwal sholat SELALU terlihat di semua view
  // (home, notes, tools) supaya countdown sholat tidak hilang saat user di menu lain.
  // Sebelumnya: homeOnly ? '' : 'none' → ketutup saat di notes/tools.
  document.querySelector('.strip').style.display = '';
  $('#page').classList.remove('in');
  if (v === 'notes') renderNotes();
}

// ============ Notes ============
// v3.7.2 (Issue 5): 12 warna (sebelumnya 6) — tambah orange, red, teal, indigo, slate, rose.
const NCOLORS = ['default', 'yellow', 'green', 'blue', 'pink', 'purple', 'orange', 'red', 'teal', 'indigo', 'slate', 'rose'];
function notesSorted() {
  // v3.7.2 (Issue 5): Saring berdasarkan currentNoteGroup kalau dipilih.
  let arr = currentNotes.filter(n => !n.archived);
  if (currentNoteGroup) {
    arr = arr.filter(n => (n.group || '') === currentNoteGroup);
  }
  return arr.slice().sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
}
async function renderNotes() {
  currentNotes = await getNotes();
  const list = $('#notesList');
  const badge = $('#notesBadge');
  if (badge) { badge.style.display = currentNotes.length ? 'grid' : 'none'; badge.textContent = currentNotes.length; }
  // v3.11.1 (Issue 3 fix): Update count meta di notes-bar compact
  const countMeta = $('#notesCountMeta');
  if (countMeta) {
    const activeCount = currentNotes.filter(n => !n.archived).length;
    countMeta.textContent = activeCount + ' catatan';
  }
  // v3.7.2 (Issue 5): Group filter chips
  const groups = await getNoteGroups();
  let groupChipsHtml = '';
  if (groups.length > 0) {
    groupChipsHtml = '<div class="ngroups" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;overflow-x:auto;padding-bottom:2px">'
      + '<button class="ngroup-chip' + (currentNoteGroup === '' ? ' on' : '') + '" data-ngroup="" style="padding:4px 10px;border:1px solid var(--border);border-radius:999px;font-size:11px;background:' + (currentNoteGroup === '' ? 'var(--primary-soft)' : 'transparent') + ';color:' + (currentNoteGroup === '' ? 'var(--primary)' : 'var(--text-2)') + ';cursor:pointer;white-space:nowrap">Semua (' + currentNotes.filter(n => !n.archived).length + ')</button>'
      + groups.map(g => {
          const on = currentNoteGroup === g.name;
          return '<button class="ngroup-chip' + (on ? ' on' : '') + '" data-ngroup="' + esc(g.name) + '" style="padding:4px 10px;border:1px solid var(--border);border-radius:999px;font-size:11px;background:' + (on ? 'var(--primary-soft)' : 'transparent') + ';color:' + (on ? 'var(--primary)' : 'var(--text-2)') + ';cursor:pointer;white-space:nowrap">' + esc(g.name) + ' (' + g.count + ')</button>';
        }).join('')
      + '</div>';
  }
  if (!currentNotes.length) {
    list.innerHTML = groupChipsHtml + '<div class="notes-empty"><div class="big">📝</div>Belum ada catatan.<br><span style="font-size:11px">Klik <b>Catatan Baru</b> — tersimpan otomatis.</span></div>';
    bindGroupChips();
    return;
  }
  const sorted = notesSorted();
  if (!sorted.length) {
    list.innerHTML = groupChipsHtml + '<div class="notes-empty"><div class="big">📭</div>Tidak ada catatan di grup "' + esc(currentNoteGroup) + '".<br><span style="font-size:11px">Pilih grup lain atau buat catatan baru di grup ini.</span></div>';
    bindGroupChips();
    return;
  }
  list.innerHTML = groupChipsHtml + sorted.map(n => {
    const titleHtml = n.title ? '<div class="note-title">' + esc(n.title) + '</div>' : '';
    // v3.11.15: Preview yang lebih baik — ganti newline dengan spasi (bukan biarkan pre-wrap
    // yang bikin area kosong di kiri). Naikkan limit dari 200 → 400 karakter supaya context
    // lebih lengkap. CSS .note-body-txt pakai max-height:4.5em untuk clamp visual.
    const preview = (n.body || '').slice(0, 400).replace(/\s+/g, ' ').trim();
    const previewHtml = preview ? esc(preview) : '<em style="color:var(--muted)">(kosong)</em>';
    const groupTag = n.group ? '<span class="ngroup-tag">📁 ' + esc(n.group) + '</span>' : '';
    // v3.11.16 (Issue dari Google Doc): Hapus note-card-actions (3 tombol ✏️📦🗑️ yang muncul
    // saat hover) — bikin teks catatan sempit karena ada area kosong di kiri.
    // User: "bagian ijo nya itu di hilangkan, jadi teksnya bisa lebih lebar. kan udah ada toggle batch"
    // Sekarang: di non-batch mode, tidak ada elemen di kiri teks → teks full width.
    // Aksi individual tetap tersedia: klik note → buka editor (ada Hapus/Arsip/Pin di footer).
    // Aksi massal: pakai toggle batch (sudah ada).
    let batchHtml = '';
    if (notesBatchMode) {
      const checked = notesBatchSelected.has(n.id) ? ' checked' : '';
      batchHtml = '<div class="note-batch-wrap" style="flex-shrink:0;display:flex;align-items:center;padding-right:4px"><input type="checkbox" class="note-batch-check" data-nid="' + n.id + '"' + checked + ' style="width:16px;height:16px;cursor:pointer"></div>';
    }
    // v3.11.16: else branch dihapus — tidak ada note-card-actions lagi.
    return '<div class="note-card nc-' + (n.color || 'default') + '" data-nid="' + n.id + '"' + (notesBatchSelected.has(n.id) ? ' style="background:var(--primary-soft);border-color:var(--primary)"' : '') + '>'
      + batchHtml
      + '<div class="note-card-main">'
      + titleHtml
      + '<div class="note-body-txt">' + previewHtml + '</div>'
      + '<div class="note-meta">' + (n.pinned ? '<span class="pin">📌</span>' : '') + groupTag + '<span class="cdot"></span><span>' + timeAgo(n.updatedAt || n.createdAt) + '</span></div>'
      + '</div>'
      + '</div>';
  }).join('');
  list.querySelectorAll('.note-card').forEach(c => c.addEventListener('click', (e) => {
    // v3.9.0 (Issue 7): In batch mode, toggle selection instead of opening editor
    if (notesBatchMode) {
      const nid = c.dataset.nid;
      if (notesBatchSelected.has(nid)) notesBatchSelected.delete(nid);
      else notesBatchSelected.add(nid);
      updateNotesBatchCount();
      renderNotes();
      return;
    }
    // v3.11.16: note-act buttons sudah dihapus — klik note-card langsung buka editor.
    // Aksi Hapus/Arsip/Pin ada di footer editor. Aksi massal pakai toggle batch.
    openNoteEditor(c.dataset.nid);
  }));
  bindGroupChips();
}

// v3.9.0 (Issue 7): Quick action handler untuk note (dari list, tanpa buka editor)
// v3.11.16: DEPRECATED — note-card-actions sudah dihapus. Fungsi tetap dipertahankan
// untuk backward-compat (kalau ada kode lain yang panggil), tapi tidak digunakan lagi.
async function handleNoteQuickAction(action, noteId) {
  const n = currentNotes.find(x => x.id === noteId);
  if (!n) return;
  if (action === 'edit') {
    openNoteEditor(noteId);
  } else if (action === 'archive') {
    await updateNote(noteId, { archived: !n.archived, updatedAt: new Date().toISOString() });
    toast(n.archived ? '📤 Dikeluarkan dari arsip' : '📦 Catatan diarsipkan');
    await renderNotes();
  } else if (action === 'delete') {
    if (!confirm('Hapus catatan ini?')) return;
    await deleteNote(noteId);
    toast('🗑️ Catatan dihapus');
    await renderNotes();
  }
}
function bindGroupChips() {
  $$('.ngroup-chip').forEach(ch => ch.addEventListener('click', () => {
    currentNoteGroup = ch.dataset.ngroup || '';
    renderNotes();
  }));
}
async function newNote() {
  // v3.7.2 (Issue 5): Catatan baru otomatis masuk grup yang sedang difilter.
  const n = await addNote('', { color: 'yellow', pinned: false, group: currentNoteGroup || '' });
  await renderNotes();
  openNoteEditor(n.id);
}
function openNoteEditor(noteId) {
  editingNoteId = noteId;
  const n = currentNotes.find(x => x.id === noteId);
  if (!n) return;
  openPage('📝 Catatan');
  $('#pageBody').innerHTML =
    '<div class="card" style="margin-bottom:10px">'
    + '<input class="f" id="nTitle" value="' + esc(n.title || '') + '" placeholder="Judul (opsional) — dikosongkan pakai preview isi" style="margin-bottom:8px;font-weight:600">'
    + '<textarea class="f" id="nBody" rows="9" placeholder="Tulis catatan sementara di sini… (auto-save)" style="font-family:ui-monospace,Menlo,monospace;font-size:12.5px;line-height:1.55">' + esc(n.body || '') + '</textarea>'
    // v3.10.0 (Issue 5): Compose + Parafrase untuk catatan
    + '<div style="display:flex;gap:6px;margin-top:8px">'
    +   '<button class="btn btn-g" id="nCompose" title="AI generate catatan dari judul — bisa diulang" style="flex:1;padding:6px 8px;font-size:11px">✨ Compose dengan AI</button>'
    +   '<button class="btn btn-g" id="nParafrase" title="AI parafrase catatan — bisa diulang" style="flex:1;padding:6px 8px;font-size:11px">🔄 Parafrase</button>'
    + '</div>'
    + '</div>'
    + '<div class="card"><h3>Grup / Proyek</h3>'
    + '<input class="f" id="nGroup" value="' + esc(n.group || '') + '" placeholder="mis. Proyek A, Riset B (opsional)" style="margin-bottom:8px">'
    + '<div class="hintbox" style="font-size:11px">Catatan dengan nama grup yang sama akan terkumpul di filter grup di atas daftar.</div>'
    + '</div>'
    + '<div class="card"><h3>Warna</h3><div class="ndots">' + NCOLORS.map(c => '<button class="d-' + c + (n.color === c ? ' on' : '') + '" data-c="' + c + '" title="' + c + '"></button>').join('') + '</div></div>'
    + '<div class="hintbox">🕑 Terakhir disimpan: <b id="nMeta">' + timeAgo(n.updatedAt || n.createdAt) + '</b> · Catatan tersimpan lokal & ikut backup otomatis.</div>';
  // v3.11.7-fix (Issue #2 gap): Note editor footer konsisten dengan editor lain.
  // Sebelumnya: 5 tombol flex:none + spacer span flex:1 → di sidebar sempit, tombol
  // "Selesai" terdorong ke kanan ekstrim / wrap ke baris baru tidak rapi.
  // Sekarang: semua tombol flex:1 (rata konsisten), label dipendekkan supaya muat sidebar.
  $('#pageFoot').innerHTML =
    '<button class="btn btn-d" id="nDel">Hapus</button>'
    + '<button class="btn btn-g" id="nArchive">' + (n.archived ? '📤 Unarsip' : '📦 Arsip') + '</button>'
    + '<button class="btn btn-g" id="nPin">' + (n.pinned ? '📌 Lepas' : '📌 Pin') + '</button>'
    + '<button class="btn btn-g" id="nCopy">Salin</button>'
    + '<button class="btn btn-p" id="nDone">Selesai</button>';
  const ta = $('#nBody');
  const titleInput = $('#nTitle');
  const groupInput = $('#nGroup');
  function markSaved() {
    const st = $('#pageSaveState'); st.textContent = 'Tersimpan ✓'; st.classList.add('ok');
    renderNotes();
  }
  // v3.7.2 (Issue 5): Auto-save title + body + group dengan debounce yang sama.
  function scheduleSave() {
    const st = $('#pageSaveState'); st.textContent = 'Menyimpan…'; st.classList.remove('ok');
    clearTimeout(noteSaveTimer);
    noteSaveTimer = setTimeout(async () => {
      await updateNote(n.id, {
        title: titleInput.value.trim(),
        body: ta.value,
        group: groupInput.value.trim(),
        updatedAt: new Date().toISOString()
      });
      markSaved();
    }, 800);
  }
  ta.addEventListener('input', scheduleSave);
  titleInput.addEventListener('input', scheduleSave);
  groupInput.addEventListener('input', scheduleSave);
  $('#pageBody').querySelectorAll('.ndots button').forEach(d => {
    d.addEventListener('click', async () => {
      $('#pageBody').querySelectorAll('.ndots button').forEach(x => x.classList.remove('on'));
      d.classList.add('on');
      await updateNote(n.id, { color: d.dataset.c });
      markSaved();
    });
  });
  $('#nPin').addEventListener('click', async () => {
    await toggleNotePin(n.id);
    const updated = currentNotes.find(x => x.id === n.id);
    if (updated) updated.pinned = !updated.pinned;
    $('#nPin').textContent = updated.pinned ? '📌 Lepas pin' : '📌 Pin';
    markSaved();
    toast(updated.pinned ? '📌 Disematkan' : 'Pin dilepas');
  });

  // v3.10.0 (Issue 5): Compose + Parafrase untuk catatan
  $('#nCompose').addEventListener('click', async () => {
    const titleVal = ($('#nTitle').value || '').trim();
    if (!titleVal) { toast('Isi judul dulu, lalu klik Compose'); return; }
    const btn = $('#nCompose');
    const orig = btn.textContent;
    btn.textContent = '⏳ Composing...';
    btn.disabled = true;
    try {
      const { isAssistantConfigured, chatWithFallback } = await import('../lib/assistant.js');
      if (!(await isAssistantConfigured())) { toast('Setup AI Assistant dulu di Pengaturan'); return; }
      const sys = 'Anda adalah asisten yang menulis catatan yang rapi dan berguna. Berdasarkan judul, tulis catatan singkat (50-150 kata) dengan poin-poin penting. Jawab HANYA isinya.';
      let acc = '';
      const ta = $('#nBody');
      const resp = await chatWithFallback(
        [{ role: 'system', content: sys }, { role: 'user', content: 'Judul: "' + titleVal + '"\n\nTulis catatan.' }],
        { onToken: (t) => { acc += t; ta.value = acc; ta.dispatchEvent(new Event('input')); } }
      );
      if (!acc && resp?.content) { ta.value = resp.content; ta.dispatchEvent(new Event('input')); }
      toast('✨ Catatan di-generate. Klik lagi untuk varian lain.');
    } catch (e) { toast('Gagal compose: ' + e.message); }
    finally { btn.textContent = orig; btn.disabled = false; }
  });
  $('#nParafrase').addEventListener('click', async () => {
    const ta = $('#nBody');
    if (!ta || !ta.value.trim()) { toast('Isi catatan dulu, lalu klik Parafrase'); return; }
    const btn = $('#nParafrase');
    const orig = btn.textContent;
    btn.textContent = '⏳ Parafrase...';
    btn.disabled = true;
    try {
      const { isAssistantConfigured, chatWithFallback } = await import('../lib/assistant.js');
      if (!(await isAssistantConfigured())) { toast('Setup AI Assistant dulu di Pengaturan'); return; }
      const sys = 'Parafrase teks berikut agar lebih jelas, rapi, dan mudah dibaca. Pertahankan semua informasi penting. Jawab HANYA teks hasil parafrase.';
      let acc = '';
      const resp = await chatWithFallback(
        [{ role: 'system', content: sys }, { role: 'user', content: 'Teks asli:\n\n' + ta.value + '\n\nParafrase.' }],
        { onToken: (t) => { acc += t; ta.value = acc; ta.dispatchEvent(new Event('input')); } }
      );
      if (!acc && resp?.content) { ta.value = resp.content; ta.dispatchEvent(new Event('input')); }
      toast('🔄 Parafrase selesai. Klik lagi untuk varian lain.');
    } catch (e) { toast('Gagal parafrase: ' + e.message); }
    finally { btn.textContent = orig; btn.disabled = false; }
  });

  // v3.7.2 (Issue 5): Arsipkan catatan tanpa hapus (paralel dengan item vault).
  $('#nArchive').addEventListener('click', async () => {
    const updated = currentNotes.find(x => x.id === n.id);
    const newVal = !(updated?.archived);
    await updateNote(n.id, { archived: newVal });
    if (updated) updated.archived = newVal;
    $('#nArchive').textContent = newVal ? '📤 Unarsip' : '📦 Arsipkan';
    markSaved();
    toast(newVal ? '📦 Catatan diarsipkan' : '📤 Dikeluarkan dari arsip');
  });
  $('#nCopy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(n.body || ''); toast('📋 Catatan disalin'); }
    catch (e) { toast('Gagal salin', false); }
  });
  $('#nDone').addEventListener('click', async () => {
    const cur = currentNotes.find(x => x.id === n.id);
    if (cur && !cur.body?.trim() && !cur.title?.trim()) { await deleteNote(n.id); }
    await renderNotes();
    closePage();
  });
  $('#nDel').addEventListener('click', () => {
    openSheet('Hapus catatan?', 'Tidak bisa dibatalkan', b => {
      b.innerHTML = '<div class="confirmstrip"><span style="flex:1">Hapus catatan ini permanen?</span>'
        + '<button class="btn btn-g" data-c="0">Batal</button><button class="btn btn-d" data-c="1">Hapus</button></div>';
      b.querySelector('[data-c="0"]').addEventListener('click', closeSheet);
      b.querySelector('[data-c="1"]').addEventListener('click', async () => {
        await deleteNote(n.id);
        closeSheet(); await renderNotes(); closePage(); toast('Catatan dihapus');
      });
    });
  });
  setTimeout(() => ta.focus(), 200);
}

// ============ Tools drawer ============
const TOOLS = [
  ['shalat', 'Waktu Shalat', 'Muhammadiyah · countdown', ICONS.mosque],
  ['habits', 'Habits', 'Ngaji & olahraga harian', ICONS.heart],
  ['puasa', 'Puasa Sunnah', 'Kalender Islam & jadwal', ICONS.moonstar],
  ['volume', 'Penguat Volume', 'Hingga 600% per tab', ICONS.vol],
  ['kontrol', 'Kontrol Situs', 'Blocker + filter konten', ICONS.shield],
  ['aimanage', 'Kelola Situs AI', 'Pin/hide/tambah situs', ICONS.spark],  // v3.11.1 (Issue 4)
  ['cache', 'Bersihkan Cache', '9 tipe data · konfirmasi', ICONS.trash, 'warn'],
  ['askai', 'Tanya AI', 'Tanya soal teks terseleksi', ICONS.spark],
  ['gdrive', 'Sync Cloud', 'GDrive + Multi-PC sync', ICONS.cloud || '☁️'],   // v3.11.7-fix Issue #5: gabung GDrive + Multi-PC
  ['backup', 'Backup', 'Ekspor terenkripsi AES + GDrive', ICONS.archive],
  ['keys', 'Pintasan', 'Semua shortcut', ICONS.kb]
];
function renderTools() {
  $('#toolgrid').innerHTML = TOOLS.map(t => '<button class="tool' + (t[4] ? ' ' + t[4] : '') + '" data-tool="' + t[0] + '"><div class="tool-ic">' + t[3] + '</div><div><div class="tool-n">' + t[1] + '</div><div class="tool-d">' + t[2] + '</div></div></button>').join('');
  $$('#toolgrid .tool').forEach(t => t.addEventListener('click', () => toolPage(t.dataset.tool)));
}
function toolPage(k) {
  closeSheet();
  const names = { shalat: '🕌 Waktu Shalat', habits: '❤️ Kebiasaan', puasa: '🌙 Puasa Sunnah', volume: '🔊 Penguat Volume', kontrol: '🛡 Kontrol Situs', cache: '🗑 Bersihkan Cache', askai: '✨ Tanya AI', gdrive: '☁️ Sync Cloud (GDrive + Multi-PC)', backup: '📦 Cadangkan & Pulihkan', keys: '⌨️ Pintasan Keyboard', aimanage: '⚙️ Kelola Situs AI' };
  openPage(names[k] || 'Alat');
  const B = $('#pageBody');
  if (k === 'shalat') renderShalatPage(B);
  else if (k === 'habits') renderHabitsPage(B);
  else if (k === 'puasa') renderPuasaPage(B);
  else if (k === 'volume') renderVolumePage(B);
  else if (k === 'cache') renderCachePage(B);
  else if (k === 'gdrive') renderGDrivePage(B);   // v3.8.1 Issue #1+#2+#6
  else if (k === 'keys') renderKeysPage(B);
  else if (k === 'kontrol') renderKontrolSitusPage(B);
  else if (k === 'aimanage') renderAiManagePage(B);  // v3.11.1 (Issue 4)
  else renderToolStubPage(B, k, names[k]);
}
function renderShalatPage(B) {
  const s = currentVault?.settings || {};
  if (!s.prayerEnabled || typeof s.prayerLatitude !== 'number') {
    B.innerHTML = '<div class="card" style="text-align:center;padding:26px 16px"><div style="font-size:30px;margin-bottom:8px">🕌</div>'
      + '<div style="font-size:12.5px;color:var(--text-2);line-height:1.55;max-width:250px;margin:0 auto 14px">Aktifkan jadwal shalat harian dengan metode Muhammadiyah (Subuh -18°, Isya -18°).</div>'
      + '<button class="btn btn-p" id="shSetup">Setup Sekarang</button></div>';
    $('#shSetup').addEventListener('click', openPrayerSetup);
    return;
  }
  const times = prayerTimesCache || s.prayerCachedTimes;
  const next = times ? getNextPrayerIncludingSunnah(times.timings) : null;
  const fmt = s.prayerTimeFormat === '12h' ? to12Hour : (t) => t;
  const countdown = next ? formatCountdown(next.minutesUntil) : '—';
  // v3.4: Ambil daftar sholat sunnah dari library
  const sunnahs = times ? (getSunnahPrayers(times.timings) || []) : [];
  // Bangun kartu sholat sunnah
  const sunnahCard = sunnahs.length > 0
    ? '<div class="card"><h3>🌟 Sholat Sunnah (' + sunnahs.length + ')</h3>'
      + '<div class="hintbox" style="margin-bottom:8px;font-size:10.5px;line-height:1.5">Waktu mustahab — dianjurkan, bukan wajib. Pahala berlipat bila diamalkan secara konsisten.</div>'
      + sunnahs.map(function (sn) {
          // Highlight kalau sunnah ini adalah next prayer
          const isNextSunnah = next && next.isSunnah && next.name === sn.name;
          return '<div class="rf-sunnah-row' + (isNextSunnah ? ' next' : '') + '">'
            + '<div class="rf-sunnah-main">'
            +   '<span class="rf-sunnah-icon">' + sn.icon + '</span>'
            +   '<div>'
            +     '<div class="rf-sunnah-name">' + esc(sn.name) + (isNextSunnah ? ' · berikutnya' : '') + '</div>'
            +     '<div class="rf-sunnah-desc">' + esc(sn.desc) + '</div>'
            +   '</div>'
            + '</div>'
            + '<div class="rf-sunnah-time">' + fmt(sn.time) + '</div>'
          + '</div>';
        }).join('')
      + '</div>'
    : '';
  B.innerHTML = '<div class="card" style="background:linear-gradient(135deg,#065f46,#047857);color:#ecfdf5;border:none">'
    + '<div style="font-size:11px;opacity:.85">' + esc(s.prayerLocation || 'Lokasi') + ' · ' + (times?.date || '') + '</div>'
    + '<div style="font-size:26px;font-weight:750;margin:6px 0 2px;letter-spacing:-.02em">' + (next ? (next.isSunnah ? '🌟 ' : '') + next.name + ' ' + fmt(next.time) : '—') + '</div>'
    + '<div style="font-size:12px;opacity:.9">' + (next ? '−' + countdown + (next.isToday ? '' : ' (besok)') : '') + '</div></div>'
    + '<div class="card"><h3>6 waktu · metode Muhammadiyah (−18°/−18°)</h3>'
    + (times ? [['Subuh', times.timings.Fajr, 'Fajr'], ['Terbit', times.timings.Sunrise, 'Sunrise'], ['Dzuhur', times.timings.Dhuhr, 'Dhuhr'], ['Ashar', times.timings.Asr, 'Asr'], ['Magrib', times.timings.Maghrib, 'Maghrib'], ['Isya', times.timings.Isha, 'Isha']].map(p => {
      const isNext = next && next.key === p[2];
      return '<div class="krow" style="padding:5px 0' + (isNext ? ';color:var(--green);font-weight:700' : '') + '"><span>' + p[0] + '</span><span>' + fmt(p[1]) + '</span></div>';
    }).join('') : '<div style="color:var(--muted);font-size:11px">Memuat…</div>') + '</div>'
    + sunnahCard
    + '<div class="btn-row"><button class="btn btn-g" id="shRefresh">Refresh</button><button class="btn btn-p" id="shSetup">Ubah Lokasi</button></div>';
  $('#shRefresh').addEventListener('click', async () => {
    await saveSettings({ prayerCachedTimes: null });
    await refreshVault();
    await updatePrayerStrip();
    toolPage('shalat');
    toast('Jadwal diperbarui ✓');
  });
  $('#shSetup').addEventListener('click', openPrayerSetup);
}
async function renderHabitsPage(B) {
  const s = currentVault?.settings || {};
  let qStatus = null, eStatus = null, habits = null;
  try { if (s.quranEnabled !== false) qStatus = await getQuranStatus(s); } catch (e) {}
  try { if (s.exerciseEnabled !== false) eStatus = await getExerciseStatus(s); } catch (e) {}
  try { habits = await getHabits(); } catch (e) {}

  // Today's date + hijri
  const today = new Date();
  const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const monthNames = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const todayStr = dayNames[today.getDay()] + ', ' + today.getDate() + ' ' + monthNames[today.getMonth()];
  const cachedHijri = currentVault?.settings?.prayerCachedTimes?.hijri;
  const hijriStr = cachedHijri ? (parseHijriString(cachedHijri) ? (parseInt(parseHijriString(cachedHijri).day,10) + ' ' + HIJRI_MONTHS[parseInt(parseHijriString(cachedHijri).month.number,10)-1] + ' ' + parseHijriString(cachedHijri).year + ' H') : cachedHijri) : '';

  const qTarget = s.quranTargetPages || 1;
  const qToday = qStatus?.todayPages || 0;
  const qProgress = Math.min(100, Math.round((qToday / qTarget) * 100));
  const qStreak = qStatus?.streak || 0;

  const eTarget = 30; // minutes (default)
  const eToday = (eStatus?.todayCount || 0) * 5; // each count = 5 min
  const eProgress = Math.min(100, Math.round((eToday / eTarget) * 100));
  const eWeekCount = (() => {
    if (!habits?.exerciseLog) return 0;
    const now = new Date();
    let count = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0,10);
      if (habits.exerciseLog[key] && habits.exerciseLog[key] > 0) count++;
    }
    return count;
  })();

  // Build weekly schedule grid
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - today.getDay()); // Sunday start
  let weekHtml = '';
  const dayShort = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart); d.setDate(weekStart.getDate() + i);
    const dStr = d.toISOString().slice(0,10);
    const isToday = dStr === today.toISOString().slice(0,10);
    const qDone = habits?.quranLog?.[dStr] >= qTarget;
    const eDone = (habits?.exerciseLog?.[dStr] || 0) > 0;
    const icons = (qDone ? '📖' : '') + (eDone ? '🏃' : '');
    const lbl = isToday ? 'Hari ini' : (icons || '—');
    weekHtml += '<div class="habit-day' + (isToday ? ' today' : '') + (qDone || eDone ? ' done' : '') + '">'
      + '<b>' + dayShort[i] + ' ' + d.getDate() + '</b>'
      + '<i>' + (icons || '·') + '</i>'
      + '<span>' + lbl + '</span></div>';
  }

  B.innerHTML =
    '<div class="habits-date"><b>Hari ini · ' + esc(todayStr) + '</b>' + (hijriStr ? '<span>' + esc(hijriStr) + '</span>' : '') + '</div>'

    // Quran habit card
    + '<section class="habit-card">'
    +   '<div class="habit-card-top">'
    +     '<div class="habit-ic quran">📖</div>'
    +     '<div class="habit-title"><b>Ngaji</b><span>Target ' + qTarget + ' halaman · setelah Maghrib</span></div>'
    +     '<span class="habit-status' + (qStatus?.isComplete ? ' done' : '') + '" id="quranStatus">' + (qStatus?.isComplete ? 'SELESAI' : 'BELUM') + '</span>'
    +   '</div>'
    +   '<div class="habit-details">'
    +     '<div class="habit-plan"><div><b>Rencana hari ini</b><br><span>' + qTarget + ' halaman · ±' + (qTarget * 10) + ' menit</span></div><span id="quranProgress">' + qToday + ' / ' + qTarget + ' hal</span></div>'
    +     '<div class="habit-progress"><i id="quranBar" style="width:' + qProgress + '%"></i></div>'
    +     '<div class="habit-actions">'
    +       '<button class="habit-action" id="quranMinus">− 1 hal</button>'
    +       '<button class="habit-action main" id="quranPlus">+ 1 halaman</button>'
    +       '<span class="counter" id="quranCounter">' + qToday + ' hal dicatat</span>'
    +     '</div>'
    +   '</div>'
    + '</section>'

    // Sport habit card
    + '<section class="habit-card sport">'
    +   '<div class="habit-card-top">'
    +     '<div class="habit-ic sport">🏃</div>'
    +     '<div class="habit-title"><b>Olahraga</b><span>Jalan cepat · ' + eTarget + ' menit · setelah Asar</span></div>'
    +     '<span class="habit-status' + (eToday >= eTarget ? ' done' : '') + '" id="sportStatus">' + (eToday >= eTarget ? 'SELESAI' : 'BELUM') + '</span>'
    +   '</div>'
    +   '<div class="habit-details">'
    +     '<div class="habit-plan"><div><b>Rencana hari ini</b><br><span>Jalan cepat · ' + eTarget + ' menit · 16.30</span></div><span id="sportProgress">' + eToday + ' / ' + eTarget + ' mnt</span></div>'
    +     '<div class="habit-progress"><i id="sportBar" style="width:' + eProgress + '%"></i></div>'
    +     '<div class="habit-actions">'
    +       '<button class="habit-action" id="sportMinus">− 5 mnt</button>'
    +       '<button class="habit-action main" id="sportPlus">+ 5 menit</button>'
    +       '<span class="counter" id="sportCounter">' + eToday + ' mnt dicatat</span>'
    +     '</div>'
    +   '</div>'
    + '</section>'

    // Weekly schedule
    + '<section class="habit-week">'
    +   '<div class="habit-week-h"><div><b>Rencana minggu ini</b><span>Streak dihitung per kebiasaan, bukan dicampur</span></div><span>' + (weekStart.getDate()) + '–' + (today.getDate()) + ' ' + monthNames[weekStart.getMonth()].slice(0,3) + '</span></div>'
    +   '<div class="habit-week-grid">' + weekHtml + '</div>'
    + '</section>'

    // Insights
    + '<section class="habit-insight">'
    +   '<div class="habit-metric"><span>Streak ngaji</span><b>' + qStreak + ' hari</b><small>Target: setiap hari</small></div>'
    +   '<div class="habit-metric"><span>Olahraga minggu ini</span><b>' + eWeekCount + ' / 3</b><small>Target: 3 sesi × ' + eTarget + ' menit</small></div>'
    + '</section>'

    // Settings drawer
    + '<details class="habit-setting"><summary>⚙ Atur kebiasaan dan jadwal</summary><div class="habit-config">'
    +   '<div class="habit-config-row"><div><b>Target ngaji</b><span>Ukuran paling sederhana: halaman</span></div><select id="quranTargetSel">'
    +     [1,2,4].map(n => '<option value="' + n + '"' + (n === qTarget ? ' selected' : '') + '>' + n + ' halaman / hari</option>').join('')
    +   '</select></div>'
    +   '<div class="habit-config-row"><div><b>Waktu ngaji</b><span>Hanya sebagai pengingat, bukan batas</span></div><input id="quranTimeInput" type="time" value="' + esc(s.quranReminderTime || '18:15') + '"></div>'
    +   '<div class="habit-config-row"><div><b>Jenis olahraga</b><span>Pilih aktivitas favorit</span></div><select id="sportTypeSel">'
    +     ['Jalan cepat', 'Lari', 'Bersepeda', 'Latihan kekuatan', 'Peregangan / yoga'].map(n => '<option>' + n + '</option>').join('')
    +   '</select></div>'
    +   '<div class="habit-config-row"><div><b>Target olahraga</b><span>Durasi per sesi</span></div><select id="sportTargetSel">'
    +     [20,30,45,60].map(n => '<option value="' + n + '"' + (n === eTarget ? ' selected' : '') + '>' + n + ' menit</option>').join('')
    +   '</select></div>'
    +   '<div class="habit-save"><button class="habit-action main" id="saveHabitPlan">Simpan rencana</button></div>'
    + '</div></details>'

    + '<p class="hintbox" style="margin:15px 3px"><b>Prinsip desain:</b> target ngaji diukur dengan halaman; olahraga diukur dengan jenis aktivitas dan menit. Keduanya punya progres dan streak sendiri agar pengguna tahu mana yang konsisten tanpa memberi tekanan dari target yang terlalu rumit.</p>';

  // Bind actions
  $('#quranPlus').addEventListener('click', async () => {
    await logQuranPages(1, s);
    await refreshVault();
    await updateHabitsStrip();
    renderHabitsPage(B);
    toast('📖 1 halaman ngaji dicatat');
  });
  $('#quranMinus').addEventListener('click', async () => {
    await logQuranPages(-1, s);
    await refreshVault();
    await updateHabitsStrip();
    renderHabitsPage(B);
  });
  $('#sportPlus').addEventListener('click', async () => {
    await logExerciseDone(s);
    await refreshVault();
    await updateHabitsStrip();
    renderHabitsPage(B);
    toast('🏃 5 menit olahraga dicatat');
  });
  $('#sportMinus').addEventListener('click', async () => {
    // Decrement exercise count (need custom logic — logExerciseDone only increments)
    // For now: noop if 0, else decrement via direct storage
    try {
      const today = new Date().toISOString().slice(0,10);
      const h = await getHabits();
      if (h.exerciseLog?.[today] > 0) {
        h.exerciseLog[today]--;
        const { saveHabits } = await import('../lib/habits.js');
        await saveHabits(h);
        await refreshVault();
        await updateHabitsStrip();
        renderHabitsPage(B);
      }
    } catch (e) {}
  });
  $('#saveHabitPlan').addEventListener('click', async () => {
    const newTarget = parseInt($('#quranTargetSel').value, 10) || 1;
    const newTime = $('#quranTimeInput').value || '18:15';
    await saveSettings({ quranTargetPages: newTarget, quranReminderTime: newTime });
    await refreshVault();
    renderHabitsPage(B);
    toast('✓ Rencana habit disimpan');
  });
}
async function renderPuasaPage(B) {
  // Get hijri date from cached prayer times, or fall back to approximating
  const cachedHijri = currentVault?.settings?.prayerCachedTimes?.hijri;
  let hijriToday = cachedHijri ? parseHijriString(cachedHijri) : null;
  // If no prayer data, we can't reliably compute hijri dates — show notice
  if (!hijriToday) {
    B.innerHTML = '<div class="card" style="text-align:center;padding:26px 16px"><div style="font-size:30px;margin-bottom:8px">🌙</div>'
      + '<div style="font-size:12.5px;color:var(--text-2);line-height:1.55;max-width:280px;margin:0 auto 14px">Aktifkan <b>Waktu Shalat</b> dulu untuk mendapat tanggal Hijriah akurat dari Aladhan API. Kalender puasa butuh data Hijriah untuk menandai hari Ayyamul Bidh, Asyura, Arafah, dll.</div>'
      + '<button class="btn btn-p" id="puasaGoShalat">Aktifkan Waktu Shalat</button></div>';
    $('#puasaGoShalat').addEventListener('click', () => {
      $('#tabTools').click();
      setTimeout(() => document.querySelector('[data-tool="shalat"]')?.click(), 100);
    });
    return;
  }

  // Calendar state — start from current month
  let viewYear = new Date().getFullYear();
  let viewMonth = new Date().getMonth();
  let selectedDate = new Date();
  selectedDate.setHours(0,0,0,0);

  function renderCalendar() {
    const today = new Date();
    today.setHours(0,0,0,0);
    const monthNames = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

    // Compute first day of month + days in month
    const firstDay = new Date(viewYear, viewMonth, 1);
    const lastDay = new Date(viewYear, viewMonth + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startWeekday = firstDay.getDay(); // 0=Sun

    // Build hijri lookup for each day of this month (increment from today's hijri)
    const hijriDayToday = parseInt(hijriToday.day, 10);
    const hijriMonthToday = parseInt(hijriToday.month?.number || 0, 10);
    const hijriYearToday = parseInt(hijriToday.year || 0, 10);
    const todayDate = today.getDate();
    const todayMonthIdx = today.getMonth();
    const todayYear = today.getFullYear();

    function getHijriForDate(d) {
      // Calculate days diff from today
      const dateObj = new Date(d);
      const diffDays = Math.round((dateObj - today) / (24*60*60*1000));
      let hDay = hijriDayToday + diffDays;
      let hMonth = hijriMonthToday;
      let hYear = hijriYearToday;
      while (hDay > 30) { hDay -= 30; hMonth++; if (hMonth > 12) { hMonth = 1; hYear++; } }
      while (hDay < 1) { hMonth--; if (hMonth < 1) { hMonth = 12; hYear--; } hDay += 30; }
      return { day: String(hDay), month: { number: String(hMonth), en: HIJRI_MONTHS[hMonth-1] }, year: String(hYear) };
    }

    // Build day cells
    let daysHtml = '';
    // Leading blanks
    for (let i = 0; i < startWeekday; i++) daysHtml += '<div class="puasa-day blank"></div>';
    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(viewYear, viewMonth, d);
      dateObj.setHours(0,0,0,0);
      const isToday = dateObj.getTime() === today.getTime();
      const isSelected = dateObj.getTime() === selectedDate.getTime();
      const weekday = dateObj.getDay();
      const isMonday = weekday === 1;
      const isThursday = weekday === 4;
      const hijri = getHijriForDate(dateObj);
      const hijriDay = parseInt(hijri.day, 10);
      const isBidh = hijriDay === 13 || hijriDay === 14 || hijriDay === 15;
      const isSpecial = (parseInt(hijri.month.number,10) === 1 && (hijriDay === 9 || hijriDay === 10))
                     || (parseInt(hijri.month.number,10) === 12 && hijriDay === 9)
                     || (parseInt(hijri.month.number,10) === 10 && hijriDay >= 1 && hijriDay <= 6);

      let classes = 'puasa-day';
      if (isMonday || isThursday) classes += ' monday';
      if (isThursday) classes += ' thursday';
      if (isBidh) classes += ' bidh-day';
      if (isSelected) classes += ' selected';
      if (isToday) classes += ' today';

      let dots = '';
      if (isMonday || isThursday) dots += '<div class="dot"></div>';
      if (isBidh) dots += '<div class="dot bidh"></div>';
      if (isSpecial) dots += '<div class="dot special"></div>';

      daysHtml += '<div class="' + classes + '" data-date="' + viewYear + '-' + String(viewMonth+1).padStart(2,'0') + '-' + String(d).padStart(2,'0') + '">'
        + '<span class="date">' + d + '</span>'
        + '<span class="hijri">' + hijriDay + '</span>'
        + '<div class="dots">' + dots + '</div>'
        + '</div>';
    }

    // Get today's fast info
    const todayFast = getSunnahFast(hijriToday, today);

    // Selected day info
    const selHijri = getHijriForDate(selectedDate);
    const selFast = getSunnahFast(selHijri, selectedDate);
    const selDayName = ['Ahad', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'][selectedDate.getDay()];
    const selDateStr = selectedDate.getDate() + ' ' + monthNames[selectedDate.getMonth()] + ' ' + selectedDate.getFullYear();
    const selHijriStr = parseInt(selHijri.day,10) + ' ' + HIJRI_MONTHS[parseInt(selHijri.month.number,10)-1] + ' ' + selHijri.year + ' H';
    const selInfoHtml = selFast
      ? '<b>' + selDateStr + ' · ' + selHijriStr + '</b><span>' + esc(selDayName) + ' · ' + esc(selFast.name) + ' — ' + esc(selFast.desc || '') + '</span>'
      : '<b>' + selDateStr + ' · ' + selHijriStr + '</b><span>' + esc(selDayName) + ' · Tidak ada jadwal puasa sunnah khusus.</span>';

    // Compute hijri month range for header
    const firstHijri = getHijriForDate(firstDay);
    const lastHijri = getHijriForDate(lastDay);
    const hijriRange = parseInt(firstHijri.day,10) + ' ' + HIJRI_MONTHS[parseInt(firstHijri.month.number,10)-1] + ' – ' + parseInt(lastHijri.day,10) + ' ' + HIJRI_MONTHS[parseInt(lastHijri.month.number,10)-1] + ' ' + lastHijri.year + ' H';

    // Upcoming fasts (14 days)
    const fasts = getUpcomingFasts(hijriToday, today, 14);

    B.innerHTML =
      // Today card
      '<div class="puasa-today"><div class="moon">☾</div><div><b>Hari ini · ' + ['Ahad','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'][today.getDay()] + ', ' + today.getDate() + ' ' + monthNames[today.getMonth()] + ' ' + today.getFullYear() + '</b>'
      + '<span>' + parseInt(hijriToday.day,10) + ' ' + HIJRI_MONTHS[parseInt(hijriToday.month.number,10)-1] + ' ' + hijriToday.year + ' H · '
      + (todayFast ? esc(todayFast.name) + ' — ' + esc(todayFast.desc || '') : 'Tidak ada puasa sunnah khusus hari ini')
      + '</span></div></div>'

      // Upcoming fasts card
      + '<section class="puasa-card"><div class="puasa-card-title">Jadwal 14 hari ke depan</div>'
      + (fasts && fasts.length ? fasts.slice(0, 5).map(f => {
          const dayLabel = f.isToday ? 'Hari ini' : (f.isTomorrow ? 'Besok' : f.daysAhead + ' hari lagi');
          const cls = f.daysAhead <= 2 ? 'puasa-pill soon' : 'puasa-pill';
          const fDate = f.date instanceof Date ? f.date : new Date(f.date);
          return '<div class="puasa-next"><div><div class="puasa-next-name">' + esc(f.name) + '</div>'
            + '<div class="puasa-next-detail">' + ['Ahad','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'][fDate.getDay()] + ', ' + fDate.getDate() + ' ' + monthNames[fDate.getMonth()].slice(0,3) + ' · ' + esc(f.hijriDate || '') + '</div></div>'
            + '<span class="' + cls + '">' + dayLabel + '</span></div>';
        }).join('') : '<div style="color:var(--muted);font-size:11px;padding:8px 0">Tidak ada puasa sunnah dalam 14 hari.</div>')
      + '</section>'

      // Calendar card
      + '<section class="puasa-card puasa-cal-card">'
      +   '<div class="puasa-cal-head"><div><b>' + monthNames[viewMonth] + ' ' + viewYear + '</b><span>' + hijriRange + '</span></div>'
      +     '<div class="puasa-nav"><button id="puasaPrev" aria-label="Bulan sebelumnya">‹</button><button id="puasaNext" aria-label="Bulan berikutnya">›</button></div>'
      +   '</div>'
      +   '<div class="puasa-weekrow"><span>Min</span><span>Sen</span><span>Sel</span><span>Rab</span><span>Kam</span><span>Jum</span><span>Sab</span></div>'
      +   '<div class="puasa-days">' + daysHtml + '</div>'
      +   '<div class="puasa-legend">'
      +     '<span><i style="background:var(--green)"></i>Senin / Kamis</span>'
      +     '<span><i style="background:var(--amber)"></i>Ayyamul Bidh</span>'
      +     '<span><i style="background:var(--violet)"></i>Puasa khusus</span>'
      +   '</div>'
      +   '<div class="puasa-selected-info">' + selInfoHtml + '</div>'
      + '</section>'

      // Year summary
      + '<section><div class="puasa-card-title" style="margin:2px 0 10px">Penanda khusus tahun ' + viewYear + '</div>'
      +   '<div class="puasa-year-summary">'
      +     '<div class="puasa-event"><b>9–10 Muharram · Tasu\'a & Asyura</b><span>Puasa penghapusan dosa setahun (HR Muslim) — ditandai ungu</span></div>'
      +     '<div class="puasa-event"><b>13–15 setiap bulan Hijriah</b><span>Ayyamul Bidh — ditandai kuning</span></div>'
      +     '<div class="puasa-event"><b>Setiap Senin & Kamis</b><span>Puasa sunnah mingguan — ditandai hijau</span></div>'
      +     '<div class="puasa-event"><b>6 hari Syawal & 9 Zulhijah</b><span>Tampil saat bulan terkait dipilih</span></div>'
      +   '</div>'
      + '</section>'

      + '<p class="hintbox" style="margin:15px 3px"><b>Catatan kalender:</b> penanggalan Hijriah dapat berbeda ±1 hari sesuai rukyat/isbat resmi Indonesia. Rancangan ini memakai acuan dari Aladhan API; cek keputusan Kemenag untuk penetapan ibadah yang bergantung pada tanggal.</p>';

    // Bind nav
    $('#puasaPrev').addEventListener('click', () => {
      viewMonth--;
      if (viewMonth < 0) { viewMonth = 11; viewYear--; }
      renderCalendar();
    });
    $('#puasaNext').addEventListener('click', () => {
      viewMonth++;
      if (viewMonth > 11) { viewMonth = 0; viewYear++; }
      renderCalendar();
    });

    // Bind day clicks
    $$('.puasa-day[data-date]').forEach(el => {
      el.addEventListener('click', () => {
        const [y, m, d] = el.dataset.date.split('-').map(n => parseInt(n, 10));
        selectedDate = new Date(y, m - 1, d);
        selectedDate.setHours(0,0,0,0);
        renderCalendar();
      });
    });
  }

  renderCalendar();
}
async function renderVolumePage(B) {
  let res;
  try { res = await browser.runtime.sendMessage({ type: 'VOLUME_GET' }); } catch (e) { res = { ok: false }; }
  if (!res?.ok) {
    B.innerHTML = '<div class="card" style="text-align:center;padding:20px"><div style="font-size:26px;margin-bottom:6px">🔊</div><div style="font-size:12px;color:var(--muted)">Buka halaman web (http/https) untuk kontrol volume.</div></div>';
    return;
  }
  const dB = res.dB || 0;
  const pct = dbToPercent(dB);
  B.innerHTML = '<div class="card"><div class="vol-pct" id="vPct">' + Math.round(pct) + '%</div><div class="vol-sub">Volume tab aktif · ' + esc(res.domain || 'global') + '</div>'
    + '<input type="range" id="vRange" min="' + MIN_DB + '" max="' + MAX_DB + '" step="1" value="' + dB + '">'
    + '<div class="btn-row" style="margin-top:10px"><button class="btn btn-g" id="vMute">🔇 Mute</button><button class="btn btn-g" id="vReset">↺ Reset 100%</button></div></div>'
    + '<div class="hintbox">⚡ Shortcut: <kbd>Alt+Shift+↑</kbd> <kbd>Alt+Shift+↓</kbd> <kbd>Alt+Shift+0</kbd> — tanpa buka popup.</div>';
  const r = $('#vRange');
  let t = null;
  r.addEventListener('input', () => {
    const newDb = parseInt(r.value, 10);
    $('#vPct').textContent = Math.round(dbToPercent(newDb)) + '%';
    clearTimeout(t);
    t = setTimeout(() => browser.runtime.sendMessage({ type: 'VOLUME_SET', dB: newDb }), 300);
  });
  $('#vMute').addEventListener('click', async () => {
    r.value = -40;
    $('#vPct').textContent = '0%';
    await browser.runtime.sendMessage({ type: 'VOLUME_SET', dB: -40 });
    toast('Tab di-mute');
  });
  $('#vReset').addEventListener('click', async () => {
    r.value = 0;
    $('#vPct').textContent = '100%';
    await browser.runtime.sendMessage({ type: 'VOLUME_SET', dB: 0 });
    toast('Volume direset ke 100%');
  });
}
function renderCachePage(B) {
  const s = currentVault?.settings || {};
  const types = ['Cache', 'Cookies', 'Riwayat', 'Local Storage', 'Downloads'];
  B.innerHTML = '<div class="card"><h3>Tipe data</h3>'
    + types.map((x, i) => '<label class="checkrow"><input type="checkbox" data-cache="' + x.toLowerCase().replace(' ', '_') + '"' + (i === 0 ? ' checked' : '') + '>' + x + '</label>').join('')
    + '<label class="checkrow" style="color:var(--danger)"><input type="checkbox" data-cache="passwords">Passwords ⚠️</label></div>'
    + '<div class="card"><h3>Periode</h3><select class="f" id="cachePeriod"><option value="all">Semua waktu</option><option value="15m">15 menit terakhir</option><option value="1h">1 jam terakhir</option><option value="24h">24 jam terakhir</option><option value="1w">1 minggu terakhir</option></select></div>'
    + '<button class="btn btn-d" style="width:100%" id="cacheGo">' + ICONS.trash + 'Bersihkan Sekarang</button>';
  $('#cacheGo').addEventListener('click', () => {
    openSheet('Konfirmasi', 'Aksi ini tidak bisa dibatalkan', b => {
      b.innerHTML = '<div class="confirmstrip"><span style="flex:1">Hapus data browsing terpilih?</span>'
        + '<button class="btn btn-g" data-c="0">Batal</button><button class="btn btn-d" data-c="1">Ya, bersihkan</button></div>';
      b.querySelector('[data-c="0"]').addEventListener('click', closeSheet);
      b.querySelector('[data-c="1"]').addEventListener('click', async () => {
        closeSheet();
        try {
          const res = await browser.runtime.sendMessage({ type: 'CLEAR_CACHE' });
          if (res?.ok) toast('🗑 Cache dibersihkan ✓ · tab dimuat ulang');
          else toast('Gagal: ' + (res?.error || ''), false);
        } catch (e) { toast('Error: ' + e.message, false); }
      });
    });
  });
}
function renderKeysPage(B) {
  B.innerHTML = '<div class="card"><h3>Shortcut global</h3><div class="klist">'
    + [['Buka / tutup sidebar', ['Alt', 'Shift', '4']], ['Simpan teks terseleksi', ['Alt', 'Shift', '2']], ['Snapshot chat AI', ['Alt', 'Shift', '3']], ['Screenshot (pilih mode)', ['Alt', 'Shift', '5']], ['Screenshot area (seret kotak)', ['Alt', 'Shift', '6']], ['Screenshot viewport', ['Alt', 'Shift', '7']], ['Clear cache', ['Alt', 'Shift', 'C']], ['Volume naik', ['Alt', 'Shift', '↑']], ['Volume turun', ['Alt', 'Shift', '↓']], ['Volume reset', ['Alt', 'Shift', '0']], ['Fokus pencarian', ['/']]].map(r => '<div class="krow"><span class="kl">' + r[0] + '</span><span>' + r[1].map(x => '<kbd>' + x + '</kbd>').join(' ') + '</span></div>').join('')
    + '</div></div>'
    + '<div class="hintbox">💡 <b>Screenshot area</b> paling berguna untuk ambil cuplikan UI saat troubleshooting atau membuat dokumentasi. Bisa diulang beberapa kali untuk beberapa contoh berbeda.</div>';
}
function renderToolStubPage(B, k, name) {
  // v3.7: Halaman stub sekarang punya UI yang lebih kaya untuk Backup & Tanya AI
  if (k === 'backup') {
    renderBackupPage(B);
    return;
  }
  if (k === 'askai') {
    renderAskAiPage(B);
    return;
  }
  // Untuk tipe lain (kalau ada), pakai stub lama
  const desc = {};
  B.innerHTML = '<div class="card" style="text-align:center;padding:26px 16px"><div style="font-size:30px;margin-bottom:8px">' + (name || '🛠').split(' ')[0] + '</div>'
    + '<div style="font-size:12.5px;color:var(--text-2);line-height:1.55;max-width:250px;margin:0 auto 14px">' + (desc[k] || '') + '</div>'
    + '<button class="btn btn-p" id="goSettings">Buka di Pengaturan</button></div>';
  $('#goSettings').addEventListener('click', () => browser.runtime.openOptionsPage());
}

// v3.11.1 (Issue 4): Halaman "Kelola Situs AI"
// User bisa: pin/unpin, hide/unhide, add custom site, delete custom site.
// Set perubahan disimpan di settings.aiToolsCustomizations.
async function renderAiManagePage(B) {
  const s = currentVault?.settings || {};
  const customizations = s.aiToolsCustomizations || {};
  const allTools = getEffectiveTools(customizations);

  const render = () => {
    const currentCust = (currentVault?.settings?.aiToolsCustomizations) || {};
    const tools = getEffectiveTools(currentCust);
    const pinned = tools.filter(t => t.pinned && !t.hidden);
    const visible = tools.filter(t => !t.pinned && !t.hidden);
    const hidden = tools.filter(t => t.hidden);
    const custom = tools.filter(t => t.custom);

    const row = (t) => {
      const pinnedBtn = t.pinned
        ? '<button class="btn btn-g ai-action-btn ai-unpin" data-id="' + esc(t.id) + '" data-act="unpin" title="Lepas pin" style="background:var(--amber-soft);color:var(--amber);border-color:transparent">⭐ Unpin</button>'
        : '<button class="btn btn-g ai-action-btn ai-pin" data-id="' + esc(t.id) + '" data-act="pin" title="Pin ke atas">☆ Pin</button>';
      const hideBtn = '<button class="btn btn-g ai-action-btn ai-hide" data-id="' + esc(t.id) + '" data-act="hide" title="Sembunyikan dari daftar">👁️ Hide</button>';
      const deleteBtn = t.custom
        ? '<button class="btn btn-d ai-action-btn ai-delete" data-id="' + esc(t.id) + '" data-act="delete" title="Hapus permanen">🗑️</button>'
        : '';
      const customBadge = t.custom ? ' <span style="font-size:9px;background:var(--violet-soft);color:var(--violet);padding:1px 5px;border-radius:4px;font-weight:700;margin-left:4px">CUSTOM</span>' : '';
      const pinnedBadge = t.pinned ? ' <span style="color:var(--amber)">⭐</span>' : '';
      return '<div class="ai-mgmt-row" data-id="' + esc(t.id) + '">'
        + '<div class="ai-mgmt-ic">' + (t.emoji || '🤖') + '</div>'
        + '<div class="ai-mgmt-main">'
        + '<div class="ai-mgmt-name">' + esc(t.name) + customBadge + pinnedBadge + '</div>'
        + '<div class="ai-mgmt-url">' + esc(t.url) + '</div>'
        + '</div>'
        + '<div class="ai-mgmt-actions">'
        + pinnedBtn + hideBtn + deleteBtn
        + '</div>'
        + '</div>';
    };

    let html = '';
    // Intro
    html += '<div class="card" style="background:linear-gradient(135deg,var(--primary-soft),var(--surface-2));border:1px solid var(--primary)">'
      + '<div style="display:flex;align-items:center;gap:10px">'
      + '<div style="font-size:24px">⚙️</div>'
      + '<div style="flex:1">'
      + '<div style="font-size:13px;font-weight:700;color:var(--primary)">Kelola Situs AI</div>'
      + '<div style="font-size:11px;color:var(--text-2);margin-top:2px;line-height:1.5">Pin situs yang sering dipakai ke atas, sembunyikan yang tidak pernah dipakai, atau tambah situs AI baru yang custom.</div>'
      + '</div></div></div>';

    // Stats summary
    html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px">'
      + '<div style="text-align:center;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 8px">'
      + '<div style="font-size:18px;font-weight:750;color:var(--primary)">' + pinned.length + '</div>'
      + '<div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-top:2px">Dipin</div></div>'
      + '<div style="text-align:center;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 8px">'
      + '<div style="font-size:18px;font-weight:750;color:var(--text)">' + (pinned.length + visible.length) + '</div>'
      + '<div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-top:2px">Aktif</div></div>'
      + '<div style="text-align:center;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 8px">'
      + '<div style="font-size:18px;font-weight:750;color:var(--muted)">' + hidden.length + '</div>'
      + '<div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-top:2px">Disembunyikan</div></div>'
      + '</div>';

    html += '</div>';

    // Add custom site form
    html += '<div class="card">'
      + '<h3>➕ Tambah Situs AI Custom</h3>'
      + '<div class="ai-add-form">'
      + '<div class="ai-add-row"><label>Nama</label><input id="aiAddName" type="text" placeholder="mis. MyAI" /></div>'
      + '<div class="ai-add-row"><label>URL</label><input id="aiAddUrl" type="text" placeholder="https://myai.example.com/" /></div>'
      + '<div class="ai-add-row"><label>Emoji (opsional)</label><input id="aiAddEmoji" type="text" placeholder="🤖" maxlength="4" style="max-width:80px" /></div>'
      + '<div class="ai-add-row"><label>Region</label>'
      + '<select id="aiAddRegion">'
      + '<option value="west">🌍 Barat</option>'
      + '<option value="china">🇨🇳 China</option>'
      + '<option value="local">🇮🇩 Lokal</option>'
      + '</select></div>'
      + '</div>'
      + '<button class="btn btn-p" id="aiAddBtn" style="margin-top:10px;width:100%">➕ Tambah Situs</button>'
      + '</div>';

    // Pinned section
    if (pinned.length) {
      html += '<div class="card"><h3>⭐ Dipin (' + pinned.length + ')</h3>'
        + '<div class="ai-mgmt-list">' + pinned.map(row).join('') + '</div></div>';
    }
    // Active (non-pinned, visible)
    if (visible.length) {
      html += '<div class="card"><h3>📋 Aktif (' + visible.length + ')</h3>'
        + '<div class="ai-mgmt-list">' + visible.map(row).join('') + '</div></div>';
    }
    // Hidden section
    if (hidden.length) {
      html += '<div class="card"><h3>🚫 Disembunyikan (' + hidden.length + ')</h3>'
        + '<div class="ai-mgmt-list">' + hidden.map(row).join('') + '</div></div>';
    }
    // Custom sites info
    if (custom.length) {
      html += '<div class="hintbox" style="margin-top:10px">💡 <b>' + custom.length + ' situs custom</b> — ditandai badge "CUSTOM". Bisa dihapus permanen dengan tombol 🗑️.</div>';
    }

    B.innerHTML = html;

    // Bind action buttons (pin/unpin/hide/unhide/delete)
    B.querySelectorAll('.ai-action-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const act = btn.dataset.act;
        const cust = { ...((currentVault?.settings?.aiToolsCustomizations) || {}) };
        if (!cust[id]) cust[id] = {};
        if (act === 'pin') { cust[id].pinned = true; toast('⭐ Dipin ke atas'); }
        else if (act === 'unpin') { cust[id].pinned = false; toast('☆ Pin dilepas'); }
        else if (act === 'hide') { cust[id].hidden = true; toast('👁️ Disembunyikan'); }
        else if (act === 'unhide') { cust[id].hidden = false; toast('👁️ Ditampilkan kembali'); }
        else if (act === 'delete') {
          // Confirm before delete
          if (!confirm('Hapus situs custom ini permanen? Tidak bisa dibatalkan.')) return;
          delete cust[id];
          toast('🗑️ Situs custom dihapus');
        }
        await saveSettings({ aiToolsCustomizations: cust });
        await refreshVault();
        render();
      });
    });

    // Also update unhide buttons in hidden section — they use act="hide" with already-hidden tool
    // Re-bind: untuk tool yang sudah hidden, tombol "Hide" jadi "Unhide"
    B.querySelectorAll('.ai-mgmt-row').forEach(r => {
      const id = r.dataset.id;
      const cust = (currentVault?.settings?.aiToolsCustomizations) || {};
      const isHidden = cust[id]?.hidden === true;
      const hideBtn = r.querySelector('.ai-hide');
      if (hideBtn && isHidden) {
        hideBtn.textContent = '👁️ Unhide';
        hideBtn.dataset.act = 'unhide';
        hideBtn.style.background = 'var(--green-soft)';
        hideBtn.style.color = 'var(--green)';
        hideBtn.style.borderColor = 'transparent';
      }
    });

    // Bind add button
    const addBtn = B.querySelector('#aiAddBtn');
    if (addBtn) addBtn.addEventListener('click', async () => {
      const name = B.querySelector('#aiAddName').value.trim();
      const url = B.querySelector('#aiAddUrl').value.trim();
      const emoji = B.querySelector('#aiAddEmoji').value.trim() || '🤖';
      const region = B.querySelector('#aiAddRegion').value;
      if (!name) { toast('⚠️ Nama wajib diisi', 'err'); return; }
      if (!url || !/^https?:\/\//.test(url)) { toast('⚠️ URL tidak valid (harus http/https)', 'err'); return; }
      // Generate unique id
      const customId = 'custom_' + Date.now().toString(36);
      const cust = { ...((currentVault?.settings?.aiToolsCustomizations) || {}) };
      cust[customId] = { custom: true, name, url, region, emoji, alt: [], pinned: false, hidden: false };
      await saveSettings({ aiToolsCustomizations: cust });
      await refreshVault();
      toast('✅ ' + name + ' ditambahkan');
      render();
    });
  };

  render();
}

// v3.7: Halaman Backup — UI lengkap dengan export/import/info langsung
// v3.8.1 (Issue #1, #2, #6): Halaman Sync Google Drive — bilah Alat
// User set URL Web App + token di sini, lalu test koneksi / sync now / full backup.
async function renderGDrivePage(B) {
  const s = currentVault?.settings || {};

  // Ambil status sync terbaru dari background (GDrive Sync)
  let syncStatus = { meta: { lastSyncAt: null, lastError: null, totalSynced: 0, totalFailed: 0 }, queueLength: 0 };
  try {
    const r = await browser.runtime.sendMessage({ type: 'GDRIVE_STATUS' });
    if (r?.ok) syncStatus = { meta: r.meta, queueLength: r.queueLength };
  } catch (e) {}

  // v3.11.7-fix (Issue #5): Ambil juga status Multi-PC Sync
  let multiPcStatus = { hasActive: false, activeProfile: null, profiles: [] };
  try {
    const r = await browser.runtime.sendMessage({ type: 'SYNC_STATUS' });
    if (r?.ok && r.status) multiPcStatus = r.status;
  } catch (e) {}

  const enabled = !!s.gdriveSyncEnabled;
  const configured = !!(s.gdriveWebAppUrl && s.gdriveAuthToken);
  // v3.11.7-fix (Issue #3): Lock token — read-only by default, butuh klik "Unlock" untuk edit
  const tokenLocked = s.gdriveTokenLocked !== false; // default locked

  let statusBadge = '⛔ Nonaktif';
  let statusColor = '#6b7280';
  if (enabled && !configured) {
    statusBadge = '⚠️ URL/Token belum diisi';
    statusColor = '#d97706';
  } else if (enabled && configured && syncStatus.meta?.lastError) {
    statusBadge = '❌ Error: ' + (syncStatus.meta.lastError || '').slice(0, 60);
    statusColor = '#dc2626';
  } else if (enabled && configured && syncStatus.meta?.lastSyncAt) {
    const d = new Date(syncStatus.meta.lastSyncAt);
    statusBadge = '✅ Sync terakhir: ' + d.toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })
                + ' (' + (syncStatus.meta.totalSynced || 0) + ' total)';
    statusColor = '#059669';
  } else if (enabled && configured) {
    statusBadge = '⏳ Belum pernah sync';
    statusColor = '#6b7280';
  }

  // v3.11.7-fix (Issue #5): Status Multi-PC Sync
  let multiPcBadge = '⛔ Belum ada profile aktif';
  let multiPcColor = '#6b7280';
  if (multiPcStatus.hasActive && multiPcStatus.activeProfile) {
    const p = multiPcStatus.activeProfile;
    const lastSync = p.lastSyncAt ? new Date(p.lastSyncAt).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }) : 'belum pernah';
    multiPcBadge = '✅ Profile: ' + (p.name || '?') + ' · Last: ' + lastSync + ' · ' + (p.lastSyncDirection || '-');
    multiPcColor = '#059669';
  }

  // v3.11.21: Ambil status Supabase
  let supabaseStatus = { loggedIn: false };
  try {
    const r = await browser.runtime.sendMessage({ type: 'SUPABASE_STATUS' });
    if (r?.ok && r.status) supabaseStatus = r.status;
  } catch (e) {}

  B.innerHTML =
    // ===== SECTION 0: Supabase Login (v3.11.21) — Auto-sync, lebih mudah dari Apps Script =====
    // User feedback: "saya frustasi dengan apps script yang tidak berhasil sudah dua hari
    // untuk save gambar screenshot di drive. oleh karena itu buatkan databasenya menggunakan
    // suppabase untuk menyimpan seluruh data yang dihasilkan di dalam addon"
    '<div class="card" style="background:linear-gradient(135deg,#15803d,#166534);color:#f0fdf4;border:none">'
    + '<div style="font-size:11px;opacity:.85">🟢 Supabase Cloud Sync (NEW — otomatis, lebih mudah)</div>'
    + '<div style="font-size:13px;font-weight:600;margin:4px 0;color:#fff">'
    + (supabaseStatus.loggedIn
        ? '✅ Login: ' + esc(supabaseStatus.user?.email || 'user')
        : '⛔ Belum login')
    + '</div>'
    + (supabaseStatus.loggedIn && supabaseStatus.lastSync
        ? '<div style="font-size:11px;opacity:.85">Last sync: ' + esc(supabaseStatus.lastSync.direction || '-') + ' · ' + (supabaseStatus.lastSync.at ? new Date(supabaseStatus.lastSync.at).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }) : 'belum') + '</div>'
        : '<div style="font-size:11px;opacity:.85">Login sekali → semua data otomatis sync ke cloud</div>')
    + '</div>'

    // Supabase Login Form / User Info
    + '<div class="card"><h3>🔐 Login Supabase</h3>'
    + '<div class="hintbox" style="margin:0 0 10px;font-size:11px;line-height:1.55;background:#f0fdf4;border:1px solid #bbf7d0;color:#14532d">'
    + '<b>Kenapa Supabase?</b> Apps Script ribet (URL + Token + deploy). Supabase cukup <b>login email/password</b> sekali → semua data (vault, catatan, screenshot, settings) <b>otomatis sync</b> ke cloud. Screenshot full image disimpan di Supabase Storage (tidak ke-limit Apps Script 10MB).<br>'
    + '<b>Akun default:</b> agung.kesmas@gmail.com / Recallfox@2026<br>'
    + '<b>Setup:</b> 1) Login email/password di bawah. 2) Klik "Push ke Cloud" untuk upload state lokal. 3) Di PC lain: login sama → klik "Pull dari Cloud".'
    + '</div>';

  if (supabaseStatus.loggedIn) {
    // User sudah login — tampilkan info + tombol sync
    B.innerHTML += '<div style="margin:8px 0;padding:10px;background:var(--surface-2);border-radius:8px">'
      + '<div style="font-size:12px"><b>Email:</b> ' + esc(supabaseStatus.user?.email || '-') + '</div>'
      + '<div style="font-size:11px;color:var(--muted);margin-top:2px"><b>User ID:</b> ' + esc(supabaseStatus.userId || '-') + '</div>'
      + '</div>'
      + '<div class="btn-row" style="flex-direction:column;gap:6px">'
      +   '<button class="btn btn-p" id="rfSupaFullSync" style="width:100%;background:linear-gradient(135deg,#15803d,#166534)">🔄 Sync Full (push + pull)</button>'
      +   '<div class="btn-row" style="gap:6px">'
      +     '<button class="btn btn-g" id="rfSupaPush" style="flex:1">📤 Push ke Cloud</button>'
      +     '<button class="btn btn-g" id="rfSupaPull" style="flex:1">📥 Pull dari Cloud</button>'
      +   '</div>'
      +   '<button class="btn btn-g" id="rfSupaLogout" style="width:100%;background:#fee2e2;color:#991b1b">🚪 Logout</button>'
      + '</div>';
  } else {
    // Form login
    B.innerHTML += '<div style="display:flex;flex-direction:column;gap:6px">'
      +   '<input class="f" id="rfSupaEmail" type="email" placeholder="Email (mis. agung.kesmas@gmail.com)" value="agung.kesmas@gmail.com" style="font-size:12px">'
      +   '<input class="f" id="rfSupaPass" type="password" placeholder="Password" value="Recallfox@2026" style="font-size:12px">'
      +   '<button class="btn btn-p" id="rfSupaLogin" style="width:100%;background:linear-gradient(135deg,#15803d,#166534)">🔐 Login</button>'
      +   '<div style="text-align:center;font-size:10px;color:var(--muted);margin:4px 0">— atau —</div>'
      +   '<button class="btn btn-g" id="rfSupaGmail" style="width:100%;background:#fff;color:#1f2937;border:1px solid #d1d5db">'
      +     '<span style="display:inline-flex;align-items:center;gap:6px">'
      +       '<svg width="16" height="16" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>'
      +       'Login dengan Gmail'
      +     '</span>'
      +   '</button>'
      +   '<button class="btn btn-g" id="rfSupaSignup" style="width:100%;font-size:11px">📝 Buat akun baru</button>'
      +   '<button class="btn btn-g" id="rfSupaTestConn" style="width:100%;font-size:11px">🔌 Test Koneksi Supabase</button>'
      + '</div>';
  }

  B.innerHTML += '<div id="rfSupaResult" style="margin-top:8px;font-size:11px;display:none"></div>'
    + '</div>'

    // ===== HEADER: Status gabungan GDrive + Multi-PC =====
    + '<div class="card" style="background:linear-gradient(135deg,#1e3a8a,#1e40af);color:#eff6ff;border:none">'
    + '<div style="font-size:11px;opacity:.85">Status GDrive Sync (one-way push)</div>'
    + '<div style="font-size:13px;font-weight:600;margin:4px 0;color:#fff">' + esc(statusBadge) + '</div>'
    + '<div style="font-size:11px;opacity:.85">Queue: ' + (syncStatus.queueLength || 0) + ' item · Gagal: ' + (syncStatus.meta?.totalFailed || 0) + '</div>'
    + '<hr style="border:none;border-top:1px solid rgba(255,255,255,.2);margin:8px 0">'
    + '<div style="font-size:11px;opacity:.85">Status Multi-PC Sync (bidirectional)</div>'
    + '<div style="font-size:13px;font-weight:600;margin:4px 0;color:' + multiPcColor + ';color:#fff">' + esc(multiPcBadge) + '</div>'
    + '</div>'

    // ===== SECTION 1: Hubungkan ke Google Drive (URL + Token + Copy URL + Lock Token) =====
    // v3.11.8 (Issue #4): Simplify labeling — ganti "Konfigurasi" jadi "Hubungkan ke Google Drive".
    // User report: "ini tu masuk ke logika buat akun baru untuk konfigurasi dan multi pc sync
    // ini untuk login? karena terasa tidak familiar penyebutannya."
    // Fix: Pakai istilah yang familiar — "Hubungkan" (bukan "Konfigurasi"), "Kunci" (bukan "Lock"),
    // "Sandi" (bukan "Token"). Tambah penjelasan singkat di atas: Bukan login, ini jembatan.
    + '<div class="card"><h3>🔗 Hubungkan ke Google Drive</h3>'
    + '<div class="hintbox" style="margin:0 0 10px;font-size:11px;line-height:1.55;background:#f0f9ff;border:1px solid #bae6fd;color:#0c4a6e">'
    +   '<b>💡 Ini BUKAN login akun.</b> RecallFox tidak punya server, tidak punya akun. '
    +   'Anda hanya perlu menghubungkan addon ini ke <b>Apps Script milik Anda sendiri</b> '
    +   '(yang Anda buat dari Spreadsheet Anda). Seperti menghubungkan Bluetooth — perlu kode '
    +   'pasangan supaya aman.'
    +   '<br><br>'
    +   '<b>Cara pakai:</b><br>'
    +   '1. Deploy Apps Script Web App (lihat panduan di bawah) → dapat <b>URL Web App</b><br>'
    +   '2. Klik <b>🎲 Generate</b> di bawah untuk buat sandi acak<br>'
    +   '3. Copy sandi, paste ke <code>AUTH_TOKEN</code> di Code.gs Apps Script Anda<br>'
    +   '4. Tempel <b>URL Web App</b> + <b>sandi</b> di bawah → klik <b>Simpan</b><br>'
    +   '5. Klik <b>Test Koneksi</b> → harus "✅ Terhubung!"<br>'
    +   '6. Untuk pakai di PC lain: copy URL+sandi, paste di PC lain (tidak perlu deploy ulang)'
    + '</div>'
    + '<div style="margin:8px 0">'
    +   '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px">'
    +     '<label style="font-size:11px;color:var(--muted)"><b>Aktifkan sinkronisasi</b> (master switch)</label>'
    +     '<label class="ks-toggle' + (enabled ? ' on' : '') + '" id="rfGdToggle" aria-label="Toggle GDrive sync"><i></i></label>'
    +   '</div>'
    + '</div>'
    // v3.11.7-fix (Issue #3): Web App URL + tombol Copy URL
    + '<div style="margin:10px 0">'
    +   '<label style="font-size:11px;color:var(--muted)"><b>URL Web App</b> (alamat Apps Script Anda)</label>'
    +   '<div style="display:flex;gap:6px;margin-top:4px">'
    +     '<input class="f" id="rfGdUrl" value="' + esc(s.gdriveWebAppUrl || '') + '" placeholder="https://script.google.com/macros/s/AKfyc.../exec" style="flex:1;font-size:11px">'
    +     '<button class="btn btn-g" id="rfGdCopyUrl" title="Salin URL — paste di PC lain untuk multi-PC sync" style="flex:none;padding:6px 10px;font-size:11px">📋 Copy URL</button>'
    +   '</div>'
    +   '<div style="font-size:10px;color:var(--muted);margin-top:3px">Klik <b>📋 Copy URL</b> untuk salin ke clipboard. Paste di PC lain di field yang sama.</div>'
    + '</div>'
    // v3.11.7-fix (Issue #3): Sandi rahasia dengan LOCK protection
    + '<div style="margin:10px 0">'
    +   '<label style="font-size:11px;color:var(--muted)"><b>Sandi rahasia</b> (HARUS sama dengan <code>AUTH_TOKEN</code> di Code.gs Anda)</label>'
    +   '<div style="display:flex;gap:6px;margin-top:4px;flex-wrap:wrap">'
    +     '<input type="' + (tokenLocked ? 'password' : 'text') + '" class="f" id="rfGdToken" value="' + esc(s.gdriveAuthToken || '') + '" placeholder="32 karakter acak" style="flex:1;min-width:120px;font-size:11px"' + (tokenLocked ? ' readonly' : '') + '>'
    +     '<button class="btn btn-g" id="rfGdLockToken" title="' + (tokenLocked ? 'Buka kunci untuk edit sandi' : 'Kunci sandi agar tidak terketik tidak sengaja') + '" style="flex:none;padding:6px 10px;font-size:11px">' + (tokenLocked ? '🔓 Buka' : '🔒 Kunci') + '</button>'
    +     '<button class="btn btn-g" id="rfGdGenToken" title="Buat sandi acak (butuh konfirmasi kalau sudah ada)" style="flex:none;padding:6px 10px;font-size:11px">🎲 Generate</button>'
    +     '<button class="btn btn-g" id="rfGdCopyToken" title="Salin sandi ke clipboard" style="flex:none;padding:6px 10px;font-size:11px">📋 Copy</button>'
    +   '</div>'
    +   '<div style="font-size:10px;color:var(--muted);margin-top:3px">'
    +     (tokenLocked ? '🔒 Sandi <b>terkunci</b> (read-only) — klik 🔓 Buka untuk edit. Mencegah ketimpa tidak sengaja.' : '⚠️ Sandi <b>terbuka</b> — bisa diedit. Klik 🔒 Kunci setelah selesai.')
    +     '<br>Klik 🎲 Generate untuk buat sandi acak, lalu 📋 Copy dan paste ke <code>AUTH_TOKEN</code> di Code.gs Apps Script Anda.'
    +   '</div>'
    + '</div>'
    + '<button class="btn btn-g" id="rfGdSave" style="width:100%;margin-top:6px">💾 Simpan & Hubungkan</button></div>'

    // ===== SECTION 2: Aksi Cepat (gabungan GDrive + Multi-PC) =====
    + '<div class="card"><h3>🚀 Aksi Cepat (1 klik)</h3>'
    + '<div class="hintbox" style="margin-bottom:8px;font-size:11px">'
    +   '<b>Test Koneksi</b>: cek URL+Token valid.<br>'
    +   '<b>🔄 Sync Sekarang</b>: flush queue GDrive Sync (push perubahan tertunda ke spreadsheet).<br>'
    +   '<b>💾 Full Backup</b>: kirim SEMUA item existing ke GDrive Spreadsheet (one-time, untuk first setup).<br>'
    +   '<b>📤 Push (Multi-PC)</b>: upload state vault saat ini ke cloud (untuk PC lain ambil).<br>'
    +   '<b>📥 Pull (Multi-PC)</b>: download state dari cloud ke PC ini (merge, tidak overwrite).<br>'
    +   '<b>🔄 Sync Full (Multi-PC)</b>: push + pull sekaligus (bidirectional).<br>'
    +   '<b>🗑 Reset Queue</b>: bersihkan queue GDrive yang tertunda (item belum terkirim akan dibuang).'
    + '</div>'
    + '<div class="btn-row" style="flex-direction:column;gap:6px">'
    +   '<button class="btn btn-g" id="rfGdTest" style="width:100%">🔗 Test Koneksi</button>'
    +   '<button class="btn btn-p" id="rfGdSyncNow" style="width:100%">🔄 Sync Sekarang (GDrive queue)</button>'
    +   '<button class="btn btn-p" id="rfGdFullBackup" style="width:100%">💾 Full Backup ke GDrive (one-time)</button>'
    +   '<div style="border-top:1px dashed var(--border);margin:4px 0;padding-top:6px"></div>'
    +   '<button class="btn btn-p" id="rfSyncFull" style="width:100%;background:linear-gradient(135deg,#7c3aed,#5b21b6)">🔄 Sync Full Multi-PC (push+pull)</button>'
    +   '<div class="btn-row" style="gap:6px">'
    +     '<button class="btn btn-g" id="rfSyncPush" style="flex:1">📤 Push</button>'
    +     '<button class="btn btn-g" id="rfSyncPull" style="flex:1">📥 Pull</button>'
    +   '</div>'
    +   '<button class="btn btn-g" id="rfGdClearQueue" style="width:100%;background:#fee2e2;color:#991b1b">🗑 Reset Queue GDrive (' + (syncStatus.queueLength || 0) + ' item)</button>'
    + '</div></div>'

    // ===== SECTION 3: Multi-PC Profile Manager (inline, bukan modal) =====
    + '<div class="card"><h3>👥 Multi-PC Profile Manager</h3>'
    + '<div class="hintbox" style="margin-bottom:8px;font-size:11px">'
    +   '<b>Apa itu Profile?</b> Profile = pasangan URL+Token untuk satu Apps Script deployment. '
    +   'Pakai 1 profile untuk multi-PC (Anda punya data sama di beberapa PC), atau multi-profile untuk multi-user (Anda, istri, teman — data terpisah).'
    + '</div>'
    + '<div id="rfSyncProfileList" style="margin-bottom:10px"></div>'
    + '<div style="border-top:1px dashed var(--border);padding-top:10px">'
    +   '<h4 style="font-size:11px;font-weight:700;margin-bottom:6px">➕ Tambah Profile Baru</h4>'
    +   '<div style="display:flex;flex-direction:column;gap:6px">'
    +     '<input class="f" id="rfSyncProfName" type="text" placeholder="Nama profile (mis. Kantor, Rumah, Istri)" style="font-size:11px">'
    +     '<input class="f" id="rfSyncProfUrl" type="url" placeholder="URL Apps Script (https://script.google.com/macros/s/.../exec)" style="font-size:11px">'
    +     '<input class="f" id="rfSyncProfToken" type="password" placeholder="Token (sama dengan CONFIG.AUTH_TOKEN di Apps Script)" style="font-size:11px">'
    +     '<div class="btn-row" style="gap:6px">'
    +       '<button class="btn btn-g" id="rfSyncProfTest" style="flex:1">🔌 Test Koneksi</button>'
    +       '<button class="btn btn-p" id="rfSyncProfAdd" style="flex:1">➕ Tambah & Aktifkan</button>'
    +     '</div>'
    +   '</div>'
    +   '<div id="rfSyncProfResult" style="margin-top:6px;font-size:11px;display:none"></div>'
    + '</div></div>'

    // ===== SECTION 4: Opsi Sync =====
    + '<div class="card"><h3>🔧 Opsi Sync</h3>'
    + '<div class="krow" style="padding:6px 0">'
    +   '<div><b>GDrive: sync real-time saat save</b><div style="font-size:11px;color:var(--muted)">Setiap tambah/edit/hapus item langsung dikirim ke spreadsheet (debounced 2s)</div></div>'
    +   '<button class="ks-toggle' + (s.gdriveSyncOnSave !== false ? ' on' : '') + '" id="rfGdOnSave" aria-label="Toggle sync-on-save"><i></i></button>'
    + '</div>'
    + '<div class="krow" style="padding:6px 0">'
    +   '<div><b>GDrive: upload screenshot ke Drive</b><div style="font-size:11px;color:var(--muted)">Full image screenshot disimpan sebagai file PNG/JPEG di folder Drive. Pakai kompresi <b>Tinggi (JPEG q60)</b> supaya < 10MB.</div></div>'
    +   '<button class="ks-toggle' + (s.gdriveSyncScreenshots !== false ? ' on' : '') + '" id="rfGdShots" aria-label="Toggle screenshot upload"><i></i></button>'
    + '</div>'
    + '<div class="krow" style="padding:6px 0">'
    +   '<div><b>Multi-PC: auto-sync (debounced 30s)</b><div style="font-size:11px;color:var(--muted)">Setiap vault berubah, otomatis push+pull ke cloud (butuh profile aktif)</div></div>'
    +   '<button class="ks-toggle' + (s.syncAutoEnabled ? ' on' : '') + '" id="rfSyncAuto" aria-label="Toggle auto-sync"><i></i></button>'
    + '</div>'
    + '<div class="krow" style="padding:6px 0">'
    +   '<div><b>Auto-sync ke GDrive saat backup lokal</b><div style="font-size:11px;color:var(--muted)">Tombol "Backup sekarang" lokal juga kirim ke GDrive</div></div>'
    +   '<button class="ks-toggle' + (s.gdriveAutoBackupOnLocalBackup !== false ? ' on' : '') + '" id="rfGdAutoBak" aria-label="Toggle auto-backup-on-local-backup"><i></i></button>'
    + '</div>'
    + '<div style="margin:8px 0">'
    +   '<label style="font-size:11px;color:var(--muted)">Interval flush periodik GDrive (menit, min 1)</label>'
    +   '<input type="number" class="f" id="rfGdInterval" value="' + (s.gdriveSyncIntervalMinutes || 5) + '" min="1" max="60" style="width:80px;margin-top:4px">'
    + '</div></div>'

    // ===== SECTION 5: Panduan Setup Detil =====
    + '<div class="card"><h3>📖 Panduan Setup Detil (Step-by-Step)</h3>'
    + '<div style="font-size:11.5px;line-height:1.6;color:var(--text-2)">'
    +   '<div style="margin-bottom:8px;padding:6px 8px;background:var(--surface-2);border-radius:6px">'
    +     '<b>❓ Apakah GDrive Sync sama dengan Multi-PC Sync?</b><br>'
    +     '<span style="color:var(--muted)">TEKNOLOGI SAMA (Apps Script Web App + Spreadsheet), tapi FUNGSI BERBEDA:<br>'
    +     '• <b>GDrive Sync</b> = <i>one-way push</i> real-time. Setiap save/hapus item langsung dikirim ke sheet terpisah (02_Prompts, 03_Konteks, dst.). Cocok untuk backup otomatis.<br>'
    +     '• <b>Multi-PC Sync</b> = <i>bidirectional</i> seluruh state. Pakai sheet "SyncState" terpisah. Cocok untuk punya data sama di beberapa PC (push dari PC-1, pull di PC-2).<br>'
    +     'Keduanya pakai URL+Token yang sama. Bisa dipakai bersamaan.</span>'
    +   '</div>'
    +   '<div style="margin-bottom:8px;padding:6px 8px;background:var(--surface-2);border-radius:6px">'
    +     '<b>🆕 Setup PC pertama (3 langkah):</b><br>'
    +     '<span style="color:var(--muted)">1. Deploy Apps Script Web App (lihat langkah A–H di bawah).<br>'
    +     '2. Isi <b>Web App URL</b> + <b>Auth Token</b> di Konfigurasi atas → klik <b>Simpan</b>.<br>'
    +     '3. Klik <b>💾 Full Backup ke GDrive</b> (kirim semua item existing ke spreadsheet).</span>'
    +   '</div>'
    +   '<div style="margin-bottom:8px;padding:6px 8px;background:var(--surface-2);border-radius:6px">'
    +     '<b>💻 Setup PC kedua (3 langkah):</b><br>'
    +     '<span style="color:var(--muted)">1. Install RecallFox di PC-2.<br>'
    +     '2. Buka <b>Sync Cloud</b> di sidebar → klik <b>📋 Copy URL</b> dari PC-1 (atau ketik manual) → isi URL+Token sama.<br>'
    +     '3. Klik <b>📥 Pull</b> (Multi-PC Sync) → semua data ter-restore ke PC-2.</span>'
    +   '</div>'
    +   '<ol style="padding-left:18px;margin:0">'
    +     '<li style="margin-bottom:6px"><b>Buat Spreadsheet baru</b> di <a href="https://sheets.google.com" target="_blank">sheets.google.com</a> (atau pakai yang sudah ada).</li>'
    +     '<li style="margin-bottom:6px"><b>Buka Apps Script</b>: dari Spreadsheet, klik <code>Extensions → Apps Script</code>.</li>'
    +     '<li style="margin-bottom:6px"><b>Hapus kode default</b>, lalu <b>paste isi file <code>Code.gs</code></b> dari folder <code>appscript/</code> RecallFox.</li>'
    +     '<li style="margin-bottom:6px"><b>Ganti <code>SPREADSHEET_ID</code></b> di Code.gs dengan ID Spreadsheet Anda (dari URL sheet: <code>docs.google.com/spreadsheets/d/<b>[INI_ID_ANDA]</b>/edit</code>).</li>'
    +     '<li style="margin-bottom:6px"><b>Klik tombol 🎲 Generate di atas</b> (Unlock dulu kalau token sudah ada) untuk buat token acak, lalu klik 📋 Copy.</li>'
    +     '<li style="margin-bottom:6px"><b>Paste token ke <code>AUTH_TOKEN</code></b> di Code.gs Apps Script (ganti placeholder).</li>'
    +     '<li style="margin-bottom:6px"><b>Run fungsi <code>setup</code></b> sekali (tombol Run di editor Apps Script, accept permissions).</li>'
    +     '<li style="margin-bottom:6px"><b>Deploy → New deployment → Web app</b>. Set: Execute as = Me, Who has access = Anyone. Klik Deploy.</li>'
    +     '<li style="margin-bottom:6px"><b>Copy URL Web App</b> (ends with <code>/exec</code>), paste ke kolom "Web App URL" di atas.</li>'
    +     '<li style="margin-bottom:6px"><b>Klik Simpan Konfigurasi</b>, lalu <b>Test Koneksi</b>. Harus muncul "✅ Terhubung!".</li>'
    +     '<li><b>Klik Full Backup</b> untuk kirim seluruh data existing Anda ke Spreadsheet.</li>'
    +   '</ol>'
    +   '<div style="margin-top:8px;padding:6px 8px;background:#fef3c7;border-left:3px solid #d97706;border-radius:4px;font-size:11px">'
    +     '<b>💡 Tips:</b> Kalau Test Koneksi gagal dengan "Unauthorized", periksa: (1) token sama persis di addon & Code.gs, (2) deploy pakai <code>/exec</code> bukan <code>/dev</code>, (3) "Who has access" = Anyone.'
    +   '</div>'
    + '</div></div>'

    // ===== SECTION 6: Hasil operasi terakhir =====
    + '<div class="card" id="rfGdResultCard" style="display:none"><h3>📋 Hasil operasi terakhir</h3>'
    + '<div id="rfGdResult" style="font-size:12px;line-height:1.5"></div></div>'

    + '<p class="hintbox" style="margin:10px 3px">💡 <b>Setup:</b> 1) Deploy Apps Script Web App (lihat panduan di atas). 2) Generate token via 🎲 Generate. 3) Tempel URL + token di Konfigurasi. 4) Klik Test Koneksi. 5) Klik Full Backup untuk kirim seluruh data existing. 6) Untuk multi-PC: di PC-2 pakai URL+Token sama, klik 📥 Pull.</p>';

  // ===== Bind events =====

  // Save config
  $('#rfGdSave').addEventListener('click', async () => {
    const url = ($('#rfGdUrl').value || '').trim();
    const token = ($('#rfGdToken').value || '').trim();
    await saveSettings({ gdriveWebAppUrl: url, gdriveAuthToken: token });
    toast('✓ Konfigurasi disimpan');
    renderGDrivePage(B);
  });

  // Master toggle
  $('#rfGdToggle').addEventListener('click', async () => {
    await saveSettings({ gdriveSyncEnabled: !enabled });
    toast(!enabled ? '✓ GDrive sync AKTIF' : 'GDrive sync dimatikan');
    renderGDrivePage(B);
  });

  // v3.11.7-fix (Issue #3): Copy URL ke clipboard
  $('#rfGdCopyUrl').addEventListener('click', async () => {
    const url = ($('#rfGdUrl').value || '').trim();
    if (!url) { toast('URL masih kosong. Isi dulu, lalu Copy.', false); return; }
    try {
      await navigator.clipboard.writeText(url);
      toast('📋 URL disalin. Paste di PC lain di field URL yang sama.');
    } catch (e) {
      toast('Gagal copy URL: ' + e.message, false);
    }
  });

  // v3.11.7-fix (Issue #3): Lock/Unlock token
  $('#rfGdLockToken').addEventListener('click', async () => {
    const newLockState = !tokenLocked;
    await saveSettings({ gdriveTokenLocked: newLockState });
    toast(newLockState ? '🔒 Token dikunci (read-only)' : '🔓 Token dibuka — bisa diedit. Jangan lupa kunci lagi setelah selesai.');
    renderGDrivePage(B);
  });

  // Toggles opsi
  $('#rfGdOnSave').addEventListener('click', async () => {
    await saveSettings({ gdriveSyncOnSave: s.gdriveSyncOnSave === false ? true : false });
    renderGDrivePage(B);
  });
  $('#rfGdShots').addEventListener('click', async () => {
    await saveSettings({ gdriveSyncScreenshots: s.gdriveSyncScreenshots === false ? true : false });
    renderGDrivePage(B);
  });
  $('#rfSyncAuto').addEventListener('click', async () => {
    await saveSettings({ syncAutoEnabled: !s.syncAutoEnabled });
    toast(!s.syncAutoEnabled ? '✓ Multi-PC auto-sync aktif (30s debounce)' : 'Multi-PC auto-sync dimatikan');
    renderGDrivePage(B);
  });
  $('#rfGdAutoBak').addEventListener('click', async () => {
    await saveSettings({ gdriveAutoBackupOnLocalBackup: s.gdriveAutoBackupOnLocalBackup === false ? true : false });
    renderGDrivePage(B);
  });
  $('#rfGdInterval').addEventListener('change', async (e) => {
    const v = Math.max(1, Math.min(60, parseInt(e.target.value, 10) || 5));
    await saveSettings({ gdriveSyncIntervalMinutes: v });
    toast('✓ Interval sync: ' + v + ' menit');
  });

  // Generate token — dengan konfirmasi kalau sudah ada
  $('#rfGdGenToken').addEventListener('click', async () => {
    const existing = $('#rfGdToken').value || '';
    if (existing && !confirm('Token sudah ada. Yakin generate token baru?\n\nToken lama: ' + existing.slice(0, 8) + '...\n\nToken baru akan MENGUBAH token di addon. Pastikan Anda juga update AUTH_TOKEN di Code.gs Apps Script dan deploy ulang.')) {
      return;
    }
    // Auto-unlock sebelum generate
    if (tokenLocked) {
      await saveSettings({ gdriveTokenLocked: false });
    }
    const arr = new Uint8Array(24);
    crypto.getRandomValues(arr);
    const token = 'rf-' + Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
    const tokenInput = $('#rfGdToken');
    if (tokenInput) {
      tokenInput.value = token;
      tokenInput.removeAttribute('readonly');
      tokenInput.type = 'text';
      toast('🎲 Token di-generate. Klik 📋 Copy lalu paste ke Code.gs!');
    }
  });
  // Copy token
  $('#rfGdCopyToken').addEventListener('click', async () => {
    const tokenInput = $('#rfGdToken');
    const token = tokenInput?.value || '';
    if (!token) { toast('Token masih kosong. Klik 🎲 Generate dulu.', false); return; }
    try {
      await navigator.clipboard.writeText(token);
      toast('📋 Token disalin. Paste ke AUTH_TOKEN di Code.gs.');
    } catch (e) {
      toast('Gagal copy: ' + e.message, false);
    }
  });

  // Test koneksi
  $('#rfGdTest').addEventListener('click', async () => {
    const btn = $('#rfGdTest');
    const orig = btn.textContent;
    btn.textContent = '⏳ Testing...';
    btn.disabled = true;
    try {
      const r = await browser.runtime.sendMessage({ type: 'GDRIVE_TEST' });
      _showGDriveResult(B, r?.ok, r?.ok
        ? '✅ Terhubung! Service: ' + (r.service || '?') + ' · waktu server: ' + (r.time || '?')
        : '❌ Gagal: ' + (r?.error || 'unknown'));
    } catch (e) {
      _showGDriveResult(B, false, '❌ Error: ' + e.message);
    } finally {
      btn.textContent = orig;
      btn.disabled = false;
    }
  });

  // GDrive Sync now (flush queue)
  $('#rfGdSyncNow').addEventListener('click', async () => {
    const btn = $('#rfGdSyncNow');
    const orig = btn.textContent;
    btn.textContent = '⏳ Syncing...';
    btn.disabled = true;
    try {
      const s2 = currentVault?.settings || {};
      if (s2.gdriveWebAppUrl && s2.gdriveAuthToken && !s2.gdriveSyncEnabled) {
        await saveSettings({ gdriveSyncEnabled: true });
        toast('💡 Sync otomatis diaktifkan (URL+token sudah diisi)');
      }
      const r = await browser.runtime.sendMessage({ type: 'GDRIVE_SYNC_NOW' });
      if (r?.ok) {
        const res = r.result || {};
        if ((res.synced || 0) === 0 && (res.remaining || 0) === 0) {
          _showGDriveResult(B, true,
            '✅ Sync selesai — queue kosong (tidak ada perubahan tertunda).<br>'
            + '<span style="font-size:11px;color:var(--muted)">Item yang sudah ada sebelum sync diaktifkan TIDAK otomatis terkirim. '
            + 'Klik <b>"Full Backup ke GDrive"</b> untuk kirim semua item existing sekaligus.</span>');
        } else {
          _showGDriveResult(B, true,
            '✅ Sync selesai: <b>' + (res.synced || 0) + ' item terkirim</b>, '
            + (res.failed || 0) + ' gagal, ' + (res.remaining || 0) + ' tersisa di queue.');
        }
      } else {
        let errMsg = '❌ ' + (r?.error || 'Gagal');
        if (r?.reason === 'disabled' || (r?.result?.reason === 'disabled')) {
          errMsg = '⚠️ Sync belum diaktifkan. Isi URL + Token dulu, lalu klik toggle "Aktifkan sync".';
        } else if (r?.error === 'NETWORK_ERROR') {
          errMsg = '❌ Network error. Cek: URL benar, Apps Script sudah di-deploy, koneksi internet aktif.';
        }
        _showGDriveResult(B, false, errMsg);
      }
      renderGDrivePage(B);
    } catch (e) {
      _showGDriveResult(B, false, '❌ Error: ' + e.message);
    } finally {
      btn.textContent = orig;
      btn.disabled = false;
    }
  });

  // GDrive Full backup
  $('#rfGdFullBackup').addEventListener('click', async () => {
    const btn = $('#rfGdFullBackup');
    const orig = btn.textContent;
    btn.textContent = '⏳ Mengupload...';
    btn.disabled = true;
    _showGDriveResult(B, true, '⏳ Memulai full backup... mohon tunggu, proses ini bisa 30-60 detik tergantung jumlah item.');
    try {
      const s2 = currentVault?.settings || {};
      if (s2.gdriveWebAppUrl && s2.gdriveAuthToken && !s2.gdriveSyncEnabled) {
        await saveSettings({ gdriveSyncEnabled: true });
        toast('💡 Sync otomatis diaktifkan (URL+token sudah diisi)');
      }
      const r = await browser.runtime.sendMessage({ type: 'GDRIVE_FULL_BACKUP' });
      if (r?.ok) {
        const st = r.stats || {};
        _showGDriveResult(B, true,
          '✅ Full backup sukses! Items: ' + (st.items || 0) + ', Bundles: ' + (st.bundles || 0) + ', '
          + 'Notes: ' + (st.notes || 0) + ', Toppings: ' + (st.toppings || 0) + ', '
          + 'Habits: ' + (st.habits || 0) + ', Settings: ' + (st.settings || 0));
      } else {
        let errMsg = '❌ ' + (r?.error || 'Gagal');
        if (r?.reason === 'disabled') {
          errMsg = '⚠️ Sync belum diaktifkan. Klik toggle "Aktifkan sync" di atas dulu, atau isi URL + Token.';
        } else if (r?.error === 'NO_URL' || r?.error === 'NO_TOKEN') {
          errMsg = '⚠️ URL Web App atau Token belum diisi. Scroll ke section "Konfigurasi" di atas.';
        } else if (r?.error === 'HTTP_401' || r?.error === 'UNAUTHORIZED') {
          errMsg = '❌ Token tidak cocok.<br><span style="font-size:11px">💡 Pastikan token di addon SAMA PERSIS dengan <code>AUTH_TOKEN</code> di Code.gs Apps Script Anda. Periksa juga apakah Code.gs sudah di-deploy ulang setelah token diubah.</span>';
        } else if (r?.error === 'HTTP_404') {
          errMsg = '❌ URL Web App tidak ditemukan (404).<br><span style="font-size:11px">💡 Periksa: (1) URL diakhiri <code>/exec</code> bukan <code>/dev</code>, (2) Apps Script sudah di-deploy sebagai Web app.</span>';
        } else if (r?.error === 'HTTP_500') {
          errMsg = '❌ Server error (500).<br><span style="font-size:11px">💡 Cek Execution log di Apps Script editor (View → Execution log). Kemungkinan: SPREADSHEET_ID salah, atau sheet belum dibuat (Run <code>setup</code> di Apps Script).</span>';
        } else if (r?.error === 'PAYLOAD_TOO_LARGE') {
          errMsg = '❌ Data terlalu besar.<br><span style="font-size:11px">' + esc(r?.detail || '') + '</span>';
        } else if (r?.error === 'TIMEOUT') {
          errMsg = '❌ Timeout (90 detik).<br><span style="font-size:11px">💡 Server Apps Script lambat. Coba lagi, atau kurangi jumlah item.</span>';
        } else if (r?.error === 'NETWORK_ERROR') {
          errMsg = '❌ Network error.<br><span style="font-size:11px">💡 Cek koneksi internet. Kalau persisten, mungkin URL Web App salah atau Apps Script belum di-deploy.</span>';
        } else if (r?.detail) {
          errMsg += '<br><span style="font-size:11px;color:var(--muted)">' + esc(r.detail) + '</span>';
        }
        _showGDriveResult(B, false, errMsg);
      }
      renderGDrivePage(B);
    } catch (e) {
      _showGDriveResult(B, false, '❌ Error: ' + e.message + '<br><span style="font-size:11px">Buka console (F12 → Console) untuk detail. Kemungkinan: background script crash, atau pesan tidak terkirim.</span>');
    } finally {
      btn.textContent = orig;
      btn.disabled = false;
    }
  });

  // Clear queue
  $('#rfGdClearQueue').addEventListener('click', async () => {
    if (!confirm('Yakin reset queue sync? Item yang belum terkirim akan dibuang.')) return;
    try {
      await browser.runtime.sendMessage({ type: 'GDRIVE_CLEAR_QUEUE' });
      toast('🗑 Queue direset');
      renderGDrivePage(B);
    } catch (e) { toast('Error: ' + e.message, false); }
  });

  // v3.11.7-fix (Issue #5): Multi-PC Sync actions
  $('#rfSyncFull')?.addEventListener('click', () => _doMultiPcSync(B, 'full'));
  $('#rfSyncPush')?.addEventListener('click', () => _doMultiPcSync(B, 'push'));
  $('#rfSyncPull')?.addEventListener('click', () => _doMultiPcSync(B, 'pull'));

  // v3.11.7-fix (Issue #5): Render profile list inline
  _renderSyncProfileListInline(B);
  $('#rfSyncProfAdd')?.addEventListener('click', () => _addSyncProfileInline(B));
  $('#rfSyncProfTest')?.addEventListener('click', () => _testSyncProfileInline(B));

  // v3.11.21: Supabase event bindings
  $('#rfSupaLogin')?.addEventListener('click', async () => {
    const email = ($('#rfSupaEmail')?.value || '').trim();
    const password = $('#rfSupaPass')?.value || '';
    if (!email || !password) { _showSupaResult(B, false, 'Email dan password wajib diisi'); return; }
    _showSupaResult(B, true, '⏳ Login ke Supabase...');
    try {
      const res = await browser.runtime.sendMessage({ type: 'SUPABASE_LOGIN', email, password });
      if (res?.ok) {
        _showSupaResult(B, true, '✅ Login berhasil! Email: ' + (res.user?.email || email));
        toast('✅ Login Supabase berhasil');
        renderGDrivePage(B);
      } else {
        _showSupaResult(B, false, '❌ Login gagal: ' + (res?.error || 'unknown'));
      }
    } catch (e) {
      _showSupaResult(B, false, '❌ Error: ' + e.message);
    }
  });

  $('#rfSupaSignup')?.addEventListener('click', async () => {
    const email = ($('#rfSupaEmail')?.value || '').trim();
    const password = $('#rfSupaPass')?.value || '';
    if (!email || !password) { _showSupaResult(B, false, 'Email dan password wajib diisi'); return; }
    if (!confirm('Buat akun Supabase baru?\n\nEmail: ' + email + '\n\nAkun akan dibuat di project RecallFox Supabase.')) return;
    _showSupaResult(B, true, '⏳ Mendaftarkan akun...');
    try {
      const res = await browser.runtime.sendMessage({ type: 'SUPABASE_SIGNUP', email, password });
      if (res?.ok) {
        if (res.needsConfirmation) {
          _showSupaResult(B, true, '📧 Akun dibuat! Cek email untuk konfirmasi, lalu login.');
        } else {
          _showSupaResult(B, true, '✅ Akun dibuat & login otomatis!');
          renderGDrivePage(B);
        }
      } else {
        _showSupaResult(B, false, '❌ Signup gagal: ' + (res?.error || 'unknown'));
      }
    } catch (e) {
      _showSupaResult(B, false, '❌ Error: ' + e.message);
    }
  });

  $('#rfSupaGmail')?.addEventListener('click', async () => {
    _showSupaResult(B, true, '⏳ Membuka Gmail login di tab baru...');
    try {
      const res = await browser.runtime.sendMessage({ type: 'SUPABASE_GMAIL' });
      _showSupaResult(B, true, '🔗 Tab baru dibuka. Login Gmail di sana, lalu kembali ke addon.');
    } catch (e) {
      _showSupaResult(B, false, '❌ Error: ' + e.message);
    }
  });

  $('#rfSupaLogout')?.addEventListener('click', async () => {
    if (!confirm('Logout dari Supabase? Data lokal tetap ada, tapi sync cloud berhenti.')) return;
    try {
      await browser.runtime.sendMessage({ type: 'SUPABASE_LOGOUT' });
      toast('🚪 Logout Supabase berhasil');
      renderGDrivePage(B);
    } catch (e) {
      toast('Error: ' + e.message, false);
    }
  });

  $('#rfSupaPush')?.addEventListener('click', () => _doSupabaseSync(B, 'push'));
  $('#rfSupaPull')?.addEventListener('click', () => _doSupabaseSync(B, 'pull'));
  $('#rfSupaFullSync')?.addEventListener('click', () => _doSupabaseSync(B, 'full'));

  $('#rfSupaTestConn')?.addEventListener('click', async () => {
    _showSupaResult(B, true, '⏳ Test koneksi Supabase...');
    try {
      const res = await browser.runtime.sendMessage({ type: 'SUPABASE_TEST_CONNECTION' });
      if (res?.ok) {
        _showSupaResult(B, true, '✅ Supabase accessible: ' + (res.url || ''));
      } else {
        _showSupaResult(B, false, '❌ Gagal: ' + (res?.error || 'unknown'));
      }
    } catch (e) {
      _showSupaResult(B, false, '❌ Error: ' + e.message);
    }
  });
}

// v3.11.21: Helper — jalankan Supabase sync (push/pull/full)
// v3.11.24: Tampilkan errors dengan detail supaya user tahu kenapa 0 item
async function _doSupabaseSync(B, action) {
  const btnMap = { full: 'rfSupaFullSync', push: 'rfSupaPush', pull: 'rfSupaPull' };
  const btn = $('#' + btnMap[action]);
  const orig = btn?.textContent || '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Memproses...'; }
  _showSupaResult(B, true, '⏳ Supabase ' + action + ' sedang berjalan... mohon tunggu.');
  try {
    const msgType = action === 'full' ? 'SUPABASE_FULL_SYNC' : action === 'push' ? 'SUPABASE_PUSH' : 'SUPABASE_PULL';
    const res = await browser.runtime.sendMessage({ type: msgType });
    if (res?.ok) {
      let msg = '';
      if (action === 'push') {
        const s = res.stats || {};
        msg = '✓ Push berhasil · ' + (s.items || 0) + ' items, ' + (s.notes || 0) + ' catatan, ' + (s.screenshots || 0) + ' screenshot, ' + (s.settings || 0) + ' settings';
        // v3.11.24: Tampilkan detail kalau 0 item padahal vault tidak kosong
        if ((s.items || 0) === 0 && (s.notes || 0) === 0) {
          const debug = res.debug || {};
          msg += '\n\n⚠️ 0 item ter-push! Debug info:';
          msg += '\n· Vault items: ' + (debug.vaultItems ?? 'unknown');
          msg += '\n· Bundles: ' + (debug.bundles ?? 'unknown');
          msg += '\n· Notes: ' + (debug.notes ?? 'unknown');
          msg += '\n· Settings: ' + (debug.settingsKeys ?? 'unknown');
          msg += '\n· User ID: ' + (debug.userId || 'null');
          msg += '\n· Duration: ' + (debug.duration ?? 'unknown') + 'ms';
          msg += '\n\nKemungkinan: (1) belum login Supabase, (2) RLS policy reject insert, (3) table belum dibuat di Supabase. Cek console background (about:debugging → Inspect) untuk log detail.';
        }
        if (s.errors && s.errors.length > 0) {
          msg += '\n\n❌ ' + s.errors.length + ' error:';
          // Tampilkan 5 error pertama
          const shown = s.errors.slice(0, 5);
          for (const e of shown) {
            msg += '\n· ' + (e.type || e.id || e.key || '?') + ': ' + e.error;
          }
          if (s.errors.length > 5) msg += '\n· ... dan ' + (s.errors.length - 5) + ' lainnya';
        }
      } else if (action === 'pull') {
        const s = res.stats || {};
        msg = '✓ Pull berhasil · +' + (s.itemsAdded || 0) + ' items baru, ~' + (s.itemsUpdated || 0) + ' updated, +' + (s.notesAdded || 0) + ' catatan baru';
      } else {
        const p = res.push?.stats || {}, l = res.pull?.stats || {};
        msg = '✓ Sync lengkap · push: ' + (p.items || 0) + ' items, pull: +' + (l.itemsAdded || 0) + ' baru';
      }
      _showSupaResult(B, true, msg);
      toast(action === 'push' ? '✓ Push: ' + (res.stats?.items || 0) + ' items' : msg);
      if (action !== 'push') {
        // Refresh vault kalau ada pull
        await refreshVault();
      }
    } else {
      let msg = '⚠ Gagal: ' + (res?.error || 'unknown');
      // v3.11.24: Tambah hint untuk error umum
      if (res?.error === 'not_logged_in') {
        msg += '\n\n💡 Anda belum login Supabase. Klik "Login Email/Password" di section Supabase di atas.';
      } else if (res?.error === 'no_user_id') {
        msg += '\n\n💡 Session tidak valid. Logout lalu login ulang.';
      } else if (res?.error?.includes('http_40')) {
        msg += '\n\n💡 HTTP error — kemungkinan RLS policy atau table belum dibuat. Jalankan supabase-schema.sql di Supabase SQL Editor.';
      }
      _showSupaResult(B, false, msg);
      toast(msg, false);
    }
  } catch (e) {
    _showSupaResult(B, false, '⚠ Error: ' + e.message);
    toast('⚠ Error: ' + e.message, false);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = orig; }
  }
}

function _showSupaResult(B, ok, msg) {
  const el = $('#rfSupaResult');
  if (!el) return;
  el.style.display = '';
  el.innerHTML = (ok ? '✓ ' : '✕ ') + msg;
  el.style.color = ok ? 'var(--green)' : 'var(--red)';
}

// v3.11.7-fix (Issue #5): Helper — jalankan aksi Multi-PC Sync (push/pull/full)
async function _doMultiPcSync(B, action) {
  const btnMap = { full: 'rfSyncFull', push: 'rfSyncPush', pull: 'rfSyncPull' };
  const btn = $('#' + btnMap[action]);
  const orig = btn?.textContent || '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Memproses...'; }
  _showGDriveResult(B, true, '⏳ Multi-PC ' + action + ' sedang berjalan... mohon tunggu.');
  try {
    const msgType = action === 'full' ? 'SYNC_FULL' : action === 'push' ? 'SYNC_PUSH' : 'SYNC_PULL';
    const res = await browser.runtime.sendMessage({ type: msgType });
    if (res?.ok) {
      let msg = '';
      if (action === 'push') {
        msg = '✓ Push berhasil · ' + (res.itemsCount || 0) + ' items + ' + (res.notesCount || 0) + ' catatan';
      } else if (action === 'pull') {
        msg = '✓ Pull berhasil · +' + (res.itemsAdded || 0) + ' items baru, ~' + (res.itemsUpdated || 0) + ' updated, +' + (res.notesAdded || 0) + ' catatan baru';
      } else {
        msg = '✓ Sync lengkap · push: ' + (res.itemsCount || 0) + ' items, pull: +' + (res.itemsAdded || 0) + ' baru';
      }
      _showGDriveResult(B, true, msg);
      toast(msg);
    } else {
      const msg = '⚠ Gagal: ' + (res?.error || 'unknown') + (res?.detail ? ' · ' + res.detail : '');
      _showGDriveResult(B, false, msg);
      toast(msg, false);
    }
  } catch (e) {
    _showGDriveResult(B, false, '⚠ Error: ' + e.message);
    toast('⚠ Error: ' + e.message, false);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = orig; }
  }
}

// v3.11.7-fix (Issue #5): Render profile list inline (bukan modal)
async function _renderSyncProfileListInline(B) {
  const listEl = $('#rfSyncProfileList');
  if (!listEl) return;
  let res;
  try {
    res = await browser.runtime.sendMessage({ type: 'SYNC_GET_PROFILES' });
  } catch (e) {
    listEl.innerHTML = '<div style="font-size:11px;color:var(--muted);padding:6px">Gagal memuat profiles: ' + e.message + '</div>';
    return;
  }
  if (!res?.ok) {
    listEl.innerHTML = '<div style="font-size:11px;color:var(--muted);padding:6px">Belum ada profile. Tambah di form bawah.</div>';
    return;
  }
  const data = res.data;
  if (!data.profiles || data.profiles.length === 0) {
    listEl.innerHTML = '<div style="font-size:11px;color:var(--muted);padding:6px">📋 Belum ada profile. Tambah di form bawah.</div>';
    return;
  }
  listEl.innerHTML = data.profiles.map(p => {
    const isActive = p.id === data.activeProfileId;
    const lastSync = p.lastSyncAt ? new Date(p.lastSyncAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'belum';
    return '<div style="display:flex;align-items:center;gap:8px;padding:8px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;background:' + (isActive ? 'var(--primary-soft)' : 'var(--surface)') + '">'
      + '<div style="font-size:14px">' + (isActive ? '🟢' : '⚪') + '</div>'
      + '<div style="flex:1;min-width:0">'
      +   '<div style="font-size:12px;font-weight:600">' + esc(p.name) + (isActive ? ' <span style="font-size:9px;background:var(--primary);color:#fff;padding:1px 5px;border-radius:999px;font-weight:700">AKTIF</span>' : '') + '</div>'
      +   '<div style="font-size:10px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Last: ' + lastSync + ' · ' + (p.lastSyncDirection || '-') + ' · ' + esc((p.url || '').slice(0, 40)) + '…</div>'
      + '</div>'
      + '<div style="display:flex;gap:4px">'
      +   (isActive ? '' : '<button class="btn btn-g" data-act="activate" data-id="' + p.id + '" style="padding:4px 8px;font-size:10px">Aktifkan</button>')
      +   '<button class="btn btn-g" data-act="delete" data-id="' + p.id + '" style="padding:4px 8px;font-size:10px;background:#fee2e2;color:#991b1b">🗑</button>'
      + '</div></div>';
  }).join('');
  listEl.querySelectorAll('button[data-act]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const act = btn.dataset.act;
      const id = btn.dataset.id;
      if (act === 'activate') {
        await browser.runtime.sendMessage({ type: 'SYNC_SET_ACTIVE', id });
        toast('✓ Profile diaktifkan');
        renderGDrivePage(B);
      } else if (act === 'delete') {
        if (!confirm('Hapus profile ini?')) return;
        await browser.runtime.sendMessage({ type: 'SYNC_DELETE_PROFILE', id });
        toast('Profile dihapus');
        renderGDrivePage(B);
      }
    });
  });
}

// v3.11.7-fix (Issue #5): Add profile inline
async function _addSyncProfileInline(B) {
  const name = ($('#rfSyncProfName').value || '').trim();
  const url = ($('#rfSyncProfUrl').value || '').trim();
  const token = ($('#rfSyncProfToken').value || '').trim();
  const resultEl = $('#rfSyncProfResult');
  if (!name || !url || !token) {
    if (resultEl) { resultEl.style.display = ''; resultEl.textContent = '⚠ Semua field wajib diisi'; resultEl.style.color = 'var(--red)'; }
    return;
  }
  const res = await browser.runtime.sendMessage({ type: 'SYNC_ADD_PROFILE', profile: { name, url, token } });
  if (res?.ok) {
    $('#rfSyncProfName').value = '';
    $('#rfSyncProfUrl').value = '';
    $('#rfSyncProfToken').value = '';
    if (resultEl) { resultEl.style.display = ''; resultEl.textContent = '✓ Profile ditambahkan & diaktifkan'; resultEl.style.color = 'var(--green)'; }
    toast('✓ Profile "' + name + '" ditambahkan');
    renderGDrivePage(B);
  } else {
    if (resultEl) { resultEl.style.display = ''; resultEl.textContent = '⚠ Gagal: ' + (res?.error || 'unknown'); resultEl.style.color = 'var(--red)'; }
  }
}

// v3.11.7-fix (Issue #5): Test profile inline
async function _testSyncProfileInline(B) {
  const url = ($('#rfSyncProfUrl').value || '').trim();
  const token = ($('#rfSyncProfToken').value || '').trim();
  const resultEl = $('#rfSyncProfResult');
  if (!url || !token) {
    if (resultEl) { resultEl.style.display = ''; resultEl.textContent = '⚠ Isi URL dan token dulu'; resultEl.style.color = 'var(--red)'; }
    return;
  }
  const btn = $('#rfSyncProfTest');
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = '🔌 Menguji...';
  try {
    const res = await browser.runtime.sendMessage({ type: 'SYNC_TEST_PROFILE', profile: { url, token } });
    if (res?.ok) {
      if (resultEl) { resultEl.style.display = ''; resultEl.textContent = '✓ Koneksi OK · ' + (res.spreadsheetUrl || 'spreadsheet accessible'); resultEl.style.color = 'var(--green)'; }
      toast('✓ Koneksi OK');
    } else {
      if (resultEl) { resultEl.style.display = ''; resultEl.textContent = '⚠ ' + (res?.error || 'gagal'); resultEl.style.color = 'var(--red)'; }
    }
  } catch (e) {
    if (resultEl) { resultEl.style.display = ''; resultEl.textContent = '⚠ ' + e.message; resultEl.style.color = 'var(--red)'; }
  } finally {
    btn.disabled = false; btn.textContent = orig;
  }
}

function _showGDriveResult(B, ok, msg) {
  const card = $('#rfGdResultCard');
  const el = $('#rfGdResult');
  if (!card || !el) return;
  card.style.display = '';
  el.innerHTML = (ok ? '✓ ' : '✕ ') + msg;
  el.style.color = ok ? 'var(--green)' : 'var(--red)';
}

async function renderBackupPage(B) {
  const s = currentVault?.settings || {};
  const vault = currentVault || { items: [], bundles: [] };
  const itemCount = (vault.items || []).length;
  const bundleCount = (vault.bundles || []).length;

  // Cek info backup terakhir
  let lastBackupInfo = 'Belum pernah';
  let lastBackupSize = '—';
  try {
    const meta = await getBackupMetadata();
    if (meta && meta.lastBackupAt) {
      const d = new Date(meta.lastBackupAt);
      lastBackupInfo = d.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
    }
    if (meta && meta.lastBackupSize) {
      lastBackupSize = Math.round(meta.lastBackupSize / 1024) + ' KB';
    }
  } catch (e) {}

  const autoBackupOn = s.autoBackupEnabled !== false;
  // v3.8.1 (Issue #6): Cek apakah GDrive sync aktif — jika ya, tampilkan shortcut di backup page
  const gdriveOn = !!(s.gdriveSyncEnabled && s.gdriveWebAppUrl && s.gdriveAuthToken);

  B.innerHTML =
    '<div class="card" style="background:linear-gradient(135deg,#1e3a8a,#1e40af);color:#eff6ff;border:none">'
    + '<div style="font-size:11px;opacity:.85">Status vault</div>'
    + '<div style="font-size:24px;font-weight:750;margin:4px 0">' + itemCount + ' item · ' + bundleCount + ' bundle</div>'
    + '<div style="font-size:11px;opacity:.85">Backup terakhir: ' + esc(lastBackupInfo) + ' · ' + esc(lastBackupSize) + '</div>'
    + '</div>'

    // v3.8.1 (Issue #7): SATU card "Buat Backup" — gabung Export JSON + Backup Sekarang (sebelumnya 2 tombol mubazir)
    + '<div class="card"><h3>💾 Buat Backup</h3>'
    + '<div class="hintbox" style="margin-bottom:10px">Backup lokal otomatis tersimpan ke <code>Downloads/RecallFox/</code>. File <b>.rfvault</b> terenkripsi AES-GCM (butuh passphrase untuk restore).</div>'
    + '<div class="btn-row" style="flex-direction:column;gap:6px">'
    +   '<button class="btn btn-p" id="rfBackupNow" style="width:100%">⚡ Backup sekarang (plain JSON)</button>'
    +   '<button class="btn btn-g" id="rfExpEnc" style="width:100%">🔒 Export .rfvault terenkripsi</button>'
    + (gdriveOn
        ?   '<button class="btn btn-g" id="rfBackupGDrive" style="width:100%;background:linear-gradient(135deg,#1e3a8a,#1e40af);color:#fff">☁️ Full Backup ke Google Drive</button>'
        :   '<button class="btn btn-g" id="rfGoGDrive" style="width:100%;opacity:0.7">☁️ Setup GDrive Sync dulu →</button>')
    + '</div></div>'

    + '<div class="card"><h3>📥 Import vault</h3>'
    + '<div class="hintbox" style="margin-bottom:10px">Restore dari file backup (.rfvault atau .json). Item yang ada akan <b>digabung</b> (bukan ditimpa) — item dengan ID sama akan di-skip.</div>'
    + '<label class="btn btn-g" style="display:block;text-align:center;cursor:pointer">'
    +   '📁 Pilih file backup...'
    +   '<input type="file" id="rfImportFile" accept=".json,.rfvault" style="display:none">'
    + '</label>'
    + '<div id="rfImportResult" style="margin-top:8px;font-size:11px"></div></div>'

    + '<div class="card"><h3>⚙️ Auto-backup</h3>'
    + '<div class="krow" style="padding:8px 0">'
    +   '<div><b>Backup otomatis harian</b><div style="font-size:11px;color:var(--muted);margin-top:2px">Simpan ke Downloads/RecallFox/ setiap hari saat addon aktif.</div></div>'
    +   '<button class="ks-toggle' + (autoBackupOn ? ' on' : '') + '" id="rfAutoBackupToggle" aria-label="Toggle auto-backup"><i></i></button>'
    + '</div></div>'

    + '<div class="card"><h3>🔧 Pengaturan lanjutan</h3>'
    + '<div class="hintbox" style="margin-bottom:10px">Atur jadwal auto-backup, lokasi folder, enkripsi default, dll di halaman pengaturan.</div>'
    + '<button class="btn btn-g" id="rfGoSettings" style="width:100%">Buka pengaturan RecallFox</button></div>'

    + '<p class="hintbox" style="margin:10px 3px">💡 <b>Tip:</b> Backup .rfvault terenkripsi aman untuk disimpan di cloud (Google Drive, Dropbox). Passphrase tidak bisa dikembalikan jika lupa — simpan baik-baik.</p>';

  // === Bind events ===
  // v3.8.1 (Issue #7): Hapus tombol "Export .json (plain)" yang redundant dengan "Backup sekarang"
  // — keduanya sama-sama plain JSON, beda folder tujuan saja. Sekarang hanya "Backup sekarang"
  // yang pakai folder RecallFox/ + tombol "Export .rfvault terenkripsi" untuk file terenkripsi.

  // Backup now (plain JSON ke Downloads/RecallFox/)
  $('#rfBackupNow').addEventListener('click', async () => {
    try {
      toast('⏳ Backup berjalan...');
      const res = await browser.runtime.sendMessage({ type: 'MANUAL_BACKUP_NOW' });
      if (res?.ok) {
        toast('✓ Backup tersimpan ke Downloads/RecallFox/'
              + (gdriveOn && s.gdriveAutoBackupOnLocalBackup ? ' + terkirim ke GDrive' : ''));
        renderBackupPage(B);
      } else {
        toast('⚠ Gagal: ' + (res?.error || ''), false);
      }
    } catch (e) {
      toast('⚠ Gagal: ' + e.message, false);
    }
  });

  // Export terenkripsi (.rfvault)
  $('#rfExpEnc').addEventListener('click', async () => {
    try {
      const passphrase = prompt('Masukkan passphrase untuk enkripsi backup (min. 8 karakter):');
      if (!passphrase) return;
      if (passphrase.length < 8) {
        if (!confirm('Passphrase kurang dari 8 karakter. Lanjut? (Tidak disarankan)')) return;
      }
      toast('🔒 Membuat backup terenkripsi...');
      const res = await browser.runtime.sendMessage({ type: 'EXPORT_BACKUP', encrypted: true, passphrase });
      if (res?.ok) {
        toast('✓ Backup .rfvault tersimpan ke Downloads');
      } else {
        toast('⚠ Gagal: ' + (res?.error || 'unknown'), false);
      }
    } catch (e) {
      toast('⚠ Gagal export: ' + e.message, false);
    }
  });

  // v3.8.1 (Issue #6): Tombol Full Backup ke GDrive (jika GDrive aktif)
  if (gdriveOn) {
    $('#rfBackupGDrive')?.addEventListener('click', async () => {
      try {
        toast('⏳ Mengirim full backup ke Google Drive...');
        const res = await browser.runtime.sendMessage({ type: 'GDRIVE_FULL_BACKUP' });
        if (res?.ok) {
          const s = res.stats || {};
          toast('✓ GDrive backup sukses · ' + (s.items || 0) + ' item, ' + (s.notes || 0) + ' catatan, ' + (s.settings || 0) + ' settings');
        } else {
          toast('⚠ Gagal GDrive: ' + (res?.error || ''), false);
        }
      } catch (e) {
        toast('⚠ Error: ' + e.message, false);
      }
    });
  } else {
    // Tombol "Setup GDrive Sync dulu →" pindah ke tool gdrive
    $('#rfGoGDrive')?.addEventListener('click', () => toolPage('gdrive'));
  }

  // Import file
  $('#rfImportFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const resultEl = $('#rfImportResult');
    resultEl.innerHTML = '⏳ Mengimpor...';
    try {
      const text = await file.text();
      let passphrase = null;
      if (file.name.endsWith('.rfvault')) {
        passphrase = prompt('Masukkan passphrase untuk dekripsi:');
        if (!passphrase) {
          resultEl.innerHTML = '<span style="color:var(--red)">✕ Dibatalkan</span>';
          e.target.value = '';
          return;
        }
      }
      const res = await browser.runtime.sendMessage({
        type: 'IMPORT_BACKUP',
        text,
        passphrase,
        filename: file.name
      });
      if (res?.ok) {
        resultEl.innerHTML = '<span style="color:var(--green)">✓ Berhasil: ' + (res.added || 0) + ' item baru, ' + (res.skipped || 0) + ' di-skip</span>';
        toast('✓ Import selesai');
        await refreshVault();
      } else {
        resultEl.innerHTML = '<span style="color:var(--red)">✕ ' + esc(res?.error || 'Gagal') + '</span>';
        toast('⚠ Gagal import: ' + (res?.error || ''), false);
      }
    } catch (e) {
      resultEl.innerHTML = '<span style="color:var(--red)">✕ ' + esc(e.message) + '</span>';
      toast('⚠ Gagal: ' + e.message, false);
    }
    e.target.value = '';
  });

  // Auto-backup toggle
  $('#rfAutoBackupToggle').addEventListener('click', async () => {
    const newOn = s.autoBackupEnabled === false;
    await saveSettings({ autoBackupEnabled: newOn });
    s.autoBackupEnabled = newOn;
    await refreshVault();
    renderBackupPage(B);
    toast(newOn ? '✓ Auto-backup aktif' : 'Auto-backup dimatikan');
  });

  // Buka settings
  $('#rfGoSettings').addEventListener('click', () => browser.runtime.openOptionsPage());
}

// v3.7: Halaman Tanya AI — UI lengkap dengan quick prompts + chat
async function renderAskAiPage(B) {
  const s = currentVault?.settings || {};

  // Cek apakah AI sudah dikonfigurasi
  let aiConfigured = false;
  let providerInfo = null;
  try {
    aiConfigured = await isAssistantConfigured();
    providerInfo = getProviderInfo(s.assistantProvider || 'groq');
  } catch (e) {}

  // Quick prompt templates
  const quickPrompts = [
    { icon: '📝', label: 'Rangkum teks ini', prompt: 'Tolong rangkum teks berikut dalam 3 poin utama:\n\n' },
    { icon: '🌐', label: 'Terjemahkan ke Indonesia', prompt: 'Terjemahkan teks berikut ke Bahasa Indonesia:\n\n' },
    { icon: '🔍', label: 'Jelaskan maknanya', prompt: 'Jelaskan makna dan konteks teks berikut dengan bahasa sederhana:\n\n' },
    { icon: '✅', label: 'Cek fakta', prompt: 'Cek faktualitas klaim dalam teks berikut. Sebutkan yang benar dan yang salah:\n\n' },
    { icon: '💡', label: 'Beri ide terkait', prompt: 'Beri 5 ide menarik yang terkait dengan topik teks berikut:\n\n' },
    { icon: '🎯', label: 'Kritisi argumen', prompt: 'Kritisi argumen dalam teks berikut. Sebutkan kekuatan dan kelemahannya:\n\n' }
  ];

  // Info card: status AI
  let statusCard;
  if (aiConfigured) {
    statusCard = '<div class="card" style="background:linear-gradient(135deg,#065f46,#047857);color:#ecfdf5;border:none">'
      + '<div style="font-size:11px;opacity:.85">AI Assistant</div>'
      + '<div style="font-size:18px;font-weight:750;margin:4px 0">' + esc(providerInfo?.name || 'AI') + ' siap</div>'
      + '<div style="font-size:11px;opacity:.85">Model: ' + esc(s.assistantModel || providerInfo?.defaultModel || 'default') + '</div></div>';
  } else {
    statusCard = '<div class="card" style="background:linear-gradient(135deg,#7c2d12,#9a3412);color:#fff7ed;border:none">'
      + '<div style="font-size:11px;opacity:.85">⚠️ AI belum dikonfigurasi</div>'
      + '<div style="font-size:14px;font-weight:700;margin:4px 0">Atur API key dulu</div>'
      + '<div style="font-size:11px;opacity:.85">Buka pengaturan untuk masukkan API key Groq (gratis) / Gemini / OpenAI.</div>'
      + '<button class="btn btn-p" id="askAiSetup" style="width:100%;margin-top:8px">Buka Pengaturan</button></div>';
  }

  B.innerHTML =
    statusCard

    + '<div class="card"><h3>⚡ Quick prompts</h3>'
    + '<div class="hintbox" style="margin-bottom:10px">Pilih template, lalu blok teks di halaman mana pun → klik kanan → "Tanya Si Pandai". Atau ketik pertanyaan langsung di bawah.</div>'
    + '<div class="rf-quick-grid">'
    + quickPrompts.map(function (p, i) {
        return '<button class="rf-quick-btn" data-prompt-idx="' + i + '" title="' + esc(p.prompt.slice(0, 80)) + '">'
          + '<span class="rf-quick-icon">' + p.icon + '</span>'
          + '<span class="rf-quick-label">' + esc(p.label) + '</span></button>';
      }).join('')
    + '</div></div>'

    + '<div class="card"><h3>💬 Tanya langsung</h3>'
    + '<div class="hintbox" style="margin-bottom:10px">Ketik pertanyaan Anda. Jawaban akan muncul di sini.</div>'
    + '<textarea id="askAiInput" class="rf-textarea" placeholder="Ketik pertanyaan... (mis. Jelaskan apa itu Recurrent Neural Network)" rows="3"></textarea>'
    + '<div class="btn-row" style="margin-top:8px">'
    +   '<button class="btn btn-g" id="askAiClear" style="flex:none">Bersihkan</button>'
    +   '<button class="btn btn-p" id="askAiSend" style="flex:1">' + (aiConfigured ? 'Kirim ke AI' : 'Setup dulu') + '</button>'
    + '</div>'
    + '<div id="askAiResult" style="margin-top:10px;font-size:12px;max-height:300px;overflow-y:auto"></div></div>'

    + '<div class="card"><h3>ℹ️ Cara pakai lain</h3>'
    + '<div style="font-size:11.5px;color:var(--text-2);line-height:1.6">'
    +   '<div style="margin-bottom:6px"><b>1. Seleksi teks → klik kanan:</b> Blok teks di halaman mana pun → klik kanan → <b>"Tanya Si Pandai"</b>. Jawaban muncul sebagai overlay di halaman.</div>'
    +   '<div style="margin-bottom:6px"><b>2. Tanya tentang tab aktif:</b> Buka tab AI tool (chat.z.ai, chatgpt.com, dll), lalu pakai tombol di bawah untuk kirim judul + URL tab ke chat AI.</div>'
    +   '<div><b>3. Pintasan keyboard:</b> Alt+Shift+A (kalau di-set di pengaturan).</div>'
    + '</div>'
    + '<button class="btn btn-g" id="askAiSendTab" style="width:100%;margin-top:10px">🔗 Tanya AI tentang tab aktif</button></div>'

    + '<p class="hintbox" style="margin:10px 3px">💡 <b>Tip:</b> Groq (gratis) paling cepat untuk teks pendek. Gemini Flash (gratis) bagus untuk multi-bahasa. Buka pengaturan untuk pindah provider.</p>';

  // === Bind events ===
  if (!aiConfigured) {
    $('#askAiSetup').addEventListener('click', () => browser.runtime.openOptionsPage());
  }

  // Quick prompt click → isi textarea
  $$('.rf-quick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.promptIdx, 10);
      const p = quickPrompts[idx];
      const ta = $('#askAiInput');
      ta.value = p.prompt;
      ta.focus();
      // Pindahkan cursor ke akhir
      ta.setSelectionRange(ta.value.length, ta.value.length);
      toast('💡 Template "' + p.label + '" dimuat. Ketik teks lalu Kirim.');
    });
  });

  // Send question
  $('#askAiSend').addEventListener('click', async () => {
    if (!aiConfigured) {
      browser.runtime.openOptionsPage();
      return;
    }
    const q = $('#askAiInput').value.trim();
    if (!q) { toast('Ketik pertanyaan dulu', false); return; }
    const resultEl = $('#askAiResult');
    const sendBtn = $('#askAiSend');
    sendBtn.disabled = true;
    sendBtn.textContent = '⏳ Menjawab...';
    resultEl.innerHTML = '<div style="color:var(--muted);font-style:italic">⏳ Menunggu jawaban dari ' + esc(providerInfo?.name || 'AI') + '...</div>';
    try {
      const messages = [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: q }
      ];
      let acc = '';
      const resp = await chatWithFallback(messages, {
        onToken: (token) => {
          acc += token;
          resultEl.innerHTML = '<div class="rf-ai-answer">' + esc(acc).replace(/\n/g, '<br>') + '</div>';
          resultEl.scrollTop = resultEl.scrollHeight;
        }
      });
      if (!acc && resp?.content) {
        resultEl.innerHTML = '<div class="rf-ai-answer">' + esc(resp.content).replace(/\n/g, '<br>') + '</div>';
      }
      if (!resultEl.innerHTML.trim()) {
        resultEl.innerHTML = '<div style="color:var(--red)">⚠ Tidak ada jawaban. Coba lagi atau cek API key di pengaturan.</div>';
      } else {
        // Tambah tombol copy di akhir
        const copyWrap = document.createElement('div');
        copyWrap.style.marginTop = '8px';
        copyWrap.innerHTML = '<button class="btn btn-g" id="askAiCopy" style="width:100%">📋 Salin jawaban</button>';
        resultEl.appendChild(copyWrap);
        $('#askAiCopy').addEventListener('click', () => {
          const text = resultEl.querySelector('.rf-ai-answer')?.innerText || '';
          navigator.clipboard.writeText(text).then(() => toast('📋 Jawaban disalin'));
        });
      }
    } catch (e) {
      resultEl.innerHTML = '<div style="color:var(--red)">⚠ Error: ' + esc(e.message) + '</div>';
    }
    sendBtn.disabled = false;
    sendBtn.textContent = 'Kirim ke AI';
  });

  // Clear
  $('#askAiClear').addEventListener('click', () => {
    $('#askAiInput').value = '';
    $('#askAiResult').innerHTML = '';
    $('#askAiInput').focus();
  });

  // Tanya tentang tab aktif
  $('#askAiSendTab').addEventListener('click', async () => {
    if (!aiConfigured) {
      browser.runtime.openOptionsPage();
      return;
    }
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tabs[0]) { toast('Tidak ada tab aktif', false); return; }
      const tab = tabs[0];
      const prompt = 'Jelaskan secara singkat situs/web ini apa dan untuk apa:\n\nJudul: ' + (tab.title || '(tanpa judul)') + '\nURL: ' + tab.url;
      $('#askAiInput').value = prompt;
      toast('💡 Prompt dimuat. Klik "Kirim ke AI" untuk kirim.');
      $('#askAiInput').focus();
    } catch (e) {
      toast('⚠ Gagal: ' + e.message, false);
    }
  });
}

// ============ Kontrol Situs (unified Element Blocker + Content Guard) ============
async function renderKontrolSitusPage(B) {
  const s = currentVault?.settings || {};
  // Get user blocklist (content filter rules)
  let userBlocklist = [];
  try { userBlocklist = await getUserBlocklist(); } catch (e) {}

  // Get current active tab domain (for site bar)
  let currentDomain = '—';
  let currentSiteIcon = '🌐';
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]?.url) {
      const url = new URL(tabs[0].url);
      currentDomain = url.hostname.replace(/^www\./, '');
      // Pick icon based on domain
      if (currentDomain.includes('youtube')) { currentSiteIcon = '▶'; }
      else if (currentDomain.includes('twitter') || currentDomain.endsWith('x.com')) { currentSiteIcon = '𝕏'; }
      else if (currentDomain.includes('facebook')) { currentSiteIcon = 'f'; }
      else if (currentDomain.includes('instagram')) { currentSiteIcon = '📷'; }
      else { currentSiteIcon = currentDomain.charAt(0).toUpperCase(); }
    }
  } catch (e) {}

  // Compute rules count
  const rulesCount = (s.elementBlockerRules?.length || 0) + userBlocklist.length;
  const blockerOn = s.elementBlockerEnabled !== false;
  const guardOn = s.contentGuardEnabled !== false;
  const siteActive = blockerOn || guardOn;

  // v3.4: Kumpulkan daftar selector yang sudah di-block untuk domain aktif
  // (dari elementBlockerRules yang domain-nya cocok dengan currentDomain)
  // v3.7: FIX — domain matching 2-arah + strip www. dari rule.domain juga
  // (sebelumnya rule disimpan sebagai "www.youtube.com" tapi currentDomain = "youtube.com"
  //  sehingga rule tidak match dan daftar Diblokir tampil (0))
  const ebRules = Array.isArray(s.elementBlockerRules) ? s.elementBlockerRules : [];
  const currentDomainRules = ebRules.filter(function (r) {
    if (!r || !r.domain) return false;
    // Normalisasi: strip www. dari kedua sisi
    const d = String(r.domain).toLowerCase().replace(/^www\./, '');
    const cd = (currentDomain || '').toLowerCase().replace(/^www\./, '');
    if (!d || !cd) return false;
    // Match kalau: exact, atau salah satu adalah subdomain dari yang lain, atau rule = 'all'
    return cd === d || cd.endsWith('.' + d) || d.endsWith('.' + cd) || d === 'all';
  });
  // Flat list of { domain, selector, isPreset, ruleName } for the current domain
  const blockedForCurrent = [];
  currentDomainRules.forEach(function (r) {
    (r.selectors || []).forEach(function (sel) {
      blockedForCurrent.push({
        domain: r.domain,
        selector: sel,
        isPreset: !!r.isPreset,
        ruleName: r.name || r.domain,
        kind: 'eb_selector'
      });
    });
  });

  // v3.6: Tambahkan juga filter konten (keyword/channel/account/x_post_url) yang aktif
  // untuk domain ini — supaya counter "Diblokir" akurat mencerminkan semua aturan.
  // Cakupan: 'all' (semua situs), 'youtube.com' (hanya YT), 'x.com' (hanya X), atau domain spesifik.
  const cgFiltersForCurrent = [];
  (userBlocklist || []).forEach(function (b) {
    if (!b || !b.value) return;
    const bDomain = (b.domain || '').toLowerCase();
    const cd = (currentDomain || '').toLowerCase();
    // Match kalau: domain kosong (all), atau domain cocok / suffix cocok
    const matches = !bDomain || bDomain === 'all' ||
      cd === bDomain || cd.endsWith('.' + bDomain) ||
      (bDomain === 'youtube.com' && (cd.endsWith('youtube.com') || cd.endsWith('youtube-nocookie.com'))) ||
      (bDomain === 'x.com' && (cd.endsWith('x.com') || cd.endsWith('twitter.com')));
    if (matches) {
      cgFiltersForCurrent.push({
        domain: b.domain || 'all',
        selector: '[' + (b.type || 'keyword') + '] ' + b.value,
        isPreset: false,
        ruleName: 'Filter konten' + (b.domain ? ' · ' + b.domain : ''),
        kind: 'cg_filter',
        rawType: b.type || 'keyword',
        rawValue: b.value,
        rawId: b.id
      });
    }
  });

  // Gabungkan: EB selectors + CG filters untuk domain aktif
  const allBlockedForCurrent = blockedForCurrent.concat(cgFiltersForCurrent);

  // Build rule list (mix of element blocker presets + user blocklist)
  // v3.6: Tambah toggle ON/OFF per-feature (ganti tombol ⋮ yang tidak berfungsi)
  const rules = [];
  if (s.elementBlockerEnabled !== false) {
    rules.push({
      type: 'UI', name: 'Element Blocker aktif',
      desc: 'Sembunyikan elemen mengganggu sesuai preset domain',
      toggleKey: 'elementBlockerEnabled',
      toggleOn: s.elementBlockerEnabled !== false
    });
  } else {
    rules.push({
      type: 'UI', name: 'Element Blocker (mati)',
      desc: 'Klik toggle untuk aktifkan kembali',
      toggleKey: 'elementBlockerEnabled',
      toggleOn: false
    });
  }
  if (s.contentGuardEnabled !== false) {
    rules.push({
      type: 'KONTEN', name: 'Content Guard aktif',
      desc: 'Filter konten negatif di YouTube & X',
      toggleKey: 'contentGuardEnabled',
      toggleOn: s.contentGuardEnabled !== false
    });
  } else {
    rules.push({
      type: 'KONTEN', name: 'Content Guard (mati)',
      desc: 'Klik toggle untuk aktifkan kembali',
      toggleKey: 'contentGuardEnabled',
      toggleOn: false
    });
  }
  userBlocklist.slice(0, 4).forEach(b => {
    rules.push({
      type: 'KONTEN',
      name: b.value?.slice(0, 40) || b.text?.slice(0, 40) || 'Aturan user',
      desc: 'Diblokir user' + (b.domain ? ' · ' + b.domain : ''),
      delId: b.id  // v3.6: tombol ✕ untuk hapus filter user
    });
  });

  let activeTab = 'home';
  function render() {
    B.innerHTML =
      // Site bar
      '<div class="ks-sitebar">'
      +   '<div class="ks-site-icon">' + esc(currentSiteIcon) + '</div>'
      +   '<div><b>' + esc(currentDomain) + '</b><span>Kontrol ' + (siteActive ? 'aktif' : 'nonaktif') + ' · ' + rulesCount + ' aturan diterapkan</span></div>'
      +   '<div class="right"><small>' + (siteActive ? 'Aktif' : 'Nonaktif') + '</small><button class="ks-toggle' + (siteActive ? ' on' : '') + '" id="ksMasterToggle" aria-label="Toggle kontrol"><i></i></button></div>'
      + '</div>'

      // Tabs — v3.4: tambah tab "Diblokir" (daftar selector domain aktif) + "Pengaturan" (floating Guardian toggle)
      // v3.6: Counter "Diblokir" sekarang juga include filter konten (keyword/channel/account/x_post_url)
      + '<nav class="ks-tabs">'
      +   '<button class="ks-tab' + (activeTab === 'home' ? ' active' : '') + '" data-tab="home">Ringkasan</button>'
      +   '<button class="ks-tab' + (activeTab === 'blocked' ? ' active' : '') + '" data-tab="blocked">Diblokir (' + allBlockedForCurrent.length + ')</button>'
      +   '<button class="ks-tab' + (activeTab === 'content' ? ' active' : '') + '" data-tab="content">Filter konten</button>'
      +   '<button class="ks-tab' + (activeTab === 'settings' ? ' active' : '') + '" data-tab="settings">Pengaturan</button>'
      + '</nav>'

      // Home view
      + '<div class="ks-view' + (activeTab === 'home' ? ' active' : '') + '" id="ksViewHome">'
      // v3.7.2 (Issue 6): Kartu Mode Anak — 1 klik untuk amankan laptop saat dipinjam anak.
      // Mengaktifkan: contentGuardYoutubeKidsOnly + contentGuardBlockShorts.
      +   '<div class="card" style="background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff;border:none;margin-bottom:12px">'
      +     '<div style="display:flex;align-items:center;gap:12px">'
      +       '<div style="font-size:32px">👶</div>'
      +       '<div style="flex:1">'
      +         '<div style="font-size:14px;font-weight:700">Mode Anak</div>'
      +         '<div style="font-size:11px;opacity:.9;line-height:1.45;margin-top:2px">Arahkan semua YouTube ke YouTube Kids & blokir YouTube Shorts. Aktifkan saat laptop dipinjam anak — 1 klik.</div>'
      +       '</div>'
      +       '<button class="ks-toggle' + (s.contentGuardYoutubeKidsOnly === true ? ' on' : '') + '" id="ksKidModeToggle" aria-label="Toggle Mode Anak" style="flex:none"><i></i></button>'
      +     '</div>'
      +   '</div>'
      +   '<div class="ks-intro">'
      +     '<div><h2>Hapus elemen yang mengganggu</h2><p>Tutup komentar, iklan, rekomendasi, dan elemen UI yang tidak perlu di situs mana pun.</p></div>'
      +     '<button class="ks-primary" id="ksAddRule">+ Aturan baru</button>'
      +   '</div>'
      +   '<div class="ks-cards">'
      +     '<button class="ks-action-card" id="ksPickElement"><div class="symbol">⊕</div><b>Pilih elemen di halaman</b><span>Klik elemen apa pun di tab aktif untuk sembunyikan. Bisa diulang untuk beberapa elemen. Esc atau tombol Batal untuk urung.</span></button>'
      +     '<button class="ks-action-card" id="ksAutoHide"><div class="symbol">⊗</div><b>Tutup otomatis</b><span>Preset untuk komentar, iklan, rekomendasi YouTube/X. Aktifkan sekali, berjalan pasif.</span></button>'
      +   '</div>'
      +   '<div class="ks-rule-summary">'
      +     '<div class="ks-rs-head"><span>Aturan aktif (' + rules.length + ')</span></div>'
      +     (rules.length ? rules.map(function (r) {
          // v3.6: Tombol aksi berbeda per jenis rule
          let actionBtn;
          if (r.toggleKey) {
            // Toggle ON/OFF untuk Element Blocker & Content Guard
            actionBtn = '<button class="ks-toggle' + (r.toggleOn ? ' on' : '') + '" data-toggle-key="' + esc(r.toggleKey) + '" aria-label="Toggle ' + esc(r.name) + '"><i></i></button>';
          } else if (r.delId) {
            // Tombol ✕ untuk hapus filter user
            actionBtn = '<button class="ks-dots" data-del-rule="' + esc(r.delId) + '" title="Hapus aturan">✕</button>';
          } else {
            actionBtn = '<button class="ks-dots">⋮</button>';
          }
          return '<div class="ks-rule"><span class="ks-tag' + (r.type === 'KONTEN' ? ' content' : '') + '">' + r.type + '</span>'
            + '<div class="ks-rule-main"><b>' + esc(r.name) + '</b><span>' + esc(r.desc) + '</span></div>'
            + actionBtn + '</div>';
        }).join('') : '<div class="ks-empty"><span class="big">🛡</span>Belum ada aturan. Klik "Aturan baru" untuk memulai.</div>')
      +   '</div>'
      + '</div>'

      // v3.4: Blocked view — daftar semua selector yang di-block di domain aktif
      // v3.6: Sekarang juga tampilkan filter konten (keyword/channel/account/x_post_url)
      + '<div class="ks-view' + (activeTab === 'blocked' ? ' active' : '') + '" id="ksViewBlocked">'
      +   '<div class="ks-intro"><div><h2>Diblokir di ' + esc(currentDomain) + '</h2><p>Daftar semua aturan aktif untuk situs ini. Centang item lalu klik "Hapus terpilih", atau klik ✕ untuk hapus satu-satu.</p></div></div>'
      +   '<div class="ks-batch-bar" id="ksBatchBar" style="display:none;margin-bottom:8px;padding:6px 10px;background:var(--primary-soft);border-radius:var(--r-md);align-items:center;gap:8px;font-size:12px"><label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="ksSelectAll"><span>Pilih semua</span></label><span style="flex:1"></span><span id="ksSelCount">0 dipilih</span><button class="btn btn-d" id="ksBatchDelete" style="padding:4px 12px;font-size:11px">Hapus terpilih</button></div>'
      +   '<div class="ks-rule-summary" style="margin-top:0">'
      +   '<style>.ks-rule .ks-pick{width:16px;height:16px;accent-color:var(--primary);cursor:pointer;flex:none;margin-right:4px}</style>'
      +     (allBlockedForCurrent.length
            ? allBlockedForCurrent.map(function (item) {
                // v3.6: Badge berbeda untuk EB selector vs CG filter
                let badge, delBtn;
                if (item.kind === 'cg_filter') {
                  const typeLabel = (item.rawType || 'keyword').toUpperCase().slice(0, 10);
                  badge = '<span class="ks-tag content">' + esc(typeLabel) + '</span>';
                  delBtn = '<button class="ks-dots" data-del-cg="' + esc(item.rawId || '') + '" title="Hapus filter">✕</button>';
                } else if (item.isPreset) {
                  badge = '<span class="ks-tag">PRESET</span>';
                  delBtn = '<span style="font-size:10px;color:var(--muted);padding:0 8px">preset</span>';
                } else {
                  badge = '<span class="ks-tag content">PICKED</span>';
                  delBtn = '<button class="ks-dots" data-del-sel="' + esc(item.domain) + '" data-sel="' + esc(item.selector) + '" title="Hapus">✕</button>';
                }
                // v3.7.1-FIX: Checkbox untuk multi-select delete
                var pickCheck = '';
                if (item.kind === 'cg_filter') {
                  pickCheck = '<input type="checkbox" class="ks-pick" data-pick-cg-id="' + esc(item.rawId || '') + '">';
                } else if (!item.isPreset) {
                  pickCheck = '<input type="checkbox" class="ks-pick" data-pick-domain="' + esc(item.domain) + '" data-pick-sel="' + esc(item.selector) + '">';
                }
                return '<div class="ks-rule">' + pickCheck + badge
                  + '<div class="ks-rule-main"><b>' + esc(item.selector.slice(0, 70)) + (item.selector.length > 70 ? '…' : '') + '</b>'
                  + '<span>dari: ' + esc(item.ruleName) + '</span></div>'
                  + delBtn + '</div>';
              }).join('')
            : '<div class="ks-empty"><span class="big">⊘</span>Belum ada aturan aktif untuk situs ini. Klik "Pilih elemen di halaman" untuk sembunyikan elemen UI, atau buka tab "Filter konten" untuk tambah kata kunci/channel.</div>')
      +   '</div>'
      + '</div>'

      // Content filter view — v3.4: form lebih lengkap dengan custom keyword + scope + tipe lebih jelas
      + '<div class="ks-view' + (activeTab === 'content' ? ' active' : '') + '" id="ksViewContent">'
      +   '<div class="ks-intro"><div><h2>Filter konten</h2><p>Blokir video/postingan berdasarkan kata kunci (mis. "anjir", "bokep"), kanal YouTube, akun X, atau URL post X.</p></div></div>'
      +   '<div class="ks-content-form">'
      +     '<div class="ks-form-row"><div><b>Jenis filter</b><span>Pilih jenis aturan filter</span></div><select id="ksFilterType"><option value="keyword">Kata kunci (judul/teks/caption)</option><option value="channel">Channel YouTube (nama)</option><option value="account">Akun X (handle)</option><option value="exact_title">Judul persis</option><option value="domain">Domain</option></select></div>'
      +     '<div class="ks-form-row"><div><b>Nilai</b><span>Teks yang akan dicocokkan (case-insensitive)</span></div><input id="ksFilterValue" type="text" placeholder="mis. anjir, bocil, @username, atau URL post X"></div>'
      +     '<div class="ks-form-row"><div><b>Tindakan</b><span>Apa yang dilakukan saat cocok</span></div><select id="ksFilterAction"><option value="hide">Sembunyikan</option><option value="blur">Blur</option><option value="warn">Tampilkan peringatan</option></select></div>'
      +     '<div class="ks-form-row"><div><b>Cakupan</b><span>Di mana aturan berlaku</span></div><select id="ksFilterScope"><option value="all">Semua situs</option><option value="youtube">Hanya YouTube</option><option value="x">Hanya X</option><option value="current">Hanya ' + esc(currentDomain) + '</option></select></div>'
      +     '<div class="ks-save-row"><button class="btn btn-g" id="ksFilterCancel">Batal</button><button class="btn btn-p" id="ksFilterSave">Simpan filter</button></div>'
      +   '</div>'
      // Tips untuk blokir URL post X
      +   '<div class="hintbox" style="margin:10px 3px 0">💡 <b>Tip blokir post X:</b> Klik kanan pada postingan di X → "🚫 Blokir Konten Ini" → pilih "Blokir URL post ini". Postingan dengan URL yang sama akan otomatis disembunyikan di timeline X.</div>'
      +   (userBlocklist.length ? '<div class="ks-rule-summary"><div class="ks-rs-head">Filter tersimpan (' + userBlocklist.length + ')</div>' + userBlocklist.slice(0, 20).map(b => '<div class="ks-rule"><span class="ks-tag content">' + esc((b.type || 'keyword').toUpperCase().slice(0, 8)) + '</span><div class="ks-rule-main"><b>' + esc((b.value || b.text || '').slice(0, 60)) + '</b><span>' + esc(b.type || 'keyword') + (b.domain ? ' · ' + b.domain : '') + '</span></div><button class="ks-dots" data-del="' + esc(b.id) + '">✕</button></div>').join('') + '</div>' : '')
      + '</div>'

      // v3.4: Settings view — toggle floating Guardian + info
      + '<div class="ks-view' + (activeTab === 'settings' ? ' active' : '') + '" id="ksViewSettings">'
      +   '<div class="ks-intro"><div><h2>Pengaturan Guardian</h2><p>Konfigurasi tampilan & perilaku RecallFox Guardian di YouTube & X.</p></div></div>'
      +   '<div class="card">'
      +     '<div class="krow" style="padding:10px 0">'
      +       '<div><b>Panel mengambang Guardian</b><div style="font-size:11px;color:var(--muted);margin-top:2px">Tampilkan panel kontrol mengambang di pojok halaman YouTube/X. Anak-anak bisa melihat dan mematikannya — lebih aman dimatikan.</div></div>'
      +       '<button class="ks-toggle' + (s.contentGuardShowFloating === true ? ' on' : '') + '" id="ksFloatingToggle" aria-label="Toggle floating panel"><i></i></button>'
      +     '</div>'
      +     '<div class="krow" style="padding:10px 0;border-top:1px solid var(--border)">'
      +       '<div><b>Nuclear mode</b><div style="font-size:11px;color:var(--muted);margin-top:2px">Blokir semua konten yang menyebut politisi/partai/lembaga politik Indonesia.</div></div>'
      +       '<button class="ks-toggle' + (s.contentGuardNuclearMode !== false ? ' on' : '') + '" id="ksNuclearToggle" aria-label="Toggle nuclear mode"><i></i></button>'
      +     '</div>'
      +     '<div class="krow" style="padding:10px 0;border-top:1px solid var(--border)">'
      +       '<div><b>Filter feed</b><div style="font-size:11px;color:var(--muted);margin-top:2px">Sembunyikan video/postingan negatif di feed YouTube/X.</div></div>'
      +       '<button class="ks-toggle' + (s.contentGuardFilterFeeds !== false ? ' on' : '') + '" id="ksFilterFeedsToggle" aria-label="Toggle filter feeds"><i></i></button>'
      +     '</div>'
      // v3.7.2 (Issue 6): Toggle individu — YouTube Shorts Block
      +     '<div class="krow" style="padding:10px 0;border-top:1px solid var(--border)">'
      +       '<div><b>🚫 Blokir YouTube Shorts</b><div style="font-size:11px;color:var(--muted);margin-top:2px">Sembunyikan semua Short dari feed YouTube & cegah navigasi ke /shorts/. Tidak mengubah jenis konten lain.</div></div>'
      +       '<button class="ks-toggle' + (s.contentGuardBlockShorts === true ? ' on' : '') + '" id="ksBlockShortsToggle" aria-label="Toggle Block Shorts"><i></i></button>'
      +     '</div>'
      // v3.7.2 (Issue 6): Toggle individu — Mode Anak (filter, no redirect)
      // v3.10.0 (Issue 2): Ubah dari redirect youtubekids.com → filter di youtube.com biasa
      +     '<div class="krow" style="padding:10px 0;border-top:1px solid var(--border)">'
      +       '<div><b>👶 Mode Anak (Filter Konten)</b><div style="font-size:11px;color:var(--muted);margin-top:2px">Tetap di youtube.com, tapi sembunyikan video non-ramah-anak. Hanya video edukasi/kartun/lagu anak yang tampil. Shorts juga di-hide.</div></div>'
      +       '<button class="ks-toggle' + (s.contentGuardKidModeFilter === true ? ' on' : '') + '" id="ksKidsOnlyToggle" aria-label="Toggle Mode Anak"><i></i></button>'
      +     '</div>'
      +   '</div>'
      +   '<p class="hintbox" style="margin:10px 3px">🔒 <b>Mode aman anak:</b> Matikan panel mengambang supaya anak tidak bisa toggle-off Guardian dari halaman. Kontrol tetap bisa diakses lewat popup RecallFox (hanya Anda yang tahu).</p>'
      + '</div>'

      + '<p class="hintbox" style="margin:15px 3px">💡 <b>Kontrol Situs</b> menggabungkan Element Blocker (sembunyikan elemen UI) dan Content Guard (filter konten negatif). Kedua fitur tetap berjalan di background — halaman ini hanya untuk konfigurasi.</p>';

    // Bind tab clicks
    $$('.ks-tab').forEach(t => t.addEventListener('click', () => {
      activeTab = t.dataset.tab;
      render();
    }));

    // Master toggle
    const masterToggle = $('#ksMasterToggle');
    if (masterToggle) masterToggle.addEventListener('click', async () => {
      const newOn = !siteActive;
      await saveSettings({
        elementBlockerEnabled: newOn,
        contentGuardEnabled: newOn
      });
      await refreshVault();
      renderKontrolSitusPage(B);
      toast(newOn ? '🛡 Kontrol Situs diaktifkan' : 'Kontrol Situs dimatikan');
    });

    // v3.7.2 (Issue 6): Mode Anak — 1 klik toggle (YouTube Kids + Block Shorts sekaligus)
    const kidModeBtn = $('#ksKidModeToggle');
    if (kidModeBtn) kidModeBtn.addEventListener('click', async () => {
      const newOn = !(s.contentGuardYoutubeKidsOnly === true);
      // Pastikan contentGuardEnabled tetap on agar redirect jalan
      await saveSettings({
        contentGuardEnabled: true,
        contentGuardYoutubeKidsOnly: newOn,
        contentGuardBlockShorts: newOn
      });
      await refreshVault();
      renderKontrolSitusPage(B);
      toast(newOn ? '👶 Mode Anak AKTIF — YouTube → Kids, Shorts diblokir' : 'Mode Anak dimatikan');
    });

    // v3.7.2 (Issue 6): Toggle individu — Block Shorts saja
    const blockShortsBtn = $('#ksBlockShortsToggle');
    if (blockShortsBtn) blockShortsBtn.addEventListener('click', async () => {
      const newOn = !(s.contentGuardBlockShorts === true);
      await saveSettings({
        contentGuardEnabled: true,
        contentGuardBlockShorts: newOn
      });
      await refreshVault();
      renderKontrolSitusPage(B);
      toast(newOn ? '🚫 YouTube Shorts diblokir' : 'YouTube Shorts diizinkan');
    });

    // v3.7.2 (Issue 6): Toggle individu — YouTube Kids Only
    const kidsOnlyBtn = $('#ksKidsOnlyToggle');
    if (kidsOnlyBtn) kidsOnlyBtn.addEventListener('click', async () => {
      // v3.10.0 (Issue 2): Mode Anak pakai contentGuardKidModeFilter (no redirect)
      const newOn = !(s.contentGuardKidModeFilter === true);
      const r = await browser.runtime.sendMessage({ type: 'TOGGLE_KID_MODE', enabled: newOn });
      const finalOn = r?.enabled ?? newOn;
      await refreshVault();
      renderKontrolSitusPage(B);
      toast(finalOn ? '👶 Mode Anak AKTIF — feed YouTube hanya konten ramah anak' : 'Mode Anak dimatikan');
    });

    // Add rule buttons (open same sheet)
    ['ksAddRule'].forEach(id => {
      const el = $('#' + id);
      if (el) el.addEventListener('click', () => {
        // Switch to content filter view
        activeTab = 'content';
        render();
        setTimeout(() => $('#ksFilterValue')?.focus(), 100);
      });
    });

    // v3.4: Delete selector buttons (di tab "Diblokir")
    $$('[data-del-sel]').forEach(btn => btn.addEventListener('click', async () => {
      const domain = btn.dataset.delSel;
      const sel = btn.dataset.sel;
      if (!domain || !sel) return;
      await removeElementBlockerSelector(domain, sel);
      await refreshVault();
      renderKontrolSitusPage(B);
      toast('✕ Elemen dihapus dari daftar blok');
    }));

    // v3.7.1-FIX: Batch select & delete untuk Element Blocker
    const batchBar = $('#ksBatchBar');
    const selectAllBox = $('#ksSelectAll');
    const selCountEl = $('#ksSelCount');
    const allPickBoxes = () => [...$$('.ks-pick')];
    const updateBatchUI = () => {
      const checked = allPickBoxes().filter(c => c.checked).length;
      if (selCountEl) selCountEl.textContent = checked + ' dipilih';
      if (batchBar) batchBar.style.display = checked > 0 ? 'flex' : 'none';
      if (selectAllBox) selectAllBox.checked = allPickBoxes().length > 0 && checked === allPickBoxes().length;
    };
    if (selectAllBox) selectAllBox.addEventListener('change', () => {
      const on = selectAllBox.checked;
      allPickBoxes().forEach(c => { c.checked = on; });
      updateBatchUI();
    });
    allPickBoxes().forEach(c => c.addEventListener('change', updateBatchUI));
    const batchDelBtn = $('#ksBatchDelete');
    if (batchDelBtn) batchDelBtn.addEventListener('click', async () => {
      const checked = allPickBoxes().filter(c => c.checked);
      if (!checked.length) { toast('Tidak ada item dipilih', false); return; }
      let deleted = 0;
      for (const c of checked) {
        if (c.dataset.pickCgId) {
          await removeUserBlocklistEntry(c.dataset.pickCgId);
          deleted++;
        } else if (c.dataset.pickDomain && c.dataset.pickSel) {
          await removeElementBlockerSelector(c.dataset.pickDomain, c.dataset.pickSel);
          deleted++;
        }
      }
      await refreshVault();
      renderKontrolSitusPage(B);
      toast('✓ ' + deleted + ' item dihapus dari daftar blok');
    });

    // v3.6: Delete CG filter buttons (di tab "Diblokir")
    $$('[data-del-cg]').forEach(btn => btn.addEventListener('click', async () => {
      const id = btn.dataset.delCg;
      if (!id) return;
      await removeUserBlocklistEntry(id);
      await refreshVault();
      renderKontrolSitusPage(B);
      toast('✕ Filter konten dihapus');
    }));

    // v3.6: Toggle per-feature (Element Blocker / Content Guard) di "Aturan aktif"
    $$('[data-toggle-key]').forEach(btn => btn.addEventListener('click', async () => {
      const key = btn.dataset.toggleKey;
      if (!key) return;
      // Baca current value, lalu toggle
      const v = await getVault();
      const currentOn = v.settings[key] !== false;
      const newOn = !currentOn;
      const update = {};
      update[key] = newOn;
      await saveSettings(update);
      // Broadcast update
      try {
        const tabs = await browser.tabs.query({});
        for (const t of tabs) {
          browser.tabs.sendMessage(t.id, { type: 'EB_RULES_UPDATED' }).catch(() => {});
          browser.tabs.sendMessage(t.id, { type: 'CG_SETTINGS_UPDATED' }).catch(() => {});
        }
      } catch (e) {}
      await refreshVault();
      renderKontrolSitusPage(B);
      toast((newOn ? '✓ ' : '✕ ') + (key === 'elementBlockerEnabled' ? 'Element Blocker' : 'Content Guard') + (newOn ? ' aktif' : ' dimatikan'));
    }));

    // v3.6: Delete rule buttons (di "Aturan aktif" - untuk filter user)
    $$('[data-del-rule]').forEach(btn => btn.addEventListener('click', async () => {
      const id = btn.dataset.delRule;
      if (!id) return;
      await removeUserBlocklistEntry(id);
      await refreshVault();
      renderKontrolSitusPage(B);
      toast('✕ Aturan dihapus');
    }));

    // v3.4: Floating panel toggle
    const floatingToggle = $('#ksFloatingToggle');
    if (floatingToggle) floatingToggle.addEventListener('click', async () => {
      const newOn = s.contentGuardShowFloating !== true;
      await setGuardianFloatingEnabled(newOn);
      // Re-read settings
      const v = await getVault();
      s.contentGuardShowFloating = v.settings.contentGuardShowFloating;
      render();
      toast(newOn ? '🛡 Panel mengambang diaktifkan' : '🔒 Panel mengambang dimatikan (lebih aman untuk anak)');
    });

    // v3.4: Nuclear mode toggle
    const nuclearToggle = $('#ksNuclearToggle');
    if (nuclearToggle) nuclearToggle.addEventListener('click', async () => {
      const newOn = s.contentGuardNuclearMode === false;
      await saveSettings({ contentGuardNuclearMode: newOn });
      s.contentGuardNuclearMode = newOn;
      // Broadcast
      try {
        const tabs = await browser.tabs.query({});
        for (const t of tabs) browser.tabs.sendMessage(t.id, { type: 'CG_SETTINGS_UPDATED' }).catch(() => {});
      } catch (e) {}
      render();
      toast(newOn ? '☢️ Nuclear mode aktif' : 'Nuclear mode dimatikan');
    });

    // v3.4: Filter feeds toggle
    const filterFeedsToggle = $('#ksFilterFeedsToggle');
    if (filterFeedsToggle) filterFeedsToggle.addEventListener('click', async () => {
      const newOn = s.contentGuardFilterFeeds === false;
      await saveSettings({ contentGuardFilterFeeds: newOn });
      s.contentGuardFilterFeeds = newOn;
      try {
        const tabs = await browser.tabs.query({});
        for (const t of tabs) browser.tabs.sendMessage(t.id, { type: 'CG_SETTINGS_UPDATED' }).catch(() => {});
      } catch (e) {}
      render();
      toast(newOn ? '🛡 Filter feed aktif' : 'Filter feed dimatikan');
    });

    // Pick element button (triggers element picker in active tab)
    const pickBtn = $('#ksPickElement');
    if (pickBtn) pickBtn.addEventListener('click', async () => {
      try {
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        if (!tabs[0]?.id) { toast('Tidak ada tab aktif', false); return; }
        const tabUrl = tabs[0].url || '';
        // Cek apakah URL bisa di-inject (http/https saja — bukan about:, moz-extension:, dll)
        if (!/^https?:\/\//i.test(tabUrl)) {
          toast('Picker tidak bisa aktif di halaman ini (hanya http/https)', false);
          return;
        }
        // Kirim pesan activate ke content script
        try {
          await browser.tabs.sendMessage(tabs[0].id, { type: 'START_ELEMENT_PICKER' });
        } catch (sendErr) {
          // Fallback: coba inject via scripting API kalau content script belum loaded
          try {
            await browser.scripting.executeScript({
              target: { tabId: tabs[0].id },
              files: ['content/elementblocker-cs.js']
            });
            // Tunggu sebentar lalu coba kirim pesan lagi
            await new Promise(r => setTimeout(r, 200));
            await browser.tabs.sendMessage(tabs[0].id, { type: 'START_ELEMENT_PICKER' });
          } catch (injErr) {
            toast('Tidak bisa mulai picker di tab ini', false);
            return;
          }
        }
        toast('🎯 Klik elemen apa pun untuk sembunyikan · Esc untuk batal');
        // Tutup popup agar user bisa berinteraksi dengan halaman
        if (!document.body.classList.contains('rf-sidebar-body')) setTimeout(() => window.close(), 1200);
      } catch (e) {
        toast('Tidak bisa mulai picker: ' + (e.message || 'error'), false);
      }
    });

    // Auto-hide preset button (toggle content guard + element blocker presets)
    const autoBtn = $('#ksAutoHide');
    if (autoBtn) autoBtn.addEventListener('click', async () => {
      await saveSettings({
        elementBlockerEnabled: true,
        contentGuardEnabled: true,
        contentGuardBlockYtChannels: true,
        contentGuardBlockXAccounts: true,
        contentGuardFilterFeeds: true
      });
      await refreshVault();
      renderKontrolSitusPage(B);
      toast('✓ Preset otomatis aktif (komentar, iklan, rekomendasi)');
    });

    // Save filter button
    const saveFilterBtn = $('#ksFilterSave');
    if (saveFilterBtn) saveFilterBtn.addEventListener('click', async () => {
      const type = $('#ksFilterType').value;
      const value = $('#ksFilterValue').value.trim();
      const action = $('#ksFilterAction').value;
      const scope = $('#ksFilterScope').value;
      if (!value) { toast('Isi nilai filter dulu', false); return; }
      const domain = scope === 'current' ? currentDomain : (scope === 'youtube' ? 'youtube.com' : scope === 'x' ? 'x.com' : null);
      // v3.4: Pakai field `value` (bukan `text`) supaya konsisten dengan helper matchesUserBlocklist
      // dan addUserBlocklistEntry. `text` hanya untuk display fallback di UI lama.
      const entry = {
        value: value,
        type,
        action,
        domain,
        createdAt: new Date().toISOString(),
        text: value  // untuk backward compat dengan UI lama yang baca .text
      };
      // v3.4: Untuk tipe 'account' (akun X), normalisasi handle — strip @ prefix
      if (type === 'account' && entry.value.startsWith('@')) {
        entry.value = entry.value.slice(1);
      }
      await addUserBlocklistEntry(entry);
      await refreshVault();
      renderKontrolSitusPage(B);
      toast('✓ Filter "' + value.slice(0, 30) + '" disimpan');
    });

    // Cancel filter
    const cancelBtn = $('#ksFilterCancel');
    if (cancelBtn) cancelBtn.addEventListener('click', () => {
      $('#ksFilterValue').value = '';
    });

    // Delete user blocklist entries
    $$('[data-del]').forEach(btn => btn.addEventListener('click', async () => {
      const id = btn.dataset.del;
      await removeUserBlocklistEntry(id);
      await refreshVault();
      renderKontrolSitusPage(B);
      toast('Aturan dihapus');
    }));
  }

  render();
}

// ============ Prayer Setup modal ============
function openPrayerSetup() {
  const s = currentVault?.settings || {};
  $('#prayerAddr').value = '';
  $('#prayerSugg').innerHTML = '';
  $('#prayerAsr').value = String(s.prayerAsrSchool || 0);
  $('#prayerFormat').value = s.prayerTimeFormat || '24h';
  const currentEl = $('#prayerCurrent');
  if (typeof s.prayerLatitude === 'number') {
    currentEl.textContent = s.prayerLocation || (s.prayerLatitude.toFixed(4) + ', ' + s.prayerLongitude.toFixed(4));
  } else {
    currentEl.textContent = '— belum diset —';
  }
  prayerPendingLocation = (typeof s.prayerLatitude === 'number')
    ? { lat: s.prayerLatitude, lng: s.prayerLongitude, display: s.prayerLocation || '' }
    : null;
  $('#prayerSetupOverlay').style.display = 'flex';
}
function closePrayerSetup() { $('#prayerSetupOverlay').style.display = 'none'; }
async function savePrayerSetup() {
  const asr = parseInt($('#prayerAsr').value, 10) || 0;
  const fmt = $('#prayerFormat').value;
  if (!prayerPendingLocation) { toast('Set lokasi dulu', false); return; }
  await saveSettings({
    prayerEnabled: true,
    prayerLatitude: prayerPendingLocation.lat,
    prayerLongitude: prayerPendingLocation.lng,
    prayerLocation: prayerPendingLocation.display || '',
    prayerAsrSchool: asr,
    prayerTimeFormat: fmt,
    prayerCachedTimes: null
  });
  await refreshVault();
  closePrayerSetup();
  await updatePrayerStrip();
  toast('🕌 Shalat diaktifkan ✓');
}
async function prayerGeolocate() {
  const btn = $('#prayerGeo');
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = '📍 Mendeteksi…';
  try {
    const pos = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
    });
    const lat = pos.coords.latitude, lng = pos.coords.longitude;
    btn.textContent = '🗺️ Mencari nama lokasi…';
    const res = await browser.runtime.sendMessage({ type: 'PRAYER_REVERSE_GEOCODE', lat, lng });
    const display = res?.ok ? (res.location || (lat.toFixed(4) + ', ' + lng.toFixed(4))) : (lat.toFixed(4) + ', ' + lng.toFixed(4));
    prayerPendingLocation = { lat, lng, display };
    $('#prayerCurrent').textContent = display;
    btn.textContent = '✓ Lokasi terdeteksi';
  } catch (e) {
    let msg = 'Gagal: ' + e.message;
    if (e.code === 1) msg = 'Izin lokasi ditolak. Cari alamat manual di atas.';
    else if (e.code === 3) msg = 'Timeout. Coba lagi.';
    btn.textContent = '⚠ ' + msg;
  } finally {
    setTimeout(() => { btn.disabled = false; btn.textContent = orig; }, 2500);
  }
}
function prayerAddrInputHandler() {
  const addr = $('#prayerAddr').value;
  const sugg = $('#prayerSugg');
  if (addr.trim().length < 3) { sugg.innerHTML = ''; return; }
  clearTimeout(prayerGeocodeTimer);
  prayerGeocodeTimer = setTimeout(async () => {
    try {
      const res = await browser.runtime.sendMessage({ type: 'PRAYER_GEOCODE', address: addr });
      if (!res?.ok || !res.results) { sugg.innerHTML = ''; return; }
      sugg.innerHTML = res.results.slice(0, 5).map(r => '<div class="sugg-item" data-lat="' + r.lat + '" data-lng="' + r.lng + '" data-display="' + escAttr(r.display) + '">' + esc(r.display) + '</div>').join('');
      sugg.querySelectorAll('.sugg-item').forEach(el => el.addEventListener('click', () => {
        prayerPendingLocation = { lat: parseFloat(el.dataset.lat), lng: parseFloat(el.dataset.lng), display: el.dataset.display };
        $('#prayerCurrent').textContent = el.dataset.display;
        sugg.innerHTML = '';
        $('#prayerAddr').value = el.dataset.display;
      }));
    } catch (e) { sugg.innerHTML = ''; }
  }, 400);
}

// ============ Variables modal ============
function openVarsModal(vars) {
  $('#varsFields').innerHTML = vars.map(v => '<div class="var-field"><label>{{' + esc(v) + '}}</label><input type="text" data-var="' + escAttr(v) + '" placeholder="' + escAttr(v) + '"></div>').join('');
  $('#varsOverlay').style.display = 'flex';
  const first = $('#varsFields input'); if (first) first.focus();
}
function closeVarsModal() { $('#varsOverlay').style.display = 'none'; pendingInjectItem = null; }
async function confirmInjectWithVars() {
  if (!pendingInjectItem) { closeVarsModal(); return; }
  const vals = {};
  $$('#varsFields input').forEach(i => { vals[i.dataset.var] = i.value; });
  const body = fillVariables(pendingInjectItem.body, vals);
  closeVarsModal();
  await doInject(body, pendingInjectItem.id);
  pendingInjectItem = null;
}

// ============ Attach modal ============
let attachItemId = null;
function openAttachModal(itemId) {
  attachItemId = itemId;
  attachSelected = new Set();
  $('#attachSearch').value = '';
  $('#attachOverlay').style.display = 'flex';
  renderAttachList();
}
function closeAttachModal() { $('#attachOverlay').style.display = 'none'; attachItemId = null; }
function renderAttachList() {
  const q = ($('#attachSearch').value || '').toLowerCase();
  const items = (currentVault?.items || []).filter(i => i.type === 'link');
  const filtered = q ? items.filter(i => (i.title + ' ' + (i.linkUrl || '') + ' ' + (i.tags || []).join(' ')).toLowerCase().indexOf(q) >= 0) : items;
  $('#attachList').innerHTML = filtered.length ? filtered.map(it => '<label class="attach-row"><input type="checkbox" value="' + it.id + '"' + (attachSelected.has(it.id) ? ' checked' : '') + '><span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(it.title) + '</span></label>').join('') : '<div style="padding:14px;font-size:11px;color:var(--muted);text-align:center">Tidak ada link di vault.</div>';
  $$('#attachList .attach-row input').forEach(c => c.addEventListener('change', () => {
    if (c.checked) attachSelected.add(c.value); else attachSelected.delete(c.value);
    renderAttachPreview();
  }));
}
async function renderAttachPreview() {
  const item = currentVault?.items.find(i => i.id === attachItemId);
  if (!item) { $('#attachPreview').textContent = ''; return; }
  const links = [...attachSelected].map(id => currentVault.items.find(i => i.id === id)).filter(Boolean);
  let text = item.body || '';
  const intro = $('#attachIntro').value || '';
  const position = $('#attachPosition').value;
  const linkText = links.map(l => '• ' + (l.title || '') + ' — ' + (l.linkUrl || l.body || '')).join('\n');
  const full = position === 'above' ? (intro + '\n' + linkText + '\n\n' + text) : (text + '\n\n' + intro + '\n' + linkText);
  $('#attachPreview').textContent = full;
}
async function confirmAttachInject() {
  const item = currentVault?.items.find(i => i.id === attachItemId);
  if (!item) { closeAttachModal(); return; }
  const links = [...attachSelected].map(id => currentVault.items.find(i => i.id === id)).filter(Boolean);
  let text = item.body || '';
  const intro = $('#attachIntro').value || '';
  const position = $('#attachPosition').value;
  const linkText = links.map(l => '• ' + (l.title || '') + ' — ' + (l.linkUrl || l.body || '')).join('\n');
  const full = position === 'above' ? (intro + '\n' + linkText + '\n\n' + text) : (text + '\n\n' + intro + '\n' + linkText);
  const finalBody = await buildFinalPrompt(full, item.toppings || []);
  closeAttachModal();
  await doInject(finalBody, item.id);
}

// ============ Refresh & init ============
async function refreshVault() {
  currentVault = await getVault();
  // v3.7.2 (Issue 4): Muat catatan juga supaya search bisa mencari di notes
  // tanpa user harus klik tab Catatan dulu.
  try { currentNotes = await getNotes(); } catch (e) { currentNotes = []; }
  renderVault();
  // v3.11.15: Update visibility tombol batch setelah refresh vault — sebelumnya
  // tidak dipanggil, sehingga tombol batch bisa inconsistent setelah hapus/edit item.
  try { updateBatchModeBtnVisibility(); } catch (e) {}
}
async function init() {
  try { await initTheme(); } catch (e) { console.warn('initTheme failed:', e); }
  try { await refreshVault(); } catch (e) { console.warn('refreshVault failed:', e); }
  try { await detectAiContext(); } catch (e) {}

  // Sticky bars
  await Promise.allSettled([updatePrayerStrip(), updateHabitsStrip(), updateFastStrip()]);
  setInterval(() => Promise.allSettled([updatePrayerStrip(), updateHabitsStrip(), updateFastStrip()]), 60000);

  // Render tools + notes (lazy)
  renderTools();
  await renderNotes();

  bindEvents();
  renderVault();
  // v3.9.0 (Issue 5): Sidebar auto-close after idle (only in sidebar mode)
  try { initSidebarAutoClose(); } catch (e) { console.warn('initSidebarAutoClose failed:', e); }

  // Width responsive for sidebar
  // v3.11.1 (Issue 2 fix): Tambah w-xs (≤280px) dan w-xxs (≤220px) untuk collapse lebih sempit.
  // Sebelumnya cuma w-sm (≤310px) — tidak cukup untuk sidebar super narrow.
  if (document.body.classList.contains('rf-sidebar-body')) {
    const setW = () => {
      const w = window.innerWidth;
      const popup = $('#popup');
      if (!popup) return;
      popup.classList.toggle('w-sm', w <= 360);
      popup.classList.toggle('w-xs', w <= 280);
      popup.classList.toggle('w-xxs', w <= 220);
    };
    setW();
    window.addEventListener('resize', setW);
  }

  // v3.11.1: Focus search — di-skip karena search bar sudah dihapus.
  // Quick-actions bar tidak perlu auto-focus (user pilih tombol yang mau).
}

function bindEvents() {
  // Theme + header
  // v3.7.1-FIX: Set ikon untuk tombol header (sebelumnya kosong/tidak terlihat)
  $('#aiBtn').innerHTML = ICONS.spark;
  $('#settingsBtn').innerHTML = ICONS.gear;
  $('#themeBtn').addEventListener('click', toggleTheme);
  $('#settingsBtn').addEventListener('click', () => browser.runtime.openOptionsPage());
  $('#aiBtn').addEventListener('click', aiToolsSheet);
  $('#scrim').addEventListener('click', closeSheet);
  $('#pageBack').addEventListener('click', closePage);

  // Status strip
  $('#stripBar').addEventListener('click', () => {
    $('#strip').classList.toggle('open');
    // v3.11.36: Recompute .page.top kalau page sedang terbuka, supaya strip-detail
    // (grid 6 waktu shalat) tidak tertutup page saat user expand strip.
    const page = $('#page');
    if (page && page.classList.contains('in')) {
      try {
        const strip = document.querySelector('.strip');
        const popup = document.getElementById('popup');
        if (strip && popup) {
          const stripRect = strip.getBoundingClientRect();
          const popupRect = popup.getBoundingClientRect();
          const offset = Math.round(stripRect.bottom - popupRect.top);
          page.style.top = (offset > 0 && offset < 400) ? offset + 'px' : '95px';
        }
      } catch (e) {}
    }
  });
  $('#habitQuran').addEventListener('click', async () => {
    const s = currentVault?.settings || {};
    if (s.quranEnabled !== false) { await logQuranPages(1, s); await refreshVault(); await updateHabitsStrip(); toast('📖 Ngaji +1 hal'); }
  });
  $('#habitGym').addEventListener('click', async () => {
    const s = currentVault?.settings || {};
    if (s.exerciseEnabled !== false) { await logExerciseDone(s); await refreshVault(); await updateHabitsStrip(); toast('🏃 Olahraga tercatat'); }
  });

  // Hero tiles
  $('#qaPrompt').addEventListener('click', savePromptSheet);
  $('#qaKonteks').addEventListener('click', saveKonteksSheet);
  $('#qaLink').addEventListener('click', saveLinkSheet);
  $('#qaBundle').addEventListener('click', saveBundleSheet);
  $('#qaSnap').addEventListener('click', snapshotFlow);
  $('#qaShot').addEventListener('click', () => doShot());

  // Add item button
  $('#addItemBtn').addEventListener('click', addItemMenu);
  $('#noteAddBtn').addEventListener('click', newNote);
  // v3.11.11 (Issue #1): Batch mode untuk screenshot di vault
  // v3.11.14: Generalisasi — batch mode untuk SEMUA tipe (prompt, link, bundle, archive, dll)
  const vaultBatchModeBtnEl = $('#batchModeBtn');
  if (vaultBatchModeBtnEl) vaultBatchModeBtnEl.addEventListener('click', toggleVaultBatchMode);
  const vaultBatchCopyBtn = $('#vaultBatchCopy');
  if (vaultBatchCopyBtn) vaultBatchCopyBtn.addEventListener('click', () => vaultBatchCopyAction(true));
  const vaultBatchCopyImgBtn = $('#vaultBatchCopyImg');
  if (vaultBatchCopyImgBtn) vaultBatchCopyImgBtn.addEventListener('click', () => vaultBatchCopyAction(false));
  // v3.11.36: Batch copy teks metadata saja (tanpa gambar)
  const vaultBatchCopyMetaBtn = $('#vaultBatchCopyMeta');
  if (vaultBatchCopyMetaBtn) vaultBatchCopyMetaBtn.addEventListener('click', vaultBatchCopyMetaAction);
  // v3.11.14: Tombol batch baru untuk tipe lain
  const vaultBatchCopyTextBtn = $('#vaultBatchCopyText');
  if (vaultBatchCopyTextBtn) vaultBatchCopyTextBtn.addEventListener('click', vaultBatchCopyTextAction);
  const vaultBatchCopyBundleBtn = $('#vaultBatchCopyBundle');
  if (vaultBatchCopyBundleBtn) vaultBatchCopyBundleBtn.addEventListener('click', vaultBatchCopyBundleAction);
  const vaultBatchUnarchiveBtn = $('#vaultBatchUnarchive');
  if (vaultBatchUnarchiveBtn) vaultBatchUnarchiveBtn.addEventListener('click', vaultBatchUnarchiveAction);
  // v3.11.13 (Sesi 12): Batch delete button
  const vaultBatchDeleteBtn = $('#vaultBatchDelete');
  if (vaultBatchDeleteBtn) vaultBatchDeleteBtn.addEventListener('click', vaultBatchDeleteAction);
  const vaultBatchCancelBtn = $('#vaultBatchCancel');
  if (vaultBatchCancelBtn) vaultBatchCancelBtn.addEventListener('click', exitVaultBatchMode);
  // v3.9.0 (Issue 7): Batch mode untuk notes
  $('#noteBatchBtn').addEventListener('click', toggleNotesBatchMode);
  const batchArchiveBtn = $('#notesBatchArchive');
  const batchDeleteBtn = $('#notesBatchDelete');
  const batchCancelBtn = $('#notesBatchCancel');
  if (batchArchiveBtn) batchArchiveBtn.addEventListener('click', () => notesBatchAction('archive'));
  if (batchDeleteBtn) batchDeleteBtn.addEventListener('click', () => notesBatchAction('delete'));
  if (batchCancelBtn) batchCancelBtn.addEventListener('click', exitNotesBatchMode);

  // Tab bar
  $('#tabHome').addEventListener('click', () => setView('home'));
  $('#tabNotes').addEventListener('click', () => setView('notes'));
  $('#tabTools').addEventListener('click', () => setView('tools'));

  // Search / command bar
  // v3.11.1: Search bar sudah dihapus dari sidebar (ganti quick-actions).
  // Pertahankan binding untuk popup mode (yang masih punya search bar).
  // v3.10.2 (Issue 4 fix): Update tombol clear (X) visibility saat user mengetik
  const searchInput = $('#search');
  const searchClearBtn = $('#searchClear');
  function updateClearBtnVisibility() {
    if (!searchClearBtn) return;
    searchClearBtn.style.display = (searchInput && searchInput.value && searchInput.value.length > 0) ? 'flex' : 'none';
  }
  if (searchInput) {
    searchInput.addEventListener('input', e => {
      currentQuery = e.target.value;
      updateClearBtnVisibility();
      renderSearch();
    });
    searchInput.addEventListener('keydown', e => {
      if (e.key === 'Escape') { clearSearch(); updateClearBtnVisibility(); e.target.blur(); }
    });
    // v3.10.2 (Issue 4 fix): Click tombol clear (X) → hapus semua teks sekaligus
    if (searchClearBtn) {
      searchClearBtn.addEventListener('click', () => {
        clearSearch();
        updateClearBtnVisibility();
        searchInput.focus();
      });
    }
  }
  // v3.11.1: Quick-actions bar (pengganti search bar di sidebar)
  // v3.11.2: Tombol "Menu" (qaMoreBtn) dihapus — redundan dengan tombol "Baru" di vault view.
  // v3.11.3: Seluruh quick-actions bar dihapus — user bilang "mubazir yang 4 tombol
  //          di atas jadwal sholat". Tiles row sudah cover semua aksi yang sama.
  // Binding di-comment out (tidak dihapus) untuk dokumentasi sejarah.
  // const qaPrompt = $('#qaNewPrompt');
  // if (qaPrompt) qaPrompt.addEventListener('click', savePromptSheet);
  // const qaNote = $('#qaNewNote');
  // if (qaNote) qaNote.addEventListener('click', () => { setView('notes'); newNote(); });
  // const qaLink = $('#qaNewLink');
  // if (qaLink) qaLink.addEventListener('click', saveLinkSheet);
  // const qaShot = $('#qaQuickShot');
  // if (qaShot) qaShot.addEventListener('click', () => doShot());

  document.addEventListener('keydown', e => {
    const inField = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    // v3.11.1: Shortcuts search hanya aktif kalau search bar ada (popup mode)
    if (searchInput && ((e.key === '/' || (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey))) && !inField)) {
      e.preventDefault();
      setView('home');
      searchInput.focus();
    }
    if (e.key === 'Escape') {
      if ($('#prayerSetupOverlay').style.display !== 'none') closePrayerSetup();
      else if ($('#varsOverlay').style.display !== 'none') closeVarsModal();
      else if ($('#attachOverlay').style.display !== 'none') closeAttachModal();
      else if ($('#sheet').classList.contains('show')) closeSheet();
      else if ($('#page').classList.contains('in')) closePage();
    }
  });

  // Prayer setup
  $('#prayerSetupClose').addEventListener('click', closePrayerSetup);
  $('#prayerSetupCancel').addEventListener('click', closePrayerSetup);
  $('#prayerSetupSave').addEventListener('click', savePrayerSetup);
  $('#prayerGeo').addEventListener('click', prayerGeolocate);
  $('#prayerAddr').addEventListener('input', prayerAddrInputHandler);

  // Vars modal
  $('#varsClose').addEventListener('click', closeVarsModal);
  $('#varsCancel').addEventListener('click', closeVarsModal);
  $('#varsInject').addEventListener('click', confirmInjectWithVars);

  // Attach modal
  $('#attachClose').addEventListener('click', closeAttachModal);
  $('#attachCancel').addEventListener('click', closeAttachModal);
  $('#attachInject').addEventListener('click', confirmAttachInject);
  $('#attachSearch').addEventListener('input', renderAttachList);
  $('#attachIntro').addEventListener('input', renderAttachPreview);
  $('#attachPosition').addEventListener('change', renderAttachPreview);
}

// Listen for storage changes (sync) — guard for non-extension contexts
if (typeof browser !== 'undefined' && browser.storage && browser.storage.onChanged) {
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.recallfox_vault || changes.recallfox_notes)) {
      refreshVault();
      renderNotes();
    }
  });
}

// ============================================================================
// v3.9.0 (Issue 7): Batch mode untuk notes — select multiple + bulk delete/archive
// ============================================================================
let notesBatchMode = false;
const notesBatchSelected = new Set();

function toggleNotesBatchMode() {
  notesBatchMode = !notesBatchMode;
  notesBatchSelected.clear();
  const bar = $('#notesBatchBar');
  if (bar) bar.style.display = notesBatchMode ? 'flex' : 'none';
  if (!notesBatchMode) {
    // Exit mode — uncheck all
    document.querySelectorAll('.note-batch-check').forEach(c => c.checked = false);
  }
  renderNotes();
  toast(notesBatchMode ? '☑️ Mode batch aktif — klik note untuk pilih' : 'Mode batch dimatikan');
}

function exitNotesBatchMode() {
  if (!notesBatchMode) return;
  toggleNotesBatchMode();
}

function updateNotesBatchCount() {
  const countEl = $('#notesBatchCount');
  if (countEl) countEl.textContent = notesBatchSelected.size + ' dipilih';
}

async function notesBatchAction(action) {
  if (notesBatchSelected.size === 0) {
    toast('Pilih minimal 1 note dulu');
    return;
  }
  const ids = Array.from(notesBatchSelected);
  const verb = action === 'delete' ? 'hapus' : 'arsipkan';
  if (!confirm(`${verb.charAt(0).toUpperCase() + verb.slice(1)} ${ids.length} catatan?`)) return;

  for (const id of ids) {
    try {
      if (action === 'delete') {
        await deleteNote(id);
      } else if (action === 'archive') {
        const n = currentNotes.find(x => x.id === id);
        if (n) await updateNote(id, { archived: !n.archived, updatedAt: new Date().toISOString() });
      }
    } catch (e) {
      console.warn('Batch action failed for note', id, e.message);
    }
  }
  toast(`✓ ${ids.length} catatan di${action === 'delete' ? 'hapus' : 'arsipkan'}`);
  notesBatchSelected.clear();
  notesBatchMode = false;
  const bar = $('#notesBatchBar');
  if (bar) bar.style.display = 'none';
  await renderNotes();
}

// ============================================================================
// v3.9.0 (Issue 5): Sidebar auto-close after N minutes of idle
// ============================================================================
// Only active in sidebar mode (body.rf-sidebar-body). Tracks user activity
// (mousemove, keydown, click, scroll, touchstart, input). After N minutes idle,
// closes sidebar via browser.sidebarAction.close() or window.close() fallback.
function initSidebarAutoClose() {
  if (!document.body.classList.contains('rf-sidebar-body')) return;  // popup mode: skip
  let idleTimer = null;
  let lastActivity = Date.now();
  const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart', 'input'];

  async function checkAndSchedule() {
    try {
      const s = await getVault().then(v => v.settings || {});
      const minutes = Number(s.sidebarAutoCloseMinutes) || 0;
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
      if (minutes <= 0) return;
      const idleMs = minutes * 60 * 1000;
      const elapsed = Date.now() - lastActivity;
      const remaining = Math.max(0, idleMs - elapsed);
      idleTimer = setTimeout(async () => {
        const idle = Date.now() - lastActivity;
        if (idle >= idleMs - 5000) {  // allow 5s slack
          console.log(`[RecallFox] Sidebar auto-close after ${minutes}min idle`);
          try {
            if (browser.sidebarAction && browser.sidebarAction.close) {
              await browser.sidebarAction.close();
            } else {
              window.close();
            }
          } catch (e) {
            console.warn('[RecallFox] Sidebar close failed:', e.message);
          }
        } else {
          checkAndSchedule();
        }
      }, remaining);
    } catch (e) {
      console.warn('[RecallFox] Sidebar auto-close check failed:', e.message);
    }
  }

  function onActivity() {
    lastActivity = Date.now();
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
      checkAndSchedule();
    }
  }

  ACTIVITY_EVENTS.forEach(ev => {
    document.addEventListener(ev, onActivity, { passive: true, capture: true });
  });

  setTimeout(checkAndSchedule, 2000);

  if (browser.storage && browser.storage.onChanged) {
    browser.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.recallfox_vault) {
        const newVault = changes.recallfox_vault.newValue;
        if (newVault?.settings?.sidebarAutoCloseMinutes !== undefined) {
          checkAndSchedule();
        }
      }
    });
  }
}

init().catch(e => console.error('[RecallFox] init failed:', e));

// ============================================================================
// v3.11.7-fix (Issue #6): Adzan sound handler — mainkan suara adzan saat masuk waktu sholat
// Dipicu oleh background.js via browser.runtime.sendMessage({ type: 'PLAY_ADZAN' })
// Audio hanya bisa di-play dari context page (popup/sidebar), bukan background.
// ============================================================================

let _adzanAudio = null;
let _adzanBanner = null;

// URL adzan default — pakai CDN publik (no API key needed).
// File adzan pendek (~30 detik) dari IslamicFinder CDN (gratis, sering dipakai aplikasi adzan).
const ADZAN_URLS = {
  default: 'https://www.islamicfinder.org/cms/audio/azan1/azan1.mp3',
  short: 'https://www.islamicfinder.org/cms/audio/azan2/azan2.mp3'
};

function _stopAdzan() {
  if (_adzanAudio) {
    // v3.11.9: Handle 2 jenis — Audio element ATAU Web Audio API context
    if (_adzanAudio._toneCtx) {
      // Web Audio API tone
      try { _adzanAudio._toneCtx.close(); } catch (e) {}
    } else {
      // Audio element
      try { _adzanAudio.pause(); _adzanAudio.currentTime = 0; } catch (e) {}
    }
    _adzanAudio = null;
  }
  if (_adzanBanner) {
    try { _adzanBanner.remove(); } catch (e) {}
    _adzanBanner = null;
  }
  // v3.11.7-fix2 (Sesi 7, Issue #5): Hide tombol Stop global di header
  const stopBtn = document.getElementById('adzanStopBtn');
  if (stopBtn) stopBtn.style.display = 'none';
  // v3.11.8 (Issue #5): Hide tombol Stop di strip jadwal sholat juga
  const stripStopBtn = document.getElementById('stripAdzanStop');
  if (stripStopBtn) stripStopBtn.style.display = 'none';
  // v3.11.7-fix2: Juga broadcast STOP_ADZAN ke content script tab aktif (kalau adzan
  // di-play di tab aktif, bukan di popup)
  try {
    browser.runtime.sendMessage({ type: 'STOP_ADZAN' }).catch(() => {});
  } catch (e) {}
}

// v3.11.7-fix2 (Sesi 7, Issue #5): Toggle tombol Stop global di header saat adzan aktif.
// Dipanggil dari _playAdzan (popup context) dan dari handler PLAY_ADZAN (saat background
// kirim ke popup). Tombol muncul sebagai icon ⏹ hijau di header — mudah diakses tanpa
// masuk settings.
function _showAdzanStopButton() {
  const stopBtn = document.getElementById('adzanStopBtn');
  if (stopBtn) {
    stopBtn.style.display = '';
    // Bind click handler (sekali saja, tapi idempotent)
    if (!stopBtn.dataset.bound) {
      stopBtn.addEventListener('click', _stopAdzan);
      stopBtn.dataset.bound = '1';
    }
  }
  // v3.11.8 (Issue #5): Show tombol Stop di strip jadwal sholat juga (selalu visible)
  const stripStopBtn = document.getElementById('stripAdzanStop');
  if (stripStopBtn) {
    stripStopBtn.style.display = '';
    if (!stripStopBtn.dataset.bound) {
      stripStopBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        _stopAdzan();
      });
      stripStopBtn.dataset.bound = '1';
    }
  }
}

function _playAdzan(prayer, prayerKey, volume, sound, customUrl) {
  // Stop adzan sebelumnya kalau ada
  _stopAdzan();

  const vol = Math.max(0, Math.min(1, Number(volume) || 0.7));

  // v3.11.9 (Issue #3 fix): Adzan pakai 2 strategi:
  // 1. Jika sound='custom' + customUrl → pakai Audio element dengan URL custom
  // 2. Jika sound='default'/'short' → pakai Web Audio API generate tone (PASTI JALAN, no CORS, no 404)
  //    Sebelumnya pakai URL IslamicFinder yang 404 → error terus.
  //    Tone ini bukan adzan asli, tapi cukup sebagai pengingat waktu sholat.
  //    User yang mau adzan asli bisa set custom URL ke file MP3 sendiri.

  let _adzanTimeout = null;

  if (sound === 'custom' && customUrl) {
    // Strategy 1: Custom URL — pakai Audio element
    try {
      _adzanAudio = new Audio(customUrl);
      _adzanAudio.volume = vol;
      _adzanAudio.crossOrigin = 'anonymous';
      _adzanAudio.play().catch(e => {
        console.warn('[RecallFox] Custom adzan play failed:', e.message);
        // Fallback ke tone
        _playAdzanTone(vol);
      });
    } catch (e) {
      console.warn('[RecallFox] Custom adzan init failed:', e.message);
      _playAdzanTone(vol);
    }
  } else {
    // Strategy 2: Web Audio API tone (default + short)
    _playAdzanTone(vol, sound === 'short');
  }

  // Tampilkan banner Stop (fixed di bawah, tidak nutupin konten)
  _adzanBanner = document.createElement('div');
  _adzanBanner.id = 'rfAdzanBanner';
  _adzanBanner.style.cssText = [
    'position:fixed',
    'bottom:0',
    'left:0',
    'right:0',
    'background:linear-gradient(135deg,#10b981,#059669)',
    'color:#fff',
    'padding:10px 16px',
    'display:flex',
    'align-items:center',
    'justify-content:space-between',
    'gap:10px',
    'z-index:99999',
    'font-size:13px',
    'box-shadow:0 -2px 12px rgba(0,0,0,0.15)',
    'font-family:inherit'
  ].join(';');
  _adzanBanner.innerHTML =
    '<div style="display:flex;align-items:center;gap:8px">'
    + '<span style="font-size:18px">🕌</span>'
    + '<div>'
    +   '<div style="font-weight:600">Adzan — ' + prayer + ' telah masuk</div>'
    +   '<div style="font-size:11px;opacity:0.85">Klik ⏹ Stop untuk menghentikan suara</div>'
    + '</div>'
    + '</div>'
    + '<button id="rfAdzanStop" style="background:rgba(255,255,255,0.2);color:#fff;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600">⏹ Stop</button>';
  document.body.appendChild(_adzanBanner);

  // Bind tombol Stop
  const stopBtn = _adzanBanner.querySelector('#rfAdzanStop');
  if (stopBtn) {
    stopBtn.addEventListener('click', _stopAdzan);
  }

  // Auto-cleanup saat audio selesai (hanya untuk custom URL)
  if (_adzanAudio) {
    _adzanAudio.onended = () => _stopAdzan();
    _adzanAudio.onerror = () => {
      console.warn('[RecallFox] Adzan audio error — fallback ke tone');
      _stopAdzan();
      _playAdzanTone(vol);
    };
  }

  // Auto-stop setelah 2 menit (safety)
  _adzanTimeout = setTimeout(() => {
    if (_adzanAudio || _adzanBanner) {
      console.log('[RecallFox] Adzan auto-stop after 2 minutes');
      _stopAdzan();
    }
  }, 2 * 60 * 1000);

  // v3.11.7-fix2 (Sesi 7, Issue #5): Tampilkan tombol Stop global di header
  _showAdzanStopButton();
}

// v3.11.10 (Issue #3 fix): REWRITE adzan tone jadi lebih mirip suara adzan asli.
// V3.11.9 pakai 7 nada sine wave pendek → user dengar seperti "bel", bukan adzan.
// V3.11.10: 4 phrase "Allahu Akbar" (30+ detik) dengan:
//   - Multiple oscillators (chord) supaya kaya suara manusia
//   - Frequency modulation (vibrato) supaya tidak monoton
//   - Reverb effect (delay + feedback) supaya sound like mosque
//   - Durasi lebih panjang (4 phrase × ~7 detik = ~28 detik)
//   - Singkat kata per phrase: "Al-la-hu Ak-bar" (4 syllable)
//
// Plus: tetap allow custom URL ke file MP3 adzan asli (di settings).
function _playAdzanTone(vol, isShort) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) {
      console.warn('[RecallFox] Web Audio API tidak support');
      return;
    }
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    // ===== Reverb effect (delay + feedback) supaya sound like mosque =====
    const reverbDelay = ctx.createDelay(2.0);
    reverbDelay.delayTime.value = 0.18; // 180ms delay
    const reverbFeedback = ctx.createGain();
    reverbFeedback.gain.value = 0.35; // 35% feedback
    const reverbWet = ctx.createGain();
    reverbWet.gain.value = 0.25; // 25% wet mix
    reverbDelay.connect(reverbFeedback);
    reverbFeedback.connect(reverbDelay);
    reverbDelay.connect(reverbWet);

    // ===== Master gain + low-pass filter (supaya tidak terlalu bright/harsh) =====
    const masterGain = ctx.createGain();
    masterGain.gain.value = vol;
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 2400; // cut frequencies above 2400Hz
    lowpass.Q.value = 0.7;

    masterGain.connect(lowpass);
    lowpass.connect(ctx.destination);
    lowpass.connect(reverbDelay); // send to reverb
    reverbWet.connect(ctx.destination);

    // ===== Phrase: "Allahu Akbar" motif =====
    // Setiap phrase = 4 syllable: "Al-la-hu Ak-bar"
    // Syllable mapping (Hz):
    //   "Al"  = A4 (440) — singkat
    //   "la"  = G4 (392) — singkat
    //   "hu"  = A4 (440) — sedang
    //   "Ak"  = E4 (329.63) — singkat, lower
    //   "bar" = A4 (440) — panjang (sustain)
    //
    // Phrase 1 (Allahu Akbar) — base
    // Phrase 2 (Allahu Akbar) — repeat, slightly higher
    // Phrase 3 (Allahu Akbar) — repeat, modulasi
    // Phrase 4 (Allahu Akbar) — final, panjang
    const syllables = [
      // [freq, startOffset, dur, gain]
      // Phrase 1 (0-7s)
      { freq: 440, start: 0.0, dur: 0.6, gain: 0.9 },  // Al
      { freq: 392, start: 0.6, dur: 0.5, gain: 0.85 }, // la
      { freq: 440, start: 1.1, dur: 0.7, gain: 0.9 },  // hu
      { freq: 329.63, start: 1.8, dur: 0.5, gain: 0.8 }, // Ak
      { freq: 440, start: 2.3, dur: 1.5, gain: 1.0 },  // bar (panjang)
      // Pause
      { freq: 0, start: 3.8, dur: 0.4, gain: 0 }, // pause
      // Phrase 2 (4.2-11s) — slightly higher
      { freq: 466.16, start: 4.2, dur: 0.6, gain: 0.9 },  // Al (Bb4)
      { freq: 415.30, start: 4.8, dur: 0.5, gain: 0.85 }, // la (Ab4)
      { freq: 466.16, start: 5.3, dur: 0.7, gain: 0.9 },  // hu (Bb4)
      { freq: 349.23, start: 6.0, dur: 0.5, gain: 0.8 },  // Ak (F4)
      { freq: 466.16, start: 6.5, dur: 1.5, gain: 1.0 },  // bar (panjang)
      // Pause
      { freq: 0, start: 8.0, dur: 0.4, gain: 0 },
    ];

    // Untuk short version, hanya 2 phrase
    const phrases = isShort ? syllables.slice(0, 6) : syllables;

    // ===== Mainkan setiap syllable dengan chord + vibrato =====
    for (const syl of phrases) {
      if (syl.freq === 0) continue; // skip pause
      const start = now + syl.start;
      const end = start + syl.dur;

      // Chord: fundamental + 2 harmonics (octave + fifth) supaya kaya voice
      const harmonics = [
        { ratio: 1.0, gain: 0.6 },     // fundamental
        { ratio: 2.0, gain: 0.2 },     // octave
        { ratio: 1.5, gain: 0.15 },    // fifth
      ];

      for (const h of harmonics) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine'; // sine = smooth, less harsh
        osc.frequency.value = syl.freq * h.ratio;

        // Vibrato: frequency modulation supaya tidak monoton
        const vibrato = ctx.createOscillator();
        const vibratoGain = ctx.createGain();
        vibrato.frequency.value = 5; // 5Hz vibrato
        vibratoGain.gain.value = syl.freq * 0.015; // 1.5% pitch modulation
        vibrato.connect(vibratoGain);
        vibratoGain.connect(osc.frequency);

        // Envelope: attack-decay-sustain-release
        const peakGain = vol * syl.gain * h.gain;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(peakGain, start + 0.08); // attack 80ms
        gain.gain.linearRampToValueAtTime(peakGain * 0.75, start + syl.dur * 0.5); // sustain
        gain.gain.linearRampToValueAtTime(0, end); // release

        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(start);
        osc.stop(end + 0.1);
        vibrato.start(start);
        vibrato.stop(end + 0.1);
      }
    }

    // Simpan context supaya bisa di-stop
    _adzanAudio = { _toneCtx: ctx, _toneGain: masterGain };

    // Auto-stop context setelah selesai (30s untuk default, 10s untuk short)
    const totalDur = isShort ? 10 : 28;
    setTimeout(() => {
      try {
        if (ctx.state !== 'closed') ctx.close();
      } catch (e) {}
    }, totalDur * 1000 + 500);

    console.log('[RecallFox] Adzan tone diputar (' + (isShort ? 'short' : 'default') + ', ' + phrases.length + ' syllables, ~' + totalDur + 's)');
  } catch (e) {
    console.warn('[RecallFox] Adzan tone failed:', e.message);
  }
}

// Listener untuk message PLAY_ADZAN dari background
// v3.11.9 (Issue #2 fix): return `true` untuk async response supaya tidak
// "Promised response from onMessage listener went out of scope"
if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.onMessage) {
  browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'PLAY_ADZAN') {
      try {
        _playAdzan(msg.prayer, msg.prayerKey, msg.volume, msg.sound, msg.customUrl);
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
      return true; // v3.11.9: return true supaya sendResponse tidak out of scope
    }
    if (msg.type === 'STOP_ADZAN') {
      try {
        _stopAdzan();
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
      return true;
    }
    return false;
  });
}
