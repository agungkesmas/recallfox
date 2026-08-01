// content/sidebar-cs.js — RecallFox Popout Sidebar (iframe approach)
//
// v3.20.4 (Firefox) / v3.20.9 (Chrome) — experimental, NOT stable.
//
// Tujuan: Sidebar RecallFox sebagai elemen DOM di halaman web ("popout sidebar"),
// supaya user bisa pakai sidebar tanpa buka browser sidebar panel, dan supaya
// agent automation bisa query + operate sidebar via DOM selectors.
//
// Pendekatan: iframe ke sidebar.html (extension page). Iframe load sidebar.html
// yang punya popup.css + sidebar.css + popup.js (semua logic native sidebar).
// Artinya:
//   - Visual 100% identik dengan sidebar native (same CSS, same HTML structure)
//   - Semua tombol + fitur jalan (RecallTape, AI, Theme, Settings, quick tiles,
//     vault list, notes, prayer strip, sync, dll) — pakai popup.js asli
//   - Agent bisa akses via page.frames() di Puppeteer/Playwright, lalu query
//     selector native (.popup, .hd, .cmd, .strip, .vault-view, .tabbar, dll)
//
// Toggle:
//   1. Floating button 🦊 di pojok kanan bawah halaman
//   2. Tombol di header popup (icon panel kanan)
//   3. Context menu "Tampilkan RecallFox di halaman ini"
//   4. Background message TOGGLE_SIDEBAR_IN_PAGE / OPEN_SIDEBAR_IN_PAGE /
//      CLOSE_SIDEBAR_IN_PAGE
//
// Agent API (di parent window):
//   window.__recallfox.toggle() / .show() / .hide()
//   window.__recallfox.iframe  → HTMLIFrameElement (untuk page.frames() lookup)
//
// Limitasi: iframe adalah cross-origin (moz-extension://... vs https://page.com)
// jadi page JS tidak bisa langsung access DOM inside iframe. Agent perlu pakai
// frame traversal: Puppeteer page.frames(), Playwright page.frameLocator().

(async function () {
  if (window.__recallfoxSidebarLoaded) return;
  window.__recallfoxSidebarLoaded = true;

  // ===========================================================================
  // Constants
  // ===========================================================================
  const HOST_ID = 'recallfox-sidebar-host';
  const FLOATER_ID = 'recallfox-sidebar-floater';
  const STORAGE_KEY = 'recallfox_sidebar_in_page_state';
  const DEFAULT_WIDTH = 340;
  const MIN_WIDTH = 280;
  const MAX_WIDTH = 600;

  // ===========================================================================
  // State
  // ===========================================================================
  let host = null;          // <div id="recallfox-sidebar-host"> wrapper
  let iframe = null;        // <iframe src="sidebar.html">
  let resizeHandle = null;  // <div class="rf-resize-handle"> di edge kiri
  let floater = null;       // floating toggle button at page corner
  let isVisible = false;
  let currentWidth = DEFAULT_WIDTH;

  // ===========================================================================
  // Storage helpers
  // ===========================================================================
  async function loadState() {
    try {
      const r = await browser.storage.local.get([STORAGE_KEY]);
      const s = r[STORAGE_KEY] || {};
      return {
        visible: !!s.visible,
        width: Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, s.width || DEFAULT_WIDTH))
      };
    } catch (e) { return { visible: false, width: DEFAULT_WIDTH }; }
  }
  async function saveState(state) {
    try { await browser.storage.local.set({ [STORAGE_KEY]: state }); } catch (e) {}
  }

  // ===========================================================================
  // Mount — create host + iframe + resize handle
  // ===========================================================================
  function mount() {
    if (host) return;
    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = [
      'all:initial',
      'position:fixed',
      'top:0',
      'right:0',
      'height:100vh',
      'width:' + currentWidth + 'px',
      'z-index:2147483646',
      'pointer-events:none'  // host itself doesn't capture; iframe + handle do
    ].join(';');
    document.documentElement.appendChild(host);

    // Resize handle (vertical bar di edge kiri host)
    resizeHandle = document.createElement('div');
    resizeHandle.setAttribute('data-rf-resize-handle', '');
    resizeHandle.setAttribute('role', 'separator');
    resizeHandle.setAttribute('aria-label', 'Resize sidebar');
    resizeHandle.title = 'Seret untuk ubah lebar';
    resizeHandle.style.cssText = [
      'all:initial',
      'position:absolute',
      'top:0',
      'left:0',
      'width:6px',
      'height:100%',
      'cursor:ew-resize',
      'pointer-events:auto',
      'background:transparent',
      'z-index:2',
      'transition:background .15s ease'
    ].join(';');
    host.appendChild(resizeHandle);

    // Iframe — load sidebar.html (extension page with full popup.js logic)
    iframe = document.createElement('iframe');
    iframe.setAttribute('data-rf-sidebar-iframe', '');
    iframe.setAttribute('title', 'RecallFox Sidebar');
    iframe.src = browser.runtime.getURL('sidebar/sidebar.html');
    iframe.style.cssText = [
      'all:initial',
      'position:absolute',
      'top:0',
      'left:6px',  // offset for resize handle
      'width:calc(100% - 6px)',
      'height:100%',
      'border:0',
      'background:#ffffff',
      'pointer-events:auto',
      'box-shadow:-8px 0 32px rgba(0,0,0,.12)'
    ].join(';');
    host.appendChild(iframe);

    // Initially hidden (CSS class toggle)
    host.style.display = 'none';

    wireResize();
  }

  // ===========================================================================
  // Floating toggle button (single 🦊 button)
  // ===========================================================================
  function mountFloater() {
    if (floater) return;
    floater = document.createElement('div');
    floater.id = FLOATER_ID;
    floater.setAttribute('data-rf-floater', '');
    floater.setAttribute('role', 'button');
    floater.setAttribute('aria-label', 'Tampilkan sidebar RecallFox');
    floater.setAttribute('tabindex', '0');
    floater.textContent = '🦊';
    floater.title = 'Tampilkan sidebar RecallFox di halaman ini';
    floater.style.cssText = [
      'all:initial',
      'position:fixed',
      'bottom:24px',
      'right:24px',
      'width:52px',
      'height:52px',
      'border-radius:50%',
      'background:linear-gradient(135deg,#f97316,#ea580c)',
      'box-shadow:0 6px 20px rgba(234,88,12,.4), 0 2px 6px rgba(0,0,0,.15)',
      'cursor:pointer',
      'z-index:2147483645',
      'display:grid',
      'place-items:center',
      'font-size:24px',
      'line-height:1',
      'pointer-events:auto',
      'transition:transform .15s ease, box-shadow .15s ease',
      'user-select:none',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif'
    ].join(';');
    floater.addEventListener('mouseenter', () => {
      floater.style.transform = 'scale(1.08)';
      floater.style.boxShadow = '0 8px 24px rgba(234,88,12,.5), 0 3px 8px rgba(0,0,0,.18)';
    });
    floater.addEventListener('mouseleave', () => {
      floater.style.transform = 'scale(1)';
      floater.style.boxShadow = '0 6px 20px rgba(234,88,12,.4), 0 2px 6px rgba(0,0,0,.15)';
    });
    floater.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      show();
    });
    floater.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        show();
      }
    });
    document.documentElement.appendChild(floater);
  }
  function unmountFloater() {
    if (floater) { floater.remove(); floater = null; }
  }

  // ===========================================================================
  // Show / Hide / Toggle
  // ===========================================================================
  function show() {
    mount();
    host.style.width = currentWidth + 'px';
    host.style.display = 'block';
    isVisible = true;
    unmountFloater();
    saveState({ visible: true, width: currentWidth });
  }
  function hide() {
    if (!host) return;
    host.style.display = 'none';
    isVisible = false;
    mountFloater();
    saveState({ visible: false, width: currentWidth });
  }
  function toggle() {
    if (isVisible) hide();
    else show();
  }

  // ===========================================================================
  // Resize handle (drag dari edge kiri)
  // ===========================================================================
  function wireResize() {
    let dragging = false;
    let startX = 0;
    let startWidth = 0;

    resizeHandle.addEventListener('mousedown', (e) => {
      dragging = true;
      startX = e.clientX;
      startWidth = host.offsetWidth;
      resizeHandle.style.background = 'rgba(79,70,229,.3)';
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      // Drag left = wider; drag right = narrower (because handle is on left edge)
      const delta = startX - e.clientX;
      const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + delta));
      currentWidth = newWidth;
      host.style.width = newWidth + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (dragging) {
        dragging = false;
        resizeHandle.style.background = 'transparent';
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        saveState({ visible: isVisible, width: currentWidth });
      }
    });

    // Hover effect
    resizeHandle.addEventListener('mouseenter', () => {
      if (!dragging) resizeHandle.style.background = 'rgba(79,70,229,.2)';
    });
    resizeHandle.addEventListener('mouseleave', () => {
      if (!dragging) resizeHandle.style.background = 'transparent';
    });
  }

  // ===========================================================================
  // Listen for messages from background (toggle from popup/context menu)
  // ===========================================================================
  browser.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'OPEN_SIDEBAR_IN_PAGE') show();
    else if (msg.type === 'CLOSE_SIDEBAR_IN_PAGE') hide();
    else if (msg.type === 'TOGGLE_SIDEBAR_IN_PAGE') toggle();
  });

  // ===========================================================================
  // Init
  // ===========================================================================
  (async function init() {
    // Skip on browser-internal pages
    if (!/^https?:/i.test(location.protocol) && !/^file:/i.test(location.protocol)) return;

    // Wait for DOM ready
    if (document.readyState === 'loading') {
      await new Promise(r => document.addEventListener('DOMContentLoaded', r, { once: true }));
    }

    // Restore state (per-tab — but state persists in storage so it survives reload)
    const state = await loadState();
    currentWidth = state.width;
    if (state.visible) {
      // Auto-show after small delay (let page settle)
      setTimeout(() => show(), 500);
    } else {
      mountFloater();
    }
  })();

  // ===========================================================================
  // Agent API (parent window)
  // ===========================================================================
  if (!window.__recallfox) {
    window.__recallfox = {
      toggle, show, hide,
      get visible() { return isVisible; },
      get iframe() { return iframe; },
      get width() { return currentWidth; },
      setWidth(w) {
        currentWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, w));
        if (host) host.style.width = currentWidth + 'px';
        saveState({ visible: isVisible, width: currentWidth });
      },
      version: '3.20.4-iframe-experimental'
    };
  }
})();
