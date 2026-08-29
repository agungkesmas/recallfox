# Changelog — RecallFox v3.22.3-firefox (Fix 4 floating button rusak + port base Chrome)

> **Base:** v3.22.2-firefox (36eecc0) · **Branch:** main
> **Tanggal:** 2026-08-29

## 🎯 Ringkasan

Floating button Firefox yang rusak dibenerin dengan **porting penuh dari versi
Chrome v3.22.3 yang sudah diperbaiki dulu** (base parity). Tambahan perbaikan
khusus Firefox: pola respons background message yang selama ini salah.

## 🐞 Fix 1 — Floater 4 tombol balik & semua klik jalan

**Root cause di v3.22.2-firefox:**
1. Tombol 📸 (screenshot) **dihapus** dari floater — tinggal 3 tombol, tidak
   paritas dengan Chrome (4 tombol).
2. Klik hanya mengandalkan jalur `pointerup` — di Firefox, interaksi
   `setPointerCapture` bisa me-retarget/hilangkan event sehingga klik tidak
   terproses (tombol terasa mati).
3. Background memakai pola Chrome (`return true` + `sendResponse`) — di Firefox
   pola itu TIDAK menahan channel respons: sender selalu menerima `undefined`,
   sehingga keputusan fallback berbasis respons salah.

**Fix (port base Chrome v3.22.3):**
- `content/sidebar-cs.js` diganti **identik dengan versi Chrome** (parity penuh):
  4 tombol 🦊 📸 📝 🧾, 1x klik 🦊 = toggle popout DOM sidebar langsung, aksi
  terpusat `performAction()` + dedupe 400ms, **native click fallback** untuk
  semua tombol (safety net khusus efektif di Firefox), note/tape berbasis respons.
- `content/overlay.js` sinkron dengan Chrome: dock FAB "sc" ke-5 dibasmi
  (`maybeInjectOverlay` jadi cleanup-only).
- `sidebar/sidebar.js`, `lib/float-sync.js`, `notes-cs.js`, `tape-cs.js` tidak
  berubah (sudah identik antar repo sejak sebelumnya).

## 🔌 Fix 2 — Background: pola respons Promise Firefox

Handler floater dikonversi ke pola yang benar untuk Firefox (return Promise,
bukan `return true` + `sendResponse`):
- `RF_OPEN_NOTE` → sekarang mengembalikan `{ok:true/false}` ke sender.
- `RF_OPEN_TAPE` → idem.
- `RF_FORWARD_TO_ACTIVE_TAB` → idem + handler **dobel** (v3.21.16 & v3.20.10)
  digabung jadi satu (forward extra fields + inject/retry).

Dengan respons yang benar, fallback berbasis `res.ok` di sidebar-cs.js kini
putus-putusnya akurat: fallback hanya jalan kalau benar-benar gagal.

## ⚙️ Settings

Baris setting mati dihapus dari UI: "Tombol mengambang di halaman AI"
(`rf-set-floating`) dan "Tombol overlay screenshot di semua halaman"
(`rf-set-overlay`) — tombol yang dulu dikontrolnya sudah tidak ada. Blok
broadcast `TOGGLE_OVERLAY` di settings.js ikut dibersihkan.

## ✅ Verifikasi

- Audit statis 80/80 PASS — `scripts/audit_recallfox.py`.
- Simulasi DOM 14/14 PASS (dieksekusi terhadap file Firefox yang sama dengan
  Chrome karena parity penuh): 1x klik buka popout, klik lagi tutup,
  double-click anti-flicker, 📸/📝/🧾 terkirim, drag ≠ klik, native click
  fallback jalan — `scripts/simulate_floater.js`.

## 📁 File berubah

| File | Perubahan |
|---|---|
| `content/sidebar-cs.js` | Port penuh dari Chrome v3.22.3 (4 tombol, klik 1x toggle popout, hardening klik) |
| `content/overlay.js` | Sinkron Chrome — dock FAB ke-5 dibasmi |
| `background.js` | RF_OPEN_NOTE/RF_OPEN_TAPE/RF_FORWARD_TO_ACTIVE_TAB → pola Promise; handler dobel digabung |
| `settings/settings.html` | Hapus 2 baris setting mati |
| `settings/settings.js` | Sinkron Chrome — mapping + blok overlayToggle dihapus |
| `manifest.json` | 3.22.2 → 3.22.3 |
