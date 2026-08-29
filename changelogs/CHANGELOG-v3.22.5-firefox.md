# CHANGELOG v3.22.5-firefox

Tanggal: 2026-08-30

## Root cause tombol floating mati (fix dari simulasi runtime Firefox ketat)

Simulator end-to-end (background event page + content script + message bus
dengan semantik Firefox asli) mereproduksi persis keluhan user: klik 📸 tidak
pernah memunculkan modal, termasuk lewat sidebar — error
"Could not establish connection. Receiving end does not exist."

### FIX-1 (FATAL): `browser.contextMenus` — namespace Chrome-first
- Firefox dengan permission "menus" HANYA menjamin `browser.menus`;
  `browser.contextMenus` adalah alias yang tidak selalu ada.
- `background.js` mengakses `browser.contextMenus.onClicked.addListener(...)`
  di TOP-LEVEL → TypeError → SELURUH background mati sebelum listener
  onMessage terdaftar → SEMUA tombol floating mati.
- Solusi: alias aman `RF_MENUS = browser.menus || browser.contextMenus`
  (33 titik pemakaian diganti) + guard `if (RF_MENUS && RF_MENUS.onShown)`.

### FIX-2 (FATAL): `browser.storage.sync.onChanged` — API Chrome-only
- Firefox tidak punya `storage.<area>.onChanged`; hanya `storage.onChanged`
  global. `lib/storage.js` (dan bundle classic-nya) memakai
  `storage.sync.onChanged` → dipanggil top-level via `onSyncChange()` →
  TypeError di tengah load background.
- Solusi: `browser.storage.onChanged.addListener` + filter `area === 'sync'`.

### FIX-3 (FATAL): tabrakan deklarasi antar classic bundle di shared world
- Semua content script satu extension berbagi SATU isolated world per frame.
  `float-sync.classic.js` dimuat dua kali (grup tape-cs & notes-cs) →
  "Identifier 'NOTE_FLOAT_KEY' has already been declared" → SELURUH grup
  notes-cs gagal load → recallnote mati.
- `tape.classic.js` & `notes.classic.js` juga sama-sama mendeklarasikan
  `SESSION_KEY`, `PIN_KEY`, `loadSession`, `saveSession`, dll → silent
  override lintas bundle (risiko data silang).
- Solusi: (a) float-sync hanya dimuat di grup tape-cs (urutan manifest
  menjamin grup notes-cs mendapat global-nya); (b) keempat classic bundle
  dibungkus IIFE idempoten; (c) tape-cs/notes-cs memakai alias eksplisit
  (`RFT_*` / `RFN_*`) dari namespace `__RF_LIB_*`, bukan identifier telanjang.

### FIX-4 (defensif): registrasi listener top-level di-guard `rfSafeListen()`
- `menus.onClicked`, `onSyncChange`, `storage.onChanged`, `tabs.onUpdated`
  (Content Guardian), `startAutoDiscardChecker`, `startProactiveTokenRefresh`
  dibungkus guard — satu error registrasi TIDAK BOLEH lagi mematikan
  background secara keseluruhan.

## Hasil verifikasi (simulator Firefox ketat, 10/10 lolos)
1. Background event page load tanpa error (dengan & tanpa alias contextMenus)
2. runtime.onMessage terdaftar; GET_VAULT terjawab (sidebar hidup)
3. Klik 📸 floater → CAPTURE_SCREENSHOT → {ok:true, deferred:true}
4. Modal pilih mode screenshot muncul (3 pilihan)
5. Pilih "Bagian terlihat" → pipeline capture penuh (capture.js →
   CAPTURE_VISIBLE_TAB → captureVisibleTab) → respons {ok:true, dataUrl}
6. Modal edit screenshot muncul dengan preview
7. recallnote → floating note UI muncul (shadow DOM)
8. recalltape → floating tape UI muncul (shadow DOM)
9. Semua JS lolos node --check (63 file)
10. Regresi: build v3.22.4 lama terbukti GAGAL di simulator pada titik yang
    sama dengan gejala user.
