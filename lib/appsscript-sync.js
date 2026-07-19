// lib/appsscript-sync.js — Sync vault ke Google Spreadsheet via Apps Script Web App
// RecallFox v3.8.0 (Log Troubleshooting Sesi 1 — Issue 1+2+6)
//
// Tujuan:
//   - Mengapa fitur ini dibuat? User mengeluh "klik kirim, berhasil terkirim 1
//     tapi spreadsheet kosong". Penyebabnya: fitur Apps Script Sync TIDAK ADA
//     di versi sebelumnya — yang ada hanya Firefox Sync (browser.storage.sync)
//     yang TIDAK mengirim ke spreadsheet. User melihat toast "Tersinkron" lalu
//     salah mengira datanya sudah masuk spreadsheet. Modul ini mengimplementasikan
//     sync yang sebenarnya: POST HTTP ke Apps Script Web App yang user deploy
//     sendiri, dengan verifikasi response.
//
//   - Payload dipersatukan dengan backup lokal (buildBackupPayload di
//     autobackup.js) supaya tidak mubazir (Issue 6). Satu serializer, tiga
//     transport: disk / Firefox Sync / Apps Script.
//
//   - Spreadsheet menerima payload sebagai baris-baris per item (bukan JSON
//     blob utuh) supaya user bisa baca & filter datanya. Lihat Apps Script
//     template di /apps-script/recallfox-sync.gs untuk implementasi sisi server.
//
// Keamanan:
//   - URL Apps Script disimpan di storage.local (tidak disinkron ke Firefox Sync).
//   - Token bearer dikirim di header Authorization — Apps Script WAJIB verifikasi
//     token ini sebelum proses POST.
//   - Tidak ada auto-sync default — user harus explicit enable.

import { getVault, saveSettings } from './storage.js';
import { buildBackupPayload } from './autobackup.js';

// Debounce timer untuk auto-sync
let autoSyncTimer = null;
const AUTO_SYNC_DEBOUNCE_MS = 30000; // 30 detik

// ===== Public API =====

/**
 * Kirim payload vault ke Apps Script Web App.
 *
 * @param {Object} opts — opsi override (opsional)
 *   - opts.silent: kalau true, tidak update lastSentError di storage (untuk auto-sync)
 * @returns {Promise<{ok: boolean, error?: string, rowsAppended?: number, totalRows?: number}>}
 */
export async function pushToAppsScript(opts = {}) {
  const vault = await getVault();
  const settings = vault.settings || {};
  const url = (settings.appsScriptUrl || '').trim();
  const token = (settings.appsScriptToken || '').trim();

  if (!url) {
    return { ok: false, error: 'URL Apps Script belum diset. Buka Settings → Apps Script Sync.' };
  }
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec/i.test(url) &&
      !/^https:\/\/script\.googleusercontent\.com\/macros\/echo/i.test(url)) {
    return { ok: false, error: 'URL tidak valid — harus https://script.google.com/macros/s/.../exec' };
  }

  // Bangun payload (unified dengan backup)
  const payload = await buildBackupPayload();

  // Filter sesuai preferensi user
  const filtered = {
    version: payload.version,
    exportedAt: payload.exportedAt,
    addonVersion: payload.addonVersion,
    vault: payload.vault,
    meta: payload.meta
  };
  if (settings.appsScriptIncludeNotes !== false) filtered.notes = payload.notes || [];
  if (settings.appsScriptIncludeScreenshots !== false) {
    // Hanya kirim metadata screenshot (bukan base64 blob — terlalu besar utk spreadsheet).
    filtered.screenshotMeta = (payload.vault.items || [])
      .filter(i => i.type === 'screenshot')
      .map(i => ({
        id: i.id,
        title: i.title,
        mode: i.screenshotMode,
        width: i.screenshotWidth,
        height: i.screenshotHeight,
        format: i.screenshotFormat,
        bytes: i.screenshotBytes,
        sourceUrl: i.source?.url || '',
        capturedAt: i.source?.capturedAt || i.createdAt,
        createdAt: i.createdAt,
        updatedAt: i.updatedAt,
        // v3.11.0 (Issue 2): Sertakan driveFileUrl + driveFileId kalau sudah di-upload sebelumnya.
        // Supaya sheet 'ScreenshotMeta' selalu menampilkan link Drive untuk screenshot yang sudah di-upload.
        driveFileUrl: i.driveFileUrl || '',
        driveFileId: i.driveFileId || ''
      }));
  }
  if (settings.appsScriptIncludeHabits !== false) filtered.habits = payload.habits || null;
  if (settings.appsScriptIncludeChat === true) filtered.assistantChat = payload.assistantChat || null;
  if (settings.appsScriptIncludeVolume === true) filtered.volumeSettings = payload.volumeSettings || null;

  // v3.11.0 (Issue 1): STRIP vault.settings dari payload yang dikirim.
  // Sebelumnya: filtered.vault = payload.vault (utuh, mengandung appsScriptToken!).
  // Risiko: token bearer terkirim ke spreadsheet walau user tidak expect.
  // Plus: kurangi payload size (settings bisa besar karena default values).
  if (filtered.vault) {
    filtered.vault = {
      version: filtered.vault.version,
      items: filtered.vault.items || [],
      bundles: filtered.vault.bundles || [],
      toppings: filtered.vault.toppings || []
      // settings SENGAJA tidak diikutkan — berisi token + preferences lokal
    };
  }

  // v3.11.0 (Issue 1): STRIP thumbnailDataUrl dari setiap screenshot item.
  // Sebelumnya: setiap screenshot item mengandung thumbnailDataUrl (PNG 200px base64, ~10-50KB).
  // 100 screenshot = 5MB → payloadApps Script doPost reject (size limit 50MB, tapi praktis
  // sering kena timeout atau truncation). Apps Script hanya perlu metadata untuk sheet.
  if (Array.isArray(filtered.vault?.items)) {
    filtered.vault.items = filtered.vault.items.map(it => {
      if (it.type === 'screenshot' && it.thumbnailDataUrl) {
        const { thumbnailDataUrl, screenshotDataUrl, ...rest } = it;
        return rest;
      }
      return it;
    });
  }

  // Bangun body request. Apps Script doPost(e) terima e.parameter.action & e.postData.contents.
  // Kita kirim JSON utuh supaya Apps Script bisa pilih: append per-item atau replace-all.
  const body = JSON.stringify({
    action: 'sync',
    token: token, // redundan dengan header Authorization (untuk Apps Script yang cek body saja)
    payload: filtered
  });

  // v3.11.0 (Issue 1): Log payload size untuk debugging
  console.log('[RecallFox] Apps Script sync payload size:', (body.length / 1024).toFixed(1), 'KB');

  // v3.11.0 (Issue 1): FIX CORS preflight.
  // Sebelumnya: 'Content-Type: application/json' memicu CORS preflight (OPTIONS request).
  // Apps Script Web App endpoint TIDAK respons OPTIONS dengan CORS header valid → fetch POST diblokir.
  // GET (test koneksi) tidak kena preflight karena tidak ada Content-Type header → itu sebabnya ping sukses.
  // Solusi: ganti Content-Type ke 'text/plain;charset=utf-8' (simple request, tidak trigger preflight).
  // Apps Script tetap terima body JSON di e.postData.contents dan JSON.parse-nya.
  // Plus: tambah query param ?action=sync&alt=json supaya Apps Script return JSON (bukan HTML redirect).
  const syncUrl = url + (url.includes('?') ? '&' : '?') + 'action=sync&alt=json';

  // Kirim dengan timeout 60 detik (sebelumnya 30s — terlalu pendek untuk payload besar)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);
  let res;
  try {
    res = await fetch(syncUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
        'Authorization': 'Bearer ' + token
      },
      body,
      signal: controller.signal
    });
  } catch (e) {
    clearTimeout(timeoutId);
    const msg = e.name === 'AbortError' ? 'Timeout (60s) — periksa koneksi / URL Apps Script / payload size' : e.message;
    if (!opts.silent) await saveSettings({ appsScriptLastSentError: msg });
    return { ok: false, error: msg };
  }
  clearTimeout(timeoutId);

  if (!res.ok) {
    let msg = 'HTTP ' + res.status;
    try {
      const errText = await res.text();
      if (errText) msg += ': ' + errText.slice(0, 300);
    } catch (e) {}
    if (!opts.silent) await saveSettings({ appsScriptLastSentError: msg });
    return { ok: false, error: msg };
  }

  // Parse response JSON
  let data;
  try {
    data = await res.json();
  } catch (e) {
    // Beberapa deployment Apps Script return text/plain. Coba parse text.
    try {
      const txt = await res.text();
      data = txt ? JSON.parse(txt) : {};
    } catch (e2) {
      const msg = 'Response Apps Script tidak valid (bukan JSON): ' + e2.message + '. Raw: ' + (txt || '').slice(0, 200);
      if (!opts.silent) await saveSettings({ appsScriptLastSentError: msg });
      return { ok: false, error: msg };
    }
  }

  // Verifikasi response. Apps Script WAJIB return {ok:true, rowsAppended:N, totalRows:M, receivedAt:ISO}.
  // Tanpa verifikasi ini, "kirim berhasil" tapi spreadsheet kosong bisa terjadi lagi.
  if (!data || data.ok !== true) {
    const msg = data?.error || 'Apps Script tidak return {ok:true}. Periksa implementasi server (lihat apps-script/recallfox-sync.gs).';
    if (!opts.silent) await saveSettings({ appsScriptLastSentError: msg });
    return { ok: false, error: msg };
  }

  // Sukses — simpan metadata
  await saveSettings({
    appsScriptLastSentAt: new Date().toISOString(),
    appsScriptLastSentRows: data.totalRows || data.rowsAppended || 0,
    appsScriptLastSentError: null
  });

  return {
    ok: true,
    rowsAppended: data.rowsAppended || 0,
    totalRows: data.totalRows || 0,
    receivedAt: data.receivedAt || new Date().toISOString()
  };
}

/**
 * Test koneksi ke Apps Script (ping) — kirim payload minimal, hanya untuk
 * memverifikasi URL + token valid. Tidak menulis data ke spreadsheet.
 */
export async function testAppsScriptConnection() {
  const vault = await getVault();
  const settings = vault.settings || {};
  const url = (settings.appsScriptUrl || '').trim();
  const token = (settings.appsScriptToken || '').trim();

  if (!url) return { ok: false, error: 'URL belum diset' };

  // v3.11.0 (Issue 1): Tambah alt=json supaya Apps Script return JSON (bukan HTML redirect)
  const pingUrl = url + (url.includes('?') ? '&' : '?') + 'action=ping&alt=json';
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(pingUrl, {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + token }
    });
    clearTimeout(timeoutId);
    if (!res.ok) return { ok: false, error: 'HTTP ' + res.status };
    const data = await res.json().catch(() => ({}));
    if (data.ok !== true) {
      return { ok: false, error: data.error || 'Apps Script tidak return {ok:true} untuk ping' };
    }
    return {
      ok: true,
      version: data.version || 'unknown',
      spreadsheetUrl: data.spreadsheetUrl || '',
      totalRows: data.totalRows || 0
    };
  } catch (e) {
    clearTimeout(timeoutId);
    return { ok: false, error: e.name === 'AbortError' ? 'Timeout (15s)' : e.message };
  }
}

/**
 * v3.11.0 (Issue 2): Upload screenshot blob ke Google Drive via Apps Script.
 *
 * Flow:
 *   1. RecallFox POST base64 image ke Apps Script endpoint dengan action=upload_screenshot
 *   2. Apps Script decode base64 → DriveApp.createFile() → setSharing ANYONE_WITH_LINK
 *   3. Apps Script return {ok:true, driveFileUrl, driveFileId}
 *   4. RecallFox simpan driveFileUrl + driveFileId ke screenshot item via updateItem()
 *
 * Prasyarat:
 *   - User sudah deploy ulang apps-script/recallfox-sync.gs dengan scope drive.file
 *   - appsScriptSyncEnabled = true
 *   - appsScriptUploadScreenshots = true (default)
 *
 * @param {Object} item — screenshot vault item (harus punya id + screenshotFormat)
 * @returns {Promise<{ok:boolean, driveFileUrl?:string, driveFileId?:string, error?:string}>}
 */
export async function pushScreenshotToDrive(item) {
  if (!item || !item.id) return { ok: false, error: 'invalid_item' };
  const vault = await getVault();
  const settings = vault.settings || {};
  const url = (settings.appsScriptUrl || '').trim();
  const token = (settings.appsScriptToken || '').trim();

  if (!url) return { ok: false, error: 'URL Apps Script belum diset' };
  if (!settings.appsScriptSyncEnabled) return { ok: false, error: 'Apps Script Sync belum diaktifkan' };
  if (settings.appsScriptUploadScreenshots === false) return { ok: false, error: 'Upload screenshot dimatikan di settings' };

  // Lazy-load blob dari storage.local
  const { getScreenshotBlob } = await import('./storage.js');
  const dataUrl = await getScreenshotBlob(item.id);
  if (!dataUrl) return { ok: false, error: 'Screenshot blob tidak ditemukan di storage.local' };

  // Strip "data:image/png;base64," prefix → ambil base64 only
  const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!match) return { ok: false, error: 'Format dataUrl tidak valid' };
  const format = match[1] === 'jpeg' ? 'jpeg' : 'png';
  const base64Data = match[2];
  const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';

  // Payload JSON dengan base64
  const body = JSON.stringify({
    action: 'upload_screenshot',
    token: token,
    payload: {
      id: item.id,
      title: (item.title || 'screenshot').slice(0, 100),
      format: format,
      mimeType: mimeType,
      base64Data: base64Data,
      capturedAt: item.source?.capturedAt || item.createdAt || new Date().toISOString(),
      sourceUrl: item.source?.url || '',
      sourceTitle: item.source?.title || ''
    }
  });

  console.log('[RecallFox] Uploading screenshot to Drive:', item.id, 'size:', (base64Data.length / 1024).toFixed(1), 'KB');

  const uploadUrl = url + (url.includes('?') ? '&' : '?') + 'action=upload_screenshot&alt=json';
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);
  let res;
  try {
    res = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
        'Authorization': 'Bearer ' + token
      },
      body,
      signal: controller.signal
    });
  } catch (e) {
    clearTimeout(timeoutId);
    return { ok: false, error: e.name === 'AbortError' ? 'Timeout (60s)' : e.message };
  }
  clearTimeout(timeoutId);

  if (!res.ok) {
    let msg = 'HTTP ' + res.status;
    try {
      const errText = await res.text();
      if (errText) msg += ': ' + errText.slice(0, 200);
    } catch (e) {}
    return { ok: false, error: msg };
  }

  let data;
  try {
    data = await res.json();
  } catch (e) {
    try {
      const txt = await res.text();
      data = txt ? JSON.parse(txt) : {};
    } catch (e2) {
      return { ok: false, error: 'Response Apps Script tidak valid: ' + e2.message };
    }
  }

  if (!data || data.ok !== true) {
    return { ok: false, error: data?.error || 'Apps Script tidak return {ok:true}' };
  }

  return {
    ok: true,
    driveFileUrl: data.driveFileUrl || '',
    driveFileId: data.driveFileId || '',
    driveFileName: data.driveFileName || ''
  };
}

/**
 * Schedule auto-sync (debounced 30s). Dipanggil saat vault berubah &
 * user enable appsScriptAutoSync. Tidak blocking — jalankan di background.
 */
export function scheduleAutoAppsScriptSync() {
  if (autoSyncTimer) clearTimeout(autoSyncTimer);
  autoSyncTimer = setTimeout(async () => {
    autoSyncTimer = null;
    try {
      const vault = await getVault();
      if (!vault.settings.appsScriptSyncEnabled || !vault.settings.appsScriptAutoSync) return;
      console.log('[RecallFox] Auto-sync Apps Script triggered (debounced 30s)');
      const res = await pushToAppsScript({ silent: true });
      if (!res.ok) {
        console.warn('[RecallFox] Auto-sync Apps Script gagal:', res.error);
      } else {
        console.log('[RecallFox] Auto-sync Apps Script OK:', res.totalRows, 'rows');
      }
    } catch (e) {
      console.warn('[RecallFox] Auto-sync Apps Script exception:', e.message);
    }
  }, AUTO_SYNC_DEBOUNCE_MS);
}

/**
 * Ambil status terakhir sync (untuk UI).
 */
export async function getAppsScriptStatus() {
  const vault = await getVault();
  const s = vault.settings || {};
  return {
    enabled: !!s.appsScriptSyncEnabled,
    url: s.appsScriptUrl || '',
    hasToken: !!(s.appsScriptToken || '').trim(),
    lastSentAt: s.appsScriptLastSentAt || null,
    lastSentRows: s.appsScriptLastSentRows || 0,
    lastError: s.appsScriptLastSentError || null,
    autoSync: !!s.appsScriptAutoSync
  };
}
