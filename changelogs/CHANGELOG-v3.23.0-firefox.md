# CHANGELOG — Multi-Instance Floating Note/Tape v3.23.0 (Firefox)

## Fitur baru (permintaan user)

1. **Tombol 📝/🧾 di pill mengambang (4 tombol) = LEMBAR BARU.** Setiap tekan
   membuka RecallNote/RecallTape baru yang kosong — bukan membuka lembar lama.
   Bisa membuka 2-3+ lembar bersamaan.
2. **Tombol ＋ di header setiap floater** — buat lembar baru langsung dari
   floating note/tape, tanpa masuk ke sidebar.
3. **Tombol ▾ gulung (collapse)** — floater bisa digulung jadi bar judul saja
   dan dibuka lagi lewat tombol yang sama. State tersimpan per-lembar.
4. **Tombol ✕ tutup** — tutup satu lembar saja (sebelumnya tidak ada cara
   eksplisit menutup floater). Isi lembar tetap tersimpan.
5. **Ukuran ringkas default** — note 300px, tape 320px (sebelumnya 360/340px,
   min-height lebih pendek) supaya 2-3 floater muat seraya. Tetap bisa
   di-resize; ukuran hasil resize diingat per-lembar.
6. **Auto merapihkan diri** — lembar-lembar tanpa posisi pilihan user ditata
   bertumpuk rapi: note dari tepi KANAN, tape dari tepi KIRI (tidak saling
   tabrak); melebihi tinggi layar otomatis wrap ke kolom baru. Floater yang
   pernah digeser user tidak diganggu.

## Arsitektur

- State baru global: `noteInstances` / `tapeInstances` di storage.local — array
  per-lembar `{id, text, open, collapsed, x, y, w, h, vaultNoteId, createdAt}`.
- **Migrasi otomatis** dari model lama (`notesSession` + `floatNoteState`, dan
  `tapeSession` + `floatTapeState`) saat key baru belum ada — catatan lama
  tidak hilang. `floatNoteState`/`floatTapeState` dibersihkan setelah migrasi.
- Mirror kompat: instance#1 tetap di-mirror ke `notesSession`/`tapeSession`.
- Sinkron antar tab real-time dipertahankan & diperluas per-lembar: buka/tutup/
  ketik/collapse di satu tab mengikuti ke tab lain via `storage.onChanged`
  (reconcile idempoten, anti-loop, guard anti-timpa saat textarea fokus).
- Link vault note (⧉) per-instance: klik ⧉ pada note yang sama memakai ulang
  instance yang sudah terbuka (tidak dobel), autosave vault tetap nyambung.
- `ADD_TO_NOTE`/`ADD_TO_TAPE` (menu konteks) menambah ke lembar terakhir yang
  terbuka; kalau tidak ada, membuat lembar baru berisi teks itu.
- Pesan `OPEN_NOTE`/`OPEN_TAPE` kini berarti "lembar baru" (dipakai pill,
  header sidebar, CustomEvent fallback) — routing v3.22.9 tidak berubah.

## Logika yang dipertahankan 100%

- Kalkulator RecallTape: auto-format, Enter = hitung, percent, suffix k/rb/jt,
  double-copy hasil, print resi 80mm, save ke catatan.
- RecallNote: autosave + word count, print, copy, save ke vault, pin, drag,
  hover transparan, tema gelap/terang.
- Guard SHOW_* basi 5s, sendResponse wajib (Firefox BUG-3), CustomEvent
  'rf-open-note'/'rf-open-tape', mirror vault→notesSession (v3.22.8),
  routing anti-mati tombol (v3.22.9), posisi pill kiri-tengah (v3.22.9).

## Validasi (semua deterministik, tanpa browser)

- `node --check` seluruh file JS kedua repo = 0 error.
- SIM BARU `multi_float_sim.js` 28/28 PASS kedua repo (3 lembar + auto-arrange,
  ＋/▾/✕, ADD_TO_*, reuse vault, migrasi, idempoten, tape kalkulasi Enter).
- `float_sync_sim.js` (ditulis ulang utk model instance) 11/11 PASS kedua repo.
- `vault_float_sim.js` 36/36 PASS kedua repo (routing ⧉ v3.22.9 tidak rusak).
- `ff_sim` 10/10 · `chrome_sw_sim` 14/14 · `echo_sim2` bersih (anti-echo v3.22.7
  tetap hidup — broadcast hanya transisi tertutup→terbuka).
