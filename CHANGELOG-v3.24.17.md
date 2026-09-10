# CHANGELOG v3.24.17 — Firefox

Tanggal: 2026-09-10

## Upload ⏳ Sementara tetap `http_500` walau sudah retry — TANGKAP PESAN SERVER (laporan lanjutan)

**Laporan lanjutan:** retry 3x (v3.24.16) tetap gagal `http_500` untuk file
`STANDAR_TARIF_RS_MITRA_PLUMBON_CIREBON.zip` (45 KB).

**Investigasi (tidak bisa direproduksi = data penting):**
- File 45 KB .zip via curl → **200 OK** (URL litter.catbox.moe valid).
- Nama file persis + header `Origin: moz-extension://` / `chrome-extension://` → **200 OK**.
- Kesimpulan: bukan tipe file, bukan nama, bukan origin. Tersisa: (a) jendela outage
  server saat user mencoba, (b) isi spesifik file user, (c) rate-limit setelah
  percobaan berulang, (d) jaringan user. Semua tak bisa dibuktikan tanpa info server.

**Perubahan (`lib/temp-upload.js`):**
- Saat HTTP non-2xx, **body respons ikut dibaca** (best-effort, 160 char) dan ditempel
  ke error: `http_500: <pesan server>`. Kegagalan berikutnya langsung menyebut
  penyebabnya (mis. rate-limit) alih-alih angka buta.
- Test: 44/44.

**Jawaban atas dua pertanyaan user:**
- *Ganti situs?* — Diteliti: 0x0.st (tanpa CORS browser + retensi tak cocok),
  tmpfiles.org (maks 100MB, maks 48 jam), tmp0.cc (E2E → AI chat tak bisa baca).
  **Litterbox tetap paling pas** (1GB, CORS \*, URL mentah, 1–72 jam). Tidak ganti.
- *Maksimalkan litterbox?* — **Sudah mentok** (1GB = batas server). Gagalnya file
  45 KB membuktikan ini bukan soal limit.
