// content/sidebar-cs.js — RecallFox Popout Sidebar (iframe approach)
//
// v3.20.6 (Firefox) — fix berdasarkan user feedback:
// 1. Close button: JANGAN unmount floater di show() — ubah text jadi "✕" saat open
//    User: "tombol tutup popout sidebar nya tidak berfungsi di versi firefox"
//    Root cause: #sidebarInPageBtn di iframe kirim browser.tabs.sendMessage yang
//    gagal di Firefox (cross-origin iframe context). Fix: floater tetap visible
//    sebagai tombol close, text "✕" saat open, "rf" saat closed.
// 2. "sc" button: Posisi offset dari "rf" supaya tidak overlap
// 3. Draggable: Tambah mouse event fallback (Firefox tidak reliable dengan setPointerCapture)

(async function () {
  if (window.__recallfoxSidebarLoaded) return;
  window.__recallfoxSidebarLoaded = true;

  const HOST_ID = 'recallfox-sidebar-host';
  const FLOATER_ID = 'recallfox-sidebar-floater';
  const STORAGE_KEY = 'recallfox_sidebar_in_page_state';
  const FLOATER_POS_KEY = 'recallfox_popout_floater_pos';
  const DEFAULT_WIDTH = 280;
  const MIN_WIDTH = 280;
  const MAX_WIDTH = 600;
  const AUTO_CLOSE_MS = 15000;
  const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart', 'input', 'wheel'];

  let host = null;
  let iframe = null;
  let resizeHandle = null;
  let floater = null;
  let pinBtn = null;
  let isVisible = false;
  let currentWidth = DEFAULT_WIDTH;
  let isPinned = false;
  let idleTimer = null;

  // ===== Storage =====
  async function loadState() {
    try {
      const r = await browser.storage.local.get([STORAGE_KEY]);
      const s = r[STORAGE_KEY] || {};
      return {
        visible: !!s.visible,
        width: Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, s.width || DEFAULT_WIDTH)),
        pinned: !!s.pinned
      };
    } catch (e) { return { visible: false, width: DEFAULT_WIDTH, pinned: false }; }
  }
  async function saveState(state) {
    try { await browser.storage.local.set({ [STORAGE_KEY]: state }); } catch (e) {}
  }

  // ===== Idle timer =====
  function resetIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer);
    if (isPinned || !isVisible) return;
    idleTimer = setTimeout(() => {
      console.log('[RecallFox] Popout auto-close after 15s idle');
      hide();
    }, AUTO_CLOSE_MS);
  }
  function onActivity() {
    if (isVisible && !isPinned) resetIdleTimer();
  }
  ACTIVITY_EVENTS.forEach(ev => document.addEventListener(ev, onActivity, { passive: true, capture: true }));

  // ===== Floater position persistence =====
  function loadFloaterPos() {
    try {
      const pos = JSON.parse(localStorage.getItem(FLOATER_POS_KEY) || 'null');
      if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') return pos;
    } catch (e) {}
    return null;
  }
  function saveFloaterPos(x, y) {
    try { localStorage.setItem(FLOATER_POS_KEY, JSON.stringify({ x, y })); } catch (e) {}
  }

  // ===== Mount host + iframe + resize + pin =====
  function mount() {
    if (host) return;
    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = [
      'all:initial', 'position:fixed', 'top:0', 'right:0',
      'height:100vh', 'width:' + currentWidth + 'px',
      'z-index:2147483646', 'pointer-events:none'
    ].join(';');
    document.documentElement.appendChild(host);

    // Resize handle
    resizeHandle = document.createElement('div');
    resizeHandle.setAttribute('role', 'separator');
    resizeHandle.title = 'Seret untuk ubah lebar';
    resizeHandle.style.cssText = [
      'all:initial', 'position:absolute', 'top:0', 'left:0',
      'width:6px', 'height:100%', 'cursor:ew-resize', 'pointer-events:auto',
      'background:transparent', 'z-index:2', 'transition:background .15s ease'
    ].join(';');
    host.appendChild(resizeHandle);

    // Iframe
    iframe = document.createElement('iframe');
    iframe.setAttribute('title', 'RecallFox Sidebar');
    iframe.src = browser.runtime.getURL('sidebar/sidebar.html');
    iframe.style.cssText = [
      'all:initial', 'position:absolute', 'top:0', 'left:6px',
      'width:calc(100% - 6px)', 'height:100%', 'border:0',
      'background:#ffffff', 'pointer-events:auto',
      'box-shadow:-8px 0 32px rgba(0,0,0,.12)'
    ].join(';');
    host.appendChild(iframe);

    // Pin button
    pinBtn = document.createElement('div');
    pinBtn.id = 'recallfox-popout-pin';
    pinBtn.setAttribute('role', 'button');
    pinBtn.title = isPinned ? 'Lepas pin (auto-close aktif)' : 'Pin (anti auto-close)';
    pinBtn.textContent = isPinned ? '📌' : '📍';
    pinBtn.style.cssText = [
      'all:initial', 'position:absolute', 'top:4px', 'right:4px',
      'width:24px', 'height:24px', 'z-index:3', 'cursor:pointer',
      'pointer-events:auto', 'display:grid', 'place-items:center',
      'font-size:14px', 'line-height:1', 'background:rgba(255,255,255,.8)',
      'border-radius:4px', 'user-select:none',
      'font-family:-apple-system,sans-serif'
    ].join(';');
    pinBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      isPinned = !isPinned;
      pinBtn.textContent = isPinned ? '📌' : '📍';
      pinBtn.title = isPinned ? 'Lepas pin (auto-close aktif)' : 'Pin (anti auto-close)';
      if (isPinned) { if (idleTimer) clearTimeout(idleTimer); }
      else resetIdleTimer();
      saveState({ visible: isVisible, width: currentWidth, pinned: isPinned });
    });
    host.appendChild(pinBtn);

    host.style.display = 'none';
    wireResize();
  }

  // ===== Floating "rf" button — draggable, acts as open/close toggle =====
  function mountFloater() {
    if (floater) return;
    floater = document.createElement('div');
    floater.id = FLOATER_ID;
    floater.setAttribute('role', 'button');
    floater.setAttribute('tabindex', '0');
    // v3.20.6: text "rf" saat closed, "✕" saat open
    updateFloaterText();
    floater.title = 'Buka/Tutup RecallFox sidebar';
    floater.style.cssText = [
      'all:initial', 'position:fixed',
      'width:36px', 'height:36px', 'border-radius:8px',
      'background:#6d3df5', 'color:#fff',
      'cursor:pointer', 'z-index:2147483645',
      'display:grid', 'place-items:center',
      'font-size:13px', 'font-weight:700',
      'font-family:monospace', 'line-height:1',
      'pointer-events:auto', 'user-select:none',
      'box-shadow:0 4px 12px rgba(109,61,245,.4)',
      'transition:transform .1s ease'
    ].join(';');

    // Restore position
    const savedPos = loadFloaterPos();
    if (savedPos) {
      floater.style.left = Math.max(0, Math.min(window.innerWidth - 36, savedPos.x)) + 'px';
      floater.style.top = Math.max(0, Math.min(window.innerHeight - 36, savedPos.y)) + 'px';
      floater.style.bottom = 'auto';
      floater.style.right = 'auto';
    } else {
      // v3.20.6: Posisi default offset dari "sc" FAB supaya tidak overlap
      // "sc" FAB ada di bottom:24px right:24px (48px wide)
      // "rf" floater di bottom:24px right:76px (24+48+4 padding)
      floater.style.bottom = '24px';
      floater.style.right = '76px';
    }

    // v3.20.6: Drag logic dengan DUAL pointer + mouse events (Firefox fallback)
    let dragState = { dragging: false, startX: 0, startY: 0, origX: 0, origY: 0, moved: false };

    function onDown(e) {
      if (e.button !== undefined && e.button !== 0) return;
      dragState.dragging = true;
      dragState.startX = e.clientX;
      dragState.startY = e.clientY;
      const rect = floater.getBoundingClientRect();
      dragState.origX = rect.left;
      dragState.origY = rect.top;
      dragState.moved = false;
      // Try pointer capture (Chrome) — fallback to mouse events (Firefox)
      if (e.pointerId !== undefined) {
        try { floater.setPointerCapture(e.pointerId); } catch (err) {}
      }
      e.preventDefault();
    }

    function onMove(e) {
      if (!dragState.dragging) return;
      const cx = e.clientX !== undefined ? e.clientX : e.touches?.[0]?.clientX;
      const cy = e.clientY !== undefined ? e.clientY : e.touches?.[0]?.clientY;
      if (cx === undefined) return;
      const dx = cx - dragState.startX;
      const dy = cy - dragState.startY;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) dragState.moved = true;
      if (!dragState.moved) return;
      let newX = dragState.origX + dx;
      let newY = dragState.origY + dy;
      newX = Math.max(0, Math.min(window.innerWidth - 36, newX));
      newY = Math.max(0, Math.min(window.innerHeight - 36, newY));
      floater.style.left = newX + 'px';
      floater.style.top = newY + 'px';
      floater.style.bottom = 'auto';
      floater.style.right = 'auto';
    }

    function onUp(e) {
      if (!dragState.dragging) return;
      dragState.dragging = false;
      if (e.pointerId !== undefined) {
        try { floater.releasePointerCapture(e.pointerId); } catch (err) {}
      }
      if (dragState.moved) {
        const rect = floater.getBoundingClientRect();
        saveFloaterPos(rect.left, rect.top);
      } else {
        // Click (not drag) → toggle
        e.preventDefault();
        e.stopPropagation();
        toggle();
      }
    }

    // Pointer events (Chrome + Firefox modern)
    floater.addEventListener('pointerdown', onDown);
    floater.addEventListener('pointermove', onMove);
    floater.addEventListener('pointerup', onUp);
    floater.addEventListener('pointercancel', onUp);

    // Mouse events fallback (Firefox)
    floater.addEventListener('mousedown', onDown);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);

    // Touch events (mobile)
    floater.addEventListener('touchstart', onDown, { passive: false });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onUp);

    floater.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    });

    document.documentElement.appendChild(floater);
  }

  // v3.20.6: Update floater text berdasarkan state
  function updateFloaterText() {
    if (!floater) return;
    if (isVisible) {
      floater.textContent = '✕';
      floater.title = 'Tutup popout sidebar';
      floater.style.background = '#ef4444';
    } else {
      floater.textContent = 'rf';
      floater.title = 'Buka RecallFox sidebar';
      floater.style.background = '#6d3df5';
    }
  }

  // ===== Show / Hide / Toggle =====
  function show() {
    mount();
    host.style.width = currentWidth + 'px';
    host.style.display = 'block';
    isVisible = true;
    // v3.20.6: JANGAN unmount floater — ubah text jadi "✕" supaya bisa close
    updateFloaterText();
    resetIdleTimer();
    saveState({ visible: true, width: currentWidth, pinned: isPinned });
  }
  function hide() {
    if (!host) return;
    host.style.display = 'none';
    isVisible = false;
    // v3.20.6: Update floater text kembali ke "rf"
    updateFloaterText();
    if (idleTimer) clearTimeout(idleTimer);
    saveState({ visible: false, width: currentWidth, pinned: isPinned });
  }
  function toggle() {
    if (isVisible) hide();
    else show();
  }

  // ===== Resize handle =====
  function wireResize() {
    let dragging = false, startX = 0, startWidth = 0;
    resizeHandle.addEventListener('mousedown', (e) => {
      dragging = true; startX = e.clientX; startWidth = host.offsetWidth;
      resizeHandle.style.background = 'rgba(79,70,229,.3)';
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const delta = startX - e.clientX;
      currentWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + delta));
      host.style.width = currentWidth + 'px';
    });
    document.addEventListener('mouseup', () => {
      if (dragging) {
        dragging = false;
        resizeHandle.style.background = 'transparent';
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        saveState({ visible: isVisible, width: currentWidth, pinned: isPinned });
      }
    });
    resizeHandle.addEventListener('mouseenter', () => { if (!dragging) resizeHandle.style.background = 'rgba(79,70,229,.2)'; });
    resizeHandle.addEventListener('mouseleave', () => { if (!dragging) resizeHandle.style.background = 'transparent'; });
  }

  // ===== Message listener =====
  browser.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'OPEN_SIDEBAR_IN_PAGE') show();
    else if (msg.type === 'CLOSE_SIDEBAR_IN_PAGE') hide();
    else if (msg.type === 'TOGGLE_SIDEBAR_IN_PAGE') toggle();
    else if (msg.type === 'RF_HIDE_FOR_CAPTURE') {
      if (host && isVisible) host.style.visibility = 'hidden';
      if (floater) floater.style.visibility = 'hidden';
    }
    else if (msg.type === 'RF_RESTORE_AFTER_CAPTURE') {
      if (host && isVisible) host.style.visibility = 'visible';
      if (floater) floater.style.visibility = 'visible';
    }
  });

  // ===== Init =====
  (async function init() {
    if (!/^https?:/i.test(location.protocol) && !/^file:/i.test(location.protocol)) return;
    if (document.readyState === 'loading') {
      await new Promise(r => document.addEventListener('DOMContentLoaded', r, { once: true }));
    }
    const state = await loadState();
    currentWidth = state.width;
    isPinned = state.pinned;
    // v3.20.6: Selalu mount floater (bahkan saat visible) supaya bisa close
    mountFloater();
    if (state.visible) {
      setTimeout(() => show(), 500);
    }
  })();

  // ===== Agent API =====
  if (!window.__recallfox) {
    window.__recallfox = {
      toggle, show, hide,
      get visible() { return isVisible; },
      get iframe() { return iframe; },
      get width() { return currentWidth; },
      setWidth(w) {
        currentWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, w));
        if (host) host.style.width = currentWidth + 'px';
        saveState({ visible: isVisible, width: currentWidth, pinned: isPinned });
      },
      version: '3.20.6-iframe'
    };
  }
})();
