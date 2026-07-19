// lib/pomodoro.js — Pomodoro timer + simple YouTube music player
// RecallFox v3.11.2 (Issue 1: ganti "kotak merah" dengan pomodoro + music player)
//
// Fitur:
//   - Pomodoro counter dengan 3 phase: work / short break / long break
//   - Settings: work duration (default 25m), short break (5m), long break (15m),
//     long break interval (default 4 — setiap 4 work sessions, dapat long break)
//   - Play/pause/reset/skip
//   - Persist state ke storage.local supaya timer tetap jalan walau popup ditutup
//   - Notifikasi browser saat phase berakhir (kalau enabled)
//
// Music player:
//   - Embed YouTube iframe dengan playlist URL
//   - User input: YouTube video URL atau playlist URL
//   - Save playlist ke storage (recents + pinned)
//   - Play/pause/next/back via YouTube IFrame API (best effort — terbatas oleh
//     YouTube CORS policy, fallback ke simple iframe reload)

const POMODORO_KEY = 'recallfox_pomodoro';
const MUSIC_KEY = 'recallfox_music_playlists';

const DEFAULT_POMODORO = {
  workMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakInterval: 4,
  autoStartNext: false,
  notifyOnComplete: true,
  // Runtime state:
  phase: 'idle',         // 'idle' | 'work' | 'short_break' | 'long_break'
  remainingSec: 25 * 60, // seconds remaining in current phase
  completedWorks: 0,     // number of completed work sessions
  running: false,
  startedAt: null,       // ISO timestamp saat phase dimulai (untuk persist across popup close)
  totalFocusSec: 0       // total akumulasi waktu fokus (untuk statistik)
};

// ===== Settings & state =====

export async function getPomodoroState() {
  const data = await browser.storage.local.get(POMODORO_KEY);
  const stored = data[POMODORO_KEY] || {};
  const merged = { ...DEFAULT_POMODORO, ...stored };
  // Recompute remainingSec kalau ada startedAt (timer berjalan saat popup ditutup)
  if (merged.running && merged.startedAt) {
    const elapsed = Math.floor((Date.now() - new Date(merged.startedAt).getTime()) / 1000);
    const originalSec = merged._phaseDurationSec || merged.workMinutes * 60;
    merged.remainingSec = Math.max(0, originalSec - elapsed);
    // Kalau sudah 0, phase selesai saat popup tertutup — auto-advance
    if (merged.remainingSec === 0) {
      // Recompute state — assume phase ended
      const next = advancePhase(merged);
      Object.assign(merged, next);
      await savePomodoroState(merged);
    }
  }
  return merged;
}

export async function savePomodoroState(state) {
  await browser.storage.local.set({ [POMODORO_KEY]: state });
}

export async function updatePomodoroSettings(patch) {
  const cur = await getPomodoroState();
  const next = { ...cur, ...patch };
  // Kalau phase idle dan workMinutes berubah, reset remainingSec
  if (cur.phase === 'idle' && patch.workMinutes) {
    next.remainingSec = patch.workMinutes * 60;
  }
  await savePomodoroState(next);
  return next;
}

// ===== Timer control =====

export async function startPomodoro() {
  const cur = await getPomodoroState();
  if (cur.running) return cur;
  // Kalau idle, mulai dari work phase
  if (cur.phase === 'idle') {
    cur.phase = 'work';
    cur.remainingSec = cur.workMinutes * 60;
  }
  cur.running = true;
  cur.startedAt = new Date().toISOString();
  cur._phaseDurationSec = cur.remainingSec;
  await savePomodoroState(cur);
  return cur;
}

export async function pausePomodoro() {
  const cur = await getPomodoroState();
  if (!cur.running) return cur;
  cur.running = false;
  cur.startedAt = null;
  await savePomodoroState(cur);
  return cur;
}

export async function resetPomodoro() {
  const cur = await getPomodoroState();
  cur.running = false;
  cur.startedAt = null;
  cur.phase = 'idle';
  cur.remainingSec = cur.workMinutes * 60;
  await savePomodoroState(cur);
  return cur;
}

export async function skipPhase() {
  const cur = await getPomodoroState();
  const next = advancePhase(cur);
  await savePomodoroState(next);
  return next;
}

function advancePhase(state) {
  const next = { ...state, running: false, startedAt: null };
  if (state.phase === 'work') {
    next.completedWorks = (state.completedWorks || 0) + 1;
    next.totalFocusSec = (state.totalFocusSec || 0) + state._phaseDurationSec || (state.workMinutes * 60);
    // Long break setiap N work sessions
    if (next.completedWorks % state.longBreakInterval === 0) {
      next.phase = 'long_break';
      next.remainingSec = state.longBreakMinutes * 60;
    } else {
      next.phase = 'short_break';
      next.remainingSec = state.shortBreakMinutes * 60;
    }
  } else if (state.phase === 'short_break' || state.phase === 'long_break') {
    next.phase = 'work';
    next.remainingSec = state.workMinutes * 60;
  } else {
    // idle → start work
    next.phase = 'work';
    next.remainingSec = state.workMinutes * 60;
  }
  return next;
}

// Decrement timer by 1 second (called from popup interval)
export async function tickPomodoro() {
  const cur = await getPomodoroState();
  if (!cur.running) return cur;
  cur.remainingSec = Math.max(0, cur.remainingSec - 1);
  if (cur.remainingSec === 0) {
    // Phase selesai — notify + advance
    if (cur.notifyOnComplete) {
      try {
        await browser.notifications.create({
          type: 'basic',
          iconUrl: browser.runtime.getURL('icons/icon-96.svg'),
          title: 'RecallFox Pomodoro',
          message: cur.phase === 'work'
            ? '🎉 Work session selesai! Saatnya istirahat.'
            : '⏰ Istirahat selesai! Saatnya fokus lagi.'
        });
      } catch (e) { /* notif opsional */ }
    }
    const next = advancePhase(cur);
    if (next.autoStartNext) {
      next.running = true;
      next.startedAt = new Date().toISOString();
      next._phaseDurationSec = next.remainingSec;
    }
    await savePomodoroState(next);
    return next;
  }
  // Update startedAt supaya tetap accurate kalau popup ditutup
  cur.startedAt = new Date().toISOString();
  cur._phaseDurationSec = cur.remainingSec + 1; // adjust karena kita baru decrement
  await savePomodoroState(cur);
  return cur;
}

// ===== Music playlists =====

export async function getMusicPlaylists() {
  const data = await browser.storage.local.get(MUSIC_KEY);
  return data[MUSIC_KEY] || { recents: [], pinned: [] };
}

export async function addMusicPlaylist(url, title) {
  const all = await getMusicPlaylists();
  // Remove from recents if already there
  all.recents = all.recents.filter(p => p.url !== url);
  // Add to front of recents
  all.recents.unshift({ url, title: title || url, addedAt: new Date().toISOString() });
  // Cap recents to 20
  all.recents = all.recents.slice(0, 20);
  await browser.storage.local.set({ [MUSIC_KEY]: all });
  return all;
}

export async function pinMusicPlaylist(url, title) {
  const all = await getMusicPlaylists();
  // Remove from recents
  all.recents = all.recents.filter(p => p.url !== url);
  // Add to pinned if not there
  if (!all.pinned.find(p => p.url === url)) {
    all.pinned.unshift({ url, title: title || url, addedAt: new Date().toISOString(), pinned: true });
  }
  await browser.storage.local.set({ [MUSIC_KEY]: all });
  return all;
}

export async function unpinMusicPlaylist(url) {
  const all = await getMusicPlaylists();
  const item = all.pinned.find(p => p.url === url);
  all.pinned = all.pinned.filter(p => p.url !== url);
  if (item) {
    all.recents.unshift(item);
  }
  await browser.storage.local.set({ [MUSIC_KEY]: all });
  return all;
}

export async function deleteMusicPlaylist(url) {
  const all = await getMusicPlaylists();
  all.recents = all.recents.filter(p => p.url !== url);
  all.pinned = all.pinned.filter(p => p.url !== url);
  await browser.storage.local.set({ [MUSIC_KEY]: all });
  return all;
}

// Helper: extract YouTube video ID or playlist ID from URL
export function parseYouTubeUrl(url) {
  if (!url) return null;
  // Playlist
  const plMatch = url.match(/[?&]list=([A-Za-z0-9_-]+)/);
  if (plMatch) return { type: 'playlist', id: plMatch[1] };
  // Video
  const vidMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/);
  if (vidMatch) return { type: 'video', id: vidMatch[1] };
  return null;
}

export function buildYouTubeEmbedUrl(url) {
  const parsed = parseYouTubeUrl(url);
  if (!parsed) return null;
  if (parsed.type === 'playlist') {
    return `https://www.youtube.com/embed/videoseries?list=${parsed.id}&autoplay=1`;
  }
  return `https://www.youtube.com/embed/${parsed.id}?autoplay=1`;
}

// Format seconds as MM:SS or HH:MM:SS
export function formatTime(sec) {
  if (!sec || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}
