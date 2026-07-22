// lib/copy-format.js — Shared clipboard format builder for screenshot copy
// RecallFox v3.11.34
//
// User feedback (Sesi 1, 18 Jul 2026):
//   "format paste ketika saya memencet tombol kopi gambar + keterangan di preview
//    modal sangat sangat sangat bagus. tapi kalau pakai sidebar itu jelek jelek
//    jelek banget. banyak yang ga muncul. standarkan dong, disamakan format kopi
//    paste nya yang sidebar ke menjadi selengkap tekan tombol gambar + keterangan
//    di preview modal. berlaku juga untuk batch harus sama formatnya."
//
// Modul ini berisi SATU fungsi `buildScreenshotCaption(item, dataUrl)` yang
// dipakai oleh:
//   - content/overlay.js (preview modal copy)
//   - popup/popup.js (single item + batch copy via direct clipboard.write)
//   - background.js (COPY_SCREENSHOT_TO_CLIPBOARD + COPY_SCREENSHOTS_BATCH handlers)
//
// Format output (text/plain):
//   📸 Screenshot — {pageTitle}
//   Sumber: {pageUrl}
//   Waktu: {capturedDateStr}
//   Mode: {modeLabel} · {dims}
//   📝 Catatan: {annotationNote}      (kalau ada)
//   Ditangkap oleh RecallFox
//
// Format output (text/html):
//   <div style="font-family:-apple-system,system-ui,sans-serif;font-size:13px;color:#1c1917">
//     <p style="margin:0 0 6px"><img src="{dataUrl}" alt="screenshot" style="max-width:100%;border-radius:8px;border:1px solid #e7e5e4"/></p>
//     <p style="margin:8px 0 2px"><strong>📸 {pageTitle}</strong></p>
//     <p style="margin:0 0 2px;color:#57534e">🔗 <a href="{pageUrl}">{pageUrl}</a></p>
//     <p style="margin:0 0 2px;color:#57534e">🕒 {capturedDateStr}</p>
//     <p style="margin:0 0 2px;color:#92400e;background:#fef3c7;padding:4px 8px;border-radius:4px">📝 {annotationNote}</p>   (kalau ada)
//     <p style="margin:0;color:#78716c">🔧 {modeLabel} · {dims} · RecallFox</p>
//   </div>
//
// Untuk batch (multiple screenshots), format dibungkus dalam heading bundle.

/**
 * Escape HTML special characters untuk mencegah XSS / broken HTML di clipboard.
 * @param {string} s
 * @returns {string}
 */
export function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Build caption (text/plain + text/html) untuk satu screenshot.
 *
 * @param {Object} item - vault item dengan type='screenshot'
 * @param {string} [dataUrl] - data URL gambar (untuk embed di HTML). Kalau tidak
 *                             ada, HTML tidak akan menyertakan <img>.
 * @param {number} [index] - nomor urut (untuk batch). Default: tidak ada nomor.
 * @returns {{textPlain: string, textHtml: string, pageTitle: string, pageUrl: string,
 *           capturedDate: string, modeLabel: string, dims: string, annotationNote: string}}
 */
export function buildScreenshotCaption(item, dataUrl, opts = {}) {
  if (!item) return { textPlain: '', textHtml: '' };

  const pageTitle = item.source?.title || item.title || 'screenshot';
  const pageUrl = item.source?.url || '';
  const capturedAt = item.source?.capturedAt || item.createdAt || new Date().toISOString();
  const modeRaw = item.screenshotMode || 'visible';
  const modeLabel = modeRaw === 'visible' ? 'Viewport'
    : modeRaw === 'selection' ? 'Area'
    : modeRaw === 'entire' ? 'Seluruh halaman'
    : modeRaw;
  const dims = (item.screenshotWidth || 0) + '×' + (item.screenshotHeight || 0) + ' px';
  const annotationNote = item.annotationNote || item.source?.annotationNote || '';
  const capturedDateStr = new Date(capturedAt).toLocaleString('id-ID', {
    dateStyle: 'full',
    timeStyle: 'short'
  });

  const index = opts.index; // 1-based index for batch (optional)
  // Single item: "📸 Screenshot — {pageTitle}"  (match preview modal / overlay.js)
  // Batch item:  "📸 N. {pageTitle}"            (match user doc request: "📸 1 Title")
  const titlePrefixPlain = (typeof index === 'number' && index > 0)
    ? '📸 ' + index + '. '
    : '📸 Screenshot — ';
  const titlePrefixHtml = (typeof index === 'number' && index > 0)
    ? '📸 ' + index + '. '
    : '📸 Screenshot — ';

  // === text/plain ===
  let textPlain = titlePrefixPlain + pageTitle + '\n'
    + (pageUrl ? 'Sumber: ' + pageUrl + '\n' : '')
    + 'Waktu: ' + capturedDateStr + '\n'
    + 'Mode: ' + modeLabel + ' · ' + dims + '\n'
    + (annotationNote ? '📝 Catatan: ' + annotationNote + '\n' : '')
    + 'Ditangkap oleh RecallFox';

  // === text/html ===
  let html = '<div style="font-family:-apple-system,system-ui,sans-serif;font-size:13px;color:#1c1917">';
  if (dataUrl) {
    html += '<p style="margin:0 0 6px"><img src="' + dataUrl + '" alt="screenshot" style="max-width:100%;border-radius:8px;border:1px solid #e7e5e4"/></p>';
  }
  html += '<p style="margin:8px 0 2px"><strong>' + titlePrefixHtml + escapeHtml(pageTitle) + '</strong></p>';
  if (pageUrl) {
    html += '<p style="margin:0 0 2px;color:#57534e">🔗 <a href="' + escapeHtml(pageUrl) + '">' + escapeHtml(pageUrl) + '</a></p>';
  }
  html += '<p style="margin:0 0 2px;color:#57534e">🕒 ' + escapeHtml(capturedDateStr) + '</p>';
  if (annotationNote) {
    html += '<p style="margin:0 0 2px;color:#92400e;background:#fef3c7;padding:4px 8px;border-radius:4px">📝 ' + escapeHtml(annotationNote) + '</p>';
  }
  html += '<p style="margin:0;color:#78716c">🔧 ' + escapeHtml(modeLabel) + ' · ' + escapeHtml(dims) + ' · RecallFox</p>';
  html += '</div>';

  return {
    textPlain,
    textHtml: html,
    pageTitle,
    pageUrl,
    capturedDate: capturedDateStr,
    modeLabel,
    dims,
    annotationNote
  };
}

/**
 * Build caption untuk multiple screenshots (batch copy).
 *
 * @param {Array<{item: Object, dataUrl: string}>} screenshots
 * @returns {{textPlain: string, textHtml: string, count: number}}
 */
export function buildBatchCaption(screenshots) {
  if (!Array.isArray(screenshots) || screenshots.length === 0) {
    return { textPlain: '', textHtml: '', count: 0 };
  }

  const now = new Date();
  const dateStr = now.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
  const count = screenshots.length;

  // === text/plain (markdown-ish) ===
  let textPlain = '# 📷 Screenshot Bundle — RecallFox\n'
    + 'Tanggal: ' + dateStr + ' · Total: ' + count + ' screenshot\n\n';

  // === text/html ===
  let textHtml = '<div style="font-family:-apple-system,system-ui,sans-serif;font-size:13px;color:#1c1917">'
    + '<h1 style="margin:0 0 6px">📷 Screenshot Bundle — RecallFox</h1>'
    + '<p style="margin:0 0 10px;color:#57534e"><em>Tanggal: ' + escapeHtml(dateStr) + ' · Total: ' + count + ' screenshot</em></p>';

  for (let i = 0; i < screenshots.length; i++) {
    const { item, dataUrl } = screenshots[i];
    const idx = i + 1;
    const cap = buildScreenshotCaption(item, dataUrl, { index: idx });

    if (i > 0) {
      textPlain += '\n---\n\n';
      textHtml += '<hr style="border:none;border-top:1px solid #e7e5e4;margin:16px 0">';
    }

    // text/plain — gunakan caption + placeholder gambar
    textPlain += cap.textPlain + '\n\n';
    textPlain += '[📸 Gambar ' + idx + ' — ' + cap.dims + ']\n';

    // text/html — langsung pakai cap.textHtml (sudah lengkap dengan <img>)
    textHtml += cap.textHtml;
  }

  textPlain += '\n— Ditangkap oleh RecallFox —';
  textHtml += '</div>';

  return { textPlain, textHtml, count };
}

/**
 * v3.11.34: Tulis clipboard langsung dari popup/sidebar context.
 *
 * Keunggulan vs background-inject-into-active-tab:
 *   - Popup punya `clipboardWrite` permission → navigator.clipboard.write jalan
 *   - Gak perlu inject ke active tab (yang bisa gagal kalau tab adalah about:/moz-extension:)
 *   - User gesture dari klik tombol popup langsung tersedia
 *
 * Strategi:
 *   1. Coba navigator.clipboard.write dengan ClipboardItem multi-mime
 *      (image/png + text/html + text/plain) — best case, paste ke mana saja
 *   2. Kalau ClipboardItem undefined atau write throw, fallback ke
 *      navigator.clipboard.writeText(textPlain) — text-only, gambar hilang
 *      tapi metadata lengkap (📸, 🔗, 🕒, 📝, 🔧)
 *   3. Kalau writeText juga gagal, return error (biar caller decide fallback)
 *
 * @param {string} dataUrl - data URL gambar (e.g. 'data:image/png;base64,...')
 * @param {string} textPlain
 * @param {string} textHtml
 * @returns {Promise<{ok: boolean, message?: string, error?: string, fallback?: string}>}
 */
export async function writeScreenshotToClipboard(dataUrl, textPlain, textHtml) {
  // Strategy 1: ClipboardItem multi-mime
  if (typeof ClipboardItem !== 'undefined' && dataUrl) {
    try {
      const resp = await fetch(dataUrl);
      const blob = await resp.blob();
      // Convert ke PNG kalau perlu (clipboard API hanya support image/png)
      let pngBlob;
      if (blob.type === 'image/png') {
        pngBlob = blob;
      } else {
        const img = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        canvas.getContext('2d').drawImage(img, 0, 0);
        pngBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      }
      if (!pngBlob) {
        throw new Error('blob_conversion_failed');
      }

      const clipboardData = {
        'image/png': pngBlob,
        'text/html': new Blob([textHtml], { type: 'text/html' }),
        'text/plain': new Blob([textPlain], { type: 'text/plain' })
      };
      const item = new ClipboardItem(clipboardData);
      await navigator.clipboard.write([item]);
      return { ok: true, message: '✓ Gambar + keterangan tersalin ke clipboard' };
    } catch (e) {
      console.warn('[RecallFox] clipboard.write ClipboardItem failed:', e.message);
      // fall through to strategy 2
    }
  }

  // Strategy 2: text/html + text/plain (tanpa image/png blob)
  // — text/html tetap berisi <img src="dataUrl"> jadi paste ke Google Docs /
  //   rich text editor masih menampilkan gambar.
  if (typeof ClipboardItem !== 'undefined' && textHtml) {
    try {
      const item = new ClipboardItem({
        'text/html': new Blob([textHtml], { type: 'text/html' }),
        'text/plain': new Blob([textPlain], { type: 'text/plain' })
      });
      await navigator.clipboard.write([item]);
      return { ok: true, message: '✓ Keterangan + gambar (embedded) tersalin ke clipboard' };
    } catch (e) {
      console.warn('[RecallFox] clipboard.write text/html+plain failed:', e.message);
      // fall through to strategy 3
    }
  }

  // Strategy 3: text-only fallback (writeText)
  if (textPlain && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(textPlain);
      return {
        ok: true,
        message: '✓ Keterangan tersalin (text-only — gambar tidak ikut karena browser tidak support clipboard image)',
        fallback: 'text_only'
      };
    } catch (e) {
      console.warn('[RecallFox] clipboard.writeText failed:', e.message);
    }
  }

  return { ok: false, error: 'clipboard_write_failed' };
}
