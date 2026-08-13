// content/contentguard-cs.js — Pelindung Konten (Mode Fokus Allowlist) — RecallFox v3.21.0
// ============================================================================
// Rombak total dari versi lama (filter blacklist 650 keyword + panel mengambang).
// Versi baru: Mode Fokus Allowlist berbasis profil topik. Lihat instruksi
// prompt-agent-rombak-firefox.md §4.
//
// Cara kerja:
//   1. Inject di youtube.com & x.com/twitter.com (document_idle).
//   2. Pasang MutationObserver + setInterval (fallback) untuk scan feed.
//   3. YouTube: bila Mode Fokus AKTIF (master ON + activeProfileId valid + profil
//      punya topik/channel), video TAMPIL hanya jika judul/channel cocok profil
//      aktif (matchesActiveProfile). Semua video lain disembunyikan.
//      Shorts selalu disembunyikan saat contentGuardBlockShorts=true.
//   4. X (Twitter): TETAP blacklist (bukan allowlist). Filter performa di-cache.
//   5. Watch page (Profil Anak strictWatch=true) → minta background redirect ke home.
//      Watch page (Profil Saya strictWatch=false) → overlay non-blocking W4.
//   6. Search Lock detection ada di background (checkContentGuard) — content
//      script tidak perlu mendeteksi search.
//   7. Panel mengambang DIHAPUS — status hanya via popup & Settings.
//   8. Counter internal (hiddenCount/panelStats) tetap untuk debug CG_PING.
//
// Yang dipertahankan dari versi lama:
//   - Guard anti-duplikat inject (dataset.rfCgInjected).
//   - 3-tier load settings (sendMessage → storage.local → default).
//   - Hide via CSS !important + dataset attribute (flicker fix YouTube recycle DOM).
//   - hoveredElement + listener mouseover + handler CG_GET_CONTEXT_FOR_BLOCK
//     (dipakai context menu "Blokir Konten Ini" yang tetap aktif).
//   - Helper user blocklist (matchesUserBlocklistLocal, matchesBlockedXPostUrlLocal)
//     — dipakai sebagai lapisan tambahan di atas Mode Fokus.
// ============================================================================

(function () {
  'use strict';

  // ===== Guard anti-duplikat inject =====
  if (document.documentElement.dataset.rfCgInjected === '1') {
    console.log('[RecallFox/CG] Already injected, skip');
    return;
  }
  document.documentElement.dataset.rfCgInjected = '1';

  // Bersihkan sisa panel lama (defensive — dari inject sebelum rombakan)
  document.querySelectorAll('#rf-cg-control, #rf-cg-status, #rf-cg-debug').forEach(el => el.remove());

  // ===== State global =====
  let settings = null;
  let hiddenCount = 0;             // total elemen disembunyikan (untuk CG_PING debug)
  let hoveredElement = null;       // elemen terakhir yang di-hover (context menu)
  let scanTimer = null;            // debounce timer untuk MutationObserver
  let intervalTimer = null;        // fallback interval
  let profileCache = null;         // cache normalizeText untuk profil aktif
  let keywordCache = null;         // cache normalizeText untuk keyword X (negatif)
  let channelBlocklistCache = null;// cache normalizeText untuk channel blocklist YT+X
  let watchOverlayEl = null;       // elemen overlay watch (Profil Saya)
  let watchAllowUntil = 0;         // timestamp: "Tetap tonton" aktif sampai sini
  let lastWatchStrictRequest = 0;  // anti-spam: jangan spam background untuk watch strict
  let lastWatchTitle = '';         // judul watch terakhir yang di-evaluate (anti re-evaluate)

  // ===== Stats internal (dipakai CG_PING untuk debug; tanpa DOM UI) =====
  const panelStats = { blocked: 0, allowed: 0, lastScanAt: null };

  // ===== Load settings dari background (3-tier fallback) =====
  async function loadSettings() {
    // Strategi 1: kirim message ke background
    try {
      const resp = await browser.runtime.sendMessage({ type: 'CG_GET_SETTINGS' });
      if (resp && resp.settings) {
        settings = resp.settings;
        rebuildCaches();
        return true;
      }
    } catch (e) {
      console.warn('[RecallFox/CG] sendMessage ke background gagal, coba storage.local langsung:', e.message);
    }
    // Strategi 2: fallback ke storage.local langsung
    try {
      const data = await browser.storage.local.get('recallfox_vault');
      const vault = data.recallfox_vault;
      if (vault && vault.settings) {
        settings = vault.settings;
        rebuildCaches();
        console.log('[RecallFox/CG] Settings loaded via storage.local fallback');
        return true;
      }
    } catch (e2) {
      console.warn('[RecallFox/CG] storage.local fallback juga gagal:', e2.message);
    }
    // Strategi 3: default empty settings
    settings = {
      contentGuardEnabled: true,
      contentGuardNegativeKeywords: [],
      contentGuardBlockedYtChannels: [],
      contentGuardBlockedXAccounts: [],
      contentGuardUserBlocklist: [],
      contentGuardTopicProfiles: { profiles: [], activeProfileId: null }
    };
    rebuildCaches();
    console.warn('[RecallFox/CG] Pakai default empty settings');
    return false;
  }

  // ===== Bangun cache normalizeText sekali per settings load (§5.1) =====
  // Dipanggil setelah loadSettings + setelah CG_SETTINGS_UPDATED.
  function rebuildCaches() {
    if (!settings) return;
    // Cache keyword negatif (untuk X filter) — array of normalized string.
    const kws = Array.isArray(settings.contentGuardNegativeKeywords) ? settings.contentGuardNegativeKeywords : [];
    keywordCache = [];
    for (const k of kws) {
      const n = normalizeText(k);
      if (n) keywordCache.push(n);
    }
    // Cache channel blocklist (YT + X) — array of normalized string (tanpa prefix @).
    const ytList = settings.contentGuardBlockYtChannels !== false
      ? (Array.isArray(settings.contentGuardBlockedYtChannels) ? settings.contentGuardBlockedYtChannels : [])
      : [];
    const xList = settings.contentGuardBlockXAccounts !== false
      ? (Array.isArray(settings.contentGuardBlockedXAccounts) ? settings.contentGuardBlockedXAccounts : [])
      : [];
    channelBlocklistCache = [];
    for (const ch of [...ytList, ...xList]) {
      const n = normalizeText(ch).replace(/^@\s*/, '');
      if (n) channelBlocklistCache.push(n);
    }
    // Cache profil aktif (Mode Fokus) — { topics: Set, channels: Set }.
    const activeProfile = getActiveProfileLocal();
    profileCache = buildProfileMatchCacheLocal(activeProfile);
  }

  // ===== shouldRun: master ON saja cukup untuk scan =====
  // (Mode Fokus mungkin aktif/tidak aktif tergantung activeProfileId.)
  function shouldRun() {
    if (!settings) return false;
    if (settings.contentGuardEnabled === false) return false;
    return true;
  }

  // ===== Helper akses settings =====
  function getKeywords() { return keywordCache || []; }
  function getUserBlocklist() {
    return Array.isArray(settings?.contentGuardUserBlocklist) ? settings.contentGuardUserBlocklist : [];
  }
  function getTopicProfiles() {
    if (!settings) return null;
    let tp = settings.contentGuardTopicProfiles;
    if (!tp || !Array.isArray(tp.profiles)) {
      tp = { profiles: [], activeProfileId: null };
    }
    return tp;
  }
  function getActiveProfileLocal() {
    const tp = getTopicProfiles();
    if (!tp || !tp.activeProfileId) return null;
    return tp.profiles.find(p => p.id === tp.activeProfileId) || null;
  }
  function isProfileFilteringLocal(profile) {
    if (!profile) return false;
    const hasTopics = Array.isArray(profile.topics) && profile.topics.length > 0;
    const hasChannels = Array.isArray(profile.channels) && profile.channels.length > 0;
    return hasTopics || hasChannels;
  }
  // Mode Fokus AKTIF = master ON + activeProfile valid + profil punya topik/channel
  function focusModeActive() {
    if (!shouldRun()) return false;
    const p = getActiveProfileLocal();
    return isProfileFilteringLocal(p);
  }

  // ===== Normalisasi teks (anti bypass / anti leet) =====
  // Mis. "F3bri3 Adr14nsy4h" → "febrie adriansyah"
  function normalizeText(text) {
    if (!text) return '';
    let s = String(text).toLowerCase();
    s = s.replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e')
         .replace(/4/g, 'a').replace(/5/g, 's').replace(/7/g, 't')
         .replace(/8/g, 'b').replace(/9/g, 'g');
    s = s.replace(/[._\-*+#~|]/g, '');
    s = s.replace(/\s+/g, ' ').trim();
    return s;
  }

  // ===== Cache match profile (inline — konten script tidak pakai ES module import) =====
  // Hasil: { topics: Set<normalized>, channels: Set<normalized> }
  function buildProfileMatchCacheLocal(profile) {
    const topics = new Set();
    const channels = new Set();
    if (!profile) return { topics, channels };
    if (Array.isArray(profile.topics)) {
      for (const t of profile.topics) {
        const n = normalizeText(t);
        if (n) topics.add(n);
      }
    }
    if (Array.isArray(profile.channels)) {
      for (const c of profile.channels) {
        const n = normalizeText(c);
        if (n) channels.add(n);
      }
    }
    return { topics, channels };
  }

  // ===== Cek cocok profil aktif (Mode Fokus Allowlist) =====
  // Video TAMPIL jika: judul mengandung topik, ATAU channel mengandung topik,
  // ATAU channel cocok salah satu channel whitelist.
  function matchesActiveProfileLocal(title, channel, cache) {
    if (!cache) return false;
    if (cache.topics.size === 0 && cache.channels.size === 0) return false;
    const normTitle = normalizeText(title);
    const normChannel = normalizeText(channel);
    // Topik di judul
    for (const t of cache.topics) {
      if (t && normTitle.includes(t)) return true;
    }
    // Topik di nama channel
    for (const t of cache.topics) {
      if (t && normChannel.includes(t)) return true;
    }
    // Channel whitelist
    for (const c of cache.channels) {
      if (c && normChannel.includes(c)) return true;
    }
    return false;
  }

  // ===== X filter: cek keyword negatif (cache sudah dinormalisasi) =====
  function containsNegative(text) {
    if (!text || !keywordCache || keywordCache.length === 0) return null;
    const normalized = normalizeText(text);
    for (const nkw of keywordCache) {
      if (normalized.includes(nkw)) return nkw;
    }
    return null;
  }

  // ===== X filter: cek channel/akun di blocklist (cache sudah dinormalisasi) =====
  function isChannelBlocked(channelName) {
    if (!channelName) return null;
    if (!channelBlocklistCache || channelBlocklistCache.length === 0) return null;
    const norm = normalizeText(channelName).replace(/^@\s*/, '');
    if (!norm) return null;
    for (const c of channelBlocklistCache) {
      if (!c) continue;
      // Match kalau salah satu mengandung yang lain (case + leet sudah dinormalisasi).
      if (norm === c || norm.includes(c) || c.includes(norm)) {
        return c;
      }
    }
    return null;
  }

  // ===== User blocklist manual (lapisan tambahan di atas Mode Fokus / X filter) =====
  function matchesUserBlocklistLocal(text, channel) {
    const list = getUserBlocklist();
    if (!list || list.length === 0) return null;
    const lowerText = (text || '').toLowerCase();
    const lowerChan = (channel || '').toLowerCase();
    for (const entry of list) {
      if (!entry || !entry.value) continue;
      const v = String(entry.value).toLowerCase().trim();
      if (!v) continue;
      if (entry.type === 'channel' || entry.type === 'account') {
        if (lowerChan && (lowerChan.includes(v) || v.includes(lowerChan))) {
          return { entry, matched: entry.type };
        }
      } else if (entry.type === 'exact_title') {
        if (lowerText === v) return { entry, matched: 'exact_title' };
      } else if (entry.type === 'title') {
        if (lowerText.includes(v)) return { entry, matched: 'title' };
      } else if (entry.type === 'x_post_url') {
        if (lowerText && lowerText.includes(v)) return { entry, matched: 'x_post_url' };
        if (entry.altValue) {
          const altV = String(entry.altValue).toLowerCase().trim();
          if (altV && lowerText.includes(altV)) return { entry, matched: 'x_post_url' };
        }
      } else {  // 'keyword' / default
        if (lowerText.includes(v) || (lowerChan && lowerChan.includes(v))) {
          return { entry, matched: 'keyword' };
        }
      }
    }
    return null;
  }

  // Helper khusus untuk cek URL post X terhadap blocklist (v3.4)
  function matchesBlockedXPostUrlLocal(postUrl) {
    const list = getUserBlocklist();
    if (!list || list.length === 0 || !postUrl) return null;
    const lowerUrl = String(postUrl).toLowerCase();
    let urlPath = '';
    try { urlPath = new URL(postUrl).pathname.toLowerCase(); } catch (e) {}
    for (const entry of list) {
      if (!entry || entry.type !== 'x_post_url' || !entry.value) continue;
      const v = String(entry.value).toLowerCase().trim();
      if (v && lowerUrl.includes(v)) return { entry, matched: 'x_post_url' };
      if (entry.altValue) {
        const altV = String(entry.altValue).toLowerCase().trim();
        if (altV && urlPath && urlPath === altV) return { entry, matched: 'x_post_url' };
      }
    }
    return null;
  }

  // ===== YouTube selectors (sudah didedup, performa) =====
  // v3.21.0: buang duplikat (ytd-rich-item-renderer muncul 2x, ytd-video-renderer 2x, dll.)
  // Tetap multi-fallback karena YouTube sering ganti DOM.
  const YT_VIDEO_SELECTORS = [
    'ytd-rich-item-renderer',                              // feed home
    'ytd-video-renderer',                                  // search results
    'ytd-compact-video-renderer',                          // sidebar related
    'ytd-grid-video-renderer',                             // channel pages
    'ytd-reel-item-renderer',                              // shorts
    'ytd-playlist-panel-video-renderer',                   // playlist
    'ytd-rich-shelf-renderer',                             // shelf (untuk hideEmptyShelves)
    'ytd-rich-section-renderer ytd-rich-item-renderer',    // section feed
    'ytd-video-preview-renderer',                          // new layout 2026
    'ytd-compact-station-renderer',                        // music station
    'ytd-grid-movie-renderer', 'ytd-movie-renderer'        // premium/movie
  ];

  function getYouTubeTitle(el) {
    const candidates = [
      '#video-title',
      'a#video-title-link',
      '#metadata-line',
      'yt-formatted-string#video-title',
      'h3.ytd-rich-item-renderer',
      'span#title',
      '[title]',
      '[aria-label]'
    ];
    for (const sel of candidates) {
      const node = el.querySelector(sel);
      if (node) {
        const t = (node.textContent || node.getAttribute('title') || node.getAttribute('aria-label') || '').trim();
        if (t && t.length > 3) return t;
      }
    }
    return (el.textContent || '').trim().slice(0, 500);
  }

  function getYouTubeChannel(el) {
    const candidates = [
      'yt-formatted-string#text a',
      '#channel-name a',
      '#channel-name',
      'a.yt-simple-endpoint[href*="/@"]',
      'a.yt-simple-endpoint[href*="/channel/"]',
      'a.yt-simple-endpoint[href*="/c/"]',
      'a.yt-simple-endpoint[href*="/user/"]',
      'ytd-channel-name a',
      'ytd-channel-name yt-formatted-string',
      '#text.ytd-channel-name',
      '.ytd-channel-name a'
    ];
    for (const sel of candidates) {
      const nodes = el.querySelectorAll(sel);
      for (const node of nodes) {
        const t = (node.textContent || '').trim();
        if (t && t.length > 0 && t.length < 100) return t;
        if (node.href) {
          const m = node.href.match(/\/(@[\w.\-]+|channel\/[\w\-]+|c\/[\w\-]+|user\/[\w\-]+)/);
          if (m) return m[1];
        }
      }
    }
    return '';
  }

  // ===== hideYouTubeByFocus: Mode Fokus allowlist (replaces hideYouTubeNegative) =====
  // Saat Mode Fokus AKTIF: video TAMPIL hanya jika cocok profil aktif.
  // Lapisan tambahan: user blocklist (matchesUserBlocklistLocal) tetap berlaku
  // di atas Mode Fokus (bisa hide video yang cocok profil tapi di-block user).
  // Shorts (contentGuardBlockShorts=true) disembunyikan via hideAllShorts.
  function hideYouTubeByFocus() {
    if (settings?.contentGuardBlockShorts === true) {
      hideAllShorts();
    }

    const focus = focusModeActive();
    let changed = false;
    let allowedThisScan = 0;
    const MAX_NODES = 500;  // batas node per scan (§8 — jangan scan tanpa batas)

    // Deduplikasi node via Set
    const allNodes = new Set();
    for (const sel of YT_VIDEO_SELECTORS) {
      let nodes;
      try { nodes = document.querySelectorAll(sel); }
      catch (e) { continue; }
      for (const n of nodes) {
        if (allNodes.size >= MAX_NODES) break;
        allNodes.add(n);
      }
      if (allNodes.size >= MAX_NODES) break;
    }

    for (const node of allNodes) {
      // Skip ad slots
      if (node.querySelector('ytd-ad-slot-renderer, [class*="ad-"]')) continue;

      const title = getYouTubeTitle(node);
      const channel = getYouTubeChannel(node);

      // Lapisan 1: user blocklist manual (selalu aktif di atas Mode Fokus)
      const userBlk = matchesUserBlocklistLocal(title + ' ' + channel, channel);

      // Lapisan 2: Mode Fokus allowlist
      let hideByFocus = false;
      if (focus) {
        // Deteksi recycle DOM: hash judul+channel. Kalau hash berubah → reset flag.
        const currentHash = (title + '||' + channel).slice(0, 200);
        const prevHash = node.dataset.rfCgFocusHash || '';
        if (node.dataset.rfCgHidden === '1' && prevHash && prevHash !== currentHash) {
          // Node di-recycle dengan konten baru — re-evaluate
          delete node.dataset.rfCgHidden;
          delete node.dataset.rfCgReason;
        }
        node.dataset.rfCgFocusHash = currentHash;

        if (node.dataset.rfCgHidden !== '1') {
          if (!matchesActiveProfileLocal(title, channel, profileCache)) {
            hideByFocus = true;
          }
        }
      }

      if (userBlk || hideByFocus) {
        if (node.dataset.rfCgHidden === '1') continue;  // sudah di-hide, skip counter
        node.style.setProperty('display', 'none', 'important');
        node.dataset.rfCgHidden = '1';
        node.dataset.rfCgReason = userBlk?.entry?.value || 'focus_mode';
        node.dataset.rfCgTitle = (title || '').slice(0, 100);
        node.dataset.rfCgChannel = (channel || '').slice(0, 60);
        hiddenCount++;
        changed = true;
        if (settings.contentGuardDebugMode) {
          console.log('[RecallFox/CG] YT hidden:', { title: title.slice(0, 80), channel, reason: node.dataset.rfCgReason });
        }
      } else if (node.dataset.rfCgHidden !== '1') {
        // Hitung allowed hanya sekali per node
        allowedThisScan++;
      }
    }

    if (changed) {
      hideEmptyShelves();
    }
    panelStats.blocked = hiddenCount;
    panelStats.allowed = allowedThisScan;
    panelStats.lastScanAt = Date.now();
  }

  // ===== hideEmptyShelves (dipertahankan dari versi lama) =====
  // Sembunyikan shelf/section yang semua isinya sudah di-hidden.
  function hideEmptyShelves() {
    const shelfSelectors = [
      'ytd-rich-shelf-renderer',
      'ytd-shelf-renderer',
      'ytd-item-section-renderer',
      'ytd-rich-section-renderer'
    ];
    for (const sel of shelfSelectors) {
      let shelves;
      try { shelves = document.querySelectorAll(sel); }
      catch (e) { continue; }
      for (const shelf of shelves) {
        if (shelf.dataset.rfCgShelfHidden === '1') continue;
        const cards = shelf.querySelectorAll(
          'ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer'
        );
        if (cards.length === 0) continue;
        let hiddenInShelf = 0;
        for (const c of cards) {
          if (c.dataset.rfCgHidden === '1') hiddenInShelf++;
        }
        if (hiddenInShelf === cards.length) {
          shelf.style.setProperty('display', 'none', 'important');
          shelf.dataset.rfCgShelfHidden = '1';
        }
      }
    }
  }

  // ===== hideAllShorts (dipertahankan dari versi lama) =====
  // Sembunyikan SEMUA elemen YouTube Shorts: feed, sidebar, channel tab, dsb.
  function hideAllShorts() {
    const shortsSelectors = [
      'ytd-reel-item-renderer',
      'ytd-rich-shelf-renderer ytd-reel-item-renderer',
      'ytd-rich-section-renderer ytd-reel-item-renderer',
      'ytd-rich-shelf-renderer[is-shorts]',
      'ytd-rich-section-renderer[is-shorts]',
      'ytd-mini-guide-entry-renderer[aria-label*="Shorts"]',
      'ytd-guide-entry-renderer[aria-label*="Shorts"]',
      'a[title="Shorts"]',
      'yt-tab-shape[tab-title="Shorts"]',
      'tp-yt-paper-tab[aria-label*="Shorts"]',
      'ytd-rich-section-renderer:has(ytd-reel-item-renderer)',
      '.reel-video-renderer'
    ];
    let hiddenNow = 0;
    for (const sel of shortsSelectors) {
      let nodes;
      try { nodes = document.querySelectorAll(sel); }
      catch (e) { continue; }
      for (const node of nodes) {
        if (node.dataset.rfCgShortsHidden === '1') continue;
        node.style.setProperty('display', 'none', 'important');
        node.dataset.rfCgShortsHidden = '1';
        hiddenNow++;
      }
    }
    if (hiddenNow > 0 && settings?.contentGuardDebugMode) {
      console.log('[RecallFox/CG] hideAllShorts: hidden', hiddenNow, 'shorts elements');
    }
  }

  // ===== X (Twitter) selectors — DIPANGKAS (§5.1) =====
  // Cukup scan: article[data-testid="tweet"] + div[data-testid="tweetText"] + fallback article.
  // Hapus selector boros: div[data-testid="tweetText"] *, [lang], div[dir="auto"], span[dir="auto"].
  const X_TWEET_SELECTORS = [
    'article[data-testid="tweet"]',
    'div[data-testid="tweetText"]',
    'article'
  ];

  function getXTweetText(el) {
    // Hanya car tweetText di dalam article (atau el itu sendiri kalau tweetText).
    // Versi lama scan [lang], div[dir="auto"], span[dir="auto"] → terlalu boros.
    if (el.getAttribute && el.getAttribute('data-testid') === 'tweetText') {
      return (el.textContent || '').trim();
    }
    const nodes = el.querySelectorAll('[data-testid="tweetText"]');
    let txt = '';
    const seen = new Set();
    for (const n of nodes) {
      const t = (n.textContent || '').trim();
      if (t && !seen.has(t) && t.length > 2) {
        seen.add(t);
        txt += ' ' + t;
      }
    }
    if (!txt.trim()) txt = (el.textContent || '').trim();
    return txt.trim();
  }

  function getXTweetAuthor(el) {
    const userLinks = el.querySelectorAll('[data-testid="User-Name"] a[href], a[href*="/"]');
    for (const link of userLinks) {
      if (!link.href) continue;
      const m = link.href.match(/https:\/\/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})(?:$|\/|\?)/);
      if (m && !['home', 'explore', 'i', 'settings', 'notifications', 'messages',
                 'bookmarks', 'compose', 'search', 'login', 'signup'].includes(m[1].toLowerCase())) {
        return '@' + m[1];
      }
    }
    const allText = el.textContent || '';
    const m = allText.match(/@([A-Za-z0-9_]{1,15})/);
    return m ? m[0] : '';
  }

  // ===== hideXNegative: X TETAP blacklist (refactor performa) =====
  // Filter: keyword negatif (cache) + channel/akun blocklist (cache) + user blocklist
  // + URL post X blocklist. Tidak ada Mode Fokus allowlist untuk X (§4.7).
  function hideXNegative() {
    let changed = false;
    let allowedThisScan = 0;
    const MAX_NODES = 500;

    // Deduplikasi node via Set
    const allNodes = new Set();
    for (const sel of X_TWEET_SELECTORS) {
      let nodes;
      try { nodes = document.querySelectorAll(sel); }
      catch (e) { continue; }
      for (const n of nodes) {
        if (allNodes.size >= MAX_NODES) break;
        allNodes.add(n);
      }
      if (allNodes.size >= MAX_NODES) break;
    }

    for (const node of allNodes) {
      if (node.dataset.rfCgHidden === '1') continue;
      if (node.querySelector('[data-testid="placementTracking"]')) continue;
      // Hanya proses article ATAU tweetText yang parent article-nya belum di-hide.
      if (node.tagName !== 'ARTICLE' && !node.closest('article')) {
        if (node.getAttribute('data-testid') !== 'tweetText') continue;
      }

      const txt = getXTweetText(node);
      const author = getXTweetAuthor(node);

      // Extract URL post X dari article (link /<user>/status/<id>)
      let postUrl = '';
      try {
        const links = node.querySelectorAll('a[href*="/status/"]');
        for (const a of links) {
          const href = a.getAttribute('href') || '';
          if (/^\/[^/]+\/status\/\d+(?:\?|$)/.test(href)) {
            postUrl = location.protocol + '//' + location.hostname + href.split('?')[0];
            break;
          }
        }
      } catch (e) {}

      const negKw = containsNegative(txt);
      const blockedAcct = isChannelBlocked(author);
      const userBlk = matchesUserBlocklistLocal(txt, author);
      const urlBlk = postUrl ? matchesBlockedXPostUrlLocal(postUrl) : null;

      if (negKw || blockedAcct || userBlk || urlBlk) {
        let target = node;
        if (node.getAttribute('data-testid') === 'tweetText' && node.tagName !== 'ARTICLE') {
          const parentArticle = node.closest('article, div[data-testid="cellInnerDiv"]');
          if (parentArticle) target = parentArticle;
        }
        target.style.setProperty('display', 'none', 'important');
        target.dataset.rfCgHidden = '1';
        target.dataset.rfCgReason = negKw || blockedAcct || (userBlk?.entry?.value) || (urlBlk?.entry?.value) || 'unknown';
        target.dataset.rfCgTitle = (txt || '').slice(0, 100);
        target.dataset.rfCgChannel = (author || '').slice(0, 60);
        hiddenCount++;
        changed = true;
        if (settings.contentGuardDebugMode) {
          console.log('[RecallFox/CG] X hidden:', { text: txt.slice(0, 100), author, postUrl, reason: target.dataset.rfCgReason });
        }
      } else {
        allowedThisScan++;
      }
    }

    panelStats.blocked = hiddenCount;
    panelStats.allowed = allowedThisScan;
    panelStats.lastScanAt = Date.now();
  }

  // ===== Watch page handling (§4.5) =====
  // Pada /watch?v=* : cek judul video terhadap profil aktif.
  //  - strictWatch=true  → request background redirect ke home (CG_WATCH_STRICT_REDIRECT).
  //  - strictWatch=false → tampilkan overlay W4 non-blocking ("Kembali ke beranda" / "Tetap tonton" 30s).
  //  - Mode Fokus tidak aktif / profil kosong → tidak ada intervensi.
  function checkWatchPage() {
    if (!isYouTube) return;
    if (location.pathname !== '/watch') {
      // Bukan watch page → pastikan overlay dihapus
      removeWatchOverlay();
      lastWatchTitle = '';
      return;
    }
    if (!shouldRun()) { removeWatchOverlay(); return; }

    const profile = getActiveProfileLocal();
    if (!isProfileFilteringLocal(profile)) {
      removeWatchOverlay();
      return;
    }

    // Ambil judul video dari document.title (lebih reliable daripada ytd-watch-metadata).
    let title = '';
    try {
      title = document.title.replace(/\s*-\s*YouTube\s*$/i, '').trim();
    } catch (e) { title = ''; }
    if (!title) {
      // Coba fallback via ytd-watch-metadata h1
      try {
        const h1 = document.querySelector('ytd-watch-metadata h1 yt-formatted-string, h1.ytd-watch-metadata');
        if (h1) title = (h1.textContent || '').trim();
      } catch (e) {}
    }
    if (!title) return;  // judul belum ada — tunggu scan berikutnya

    // Cocok profil?
    const matches = matchesActiveProfileLocal(title, '', profileCache);
    if (matches) {
      removeWatchOverlay();
      lastWatchTitle = title;
      return;
    }

    // "Tetap tonton" 30 detik aktif?
    if (Date.now() < watchAllowUntil) {
      removeWatchOverlay();
      return;
    }

    // Judul sama dengan yang terakhir dievaluasi → jangan spam (overlay mungkin sudah tampil)
    if (title === lastWatchTitle && watchOverlayEl && document.documentElement.contains(watchOverlayEl)) {
      return;
    }
    lastWatchTitle = title;

    if (profile.strictWatch === true) {
      // Profil Anak — minta background redirect ke home (anti-spam 5 detik lokal).
      const now = Date.now();
      if (now - lastWatchStrictRequest > 5000) {
        lastWatchStrictRequest = now;
        try {
          browser.runtime.sendMessage({ type: 'CG_WATCH_STRICT_REDIRECT' }).catch(() => {});
        } catch (e) {}
      }
      return;
    }

    // Profil Saya — tampilkan overlay W4 non-blocking.
    showWatchOverlay(profile, title);
  }

  function showWatchOverlay(profile, title) {
    if (watchOverlayEl && document.documentElement.contains(watchOverlayEl)) return;
    try {
      const overlay = document.createElement('div');
      overlay.id = 'rf-cg-watch-overlay';
      overlay.style.cssText = [
        'position:fixed',
        'left:50%',
        'top:80px',
        'transform:translateX(-50%)',
        'z-index:2147483646',
        'max-width:560px',
        'width:calc(100% - 32px)',
        'background:linear-gradient(135deg,#1e293b,#0f172a)',
        'color:#f1f5f9',
        'border:1px solid #f59e0b',
        'border-radius:12px',
        'box-shadow:0 8px 32px rgba(0,0,0,0.45)',
        'padding:14px 18px',
        'font:600 13px/1.5 system-ui,-apple-system,sans-serif',
        'display:flex',
        'flex-direction:column',
        'gap:10px'
      ].join(' !important;') + ' !important';

      const emoji = profile.emoji || '👤';
      const name = profile.name || 'Profil';
      overlay.innerHTML =
        '<div style="font-size:14px;font-weight:700;color:#fbbf24;">⚠️ DI LUAR TOPIK AKTIF — '
        + escapeHtml(emoji + ' ' + name) + '</div>'
        + '<div style="font-size:12px;color:#cbd5e1;">Video ini tidak cocok dengan topik yang kamu fokuskan.</div>'
        + '<div style="display:flex;gap:8px;flex-wrap:wrap;">'
        +   '<button id="rf-cg-watch-back" style="background:#f59e0b;color:#000;border:none;padding:8px 14px;border-radius:6px;cursor:pointer;font-weight:700;font-size:12px;">🏠 Kembali ke beranda</button>'
        +   '<button id="rf-cg-watch-stay" style="background:transparent;color:#f1f5f9;border:1px solid #475569;padding:8px 14px;border-radius:6px;cursor:pointer;font-size:12px;">▶ Tetap tonton</button>'
        + '</div>';
      document.documentElement.appendChild(overlay);
      watchOverlayEl = overlay;

      const backBtn = overlay.querySelector('#rf-cg-watch-back');
      if (backBtn) backBtn.addEventListener('click', () => {
        location.href = 'https://www.youtube.com/';
      });
      const stayBtn = overlay.querySelector('#rf-cg-watch-stay');
      if (stayBtn) stayBtn.addEventListener('click', () => {
        watchAllowUntil = Date.now() + 30 * 1000;  // 30 detik
        removeWatchOverlay();
      });
    } catch (e) {
      console.warn('[RecallFox/CG] showWatchOverlay error:', e.message);
    }
  }

  function removeWatchOverlay() {
    if (watchOverlayEl && document.documentElement.contains(watchOverlayEl)) {
      try { watchOverlayEl.remove(); } catch (e) {}
    }
    watchOverlayEl = null;
  }

  // ===== escapeHtml (kecil — dipakai overlay watch W4 saja) =====
  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // ===== MutationObserver + interval fallback (performa §5.2) =====
  // Throttle interval ≥ 1500 ms (sebelumnya 500 ms).
  // Debounce MutationObserver ≥ 250 ms (sebelumnya 150 ms).
  // Skip seluruh scan saat document.hidden === true.
  let observer = null;
  function startObserver() {
    if (observer) return;
    observer = new MutationObserver(() => { scheduleScan(); });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: false,
      characterData: false
    });
    if (!intervalTimer) {
      intervalTimer = setInterval(() => { scheduleScan(); }, 1500);
    }
  }

  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      // Skip seluruh scan saat tab di background (§5.2)
      if (document.hidden === true) return;
      try {
        if (isYouTube) { hideYouTubeByFocus(); checkWatchPage(); }
        if (isX) hideXNegative();
      } catch (e) {
        console.warn('[RecallFox/CG] scan error:', e);
      }
    }, 250);  // debounce 250 ms
  }

  function stopObserver() {
    if (observer) { observer.disconnect(); observer = null; }
    if (intervalTimer) { clearInterval(intervalTimer); intervalTimer = null; }
    if (scanTimer) { clearTimeout(scanTimer); scanTimer = null; }
  }

  // ===== Track hovered element untuk context menu "Blokir Konten Ini" =====
  // Dipertahankan dari versi lama (§4.7 — context menu tetap aktif).
  document.addEventListener('mouseover', (e) => {
    const card = e.target.closest(
      YT_VIDEO_SELECTORS.join(', ') + ', ' + X_TWEET_SELECTORS.join(', ') + ', article'
    );
    hoveredElement = card || null;
  }, true);

  // ===== Deteksi platform =====
  let isYouTube = false;
  let isX = false;
  function detectPlatform() {
    const host = location.hostname.toLowerCase();
    isYouTube = host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com');
    isX = host.endsWith('twitter.com') || host.endsWith('x.com');
  }

  function injectHideCSS() {
    const cssId = 'rf-cg-hide-css';
    if (document.getElementById(cssId)) return;
    const style = document.createElement('style');
    style.id = cssId;
    // Hide via attribute selector + !important (flicker fix YouTube recycle DOM).
    style.textContent = `
      [data-rf-cg-hidden="1"] { display: none !important; }
      [data-rf-cg-shelf-hidden="1"] { display: none !important; }
      [data-rf-cg-shorts-hidden="1"] { display: none !important; }
    `;
    document.documentElement.appendChild(style);
  }

  // ===== Auto-reload settings setiap 5 detik (defensive, lebih lambat dari versi lama) =====
  // Kalau CG_SETTINGS_UPDATED broadcast miss, settings tetap ke-update via polling.
  let settingsReloadTimer = null;
  function startSettingsPolling() {
    if (settingsReloadTimer) return;
    settingsReloadTimer = setInterval(async () => {
      const prev = JSON.stringify(settings);
      const ok = await loadSettings();
      if (!ok) return;
      const now = JSON.stringify(settings);
      if (prev !== now) {
        console.log('[RecallFox/CG] Settings changed (detected via polling) — re-scanning');
        resetHiddenFlags();
        if (isYouTube) { hideYouTubeByFocus(); checkWatchPage(); }
        if (isX) hideXNegative();
      }
    }, 5000);
  }

  // Reset semua flag hide (dipakai saat settings berubah / CG_RESCAN_NOW).
  function resetHiddenFlags() {
    document.querySelectorAll('[data-rf-cg-hidden="1"]').forEach(el => {
      el.style.removeProperty('display');
      delete el.dataset.rfCgHidden;
      delete el.dataset.rfCgReason;
      delete el.dataset.rfCgTitle;
      delete el.dataset.rfCgChannel;
      delete el.dataset.rfCgFocusHash;
    });
    document.querySelectorAll('[data-rf-cg-shelf-hidden="1"]').forEach(el => {
      el.style.removeProperty('display');
      delete el.dataset.rfCgShelfHidden;
    });
    document.querySelectorAll('[data-rf-cg-shorts-hidden="1"]').forEach(el => {
      el.style.removeProperty('display');
      delete el.dataset.rfCgShortsHidden;
    });
    hiddenCount = 0;
  }

  async function init() {
    detectPlatform();
    if (!isYouTube && !isX) return;
    console.log('[RecallFox/CG] Initializing on', isYouTube ? 'YouTube' : 'X', 'at', location.href);

    const ok = await loadSettings();
    if (!ok) {
      console.warn('[RecallFox/CG] Failed to load settings on init — Pelindung Konten TIDAK AKTIF');
      return;
    }
    if (!shouldRun()) {
      console.log('[RecallFox/CG] Master OFF — Pelindung Konten MATI');
      return;
    }
    injectHideCSS();
    // Initial sweep
    if (isYouTube) { hideYouTubeByFocus(); checkWatchPage(); }
    if (isX) hideXNegative();
    startObserver();
    startSettingsPolling();
    console.log('[RecallFox/CG] Pelindung Konten AKTIF di', isYouTube ? 'YouTube' : 'X',
      '| Mode Fokus:', focusModeActive() ? 'ON' : 'OFF',
      '| X-keywords:', (keywordCache || []).length,
      '| user blocklist:', getUserBlocklist().length);
  }

  // ===== Handler message dari background =====
  browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return;

    // Ping handler — supaya background bisa cek apakah content script sudah ter-load
    if (msg?.type === 'CG_PING') {
      sendResponse({
        ok: true,
        platform: isYouTube ? 'youtube' : (isX ? 'x' : 'unknown'),
        hiddenCount,
        focusModeActive: focusModeActive()
      });
      return false;
    }

    if (msg?.type === 'CG_SETTINGS_UPDATED') {
      loadSettings().then(() => {
        if (!shouldRun()) {
          stopObserver();
          resetHiddenFlags();
          removeWatchOverlay();
        } else {
          resetHiddenFlags();
          startObserver();
          if (isYouTube) { hideYouTubeByFocus(); checkWatchPage(); }
          if (isX) hideXNegative();
        }
      });
      return false;
    }

    if (msg?.type === 'CG_RESCAN_NOW') {
      resetHiddenFlags();
      if (isYouTube) { hideYouTubeByFocus(); checkWatchPage(); }
      if (isX) hideXNegative();
      return false;
    }

    if (msg?.type === 'CG_PAUSE_FEED_FILTER') {
      stopObserver();
      return false;
    }
    if (msg?.type === 'CG_RESUME_FEED_FILTER') {
      if (shouldRun()) startObserver();
      return false;
    }

    // CG_GET_CONTEXT_FOR_BLOCK — dipakai context menu "Blokir Konten Ini" (dipertahankan).
    if (msg?.type === 'CG_GET_CONTEXT_FOR_BLOCK') {
      const menuItemId = msg.menuItemId;
      const selectionText = msg.selectionText || '';

      let targetEl = hoveredElement;
      if (!targetEl) {
        const sel = window.getSelection();
        if (sel && sel.anchorNode) {
          targetEl = (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement)
            ?.closest(YT_VIDEO_SELECTORS.join(', ') + ', ' + X_TWEET_SELECTORS.join(', ') + ', article');
        }
      }

      let title = '';
      let channel = '';
      let value = '';

      if (targetEl) {
        if (isYouTube) {
          title = getYouTubeTitle(targetEl);
          channel = getYouTubeChannel(targetEl);
        } else if (isX) {
          title = getXTweetText(targetEl);
          channel = getXTweetAuthor(targetEl);
        }
      }

      if (menuItemId === 'rf-cg-block-title') {
        value = title;
      } else if (menuItemId === 'rf-cg-block-exact-title') {
        value = title;
      } else if (menuItemId === 'rf-cg-block-channel') {
        value = channel;
      } else if (menuItemId === 'rf-cg-block-keyword') {
        value = selectionText || title;
      }

      sendResponse({
        value: (value || '').trim().slice(0, 300),
        title,
        channel,
        platform: isYouTube ? 'youtube' : (isX ? 'x' : 'unknown')
      });
      return true;
    }
  });

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
