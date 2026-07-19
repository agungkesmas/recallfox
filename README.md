# 🦊 RecallFox

> **Firefox addon all-in-one untuk produktivitas AI + kehidupan Muslim Indonesia.**
> Vault prompt & konteks, screenshot FireShot-style, Content Guardian, waktu shalat Muhammadiyah, tracker ngaji & olahraga, volume booster, dan masih banyak lagi — semua lokal-first, tanpa server, tanpa telemetry.

**Versi:** 3.11.0 · **Manifest:** V3 · **Browser:** Firefox 115+ · **Lisensi:** MIT

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Firefox](https://img.shields.io/badge/Firefox-115%2B-FF7139?logo=Firefox&logoColor=white)](https://www.mozilla.org/firefox/)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blueviolet)](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json)
[![Version](https://img.shields.io/badge/version-3.11.0-success)](#)

---

## 📦 Fitur Utama

### 🗄️ Vault & Items (6 tipe + Arsip)
- **Prompt** — snippet dengan `{{variabel}}` + 12 "topping" orchestrator (Research, Step-by-step, Deep Think, dst.)
- **Konteks** — referensi yang bisa dilampirkan ke prompt via modal 📎
- **Link** — URL + judul, klik untuk buka di tab baru
- **Bundle** — koleksi item, klik untuk sisipkan semua sekaligus ke AI
- **Snapshot** — cuplikan percakapan AI (50 pesan terakhir, deteksi role otomatis)
- **Screenshot (Shot)** — 3 mode: visible, entire (scroll-stitch), selection (seret kotak)
- **Arsip** — item/bundle bisa diarsipkan tanpa dihapus (v3.7.2)
- **Reassign ke Bundle** — pindahkan item antar bundle tanpa hapus-buat (v3.7.2)

### 🤖 AI Integration
- **7 AI domain didukung penuh** (textarea + send + snapshot): z.ai, ChatGPT, Claude, Gemini, DeepSeek, Qwen, Kimi
- **22 AI tool** di Quick Switch (Barat: ChatGPT/Claude/Gemini/Copilot/Perplexity/Grok/Mistral/HuggingChat/Pi/You.com · China: z.ai/DeepSeek/Qwen/Kimi/Doubao/ChatGLM/Yiyan/Yuanbao/Baichuan/MiniMax/SenseChat)
- **6 provider AI Assistant** (Groq default, Gemini fallback, xAI Grok, z.ai GLM-4.6, OpenAI, Custom)
- **Inject strategy 3-tier**: native setter (React/Vue) → execCommand insertText (ProseMirror/Quill) → clipboard fallback
- **3 mode inject**: append / prepend / replace
- **Fallback chain otomatis**: kalau provider utama 5xx/429/401 → retry ke fallback
- **"Tanya Si Pandai"** — AI assistant 2-peran: receptionist RecallFox + BPJS Ketenagakerjaan verifier (JKK/JKM/JHT/JP/JKP, FORNAS/OGB, ICD-10 ↔ ICD-9-CM)

### 🛡️ Content Guardian
- Filter **250+ keyword negatif** berita Indonesia (bencana, konflik, korupsi, politik, SARA)
- **Anti-leet-speak**: normalisasi `0→o, 1→i, 3→e, 4→a, 5→s, 7→t` — tangkap `J0K0W1`, `k0rupsi`
- **50+ channel YouTube** berita Indonesia diblokir
- **30+ akun X** berita Indonesia diblokir
- **30+ domain berita** Indonesia diblokir (detik, kompas, tribunnews, dll.)
- **60+ query search** politik diblokir → redirect ke search positif Tiongkok
- **15 kurasi positif** Tiongkok (teknologi, kereta cepat, BYD EV, Huawei, smart city, dll.)
- **Mode Anak (v3.7.2)** — 1 klik: `youtube.com → youtubekids.com` + block `/shorts/`
- **Blokir YouTube Shorts** — sembunyikan semua Short dari feed + block navigasi `/shorts/`
- **Dynamic blocklist** — klik kanan → "🚫 Blokir Konten Ini" (6 tipe: title/exact_title/channel/keyword/selection/x_post_url)
- **Takeover & blocked page** dengan 2-click bypass (strict mode)

### 🧱 Element Blocker
- **Picker visual** — klik kanan → "Block Element Ini" → hover indikator merah → klik untuk simpan selector
- **Per-domain rules** dengan multi-selector
- **Block iframe/script** dari domain tertentu (doubleclick, googlesyndication, taboola, dll.)
- **Block popup** — override `window.open` di MAIN world
- **Preset shipped**: NinosPositano/IDLIX21 (streaming + judol ad blocker), Generic Ad Blocker, Streaming Site Blocker

### 🎯 Screenshot (FireShot-style)
- **3 mode**: Visible (viewport), Entire (scroll-stitch), Selection (seret kotak)
- **5 trigger**: floating FAB (toggleable), 3 shortcut keyboard, popup tile, context menu, command palette
- **5 aksi post-capture**: Save PDF, Save JPG, Save PNG, Copy clipboard, Save to Vault
- **PDF generator murni JS** — no jsPDF, A4 multi-page, DCTDecode JPEG XObject
- **Thumbnail 200px** otomatis untuk list view (via OffscreenCanvas)
- **Max 60 frame** per capture, max tinggi 16,384px (configurable)

### 🔊 Volume Booster
- **Range −32 dB to +32 dB** per tab/per domain (slider UI)
- **0 dB = 100%, +20 dB = 1000%, −32 dB ≈ 2.5%**
- **Monkey-patch AudioNode/HTMLMediaElement/Audio** di MAIN world
- **Auto-detect cross-origin/DRM** → fallback ke native volume (lower only)
- **3 shortcut**: `Alt+Shift+↑/↓/0` (+1 dB, −1 dB, reset)
- **Per-site persistence** — volume diingat per hostname

### 🕌 Fitur Islamic
- **Waktu Shalat Muhammadiyah** (Munas Tarjih 2020) — Fajr −18°, Isha −18°, via Aladhan API
- **6 waktu wajib** + **5 waktu sunnah** (Ishraq, Dhuha, Awwabin, Tahajud, Witir)
- **Countdown** ke shalat berikutnya + badge toolbar (menit/jam/NOW)
- **Reminder** N menit sebelum shalat (5/10/15/30)
- **Kalender Hijriah** dengan parser robust (handle diacritic Aladhan)
- **6 jenis puasa sunnah**: Senin-Kamis, Ayyamul Bidh (13-15), Tasua (9 Muharram), Asyura (10 Muharram), Arafah (9 Dzulhijjah), 6 Syawal
- **Notifikasi H-1** puasa sunnah
- **Tracker ngaji** — target halaman/hari, streak, reminder waktu
- **Tracker olahraga** — interval/specific time, 5 jenis (jalan cepat, lari, bersepeda, kekuatan, yoga)

### 📝 Catatan (Notepad)
- **12 warna** (default, yellow, green, blue, pink, purple, orange, red, teal, indigo, slate, rose)
- **Judul opsional** + **grup/proyek** (v3.7.2)
- **Filter grup** chips — kelompokkan catatan per proyek
- **Auto-save** 800ms debounce
- **Pin**, **arsip**, **copy** ke clipboard
- Tersimpan lokal (ikut backup otomatis, tidak ikut sync)

### 💾 Backup & Sync
- **Auto-backup** ke `Downloads/RecallFox/auto-backup.json` (interval 1/6/12/24 jam)
- **Manual backup** dengan timestamp (`manual-backup-YYYYMMDDHHMMSS.json`)
- **Backup terenkripsi** `.rfvault` — AES-GCM 256-bit + PBKDF2 100k iter (Web Crypto native)
- **Backup payload** lengkap: vault + notes + screenshot blobs + habits + chat + volume settings
- **Orphan cleanup** saat restore — hapus screenshot blobs yang tidak ada di payload (v3.7.2)
- **Firefox Sync** chunked 90KB/key dengan SHA-256 hash verification
- **Item-level merge** by `updatedAt` (last-write-wins)

### 🔍 Search Multi-Field
- **Fuzzy search** dengan scoring: exact (100) > startsWith (80) > contains (60) > word-start (50) > char-by-char (20)
- **Field weight**: title ×3, body ×1, tags ×2, category ×1.5, favorite bonus ×1.1
- **Cari di SEMUA tipe** (v3.7.2): Prompt, Konteks, Link, Bundle (+ judul anggota), Snapshot, Screenshot (+ source URL), Catatan (title + body + group)
- **Command palette**: ketik `/` untuk fokus search, `>cmd` untuk command

### 🧰 Alat Lain
- **Clear Cache** — 9 tipe data (cache, cookies, history, localStorage, indexedDB, serviceWorkers, downloads, formData, passwords), 5 periode waktu, per-site mode
- **Auto Tab Discard** — hemat memory, discard tab idle >N menit (exclude pinned/active/media/input)
- **Statistik** — total item, top used, top tags
- **Restore banner** — otomatis tampil saat vault kosong + backup tersedia

---

## 🚀 Install

### Cara 1 — Temporary addon (untuk dev/coba)
1. Buka Firefox → `about:debugging` di address bar
2. Klik **"This Firefox"** di sidebar kiri
3. Klik **"Load Temporary Add-on..."**
4. Pilih file `manifest.json` di folder repo ini
5. Addon aktif sampai Firefox ditutup

### Cara 2 — Permanen (perlu signing)
Karena addon unsigned, untuk instalasi permanen:
- **Firefox Developer Edition / Nightly / ESR** — set `xpinstall.signatures.required = false` di `about:config`
- **Submit ke AMO** (addons.mozilla.org) untuk di-sign

### Cara 3 — Install dari XPI
1. Download file `.xpi` dari [Releases](../../releases)
2. Drag file `.xpi` ke window Firefox
3. Klik **"Add"** saat konfirmasi

---

## ⌨️ Shortcut Keyboard

| Shortcut | Fungsi |
|---|---|
| `Alt+Shift+4` | Buka / tutup sidebar |
| `Alt+Shift+5` | Tangkap **seluruh halaman** (scroll-stitch) |
| `Alt+Shift+6` | Tangkap **area terpilih** (seret kotak) |
| `Alt+Shift+7` | Tangkap **bagian terlihat** (viewport) |
| `Alt+Shift+C` | Clear cache |
| `Alt+Shift+↑` | Volume +1 dB |
| `Alt+Shift+↓` | Volume −1 dB |
| `Alt+Shift+0` | Reset volume ke 0 dB (100%) |
| `Alt+Shift+A` | Tanya Si Pandai tentang teks terseleksi |
| `/` atau `⌘K` | Fokus search box (di popup) |
| `Esc` | Tutup sheet / picker / modal |

---

## 📋 Context Menu (Klik Kanan)

### Pada teks terseleksi
- **Simpan sebagai Prompt**
- **Simpan sebagai Konteks**
- **🤖 Tanya Si Pandai** — kirim teks ke AI assistant
- **🚫 Blokir Konten Ini** (submenu, YouTube/X/Twitter only):
  - Blokir judul / judul PERSIS / channel / kata kunci / teks terseleksi / URL post X

### Pada halaman
- **Simpan Halaman Ini** — sebagai Link
- **Snapshot Percakapan** (AI domain only)
- **Capture Screenshot**
- **Clear Cache**
- **🚫 Block Element Ini (Element Blocker)** — picker visual

### Pada link
- **Simpan Link Ini**

---

## 📁 Struktur File

```
recallfox/
├── manifest.json              # MV3 manifest (Firefox 115+)
├── background.js              # Service worker (2.7k lines)
├── README.md                  # File ini
├── LICENSE                    # MIT
├── .gitignore
│
├── _locales/                  # i18n (id + en)
│   ├── id/messages.json
│   └── en/messages.json
│
├── content/                   # Content scripts
│   ├── ai-resolvers.js        #   AI domain selector config
│   ├── content.js             #   Inject, toast, snapshot (AI domains)
│   ├── content.css
│   ├── capture.js             #   Screenshot scroll-stitch (on-demand)
│   ├── capture.css
│   ├── overlay.js             #   Floating screenshot FAB + modal (all pages)
│   ├── overlay.css
│   ├── selection-ai.js        #   "Tanya Si Pandai" floating pill
│   ├── contentguard-cs.js     #   CG filter (YouTube/X)
│   ├── elementblocker-cs.js   #   EB picker + rule application
│   ├── volume-hook.js         #   MAIN-world audio monkey-patch
│   ├── volume-shared.js
│   └── volume-cs.js
│
├── contentguard/              # CG redirect pages
│   ├── takeover.html/.js/.css #   Replacement for YT/X home
│   └── blocked.html/.js/.css  #   Replacement for blocked news sites
│
├── popup/                     # Vault UI (popup toolbar)
│   ├── popup.html
│   ├── popup.js               #   3.1k lines — main UI logic
│   └── popup.css
│
├── sidebar/                   # Vault UI (sidebar persistent)
│   ├── sidebar.html
│   ├── sidebar.js             #   Imports popup.js
│   └── sidebar.css
│
├── settings/                  # Full-page settings
│   ├── settings.html          #   1.5k lines
│   ├── settings.js            #   1.5k lines
│   └── settings.css
│
├── lib/                       # Business logic (ESM modules)
│   ├── storage.js             #   Vault + notes + screenshot + sync chunked
│   ├── search.js              #   Fuzzy multi-field search
│   ├── autobackup.js          #   Auto-backup to disk + restore
│   ├── crypto.js              #   AES-GCM + PBKDF2 (Web Crypto)
│   ├── pdf.js                 #   Pure-JS PDF generator
│   ├── assistant.js           #   AI assistant (6 providers + fallback)
│   ├── ai-tools.js            #   22 AI tool catalog
│   ├── toppings.js            #   12 prompt orchestrator toppings
│   ├── contentguard.js        #   CG keyword lists + helpers
│   ├── elementblocker.js      #   EB rule presets
│   ├── salahtime.js           #   Prayer times (Muhammadiyah)
│   ├── islamicCalendar.js     #   Hijri + sunnah fasts
│   ├── habits.js              #   Ngaji + exercise tracker
│   ├── volume.js              #   dB ↔ percent conversion
│   ├── clearcache.js          #   browsingData cleaner
│   ├── domains.js             #   Domain categorization
│   └── crypto.js
│
└── icons/                     # SVG icons (16/32/48/96/128)
```

**Stats**: ~25k lines total · 54 files · 0 dependencies · 0 build step

---

## 🔧 Tech Stack

- **Firefox WebExtension Manifest V3** (Firefox 115+)
- **Vanilla JavaScript** (ESM modules) — zero dependencies, zero build step
- **Web APIs**: `crypto.subtle` (AES-GCM/PBKDF2), `OffscreenCanvas`, `browser.storage.local/sync`, `browser.tabs.captureVisibleTab`, `browser.menus`, `browser.alarms`, `browser.browsingData`, `browser.notifications`, `browser.geolocation`
- **External APIs** (user-initiated, visible in Network DevTools):
  - [Aladhan](https://aladhan.com/prayer-timing-api) — prayer times
  - [Nominatim OpenStreetMap](https://nominatim.org/) — geocoding
  - [Groq](https://groq.com/), [Gemini](https://ai.google.dev/), [xAI](https://x.ai/), [OpenAI](https://openai.com/), [z.ai](https://z.ai/) — AI providers (user-configured)

---

## 🔒 Privacy Posture

- **Local-first**: semua data vault, catatan, screenshot, habits, volume, chat history disimpan di `browser.storage.local` perangkat user. Tidak ada server, tidak ada telemetry, tidak ada analytics.
- **Sync opsional**: Firefox Sync (E2E encrypted by Mozilla) **OFF** by default. User harus explicit enable.
- **Cloud AI opsional**: Groq adalah default (perlu user isi sendiri API key-nya). User bisa switch ke Gemini free tier, xAI, OpenAI, z.ai, atau custom endpoint. Semua API call langsung dari browser ke provider — RecallFox tidak punya intermediary server.
- **No third-party scripts**: zero external JS library. PDF generation, enkripsi, fuzzy search — semua vanilla JS pakai Web API native.
- **Passphrase tidak pernah disimpan**: backup terenkripsi hanya simpan salt + IV + ciphertext. Salah passphrase → `WRONG_PASSPHRASE` error.
- **Permission scoped**: `geolocation` hanya trigger via user gesture eksplisit; `browsingData` hanya invoke saat user command; `tabs` mostly read-only (write hanya untuk redirect/discard).

---

## 📊 Permissions & Host Permissions

### Permissions (12)
| Permission | Alasan |
|---|---|
| `storage` | Vault, notes, settings, screenshot blobs, habits, volume, chat history |
| `menus` | 15+ context menu items |
| `activeTab` | Capture, inject, volume, picker di tab aktif |
| `scripting` | Inject `capture.js` on-demand untuk screenshot |
| `tabs` | Query, redirect (CG), discard tabs |
| `clipboardWrite` | Copy prompt/screenshot/AI answer ke clipboard |
| `downloads` | Save screenshot PDF/JPG/PNG, backup `.json`/`.rfvault` |
| `unlimitedStorage` | Screenshot blobs bisa besar (multi-MB) |
| `browsingData` | Clear cache/cookies/history/dll. |
| `notifications` | Reminder shalat/exercise/ngaji, fast H-1, block notify |
| `geolocation` | Deteksi lokasi untuk waktu shalat (user-initiated) |
| `alarms` | Periodic timer untuk auto-discard (lebih reliable dari setInterval di MV3) |

### Host Permissions
- `<all_urls>` — content scripts generic (overlay, selection-ai, volume, EB, CG)
- `https://api.aladhan.com/*` — prayer times
- `https://nominatim.openstreetmap.org/*` — geocoding
- 9 AI domains (`chat.z.ai`, `chatgpt.com`, `claude.ai`, `gemini.google.com`, `chat.deepseek.com`, `tongyi.aliyun.com`, `chat.qwen.ai`, `kimi.moonshot.cn`, `kimi.com`)
- 5 AI provider APIs (`api.groq.com`, `generativelanguage.googleapis.com`, `api.x.ai`, `api.z.ai`, `api.openai.com`)

---

## 💾 Storage Keys

| Key | Lokasi | Isi |
|---|---|---|
| `recallfox_vault` | local | Vault utama: items, bundles, toppings, settings |
| `recallfox_notes` | local | Catatan (title, body, color, group, pinned, archived) |
| `rf_shot_<id>` | local | Full-size screenshot data URL (1 key per screenshot) |
| `rf_cg_bypass` | local | CG bypass URLs → timestamps (60s TTL) |
| `recallfox_assistant_chat` | local | Riwayat chat Si Pandai |
| `recallfox_habits` | local | Ngaji log + exercise log |
| `recallfox_volume_settings` | local | Volume per-site + global |
| `recallfox_autobackup_meta` | local | Metadata backup terakhir |
| `recallfox_pending_ai_query` | local | Pending AI query untuk sidebar routing (transient) |
| `sync_meta` | sync | Metadata chunked sync (totalChunks, hash) |
| `sync_chunk_<N>` | sync | 90KB chunk vault JSON |

**Sync limit**: Firefox Sync 100KB/key → RecallFox chunk di 90KB (safety) + SHA-256 hash verification.

---

## 🆕 Changelog v3.11.0

4 issue baru dari Log_Troubleshooting Sesi lanjutan (18 Juli 2026) — semua selesai:

| # | Issue | Solusi |
|---|---|---|
| 1 | "Tombol full backup ke Google Drive tidak bekerja. Padahal test koneksi berhasil." | **Root cause**: `Content-Type: application/json` memicu CORS preflight (OPTIONS request) yang diblokir Apps Script Web App. GET (test koneksi) tidak kena preflight → itu sebabnya ping sukses. **Fix**: ganti ke `text/plain;charset=utf-8` (simple request, no preflight) + tambah `?action=sync&alt=json` query param. Plus: strip `vault.settings` (berisi `appsScriptToken`!) + `thumbnailDataUrl` dari payload. Timeout 30s → 60s. Header Authorization handle case-insensitive. Apps Script guard empty rows sebelum `setValues()`. |
| 2 | "Screenshot yang diambil menggunakan fitur 'Shot' tidak tersave di Drive... bisa engga sih setiap screenshot tu bisa disave di Drive?" | **NEW feature**: setiap screenshot yang di-capture (via `triggerScreenshot`, `saveCaptureToVault`, `SAVE_UPLOAD_TO_VAULT`) OTOMATIS di-upload ke folder "RecallFox Screenshots" di Google Drive user via Apps Script baru `handleScreenshotUpload`. File sharing: ANYONE_WITH_LINK. Link disimpan di item (`driveFileUrl`, `driveFileId`, `driveUploadedAt`) + di sheet `ScreenshotMeta` (kolom `driveFileUrl` dengan formula HYPERLINK). Setting toggle `appsScriptUploadScreenshots` (default ON). Manual trigger via tombol "☁ Upload ke Drive" di screenshot functional sheet. Apps Script harus re-deploy dengan scope `drive.file`. |
| 3 | "Di menu buat bundle kolom 'filter per type' jadi hilang padahal tadinya ada, cek di 'edit bundle' itu ada. jadi tidak selaras" | **Root cause**: timing bug — `getNotesAsBundleCandidates()` dijalankan DI DALAM `openSheet` callback, menyebabkan sheet terbuka kosong sejenak (flash) sebelum chips ter-render. User mengira "filter per type hilang". Plus: inline-add buttons "+ Catatan baru" / "+ Prompt baru" hanya ada di Edit Bundle, tidak di Create Bundle. **Fix**: pindahkan promise ke LUAR openSheet (match pattern Edit Bundle) + tambah inline-add buttons ke Create Bundle supaya selaras. |
| 4 | "Aku coba ketik github di fitur pencarian, tapi tidak ditemukan apapun... harusnya fitur cari ini bisa mencari teks di dalam • Prompt Konteks Link Bundle Snapshot Shot sampai arsip. di ujung kanan kotak harusnya ada tombol silang untuk menghapus semua teks" | **Root cause**: `searchableTextFor()` untuk bundle hanya mengambil **title** anggota, BUKAN `linkUrl`/`body`/`tags`/`source` anggota. User cari "github" tidak ketemu kalau github link ada di dalam bundle sebagai anggota. **Fix**: expand bundle member haystack — include title + body + linkUrl + linkTitle + tags + source.url + source.title + note title/body/group. Plus: tambah X clear button di ujung kanan search box (popup.html + sidebar.html + CSS `.search-clear` + JS toggle visibility). Tambah badge "📦 arsip" + "☁ Drive" di search results. |

Lihat [CHANGELOG-v3.11.0.md](./CHANGELOG-v3.11.0.md) untuk detail lengkap.

---

## 🆕 Changelog v3.8.0

7 issue dari Log Troubleshooting Sesi 1 (18 Juli 2026) — semua selesai:

| # | Issue | Solusi |
|---|---|---|
| 1 | "Apps Script Sync (Web App Anda)" — user kirim prompt tapi spreadsheet kosong | Fitur **Apps Script Sync** dibangun dari nol: `lib/appsscript-sync.js` + handler `SYNC_TO_APPSSCRIPT`/`TEST_APPSSCRIPT` + UI di Settings & Tools. Apps Script server template di `apps-script/recallfox-sync.gs`. Verifikasi response `{ok:true, rowsAppended, totalRows}` supaya user tahu kalau spreadsheet benar-benar terisi. |
| 2 | "Terkirim 1 tapi spreadsheet kosong" — tidak jelas kirim ke mana | Verifikasi response ketat di `pushToAppsScript()` — kalau Apps Script tidak return `{ok:true}`, RecallFox anggap gagal & simpan `appsScriptLastSentError`. Plus: tombol **Test Koneksi** (ping) sebelum kirim data. |
| 3 | Media: tidak bisa input manual screenshot dari luar web | Tombol **📁 Upload gambar (manual)** di Add Item menu. Wire-up `#screenshotFileInput` (sebelumnya orphan) + global `paste` handler untuk tangkap gambar dari OS clipboard (Snipping Tool, screenshot macOS, dll.). Screenshot upload disimpan dengan metadata lengkap (width/height/format/bytes + thumbnail 200px). |
| 4 | "Ambil dari halaman aktif" tidak berfungsi | Handler `GET_PAGE_CONTEXT` di `content/overlay.js` + `browser.scripting.executeScript` di background. Ekstrak title + URL + meta description + main content (`<main>`/`<article>`/fallback `body`) + H1 + nav links. Plus: tombol **🤖 Ringkas dengan AI** (Groq/Gemini) untuk ringkasan padat + keyword + klasifikasi tipe halaman. Whitelist field `contextPurpose` di `addItem()`. Simpan `source: {url, title, capturedAt}` dari modal. |
| 5 | Bundle: catatan belum bisa masuk + tidak bisa tambah inline + tidak bisa sort/filter/warna | **Catatan jadi anggota bundle** via `getNotesAsBundleCandidates()` + `resolveBundleMembers()`. Bundle editor & create: **search box**, **filter chips per-tipe** (6 tipe), **type badge berwarna**, **inline add** (+ Catatan baru / + Prompt baru). Opsi **"save as prompt"** saat inline add prompt — default OFF. |
| 6 | Backup & Apps Script redundan | **Unify payload**: `buildBackupPayload()` di `autobackup.js` sekarang exported & dipakai oleh EXPORT_BACKUP (popup + settings), auto-backup, dan Apps Script Sync. Sebelumnya EXPORT_BACKUP kehilangan notes/habits/chat/volume — sekarang sama. `handleImportFile()` juga diperbaiki: restore notes + habits + chat + volume yang sebelumnya di-skip. |
| 7 | 2 kolom tombol inline mubazir (Salin+Sisipkan / Lihat+Download / Salin+Buka+Sisipkan) | **Satukan jadi 1 CTA "Buka ↵"** yang membuka **functional sheet** in-app. Untuk Screenshot: preview gambar + Salin/Download/Sisipkan/Edit/Arsip/Hapus. Untuk Bundle: daftar anggota + Salin semua/Sisipkan ke AI/Edit anggota/Arsip/Hapus. Untuk Link: URL display + Salin/Buka/Sisipkan/Edit. Untuk Prompt/Konteks: preview body + Sisipkan/Salin/+Lampiran/Edit/Tambah ke Bundle. |

Lihat [CHANGELOG-v3.8.0.md](./CHANGELOG-v3.8.0.md) untuk detail lengkap.

---

## 🆕 Changelog v3.7.2

6 issue dari Log Troubleshooting Sesi 1 (18 Juli 2026) — semua selesai:

| # | Issue | Solusi |
|---|---|---|
| 1 | Screenshot + Bundle enhancement | Tambah `updateBundle()` & `reassignToBundle()` API, chip "Arsip", menu "Tambah/Pindah ke Bundle", "Edit Bundle" |
| 2 | Tombol hijau default OFF | `floatingButtonEnabled` & `overlayButtonEnabled` default `false` |
| 3 | Backup menyeluruh | Verified semua data sudah dibackup + hapus orphan screenshot saat restore |
| 4 | Pencarian menyeluruh | `searchableTextFor()` — cari di semua tipe item + catatan + bundle member titles + screenshot URLs |
| 5 | Catatan dengan grouping | 12 warna (dari 6), field `title` + `group`, filter grup chips, archive catatan |
| 6 | Kontrol situs ramah anak | **Mode Anak** — 1 klik: youtube.com → youtubekids.com + block `/shorts/` + hideAllShorts di feed |

Lihat [CHANGELOG-v3.7.2.md](./CHANGELOG-v3.7.2.md) untuk detail lengkap.

---

## 🧪 Development

### Requirement
- Firefox 115+ (Firefox Developer Edition / Nightly / ESR untuk install permanen tanpa signing)
- `web-ext` CLI (optional, untuk lint & build): `npm install -g web-ext`

### Lint
```bash
web-ext lint --self-hosted
```

### Build XPI
```bash
web-ext build --overwrite-dest --filename recallfox-vX.Y.Z.zip
# Rename .zip → .xpi
```

### Run dengan auto-reload (dev)
```bash
web-ext run --firefox <path-to-firefox-binary> --browser-console
```

### Test
```bash
# Syntax check semua JS
find . -name '*.js' -exec node --check {} \;

# Validasi import/export resolve
node /path/to/validate-addon.js
```

---

## ⚠️ Known Limitations

- Selector AI tool bisa berubah saat situs update. Kalau inject gagal, fallback otomatis ke clipboard.
- Snapshot hanya teks (gambar, file attachment, code block diformat diabaikan).
- Maks 50 pesan terakhir per snapshot, maks 10KB body.
- Firefox Sync limit 100KB/key → chunking 90KB untuk vault besar.
- Screenshot "Seluruh Halaman" tidak menangkap posisi fixed/sticky dengan sempurna (heading yang menempel saat scroll bisa ter-duplikasi).
- Screenshot halaman yang butuh login mungkin gagal capture bagian yang belum di-render (lazy-load).
- Capture tidak bisa dipanggil di halaman `about:`, `chrome:`, `moz-extension:`.
- Volume booster tidak bisa boost audio cross-origin/DRM-protected (fallback ke native volume, lower only).

---

## 🗺️ Roadmap

- [ ] Domain tier 2: Perplexity, Copilot, Mistral, Doubao, ChatGLM, Yiyan, Yuanbao
- [ ] Smart suggestions (saran konteks berdasarkan kata di textarea)
- [ ] Bundle editor visual (drag-drop urutan)
- [ ] Sidebar pindah posisi (kiri/kanan)
- [ ] Auto-update selector dari remote config (GitHub raw JSON)
- [ ] Opsi summary AI untuk snapshot
- [ ] Mobile-friendly responsive untuk sidebar sangat sempit (<280px)
- [ ] Integrasi dengan browser sync cloud lain (Google Drive, Dropbox) untuk backup

---

## 🤝 Contributing

Kontribusi welcome! Untuk bug report atau feature request, silakan buat [Issue](../../issues).

### Cara kontribusi
1. Fork repo ini
2. Buat branch: `git checkout -b feature/nama-fitur`
3. Commit perubahan: `git commit -m 'Add: nama fitur'`
4. Push: `git push origin feature/nama-fitur`
5. Buat Pull Request

### Code style
- 2-space indentation
- Komentar dalam Bahasa Indonesia (sesuai target user)
- Tidak ada dependency eksternal — semua pakai Web API native
- Test manual via `web-ext run` sebelum submit PR

---

## 📜 Lisensi

**MIT** — bebas pakai, modifikasi, distribusi. Lihat [LICENSE](./LICENSE).

### Attribution
RecallFox terinspirasi dari beberapa project open-source:
- [clear-cache](https://github.com/TenSoja/clear-cache) (MIT) — inspirasi fitur Clear Cache
- FireShot — inspirasi UX screenshot pipeline
- Aladhan API — sumber data waktu shalat
- Muhammadiyah — metode perhitungan waktu shalat (Munas Tarjih 2020)

---

## 👨‍💻 Author

**agungkesmas** — [GitHub](https://github.com/agungkesmas)

Dibuat untuk produktivitas kerja sehari-hari dengan AI tools + kepatuhan ibadah Muslim Indonesia.

---

## 🙏 Acknowledgments

- **Muhammadiyah** — metode waktu shalat (Fajr −18°, Isha −18°)
- **Aladhan API** — data waktu shalat gratis
- **OpenStreetMap Nominatim** — geocoding gratis
- **Mozilla** — Firefox WebExtension API yang powerful
- **Groq** — free tier AI inference yang generous
- Semua user yang sudah kasih feedback di Log Troubleshooting
