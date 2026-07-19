// lib/kidsafe-sites.js — Daftar situs ramah anak (game + video edukasi)
// RecallFox v3.11.2 (Issue 3: ganti "kotak ijo" dengan daftar situs ramah anak)
//
// Kriteria kurasi:
//   - Gratis (atau punya tier gratis yang substantial)
//   - Tidak wajib login untuk akses konten utama
//   - Konten edukasi / hiburan sehat untuk anak
//   - Bahasa Indonesia atau Inggris
//
// User bisa: tambah, hapus, hide, pin site sendiri via UI.
// Setting disimpan di storage.local sebagai patch (custom add/delete) + effective list.

const KIDSAFE_KEY = 'recallfox_kidsafe_sites';

// ===== Curated default list =====
// Format: { id, name, url, lang ('id'|'en'), category ('game'|'video'|'learn'|'read'), description, noLogin: true }

export const DEFAULT_KIDSAFE_SITES = [
  // === Indonesia ===
  { id: 'wardayaacademy', name: 'Wardaya Academy', url: 'https://wardayaacademy.org', lang: 'id', category: 'learn', description: 'Video pelajaran gratis SD/SMP/SMA sesuai kurikulum Indonesia', noLogin: true },
  { id: 'ruangguru-learn', name: 'Ruangguru (Free Content)', url: 'https://ruangguru.com/blog/ruangguru-belajar-gratis', lang: 'id', category: 'learn', description: 'Artikel & video belajar gratis', noLogin: true },
  { id: 'dummetschool', name: 'Dumet School', url: 'https://dumetschool.com', lang: 'id', category: 'learn', description: 'Tutorial digital kreatif untuk anak', noLogin: true },
  { id: 'kombak', name: 'Kombak.id', url: 'https://kombak.id', lang: 'id', category: 'game', description: 'Game edukasi budaya Indonesia', noLogin: true },
  { id: 'nusalontar', name: 'Nusa Lontar', url: 'https://nusalontar.id', lang: 'id', category: 'read', description: 'Cerita rakyat Nusantara interaktif', noLogin: true },
  { id: 'tokopedia-play', name: 'Tokopedia Play Kids', url: 'https://play.tokopedia.com', lang: 'id', category: 'video', description: 'Video edukasi anak', noLogin: false },
  // === English — Games ===
  { id: 'pbskids', name: 'PBS Kids', url: 'https://pbskids.org', lang: 'en', category: 'game', description: 'Game + video edukasi dari PBS (Sesame Street, Curious George)', noLogin: true },
  { id: 'coolmathgames', name: 'Cool Math Games', url: 'https://coolmathgames.com', lang: 'en', category: 'game', description: 'Game puzzle & logika gratis', noLogin: true },
  { id: 'abcya', name: 'ABCya!', url: 'https://abcya.com', lang: 'en', category: 'game', description: 'Game edukasi K-6 (matematika, bahasa, sains)', noLogin: true },
  { id: 'funbrain', name: 'Funbrain', url: 'https://funbrain.com', lang: 'en', category: 'game', description: 'Game + buku + video untuk PreK-8', noLogin: true },
  { id: 'sheppardsoftware', name: 'Sheppard Software', url: 'https://sheppardsoftware.com', lang: 'en', category: 'game', description: 'Game edukasi sains, geografi, matematika, bahasa', noLogin: true },
  { id: 'turtlediary', name: 'Turtle Diary', url: 'https://turtlediary.com', lang: 'en', category: 'game', description: 'Game + video + worksheet untuk anak', noLogin: true },
  { id: 'nationalgeographickids', name: 'National Geographic Kids', url: 'https://kids.nationalgeographic.com', lang: 'en', category: 'learn', description: 'Game, video, dan artikel tentang hewan & sains', noLogin: true },
  { id: 'switchzoo', name: 'Switch Zoo', url: 'https://switchzoo.com', lang: 'en', category: 'game', description: 'Game hewan & habitat edukatif', noLogin: true },
  { id: 'seussville', name: 'Seussville', url: 'https://seussville.com', lang: 'en', category: 'game', description: 'Game + aktivitas dari Dr. Seuss', noLogin: true },
  // === English — Video ===
  { id: 'khanacademy-kids', name: 'Khan Academy Kids', url: 'https://khankids.org', lang: 'en', category: 'video', description: 'App/video pembelajaran gratis untuk anak 2-8 tahun', noLogin: true },
  { id: 'crashcourse-kids', name: 'Crash Course Kids', url: 'https://thecrashcourse.com/topic/kids', lang: 'en', category: 'video', description: 'Video sains & sosial grade school', noLogin: true },
  { id: 'scishow-kids', name: 'SciShow Kids', url: 'https://youtube.com/@SciShowKids', lang: 'en', category: 'video', description: 'Channel YouTube sains untuk anak', noLogin: true },
  { id: 'peekaboo-kidz', name: 'Peekaboo Kidz', url: 'https://youtube.com/@PeekabooKidz', lang: 'en', category: 'video', description: 'Dr. Binocs sains untuk anak', noLogin: true },
  { id: 'turtlediary-vid', name: 'Turtle Diary Videos', url: 'https://turtlediary.com/videos.html', lang: 'en', category: 'video', description: 'Video edukasi pendek', noLogin: true },
  // === English — Learn ===
  { id: 'khanacademy', name: 'Khan Academy', url: 'https://khanacademy.org', lang: 'en', category: 'learn', description: 'Pembelajaran gratis matematika, sains, ekonomi', noLogin: true },
  { id: 'code-org', name: 'Code.org', url: 'https://code.org/student/elementary', lang: 'en', category: 'learn', description: 'Belajar coding untuk anak', noLogin: true },
  { id: 'scratch', name: 'Scratch', url: 'https://scratch.mit.edu', lang: 'en', category: 'learn', description: 'Buat game & animasi dengan block coding', noLogin: true },
  { id: 'duolingo', name: 'Duolingo', url: 'https://duolingo.com', lang: 'en', category: 'learn', description: 'Belajar bahasa secara interaktif', noLogin: false },
  { id: 'tynker', name: 'Tynker', url: 'https://tynker.com', lang: 'en', category: 'learn', description: 'Coding untuk anak (block + Python)', noLogin: false },
  // === English — Reading ===
  { id: 'storylineonline', name: 'Storyline Online', url: 'https://storylineonline.net', lang: 'en', category: 'read', description: 'Buku cerita dibacakan aktor Hollywood', noLogin: true },
  { id: 'internationalchildrens', name: 'International Children\'s Library', url: 'https://en.childrenslibrary.org', lang: 'en', category: 'read', description: 'Buku anak gratis dalam berbagai bahasa', noLogin: true },
  { id: 'oxfordowl', name: 'Oxford Owl (Free)', url: 'https://oxfordowl.co.uk/for-home/find-a-book/library-page', lang: 'en', category: 'read', description: 'E-book gratis dari Oxford', noLogin: false }
];

// ===== Custom sites management =====

export async function getKidSafeSitesCustom() {
  const data = await browser.storage.local.get(KIDSAFE_KEY);
  return data[KIDSAFE_KEY] || { hidden: [], pinned: [], customAdds: [], customDeletes: [] };
}

export async function saveKidSafeSitesCustom(custom) {
  await browser.storage.local.set({ [KIDSAFE_KEY]: custom });
}

// Get effective list: default + custom adds - deletes, with pinned/hidden flags
export async function getEffectiveKidSafeSites() {
  const custom = await getKidSafeSitesCustom();
  // Start with defaults
  let list = [...DEFAULT_KIDSAFE_SITES];
  // Add custom
  for (const add of (custom.customAdds || [])) {
    if (!list.find(s => s.id === add.id)) list.push(add);
  }
  // Remove deleted
  list = list.filter(s => !(custom.customDeletes || []).includes(s.id));
  // Mark hidden + pinned
  for (const s of list) {
    s.hidden = (custom.hidden || []).includes(s.id);
    s.pinned = (custom.pinned || []).includes(s.id);
  }
  // Sort: pinned first, then alphabetical by name
  list.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return list;
}

export async function toggleHideSite(id) {
  const custom = await getKidSafeSitesCustom();
  custom.hidden = custom.hidden || [];
  if (custom.hidden.includes(id)) {
    custom.hidden = custom.hidden.filter(i => i !== id);
  } else {
    custom.hidden.push(id);
  }
  await saveKidSafeSitesCustom(custom);
  return getEffectiveKidSafeSites();
}

export async function togglePinSite(id) {
  const custom = await getKidSafeSitesCustom();
  custom.pinned = custom.pinned || [];
  if (custom.pinned.includes(id)) {
    custom.pinned = custom.pinned.filter(i => i !== id);
  } else {
    custom.pinned.push(id);
  }
  await saveKidSafeSitesCustom(custom);
  return getEffectiveKidSafeSites();
}

export async function deleteSite(id) {
  const custom = await getKidSafeSitesCustom();
  // If it's a custom add, remove from customAdds
  if ((custom.customAdds || []).find(s => s.id === id)) {
    custom.customAdds = custom.customAdds.filter(s => s.id !== id);
  } else {
    // Mark default as deleted
    custom.customDeletes = custom.customDeletes || [];
    if (!custom.customDeletes.includes(id)) {
      custom.customDeletes.push(id);
    }
  }
  // Also remove from hidden/pinned
  custom.hidden = (custom.hidden || []).filter(i => i !== id);
  custom.pinned = (custom.pinned || []).filter(i => i !== id);
  await saveKidSafeSitesCustom(custom);
  return getEffectiveKidSafeSites();
}

export async function addCustomSite({ name, url, lang = 'en', category = 'learn', description = '' }) {
  if (!name || !url) throw new Error('name and url required');
  const custom = await getKidSafeSitesCustom();
  const id = 'custom_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
  const site = { id, name, url, lang, category, description, noLogin: false, isCustom: true };
  custom.customAdds = custom.customAdds || [];
  custom.customAdds.push(site);
  await saveKidSafeSitesCustom(custom);
  return getEffectiveKidSafeSites();
}

export async function resetKidSafeSites() {
  await browser.storage.local.remove(KIDSAFE_KEY);
  return getEffectiveKidSafeSites();
}
