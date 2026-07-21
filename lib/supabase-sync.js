// lib/supabase-sync.js — Sync vault items, notes, settings, screenshots ke Supabase
// RecallFox v3.11.21
//
// Modul ini menggantikan (atau melengkapi) sync-profile.js (Apps Script).
// User feedback: "saya frustasi dengan apps script yang tidak berhasil sudah dua hari
// untuk save gambar screenshot di drive. oleh karena itu buatkan databasenya menggunakan
// suppabase untuk menyimpan seluruh data yang dihasilkan di dalam addon seperti desain
// apps sync nya aja namun versi otomatis karena ini kan pake suppabase"
//
// === CARA KERJA ===
// 1. User login via Supabase Auth (email/password atau Gmail OAuth).
// 2. Setiap perubahan vault (tambah/edit/hapus item) → trigger pushToSupabase()
//    (debounced 5 detik, fire-and-forget).
// 3. User bisa klik "Pull dari Cloud" untuk download state terbaru.
// 4. Screenshot full image di-upload ke Supabase Storage bucket 'screenshots'.
//
// === TABLES ===
// - vault_items: prompt, context, link, snapshot, screenshot metadata, bundle
// - notes: catatan notepad
// - settings: preferensi user (key-value)
// - screenshots: metadata + storage path
// - sync_log: audit trail
//
// === RLS ===
// Semua table punya Row Level Security — user hanya bisa akses row miliknya
// (filter: user_id = auth.uid()).

import {
  getSession, isLoggedIn, getUserId,
  selectRows, upsertRow, deleteRow, insertRow,
  uploadFile, deleteFile,
  SUPABASE_URL
} from './supabase-client.js';
import { getVault, getNotes, saveVault, saveNotes, getSettings, saveSettings, getAllScreenshotBlobKeys } from './storage.js';

const SYNC_LOG_TABLE = 'sync_log';
const VAULT_TABLE = 'vault_items';
const NOTES_TABLE = 'notes';
const SETTINGS_TABLE = 'settings';
const SCREENSHOTS_TABLE = 'screenshots';
const STORAGE_BUCKET = 'screenshots';

// ============== STATUS ==============

/**
 * Get status sync Supabase — apakah login, user info, last sync, dll.
 */
export async function getSupabaseStatus() {
  const loggedIn = await isLoggedIn();
  if (!loggedIn) {
    return { loggedIn: false };
  }
  const user = await getCurrentUser();
  const userId = await getUserId();
  // Ambil last sync dari storage.local
  let lastSync = null;
  try {
    const data = await browser.storage.local.get('recallfox_supabase_last_sync');
    lastSync = data.recallfox_supabase_last_sync || null;
  } catch (e) {}
  return {
    loggedIn: true,
    user,
    userId,
    lastSync
  };
}

async function getCurrentUser() {
  const session = await getSession();
  return session?.user || null;
}

async function _setLastSync(direction, counts) {
  const lastSync = {
    at: new Date().toISOString(),
    direction,
    counts
  };
  try {
    await browser.storage.local.set({ 'recallfox_supabase_last_sync': lastSync });
  } catch (e) {}
}

// ============== PUSH (upload local → cloud) ==============

/**
 * Push state lokal ke Supabase Cloud.
 * - Vault items → upsert ke vault_items table
 * - Notes → upsert ke notes table
 * - Settings → upsert ke settings table
 * - Screenshot blobs → upload ke Storage bucket
 *
 * Returns: { ok, stats: { items, notes, settings, screenshots, errors } }
 */
export async function pushToSupabase() {
  if (!(await isLoggedIn())) {
    return { ok: false, error: 'not_logged_in' };
  }
  const userId = await getUserId();
  if (!userId) return { ok: false, error: 'no_user_id' };

  const startTime = Date.now();
  const stats = { items: 0, notes: 0, settings: 0, screenshots: 0, errors: [] };

  try {
    // === 1. Push vault items ===
    const vault = await getVault();
    const items = vault.items || [];
    const bundles = vault.bundles || [];
    const allToppings = vault.toppings || [];

    // Items (prompt, context, link, snapshot, screenshot)
    for (const item of items) {
      try {
        const row = _buildVaultItemRow(item, userId);
        const res = await upsertRow(VAULT_TABLE, row);
        if (res.ok) stats.items++;
        else stats.errors.push({ id: item.id, error: res.error });

        // Kalau screenshot, upload blob ke Storage juga
        if (item.type === 'screenshot') {
          const blobRes = await _uploadScreenshotBlob(item, userId);
          if (blobRes.ok) stats.screenshots++;
          else stats.errors.push({ id: item.id, error: 'storage: ' + blobRes.error });
        }
      } catch (e) {
        stats.errors.push({ id: item.id, error: e.message });
      }
    }

    // Bundles (simpan sebagai row type='bundle')
    for (const bundle of bundles) {
      try {
        const row = _buildBundleRow(bundle, userId);
        const res = await upsertRow(VAULT_TABLE, row);
        if (res.ok) stats.items++;
        else stats.errors.push({ id: bundle.id, error: res.error });
      } catch (e) {
        stats.errors.push({ id: bundle.id, error: e.message });
      }
    }

    // === 2. Push notes ===
    const notes = await getNotes();
    for (const note of notes) {
      try {
        const row = _buildNoteRow(note, userId);
        const res = await upsertRow(NOTES_TABLE, row);
        if (res.ok) stats.notes++;
        else stats.errors.push({ id: note.id, error: res.error });
      } catch (e) {
        stats.errors.push({ id: note.id, error: e.message });
      }
    }

    // === 3. Push settings ===
    const settings = vault.settings || {};
    for (const [key, value] of Object.entries(settings)) {
      // Skip sensitive fields
      if (_isSensitiveSetting(key)) continue;
      try {
        const row = _buildSettingRow(key, value, userId);
        const res = await upsertRow(SETTINGS_TABLE, row);
        if (res.ok) stats.settings++;
      } catch (e) {
        stats.errors.push({ key, error: e.message });
      }
    }

    // === 4. Log sync ===
    await _logSync('push', 'upload', stats, Date.now() - startTime);
    await _setLastSync('push', stats);

    return { ok: true, stats };
  } catch (e) {
    return { ok: false, error: e.message, stats };
  }
}

// ============== PULL (download cloud → local) ==============

/**
 * Pull state terbaru dari Supabase Cloud ke local.
 * - Vault items → merge ke vault local (upsert by id)
 * - Notes → merge ke notes local
 * - Settings → merge ke settings local (cloud menang)
 *
 * Strategy merge: last-write-wins by updated_at.
 *
 * Returns: { ok, stats: { itemsAdded, itemsUpdated, notesAdded, notesUpdated, settingsUpdated } }
 */
export async function pullFromSupabase() {
  if (!(await isLoggedIn())) {
    return { ok: false, error: 'not_logged_in' };
  }
  const userId = await getUserId();
  if (!userId) return { ok: false, error: 'no_user_id' };

  const startTime = Date.now();
  const stats = { itemsAdded: 0, itemsUpdated: 0, notesAdded: 0, notesUpdated: 0, settingsUpdated: 0, errors: [] };

  try {
    // === 1. Pull vault items ===
    const itemsRes = await selectRows(VAULT_TABLE, {
      select: '*',
      filter: `user_id=eq.${userId}`,
      order: 'updated_at.desc'
    });
    if (itemsRes.ok && itemsRes.data) {
      const vault = await getVault();
      const localItems = vault.items || [];
      const localBundles = vault.bundles || [];

      for (const row of itemsRes.data) {
        try {
          if (row.type === 'bundle') {
            // Bundle
            const bundle = _parseBundleRow(row);
            const idx = localBundles.findIndex(b => b.id === bundle.id);
            if (idx < 0) {
              localBundles.push(bundle);
              stats.itemsAdded++;
            } else if (new Date(row.updated_at) > new Date(localBundles[idx].updatedAt || 0)) {
              localBundles[idx] = bundle;
              stats.itemsUpdated++;
            }
          } else {
            // Item
            const item = _parseVaultItemRow(row);
            const idx = localItems.findIndex(i => i.id === item.id);
            if (idx < 0) {
              localItems.push(item);
              stats.itemsAdded++;
            } else if (new Date(row.updated_at) > new Date(localItems[idx].updatedAt || 0)) {
              localItems[idx] = item;
              stats.itemsUpdated++;
            }
          }
        } catch (e) {
          stats.errors.push({ id: row.id, error: e.message });
        }
      }

      vault.items = localItems;
      vault.bundles = localBundles;
      await saveVault(vault);
    }

    // === 2. Pull notes ===
    const notesRes = await selectRows(NOTES_TABLE, {
      select: '*',
      filter: `user_id=eq.${userId}`,
      order: 'updated_at.desc'
    });
    if (notesRes.ok && notesRes.data) {
      const localNotes = await getNotes();
      for (const row of notesRes.data) {
        try {
          const note = _parseNoteRow(row);
          const idx = localNotes.findIndex(n => n.id === note.id);
          if (idx < 0) {
            localNotes.push(note);
            stats.notesAdded++;
          } else if (new Date(row.updated_at) > new Date(localNotes[idx].updatedAt || 0)) {
            localNotes[idx] = note;
            stats.notesUpdated++;
          }
        } catch (e) {
          stats.errors.push({ id: row.id, error: e.message });
        }
      }
      await saveNotes(localNotes);
    }

    // === 3. Pull settings ===
    const settingsRes = await selectRows(SETTINGS_TABLE, {
      select: '*',
      filter: `user_id=eq.${userId}`
    });
    if (settingsRes.ok && settingsRes.data) {
      const vault = await getVault();
      const localSettings = vault.settings || {};
      let changed = false;
      for (const row of settingsRes.data) {
        if (!row.setting_key) continue;
        const cloudValue = row.setting_value;
        const cloudUpdatedAt = new Date(row.updated_at).getTime();
        // Local tidak track updated_at per setting, jadi cloud always wins
        if (JSON.stringify(localSettings[row.setting_key]) !== JSON.stringify(cloudValue)) {
          localSettings[row.setting_key] = cloudValue;
          stats.settingsUpdated++;
          changed = true;
        }
      }
      if (changed) {
        vault.settings = localSettings;
        await saveVault(vault);
      }
    }

    // === 4. Log sync ===
    await _logSync('pull', 'download', stats, Date.now() - startTime);
    await _setLastSync('pull', stats);

    return { ok: true, stats };
  } catch (e) {
    return { ok: false, error: e.message, stats };
  }
}

// ============== FULL SYNC (push + pull) ==============

/**
 * Sync penuh — push state lokal lalu pull state cloud.
 * Berguna untuk conflict resolution: push dulu, lalu ambil yang terbaru.
 */
export async function fullSync() {
  if (!(await isLoggedIn())) {
    return { ok: false, error: 'not_logged_in' };
  }
  const startTime = Date.now();
  const pushRes = await pushToSupabase();
  const pullRes = await pullFromSupabase();
  const duration = Date.now() - startTime;

  await _logSync('sync_full', 'both', {
    pushed: pushRes.stats,
    pulled: pullRes.stats
  }, duration);

  return {
    ok: pushRes.ok && pullRes.ok,
    push: pushRes,
    pull: pullRes,
    duration
  };
}

// ============== SCREENSHOT STORAGE ==============

/**
 * Upload screenshot blob ke Supabase Storage.
 * Path: 'user-<uuid>/<screenshot-id>.<ext>'
 */
async function _uploadScreenshotBlob(item, userId) {
  try {
    const { getScreenshotBlob } = await import('./storage.js');
    const dataUrl = await getScreenshotBlob(item.id);
    if (!dataUrl) return { ok: false, error: 'no_blob' };

    // Convert dataUrl → Blob
    const resp = await fetch(dataUrl);
    const blob = await resp.blob();
    const ext = item.screenshotFormat === 'jpeg' ? 'jpg' : 'png';
    const contentType = item.screenshotFormat === 'jpeg' ? 'image/jpeg' : 'image/png';
    const path = `user-${userId}/${item.id}.${ext}`;

    const upRes = await uploadFile(STORAGE_BUCKET, path, blob, contentType);
    if (!upRes.ok) return upRes;

    // Update screenshots table dengan storage path + URL
    const screenshotRow = {
      id: item.id,
      user_id: userId,
      vault_item_id: item.id,
      storage_path: path,
      storage_url: upRes.url,
      file_size: item.screenshotBytes || blob.size,
      width: item.screenshotWidth || 0,
      height: item.screenshotHeight || 0,
      format: item.screenshotFormat || 'png',
      captured_at: item.source?.capturedAt || item.createdAt,
      source_url: item.source?.url,
      source_title: item.source?.title,
      created_at: item.createdAt || new Date().toISOString()
    };
    await upsertRow(SCREENSHOTS_TABLE, screenshotRow);

    // Update vault_items row dengan gdrive_file_url = storage_url (supaya link muncul di UI)
    await upsertRow(VAULT_TABLE, {
      id: item.id,
      user_id: userId,
      gdrive_file_id: path,
      gdrive_file_url: upRes.url,
      updated_at: new Date().toISOString()
    });

    return { ok: true, url: upRes.url, path };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ============== ROW BUILDERS (local object → DB row) ==============

function _buildVaultItemRow(item, userId) {
  return {
    id: item.id,
    user_id: userId,
    type: item.type,
    title: item.title || null,
    body: item.body || null,
    tags: Array.isArray(item.tags) ? item.tags : [],
    category: item.category || null,
    source: item.source || null,
    link_url: item.linkUrl || null,
    link_title: item.linkTitle || null,
    screenshot_mode: item.screenshotMode || null,
    screenshot_width: item.screenshotWidth || 0,
    screenshot_height: item.screenshotHeight || 0,
    screenshot_format: item.screenshotFormat || null,
    screenshot_bytes: item.screenshotBytes || 0,
    thumbnail_data_url: item.thumbnailDataUrl || null,
    gdrive_file_id: item.gdriveFileId || null,
    gdrive_file_url: item.gdriveFileUrl || null,
    snapshot_domain: item.snapshotDomain || null,
    snapshot_message_count: item.snapshotMessageCount || 0,
    toppings: Array.isArray(item.toppings) ? item.toppings : [],
    variables: Array.isArray(item.variables) ? item.variables : [],
    favorite: !!item.favorite,
    archived: !!item.archived,
    use_count: item.useCount || 0,
    last_used_at: item.lastUsedAt || null,
    created_at: item.createdAt || new Date().toISOString(),
    updated_at: item.updatedAt || new Date().toISOString()
  };
}

function _buildBundleRow(bundle, userId) {
  return {
    id: bundle.id,
    user_id: userId,
    type: 'bundle',
    title: bundle.name || 'Bundle',
    body: bundle.note || null,
    item_ids: Array.isArray(bundle.itemIds) ? bundle.itemIds : [],
    inject_order: Array.isArray(bundle.injectOrder) ? bundle.injectOrder : [],
    note_ids: Array.isArray(bundle.noteIds) ? bundle.noteIds : [],
    color: bundle.color || null,
    inline_prompt: bundle.inlinePrompt || null,
    inline_prompt_item_id: bundle.inlinePromptItemId || null,
    favorite: false,
    archived: !!bundle.archived,
    created_at: bundle.createdAt || new Date().toISOString(),
    updated_at: bundle.updatedAt || new Date().toISOString()
  };
}

function _buildNoteRow(note, userId) {
  return {
    id: note.id,
    user_id: userId,
    title: note.title || null,
    body: note.body || null,
    color: note.color || 'default',
    "group": note.group || null,
    pinned: !!note.pinned,
    archived: !!note.archived,
    created_at: note.createdAt || new Date().toISOString(),
    updated_at: note.updatedAt || new Date().toISOString()
  };
}

function _buildSettingRow(key, value, userId) {
  let settingType = 'STRING';
  if (typeof value === 'boolean') settingType = 'BOOLEAN';
  else if (typeof value === 'number') settingType = 'NUMBER';
  else if (value && typeof value === 'object') settingType = 'JSON';

  return {
    user_id: userId,
    setting_key: key,
    setting_value: value,
    setting_type: settingType,
    category: _categorizeSetting(key),
    updated_at: new Date().toISOString()
  };
}

// ============== ROW PARSERS (DB row → local object) ==============

function _parseVaultItemRow(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title || '',
    body: row.body || '',
    tags: Array.isArray(row.tags) ? row.tags : [],
    category: row.category || '',
    source: row.source || null,
    linkUrl: row.link_url || '',
    linkTitle: row.link_title || '',
    screenshotMode: row.screenshot_mode || 'visible',
    screenshotWidth: row.screenshot_width || 0,
    screenshotHeight: row.screenshot_height || 0,
    screenshotFormat: row.screenshot_format || 'png',
    screenshotBytes: row.screenshot_bytes || 0,
    thumbnailDataUrl: row.thumbnail_data_url || '',
    gdriveFileId: row.gdrive_file_id || null,
    gdriveFileUrl: row.gdrive_file_url || null,
    snapshotDomain: row.snapshot_domain || '',
    snapshotMessageCount: row.snapshot_message_count || 0,
    toppings: Array.isArray(row.toppings) ? row.toppings : [],
    variables: Array.isArray(row.variables) ? row.variables : [],
    favorite: !!row.favorite,
    archived: !!row.archived,
    useCount: row.use_count || 0,
    lastUsedAt: row.last_used_at || null,
    createdAt: row.created_at || new Date().toISOString(),
    updatedAt: row.updated_at || new Date().toISOString()
  };
}

function _parseBundleRow(row) {
  return {
    id: row.id,
    name: row.title || 'Bundle',
    note: row.body || '',
    itemIds: Array.isArray(row.item_ids) ? row.item_ids : [],
    injectOrder: Array.isArray(row.inject_order) ? row.inject_order : [],
    noteIds: Array.isArray(row.note_ids) ? row.note_ids : [],
    color: row.color || '',
    inlinePrompt: row.inline_prompt || '',
    inlinePromptItemId: row.inline_prompt_item_id || null,
    archived: !!row.archived,
    createdAt: row.created_at || new Date().toISOString(),
    updatedAt: row.updated_at || new Date().toISOString()
  };
}

function _parseNoteRow(row) {
  return {
    id: row.id,
    title: row.title || '',
    body: row.body || '',
    color: row.color || 'default',
    group: row.group || '',
    pinned: !!row.pinned,
    archived: !!row.archived,
    createdAt: row.created_at || new Date().toISOString(),
    updatedAt: row.updated_at || new Date().toISOString()
  };
}

// ============== HELPERS ==============

const SENSITIVE_SETTINGS = new Set([
  'assistantApiKey', 'assistantFallbackApiKey', 'gdriveAuthToken', 'gdriveTokenLocked',
  'gdriveWebAppUrl', 'supabaseAccessToken', 'supabaseRefreshToken'
]);

function _isSensitiveSetting(key) {
  return SENSITIVE_SETTINGS.has(key);
}

function _categorizeSetting(key) {
  if (key.startsWith('gdrive')) return 'gdrive';
  if (key.startsWith('supabase')) return 'supabase';
  if (key.startsWith('assistant')) return 'assistant';
  if (key.startsWith('prayer')) return 'prayer';
  if (key.startsWith('screenshot')) return 'screenshot';
  if (key.startsWith('clearCache')) return 'clearcache';
  if (key.startsWith('contentGuard')) return 'content_guard';
  if (key.startsWith('quran') || key.startsWith('exercise')) return 'habits';
  if (['theme', 'displayMode', 'injectMode', 'floatingButtonEnabled', 'overlayButtonEnabled',
       'sidebarAutoOpen', 'rememberLastTab', 'lastActiveTab', 'lastSidebarWidth',
       'locale', 'syncEnabled', 'syncAutoEnabled'].includes(key)) return 'ui';
  return 'other';
}

async function _logSync(action, direction, stats, durationMs) {
  try {
    const userId = await getUserId();
    if (!userId) return;
    await insertRow(SYNC_LOG_TABLE, {
      user_id: userId,
      action,
      direction,
      items_count: stats.items || stats.itemsAdded || 0,
      notes_count: stats.notes || stats.notesAdded || 0,
      screenshots_count: stats.screenshots || 0,
      duration_ms: durationMs,
      status: stats.errors && stats.errors.length > 0 ? 'error' : 'ok',
      error_message: stats.errors && stats.errors.length > 0
        ? JSON.stringify(stats.errors.slice(0, 5))
        : null,
      created_at: new Date().toISOString()
    });
  } catch (e) {
    // Silent fail — log tidak boleh block sync
  }
}

// ============== DELETE (untuk hapus dari cloud saat item dihapus lokal) ==============

/**
 * Hapus item dari Supabase cloud (vault_items + screenshot storage).
 */
export async function deleteItemFromCloud(itemId) {
  if (!(await isLoggedIn())) return { ok: false, error: 'not_logged_in' };
  const userId = await getUserId();
  if (!userId) return { ok: false, error: 'no_user_id' };

  try {
    // Cek apakah item adalah screenshot — hapus storage juga
    const screenshotsRes = await selectRows(SCREENSHOTS_TABLE, {
      filter: `id=eq.${itemId}`,
      limit: 1
    });
    if (screenshotsRes.ok && screenshotsRes.data?.length > 0) {
      const screenshot = screenshotsRes.data[0];
      if (screenshot.storage_path) {
        await deleteFile(STORAGE_BUCKET, screenshot.storage_path);
      }
      await deleteRow(SCREENSHOTS_TABLE, `id=eq.${itemId}`);
    }
    // Hapus dari vault_items
    const res = await deleteRow(VAULT_TABLE, `id=eq.${itemId}`);
    return res;
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Hapus note dari Supabase cloud.
 */
export async function deleteNoteFromCloud(noteId) {
  if (!(await isLoggedIn())) return { ok: false, error: 'not_logged_in' };
  return await deleteRow(NOTES_TABLE, `id=eq.${noteId}`);
}

// ============== AUTO-SYNC (debounced) ==============

let _autoSyncTimer = null;
const AUTO_SYNC_DELAY = 5000; // 5 detik

/**
 * Trigger push ke Supabase (debounced 5 detik).
 * Dipanggil otomatis saat vault berubah.
 */
export function triggerAutoSync() {
  if (_autoSyncTimer) clearTimeout(_autoSyncTimer);
  _autoSyncTimer = setTimeout(async () => {
    _autoSyncTimer = null;
    try {
      const loggedIn = await isLoggedIn();
      if (!loggedIn) return;
      console.log('[RecallFox/Supabase] Auto-sync triggered');
      const res = await pushToSupabase();
      if (res.ok) {
        console.log('[RecallFox/Supabase] Auto-sync OK:', res.stats);
      } else {
        console.warn('[RecallFox/Supabase] Auto-sync failed:', res.error);
      }
    } catch (e) {
      console.warn('[RecallFox/Supabase] Auto-sync error:', e.message);
    }
  }, AUTO_SYNC_DELAY);
}
