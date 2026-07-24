// content/tape-cs.js — RecallTape floating calculator (v3.14.3 — REBUILT FROM SCRATCH)
// Simple textarea + live evaluation. No contenteditable per-line complexity.
//
// Key design:
//   - Single <textarea> for all input (reliable, no focus bugs)
//   - On every input → evaluate ALL lines → update result display LIVE
//   - Result bar: block total + grand total (updates as you type)
//   - Print via iframe to document.body (not Shadow DOM)
//   - Dark/light theme adaptive
//   - Draggable header, resizable
//   - 5 buttons: Pin / Print / Copy / Save / Clear

(async function () {
  if (window.__recallfoxTapeLoaded) return;
  window.__recallfoxTapeLoaded = true;

  let tape;
  try {
    tape = await import(browser.runtime.getURL('lib/tape.js'));
  } catch (e) {
    console.warn('[RecallFox/Tape] Failed to load lib/tape.js:', e);
    return;
  }
  const { evaluate, formatNumber, toPlainText, toMarkdown, loadSession, saveSession, savePinState } = tape;

  let host = null, shadow = null, popover = null, textarea = null;
  let resultBlock = null, resultGrand = null, statusAutosave = null;
  let pinBtn = null, isVisible = false, pinned = false;
  let saveTimer = null, evalTimer = null;

  // ===== Theme =====
  async function loadTheme() {
    try {
      const r = await browser.storage.local.get(['settings']);
      const s = r.settings || {};
      let theme = s.theme || 'auto';
      if (theme === 'auto') theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      return theme;
    } catch (e) { return 'dark'; }
  }

  // ===== Mount =====
  function mount() {
    if (host) return;
    host = document.createElement('div');
    host.id = 'recallfox-tape-host';
    host.style.cssText = 'all:initial;position:fixed;top:0;right:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
    document.documentElement.appendChild(host);
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = TEMPLATE;
    popover = shadow.querySelector('.rft-popover');
    textarea = shadow.querySelector('.rft-editor');
    resultBlock = shadow.querySelector('.rft-block-val');
    resultGrand = shadow.querySelector('.rft-grand-val');
    statusAutosave = shadow.querySelector('.rft-autosave');
    pinBtn = shadow.querySelector('.rft-pin');
    wireEvents();
  }

  // ===== Show / Hide =====
  async function show() {
    mount();
    const theme = await loadTheme();
    shadow.host.setAttribute('data-theme', theme);
    popover.classList.add('rft-show');
    isVisible = true;
    const s = await loadSession();
    if (s.text) textarea.value = s.text;
    if (s.pinned) { pinned = true; pinBtn.classList.add('rft-active'); }
    setTimeout(() => { textarea.focus(); doEval(); }, 50);
  }
  function hide() { if (popover) { popover.classList.remove('rft-show'); isVisible = false; } }
  async function toggle() { if (isVisible) hide(); else await show(); }

  // ===== Evaluation (live — on every input) =====
  function doEval() {
    const text = textarea.value;
    const lines = text.split('\n');
    const result = evaluate(lines);

    // Update result display
    const lastEntry = result.entries[result.entries.length - 1];
    resultBlock.textContent = formatNumber(lastEntry ? lastEntry.running : 0);
    resultGrand.textContent = formatNumber(result.grandTotal);

    // Update status
    if (statusAutosave) {
      if (result.error) {
        statusAutosave.textContent = '⚠ ' + result.error;
        statusAutosave.style.color = '#FB7185';
      } else {
        statusAutosave.textContent = '✓ Tersimpan otomatis';
        statusAutosave.style.color = '';
      }
    }
  }

  function scheduleEval() {
    if (evalTimer) clearTimeout(evalTimer);
    evalTimer = setTimeout(doEval, 80);
  }
  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    statusAutosave.textContent = '⏳ Menyimpan…';
    statusAutosave.style.color = '#F0B64A';
    saveTimer = setTimeout(async () => {
      try { await saveSession(textarea.value); } catch (e) {}
      doEval();
    }, 400);
  }

  // ===== Actions =====
  async function doCopy() {
    const text = textarea.value;
    const result = evaluate(text.split('\n'));
    const plain = toPlainText(result);
    try {
      await navigator.clipboard.writeText(plain);
      flashBtn('.rft-copy');
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = plain; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); flashBtn('.rft-copy'); } catch (e2) {}
      ta.remove();
    }
  }

  function doPrint() {
    const text = textarea.value;
    const result = evaluate(text.split('\n'));
    if (result.entries.length === 0) { toast('Tape kosong'); return; }
    let html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>RecallTape</title>';
    html += '<style>body{font-family:Menlo,Consolas,monospace;font-size:11px;max-width:300px;margin:0 auto;padding:16px}';
    html += 'h1{font-size:14px;text-align:center;margin-bottom:4px}';
    html += '.date{font-size:9px;color:#999;text-align:center;margin-bottom:12px}';
    html += '.line{padding:2px 0;display:flex;justify-content:space-between}';
    html += '.op{font-weight:bold;margin-right:4px}.amt{flex:1;text-align:right}.note{margin-left:8px;color:#666}';
    html += '.sep{border-top:1px dashed #ccc;margin:6px 0}.subtotal{font-weight:bold;color:#059669}';
    html += '.grand{border-top:2px solid #333;margin-top:8px;padding-top:6px;font-weight:bold;font-size:14px;text-align:right}';
    html += '</style></head><body>';
    html += '<h1>🧾 RecallTape</h1><div class="date">' + new Date().toLocaleString('id-ID') + '</div>';
    for (const e of result.entries) {
      if (e.kind === 'comment' || e.kind === 'note') { html += '<div class="line">' + esc(e.note) + '</div>'; continue; }
      if (e.kind === 'subtotal') {
        html += '<div class="sep"></div><div class="line subtotal"><span>= ' + esc(e.note || 'Subtotal') + '</span><span>' + formatNumber(e.running) + '</span></div>';
        continue;
      }
      const sym = e.op || '+';
      const amtStr = e.isPercent ? formatNumber(e.amount) + '%' : formatNumber(e.amount);
      html += '<div class="line"><span class="op">' + sym + '</span><span class="amt">' + amtStr + '</span><span class="note">' + esc(e.note || '') + '</span></div>';
    }
    html += '<div class="grand">Total: ' + formatNumber(result.grandTotal) + '</div>';
    html += '</body></html>';

    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;z-index:-1;';
    document.body.appendChild(iframe);
    try {
      const doc = iframe.contentWindow.document;
      doc.open(); doc.write(html); doc.close();
    } catch (e) { toast('Gagal mencetak: ' + e.message); iframe.remove(); return; }
    setTimeout(() => {
      try { iframe.contentWindow.focus(); iframe.contentWindow.print(); } catch (e) { toast('Gagal print: ' + e.message); }
      setTimeout(() => { try { iframe.remove(); } catch (e) {} }, 2000);
    }, 300);
    flashBtn('.rft-print');
  }

  async function doSave() {
    const text = textarea.value;
    const result = evaluate(text.split('\n'));
    if (result.entries.length === 0) { toast('Tape kosong'); return; }
    try {
      const md = toMarkdown(result);
      await browser.runtime.sendMessage({ type: 'SAVE_TAPE_TO_VAULT', markdown: md, text: text, grandTotal: result.grandTotal });
      toast('✓ Tersimpan ke Vault');
      flashBtn('.rft-save');
    } catch (e) { toast('Gagal simpan: ' + e.message); }
  }

  function doClear() {
    if (!textarea.value.trim()) return;
    if (!confirm('Kosongkan tape?')) return;
    textarea.value = '';
    doEval();
    scheduleSave();
    textarea.focus();
    flashBtn('.rft-clear');
  }

  // ===== Helpers =====
  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function flashBtn(sel) {
    const btn = shadow.querySelector(sel);
    if (!btn) return;
    btn.classList.add('rft-flash');
    setTimeout(() => btn.classList.remove('rft-flash'), 600);
  }
  function toast(msg) {
    const t = shadow.querySelector('.rft-toast');
    if (!t) return;
    t.textContent = msg; t.classList.add('rft-show');
    setTimeout(() => t.classList.remove('rft-show'), 2000);
  }

  // ===== Drag =====
  function makeDraggable() {
    const hd = shadow.querySelector('.rft-hd');
    let dragging = false, dx = 0, dy = 0;
    hd.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      dragging = true;
      const rect = popover.getBoundingClientRect();
      dx = e.clientX - rect.left;
      dy = e.clientY - rect.top;
      popover.style.transition = 'none';
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      popover.style.left = (e.clientX - dx) + 'px';
      popover.style.top = (e.clientY - dy) + 'px';
      popover.style.right = 'auto';
    });
    document.addEventListener('mouseup', () => {
      if (dragging) { dragging = false; popover.style.transition = ''; }
    });
  }

  // ===== Wire events =====
  function wireEvents() {
    // Textarea input → live eval + debounced save
    textarea.addEventListener('input', () => { scheduleEval(); scheduleSave(); });

    // Ctrl+Enter → save
    textarea.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); doSave(); }
      if (e.key === 'Escape' && !pinned) { e.preventDefault(); hide(); }
    });

    // Buttons
    pinBtn.addEventListener('click', async () => {
      pinned = !pinned;
      pinBtn.classList.toggle('rft-active', pinned);
      await savePinState(pinned);
    });
    shadow.querySelector('.rft-print').addEventListener('click', doPrint);
    shadow.querySelector('.rft-copy').addEventListener('click', doCopy);
    shadow.querySelector('.rft-save').addEventListener('click', doSave);
    shadow.querySelector('.rft-clear').addEventListener('click', doClear);

    // Click outside → hide (unless pinned)
    document.addEventListener('mousedown', (e) => {
      if (!isVisible || pinned) return;
      if (host.contains(e.target)) return;
      hide();
    }, true);

    // Theme change listener
    browser.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'THEME_CHANGED') shadow.host.setAttribute('data-theme', msg.theme);
    });

    makeDraggable();
  }

  // ===== Message listener =====
  browser.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'OPEN_TAPE') toggle();
    else if (msg.type === 'ADD_TO_TAPE') { show(); textarea.value += (textarea.value ? '\n' : '') + msg.text; doEval(); scheduleSave(); }
    else if (msg.type === 'SHOW_TAPE') show();
    else if (msg.type === 'HIDE_TAPE') hide();
  });

  loadSession().then((s) => { pinned = s.pinned; });

  // ===== Template (HTML + CSS inlined in Shadow DOM) =====
  const TEMPLATE = `
<style>
:host{all:initial}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}

.rft-popover{
  position:fixed; top:60px; right:14px;
  width:340px; max-height:560px;
  background:#0E182A; color:#E8EEF7;
  border:1px solid #1A293D; border-radius:12px;
  box-shadow:0 18px 50px rgba(0,0,0,.55), 0 2px 8px rgba(0,0,0,.4);
  display:flex; flex-direction:column; overflow:hidden;
  font-family:Menlo,Consolas,"Courier New",monospace; font-size:13px;
  opacity:0; transform:translateY(-6px) scale(.98); pointer-events:none;
  transition:opacity .15s ease, transform .15s ease;
  resize:both; min-width:280px; min-height:340px;
}
.rft-popover.rft-show{ opacity:1; transform:translateY(0) scale(1); pointer-events:auto }

:host([data-theme="light"]) .rft-popover{
  background:#F8FAFC; color:#1E293B; border-color:#E2E8F0;
  box-shadow:0 18px 50px rgba(0,0,0,.12), 0 2px 8px rgba(0,0,0,.08);
}

/* Header — draggable */
.rft-hd{
  display:flex; align-items:center; gap:6px;
  padding:7px 10px; flex:none; cursor:move;
  background:#1A293D; border-bottom:1px solid #0F1E33;
}
:host([data-theme="light"]) .rft-hd{ background:#FFFFFF; border-bottom:1px solid #E2E8F0; }

.rft-title{
  font-size:11px; font-weight:700; letter-spacing:-.01em; flex:1;
  display:flex; align-items:center; gap:5px;
  font-family:-apple-system,system-ui,"Segoe UI",sans-serif;
}
.rft-actions{ display:flex; gap:2px; }

.rft-btn{
  width:24px; height:24px; border-radius:5px; border:none; background:none;
  color:#A3B0C2; cursor:pointer; line-height:1;
  display:grid; place-items:center; transition:.12s; padding:0;
}
:host([data-theme="light"]) .rft-btn{ color:#64748B; }
.rft-btn:hover{ background:rgba(255,255,255,.08); color:#E8EEF7; }
:host([data-theme="light"]) .rft-btn:hover{ background:rgba(0,0,0,.06); color:#1E293B; }
.rft-btn:active{ transform:scale(.92) }
.rft-btn.rft-active{ background:#1E3A8A; color:#60A5FA; }
.rft-btn.rft-flash{ background:#42C6A0; color:#fff; }
.rft-btn svg{ width:13px; height:13px }

/* Textarea editor */
.rft-editor{
  flex:1; overflow-y:auto; min-height:180px; max-height:400px;
  background:#273953; color:#E8EEF7;
  font-family:Menlo,Consolas,"Courier New",monospace;
  font-size:13px; line-height:24px;
  padding:8px 14px; border:none; outline:none; resize:none;
  width:100%; font-variant-numeric:tabular-nums;
  white-space:pre; overflow-wrap:normal;
}
:host([data-theme="light"]) .rft-editor{ background:#FFFFFF; color:#1E293B; }
.rft-editor::-webkit-scrollbar{ width:6px }
.rft-editor::-webkit-scrollbar-thumb{ background:#364C6C; border-radius:3px }
:host([data-theme="light"]) .rft-editor::-webkit-scrollbar-thumb{ background:#CBD5E1; }
.rft-editor::placeholder{ color:#5B7090; }
:host([data-theme="light"]) .rft-editor::placeholder{ color:#94A3B8; }

/* Status bar */
.rft-status{
  flex:none; padding:4px 10px; background:#1A293D;
  border-top:1px solid #0F1E33;
  display:flex; align-items:center; gap:8px;
  font-family:-apple-system,system-ui,sans-serif;
  font-size:10px; color:#A3B0C2;
}
:host([data-theme="light"]) .rft-status{ background:#FFFFFF; border-top:1px solid #E2E8F0; color:#64748B; }
.rft-autosave{ margin-left:auto; }

/* Result bar */
.rft-result-bar{
  flex:none; padding:8px 14px; background:#1A293D;
  border-top:1px solid #0F1E33;
  display:flex; gap:14px; align-items:flex-end;
}
:host([data-theme="light"]) .rft-result-bar{ background:#FFFFFF; border-top:1px solid #E2E8F0; }
.rft-block, .rft-grand{ display:flex; flex-direction:column; gap:2px; }
.rft-grand{ margin-left:auto; text-align:right; align-items:flex-end; }
.rft-eyebrow{
  font-family:-apple-system,system-ui,sans-serif;
  font-size:9px; font-weight:700; letter-spacing:.05em;
  color:#60A5FA; text-transform:uppercase;
}
:host([data-theme="light"]) .rft-eyebrow{ color:#3B82F6; }
.rft-block-val{
  font-family:Menlo,Consolas,monospace; font-size:14px; font-weight:600;
  color:#E8EEF7; font-variant-numeric:tabular-nums;
}
:host([data-theme="light"]) .rft-block-val{ color:#1E293B; }
.rft-grand-val{
  font-family:Menlo,Consolas,monospace; font-size:20px; font-weight:700;
  color:#42C6A0; font-variant-numeric:tabular-nums; line-height:1;
}
:host([data-theme="light"]) .rft-grand-val{ color:#059669; }

/* Toast */
.rft-toast{
  position:absolute; bottom:8px; left:50%; transform:translateX(-50%) translateY(8px);
  background:#E8EEF7; color:#0E182A; padding:5px 12px; border-radius:6px;
  font-size:11px; font-weight:600; opacity:0; pointer-events:none; transition:.2s;
  white-space:nowrap; max-width:90%;
  font-family:-apple-system,system-ui,sans-serif;
}
.rft-toast.rft-show{ opacity:1; transform:translateX(-50%) translateY(0) }
</style>
<div class="rft-popover" role="dialog" aria-label="RecallTape calculator">
  <div class="rft-hd">
    <div class="rft-title">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6"/><path d="M3 11h18"/><path d="M3 11v8a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-8"/><path d="M7 15h4"/></svg>
      RecallTape
    </div>
    <div class="rft-actions">
      <button class="rft-btn rft-pin" title="Pin (kunci agar tetap terbuka)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.5V4h6v6.5l2 3.5H7l2-3.5z"/></svg>
      </button>
      <button class="rft-btn rft-print" title="Cetak resi (PDF)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
      </button>
      <button class="rft-btn rft-copy" title="Salin sebagai teks">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      </button>
      <button class="rft-btn rft-save" title="Simpan ke Vault (Ctrl+Enter)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
      </button>
      <button class="rft-btn rft-clear" title="Kosongkan">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>
    </div>
  </div>
  <textarea class="rft-editor" spellcheck="false" placeholder="250000 Gaji&#10;+ 50k Bonus&#10;- 20rb Makan&#10;= Subtotal&#10;&#10;Format: angka + catatan&#10;Suffix: k/rb/jt/juta&#10;Op: + - * / = (subtotal)"></textarea>
  <div class="rft-status">
    <span class="rft-autosave">✓ Tersimpan otomatis</span>
  </div>
  <div class="rft-result-bar">
    <div class="rft-block">
      <span class="rft-eyebrow">Block</span>
      <span class="rft-block-val">0</span>
    </div>
    <div class="rft-grand">
      <span class="rft-eyebrow">Grand Total</span>
      <span class="rft-grand-val">0</span>
    </div>
  </div>
  <div class="rft-toast"></div>
</div>
`;
})();
