# RINGKASAN-v3.22.0.md — Chat 29 Aug 2026

## Tujuan Chat
- Push bundle `v3.22.0` Upload File Binary ke GitHub (`recallfox` Firefox + `recallfox-chrome`)
- Jawab pertanyaan workspace vs git otak pusat → implementasi `AI-CONTEXT.md`

## Timeline

**Fetch & Verifikasi Bundle (16:59-17:00):**
- `~/Downloads/recallfox-v3.22.0.bundle` 1.1M, `recallfox-chrome-v3.22.0.bundle` 1.8M → `git bundle verify` OK
- Firefox: `feat/upload-all-files` `8b120cd`, tags `v3.22.0-firefox` `7c7902b`, `v3.22.0-stable` `4d5b3ce` — fast-forward `0 behind 15 ahead` dari `origin/main` `cc2bb46` (v3.21.11) → AMAN
- Chrome: `feat/upload-all-files` `ab6abea`, tags `96c4553`/`c2d6841` — DIVERGE: base `b6e64bc` (v3.21.25) ketinggalan `500bb2e` (v3.21.26 Floater 1x/2x) → TIDAK AMAN jika push mentah

**Push Firefox (17:05):**
- `git checkout -B feat/upload-all-files bundle/feat/upload-all-files` → `git push origin feat/upload-all-files v3.22.0-firefox v3.22.0-stable` → sukses

**Fix & Push Chrome (17:05-17:10):**
- `git checkout -B feat/upload-all-files bundle/feat/upload-all-files` + `git rebase origin/main`
- Conflict `manifest.json` version `3.21.26` vs `3.22.0` → resolve `3.22.0`, `GIT_EDITOR=true rebase --continue`
- Hasil rebase: `a5ef6b7` (v3.22.0 binary) + `9f89572` (docs RLS) di atas `500bb2e` → `git tag -d` + recreate `v3.22.0-chrome` `87ea9f6` + `v3.22.0-stable` `e238a5d` → `git push --force-with-lease` sukses (sempat duplicate pick `ab6abea` di todo, di-fix manual)

**Implementasi Git Otak Pusat (17:35):**
- User: "boleh broh" → bikin `AI-CONTEXT.md` di kedua repo + `docs/ai-memory/CARA-KERJA.md` + file ini
- Tujuan: new chat cukup `clone + cat AI-CONTEXT.md` → konteks balik 100% (public repo, read tanpa token)

## Hasil Akhir (29 Aug 2026 17:35)

| Repo | Branch | Commit | Tag |
|------|--------|--------|-----|
| `recallfox` | `feat/upload-all-files` | `8b120cd` | `v3.22.0-firefox` `7c7902b`, `v3.22.0-stable` `4d5b3ce` |
| `recallfox-chrome` | `feat/upload-all-files` | `9f89572` | `v3.22.0-chrome` `87ea9f6`, `v3.22.0-stable` `e238a5d` |

- `git merge-base --is-ancestor origin/main HEAD` OK kedua repo
- Chrome `manifest.json` tetap `service_worker type:module`, `background.js` `RF_OPEN_REAL_SIDEBAR` x3

## Detail v3.22.0

- **Fitur:** Upload file binary PDF/Office/gambar 10MB + whitelist teks programming (~60 ekstensi)
- **File baru:** `lib/file-kinds.js` (258), `test/file-kinds.test.mjs`, `test/storage-binary.test.mjs`, `docs/fix-documents-rls.sql` (82), `changelogs/CHANGELOG-v3.22.0.md` (79)
- **Ubah:** `lib/storage.js` (blob `rf_file_{id}`), `lib/supabase-sync.js` (`_resolveFileBlob`), `popup/popup.js` (296), `manifest.json` version bump
- **RLS:** policy BACA PUBLIK `documents` untuk AI fetch URL tanpa login, idempotent, verifikasi Postgres 17 lokal

## Pelajaran

- Selalu `verify bundle + ls-remote + rev-list --left-right` sebelum push — Chrome diverge 1 commit hampir bikin regresi Floater 1x/2x
- Rebase Chrome butuh resolve manifest version + hati-hati duplicate pick di `rebase-todo`
- Filosofi `template-project` (git otak pusat) terbukti: bundle + `AI-CONTEXT.md` lebih tahan new chat daripada workspace

## Next Step

- Push commit `AI-CONTEXT.md` + `docs/ai-memory/` ini (di atas `8b120cd`/`9f89572`) → `git push origin feat/upload-all-files` (fast-forward)
- Bundle baru untuk backup (opsional)
- Test di new chat: `clone recallfox && cat AI-CONTEXT.md` → harus langsung nyambung

---
*Generated: 29 Aug 2026 17:35 WIB — Session Muse Spark 1.2 via Arena. Sumber: git log, bundle verify, ls-remote.*
