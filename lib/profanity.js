// lib/profanity.js — Filter kata kasar Indonesia (mode "nuclear" untuk anak)
// RecallFox v3.11.2 (Issue 2: ganti "mode anak (filter konten)" dengan nuclear profanity filter)
//
// Mode ini MEMBLOKIR konten yang mengandung kata-kata kasar yang sering muncul di konten
// sampah yang menargetkan anak-anak (gaming, YouTube Kids bypass, dll.).
//
// Berbeda dengan contentGuardNuclearMode (yang blokir politisi/partai), mode ini fokus
// ke kata kasar: anjir, cok, bangsat, kontol, memek, dsb.

// Daftar kata kasar Indonesia (umum + variasi leet/typo)
// Di-normalize: lowercase, strip diacritics, replace leet (0→o, 1→i, 3→e, 4→a, 5→s, 7→t)
export const DEFAULT_PROFANITY_WORDS = [
  // === Variasi anjir / anjing ===
  'anjir', 'anjing', 'anjg', 'anjeng', 'anjimg', 'anj1r', 'anj1ng', '4njir', '4njing',
  'asu', 'asuU', '4su', '4s1n',
  // === Variasi bangsat ===
  'bangsat', 'bangsad', 'bgsat', 'b4ngsat', 'bangs4t', 'b4ngs4t',
  // === Variasi brengsek ===
  'brengsek', 'bngsek', 'brengs3k', 'br3ngsek',
  // === Variasi cok / cokk ===
  'cok', 'cokk', 'c0k', 'c0kk', 'jancok', 'jancokk', 'j4ncok', 'dancok', 'cokk',
  // === Variasi kontol ===
  'kontol', 'kntl', 'k0ntol', 'k0nt0l', 'kont0l', 'k3nt0l',
  // === Variasi memek ===
  'memek', 'mmk', 'm3mek', 'm3m3k', 'mem3k', 'mmek',
  // === Variasi ngentot ===
  'ngentot', 'ngentod', 'ngntot', 'ngntod', 'ng3ntot', 'ng3nt0d',
  // === Variasi pepek ===
  'pepek', 'ppk', 'p3pek', 'p3p3k', 'pep3k',
  // === Variasi titit ===
  'titit', 'ttt', 't1t1t', 't1tit',
  // === Variasi setan / iblis (slang) ===
  'setan', 'iblis', 's4tan',
  // === Variasi bajingan ===
  'bajingan', 'bjingan', 'b4jingan', 'baj1ngan',
  // === Variasi kafir (jika dipakai sebagai hinaan) ===
  'kafir', 'k4fir',
  // === Variasi tolol / bodoh (kasar) ===
  'tolol', 'tll', 't0l0l', 't0lol', 'tol0l',
  'bodoh', 'b0doh', 'bod0h',
  'goblok', 'goblog', 'gblg', 'gbl0g', 'g0bl0g', 'g0blok',
  // === Variasi bencong / banci (hinaan gender) ===
  'banci', 'b4nci', 'banc1',
  'bencong', 'b3nc0ng', 'benc0ng',
  // === Variasi japri / jap / pelacur ===
  'pelacur', 'placur', 'p3lacur', 'p3l4cur',
  'lonte', 'l0nte', 'lont3',
  // === Variasi ngewe ===
  'ngewe', 'ng3w3', 'ngew3',
  // === Variasi bokep ===
  'bokep', 'b0kep', 'bok3p',
  // === Variasi perek ===
  'perek', 'p3r3k', 'per3k',
  // === Tambahan slang kasar ===
  'jembut', 'j3mbut', 'jembut',
  'pantek', 'p4ntek', 'pant3k',
  'kerdil', 'k3rdil',
  'katro', 'k4tro',
  // === Singkatan slang umum ===
  'ktl', 'mmk', 'ppk', 'ttk', 'bgst', 'anj', 'ktl', 'jck', 'bncng'
];

// Normalize text: lowercase + strip diacritics + replace leet
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
  // Remove non-alphanumeric (untuk catch "an-jir" → "anjir")
  s = s.replace(/[^a-z]/g, '');
  return s;
}

// Build set of normalized profanity words
let normalizedSet = null;
function getNormalizedSet() {
  if (normalizedSet) return normalizedSet;
  normalizedSet = new Set(DEFAULT_PROFANITY_WORDS.map(normalizeProfanity));
  return normalizedSet;
}

// Check if text contains profanity
export function containsProfanity(text) {
  if (!text) return false;
  const normalized = normalizeProfanity(text);
  const set = getNormalizedSet();
  // Check exact substring match (normalized) — fast
  for (const word of set) {
    if (normalized.includes(word)) return true;
  }
  return false;
}

// Mask profanity in text with asterisks
export function maskProfanity(text) {
  if (!text) return text;
  let result = String(text);
  for (const word of DEFAULT_PROFANITY_WORDS) {
    // Build regex case-insensitive, match word boundaries OR with leet variations
    // Simple approach: replace exact word (case-insensitive) with asterisks of same length
    const re = new RegExp('\\b' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
    result = result.replace(re, match => '*'.repeat(match.length));
  }
  return result;
}

// Reset cache (untuk testing)
export function _resetCache() {
  normalizedSet = null;
}
