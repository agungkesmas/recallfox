# Changelog v3.11.0 — Log Troubleshooting Sesi Lanjutan (18 Juli 2026)

4 issue baru dari Log_Troubleshooting_RECALFOX.docx (update sesi lanjutan) — semua selesai.

> **Catatan versi**: v3.11.0 dibangun di atas v3.10.1 (versi sebelumnya yang sudah mencakup
> semua fix v3.8.0: Apps Script Sync, GET_PAGE_CONTEXT, manual screenshot upload, bundle
> dengan catatan, unified backup payload, single-CTA functional sheet). v3.11.0 menambahkan
> 4 fix baru berdasarkan feedback user pasca-v3.10.1.

---

## Issue 1 — Tombol "Kirim Sekarang" gagal padahal "Test Koneksi" berhasil

### Laporan User
"tombol full backup ke google drive tidak bekerja. padahal test koneksi berhasil."

### Root Cause (Hasil Audit)
- **POST** sync (`pushToAppsScript`) menggunakan header `Content-Type: application/json` → memicu **CORS preflight** (OPTIONS request).
- Apps Script Web App endpoint TIDAK merespons OPTIONS dengan CORS header valid → fetch POST diblokir browser.
- **GET** test koneksi (`testAppsScriptConnection`) TIDAK kena preflight karena tidak ada Content-Type header (simple request) → itu sebabnya ping sukses.
- Tambahan: payload mengandung `vault.settings` (yang berisi `appsScriptToken`!) + `thumbnailDataUrl` per screenshot (~10-50KB/item) → payload bisa 5-10MB untuk 100+ screenshot.
- Apps Script sheet writers tidak guard empty rows sebelum `setValues()` → throw kalau 0 rows.
- Authorization header case-sensitive (`e.headers.Authorization`) — bisa miss kalau browser kirim `authorization` (lowercase).

### Solusi v3.11.0
1. **Ganti `Content-Type: application/json` → `text/plain;charset=utf-8`** di `lib/appsscript-sync.js:147`. Simple request, tidak trigger CORS preflight. Apps Script tetap terima body JSON di `e.postData.contents` dan `JSON.parse()`-nya.
2. **Tambah query param `?action=sync&alt=json`** ke URL POST → Apps Script return JSON (bukan HTML redirect).
3. **Strip `vault.settings` dari payload** — sebelumnya payload mengandung `appsScriptToken` (bearer token!). Sekarang hanya kirim `version + items + bundles + toppings`.
4. **Strip `thumbnailDataUrl` dari setiap screenshot item** — Apps Script hanya perlu metadata untuk sheet, bukan base64 PNG 200px.
5. **Timeout 30s → 60s** — payload besar butuh waktu lebih.
6. **Header Authorization handle case-insensitive** di Apps Script: `e.headers.Authorization || e.headers.authorization`.
7. **Guard empty rows** di Apps Script sheet writers sebelum `getRange(...).setValues(...)`.
8. **Log payload size** di console: `console.log('[RecallFox] Apps Script sync payload size:', (body.length / 1024).toFixed(1), 'KB')`.
9. **Error message lebih informatif**: include raw response text (300 char) + line number di Apps Script exception.
10. **`?action=ping&alt=json`** untuk test koneksi juga (konsistensi).

### Testing
1. Set URL + token Apps Script di Settings
2. Klik "Test Koneksi" → harus sukses (seperti sebelumnya)
3. Klik "Kirim Sekarang" → sekarang harus sukses juga (sebelumnya gagal)
4. Cek Browser Console → log "Apps Script sync payload size: X KB"
5. Cek spreadsheet → semua sheet (Vault, Notes, Bundles, Habits, ScreenshotMeta, Meta) terisi

---

## Issue 2 — Screenshot tidak tersave di Drive (tidak ada link file di spreadsheet)

### Laporan User
"screnshoot yang diambil menggunakan fitur 'shot' tidak tersave di drive jika dilihat dari spreadsheet database karena tidak terbentuk link filenya disitu. cek bener bener karena saya pengennya setiap screnshoot tu bisa disave di drive biar ga ilang, bisa engga sih?"

### Root Cause
- Tidak ada implementasi upload file kemana pun di v3.10.1 (grep `driveFileUrl|driveFileId|DriveApp|createFile` → 0 hasil).
- `lib/appsscript-sync.js` EKSPLISIT hanya kirim metadata screenshot (komentar: "bukan base64 blob — terlalu besar utk spreadsheet").
- `apps-script/recallfox-sync.gs writeScreenshotMetaSheet` hanya tulis 11 kolom metadata, tidak upload gambar.
- User benar: spreadsheet database TIDAK punya link file Drive untuk screenshot.

### Solusi v3.11.0 — NEW FEATURE: Auto-upload screenshot ke Drive

#### Server-side (apps-script/recallfox-sync.gs)
1. **Handler baru `handleScreenshotUpload(payload)`** — dipanggil saat `body.action === 'upload_screenshot'`.
2. **Decode base64 → Blob**: `Utilities.base64Decode()` + `Utilities.newBlob(bytes, mimeType, fileName)`.
3. **Folder "RecallFox Screenshots"** auto-create di root Drive via `getOrCreateScreenshotsFolder()`.
4. **Hapus file lama dengan nama sama** (re-upload support) via `folder.getFilesByName(fileName)` + `folder.removeFile()`.
5. **Set sharing ANYONE_WITH_LINK** supaya URL bisa dibuka tanpa login ulang: `file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW)`.
6. **Return**: `{ok:true, driveFileUrl, driveFileId, driveFileName, driveFileSize}`.
7. **Sheet `ScreenshotMeta` tambah kolom `driveFileUrl` + `driveFileId`** + formula `=HYPERLINK(url, "Buka di Drive")` supaya user bisa klik langsung.

**Prasyarat**: Apps Script HARUS di-deploy ulang dengan scope `https://www.googleapis.com/auth/drive.file`. Cara: Apps Script editor → Project Settings → check "Show appsscript.json" → buka appsscript.json → tambah scope ke `oauthScopes` array → Save → Re-deploy Web App.

#### Client-side (lib/appsscript-sync.js)
1. **Fungsi baru `pushScreenshotToDrive(item)`** — POST base64 image ke Apps Script dengan `action=upload_screenshot`.
2. **Format payload JSON**: `{action, token, payload: {id, title, format, mimeType, base64Data, capturedAt, sourceUrl, sourceTitle}}`.
3. **Strip `data:image/...;base64,` prefix** → ambil base64 only.
4. **Content-Type: `text/plain;charset=utf-8`** (sama dengan sync — avoid CORS preflight).
5. **Timeout 60s** untuk upload gambar besar.
6. **Return**: `{ok, driveFileUrl, driveFileId, driveFileName}`.

#### Client-side integration (background.js)
1. **Helper baru `uploadScreenshotToDriveIfEnabled(item)`** — dipanggil setelah `addItem` screenshot.
2. **Cek prasyarat**: `appsScriptSyncEnabled + appsScriptUploadScreenshots + appsScriptUrl + appsScriptToken`.
3. **Tidak blocking** — jalankan di background supaya capture UX tetap cepat.
4. **Simpan `driveFileUrl + driveFileId + driveUploadedAt`** ke item via `updateItem()`.
5. **Trigger auto-sync Apps Script** supaya sheet `ScreenshotMeta` update dengan link baru.
6. **Notify UI** via `SCREENSHOT_DRIVE_UPLOADED` message.
7. **Hook di 3 lokasi**: `triggerScreenshot` (direct save), `saveCaptureToVault` (modal "Save to Vault"), `SAVE_UPLOAD_TO_VAULT` (manual upload).

#### Client-side integration (popup.js)
1. **Manual trigger handler `UPLOAD_SCREENSHOT_TO_DRIVE`** di background.js — user klik "☁ Upload ke Drive" di functional sheet.
2. **Functional sheet screenshot** sekarang menampilkan:
   - Badge "☁ Drive ✓ Tersimpan" + link "Buka di Google Drive" kalau sudah di-upload
   - Tombol "☁ Upload ke Drive" kalau belum di-upload
   - Tombol "☁ Buka di Drive" (anchor `<a>`) kalau sudah ada `driveFileUrl`
3. **Inject ke AI** sekarang sertakan `driveFileUrl` juga (sebelumnya hanya source URL).

#### Settings UI
1. **Toggle baru `appsScriptUploadScreenshots`** di Settings → Apps Script Sync (default ON).
2. **Warning text**: "⚠ Prasyarat: Apps Script harus di-deploy ulang dengan scope `drive.file`".

#### Storage (lib/storage.js)
1. **Setting baru `appsScriptUploadScreenshots: true`** di `DEFAULT_SETTINGS`.
2. **Item fields baru** (otomatis tersimpan via `updateItem`): `driveFileUrl`, `driveFileId`, `driveUploadedAt`.

### Testing
1. Deploy ulang Apps Script dengan scope `drive.file` (lihat petunjuk di header `apps-script/recallfox-sync.gs`)
2. Set URL + token + enable Apps Script Sync + enable "Auto-upload screenshot ke Drive" di Settings
3. Buka halaman web apapun → klik tile "Shot" → capture screenshot
4. Cek Browser Console → log "Uploading screenshot to Drive: sh_xxx size: Y KB"
5. Cek Google Drive → folder "RecallFox Screenshots" → file baru dengan nama `recallfox_<title>_<id>_<timestamp>.png`
6. Buka file → sharing harusnya "Anyone with link can view"
7. Buka vault → klik screenshot → functional sheet menampilkan badge "☁ Drive ✓ Tersimpan" + tombol "☁ Buka di Drive"
8. Klik "Kirim Sekarang" di Apps Script Sync → cek sheet `ScreenshotMeta` → kolom `driveFileUrl` berisi formula HYPERLINK "Buka di Drive"

---

## Issue 3 — Filter per-type di Create Bundle hilang (tidak selaras dengan Edit Bundle)

### Laporan User
"di menu buat bundle kolom 'filter per type' jadi hilang padahal tadinya ada, cek di 'edit bundle' itu ada. jadi tidak selaras"

### Root Cause (Hasil Audit)
- **Klaim literal user TIDAK terverifikasi di kode v3.8.0+** — kedua fungsi (saveBundleSheet + openBundleEditorSheet) punya filter chips secara paralel sejak v3.8.0.
- **Yang BENAR-BENAR bermasalah**: timing bug di `saveBundleSheet` — `getNotesAsBundleCandidates()` dijalankan DI DALAM `openSheet` callback, menyebabkan sheet terbuka kosong sejenak (flash) sebelum chips + picklist ter-render. User mengira "filter per type hilang".
- **Plus**: inline-add buttons "+ Catatan baru" / "+ Prompt baru" hanya ada di Edit Bundle, tidak di Create Bundle → ketidakselarasan visual yang user rasakan.

### Solusi v3.11.0
1. **Pindahkan `getNotesAsBundleCandidates()` ke LUAR callback `openSheet`** di `saveBundleSheet` — match pattern `openBundleEditorSheet` (yang tidak punya flash kosong). Resolve notes DULU, baru panggil `openSheet(...)` di dalam `.then(...)`.
2. **Tambah inline-add buttons** "+ Catatan baru" (`#bAddNote`) & "+ Prompt baru" (`#bAddPrompt`) ke `saveBundleSheet` — paralel dengan Edit Bundle. Copy logic handler dari `openBundleEditorSheet`.
3. **Tambah `.catch(err => ...)`** untuk handle error kalau `getNotesAsBundleCandidates` gagal.

### Testing
1. Klik tile "Bundle" → sheet "Buat Bundle" terbuka → cek: chips + picklist LANGSUNG ter-render (tidak ada flash kosong)
2. Cek: ada search box, ada 6 filter chips (Prompt/Konteks/Link/Media/Snapshot/Catatan), ada tombol "+ Catatan baru" & "+ Prompt baru"
3. Bandingkan dengan "Edit Bundle" — struktur harus selaras
4. Klik "+ Catatan baru" → isi body + title → cek note baru muncul & ter-centang
5. Klik "+ Prompt baru" → isi body + title → konfirmasi "Save as prompt?" → cek prompt baru muncul & ter-centang

---

## Issue 4 — Search "github" tidak ditemukan + tidak ada X clear button

### Laporan User
"aku coba ketik github di fitur pencarian, tapi tidak ditemukan apapun, padahal ada di link tu pernah simpan link github disitu. harusnya fitur cari ini bisa mencari teks di dalam • Prompt Konteks Link Bundle Snapshot Shot sampai arsip. di ujung kanan kotak harusnya ada tombol silang untuk menghapus semua teks sekaligus"

### Root Cause (Hasil Audit)
- `searchableTextFor()` untuk bundle (popup.js) hanya mengambil **title** anggota (`currentVault.items.find(i => i.id === iid).title`), BUKAN `linkUrl`/`body`/`tags`/`source` anggota.
- Jika user simpan link github sebagai anggota bundle, search "github" TIDAK akan menemukan bundle tersebut.
- Search sudah include archived items (via `getVaultItems()` yang return semua) — issue bukan di archive filtering.
- Tidak ada X clear button di search box (popup.html + sidebar.html) — hanya ada `<kbd>/</kbd><kbd>⌘K</kbd>` hint.

### Solusi v3.11.0
1. **Expand bundle member haystack** di `searchableTextFor()`:
   - Sebelumnya: hanya `memberTitles.join(' ')`
   - Sekarang: untuk setiap member, include `title + body + linkUrl + linkTitle + tags.join(' ') + source.url + source.title`
   - Plus: include notes (id mulai "n_") yang jadi anggota bundle — title + body + group
2. **Tambah field baru ke haystack**: `contextPurpose` (v3.8.0 field yang belum di-search), `driveFileUrl`, `driveFileId` (v3.11.0 field untuk screenshot di Drive).
3. **X clear button** di ujung kanan search box:
   - HTML: `<button id="searchClear" class="search-clear">` di popup.html + sidebar.html
   - CSS: `.search-clear` (22×22px, grid place-items center, hover background)
   - JS: toggle visibility saat search input berubah (display: 'grid' / 'none')
   - JS: click handler → `clearSearch()` + fokus balik ke search box
   - JS: `clearSearch()` juga sembunyikan X button
4. **Badge "📦 arsip"** di search results untuk item yang diarsipkan — supaya user tahu kalau hasil search ada yang dari arsip.
5. **Badge "☁ Drive"** di search results untuk screenshot yang sudah di-upload ke Drive.

### Testing
1. Buat link dengan URL "https://github.com/..." → simpan di vault
2. Buat bundle → centang link github tsb sebagai anggota
3. Ketik "github" di search box → HARUS muncul: link standalone + bundle yang anggotanya berisi link github
4. Cek: ada tombol X di ujung kanan search box (hanya saat ada teks)
5. Klik X → search box ter-clear + fokus balik ke search box
6. Ketik "github" lagi → arsipkan link github → ketik "github" lagi → hasil search menampilkan link dengan badge "📦 arsip"
7. Capture screenshot + upload ke Drive → ketik kata kunci dari driveFileUrl → hasil search menampilkan screenshot dengan badge "☁ Drive"

---

## File yang diubah

| File | Jenis | Ringkasan |
|---|---|---|
| `manifest.json` | Modify | Bump 3.8.0 → 3.11.0 (di atas v3.10.1 baseline) |
| `lib/appsscript-sync.js` | Modify | Fix CORS preflight (Content-Type → text/plain), strip vault.settings + thumbnailDataUrl, timeout 60s, ?action=sync&alt=json. NEW: `pushScreenshotToDrive()` function (~95 baris) untuk Issue 2. Sertakan driveFileUrl/driveFileId di screenshotMeta. |
| `lib/storage.js` | Modify | Tambah setting `appsScriptUploadScreenshots: true` di DEFAULT_SETTINGS |
| `apps-script/recallfox-sync.gs` | Modify | Handle `action=upload_screenshot` via `handleScreenshotUpload()` + `getOrCreateScreenshotsFolder()` (~80 baris). Guard empty rows di sheet writers. Authorization header case-insensitive. Sheet `ScreenshotMeta` tambah kolom `driveFileUrl` + `driveFileId` + formula HYPERLINK. |
| `background.js` | Modify | Helper `uploadScreenshotToDriveIfEnabled()` (~40 baris). Hook di `triggerScreenshot`, `saveCaptureToVault`, `SAVE_UPLOAD_TO_VAULT`. Handler `UPLOAD_SCREENSHOT_TO_DRIVE` untuk manual trigger. |
| `popup/popup.js` | Modify | Fix `saveBundleSheet` timing bug (pindahkan promise ke luar openSheet) + tambah inline-add buttons. Expand `searchableTextFor()` bundle member haystack. Tambah X clear button handler. Tambah "☁ Drive" badge + "Upload ke Drive" / "Buka di Drive" button di screenshot functional sheet. Tambah "📦 arsip" + "☁ Drive" badge di search results. |
| `popup/popup.html` | Modify | Tambah `<button id="searchClear" class="search-clear">` di command bar |
| `sidebar/sidebar.html` | Modify | Tambah `<button id="searchClear" class="search-clear">` di command bar |
| `popup/popup.css` | Modify | Tambah `.search-clear` style (22×22px grid, hover background) |
| `settings/settings.html` | Modify | Tambah toggle "☁ Auto-upload screenshot ke Drive" + warning prasyarat scope drive.file |
| `settings/settings.js` | Modify | Init + handler untuk `appsScriptUploadScreenshots` toggle |
| `README.md` | Modify | Bump version 3.8.0 → 3.11.0, tambah changelog v3.11.0 section |
| `CHANGELOG-v3.11.0.md` | NEW | Detail per-issue analysis + root cause + solution (file ini) |

---

## Testing checklist lengkap

- [ ] Buka Firefox → `about:debugging` → Load Temporary Add-on → pilih `manifest.json`
- [ ] Cek tidak ada error di Browser Console (Ctrl+Shift+J)
- [ ] **Issue 1**: Set URL + token Apps Script → Test Koneksi (sukses) → Kirim Sekarang (sebelumnya gagal, sekarang sukses) → cek spreadsheet terisi
- [ ] **Issue 2**: Deploy ulang Apps Script dengan scope `drive.file` → enable "Auto-upload screenshot ke Drive" → capture screenshot → cek Drive folder "RecallFox Screenshots" → cek spreadsheet kolom `driveFileUrl` ada link HYPERLINK
- [ ] **Issue 3**: Klik tile "Bundle" → cek chips + picklist LANGSUNG ter-render (no flash) → bandingkan dengan "Edit Bundle" (selaras) → cek ada tombol "+ Catatan baru" & "+ Prompt baru"
- [ ] **Issue 4**: Simpan link github → buat bundle dengan link github sebagai anggota → ketik "github" di search → HARUS muncul link + bundle → cek ada X clear button → klik X → search ter-clear

---

**Versi:** 3.11.0 · **Total issue:** 4 · **Status:** Semua selesai ✓ · **Baseline:** v3.10.1
