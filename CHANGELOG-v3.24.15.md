# CHANGELOG v3.24.15 — Firefox

Tanggal: 2026-09-10

## 1. Upload ⏳ Sementara: 100MB → 1GB (batas maksimal litterbox)

Permintaan user: "maksimalkan saja litterbox sampe ke batas maksimal uploadnya."

- Host sementara (litterbox.catbox.moe) menerima s.d. **1GB** per file di sisi server
  (terkonfirmasi via docs API + FAQ Catbox).
- `lib/file-kinds.js`: `MAX_TEMP_UPLOAD_BYTES = 1024*1024*1024` (1GB).
  Database tetap 10MB (aman kuota Supabase free), teks tetap 2MB.
- `popup/popup.js`: validasi dua lapis + copy UI diperbarui
  (sheet-note, dropzone, destNote, toast pick/save → "1GB").
- `test/file-kinds.test.mjs`: asersi diperbarui → 56/56 lolos.
- `manifest.json` → 3.24.15.

Catatan: file 1GB butuh waktu upload lama — biarkan popup terbuka sampai selesai.
