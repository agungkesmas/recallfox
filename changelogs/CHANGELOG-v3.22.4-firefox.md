# RecallFox v3.22.4-firefox — Perbaikan Tombol Floating (Base: Chrome v3.22.3)

Tanggal: 2026-08-30
Base: recallfox-chrome v3.22.3 (tombol floating normal) + adaptasi Firefox yang sudah
benar dari recallfox v3.22.3-firefox (sidebarAction, pola Promise handler).

## Akar Masalah (kenapa tombol mati di Firefox)

### BUG-1 (primer) — Background tidak pernah jalan di Firefox
Firefox **tidak mendukung** `background "type": "module"` (Bugzilla 1806731).
`background.js` memakai static ESM `import { ... } from './lib/...'` sehingga
dimuat sebagai classic script → **SyntaxError → seluruh background gagal dimuat**.
Akibatnya SEMUA pesan dari content script (`CAPTURE_SCREENSHOT`, `RF_OPEN_NOTE`,
`RF_OPEN_TAPE`, `RF_FORWARD_TO_ACTIVE_TAB`) gagal dengan "Could not establish
connection" → tombol 📸 📝 🧾 mati total. Tombol 🦊 (popout DOM sidebar) tetap
hidup karena murni DOM content script + iframe — persis sesuai laporan.

**Fix:**
- 6 dependensi statis background (storage, crypto, assistant, contentguard,
  elementblocker, gdrive-sync) di-bundel menjadi classic scripts di
  `lib/classic/*.classic.js` dan dimuat lebih dulu via `background.scripts`.
- 6 static import dihapus dari `background.js`.
- 9 dynamic `import('./lib/storage.js')` di-rewrite menjadi referensi global
  (menghindari dual-instance state).
- Dynamic `import()` relatif di dalam lib classic di-rewrite `./` → `../`
  (storage.classic 10 site, ai-detect.classic 1 site).

### BUG-2 — Dynamic import() dinonaktifkan untuk content script Firefox
`notes-cs.js` / `tape-cs.js` / `ai-resolvers.js` memulai dengan
`await import(browser.runtime.getURL('lib/...'))` — di Firefox ini dilempar
sebagai error (Bugzilla 1536094) → script abort → listener `OPEN_NOTE` /
`OPEN_TAPE` tidak pernah terdaftar → tombol 📝 🧾 mati.

**Fix:** lib versi classic (notes, tape, float-sync, ai-detect) di-preload via
manifest `content_scripts` dan mendaftarkan global
(`globalThis.__RF_LIB_*__` + `window.__RF_LIB_*__`). Content script mencoba
dynamic import dulu (jalur Chrome), lalu fallback ke global classic.

### BUG-3 — Protokol respons: Firefox me-reject pesan tanpa balasan
Firefox menutup channel dengan rejection "Message channel closed without a
response" jika listener tab tidak memanggil `sendResponse`. Handler yang tidak
membalas: `overlay.js` (TRIGGER_CAPTURE_FROM_POPUP), `sidebar-cs.js`
(TOGGLE/OPEN/CLOSE_SIDEBAR_IN_PAGE), `notes-cs.js`/`tape-cs.js` (OPEN_NOTE,
OPEN_TAPE, ADD_TO_*, SHOW_*). Akibatnya background masuk jalur error
(re-inject + retry yang percuma) dan alur screenshot/note/tape tidak andal.

**Fix:** semua listener di atas kini membalas `sendResponse({ok:true})`.

### BUG-4 — Ikon & referensi file hilang
- `icons/icon-*.png` dirujuk ±25x untuk notifikasi tetapi file tidak ada di
  paket Firefox (SVG tidak didukung sebagai ikon notifikasi). → PNG ikon
  ditambahkan dari paket Chrome.
- `web_accessible_resources` mereferensi `lib/browser-polyfill.min.js` yang
  tidak ada → referensi dibuang (file polyfill memang tidak dipakai Firefox;
  `browser.*` native).

### BUG-5 — Fallback CustomEvent tanpa pendengar
`sidebar-cs.js` men-dispatch CustomEvent `rf-open-note` / `rf-open-tape`
sebagai fallback terakhir, tapi tidak ada yang mendengarkan. → listener
ditambahkan di notes-cs.js / tape-cs.js.

## Bonus dari Audit (orphan code)

- **SAVE_NOTE_TO_VAULT tidak punya handler** — tombol "Simpan ke Catatan" di
  RecallNote selalu gagal ("Gagal simpan") di v3.22.3 Chrome & Firefox.
  Handler kini diimplementasikan miror `SAVE_TAPE_TO_VAULT` memakai `addNote()`
  (grup "RecallNote").

## Isi perubahan (file)

| File | Perubahan |
|---|---|
| `manifest.json` | v3.22.4, background.scripts classic bundle, preload lib classic di content_scripts, WAR bersih |
| `background.js` | static import dihapus, 9 dynamic import storage → global, handler SAVE_NOTE_TO_VAULT |
| `lib/classic/*.classic.js` (baru, 10 file) | versi classic dari 10 lib (6 background + 4 content) |
| `content/notes-cs.js` | fallback global classic + sendResponse + CustomEvent rf-open-note |
| `content/tape-cs.js` | fallback global classic + sendResponse + CustomEvent rf-open-tape |
| `content/ai-resolvers.js` | fallback global classic untuk migrasi ai-detect |
| `content/sidebar-cs.js` | sendResponse untuk OPEN/CLOSE/TOGGLE_SIDEBAR_IN_PAGE |
| `content/overlay.js` | sendResponse untuk TRIGGER_CAPTURE_FROM_POPUP |
| `sidebar/sidebar.html`, `popup/popup.html`, `popup/viewer.html`, `settings/settings.html` | tag browser-polyfill dihapus |
| `icons/icon-*.png` | ditambahkan (16/32/48/96/128) untuk notifikasi |

Dibuang dari paket: `ff.zip` (artefak build), `lib/sidebar-compat.js` +
`popup/upload-window.*` (khusus sidePanel Chrome), `lib/browser-polyfill.min.js`
(tidak dipakai Firefox).

## Verifikasi

- `node --check` lolos untuk seluruh 176 file JS/JSON (classic & ESM sesuai konteks).
- Load-test bundle background (gabungan 6 lib classic + background.js) dieksekusi
  penuh tanpa error load-time — listener, context menu, alarm, sync terpasang.
- Cross-reference: 0 dangling reference, 0 message type tanpa handler.
- Kolisi nama top-level antar lib bundel: 0.
