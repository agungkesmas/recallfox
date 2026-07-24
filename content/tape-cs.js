// content/tape-cs.js — RecallTape popover content script
// Injects a compact (320x~400px) "tape calculator" popover into the active page via Shadow DOM.
// Triggered from:
//   - Top Header button in RecallFox popup/sidebar (sends OPEN_TAPE message)
//   - Tools grid button (also OPEN_TAPE)
//   - Context menu "Add to RecallFox Tape" (sends ADD_TO_TAPE with selected text)
//
// Features:
//   - Keyboard-first input (textarea, no numpad)
//   - Real-time parser & evaluator (handles 50k, 100rb, 2,5jt, 1.250.000, etc.)
//   - Auto-recalculation when any line is edited
//   - Micro icon buttons: Pin / Print / Copy / Save / Clear
//   - Auto-save session + pin state to browser.storage.local
//   - @media print for 58mm/80mm receipt format
//   - Dark/light theme adapts to RecallFox theme setting

(async function () {
  if (window.__recallfoxTapeLoaded) return;
  window.__recallfoxTapeLoaded = true;

  // Dynamic-load lib/tape.js (pure module) from extension URL.
  // lib/tape.js is listed in web_accessible_resources.
  let tape;
  try {
    tape = await import(browser.runtime.getURL('lib/tape.js'));
  } catch (e) {
    console.warn('[RecallFox/Tape] Failed to load lib/tape.js:', e);
    return;
  }
  const { evaluate, formatNumber, formatCurrency, toPlainText, toMarkdown, loadSession, saveSession, savePinState } = tape;

  // ============ State ============
  let host = null;
  let shadow = null;
  let popover = null;
  let textarea = null;
  let canvas = null;
  let grandTotalEl = null;
  let pinBtn = null;
  let isVisible = false;
  let pinned = false;
  let saveTimer = null;
  let lastTheme = 'light';

  // ============ Theme detection ============
  async function loadTheme() {
    try {
      const r = await browser.storage.local.get(['settings']);
      const s = r.settings || {};
      let theme = s.theme || 'auto';
      if (theme === 'auto') {
        theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      return theme;
    } catch (e) {
      return 'light';
    }
  }

  // ============ Mount popover ============
  function mount() {
    if (host) return;
    host = document.createElement('div');
    host.id = 'recallfox-tape-host';
    // Host is a zero-size anchor at top-right; popover is absolutely positioned inside shadow.
    host.style.cssText = 'all:initial;position:fixed;top:0;right:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
    document.documentElement.appendChild(host);
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = TEMPLATE;
    popover = shadow.querySelector('.rft-popover');
    textarea = shadow.querySelector('.rft-input');
    canvas = shadow.querySelector('.rft-canvas');
    grandTotalEl = shadow.querySelector('.rft-grand');
    pinBtn = shadow.querySelector('.rft-pin');
    wireEvents();
  }

  // ============ Show / hide ============
  async function show() {
    mount();
    const theme = await loadTheme();
    shadow.host.setAttribute('data-theme', theme);
    popover.classList.add('rft-show');
    isVisible = true;
    setTimeout(() => textarea.focus(), 50);
  }
  function hide() {
    if (!popover) return;
    popover.classList.remove('rft-show');
    isVisible = false;
  }
  async function toggle() {
    if (isVisible) hide();
    else await show();
  }

  // ============ Render canvas from textarea content ============
  function render() {
    const text = textarea.value;
    const result = evaluate(text);
    // Build canvas HTML
    let html = '';
    for (const e of result.entries) {
      if (e.kind === 'comment') {
        html += `<div class="rft-row rft-comment"><span class="rft-note"># ${escapeHtml(e.note)}</span><span class="rft-amt"></span></div>`;
        continue;
      }
      if (e.kind === 'note') {
        html += `<div class="rft-row rft-note-row"><span class="rft-note">${escapeHtml(e.note)}</span><span class="rft-amt"></span></div>`;
        continue;
      }
      if (e.kind === 'subtotal') {
        html += `<div class="rft-sep"></div>`;
        const label = e.note || 'Subtotal';
        html += `<div class="rft-row rft-subtotal"><span class="rft-note">${escapeHtml(label)}</span><span class="rft-amt">${formatNumber(e.display)}</span></div>`;
        html += `<div class="rft-sep"></div>`;
        continue;
      }
      // op row
      const sym = OP_SYMBOL[e.op] || '+';
      html += `<div class="rft-row rft-op"><span class="rft-note">${escapeHtml(e.note || '')}</span><span class="rft-op-sym">${sym}</span><span class="rft-amt">${formatNumber(e.amount)}</span></div>`;
    }
    if (result.entries.length === 0) {
      html = `<div class="rft-empty">Ketik baris pertama, contoh:<br><code>250000 Gaji Utama</code><br><code>+ 50k Bonus</code><br><code>- 20rb Makan</code><br><code>= Subtotal</code></div>`;
    }
    canvas.innerHTML = html;
    grandTotalEl.textContent = formatCurrency(result.grandTotal);
    if (result.error) {
      grandTotalEl.title = result.error;
      grandTotalEl.classList.add('rft-error');
    } else {
      grandTotalEl.title = '';
      grandTotalEl.classList.remove('rft-error');
    }
    // auto-scroll to bottom
    canvas.scrollTop = canvas.scrollHeight;
    // schedule save
    scheduleSave(text);
  }

  function scheduleSave(text) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveSession(text);
    }, 400);
  }

  // ============ Wire events ============
  function wireEvents() {
    textarea.addEventListener('input', render);
    textarea.addEventListener('keydown', (e) => {
      // Ctrl+Enter → save to vault
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        doSave();
      }
      // Esc → hide (unless pinned)
      if (e.key === 'Escape' && !pinned) {
        e.preventDefault();
        hide();
      }
    });

    // Pin toggle
    pinBtn.addEventListener('click', async () => {
      pinned = !pinned;
      pinBtn.classList.toggle('rft-active', pinned);
      pinBtn.setAttribute('aria-pressed', String(pinned));
      pinBtn.title = pinned ? 'Unpin (pop-over tetap terbuka)' : 'Pin (kunci popover agar tetap terbuka)';
      await savePinState(pinned);
    });

    // Print
    shadow.querySelector('.rft-print').addEventListener('click', doPrint);
    // Copy
    shadow.querySelector('.rft-copy').addEventListener('click', doCopy);
    // Save to vault
    shadow.querySelector('.rft-save').addEventListener('click', doSave);
    // Clear
    shadow.querySelector('.rft-clear').addEventListener('click', doClear);

    // Click outside → hide (unless pinned)
    document.addEventListener('mousedown', (e) => {
      if (!isVisible || pinned) return;
      if (host.contains(e.target)) return;
      // If click was on RecallFox UI (popup), don't auto-hide
      // We can't really know — but mousedown on page content should hide
      hide();
    }, true);

    // Listen for theme changes from popup
    browser.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'THEME_CHANGED') {
        shadow.host.setAttribute('data-theme', msg.theme);
      }
    });
  }

  // ============ Actions ============
  async function doCopy() {
    const text = textarea.value;
    const result = evaluate(text);
    const plain = toPlainText(result);
    try {
      await navigator.clipboard.writeText(plain);
      flashBtn(shadow.querySelector('.rft-copy'), '✓');
    } catch (e) {
      // Fallback: select-then-copy via execCommand
      const ta = document.createElement('textarea');
      ta.value = plain;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); flashBtn(shadow.querySelector('.rft-copy'), '✓'); }
      catch (e2) { flashBtn(shadow.querySelector('.rft-copy'), '✗'); }
      ta.remove();
    }
  }

  async function doSave() {
    const text = textarea.value;
    const result = evaluate(text);
    if (result.entries.length === 0) {
      toast('Tape kosong — tidak ada yang disimpan');
      return;
    }
    const md = toMarkdown(result, { title: 'RecallTape' });
    const plain = toPlainText(result);
    // Title: first non-empty note, or "Tape {date}"
    const firstNote = (result.entries.find(e => e.note) || {}).note || 'Tape';
    const title = `🧾 ${firstNote.slice(0, 50)}`.trim();
    // Send to background — background.js will call addItem({type:'prompt', ...})
    try {
      await browser.runtime.sendMessage({
        type: 'TAPE_SAVE_TO_VAULT',
        payload: {
          title,
          body: md,
          // Also stash plain text in source for quick recall
          source: { kind: 'tape', plainText: plain, savedAt: new Date().toISOString() }
        }
      });
      flashBtn(shadow.querySelector('.rft-save'), '✓');
    } catch (e) {
      console.warn('[RecallFox/Tape] Save failed:', e);
      flashBtn(shadow.querySelector('.rft-save'), '✗');
    }
  }

  function doPrint() {
    // Build a dedicated print window with receipt format
    const text = textarea.value;
    const result = evaluate(text);
    const plain = toPlainText(result);
    const printWin = window.open('', '_blank', 'width=400,height=600');
    if (!printWin) {
      toast('Popup diblokir — izinkan popup untuk print');
      return;
    }
    const theme = shadow.host.getAttribute('data-theme') || 'light';
    printWin.document.write(PRINT_HTML(theme, plain));
    printWin.document.close();
    printWin.focus();
    setTimeout(() => {
      printWin.print();
      // Some browsers close automatically; user can close manually otherwise
    }, 250);
  }

  function doClear() {
    if (!textarea.value.trim()) return;
    if (!confirm('Kosongkan tape? Semua baris akan dihapus.')) return;
    textarea.value = '';
    render();
    textarea.focus();
  }

  function addLine(line) {
    mount();
    show().then(() => {
      const cur = textarea.value;
      const trimmed = String(line || '').trim();
      if (!trimmed) return;
      // Heuristic: if selection is a pure number, prefix with '+'; if it starts with operator, leave as is; else treat as a note line (no operator).
      let prefix = '+ ';
      if (/^[+\-*/=×÷]/.test(trimmed)) prefix = '';
      else if (!/^[\d.,]/.test(trimmed)) prefix = '# ';  // comment line
      const newLine = prefix + trimmed;
      textarea.value = cur ? cur.replace(/\s+$/, '') + '\n' + newLine : newLine;
      render();
      // Scroll textarea to end + focus
      textarea.scrollTop = textarea.scrollHeight;
      textarea.focus();
      // Place caret at end
      const len = textarea.value.length;
      textarea.setSelectionRange(len, len);
    });
  }

  // ============ Helpers ============
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function flashBtn(btn, glyph) {
    if (!btn) return;
    const orig = btn.dataset.glyph || btn.textContent;
    btn.dataset.glyph = orig;
    btn.textContent = glyph;
    btn.classList.add('rft-flash');
    setTimeout(() => {
      btn.textContent = orig;
      btn.classList.remove('rft-flash');
    }, 900);
  }
  function toast(msg) {
    // Lightweight in-page toast
    let t = shadow.querySelector('.rft-toast');
    if (!t) {
      t = document.createElement('div');
      t.className = 'rft-toast';
      popover.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('rft-show');
    setTimeout(() => t.classList.remove('rft-show'), 1800);
  }

  const OP_SYMBOL = { '+': '+', '-': '−', '*': '×', '/': '÷', '=': '=' };

  // ============ Message listener ============
  browser.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'OPEN_TAPE') {
      toggle();
    } else if (msg.type === 'ADD_TO_TAPE') {
      addLine(msg.text);
    } else if (msg.type === 'SHOW_TAPE') {
      show();
    } else if (msg.type === 'HIDE_TAPE') {
      hide();
    }
  });

  // ============ Restore session on load ============
  loadSession().then((s) => {
    pinned = s.pinned;
    // Don't auto-mount on every page — wait for OPEN_TAPE message.
    // But if pinned, we should be ready to show immediately.
  });

  // ============ Template ============
  const TEMPLATE = `
<style>
:host{all:initial}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;font-family:inherit}
.rft-popover{
  position:fixed; top:14px; right:14px;
  width:320px; max-height:400px;
  background:var(--rft-bg, #fafaf9); color:var(--rft-text, #1c1917);
  border:1px solid var(--rft-border, #e7e5e4);
  border-radius:14px;
  box-shadow:0 18px 50px rgba(0,0,0,.22), 0 2px 8px rgba(0,0,0,.08);
  display:flex; flex-direction:column; overflow:hidden;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  font-size:12px;
  opacity:0; transform:translateY(-6px) scale(.98); pointer-events:none;
  transition:opacity .15s ease, transform .15s ease;
  pointer-events:auto;
}
:host([data-theme="dark"]) .rft-popover{
  --rft-bg:#1c1b19; --rft-surface:#242220; --rft-surface-2:#2b2926;
  --rft-border:#2e2b28; --rft-border-strong:#3d3935;
  --rft-text:#f5f4f2; --rft-text-2:#c9c5c1; --rft-muted:#8a8580;
  --rft-primary:#818cf8; --rft-primary-soft:rgba(129,140,248,.14);
  --rft-green:#34d399; --rft-amber:#fbbf24; --rft-danger:#f87171;
  box-shadow:0 18px 50px rgba(0,0,0,.55), 0 2px 8px rgba(0,0,0,.4);
}
:host([data-theme="light"]) .rft-popover{
  --rft-bg:#fafaf9; --rft-surface:#ffffff; --rft-surface-2:#f5f5f4;
  --rft-border:#e7e5e4; --rft-border-strong:#d6d3d1;
  --rft-text:#1c1917; --rft-text-2:#57534e; --rft-muted:#a8a29e;
  --rft-primary:#4f46e5; --rft-primary-soft:#eef2ff;
  --rft-green:#059669; --rft-amber:#d97706; --rft-danger:#dc2626;
  box-shadow:0 18px 50px rgba(0,0,0,.18), 0 2px 8px rgba(0,0,0,.06);
}
.rft-popover.rft-show{ opacity:1; transform:translateY(0) scale(1); pointer-events:auto }

/* Header */
.rft-hd{
  display:flex; align-items:center; gap:8px;
  padding:8px 10px; flex:none;
  background:var(--rft-surface); border-bottom:1px solid var(--rft-border);
}
.rft-title{ font-size:11.5px; font-weight:700; color:var(--rft-text); letter-spacing:-.01em; flex:1; display:flex; align-items:center; gap:5px }
.rft-title-ic{ font-size:13px }
.rft-actions{ display:flex; gap:2px }
.rft-btn{
  width:24px; height:24px; border-radius:6px; border:none; background:none;
  color:var(--rft-text-2); cursor:pointer; font-size:12px; line-height:1;
  display:grid; place-items:center; transition:.12s; padding:0;
}
.rft-btn:hover{ background:var(--rft-surface-2); color:var(--rft-text) }
.rft-btn:active{ transform:scale(.92) }
.rft-btn.rft-active{ background:var(--rft-primary-soft); color:var(--rft-primary) }
.rft-btn.rft-flash{ background:var(--rft-green); color:#fff }
.rft-btn svg{ width:13px; height:13px }

/* Canvas */
.rft-canvas{
  flex:1; overflow-y:auto; padding:8px 10px; min-height:120px;
  background:var(--rft-bg); font-variant-numeric:tabular-nums;
}
.rft-canvas::-webkit-scrollbar{ width:6px }
.rft-canvas::-webkit-scrollbar-thumb{ background:var(--rft-border-strong); border-radius:3px }
.rft-empty{
  color:var(--rft-muted); font-size:11px; line-height:1.55; padding:14px 4px; text-align:center;
}
.rft-empty code{
  display:inline-block; padding:1px 5px; margin:2px 0;
  background:var(--rft-surface-2); border:1px solid var(--rft-border);
  border-radius:4px; font-family:ui-monospace,Menlo,monospace; font-size:10.5px; color:var(--rft-text-2);
}
.rft-row{
  display:grid; grid-template-columns:1fr 16px 90px; gap:6px; align-items:baseline;
  padding:3px 0; font-size:12px;
}
.rft-note{ color:var(--rft-text-2); font-size:11.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
.rft-op-sym{ color:var(--rft-muted); font-weight:700; text-align:center; font-family:ui-monospace,Menlo,monospace; font-size:11.5px }
.rft-amt{
  color:var(--rft-text); font-weight:700; text-align:right;
  font-family:ui-monospace,"SF Mono",Menlo,monospace; font-size:12px;
}
.rft-row.rft-op .rft-amt{ color:var(--rft-text) }
.rft-row.rft-subtotal{ background:var(--rft-surface-2); padding:5px 6px; border-radius:5px; margin:2px 0 }
.rft-row.rft-subtotal .rft-note{ color:var(--rft-text); font-weight:600 }
.rft-row.rft-subtotal .rft-amt{ color:var(--rft-primary); font-size:12.5px }
.rft-row.rft-comment .rft-note{ color:var(--rft-muted); font-style:italic; font-size:11px }
.rft-row.rft-note-row .rft-note{ color:var(--rft-muted); font-size:11px; padding-left:6px }
.rft-sep{ border-top:1px dashed var(--rft-border-strong); margin:4px 0; height:0 }

/* Input */
.rft-input{
  flex:none; width:100%; min-height:60px; max-height:120px; resize:vertical;
  padding:7px 10px; border:none; border-top:1px solid var(--rft-border);
  background:var(--rft-surface); color:var(--rft-text);
  font-family:ui-monospace,"SF Mono",Menlo,monospace; font-size:12px; line-height:1.55;
  outline:none;
}
.rft-input:focus{ background:var(--rft-surface-2); box-shadow:inset 0 2px 0 var(--rft-primary) }
.rft-input::placeholder{ color:var(--rft-muted) }

/* Footer */
.rft-foot{
  flex:none; padding:8px 10px; background:var(--rft-surface);
  border-top:1px solid var(--rft-border);
  display:flex; align-items:center; justify-content:space-between; gap:8px;
}
.rft-foot-lbl{ font-size:10px; font-weight:700; color:var(--rft-muted); letter-spacing:.06em; text-transform:uppercase }
.rft-grand{
  font-family:ui-monospace,"SF Mono",Menlo,monospace; font-size:14.5px; font-weight:700;
  color:var(--rft-primary); font-variant-numeric:tabular-nums;
}
.rft-grand.rft-error{ color:var(--rft-danger) }
.rft-toast{
  position:absolute; bottom:8px; left:50%; transform:translateX(-50%) translateY(8px);
  background:var(--rft-text); color:var(--rft-bg); padding:5px 10px; border-radius:6px;
  font-size:11px; font-weight:600; opacity:0; pointer-events:none; transition:.2s;
  white-space:nowrap; max-width:90%;
}
.rft-toast.rft-show{ opacity:1; transform:translateX(-50%) translateY(0) }
</style>
<div class="rft-popover" role="dialog" aria-label="RecallTape calculator">
  <div class="rft-hd">
    <div class="rft-title"><span class="rft-title-ic">🧾</span>RecallTape</div>
    <div class="rft-actions">
      <button class="rft-btn rft-pin" title="Pin (kunci popover agar tetap terbuka)" aria-pressed="false">📌</button>
      <button class="rft-btn rft-print" title="Cetak resi (PDF)">🖨️</button>
      <button class="rft-btn rft-copy" title="Salin sebagai teks">📋</button>
      <button class="rft-btn rft-save" title="Simpan ke Vault (Ctrl+Enter)">💾</button>
      <button class="rft-btn rft-clear" title="Kosongkan" style="font-size:13px">🗑️</button>
    </div>
  </div>
  <div class="rft-canvas"></div>
  <textarea class="rft-input" placeholder="Ketik di sini, contoh:&#10;250000 Gaji Utama&#10;+ 50k Bonus projek&#10;- 20rb Makan siang&#10;= Subtotal&#10;&#10;Format: 50k / 100rb / 2,5jt / 1.250.000"></textarea>
  <div class="rft-foot">
    <span class="rft-foot-lbl">Grand Total</span>
    <span class="rft-grand">Rp 0</span>
  </div>
</div>
`;

  function PRINT_HTML(theme, plain) {
    return `<!DOCTYPE html>
<html lang="id" data-theme="${theme}">
<head>
<meta charset="utf-8">
<title>RecallTape — Resi</title>
<style>
  @page { size: 80mm auto; margin: 2mm }
  :root{
    --bg:#fff; --text:#000; --muted:#666; --border:#000;
    --primary:#000;
  }
  [data-theme="dark"]{
    --bg:#1c1b19; --text:#f5f4f2; --muted:#8a8580; --border:#3d3935;
    --primary:#818cf8;
  }
  *{ box-sizing:border-box; margin:0; padding:0 }
  html,body{ background:var(--bg); color:var(--text); font-family:ui-monospace,"SF Mono",Menlo,monospace; font-size:10px; line-height:1.5 }
  body{ padding:6mm 4mm; max-width:72mm; margin:0 auto }
  .hd{ text-align:center; padding-bottom:6px; border-bottom:1px dashed var(--border); margin-bottom:6px }
  .hd h1{ font-size:13px; font-weight:700 }
  .hd .sub{ font-size:9px; color:var(--muted); margin-top:1px }
  pre{ white-space:pre-wrap; word-break:break-word; font-family:inherit; font-size:10px; line-height:1.55 }
  .foot{ margin-top:6px; padding-top:6px; border-top:1px dashed var(--border); text-align:center; font-size:9px; color:var(--muted) }
</style>
</head>
<body>
  <div class="hd"><h1>🧾 RecallTape</h1><div class="sub">${new Date().toLocaleString('id-ID')}</div></div>
  <pre>${escapeHtml(plain)}</pre>
  <div class="foot">RecallFox · disimpan ${new Date().toISOString().slice(0,10)}</div>
</body>
</html>`;
  }

  // Expose for debugging
  window.__recallfoxTape = { show, hide, toggle, addLine, render };
})();
