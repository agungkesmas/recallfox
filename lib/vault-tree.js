// lib/vault-tree.js — Vault tree/grouping helpers (v3.17.1)
//
// Menyediakan grouping untuk vault items. Item bisa dikelompokkan ke "group"
// (parent node), dengan DnD untuk pindahkan item antar grup.
//
// Schema (di item.source JSONB — backward compatible, no ALTER TABLE):
//   source.parentId: string | null   (ID group induk, null = top-level)
//   source.isGroup: boolean          (true = ini node group)
//   source.order: number             (urutan dalam parent, default 0)
//
// Item lama (tanpa source.parentId) = top-level → tidak ada breaking change.

// ============================================================================
// Helpers — baca/tulis field group dari item
// ============================================================================

export function getParentId(item) {
  return item?.source?.parentId || null;
}

export function setIsGroup(item, val) {
  if (!item.source) item.source = {};
  item.source.isGroup = !!val;
}

export function getIsGroup(item) {
  return !!(item?.source?.isGroup);
}

export function setParentId(item, parentId) {
  if (!item.source) item.source = {};
  item.source.parentId = parentId || null;
}

export function getOrder(item) {
  return item?.source?.order || 0;
}

export function setOrder(item, order) {
  if (!item.source) item.source = {};
  item.source.order = order || 0;
}

// ============================================================================
// buildTree — flat items → grouped structure
// ============================================================================
//
// Returns array of nodes, each node is either:
//   { kind: 'item', item: <vault item> }
//   { kind: 'group', group: <vault item dengan isGroup=true>, children: [...nodes] }
//
// Order: groups first (urut by name), then items (urut by title).
// Children di-sort by source.order, fallback by title.
//
// Item yang parentId-nya tidak ditemukan (orphan) → top-level.
//
// v3.17.4: categoryFilter — kalau di-set (mis. 'link'), filter group + children
//   berdasarkan tipe item. Group hanya tampil kalau punya child dengan tipe tsb.
//   Top-level items juga di-filter sesuai kategori (kecuali group).
//   Null/undefined = tampilkan semua (mode "Semua").

export function buildTree(items, expandedGroupIds = [], categoryFilter = null, showGroups = true) {
  if (!Array.isArray(items)) return [];

  // v3.17.6: Kalau showGroups=false (mis. tab "Semua"), treat semua group sebagai
  // item biasa (flat list). Group header tetap tampil sebagai item, tapi children
  // di-flatten ke top-level (tidak nested).
  if (!showGroups) {
    // Flat mode: semua item (termasuk group) tampil sebagai top-level item.
    // Group tidak dirender sebagai collapsible header, children tidak di-indent.
    // Tapi children group tetap tampil sebagai item top-level terpisah.
    const flatItems = [];
    const groupIds = new Set(items.filter(it => getIsGroup(it)).map(g => g.id));
    for (const it of items) {
      if (getIsGroup(it)) {
        // Group → tampilkan sebagai item biasa (tidak collapsible)
        flatItems.push({ kind: 'item', item: it });
      } else {
        // Item (termasuk child group) → tampilkan sebagai top-level
        flatItems.push({ kind: 'item', item: it });
      }
    }
    // Sort by title
    flatItems.sort((a, b) => (a.item.title || '').localeCompare(b.item.title || '', 'id'));
    return flatItems;
  }

  // Pisahkan: groups vs items vs top-level vs children
  const groups = items.filter(it => getIsGroup(it));
  const groupIds = new Set(groups.map(g => g.id));

  // Validasi parentId — kalau tidak ada di groupIds, anggap top-level (orphan)
  const topLevelItems = [];
  const topLevelGroups = [];
  const childrenByParent = new Map(); // parentId -> [items]

  for (const it of items) {
    const pid = getParentId(it);
    if (!pid || !groupIds.has(pid)) {
      // Top-level
      if (getIsGroup(it)) topLevelGroups.push(it);
      else topLevelItems.push(it);
    } else {
      // Child
      if (!childrenByParent.has(pid)) childrenByParent.set(pid, []);
      childrenByParent.get(pid).push(it);
    }
  }

  // v3.17.4: Category scope filter
  // Kalau categoryFilter di-set (mis. 'link'), filter top-level items by type.
  // Group hanya tampil kalau punya minimal 1 child dengan tipe tsb.
  if (categoryFilter) {
    // Helper: cek apakah tipe cocok dengan categoryFilter
    // 'screenshot' chip = screenshot + document (sesuai chipCount logic)
    const matchesCategory = (it) => {
      if (categoryFilter === 'screenshot') {
        return it.type === 'screenshot' || it.type === 'document';
      }
      return it.type === categoryFilter;
    };

    // Filter top-level items
    const filteredTopItems = topLevelItems.filter(matchesCategory);

    // Filter groups: hanya tampilkan kalau punya child dengan tipe tsb
    const filteredGroups = topLevelGroups.filter(g => {
      const children = childrenByParent.get(g.id) || [];
      return children.some(matchesCategory);
    });

    // Filter children per group (hanya keep children yang match)
    const filteredChildrenByParent = new Map();
    for (const g of filteredGroups) {
      const allChildren = childrenByParent.get(g.id) || [];
      const matchingChildren = allChildren.filter(matchesCategory);
      if (matchingChildren.length > 0) {
        filteredChildrenByParent.set(g.id, matchingChildren);
      }
    }

    // Replace dengan filtered
    topLevelItems.length = 0;
    topLevelItems.push(...filteredTopItems);
    topLevelGroups.length = 0;
    topLevelGroups.push(...filteredGroups);
    childrenByParent.clear();
    for (const [k, v] of filteredChildrenByParent) {
      childrenByParent.set(k, v);
    }
  }

  // Sort top-level: groups first (by title), then items (by title)
  topLevelGroups.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'id'));
  topLevelItems.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'id'));

  // Build nodes
  const nodes = [];
  for (const g of topLevelGroups) {
    const children = (childrenByParent.get(g.id) || []).slice();
    children.sort((a, b) => {
      const oa = getOrder(a), ob = getOrder(b);
      if (oa !== ob) return oa - ob;
      return (a.title || '').localeCompare(b.title || '', 'id');
    });
    const childNodes = children.map(item => ({ kind: 'item', item }));
    const isExpanded = expandedGroupIds.includes(g.id);
    nodes.push({
      kind: 'group',
      group: g,
      children: childNodes,
      childCount: childNodes.length,
      isExpanded
    });
  }
  for (const it of topLevelItems) {
    nodes.push({ kind: 'item', item: it });
  }

  return nodes;
}

// ============================================================================
// Group CRUD helpers
// ============================================================================

/**
 * Buat group baru (item dengan isGroup=true).
 * @param {string} name - nama group
 * @returns {Object} new group item (belum di-save)
 */
export function createGroupItem(name) {
  const now = new Date().toISOString();
  const id = 'g_' + now.slice(0, 19).replace(/[-:T]/g, '') + '_' + Math.random().toString(36).slice(2, 8);
  return {
    id,
    type: 'prompt',  // group pakai type prompt supaya tetap di chip "Semua"
    title: name || 'Grup Baru',
    body: '',
    tags: ['group'],
    category: 'group',
    source: {
      isGroup: true,
      parentId: null,
      order: 0,
      createdAt: now
    },
    favorite: false,
    archived: false,
    useCount: 0,
    createdAt: now,
    updatedAt: now
  };
}

/**
 * Pindahkan item ke group (set parentId).
 * @param {Object} item - vault item
 * @param {string|null} groupId - ID group tujuan, null = top-level
 */
export function moveToGroup(item, groupId) {
  setParentId(item, groupId);
  // Reset order ke akhir (akan di-sort ulang oleh buildTree)
  if (!item.source) item.source = {};
  item.source.order = Date.now();
  item.updatedAt = new Date().toISOString();
}

// ============================================================================
// AI Grouping — auto-kelompokkan item pakai AI
// ============================================================================
//
// User bilang: "ada grouping pake ai juga jadi kalau sudah mumet kebanyakan
// pencet aja nanti Tree list nya ngatur sendiri bikin nama grup dan menentukan isinya"
//
// Strategi:
//   1. Kumpulkan semua item top-level (tanpa parentId) yang visible
//   2. Kirim ke AI (lib/assistant.js chatWithFallback) dengan prompt:
//      "Kelompokkan item-item ini ke dalam grup-grup yang logis berdasarkan
//       judul/tags/tipe. Berikan nama grup yang singkat dan deskriptif.
//       Format: JSON { groups: [{ name, items: [indices] }] }"
//   3. Parse response JSON
//   4. Buat group items + set parentId untuk setiap item
//   5. Save + refresh
//
// Item yang sudah ada di group tidak ikut (hanya top-level yang di-auto-group).

/**
 * Auto-group item pakai AI.
 * @param {Array} items - semua vault items (akan di-filter top-level visible)
 * @param {Function} chatFn - function dari lib/assistant.js (chatWithFallback)
 * @returns {Promise<{ ok: boolean, groups?: Array, error?: string }>}
 *   groups = array of { name: string, itemIds: string[] }
 */
export async function aiAutoGroup(items, chatFn) {
  // Filter: top-level, non-archived, non-group, visible
  const topItems = items.filter(it => {
    if (getIsGroup(it)) return false;
    if (it.archived) return false;
    if (getParentId(it)) return false;  // sudah di group
    return true;
  });

  if (topItems.length < 3) {
    return { ok: false, error: 'Minimal 3 item top-level untuk auto-group' };
  }

  // Build context untuk AI
  const context = topItems.map((it, i) => {
    const tags = Array.isArray(it.tags) ? it.tags.join(', ') : (it.tags || '');
    return `${i + 1}. [${it.type}] ${it.title || 'Untitled'}${tags ? ' (tags: ' + tags + ')' : ''}`;
  }).join('\n');

  const prompt = `Kelompokkan item-item berikut ke dalam grup-grup yang logis berdasarkan kesamaan tema/proyek/tipe.

Item:
${context}

Buat 2-6 grup. Setiap grup harus berisi item yang berkaitan. Berikan nama grup yang singkat (1-3 kata) dan deskriptif dalam bahasa Indonesia.

Jawab HANYA dengan JSON valid (tanpa markdown code fence), format:
{"groups":[{"name":"Nama Grup","items":[1,3,5]},{"name":"Grup Lain","items":[2,4]}]}

"items" berisi nomor index item (mulai dari 1) sesuai daftar di atas.`;

  try {
    let acc = '';
    const resp = await chatFn(
      [
        { role: 'system', content: 'Anda adalah asisten yang mengelompokkan item ke dalam grup-grup logis. Jawab HANYA dengan JSON valid, tidak ada teks lain.' },
        { role: 'user', content: prompt }
      ],
      {
        onToken: (t) => { acc += t; },
        temperature: 0.3
      }
    );

    let text = acc || resp?.content || '';
    // Strip code fence kalau AI tetap pakai
    text = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

    // Extract JSON object
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { ok: false, error: 'AI tidak return JSON valid' };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.groups || !Array.isArray(parsed.groups)) {
      return { ok: false, error: 'Format JSON tidak valid (tidak ada "groups")' };
    }

    // Validate + map indices ke item IDs
    const result = [];
    for (const g of parsed.groups) {
      if (!g.name || !Array.isArray(g.items)) continue;
      const itemIds = [];
      for (const idx of g.items) {
        const i = idx - 1;  // 1-based to 0-based
        if (i >= 0 && i < topItems.length) {
          itemIds.push(topItems[i].id);
        }
      }
      if (itemIds.length > 0) {
        result.push({ name: String(g.name).slice(0, 60), itemIds });
      }
    }

    if (result.length === 0) {
      return { ok: false, error: 'AI tidak mengelompokkan item dengan benar' };
    }

    return { ok: true, groups: result };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
