// content/sidebar-cs.js — RecallFox Popout Sidebar (iframe approach)
//
// v3.20.5 (Firefox) / v3.20.10 (Chrome) — fix 6 bug dari user:
// 1. Toggle buka/tutup jalan (pakai toggle() bukan show())
// 2. Floating button text "rf" (bukan 🦊)
// 3. Floating button draggable
// 4. Default width = MIN_WIDTH (280px)
// 5. Hide during screenshot capture
// 6. Auto-close 15s idle + pin button

(async function () {
  if (window.__recallfoxSidebarLoaded) return;
  window.__recallfoxSidebarLoaded = true;

  const HOST_ID = 'recallfox-sidebar-host';
  const FLOATER_ID = 'recallfox-sidebar-floater';
  const STORAGE_KEY = 'recallfox_sidebar_in_page_state';
  const FLOATER_POS_KEY = 'recallfox_popout_floater_pos';
  const DEFAULT_WIDTH = 280;  // v3.20.5: was 340, user mau "ukuran terkecil"
  const MIN_WIDTH = 280;
  const MAX_WIDTH = 600;
  const AUTO_CLOSE_MS = 15000;  // v3.20.5: 15 detik idle → auto-close
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

  // ===== Idle timer (auto-close 15s) =====
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

  // ===== Load floater position from localStorage =====
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

  // ===== Mount host + iframe + resize handle + pin button =====
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

    // v3.20.5: Pin button — kecil, di pojok kanan atas host
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

  // ===== Floating toggle button (text "rf", draggable) =====
  function mountFloater() {
    if (floater) return;
    floater = document.createElement('div');
    floater.id = FLOATER_ID;
    floater.setAttribute('role', 'button');
    floater.setAttribute('tabindex', '0');
    floater.textContent = 'rf';
    floater.title = 'Buka RecallFox sidebar';
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

    // Restore position dari localStorage
    const savedPos = loadFloaterPos();
    if (savedPos) {
      floater.style.left = Math.max(0, Math.min(window.innerWidth - 36, savedPos.x)) + 'px';
      floater.style.top = Math.max(0, Math.min(window.innerHeight - 36, savedPos.y)) + 'px';
      floater.style.bottom = 'auto';
      floater.style.right = 'auto';
    } else {
      floater.style.bottom = '24px';
      floater.style.right = '24px';
    }

    // v3.20.5: Drag logic (copy pattern dari overlay.js)
    let dragState = { dragging: false, startX: 0, startY: 0, origX: 0, origY: 0, moved: false };

    floater.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      dragState.dragging = true;
      dragState.startX = e.clientX;
      dragState.startY = e.clientY;
      const rect = floater.getBoundingClientRect();
      dragState.origX = rect.left;
      dragState.origY = rect.top;
      dragState.moved = false;
      try { floater.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    });

    floater.addEventListener('pointermove', (e) => {
      if (!dragState.dragging) return;
      const dx = e.clientX - dragState.startX;
      const dy = e.clientY - dragState.startY;
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
    });

    floater.addEventListener('pointerup', (e) => {
      if (dragState.dragging) {
        dragState.dragging = false;
        try { floater.releasePointerCapture(e.pointerId); } catch (err) {}
        if (dragState.moved) {
          // Save position
          const rect = floater.getBoundingClientRect();
          saveFloaterPos(rect.left, rect.top);
        } else {
          // Click (not drag) → toggle popout
          e.preventDefault();
          e.stopPropagation();
          toggle();
        }
      }
    });

    floater.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    });

    document.documentElement.appendChild(floater);
  }

  function unmountFloater() {
    if (floater) { floater.remove(); floater = null; }
  }

  // ===== Show / Hide / Toggle =====
  function show() {
    mount();
    host.style.width = currentWidth + 'px';
    host.style.display = 'block';
    isVisible = true;
    unmountFloater();
    resetIdleTimer();  // v3.20.5: start idle timer
    saveState({ visible: true, width: currentWidth, pinned: isPinned });
  }
  function hide() {
    if (!host) return;
    host.style.display = 'none';
    isVisible = false;
    if (idleTimer) clearTimeout(idleTimer);  // v3.20.5: stop idle timer
    mountFloater();
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
    // v3.20.5: Hide during screenshot capture
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
    if (state.visible) {
      setTimeout(() => show(), 500);
    } else {
      mountFloater();
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
      version: '3.20.5-iframe'
    };
  }
})();
