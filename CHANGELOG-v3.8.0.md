# Changelog v3.8.0 — Log Troubleshooting Sesi 1 (18 Juli 2026)

7 issue dari Log_Troubleshooting_RECALFOX.docx — semua selesai.

> **Catatan**: User menganggap ada fitur "Apps Script Sync" yang sudah ada di v3.7.2,
> padahal yang ada hanya **Firefox Sync** (browser.storage.sync) — TIDAK ada
> integrasi Google Spreadsheet. User melihat toast "Tersinkron" lalu salah mengira
> datanya sudah masuk spreadsheet. v3.8.0 membangun fitur Apps Script Sync yang
> sebenarnya dari nol, plus memperbaiki 6 issue lain.

---

## Issue 1 + 2: Apps Script Sync (Web App)

### Problem
User mengeluh: "aku pernah bikin prompt di addonya dan klik kirim sekarang, berhasil terkirim 1 tapi spreadsheet yang terhubungnya masih kosong, entah kirim apa ke mana tu tidak jelas."

### Root cause
- Fitur Apps Script Sync **TIDAK ADA** di v3.7.2 — grep `appsscript|apps_script|spreadsheet` di seluruh repo → 0 match.
- Yang ada hanya **Firefox Sync** (browser.storage.sync) — sync antar device via server Mozilla, BUKAN ke Google Spreadsheet.
- User melihat tombol "Sinkron sekarang" → klik → toast "Tersinkron" → user salah mengira datanya masuk spreadsheet.
- Tidak ada UI yang menampilkan apa yang sebenarnya tersimpan di spreadsheet.

### Solusi (v3.8.0)
1. **Modul baru**: `lib/appsscript-sync.js`
   - `pushToAppsScript(opts)` — POST HTTP ke Apps Script Web App
   - `testAppsScriptConnection()` — ping tanpa mengirim data
   - `scheduleAutoAppsScriptSync()` — debounced 30s untuk auto-sync
   - `getAppsScriptStatus()` — untuk UI display
2. **Apps Script server template**: `apps-script/recallfox-sync.gs`
   - `doGet(e)` — handle ping
   - `doPost(e)` — handle sync (replace-all mode)
   - Verifikasi token via `Authorization: Bearer <token>` atau body.token
   - Buat spreadsheet "RecallFox Backup" otomatis di Google Drive user
   - Sheet terpisah: Vault, Notes, Bundles, Habits, ScreenshotMeta, Meta
3. **Settings UI** (`settings/settings.html` + `settings.js`)
   - Section baru "📊 Apps Script Sync (Google Spreadsheet)"
   - Field: URL, Token, payload checkboxes (notes/screenshots/habits/chat/volume), auto-sync toggle
   - Tombol: Test Koneksi, Kirim Sekarang
   - Display: last sync time, total rows, last error
4. **Tools UI** (`popup/popup.js` `renderAppsScriptPage`)
   - Quick access dari toolbar → "Apps Script Sync" tile
   - Status card (green=synced, blue=ready, red=not configured)
   - Aksi: Test, Send, Open Settings
5. **Message handlers** (background.js): `SYNC_TO_APPSSCRIPT`, `TEST_APPSSCRIPT`, `GET_APPSSCRIPT_STATUS`
6. **Manifest**: tambah `https://script.google.com/*` & `https://script.googleusercontent.com/*` & `https://drive.google.com/*` ke host_permissions

### Verifikasi response ketat (Issue 2)
- `pushToAppsScript()` mengharapkan response `{ok:true, rowsAppended, totalRows, receivedAt}`.
- Kalau Apps Script tidak return persis seperti itu → RecallFox anggap gagal & simpan error.
- Tidak mungkin lagi "kirim berhasil tapi spreadsheet kosong" — user selalu tahu status sebenarnya.

### Test koneksi (Issue 2)
- Sebelum kirim data, user bisa klik "Test Koneksi" yang hanya ping.
- Ping return `{ok:true, version, spreadsheetUrl, totalRows}` — verifikasi URL + token valid.

---

## Issue 3: Media — Input Manual Screenshot dari Luar Web

### Problem
"di bagian media ini kan semua screnshot dari web masuk ke sini ya, tapi screnshoot diluar web tidak bisa masuk sini, maksudku, tetap sediakan inputan manual untuk screnshot diluar web ya."

### Root cause
- `<input type="file" id="screenshotFileInput">` ada di `popup.html:247` & `sidebar.html:248` tapi **TIDAK PERNAH direferensikan** di JS manapun (orphan element).
- Editor sheet eksplisit blok add baru: `toast('Screenshot baru pakai tombol Shot', false); return;`
- Tidak ada `paste` handler untuk gambar dari OS clipboard.

### Solusi (v3.8.0)
1. **Tombol "📁 Upload gambar (manual)"** di `addItemMenu()` → `saveScreenshotUploadSheet()`
2. **Upload sheet** dengan:
   - Field: Judul, Tag, URL sumber (opsional)
   - Upload zone (klik untuk pilih file)
   - **Paste handler** — tangkap gambar dari OS clipboard (Snipping Tool, macOS screenshot, dll.) via `document.addEventListener('paste', ...)` + `e.clipboardData.items`
   - Preview gambar + metadata (dimensi, ukuran, format)
   - Validasi: maks 10 MB, harus image/*
3. **Handler background**: `SAVE_UPLOAD_TO_VAULT` di `background.js`
   - Decode dataURL → generate thumbnail 200px via `OffscreenCanvas` + `createImageBitmap`
   - Tambah ke vault via `addItem({type:'screenshot', screenshotMode:'upload', ...})`
4. **Editor sheet fix**: tidak lagi blok pembuatan screenshot baru — redirect ke upload sheet.

---

## Issue 4: "Ambil dari halaman aktif" Tidak Berfungsi

### Problem
"fitur konteks ini masih tidak berguna, contoh aku klik 'Ambil dari halaman aktif' tidak berfungsi apapun."

### Root cause
- Handler `GET_PAGE_CONTEXT` **tidak ada di mana pun** di v3.7.2.
- Empty `catch (e) {}` di `popup.js:1010` menelan error → user tidak tahu gagal.
- Toast "📋 Info halaman diambil" selalu muncul walau gagal (menyesatkan).
- Hanya mengisi title + URL — value-add yang dijanjikan ("ambil konten halaman") tidak pernah tercapai.
- Field `contextPurpose` di-drop silent oleh `addItem()` (tidak ada di whitelist).
- Field `source` tidak ikut disimpan dari modal (inkonsisten vs context menu).

### Solusi (v3.8.0)
1. **Handler `GET_PAGE_CONTEXT`** di `content/overlay.js` (sebagai fallback kalau scripting diblokir CSP) — extract title/URL/desc/main content/H1/navLinks.
2. **`browser.scripting.executeScript`** di background (lebih reliable untuk halaman dengan CSP ketat) — ekstrak:
   - `document.title`, `location.href`
   - Meta description (3 source: name, og:description, twitter:description)
   - Main content: `<main>` → `<article>` → `[role="main"]` → `.content` → `.article-body` → `body`
   - H1 pertama
   - Nav links (max 10)
   - Truncate text ke 8000 char (cukup untuk context AI)
3. **Tombol "🤖 Ringkas dengan AI"** — kirim konten ke Groq/Gemini via `chatWithFallback()`:
   - System prompt: ringkas ≤200 kata + 3-5 keyword + klasifikasi tipe halaman
   - Format output: `RINGKASAN: ... KEYWORD: ... TIPE: ...`
4. **Akurat toast**: tampilkan status real berdasarkan response (sukses ekstrak / partial / gagal).
5. **Whitelist `contextPurpose`** di `addItem()` storage.js.
6. **Simpan `source: {url, title, capturedAt}`** dari modal — sebelumnya tidak dikirim.
7. **Append, bukan replace**: user bisa ambil konten dari beberapa halaman sekaligus.

---

## Issue 5: Bundle — Catatan, Inline Add, Sort/Filter/Warna

### Problem
"fitur bundle ini kenapa tidak bisa membaca catatan ya? hanya bisa link, prompt, dsb tapi catatan belum."
"fitur ini kenapa tidak dibikin ada menambahkan catatan disitu jadi bisa ngeprompt langsung disitu bukan hanya ada judul saja. nah nanti promptnya bisa ada centang save sebagai prompt yang akan digunakan lagi atau tidak disave, tapi defaultnya tidak disave ya."
"disitu udah ditandai sih, link, prompt media dsb tapi karena daftarnya panjang dan ditandai hanya pake tulisan tidak bisa disort juga, tidak ada warna juga untuk membedakan maka bingung milihnya."

### Root cause
- Bundle picker filter eksplisit: `['prompt','context','link','screenshot','snapshot']` — catatan tidak termasuk.
- Catatan disimpan di storage key terpisah (`recallfox_notes`) → tidak ter-index di vault.
- Tidak ada UI tambah item baru dari dalam bundle editor.
- Tidak ada search/filter/sort di picker.
- Type badge hanya teks abu-abu (`color:var(--muted)`) — tidak ada warna per-tipe.

### Solusi (v3.8.0)
1. **Catatan sebagai anggota bundle**:
   - `getNotesAsBundleCandidates()` di storage.js — return notes sebagai virtual items dengan `type:'note'`
   - `resolveBundleMembers(itemIds)` — resolve ID ke vault items ATAU notes (untuk inject)
   - Bundle editor & create sekarang include notes sebagai kandidat
   - `injectBundle()` pakai `resolveBundleMembers()` supaya note ikut ter-render
2. **Search box** di picker — filter berdasarkan judul/tags/body (case-insensitive)
3. **Filter chips per-tipe** — 6 chips: Prompt/Konteks/Link/Media/Snapshot/Catatan. Multi-select, toggle on/off.
4. **Type badge berwarna** di pickrow:
   - `.pt-type.t-prompt` → primary (biru)
   - `.pt-type.t-context` → violet
   - `.pt-type.t-snapshot` → green
   - `.pt-type.t-screenshot` → amber
   - `.pt-type.t-link` → light blue
   - `.pt-type.t-note` → warm yellow
5. **Sort**: checked-first, lalu by updatedAt desc
6. **Inline add** di bundle editor:
   - Tombol "+ Catatan baru" → prompt body+title → `addNote()` → auto-centang
   - Tombol "+ Prompt baru" → prompt body+title → confirm "Save as prompt?"
     - Cancel = simpan sebagai catatan di grup 'bundle-prompts' (default, tidak disave ke vault prompt)
     - OK = simpan ke `vault.items` sebagai prompt (bisa dipakai ulang di bundle lain)
7. **`type:'note'` di TYPE constant** + class CSS untuk icon note

---

## Issue 6: Backup & Apps Script Redundan

### Problem
"fitur backup ini, apakah tidak bisa di integrasikan dengan Apps Script Sync ya? baiknya gimana agar simpel tidak mubazir fitur karena nanti user bingung."

### Root cause
- DUA versi payload yang berbeda:
  - **VERSI A** (autobackup.js `buildBackupPayload`): vault + notes + screenshotBlobs + habits + assistantChat + volumeSettings + meta (v4)
  - **VERSI B** (background.js `EXPORT_BACKUP` & settings.js `exportBackup`): hanya `{vault, screenshotBlobs}` — kehilangan notes/habits/chat/volume
- `handleImportFile()` di settings.js hanya merge vault.items → data lain (notes/habits/chat/volume) tidak di-restore walau ada di file backup.
- Sebelum v3.8.0: Apps Script Sync tidak ada, jadi tidak ada integrasi yang bisa dilakukan.

### Solusi (v3.8.0)
1. **Export `buildBackupPayload()`** dari `autobackup.js` (sebelumnya private function).
2. **Refactor `EXPORT_BACKUP`** (background.js) — pakai `buildBackupPayload()`. Fix bug: sebelumnya Export dari popup/settings kehilangan notes/habits/chat/volume.
3. **Refactor `exportBackup()`** (settings.js) — pakai `buildBackupPayload()`.
4. **Fix `handleImportFile()`** (settings.js) — restore notes + habits + assistantChat + volumeSettings yang sebelumnya di-skip.
5. **Fix `IMPORT_BACKUP`** (background.js) — sama: restore v4 data yang sebelumnya di-skip. Return `extras` array untuk display.
6. **Apps Script Sync pakai payload yang sama** — `pushToAppsScript()` call `buildBackupPayload()` lalu filter sesuai preferensi user (notes/screenshots/habits/chat/volume).
7. **Satu serializer, tiga transport**: disk (auto-backup + manual export), Firefox Sync (vault-only, size limit), Apps Script (filtered payload ke spreadsheet).

---

## Issue 7: 2 Kolom Tombol Inline Mubazir

### Problem
"ini kenapa kolomnya tidak disatukan saja? karena dua gini mubazir, terus desain kolom di dalamnya nanti ketika di klik itu yang fungsional."

### Root cause
- 3 tipe item punya 2-3 tombol inline berdampingan:
  - Link: Salin + Buka + Sisipkan (3 tombol)
  - Bundle: Salin + Sisipkan (2 tombol)
  - Screenshot: Lihat + Download (2 tombol)
- `openScreenshotViewer()` pakai `window.open('')` → hanya buka window baru berisi gambar polos, tanpa UI tambahan.
- User anggap mubazir & membingungkan — harus pilih mana yang mau diklik.

### Solusi (v3.8.0)
1. **Single CTA "Buka ↵"** (atau "Lihat ↵" untuk screenshot) di setiap baris item.
2. **Functional sheet** (`openFunctionalSheet(id)`) — sheet in-app dengan layout berbeda per tipe:
   - **Screenshot**: preview gambar lazy-loaded + metadata (bytes/format/source URL) + 6 aksi (Salin ke clipboard gambar, Download, Sisipkan referensi ke AI, Edit, Favorit, Arsip, Hapus)
   - **Bundle**: daftar anggota dengan type badge + 4 aksi (Salin semua, Sisipkan ke AI, Edit anggota, Arsip, Hapus)
   - **Link**: URL display + 6 aksi (Salin URL, Buka di tab baru, Sisipkan ke AI, Edit, Favorit, Arsip, Hapus)
   - **Prompt/Konteks/Snapshot**: preview body (max 800 char) + 6 aksi (Sisipkan ke AI / Salin, +Lampiran, Edit, Favorit, Arsip, Tambah ke Bundle, Hapus)
3. **Screenshot viewer in-app** — bukan window.open lagi. Preview + semua aksi dalam 1 sheet.
4. **Klik row mana pun** (bukan hanya CTA) → buka functional sheet — konsisten.

---

## File yang diubah

| File | Jenis | Ringkasan |
|---|---|---|
| `manifest.json` | Modify | Bump 3.7.2 → 3.8.0, tambah host permission Apps Script |
| `lib/appsscript-sync.js` | **NEW** | Modul sync ke Apps Script Web App |
| `lib/storage.js` | Modify | Whitelist `contextPurpose`, `getNotesAsBundleCandidates()`, `resolveBundleMembers()`, settings Apps Script |
| `lib/autobackup.js` | Modify | Export `buildBackupPayload()` (sebelumnya private) |
| `apps-script/recallfox-sync.gs` | **NEW** | Template Google Apps Script server-side |
| `background.js` | Modify | Handler: SYNC_TO_APPSSCRIPT, TEST_APPSSCRIPT, GET_APPSSCRIPT_STATUS, GET_PAGE_CONTEXT, SUMMARIZE_TEXT, SAVE_UPLOAD_TO_VAULT. Fix EXPORT_BACKUP & IMPORT_BACKUP payload. Auto-sync Apps Script trigger. |
| `content/overlay.js` | Modify | Handler GET_PAGE_CONTEXT (fallback) |
| `popup/popup.js` | Modify | saveKonteksSheet rewrite + AI summarize, saveScreenshotUploadSheet, bundle editor + create dengan notes/search/filter/warna/inline add, openFunctionalSheet, renderAppsScriptPage, TYPE.note, redirect openScreenshotViewer & primaryAction |
| `popup/popup.css` | Modify | Type badge berwarna untuk picker, .bf-chips, .fs-member, .item-ic.t-note/.t-link/.t-bundle |
| `settings/settings.html` | Modify | Section baru "Apps Script Sync" |
| `settings/settings.js` | Modify | Init Apps Script settings, handler events, refreshAppsScriptStatus, fix exportBackup & handleImportFile payload |
| `README.md` | Modify | Bump version, changelog v3.8.0 |

---

## Testing checklist

- [ ] Buka Firefox → `about:debugging` → Load Temporary Add-on → pilih `manifest.json`
- [ ] Cek tidak ada error di Browser Console (Ctrl+Shift+J)
- [ ] **Issue 1+2**: Buka Settings → Apps Script Sync → set URL+token (pakai template `apps-script/recallfox-sync.gs`) → Test Koneksi → Kirim Sekarang → cek spreadsheet terisi
- [ ] **Issue 3**: Add Item → 📁 Upload gambar (manual) → drag file atau Ctrl+V gambar dari Snipping Tool → Save → cek muncul di vault dengan thumbnail
- [ ] **Issue 4**: Hero tile "Konteks" → Ambil dari halaman aktif → cek body terisi konten halaman (bukan hanya title+URL) → klik 🤖 Ringkas dengan AI → cek ringkasan muncul
- [ ] **Issue 5**: Hero tile "Bundle" → buat bundle → cek: ada search box, ada filter chips 6 tipe, ada tombol + Catatan baru & + Prompt baru, type badge berwarna. Edit bundle → centang catatan → Save → inject bundle → cek catatan ikut
- [ ] **Issue 6**: Export backup (.json) → buka file → cek ada field `notes`, `habits`, `assistantChat`, `volumeSettings`. Import file backup yang sama → cek catatan & habits ter-restore
- [ ] **Issue 7**: Klik baris item di vault → cek sheet fungsional terbuka (bukan langsung inject). Untuk screenshot: cek preview gambar muncul. Untuk bundle: cek daftar anggota muncul.
- [ ] Test di sidebar (Alt+Shift+4) juga — harus konsisten dengan popup

---

**Versi:** 3.8.0 · **Total issue:** 7 · **Status:** Semua selesai ✓
