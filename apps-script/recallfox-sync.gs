/**
 * RecallFox — Google Apps Script Web App (server-side sync target)
 * ============================================================
 * Log Troubleshooting Sesi 1 (18 Juli 2026) — Issue 1 + 2 + 6
 *
 * Cara pakai:
 *   1. Buka https://script.google.com  →  New project
 *   2. Hapus kode default, copy-paste seluruh file ini.
 *   3. Ganti TOKEN di bawah dengan string random (mis. 32 karakter hex).
 *      Token ini HARUS sama dengan yang diisi di RecallFox Settings →
 *      Apps Script Sync → Token.
 *   4. Deploy  →  New deployment  →  Type: Web app
 *        - Execute as: Me
 *        - Who has access: Anyone
 *      (Apps Script Web App butuh "Anyone" supaya bisa di-fetch dari
 *      Firefox tanpa login Google. Token bearer melindungi dari akses
 *      liar — semua request tanpa token valid akan ditolak.)
 *   5. Copy URL deployment (https://script.google.com/macros/s/.../exec).
 *      Paste ke RecallFox Settings → Apps Script Sync → URL.
 *   6. Klik "Test koneksi" di RecallFox. Kalau ok, klik "Kirim Sekarang".
 *
 * Hasil:
 *   - Spreadsheet otomatis dibuat bernama "RecallFox Backup" di Google Drive.
 *   - Sheet "Vault"      → semua item vault (prompt, context, link, screenshot, snapshot)
 *   - Sheet "Notes"      → semua catatan
 *   - Sheet "Bundles"    → semua bundle + anggota (JSON)
 *   - Sheet "Meta"       → metadata sinkronisasi (last sync, version, rows, errors)
 *   - Sheet "Habits"     → log ngaji + olahraga
 *
 * Verifikasi response:
 *   RecallFox MENGAFAK response — kalau Apps Script tidak return {ok:true,...},
 *   RecallFox anggap gagal dan tampilkan error. Ini memperbaiki Issue 2 di mana
 *   "kirim berhasil" tapi spreadsheet kosong — sekarang user selalu tahu kalau
 *   spreadsheet benar-benar terisi atau tidak.
 */

// ====== KONFIGURASI ======
// Ganti TOKEN ini dengan string random Anda. Jangan pakai default!
const TOKEN = 'GANTI_INI_DENGAN_TOKEN_RANDOM_32_KARAKTER_HEX';
const SPREADSHEET_NAME = 'RecallFox Backup';

// ====== ENTRY POINTS ======

/**
 * GET — dipanggil saat RecallFox "Test koneksi".
 * Query: ?action=ping
 * Return: {ok:true, version, spreadsheetUrl, totalRows}
 */
function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || '';
    if (action === 'ping') {
      if (!verifyToken(e)) return jsonOut({ ok: false, error: 'invalid_token' });
      const ss = getOrCreateSpreadsheet();
      const totalRows = countTotalRows(ss);
      return jsonOut({
        ok: true,
        version: '1.0.0',
        spreadsheetUrl: ss.getUrl(),
        totalRows: totalRows,
        receivedAt: new Date().toISOString()
      });
    }
    return jsonOut({ ok: false, error: 'unknown_action', action: action });
  } catch (err) {
    return jsonOut({ ok: false, error: 'doGet_exception: ' + err.message });
  }
}

/**
 * POST — dipanggil saat RecallFox "Kirim Sekarang" atau auto-sync.
 * Body JSON: {action:'sync', token, payload}
 * Return: {ok:true, rowsAppended, totalRows, receivedAt}
 */
function doPost(e) {
  try {
    if (!verifyToken(e)) return jsonOut({ ok: false, error: 'invalid_token' });

    let body;
    try {
      body = JSON.parse(e.postData.contents);
    } catch (err) {
      return jsonOut({ ok: false, error: 'invalid_json_body: ' + err.message });
    }
    if (!body) {
      return jsonOut({ ok: false, error: 'empty_body' });
    }

    // v3.11.0 (Issue 2): Handle upload_screenshot action — upload gambar ke Drive.
    if (body.action === 'upload_screenshot') {
      return handleScreenshotUpload(body.payload || {});
    }

    if (body.action !== 'sync') {
      return jsonOut({ ok: false, error: 'unknown_action', action: body.action });
    }

    const payload = body.payload || {};
    const ss = getOrCreateSpreadsheet();

    // Mode "replace-all": bersihkan sheet dulu, lalu tulis ulang.
    // Lebih sederhana & lebih reliable daripada append (tidak ada duplikat).
    let rowsAppended = 0;

    // Sheet: Vault
    if (payload.vault && Array.isArray(payload.vault.items)) {
      rowsAppended += writeVaultSheet(ss, payload.vault.items);
    }
    // Sheet: Bundles
    if (payload.vault && Array.isArray(payload.vault.bundles)) {
      writeBundlesSheet(ss, payload.vault.bundles);
    }
    // Sheet: Notes
    if (Array.isArray(payload.notes)) {
      writeNotesSheet(ss, payload.notes);
    }
    // Sheet: Habits
    if (payload.habits) {
      writeHabitsSheet(ss, payload.habits);
    }
    // Sheet: Screenshot metadata
    if (Array.isArray(payload.screenshotMeta)) {
      writeScreenshotMetaSheet(ss, payload.screenshotMeta);
    }
    // Sheet: Meta
    writeMetaSheet(ss, payload, rowsAppended);

    const totalRows = countTotalRows(ss);
    return jsonOut({
      ok: true,
      rowsAppended: rowsAppended,
      totalRows: totalRows,
      receivedAt: new Date().toISOString()
    });
  } catch (err) {
    return jsonOut({ ok: false, error: 'doPost_exception: ' + err.message + ' (line: ' + err.lineNumber + ')' });
  }
}

// ============================================================
// v3.11.0 (Issue 2): Screenshot upload ke Google Drive
// ============================================================
// Handler untuk action=upload_screenshot.
// Payload: {id, title, format, mimeType, base64Data, capturedAt, sourceUrl, sourceTitle}
// Return: {ok:true, driveFileUrl, driveFileId, driveFileName}
//
// Prasyarat: saat deploy Web App, scope HARUS ditambah:
//   - https://www.googleapis.com/auth/drive.file (preferred — hanya akses file yang dibuat oleh script ini)
//   atau https://www.googleapis.com/auth/drive (penuh — tidak disarankan)
//
// Cara add scope: di Apps Script editor → Project Settings → check "Show appsscript.json"
// → buka appsscript.json → tambah scope ke oauthScopes array → Save → Re-deploy Web App.

function handleScreenshotUpload(payload) {
  try {
    if (!payload || !payload.base64Data) {
      return jsonOut({ ok: false, error: 'missing_base64_data' });
    }
    if (!payload.id) {
      return jsonOut({ ok: false, error: 'missing_screenshot_id' });
    }

    // Sanitize filename — Drive tidak accept / \ : * ? " < > |
    const safeTitle = String(payload.title || 'screenshot')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 80);
    const ext = payload.format === 'jpeg' ? 'jpg' : 'png';
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
    const fileName = 'recallfox_' + safeTitle + '_' + payload.id.slice(-8) + '_' + timestamp + '.' + ext;
    const mimeType = payload.mimeType || (payload.format === 'jpeg' ? 'image/jpeg' : 'image/png');

    // Decode base64 → bytes → Blob
    const bytes = Utilities.base64Decode(payload.base64Data);
    const blob = Utilities.newBlob(bytes, mimeType, fileName);

    // Buat/get folder "RecallFox Screenshots" di root Drive
    const folder = getOrCreateScreenshotsFolder();
    // Hapus file lama dengan nama sama (kalau re-upload)
    const existing = folder.getFilesByName(fileName);
    while (existing.hasNext()) {
      folder.removeFile(existing.next());
    }
    // Create file
    const file = folder.createFile(blob);
    file.setDescription('RecallFox screenshot · ID: ' + payload.id +
      (payload.sourceUrl ? ' · Source: ' + payload.sourceUrl : '') +
      ' · Captured: ' + (payload.capturedAt || new Date().toISOString()));

    // Set sharing: anyone with link can view (supaya URL bisa dibuka tanpa login ulang)
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (shareErr) {
      // Kalau gagal set sharing, file tetap tersimpan — user bisa set manual di Drive
      console.warn('setSharing failed (screenshot):', shareErr.message);
    }

    console.log('Screenshot uploaded to Drive:', fileName, file.getSize(), 'bytes');

    return jsonOut({
      ok: true,
      driveFileUrl: file.getUrl(),
      driveFileId: file.getId(),
      driveFileName: fileName,
      driveFileSize: file.getSize()
    });
  } catch (err) {
    return jsonOut({ ok: false, error: 'upload_exception: ' + err.message + ' (line: ' + err.lineNumber + ')' });
  }
}

// Buat atau get folder "RecallFox Screenshots" di root Drive
function getOrCreateScreenshotsFolder() {
  const folderName = 'RecallFox Screenshots';
  const it = DriveApp.getFoldersByName(folderName);
  if (it.hasNext()) return it.next();
  return DriveApp.createFolder(folderName);
}

// ====== HELPER: Token verification ======

function verifyToken(e) {
  // v3.11.0 (Issue 1): Handle Authorization header case-insensitive.
  // Apps Script e.headers mungkin berisi "Authorization" atau "authorization" tergantung browser/fetch.
  // Fallback ke body.token untuk request yang tidak lewat header.
  let authHeader = '';
  if (e && e.headers) {
    authHeader = e.headers.Authorization || e.headers.authorization || '';
  }
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  if (bearerMatch && bearerMatch[1] === TOKEN) return true;

  // Fallback: cek body JSON.token (untuk request yang tidak lewat header)
  if (e && e.postData && e.postData.contents) {
    try {
      const body = JSON.parse(e.postData.contents);
      if (body.token && body.token === TOKEN) return true;
    } catch (err) {}
  }
  return false;
}

// ====== HELPER: Spreadsheet management ======

function getOrCreateSpreadsheet() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('SPREADSHEET_ID');
  if (id) {
    try {
      return SpreadsheetApp.openById(id);
    } catch (err) {
      // Mungkin sudah dihapus — buat ulang
      props.deleteProperty('SPREADSHEET_ID');
    }
  }
  const ss = SpreadsheetApp.create(SPREADSHEET_NAME);
  props.setProperty('SPREADSHEET_ID', ss.getId());
  return ss;
}

function getOrCreateSheet(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  // Reset isi (replace-all mode)
  sheet.clear();
  if (headers && headers.length) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function countTotalRows(ss) {
  let total = 0;
  ['Vault', 'Notes', 'Bundles', 'Habits', 'ScreenshotMeta'].forEach(function (name) {
    const sheet = ss.getSheetByName(name);
    if (sheet) total += Math.max(0, sheet.getLastRow() - 1); // exclude header
  });
  return total;
}

// ====== SHEET WRITERS ======

function writeVaultSheet(ss, items) {
  const headers = ['id', 'type', 'title', 'body', 'tags', 'favorite', 'archived', 'useCount', 'sourceUrl', 'sourceTitle', 'createdAt', 'updatedAt', 'contextPurpose', 'linkUrl'];
  const sheet = getOrCreateSheet(ss, 'Vault', headers);
  if (!items.length) return 0;
  const rows = items.map(function (it) {
    return [
      it.id || '',
      it.type || '',
      (it.title || '').slice(0, 200),
      (it.body || '').slice(0, 50000), // Spreadsheet cell limit ~50K
      Array.isArray(it.tags) ? it.tags.join(', ') : (it.tags || ''),
      it.favorite ? 'true' : 'false',
      it.archived ? 'true' : 'false',
      it.useCount || 0,
      (it.source && it.source.url) || '',
      (it.source && it.source.title) || '',
      it.createdAt || '',
      it.updatedAt || '',
      it.contextPurpose || '',
      it.linkUrl || ''
    ];
  });
  sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  sheet.autoResizeColumns(1, 3); // id, type, title
  return rows.length;
}

function writeBundlesSheet(ss, bundles) {
  const headers = ['id', 'name', 'itemCount', 'itemIds', 'archived', 'createdAt', 'updatedAt'];
  const sheet = getOrCreateSheet(ss, 'Bundles', headers);
  if (!bundles.length) return;
  const rows = bundles.map(function (b) {
    return [
      b.id || '',
      b.name || '',
      (b.itemIds || []).length,
      (b.itemIds || []).join(', '),
      b.archived ? 'true' : 'false',
      b.createdAt || '',
      b.updatedAt || ''
    ];
  });
  sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
}

function writeNotesSheet(ss, notes) {
  const headers = ['id', 'title', 'body', 'color', 'group', 'pinned', 'archived', 'createdAt', 'updatedAt'];
  const sheet = getOrCreateSheet(ss, 'Notes', headers);
  if (!notes.length) return;
  const rows = notes.map(function (n) {
    return [
      n.id || '',
      (n.title || '').slice(0, 200),
      (n.body || '').slice(0, 50000),
      n.color || '',
      n.group || '',
      n.pinned ? 'true' : 'false',
      n.archived ? 'true' : 'false',
      n.createdAt || '',
      n.updatedAt || ''
    ];
  });
  sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
}

function writeHabitsSheet(ss, habits) {
  const headers = ['kind', 'date', 'value'];
  const sheet = getOrCreateSheet(ss, 'Habits', headers);
  const rows = [];
  if (habits.quranLog) {
    Object.keys(habits.quranLog).forEach(function (date) {
      rows.push(['quran', date, habits.quranLog[date]]);
    });
  }
  if (habits.exerciseLog) {
    Object.keys(habits.exerciseLog).forEach(function (date) {
      rows.push(['exercise', date, JSON.stringify(habits.exerciseLog[date])]);
    });
  }
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
}

function writeScreenshotMetaSheet(ss, metas) {
  // v3.11.0 (Issue 2): Tambah kolom driveFileUrl + driveFileId supaya user bisa lihat link
  // file Drive untuk setiap screenshot langsung di spreadsheet (sebelumnya hanya metadata).
  const headers = ['id', 'title', 'mode', 'width', 'height', 'format', 'bytes', 'sourceUrl', 'capturedAt', 'createdAt', 'updatedAt', 'driveFileUrl', 'driveFileId'];
  const sheet = getOrCreateSheet(ss, 'ScreenshotMeta', headers);
  if (!metas.length) return;
  // v3.11.0 (Issue 1): Guard empty rows sebelum setValues (Apps Script throw kalau getRange 0 rows)
  const rows = metas.map(function (m) {
    return [
      m.id || '', m.title || '', m.mode || '', m.width || 0, m.height || 0,
      m.format || '', m.bytes || 0, m.sourceUrl || '', m.capturedAt || '',
      m.createdAt || '', m.updatedAt || '',
      m.driveFileUrl || '', m.driveFileId || ''
    ];
  });
  sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  // Hyperlink kolom driveFileUrl (kolom 12) supaya user bisa klik langsung
  for (let i = 0; i < rows.length; i++) {
    const url = rows[i][11];
    if (url) {
      const cell = sheet.getRange(i + 2, 12);
      cell.setFormula('=HYPERLINK("' + url.replace(/"/g, '\\"') + '","Buka di Drive")');
      cell.setFontColor('#1e40af').setUnderline(true);
    }
  }
}

function writeMetaSheet(ss, payload, rowsAppended) {
  const headers = ['key', 'value'];
  const sheet = getOrCreateSheet(ss, 'Meta', headers);
  const rows = [
    ['lastSyncAt', new Date().toISOString()],
    ['addonVersion', payload.addonVersion || ''],
    ['payloadVersion', payload.version || ''],
    ['exportedAt', payload.exportedAt || ''],
    ['vaultItemsCount', (payload.meta && payload.meta.vaultItemsCount) || 0],
    ['notesCount', (payload.meta && payload.meta.notesCount) || 0],
    ['bundlesCount', (payload.meta && payload.meta.bundlesCount) || 0],
    ['screenshotBlobsCount', (payload.meta && payload.meta.screenshotBlobsCount) || 0],
    ['hasHabits', (payload.meta && payload.meta.hasHabits) ? 'true' : 'false'],
    ['rowsAppended', rowsAppended]
  ];
  sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
}

// ====== HELPER: JSON output ======

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
