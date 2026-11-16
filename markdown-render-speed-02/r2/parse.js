// Lexor — a from-scratch CommonMark 0.31.2 + GFM 0.29 parser.
// Architecture: line lexer -> block state machine -> inline scanner -> renderer.
// Written fresh in this session; no code is copied from any other parser.

// ------------------------------------------------------------------
// Small character helpers (char codes, no regex in hot paths)
// ------------------------------------------------------------------
function isSpaceCode(c) { return c === 32 || c === 9 || c === 10 || c === 11 || c === 12 || c === 13; }
function isDigitCode(c) { return c >= 48 && c <= 57; }
function isAsciiLetter(c) { return (c >= 65 && c <= 90) || (c >= 97 && c <= 122); }
function isAlphaNumCode(c) { return isDigitCode(c) || isAsciiLetter(c); }
function isPunctCode(c) {
  return (c >= 33 && c <= 47) || (c >= 58 && c <= 64) || (c >= 91 && c <= 96) || (c >= 123 && c <= 126);
}
// Unicode punctuation for flanking: CommonMark counts category P
// (punctuation) AND category S (symbols: currency, math, misc).
function isUnicodePunct(ch) {
  const c = ch.codePointAt(0);
  if (c < 128) return isPunctCode(c);
  if (c >= 0x00a1 && c <= 0x00bf) {
    if (c === 0x00aa || c === 0x00b5 || c === 0x00ba) return false; // letters ª µ º
    return true;
  }
  if (c >= 0x2000 && c <= 0x206f) return true;
  if (c >= 0x2070 && c <= 0x209f) return true;
  if (c >= 0x20a0 && c <= 0x20cf) return true; // currency symbols (€)
  if (c >= 0x2100 && c <= 0x214f) return true;
  if (c >= 0x2190 && c <= 0x21ff) return true;
  if (c >= 0x2200 && c <= 0x22ff) return true;
  if (c >= 0x2300 && c <= 0x23ff) return true;
  if (c >= 0x2460 && c <= 0x24ff) return true;
  if (c >= 0x2500 && c <= 0x257f) return true;
  if (c >= 0x2580 && c <= 0x259f) return true;
  if (c >= 0x25a0 && c <= 0x25ff) return true;
  if (c >= 0x2600 && c <= 0x27bf) return true;
  if (c >= 0x2b00 && c <= 0x2bff) return true;
  if (c >= 0x3000 && c <= 0x303f) return true;
  if (c >= 0x2e00 && c <= 0x2e7f) return true;
  if (c >= 0xfe10 && c <= 0xfe6f) return true;
  if (c >= 0xff01 && c <= 0xff0f) return true;
  if (c >= 0xff1a && c <= 0xff20) return true;
  if (c >= 0xff3b && c <= 0xff40) return true;
  if (c >= 0xff5b && c <= 0xff65) return true;
  return false;
}

// Count leading spaces of a string, expanding tabs to tab stops of 4.
function leadingWidth(s) {
  let w = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 32) w += 1;
    else if (c === 9) w += 4 - (w % 4);
    else break;
  }
  return w;
}

// Expand tabs in a line to spaces (tab stops of 4), starting at column 0.
function expandTabs(s) {
  if (s.indexOf('\t') < 0) return s;
  let out = '';
  let col = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\t') {
      const n = 4 - (col % 4);
      out += '    '.slice(0, n);
      col += n;
    } else {
      out += ch;
      col += 1;
    }
  }
  return out;
}

// Strip up to `n` leading spaces from a string (tabs already expanded).
function stripIndent(s, n) {
  let i = 0;
  while (i < s.length && n > 0 && s.charCodeAt(i) === 32) { i++; n--; }
  return s.slice(i);
}

// ------------------------------------------------------------------
// HTML entity table (named entities, HTML5). Hand-written.
// ------------------------------------------------------------------
const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', iexcl: '¡', cent: '¢',
  pound: '£', curren: '¤', yen: '¥', brvbar: '¦', sect: '§', uml: '¨', copy: '©', ordf: 'ª',
  laquo: '«', not: '¬', shy: '­', reg: '®', macr: '¯', deg: '°', plusmn: '±',
  sup2: '²', sup3: '³', acute: '´', micro: 'µ', para: '¶', middot: '·', cedil: '¸',
  sup1: '¹', ordm: 'º', raquo: '»', frac14: '¼', frac12: '½', frac34: '¾', iquest: '¿',
  Agrave: 'À', Aacute: 'Á', Acirc: 'Â', Atilde: 'Ã', Auml: 'Ä', Aring: 'Å', AElig: 'Æ',
  Ccedil: 'Ç', Egrave: 'È', Eacute: 'É', Ecirc: 'Ê', Euml: 'Ë', Igrave: 'Ì', Iacute: 'Í',
  Icirc: 'Î', Iuml: 'Ï', ETH: 'Ð', Ntilde: 'Ñ', Ograve: 'Ò', Oacute: 'Ó', Ocirc: 'Ô',
  Otilde: 'Õ', Ouml: 'Ö', times: '×', Oslash: 'Ø', Ugrave: 'Ù', Uacute: 'Ú', Ucirc: 'Û',
  Uuml: 'Ü', Yacute: 'Ý', THORN: 'Þ', szlig: 'ß', agrave: 'à', aacute: 'á', acirc: 'â',
  atilde: 'ã', auml: 'ä', aring: 'å', aelig: 'æ', ccedil: 'ç', egrave: 'è', eacute: 'é',
  ecirc: 'ê', euml: 'ë', igrave: 'ì', iacute: 'í', icirc: 'î', iuml: 'ï', eth: 'ð',
  ntilde: 'ñ', ograve: 'ò', oacute: 'ó', ocirc: 'ô', otilde: 'õ', ouml: 'ö', divide: '÷',
  oslash: 'ø', ugrave: 'ù', uacute: 'ú', ucirc: 'û', uuml: 'ü', yacute: 'ý', thorn: 'þ',
  yuml: 'ÿ', Amacr: 'Ā', amacr: 'ā', Abreve: 'Ă', abreve: 'ă', Aogon: 'Ą', aogon: 'ą',
  Cacute: 'Ć', cacute: 'ć', Ccaron: 'Č', ccaron: 'č', Dcaron: 'Ď', dcaron: 'ď',
  Emacr: 'Ē', emacr: 'ē', Edot: 'Ė', edot: 'ė', Eogon: 'Ę', eogon: 'ę', Ecaron: 'Ě',
  ecaron: 'ě', Gbreve: 'Ğ', gbreve: 'ğ', Gdot: 'Ġ', gdot: 'ġ', Hcirc: 'Ĥ', hcirc: 'ĥ',
  Hstrok: 'Ħ', hstrok: 'ħ', Idot: 'İ', imacr: 'ī', Imacr: 'Ī', Iogon: 'Į', iogon: 'į',
  Jcirc: 'Ĵ', jcirc: 'ĵ', Lacute: 'Ĺ', lacute: 'ĺ', Lcaron: 'Ľ', lcaron: 'ľ',
  Lmidot: 'Ŀ', lmidot: 'ŀ', Lstrok: 'Ł', lstrok: 'ł', Nacute: 'Ń', nacute: 'ń',
  Ncaron: 'Ň', ncaron: 'ň', Napos: 'ŉ', napos: 'ŉ', Ncedil: 'Ņ', ncedil: 'ņ',
  Omacr: 'Ō', omacr: 'ō', Odblac: 'Ő', odblac: 'ő', OElig: 'Œ', oelig: 'œ',
  Racute: 'Ŕ', racute: 'ŕ', Rcaron: 'Ř', rcaron: 'ř', Rcedil: 'Ŗ', rcedil: 'ŗ',
  Sacute: 'Ś', sacute: 'ś', Scirc: 'Ŝ', scirc: 'ŝ', Scedil: 'Ş', scedil: 'ş',
  Scaron: 'Š', scaron: 'š', Tcedil: 'Ţ', tcedil: 'ţ', Tcaron: 'Ť', tcaron: 'ť',
  Tstrok: 'Ŧ', tstrok: 'ŧ', Umacr: 'Ū', umacr: 'ū', Ubreve: 'Ŭ', ubreve: 'ŭ',
  Uring: 'Ů', uring: 'ů', Udblac: 'Ű', udblac: 'ű', Uogon: 'Ų', uogon: 'ų',
  Wcirc: 'Ŵ', wcirc: 'ŵ', Ycirc: 'Ŷ', ycirc: 'ŷ', Yuml: 'Ÿ', Zacute: 'Ź',
  zacute: 'ź', Zdot: 'Ż', zdot: 'ż', Zcaron: 'Ž', zcaron: 'ž', fnof: 'ƒ',
  circ: 'ˆ', tilde: '˜', ensp: ' ', emsp: ' ', thinsp: ' ', zwnj: '‌', zwj: '‍',
  lrm: '‎', rlm: '‏', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', sbquo: '‚',
  ldquo: '“', rdquo: '”', bdquo: '„', dagger: '†', Dagger: '‡', permil: '‰',
  lsaquo: '‹', rsaquo: '›', euro: '€', hellip: '…', prime: '′', Prime: '″',
  oline: '‾', frasl: '⁄', image: 'ℑ', weierp: '℘', real: 'ℜ', trade: '™',
  alefsym: 'ℵ', larr: '←', uarr: '↑', rarr: '→', darr: '↓', harr: '↔', crarr: '↵',
  lArr: '⇐', uArr: '⇑', rArr: '⇒', dArr: '⇓', hArr: '⇔', forall: '∀', part: '∂',
  exist: '∃', empty: '∅', nabla: '∇', isin: '∈', notin: '∉', ni: '∋', prod: '∏',
  sum: '∑', minus: '−', lowast: '∗', radic: '√', prop: '∝', infin: '∞', ang: '∠',
  and: '∧', or: '∨', cap: '∩', cup: '∪', int: '∫', there4: '∴', sim: '∼',
  cong: '≅', asymp: '≈', ne: '≠', equiv: '≡', le: '≤', ge: '≥', sub: '⊂',
  sup: '⊃', nsub: '⊄', sube: '⊆', supe: '⊇', oplus: '⊕', otimes: '⊗', perp: '⊥',
  sdot: '⋅', lceil: '⌈', rceil: '⌉', lfloor: '⌊', rfloor: '⌋', lang: '⟨',
  rang: '⟩', loz: '◊', spades: '♠', clubs: '♣', hearts: '♥', diams: '♦',
  Alpha: 'Α', Beta: 'Β', Gamma: 'Γ', Delta: 'Δ', Epsilon: 'Ε', Zeta: 'Ζ', Eta: 'Η',
  Theta: 'Θ', Iota: 'Ι', Kappa: 'Κ', Lambda: 'Λ', Mu: 'Μ', Nu: 'Ν', Xi: 'Ξ',
  Omicron: 'Ο', Pi: 'Π', Rho: 'Ρ', Sigma: 'Σ', Tau: 'Τ', Upsilon: 'Υ', Phi: 'Φ',
  Chi: 'Χ', Psi: 'Ψ', Omega: 'Ω', alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ',
  epsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ',
  mu: 'μ', nu: 'ν', xi: 'ξ', omicron: 'ο', pi: 'π', rho: 'ρ', sigmaf: 'ς',
  sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  thetasym: 'ϑ', upsih: 'ϒ', piv: 'ϖ', HilbertSpace: 'ℋ', DifferentialD: 'ⅆ',
  ClockwiseContourIntegral: '∲', ngE: '≧̸',
};

// Decode one entity starting at src[i] === '&'. Returns [decoded, nextIndex] or null.
function tryEntity(src, i) {
  const n = src.length;
  if (src.charCodeAt(i) !== 38) return null;
  if (i + 1 >= n) return null;
  const c1 = src.charCodeAt(i + 1);
  if (c1 === 35) {
    // numeric: &#123; or &#x1F; or &#X1F; -> decode to the character
    let j = i + 2;
    let hex = false;
    if (j < n && (src.charCodeAt(j) === 120 || src.charCodeAt(j) === 88)) { hex = true; j++; }
    const start = j;
    while (j < n) {
      const c = src.charCodeAt(j);
      if (hex ? (isDigitCode(c) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102)) : isDigitCode(c)) j++;
      else break;
    }
    if (j === start || j >= n || src.charCodeAt(j) !== 59) return null;
    const num = parseInt(src.slice(start, j), hex ? 16 : 10);
    if (num > 0x10ffff) return null;
    let ch;
    if (!num || (num >= 0xd800 && num <= 0xdfff)) ch = '�';
    else ch = String.fromCodePoint(num);
    if (ch === '"') ch = '&quot;';
    else if (ch === "'") ch = '&#39;';
    else if (ch === '&') ch = '&amp;';
    else if (ch === '<') ch = '&lt;';
    else if (ch === '>') ch = '&gt;';
    return [ch, j + 1];
  }
  // named: any alphanumeric name + ';' passes through verbatim (marked
  // leaves named entity references untouched, real or invented)
  if (!isAsciiLetter(c1)) return null;
  let j = i + 1;
  while (j < n && isAlphaNumCode(src.charCodeAt(j))) j++;
  if (j >= n || src.charCodeAt(j) !== 59) return null;
  return [src.slice(i, j + 1), j + 1];
}

// ------------------------------------------------------------------
// HTML escaping + URL handling
// ------------------------------------------------------------------
function escTextInto(out, s) {
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 38) { if (i > start) out.push(s.slice(start, i)); out.push('&amp;'); start = i + 1; }
    else if (c === 60) { if (i > start) out.push(s.slice(start, i)); out.push('&lt;'); start = i + 1; }
    else if (c === 62) { if (i > start) out.push(s.slice(start, i)); out.push('&gt;'); start = i + 1; }
    else if (c === 34) { if (i > start) out.push(s.slice(start, i)); out.push('&quot;'); start = i + 1; }
    else if (c === 39) { if (i > start) out.push(s.slice(start, i)); out.push('&#39;'); start = i + 1; }
  }
  if (start < s.length) out.push(s.slice(start));
  else if (start === 0) out.push(s);
}

function escAttrInto(out, s) {
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 38) {
      // a '&' that starts a valid entity reference is left untouched
      const e = tryEntity(s, i);
      if (e) { i = e[1] - 1; continue; }
      if (i > start) out.push(s.slice(start, i)); out.push('&amp;'); start = i + 1;
    }
    else if (c === 60) { if (i > start) out.push(s.slice(start, i)); out.push('&lt;'); start = i + 1; }
    else if (c === 62) { if (i > start) out.push(s.slice(start, i)); out.push('&gt;'); start = i + 1; }
    else if (c === 34) { if (i > start) out.push(s.slice(start, i)); out.push('&quot;'); start = i + 1; }
    else if (c === 39) { if (i > start) out.push(s.slice(start, i)); out.push('&#39;'); start = i + 1; }
  }
  if (start < s.length) out.push(s.slice(start));
  else if (start === 0) out.push(s);
}

// Percent-encode a link destination: encode spaces and characters outside
// the usual URL set, keeping the standard URL punctuation intact.
function encodeHref(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const ch = s[i];
    if (c === 32) out += '%20';
    else if (c < 32 || c === 127) out += '%' + c.toString(16).toUpperCase().padStart(2, '0');
    else if (ch === '"' || ch === '<' || ch === '>' || ch === '`' || ch === '{' || ch === '}' ||
      ch === '|' || ch === '^' || ch === '\\' || ch === '[' || ch === ']') {
      out += '%' + c.toString(16).toUpperCase().padStart(2, '0');
    } else if (c > 127) {
      const bytes = new TextEncoder().encode(ch);
      for (const b of bytes) out += '%' + b.toString(16).toUpperCase().padStart(2, '0');
    } else out += ch;
  }
  return out;
}

// Reject dangerous link protocols; returns the cleaned href or null.
function cleanHref(raw) {
  let href = raw.trim();
  let clean = '';
  for (let i = 0; i < href.length; i++) {
    const c = href.charCodeAt(i);
    if (c >= 32 && c !== 127) clean += href[i];
  }
  href = clean;
  const lower = href.toLowerCase();
  if (lower.indexOf('javascript:') === 0 || lower.indexOf('vbscript:') === 0) return null;
  if (lower.indexOf('data:') === 0 && lower.indexOf('data:image/') !== 0) return null;
  return encodeHref(href);
}

// ------------------------------------------------------------------
// Inline parser.
// Segments: {k:0, s} literal HTML text | {k:1, ch, left, open, close,
//   pos, ot:[], ct:[]} delimiter run. Emphasis is resolved in a second
// pass over the segments with the CommonMark delimiter algorithm.
// ------------------------------------------------------------------

// Find the closing bracket for a link text starting at src[i] === '['.
// Returns the index of the matching ']' or -1. Skips code spans and
// backslash escapes; tracks nested bracket depth.
function findLinkTextEnd(src, i) {
  const n = src.length;
  let depth = 0;
  let j = i + 1;
  let poisoned = false; // a failed backtick run of length >= 2 seen
  while (j < n) {
    const c = src.charCodeAt(j);
    if (c === 92) { j += 2; continue; } // backslash escape
    if (c === 96) {
      // skip a code span. The closer must come before the first ] at
      // depth 0 (a ] inside the would-be span still ends the link text
      // when the closer lies beyond it). A failed run of length >= 2
      // poisons later 1-backtick runs (they are literal, not openers),
      // so a ] after one DOES end the link text (B class). A failed
      // 1-backtick run with no prior longer failure is an unterminated
      // code span: the link text is invalid (probe66).
      let run = 0;
      while (j + run < n && src.charCodeAt(j + run) === 96) run++;
      if (poisoned && run === 1) { j += run; continue; }
      let k = j + run;
      let closed = -1;
      let d = depth;
      while (k < n) {
        const kc = src.charCodeAt(k);
        if (kc === 91) { d++; k++; continue; }
        if (kc === 93) {
          if (d === 0) break; // a ] ends the link text before any closer
          d--; k++; continue;
        }
        if (kc === 96) {
          let r2 = 0;
          while (k + r2 < n && src.charCodeAt(k + r2) === 96) r2++;
          if (r2 === run) { closed = k; break; }
          k += r2;
        } else k++;
      }
      if (closed < 0) {
        if (run >= 2) { poisoned = true; j += run; continue; }
        return -1;
      }
      j = closed + run;
      continue;
    }
    if (c === 91) { depth++; j++; continue; }
    if (c === 93) {
      if (depth === 0) return j;
      depth--; j++; continue;
    }
    if (c === 60) {
      // skip an autolink / HTML tag <...>: a ] inside it (or inside a
      // quoted attribute value) does not end the link text (cm-524/526)
      let k = j + 1;
      let quote = 0;
      let closed = -1;
      let unclosedQuote = false;
      while (k < n) {
        const kc = src.charCodeAt(k);
        if (quote !== 0) {
          if (kc === quote) quote = 0;
          else if (kc === 10) { unclosedQuote = true; break; }
          k++;
          continue;
        }
        if (kc === 34 || kc === 39) { quote = kc; k++; continue; }
        if (kc === 62) { closed = k; break; }
        k++;
      }
      if (closed >= 0) { j = closed + 1; continue; }
      if (unclosedQuote || quote !== 0) { j = n; continue; }
      j++;
      continue;
    }
    j++;
  }
  return -1;
}

// Does the raw text contain a backtick run of length >= 2?
function hasLongBacktickRun(s) {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) === 96) {
      let j = i;
      while (j < s.length && s.charCodeAt(j) === 96) j++;
      if (j - i >= 2) return true;
      i = j - 1;
    }
  }
  return false;
}

// Normalize a link label: collapse internal whitespace, trim, lowercase.
function normalizeLabel(s) {
  let out = '';
  let inWs = false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 32 || c === 9 || c === 10 || c === 11 || c === 12 || c === 13) {
      if (!inWs && out.length > 0) { out += ' '; inWs = true; }
    } else { out += s[i]; inWs = false; }
  }
  if (out.length > 0 && out.charCodeAt(out.length - 1) === 32) out = out.slice(0, -1);
  // Unicode case folding: ß / ẞ fold to "ss" (cm-540)
  return out.toLowerCase().replace(/ß/g, 'ss').replace(/ẞ/g, 'ss');
}

// Parse a link destination + optional title after '(' at src[i] === '('.
// Returns {href, title, end} (end = index just past the closing ')') or null.
function parseInlineDest(src, i, refs) {
  const n = src.length;
  let j = i + 1;
  // skip whitespace (spaces, tabs, newlines)
  while (j < n && (src.charCodeAt(j) === 32 || src.charCodeAt(j) === 9 || src.charCodeAt(j) === 10)) j++;
  if (j >= n) return null;
  let href = '';
  if (src.charCodeAt(j) === 60) {
    // <...> destination
    j++;
    let start = j;
    let dest = '';
    let ok = false;
    while (j < n) {
      const c = src.charCodeAt(j);
      if (c === 62) { ok = true; break; }
      if (c === 10 || c === 60) return null;
      if (c === 92 && j + 1 < n && isPunctCode(src.charCodeAt(j + 1))) { dest += src.slice(start, j) + src[j + 1]; j += 2; start = j; continue; }
      j++;
    }
    if (!ok) return null;
    dest += src.slice(start, j);
    href = decodeInlineEntities(dest);
    j++; // past '>'
  } else {
    // bare destination: balanced parens, may contain ']'
    let depth = 0;
    let start = j;
    let dest = '';
    let closed = false;
    while (j < n) {
      const c = src.charCodeAt(j);
      if (c === 32 || c === 9 || c === 10) break;
      if (c === 40) { depth++; j++; continue; }
      if (c === 41) {
        if (depth === 0) {
          closed = true; break;
        }
        depth--; j++; continue;
      }
      if (c === 92 && j + 1 < n && isPunctCode(src.charCodeAt(j + 1))) {
        dest += src.slice(start, j) + src[j + 1]; j += 2; start = j; continue;
      }
      j++;
    }
    dest += src.slice(start, j);
    if (dest.length === 0 && !closed) {
      // empty destination is allowed only when immediately closed: [a]()
      // (handled by the caller checking for ')' here)
    }
    href = decodeInlineEntities(dest);
    // if we stopped at a space, the destination is done; if at ')', closed
    if (!closed && j < n && src.charCodeAt(j) !== 32 && src.charCodeAt(j) !== 9 && src.charCodeAt(j) !== 10) {
      // stopped at something else (should not happen)
    }
  }
  // optional title
  let title = null;
  let k = j;
  while (k < n && (src.charCodeAt(k) === 32 || src.charCodeAt(k) === 9 || src.charCodeAt(k) === 10)) k++;
  if (k < n) {
    const tc = src.charCodeAt(k);
    if (tc === 34 || tc === 39) {
      const q = String.fromCharCode(tc);
      let tstart = k + 1;
      let t = '';
      let p = tstart;
      let ok = false;
      while (p < n) {
        const c = src.charCodeAt(p);
        if (c === tc) { ok = true; break; }
        if (c === 92 && p + 1 < n && isPunctCode(src.charCodeAt(p + 1))) { t += src.slice(tstart, p) + src[p + 1]; p += 2; tstart = p; continue; }
        p++;
      }
      if (!ok) return null;
      t += src.slice(tstart, p);
      title = decodeInlineEntities(t);
      k = p + 1;
    } else if (tc === 40) {
      let tstart = k + 1;
      let t = '';
      let p = tstart;
      let ok = false;
      while (p < n) {
        const c = src.charCodeAt(p);
        if (c === 41) { ok = true; break; }
        if (c === 40) return null;
        if (c === 92 && p + 1 < n && isPunctCode(src.charCodeAt(p + 1))) { t += src.slice(tstart, p) + src[p + 1]; p += 2; tstart = p; continue; }
        p++;
      }
      if (!ok) return null;
      t += src.slice(tstart, p);
      title = decodeInlineEntities(t);
      k = p + 1;
    }
  }
  while (k < n && (src.charCodeAt(k) === 32 || src.charCodeAt(k) === 9 || src.charCodeAt(k) === 10)) k++;
  if (k >= n || src.charCodeAt(k) !== 41) return null;
  return { href, title, end: k + 1 };
}

// Decode backslash escapes and entities in a link destination / title.
function decodeInlineEntities(s) {
  if (s.indexOf('\\') < 0 && s.indexOf('&') < 0) return s;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 92 && i + 1 < s.length && isPunctCode(s.charCodeAt(i + 1))) { out += s[i + 1]; i++; }
    else if (c === 38) {
      const e = tryEntity(s, i);
      if (e) { out += e[0]; i = e[1] - 1; }
      else out += '&';
    } else out += s[i];
  }
  return out;
}

// Try to parse a link or image starting at src[i] ('[' or '![').
// Returns {html, end} or null. `isImage` distinguishes ![ from [.
function tryLink(src, i, refs, isImage, poison, codeSpans) {
  const n = src.length;
  const open = isImage ? i + 1 : i;
  const closeBracket = findLinkTextEnd(src, open);
  if (closeBracket < 0) return null;
  const textRaw = src.slice(open + 1, closeBracket);
  let j = closeBracket + 1;
  let href = null;
  let title = null;
  let isInline = false;
  if (j < n && src.charCodeAt(j) === 40) {
    const d = parseInlineDest(src, j, refs);
    if (!d) {
      // not a valid inline link: fall back to a shortcut reference link
      // (cm-568: "[foo](not a link)" with [foo]: /url1)
      const key = normalizeLabel(textRaw);
      const ref = refs.get(key);
      if (!ref) return null;
      href = ref.href;
      title = ref.title;
      j = closeBracket + 1;
    } else {
      href = d.href;
      title = d.title;
      j = d.end;
      isInline = true;
    }
  } else {
    // reference link: [text][label], [text][], or [text]
    let label = null;
    if (j < n && src.charCodeAt(j) === 91) {
      const close2 = findLinkTextEnd(src, j);
      if (close2 < 0) return null;
      label = src.slice(j + 1, close2);
      if (label.length === 0) label = textRaw;
      j = close2 + 1;
    } else {
      label = textRaw;
    }
    const key = normalizeLabel(label);
    const ref = refs.get(key);
    if (!ref) return null;
    href = ref.href;
    title = ref.title;
  }
  const clean = cleanHref(href);
  if (clean === null) return null;
  // B3 poison: only an INLINE link/image whose text holds a 2+ backtick
  // run suppresses later emphasis when a code span follows it.
  if (isInline && hasLongBacktickRun(textRaw)) poison.push(j);
  if (isImage) {
    const altHtml = parseInline(textRaw, refs, poison, codeSpans);
    // alt text: strip tags, but a nested image contributes its alt
    // (cm-574: ![foo ![bar](/url)](/url2) has alt "foo bar")
    let alt = '';
    let q = 0;
    while (q < altHtml.length) {
      if (altHtml.startsWith('<img ', q)) {
        const ae = altHtml.indexOf('>', q);
        const tagStr = ae < 0 ? altHtml.slice(q) : altHtml.slice(q, ae + 1);
        const am = tagStr.match(/alt="([^"]*)"/);
        if (am) alt += am[1];
        q = ae < 0 ? altHtml.length : ae + 1;
        continue;
      }
      if (altHtml.charCodeAt(q) === 60) {
        const e = altHtml.indexOf('>', q);
        q = e < 0 ? altHtml.length : e + 1;
        continue;
      }
      alt += altHtml[q];
      q++;
    }
    alt = alt.replace(/"/g, '&quot;');
    let tag = '<img src="' + escAttrStr(clean) + '" alt="' + alt + '"';
    if (title !== null && title !== undefined) tag += ' title="' + escAttrStr(title) + '"';
    tag += '>';
    return { html: tag, end: j };
  }
  const innerLinks = [];
  const inner = parseInline(textRaw, refs, innerLinks, true);
  // a link cannot contain another EXPLICIT link (cm-518/519/532/533).
  // Angle autolinks (<...>) inside link text still form (doc-04), but
  // extended autolinks (www./http/email) do not (probe50) -- the
  // inLink flag suppresses tryExtendedAutolink in the inner parse.
  if (!isImage && innerLinks.length > 0) return null;
  let tag = '<a href="' + escAttrStr(clean) + '"';
  if (title !== null && title !== undefined) tag += ' title="' + escAttrStr(title) + '"';
  tag += '>' + inner + '</a>';
  return { html: tag, end: j };
}

function escAttrStr(s) {
  const out = [];
  escAttrInto(out, s);
  return out.join('');
}

function stripTags(html) {
  let out = '';
  let inTag = false;
  for (let i = 0; i < html.length; i++) {
    const c = html.charCodeAt(i);
    if (c === 60) inTag = true;
    else if (c === 62) inTag = false;
    else if (!inTag) out += html[i];
  }
  return out;
}

// Try an autolink or inline HTML tag starting at src[i] === '<'.
// Returns {html, end} or null.
function tryAngle(src, i) {
  const n = src.length;
  let j = i + 1;
  if (j < n && src.charCodeAt(j) === 47) {
    // closing tag </name>
    return tryHtmlTag(src, i);
  }
  if (j < n && isAsciiLetter(src.charCodeAt(j))) {
    // could be scheme:... or an HTML open tag
    // a scheme is [a-zA-Z][a-zA-Z0-9+.-]* (cm-598: a+b+c:d)
    let k = j;
    while (k < n) {
      const kc = src.charCodeAt(k);
      if (isAlphaNumCode(kc) || kc === 43 || kc === 45 || kc === 46) k++;
      else break;
    }
    if (k < n && src.charCodeAt(k) === 58 && k - j >= 2 && k - j <= 32) {
      // scheme autolink: scheme:rest>
      let p = k + 1;
      while (p < n && src.charCodeAt(p) !== 62 && src.charCodeAt(p) !== 32 && src.charCodeAt(p) !== 10 && src.charCodeAt(p) !== 60) p++;
      if (p < n && src.charCodeAt(p) === 62) {
        const inner = src.slice(i + 1, p);
        const href = cleanHref(inner);
        if (href === null) return null;
        return { html: '<a href="' + escAttrStr(href) + '">' + escTextStr(inner) + '</a>', end: p + 1 };
      }
      return null;
    }
    // not a scheme: fall through to the email scan, then the HTML tag
  }
  if (j < n && (src.charCodeAt(j) === 33 || src.charCodeAt(j) === 63)) {
    return tryHtmlTag(src, i);
  }
  // email autolink: scan for a@b>
  let p = j;
  let atPos = -1;
  while (p < n && src.charCodeAt(p) !== 62 && src.charCodeAt(p) !== 32 && src.charCodeAt(p) !== 10 && src.charCodeAt(p) !== 60) {
    if (src.charCodeAt(p) === 64) atPos = p;
    p++;
  }
  if (p < n && src.charCodeAt(p) === 62 && atPos > j) {
    const inner = src.slice(i + 1, p);
    if (isValidEmail(inner)) {
      return { html: '<a href="mailto:' + escAttrStr(inner) + '">' + escTextStr(inner) + '</a>', end: p + 1 };
    }
  }
  // otherwise, an inline HTML tag
  if (j < n && isAsciiLetter(src.charCodeAt(j))) return tryHtmlTag(src, i);
  return null;
}

const ESC_TEXT_RE = /[&<>"']/;
function escTextStr(s) {
  // plain text with no escapable char is returned as-is (no array/join)
  if (!ESC_TEXT_RE.test(s)) return s;
  const out = [];
  escTextInto(out, s);
  return out.join('');
}

// Validate an email address for autolinking (local@domain.tld).
function isValidEmail(s) {
  const at = s.indexOf('@');
  if (at <= 0 || at === s.length - 1) return false;
  const local = s.slice(0, at);
  const domain = s.slice(at + 1);
  if (!/^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+$/.test(local)) return false;
  if (local.indexOf('..') >= 0 || local[0] === '.' || local[local.length - 1] === '.') return false;
  const parts = domain.split('.');
  if (parts.length < 2) return false;
  for (const part of parts) {
    if (!/^[A-Za-z0-9-]+$/.test(part) || part.length === 0) return false;
    if (part[0] === '-' || part[part.length - 1] === '-') return false;
  }
  const tld = parts[parts.length - 1];
  if (!/^[A-Za-z]+$/.test(tld)) return false;
  return true;
}

// Parse an inline HTML tag (open, close, comment, PI, declaration, CDATA).
function tryHtmlTag(src, i) {
  const n = src.length;
  let j = i + 1;
  if (j < n && src.charCodeAt(j) === 33) {
    // <!-- comment -->, <!A ...>, <![CDATA[ ... ]]>
    if (src.slice(j, j + 3) === '!--') {
      // <!--> is a complete (empty) comment ending at the immediate >
      if (j + 3 < n && src.charCodeAt(j + 3) === 62) {
        return { html: src.slice(i, j + 4), end: j + 4 };
      }
      // search from j+2 so <!---> (whose --> starts at j+2) is found
      const end = src.indexOf('-->', j + 2);
      if (end < 0) return null;
      return { html: src.slice(i, end + 3), end: end + 3 };
    }
    if (src.slice(j, j + 8) === '![CDATA[') {
      const end = src.indexOf(']]>', j + 8);
      if (end < 0) return null;
      return { html: src.slice(i, end + 3), end: end + 3 };
    }
    // declaration <!A ...>
    let p = j + 1;
    while (p < n && isAsciiLetter(src.charCodeAt(p))) p++;
    if (p === j + 1) return null;
    while (p < n && src.charCodeAt(p) !== 62) p++;
    if (p >= n) return null;
    return { html: src.slice(i, p + 1), end: p + 1 };
  }
  if (j < n && src.charCodeAt(j) === 63) {
    const end = src.indexOf('?>', j + 1);
    if (end < 0) return null;
    return { html: src.slice(i, end + 2), end: end + 2 };
  }
  // open or close tag
  let closing = false;
  if (j < n && src.charCodeAt(j) === 47) { closing = true; j++; }
  let k = j;
  while (k < n && (isAsciiLetter(src.charCodeAt(k)) || isDigitCode(src.charCodeAt(k)) || src.charCodeAt(k) === 45)) k++;
  if (k === j) return null;
  const name = src.slice(j, k);
  if (!isAsciiLetter(src.charCodeAt(j))) return null;
  j = k;
  if (closing) {
    while (j < n && (src.charCodeAt(j) === 32 || src.charCodeAt(j) === 9 || src.charCodeAt(j) === 10)) j++;
    if (j < n && src.charCodeAt(j) === 62) return { html: src.slice(i, j + 1), end: j + 1 };
    return null;
  }
  // attributes
  let sawAttr = false;
  while (j < n) {
    const wsStart = j;
    while (j < n && (src.charCodeAt(j) === 32 || src.charCodeAt(j) === 9 || src.charCodeAt(j) === 10)) j++;
    if (j >= n) return null;
    const c = src.charCodeAt(j);
    if (c === 62) return { html: src.slice(i, j + 1), end: j + 1 };
    if (c === 47) {
      if (j + 1 < n && src.charCodeAt(j + 1) === 62) return { html: src.slice(i, j + 2), end: j + 2 };
      return null;
    }
    // attributes must be separated by whitespace (cm-622:
    // <a href='bar'title=title> is not a tag)
    if (sawAttr && j === wsStart) return null;
    // attribute name (must start with a letter or '_'; ':' is allowed
    // inside a name, e.g. xml:lang, but not as its first character)
    if (!isAsciiLetter(c) && c !== 95) return null;
    while (j < n) {
      const a = src.charCodeAt(j);
      if (isAlphaNumCode(a) || a === 45 || a === 95 || a === 58 || a === 46) j++;
      else break;
    }
    // do not consume the whitespace after a valueless (boolean)
    // attribute: it is the separator for the next attribute
    const afterName = j;
    while (j < n && (src.charCodeAt(j) === 32 || src.charCodeAt(j) === 9 || src.charCodeAt(j) === 10)) j++;
    if (j < n && src.charCodeAt(j) === 61) {
      j++;
      while (j < n && (src.charCodeAt(j) === 32 || src.charCodeAt(j) === 9 || src.charCodeAt(j) === 10)) j++;
      if (j >= n) return null;
      const q = src.charCodeAt(j);
      if (q === 34 || q === 39) {
        j++;
        while (j < n && src.charCodeAt(j) !== q) j++;
        if (j >= n) return null;
        j++;
      } else {
        let vstart = j;
        while (j < n) {
          const v = src.charCodeAt(j);
          if (v === 32 || v === 9 || v === 10 || v === 34 || v === 39 || v === 61 || v === 60 || v === 62 || v === 96) break;
          j++;
        }
        if (j === vstart) return null;
      }
    } else {
      j = afterName;
    }
    sawAttr = true;
  }
  return null;
}

// GFM extended autolink: www., http(s)://, or bare email at position i.
// Returns {html, end} or null. `prev` is the char before i (or '').
function tryExtendedAutolink(src, i, prev) {
  const n = src.length;
  if (prev !== '' && (isAlphaNumCode(prev.charCodeAt(0)) || prev === '_' || prev === '.')) return null;
  // scheme autolink: mailto:/xmpp: + email, optionally one /segment
  {
    let j = i;
    while (j < n && isAsciiLetter(src.charCodeAt(j))) j++;
    if (j - i >= 2 && j < n && src.charCodeAt(j) === 58) {
      const scheme = src.slice(i, j);
      let k = j + 1;
      let m = k;
      while (m < n) {
        const c = src.charCodeAt(m);
        if (isAlphaNumCode(c) || c === 46 || c === 95 || c === 45 || c === 43 || c === 64) m++;
        else break;
      }
      const cand = src.slice(k, m);
      if (cand.includes('@')) {
        let email = cand;
        while (email.length > 0) {
          const last = email[email.length - 1];
          if (last === '.' || last === ',' || last === ';' || last === ':' || last === '!' || last === '?' || last === ')' || last === ']') {
            if (last === ')' && balancedParens(email)) break;
            email = email.slice(0, -1);
          } else break;
        }
        if (!email.endsWith('_') && isValidEmail(email)) {
          let end = k + email.length;
          // optional single /segment (xmpp:foo@bar.baz/txt)
          if (end < n && src.charCodeAt(end) === 47) {
            let p = end + 1;
            let q = p;
            while (q < n) {
              const c = src.charCodeAt(q);
              if (isAlphaNumCode(c) || c === 46 || c === 95 || c === 45 || c === 43 || c === 64 || c === 37) q++;
              else break;
            }
            if (q > p) {
              let seg = src.slice(p, q);
              while (seg.length > 0 && (seg[seg.length - 1] === '.' || seg[seg.length - 1] === ',' || seg[seg.length - 1] === ';' || seg[seg.length - 1] === ':' || seg[seg.length - 1] === '!' || seg[seg.length - 1] === '?' || seg[seg.length - 1] === ')')) seg = seg.slice(0, -1);
              if (seg.length > 0) end = p + seg.length;
            }
          }
          const full = src.slice(i, end);
          return { html: '<a href="' + escAttrStr(full) + '">' + escTextStr(full) + '</a>', end };
        }
      }
    }
  }
  // www. (guarded by first char so a word-start probe does not slice)
  if (src.charCodeAt(i) === 119 && src.slice(i, i + 4) === 'www.') {
    let j = i + 4;
    let end = scanUrlEnd(src, j);
    if (end <= j) return null;
    let url = src.slice(i, end);
    url = trimUrlTail(url);
    if (!url.includes('.')) return null;
    const host = url.split(/[\/?#]/)[0];
    if (!isValidHost(host)) return null;
    end = i + url.length;
    const href = 'http://' + url;
    return { html: '<a href="' + escAttrStr(encodeHref(href)) + '">' + escTextStr(url) + '</a>', end };
  }
  // http(s):// (guarded by first char 'h'/'H' so a word-start probe does
  // not pay two slice+toLowerCase allocations per word)
  const c0 = src.charCodeAt(i);
  if (c0 === 104 || c0 === 72) {
    const lower7 = src.slice(i, i + 7).toLowerCase();
    const lower8 = src.slice(i, i + 8).toLowerCase();
    if (lower7 === 'http://' || lower8 === 'https://') {
    let j = i + (src.charCodeAt(i + 4) === 115 || src.charCodeAt(i + 4) === 83 ? 8 : 7);
    let end = scanUrlEnd(src, j);
    if (end <= j) return null;
    let url = src.slice(i, end);
    url = trimUrlTail(url);
    const host = url.slice(url.indexOf('://') + 3).split(/[\/?#]/)[0];
    if (!isValidHost(host)) return null;
    end = i + url.length;
    return { html: '<a href="' + escAttrStr(encodeHref(url)) + '">' + escTextStr(url) + '</a>', end };
    }
  }
  // bare email: local@domain
  // bare email: local@domain (skip the slice+validate when the word
  // holds no '@' — the common case for a word-start probe)
  if (isAlphaNumCode(src.charCodeAt(i)) || src.charCodeAt(i) === 46 || src.charCodeAt(i) === 95 ||
    src.charCodeAt(i) === 45 || src.charCodeAt(i) === 43) {
    let j = i;
    let atSeen = false;
    while (j < n) {
      const c = src.charCodeAt(j);
      if (isAlphaNumCode(c) || c === 46 || c === 95 || c === 45 || c === 43 || c === 64) { if (c === 64) atSeen = true; j++; }
      else break;
    }
    const cand = atSeen ? src.slice(i, j) : '';
    if (cand.includes('@')) {
      let email = cand;
      // strip trailing punctuation: . , ; : ! ? ) etc.
      while (email.length > 0) {
        const last = email[email.length - 1];
        if (last === '.' || last === ',' || last === ';' || last === ':' || last === '!' || last === '?' || last === ')' || last === ']') {
          if (last === ')' && balancedParens(email)) break;
          email = email.slice(0, -1);
        } else break;
      }
      if (email.endsWith('_')) return null;
      if (isValidEmail(email)) {
        return { html: '<a href="mailto:' + escAttrStr(email) + '">' + escTextStr(email) + '</a>', end: i + email.length };
      }
    }
  }
  return null;
}

function balancedParens(s) {
  let d = 0;
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) === 40) d++;
    else if (s.charCodeAt(i) === 41) { d--; if (d < 0) return false; }
  }
  return d === 0;
}

function isValidHost(host) {
  if (!host || host.length === 0) return false;
  const parts = host.split('.');
  if (parts.length < 2) return false;
  for (const part of parts) {
    if (part.length === 0) return false;
    if (!/^[A-Za-z0-9-]+$/.test(part)) return false;
  }
  const tld = parts[parts.length - 1];
  if (!/^[A-Za-z]{2,}$/.test(tld)) return false;
  return true;
}

// Scan a URL body from j: stops at whitespace or '<' or '>' or '"'.
function scanUrlEnd(src, j) {
  const n = src.length;
  let k = j;
  while (k < n) {
    const c = src.charCodeAt(k);
    if (c === 32 || c === 9 || c === 10 || c === 60 || c === 62 || c === 34) break;
    // a * _ or ~ followed by ] [ whitespace or end is an emphasis/del
    // delimiter, not part of the URL (e.g. "*write that http://e.com/7*][ref]"
    // ends the URL at 7 so the * can close the em)
    if (c === 42 || c === 95 || c === 126) {
      const nx = k + 1 < n ? src.charCodeAt(k + 1) : 32;
      if (nx === 93 || nx === 91 || nx === 32 || nx === 9 || nx === 10) break;
    }
    k++;
  }
  return k;
}

// Strip trailing punctuation from an extended-autolink URL per GFM rules.
function trimUrlTail(url) {
  let end = url.length;
  // strip a trailing &name; entity-like suffix entirely (gfm-627:
  // &hl; is not part of the URL)
  while (end > 0 && url[end - 1] === ';') {
    const amp = url.lastIndexOf('&', end - 1);
    if (amp >= 0 && /^[A-Za-z0-9#]+$/.test(url.slice(amp + 1, end - 1))) {
      end = amp;
    } else break;
  }
  // strip trailing ? ! . , : ; * _ ~
  while (end > 0) {
    const ch = url[end - 1];
    if (ch === '?' || ch === '!' || ch === '.' || ch === ',' || ch === ':' || ch === '*' || ch === '_' || ch === '~') end--;
    else if (ch === ';') {
      // keep ';' only if it ends an entity reference &...;
      const amp = url.lastIndexOf('&', end - 1);
      if (amp >= 0 && /^[A-Za-z0-9#]+$/.test(url.slice(amp + 1, end - 1))) break;
      end--;
    } else if (ch === ')') {
      // keep ')' only if it closes a '(' that has no ')' between it and
      // this one (marked's _backpedal \([^)]*\) group): scan backward
      // from the char before it; a ')' met first means unbalanced.
      let keep = false;
      for (let i = end - 2; i >= 0; i--) {
        if (url.charCodeAt(i) === 40) { keep = true; break; }
        if (url.charCodeAt(i) === 41) break;
      }
      if (keep) break;
      end--;
    } else break;
  }
  return url.slice(0, end);
}

// ------------------------------------------------------------------
// Inline scan + emphasis resolution.
// ------------------------------------------------------------------

// Flanking: is the char before/after a delimiter run whitespace/punct?
function flankingInfo(src, start, len) {
  const n = src.length;
  const prev = start > 0 ? src[start - 1] : '';
  const next = start + len < n ? src[start + len] : '';
  const prevWs = prev === '' ? true : isWhitespaceChar(prev);
  const nextWs = next === '' ? true : isWhitespaceChar(next);
  const prevPunct = prev === '' ? false : isUnicodePunct(prev);
  const nextPunct = next === '' ? false : isUnicodePunct(next);
  const leftFlank = !nextWs && (!nextPunct || prevWs || prevPunct);
  const rightFlank = !prevWs && (!prevPunct || nextWs || nextPunct);
  return [leftFlank, rightFlank, prevPunct, nextPunct];
}

// RDelim classification for emBudget only: marked's emStrong RDelim
// regex excludes "~" from the punctuation classes (it is itself a
// delimiter), so a "*" run next to "~" is flanked as if by a letter.
// The delimiter scan's own open/close flags (LDelim) DO count "~" as
// punctuation — only the budget's classification uses this. Cached on
// the delimiter (fresh objects per inline segment).
function rdelimCls(D, src) {
  if (D.rcls !== undefined) return D.rcls;
  const n = src.length;
  const prev = D.pos > 0 ? src[D.pos - 1] : '';
  const next = D.pos + D.len < n ? src[D.pos + D.len] : '';
  const prevWs = prev === '' ? true : isWhitespaceChar(prev);
  const nextWs = next === '' ? true : isWhitespaceChar(next);
  const prevPunct = prev === '' || prev === '~' ? false : isUnicodePunct(prev);
  const nextPunct = next === '' || next === '~' ? false : isUnicodePunct(next);
  const leftFlank = !nextWs && (!nextPunct || prevWs || prevPunct);
  const rightFlank = !prevWs && (!prevPunct || nextWs || nextPunct);
  let canOpen, canClose;
  if (D.ch === '_') {
    canOpen = leftFlank && (!rightFlank || prevPunct);
    canClose = rightFlank && (!leftFlank || nextPunct);
  } else {
    canOpen = leftFlank;
    canClose = rightFlank;
  }
  const cls = canOpen && canClose ? 'both' : canOpen ? 'open' : 'close';
  D.rcls = cls;
  return cls;
}

function isWhitespaceChar(ch) {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\u00a0' ||
    ch === '\u2000' || ch === '\u2001' || ch === '\u2002' || ch === '\u2003' ||
    ch === '\u2004' || ch === '\u2005' || ch === '\u2006' || ch === '\u2007' ||
    ch === '\u2008' || ch === '\u2009' || ch === '\u200a' || ch === '\u2028' ||
    ch === '\u2029' || ch === '\u202f' || ch === '\u205f' || ch === '\u3000';
}

// Find the closer for a backtick run of length `runLen` starting at `open`.
// Returns the index of the closer run, or -1.
function findCodeClose(src, open, runLen) {
  const n = src.length;
  let k = open + runLen;
  while (k < n) {
    if (src.charCodeAt(k) === 96) {
      let r = 0;
      while (k + r < n && src.charCodeAt(k + r) === 96) r++;
      if (r === runLen) return k;
      k += r;
    } else k++;
  }
  return -1;
}

// The inline parser: turns inline markdown into HTML.
// single-pass regex checks for the inline fast path (replaces 14
// indexOf scans + a toLowerCase allocation)
const INLINE_SPECIAL_RE = /[*_~`\[!<&\\\n@]/;
const INLINE_URL_RE = /www\.|https?:\/\//i;
function parseInline(src, refs, linksOut, inLink) {
  // Fast path: plain text with no inline constructs at all.
  // The http(s) check is case-insensitive (Https://, HTTP:// autolink).
  if (!INLINE_SPECIAL_RE.test(src) && !INLINE_URL_RE.test(src)) {
    return escTextStr(src);
  }
  const poison = [];
  const codeSpans = [];
  return scanInline(src, refs, poison, codeSpans, linksOut, inLink);
}

function scanInline(src, refs, poison, codeSpans, linksOut, inLink) {
  const n = src.length;
  const segs = [];
  const delims = [];
  let i = 0;
  let textStart = 0;

  function flushText(upto) {
    if (upto > textStart) {
      segs.push({ k: 0, s: escTextStr(src.slice(textStart, upto)) });
    }
    textStart = upto;
  }

  while (i < n) {
    const c = src.charCodeAt(i);
    // backslash escape / hard break
    if (c === 92) {
      const nx = i + 1 < n ? src.charCodeAt(i + 1) : -1;
      if (nx === 10) {
        flushText(i);
        segs.push({ k: 0, s: '<br>' });
        i += 2;
        // hard break strips the next line's leading spaces/tabs
        while (i < n && (src.charCodeAt(i) === 32 || src.charCodeAt(i) === 9)) i++;
        textStart = i;
        continue;
      }
      if (nx >= 0 && isPunctCode(nx)) {
        flushText(i);
        const ech = src[i + 1];
        segs.push({ k: 0, s: ech === '&' ? '&amp;' : ech === '<' ? '&lt;' : ech === '>' ? '&gt;' : ech === '"' ? '&quot;' : ech === "'" ? '&#39;' : ech });
        i += 2; textStart = i;
        continue;
      }
      i++;
      continue;
    }
    // code span
    if (c === 96) {
      let run = 0;
      while (i + run < n && src.charCodeAt(i + run) === 96) run++;
      const close = findCodeClose(src, i, run);
      if (close >= 0) {
        let content = src.slice(i + run, close);
        content = content.replace(/\n/g, ' ');
        if (content.length >= 2 && content.charCodeAt(0) === 32 && content.charCodeAt(content.length - 1) === 32 &&
            content.trim() !== '') {
          content = content.slice(1, -1);
        }
        flushText(i);
        segs.push({ k: 0, s: '<code>' + escTextStr(content) + '</code>' });
        codeSpans.push([i, close + run]);
        i = close + run; textStart = i;
        continue;
      }
      // no matching closer: the run is literal text, but record its
      // position for the B3 poison check (an unmatched backtick run
      // after a delimiter still counts as a following code span)
      codeSpans.push([i, i + run]);
      i += run;
      continue;
    }
    // image / link
    if (c === 33 && i + 1 < n && src.charCodeAt(i + 1) === 91) {
      const r = tryLink(src, i, refs, true, poison);
      if (r) {
        flushText(i);
        segs.push({ k: 0, s: r.html });
        i = r.end; textStart = i;
        continue;
      }
      i++;
      continue;
    }
    if (c === 91) {
      const r = tryLink(src, i, refs, false, poison);
      if (r) {
        flushText(i);
        segs.push({ k: 0, s: r.html });
        if (linksOut) linksOut.push([i, r.end]);
        i = r.end; textStart = i;
        continue;
      }
      i++;
      continue;
    }
    // autolink / inline HTML
    if (c === 60) {
      const r = tryAngle(src, i);
      if (r) {
        flushText(i);
        // raw-text tags <code>, <pre>, <script>: content is output
        // unescaped until the matching close tag, the first emphasis/
        // link delimiter (* _ [ !), a valid code span opener, or end
        // of string (probe53-56); other tags escape content normally
        const h = r.html;
        const m = /^<(code|pre|script)(\s[^>]*)?>$/i.exec(h);
        if (m && !/\/>$/.test(h)) {
          const name = m[1].toLowerCase();
          const closeTag = '</' + name;
          let p = r.end;
          let rawEnd = n;
          while (p < n) {
            const pc = src.charCodeAt(p);
            if (pc === 60 && src.slice(p, p + 2 + name.length).toLowerCase() === closeTag) {
              const after = src.charCodeAt(p + 2 + name.length);
              if (after === 62 || after === 32 || after === 9 || after === 10 || after === 47) {
                rawEnd = p;
                break;
              }
            }
            if (pc === 42 || pc === 95 || pc === 91 || pc === 33) { rawEnd = p; break; }
            if (pc === 96) {
              // a backtick run with a matching closer ends the raw run
              let run = 0;
              while (p + run < n && src.charCodeAt(p + run) === 96) run++;
              let k = p + run;
              let closed = false;
              while (k < n) {
                if (src.charCodeAt(k) === 96) {
                  let r2 = 0;
                  while (k + r2 < n && src.charCodeAt(k + r2) === 96) r2++;
                  if (r2 === run) { closed = true; break; }
                  k += r2;
                } else k++;
              }
              if (closed) { rawEnd = p; break; }
              p += run;
              continue;
            }
            p++;
          }
          // include the closing tag itself in the raw output
          let end = rawEnd;
          if (rawEnd < n && src.charCodeAt(rawEnd) === 60) {
            const cm2 = /^<\/[a-zA-Z][^>]*>/i.exec(src.slice(rawEnd));
            if (cm2) end = rawEnd + cm2[0].length;
          }
          segs.push({ k: 0, s: src.slice(i, end) });
          i = end; textStart = i;
          continue;
        }
        segs.push({ k: 0, s: r.html });
        i = r.end; textStart = i;
        continue;
      }
      i++;
      continue;
    }
    // entity
    if (c === 38) {
      const e = tryEntity(src, i);
      if (e) {
        flushText(i);
        segs.push({ k: 0, s: e[0] });
        i = e[1]; textStart = i;
        continue;
      }
      i++;
      continue;
    }
    // emphasis / strikethrough delimiter run
    if (c === 42 || c === 95 || c === 126) {
      let run = 0;
      while (i + run < n && src.charCodeAt(i + run) === c) run++;
      // a ~ run of length >= 3 never forms <del> (gfm-493)
      if (c === 126 && run >= 3) { i += run; continue; }
      const ch = String.fromCharCode(c);
      const fl = flankingInfo(src, i, run);
      let canOpen, canClose;
      if (ch === '_') {
        canOpen = fl[0] && (!fl[1] || fl[2]);
        canClose = fl[1] && (!fl[0] || fl[3]);
      } else {
        canOpen = fl[0];
        canClose = fl[1];
      }
      flushText(i);
      const d = { k: 1, ch, left: run, len: run, open: canOpen, close: canClose, pos: i, ot: [], ct: [] };
      segs.push(d);
      delims.push(d);
      i += run; textStart = i;
      continue;
    }
    // newline: hard or soft break
    if (c === 10) {
      // count trailing spaces in the current text run
      let sp = 0;
      let j = i - 1;
      while (j >= textStart && src.charCodeAt(j) === 32) { sp++; j--; }
      if (sp >= 2) {
        flushText(i - sp);
        segs.push({ k: 0, s: '<br>' });
        i++;
        // hard break strips the next line's leading spaces/tabs
        while (i < n && (src.charCodeAt(i) === 32 || src.charCodeAt(i) === 9)) i++;
        textStart = i;
      } else {
        flushText(i);
        segs.push({ k: 0, s: '\n' });
        i++; textStart = i;
      }
      continue;
    }
    // GFM extended autolinks: www., http(s)://, bare email.
    // Suppressed inside link text (inLink): probe50.
    if (!inLink && c === 119 && src.slice(i, i + 4) === 'www.') {
      const prev = i > 0 ? src[i - 1] : '';
      const r = tryExtendedAutolink(src, i, prev);
      if (r) {
        flushText(i);
        segs.push({ k: 0, s: r.html });
        i = r.end; textStart = i;
        continue;
      }
      i++;
      continue;
    }
    if (!inLink && c === 104 && (src.slice(i, i + 7) === 'http://' || src.slice(i, i + 8) === 'https://')) {
      const prev = i > 0 ? src[i - 1] : '';
      const r = tryExtendedAutolink(src, i, prev);
      if (r) {
        flushText(i);
        segs.push({ k: 0, s: r.html });
        i = r.end; textStart = i;
        continue;
      }
      i++;
      continue;
    }
    if (!inLink && isAlphaNumCode(c)) {
      const prev = i > 0 ? src[i - 1] : '';
      if (prev === '' || (!isAlphaNumCode(prev.charCodeAt(0)) && prev !== '_' && prev !== '-' && prev !== '.' && prev !== '+')) {
        const r = tryExtendedAutolink(src, i, prev);
        if (r) {
          flushText(i);
          segs.push({ k: 0, s: r.html });
          i = r.end; textStart = i;
          continue;
        }
      }
      i++;
      continue;
    }
    i++;
  }
  flushText(n);

  // B3 poison: a delimiter run is suppressed when an inline link/image whose
  // text holds a 2+ backtick run sits before it and a code span sits after it.
  if (poison.length > 0 && codeSpans.length > 0) {
    for (const d of delims) {
      if (!d.open && !d.close) continue;
      let hasPoisonBefore = false;
      for (const pe of poison) { if (pe <= d.pos) { hasPoisonBefore = true; break; } }
      if (!hasPoisonBefore) continue;
      let hasSpanAfter = false;
      for (const cs of codeSpans) { if (cs[0] > d.pos) { hasSpanAfter = true; break; } }
      if (hasSpanAfter) { d.open = false; d.close = false; }
    }
  }

  resolveEmphasis(delims, src);

  // render segments: a closer flagged `lb` (an em-early steal from a **
  // closer) leaves its unused stars BEFORE the close tag; every other
  // partially-used closer leaves them after it
  let out = '';
  for (const s of segs) {
    if (s.k === 0) out += s.s;
    else {
      if (s.lb) {
        if (s.left > 0) out += s.ch.repeat(s.left);
        for (const t of s.ct) out += t;
        if (s.after > 0) out += s.ch.repeat(s.after);
      } else {
        for (const t of s.ct) out += t;
        if (s.left > 0) out += s.ch.repeat(s.left);
        if (s.after > 0) out += s.ch.repeat(s.after);
      }
      for (const t of s.ot) out += t;
    }
  }
  return out;
}

// The delimiter-stack algorithm: match closers with openers.
// Odd-match rule (CommonMark): if either the opener or the closer can BOTH
// open and close, and (openerLen + closerLen) is a multiple of 3, skip the
// opener unless both lengths are multiples of 3. An opener inside an
// already-formed emphasis span cannot match a closer outside that span
// (emphasis must nest, never overlap).
// Marked gate (B): an * em opener does NOT match when its content holds a
// ** strong whose opener is preceded by a non-alphanumeric char and whose
// closer is followed by an alphanumeric or whitespace char (e.g.
// "*x **y**c*" stays literal, but "*xa**y**c*" and "*x **y**.*" form the em).
// Budget check (marked emStrong forward search): when an opener looks for
// a closer, intervening same-char opener-only runs add their length to a
// budget m and closer-only runs subtract from it; a both-case run goes
// through the rule of 3 (y%3 && (y+b)%3==0 -> skipped into f). The closer
// can close the opener only if the budget is exhausted (m<=0) after
// subtracting the closer's available length. This is why "*a **b**c* d*"
// forms no em (the ** opener absorbs 2, the ** closer is rule-of-3
// skipped, single * closers only chip 1 each off a budget of 3) while
// "*a **b** c*" closes at the first * (the ** closer subtracts 2) and
// "*a **b**c* d* e*" closes at the LAST *.
// `k` is the opener's effective run length (marked retries each starting
// position inside a run, so "**a b* c" forms an em from the run's last
// star); the span uses n=min(k,bPrime) stars and is an em iff n is odd,
// a strong iff n is even. m starts at k: for "***a***" k=3 gives
// bPrime=3, n=3, an em whose text holds the inner strong.
// Returns {blocked, bPrime}: bPrime is marked's closer consumption
// min(b, b+m+f) — the stars the closer contributes to the span's raw.
// Only `use` of them are the tag; the other (bPrime-use) are literal
// stars INSIDE the span, and (left-bPrime) are literal AFTER it.
// Corrections to the naive model (marked's emStrong, verified against
// baselines/vendor/marked/marked.esm.js): a delimiter's EFFECTIVE run
// length for a pair is the FULL run when its consumed stars went to a
// span strictly inside the pair (marked finds the outer span before
// those inner spans form, so the outer raw holds the full run), else
// the remaining length. And a delimiter strictly inside a formed
// span's TEXT is skipped entirely (marked's RDelim regex
// skip-alternatives hide it; e.g. the "*" inside "__...__" in cm-470).
// A delimiter that IS a span boundary still counts at full length
// (e.g. the strong's runs in "*a **b**c*", which block the outer em).
// The naive "skip consumed / use remaining" model over-forms (B 6/28);
// the full-length model keeps B and fixes cm-408/413/416/417/426/430/470.
function emBudget(delims, src, oi, di, k, spans) {
  const opener = delims[oi];
  const closer = delims[di];
  // Effective run length of a delimiter for the (oi, di) pair: the FULL
  // run when its consumed stars went to a span strictly inside (oi, di)
  // (marked finds the outer span before those inner spans form, so the
  // outer span's raw holds the full run), else the remaining length.
  // A span strictly inside (oi, di) has sp[0] >= oi and sp[1] <= di
  // and is not the (oi, di) pair itself. This is what makes
  // "__foo_ bar_" (cm-408) form its outer em: the inner em's closer
  // counts at full length, but the budget starts at the full opener
  // run (2), so it absorbs it. It also keeps "*a **b**c*" blocked:
  // the strong's runs count at full length, inflating the budget past
  // what the final single-star closer can exhaust.
  function effLen(idx) {
    const D = delims[idx];
    if (D.left === D.len) return D.len;
    for (let s = 0; s < spans.length; s++) {
      const sp = spans[s];
      if ((sp[0] === idx || sp[1] === idx) && sp[0] >= oi && sp[1] <= di && !(sp[0] === oi && sp[1] === di)) return D.len;
    }
    return D.left;
  }
  // y is the run length of the opener as the search sees it (marked:
  // y = i-l+k = offset-in-run + k). o is true when the search starts
  // inside the remaining run (k < left): marked then breaks the search
  // at the first both-case delimiter (its lexer masked the run's
  // earlier stars), so "**warning ... *link*string**" forms no em
  // from the run's second star while "**a b* c" does.
  const y = effLen(oi);
  const o = k < opener.left;
  // m starts at k, not at y: the k-loop retries the opener at smaller
  // k, and each retry is a fresh call whose budget is its own run
  // length. The outer pair's larger budget comes from skipping the
  // nested span's closer below, not from inflating m.
  let m = k;
  let f = 0;
  // R flag (marked emStrong): the opener is preceded by a non-space char
  // and (the char after the opener run is punctuation, or the delimiter
  // is * and the preceding char is not punctuation/delimiter)
  const pCh = opener.pos > 0 ? src[opener.pos - 1] : '';
  const afterOp = opener.pos + opener.len < src.length ? src[opener.pos + opener.len] : '';
  const pNonSpace = pCh !== '' && !isWhitespaceChar(pCh);
  const afterIsPunct = afterOp !== '' && isUnicodePunct(afterOp);
  const pIsPunctDelim = pCh === '*' || pCh === '_' || (pCh !== '' && isUnicodePunct(pCh));
  const R = pNonSpace && (afterIsPunct || (opener.ch === '*' && !pIsPunctDelim));
  for (let j = oi + 1; j < di; j++) {
    const D = delims[j];
    if (D.ch !== opener.ch) continue;
    if (!D.open && !D.close) continue;
    let inSpan = false;
    for (let s = 0; s < spans.length; s++) {
      const sp = spans[s];
      // Only an opposite-EMPHASIS span hides a delimiter (marked's
      // RDelim skip-alternative hides "*" inside "__...__" and "_"
      // inside "**...**"). A "~~" del span does NOT hide it (the "**"
      // closer in "*a ~~b **c**~~*" still counts), and a same-char span
      // does not hide it either (hc-b17).
      const oppCh = opener.ch === '*' ? '_' : '*';
      if (sp[0] < j && j < sp[1] && delims[sp[0]].ch === oppCh) { inSpan = true; break; }
    }
    if (inSpan) continue; // inside an opposite-emphasis span's text (marked's RDelim skip)
    // A delimiter that closes a span opened by THIS opener is already
    // paid for (that inner span formed first, from this opener's pool),
    // so it must not subtract again — "__foo_ bar_" cm-408. A sibling
    // span's boundary is counted at full length instead (marked finds
    // the outer span before the sibling forms) — "*a **b**c*".
    let nested = false;
    for (let s = 0; s < spans.length; s++) {
      const sp = spans[s];
      if (sp[0] === oi && sp[1] === j) { nested = true; break; }
    }
    if (nested) continue;
    const cls = rdelimCls(D, src);
    const b = effLen(j);
    if (cls === 'open') { m += b; continue; }
    if (cls === 'both' || R) {
      if (o && cls === 'both') return { blocked: true, bPrime: 0 }; // masked-run break
      if (y % 3 !== 0 && (y + b) % 3 === 0) { f += b; continue; } // rule of 3: skipped
    }
    m -= b;
    if (m <= 0) return { blocked: true, bPrime: 0 }; // an intervening closer would have closed the opener first
  }
  const cCls = rdelimCls(closer, src);
  const cLen = effLen(di);
  if (cCls === 'both' || R) {
    if (o && cCls === 'both') return { blocked: true, bPrime: 0 }; // masked-run break
    if (y % 3 !== 0 && (y + cLen) % 3 === 0) return { blocked: true, bPrime: 0 };
  }
  m -= cLen;
  if (m > 0) return { blocked: true, bPrime: 0 };
  // bPrime is capped at closer.left: the tag can only use stars not
  // already inside a formed inner span.
  return { blocked: false, bPrime: Math.min(cLen, cLen + m + f, closer.left) };
}

function resolveEmphasis(delims, src) {
  const spans = [];
  for (let di = 0; di < delims.length; di++) {
    const closer = delims[di];
    if (!closer.close || closer.left === 0) continue;
    // A closer is claimed by the LEFTMOST opener it can validly close
    // (marked processes openers left-to-right, so an outer opener claims
    // its closer before an inner opener can: "*a b *c d* e*" forms the
    // outer em, "*note link **example**one* at browser*that* end" closes
    // at "that*"). The nearest-opener rule broke those: a nearer
    // both-case opener (e.g. "*browser") stole the closer and the outer
    // span never formed. For "~" (no budget) keep nearest-first.
    while (closer.left > 0) {
      let bestOi = -1, bestUse = 0, bestTag = '', bestBPrime = 0, bestK;
      let r2Fired = false;
      for (let cj = di - 1; cj >= 0; cj--) {
        const opener = delims[cj];
        if (opener.left <= 0 || !opener.open || opener.ch !== closer.ch) continue;
        let inside = false;
        for (let s = 0; s < spans.length; s++) {
          const sp = spans[s];
          if (sp[0] < cj && cj < sp[1] && sp[1] < di) { inside = true; break; }
        }
        if (inside) continue;
        const eitherBoth = (opener.open && opener.close) || (closer.open && closer.close);
        if (eitherBoth && (opener.left + closer.left) % 3 === 0 && !(opener.left % 3 === 0 && closer.left % 3 === 0)) {
          continue;
        }
        // Find the span this pair forms: try k from the opener's full
        // run down (marked retries each starting position inside a run);
        // the first k whose budget reaches the closer wins, and the span
        // is an em iff min(k, bPrime) is odd, a strong iff even.
        // Same-pair retry cap: if a span [cj, di] already formed, only
        // its (kUsed - use) opener stars lie INSIDE its text and can
        // nest; the rest sit BEFORE it (literal). A span formed by a
        // k-retry (kUsed < leftBefore) leaves (kUsed - use) stars
        // inside — 0 when kUsed == use, so "**a *b c**" must not nest
        // a second em from the same pair while "***bar***" (kUsed 3,
        // use 1) nests its strong.
        let kMax = opener.left, kUsed = 0;
        for (let s = spans.length - 1; s >= 0; s--) {
          const sp = spans[s];
          if (sp[0] === cj && sp[1] === di && sp[3] !== undefined) {
            const nestAvail = sp[3] - sp[4];
            if (nestAvail <= 0) { kMax = 0; break; }
            kMax = Math.min(opener.left, nestAvail);
            break;
          }
        }
        if (kMax <= 0) continue;
        let use = 0, bPrime = 0, tag = '';
        if (closer.ch === '*' || closer.ch === '_') {
          for (let k = kMax; k >= 1; k--) {
            const bud = emBudget(delims, src, cj, di, k, spans);
            if (bud.blocked) continue;
            const n = Math.min(k, bud.bPrime);
            use = (n % 2 === 0) ? 2 : 1;
            bPrime = bud.bPrime;
            tag = (use === 2) ? 'strong' : 'em';
            kUsed = k;
            break;
          }
          if (use === 0) continue;
        } else {
          use = (opener.left >= 2 && closer.left >= 2) ? 2 : 1;
          bPrime = use;
          tag = 'del';
        }
        // R2 (em-early): a ** closer that would form a strong is instead
        // spent (1 star) closing an outer * em when the ** opener is
        // preceded by an alphanumeric char and the closer is followed by
        // a space/punctuation char (e.g. "*xa**y** *" -> <em>xa**y*</em>).
        // The ** opener stays literal and the closer's leftover star is
        // literal inside the em.
        if (use === 2 && closer.ch === '*' && closer.left >= 2) {
          let eIdx = -1;
          for (let ej = cj - 1; ej >= 0; ej--) {
            const e = delims[ej];
            if (e.left > 0 && e.open && e.ch === '*' && e.left === 1) { eIdx = ej; break; }
            if (e.ch === '*' && e.left >= 2 && e.open) break;
          }
          if (eIdx >= 0) {
            const sOpen = opener;
            const bCh = sOpen.pos > 0 ? src[sOpen.pos - 1] : '';
            const aPos = closer.pos + closer.len;
            const aCh = aPos < src.length ? src[aPos] : '';
            const bAlnum = bCh !== '' && isAlphaNumCode(bCh.charCodeAt(0));
            const aSpPunct = aCh !== '' && (isWhitespaceChar(aCh) || isUnicodePunct(aCh));
            if (bAlnum && aSpPunct) {
              const eOpener = delims[eIdx];
              eOpener.left -= 1;
              closer.left -= 1;
              // the closer's leftover star sits INSIDE the em (before
              // </em>), unlike a plain partial closer whose leftover
              // follows the tag
              closer.lb = true;
              spans.push([eIdx, di, 'em']);
              r2Fired = true;
              break;
            }
          }
        }
        if (closer.ch === '~') { bestOi = cj; bestUse = use; bestTag = tag; bestBPrime = bPrime; break; }
        bestOi = cj; bestUse = use; bestTag = tag; bestBPrime = bPrime; bestK = kUsed;
      }
      if (r2Fired) break;
      if (bestOi < 0) break;
      const opener = delims[bestOi];
      opener.left -= bestUse;
      // bPrime split: stars beyond the span's raw stay AFTER the span
      // (closer.after); stars inside the raw but beyond the tag stay
      // available (closer.left) for an inner span and render INSIDE
      // (closer.lb). Only the tag's `use` stars are consumed here.
      if (closer.ch === '*' || closer.ch === '_') {
        closer.after = (closer.after || 0) + (closer.left - bestBPrime);
        closer.left = bestBPrime - bestUse;
        if (bestBPrime > bestUse) closer.lb = true;
      } else {
        closer.left -= bestUse;
      }
      // an em closer whose content holds a strong that is directly
      // followed by an alphanumeric char leaves its unused stars
      // INSIDE the em (before </em>), e.g. "*a **b**c***" ->
      // <em>a <strong>b</strong>c**</em>; otherwise (strong followed
      // by a space, e.g. "*a **b** c****") they stay after it
      if (bestUse === 1 && bestTag === 'em' && closer.left > 0) {
        for (let s = 0; s < spans.length; s++) {
          const sp = spans[s];
          if (sp[2] !== 'strong' || !(bestOi < sp[0] && sp[1] < di)) continue;
          const sClose = delims[sp[1]];
          const aPos = sClose.pos + sClose.len;
          const aCh = aPos < src.length ? src[aPos] : '';
          if (aCh !== '' && isAlphaNumCode(aCh.charCodeAt(0))) { closer.lb = true; break; }
        }
      }
      spans.push([bestOi, di, bestTag, bestK, bestUse]);
    }
  }
  // Rebuild opening/closing tags in nesting order from the spans.
  // For an opener, tags go outermost-first (latest closer first);
  // for a closer, tags go innermost-first (latest opener first).
  // (Spans form outermost-first, which is the reverse of what a shared
  // closer needs; extent order is correct in all cases. Ties — spans
  // sharing both delimiters, e.g. the em+strong of "***a***" — keep
  // formation order for the opener (outer first) and reverse it for
  // the closer (inner first).)
  const openBy = new Map();
  const closeBy = new Map();
  spans.forEach((sp, idx) => {
    if (!openBy.has(sp[0])) openBy.set(sp[0], []);
    openBy.get(sp[0]).push([sp, idx]);
    if (!closeBy.has(sp[1])) closeBy.set(sp[1], []);
    closeBy.get(sp[1]).push([sp, idx]);
  });
  for (const [oi, list] of openBy) {
    list.sort((a, b) => (b[0][1] - a[0][1]) || (a[1] - b[1]));
    delims[oi].ot = list.map(([sp]) => '<' + sp[2] + '>');
  }
  for (const [di2, list] of closeBy) {
    list.sort((a, b) => (b[0][0] - a[0][0]) || (b[1] - a[1]));
    delims[di2].ct = list.map(([sp]) => '</' + sp[2] + '>');
  }
}

// ------------------------------------------------------------------
// Block parser: line helpers, classification, paragraphs, containers.
// ------------------------------------------------------------------

const BLOCK_TAGS = new Set([
  'address','article','aside','base','basefont','blockquote','body','caption',
  'center','col','colgroup','dd','details','dialog','dir','div','dl','dt',
  'fieldset','figcaption','figure','footer','form','frame','frameset',
  'h1','h2','h3','h4','h5','h6','head','header','hr','html','iframe',
  'legend','li','link','main','menu','menuitem','nav','noframes','ol',
  'optgroup','option','p','param','section','source',
  'summary','table','tbody','td','tfoot','th','thead','title',
  'tr','track','ul'
]);

function isBlankLine(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

// Width of the leading whitespace run (tabs advance to the next multiple of 4).
function indentWidth(s) {
  let col = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 32) col++;
    else if (c === 9) col += 4 - (col % 4);
    else break;
  }
  return col;
}

// Remove `col` columns of leading indent (expanding tabs as needed).
// Strip a container indent (list content indent / blockquote marker).
// The remainder's leading tabs expand to spaces at absolute columns, so
// a later strip (e.g. the indented-code strip) sees the same tab stops.
function stripContainerIndent(s, col) {
  return expandLeadingTabs(stripLeading(s, col), col);
}

function stripLeading(s, col) {
  let i = 0, c = 0;
  while (i < s.length && c < col) {
    const ch = s.charCodeAt(i);
    if (ch === 32) { c++; i++; }
    else if (ch === 9) {
      const w = 4 - (c % 4);
      if (c + w > col) return ' '.repeat(c + w - col) + s.slice(i + 1);
      c += w; i++;
    } else break;
  }
  return s.slice(i);
}

// Expand leading tabs to spaces, treating `s` as starting at absolute
// column `startCol` (tabs advance to the next multiple of 4). Only the
// leading whitespace run is expanded; tabs later in the line are kept
// literally. A container strip must expand before stripping, or a
// partially-consumed tab shifts every later tab stop.
function expandLeadingTabs(s, startCol) {
  if (s.indexOf('\t') < 0) return s;
  let out = '';
  let col = startCol;
  let i = 0;
  while (i < s.length) {
    const ch = s.charCodeAt(i);
    if (ch === 32) { out += ' '; col++; i++; }
    else if (ch === 9) { const w = 4 - (col % 4); out += ' '.repeat(w); col += w; i++; }
    else break;
  }
  return out + s.slice(i);
}

// Strip up to 3 leading spaces (no tab expansion past a tab boundary).
function stripUpTo3(s) {
  let i = 0;
  while (i < s.length && i < 3 && s.charCodeAt(i) === 32) i++;
  return s.slice(i);
}

// Match a blockquote marker at the start of a line (<=3 spaces, then '>').
// Returns the remainder after '>' + one optional space, or null. A tab
// right after the marker IS the optional space (1 column consumed, the
// remainder of the tab becomes spaces); a tab after a consumed space
// expands to its full width. Leading tabs in the remainder expand to
// spaces at absolute columns.
function matchBlockquoteLine(line) {
  let i = 0;
  while (i < line.length && i < 3 && line.charCodeAt(i) === 32) i++;
  if (i < line.length && line.charCodeAt(i) === 62) {
    let j = i + 1;
    if (j < line.length && line.charCodeAt(j) === 32) j++;
    else if (j < line.length && line.charCodeAt(j) === 9) {
      const w = 4 - (j % 4);
      return ' '.repeat(w - 1) + expandLeadingTabs(line.slice(j + 1), j + w);
    }
    return expandLeadingTabs(line.slice(j), j);
  }
  return null;
}

// Match a list marker. Returns {ordered, delim, start, width, contentIndent,
// markerEnd} or null. `line` must have indent <= 3 (checked by caller).
function matchListMarker(line) {
  let i = 0;
  while (i < line.length && i < 3 && line.charCodeAt(i) === 32) i++;
  if (i >= line.length) return null;
  const c = line.charCodeAt(i);
  if (c === 42 || c === 45 || c === 43) {
    // unordered: -, +, *
    if (i + 1 >= line.length || (line.charCodeAt(i + 1) !== 32 && line.charCodeAt(i + 1) !== 9)) {
      // a bare marker with nothing after is still a list item (empty)
      if (i + 1 < line.length) return null;
    }
    const r = finishListMarker(line, i, false, '', 0, 1);
    r.bullet = line[i];
    return r;
  }
  if (isDigitCode(c)) {
    let j = i;
    while (j < line.length && isDigitCode(line.charCodeAt(j))) j++;
    const numStr = line.slice(i, j);
    if (numStr.length > 9) return null;
    if (j < line.length && (line.charCodeAt(j) === 46 || line.charCodeAt(j) === 41)) {
      const delim = line.charCodeAt(j) === 46 ? '.' : ')';
      const start = parseInt(numStr, 10);
      if (j + 1 >= line.length || (line.charCodeAt(j + 1) !== 32 && line.charCodeAt(j + 1) !== 9)) {
        if (j + 1 < line.length) return null;
      }
      return finishListMarker(line, i, true, delim, start, j - i + 1);
    }
  }
  return null;
}

function finishListMarker(line, i, ordered, delim, start, markerWidth) {
  // The marker ends at column i + markerWidth. Scan the whitespace after it
  // tracking columns (tabs advance to the next multiple of 4).
  let col = i + markerWidth;
  let k = i + markerWidth;
  let wsCols = 0;
  while (k < line.length) {
    const ch = line.charCodeAt(k);
    if (ch === 32) { col++; wsCols++; k++; }
    else if (ch === 9) { const w = 4 - (col % 4); col += w; wsCols += w; k++; }
    else break;
  }
  let contentIndent;
  if (k >= line.length) {
    // empty item (nothing after marker + spaces): indent is marker + 1
    contentIndent = i + markerWidth + 1;
  } else if (wsCols === 0 || wsCols >= 5) {
    contentIndent = i + markerWidth + 1;
  } else {
    contentIndent = col;
  }
  return {
    ordered, delim, start,
    width: markerWidth,
    contentIndent,
    markerEnd: i + markerWidth,
    indent: i
  };
}

// Match an ATX heading. Returns {level, text} or null.
function matchAtx(line) {
  let i = 0;
  while (i < line.length && i < 3 && line.charCodeAt(i) === 32) i++;
  if (i >= line.length || line.charCodeAt(i) !== 35) return null;
  let level = 0;
  while (i + level < line.length && line.charCodeAt(i + level) === 35) level++;
  if (level > 6) return null;
  const after = i + level;
  if (after < line.length && line.charCodeAt(after) !== 32 && line.charCodeAt(after) !== 9) return null;
  let text = line.slice(after).replace(/[ \t]+$/, '');
  // strip a closing sequence of #'s preceded by a space
  text = text.replace(/[ \t]+#+$/, '');
  text = text.replace(/^[ \t]+/, '');
  return { level, text };
}

// Match a thematic break. Returns true/false.
function matchHr(line) {
  let i = 0;
  while (i < line.length && i < 3 && line.charCodeAt(i) === 32) i++;
  if (i >= line.length) return false;
  const c = line.charCodeAt(i);
  if (c !== 42 && c !== 45 && c !== 95) return false;
  let count = 0;
  for (; i < line.length; i++) {
    const ch = line.charCodeAt(i);
    if (ch === c) count++;
    else if (ch !== 32 && ch !== 9) return false;
  }
  return count >= 3;
}

// Match a setext underline: a contiguous run of '=' or '-' (no spaces
// between the marks), optionally indented <=3, trailing spaces allowed.
// Returns 1 ('='), 2 ('-'), or 0.
function matchSetext(line) {
  let i = 0;
  while (i < line.length && i < 3 && line.charCodeAt(i) === 32) i++;
  if (i >= line.length) return 0;
  const c = line.charCodeAt(i);
  if (c !== 61 && c !== 45) return 0;
  let j = i;
  while (j < line.length && line.charCodeAt(j) === c) j++;
  while (j < line.length) {
    const ch = line.charCodeAt(j);
    if (ch !== 32 && ch !== 9) return 0;
    j++;
  }
  return c === 61 ? 1 : 2;
}

// Match a code fence. Returns {ch, len, info, indent} or null.
function matchFence(line) {
  let i = 0;
  while (i < line.length && i < 3 && line.charCodeAt(i) === 32) i++;
  if (i >= line.length) return null;
  const c = line.charCodeAt(i);
  if (c !== 96 && c !== 126) return null;
  let len = 0;
  while (i + len < line.length && line.charCodeAt(i + len) === c) len++;
  if (len < 3) return null;
  const info = line.slice(i + len);
  if (c === 96 && info.indexOf('`') >= 0) return null;
  return { ch: String.fromCharCode(c), len, info, indent: i };
}

// Match an HTML block start. Returns the type 1-7, or 0.
function matchHtmlBlockStart(line) {
  let i = 0;
  while (i < line.length && i < 3 && line.charCodeAt(i) === 32) i++;
  if (i >= line.length || line.charCodeAt(i) !== 60) return 0;
  const rest = line.slice(i + 1);
  const lower = rest.toLowerCase();
  if (lower.startsWith('script') || lower.startsWith('pre') || lower.startsWith('style') || lower.startsWith('textarea')) {
    const after = rest[lower.startsWith('script') ? 6 : lower.startsWith('textarea') ? 8 : lower.startsWith('style') ? 5 : 3];
    if (after === undefined || after === ' ' || after === '\t' || after === '\n' || after === '>') return 1;
  }
  if (rest.startsWith('!--')) return 2;
  if (rest.startsWith('?')) return 3;
  if (rest.startsWith('!') && rest.length > 1 && isAsciiLetter(rest.charCodeAt(1))) return 4;
  if (rest.startsWith('![CDATA[')) return 5;
  if (rest.startsWith('/') || isAsciiLetter(rest.charCodeAt(0))) {
    let j = rest.startsWith('/') ? 1 : 0;
    let name = '';
    while (j < rest.length && (isAsciiLetter(rest.charCodeAt(j)) || isDigitCode(rest.charCodeAt(j)) || rest.charCodeAt(j) === 45)) {
      name += rest[j];
      j++;
    }
    if (name.length > 0) {
      const nm = name.toLowerCase();
      // type 6: a block tag name starts the line -- the tag itself may
      // span lines (cm-153/154/156/157/158), no complete tag required
      if (BLOCK_TAGS.has(nm)) return 6;
      // type 7: a complete tag ALONE on the line (cm-168/344: a tag
      // followed by more content is not a type-7 block)
      const tag = tryHtmlTag(line, i);
      if (!tag) return 0;
      if (line.slice(tag.end).trim() !== '') return 0;
      return 7;
    }
  }
  return 0;
}

// Does this line start an interrupting block (one that can end a paragraph)?
function startsInterruptBlock(line, inListItem) {
  const ind = indentWidth(line);
  if (ind >= 4) return false;
  const s = stripUpTo3(line);
  if (s.length === 0) return false;
  const c = s.charCodeAt(0);
  if (c === 35) return matchAtx(line) !== null;
  if (c === 62) return true;
  if (c === 96 || c === 126) return matchFence(line) !== null;
  if (c === 60) {
    const t = matchHtmlBlockStart(line);
    return t >= 1 && t <= 6;
  }
  if (c === 42 || c === 45 || c === 95) {
    if (matchHr(line)) {
      // a setext underline ('---' / '===') does NOT interrupt
      return matchSetext(line) === 0;
    }
  }
  if (c === 42 || c === 45 || c === 43) {
    const m = matchListMarker(line);
    if (!m) return false;
    // an empty list item cannot interrupt a paragraph (cm-367)
    let k = m.markerEnd;
    while (k < line.length && (line.charCodeAt(k) === 32 || line.charCodeAt(k) === 9)) k++;
    return k < line.length;
  }
  if (isDigitCode(c)) {
    const m = matchListMarker(line);
    if (!m) return false;
    // an ordered list can only interrupt a paragraph if it starts with 1,
    // EXCEPT inside a list item where any start number interrupts (nested
    // list, e.g. "+ foo\n  49. bar")
    if (m.ordered && m.start !== 1 && !inListItem) return false;
    let k = m.markerEnd;
    while (k < line.length && (line.charCodeAt(k) === 32 || line.charCodeAt(k) === 9)) k++;
    return k < line.length;
  }
  return false;
}

// ---- tables ----

// Is this line a valid table delimiter row? Returns the alignment array or null.
function parseTableDelimiter(line) {
  const s = line.trim();
  if (s.indexOf('|') < 0) return null;
  let inner = s;
  if (inner.startsWith('|')) inner = inner.slice(1);
  if (inner.endsWith('|')) inner = inner.slice(0, -1);
  const cells = inner.split('|');
  const aligns = [];
  for (const cell of cells) {
    const t = cell.trim();
    if (!/^:?-+:?$/.test(t)) return null;
    if (t.startsWith(':') && t.endsWith(':')) aligns.push('center');
    else if (t.endsWith(':')) aligns.push('right');
    else if (t.startsWith(':')) aligns.push('left');
    else aligns.push(null);
  }
  return aligns;
}

// Split a table row line into cells (handles escaped pipes and code spans).
function splitTableRow(line) {
  let s = line.trim();
  // a leading pipe (after optional spaces) is dropped; trailing pipe dropped
  let i = 0;
  while (i < s.length && (s.charCodeAt(i) === 32 || s.charCodeAt(i) === 9)) i++;
  if (s.charCodeAt(i) === 124) { s = s.slice(i + 1); }
  // trailing pipe
  let e = s.length - 1;
  while (e >= 0 && (s.charCodeAt(e) === 32 || s.charCodeAt(e) === 9)) e--;
  if (e >= 0 && s.charCodeAt(e) === 124) {
    // make sure the trailing pipe is not escaped
    let bs = 0;
    let k = e - 1;
    while (k >= 0 && s.charCodeAt(k) === 92) { bs++; k--; }
    if (bs % 2 === 0) s = s.slice(0, e);
  }
  const cells = [];
  let cur = '';
  let inCode = false;
  let codeRun = 0;
  for (let p = 0; p < s.length; p++) {
    const ch = s.charCodeAt(p);
    if (ch === 96) {
      let run = 0;
      while (p + run < s.length && s.charCodeAt(p + run) === 96) run++;
      if (!inCode) {
        // a backtick run only opens a code span when a matching closer
        // exists later in the line; otherwise it is literal text
        if (findCodeClose(s, p, run) >= 0) { inCode = true; codeRun = run; }
      } else if (run === codeRun) { inCode = false; codeRun = 0; }
      cur += s.slice(p, p + run);
      p += run - 1;
      continue;
    }
    if (ch === 92 && p + 1 < s.length && s.charCodeAt(p + 1) === 124) {
      cur += '|';
      p++;
      continue;
    }
    if (ch === 124 && !inCode) {
      cells.push(cur.trim());
      cur = '';
      continue;
    }
    cur += s[p];
  }
  cells.push(cur.trim());
  return cells;
}

// ---- reference definitions ----

// Try to parse a reference definition starting at lines[idx].
// Returns {href, title, linesUsed} or null.
// Handles labels, destinations, and titles spanning lines.
function tryRefDef(lines, idx, hi) {
  // join up to 6 lines with \n; track where each line starts
  const parts = [];
  const starts = [];
  let src = '';
  for (let k = idx; k < Math.min(idx + 6, hi); k++) {
    starts.push(src.length);
    if (k > idx) src += '\n';
    src += lines[k];
    parts.push(lines[k]);
  }
  const n = src.length;
  let i = 0;
  while (i < n && i < 3 && src.charCodeAt(i) === 32) i++;
  if (i >= n || src.charCodeAt(i) !== 91) return null;
  // find the closing ] (label may span lines; no unescaped [ or ] inside)
  let j = i + 1;
  let close = -1;
  while (j < n) {
    const c = src.charCodeAt(j);
    if (c === 92 && j + 1 < n && isPunctCode(src.charCodeAt(j + 1))) { j += 2; continue; }
    if (c === 91) return null; // nested [ in label
    if (c === 93) { close = j; break; }
    j++;
  }
  if (close < 0) return null;
  const labelRaw = src.slice(i + 1, close);
  if (labelRaw.trim() === '') return null;
  // no unescaped ] inside (the first ] closes it, so none can remain)
  let p = close + 1;
  const skipWs = () => { while (p < n && (src.charCodeAt(p) === 32 || src.charCodeAt(p) === 9 || src.charCodeAt(p) === 10)) p++; };
  skipWs();
  if (p >= n || src.charCodeAt(p) !== 58) return null;
  p++;
  // destination: same line, or the next line (but not after a blank line)
  {
    let q = p;
    while (q < n && (src.charCodeAt(q) === 32 || src.charCodeAt(q) === 9)) q++;
    if (q >= n) return null;
    if (src.charCodeAt(q) === 10) {
      // try the next line only if it is not blank
      let r = q + 1;
      while (r < n && (src.charCodeAt(r) === 32 || src.charCodeAt(r) === 9)) r++;
      if (r >= n || src.charCodeAt(r) === 10) return null;
      p = r;
    } else {
      p = q;
    }
  }
  if (p >= n) return null;
  // destination
  let href = '';
  if (src.charCodeAt(p) === 60) {
    p++;
    const ds = p;
    let ok = false;
    while (p < n) {
      const c = src.charCodeAt(p);
      if (c === 62) { ok = true; break; }
      if (c === 10 || c === 60) return null;
      if (c === 92 && p + 1 < n && isPunctCode(src.charCodeAt(p + 1))) { p += 2; continue; }
      p++;
    }
    if (!ok) return null;
    href = src.slice(ds, p);
    // decode escapes inside <...>
    let dh = '';
    for (let q = 0; q < href.length; q++) {
      if (href.charCodeAt(q) === 92 && q + 1 < href.length && isPunctCode(href.charCodeAt(q + 1))) { dh += href[q + 1]; q++; }
      else dh += href[q];
    }
    href = dh;
    p++; // past '>'
  } else {
    const ds = p;
    let depth = 0;
    while (p < n) {
      const c = src.charCodeAt(p);
      if (c === 32 || c === 9 || c === 10) break;
      if (c === 40) { depth++; p++; continue; }
      if (c === 41) {
        if (depth === 0) break;
        depth--; p++; continue;
      }
      if (c === 92 && p + 1 < n && isPunctCode(src.charCodeAt(p + 1))) { p += 2; continue; }
      p++;
    }
    if (p === ds) return null;
    if (depth !== 0) return null;
    let dh = src.slice(ds, p);
    let out = '';
    for (let q = 0; q < dh.length; q++) {
      if (dh.charCodeAt(q) === 92 && q + 1 < dh.length && isPunctCode(dh.charCodeAt(q + 1))) { out += dh[q + 1]; q++; }
      else out += dh[q];
    }
    href = out;
  }
  // optional title: on the same line (after whitespace) or on a following
  // line. A title immediately after the destination with no whitespace
  // is invalid (cm-201).
  let title = null;
  let pAfter = p;
  const skipSpaces = () => { while (p < n && (src.charCodeAt(p) === 32 || src.charCodeAt(p) === 9)) p++; };
  const parseTitleAt = () => {
    const c = src.charCodeAt(p);
    if (c !== 34 && c !== 39 && c !== 40) return false;
    const closer = c === 40 ? 41 : c;
    let q = p + 1;
    let out = '';
    let closed = false;
    let prevNl = false;
    while (q < n) {
      const ch = src.charCodeAt(q);
      // a title cannot contain a blank line (cm-197)
      if (ch === 10) {
        if (prevNl) return false;
        prevNl = true;
      } else prevNl = false;
      if (ch === 92 && q + 1 < n && isPunctCode(src.charCodeAt(q + 1))) { out += src[q + 1]; q += 2; prevNl = false; continue; }
      if (ch === closer) { closed = true; break; }
      out += src[q];
      q++;
    }
    if (!closed) return false;
    title = decodeInlineEntities(out);
    p = q + 1;
    return true;
  };
  // same-line title: requires whitespace between destination and title
  {
    const save = p;
    skipSpaces();
    if (p > save && p < n && (src.charCodeAt(p) === 34 || src.charCodeAt(p) === 39 || src.charCodeAt(p) === 40)) {
      if (!parseTitleAt()) return null;
    } else {
      p = save;
    }
  }
  if (title === null) {
    // next-line title: skip to the next line, then spaces. If the title
    // is invalid or followed by junk, fall back to no title (cm-210):
    // the destination line is blank after the destination, so the ref
    // def is still valid and the title line is a separate paragraph.
    const destEnd = p;
    const save = p;
    skipSpaces();
    let titled = false;
    if (p < n && src.charCodeAt(p) === 10) {
      p++;
      skipSpaces();
      if (p < n && (src.charCodeAt(p) === 34 || src.charCodeAt(p) === 39 || src.charCodeAt(p) === 40)) {
        if (parseTitleAt()) {
          // rest of the title line must be blank
          let r = p;
          while (r < n && (src.charCodeAt(r) === 32 || src.charCodeAt(r) === 9)) r++;
          if (r >= n || src.charCodeAt(r) === 10) titled = true;
        }
      }
    }
    if (!titled) {
      title = null;
      p = destEnd;
    }
  }
  pAfter = p;
  // the rest of the line must be blank (only spaces/tabs to EOL)
  {
    let r = pAfter;
    while (r < n && (src.charCodeAt(r) === 32 || src.charCodeAt(r) === 9)) r++;
    if (r < n && src.charCodeAt(r) !== 10) return null;
    pAfter = r;
  }
  // lines used: count newlines before pAfter
  let linesUsed = 1;
  for (let q = 0; q < pAfter && q < n; q++) if (src.charCodeAt(q) === 10) linesUsed++;
  const key = normalizeLabel(labelRaw);
  return { key, href: decodeInlineEntities(href), title, linesUsed };
}

// Parse a title ('...' or "..." or (...)) at position `pos` in `line`.
// Returns {title, end} or null.
function parseRefTitle(line, pos) {
  let i = pos;
  while (i < line.length && (line.charCodeAt(i) === 32 || line.charCodeAt(i) === 9)) i++;
  if (i >= line.length) return null;
  const c = line.charCodeAt(i);
  if (c !== 34 && c !== 39 && c !== 40) return null;
  const closer = c === 40 ? 41 : c;
  let j = i + 1;
  let out = '';
  while (j < line.length) {
    const ch = line.charCodeAt(j);
    if (ch === 92 && j + 1 < line.length && isPunctCode(line.charCodeAt(j + 1))) {
      out += line[j + 1];
      j += 2;
      continue;
    }
    if (ch === closer) return { title: decodeInlineEntities(out), end: j + 1 };
    out += line[j];
    j++;
  }
  return null;
}

// ------------------------------------------------------------------
// Block parser main loop (lines are {s, rel, para} objects).
//   s    = container-stripped line (for block classification)
//   rel  = indent of the line relative to its container content indent
//   para = paragraph text of the line (L3-adjusted inside containers)
// ------------------------------------------------------------------

// Convert plain strings to line objects (top level: no container adjustment).
function toLineObjects(lines) {
  return lines.map(l => ({ s: l, rel: indentWidth(l), para: l }));
}

function splitLines(md) {
  const raw = md.split('\n');
  // strip a trailing \r (CRLF) from each line
  for (let i = 0; i < raw.length; i++) {
    if (raw[i].endsWith('\r')) raw[i] = raw[i].slice(0, -1);
  }
  // if the input ends with a newline, the last element is '' (a phantom line);
  // drop it so it does not count as a trailing blank line
  if (raw.length > 0 && raw[raw.length - 1] === '' && md.endsWith('\n')) raw.pop();
  return raw;
}

// Collect a paragraph starting at lines[i]. Returns {nodes, next}.
// Handles setext headings, reference definitions, L2 splits, and tables.
function collectParagraph(lines, i, hi, refs, ctx) {
  const nodes = [];
  let j = i;
  let paraLines = []; // array of text strings
  let paraRels = [];
  let paraIdx = []; // original line index of each paraLine
  let atStart = true; // still at the start (ref defs allowed)
  let curRel = lines[i].rel;
  // afterCode: the previous paragraph line was an indented-code merge
  // (a lazy continuation dedented by 4); marked's code token keeps a
  // trailing \n, so the NEXT non-code line is separated by a blank
  // line. Consecutive code-merged lines join with a single \n.
  let afterCode = false;

  function finalizePara() {
    if (paraLines.length === 0) return;
    // table check
    let tableAt = -1;
    let aligns = null;
    for (let h = 0; h + 1 < paraLines.length; h++) {
      if (paraLines[h].indexOf('|') < 0) continue;
      const a = parseTableDelimiter(paraLines[h + 1]);
      if (!a) continue;
      // header and delimiter must have the same cell count (gfm-203)
      if (a.length !== splitTableRow(paraLines[h]).length) continue;
      tableAt = h; aligns = a; break;
    }
    if (tableAt >= 0) {
      if (tableAt > 0) {
        nodes.push({ t: 'p', text: paraLines.slice(0, tableAt).join('\n') });
      }
      const header = splitTableRow(paraLines[tableAt]);
      const rows = [];
      for (let r = tableAt + 2; r < paraLines.length; r++) {
        rows.push(splitTableRow(paraLines[r]));
      }
      nodes.push({ t: 'table', header, aligns, rows });
    } else {
      // a paragraph whose last line is a lazy list-item continuation
      // keeps a trailing newline before </p> (marked: "902554. foo:\n
      //     lazy\n\n2. next" -> "<p>foo:\nlazy\n</p>")
      const lastIdx = paraIdx.length > 0 ? paraIdx[paraIdx.length - 1] : -1;
      const lazyEnd = lastIdx >= 0 && lines[lastIdx] && lines[lastIdx].lazy === true && lines[lastIdx].rel >= 4;
      const node = { t: 'p', text: paraLines.join('\n') };
      if (lazyEnd) node.lazyEnd = true;
      // codeEnd: the paragraph's last line is an indented-code merge in
      // marked's item-text lexing (state.top=false), so the text token
      // ends with \n and a following block gets a preceding \n
      // ("indented four\n<ul>"). Inside a list item any rel >= 4 line
      // is code; inside a blockquote the chunk rule decides (codeMerged)
      // and the generic <p> render does not use this flag.
      let codeEnd = false;
      if (ctx.inListItem && paraLines.length > 1 && lastIdx >= 0 && lines[lastIdx]) {
        codeEnd = paraRels[paraRels.length - 1] >= 4;
      }
      if (codeEnd) node.codeEnd = true;
      nodes.push(node);
    }
    paraLines = [];
    paraRels = [];
    paraIdx = [];
    afterCode = false;
  }

  // first line
  while (j < hi) {
    const L = lines[j];
    const s = L.s;
    if (isBlankLine(s) && !L.spc) {
      // a trailing whitespace-only line at EOF is kept in the paragraph
      // (X: "| a |\n   " keeps the "   " line)
      if (s.length > 0 && j === hi - 1 && paraLines.length > 0) {
        paraLines.push(ctx.inContainer ? L.para : L.s);
        paraRels.push(L.rel);
        paraIdx.push(j);
        atStart = false;
        j++;
        continue;
      }
      // a tab-only line is a table body row (empty cells) when a table
      // is already open, not a paragraph end
      if (s.indexOf('\t') >= 0 && paraLines.length >= 2) {
        let isTable = false;
        for (let h = 0; h + 1 < paraLines.length; h++) {
          if (paraLines[h].indexOf('|') < 0) continue;
          const a = parseTableDelimiter(paraLines[h + 1]);
          if (a && a.length === splitTableRow(paraLines[h]).length) { isTable = true; break; }
        }
        if (isTable) {
          paraLines.push(ctx.inContainer ? L.para : L.s);
          paraRels.push(L.rel);
          paraIdx.push(j);
          atStart = false;
          j++;
          continue;
        }
      }
      break;
    }
    // reference definition at the start of a paragraph
    if (atStart) {
      const rd = tryRefDefLines(lines, j, hi);
      if (rd) {
        if (!refs.has(rd.key)) refs.set(rd.key, { href: rd.href, title: rd.title });
        j += rd.linesUsed;
        continue;
      }
    }
    // setext underline (only if we already have paragraph content, and
    // the line is not a lazy setext line flagged as non-heading)
    const se = matchSetext(s);
    if (se > 0 && paraLines.length > 0 && !L.ns) {
      // an autolink line never takes setext (H: <foo@bar.com>\n--- is
      // a paragraph + <hr>, not a heading); end the paragraph so the
      // --- line becomes an <hr>
      const single = paraLines.length === 1 ? paraLines[0].trim() : '';
      let isAuto = false;
      if (single.length > 0 && single.charCodeAt(0) === 60) {
        const a = tryAngle(single, 0);
        if (a && a.end === single.length) isAuto = true;
      }
      if (isAuto) break;
      // a setext underline cannot follow a paragraph containing an
      // HTML-block line (probe61: "foo\n</picture>\n--- " is a paragraph
      // + an HTML block, not a heading): end the paragraph just before
      // that HTML line and re-process from there
      let htmlAt = -1;
      for (let k = 1; k < paraLines.length; k++) {
        if (matchHtmlBlockStart(lines[paraIdx[k]].s) > 0) { htmlAt = k; break; }
      }
      if (htmlAt >= 0) {
        const saveLines = paraLines.slice(0, htmlAt);
        const saveRels = paraRels.slice(0, htmlAt);
        const saveIdx = paraIdx.slice(0, htmlAt);
        const htmlLine = paraIdx[htmlAt];
        paraLines = saveLines; paraRels = saveRels; paraIdx = saveIdx;
        finalizePara();
        return { nodes, next: htmlLine };
      }
      const level = se;
      let text = paraLines.join('\n');
      text = text.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
      paraLines = [];
      paraRels = [];
      paraIdx = [];
      afterCode = false;
      nodes.push({ t: 'h', level, text });
      j++;
      return { nodes, next: j };
    }
    // a setext-looking line with no paragraph yet is plain paragraph text
    // interrupting block ends the paragraph (but not the first line, and
    // not before any ref def has been consumed). A lazy type-7 HTML line
    // flagged html7 is a separate HTML block, not paragraph text.
    // EXCEPTION: once a table header+delimiter is open, ANY non-blank
    // line (even an HTML-block line) becomes a table body row (T2).
    if (L.html7 && paraLines.length > 0) break;
    if (startsInterruptBlock(s, ctx.inListItem) && (paraLines.length > 0 || j > i)) {
      let tableOpen = false;
      if (paraLines.length >= 2) {
        for (let h = 0; h + 1 < paraLines.length; h++) {
          if (paraLines[h].indexOf('|') < 0) continue;
          const a = parseTableDelimiter(paraLines[h + 1]);
          if (a && a.length === splitTableRow(paraLines[h]).length) { tableOpen = true; break; }
        }
      }
      // only an HTML-block line becomes a body row (T2); a blockquote,
      // heading, list, fence, or HR still ends the table (gfm-201)
      if (!tableOpen || matchHtmlBlockStart(s) === 0) break;
      // table is open and this is an HTML line: fall through and push
      // it as a body row
    }
    // L2 split (inside list items only: a paragraph line with rel >= 4
    // followed by a rel < 4 line ends the paragraph. A blockquote
    // continuation keeps its indent and does NOT split, e.g.
    // "> foo\n>\t\tbar\n> baz" stays one paragraph. A LAZY prev line
    // does NOT split either: in marked's item-text lexing it is a
    // code-merge (afterCode blank), and splitting would break a
    // trailing-backslash hard break (52-doc-30: "bar\" + "\n\n" must
    // render as "<br>\n", not a literal "\" plus a paragraph split).
    if (ctx.inListItem && paraLines.length > 0) {
      const prevRel = paraRels[paraRels.length - 1];
      const prevIdx = paraIdx[paraIdx.length - 1];
      const prevLazy = prevIdx >= 0 && lines[prevIdx] && lines[prevIdx].lazy === true;
      if (prevRel >= 4 && L.rel < 4 && !prevLazy) {
        finalizePara();
        atStart = true;
        // fall through: the current line starts a new paragraph
      }
    }
    paraLines.push(ctx.inContainer ? L.para : L.s);
    paraRels.push(L.rel);
    paraIdx.push(j);
    // a code-merged continuation arms the blank for the next line;
    // a plain line after one consumes it as a blank line first
    if (L.codeMerged && paraLines.length > 1) afterCode = true;
    else if (!L.codeMerged) {
      if (afterCode && paraLines.length > 1) {
        // insert the blank BEFORE the line just pushed: it is the last
        // entry, so splice it in front of it
        paraLines.splice(paraLines.length - 1, 0, '');
        paraRels.splice(paraRels.length - 1, 0, 0);
        paraIdx.splice(paraIdx.length - 1, 0, j);
      }
      afterCode = false;
    }
    atStart = false;
    j++;
    // a lazy setext line is paragraph text, but it ENDS the paragraph
    // (L2): the next line starts a fresh paragraph
    if (L.ns) {
      finalizePara();
      atStart = true;
    }
  }
  finalizePara();
  return { nodes, next: j };
}

// Reference definitions work on the raw line strings; lines here are objects.
function tryRefDefLines(lines, idx, hi) {
  // build a plain-string view for the lines involved (max 6 lines)
  const plain = [];
  for (let k = idx; k < Math.min(idx + 6, hi); k++) plain.push(lines[k].s);
  const r = tryRefDef(plain, 0, plain.length);
  return r;
}

// The main block parser. `lines` is an array of line objects.
// `ctx` = {inContainer: bool}.
function parseBlocks(lines, lo, hi, refs, ctx) {
  const nodes = [];
  let i = lo;
  let sawBlank = false;
  let blankSep = false;
  while (i < hi) {
    const L = lines[i];
    const line = L.s;
    if (isBlankLine(line) && !L.spc) { sawBlank = true; i++; continue; }
    if (sawBlank && nodes.length > 0) blankSep = true;
    sawBlank = false;

    // blockquote
    const bq = matchBlockquoteLine(line);
    if (bq !== null) {
      const inner = [];
      let j = i;
      let lastWasPara = false;
      // chunk tracking (marked lexes each blockquote chunk separately
      // with state.top=true; a chunk is [lazy lines] + [> lines], so a
      // lazy line after a > line starts a NEW chunk). If a chunk starts
      // with a code-indented lazy line (rel >= 4), the whole lazy run
      // is ONE indented-code token: every line strips 4, consecutive
      // lines join with a single \n, no blank (46-doc-30, 59-doc-31,
      // 63-doc-23/35/36). If the chunk starts with a plain line, ALL
      // its lazy lines are paragraph continuations with full indent
      // kept (47-doc-27, 69-doc-34). Only the chunk's FIRST lazy line
      // decides; a later line never flips the chunk's kind.
      let atChunkStart = true;
      let chunkCode = false;
      let sawLazy = false;
      let inFence = null; // {ch, len} while a fenced block is open inside
      while (j < hi) {
        const lj = lines[j].s;
        const m = matchBlockquoteLine(lj);
        if (m !== null) {
          const rel = indentWidth(m);
          // a > line whose content is only spaces (e.g. ">  " -> " ") is
          // paragraph content, not a blank line, when a paragraph is
          // ongoing (cm-241: "> foo\n>  " -> <p>foo\n </p>)
          const spaceOnly = m.length > 0 && m.trim() === '' && lastWasPara;
          // para is the paragraph text: the full container-stripped
          // content (a paragraph continuation keeps its indent, even
          // when rel >= 4); the code branch strips 4 from s itself
          inner.push({ s: m, rel, para: m, spc: spaceOnly, bq: true });
          atChunkStart = true;
          // track fenced blocks: a lazy (non->) line cannot be fence
          // content, so it ends the blockquote while a fence is open
          const f = matchFence(m);
          if (inFence) {
            if (f && f.ch === inFence.ch && f.len >= inFence.len && f.info.trim() === '') inFence = null;
          } else if (f) {
            inFence = { ch: f.ch, len: f.len };
          }
          // indented code is not a paragraph (cm-236: a lazy indented
          // line after code ends the blockquote). A nested container
          // counts as a paragraph if its innermost content is one:
          // strip all > levels and list markers before testing for
          // an interrupting block.
          let innerMost = m;
          for (;;) {
            const mm = matchBlockquoteLine(innerMost);
            if (mm !== null) { innerMost = mm; continue; }
            const lm = matchListMarker(innerMost);
            if (lm) {
              const after = innerMost.slice(lm.markerEnd).replace(/^[ \t]+/, '');
              if (after.length > 0) { innerMost = after; continue; }
            }
            break;
          }
          lastWasPara = !isBlankLine(innerMost) && !startsInterruptBlock(innerMost) && rel < 4;
          j++;
          continue;
        }
        // a truly blank line (no > marker) ends the blockquote (cm-242).
        // Only a > line (even empty) keeps it going.
        if (isBlankLine(lj)) break;
        // inside a fence, a lazy line ends the blockquote (it cannot be
        // fence content)
        if (inFence) break;
        // lazy continuation: a setext-looking line cannot be a heading here
        // (setext underlines cannot be lazy). If it is also an HR it ends
        // the blockquote; otherwise it joins the paragraph as text. In a
        // blockquote, a setext lazy line that follows another lazy line is
        // indented by 4 spaces so it cannot be re-read as a heading.
        // A type-7 HTML line (complete non-block tag, e.g. <picture>,
        // <br>) stays lazy inside the blockquote; a type-6 block tag
        // (e.g. <div>) ends it (probe59).
        const htmlType = matchHtmlBlockStart(lj);
        if (lastWasPara && !matchHr(lj) && (!startsInterruptBlock(lj) || matchSetext(lj) > 0 || htmlType === 7)) {
          const rel = indentWidth(lj);
          const isSetextLazy = matchSetext(lj) > 0;
          if (atChunkStart) { chunkCode = rel >= 4; atChunkStart = false; }
          const isCode = chunkCode && rel >= 4;
          const para = (isSetextLazy && sawLazy) ? '    ' + lj : (isCode ? stripLeading(lj, 4) : lj);
          // a type-7 HTML lazy line that is the FIRST lazy line is a
          // separate HTML block inside the blockquote, not paragraph
          // text (probe60); once a lazy paragraph line exists it joins
          inner.push({ s: lj, rel, para, ns: isSetextLazy, html7: htmlType === 7 && !sawLazy, codeMerged: isCode });
          lastWasPara = !startsInterruptBlock(lj);
          sawLazy = true;
          j++;
          continue;
        }
        break;
      }
      const children = parseBlocks(inner, 0, inner.length, refs, { inContainer: true });
      nodes.push({ t: 'bq', children });
      i = j;
      continue;
    }

    // thematic break (checked before list: '- - -' is an HR, not a list)
    if (matchHr(line)) {
      nodes.push({ t: 'hr' });
      i++;
      continue;
    }

    // list
    const lm = matchListMarker(line);
    if (lm) {
      const r = parseList(lines, i, hi, refs, ctx);
      nodes.push(r.node);
      i = r.next;
      continue;
    }

    // ATX heading
    const atx = matchAtx(line);
    if (atx) {
      nodes.push({ t: 'h', level: atx.level, text: atx.text });
      i++;
      continue;
    }

    // fenced code
    const fence = matchFence(line);
    if (fence) {
      const content = [];
      let j = i + 1;
      while (j < hi) {
        const lj = lines[j].s;
        const close = matchFence(lj);
        if (close && close.ch === fence.ch && close.len >= fence.len && close.info.trim() === '') break;
        content.push(stripLeading(lj, fence.indent));
        j++;
      }
      // drop exactly one trailing blank line (probe28)
      if (content.length > 0 && content[content.length - 1] === '') content.pop();
      nodes.push({ t: 'fence', info: fence.info, lines: content });
      i = (j < hi) ? j + 1 : j;
      continue;
    }

    // HTML block
    const htmlType = matchHtmlBlockStart(line);
    if (htmlType > 0) {
      const content = [line];
      let j = i + 1;
      if (htmlType === 1) {
        const tag = line.toLowerCase().includes('<script') ? 'script' : line.toLowerCase().includes('<textarea') ? 'textarea' : line.toLowerCase().includes('<style') ? 'style' : 'pre';
        const endTag = '</' + tag;
        if (!line.toLowerCase().includes(endTag)) {
          while (j < hi) {
            content.push(lines[j].s);
            if (lines[j].s.toLowerCase().includes(endTag)) { j++; break; }
            j++;
          }
        }
      } else if (htmlType === 2) {
        if (!line.includes('-->')) {
          while (j < hi) {
            content.push(lines[j].s);
            if (lines[j].s.includes('-->')) { j++; break; }
            j++;
          }
        }
      } else if (htmlType === 3) {
        if (!line.includes('?>')) {
          while (j < hi) {
            content.push(lines[j].s);
            if (lines[j].s.includes('?>')) { j++; break; }
            j++;
          }
        }
      } else if (htmlType === 4) {
        if (!line.includes('>')) {
          while (j < hi) {
            content.push(lines[j].s);
            if (lines[j].s.includes('>')) { j++; break; }
            j++;
          }
        }
      } else if (htmlType === 5) {
        if (!line.includes(']]>')) {
          while (j < hi) {
            content.push(lines[j].s);
            if (lines[j].s.includes(']]>')) { j++; break; }
            j++;
          }
        }
      } else {
        // types 6-7: run to a blank line
        while (j < hi && !isBlankLine(lines[j].s)) {
          content.push(lines[j].s);
          j++;
        }
      }
      // trailing newline: append \n only when the next line is a non-blank
      // block start (the block is immediately followed by another block).
      // When followed by a blank line (types 6-7) or at EOF, no trailing \n.
      const nl = j < hi && !isBlankLine(lines[j].s);
      nodes.push({ t: 'html', lines: content, nl });
      i = j;
      continue;
    }

    // indented code
    if (L.rel >= 4) {
      const content = [];
      let j = i;
      while (j < hi) {
        const lj = lines[j].s;
        if (isBlankLine(lj)) {
          // blank line: include if followed by an indented line, keeping
          // the line's content after stripping 4 columns (spaces remain)
          let k = j + 1;
          while (k < hi && isBlankLine(lines[k].s)) k++;
          if (k < hi && lines[k].rel >= 4) {
            content.push(stripLeading(lj, 4));
            j++;
            continue;
          }
          break;
        }
        if (lines[j].rel >= 4) {
          // a list item's first line carries its code content in `code`
          // (stripped from marker+1, not from the content indent);
          // every other line strips 4 from its container-stripped text
          content.push(lines[j].code !== undefined ? lines[j].code : stripLeading(lj, 4));
          j++;
          continue;
        }
        break;
      }
      // trim trailing blank lines
      while (content.length > 0 && content[content.length - 1] === '') content.pop();
      nodes.push({ t: 'code', lines: content });
      i = j;
      continue;
    }

    // paragraph
    const pr = collectParagraph(lines, i, hi, refs, ctx);
    for (const nd of pr.nodes) nodes.push(nd);
    i = pr.next > i ? pr.next : i + 1;
  }
  nodes.blankSep = blankSep;
  return nodes;
}

// ------------------------------------------------------------------
// List parsing.
// ------------------------------------------------------------------

// Is this line fence-like (starts with ``` or ~~~ after <=3 spaces)?
function isFenceLike(line) {
  let i = 0;
  while (i < line.length && i < 3 && line.charCodeAt(i) === 32) i++;
  if (i >= line.length) return false;
  const c = line.charCodeAt(i);
  if (c !== 96 && c !== 126) return false;
  let len = 0;
  while (i + len < line.length && line.charCodeAt(i + len) === c) len++;
  return len >= 3;
}

// Content of a list item's first line: the substring starting at the
// `target` column (marker + following whitespace consumed), with any
// leading tabs expanded to spaces at absolute columns.
function itemContentTo(line, marker, target) {
  let col = marker.indent + marker.width;
  let idx = marker.markerEnd;
  while (idx < line.length && col < target) {
    const ch = line.charCodeAt(idx);
    if (ch === 32) { col++; idx++; }
    else if (ch === 9) {
      const w = 4 - (col % 4);
      if (col + w > target) return ' '.repeat(col + w - target) + expandLeadingTabs(line.slice(idx + 1), col + w);
      col += w; idx++;
    } else break;
  }
  return expandLeadingTabs(line.slice(idx), col);
}

// Is this line a single complete INLINE html tag (not a block tag)?
// Such a line inside a list-item paragraph appends to the previous
// line with no newline (L3: "- foo\n<br>" -> "foo<br>").
function isInlineTagLine(s) {
  const t = s.trim();
  if (t.length < 3 || t.charCodeAt(0) !== 60) return false;
  // a type-7 HTML block (a complete tag alone on the line, e.g.
  // </picture>) is a block-level line, never an inline tag to glue onto
  // the previous line — gluing it would break a table delimiter row.
  // Void line-break elements (<br>, <br/>) are the exception: they are
  // inline and must still glue.
  if (matchHtmlBlockStart(s) === 7) {
    const m = /^<\/?(br|wbr)\s*\/?>$/i.exec(t);
    if (!m) return false;
  }
  const tag = tryHtmlTag(t, 0);
  if (!tag || tag.end !== t.length) return false;
  // extract the tag name (after '<' and an optional '/')
  let p = 1;
  if (t.charCodeAt(p) === 47) p++;
  let q = p;
  while (q < t.length && /[A-Za-z0-9-]/.test(t[q])) q++;
  if (q === p) return false;
  const name = t.slice(p, q).toLowerCase();
  return !BLOCK_TAGS.has(name);
}

function collectListItem(lines, i, hi, refs, marker) {
  const contentIndent = marker.contentIndent;
  const itemLines = [];
  const firstLine = lines[i].s;
  const content = itemContentTo(firstLine, marker, marker.contentIndent);
  const rel0 = indentWidth(content);
  // the first line's indented-code content is stripped from the marker +
  // 1 column (a tab after the marker counts as one space here), not from
  // the content indent used for continuation lines; it lives in `code`
  // because `para` is the paragraph text (full content)
  const firstLineBase = marker.indent + marker.width + 1;
  const firstObj = { s: content, rel: rel0, para: content };
  if (rel0 >= 4) firstObj.code = itemContentTo(firstLine, marker, firstLineBase + 4);
  itemLines.push(firstObj);
  let j = i + 1;
  let hadBlank = false;
  // Quote chunking (marked blockquote tokenizer): inside a blockquote,
  // a list item ends at (1) a continuation line when the item's last
  // line ends with trailing whitespace — the trimmed list raw leaves a
  // space token, so the list re-lex never runs; and (2) a matched `>`
  // line following a lazy (non-`>`) line — the re-lex breaks at the
  // blockquote start. lastLazy tracks whether the last collected line
  // came from a non-`>` line; a `>` line clears it.
  const inBq = lines[i].bq === true;
  let lastLazy = lines[i].bq !== true;
  let chunkEnd = false;
  // F1: after a fence-looking line is collected inside the item, the
  // next line cannot be a lazy continuation — the item ends there
  // ("```inner backticks```\ntypes ..." ends the item; "types ..." is a
  // top-level paragraph, not a lazy continuation of the item)
  let afterFence = isFenceLike(firstLine);
  while (j < hi) {
    const lj = lines[j].s;
    if (isBlankLine(lj)) {
      let k = j + 1;
      while (k < hi && isBlankLine(lines[k].s)) k++;
      if (k >= hi) { j = k; break; }
      const nk = lines[k].s;
      // an empty item ends at a blank line (cm-280): it cannot gain
      // content after a blank line
      const itemEmpty = itemLines.every(L => isBlankLine(L.s));
      if (itemEmpty) break;
      if (indentWidth(nk) >= contentIndent) {
        hadBlank = true;
        afterFence = false;
        lastLazy = false;
        for (let b = j; b < k; b++) itemLines.push({ s: '', rel: 0, para: '' });
        j = k;
        continue;
      }
      break;
    }
    // F1: a fence-looking line at column < content indent ends the item
    if (isFenceLike(lj) && indentWidth(lj) < contentIndent) break;
    // an HR line at column < content indent ends the item (not a new item)
    if (matchHr(lj) && indentWidth(lj) < contentIndent) break;
    // a list marker at column < content indent ends this item
    const m2 = matchListMarker(lj);
    if (m2 && indentWidth(lj) < contentIndent) {
      // quote chunking: a matched `>` marker after a lazy line is a
      // chunk boundary — the list ends, the marker starts a NEW list
      if (inBq && lastLazy && lines[j].bq === true) chunkEnd = true;
      break;
    }
    // quote chunking (see above): trailing whitespace on the last line,
    // or a matched `>` line after a lazy line, ends the item here — and
    // the LIST (marked lexes the rest as a fresh chunk, so a following
    // same-type marker starts a new list, not a new item).
    if (inBq) {
      const prev = itemLines[itemLines.length - 1];
      // rule 1 fires only for a non-`>` (lazy) line: a matched `>` line
      // continues the chunk, and the trailing spaces stay inside the
      // item as a hard break (49-doc-05-L1, cm-226/241/645)
      if (lines[j].bq !== true && prev && prev.s.length > 0 && (prev.s.charCodeAt(prev.s.length - 1) === 32 || prev.s.charCodeAt(prev.s.length - 1) === 9)) { chunkEnd = true; break; }
      if (lines[j].bq === true && lastLazy) { chunkEnd = true; break; }
    }
    if (indentWidth(lj) >= contentIndent) {
      const ljExp = expandLeadingTabs(lj, 0);
      const rel = indentWidth(ljExp) - contentIndent;
      const s = stripContainerIndent(ljExp, contentIndent);
      // an inline-tag line appends to the previous paragraph line with
      // no newline (L3)
      if (rel < 4 && isInlineTagLine(s)) {
        const last = itemLines[itemLines.length - 1];
        if (last && !isBlankLine(last.s) && last.rel < 4 && !matchHtmlBlockStart(last.s)) {
          last.s += s.trim();
          last.para += s.trim();
          j++;
          continue;
        }
      }
      // a list paragraph continuation strips the code indent (4) from
      // its text when rel >= 4 (unlike a blockquote continuation, which
      // keeps the full indent); the strip is from the tab-expanded line
      const para = rel >= 4 ? stripLeading(ljExp, contentIndent + 4) : s;
      itemLines.push({ s, rel, para });
      lastLazy = lines[j].bq !== true;
      afterFence = isFenceLike(s);
      j++;
      continue;
    }
    // lazy paragraph continuation (a setext-looking line cannot be a
    // heading here; if it is also an HR it ends the item instead).
    // A lazy line can only continue a paragraph, never indented code
    // (rel >= 4) and never an HTML block: after either, the item ends
    // here (L2).
    const last = itemLines[itemLines.length - 1];
    if (last && !isBlankLine(last.s) && last.rel < 4 && !matchHtmlBlockStart(last.s) && !matchHr(lj) && !afterFence && (!startsInterruptBlock(lj) || matchSetext(lj) > 0)) {
      // an inline-tag lazy line appends with no newline (L3)
      if (isInlineTagLine(lj)) {
        last.s += lj.trim();
        last.para += lj.trim();
        j++;
        continue;
      }
      const rel = indentWidth(lj);
      const isSetextLazy = matchSetext(lj) > 0;
      itemLines.push({ s: lj, rel, para: rel >= 4 ? stripLeading(lj, 4) : lj, ns: isSetextLazy, lazy: true, codeMerged: rel >= 4 });
      lastLazy = lines[j].bq !== true;
      afterFence = isFenceLike(lj);
      j++;
      continue;
    }
    break;
  }
  const children = parseBlocks(itemLines, 0, itemLines.length, refs, { inContainer: true, inListItem: true });
  // looseness comes from the parsed AST: a blank line separating two
  // direct children of this item (blank lines inside a nested list do
  // not count). hadBlank is kept for the blank-line bookkeeping above.
  return { children, hadBlank: children.blankSep === true, next: j, chunkEnd };
}

// marked trims the LAST list item's raw + text (trimEnd): trailing
// spaces survive on every other item's last line, and on mid-item
// lines, but the last item's final line loses them. Mirror that here
// on the parsed AST: descend into the last child (blockquote / nested
// list) and strip the trailing whitespace of its last text line.
function trimLastItemText(children) {
  for (let ci = children.length - 1; ci >= 0; ci--) {
    const child = children[ci];
    if (child.t === 'p' || child.t === 'h') {
      child.text = child.text.replace(/[ \t\r\n]+$/, '');
      return;
    }
    if (child.t === 'code' || child.t === 'fence' || child.t === 'html') {
      if (child.lines.length > 0) child.lines[child.lines.length - 1] = child.lines[child.lines.length - 1].replace(/[ \t]+$/, '');
      return;
    }
    if (child.t === 'table') {
      const rows = child.rows;
      if (rows.length > 0) {
        const lastRow = rows[rows.length - 1];
        if (lastRow.length > 0) lastRow[lastRow.length - 1] = lastRow[lastRow.length - 1].replace(/[ \t]+$/, '');
      }
      return;
    }
    if (child.t === 'bq') { trimLastItemText(child.children); return; }
    if (child.t === 'list') {
      const last = child.items[child.items.length - 1];
      if (last) trimLastItemText(last.children);
      return;
    }
  }
}

function parseList(lines, i, hi, refs, ctx) {
  const first = matchListMarker(lines[i].s);
  const ordered = first.ordered;
  const delim = first.delim;
  const bullet = first.bullet;
  const start = first.start;
  const items = [];
  let j = i;
  let loose = false;
  while (j < hi) {
    // an HR line ends the list (it is not a new item)
    if (matchHr(lines[j].s)) break;
    const m = matchListMarker(lines[j].s);
    if (!m || m.ordered !== ordered || m.delim !== delim) break;
    // a bullet change splits an unordered list (cm-301)
    if (!ordered && m.bullet !== bullet) break;
    const r = collectListItem(lines, j, hi, refs, m);
    if (r.hadBlank) loose = true;
    items.push({ children: r.children });
    // a quote-chunking break ends the LIST, not just the item: the
    // rest is lexed as a fresh chunk, so a following same-type marker
    // starts a new list
    if (r.chunkEnd) { j = r.next; break; }
    // skip blank lines; if the next non-blank line is a same-type item,
    // the list continues (and is loose); otherwise it ends here
    let k = r.next;
    let sawBlank = false;
    while (k < hi && isBlankLine(lines[k].s)) { sawBlank = true; k++; }
    if (sawBlank) {
      const mk = k < hi ? matchListMarker(lines[k].s) : null;
      if (mk && mk.ordered === ordered && mk.delim === delim && (ordered || mk.bullet === bullet)) {
        loose = true;
        j = k;
        continue;
      }
      j = r.next;
      break;
    }
    j = r.next;
  }
  // marked: only the LAST item's text is trimEnd()ed
  if (items.length > 0) trimLastItemText(items[items.length - 1].children);
  return { node: { t: 'list', ordered, start, tight: !loose, items }, next: j };
}

// ------------------------------------------------------------------
// Renderer.
// ------------------------------------------------------------------

function escHtml(s) {
  return escTextStr(s);
}

function renderNodes(nodes, refs) {
  let out = '';
  for (const n of nodes) out += renderNode(n, refs);
  return out;
}

function renderNode(n, refs) {
  switch (n.t) {
    case 'p':
      return '<p>' + parseInline(n.text, refs) + '</p>\n';
    case 'h':
      return '<h' + n.level + '>' + parseInline(n.text, refs) + '</h' + n.level + '>\n';
    case 'hr':
      return '<hr>\n';
    case 'fence': {
      let info = '';
      if (n.info) {
        let w = n.info.trim().split(/\s+/)[0];
        if (w) {
          // decode backslash escapes in the info word (foo\+bar -> foo+bar)
          if (w.indexOf('\\') >= 0) {
            let dw = '';
            for (let k = 0; k < w.length; k++) {
              if (w.charCodeAt(k) === 92 && k + 1 < w.length && isPunctCode(w.charCodeAt(k + 1))) { dw += w[k + 1]; k++; }
              else dw += w[k];
            }
            w = dw;
          }
          info = ' class="language-' + escAttrStr(w) + '"';
        }
      }
      const body = n.lines.length > 0 ? escHtml(n.lines.join('\n')) + '\n' : '';
      return '<pre><code' + info + '>' + body + '</code></pre>\n';
    }
    case 'code': {
      const body = n.lines.length > 0 ? escHtml(n.lines.join('\n')) + '\n' : '';
      return '<pre><code>' + body + '</code></pre>\n';
    }
    case 'html':
      // an HTML block renders its raw lines joined by \n. A trailing \n
      // is added only when the block is immediately followed by another
      // block (node.nl); at EOF parse() supplies the final newline.
      return n.lines.join('\n') + (n.nl ? '\n' : '');
    case 'bq':
      return '<blockquote>\n' + renderNodes(n.children, refs) + '</blockquote>\n';
    case 'list':
      return renderList(n, refs);
    case 'table':
      return renderTable(n, refs);
    default:
      return '';
  }
}

function renderList(n, refs) {
  const tag = n.ordered ? 'ol' : 'ul';
  const startAttr = n.ordered && n.start !== 1 ? ' start="' + n.start + '"' : '';
  let out = '<' + tag + startAttr + '>\n';
  for (const item of n.items) out += renderListItem(item, refs, n.tight);
  out += '</' + tag + '>\n';
  return out;
}

function renderListItem(item, refs, tight) {
  let out = '<li>';
  const children = item.children;
  // task list: first paragraph starting with [ ] / [x] / [X]
  let taskChecked = null;
  let taskRest = null;
  if (children.length > 0 && children[0].t === 'p') {
    const tx = children[0].text;
    if (tx.startsWith('[ ] ') || tx === '[ ]' || tx.startsWith('[x] ') || tx === '[x]' ||
        tx.startsWith('[X] ') || tx === '[X]') {
      taskChecked = tx[1] === 'x' || tx[1] === 'X';
      taskRest = tx.slice(3);
      if (taskRest.startsWith(' ')) taskRest = taskRest.slice(1);
    }
  }
  for (let ci = 0; ci < children.length; ci++) {
    const child = children[ci];
    if (child.t === 'p' && tight && ci === 0) {
      if (taskChecked !== null) {
        out += taskChecked
          ? '<input checked="" disabled="" type="checkbox">'
          : '<input disabled="" type="checkbox">';
        if (taskRest !== '') out += ' ' + parseInline(taskRest, refs);
      } else {
        // trailing spaces are stripped by the parse-time last-item
        // trimEnd (marked trims ONLY the last item's text); a paragraph
        // that is the last child of a non-last item keeps them
        out += parseInline(child.text, refs);
      }
      // a tight paragraph whose last line is an indented-code merge
      // (codeEnd) gets one newline before any following block
      // ("indented four\n<ul>", "image.\n<ol>"); a plain multi-line
      // paragraph takes none ("foo\nbar<blockquote>")
      if (ci + 1 < children.length) {
        const nx = children[ci + 1].t;
        if (nx === 'p') out += '\n\n';
        else if (child.codeEnd) out += '\n';
      }
    } else if (child.t === 'p' && tight) {
      // a later paragraph in a tight list gets <p> tags ONLY when it
      // follows a nested list ("foo<ul>...</ul>\n<p><code>code</code></p>");
      // a paragraph following another paragraph stays bare
      const prev = children[ci - 1];
      if (prev && (prev.t === 'list' || prev.t === 'ul' || prev.t === 'ol')) {
        out += '<p>' + parseInline(child.text, refs) + (child.lazyEnd || child.codeEnd ? '\n' : '') + '</p>\n';
      } else {
        out += parseInline(child.text, refs);
        if (ci + 1 < children.length) {
          const nx = children[ci + 1].t;
          if (nx === 'p') out += '\n\n';
          else if (child.codeEnd) out += '\n';
        }
      }
    } else if (child.t === 'p') {
      if (ci === 0 && taskChecked !== null) {
        out += '<p>' + (taskChecked
          ? '<input checked="" disabled="" type="checkbox">'
          : '<input disabled="" type="checkbox">');
        if (taskRest !== '') out += ' ' + parseInline(taskRest, refs);
        out += '</p>\n';
      } else {
        out += '<p>' + parseInline(child.text, refs) + (child.lazyEnd || child.codeEnd ? '\n' : '') + '</p>\n';
      }
    } else {
      out += renderNode(child, refs);
    }
  }
  out += '</li>\n';
  return out;
}

function renderTable(n, refs) {
  const colCount = n.header.length;
  let out = '<table>\n<thead>\n<tr>\n';
  for (let c = 0; c < colCount; c++) {
    const a = n.aligns[c];
    const attr = a ? ' align="' + a + '"' : '';
    out += '<th' + attr + '>' + parseInline(n.header[c] || '', refs) + '</th>\n';
  }
  out += '</tr>\n</thead>\n';
  if (n.rows.length > 0) {
    out += '<tbody>';
    for (const row of n.rows) {
      out += '<tr>\n';
      for (let c = 0; c < colCount; c++) {
        const a = n.aligns[c];
        const attr = a ? ' align="' + a + '"' : '';
        out += '<td' + attr + '>' + parseInline(row[c] || '', refs) + '</td>\n';
      }
      out += '</tr>\n';
    }
    out += '</tbody>';
  }
  out += '</table>\n';
  return out;
}

// ------------------------------------------------------------------
// Entry point.
// ------------------------------------------------------------------

export function parse(md) {
  const lines = toLineObjects(splitLines(md));
  const refs = new Map();
  const nodes = parseBlocks(lines, 0, lines.length, refs, { inContainer: false });
  let out = renderNodes(nodes, refs);
  // a trailing newline is appended, EXCEPT when the last block is a raw
  // HTML block and the input itself has no trailing newline (H:
  // "</pre>" -> "</pre>", not "</pre>\n")
  if (out.length > 0 && !out.endsWith('\n')) {
    const last = nodes[nodes.length - 1];
    if (!(last && last.t === 'html' && !md.endsWith('\n'))) out += '\n';
  }
  return out;
}
