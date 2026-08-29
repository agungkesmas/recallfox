# CHANGELOG v3.22.6-firefox

Tanggal: 2026-08-30

## Ringkasan
Versi polishing UI berdasarkan feedback user. Firefox v3.22.5 sudah berjalan sempurna;
v3.22.6 memperjelas dua hal yang membingungkan: (1) checkbox mode batch yang mirip
checkbox "tugas selesai", dan (2) tombol-tombol yang kurang jelas tanpa penjelasan hover.

## 1. Pembeda visual checkbox — batch select vs tugas selesai
**Masalah:** di daftar catatan, checkbox "pilih massal (batch)" dan checkbox
"tugas selesai" tampil IDENTIK (native 16px, accent-color sama) sehingga user
sulit membedakan fungsi keduanya.

**Solusi (pembeda bentuk + warna):**
- **Batch select** → **KOTAK indigo** (konvensi seleksi): border indigo, saat
  dipilih terisi indigo dengan centang putih, hover memunculkan halo indigo lembut.
- **Tugas selesai** → **LINGKARAN hijau** (konvensi done): border hijau, saat
  selesai terisi hijau dengan centang putih, hover halo hijau lembut.
- Berlaku konsisten untuk: `vault-batch-check`, `note-batch-check`,
  `note-done-check`, dan **checkbox subtask** di editor catatan (kini ikut
  bergaya lingkaran hijau — semantiknya sama dengan tugas selesai).
- Bentuk + warna sekaligus = pembeda tetap terbaca walau warna sulit
  dibedakan (aksesoris aksesibilitas).

## 2. Tooltip hover untuk seluruh tombol yang kurang jelas
Audit menyeluruh elemen klikable (popup.js 12rb+ baris, popup.html, content script).
Tombol berlabel teks (Simpan/Batal/Arsipkan) memang sudah jelas; yang ditambah
penjelasan hover adalah yang benar-benar kurang jelas:

| Elemen | Tooltip |
|---|---|
| 🔴 P1 (editor) | P1 — Darurat & penting: kerjakan hari ini (merah) |
| 🟠 P2 (editor) | P2 — Penting, belum darurat: jadwalkan (oranye) |
| 🔵 P3 (editor) | P3 — Mendesak tapi kurang penting: kerjakan cepat (biru) |
| ⚪ P4 (editor) | P4 — Prioritas biasa: kapan saja (abu-abu). Default tanpa prioritas |
| Chip P1–P4 (list) | Filter catatan prioritas P1..P4 |
| Checkbox batch (vault & catatan) | Pilih item/catatan (mode batch) — untuk arsip/hapus/copy massal |
| Chip Semua / Aktif / Selesai | Filter status selesai |
| 📦 Arsipkan (batch bar catatan) | Arsipkan semua catatan terpilih (bisa di-restore dari chip Arsip) |
| 🗑️ Hapus (batch bar catatan) | Hapus permanen semua catatan terpilih |
| Batal (batch bar catatan) | Matikan mode pilih (batch) |
| ✕ hapus subtask | Hapus subtask |
| Checkbox subtask | Tandai subtask selesai |
| 🗑 prompt cepat | Hapus prompt cepat |
| ✕ tutup modal "Lanjutkan di AI Lain" | Tutup |

## Kompatibilitas
- Perubahan murni presentasional (CSS class + atribut title) — tidak mengubah
  handler, data, maupun perilaku tombol.
- Patch identik diterapkan juga di versi Chrome (v3.22.6-chrome) agar UI parity.

## Validasi
- `node --check` 63 file JS: 0 error.
- Simulator runtime Firefox ketat (ff_sim): **10/10 PASS** — floater 📸 → modal
  pilih mode → modal edit, recallnote, recalltape, popout sidebar semua jalan.
