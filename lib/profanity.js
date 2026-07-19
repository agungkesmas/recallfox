// lib/profanity.js — Filter kata kasar Indonesia (mode "nuclear" untuk anak)
// RecallFox v3.11.2 (Issue 2: ganti "mode anak (filter konten)" dengan nuclear profanity filter)
// v3.11.2-fix (Sesi 3): REWRITE — fix 3 bug kritis:
//   1. False positive massive: 'asu' match "Basuki", 'anj' match "Anjuran", 'cok' match "Coklat"
//      → hanya pakai kata dengan length >= 4 + word boundary regex
//   2. Hapus 'setan', 'iblis', 'kafir' — muncul di konten islami anak (cerita nabi, dongeng)
//   3. Hapus singkatan 3-huruf ('anj', 'asu', 'cok', 'mmk', 'ttk', 'ppk', 'jck', 'bncng')
//      → terlalu pendek, false positive tinggi
//
// Mode ini MEMBLOKIR konten yang mengandung kata-kata kasar yang sering muncul di konten
// sampah yang menargetkan anak-anak (gaming, YouTube Kids bypass, dll.).
//
// Berbeda dengan contentGuardNuclearMode (yang blokir politisi/partai), mode ini fokus
// ke kata kasar: anjir, cok, bangsat, kontol, memek, dsb.

// Daftar kata kasar Indonesia (umum + variasi leet/typo)
// v3.11.2-fix: Hanya kata dengan length >= 4 (setelah normalize) untuk minim false positive.
// Singkatan 3-huruf yang ambigu (asu, anj, cok, mmk, ttk, ppk, jck, bncng) dihapus.
// Kata 'setan', 'iblis', 'kafir' dihapus karena muncul di konten islami anak.
export const DEFAULT_PROFANITY_WORDS = [
  // === Variasi anjir / anjing (length >= 4) ===
  'anjir', 'anjing', 'anjeng', 'anjimg', 'anj1r', 'anj1ng', '4njir', '4njing',
  // asu dihapus — terlalu pendek, false positive di "Basuki", "Lasut", "Tasik"
  // === Variasi bangsat ===
  'bangsat', 'bangsad', 'bgsat', 'b4ngsat', 'bangs4t', 'b4ngs4t',
  // === Variasi brengsek ===
  'brengsek', 'bngsek', 'brengs3k', 'br3ngsek',
  // === Variasi jancok / cokk (length >= 4) ===
  // cok dihapus — false positive di "coklat"
  'jancok', 'jancokk', 'j4ncok', 'dancok', 'coklat' === 'coklat' ? null : null, // placeholder, removed below
  'jancok', 'jancokk', 'j4ncok', 'dancok',
  // === Variasi kontol ===
  'kontol', 'kntl', 'k0ntol', 'k0nt0l', 'kont0l', 'k3nt0l',
  // === Variasi memek ===
  'memek', 'm3mek', 'm3m3k', 'mem3k', 'mmek',
  // === Variasi ngentot ===
  'ngentot', 'ngentod', 'ngntot', 'ngntod', 'ng3ntot', 'ng3nt0d',
  // === Variasi pepek ===
  'pepek', 'p3pek', 'p3p3k', 'pep3k',
  // === Variasi titit ===
  'titit', 't1t1t', 't1tit',
  // setan, iblis DIHAPUS — muncul di konten islami anak (cerita nabi, dongeng)
  // === Variasi bajingan ===
  'bajingan', 'bjingan', 'b4jingan', 'baj1ngan',
  // kafir DIHAPUS — kata ini juga muncul di konten islami
  // === Variasi tolol / bodoh (kasar) ===
  'tolol', 'tll', 't0l0l', 't0lol', 'tol0l',
  'goblok', 'goblog', 'gblg', 'gbl0g', 'g0bl0g', 'g0blok',
  // bodoh dihapus — terlalu umum, sering dipakai konteks non-hinaan
  // === Variasi bencong / banci (hinaan gender) ===
  'banci', 'b4nci', 'banc1',
  'bencong', 'b3nc0ng', 'benc0ng',
  // === Variasi pelacur / lonte ===
  'pelacur', 'placur', 'p3lacur', 'p3l4cur',
  'lonte', 'l0nte', 'lont3',
  // === Variasi ngewe ===
  'ngewe', 'ng3w3', 'ngew3',
  // === Variasi bokep ===
  'bokep', 'b0kep', 'bok3p',
  // === Variasi perek ===
  'perek', 'p3r3k', 'per3k',
  // === Tambahan slang kasar ===
  'jembut', 'j3mbut',
  'pantek', 'p4ntek', 'pant3k',
  'kerdil', 'k3rdil',
  // katro dihapus — bukan kata kasar, hanya slang
  // === Singkatan slang umum (length >= 4) ===
  'bgst', 'ktl' === 'ktl' ? null : null, // placeholder
].filter(Boolean); // remove nulls from placeholder logic

// Normalize text: lowercase + strip diacritics + replace leet
// Returns normalized string WITH spaces preserved (for word boundary matching)
export function normalizeProfanity(text) {
  if (!text) return '';
  let s = String(text).toLowerCase();
  // Strip diacritics
  s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  // Replace leet-speak
  s = s
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
    .replace(/9/g, 'g')
    .replace(/\$/g, 's')
    .replace(/@/g, 'a')
    .replace(/\+/g, 't')
    .replace(/!/g, 'i');
  // v3.11.2-fix: JANGAN hapus non-alpha (seperti versi lama).
  // Hapus non-alpha HANYA di sekitar kata untuk word-boundary matching,
  // tapi preserve word boundaries. Konversi non-alpha ke spasi.
  s = s.replace(/[^a-z]+/g, ' ');
  return s;
}

// Build set of normalized profanity words (cached)
let normalizedSet = null;
let normalizedArray = null;
function getNormalized() {
  if (normalizedSet && normalizedArray) return { set: normalizedSet, arr: normalizedArray };
  normalizedArray = DEFAULT_PROFANITY_WORDS.map(normalizeProfanity).filter(w => w.length >= 4);
  normalizedSet = new Set(normalizedArray);
  return { set: normalizedSet, arr: normalizedArray };
}

// Check if text contains profanity.
// v3.11.2-fix: Pakai word-boundary regex supaya 'asu' tidak match 'Basuki'.
// Word boundary di sini = spasi atau start/end string (setelah normalizeProfanity).
export function containsProfanity(text) {
  if (!text) return false;
  const normalized = ' ' + normalizeProfanity(text) + ' ';
  const { arr } = getNormalized();
  // Check each word with word boundaries (space-delimited)
  for (const word of arr) {
    // Word boundary: spasi sebelum dan sesudah, atau start/end string
    const idx = normalized.indexOf(' ' + word + ' ');
    if (idx >= 0) return true;
  }
  return false;
}

// Mask profanity in text with asterisks.
// v3.11.2-fix: Hanya replace word dengan boundary, bukan substring.
// Hanya replace text node (tidak hapus children element).
export function maskProfanity(text) {
  if (!text) return text;
  let result = String(text);
  const { arr } = getNormalized();
  // Sort by length descending supaya kata lebih panjang di-replace dulu
  // (mis. "bangsat" sebelum "bangsa")
  const sorted = [...arr].sort((a, b) => b.length - a.length);
  for (const word of sorted) {
    // Build regex case-insensitive dengan word boundary.
    // Karena normalizeProfanity sudah konversi non-alpha ke spasi,
    // di sini kita match case-insensitive terhadap text asli + leet variations.
    // Untuk simplicity, kita match normalized word terhadap normalized text.
    // Tapi karena text yang masuk ke maskProfanity adalah text asli (bukan normalized),
    // kita perlu pattern yang flexible.
    // Pattern: word boundary + leet variations + word boundary
    const pattern = buildLeetPattern(word);
    if (pattern) {
      try {
        const re = new RegExp('\\b' + pattern + '\\b', 'gi');
        result = result.replace(re, match => '*'.repeat(match.length));
      } catch (e) {
        // Skip kalau pattern invalid
      }
    }
  }
  return result;
}

// Build regex pattern that matches word with common leet variations
function buildLeetPattern(word) {
  if (!word) return null;
  // Map char → char class (leet variations)
  const leetMap = {
    'a': '[a4@]',
    'b': '[b8]',
    'e': '[e3]',
    'g': '[g9]',
    'i': '[i1!]',
    'o': '[o0]',
    's': '[s$5]',
    't': '[t7+]'
  };
  let pattern = '';
  for (const ch of word) {
    pattern += leetMap[ch] || ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return pattern;
}

// Reset cache (untuk testing)
export function _resetCache() {
  normalizedSet = null;
  normalizedArray = null;
}
