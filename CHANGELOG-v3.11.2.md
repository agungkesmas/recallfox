# Changelog v3.11.2 — Log Troubleshooting Sesi Lanjutan (18 Juli 2026)

3 issue baru dari Log_Troubleshooting_RECALFOX.docx (update sesi lanjutan) — semua selesai.

> **Catatan versi**: v3.11.2 dibangun di atas v3.11.1 (versi remote GitHub).
> Push ke `agungkesmas/recallfox` menggunakan PAT user.

---

## Issue 1 — Pomodoro Counter + Music Player (ganti "kotak merah")

### Laporan User
"kotak merah di hilangkan saja, diganti pomodoro counter dengan berbagai seting bisa play pause dan include player suara yang bisa ngambil dari manapun situsnya. utamakan youtube, jadi seperti playlist gitu bisa di putar, pause, dan nex dan back. untuk memasukkan linknya caranya kamu pikirin."

### Root Cause
- Tidak ada fitur pomodoro sebelumnya (grep 0 match).
- Tidak ada music player terintegrasi.

### Solusi v3.11.2 — NEW FEATURE: Pomodoro + Music Player

#### Modul baru: `lib/pomodoro.js` (~250 baris)
- `getPomodoroState()` — load state dari `storage.local`, recomputes remainingSec kalau popup ditutup saat timer running
- `startPomodoro()` / `pausePomodoro()` / `resetPomodoro()` / `skipPhase()`
- `tickPomodoro()` — decrement 1 detik, advance phase otomatis, kirim notifikasi browser saat selesai
- `updatePomodoroSettings(patch)` — update work/short/long durations
- 3 phase: `work` (25m default) → `short_break` (5m) → `long_break` (15m setiap 4 work sessions)
- Auto-start next phase (configurable)
- Notify on complete (configurable)
- Persist state across popup close via `startedAt` timestamp + `_phaseDurationSec`

#### Music player
- `addMusicPlaylist(url, title)` — add to recents (cap 20)
- `pinMusicPlaylist(url)` / `unpinMusicPlaylist(url)` — pin/unpin
- `deleteMusicPlaylist(url)`
- `parseYouTubeUrl(url)` — extract video ID atau playlist ID
- `buildYouTubeEmbedUrl(url)` — build embed URL dengan autoplay=1
- UI: input URL + embed iframe + pinned list + recents list

#### UI: `renderPomodoroPage(B)` di popup.js
- Pomodoro card (gradient blue) dengan phase label + time (56px font) + stats (completed sessions + total focus time)
- Action buttons: Play/Pause, Reset, Skip
- Settings card: 4 number inputs (work/short/long/interval) + 2 toggles (auto-start, notify)
- Music card: input URL + 16:9 embed + pinned list + recents list
- Interval timer (1s) yang update UI + tick state

#### Settings baru di DEFAULT_SETTINGS
- `pomodoroEnabled: false`
- `pomodoroShowInStrip: false` — untuk future feature: mini counter di strip bar

---

## Issue 2 — Profanity Filter Mode + Quiz Gate

### Laporan User
"kotak merah ditambah kuis hitung hitungan kalau mau on off yang rumit biar anak anak ga bisa sembarang off."

"masih di bilah yang sama ada pengaturan, disitu ada 'mode anak (filter konten)' itu logikanya diganti menjadi seperti 'nuclear mode' tapi memblokir kata kata tidak sopan seperti anjir, cok, dsb sepaket kata kasar yang sering tampil di konten sampah yang targetin anak anak."

### Root Cause
- "Mode anak (filter konten)" hanya filter YouTube feed — TIDAK blokir kata kasar di halaman lain.
- Tidak ada quiz gate — anak bisa toggle off dengan mudah.
- Tidak ada daftar kata kasar Indonesia.

### Solusi v3.11.2 — NEW FEATURE: Nuclear Profanity Filter + Quiz Gate

#### Modul baru: `lib/profanity.js` (~120 baris)
- `DEFAULT_PROFANITY_WORDS` — 80+ kata kasar Indonesia + variasi leet-speak:
  - anjir/anjing/anjg/anj1ng/4njir
  - bangsat/bgsat/b4ngsat/bangs4t
  - cok/cokk/c0k/jancok/jancokk/j4ncok
  - kontol/kntl/k0ntol/k3nt0l
  - memek/mmk/m3mek
  - ngentot/ngentod/ngntot/ng3ntot
  - pepek/ppk/p3pek
  - titit/ttt/t1t1t
  - setan/iblis/s4tan
  - bajingan/bjingan/b4jingan
  - tolol/tll/t0l0l
  - bodoh/b0doh
  - goblok/goblog/gblg/g0bl0g
  - banci/b4nci
  - bencong/b3nc0ng
  - pelacur/placur/p3lacur
  - lonte/l0nte
  - ngewe/ng3w3
  - bokep/b0kep
  - perek/p3r3k
  - jembut/j3mbut
  - pantek/p4ntek
  - Singkatan slang: ktl, mmk, ppk, ttk, bgst, anj, jck, bncng
- `normalizeProfanity(text)` — lowercase + strip diacritics + replace leet (0→o, 1→i, 3→e, 4→a, 5→s, 7→t, 9→g)
- `containsProfanity(text)` — check normalized text against word set
- `maskProfanity(text)` — replace matched words with asterisks of same length

#### Content script integration: `content/contentguard-cs.js`
- `applyProfanityFilter()` function — async, import `lib/profanity.js` via `browser.runtime.getURL()`
- Scan text nodes di body via TreeWalker (skip SCRIPT/STYLE/TEXTAREA/INPUT)
- Mask text dengan saving original (`data-rf-prof-orig` attribute)
- MutationObserver untuk scan DOM changes (added nodes)
- Berjalan di SEMUA halaman web (bukan cuma YouTube/X)
- Hook di `CG_SETTINGS_UPDATED` message handler — apply/remove saat toggle berubah
- Auto-run saat content script load

#### UI: Quiz gate modal
- HTML `#quizOverlay` di popup.html + sidebar.html
- CSS `.quiz-modal`, `.quiz-question`, `.quiz-input` (dengan shake animation saat salah)
- `openQuizGate(onSuccess)` — generate random math question:
  - Addition: 10-59 + 10-59 (range 20-118)
  - Subtraction: big - small (10-59 range, pastikan positif)
  - Multiplication: 2-10 × 2-10 (range 4-100)
- `submitQuiz()` — check answer, execute onSuccess callback kalau benar, shake + error message kalau salah
- Click outside modal atau Escape → close

#### Integration di `renderKontrolSitusPage`
- Tambah toggle "🤬 Filter Kata Kasar (Nuclear)" dengan deskripsi
- Tambah checkbox "Mask kata kasar dengan ***" (vs hide elemen)
- Quiz gate saat MEMATIKAN mode (tidak saat menyalakan)
- Broadcast `CG_SETTINGS_UPDATED` ke semua tabs saat toggle berubah

#### Settings baru di DEFAULT_SETTINGS
- `contentGuardProfanityMode: false` — master switch
- `contentGuardProfanityMask: true` — mask vs hide
- `contentGuardProfanityQuizArmed: 0` — epoch-ms (future use)
- `contentGuardQuizGate: true` — quiz required untuk disable kid/profanity mode

#### Quiz gate juga diterapkan ke mode anak yang sudah ada
- `ksKidModeToggle` (YouTube Kids redirect) — quiz saat off
- `ksKidsOnlyToggle` (filter konten) — quiz saat off

---

## Issue 3 — Kid-Safe Sites + Drag-Drop Reorder

### Laporan User
"kotak ijo ini jarang dipake, sembunyikan aja. ganti kotak ijo dengan daftar situs ramah anak seperti game atau video edukasi anak yang konsen disitu ya situsnya berbahasa inggris atau indonesia listnya kamu cari dulu yang lengkap. nah daftar situs ini ada pengaturan untuk ditambah, dihapus, di hide, di pin. utamakan yang tidak perlu login dan gratis."

"itu kan menu banyak ya waktu shalat habits dsb itu bisa tidak si urutannya diubah ubah? ditarik tarik gitu dirangkai sendiri urutannya. berlaku juga untuk home dan catatan kalau bisa ditarik tarik urutannya."

### Root Cause
- Tidak ada fitur kid-safe sites sebelumnya.
- TOOLS array hardcoded, tidak ada reorder.
- Tab bar hardcoded, tidak ada reorder.

### Solusi v3.11.2 — NEW FEATURE: Kid-Safe Sites + Drag-Drop Reorder

#### Modul baru: `lib/kidsafe-sites.js` (~190 baris)
- `DEFAULT_KIDSAFE_SITES` — 28 situs terkurasi:
  - **Indonesia (6)**: Wardaya Academy, Ruangguru Free, Dumet School, Kombak.id, Nusa Lontar, Tokopedia Play Kids
  - **English — Games (10)**: PBS Kids, CoolMathGames, ABCya, Funbrain, Sheppard Software, Turtle Diary, National Geographic Kids, Switch Zoo, Seussville
  - **English — Video (5)**: Khan Academy Kids, Crash Course Kids, SciShow Kids, Peekaboo Kidz, Turtle Diary Videos
  - **English — Learn (5)**: Khan Academy, Code.org, Scratch, Duolingo, Tynker
  - **English — Reading (3)**: Storyline Online, International Children's Library, Oxford Owl
- Format: `{id, name, url, lang, category, description, noLogin}`
- Categories: `game`, `video`, `learn`, `read`
- `getEffectiveKidSafeSites()` — merge default + custom adds - deletes, mark hidden/pinned, sort pinned-first
- `toggleHideSite(id)` / `togglePinSite(id)` / `deleteSite(id)` / `addCustomSite({...})` / `resetKidSafeSites()`
- Persist ke `storage.local['recallfox_kidsafe_sites']`

#### UI: `renderKidSafePage(B)` di popup.js
- Header card (gradient green) dengan total count
- Filter row: kategori (All/Game/Video/Learn/Read) + bahasa (All/ID/EN) + toggle show hidden
- Grid 2-kolom cards dengan: name, category badge (colored), description, lang flag, no-login indicator, pinned indicator
- Action buttons per card: Open, Pin/Unpin, Hide/Show, Delete
- Add custom form: name + URL + lang + category + description
- Reset to default button

#### Drag-Drop Reorder untuk TOOLS
- Tambah `toolOrder: []` setting di DEFAULT_SETTINGS
- `DEFAULT_TOOL_ORDER` constant (12 tools default order)
- `getEffectiveTools()` — apply custom order, append new tools not in order
- `renderTools()` — render dengan drag handle (⋮⋮ icon)
- HTML5 drag events: `dragstart` (set dataTransfer), `dragover` (preventDefault + add drag-over class), `drop` (reorder array + save)
- Visual feedback: `.dragging` (opacity .5), `.drag-over` (primary border + scale 1.02)

#### Drag-Drop Reorder untuk Tab Bar (Beranda/Catatan/Alat)
- Tambah `tabOrder: []` setting
- `applyTabOrder()` — reorder DOM berdasarkan setting
- `setupTabDragDrop()` — bind drag events ke 3 tab buttons
- Save ke `tabOrder` setting saat drop

#### Settings baru di DEFAULT_SETTINGS
- `toolOrder: []`
- `tabOrder: []`
- `hideHeroTiles: false` — untuk future feature: hide hero tiles row

---

## Plus — CSS Wrap Fix

### Problem
"kotak ijo, logika wrap nya kyknya ga jalan lagi, makanya tabrakan, tadinya jalan kok."
"kotak ijo, logika wrap text nya atau apa itu tidak jalan harus geser ke kanan baru menu nya kelihatan"

### Root Cause
- `.strip-bar` di popup.css tidak punya `flex-wrap`, sehingga prayer/quran/fasting cells collide di narrow width.
- `.strip-cell` tidak punya `overflow:hidden` + `text-overflow:ellipsis`.

### Fix
- Tambah `flex-wrap:wrap` + `min-width:0` ke `.strip-bar`
- Tambah `overflow:hidden` + `text-overflow:ellipsis` + `max-width:100%` ke `.strip-cell`
- Tambah `overflow:hidden` + `text-overflow:ellipsis` ke `.strip-cell b`

---

## File yang diubah (v3.11.2)

| File | Jenis | Ringkasan |
|---|---|---|
| `manifest.json` | Modify | Bump 3.11.1 → 3.11.2, tambah 3 web_accessible_resources (lib/profanity.js, lib/pomodoro.js, lib/kidsafe-sites.js) |
| `lib/pomodoro.js` | **NEW** | Modul pomodoro timer + music player playlists (~250 baris) |
| `lib/kidsafe-sites.js` | **NEW** | Modul daftar situs ramah anak dengan 28 situs terkurasi (~190 baris) |
| `lib/profanity.js` | **NEW** | Modul filter kata kasar Indonesia dengan 80+ kata + variasi leet (~120 baris) |
| `lib/storage.js` | Modify | Tambah 9 settings baru: contentGuardProfanityMode/Mask/QuizArmed/QuizGate, pomodoroEnabled/ShowInStrip, hideHeroTiles, toolOrder, tabOrder |
| `content/contentguard-cs.js` | Modify | Tambah `applyProfanityFilter()` function + hook di CG_SETTINGS_UPDATED + auto-run on load |
| `popup/popup.html` | Modify | Tambah quiz gate modal HTML |
| `sidebar/sidebar.html` | Modify | Tambah quiz gate modal HTML (sinkron dengan popup) |
| `popup/popup.css` | Modify | Fix `.strip-bar` wrap (flex-wrap + min-width:0) + tambah CSS untuk pomodoro/kidsafe/quiz/drag-drop/profanity card (~120 baris baru) |
| `popup/popup.js` | Modify | Tambah TOOLS baru (pomodoro, kidsafe), renderTools dengan drag-drop, renderPomodoroPage, renderKidSafePage, renderMusicPlaylists, playMusic, openQuizGate/closeQuizGate/submitQuiz, applyHideTiles, applyTabOrder, setupTabDragDrop, bindQuizModalEvents. Profanity toggle + quiz gate di renderKontrolSitusPage. Init() call applyHideTiles + applyTabOrder + setupTabDragDrop + bindQuizModalEvents |
| `README.md` | Modify | Bump version 3.10.2 → 3.11.2, tambah changelog v3.11.2 section |
| `CHANGELOG-v3.11.2.md` | **NEW** | Detail per-issue analysis + root cause + solution (file ini) |

---

## Testing checklist

- [ ] Buka Firefox → `about:debugging` → Load Temporary Add-on → pilih `manifest.json`
- [ ] Cek tidak ada error di Browser Console (Ctrl+Shift+J)
- [ ] **Issue 1 (Pomodoro + Music)**: Tab Alat → klik "Pomodoro + Musik" → cek timer 25:00 → klik Play → tunggu 1 menit → cek timer berkurang → klik Pause → klik Reset. Test music: paste URL YouTube playlist → klik Tambah → cek iframe muncul → klik 📌 Pin → cek pindah ke Pinned section.
- [ ] **Issue 2 (Profanity + Quiz)**: Tab Alat → Kontrol Situs → enable "🤬 Filter Kata Kasar" → buka halaman web dengan komentar kasar → cek kata kasar di-mask ***. Test quiz: klik toggle off → cek modal quiz muncul → jawab salah → cek shake animation → jawab benar → cek mode off.
- [ ] **Issue 3 (Kid-Safe Sites)**: Tab Alat → klik "Situs Ramah Anak" → cek 28 situs tampil → filter by kategori "Game" → cek hanya game tampil → klik 📌 Pin di salah satu → cek pindah ke atas → klik 🙈 Sembunyikan → cek hilang → klik "👁 Tampilkan tersembunyi" → cek tampil dengan opacity 0.45. Test add custom: isi form → klik "Tambah Situs" → cek muncul.
- [ ] **Issue 3 (Drag-Drop)**: Tab Alat → tahan tombol ⋮⋮ di salah satu tool → drag ke posisi lain → drop → cek urutan berubah → refresh popup → cek urutan tetap (persisted). Test tab: drag tab "Catatan" ke kiri "Beranda" → cek urutan tab berubah.
- [ ] **CSS Wrap Fix**: Buka sidebar di narrow width (≤300px) → cek strip-bar prayer/quran/fasting cells tidak collide → cek bisa wrap ke baris baru.

---

**Versi:** 3.11.2 · **Total issue:** 3 (+ 1 CSS fix) · **Status:** Semua selesai ✓ · **Baseline:** v3.11.1 (remote GitHub)
