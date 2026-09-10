# CHANGELOG v3.24.16 — Firefox

Tanggal: 2026-09-10

## Upload ⏳ Sementara gagal `http_500` intermiten — TAMBAH RETRY OTOMATIS (laporan user)

**Laporan:** upload file sementara (litterbox) sering gagal `http_500` di Firefox & Chrome,
padahal file valid (contoh: `recallfox-desktop-finder.html`, 137,5 KB).

**Investigasi:**
- Reproduksi langsung ke `litterbox.catbox.moe` via curl: file kecil (html/txt) 200 OK,
  file 137 KB persis profil laporan diulang 6x semuanya 200 OK — server sehat saat dites.
- Kesimpulan: **HTTP 500 intermiten sisi server** (litterbox terkenal akan ini — tercatat di
  status page pihak ketiga; tool CLI pihak ketiga pun menulis "Service error 500, try again
  later"; 1x 500 transien juga kena saat verifikasi v3.24.14). Request kita valid.
- Akar di kode: `uploadToTempHost` hanya **1x percobaan** — sekali kena 500 transien,
  user langsung dapat toast gagal.

**Perbaikan (`lib/temp-upload.js`):**
- Retry otomatis maks 3x untuk **network throw + HTTP 5xx**, jeda 1s/2s/4s (FormData dirakit
  ulang tiap percobaan). TIDAK di-retry: 4xx & respons non-URL (validasi — retry tak membantu).
- Hasil bawa `attempts`; toast gagal kini sebut "server sibuk — sudah dicoba Nx" bila retry terjadi.
- Test: 43/43 (4 asersi baru: retry-3x, flaky 500,500,200 → sukses, 400 tanpa retry, urutan backoff).

**Catatan:** kalau 3x masih 500 berarti server memang down — tunggu menit lalu coba lagi,
atau pakai tujuan Database.
