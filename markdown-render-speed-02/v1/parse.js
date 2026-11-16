// Fast CommonMark 0.31.2 + GFM 0.29 renderer, matching marked 18.1.3 output.
// Single-pass, allocation-light: line-based block parsing, delimiter-stack
// inline parsing, direct HTML emission into a piece array (no token tree).
// No regex in hot paths; charCodeAt / indexOf / manual loops only.

export function parse(src) {
  // CRLF normalisation is the identity when no CR is present; skip the
  // regex scan + full-string copy for the overwhelmingly common case.
  if (src.indexOf('\r') !== -1) src = src.replace(/\r\n?/g, '\n');
  if (src === '') return '';
  docInLink = false;
  const links = new Map();
  const lines = splitLines(src);
  const endsWithNL = src.charCodeAt(src.length - 1) === 10;
  const root = parseBlocks(lines, links, endsWithNL);
  const out = [];
  renderBlocks(root, links, out);
  return out.join('');
}

// ---------------------------------------------------------------------------
// Character helpers
// ---------------------------------------------------------------------------

const PUNCT_RE = /[\p{P}\p{S}]/u;

function isSpaceCode(c) {
  return c === 32 || c === 9 || c === 10 || c === 11 || c === 12 || c === 13;
}

// Document-level inLink flag (marked's Lexer.state.inLink): an inline
// `<a ` opening tag sets it, only an exact `</a>` clears it, and it
// persists across blocks until cleared. While set, bare-URL/email
// autolinks are suppressed (marked's url tokenizer is guarded by
// !inLink); explicit [text](url) links and <...> autolinks still form.
// Reset per parse() call; saved/restored around link-text processing
// (marked's De does the same).
let docInLink = false;

// Backslash escapes apply to ASCII punctuation ONLY (CommonMark 0.31.2:
// a backslash before a non-ASCII punctuation char like « is literal).
function isPunctCode(c) {
  return (c >= 33 && c <= 47) || (c >= 58 && c <= 64) ||
    (c >= 91 && c <= 96) || (c >= 123 && c <= 126);
}

// Unicode whitespace (for emphasis flanking): ASCII space/tab/LF/FF/CR
// plus the Unicode Zs category (NBSP, en/em spaces, ideographic space...).
function isUnicodeSpaceCode(c) {
  return c === 32 || c === 9 || c === 10 || c === 11 || c === 12 || c === 13 ||
    c === 160 || c === 5760 || (c >= 8192 && c <= 8202) || c === 8239 ||
    c === 8287 || c === 12288;
}

function isPunctChar(ch) {
  const c = ch.charCodeAt(0);
  if (c < 128) {
    return (c >= 33 && c <= 47) || (c >= 58 && c <= 64) ||
      (c >= 91 && c <= 96) || (c >= 123 && c <= 126);
  }
  return PUNCT_RE.test(ch);
}

// Bare-email local-part char: [A-Za-z0-9.!#$%&'*+/=?^_`{|}~-] is the
// GFM set, but matchBareEmail's local scan only accepts alnum + . _ + -
// (a char outside that set ends the local part). This is the same set
// matchBareEmail uses for its first-char test.
function isEmailLocalCode(c) {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) ||
    c === 46 || c === 95 || c === 43 || c === 45;
}

// ---------------------------------------------------------------------------
// HTML escaping + numeric character reference decoding.
// Text runs: decode &#...; / &#x...; (0, surrogates, >0x10FFFF -> U+FFFD),
// leave valid named entities (&word;) verbatim, escape bare & and < > " '.
// ---------------------------------------------------------------------------

const ESCAPE_MAP = { 34: '&quot;', 38: '&amp;', 39: '&#39;', 60: '&lt;', 62: '&gt;' };

// Jump to the next escapable char with a C++ regex scan instead of a
// per-char JS loop. The regexes are module-level and only ever used
// inside these two leaf functions (they call nothing that touches them),
// and lastIndex is set explicitly before every exec, so no state leaks
// between calls.
const ESCAPE_RE = /[&<>"']/g;
const ESCAPE_FULL_RE = /[&<>"']/g;

function appendEscapedText(s, out) {
  const n = s.length;
  let start = 0;
  ESCAPE_RE.lastIndex = 0;
  let m;
  while ((m = ESCAPE_RE.exec(s)) !== null) {
    const i = m.index;
    const c = s.charCodeAt(i);
    if (c === 38) { // &
      const r = tryEntity(s, i, n);
      if (r < 0) {
        // bare & (or invalid numeric ref): escape it
        if (start < i) out.push(s.slice(start, i));
        out.push('&amp;');
        start = i + 1;
        ESCAPE_RE.lastIndex = start;
      } else if (r === 0) {
        // valid named entity: leave verbatim, keep scanning
        ESCAPE_RE.lastIndex = entityEnd(s, i, n);
      } else {
        // numeric ref decoded to code point r
        if (start < i) out.push(s.slice(start, i));
        const esc = ESCAPE_MAP[r];
        if (esc !== undefined) out.push(esc);
        else out.push(String.fromCodePoint(r));
        start = entityEnd(s, i, n);
        ESCAPE_RE.lastIndex = start;
      }
    } else {
      if (start < i) out.push(s.slice(start, i));
      out.push(ESCAPE_MAP[c]);
      start = i + 1;
      ESCAPE_RE.lastIndex = start;
    }
  }
  if (start < n) out.push(s.slice(start));
}

// Returns: -1 bare/invalid, 0 valid named entity, >0 decoded code point.
// Assumes s[i] === '&'.
function tryEntity(s, i, n) {
  let j = i + 1;
  if (j >= n) return -1;
  if (s.charCodeAt(j) === 35) { // #
    j++;
    if (j >= n) return -1;
    let hex = false;
    if (s.charCodeAt(j) === 120 || s.charCodeAt(j) === 88) { hex = true; j++; }
    const d0 = j;
    let v = 0;
    let digits = 0;
    while (j < n) {
      const c = s.charCodeAt(j);
      let d = -1;
      if (c >= 48 && c <= 57) d = c - 48;
      else if (hex && c >= 97 && c <= 102) d = c - 87;
      else if (hex && c >= 65 && c <= 70) d = c - 55;
      if (d < 0) break;
      v = v * (hex ? 16 : 10) + d;
      digits++;
      j++;
      if (digits > (hex ? 6 : 7)) return -1;
    }
    if (digits === 0 || j >= n || s.charCodeAt(j) !== 59) return -1; // need ;
    if (v === 0 || v > 0x10FFFF || (v >= 0xD800 && v <= 0xDFFF)) return 0xFFFD;
    return v;
  }
  // named entity: &\w+;
  let k = j;
  while (k < n) {
    const c = s.charCodeAt(k);
    if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95) k++;
    else break;
  }
  if (k > j && k < n && s.charCodeAt(k) === 59) return 0;
  return -1;
}

// Index just past the ';' of the entity starting at s[i] ('&').
function entityEnd(s, i, n) {
  let j = i + 1;
  while (j < n && s.charCodeAt(j) !== 59) j++;
  return j < n ? j + 1 : n;
}

// Escape with encode=true semantics (all & < > " ' escaped). Used for
// code spans, hrefs of autolinks, and attribute values built from raw text.
function appendEscapedFull(s, out) {
  const n = s.length;
  let start = 0;
  ESCAPE_FULL_RE.lastIndex = 0;
  let m;
  while ((m = ESCAPE_FULL_RE.exec(s)) !== null) {
    const i = m.index;
    if (start < i) out.push(s.slice(start, i));
    out.push(ESCAPE_MAP[s.charCodeAt(i)]);
    start = i + 1;
    ESCAPE_FULL_RE.lastIndex = start;
  }
  if (start < n) out.push(s.slice(start));
}

function escFull(s) {
  const out = [];
  appendEscapedFull(s, out);
  return out.join('');
}

// ---------------------------------------------------------------------------
// URL cleaning: encodeURI, then restore '%' handling; null on bad URI.
// Mirrors marked's cleanUrl (encodeURI + %25 -> %).
// ---------------------------------------------------------------------------

function cleanUrl(href) {
  // '%25' in the encoded output comes only from a literal '%' in the
  // input; without one, encodeURI's output holds no '%25' to restore.
  try {
    const enc = encodeURI(href);
    return href.indexOf('%') === -1 ? enc : enc.replace(/%25/g, '%');
  } catch (e) {
    return null;
  }
}

// Unescape backslash-punctuation and numeric refs in link dest/title.
// Backslash + ASCII punctuation -> the punctuation; numeric refs decoded.
function unescapeLinkText(s) {
  if (s.indexOf('\\') === -1 && s.indexOf('&') === -1) return s;
  let out = '';
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s.charCodeAt(i);
    if (c === 92 && i + 1 < n && isPunctCode(s.charCodeAt(i + 1))) {
      out += s[i + 1];
      i += 2;
    } else if (c === 38) {
      const r = tryEntity(s, i, n);
      if (r > 0) {
        out += String.fromCodePoint(r);
        i = entityEnd(s, i, n);
      } else if (r === 0) {
        // named entity in a dest/title: kept as-is
        const e = entityEnd(s, i, n);
        out += s.slice(i, e);
        i = e;
      } else {
        out += '&';
        i++;
      }
    } else {
      out += s[i];
      i++;
    }
  }
  return out;
}

// Normalize a link label: trim, collapse whitespace runs to one space,
// lowercase (with the toLowerCase/toUpperCase/toLowerCase fold).
function normLabel(s) {
  // A label key: collapse whitespace and case-fold. Labels match RAW:
  // no unescaping on either side (a def `[foo\!]:` matches a link
  // `[foo\!]` but NOT `[foo!]`, and vice versa — cm-545; a def
  // `[Foo*bar\]]:` matches the shortcut `[Foo*bar\]]` because both
  // sides carry the same raw `\]` — cm-194). parseDefText keeps the
  // label raw so the two sides agree.
  return s.trim().replace(/\s+/g, ' ').toLowerCase().toUpperCase().toLowerCase();
}

function splitLines(src) {
  const lines = src.split('\n');
  if (src.charCodeAt(src.length - 1) === 10) lines.pop();
  return lines;
}

// ---------------------------------------------------------------------------
// Inline parser.
// Scans the text once, emitting pieces to `out` and recording delimiter
// runs. Emphasis (em/strong/del) is resolved after the scan over the
// delimiter list (CommonMark delimiter-stack algorithm). Links and images
// are formed during the scan: their text is parsed recursively, so emphasis
// can never span a link boundary, and a link is atomic outside.
// `plain` mode emits only text content (used for image alt attributes).
// `inLink` disables bare-URL autolinks inside link text.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Emphasis mask (marked emStrongMask / #n).
// Marked builds, for each paragraph, a masked copy of the source in which
// code spans are replaced by '+' (its anyPunctuationOutsideCode regex,
// Ot). The regex pairs backtick runs greedily left-to-right IN THE RAW
// PARAGRAPH TEXT, ignoring token boundaries — so a backtick run inside a
// link label can pair with the opening backtick of a later code span, and
// the whole span between them (link URL, intervening text, emphasis
// delimiters) is masked out of the emphasis matcher's view.
//   doc-09: the label's trailing ` pairs with `deno`'s opening `, and the
//     ` after `deno` pairs with the ` before `a `, so `_issue table_`
//     lies inside a masked region and stays literal.
//   doc-28: the label's trailing ` pairs with `__init__`'s opening `,
//     so `__issues most__` is masked and stays literal.
//   doc-06: the label's trailing ` has NO later backtick to pair with,
//     so nothing is masked and `*promise example and*` etc. form.
// The old post-link suppression heuristic (labelTriggersSuppression) was a
// proxy for this and fired on doc-06's label too (same backtick-run shape
// as doc-09/28), so it is replaced by the positional mask: a `*`/`_`
// delimiter whose offset falls inside a masked region cannot open/close.
// Only code-span matches mask non-backtick text (a bare unmatched run
// covers just its own backticks, and an escaped punct is one char).
// Returns sorted, non-overlapping [start, end) intervals.
// ---------------------------------------------------------------------------
function maskRegions(src) {
  // No backtick anywhere: no regions, and no pair can form. indexOf is a
  // C++ scan; the per-char JS loop below only runs for paragraphs that
  // actually contain backticks.
  if (src.indexOf('`') === -1) return [];
  const regions = [];
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src.charCodeAt(i);
    // An escaped backtick `\`` (or escaped backslash `\\`) is consumed
    // by Ot's third alternative `\\(punct)` — it is NOT a backtick run
    // and cannot pair (doc-30: the `\`` in `Removes  \`change` must not
    // pair with the ` before `max_width`, or the `**is _modern ...**`
    // emphasis between them is wrongly masked).
    if (c === 92 && i + 1 < n && (src.charCodeAt(i + 1) === 96 || src.charCodeAt(i + 1) === 92)) { i += 2; continue; }
    if (c !== 96) { i++; continue; }
    let j = i;
    while (j < n && src.charCodeAt(j) === 96) j++;
    const run = j - i;
    // find the next maximal backtick run of the same length (the closer);
    // runs are maximal, so the char after a closer is never a backtick
    // (the regex's (?!`) is satisfied) and the content between two runs
    // never starts/ends with a backtick.
    let k = j, close = -1;
    while (k < n) {
      if (src.charCodeAt(k) === 96) {
        let m = k;
        while (m < n && src.charCodeAt(m) === 96) m++;
        if (m - k === run) { close = k; break; }
        k = m;
      } else k++;
    }
    if (close >= 0) { regions.push([i, close + run]); i = close + run; }
    else i = j;
  }
  return regions;
}

function inlineParse(src, links, out, plain, inLink) {
  const n = src.length;
  let i = 0;
  let buf = '';
  const delims = [];
  let bracketDepth = 0; // number of unclosed '[' openers on the stack
  // hasAt: a bare email needs '@' in this inline run at all; one C++
  // scan per paragraph beats a failed matchBareEmail at every position.
  const hasAt = src.indexOf('@') !== -1;
  // uscoreOpen: a can-open '_' delimiter was pushed since the current
  // word started (see the autolink gate below).
  let uscoreOpen = false;
  // prevLocal: isEmailLocalCode of the char just before i. Maintained
  // instead of re-reading src[i-1] every iteration: every branch that
  // advances i lands on a char whose local-ness equals that of the
  // branch's trigger char — except the autolink branch, whose target
  // can end on a non-local char (')', '/'), so it recomputes prevLocal
  // explicitly (a wrongly-true prevLocal would skip a real email).
  let prevLocal = false;
  // Masked regions for this paragraph (see maskRegions): emphasis
  // delimiters inside one are literal. Regions are sorted, so a linear
  // scan with early exit is cheap (typically 0-3 regions).
  const mask = maskRegions(src);
  const isMasked = (pos) => {
    for (let r = 0; r < mask.length; r++) {
      if (pos < mask[r][0]) return false;
      if (pos < mask[r][1]) return true;
    }
    return false;
  };

  const flushBuf = () => {
    if (buf !== '') {
      if (plain) appendEscapedText(buf, out);
      else appendEscapedText(buf, out);
      buf = '';
    }
  };

  // Push a literal text piece for a delimiter run and record it.
  const pushDelim = (ch, len, canOpen, canClose) => {
    const text = ch.repeat(len);
    out.push(text);
    // olen is the ORIGINAL length (len is mutated by resolveEmphasis);
    // the narrow "short closer after an inner pair" rule needs it.
    delims.push({ ch, len, canOpen, canClose, outIdx: out.length - 1, active: true, tag: '', olen: len, openerIdx: -1 });
    return delims.length - 1;
  };

  while (i < n) {
    const c = src.charCodeAt(i);
    // A new word starts after any char outside the email local set;
    // that resets the can-open-'_' flag for this word. Capture the
    // word-start flag BEFORE prevLocal is updated to this char.
    const wordStart = !prevLocal;
    if (wordStart) uscoreOpen = false;
    prevLocal = isEmailLocalCode(c);

    // ---- backslash escape / hard break ----
    if (c === 92) { // \
      const nx = i + 1 < n ? src.charCodeAt(i + 1) : -1;
      if (nx === 10) { // backslash + newline = hard break
        if (!plain && !onlyWhitespaceAhead(src, i + 2)) {
          flushBuf();
          out.push('<br>');
          i += 2;
          // a hard break strips the leading spaces/tabs of the next line
          // (cm-637: `foo\\\n     bar` -> `foo<br>bar`); a soft break
          // keeps them (cm-070).
          while (i < n && (src.charCodeAt(i) === 32 || src.charCodeAt(i) === 9)) i++;
        } else if (plain) {
          // hard break contributes nothing in plain mode
          i += 2;
        } else {
          buf += '\\';
          i += 2;
        }
        continue;
      }
      if (nx >= 0 && isPunctCode(nx)) {
        // Escaped punctuation is a literal char: emit it HTML-escaped
        // directly, never re-scanned as an entity start (so \&ouml; gives
        // &amp;ouml;, not the &ouml; entity).
        flushBuf();
        const ch = src[i + 1];
        if (ch === '&') out.push('&amp;');
        else if (ch === '<') out.push('&lt;');
        else if (ch === '>') out.push('&gt;');
        else if (ch === '"') out.push('&quot;');
        else if (ch === "'") out.push('&#39;');
        else out.push(ch);
        i += 2;
        continue;
      }
      buf += '\\';
      i++;
      continue;
    }

    // ---- code span ----
    if (c === 96) { // `
      let j = i;
      while (j < n && src.charCodeAt(j) === 96) j++;
      const run = j - i;
      const close = findCodeClose(src, j, run, delims);
      if (close < 0) {
        buf += src.slice(i, j);
        i = j;
        continue;
      }
      let content = src.slice(j, close);
      content = content.replace(/\n/g, ' ');
      if (content.length > 0 && /\S/.test(content) && content.charCodeAt(0) === 32 && content.charCodeAt(content.length - 1) === 32) {
        content = content.slice(1, -1);
      }
      flushBuf();
      if (plain) appendEscapedText(content, out);
      else {
        out.push('<code>');
        appendEscapedFull(content, out);
        out.push('</code>');
      }
      i = close + run;
      continue;
    }

    // ---- emphasis / strikethrough delimiter runs ----
    if (c === 42 || c === 95) { // * _
      const ch = src[i];
      let j = i;
      while (j < n && src.charCodeAt(j) === c) j++;
      const run = j - i;
      const fl = flanking(src, i, j);
      let canOpen, canClose;
      if (ch === '*') {
        canOpen = fl.left; canClose = fl.right;
      } else {
        canOpen = fl.left && (!fl.right || fl.beforeSpace || fl.beforePunct);
        canClose = fl.right && (!fl.left || fl.afterSpace || fl.afterPunct);
      }
      flushBuf();
      // A delimiter inside a masked region (see maskRegions) cannot open
      // or close — marked's emphasis matcher never sees it, so it stays
      // literal (doc-09 `_issue table_`, doc-28 `__issues most__`).
      if (isMasked(i)) { canOpen = false; canClose = false; }
      pushDelim(ch, run, canOpen, canClose);
      // A can-open '_' pushed inside a word changes matchBareEmail's
      // trailing-'_' lookahead for an email starting later in the same
      // word (see the autolink gate); remember it until the word ends.
      if (ch === '_' && canOpen) uscoreOpen = true;
      i = j;
      continue;
    }
    if (c === 126) { // ~
      // delimiter is 1-2 tildes. A run of 3+ tildes is not a
      // strikethrough delimiter at all (gfm-493: `~~~not~~~` stays
      // literal — it is not split into a 2-delimiter plus a literal).
      let run = 0;
      while (i + run < n && src.charCodeAt(i + run) === 126) run++;
      if (run > 2) {
        buf += src.slice(i, i + run);
        i += run;
        continue;
      }
      const len = run;
      const fl = flanking(src, i, i + len);
      if (!fl.left && !fl.right) {
        buf += src.slice(i, i + len);
        i += len;
        continue;
      }
      flushBuf();
      pushDelim('~', len, fl.left, fl.right);
      i += len;
      continue;
    }

    // ---- image / link opener ----
    if (c === 33 && i + 1 < n && src.charCodeAt(i + 1) === 91) { // ![
      flushBuf();
      out.push('!');
      const imgIdx = out.length - 1;
      out.push('[');
      delims.push({ ch: '[', len: 0, canOpen: false, canClose: false, outIdx: out.length - 1, active: true, tag: '', srcPos: i + 1, img: true, imgOutIdx: imgIdx, hasLink: false });
      bracketDepth++;
      i += 2;
      continue;
    }
    if (c === 91) { // [
      flushBuf();
      out.push('[');
      delims.push({ ch: '[', len: 0, canOpen: false, canClose: false, outIdx: out.length - 1, active: true, tag: '', srcPos: i, img: false, imgOutIdx: -1, hasLink: false });
      bracketDepth++;
      i++;
      continue;
    }

    // ---- closing bracket: try to form a link / image ----
    if (c === 93 && bracketDepth > 0) { // ]
      const formed = tryFormLink(src, i, links, delims, out, plain, inLink);
      if (formed >= 0) {
        buf = '';
        bracketDepth = countOpenBrackets(delims);
        i = formed;
        continue;
      }
      // no link: the nearest '[' opener is dead; ']' is literal text
      deactivateNearestBracket(delims);
      bracketDepth = countOpenBrackets(delims);
      buf += ']';
      i++;
      continue;
    }

    // ---- autolink / HTML tag ----
    if (c === 60) { // <
      const tag = matchInlineTag(src, i);
      if (tag) {
        flushBuf();
        if (tag.kind === 'tag') {
          // marked startATag /^<a /i, endATag /^<\/a>/i (exact, no space)
          const r = tag.raw;
          if (!docInLink && r.length > 2 && r.charCodeAt(0) === 60 && (r.charCodeAt(1) === 97 || r.charCodeAt(1) === 65) && r.charCodeAt(2) === 32) docInLink = true;
          else if (docInLink && r.length === 4 && r.charCodeAt(0) === 60 && r.charCodeAt(1) === 47 && (r.charCodeAt(2) === 97 || r.charCodeAt(2) === 65) && r.charCodeAt(3) === 62) docInLink = false;
        }
        if (plain) {
          if (tag.kind === 'auto') appendEscapedText(tag.text, out);
          else appendEscapedText(tag.raw, out);
        } else if (tag.kind === 'auto') {
          const href = cleanUrl(tag.href);
          if (href !== null) {
            out.push('<a href="');
            appendEscapedFull(href, out);
            out.push('">');
            appendEscapedFull(tag.text, out);
            out.push('</a>');
          } else {
            appendEscapedText(tag.raw, out);
          }
        } else {
          out.push(tag.raw);
        }
        i = tag.end;
        continue;
      }
      buf += '<';
      i++;
      continue;
    }

    // ---- newline: hard break (2+ trailing spaces) or soft break ----
    if (c === 10) {
      if (!plain && buf.length >= 2 && buf.charCodeAt(buf.length - 1) === 32 && buf.charCodeAt(buf.length - 2) === 32 && !onlyWhitespaceAhead(src, i + 1)) {
        let k = buf.length;
        while (k > 0 && buf.charCodeAt(k - 1) === 32) k--;
        buf = buf.slice(0, k);
        flushBuf();
        out.push('<br>');
        i++;
        // a hard break strips the leading spaces/tabs of the next line
        // (cm-636: `foo  \n     bar` -> `foo<br>bar`).
        while (i < n && (src.charCodeAt(i) === 32 || src.charCodeAt(i) === 9)) i++;
        continue;
      }
      buf += '\n';
      i++;
      continue;
    }

    // ---- extended autolinks (GFM): www. / scheme:// / bare email ----
    // matchExtendedAutolink was the hottest function (~37% of CPU): it
    // ran at EVERY text position, and its bare-email scan is quadratic
    // in word length (each position re-scans the word for '@'). Gate it:
    // a www./scheme/mailto:/xmpp: link can only start on w/h/f/m/x, and
    // a bare email can only start at a word start — a mid-word scan
    // reaches the same '@' and the same domain, so it answers exactly
    // as the word-start scan does — except after a can-open '_'
    // delimiter was pushed inside the word (uscoreOpen), which changes
    // the trailing-'_' lookahead. hasAt skips the email path entirely
    // when the paragraph holds no '@' at all.
    if (!inLink && !docInLink && !plain &&
        (c === 119 || c === 104 || c === 72 || c === 102 || c === 70 || c === 109 || c === 77 || c === 120 || c === 88 ||
         (hasAt && isEmailLocalCode(c) && (wordStart || uscoreOpen)))) {
      const au = matchExtendedAutolink(src, i, delims, links);
      if (au) {
        const href = cleanUrl(au.href);
        if (href !== null) {
          flushBuf();
          out.push('<a href="');
          appendEscapedFull(href, out);
          out.push('">');
          appendEscapedFull(au.text, out);
          out.push('</a>');
          i = au.end;
          // A URL can end on a non-local char (')', '/'); recompute
          // prevLocal from the real char before the new i.
          prevLocal = isEmailLocalCode(src.charCodeAt(i - 1));
          continue;
        }
        // bad URI: render the matched text as plain text, not a link
        buf += src.slice(i, au.end);
        i = au.end;
        prevLocal = isEmailLocalCode(src.charCodeAt(i - 1));
        continue;
      }
    }

    // ---- plain text char ----
    buf += src[i];
    i++;
  }

  flushBuf();
  resolveEmphasis(delims, out, plain);
}

// Is the rest of src from position p all whitespace (or empty)?
function onlyWhitespaceAhead(src, p) {
  const n = src.length;
  for (let k = p; k < n; k++) {
    if (!isSpaceCode(src.charCodeAt(k))) return false;
  }
  return true;
}

// Find the closing backtick run of exactly `run` backticks at or after `from`.
// Returns the index of the run start, or -1.
// The search must not cross a ']' that closes an active '[' link opener
// (followed by '(' or '[' for a dest) UNLESS a closer of the right
// length sits later on the SAME line: the link forms first and its
// text is parsed recursively, so a code span inside link text whose
// closer lies on a later line never forms (doc-09: `` ``url` `` inside
// `[docs each ...](...)` stays literal backticks; the `` `` `` closer
// on the next line must not swallow the link). But a closer on the
// same line DOES cross the ']' and the code span wins over the link
// (cm-342 `[not a `link](/foo`)`, cm-525, cm-537).
function findCodeClose(src, from, run, delims) {
  const n = src.length;
  let i = from;
  while (i < n) {
    if (src.charCodeAt(i) === 96) {
      let j = i;
      while (j < n && src.charCodeAt(j) === 96) j++;
      if (j - i === run) return i;
      i = j;
    } else {
      if (src.charCodeAt(i) === 93 && delims) {
        let openBracket = false;
        for (let k = delims.length - 1; k >= 0; k--) {
          if (delims[k].ch === '[' && delims[k].active) { openBracket = true; break; }
        }
        if (openBracket && i + 1 < n && (src.charCodeAt(i + 1) === 40 || src.charCodeAt(i + 1) === 91)) {
          // A code span may cross the ']' only if its closer lies
          // INSIDE the link construct (dest/ref) or IMMEDIATELY after
          // it (cm-525/537: the trailing backtick right after `)`/`]`).
          // A closer farther along the line (doc-16/28: many words
          // after the link) does not count — the backtick stays
          // literal and the link forms. If the construct does not
          // close on this line, fall back to the same-line search.
          let bound = -1;
          if (src.charCodeAt(i + 1) === 40) {
            let depth = 1, p = i + 2;
            while (p < n && src.charCodeAt(p) !== 10) {
              if (src.charCodeAt(p) === 40) depth++;
              else if (src.charCodeAt(p) === 41) { depth--; if (depth === 0) { bound = p; break; } }
              p++;
            }
          } else {
            let p = i + 2;
            while (p < n && src.charCodeAt(p) !== 10) { if (src.charCodeAt(p) === 93) { bound = p; break; } p++; }
          }
          if (bound < 0) {
            let k = i + 1;
            while (k < n && src.charCodeAt(k) !== 10) {
              if (src.charCodeAt(k) === 96) {
                let m = k;
                while (m < n && src.charCodeAt(m) === 96) m++;
                if (m - k === run) return k;
                k = m;
              } else k++;
            }
            return -1;
          }
          // closer run must START at or before bound+1 (inside the
          // construct, or the char right after its closing bracket)
          let k = i + 1;
          const limit = bound + 1;
          while (k <= limit) {
            if (src.charCodeAt(k) === 96) {
              let m = k;
              while (m < n && src.charCodeAt(m) === 96) m++;
              if (m - k === run) return k;
              k = m;
            } else k++;
          }
          return -1;
        }
      }
      i++;
    }
  }
  return -1;
}

// Flanking info for a delimiter run spanning [start, end) in src.
function flanking(src, start, end) {
  const n = src.length;
  const before = start > 0 ? src[start - 1] : '';
  const after = end < n ? src[end] : '';
  const beforeSpace = before === '' || isUnicodeSpaceCode(before.charCodeAt(0));
  const afterSpace = after === '' || isUnicodeSpaceCode(after.charCodeAt(0));
  const beforePunct = before !== '' && !beforeSpace && isPunctChar(before);
  const afterPunct = after !== '' && !afterSpace && isPunctChar(after);
  const left = !afterSpace && (!afterPunct || beforeSpace || beforePunct);
  const right = !beforeSpace && (!beforePunct || afterSpace || afterPunct);
  return { left, right, beforeSpace, afterSpace, beforePunct, afterPunct };
}

// Resolve emphasis/del over the delimiter list, updating `out` pieces.
// In plain mode the delimiters are consumed but no tags are emitted.
function resolveEmphasis(delims, out, plain) {
  for (let ci = 0; ci < delims.length; ci++) {
    const closer = delims[ci];
    if (closer.ch === '[' || !closer.canClose || closer.len === 0) continue;
    let oi = ci - 1;
    while (true) {
      // find nearest preceding opener with same char that can open
      while (oi >= 0) {
        const o = delims[oi];
        if (o.ch === closer.ch && o.canOpen && o.len > 0) break;
        oi--;
      }
      if (oi < 0) break;
      const opener = delims[oi];
      // Odd-match rule (CommonMark rule 9): applies ONLY when the opener
      // or the closer can both open and close emphasis. If the sum of the
      // lengths is a multiple of 3 and not both lengths are multiples of
      // 3, this opener is skipped.
      const eitherBoth = (opener.canOpen && opener.canClose) || (closer.canOpen && closer.canClose);
      if (eitherBoth && (opener.len + closer.len) % 3 === 0 && !(opener.len % 3 === 0 && closer.len % 3 === 0)) {
        oi--;
        continue;
      }
      // del requires equal lengths (1 or 2)
      if (closer.ch === '~' && opener.len !== closer.len) {
        oi--;
        continue;
      }
      // A short closer must not steal a delimiter from a longer opener
      // once an inner emphasis pair has already formed between them
      // (`**a *b*c* d**`: the lone `*` after `c` must stay literal so
      // the final `**` forms the strong). Before any inner pair, the
      // opener is still splittable (cm-408/409/413), so this does not
      // apply.
      if ((closer.ch === '*' || closer.ch === '_') && closer.len < opener.len) {
        let innerFormed = false;
        for (let k = oi + 1; k < ci; k++) {
          if (delims[k].olen > 0 && delims[k].len === 0) { innerFormed = true; break; }
        }
        if (innerFormed) {
          oi--;
          continue;
        }
      }
      // Rule-of-3 block (marked's openers_bottom): an opener cannot
      // pair with a closer if a formed pair of the same char sits
      // between them whose closing delimiter can still open, whose
      // OPENING delimiter cannot close, and whose original length
      // sums with the opener's length to a multiple of 3.
      // (`*a **b**c*`: outer `*` + inner `**` = 3, inner opener
      // preceded by a space so it cannot close -> no em;
      // `**a *b*c**`: outer `**` + inner `*` = 3 -> no strong.)
      // It does NOT block when the inner opener CAN close
      // (cm-411 `*foo**bar**baz*` and cm-429 `**foo*bar*baz**` form
      // the outer pair), when the lengths sum to 1+1 or 2+2, or when
      // the closing delimiter cannot open (followed by space/punct,
      // or intraword `_`). A closer is recognised by its tag holding
      // a closing tag (`</em>` etc.); its opener via openerIdx.
      // The block is LIFTED by an unconsumed delimiter of the same
      // char between the inner pair and this closer, but only when
      // that delimiter is a pure closer (cannot open) whose length
      // sums with the opener's to a multiple of 3: `**a *b*c* d**`
      // and doc-01 form the outer strong, while `**a *b*c*d**`
      // (lone `*` can open) and `*a **b**c* d*` (lengths sum to 2,
      // not 3) do not. A space alone does not lift it, and a
      // consumed delimiter (part of another formed pair) does not
      // lift it either.
      // A closer of length >= 3 still forms the pair (doc-11
      // `**return that *old*two***` -> strong), but its leftover
      // delimiter then goes INSIDE the tag (`c*</strong>`), not
      // outside (`</strong>*`) as in `**foo***`.
      let rule3Blocked = false;
      if (closer.ch === '*' || closer.ch === '_') {
        for (let k = oi + 1; k < ci && !rule3Blocked; k++) {
          const d = delims[k];
          if (d.ch === closer.ch && d.len === 0 && d.olen > 0 && d.canOpen
              && d.tag.includes('</') && (opener.len + d.olen) % 3 === 0
              && d.openerIdx >= 0 && !delims[d.openerIdx].canClose) {
            let lifted = false;
            for (let j = k + 1; j < ci; j++) {
              const u = delims[j];
              if (u.ch === closer.ch && u.len > 0 && !u.canOpen
                  && (opener.len + u.len) % 3 === 0) { lifted = true; break; }
            }
            if (!lifted) rule3Blocked = true;
          }
        }
      }
      if (rule3Blocked && closer.len < 3) {
        oi--;
        continue;
      }
      const use = (opener.len >= 2 && closer.len >= 2) ? 2 : 1;
      const openTag = use === 2
        ? (closer.ch === '*' || closer.ch === '_' ? '<strong>' : '<del>')
        : (closer.ch === '*' || closer.ch === '_' ? '<em>' : '<del>');
      const closeTag = use === 2
        ? (closer.ch === '*' || closer.ch === '_' ? '</strong>' : '</del>')
        : (closer.ch === '*' || closer.ch === '_' ? '</em>' : '</del>');
      opener.len -= use;
      closer.len -= use;
      // Remember which opener this closer paired with, so the
      // rule-of-3 block can check that opener's canClose.
      if (closer.openerIdx < 0) closer.openerIdx = oi;
      if (!plain) {
        opener.tag = openTag + opener.tag;
        closer.tag = closer.tag + closeTag;
        out[opener.outIdx] = opener.ch.repeat(opener.len) + opener.tag;
        // A leftover closer delimiter normally goes outside the tag
        // (`**foo***` -> `</strong>*`), but when the rule-of-3 block
        // applied and only the closer's length >= 3 let the pair form,
        // the leftover goes INSIDE (`**a *b*c***` -> `c*</strong>`).
        out[closer.outIdx] = (rule3Blocked && closer.len > 0)
          ? closer.ch.repeat(closer.len) + closer.tag
          : closer.tag + closer.ch.repeat(closer.len);
      } else {
        out[opener.outIdx] = opener.ch.repeat(opener.len);
        out[closer.outIdx] = closer.ch.repeat(closer.len);
      }
      // An emphasis pair cannot be crossed: a delimiter strictly inside
      // this pair can no longer open (cm-469/470: a `_` opener inside a
      // formed `*` pair cannot pair with a `_` closer outside it, while
      // a pair fully inside is fine). Closers inside were already
      // processed (forward order), so only canOpen needs clearing.
      for (let k = oi + 1; k < ci; k++) delims[k].canOpen = false;
      if (closer.len === 0) break;
      // The closer still has delimiters: retry the SAME opener, which
      // may still have delimiters left (`***foo***` -> em + strong,
      // `****foo****` -> strong + strong). Only move to the previous
      // opener once this one is exhausted.
      if (opener.len === 0) oi--;
    }
  }
}

function countOpenBrackets(delims) {
  let d = 0;
  for (let k = 0; k < delims.length; k++) if (delims[k].ch === '[' && delims[k].active) d++;
  return d;
}

function deactivateNearestBracket(delims) {
  for (let k = delims.length - 1; k >= 0; k--) {
    if (delims[k].ch === '[' && delims[k].active) {
      delims[k].active = false;
      return;
    }
  }
}

// Try to form a link/image whose ']' is at src[closeIdx].
// Returns the index just past the link, or -1 if no link forms.
// On success, truncates `out` to the '[' (or '!') piece and pushes the
// link/image HTML; removes delimiters recorded inside the link text and
// deactivates every remaining '[' opener (a link cannot contain a link).
// A link does not form when its text holds a matched code span AND
// (that span's content contains a backtick, or some other backtick run
// in the text is unmatched) — doc-16/18/20/22/23/30. A text with only
// unmatched runs (`[a ``b` c]`) still forms; a clean span (`[a `b` c]`)
// still forms. Greedy left-to-right pairing mirrors code-span scans.
function labelHasBadBackticks(label) {
  const runs = [];
  for (let i = 0; i < label.length;) {
    if (label.charCodeAt(i) === 96) {
      let j = i;
      while (j < label.length && label.charCodeAt(j) === 96) j++;
      runs.push([i, j]);
      i = j;
    } else i++;
  }
  if (runs.length === 0) return false;
  let matched = false, bad = false;
  const used = new Array(runs.length).fill(false);
  for (let a = 0; a < runs.length; a++) {
    if (used[a]) continue;
    const lenA = runs[a][1] - runs[a][0];
    let b = -1;
    for (let k = a + 1; k < runs.length; k++) {
      if (!used[k] && runs[k][1] - runs[k][0] === lenA) { b = k; break; }
    }
    if (b < 0) { bad = true; continue; }
    matched = true;
    used[a] = true; used[b] = true;
    // content between the pair must not contain a backtick
    for (let p = runs[a][1]; p < runs[b][0]; p++) {
      if (label.charCodeAt(p) === 96) { bad = true; break; }
    }
  }
  return matched && bad;
}

function tryFormLink(src, closeIdx, links, delims, out, plain, inLink) {
  // find nearest active '[' opener
  let bi = -1;
  for (let k = delims.length - 1; k >= 0; k--) {
    if (delims[k].ch === '[' && delims[k].active) { bi = k; break; }
  }
  if (bi < 0) return -1;
  const open = delims[bi];
  // A LINK cannot contain a link: if a link already formed inside this
  // opener's text, it cannot form one now (cm-520: the `[` before
  // `[foo](uri1)` cannot take `(uri2)` as its dest). An IMAGE may
  // contain a link, so image openers ignore hasLink.
  if (!open.img && open.hasLink) return -1;
  const labelSrc = src.slice(open.srcPos + 1, closeIdx);
  let href = null, title = null, end = -1;

  const after = closeIdx + 1;
  // Inline dest `(...)`: if it does not parse, fall back to the
  // reference/shortcut path instead of failing outright (cm-568:
  // `[foo](not a link)` with a `[foo]` def forms the shortcut ref).
  let parsedInline = null;
  if (after < src.length && src.charCodeAt(after) === 40) { // inline (dest)
    parsedInline = parseInlineDest(src, after);
  }
  if (parsedInline) {
    href = parsedInline.href;
    title = parsedInline.title;
    end = parsedInline.end;
  } else {
    let refLabel = null;
    let refEnd = -1;
    if (after < src.length && src.charCodeAt(after) === 91) { // [ref]
      const r = parseRefLabel(src, after + 1);
      if (r < 0) return -1;
      refLabel = src.slice(after + 1, r);
      refEnd = r + 1;
    }
    if (refLabel !== null) {
      if (refLabel === '') refLabel = labelSrc; // collapsed []
      const def = links.get(normLabel(refLabel));
      if (!def) return -1;
      href = def.href;
      title = def.title;
      end = refEnd;
    } else {
      // shortcut ref: label is the link text itself
      const def = links.get(normLabel(labelSrc));
      if (!def) return -1;
      href = def.href;
      title = def.title;
      end = closeIdx + 1;
    }
  }

  const clean = cleanUrl(unescapeLinkText(href));
  if (clean === null) return -1;
  // A link whose text holds a matched code span plus a backtick inside
  // it (or an unmatched backtick run) does not form (doc-16/18/20/
  // 22/23/30); the bracket stays literal and the dest autolinks.
  // Exception: when the label ENDS with a backtick (doc-03/05: the
  // unmatched backtick is the label's last char) the link still forms.
  // When it does not form, the `_`/`*` emphasis inside the label is
  // also suppressed (marked leaves `_node `a ` b`_` literal): disable
  // those delimiters (they sit after the '[' opener in delims).
  if (!open.img && labelHasBadBackticks(labelSrc) && !labelSrc.endsWith('`')) {
    for (let k = bi + 1; k < delims.length; k++) {
      if (delims[k].ch === '_' || delims[k].ch === '*') { delims[k].canOpen = false; delims[k].canClose = false; }
    }
    return -1;
  }

  // truncate out to the '[' (or '!' for images) and drop inner delimiters
  const cutIdx = open.img ? open.imgOutIdx : open.outIdx;
  out.length = cutIdx;
  // remove delimiters recorded inside the link text (they are re-parsed
  // recursively); the opener at index bi is removed by the truncation.
  delims.length = bi;
  // When a LINK forms, every still-open '[' opener now has a link inside
  // its text, so none of them can form a link later (cm-520). They stay
  // ACTIVE (not deactivated): the next ']' must try the nearest one and
  // fail on hasLink, rather than skipping ahead to an earlier image
  // opener with the wrong dest. An IMAGE marks nothing (its text may
  // contain a link, and a link's text may contain an image).
  if (!open.img) {
    for (let k = 0; k < delims.length; k++) {
      if (delims[k].ch === '[') delims[k].hasLink = true;
    }
  }

  if (open.img) {
    // image: alt is the plain-text rendering of the label
    const altOut = [];
    const savedInLink = docInLink;
    inlineParse(labelSrc, links, altOut, true, true);
    docInLink = savedInLink;
    const alt = altOut.join('');
    if (plain) {
      out.push(alt);
    } else {
      out.push('<img src="');
      appendEscapedText(clean, out);
      out.push('" alt="');
      out.push(alt);
      out.push('"');
      if (title !== null && title !== undefined) {
        out.push(' title="');
        appendEscapedText(unescapeLinkText(title), out);
        out.push('"');
      }
      out.push('>');
    }
  } else {
    const innerOut = [];
    const savedInLink = docInLink;
    inlineParse(labelSrc, links, innerOut, plain, true);
    docInLink = savedInLink;
    if (plain) {
      out.push(innerOut.join(''));
    } else {
      out.push('<a href="');
      appendEscapedText(clean, out);
      out.push('"');
      if (title !== null && title !== undefined) {
        out.push(' title="');
        appendEscapedText(unescapeLinkText(title), out);
        out.push('"');
      }
      out.push('>');
      out.push(innerOut.join(''));
      out.push('</a>');
    }
  }
  return end;
}

// Parse an inline link destination starting at src[p] === '('.
// Returns {href, title, end} (end = index just past ')') or null.
function parseInlineDest(src, p) {
  const n = src.length;
  let i = p + 1;
  // skip whitespace (spaces, tabs, newlines)
  while (i < n && isSpaceCode(src.charCodeAt(i))) i++;
  if (i >= n) return null;
  if (src.charCodeAt(i) === 41) {
    // empty destination: [a]()
    return { href: '', title: null, end: i + 1 };
  }
  let href = null;
  if (src.charCodeAt(i) === 60) { // <angle dest> (may contain parens)
    let j = i + 1;
    let ok = true;
    while (j < n) {
      const c = src.charCodeAt(j);
      if (c === 62) break;
      if (c === 10 || c === 60) { ok = false; break; }
      if (c === 92) j++;
      j++;
    }
    if (!ok || j >= n || src.charCodeAt(j) !== 62) return null;
    href = src.slice(i + 1, j);
    i = j + 1;
  } else {
    // bare dest: non-space, non-control, balanced parens
    let j = i;
    let depth = 0;
    while (j < n) {
      const c = src.charCodeAt(j);
      if (isSpaceCode(c) || c < 32 || c === 127) break;
      if (c === 92) { j += 2; continue; }
      if (c === 40) depth++;
      else if (c === 41) {
        if (depth === 0) break; // closes the link
        depth--;
      }
      j++;
    }
    if (j === i) return null;
    if (depth !== 0) return null; // unbalanced parens
    href = src.slice(i, j);
    i = j;
  }
  // optional title, then ')'
  let title = null;
  let k = i;
  while (k < n && isSpaceCode(src.charCodeAt(k))) k++;
  if (k < n && src.charCodeAt(k) !== 41) {
    const tc = src.charCodeAt(k);
    let tEnd = -1;
    if (tc === 34) { // "..."
      let j = k + 1;
      while (j < n) {
        const c = src.charCodeAt(j);
        if (c === 92) { j += 2; continue; }
        if (c === 34) { tEnd = j; break; }
        j++;
      }
      if (tEnd < 0) return null;
      title = src.slice(k + 1, tEnd);
      k = tEnd + 1;
    } else if (tc === 39) { // '...'
      let j = k + 1;
      while (j < n) {
        const c = src.charCodeAt(j);
        if (c === 92) { j += 2; continue; }
        if (c === 39) { tEnd = j; break; }
        j++;
      }
      if (tEnd < 0) return null;
      title = src.slice(k + 1, tEnd);
      k = tEnd + 1;
    } else if (tc === 40) { // (...)
      let j = k + 1;
      while (j < n) {
        const c = src.charCodeAt(j);
        if (c === 92) { j += 2; continue; }
        if (c === 41) { tEnd = j; break; }
        if (c === 40) return null;
        j++;
      }
      if (tEnd < 0) return null;
      title = src.slice(k + 1, tEnd);
      k = tEnd + 1;
    } else {
      return null; // junk after dest
    }
    while (k < n && isSpaceCode(src.charCodeAt(k))) k++;
  }
  if (k >= n || src.charCodeAt(k) !== 41) return null;
  return { href, title, end: k + 1 };
}

// Parse a reference label starting at src[p] (just after '[').
// Returns the index of the closing ']', or -1.
function parseRefLabel(src, p) {
  const n = src.length;
  let j = p;
  while (j < n) {
    const c = src.charCodeAt(j);
    if (c === 92) { j += 2; continue; }
    if (c === 93) return j;
    if (c === 91) return -1;
    if (c === 10) {
      // newline allowed unless it starts a blank line
      let k = j + 1;
      while (k < n && (src.charCodeAt(k) === 32 || src.charCodeAt(k) === 9)) k++;
      if (k < n && src.charCodeAt(k) === 10) return -1;
    }
    j++;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Inline tag / autolink matching.
// Returns {kind:'tag'|'auto', raw, end, href, text} or null.
// ---------------------------------------------------------------------------

function matchInlineTag(src, i) {
  const n = src.length;
  // comment <!-- ... -->
  if (src.startsWith('<!--', i)) {
    // Abruptly-closed comments end at their own '>': `<!-->` and
    // `<!--->` are complete comments (cm-626: the `-->` after `foo`
    // is literal text, not part of the comment).
    if (src.charCodeAt(i + 4) === 62) return { kind: 'tag', raw: src.slice(i, i + 5), end: i + 5 };
    if (src.charCodeAt(i + 4) === 45 && src.charCodeAt(i + 5) === 62) return { kind: 'tag', raw: src.slice(i, i + 6), end: i + 6 };
    const e = src.indexOf('-->', i + 4);
    if (e < 0) return null;
    return { kind: 'tag', raw: src.slice(i, e + 3), end: e + 3 };
  }
  // processing instruction <? ... ?>
  if (src.startsWith('<?', i)) {
    const e = src.indexOf('?>', i + 2);
    if (e < 0) return null;
    return { kind: 'tag', raw: src.slice(i, e + 2), end: e + 2 };
  }
  // CDATA <![CDATA[ ... ]]>
  if (src.startsWith('<![CDATA[', i)) {
    const e = src.indexOf(']]>', i + 9);
    if (e < 0) return null;
    return { kind: 'tag', raw: src.slice(i, e + 3), end: e + 3 };
  }
  // declaration <!Letter ... >
  if (src.startsWith('<!', i)) {
    let j = i + 2;
    if (j < n && isAsciiLetter(src.charCodeAt(j))) {
      while (j < n && isAsciiLetter(src.charCodeAt(j))) j++;
      if (j < n && isSpaceCode(src.charCodeAt(j))) {
        const e = src.indexOf('>', j);
        if (e < 0) return null;
        return { kind: 'tag', raw: src.slice(i, e + 1), end: e + 1 };
      }
    }
    return null;
  }
  // closing tag </name>
  if (src.startsWith('</', i)) {
    let j = i + 2;
    if (j < n && isAsciiLetter(src.charCodeAt(j))) {
      while (j < n && isTagNameChar(src.charCodeAt(j))) j++;
      while (j < n && isSpaceCode(src.charCodeAt(j))) j++;
      if (j < n && src.charCodeAt(j) === 62) {
        return { kind: 'tag', raw: src.slice(i, j + 1), end: j + 1 };
      }
    }
    return null;
  }
  // autolink <scheme:...> or <email>
  if (i + 1 < n && isAsciiLetter(src.charCodeAt(i + 1))) {
    const auto = matchAngleAutolink(src, i);
    if (auto) return auto;
  }
  // opening tag <name ...>
  if (i + 1 < n && isAsciiLetter(src.charCodeAt(i + 1))) {
    let j = i + 1;
    while (j < n && isTagNameChar(src.charCodeAt(j))) j++;
    // After the tag name, the next char must be whitespace, '/', '>',
    // or end of input (`<m:abc>` is not a tag: ':' cannot start an
    // attribute here, because no whitespace separates it from the name).
    if (j < n) {
      const nc = src.charCodeAt(j);
      if (!isSpaceCode(nc) && nc !== 62 && nc !== 47) return null;
    }
    while (true) {
      // skip whitespace
      let k = j;
      while (k < n && isSpaceCode(src.charCodeAt(k))) k++;
      if (k >= n) return null;
      const c = src.charCodeAt(k);
      if (c === 62) { // >
        return { kind: 'tag', raw: src.slice(i, k + 1), end: k + 1 };
      }
      if (c === 47) { // /
        // '/' must be followed immediately by '>' (`<bar/ >` is not a
        // tag: a self-closing tag has no whitespace after the slash).
        if (k + 1 < n && src.charCodeAt(k + 1) === 62) {
          return { kind: 'tag', raw: src.slice(i, k + 2), end: k + 2 };
        }
        return null;
      }
      // attribute name
      if (isAttrNameStart(src.charCodeAt(k))) {
        let a = k;
        while (a < n && isAttrNameChar(src.charCodeAt(a))) a++;
        let b = a;
        while (b < n && isSpaceCode(src.charCodeAt(b))) b++;
        if (b < n && src.charCodeAt(b) === 61) { // =
          b++;
          while (b < n && isSpaceCode(src.charCodeAt(b))) b++;
          if (b >= n) return null;
          const q = src.charCodeAt(b);
          if (q === 34 || q === 39) { // quoted value
            const e = src.indexOf(String.fromCharCode(q), b + 1);
            if (e < 0) return null;
            j = e + 1;
            // Attributes must be whitespace-separated: after a quoted
            // value, the next char must be whitespace, '/', '>', or end
            // (`<a href='bar'title=title>` is not a tag — cm-622).
            if (j < n) {
              const nc = src.charCodeAt(j);
              if (!isSpaceCode(nc) && nc !== 62 && nc !== 47) return null;
            }
          } else { // unquoted value
            let v = b;
            while (v < n) {
              const vc = src.charCodeAt(v);
              if (isSpaceCode(vc) || vc === 34 || vc === 39 || vc === 61 || vc === 60 || vc === 62 || vc === 96) break;
              v++;
            }
            if (v === b) return null;
            j = v;
          }
        } else {
          j = a;
        }
        continue;
      }
      return null;
    }
  }
  return null;
}

function isAsciiLetter(c) {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}
function isTagNameChar(c) {
  return isAsciiLetter(c) || (c >= 48 && c <= 57) || c === 45;
}
function isAttrNameStart(c) {
  return isAsciiLetter(c) || c === 95 || c === 58;
}
function isAttrNameChar(c) {
  return isAsciiLetter(c) || (c >= 48 && c <= 57) || c === 95 || c === 58 || c === 46 || c === 45;
}

// <scheme:...> or <email> starting at src[i] === '<'.
// Returns {kind:'auto', raw, end, href, text} or null.
function matchAngleAutolink(src, i) {
  const n = src.length;
  let j = i + 1;
  // scheme: letter, then 1-31 alnum/+/-/. , then ':'
  let k = j;
  while (k < n && (isAsciiLetter(src.charCodeAt(k)) || (src.charCodeAt(k) >= 48 && src.charCodeAt(k) <= 57) || src.charCodeAt(k) === 43 || src.charCodeAt(k) === 45 || src.charCodeAt(k) === 46)) k++;
  if (k - j >= 2 && k - j <= 32 && k < n && src.charCodeAt(k) === 58) {
    // scheme autolink: content until '>' with no space/<>/control
    let m = k + 1;
    while (m < n) {
      const c = src.charCodeAt(m);
      if (c === 62) {
        const inside = src.slice(i + 1, m);
        return { kind: 'auto', raw: src.slice(i, m + 1), end: m + 1, href: inside, text: inside };
      }
      if (c === 32 || c === 60 || c < 32 || c === 127) return null;
      m++;
    }
    return null;
  }
  // email autolink: scan to '>', validate the whole inside as an email
  let m = i + 1;
  while (m < n && src.charCodeAt(m) !== 62) {
    const c = src.charCodeAt(m);
    if (c === 32 || c === 60 || c < 32 || c === 127) return null;
    m++;
  }
  if (m >= n) return null;
  const inside = src.slice(i + 1, m);
  if (isEmailText(inside)) {
    return { kind: 'auto', raw: src.slice(i, m + 1), end: m + 1, href: 'mailto:' + inside, text: inside };
  }
  return null;
}

function isEmailText(s) {
  // [A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+ @ domain labels
  const n = s.length;
  let i = 0;
  const localOk = (c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) ||
    c === 46 || c === 33 || c === 35 || c === 36 || c === 37 || c === 38 || c === 39 ||
    c === 42 || c === 43 || c === 47 || c === 61 || c === 63 || c === 94 || c === 95 ||
    c === 96 || c === 123 || c === 124 || c === 125 || c === 126 || c === 45;
  if (i >= n || !localOk(s.charCodeAt(i))) return false;
  while (i < n && localOk(s.charCodeAt(i))) i++;
  if (i >= n || s.charCodeAt(i) !== 64) return false;
  i++;
  // domain: label(.label)+ ; each label starts/ends alnum, interior alnum/hyphen
  let labels = 0;
  while (i < n) {
    const c0 = s.charCodeAt(i);
    if (!((c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122) || (c0 >= 48 && c0 <= 57))) return false;
    let j = i;
    while (j < n) {
      const c = s.charCodeAt(j);
      if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 45) j++;
      else break;
    }
    // label must not end with '-'
    if (s.charCodeAt(j - 1) === 45) return false;
    labels++;
    i = j;
    if (i < n && s.charCodeAt(i) === 46) { i++; continue; }
    break;
  }
  return labels >= 2 && i === n;
}

// ---------------------------------------------------------------------------
// Extended (bare) autolinks: www. / http(s):// / ftp:// / mailto: / email.
// Returns {href, text, end} or null. Assumes !inLink and !plain.
// ---------------------------------------------------------------------------

// Pure predicate: would a link form at src[closeIdx] === ']'?
// Mirrors tryFormLink's decision without side effects. Used by the
// extended-autolink URL scan: marked's GFM url regex takes `]`/`[`
// into the URL (its _backpedal never trims them), so the URL stops
// at `]` ONLY when a link would actually form there (doc-22/23:
// the `[26]`/`[last used]` refs are undefined, so no link forms and
// the autolink runs through the `]`, percent-encoding it as %5D%5B).
function linkFormsAt(src, closeIdx, links, delims) {
  let bi = -1;
  for (let k = delims.length - 1; k >= 0; k--) {
    if (delims[k].ch === '[' && delims[k].active) { bi = k; break; }
  }
  if (bi < 0) return false;
  const open = delims[bi];
  if (!open.img && open.hasLink) return false;
  const labelSrc = src.slice(open.srcPos + 1, closeIdx);
  if (!open.img && labelHasBadBackticks(labelSrc) && !labelSrc.endsWith('`')) return false;
  const after = closeIdx + 1;
  let href = null;
  if (after < src.length && src.charCodeAt(after) === 40) {
    const parsedInline = parseInlineDest(src, after);
    if (parsedInline) href = parsedInline.href;
  }
  if (href === null) {
    let refLabel = null;
    if (after < src.length && src.charCodeAt(after) === 91) {
      const r = parseRefLabel(src, after + 1);
      if (r < 0) return false;
      refLabel = src.slice(after + 1, r);
    }
    if (refLabel !== null) {
      if (refLabel === '') refLabel = labelSrc;
      const def = links.get(normLabel(refLabel));
      if (!def) return false;
      href = def.href;
    } else {
      const def = links.get(normLabel(labelSrc));
      if (!def) return false;
      href = def.href;
    }
  }
  return cleanUrl(unescapeLinkText(href)) !== null;
}

function matchExtendedAutolink(src, i, delims, links) {
  const n = src.length;
  // mailto: / xmpp: + email
  if (src.startsWith('mailto:', i) || src.startsWith('MAILTO:', i) || src.startsWith('Mailto:', i)) {
    const m = matchBareEmail(src, i + 7, delims);
    if (m > i + 7) {
      const text = src.slice(i, m);
      return { href: text, text, end: m };
    }
    return null;
  }
  if (src.startsWith('xmpp:', i) || src.startsWith('XMPP:', i)) {
    const m = matchBareEmail(src, i + 5, delims);
    if (m > i + 5) {
      // xmpp: allows ONE path segment after the email, of
      // [A-Za-z0-9@.]+, with trailing '.'s trimmed (gfm-634/635:
      // `xmpp:foo@bar.baz/txt` is the link, `/txt/bin` is not,
      // `/txt?x=1` is not, `mailto:` takes NO path at all).
      let end = m;
      if (m < n && src.charCodeAt(m) === 47) {
        let s = m + 1;
        while (s < n) {
          const c = src.charCodeAt(s);
          if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 64 || c === 46) s++;
          else break;
        }
        while (s > m + 1 && src.charCodeAt(s - 1) === 46) s--;
        if (s > m + 1) end = s;
      }
      const text = src.slice(i, end);
      return { href: text, text, end };
    }
    return null;
  }
  // www. / scheme:// — the `www.` prefix is lowercase-only in marked
  // (its autolink regex is case-sensitive: `Www.`/`WWW.` are NOT links).
  // Scheme matching is case-insensitive (the old code lowercased a slice);
  // compare char codes directly — no slice allocation per position.
  // (x | 32) lowercases an ASCII letter and nothing else relevant: for a
  // lowercase target the only pre-images are the letter itself and its
  // uppercase form. charCodeAt past the end is NaN, and NaN | 32 is 0.
  let schemeEnd = -1;
  let prefix = '';
  if (src.startsWith('www.', i)) {
    schemeEnd = i + 4;
    prefix = 'http://';
  } else {
    const c0 = src.charCodeAt(i);
    if (c0 === 104 || c0 === 72) { // h/H: http:// or https://
      if ((src.charCodeAt(i + 1) | 32) === 116 && (src.charCodeAt(i + 2) | 32) === 116 &&
          (src.charCodeAt(i + 3) | 32) === 112) {
        if ((src.charCodeAt(i + 4) | 32) === 115) { // https
          if (src.charCodeAt(i + 5) === 58 && src.charCodeAt(i + 6) === 47 && src.charCodeAt(i + 7) === 47) schemeEnd = i + 8;
        } else if (src.charCodeAt(i + 4) === 58 && src.charCodeAt(i + 5) === 47 && src.charCodeAt(i + 6) === 47) {
          schemeEnd = i + 7;
        }
      }
    } else if (c0 === 102 || c0 === 70) { // f/F: ftp://
      if ((src.charCodeAt(i + 1) | 32) === 116 && (src.charCodeAt(i + 2) | 32) === 112 &&
          src.charCodeAt(i + 3) === 58 && src.charCodeAt(i + 4) === 47 && src.charCodeAt(i + 5) === 47) schemeEnd = i + 6;
    }
  }
  if (schemeEnd >= 0) {
    // domain: (label.)+ then path [^\s<]*
    let j = schemeEnd;
    let labels = 0;
    while (j < n) {
      const c0 = src.charCodeAt(j);
      if (!((c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122) || (c0 >= 48 && c0 <= 57) || c0 === 45)) break;
      let k = j;
      while (k < n) {
        const c = src.charCodeAt(k);
        if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 45) k++;
        else break;
      }
      labels++;
      j = k;
      if (j < n && src.charCodeAt(j) === 46) { j++; continue; }
      break;
    }
    if (labels === 0) return null;
    // path: any non-space, non-'<' chars, but stop at a ']' when the
    // nearest '[' link opener is pending AND can still form a link:
    // the ']' closes the link, and the bare URL inside link text must
    // not swallow it (marked forms the link first, so the URL inside
    // is never autolinked). If that opener already contains a link
    // (hasLink, set when an inner link formed), the ']' cannot form
    // a link, so it stays part of the URL (doc-12: the ']' after the
    // img.shields.io URL is inside an outer link's text that already
    // holds a link, and the URL runs on through `)](./docs/...)`).
    // An image opener may contain a link, so it still stops the URL.
    let openBracket = false;
    if (delims) {
      for (let k = delims.length - 1; k >= 0; k--) {
        if (delims[k].ch === '[' && delims[k].active) {
          openBracket = delims[k].img || !delims[k].hasLink;
          break;
        }
      }
    }
    while (j < n) {
      const c = src.charCodeAt(j);
      if (c === 32 || c === 9 || c === 10 || c === 60) break;
      if (c === 93 && openBracket && linkFormsAt(src, j, links, delims)) break;
      if (c === 40) {
        // A '(' is part of the URL only if its matching ')' comes
        // before any space (a paren group holding a space is not a
        // URL continuation: `https://a.com/x(foo bar)` links only
        // `https://a.com/x`, and doc-08's
        // `https://sub.domain.example.io)](https://npmjs.com/heading (Most))`
        // links only `https://sub.domain.example.io)]`).
        let depth = 1, k = j + 1, ok = false;
        while (k < n) {
          const d = src.charCodeAt(k);
          if (d === 32 || d === 9 || d === 10 || d === 60) break;
          if (d === 40) depth++;
          else if (d === 41) { depth--; if (depth === 0) { ok = true; break; } }
          k++;
        }
        if (!ok) break;
      }
      j++;
    }
    let end = backpedalUrl(src, schemeEnd, j);
    if (end <= schemeEnd) return null;
    const text = src.slice(i, end);
    return { href: prefix + text, text, end };
  }
  // bare email
  const m = matchBareEmail(src, i, delims);
  if (m > i) {
    // must not be preceded by a word char (the scan would have started earlier)
    const text = src.slice(i, m);
    return { href: 'mailto:' + text, text, end: m };
  }
  return null;
}

// Match a bare email starting at src[i]; returns end index or -1.
// Pattern: local@domain(.domain)+ with a negative lookahead for [\w-].
function matchBareEmail(src, i, delims) {
  const n = src.length;
  let j = i;
  const localOk = (c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) ||
    c === 46 || c === 95 || c === 43 || c === 45;
  if (j >= n || !localOk(src.charCodeAt(j))) return -1;
  while (j < n && localOk(src.charCodeAt(j))) j++;
  if (j >= n || src.charCodeAt(j) !== 64) return -1;
  j++;
  let labels = 0;
  while (j < n) {
    const c0 = src.charCodeAt(j);
    if (!((c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122) || (c0 >= 48 && c0 <= 57) || c0 === 45 || c0 === 95)) return -1;
    let k = j;
    while (k < n) {
      const c = src.charCodeAt(k);
      if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 45 || c === 95) k++;
      else break;
    }
    // A label must end with alnum: backtrack over trailing '_'/'-' so
    // a trailing `__` (strong delimiter) does not void the email; the
    // negative lookahead below then decides (a `_` delimiter allows it).
    while (k > j && (src.charCodeAt(k - 1) === 95 || src.charCodeAt(k - 1) === 45)) k--;
    if (k === j) return -1;
    // label must end with alnum (not - or _)
    const last = src.charCodeAt(k - 1);
    if (!((last >= 65 && last <= 90) || (last >= 97 && last <= 122) || (last >= 48 && last <= 57))) return -1;
    labels++;
    j = k;
    // A '.' separates labels only if a label follows it; a trailing '.'
    // (or '.' before a non-label char) ends the domain (gfm-632:
    // `a.b-c_d@a.b.` links `a.b-c_d@a.b`, the '.' stays outside).
    if (j < n && src.charCodeAt(j) === 46) {
      const nc = j + 1 < n ? src.charCodeAt(j + 1) : -1;
      if (nc >= 0 && ((nc >= 65 && nc <= 90) || (nc >= 97 && nc <= 122) || (nc >= 48 && nc <= 57) || nc === 45 || nc === 95)) {
        j++;
        continue;
      }
    }
    break;
  }
  if (labels < 2) return -1;
  // negative lookahead: next char must not be [\w-], except a trailing
  // `_` that is a strong/em delimiter: marked strips `__` delimiters
  // (recursive strong tokenizing) before matching the email inside, so
  // `__a@b.co__` links while `a@b.co_` (literal `_`) does not. Allow
  // the trailing `_` only when an open `_` delimiter is pending. The
  // open check must simulate `_` matching: resolveEmphasis runs AFTER
  // the scan, so a `__bar__` opener is still in delims when the email
  // on the next line is matched — but its closer is too, so it is
  // paired and must not authorize the trailing `_`. A `_` run that
  // closes an opener is consumed (not re-pushed as an opener).
  if (j < n) {
    const c = src.charCodeAt(j);
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 45) return -1;
    if (c === 95) {
      let open = false;
      if (delims) {
        let depth = 0;
        for (let k = 0; k < delims.length; k++) {
          const d = delims[k];
          if (d.ch !== '_') continue;
          if (d.canClose && depth > 0) { depth--; continue; }
          if (d.canOpen) depth++;
        }
        open = depth > 0;
      }
      if (!open) return -1;
    }
  }
  return j;
}

// Trim trailing punctuation / unbalanced ')' / stray ';' from a bare URL
// spanning [start, end) in src. Returns the new end.
function backpedalUrl(src, start, end) {
  let e = end;
  while (e > start) {
    const c = src.charCodeAt(e - 1);
    // marked's _backpedal trims trailing ?!.,:;*_'\"~ (and ')'/& by
    // their own rules); the set below matches it exactly, including
    // the quote chars ' and " (doc-08's trailing '"' after a URL).
    if (c === 63 || c === 33 || c === 46 || c === 44 || c === 58 || c === 59 || c === 42 || c === 95 || c === 126 || c === 39 || c === 34) {
      if (c === 59) {
        // A trailing `&name;` (entity-like) is trimmed WHOLESALE: the
        // URL ends before the `&` (gfm-627: `www.example.com/a&hl;`
        // links only `www.example.com/a`). Only `&` + alnum + `;` counts
        // (marked's backpedal lookahead `&(?![a-zA-Z0-9]+;$)`); a `;`
        // that is not part of such an entity is trimmed on its own.
        let k = e - 2;
        while (k >= start) {
          const d = src.charCodeAt(k);
          if ((d >= 48 && d <= 57) || (d >= 65 && d <= 90) || (d >= 97 && d <= 122)) { k--; continue; }
          break;
        }
        if (k >= start && src.charCodeAt(k) === 38 && k + 1 < e - 1) {
          e = k;
          continue;
        }
      }
      e--;
      continue;
    }
    if (c === 41) { // ')': drop only if no '(' is open before it.
      // Depth scan from the URL start, clamped at 0 (an unmatched ')'
      // in the middle does not consume a later '('): `a)b(c)` keeps
      // its trailing ')' (the '(' before it is open), while `a(b)c)`
      // drops it (depth 0). A plain total count is wrong here: it
      // would drop the ')' in `a)b(c)` (2 close vs 1 open).
      let depth = 0;
      for (let k = start; k < e - 1; k++) {
        const d = src.charCodeAt(k);
        if (d === 40) depth++;
        else if (d === 41 && depth > 0) depth--;
      }
      if (depth === 0) { e--; continue; }
      break;
    }
    break;
  }
  return e;
}

// ---------------------------------------------------------------------------
// Block parser (line-based, CommonMark incorporation algorithm).
// Lines are objects {s, off, col, tab} so container prefixes can be
// stripped with correct tab expansion (partial tabs kept as `tab`).
// ---------------------------------------------------------------------------

function makeLine(s) { return { s, off: 0, col: 0, tab: 0, base: 0 }; }

function lineRemain(ln) {
  if (ln.tab > 0) return ' '.repeat(ln.tab) + ln.s.slice(ln.off);
  return ln.s.slice(ln.off);
}

function lineIndent(ln) {
  let n = ln.tab;
  let p = ln.off;
  let col = ln.col + ln.tab;
  const s = ln.s;
  while (p < s.length) {
    const c = s.charCodeAt(p);
    if (c === 32) { n++; p++; col++; }
    else if (c === 9) { const w = 4 - (col % 4); n += w; p++; col += w; }
    else break;
  }
  return n;
}

// Consume n columns of leading whitespace from the line.
function advance(ln, n) {
  if (ln.tab > 0) {
    if (n <= ln.tab) { ln.tab -= n; ln.col += n; return; }
    n -= ln.tab; ln.col += ln.tab; ln.tab = 0;
  }
  const s = ln.s;
  let p = ln.off, col = ln.col;
  while (n > 0 && p < s.length) {
    const c = s.charCodeAt(p);
    if (c === 32) { p++; col++; n--; }
    else if (c === 9) {
      const w = 4 - (col % 4);
      if (n < w) { ln.tab = w - n; p++; col += n; n = 0; }
      else { p++; col += w; n -= w; }
    } else break;
  }
  ln.off = p; ln.col = col;
}

// Expand tabs in the leading whitespace run of `t` to spaces, counting
// columns from `col` (the column of t[0]). Used for fenced-code lines
// inside containers: marked expands container lines' leading whitespace
// before stripping anything, so a tab becomes 1-4 spaces here.
function expandLeadingTabs(t, col) {
  let i = 0;
  while (i < t.length && (t.charCodeAt(i) === 32 || t.charCodeAt(i) === 9)) i++;
  if (i === 0) return t;
  let hasTab = false;
  for (let k = 0; k < i; k++) if (t.charCodeAt(k) === 9) { hasTab = true; break; }
  if (!hasTab) return t;
  let out = '';
  let c = col;
  for (let k = 0; k < i; k++) {
    const ch = t.charCodeAt(k);
    if (ch === 32) { out += ' '; c++; }
    else { const w = 4 - (c % 4); out += ' '.repeat(w); c += w; }
  }
  return out + t.slice(i);
}

// Column for expandLeadingTabs: marked expands a tab after `>` per
// quote level at the marker width (J(m, b.length)), so inside a quote
// the tab's column is the `> ` marker width (2) in that level's
// logical string, NOT the raw document column (which accumulates outer
// markers: `> > \t` expands to 2 spaces, not 4). Lists expand at the
// raw column, so only quotes reset it.
function tabExpandCol(stack, ln) {
  for (let k = stack.length - 1; k >= 0; k--) {
    const e = stack[k];
    if (e.kind === 'quote') return 2;
    if (e.kind === 'item') return ln.col + ln.tab;
  }
  return ln.col + ln.tab;
}

function isBlankText(t) {
  for (let k = 0; k < t.length; k++) {
    const c = t.charCodeAt(k);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

function isBlankLine(ln) {
  return isBlankText(lineRemain(ln));
}

// Match a blockquote '>' marker on the line (indent <= 3). Advances ln.
function matchQuote(ln) {
  const ind = lineIndent(ln);
  if (ind > 3) return false;
  advance(ln, ind);
  if (ln.off >= ln.s.length || ln.s.charCodeAt(ln.off) !== 62) return false;
  ln.off++; ln.col++;
  // Whitespace after `>`: marked expands the WHOLE run (spaces and
  // tabs) starting at the marker width inside the current logical
  // string (blockquoteMarkerWhitespace: J(m, b.length), b = the
  // leading spaces + `>`, so the run starts at logical column
  // ln.col + ln.tab - ln.base), then consumes exactly one space as
  // the separator (blockquoteSetextReplace2); the rest of the run is
  // content indent (pending spaces in ln.tab). The old code consumed
  // at most one space/tab, so a tab after `> ` stayed literal
  // (`> \tX` -> `<p>\tX</p>` instead of `<p>  X</p>`) and a tab
  // after a nested `>` expanded at the raw column (`> >\tX` -> 0
  // spaces instead of 2). ln.base is then the quote's content start,
  // so a nested quote's tab expands in this quote's logical string.
  if (ln.off < ln.s.length) {
    const startCol = ln.col + ln.tab - ln.base;
    let p = ln.off, col = startCol, w = 0;
    while (p < ln.s.length) {
      const c = ln.s.charCodeAt(p);
      if (c === 32) { w++; p++; col++; }
      else if (c === 9) { const t = 4 - (col % 4); w += t; p++; col += t; }
      else break;
    }
    if (p > ln.off) {
      ln.col = ln.col + ln.tab + 1;
      ln.tab = w - 1;
      ln.off = p;
    }
  }
  ln.base = ln.col;
  return true;
}

// Match a list item's content indent on the line. Advances ln.
// Returns false if the line is neither blank nor indented enough.
function matchItem(ln, e, li) {
  if (isBlankLine(ln)) return true;
  // The item's own first line: after the outer containers were
  // consumed, the remainder starts with the marker itself
  // (`> 1. > x` -> `1. > x`). Skip the marker and the spaces after
  // it, landing at the content indent — the same steps startListItem
  // took when it created the item. Without this, the item fails its
  // own marker line and the parser pops/recreates it forever.
  if (li === e.firstLine) {
    advance(ln, e.markerIndent);
    ln.off += e.markerLen;
    ln.col += e.markerLen;
    const need = e.indent - e.markerIndent - e.markerLen;
    if (need > 0) advance(ln, need);
    ln.base = ln.col;
    return true;
  }
  // An empty item that has already seen a blank line is closed: a
  // following indented line is not its content (`-\n\n  foo` -> the
  // item stays empty and `foo` is a separate paragraph; same for a
  // fence, heading or quote at that indent).
  if (e.blankPending && e.node[1].length === 0) return false;
  const ind = lineIndent(ln);
  if (ind >= e.indent) {
    advance(ln, e.indent);
    ln.base = ln.col;
    return true;
  }
  return false;
}

// Content of the previous source line (li-1) as seen inside list item
// `e` (stack index ai): outer containers stripped, then `e`'s own
// marker/indent stripped if the line matches `e`; if the line does not
// match `e` (an unindented continuation), the raw line after the outer
// containers. Returns null if an outer container fails. `matched` says
// whether the line matched `e` (false for the unindented fallback,
// whose leading whitespace was already sliced away by marked's `m`).
function prevLineContent(e, L, li, stack, ai) {
  if (li <= 0) return null;
  const nx = { s: L[li - 1].s, off: 0, col: 0, tab: 0, base: 0 };
  for (let ci = 1; ci < ai; ci++) {
    const c = stack[ci];
    if (c.kind === 'quote') { if (!matchQuote(nx)) return null; }
    else if (c.kind === 'item') { if (!matchItem(nx, c, li - 1)) return null; }
  }
  const saveOff = nx.off, saveCol = nx.col, saveTab = nx.tab;
  if (matchItem(nx, e, li - 1)) return { text: lineRemain(nx), col: nx.col + nx.tab, matched: true };
  nx.off = saveOff; nx.col = saveCol; nx.tab = saveTab;
  return { text: lineRemain(nx), col: nx.col + nx.tab, matched: false };
}

// Does an unindented line still belong to list item `e`? Marked's list
// tokenizer keeps accumulating such a line (verbatim, as item text)
// UNLESS the PREVIOUS line in the item starts a fence/heading/html/hr,
// or is indented >= 4 (indented code). The previous line is `m` in
// marked (updated each iteration), not the item's first line: after an
// HTML-start line (`<div>`) an unindented line ends the item, but
// after a nested-list line (`- ``` `) it continues.
function itemContinues(e, L, li, stack, ai) {
  const prev = prevLineContent(e, L, li, stack, ai);
  if (prev === null) return false;
  // The previous line was blank in this item's context (e.g. `>>`, a
  // markers-only line): marked's `y` flag ends the item.
  if (isBlankText(prev.text)) return false;
  const t = prev.text;
  if (prev.matched) {
    // indent of the previous line's content (tabs expanded from its
    // starting column); >= 4 means indented code, which ends the item.
    let ind = 0, col = prev.col, p = 0;
    while (p < t.length) {
      const c = t.charCodeAt(p);
      if (c === 32) { ind++; p++; col++; }
      else if (c === 9) { const w = 4 - (col % 4); ind += w; p++; col += w; }
      else break;
    }
    if (ind >= 4) return false;
  }
  if (fenceStart(t) || atxHeading(t) || htmlBlockType(t) > 0 || isHr(t)) return false;
  return true;
}

// Does this line start a block that ends a list item's accumulation?
// (Marked's list tokenizer breaks the item at a fence/heading/html/
// blockquote/bullet/hr line, even an unindented one.)
function startsBlock(t) {
  if (fenceStart(t) || atxHeading(t) || htmlBlockType(t) > 0 || isHr(t)) return true;
  if (leadingSpaces(t) <= 3 && t.slice(leadingSpaces(t)).startsWith('>')) return true;
  if (listItemStart(t)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Block-start detectors (operate on a plain string = the line's remainder).
// ---------------------------------------------------------------------------

const BLOCK_TAGS = new Set(('address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h1|h2|h3|h4|h5|h6|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul').split('|'));

function leadingSpaces(t) {
  let n = 0;
  while (n < t.length && t.charCodeAt(n) === 32) n++;
  return n;
}

// ATX heading: returns level (1-6) or 0. Text after the hashes (trimmed).
function atxHeading(t) {
  const ind = leadingSpaces(t);
  if (ind > 3) return null;
  let i = ind;
  let hashes = 0;
  while (i < t.length && t.charCodeAt(i) === 35) { hashes++; i++; }
  if (hashes === 0 || hashes > 6) return null;
  if (i >= t.length) return { level: hashes, text: '' };
  const c = t.charCodeAt(i);
  if (c !== 32 && c !== 9) return null;
  let text = t.slice(i);
  // strip trailing spaces, then a closing sequence of #'s preceded by space
  text = text.replace(/[ \t]+$/, '');
  const m = text.match(/^(.*?)[ \t]+#+$/);
  if (m) text = m[1];
  return { level: hashes, text: text.trim() };
}

// Fenced code start: returns {ch, len, lang} or null.
function fenceStart(t) {
  const ind = leadingSpaces(t);
  if (ind > 3) return null;
  let i = ind;
  const ch = t.charCodeAt(i);
  if (ch !== 96 && ch !== 126) return null;
  let len = 0;
  while (i < t.length && t.charCodeAt(i) === ch) { len++; i++; }
  if (len < 3) return null;
  const info = t.slice(i);
  if (ch === 96 && info.indexOf('`') >= 0) return null; // backtick fence: no backtick in info
  return { ch: String.fromCharCode(ch), len, lang: info.trim(), indent: ind };
}

// Thematic break: 3+ of -, _, * (with spaces/tabs between), nothing else.
function isHr(t) {
  const ind = leadingSpaces(t);
  if (ind > 3) return false;
  let i = ind;
  let ch = -1, count = 0;
  while (i < t.length) {
    const c = t.charCodeAt(i);
    if (c === 32 || c === 9) { i++; continue; }
    if (ch === -1) {
      if (c === 45 || c === 95 || c === 42) { ch = c; count = 1; i++; continue; }
      return false;
    }
    if (c === ch) { count++; i++; continue; }
    return false;
  }
  return count >= 3;
}

// Setext underline: =+ or -+ (spaces around), indent <= 3. Returns 1, 2 or 0.
function setextLevel(t) {
  const ind = leadingSpaces(t);
  if (ind > 3) return 0;
  let i = ind;
  const c = t.charCodeAt(i);
  if (c !== 61 && c !== 45) return 0;
  while (i < t.length && t.charCodeAt(i) === c) i++;
  while (i < t.length && (t.charCodeAt(i) === 32 || t.charCodeAt(i) === 9)) i++;
  if (i !== t.length) return 0;
  return c === 61 ? 1 : 2;
}

// HTML block start: returns the block type (1-7) or 0.
// Types 1-6 interrupt a paragraph; type 7 does not.
function htmlBlockType(t) {
  const ind = leadingSpaces(t);
  if (ind > 3) return 0;
  const s = t.slice(ind);
  if (s.length === 0 || s.charCodeAt(0) !== 60) return 0;
  // type 1: <script, <pre, <style, <textarea
  const m1 = s.match(/^<(script|pre|style|textarea)(?:[\s>]|$)/i);
  if (m1) return 1;
  // type 2: <!-- comment
  if (s.startsWith('<!--')) return 2;
  // type 3: <? processing instruction
  if (s.startsWith('<?')) return 3;
  // type 4: <! + letter (declaration)
  if (s.length > 2 && s.charCodeAt(1) === 33 && isAsciiLetter(s.charCodeAt(2))) return 4;
  // type 5: <![CDATA[
  if (s.startsWith('<![CDATA[')) return 5;
  // type 6: block-level tag (open or close), followed by space/tab/newline/> or end
  const m6 = s.match(/^<\/?([a-zA-Z][a-zA-Z0-9-]*)(?:[ \t\n]|\/?>|$)/);
  if (m6 && BLOCK_TAGS.has(m6[1].toLowerCase())) return 6;
  // type 7: a single complete open/close tag covering the whole line
  // (not script/pre/style/textarea). An autolink is not a tag, and extra
  // content after the tag (e.g. <a><b>) disqualifies the line.
  const tag = matchInlineTag(s, 0);
  if (tag && tag.kind === 'tag') {
    let end = tag.end;
    while (end < s.length && (s.charCodeAt(end) === 32 || s.charCodeAt(end) === 9)) end++;
    if (end === s.length) {
      const tagName = s.match(/^<\/?([a-zA-Z][a-zA-Z0-9-]*)/);
      if (tagName) {
        const nm = tagName[1].toLowerCase();
        if (nm !== 'script' && nm !== 'pre' && nm !== 'style' && nm !== 'textarea') return 7;
      }
    }
  }
  return 0;
}

// List item start: returns {ordered, start, markerLen, contentIndent, empty} or null.
// markerLen = columns of the marker + following spaces consumed (the indent
// of the item's content). contentIndent is the column where content starts.
function listItemStart(t) {
  const ind = leadingSpaces(t);
  if (ind > 3) return null;
  let i = ind;
  const c = t.charCodeAt(i);
  let ordered = false, start = 0, markerLen = 0;
  if (c === 45 || c === 42 || c === 43) { // - * +
    ordered = false;
    markerLen = 1;
    i++;
  } else if (c >= 48 && c <= 57) {
    let j = i;
    while (j < t.length && t.charCodeAt(j) >= 48 && t.charCodeAt(j) <= 57) j++;
    const digits = j - i;
    if (digits === 0 || digits > 9) return null;
    if (j >= t.length) return null;
    const d = t.charCodeAt(j);
    if (d !== 46 && d !== 41) return null; // . or )
    ordered = true;
    start = parseInt(t.slice(i, j), 10);
    markerLen = digits + 1;
    i = j + 1;
  } else return null;
  // after the marker: need 1+ spaces/tabs, or end of line (empty item)
  if (i >= t.length) {
    return { ordered, start, markerLen, contentIndent: ind + markerLen + 1, empty: true };
  }
  const sc = t.charCodeAt(i);
  if (sc !== 32 && sc !== 9) return null;
  // count the spaces/tabs after the marker (tab expansion from column ind+markerLen)
  let col = ind + markerLen;
  let k = i;
  let spaces = 0;
  while (k < t.length) {
    const cc = t.charCodeAt(k);
    if (cc === 32) { spaces++; col++; k++; }
    else if (cc === 9) { const w = 4 - (col % 4); spaces += w; col += w; k++; }
    else break;
  }
  if (k >= t.length) {
    // marker + only whitespace = empty item
    return { ordered, start, markerLen, contentIndent: ind + markerLen + 1, empty: true };
  }
  if (spaces === 0) return null;
  // 1-4 spaces: content indent is marker + spaces; 5+ spaces: content indent
  // is marker + 1 (the extra spaces are part of the content)
  let contentIndent;
  if (spaces >= 5) contentIndent = ind + markerLen + 1;
  else contentIndent = ind + markerLen + spaces;
  return { ordered, start, markerLen, contentIndent, empty: false };
}

// Indented code: line indented >= 4 (or a tab). Returns the dedented text.
function indentedCodeText(ln) {
  const ind = lineIndent(ln);
  if (ind < 4) return null;
  advance(ln, 4);
  return lineRemain(ln);
}

// Table delimiter row: returns aligns array or null.
// A delimiter cell is :?-+:? (optional colons around 1+ dashes).
function tableDelimiter(t) {
  const ind = leadingSpaces(t);
  if (ind > 3) return null;
  let s = t.slice(ind).trim();
  if (s.length === 0) return null;
  // A bare run of dashes is a setext underline, not a table delimiter:
  // a delimiter must contain a pipe or a colon (alignment marker).
  if (s.indexOf('|') < 0 && s.indexOf(':') < 0) return null;
  // strip one leading and one trailing pipe
  if (s.charCodeAt(0) === 124) s = s.slice(1);
  if (s.length > 0 && s.charCodeAt(s.length - 1) === 124) s = s.slice(0, -1);
  if (s.length === 0) return null;
  const cells = splitTableCells(s);
  if (cells.length === 0) return null;
  const aligns = [];
  for (const cell of cells) {
    const c = cell.trim();
    const m = c.match(/^(:?)-+(:?)$/);
    if (!m) return null;
    if (m[1] === ':' && m[2] === ':') aligns.push('center');
    else if (m[2] === ':') aligns.push('right');
    else if (m[1] === ':') aligns.push('left');
    else aligns.push(null);
  }
  return aligns;
}

// Split a table row line into cells on unescaped '|'. Jump between
// backslashes and pipes with a C++ regex scan instead of a per-char
// JS loop; the transformation is identical (an escaped `\|` becomes a
// literal '|', any other backslash stays).
const TABLE_CELL_RE = /[\\|]/g;
function splitTableCells(s) {
  const cells = [];
  let cur = '';
  const n = s.length;
  let start = 0;
  TABLE_CELL_RE.lastIndex = 0;
  let m;
  while ((m = TABLE_CELL_RE.exec(s)) !== null) {
    const j = m.index;
    if (j > start) cur += s.slice(start, j);
    if (s.charCodeAt(j) === 124) { // |
      cells.push(cur);
      cur = '';
      start = j + 1;
    } else if (j + 1 < n && s.charCodeAt(j + 1) === 124) { // \|
      cur += '|';
      start = j + 2;
    } else { // lone backslash
      cur += '\\';
      start = j + 1;
    }
    TABLE_CELL_RE.lastIndex = start;
  }
  if (start < n) cur += s.slice(start);
  cells.push(cur);
  // Callers already strip one outer pipe on each side, so a leading or
  // trailing empty cell here is genuine content (not an outer-pipe
  // artifact) and must be kept.
  return cells;
}

// Is this line a table body row (not blank, not a block start)?
function isTableBodyRow(t) {
  // Blank for table purposes is spaces-only (marked's body lookahead
  // is ` *\n`): a tab-only line is a row of empty cells, not a blank.
  let spacesOnly = true;
  for (let k = 0; k < t.length; k++) {
    if (t.charCodeAt(k) !== 32) { spacesOnly = false; break; }
  }
  if (spacesOnly) return false;
  if (atxHeading(t)) return false;
  if (fenceStart(t)) return false;
  if (isHr(t)) return false;
  if (htmlBlockType(t) !== 0) return false;
  const ind = leadingSpaces(t);
  if (ind >= 4) return false; // indented code
  // Tab after 0-3 spaces: indented code iff a char follows the tab
  // (marked's `code` alternative `(?: {4}| {0,3}\t)[^\n]`); a tab at
  // end of line is a row of empty cells.
  if (t.charCodeAt(ind) === 9) {
    if (ind + 1 < t.length) return false;
    return true;
  }
  if (t.slice(ind).startsWith('>')) return false; // blockquote
  const li = listItemStart(t);
  if (li && (!li.ordered || li.start === 1)) return false; // interrupting list
  return true;
}

// ---------------------------------------------------------------------------
// Main block parser.
// ---------------------------------------------------------------------------

function parseBlocks(lines, links, endsWithNL) {
  const rootNode = ['doc', []];
  const L = lines.map(makeLine);
  const stack = [{ kind: 'doc', node: rootNode, endsWithNL, totalLines: lines.length, lines: L }];
  let li = 0;
  while (li < L.length) {
    const ln = L[li];
    // Reset the line cursor: a line re-processed after an interruption
    // (paragraph end, blockquote re-entry) must match containers from
    // the start, not from a half-advanced position.
    ln.off = 0; ln.col = 0; ln.tab = 0; ln.base = 0;
    const top0 = stack[stack.length - 1];
    const hasLeaf = top0.kind === 'para' || top0.kind === 'code' || top0.kind === 'html' || top0.kind === 'table';
    const containerCount = stack.length - (hasLeaf ? 1 : 0);

    // ---- Phase 1: match open containers ----
    let failedAt = -1;
    // saves[ci] = line cursor after container ci matched (for
    // re-processing a line inside an outer item after an inner
    // container failed).
    const saves = [{ off: 0, col: 0, tab: 0, base: 0 }];
    for (let ci = 1; ci < containerCount; ci++) {
      const e = stack[ci];
      // A failed check must not consume input: the lazy-continuation
      // branch reads the line from after the LAST MATCHED container,
      // so a quote check that skipped 1-3 spaces before failing must
      // leave them in place (`> foo\n  bar` keeps the two spaces).
      const saveOff = ln.off, saveCol = ln.col, saveTab = ln.tab, saveBase = ln.base;
      if (e.kind === 'quote') {
        if (!matchQuote(ln)) { ln.off = saveOff; ln.col = saveCol; ln.tab = saveTab; ln.base = saveBase; failedAt = ci; break; }
      } else if (e.kind === 'item') {
        if (!matchItem(ln, e, li)) { ln.off = saveOff; ln.col = saveCol; ln.tab = saveTab; ln.base = saveBase; failedAt = ci; break; }
      }
      // 'list' always matches (delegates to its item)
      saves[ci] = { off: ln.off, col: ln.col, tab: ln.tab, base: ln.base };
    }

    if (failedAt >= 0) {
      // A container failed. If the innermost open block is a paragraph,
      // this line is a lazy continuation of it.
      const top = stack[stack.length - 1];
      // Unindented line inside a list item (not a paragraph: those are
      // lazy continuations, handled below): marked's list tokenizer
      // keeps accumulating it into the item (verbatim) unless the
      // previous line starts a fence/heading/html/hr, is indented
      // >= 4, or was blank, or this line starts a block. Walk from
      // the failed container outward to the first item that keeps it:
      // - if the open leaf is a fenced code block / table directly
      //   inside that item, the line is leaf content (fed verbatim;
      //   a setext underline is padded to 4 spaces, marked's `qe`);
      // - otherwise it is a new block inside that item (close above
      //   the item and re-process it there, restoring the cursor to
      //   just after the item when the item itself matched).
      // A line the item does NOT keep falls through to the lazy /
      // close handling below (e.g. after an HTML-start line, or when
      // the item starts with a fence, the line leaves the item).
      {
        const text = lineRemain(ln);
        const prevBlank = li > 0 && isBlankText(L[li - 1].s);
        let handled = false;
        if (top.kind !== 'para' && !prevBlank && !startsBlock(text)) {
          for (let ai = failedAt; ai >= 1 && !handled; ai--) {
            const anc = stack[ai];
            if (anc.kind !== 'item') continue;
            if (!itemContinues(anc, L, li, stack, ai)) continue;
            const isLeaf = (top.kind === 'code' && top.fenced) || top.kind === 'table';
            if (isLeaf && ai === containerCount - 1 && (top.kind !== 'table' || isTableBodyRow(text))) {
              let fedText = text;
              if (setextLevel(text) > 0) {
                const prev = prevLineContent(anc, L, li, stack, ai);
                if (prev && prev.text.trim() !== '') {
                  fedText = '    ' + expandLeadingTabs(text, tabExpandCol(stack, ln)).replace(/^ {0,3}/, '');
                }
              }
              if (top.kind === 'code') li = codeLine(top, fedText, ln, stack, li);
              else li = tableLine(top, fedText, stack, li);
              handled = true;
            } else if (!isLeaf || ai !== containerCount - 1) {
              closeTo(stack, ai + 1, true);
              if (ai < failedAt && saves[ai]) {
                ln.off = saves[ai].off; ln.col = saves[ai].col; ln.tab = saves[ai].tab; ln.base = saves[ai].base;
              }
              li = startBlock(ln, stack, links, L, li);
              handled = true;
            }
          }
        }
        if (handled) continue;
      }
      if (top.kind === 'para') {
        const text = lineRemain(ln);
        if (text === '' || isBlankText(ln.s)) {
          // a blank lazy line closes the paragraph AND the failed
          // containers (so `> foo\n\n> bar` is two blockquotes)
          closeTop(stack);
          closeTo(stack, failedAt, true);
          if (isBlankText(ln.s)) markBlank(stack);
        } else if (isInterruptingBlock(text) || listItemStart(text)) {
          // a line that interrupts a paragraph ends it (and the containers)
          // NOTE: after a container failure ANY list-item line ends the
          // paragraph — even an empty one, or an ordered one not starting
          // with 1, or one with a different delimiter (`1. foo\n3) baz`
          // starts a new list). The start-with-1 rule applies only when
          // no container failed (paraLine's isInterruptingBlock).
          closeTop(stack);
          closeTo(stack, failedAt, true);
          li = startBlock(ln, stack, links, L, li);
          continue;
        } else {
          // Lazy continuation line. Leading whitespace follows marked's
          // lazy-chunk model:
          // - first lazy line of a chunk: strip 4 columns if the indent
          //   is >= 4 (an indented-code line merges into the paragraph,
          //   `> foo\n     bar` -> `foo\n bar`); lesser indents are kept
          //   (`> foo\n  bar` -> `foo\n  bar`).
          // - later lazy lines: keep the whitespace, except a setext
          //   underline directly inside a quote is padded to 4 spaces
          //   (blockquoteSetextReplace: `> foo\nbar\n===` keeps the
          //   line as paragraph text `    ===`, so it cannot become a
          //   heading; in a list item the same line stays `===`).
          let lineText = text;
          if (top.lastWasLazy) {
            const parent = stack[stack.length - 2];
            if (parent && parent.kind === 'quote' && setextLevel(text) > 0) {
              lineText = '    ' + text.slice(leadingSpaces(text));
            } else if (stack.some((x) => x.kind === 'item') && lineIndent(ln) >= 4) {
              // Later lazy lines of a list item's paragraph also lose
              // 4 columns when indented >= 4 (doc-22: `>     State`
              // inside `19.` renders with no leading spaces).
              advance(ln, 4);
              lineText = lineRemain(ln);
            }
          } else if (lineIndent(ln) >= 4) {
            advance(ln, 4);
            lineText = lineRemain(ln);
          }
          // A leading tab on a lazy line inside a LIST ITEM expands to
          // spaces at the raw column where the remainder starts
          // (doc-40). A lazy line under a plain top-level blockquote
          // keeps the tab literal, so do not expand there.
          if (stack.some((x) => x.kind === 'item')) lineText = expandLeadingTabs(lineText, ln.col + ln.tab);
          top.lines.push(lineText);
          top.lastWasLazy = true;
        }
        li++;
        continue;
      }
      // not a lazy continuation: close down to the failed container
      closeTo(stack, failedAt, true);
      li = startBlock(ln, stack, links, L, li);
      continue;
    }

    // ---- Phase 2: containers matched; handle the line ----
    const text = lineRemain(ln);
    const top = stack[stack.length - 1];

    if (top.kind === 'code') {
      li = codeLine(top, text, ln, stack, li);
      continue;
    }
    if (top.kind === 'html') {
      li = htmlLine(top, text, stack, li);
      continue;
    }
    if (top.kind === 'table') {
      li = tableLine(top, text, stack, li);
      continue;
    }
    if (top.kind === 'para') {
      li = paraLine(top, text, stack, links, L, li);
      continue;
    }

    // no leaf open
    if (isBlankText(text)) {
      if (isBlankText(ln.s)) markBlank(stack);
      li++;
      continue;
    }
    li = startBlock(ln, stack, links, L, li);
  }
  // finalize
  while (stack.length > 1) closeTop(stack);
  return rootNode;
}

function isLeafKind(k) {
  return k === 'para' || k === 'code' || k === 'html' || k === 'table';
}

// Marked's list tokenizer trimEnds the LAST item's text (and the
// list's raw), so a trailing-space run on the last item's last
// paragraph line is dropped — but a non-last item keeps it, and a
// fenced code block keeps its trailing spaces. Recurse into a
// trailing nested list/quote to reach the last paragraph.
function trimListLastPara(listNode) {
  const items = listNode[4];
  if (!items || items.length === 0) return;
  let children = items[items.length - 1][1];
  while (children && children.length > 0) {
    const last = children[children.length - 1];
    if (last[0] === 'p') {
      last[1] = last[1].replace(/[ \t]+$/, '');
      return;
    }
    if (last[0] === 'list') {
      const sub = last[4];
      if (!sub || sub.length === 0) return;
      children = sub[sub.length - 1][1];
      continue;
    }
    if (last[0] === 'q') {
      children = last[1];
      continue;
    }
    return; // code, html, h, hr, table: nothing to trim
  }
}

// Close the top block of the stack, finalizing it into its parent.
// An item is already present in its list's items array, so it is only
// popped (not re-pushed). Every other kind is pushed into its parent.
function closeTop(stack, failed) {
  const e = stack.pop();
  const parent = stack[stack.length - 1];
  if (!parent) return;
  if (e.kind === 'para') {
    e.node[1] = e.lines.join('\n');
    pushChild(parent, e.node);
    return;
  }
  if (e.kind === 'code') {
    finalizeCode(e);
    pushChild(parent, e.node);
    return;
  }
  if (e.kind === 'html') {
    if (failed) e.endedByContainerFail = true;
    const rootEntry = stack[0];
    const text = e.lines.join('\n');
    // Trailing newline (marked's html regex + ge(): the match keeps one
    // trailing newline, but a blank line after the block removes it).
    // Trailing newline by the logical-string rule (see
    // htmlTrailingNL): the block's text keeps `\n` iff its last line
    // is followed by exactly one newline in the logical string it is
    // lexed from. A block ended by container failure has none. (The
    // old rule used the document's next line and endsWithNL, which is
    // wrong inside containers: a last list item's text is trimEnd'd,
    // so a `<div>` ending an item at EOF has no `\n`.)
    const hasNL = !e.endedByContainerFail && htmlTrailingNL(stack, rootEntry.lines, e.lastLine, e.type);
    // Marked's ge(): an html block's text keeps at most one trailing
    // newline — two or more trailing blank lines are dropped entirely
    // (`<style>\n\n` renders as `<style>`, not `<style>\n\n`).
    let htmlText = hasNL ? text + '\n' : text;
    const parts = htmlText.split('\n');
    let t = parts.length - 1;
    while (t >= 0 && isBlankText(parts[t])) t--;
    if (parts.length - 1 - t >= 2) htmlText = parts.slice(0, t + 1).join('\n');
    e.node[1] = htmlText;
    pushChild(parent, e.node);
    return;
  }
  if (e.kind === 'table') {
    pushChild(parent, e.node);
    return;
  }
  if (e.kind === 'item') {
    return; // already in its list's items array
  }
  if (e.kind === 'list') {
    trimListLastPara(e.node);
  }
  pushChild(parent, e.node);
}

function pushChild(parent, node) {
  // Looseness is decided at block CREATION time (startBlock), never
  // here: a nested list closing after a blank line is not a new block
  // in its parent item (cm-307), so a close-push must not mark loose.
  parent.node[1].push(node);
}

// Close blocks down to (but not including) stack index `idx`.
// `failed` marks the unwind as a container failure (used by HTML
// blocks: a block ended by container failure has no trailing newline).
function closeTo(stack, idx, failed) {
  while (stack.length > idx) closeTop(stack, failed);
}

// Mark a blank line on every open item (for loose detection). A blank
// line inside a nested block still separates the outer item's blocks,
// so the innermost item alone is not enough (`* foo\n  * bar\n\n  baz`
// is loose for the OUTER list). Callers only invoke this for a RAW
// blank line: a line that is blank only after container markers
// (`  >`) is not a blank line and must not mark anything.
function markBlank(stack) {
  for (let k = 0; k < stack.length; k++) {
    if (stack[k].kind === 'item') stack[k].blankPending = true;
  }
}

function finalizeCode(e) {
  const lines = e.lines;
  if (e.fenced) {
    // Fenced code drops exactly ONE trailing empty line: N trailing
    // blank lines leave N-1 in the output (`foo\n\n\n``` ` -> `foo\n\n`).
    // A trailing line of spaces is content, never dropped.
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  } else {
    // Indented code drops ALL trailing blank lines (even spaces-only).
    while (lines.length > 0 && isBlankText(lines[lines.length - 1])) lines.pop();
  }
  let text = lines.join('\n');
  // A remaining blank line is still one newline of content: join([''])
  // is '' but the line contributes a '\n' (2 blank lines in a fence
  // render as one '\n', not empty).
  if (lines.length > 0) text += '\n';
  e.node[2] = text;
}

// ---- leaf line handlers (return the next line index) ----

function codeLine(e, text, ln, stack, li) {
  if (e.fenced) {
    // Inside a list/blockquote, marked expands the leading-whitespace
    // tabs of every line to spaces at their raw columns before any
    // fence processing (list: Z=f.replace(/^[ \t]+/, J); blockquote:
    // whitespace after `>` expanded with J at the marker width), so a
    // tab that survives container stripping becomes spaces here.
    // A closing fence line is matched on the expanded text too.
    let t = text;
    if (stack.some((x) => x.kind === 'quote' || x.kind === 'item')) t = expandLeadingTabs(t, tabExpandCol(stack, ln));
    const ind = leadingSpaces(t);
    if (ind <= 3) {
      const s = t.slice(ind);
      let k = 0;
      while (k < s.length && s.charCodeAt(k) === e.fenceCh.charCodeAt(0)) k++;
      if (k >= e.fenceLen) {
        // closing fence: only spaces/tabs may follow
        let ok = true;
        for (let m = k; m < s.length; m++) {
          const c = s.charCodeAt(m);
          if (c !== 32 && c !== 9) { ok = false; break; }
        }
        if (ok) {
          closeTop(stack);
          return li + 1;
        }
      }
    }
    // content: marked's fence compensation (Dt) drops up to `indent`
    // leading whitespace CHARACTERS per line, and only for backtick
    // fences (its regex /^(\s+)(?:```)/ never matches a tilde fence,
    // so tilde content is kept verbatim). A tab counts as ONE char:
    // `\tindented` under a 3-space fence becomes `indented`, while a
    // column-based advance left a 1-space partial tab; conversely
    // `  \tindented` under a 2-space fence keeps the tab. Blank lines
    // keep the remainder — even for blank lines (` ```\n\n \n``` `
    // keeps the ` ` line as ` `).
    if (e.fenceCh === '`') {
      let n = 0;
      while (n < t.length && n < e.indent && (t.charCodeAt(n) === 32 || t.charCodeAt(n) === 9)) n++;
      e.lines.push(t.slice(n));
    } else {
      e.lines.push(t);
    }
    return li + 1;
  }
  // indented code: the indent is measured on the remainder (after the
  // container markers), not on the raw line
  if (isBlankText(text)) {
    // blank line: keep the remainder after the code indent
    advance(ln, 4);
    e.lines.push(lineRemain(ln));
    return li + 1;
  }
  const ind = lineIndent(ln);
  if (ind >= 4) {
    advance(ln, 4);
    e.lines.push(lineRemain(ln));
    return li + 1;
  }
  // code block ends; re-process this line
  closeTop(stack);
  return li;
}

function htmlLine(e, text, stack, li) {
  if ((e.type === 6 || e.type === 7) && isBlankText(text)) {
    // A blank line ends the block but is not a content line, so
    // e.lastLine stays at the last content line: closeTop's trailing-
    // newline rule reads the line after the block's last line.
    closeTop(stack);
    return li;
  }
  e.lastLine = li;
  if (e.type === 6 || e.type === 7) {
    e.lines.push(text);
    return li + 1;
  }
  // types 1-5: end at the matching close marker on this line
  e.lines.push(text);
  if (e.endTest && e.endTest(text)) closeTop(stack);
  return li + 1;
}

function tableLine(e, text, stack, li) {
  if (!isTableBodyRow(text)) {
    closeTop(stack);
    return li; // re-process
  }
  const cells = splitTableCells(text.trim().replace(/^\|/, '').replace(/\|$/, ''));
  // pad / truncate to header width
  const row = [];
  for (let k = 0; k < e.node[2].length; k++) row.push(cells[k] !== undefined ? cells[k].trim() : '');
  e.node[3].push(row);
  return li + 1;
}

// Paragraph line handler.
function paraLine(e, text, stack, links, L, li) {
  // Blankness: the remainder is empty (e.g. a bare `>` line), or the raw
  // line is blank. A `>  ` line is NOT blank: its remainder is a single
  // space of paragraph content.
  const ln = L[li];
  if (lineRemain(ln) === '' || isBlankText(ln.s)) {
    // A blank line (raw, or blank only after its container markers)
    // ends the paragraph. If the paragraph's DIRECT parent is a list
    // item, the blank line separates that item's blocks (cm-259: the
    // `>>` line between `one` and `two` makes the list loose). Only a
    // RAW blank line also marks all open items (cm-320: a markers-only
    // line inside a quote ends the quote's paragraph, not the item's).
    const paraParent = stack[stack.length - 2];
    if (paraParent && paraParent.kind === 'item') paraParent.blankPending = true;
    closeTop(stack);
    // Only a RAW blank line marks the items: a line blank only after
    // its container markers (`  >`) ends the paragraph but is not a
    // blank line for looseness (cm-320 stays tight).
    if (isBlankText(ln.s)) markBlank(stack);
    return li + 1;
  }
  // setext underline? The heading text is the paragraph content trimmed.
  const sl = setextLevel(text);
  if (sl > 0) {
    const parent = stack[stack.length - 2];
    const node = ['h', sl, e.lines.join('\n').replace(/^[ \t]+/, '').replace(/[ \t]+$/, '')];
    stack.pop();
    pushChild(parent, node);
    return li + 1;
  }
  // table delimiter (paragraph has exactly one line)? A delimiter
  // needs a pipe or a colon; without either it cannot be one.
  if (e.lines.length === 1 && (text.indexOf('|') !== -1 || text.indexOf(':') !== -1)) {
    const aligns = tableDelimiter(text);
    if (aligns) {
      const header = splitTableCells(e.lines[0].trim().replace(/^\|/, '').replace(/\|$/, ''));
      if (header.length === aligns.length) {
        const parent = stack[stack.length - 2];
        const node = ['table', aligns, header.map((c) => c.trim()), []];
        stack.pop();
        stack.push({ kind: 'table', node });
        return li + 1;
      }
    }
  }
  // table starting at this line (header + delimiter on next line)?
  if (peekTable(L, li, stack)) {
    closeTop(stack);
    return li; // re-process: startBlock will see the table
  }
  // interrupting block? Inside a list item, marked lexes the item
  // text with state.top=false, so the paragraph is a series of `text`
  // tokens (one line each) and ANY list item start interrupts it — a
  // non-1 ordered list included. At top level, or inside a blockquote
  // (which resets state.top=true), only a bullet or a `1.`-ordered list
  // interrupts (the paragraph regex's list lookahead is `1[.)]`).
  const paraParent = stack[stack.length - 2];
  if (isInterruptingBlock(text, paraParent && paraParent.kind === 'item')) {
    closeTop(stack);
    return li; // re-process
  }
  // A leading tab in a paragraph line under a quote/item is expanded to
  // spaces at the container column (doc-17/40: `> \tindented` renders as
  // two spaces, not a literal tab), same as fenced-code lines.
  if (stack.some((x) => x.kind === 'quote' || x.kind === 'item')) text = expandLeadingTabs(text, tabExpandCol(stack, ln));
  // Inside a list item, marked lexes the item text with the one-line
  // `text` tokenizer: a continuation line indented >= 4 is matched by
  // the indented-code tokenizer, but since the previous token is text
  // it is MERGED back into the paragraph with the 4-space indented-code
  // dedent applied (doc-03/10/26: the line loses 4 columns and stays
  // in the paragraph). The indent is measured AFTER tab expansion
  // (doc-36: ` \t` expands to 5 columns, so 4 are stripped, leaving
  // 1 space). Direct parent only: a paragraph inside a blockquote
  // inside an item is lexed with state.top=true (no strip). And once
  // the item has a direct-child nested list before this paragraph,
  // marked keeps the full indent (doc-28: 5 spaces stay 5) — the
  // strip applies only while the item has seen no nested list.
  // The lazy path (phase 1) already strips 4 for items; this is the
  // matched path (phase 2).
  if (paraParent && paraParent.kind === 'item' && !paraParent.sawList && leadingSpaces(text) >= 4) text = text.slice(4);
  e.lines.push(text);
  e.lastWasLazy = false;
  return li + 1;
}

// Does this line start a block that interrupts a paragraph?
// `inItem`: the paragraph's direct parent is a list item, so any list
// item start interrupts (see paraLine); otherwise only a bullet or a
// `1.`-ordered list does.
function isInterruptingBlock(t, inItem) {
  if (atxHeading(t)) return true;
  if (fenceStart(t)) return true;
  if (isHr(t)) return true;
  const hb = htmlBlockType(t);
  if (hb >= 1 && hb <= 6) return true;
  if (leadingSpaces(t) <= 3 && t.slice(leadingSpaces(t)).startsWith('>')) return true;
  const li = listItemStart(t);
  if (li && !li.empty && (!li.ordered || li.start === 1 || inItem)) return true;
  return false;
}

// Peek: does lines[li] (header) + lines[li+1] (delimiter) form a table
// in the current container context? Uses copies so nothing is mutated.
function peekTable(L, li, stack) {
  if (li + 1 >= L.length) return false;
  // A table delimiter must contain a pipe or a colon. Container
  // matching only strips a prefix, so a raw next line holding neither
  // cannot become a delimiter — skip the container matching, the
  // slice/trim and the cell split entirely for ordinary prose lines.
  const rawNext = L[li + 1].s;
  if (rawNext.indexOf('|') === -1 && rawNext.indexOf(':') === -1) return false;
  const headerText = lineRemain(L[li]);
  if (isBlankText(headerText)) return false;
  // copy the next line and run container matching on it
  const nx = { s: L[li + 1].s, off: 0, col: 0, tab: 0, base: 0 };
  const top0 = stack[stack.length - 1];
  const hasLeaf = isLeafKind(top0.kind);
  const containerCount = stack.length - (hasLeaf ? 1 : 0);
  for (let ci = 1; ci < containerCount; ci++) {
    const e = stack[ci];
    if (e.kind === 'quote') {
      if (!matchQuote(nx)) return false;
    } else if (e.kind === 'item') {
      if (!matchItem(nx, e, li + 1)) return false;
    }
  }
  const delimText = lineRemain(nx);
  const aligns = tableDelimiter(delimText);
  if (!aligns) return false;
  const header = splitTableCells(headerText.trim().replace(/^\|/, '').replace(/\|$/, ''));
  return header.length === aligns.length;
}

// Match the open containers (quote/item) on document line `idx` using
// a copy, so nothing is mutated. Returns the remainder text after the
// containers, or null if a container fails. (Same pattern as
// peekTable, factored out for the html trailing-newline lookahead.)
function peekContainers(L, idx, stack) {
  const nx = { s: L[idx].s, off: 0, col: 0, tab: 0, base: 0 };
  const top0 = stack[stack.length - 1];
  const hasLeaf = isLeafKind(top0.kind);
  const containerCount = stack.length - (hasLeaf ? 1 : 0);
  for (let ci = 1; ci < containerCount; ci++) {
    const e = stack[ci];
    if (e.kind === 'quote') {
      if (!matchQuote(nx)) return null;
    } else if (e.kind === 'item') {
      if (!matchItem(nx, e, idx)) return null;
    }
  }
  return lineRemain(nx);
}

// Match only the quote containers on document line `idx` (a copy, so
// nothing is mutated). Returns the remainder after the quotes, or null
// if a quote fails. Used to test whether a line is a blank line in
// the quote content: a blank line in that string is accumulated into
// any enclosing item text regardless of the item indent (marked's
// list loop adds any blank line to the item text). Item containers
// are stripped first (like peekContainers): matchQuote sees the
// relative indent, so a blank `>` line at 6 spaces inside an item
// with content indent 5 matches (1 space before `>`) instead of
// failing (6 > 3) and wrongly keeping a trailing `\n`.
function peekQuotes(L, idx, stack) {
  const nx = { s: L[idx].s, off: 0, col: 0, tab: 0, base: 0 };
  for (let ci = 1; ci < stack.length; ci++) {
    const e = stack[ci];
    if (e.kind === 'quote') { if (!matchQuote(nx)) return null; }
    else if (e.kind === 'item') { if (!matchItem(nx, e, idx)) return null; }
  }
  return lineRemain(nx);
}

// Does document line `idx` start a new item of the innermost open
// list in `stack`? Matches the containers outside that list, then
// checks the marker key (same computation as startListItem) at exactly
// the current item's marker indent (a nested item 1-3 spaces deeper
// must not count).
function startsSameListItem(L, idx, stack) {
  let listIdx = -1, listKey = null;
  for (let k = stack.length - 1; k >= 0; k--) {
    if (stack[k].kind === 'list') { listIdx = k; listKey = stack[k].markerKey; break; }
  }
  if (listIdx < 0 || listIdx + 1 >= stack.length) return false;
  const item = stack[listIdx + 1];
  if (item.kind !== 'item') return false;
  const nx = { s: L[idx].s, off: 0, col: 0, tab: 0, base: 0 };
  for (let ci = 1; ci <= listIdx; ci++) {
    const e = stack[ci];
    if (e.kind === 'quote') { if (!matchQuote(nx)) return false; }
    else if (e.kind === 'item') { if (!matchItem(nx, e, idx)) return false; }
  }
  const text = lineRemain(nx);
  const li0 = listItemStart(text);
  if (!li0) return false;
  if (leadingSpaces(text) !== item.markerIndent) return false;
  const ind0 = leadingSpaces(text);
  const key0 = li0.ordered
    ? 'ord' + text.slice(ind0 + String(li0.start).length, ind0 + String(li0.start).length + 1)
    : 'bul' + text[ind0];
  return key0 === listKey;
}

// Trailing newline for an HTML block of `type` whose last line is
// document line `li`, in container context `stack`. Marked's rule
// (its html regex consumes the line plus the following newlines, then
// `ge` keeps exactly one trailing `\n` iff the raw ends with a single
// newline): the block's text keeps `\n` iff, in the logical string it
// is lexed from (document / item text / quote content), its last line
// is followed by exactly one newline — a non-blank next line in the
// string, a blank next line that is the string's last line, or (top
// level only) the document ending with a newline. A blank line
// followed by more content in the same string gives `\n\n` and `ge`
// strips it; a last list item's text is trimEnd'd, so it never ends
// with `\n` (doc-30: `>    *  <!-- note --> ... may you -` inside a
// last item renders with no `\n`). One type split: for types 1-5 the
// raw's `\n*` after the end marker stops at a space, so a
// whitespace-only next line keeps `\n`; for types 6/7 the terminator
// `(?:\n[ \t]*)+\n` consumes a whitespace-only line's newline too,
// so it counts as a blank (doc-03/doc-18: `<div>...</p>` followed by
// a tab-only line has no `\n`).
function htmlTrailingNL(stack, L, li, type) {
  const is67 = type === 6 || type === 7;
  const inItem = stack.some((x) => x.kind === 'item');
  const inQuote = stack.some((x) => x.kind === 'quote');
  if (!inItem && !inQuote) {
    const next = li + 1 < L.length ? L[li + 1].s : null;
    const nextEmpty = next !== null && (next === '' || (is67 && isBlankText(next)));
    return !nextEmpty && (li + 1 < L.length || stack[0].endsWithNL);
  }
  // Inside containers the logical string ends at the html line unless
  // a following line belongs to it.
  if (li + 1 >= L.length) return false;
  // A blank line in the logical string (after the quote markers) is
  // accumulated into any enclosing item text; a truly empty line
  // outside a quote is not in the quote content at all. For types 1-5
  // a whitespace-only remainder keeps `\n` outright (see above).
  const qRem = peekQuotes(L, li + 1, stack);
  if (qRem !== null && isBlankText(qRem)) {
    if (!is67 && qRem !== '') return true;
    return htmlAfterBlankNL(stack, L, li);
  }
  // Non-blank next line: in the string iff it matches all open
  // containers. A lazy line never joins after an html line (marked's
  // list loop breaks on M.test(m) for the html line), and a
  // block-start line at the item's content indent joins (marked's
  // break regexes are built with R-1 by the D memoizer, so they only
  // fire below the content indent).
  return peekContainers(L, li + 1, stack) !== null;
}

// The line after an html block's last line is a blank line in the
// logical string. Trailing `\n` iff that blank is the string's last
// line: a second blank, or more content in the same item / quote
// after it, makes the raw end with `\n\n` (stripped by `ge`). A new
// item of the same list after the blank ends this item's text at the
// blank (loose list): the item is non-last, so it keeps `\n`.
function htmlAfterBlankNL(stack, L, li) {
  const inItem = stack.some((x) => x.kind === 'item');
  if (li + 2 >= L.length) return !inItem; // quote keeps it; a last item is trimEnd'd
  const qRem2 = peekQuotes(L, li + 2, stack);
  if (qRem2 !== null && isBlankText(qRem2)) return false; // second blank -> \n\n
  // A new item of the same list after the blank ends this item's text
  // at the blank (loose list): the item is non-last, so it keeps `\n`.
  if (inItem && startsSameListItem(L, li + 2, stack)) return true;
  // More content in the same item/quote after the blank -> `\n\n`.
  // A line outside the string ends the string after the blank:
  // quote keeps `\n`, a list item is last (trimEnd'd) and does not.
  if (peekContainers(L, li + 2, stack) !== null) return false;
  return !inItem;
}

// Start a new block at the current line. Returns the next line index.
function startBlock(ln, stack, links, L, li) {
  const text = lineRemain(ln);
  // A blank line starts no block (reached after a container closed).
  if (isBlankText(text)) {
    if (isBlankText(ln.s)) markBlank(stack);
    return li + 1;
  }
  // If a list is open and this line is a new item of it, the list-item
  // reading wins — unless the line is a thematic break (`* * *` is an
  // <hr>, not a list item). Otherwise the open list ends here.
  const parent0 = stack[stack.length - 1];
  if (parent0.kind === 'list') {
    const li0 = listItemStart(text);
    let key0 = null;
    if (li0) {
      const ind0 = leadingSpaces(text);
      key0 = li0.ordered
        ? 'ord' + text.slice(ind0 + String(li0.start).length, ind0 + String(li0.start).length + 1)
        : 'bul' + text[ind0];
    }
    if (li0 && key0 === parent0.markerKey && !isHr(text)) {
      return startListItem(ln, stack, links, L, li, li0);
    }
    closeTop(stack);
  }
  const parent = stack[stack.length - 1];
  // Link reference definition (consumed, creates no block, so it must
  // not consume a pending blank line: `- a\n\n  [f]: /u\n- b` is a
  // loose list). Runs before the blank check below; a def line cannot
  // match any block start, and parseDefText rejects indent > 3, so an
  // indented def is still indented code. Cheap `[` guard: tryParseDef
  // peeks up to 10 lines, so only call it when the line can be a def.
  let sp = 0;
  while (sp < 3 && text.charCodeAt(sp) === 32) sp++;
  if (text.charCodeAt(sp) === 91) {
    const def = tryParseDef(L, li, stack, links);
    if (def) {
      return li + def.consumed;
    }
  }
  // A blank line between two blocks inside one list item makes it loose.
  // Only a block CREATED here can mark loose (a nested list closing
  // after the blank is not a new block in its parent item, cm-307).
  // The blank is consumed by the first block created after it, so clear
  // the pending flag on EVERY open item: otherwise the same blank line
  // would wrongly loosen an outer list later (cm-319: the blank
  // separates `b`/`c` inside the inner item, not `a`/`d` of the outer
  // list). A blank before the item's FIRST block does not count.
  if (parent.kind === 'item' && parent.blankPending && parent.node[1].length > 0) {
    parent.listNode[3] = true;
  }
  for (let k = 0; k < stack.length; k++) {
    if (stack[k].kind === 'item') stack[k].blankPending = false;
  }

  // ATX heading
  const atx = atxHeading(text);
  if (atx) {
    pushChild(parent, ['h', atx.level, atx.text]);
    return li + 1;
  }
  // fenced code
  const fence = fenceStart(text);
  if (fence) {
    const node = ['code', fence.lang, ''];
    const e = { kind: 'code', node, fenced: true, fenceCh: fence.ch, fenceLen: fence.len, indent: fence.indent, lines: [] };
    stack.push(e);
    return li + 1;
  }
  // HTML block
  const hb = htmlBlockType(text);
  if (hb > 0) {
    const node = ['html', ''];
    const e = { kind: 'html', node, type: hb, lines: [text], lastLine: li, endTest: htmlEndTest(hb, text) };
    if (hb <= 5 && e.endTest && e.endTest(text)) {
      // ends on the first line: trailing newline by the logical-string
      // rule (see htmlTrailingNL) — a last list item's text is
      // trimEnd'd, so an html block ending an item has no `\n`.
      pushChild(parent, node);
      node[1] = htmlTrailingNL(stack, L, li, hb) ? text + '\n' : text;
      return li + 1;
    }
    stack.push(e);
    return li + 1;
  }
  // thematic break
  if (isHr(text)) {
    pushChild(parent, ['hr']);
    return li + 1;
  }
  // blockquote
  if (leadingSpaces(text) <= 3 && text.slice(leadingSpaces(text)).startsWith('>')) {
    const node = ['q', []];
    stack.push({ kind: 'quote', node });
    // re-process this line inside the quote
    return li;
  }
  // list item
  const liStart = listItemStart(text);
  if (liStart) {
    return startListItem(ln, stack, links, L, li, liStart);
  }
  // indented code (indent measured on the remainder, after containers)
  const ind = lineIndent(ln);
  if (ind >= 4) {
    advance(ln, 4);
    const node = ['code', null, ''];
    const e = { kind: 'code', node, fenced: false, lines: [lineRemain(ln)] };
    stack.push(e);
    return li + 1;
  }
  // table (header + delimiter)
  if (peekTable(L, li, stack)) {
    const headerText = text;
    const aligns = tableDelimiter(lineRemain(copyLineForPeek(L, li + 1, stack)));
    const header = splitTableCells(headerText.trim().replace(/^\|/, '').replace(/\|$/, ''));
    const node = ['table', aligns, header.map((c) => c.trim()), []];
    stack.push({ kind: 'table', node });
    return li + 2; // consume header + delimiter
  }
  // paragraph (first line keeps its leading spaces; a setext heading
  // trims them when the paragraph is converted). Hard paragraph: the
  // parent item already has a nested list/quote child, so marked's
  // nested lexing reset state.top and this is a paragraph token (not a
  // text token) — it renders with <p> even in a tight list.
  const hard = parent.kind === 'item' && parent.node[1].some((ch) => ch[0] === 'list' || ch[0] === 'q');
  const node = hard ? ['p', '', true] : ['p', ''];
  const e = { kind: 'para', node, lines: [text], lastWasLazy: false };
  stack.push(e);
  return li + 1;
}

function copyLineForPeek(L, idx, stack) {
  const nx = { s: L[idx].s, off: 0, col: 0, tab: 0, base: 0 };
  const top0 = stack[stack.length - 1];
  const hasLeaf = isLeafKind(top0.kind);
  const containerCount = stack.length - (hasLeaf ? 1 : 0);
  for (let ci = 1; ci < containerCount; ci++) {
    const e = stack[ci];
    if (e.kind === 'quote') { if (!matchQuote(nx)) break; }
    else if (e.kind === 'item') { if (!matchItem(nx, e, idx)) break; }
  }
  return nx;
}

// End-test for HTML block types 1-5: a function on a line's text.
function htmlEndTest(type, firstLine) {
  if (type === 1) {
    const m = firstLine.match(/<(script|pre|style|textarea)(?:[\s>]|$)/i);
    const tag = m ? m[1].toLowerCase() : 'script';
    const re = new RegExp('</' + tag + '(?:[\\s>]|$)', 'i');
    return (t) => re.test(t);
  }
  if (type === 2) return (t) => t.indexOf('-->') >= 0;
  if (type === 3) return (t) => t.indexOf('?>') >= 0;
  if (type === 4) return (t) => t.indexOf('>') >= 0;
  if (type === 5) return (t) => t.indexOf(']]>') >= 0;
  return null;
}

// Start (or continue) a list at the current line.
// `liStart` describes the item marker. On return the line's remainder
// (the item content) has been dispatched as a new block inside the item.
function startListItem(ln, stack, links, L, li, liStart) {
  const text = lineRemain(ln);
  const parent = stack[stack.length - 1];
  const ind = leadingSpaces(text);
  const markerKey = liStart.ordered
    ? 'ord' + text.slice(ind + String(liStart.start).length, ind + String(liStart.start).length + 1)
    : 'bul' + text[ind];
  // Reuse an open list of the same kind (same bullet char / ordered delim).
  let listEntry = null;
  if (parent.kind === 'list' && parent.markerKey === markerKey) listEntry = parent;
  if (!listEntry) {
    const node = ['list', liStart.ordered, liStart.start, false, []];
    listEntry = { kind: 'list', node, ordered: liStart.ordered, markerKey, currentItem: null };
    // A list directly inside an item disables the 4-column paragraph
    // continuation strip for that item's later paragraphs (marked's
    // list tokenizer lexes the item text differently once a nested
    // list has been seen: doc-28 keeps 5 spaces, while the same
    // paragraph without a preceding nested list strips to 1).
    if (parent.kind === 'item') parent.sawList = true;
    stack.push(listEntry);
  }
  // Close the previous item (a blank line before this item makes it loose).
  // The previous item is usually already closed by the failed-container
  // path that led here; closeTop must only run when the item is still
  // the stack top, or it pops the LIST itself (the cm-295 bug: the
  // list vanished and the next item started a brand-new list).
  const prevItem = listEntry.currentItem;
  if (prevItem) {
    if (prevItem.blankPending) listEntry.node[3] = true;
    prevItem.blankPending = false;
    if (stack[stack.length - 1] === prevItem) closeTop(stack);
  }
  // Create the new item.
  const itemNode = ['item', []];
  const item = { kind: 'item', node: itemNode, indent: liStart.contentIndent, blankPending: false, firstLine: li, markerLen: liStart.markerLen, markerIndent: ind, listNode: listEntry.node };
  listEntry.node[4].push(itemNode);
  listEntry.currentItem = item;
  stack.push(item);
  // Advance the line past the indent, the marker, and the spaces after it.
  advance(ln, ind);
  ln.off += liStart.markerLen;
  ln.col += liStart.markerLen;
  const need = liStart.contentIndent - ind - liStart.markerLen;
  if (need > 0) advance(ln, need);
  // The item's content is a fresh logical string (see matchItem).
  ln.base = ln.col;
  // Task checkbox: - [ ] / - [x] (followed by whitespace + content).
  // Marked's listIsTask requires a non-space after the whitespace, so
  // `[]` at end-of-line and a bare `[ ]` are NOT tasks.
  const rest = lineRemain(ln);
  const task = rest.match(/^\[([ xX])\]([ \t]+)(?=\S)/);
  if (task) {
    itemNode.task = task[1] !== ' ';
    ln.off += 3;
    ln.col += 3;
    advance(ln, 100);
    // Force a paragraph with the remainder: marked strips the checkbox
    // post-hoc from the item's first text/paragraph token, so the first
    // block is a paragraph even when the remainder starts with `<!--`
    // or `<div>` (startBlock would make it an html block and drop the
    // checkbox, since renderListItem only emits it before a 'p' child).
    // `hard` is false: this is the item's first block, so no nested
    // list/quote exists yet. Same blankPending clearing as startBlock.
    for (let k = 0; k < stack.length; k++) {
      if (stack[k].kind === 'item') stack[k].blankPending = false;
    }
    const after = lineRemain(ln);
    const node = ['p', ''];
    const e = { kind: 'para', node, lines: [after], lastWasLazy: false };
    stack.push(e);
    return li + 1;
  }
  if (liStart.empty) return li + 1;
  return startBlock(ln, stack, links, L, li);
}

// ---------------------------------------------------------------------------
// Link reference definitions: [label]: dest "title" (dest/title may be on
// following lines). First definition wins. Returns {consumed} or null.
// ---------------------------------------------------------------------------

function tryParseDef(L, li, stack, links) {
  const texts = [];
  for (let k = 0; k < 10 && li + k < L.length; k++) {
    let t;
    if (k === 0) t = lineRemain(L[li]);
    else {
      t = peekLineText(L, li + k, stack);
      if (t === null) break;
    }
    texts.push(t);
  }
  const src = texts.join('\n');
  const parsed = parseDefText(src);
  if (!parsed) return null;
  const key = normLabel(parsed.label);
  if (!links.has(key)) links.set(key, { href: parsed.href, title: parsed.title });
  return { consumed: parsed.consumed };
}

function peekLineText(L, idx, stack) {
  const nx = { s: L[idx].s, off: 0, col: 0, tab: 0, base: 0 };
  const top0 = stack[stack.length - 1];
  const hasLeaf = isLeafKind(top0.kind);
  const containerCount = stack.length - (hasLeaf ? 1 : 0);
  for (let ci = 1; ci < containerCount; ci++) {
    const e = stack[ci];
    if (e.kind === 'quote') { if (!matchQuote(nx)) return null; }
    else if (e.kind === 'item') { if (!matchItem(nx, e, idx)) return null; }
  }
  return lineRemain(nx);
}

function parseDefText(src) {
  const n = src.length;
  let i = 0;
  let ind = 0;
  while (ind < n && src.charCodeAt(ind) === 32) ind++;
  if (ind > 3) return null;
  i = ind;
  if (i >= n || src.charCodeAt(i) !== 91) return null; // [
  i++;
  let label = '';
  let hasNonSpace = false;
  while (i < n) {
    const c = src.charCodeAt(i);
    // Keep the label RAW (backslash included): normLabel unescapes it
    // once, so a def label and a link label normalize to the same key.
    // An escaped `]` still does not end the label.
    if (c === 92 && i + 1 < n) { label += src[i]; label += src[i + 1]; i += 2; continue; }
    if (c === 93) break;
    if (c === 91) return null;
    if (c === 10) {
      let k = i + 1;
      while (k < n && (src.charCodeAt(k) === 32 || src.charCodeAt(k) === 9)) k++;
      if (k < n && src.charCodeAt(k) === 10) return null;
      label += ' ';
      i++;
      continue;
    }
    if (c !== 32 && c !== 9) hasNonSpace = true;
    label += src[i];
    i++;
  }
  if (i >= n || src.charCodeAt(i) !== 93) return null;
  if (!hasNonSpace) return null;
  i++; // past ]
  if (i >= n || src.charCodeAt(i) !== 58) return null; // :
  i++;
  // skip spaces/tabs and at most one newline before the dest
  let j = i;
  while (j < n && (src.charCodeAt(j) === 32 || src.charCodeAt(j) === 9)) j++;
  if (j < n && src.charCodeAt(j) === 10) {
    j++;
    while (j < n && (src.charCodeAt(j) === 32 || src.charCodeAt(j) === 9)) j++;
  }
  i = j;
  if (i >= n) return null;
  let href = null;
  if (src.charCodeAt(i) === 60) { // <angle dest>
    let k = i + 1;
    let ok = true;
    while (k < n) {
      const c = src.charCodeAt(k);
      if (c === 62) break;
      if (c === 10 || c === 60) { ok = false; break; }
      if (c === 92) k++;
      k++;
    }
    if (!ok || k >= n || src.charCodeAt(k) !== 62) return null;
    href = src.slice(i + 1, k);
    i = k + 1;
  } else {
    let k = i;
    while (k < n) {
      const c = src.charCodeAt(k);
      if (c === 32 || c === 9 || c === 10 || c < 32 || c === 127) break;
      k++;
    }
    if (k === i) return null;
    href = src.slice(i, k);
    i = k;
  }
  // optional title: on the same line after whitespace, or on the next line
  let title = null;
  let k = i;
  let ws = 0;
  while (k < n && (src.charCodeAt(k) === 32 || src.charCodeAt(k) === 9)) { k++; ws++; }
  // End of the dest's line: a next-line title that fails (or is followed
  // by junk) backtracks to the def WITHOUT the title, consuming up to
  // here (cm-210). A same-line title failure rejects the whole def.
  let destLineEnd = i;
  while (destLineEnd < n && src.charCodeAt(destLineEnd) !== 10) destLineEnd++;
  const backtrack = () => {
    let consumed = 1;
    for (let p = 0; p < destLineEnd; p++) if (src.charCodeAt(p) === 10) consumed++;
    return { label, href, title: null, consumed };
  };
  let titleOnNextLine = false;
  if (k < n && src.charCodeAt(k) === 10) {
    // possible title on the next line: cross the newline only if the
    // next line starts with a title quote; otherwise the def ends here
    // (the next line is a separate block, not junk).
    let k2 = k + 1;
    while (k2 < n && (src.charCodeAt(k2) === 32 || src.charCodeAt(k2) === 9)) k2++;
    if (k2 < n) {
      const tc2 = src.charCodeAt(k2);
      if (tc2 === 34 || tc2 === 39 || tc2 === 40) {
        titleOnNextLine = true;
        const pt = parseDefTitle(src, k2);
        if (!pt) return backtrack();
        title = pt.title;
        k = pt.end;
      }
    }
  } else if (k < n) {
    const tc = src.charCodeAt(k);
    if (tc === 34 || tc === 39 || tc === 40) {
      // a same-line title must be separated from the dest by whitespace
      if (ws === 0) return null;
      const pt = parseDefTitle(src, k);
      if (!pt) return null;
      title = pt.title;
      k = pt.end;
    } else {
      return null; // junk on the same line as the dest
    }
  }
  // after the title (or dest), only whitespace to end of line
  let m = k;
  while (m < n && src.charCodeAt(m) !== 10) {
    if (src.charCodeAt(m) !== 32 && src.charCodeAt(m) !== 9) {
      if (titleOnNextLine) return backtrack();
      return null;
    }
    m++;
  }
  let consumed = 1;
  for (let p = 0; p < m; p++) if (src.charCodeAt(p) === 10) consumed++;
  return { label, href, title, consumed };
}

function parseDefTitle(src, k) {
  const tc = src.charCodeAt(k);
  const n = src.length;
  if (tc === 34) {
    let j = k + 1;
    while (j < n) {
      const c = src.charCodeAt(j);
      if (c === 92) { j += 2; continue; }
      if (c === 34) return { title: src.slice(k + 1, j), end: j + 1 };
      j++;
    }
    return null;
  }
  if (tc === 39) {
    let j = k + 1;
    while (j < n) {
      const c = src.charCodeAt(j);
      if (c === 92) { j += 2; continue; }
      if (c === 39) return { title: src.slice(k + 1, j), end: j + 1 };
      if (c === 10) {
        let m = j + 1;
        while (m < n && (src.charCodeAt(m) === 32 || src.charCodeAt(m) === 9)) m++;
        if (m < n && src.charCodeAt(m) === 10) return null;
      }
      j++;
    }
    return null;
  }
  // ( ... )
  let j = k + 1;
  while (j < n) {
    const c = src.charCodeAt(j);
    if (c === 92) { j += 2; continue; }
    if (c === 41) return { title: src.slice(k + 1, j), end: j + 1 };
    if (c === 40) return null;
    j++;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Renderer: block tree -> HTML.
// ---------------------------------------------------------------------------

function renderBlocks(node, links, out) {
  for (const ch of node[1]) renderBlock(ch, links, out);
}

function renderBlock(node, links, out) {
  switch (node[0]) {
    case 'p':
      out.push('<p>');
      inlineParse(node[1], links, out, false, false);
      out.push('</p>\n');
      break;
    case 'h':
      out.push('<h', String(node[1]), '>');
      inlineParse(node[2], links, out, false, false);
      out.push('</h', String(node[1]), '>\n');
      break;
    case 'code': {
      const lang = node[1];
      if (lang) {
        // first word of the info string
        let w = lang;
        const sp = w.search(/[ \t]/);
        if (sp >= 0) w = w.slice(0, sp);
        out.push('<pre><code class="language-');
        appendEscapedText(unescapeLinkText(w), out);
        out.push('">');
      } else {
        out.push('<pre><code>');
      }
      let t = node[2];
      if (t.charCodeAt(t.length - 1) === 10) t = t.slice(0, -1);
      appendEscapedFull(t, out);
      // The trailing newline is emitted whenever there was content,
      // even when stripping the one trailing '\n' leaves t empty
      // (a fence holding a single blank line renders as one '\n').
      if (node[2] !== '') out.push('\n');
      out.push('</code></pre>\n');
      break;
    }
    case 'hr':
      out.push('<hr>\n');
      break;
    case 'q':
      out.push('<blockquote>\n');
      for (const ch of node[1]) renderBlock(ch, links, out);
      out.push('</blockquote>\n');
      break;
    case 'list': {
      const ordered = node[1], start = node[2], loose = node[3], items = node[4];
      out.push(ordered ? '<ol' : '<ul');
      if (ordered && start !== 1) out.push(' start="', String(start), '"');
      out.push('>\n');
      for (const item of items) renderListItem(item, loose, links, out);
      out.push(ordered ? '</ol>\n' : '</ul>\n');
      break;
    }
    case 'html':
      out.push(node[1]);
      break;
    case 'table':
      renderTable(node, links, out);
      break;
  }
}

function renderListItem(item, loose, links, out) {
  out.push('<li>');
  const kids = item[1];
  const task = item.task;
  if (loose) {
    for (let k = 0; k < kids.length; k++) {
      const ch = kids[k];
      if (ch[0] === 'p' && k === 0 && task !== undefined) {
        out.push('<p>');
        out.push(task ? '<input checked="" disabled="" type="checkbox"> ' : '<input disabled="" type="checkbox"> ');
        inlineParse(ch[1], links, out, false, false);
        out.push('</p>\n');
      } else {
        renderBlock(ch, links, out);
      }
    }
    if (kids.length === 0 && task !== undefined) {
      out.push(task ? '<input checked="" disabled="" type="checkbox"> ' : '<input disabled="" type="checkbox"> ');
    }
  } else {
    for (let k = 0; k < kids.length; k++) {
      const ch = kids[k];
      if (ch[0] === 'p' && ch[2]) {
        // hard paragraph (after a nested list/quote in this item):
        // renders with <p> even in a tight list.
        if (k === 0 && task !== undefined) {
          out.push('<p>');
          out.push(task ? '<input checked="" disabled="" type="checkbox"> ' : '<input disabled="" type="checkbox"> ');
          inlineParse(ch[1], links, out, false, false);
          out.push('</p>\n');
        } else {
          renderBlock(ch, links, out);
        }
      } else if (ch[0] === 'p') {
        if (k === 0 && task !== undefined) {
          out.push(task ? '<input checked="" disabled="" type="checkbox"> ' : '<input disabled="" type="checkbox"> ');
        }
        inlineParse(ch[1], links, out, false, false);
      } else {
        renderBlock(ch, links, out);
      }
    }
    if (kids.length === 0 && task !== undefined) {
      out.push(task ? '<input checked="" disabled="" type="checkbox"> ' : '<input disabled="" type="checkbox"> ');
    }
  }
  out.push('</li>\n');
}

function renderTable(node, links, out) {
  const aligns = node[1], header = node[2], rows = node[3];
  out.push('<table>\n<thead>\n<tr>\n');
  for (let k = 0; k < header.length; k++) {
    out.push('<th');
    if (aligns[k]) out.push(' align="', aligns[k], '"');
    out.push('>');
    inlineParse(header[k], links, out, false, false);
    out.push('</th>\n');
  }
  out.push('</tr>\n</thead>\n');
  if (rows.length > 0) {
    out.push('<tbody>');
    for (const row of rows) {
      out.push('<tr>\n');
      for (let k = 0; k < row.length; k++) {
        out.push('<td');
        if (aligns[k]) out.push(' align="', aligns[k], '"');
        out.push('>');
        inlineParse(row[k], links, out, false, false);
        out.push('</td>\n');
      }
      out.push('</tr>\n');
    }
    out.push('</tbody>');
  }
  out.push('</table>\n');
}
