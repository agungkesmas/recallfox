# CARA-KERJA.md — Master Memori RecallFox

> Filosofi Mas Agung dari `template-project`: **git sebagai otak pusat**. Semua konteks AI hidup di repo, bukan di workspace/container yang hilang tiap new chat.

## 1. Kenapa Git Jadi Otak?

- **Workspace Arena tidak persisten** — tiap new chat = container baru, file lokal hilang. Mengandalkannya = percuma.
- **Git persisten & public** — repo `agungkesmas/recallfox` (Firefox) & `recallfox-chrome` public → AI bisa `clone/read` tanpa kredensial di chat manapun. Push tetap butuh kredensial user (keamanan).
- **Single source of truth:** `AI-CONTEXT.md` (pintu masuk) + `docs/ai-memory/*` (master) + `changelogs/*` (user-facing).

## 2. Struktur Memori di Repo

```
recallfox/ (Firefox — master)
├── AI-CONTEXT.md                    # WAJIB dibaca AI tiap sesi (ritual, arsitektur, aturan)
├── docs/ai-memory/
│   ├── CARA-KERJA.md                # File ini — master cara kerja
│   └── RINGKASAN-v3.22.0.md         # Ringkasan per versi/chat
├── changelogs/CHANGELOG-v3.22.0.md  # Changelog user-facing
└── docs/fix-documents-rls.sql       # SQL RLS (contoh artefak v3.22.0)

recallfox-chrome/ (mirror)
└── AI-CONTEXT.md                    # Mirror Chrome-specific (manifest service_worker, polyfill)
```

## 3. Ritual Sesi (Berlaku di Tool Apapun)

**Awal sesi (AI):**
```bash
git pull origin feat/upload-all-files  # atau main
cat AI-CONTEXT.md
cat docs/ai-memory/RINGKASAN-v*.md  # yang terbaru
```

**Akhir sesi (AI + User):**
```bash
# AI update RINGKASAN
git add AI-CONTEXT.md docs/ai-memory/
git commit -m "docs: update memory vX.Y.Z"
# Arena: git bundle create ~/Downloads/recallfox-vX.Y.Z.bundle feat/upload-all-files
# User lokal: git fetch ~/Downloads/*.bundle feat/upload-all-files && git push origin feat/upload-all-files vX.Y.Z-*
```

**Di Arena (tanpa push cred):** kerja via `git bundle` → user fetch+push di mesin lokal. **Di OpenCode lokal:** push langsung.

## 4. Aturan Branch & Tag

- `main` — stabil, rilis
- `feat/v3.21.*` / `feat/upload-all-files` — branch fitur
- Tag Firefox: `v3.22.0-firefox`, Chrome: `v3.22.0-chrome`, Stable: `v3.22.0-stable` (gabungan, push ke kedua repo)
- Commit message: `feat:`, `fix:`, `docs:`, `chore:` + deskripsi Indonesia singkat

## 5. Aturan RecallFox Kritis (Pelajaran Chrome Broken 2026-08-28)

- **Jangan `cp` Firefox→Chrome mentah.** Beda manifest/background/content_scripts/icons.
- Firefox `manifest.json`: `background.scripts`, `sidebar_action`, `menus`, `icons svg`
- Chrome `manifest.json`: `background.service_worker type:module`, `side_panel`, `contextMenus+sidePanel`, `icons png`
- `background.js` Firefox = `browser.*` native; Chrome = `import './lib/browser-polyfill.min.js'` + `openSidebar()` dari `lib/sidebar-compat.js`
- Baseline Chrome bagus `6c90b3c`/`b421ed9` — jangan overwrite
- Checklist sebelum push Chrome: `service_worker` ada, background import polyfill, semua content_scripts ada polyfill, pill 3 tombol hidup

## 6. Arsitektur Penting (v3.22.0)

- **Storage:** `lib/storage.js` — vault JSON ringan + blob terpisah `rf_file_{id}`, `rf_shot_` untuk screenshot
- **Sync:** `lib/supabase-sync.js` — `_resolveFileBlob`, Supabase Storage, RLS `fix-documents-rls.sql` (baca publik untuk AI, per-user ketat)
- **UI:** `popup/popup.js` (967 baris), `sidebar/sidebar.html`, `content/notes-cs.js`, `content/sidebar-cs.js` (floater drag + 1x/2x klik)
- **Parsing:** `lib/todoist-parse.js` (P1-P4, due dates), `lib/file-kinds.js` (whitelist programming)
- **Sounds:** `assets/sounds/` adzan/bell, `lib/pomodoro.js`

## 7. Batasan & Pembagian Tool

- **Arena (Muse Spark via OpenCode Go):** analisis, preview file, test, SQL, bikin bundle. Tidak bisa push langsung.
- **OpenCode lokal (di mesin Mas Agung):** partner ideal untuk git langsung — pull/push, merge, lanjut fitur. Ritual `AI-CONTEXT.md` bikin konteks konsisten lintas-tool.
- **User:** eksekutor push, verifikasi di browser (pill 3 tombol, screenshot, vault).

## 8. Cara Verifikasi di New Chat

```bash
git clone https://github.com/agungkesmas/recallfox.git
cat AI-CONTEXT.md  # AI langsung nyambung
git clone https://github.com/agungkesmas/recallfox-chrome.git  # jika butuh Chrome
```

---
*Master ini hidup di `recallfox` Firefox. Chrome mirror di `AI-CONTEXT.md` masing-masing. Update tiap versi. Last: 29 Aug 2026 v3.22.0.*
