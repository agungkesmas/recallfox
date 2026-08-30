# CHANGELOG v3.22.7-firefox

Tanggal: 2026-08-30

## Ringkasan
Hardening paritas bersama v3.22.7-chrome. Fungsi screenshot/note/tape Firefox
v3.22.6 sudah normal; versi ini menerapkan lapisan perlindungan yang sama agar
kelas bug "modal bangkit kembali setelah ditutup" (yang ditemukan di Chrome)
tidak mungkin terjadi di Firefox juga. Tidak ada perubahan perilaku yang terlihat
user selain modal kini dijamin tetap ter closed.

## Latar belakang
Di Chrome ditemukan **echo loop broadcast**: `background.js` mem-broadcast
`SHOW_NOTE`/`SHOW_TAPE` pada setiap penulisan float state `isOpen:true`, sementara
`show()` menulis ulang float state di akhir show() — broadcast in-flight yang
mendarat setelah user menutup modal membangkitkannya kembali beberapa detik
kemudian. Firefox tidak menunjukkan gejala, namun pola kode yang sama berisiko;
v3.22.7 memperketatnya di kedua browser sekaligus.

## Perubahan
- **background.js**: broadcast SHOW_NOTE/SHOW_TAPE kini hanya pada **transisi
  tertutup → terbuka** (bukan pada setiap penulisan float state).
- **content/notes-cs.js + content/tape-cs.js**: guard `userHiddenAt` — broadcast
  `SHOW_NOTE`/`SHOW_TAPE` yang datang < 5 detik setelah user menutup modal
  diabaikan; `show()` mereset guard, `hide()` mencatat waktu.
- **content/sidebar-cs.js**: fallback `RF_FORWARD_TO_ACTIVE_TAB` hanya pada
  kegagalan eksplisit (`ok:false`) — respons tidak jelas tidak lagi memicu
  pengiriman dobel.

## Validasi
- `node --check` seluruh JS: 0 error.
- Simulator runtime Firefox (`ff_sim.js`): **10/10 PASS** — alur end-to-end
  📸 → modal pilih mode → modal edit → recallnote → recalltape tetap jalan.
- Simulator echo (`echo_sim2.js`): broadcast basi diabaikan, 0 modal bangkit.
