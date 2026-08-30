# CHANGELOG — Vault ⧉ / Tombol Mengambang v3.22.9 (Firefox)

## Bug yang diperbaiki (laporan user + screenshot sidebar CATATAN)

1. **Tombol ⧉ "kotak mengambang" pada catatan eksisting tidak bisa dipencet di
   Firefox** — klik tidak menghasilkan apa pun (tanpa toast, tanpa note mengambang).
2. **Tulisan `<div>` literal** muncul di isi catatan (floating note / salinan raw) —
   di Chrome dan berpotensi juga Firefox.
3. **Pill 4 tombol mengambang (🦊 📸 📝 🧾)** diminta kembali ke posisi
   **KIRI TENGAH** layar seperti pada awal install — bukan kanan-bawah.

## Akar masalah

1. **Pesan `RF_OPEN_NOTE_VAULT` tidak pernah punya penerima.** Di sidebar popout
   (iframe), jalur `browser.tabs` tidak selalu tersedia; fallback yang ada hanya
   `window.parent.postMessage({type:'RF_OPEN_NOTE_VAULT'})` — dan tidak ada satu
   pun listener (popup maupun sidebar-cs.js) yang menangani tipe pesan ini →
   klik ⧉ mati total. Masalah serupa menimpa tombol 📝 header (`RF_OPEN_NOTE`
   via postMessage) di popout iframe.
2. **Editor catatan memakai `contenteditable`.** Browser membungkus setiap baris
   ketikan dalam `<div>` ("div soup"). Body disimpan apa adanya (`ta.innerHTML`),
   lalu floating note (textarea plain text) menampilkan tag-nya sebagai tulisan
   `<div>` literal.
3. **Default posisi pill** sejak base v3.21.2 adalah `bottom:24px; right:24px`.

## Fix

- **FIX-1 — Routing ⧉/📝 anti-mati (popup/popup.js, content/sidebar-cs.js,
  background.js):**
  - Jalur primer tombol ⧉ kini `RF_FORWARD_TO_ACTIVE_TAB` via `browser.runtime`
    — API yang **selalu tersedia** di semua konteks extension page (popup window,
    sidebar native, iframe popout). Background meneruskan ke tab aktif dan
    otomatis meng-inject `content/notes-cs.js` bila belum ada.
  - `RF_FORWARD_TO_ACTIVE_TAB` kini meneruskan `noteId` (link autosave vault) dan
    memetakan `OPEN_NOTE_VAULT` → `notes-cs.js` untuk inject fallback.
  - `sidebar-cs.js` menambah handler postMessage `RF_OPEN_NOTE` & 
    `RF_OPEN_NOTE_VAULT` (fallback terakhir, tetap dipertahankan).
  - Jalur lama (tabs langsung, inject manual, popup PDF) tetap utuh sebagai
    fallback berlapis.
  - `popup.html?floatNote=<id>` kini benar-benar ditangani (`openNoteEditor`) —
    sebelumnya jendela popup PDF terbuka tapi kosong.
- **FIX-3 — Anti "div soup" (popup/popup.js):**
  - `noteBodyToPlain()` — konversi body HTML → plain text dengan baris terjaga
    (block-aware). Dipakai saat membuka note vault ke floater, sehingga catatan
    LAMA yang sudah tercemar tag juga tampil bersih di floating note.
  - `normalizeEditorHtml()` pada autosave editor — ketikan biasa (hanya wrapper
    `<div>/<br>`) kini disimpan sebagai **plain text** dengan `\n`; catatan dengan
    formatting nyata (paste tabel, bold, heading) tetap disimpan sebagai HTML.
- **FIX-4 — Posisi pill kiri tengah (content/sidebar-cs.js):**
  - Default baru: `left:14px`, vertikal di tengah viewport.
  - Migrasi: posisi tersimpan format lama (tanpa penanda versi) ikut dipindah ke
    kiri tengah. Setelah rilis ini, hasil drag user ditandai `v:2` dan dihormati
    apa adanya — bebas dipindah lagi.

## Validasi (semua deterministik, tanpa browser)

- `node --check` seluruh file JS kedua repo = 0 error.
- `ff_sim` 10/10 PASS (alur Firefox end-to-end, termasuk screenshot & note/tape).
- `chrome_sw_sim` 14/14 PASS (paritas Chrome ServiceWorker).
- `float_sync_sim` 7/7 PASS kedua repo (sinkron antar tab v3.22.8 tidak rusak).
- `echo_sim2` bersih (fix modal v3.22.7 tidak kebangkitkan kembali).
- `vault_float_sim` (BARU, v3.22.9) 36/36 PASS kedua repo:
  klik ⧉ di iframe Firefox → note tampil dengan isi plain tanpa `<div>`;
  jalur popup/sidePanel; fallback background gagal; payload `noteId` +
  inject `notes-cs.js`; posisi kiri tengah + migrasi + hormati drag v2;
  handler postMessage 📝/⧉; param `floatNote`.

## Catatan

- Catatan lama yang bodinya sudah berisi HTML **tidak diubah massal di storage**
  (aman). Ia otomatis tampil bersih di floating note (via `noteBodyToPlain`), dan
  menjadi plain text murni begitu user mengeditnya (autosave menormalisasi).
- Tidak ada tombol/fitur lain yang disentuh. Perubahan hanya pada 3 file per repo:
  `popup/popup.js`, `content/sidebar-cs.js`, `background.js` (+ versi & changelog).
