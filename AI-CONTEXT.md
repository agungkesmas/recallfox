# AI-CONTEXT.md — RecallFox (Firefox) — WAJIB BACA SEBELUM KERJA

> **Aturan #1 Arena:** Di new chat, clone dulu `github.com/agungkesmas/recallfox` lalu baca file ini. Tanpa ini konteks putus (workspace tidak kebawa).

## 0. Ritual Sesi (Wajib)

```
Awal sesi: git pull origin <branch> + baca AI-CONTEXT.md + baca docs/ai-memory/RINGKASAN-*.md terbaru
Akhir sesi: update RINGKASAN + commit + push (atau bundle jika di Arena tanpa kredensial push)
```

Arena tidak punya kredensial push GitHub — kerja via `git bundle` (`~/Downloads/recallfox-*.bundle`) lalu user yang `git fetch + push` di mesin lokal. OpenCode di mesin lokal bisa push langsung.

## 1. Git Adalah Otak Pusat

Filosofi dari `template-project` Mas Agung: **git sebagai single source of truth**. Memori AI tidak di workspace/container, tapi di repo:
- `AI-CONTEXT.md` (file ini) — pintu masuk
- `docs/ai-memory/CARA-KERJA.md` — master cara kerja lengkap
- `docs/ai-memory/RINGKASAN-v*.md` — ringkasan per versi/chat
- `changelogs/CHANGELOG-v*.md` — changelog user-facing

Repo **public** → AI di Arena bisa `clone/read` tanpa token. Push tetap butuh token user (keamanan).

## 2. Branch & Tag

- `main` — stabil (saat ini `v3.21.11` di origin, lokal `feat/upload-all-files` = `v3.22.0`)
- `feat/*` — fitur (contoh: `feat/upload-all-files`, `feat/v3.21.19-p1`)
- Tag: `v3.22.0-firefox` (Firefox), `v3.22.0-stable` (stable gabungan), `v3.22.0-chrome` di repo chrome
- Jangan `cp` mentah Firefox→Chrome (lihat Aturan RecallFox di bawah)

## 3. Arsitektur v3.22.0 (Upload File Binary)

**Fitur baru:** Upload file binary (PDF/Office/gambar 10MB) + whitelist teks programming (~60 ekstensi).

- `lib/file-kinds.js` (258 baris) — deteksi MIME/ekstensi, allowlist `isTextKind()` vs `isBinaryKind()`, test di `test/file-kinds.test.mjs`
- `lib/storage.js` — `addItem({fileBlob, fileName, mimeType})` → simpan blob di `rf_file_{id}` (pola `rf_shot_`), `getFileDataUrl(id)`, `deleteFileBlob(id)`. Vault JSON tetap ringan, blob terpisah.
- `lib/supabase-sync.js` — `_resolveFileBlob()` + ekstensi cloud dari `fileName` asli, upload `fileBlob` ke Supabase Storage
- `popup/popup.js + popup/popup.html + sidebar/sidebar.html` — UI upload 2 jalur (drag/file picker), preview PDF/gambar inline, inject URL+metadata ke AI
- `docs/fix-documents-rls.sql` — RLS: policy BACA PUBLIK untuk `documents` (AI fetch URL tanpa login), idempotent, RLS per-user ketat (sudah verifikasi Postgres 17 lokal)
- `manifest.json` — `version 3.22.0`, permissions `menus` (Firefox) vs `contextMenus+sidePanel` (Chrome)
- `test/storage-binary.test.mjs` — test blob round-trip

**File yang sering disentuh:**
`popup/popup.js` (UI utama, 967 baris di v3.22.0), `lib/todoist-parse.js` (P1-P4), `content/notes-cs.js`, `content/sidebar-cs.js`, `lib/pomodoro.js`, `background.js` (343 baris diff v3.22.0)

## 4. Aturan RecallFox Kritis (Jangan Copy Mentah)

- `manifest.json` Firefox = `scripts: ["background.js"]` + `sidebar_action` + `menus` + `icons svg` ; Chrome = `service_worker + type:module` + `side_panel` + `contextMenus` + `icons png`
- `background.js` Firefox pakai `browser.*` native; Chrome butuh `import './lib/browser-polyfill.min.js'` + `import {openSidebar} from './lib/sidebar-compat.js'`
- Chrome baseline bagus di `6c90b3c` / `b421ed9` — jangan overwrite dengan versi Firefox
- Build Chrome butuh adaptasi: manifest, background polyfill, content_scripts polyfill, icons SVG→PNG
- Sebelum push Chrome cek: `service_worker` ada, background import polyfill, semua content_scripts ada polyfill

## 5. Batasan Sandbox Arena

- Tidak bisa push GitHub langsung, tidak bisa akses `~/.local/share/opencode` user
- Bisa baca repo lokal di `recallfox-work/recallfox` + `recallfox-chrome`
- Untuk push: buat bundle (`git bundle create`) → user `git fetch ~/Downloads/*.bundle feat/upload-all-files && git push origin ...`

## 6. Status Terkini (29 Aug 2026)

- Lokal `feat/upload-all-files` Firefox `8b120cd` (2 commit di atas `7541df1` v3.22.0) — sudah push ke `origin/feat/upload-all-files` + tag `v3.22.0-firefox` + `v3.22.0-stable`
- Chrome `9f89572` (rebase di atas `500bb2e` v3.21.26 Floater 1x/2x) — sudah push `feat/upload-all-files` + tag `v3.22.0-chrome` + `v3.22.0-stable`
- v3.21.26 Chrome: `RF_OPEN_REAL_SIDEBAR` (single click → `chrome.sidePanel.open`, double click → popout DOM, timer 250ms)

## 7. Cara Lanjut di New Chat

```bash
git clone https://github.com/agungkesmas/recallfox.git
cat AI-CONTEXT.md
cat docs/ai-memory/RINGKASAN-v3.22.0.md
```

Jika butuh Chrome: clone `recallfox-chrome` juga, baca `AI-CONTEXT.md` di sana (isi mirip, beda manifest/background).

---
*Last update: 29 Aug 2026 — v3.22.0 upload binary, bundle push + rebase Chrome. Maintainer: Mas Agung.*
