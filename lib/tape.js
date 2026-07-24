// lib/tape.js — RecallTape: keyboard-first tape calculator parser & evaluator
// Pure module (zero dependencies) — safe to import from content scripts, popup, sidebar, background.
//
// Input format (one line per entry):
//   250000 Gaji Utama              → implicit add 250000, note "Gaji Utama"
//   + 50k Bonus projek             → add 50000
//   - 20rb Makan siang             → subtract 20000
//   * 2 Pajak 2x                   → multiply running total by 2
//   / 4 Bagi 4 orang               → divide running total by 4
//   = Subtotal                     → print running total as subtotal row
//   2,5jt Honorarium               → 2500000
//   2.5jt Honorarium               → 2500000 (also accepted — dot as decimal)
//   1.250.000 Gaji                 → 1250000 (thousand separators stripped)
//   1,250,000 Salary               → 1250000 (thousand separators stripped)
//
// Output of evaluate(): { entries: [...], grandTotal: number, error: string|null }

// ============================================================================
// Number parsing — Indonesian + English friendly
// ============================================================================

/**
 * Parse a number token like "50k", "100rb", "2,5jt", "2.5jt", "1.250.000", "1,250,000".
 * Returns null if the token is not a valid number.
 *
 * Strategy:
 *   1. Detect & strip suffix (k, rb, jt, juta, m, b, bn).
 *   2. Detect decimal separator (Indonesian uses comma, English uses dot).
 *      Heuristic: the LAST separator in the string is the decimal separator
 *      IF it appears exactly once AND there is at most one other separator
 *      AND its group is 1-2 digits.
 *   3. Strip all remaining separators (thousand separators).
 *   4. Apply suffix multiplier.
 */
export function parseAmount(token) {
  if (token == null) return null;
  let s = String(token).trim().toLowerCase();
  if (!s) return null;

  // Strip currency symbols / words that may sneak in
  s = s.replace(/^(rp|idr|usd|\$|eur|€|£)\s*/i, '');
  s = s.replace(/\s+/g, '');

  if (!s) return null;

  // Detect & strip suffix (longest first to avoid prefix collisions)
  // "juta" before "jt"; "rb" before "r" (we don't have r suffix anyway)
  const suffixMap = [
    { re: /^([\d.,]+)juta$/i, mult: 1_000_000 },
    { re: /^([\d.,]+)jt$/i,    mult: 1_000_000 },
    { re: /^([\d.,]+)rb$/i,    mult: 1_000 },
    { re: /^([\d.,]+)ribu$/i,  mult: 1_000 },
    { re: /^([\d.,]+)k$/i,     mult: 1_000 },
    { re: /^([\d.,]+)m$/i,     mult: 1_000_000 },       // English million
    { re: /^([\d.,]+)juta$/i,  mult: 1_000_000 },
    { re: /^([\d.,]+)b$/i,     mult: 1_000_000_000 },   // billion
    { re: /^([\d.,]+)bn$/i,    mult: 1_000_000_000 }
  ];

  let mult = 1;
  let digits = s;
  for (const sf of suffixMap) {
    const m = s.match(sf.re);
    if (m) {
      digits = m[1];
      mult = sf.mult;
      break;
    }
  }

  // digits now is the numeric core, e.g. "1.250.000", "2,5", "250000", "1,250,000.50"
  if (!/^[\d.,]+$/.test(digits)) return null;
  if (digits === '.' || digits === ',') return null;

  // Determine which separator is the decimal separator.
  // Count occurrences
  const dots = (digits.match(/\./g) || []).length;
  const commas = (digits.match(/,/g) || []).length;

  let normalized;
  if (dots === 0 && commas === 0) {
    // Pure integer
    normalized = digits;
  } else if (dots > 0 && commas === 0) {
    // Only dots.
    //  - "1.250.000" → thousand sep (Indonesian/English) → strip all
    //  - "2.5"        → decimal (English) → keep as decimal
    //  Heuristic: all middle groups must be exactly 3 digits.
    //  First group may be 1-3 digits. Last group:
    //    - 3 digits → thousand sep (no decimal)
    //    - 1-2 digits → decimal part
    const groups = digits.split('.');
    if (groups.length === 1) {
      normalized = groups[0];
    } else {
      const middleOk = groups.slice(1, -1).every(g => g.length === 3);
      const lastLen = groups[groups.length - 1].length;
      if (middleOk && lastLen === 3) {
        normalized = groups.join('');
      } else if (middleOk && (lastLen === 1 || lastLen === 2)) {
        const intPart = groups.slice(0, -1).join('');
        const decPart = groups[groups.length - 1];
        normalized = intPart + '.' + decPart;
      } else {
        // Mixed/weird — treat last as decimal anyway
        const intPart = groups.slice(0, -1).join('');
        const decPart = groups[groups.length - 1];
        normalized = intPart + '.' + decPart;
      }
    }
  } else if (dots === 0 && commas > 0) {
    // Only commas — same heuristic as dots-only.
    const groups = digits.split(',');
    if (groups.length === 1) {
      normalized = groups[0];
    } else {
      const middleOk = groups.slice(1, -1).every(g => g.length === 3);
      const lastLen = groups[groups.length - 1].length;
      if (middleOk && lastLen === 3) {
        normalized = groups.join('');
      } else if (middleOk && (lastLen === 1 || lastLen === 2)) {
        const intPart = groups.slice(0, -1).join('');
        const decPart = groups[groups.length - 1];
        normalized = intPart + '.' + decPart;
      } else {
        const intPart = groups.slice(0, -1).join('');
        const decPart = groups[groups.length - 1];
        normalized = intPart + '.' + decPart;
      }
    }
  } else {
    // Both dots and commas present — one is decimal, the other is thousand.
    // Whichever appears LAST in the string is the decimal separator.
    const lastDot = digits.lastIndexOf('.');
    const lastComma = digits.lastIndexOf(',');
    if (lastDot > lastComma) {
      // Dot is decimal, commas are thousand separators
      const intPart = digits.slice(0, lastDot).replace(/,/g, '');
      const decPart = digits.slice(lastDot + 1);
      normalized = intPart + '.' + decPart;
    } else {
      // Comma is decimal, dots are thousand separators
      const intPart = digits.slice(0, lastComma).replace(/\./g, '');
      const decPart = digits.slice(lastComma + 1);
      normalized = intPart + '.' + decPart;
    }
  }

  // Now `normalized` is a clean number string using dot as decimal
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const value = parseFloat(normalized);
  if (!isFinite(value)) return null;

  return value * mult;
}

// ============================================================================
// Line parsing — split into { op, amount, note, raw }
// ============================================================================

const OPS = new Set(['+', '-', '*', '/', '=', '×', '÷']);

/**
 * Parse a single line into a structured entry.
 * Returns null for blank/comment lines.
 *
 * Examples:
 *   parseLine('250000 Gaji Utama')     → { op:'+', amount:250000, note:'Gaji Utama', raw:'...' }
 *   parseLine('+ 50k Bonus')           → { op:'+', amount:50000,  note:'Bonus',      raw:'...' }
 *   parseLine('= Subtotal')            → { op:'=', amount:null,    note:'Subtotal',   raw:'...' }
 *   parseLine('')                      → null
 */
export function parseLine(rawLine) {
  const raw = rawLine;
  const line = rawLine.replace(/\r/, '').trim();
  if (!line) return null;
  // Skip pure comment lines (starting with # or //)
  if (/^(#|\/\/)/.test(line)) return { op: 'comment', amount: null, note: line, raw };

  // Detect leading operator (single char, possibly with whitespace)
  let op = '+';
  let rest = line;
  const firstChar = line[0];
  if (OPS.has(firstChar)) {
    // Normalize × → *, ÷ → /
    if (firstChar === '×') op = '*';
    else if (firstChar === '÷') op = '/';
    else op = firstChar;
    rest = line.slice(1).trim();
  }

  // For '=' op: usually there's no amount, just a note label
  if (op === '=') {
    // Try to detect "= 50k Foo" form too (rare but valid)
    const m = rest.match(/^([\d.,]+(?:\s*(?:juta|jt|ribu|rb|bn|k|m|b))?\b)(?:\s+|$)(.*)$/i);
    if (m) {
      const amtStr = m[1].trim();
      const amt = parseAmount(amtStr);
      if (amt != null) {
        return { op, amount: amt, note: (m[2] || '').trim(), raw };
      }
    }
    return { op: '=', amount: null, note: rest, raw };
  }

  // For +,-,*,/ ops: parse amount from the start of `rest`
  // Match: <amount token (with optional suffix)> <whitespace or end> <note>
  // The amount token can contain digits, dots, commas, and known suffixes.
  // Suffixes are ordered longest-first (bn before b, juta before jt) so the
  // regex engine picks the most specific match. The \b after the suffix group
  // prevents 'b' from matching the 'B' in 'Bagi' (since 'Ba' is word-word, no
  // boundary), and the (?:\s+|$) requires whitespace or end after the amount.
  // This stops false matches like '4 Bagi' → amtStr='4b', note='agi'.
  const m = rest.match(/^([\d.,]+(?:\s*(?:juta|jt|ribu|rb|bn|k|m|b))?\b)(?:\s+|$)(.*)$/i);
  if (!m) {
    // No leading number — treat as note-only row.
    return { op: 'note', amount: null, note: rest, raw };
  }
  const amtStr = m[1].trim();
  const note = (m[2] || '').trim();
  const amt = parseAmount(amtStr);
  if (amt == null) {
    return { op: 'note', amount: null, note: rest, raw };
  }
  return { op, amount: amt, note, raw };
}

// ============================================================================
// Evaluator — turn array of lines into structured tape with running total
// ============================================================================

/**
 * Evaluate an array of raw lines (or a single multiline string).
 *
 * Returns:
 *   {
 *     entries: [
 *       { op, amount, note, raw, running: number, display: number, kind: 'op'|'subtotal'|'note'|'comment' }
 *     ],
 *     grandTotal: number,
 *     error: string | null
 *   }
 *
 * Semantics:
 *   - '+' (default): running += amount
 *   - '-':            running -= amount
 *   - '*':            running *= amount
 *   - '/':            running /= amount (guard divide-by-zero → error)
 *   - '=':            emit subtotal row with display=running (no change to running)
 *   - 'note' / 'comment': emit as informational row, no change to running
 */
export function evaluate(input) {
  const lines = Array.isArray(input)
    ? input
    : String(input).split('\n');

  let running = 0;
  let error = null;
  const entries = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const parsed = parseLine(line);
    if (!parsed) continue; // blank line

    if (parsed.op === 'comment' || parsed.op === 'note') {
      entries.push({
        op: parsed.op,
        amount: null,
        note: parsed.note,
        raw: parsed.raw,
        running,
        display: null,
        kind: parsed.op
      });
      continue;
    }

    if (parsed.op === '=') {
      entries.push({
        op: '=',
        amount: parsed.amount,
        note: parsed.note,
        raw: parsed.raw,
        running,
        display: running,
        kind: 'subtotal'
      });
      continue;
    }

    const amt = parsed.amount || 0;
    let next;
    switch (parsed.op) {
      case '+': next = running + amt; break;
      case '-': next = running - amt; break;
      case '*': next = running * amt; break;
      case '/':
        if (amt === 0) {
          error = `Baris ${i + 1}: pembagian nol`;
          next = running;
        } else {
          next = running / amt;
        }
        break;
      default:
        next = running + amt;
    }
    running = next;
    entries.push({
      op: parsed.op,
      amount: amt,
      note: parsed.note,
      raw: parsed.raw,
      running,
      display: running,
      kind: 'op'
    });
  }

  return { entries, grandTotal: running, error };
}

// ============================================================================
// Formatting
// ============================================================================

const OP_SYMBOL = { '+': '+', '-': '−', '*': '×', '/': '÷', '=': '=' };

/**
 * Format a number with Indonesian thousand separators (dot).
 * 1234567.89 → "1.234.567,89"
 * Negative numbers: "-1.234.567,89"
 */
export function formatNumber(n) {
  if (n == null || !isFinite(n)) return '0';
  const neg = n < 0;
  const abs = Math.abs(n);
  // Round to 2 decimal places to avoid float drift
  const rounded = Math.round(abs * 100) / 100;
  const [intPart, decPart] = String(rounded).split('.');
  const intWithSep = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const out = decPart ? `${intWithSep},${decPart}` : intWithSep;
  return neg ? `-${out}` : out;
}

/**
 * Format as Indonesian Rupiah currency.
 * 250000 → "Rp 250.000"
 */
export function formatCurrency(n) {
  if (n == null || !isFinite(n)) return 'Rp 0';
  return 'Rp ' + formatNumber(n);
}

/**
 * Convert evaluated tape to plain text for clipboard (WhatsApp/Email friendly).
 * Indentation: operator+amount column right-aligned to a fixed width.
 */
export function toPlainText(tape, opts = {}) {
  const { entries, grandTotal } = tape;
  const lines = [];
  // Compute column widths
  const amountCol = 14;
  for (const e of entries) {
    if (e.kind === 'comment') {
      lines.push(`# ${e.note}`);
      continue;
    }
    if (e.kind === 'note') {
      lines.push(`  ${e.note}`);
      continue;
    }
    if (e.kind === 'subtotal') {
      lines.push('  ' + '─'.repeat(amountCol + 4));
      const label = (e.note || 'Subtotal').slice(0, 20);
      const amt = formatNumber(e.display);
      lines.push(`  ${label.padEnd(20)} ${amt.padStart(amountCol)}`);
      continue;
    }
    // op row
    const sym = OP_SYMBOL[e.op] || '+';
    const amt = formatNumber(e.amount);
    const note = e.note || '';
    lines.push(`${sym} ${amt.padStart(amountCol)}  ${note}`.trimEnd());
  }
  lines.push('  ' + '═'.repeat(amountCol + 4));
  const totalStr = formatNumber(grandTotal);
  lines.push(`  ${'GRAND TOTAL'.padEnd(20)} ${totalStr.padStart(amountCol)}`);
  return lines.join('\n');
}

/**
 * Convert evaluated tape to Markdown for vault storage / docs.
 */
export function toMarkdown(tape, opts = {}) {
  const { entries, grandTotal } = tape;
  const lines = [];
  if (opts.title) lines.push(`# ${opts.title}`, '');
  lines.push('| Operator | Amount | Note | Running |');
  lines.push('| --- | ---: | --- | ---: |');
  for (const e of entries) {
    if (e.kind === 'comment') { lines.push(`_# ${e.note}_`); continue; }
    if (e.kind === 'note')    { lines.push(`&nbsp; |  | ${e.note} |  |`); continue; }
    if (e.kind === 'subtotal') {
      lines.push(`**=** | **${formatNumber(e.display)}** | **${e.note || 'Subtotal'}** | **${formatNumber(e.running)}** |`);
      continue;
    }
    lines.push(`\`${OP_SYMBOL[e.op] || '+'}\` | ${formatNumber(e.amount)} | ${e.note || ''} | ${formatNumber(e.running)} |`);
  }
  lines.push('');
  lines.push(`> **Grand Total:** \`Rp ${formatNumber(grandTotal)}\``);
  return lines.join('\n');
}

// ============================================================================
// Session helpers (used by content script & popup)
// ============================================================================

const SESSION_KEY = 'tapeSession';
const PIN_KEY = 'tapePin';

export async function loadSession() {
  try {
    const r = await browser.storage.local.get([SESSION_KEY, PIN_KEY]);
    return {
      text: r[SESSION_KEY] || '',
      pinned: !!r[PIN_KEY]
    };
  } catch (e) {
    return { text: '', pinned: false };
  }
}

export async function saveSession(text) {
  try {
    await browser.storage.local.set({ [SESSION_KEY]: text });
  } catch (e) {}
}

export async function savePinState(pinned) {
  try {
    await browser.storage.local.set({ [PIN_KEY]: !!pinned });
  } catch (e) {}
}

// ============================================================================
// Self-test (smoke) — invoke via background console if needed
// ============================================================================
export function selfTest() {
  const cases = [
    ['50k', 50000],
    ['100rb', 100000],
    ['2,5jt', 2500000],
    ['2.5jt', 2500000],
    ['1.250.000', 1250000],
    ['1,250,000', 1250000],
    ['250000', 250000],
    ['2,500,000.50', 2500000.50],
    ['1.234.567,89', 1234567.89],
    ['rp 50k', 50000],
    ['Rp 1.250.000', 1250000],
    ['0', 0],
    ['1.000.000', 1000000],
    ['1,000,000', 1000000],
    ['3,5juta', 3500000],
    ['1.5', 1.5],
    ['1,5', 1.5],
    ['12.345', 12345],          // Indonesian: 12.345 = twelve thousand three hundred forty-five
    ['5bn', 5_000_000_000]
  ];
  const results = cases.map(([input, expected]) => {
    const got = parseAmount(input);
    const ok = got === expected || (typeof expected === 'number' && Math.abs((got || 0) - expected) < 0.001);
    return { input, expected, got, ok };
  });
  const allOk = results.every(r => r.ok);
  return { allOk, results };
}
