# CHANGELOG v3.24.18 — Firefox

Tanggal: 2026-09-11

## Upload File: 3 tujuan + batas Sementara 100MB (permintaan user)

**Permintaan:** (1) jadikan maksimal 100MB lagi (turun dari 1GB) agar minim error,
(2) tambah opsi ketiga — upload manual ke daftar situs temporari (klik buka tab baru),
lalu simpan manual ke vault dengan TTL **3 hari** di vault (terlepas dari masa simpan situs).

**Perubahan:**
- `lib/file-kinds.js`: `MAX_TEMP_UPLOAD_BYTES` **1GB → 100MB**.
- `lib/temp-upload.js`: tambah `TEMP_HOST_MANUAL='manual'`, `MANUAL_TEMP_DURATION='72h'`,
  `MANUAL_SITES` (litterbox, catbox, file.io, 0x0.st, gofile, tmpfiles — semua bisa diklik buka tab baru).
- `popup/popup.js` `saveFileUploadSheet`: **3 tombol** `☁️ Database | ⏳ Sementara | 🔗 Manual`.
  - *Sementara*: litterbox `100MB`, dropzone + durasi `1h/12h/24h/72h`, retry `3×` tetap ada.
  - *Manual*: panel baru — daftar situs (klik → tab baru), input `URL https://` + `Nama file` opsional (auto dari URL),
    validasi `https://`, deteksi `kind/mime` dari nama, `body=''` (file hidup di URL luar).
    Payload `tempHost='manual'`, `tempUrl`, `tempExpiresAt=now+72h` → vault hilang otomatis **3 hari** via `cleanupExpiredTempItems` yang sama (tanpa peduli situs hapus kapan).
  - `addItem` manual langsung tanpa `uploadToTempHost`.

**Validasi:** `file-kinds` 56/56, `temp-upload` 44/44, `node --check` OK.
