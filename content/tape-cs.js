// content/tape-cs.js — RecallTape popover content script (v3.14.1 rebuild)
// CalcTape-faithful tape calculator with per-line contenteditable editor.
//
// Key behaviors (matching CalcTape Web):
//   - Per-line contenteditable div (NOT textarea) — every line independently editable
//   - Live number formatting: "100" → "+ 100,00" saat user pindah baris
//   - Active line highlight (bg color-mix + left accent border)
//   - Lined paper background (linear-gradient tiap 24px)
//   - Negative numbers in rose (#FB7185), positive results in emerald (#42C6A0)
//   - Empty line triggers block separator + running total reset
//   - Percent support: "+ 19%" → tambah 19% dari running, hint "| {value}"
//   - Print via hidden iframe (fix "print blank" bug)
//   - Auto-save real-time (debounce 400ms) ke browser.storage.local
//   - 5 micro icon buttons: Pin / Print / Copy / Save / Clear
//   - Click-outside-to-hide (suppressed when pinned)
//   - Dark/light theme adaptive (reads settings.theme)

(async function () {
  if (window.__recallfoxTapeLoaded) return;
  window.__recallfoxTapeLoaded = true;

  // Dynamic-load lib/tape.js (pure module) dari extension URL.
  let tape;
  try {
    tape = await import(browser.runtime.getURL('lib/tape.js'));
  } catch (e) {
    console.warn('[RecallFox/Tape] Failed to load lib/tape.js:', e);
    return;
  }
  const { evaluate, formatNumber, formatCurrency, toPlainText, toMarkdown,
          loadSession, saveSession, savePinState } = tape;

  // ============ State ============
  let host = null;
  let shadow = null;
  let popover = null;
  let editor = null;          // contenteditable div
  let statusCursor = null;    // Ln col status
  let statusAutosave = null;  // "Tersimpan otomatis"
  let resultBlock = null;     // "Result block ini" value
  let resultGrand = null;     // "Grand total" value
  let pinBtn = null;
  let isVisible = false;
  let pinned = false;
  let saveTimer = null;
  let renderTimer = null;
  let isEditing = false;      // flag untuk suppress render saat user sedang mengetik di baris aktif
  let activeLineEl = null;    // reference ke div.activeline

  // ============ Theme detection ============
  async function loadTheme() {
    try {
      const r = await browser.storage.local.get(['settings']);
      const s = (r.settings && r.settings.recallfox_vault) ? r.settings.recallfox_vault.settings || r.settings : r.settings || {};
      let theme = s.theme || 'auto';
      if (theme === 'auto') {
        theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      return theme;
    } catch (e) {
      return 'dark';  // default dark (CalcTape default)
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
    editor = shadow.querySelector('.rft-editor');
    statusCursor = shadow.querySelector('.rft-cursor');
    statusAutosave = shadow.querySelector('.rft-autosave');
    resultBlock = shadow.querySelector('.rft-block-val');
    resultGrand = shadow.querySelector('.rft-grand-val');
    pinBtn = shadow.querySelector('.rft-pin');
    wireEvents();
    // Initial empty line
    ensureEmptyLine();
  }

  // ============ Show / hide ============
  async function show() {
    mount();
    const theme = await loadTheme();
    shadow.host.setAttribute('data-theme', theme);
    popover.classList.add('rft-show');
    isVisible = true;
    // Restore session
    const s = await loadSession();
    if (s.text) {
      loadFromText(s.text);
    }
    if (s.pinned) {
      pinned = true;
      pinBtn.classList.add('rft-active');
      pinBtn.setAttribute('aria-pressed', 'true');
    }
    setTimeout(() => {
      focusLastLine();
      render();
    }, 50);
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

  // ============ Editor logic — per-line contenteditable ============

  /**
   * Parse semua baris di editor jadi array of raw strings.
   */
  function getAllLines() {
    if (!editor) return [];
    const lines = [];
    for (const div of editor.children) {
      if (!div.classList.contains('rft-line')) continue;
      // Ambil textContent mentah (bukan yang sudah diformat)
      // Tapi kita simpan raw text di dataset.raw supaya tidak rusak saat re-render
      const raw = div.dataset.raw != null ? div.dataset.raw : div.textContent;
      lines.push(raw);
    }
    return lines;
  }

  /**
   * Load text multiline ke editor. Setup setiap baris sebagai div.
   */
  function loadFromText(text) {
    // Bersihkan editor
    editor.innerHTML = '';
    const lines = text.split('\n');
    for (const raw of lines) {
      addLineDiv(raw, false);
    }
    if (editor.children.length === 0) {
      addLineDiv('', false);
    }
    render();
  }

  /**
   * Tambah baris div baru di akhir editor (atau setelah refNode).
   * isEditable: kalau true, baris dalam mode editable (raw text). Kalau false, baris akan di-render formatted.
   */
  function addLineDiv(rawText, focusAfter = false) {
    const div = document.createElement('div');
    div.className = 'rft-line rft-empty';
    div.contentEditable = 'true';
    div.spellcheck = false;
    div.dataset.raw = rawText;
    editor.appendChild(div);
    attachLineHandlers(div);
    if (focusAfter) {
      div.focus();
      // Place caret at end
      const range = document.createRange();
      range.selectNodeContents(div);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
    return div;
  }

  function ensureEmptyLine() {
    if (!editor) return;
    // Cek apakah ada baris kosong terakhir
    const last = editor.lastElementChild;
    if (!last || (last.dataset.raw || '').trim() !== '') {
      addLineDiv('', false);
    }
  }

  function focusLastLine() {
    if (!editor) return;
    ensureEmptyLine();
    const last = editor.lastElementChild;
    if (last) {
      last.focus();
      const range = document.createRange();
      range.selectNodeContents(last);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      setActiveLine(last);
    }
  }

  function setActiveLine(div) {
    if (activeLineEl === div) return;
    if (activeLineEl) {
      activeLineEl.classList.remove('activeline');
      // Re-render baris lama (supaya formatted, bukan raw)
      renderLine(activeLineEl);
    }
    activeLineEl = div;
    if (div) {
      div.classList.add('activeline');
      // Saat aktif, tampilkan raw text (editable)
      if (div.dataset.raw != null) {
        div.textContent = div.dataset.raw;
      }
    }
  }

  /**
   * Attach event handlers ke setiap line div.
   */
  function attachLineHandlers(div) {
    div.addEventListener('focus', () => {
      setActiveLine(div);
      updateStatusCursor();
    });
    div.addEventListener('input', () => {
      // Update raw text
      div.dataset.raw = div.textContent;
      // Update empty class
      div.classList.toggle('rft-empty', !div.textContent.trim());
      // Schedule full re-render (debounced)
      scheduleRender();
      scheduleSave();
    });
    div.addEventListener('keydown', (e) => {
      handleKeydown(e, div);
    });
    div.addEventListener('click', () => {
      // Klik baris lama → masuk mode editable
      setActiveLine(div);
    });
    div.addEventListener('blur', () => {
      // Saat blur, re-render baris (formatted)
      if (div === activeLineEl) {
        // Jangan clear activeLineEl di sini — biarkan focus handler yang handle
        // Tapi render formatted version
        setTimeout(() => {
          if (document.activeElement !== div) {
            div.classList.remove('activeline');
            renderLine(div);
          }
        }, 50);
      } else {
        renderLine(div);
      }
    });
  }

  /**
   * Handle keydown di dalam baris.
   */
  function handleKeydown(e, div) {
    // Ctrl+Enter → save to vault
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      doSave();
      return;
    }
    // Esc → hide (unless pinned)
    if (e.key === 'Escape' && !pinned) {
      e.preventDefault();
      hide();
      return;
    }
    if (e.key === 'Enter') {
      // Enter: finalize baris, buat baris baru
      e.preventDefault();
      div.dataset.raw = div.textContent;
      // Jika baris kosong, Enter di sini = trigger block separator
      const text = div.textContent.trim();
      if (!text) {
        // Insert block separator visual (empty line stays empty, but mark block boundary)
        // CalcTape: empty line resets running total. Kita kasih visual marker.
        div.classList.add('rft-block-sep');
        // Buat baris baru setelah ini
        const newDiv = addLineDiv('', false);
        newDiv.focus();
        // Place caret di start
        const range = document.createRange();
        range.selectNodeContents(newDiv);
        range.collapse(true);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        setActiveLine(newDiv);
        scheduleRender();
        scheduleSave();
        return;
      }
      // Baris tidak kosong — finalize & buat baris baru
      div.classList.remove('rft-empty');
      const newDiv = addLineDiv('', false);
      newDiv.focus();
      const range = document.createRange();
      range.selectNodeContents(newDiv);
      range.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      setActiveLine(newDiv);
      scheduleRender();
      scheduleSave();
      return;
    }
    // Backspace di baris kosong + ada baris sebelumnya → merge ke baris sebelumnya
    if (e.key === 'Backspace' && div.textContent === '') {
      const prev = div.previousElementSibling;
      if (prev && prev.classList.contains('rft-line')) {
        e.preventDefault();
        // Hapus baris kosong ini, focus ke akhir baris sebelumnya
        div.remove();
        prev.focus();
        prev.classList.add('activeline');
        activeLineEl = prev;
        const range = document.createRange();
        range.selectNodeContents(prev);
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        // Saat aktif, tampilkan raw
        if (prev.dataset.raw != null) {
          prev.textContent = prev.dataset.raw;
        }
        scheduleRender();
        scheduleSave();
        return;
      }
    }
    // Arrow Up/Down untuk navigasi antar baris
    if (e.key === 'ArrowUp') {
      const prev = div.previousElementSibling;
      if (prev && prev.classList.contains('rft-line')) {
        e.preventDefault();
        prev.focus();
        // Place caret at end
        const range = document.createRange();
        range.selectNodeContents(prev);
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
    if (e.key === 'ArrowDown') {
      const next = div.nextElementSibling;
      if (next && next.classList.contains('rft-line')) {
        e.preventDefault();
        next.focus();
        const range = document.createRange();
        range.selectNodeContents(next);
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
  }

  /**
   * Render formatted version dari satu baris.
   */
  function renderLine(div) {
    if (!div || !div.classList.contains('rft-line')) return;
    // Skip jika sedang active (sedang editable raw)
    if (div === activeLineEl && document.activeElement === div) return;

    const raw = div.dataset.raw || '';
    const trimmed = raw.trim();
    if (!trimmed) {
      // Empty line
      div.className = 'rft-line rft-empty' + (div.classList.contains('rft-block-sep') ? ' rft-block-sep' : '');
      div.innerHTML = '';
      return;
    }

    // Parse line
    const parsed = tape.parseLine(raw);
    if (!parsed) {
      div.className = 'rft-line rft-empty';
      div.innerHTML = '';
      return;
    }

    // Render berdasarkan jenis
    if (parsed.op === 'comment') {
      div.className = 'rft-line rft-text';
      div.innerHTML = `<span class="text">${escapeHtml(parsed.note)}</span>`;
      return;
    }
    if (parsed.op === 'note') {
      div.className = 'rft-line rft-text';
      div.innerHTML = `<span class="text">${escapeHtml(parsed.note)}</span>`;
      return;
    }
    if (parsed.op === '=') {
      div.className = 'rft-line rft-subtotal-marker';
      div.innerHTML = `<span class="op">=</span><span class="subtotal-label">${escapeHtml(parsed.note || 'Subtotal')}</span>`;
      return;
    }

    // Op row: +, -, *, /
    // Cari entry yang cocok dari evaluator supaya dapat running total
    const sym = OP_SYMBOL[parsed.op] || '+';
    const amtStr = formatNumber(parsed.amount);
    const isNeg = parsed.op === '-' || (parsed.op === '/' && parsed.amount > 1);
    let amtClass = 'number';
    if (parsed.op === '-') amtClass += ' negative';

    let html = `<span class="op">${sym} </span>`;
    if (parsed.isPercent) {
      html += `<span class="${amtClass}">${amtStr}%</span>`;
    } else {
      html += `<span class="${amtClass}">${amtStr}</span>`;
    }
    if (parsed.note) {
      html += `<span class="comment"> ${escapeHtml(parsed.note)}</span>`;
    }
    div.className = 'rft-line rft-number' + (parsed.isPercent ? ' rft-percent' : '');
    div.innerHTML = html;
  }

  /**
   * Full render: evaluate all lines, render formatted version untuk semua baris non-active,
   * tambah separator otomatis sebelum subtotal, update result display.
   */
  function render() {
    if (!editor) return;

    const allLines = getAllLines();
    const result = evaluate(allLines);

    // v3.14.2 FIX: Evaluate SEMUA baris termasuk active line.
    // Sebelumnya: active line di-skip → user tidak lihat live calculation
    // untuk baris yang sedang diketik. User report "hitung ga jalan".
    // Sekarang: evaluate semua, tapi hanya skip FORMATTING (innerHTML override)
    // untuk active line — result display tetap update dengan active line termasuk.

    // Map line index → entry (untuk lookup saat render)
    let entryIdx = 0;
    const lineDivs = Array.from(editor.children).filter(c => c.classList.contains('rft-line'));

    for (let i = 0; i < lineDivs.length; i++) {
      const div = lineDivs[i];
      const raw = div.dataset.raw || '';
      const trimmed = raw.trim();

      // Skip FORMATTING active line (jangan override contenteditable content)
      // TAPI tetap evaluate (sudah di-include di allLines di atas)
      if (div === activeLineEl && document.activeElement === div) {
        continue;
      }

      if (!trimmed) {
        // Empty line
        div.className = 'rft-line rft-empty' + (div.classList.contains('rft-block-sep') ? ' rft-block-sep' : '');
        div.innerHTML = '';
        continue;
      }

      const parsed = tape.parseLine(raw);
      if (!parsed) {
        div.className = 'rft-line rft-empty';
        div.innerHTML = '';
        continue;
      }

      // Cari entry yang cocok
      let entry = null;
      while (entryIdx < result.entries.length) {
        const e = result.entries[entryIdx];
        if (e.raw === raw || (e.note === parsed.note && e.op === parsed.op)) {
          entry = e;
          entryIdx++;
          break;
        }
        entryIdx++;
      }

      // Render berdasarkan parsed + entry
      renderLineFromEntry(div, parsed, entry);
    }

    // Update result display — sekarang INCLUDES active line karena allLines sudah punya semua
    const lastEntry = result.entries[result.entries.length - 1];
    const blockVal = lastEntry ? lastEntry.running : 0;
    resultBlock.textContent = formatNumber(blockVal);
    resultGrand.textContent = formatNumber(result.grandTotal);

    // Update autosave status
    if (statusAutosave) {
      statusAutosave.textContent = '✓ Tersimpan otomatis';
      statusAutosave.classList.remove('rft-saving');
    }

    if (result.error && statusAutosave) {
      statusAutosave.textContent = '⚠ ' + result.error;
      statusAutosave.classList.add('rft-error');
    } else if (statusAutosave) {
      statusAutosave.classList.remove('rft-error');
    }
  }

  /**
   * Render satu baris dari parsed + entry (yang punya running total).
   * Insert separator otomatis sebelum subtotal.
   */
  function renderLineFromEntry(div, parsed, entry) {
    if (parsed.op === 'comment' || parsed.op === 'note') {
      div.className = 'rft-line rft-text';
      div.innerHTML = `<span class="text">${escapeHtml(parsed.note)}</span>`;
      return;
    }
    if (parsed.op === '=') {
      // Subtotal: ada separator sebelum + result line
      div.className = 'rft-line rft-subtotal';
      const subVal = entry ? formatNumber(entry.running) : '0';
      div.innerHTML = `
        <span class="op">=</span>
        <span class="subtotal-label">${escapeHtml(parsed.note || 'Subtotal')}</span>
        <span class="subtotal-val">${subVal}</span>
      `;
      return;
    }

    // Op row
    const sym = OP_SYMBOL[parsed.op] || '+';
    const amtStr = formatNumber(parsed.amount);
    let amtClass = 'number';
    if (parsed.op === '-') amtClass += ' negative';

    let html = `<span class="op">${sym} </span>`;
    if (parsed.isPercent) {
      html += `<span class="${amtClass}">${amtStr}%</span>`;
      // Hint percent value (absolut)
      if (entry && entry.percentValue != null) {
        const hintVal = formatNumber(entry.percentValue);
        html += `<span class="hint"> | ${hintVal}</span>`;
      }
    } else {
      html += `<span class="${amtClass}">${amtStr}</span>`;
    }
    if (parsed.note) {
      html += `<span class="comment"> ${escapeHtml(parsed.note)}</span>`;
    }
    div.className = 'rft-line rft-number' + (parsed.isPercent ? ' rft-percent' : '');
    div.innerHTML = html;
  }

  function scheduleRender() {
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      renderTimer = null;
      render();
      updateStatusCursor();
    }, 150);
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    if (statusAutosave) {
      statusAutosave.textContent = '⏳ Menyimpan…';
      statusAutosave.classList.add('rft-saving');
    }
    saveTimer = setTimeout(() => {
      saveTimer = null;
      const text = getAllLines().join('\n');
      saveSession(text);
    }, 400);
  }

  function updateStatusCursor() {
    if (!statusCursor) return;
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const div = document.activeElement;
    if (!div || !div.classList || !div.classList.contains('rft-line')) {
      statusCursor.textContent = 'Ln 0:0';
      return;
    }
    // Hitung line number
    const all = Array.from(editor.children).filter(c => c.classList.contains('rft-line'));
    const ln = all.indexOf(div) + 1;
    // Hitung column (caret offset dalam textContent)
    const range = sel.getRangeAt(0);
    const preRange = range.cloneRange();
    preRange.selectNodeContents(div);
    preRange.setEnd(range.endContainer, range.endOffset);
    const col = preRange.toString().length;
    statusCursor.textContent = `Ln ${ln}:${col}`;
  }

  // ============ Wire events ============
  function wireEvents() {
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
    const text = getAllLines().join('\n');
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
    const text = getAllLines().join('\n');
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
          source: { kind: 'tape', plainText: plain, savedAt: new Date().toISOString() }
        }
      });
      flashBtn(shadow.querySelector('.rft-save'), '✓');
    } catch (e) {
      console.warn('[RecallFox/Tape] Save failed:', e);
      flashBtn(shadow.querySelector('.rft-save'), '✗');
    }
  }

  // v3.14.1: Print via hidden iframe (fix "print blank" bug).
  // Sebelumnya pakai window.open('', '_blank') yang sering di-block popup blocker.
  function doPrint() {
    const text = getAllLines().join('\n');
    const result = evaluate(text);
    if (result.entries.length === 0) {
      toast('Tape kosong — tidak ada yang dicetak');
      return;
    }
    const html = RECEIPT_HTML(result);
    // v3.14.2 FIX: Append iframe ke document.body (BUKAN shadow DOM).
    // Firefox punya known issue: iframe di Shadow DOM → contentWindow.document.write()
    // bisa fail atau print blank. document.body lebih reliable.
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;z-index:-1;';
    document.body.appendChild(iframe);
    try {
      const doc = iframe.contentWindow.document;
      doc.open();
      doc.write(html);
      doc.close();
    } catch (e) {
      console.warn('[RecallFox/Tape] iframe document.write failed:', e);
      toast('Gagal mencetak: ' + e.message);
      iframe.remove();
      return;
    }
    // Wait for content to load, then print
    const tryPrint = () => {
      try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
      } catch (e) {
        console.warn('[RecallFox/Tape] Print failed:', e);
        toast('Gagal mencetak: ' + e.message);
      }
      // Cleanup iframe setelah print dialog (kasih delay 1.5 detik)
      setTimeout(() => {
        try { iframe.remove(); } catch (e) {}
      }, 1500);
    };
    // Beri waktu untuk render
    setTimeout(tryPrint, 300);
    flashBtn(shadow.querySelector('.rft-print'), '✓');
  }

  function doClear() {
    const allLines = getAllLines();
    const hasContent = allLines.some(l => l.trim());
    if (!hasContent) return;
    if (!confirm('Kosongkan tape? Semua baris akan dihapus.')) return;
    // Reset editor
    editor.innerHTML = '';
    addLineDiv('', false);
    focusLastLine();
    render();
    scheduleSave();
    toast('Tape dikosongkan');
  }

  function addLine(line) {
    mount();
    show().then(() => {
      const trimmed = String(line || '').trim();
      if (!trimmed) return;
      // Heuristic: if selection is a pure number, prefix with '+'; if it starts with operator, leave as is; else treat as a note line.
      let prefix = '+ ';
      if (/^[+\-*/=×÷]/.test(trimmed)) prefix = '';
      else if (!/^[\d.,]/.test(trimmed)) prefix = '# ';  // comment line
      const newLine = prefix + trimmed;
      // Tambah ke baris kosong terakhir (atau buat baru)
      const last = editor.lastElementChild;
      if (last && last.classList.contains('rft-line') && (last.dataset.raw || '').trim() === '') {
        last.dataset.raw = newLine;
        last.textContent = newLine;
        last.classList.remove('rft-empty');
      } else {
        addLineDiv(newLine, false);
      }
      // Tambah baris kosong baru + focus
      const newDiv = addLineDiv('', false);
      newDiv.focus();
      setActiveLine(newDiv);
      render();
      scheduleSave();
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

  // ============ Template (HTML + CSS inlined in Shadow DOM) ============
  // CalcTape-faithful palette:
  //   --paper:    #273953  (editor bg, navy slate)
  //   --ink:      #E8EEF7  (main text)
  //   --line:     #364C6C  (grid lines)
  //   --surface:  #0E182A  (popover outer bg)
  //   --card:     #1A293D  (header/footer)
  //   --accent:   #60A5FA  (active line border)
  //   --accent-bg:#1E3A8A  (active line bg)
  //   --muted:    #A3B0C2  (hint, comment)
  //   --neg:      #FB7185  (negative numbers, rose)
  //   --pos:      #42C6A0  (positive results, emerald)
  const TEMPLATE = `
<style>
:host{all:initial}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;font-family:inherit}

.rft-popover{
  position:fixed; top:14px; right:14px;
  width:340px; max-height:520px;
  background:var(--rft-surface, #0E182A); color:var(--rft-ink, #E8EEF7);
  border:1px solid var(--rft-border, #1A293D);
  border-radius:12px;
  box-shadow:0 18px 50px rgba(0,0,0,.55), 0 2px 8px rgba(0,0,0,.4);
  display:flex; flex-direction:column; overflow:hidden;
  font-family:Menlo,Consolas,"Courier New",monospace;
  font-size:13px;
  opacity:0; transform:translateY(-6px) scale(.98); pointer-events:none;
  transition:opacity .15s ease, transform .15s ease;
  pointer-events:auto;
  resize:both;
  min-width:280px; min-height:320px;
}

/* Dark theme (CalcTape-faithful) */
:host([data-theme="dark"]) .rft-popover{
  --rft-paper:#273953; --rft-ink:#E8EEF7; --rft-line:#364C6C;
  --rft-surface:#0E182A; --rft-card:#1A293D; --rft-border:#1A293D;
  --rft-accent:#60A5FA; --rft-accent-bg:#1E3A8A;
  --rft-muted:#A3B0C2; --rft-neg:#FB7185; --rft-pos:#42C6A0;
  --rft-orange:#F0B64A;
}
/* Light theme */
:host([data-theme="light"]) .rft-popover{
  --rft-paper:#FFFFFF; --rft-ink:#1E293B; --rft-line:#CBD5E1;
  --rft-surface:#F8FAFC; --rft-card:#FFFFFF; --rft-border:#E2E8F0;
  --rft-accent:#3B82F6; --rft-accent-bg:#DBEAFE;
  --rft-muted:#64748B; --rft-neg:#E11D48; --rft-pos:#059669;
  --rft-orange:#D97706;
}

.rft-popover.rft-show{ opacity:1; transform:translateY(0) scale(1); pointer-events:auto }

/* Header */
.rft-hd{
  display:flex; align-items:center; gap:6px;
  padding:6px 8px; flex:none;
  background:var(--rft-card); border-bottom:1px solid var(--rft-border);
}
.rft-title{
  font-size:11px; font-weight:700; color:var(--rft-ink); letter-spacing:-.01em;
  flex:1; display:flex; align-items:center; gap:5px;
  font-family:-apple-system,system-ui,"Segoe UI",sans-serif;
}
.rft-title-ic{ font-size:13px; line-height:1; }
.rft-actions{ display:flex; gap:1px; }

/* Micro icon buttons — 20x20px sesuai spec user */
.rft-btn{
  width:20px; height:20px; border-radius:4px; border:none; background:none;
  color:var(--rft-muted); cursor:pointer; font-size:10px; line-height:1;
  display:grid; place-items:center; transition:.12s; padding:0;
}
.rft-btn:hover{ background:rgba(255,255,255,.08); color:var(--rft-ink) }
.rft-btn:active{ transform:scale(.92) }
.rft-btn.rft-active{ background:var(--rft-accent-bg); color:var(--rft-accent) }
.rft-btn.rft-flash{ background:var(--rft-pos); color:#fff }
.rft-btn svg{ width:11px; height:11px }

/* Editor (contenteditable, per-line) */
.rft-editor{
  flex:1; overflow-y:auto; min-height:160px; max-height:380px;
  background:var(--rft-paper); color:var(--rft-ink);
  font-family:Menlo,Consolas,"Courier New",monospace;
  font-size:13px; line-height:24px;
  padding:4px 14px 20px;
  outline:none;
  font-variant-numeric:tabular-nums;
}
.rft-editor::-webkit-scrollbar{ width:6px }
.rft-editor::-webkit-scrollbar-thumb{ background:var(--rft-line); border-radius:3px }
.rft-editor::-webkit-scrollbar-track{ background:transparent }

/* Setiap baris (div.rft-line) */
.rft-line{
  position:relative; padding-left:14px; min-height:24px;
  outline:none; word-break:break-word;
}
.rft-line.rft-empty:before{
  content:'\\00a0';  /* non-breaking space supaya tinggi 24px */
  color:transparent;
}
.rft-line.activeline{
  background:var(--rft-accent-bg);
  border-left:2px solid var(--rft-accent);
  padding-left:12px;
  opacity:0.85;
}
.rft-line.rft-block-sep{
  border-top:1px dashed var(--rft-line);
  margin-top:4px; padding-top:4px;
}

/* Text/comment line */
.rft-line.rft-text{
  font-family:-apple-system,system-ui,"Segoe UI",sans-serif;
  color:var(--rft-muted);
}
.rft-line.rft-text .text{ color:var(--rft-muted) }

/* Number line */
.rft-line.rft-number{
  color:var(--rft-ink);
  font-family:Menlo,Consolas,"Courier New",monospace;
}
.rft-line.rft-number .op{
  color:var(--rft-muted); font-weight:700; margin-right:2px;
}
.rft-line.rft-number .number{ color:var(--rft-ink); }
.rft-line.rft-number .number.negative{ color:var(--rft-neg); }
.rft-line.rft-number .comment{
  color:var(--rft-muted);
  font-family:-apple-system,system-ui,"Segoe UI",sans-serif;
  margin-left:6px;
}
.rft-line.rft-number .hint{
  color:var(--rft-muted); opacity:.7;
  margin-left:6px; font-size:11px;
}

/* Subtotal line */
.rft-line.rft-subtotal{
  color:var(--rft-ink); padding-top:2px; margin-top:2px;
  border-top:1px solid var(--rft-line);
  display:flex; align-items:baseline; gap:6px;
}
.rft-line.rft-subtotal .op{ color:var(--rft-accent); font-weight:700 }
.rft-line.rft-subtotal .subtotal-label{
  color:var(--rft-muted); font-family:-apple-system,system-ui,sans-serif;
  flex:1;
}
.rft-line.rft-subtotal .subtotal-val{
  color:var(--rft-pos); font-weight:700;
  font-family:Menlo,Consolas,monospace;
}

/* Status bar */
.rft-status{
  flex:none; padding:4px 10px; background:var(--rft-card);
  border-top:1px solid var(--rft-border);
  display:flex; align-items:center; gap:8px;
  font-family:-apple-system,system-ui,"Segoe UI",sans-serif;
  font-size:10px; color:var(--rft-muted);
}
.rft-status .rft-cursor{ font-family:Menlo,Consolas,monospace; }
.rft-status .rft-autosave{
  margin-left:auto; display:flex; align-items:center; gap:3px;
}
.rft-status .rft-autosave.rft-saving{ color:var(--rft-orange); }
.rft-status .rft-autosave.rft-error{ color:var(--rft-neg); }

/* Result sidebar (mini, di bawah status bar) */
.rft-result-bar{
  flex:none; padding:8px 12px; background:var(--rft-card);
  border-top:1px solid var(--rft-border);
  display:flex; gap:14px; align-items:flex-end;
}
.rft-block, .rft-grand{ display:flex; flex-direction:column; gap:1px; }
.rft-grand{ margin-left:auto; text-align:right; align-items:flex-end; }
.rft-eyebrow{
  font-family:-apple-system,system-ui,sans-serif;
  font-size:9px; font-weight:700; letter-spacing:.05em;
  color:var(--rft-accent); text-transform:uppercase;
}
.rft-block-val{
  font-family:Menlo,Consolas,monospace; font-size:14px; font-weight:600;
  color:var(--rft-ink); font-variant-numeric:tabular-nums;
}
.rft-grand-val{
  font-family:Menlo,Consolas,monospace; font-size:20px; font-weight:700;
  color:var(--rft-pos); font-variant-numeric:tabular-nums;
  line-height:1;
}

/* Toast */
.rft-toast{
  position:absolute; bottom:8px; left:50%; transform:translateX(-50%) translateY(8px);
  background:var(--rft-ink); color:var(--rft-paper); padding:5px 10px; border-radius:6px;
  font-size:11px; font-weight:600; opacity:0; pointer-events:none; transition:.2s;
  white-space:nowrap; max-width:90%;
  font-family:-apple-system,system-ui,sans-serif;
}
.rft-toast.rft-show{ opacity:1; transform:translateX(-50%) translateY(0) }

/* Hint placeholder untuk baris kosong */
.rft-empty-hint{
  position:absolute; top:4px; left:14px;
  color:var(--rft-muted); opacity:.4; pointer-events:none;
  font-family:-apple-system,system-ui,sans-serif; font-size:11px;
}
</style>
<div class="rft-popover" role="dialog" aria-label="RecallTape calculator">
  <div class="rft-hd">
    <div class="rft-title">
      <svg class="rft-title-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6"/><path d="M3 11h18"/><path d="M3 11v8a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-8"/><path d="M7 15h4"/></svg>
      RecallTape
    </div>
    <div class="rft-actions">
      <button class="rft-btn rft-pin" title="Pin (kunci popover agar tetap terbuka)" aria-pressed="false">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.5V4h6v6.5l2 3.5H7l2-3.5z"/></svg>
      </button>
      <button class="rft-btn rft-print" title="Cetak resi (PDF)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
      </button>
      <button class="rft-btn rft-copy" title="Salin sebagai teks">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      </button>
      <button class="rft-btn rft-save" title="Simpan ke Vault (Ctrl+Enter)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
      </button>
      <button class="rft-btn rft-clear" title="Kosongkan">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>
    </div>
  </div>
  <div class="rft-editor" contenteditable="true" spellcheck="false"></div>
  <div class="rft-status">
    <span class="rft-cursor">Ln 0:0</span>
    <span class="rft-autosave">✓ Tersimpan otomatis</span>
  </div>
  <div class="rft-result-bar">
    <div class="rft-block">
      <span class="rft-eyebrow">Result block ini</span>
      <span class="rft-block-val">0</span>
    </div>
    <div class="rft-grand">
      <span class="rft-eyebrow">Grand total</span>
      <span class="rft-grand-val">0</span>
    </div>
  </div>
</div>
`;

  // ============ Receipt HTML for print ============
  function RECEIPT_HTML(tape) {
    const lines = [];
    lines.push(`<div class="rct-hd"><h1>🧾 RecallFox Tape Sheet</h1><div class="sub">${new Date().toLocaleString('id-ID')}</div></div>`);
    for (const e of tape.entries) {
      if (e.kind === 'comment') {
        lines.push(`<div class="rct-line rct-comment"># ${escapeHtml(e.note)}</div>`);
        continue;
      }
      if (e.kind === 'note') {
        lines.push(`<div class="rct-line rct-comment">${escapeHtml(e.note)}</div>`);
        continue;
      }
      if (e.kind === 'subtotal') {
        lines.push(`<div class="rct-line rct-sep">---------------</div>`);
        lines.push(`<div class="rct-line rct-subtotal"><span class="rct-op">=</span><span class="rct-label">${escapeHtml(e.note || 'Subtotal')}</span><span class="rct-val">${formatNumber(e.running)}</span></div>`);
        continue;
      }
      // op row
      const sym = OP_SYMBOL[e.op] || '+';
      const amtStr = e.isPercent ? `${formatNumber(e.amount)}%` : formatNumber(e.amount);
      const hint = e.isPercent && e.percentValue != null ? ` | ${formatNumber(e.percentValue)}` : '';
      lines.push(`<div class="rct-line rct-op"><span class="rct-op">${sym}</span><span class="rct-amt">${amtStr}${hint}</span><span class="rct-note">${escapeHtml(e.note || '')}</span></div>`);
    }
    lines.push(`<div class="rct-line rct-sep rct-double">===============</div>`);
    lines.push(`<div class="rct-line rct-total"><span class="rct-op">=</span><span class="rct-label">GRAND TOTAL</span><span class="rct-val">${formatNumber(tape.grandTotal)}</span></div>`);

    return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8">
<title>RecallTape — Resi ${new Date().toISOString().slice(0,10)}</title>
<style>
  @page { size: 80mm auto; margin: 2mm; }
  *{ box-sizing:border-box; margin:0; padding:0 }
  html,body{
    background:#fff; color:#000;
    font-family:Menlo,Consolas,"Courier New",monospace;
    font-size:10px; line-height:1.55;
  }
  body{ padding:4mm; max-width:72mm; margin:0 auto; }
  .rct-hd{ text-align:center; padding-bottom:3mm; border-bottom:1px dashed #000; margin-bottom:3mm; }
  .rct-hd h1{ font-size:13px; font-weight:700; }
  .rct-hd .sub{ font-size:9px; color:#666; margin-top:1px; }
  .rct-line{
    white-space:pre-wrap; word-break:break-word;
    padding:1px 0; display:flex; align-items:baseline;
  }
  .rct-line.rct-comment{ color:#444; font-family:-apple-system,system-ui,sans-serif; }
  .rct-line.rct-op .rct-op{ width:8px; flex:none; font-weight:700; }
  .rct-line.rct-op .rct-amt{ flex:1; padding-left:4px; font-variant-numeric:tabular-nums; }
  .rct-line.rct-op .rct-note{ flex:none; max-width:50%; overflow:hidden; color:#555; font-family:-apple-system,system-ui,sans-serif; }
  .rct-line.rct-sep{ color:#666; padding:0; letter-spacing:1px; }
  .rct-line.rct-sep.rct-double{ font-weight:700; color:#000; }
  .rct-line.rct-subtotal{ padding-top:2px; }
  .rct-line.rct-subtotal .rct-op{ width:8px; flex:none; font-weight:700; }
  .rct-line.rct-subtotal .rct-label{ flex:1; padding-left:4px; font-family:-apple-system,system-ui,sans-serif; }
  .rct-line.rct-subtotal .rct-val{ flex:none; font-weight:700; font-variant-numeric:tabular-nums; }
  .rct-line.rct-total{ padding-top:3px; margin-top:2px; border-top:1px solid #000; font-weight:700; font-size:11px; }
  .rct-line.rct-total .rct-op{ width:8px; flex:none; }
  .rct-line.rct-total .rct-label{ flex:1; padding-left:4px; font-family:-apple-system,system-ui,sans-serif; }
  .rct-line.rct-total .rct-val{ flex:none; font-variant-numeric:tabular-nums; }
  .rct-foot{ margin-top:4mm; padding-top:2mm; border-top:1px dashed #000; text-align:center; font-size:9px; color:#666; font-family:-apple-system,system-ui,sans-serif; }
</style>
</head>
<body>
  ${lines.join('\n  ')}
  <div class="rct-foot">RecallFox · dicetak ${new Date().toISOString().slice(0,10)}</div>
</body>
</html>`;
  }

  // Expose for debugging
  window.__recallfoxTape = { show, hide, toggle, addLine, render, evaluate };
})();
