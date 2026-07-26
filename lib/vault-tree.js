// lib/vault-tree.js — v3.18.0: Minimal tree/grouping helpers untuk vault items
// Storage: parentId/isGroup/order di item.source (JSONB) — no ALTER TABLE needed.
// Folder tree HANYA di kategori spesifik (Prompt, Link, Media, dll).
// Di "Semua" = flat list, group items tidak tampil.

// ===== Schema helpers =====

export function getParentId(item) {
  return item?.source?.parentId || null;
}

export function setParentId(item, parentId) {
  if (!item.source) item.source = {};
  item.source.parentId = parentId || null;
}

export function isGroupItem(item) {
  return !!(item?.source?.isGroup);
}

export function getGroupType(item) {
  return item?.source?.groupType || item?.type || null;
}

export function getOrder(item) {
  return item?.source?.order || 0;
}

export function setOrder(item, order) {
  if (!item.source) item.source = {};
  item.source.order = order;
}

// ===== Create group =====

export function createGroup(name, type) {
  const id = 'grp_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  return {
    id,
    type: type || 'prompt',
    title: name || 'Grup Baru',
    body: '',
    tags: ['group'],
    category: 'group',
    source: {
      isGroup: true,
      groupType: type || 'prompt',
      capturedAt: new Date().toISOString(),
      device: 'addon'
    },
    favorite: false,
    archived: false,
    useCount: 0,
    lastUsedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

// ===== Build tree dari flat items =====
// showGroups=false → flat list (untuk "Semua"/"Arsip"), skip group items entirely
// showGroups=true → tree structure dengan groups + children
// categoryFilter = 'prompt' | 'link' | 'screenshot' | dll (null = no filter)

export function buildTree(items, expandedIds, categoryFilter, showGroups) {
  // v3.18.2: showGroups=true SELALU tampilkan groups (termasuk di "Semua")
  // categoryFilter=null berarti "Semua" — jangan filter by type
  const groups = [];
  const topLevel = [];
  const childrenByParent = new Map();

  for (const it of items) {
    if (isGroupItem(it)) {
      // Group harus match kategori (kalau filter aktif)
      if (categoryFilter && getGroupType(it) !== categoryFilter) continue;
      groups.push(it);
    } else {
      const pid = getParentId(it);
      if (pid) {
        if (!childrenByParent.has(pid)) childrenByParent.set(pid, []);
        childrenByParent.get(pid).push(it);
      } else {
        topLevel.push(it);
      }
    }
  }

  // Sort groups by createdAt
  groups.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));

  // Build nodes
  const nodes = [];
  for (const g of groups) {
    let children = (childrenByParent.get(g.id) || [])
      .sort((a, b) => getOrder(a) - getOrder(b));

    // Filter children by category (hanya kalau categoryFilter aktif)
    if (categoryFilter) {
      children = children.filter(c =>
        c.type === categoryFilter ||
        (categoryFilter === 'screenshot' && c.type === 'document')
      );
    }

    // v3.18.2: Jangan skip empty groups di "Semua" (categoryFilter=null)
    // Supaya folder kosong tetap tampil
    if (categoryFilter && children.length === 0) continue;

    nodes.push({
      kind: 'group',
      item: g,
      isExpanded: expandedIds.includes(g.id),
      children: children.map(c => ({ kind: 'item', item: c }))
    });
  }

  // Top-level items (no parent)
  for (const it of topLevel) {
    if (categoryFilter &&
        it.type !== categoryFilter &&
        !(categoryFilter === 'screenshot' && it.type === 'document')) continue;
    nodes.push({ kind: 'item', item: it });
  }

  return nodes;
}

// ===== AI Auto Group =====
// Kirim items ke AI, minta grouping, return array of {name, itemIds}

export async function aiAutoGroup(items, chatFn) {
  if (!items || items.length < 2) return { ok: false, error: 'too_few_items' };
  if (!chatFn) return { ok: false, error: 'no_chat_fn' };

  // Filter hanya non-group items
  const candidates = items.filter(it => !isGroupItem(it));
  if (candidates.length < 2) return { ok: false, error: 'too_few_items' };

  // Build prompt
  const itemLines = candidates.map((it, i) =>
    `${i + 1}. [${it.type}] ${it.title || '(no title)'}${it.tags?.length ? ' — tags: ' + it.tags.join(', ') : ''}`
  ).join('\n');

  const prompt = `Kelompokkan item-item berikut ke dalam grup-grup yang logis berdasarkan topik/tema. Maksimal 5 grup. Return JSON array format: [{"name":"Nama Grup","itemIds":["id1","id2"]}]

Items:
${itemLines}

Return ONLY the JSON array, no explanation.`;

  try {
    const res = await chatFn(prompt, { systemPrompt: 'You are a helpful assistant that groups items logically. Always respond with valid JSON only.' });
    if (!res?.ok) return { ok: false, error: res?.error || 'chat_failed' };

    // Parse JSON dari response
    const text = res.text || res.message || '';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return { ok: false, error: 'no_json_in_response' };

    const groups = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(groups)) return { ok: false, error: 'invalid_json_format' };

    // Validasi + map itemIds
    const validGroups = groups.filter(g => g.name && Array.isArray(g.itemIds) && g.itemIds.length > 0)
      .map(g => ({
        name: String(g.name).slice(0, 60),
        itemIds: g.itemIds.filter(id => candidates.some(c => c.id === id))
      }))
      .filter(g => g.itemIds.length > 0);

    if (validGroups.length === 0) return { ok: false, error: 'no_valid_groups' };

    return { ok: true, groups: validGroups };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
