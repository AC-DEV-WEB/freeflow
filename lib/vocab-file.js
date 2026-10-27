'use strict';
// The vocabulary as a file: import from CSV (Excel, Google Sheets, Numbers),
// Excel .xlsx, plain text, JSON, a Markdown table or a list pasted in the
// window; export to CSV. One row = one word: the correct spelling first, then
// what the model hears instead (one per cell, or several in a cell separated
// by "|"). A word alone is fine too. Wispr Flow's bulk-import CSV
// ("phrase,replacement": heard first) is read as well: the column order is
// guessed and can be swapped in the preview.
const zlib = require('zlib');
const { normalizeVocab, fold } = require('./vocab');
const { buildXlsx } = require('./xlsx');
const I18N = require('./i18n');

const MAX_ENTRIES = 5000;
const MAX_LEN = 120;
const MAX_UNZIPPED = 50 * 1024 * 1024;     // a sheet bigger than that is not a word list
const HEAD_WORD = 'Mot correct';
const HEAD_HEARD = 'Ce que le modèle entend (séparé par des virgules)';
const t = (lang, key) => I18N.t(lang, key);
const header = (lang) => `${t(lang, HEAD_WORD)};${t(lang, HEAD_HEARD)}`;

// The filled example (Excel "exemple" file, also shown in the "Mode d'emploi" sheet), per language.
const exampleRows = (lang) => I18N.EXAMPLES[I18N.resolve(lang)];

const AI_PROMPTS = {
  fr: `Je dicte en français avec une reconnaissance vocale (Whisper). Elle écrit mal certains mots de mon domaine.
Voici mes mots : [COLLE TA LISTE ICI, ou décris ton métier pour que tu me proposes les mots]

Pour chaque mot, imagine comment la reconnaissance vocale peut l'écrire de travers quand on le prononce à voix haute (à la française et à l'anglaise) : mot coupé en deux, sons proches, lettres épelées, chiffres écrits en lettres.

Réponds uniquement avec un bloc CSV, sans aucune phrase autour.
Première ligne : Mot correct;Ce que le modèle entend (séparé par des virgules)
Puis une ligne par mot : le mot bien écrit, un point-virgule, puis ses mauvaises transcriptions séparées par des virgules.
N'utilise jamais comme mauvaise transcription un mot courant de la langue (par exemple « clean » ou « post-it ») : il serait remplacé partout.

Exemple :
n8n;n huit n, aine huit aine, n 8 n
Higgsfield;x field, higgs field, hicks field`,
  en: `I dictate in English with speech recognition (Whisper). It misspells some words from my field.
Here are my words: [PASTE YOUR LIST HERE, or describe your job so you can suggest the words]

For each word, imagine how speech recognition could write it wrong when it is said out loud: the word split in two, similar sounds, spelled-out letters, numbers written as words.

Answer only with a CSV block, with no sentence around it.
First line: Correct word;What the model hears (separated by commas)
Then one line per word: the word spelled right, a semicolon, then its wrong transcriptions separated by commas.
Never use an everyday word of the language as a wrong transcription (for example "clean" or "post-it"): it would be replaced everywhere.

Example:
n8n;n eight n, nate n, n 8 n
Higgsfield;x field, higgs field, hicks field`,
  ar: `أُملي باللغة العربية باستخدام التعرّف على الكلام (Whisper). يكتب بعض الكلمات الخاصة بمجالي بشكل خاطئ.
هذه كلماتي: [الصق قائمتك هنا، أو صف عملك لتقترح عليّ الكلمات]

لكل كلمة، تخيّل كيف يمكن للتعرّف على الكلام أن يكتبها خطأً عند نطقها بصوت عالٍ: كلمة مقسومة إلى قسمين، أصوات متقاربة، حروف منطوقة، أرقام مكتوبة بالحروف، أو كتابتها بالحروف العربية.

أجب فقط بكتلة CSV، دون أي جملة حولها.
السطر الأول: الكلمة الصحيحة;ما يسمعه النموذج (مفصولًا بفواصل)
ثم سطر لكل كلمة: الكلمة مكتوبة بشكل صحيح، ثم فاصلة منقوطة، ثم الكتابات الخاطئة مفصولة بفواصل.
لا تستخدم أبدًا كلمة شائعة في اللغة ككتابة خاطئة: لأنها ستُستبدل في كل مكان.

مثال:
n8n;ان ثمانية ان, إن إيت إن
Higgsfield;هيغز فيلد, هيقز فيلد`,
  zh: `我用语音识别（Whisper）进行中文听写。它会把我所在领域的一些词写错。
这是我的词语：[在这里粘贴你的列表，或者描述你的职业，让你帮我推荐词语]

对每个词，设想语音识别在大声读出时可能写错成什么：被拆成两半、发音相近的字、逐个读出的字母、写成汉字的数字或音译。

只回复一个 CSV 代码块，前后不要任何句子。
第一行：正确写法;模型听成（用逗号分隔）
然后每个词一行：正确写法，一个分号，再写它的错误转写，用逗号分隔。
绝不要把日常用词当作错误转写：否则它会在所有地方被替换。

示例：
n8n;n八n, 恩八恩
Higgsfield;希格斯菲尔德, higgs field`,
};
const aiPrompt = (lang) => AI_PROMPTS[I18N.resolve(lang)];
const AI_PROMPT = AI_PROMPTS.fr;

// ---------------------------------------------------------------------------
// Bytes -> text (Excel's "CSV (point-virgule)" is Windows-1252, its "Texte
// Unicode" is UTF-16 with a BOM; everything else is UTF-8).
// ---------------------------------------------------------------------------
function decodeText(input) {
  if (typeof input === 'string') return input.replace(/^﻿/, '');
  const buf = Buffer.from(input);
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf[0] === 0xfe && buf[1] === 0xff) {
    const le = Buffer.from(buf.subarray(2, 2 + ((buf.length - 2) & ~1)));
    return le.swap16().toString('utf16le');
  }
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8');
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { /* not UTF-8 */ }
  try { return new TextDecoder('windows-1252').decode(buf); } catch { return buf.toString('latin1'); }
}

// ---------------------------------------------------------------------------
// Minimal .xlsx reader: first worksheet, shared and inline strings, numbers.
// ---------------------------------------------------------------------------
function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Ce fichier Excel est illisible (archive incomplète).');
  const files = new Map();
  let p = buf.readUInt32LE(eocd + 16);
  for (let k = buf.readUInt16LE(eocd + 10); k > 0 && buf.readUInt32LE(p) === 0x02014b50; k--) {
    const nameLen = buf.readUInt16LE(p + 28);
    files.set(buf.subarray(p + 46, p + 46 + nameLen).toString('utf8'), {
      method: buf.readUInt16LE(p + 10), size: buf.readUInt32LE(p + 20), offset: buf.readUInt32LE(p + 42),
    });
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return {
    names: [...files.keys()],
    read(name) {
      const f = files.get(name);
      if (!f) return null;
      const start = f.offset + 30 + buf.readUInt16LE(f.offset + 26) + buf.readUInt16LE(f.offset + 28);
      const data = buf.subarray(start, start + f.size);
      try {
        return (f.method === 0 ? data : zlib.inflateRawSync(data, { maxOutputLength: MAX_UNZIPPED })).toString('utf8');
      } catch (e) {
        throw new Error(e.code === 'ERR_BUFFER_TOO_LARGE' ? 'Ce fichier Excel est trop gros pour une liste de mots.' : 'Ce fichier Excel est illisible.');
      }
    },
  };
}

function xmlText(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_m, e) => {
    const l = e.toLowerCase();
    if (l[0] === '#') return String.fromCodePoint(l[1] === 'x' ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[l];
  });
}

function runsText(xml) {
  let out = '';
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += xmlText(m[1]);
  return out;
}

function readXlsx(buf) {
  const zip = unzip(Buffer.from(buf));
  const shared = [];
  const sst = zip.read('xl/sharedStrings.xml');
  if (sst) for (const m of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(runsText(m[1]));
  // First sheet in workbook order, through its relationship id.
  let sheetPath = null;
  const wb = zip.read('xl/workbook.xml');
  const rels = zip.read('xl/_rels/workbook.xml.rels');
  const first = wb && wb.match(/<sheet\b[^>]*\br:id="([^"]+)"/);
  if (first && rels) {
    const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((r) => r.includes(`Id="${first[1]}"`));
    const target = rel && (rel.match(/Target="([^"]+)"/) || [])[1];
    if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  }
  if (!sheetPath || !zip.read(sheetPath)) sheetPath = zip.names.filter((n) => /^xl\/worksheets\/[^/]+\.xml$/.test(n)).sort()[0];
  const sheet = sheetPath && zip.read(sheetPath);
  if (!sheet) throw new Error('Aucune feuille trouvée dans ce fichier Excel.');
  const rows = [];
  for (const rm of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1], body = cm[2] || '';
      const ref = (attrs.match(/\br="([A-Z]+)\d+"/) || [])[1];
      const col = ref ? [...ref].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1 : row.length;
      const type = (attrs.match(/\bt="([^"]+)"/) || [])[1];
      const v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      let value = '';
      if (type === 's') value = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') value = runsText(body);
      else if (v != null) value = xmlText(v);
      row[col] = value;
    }
    rows.push(Array.from(row, (c) => c ?? ''));
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Text formats
// ---------------------------------------------------------------------------
/** RFC 4180-style CSV: quoted cells may hold the separator, quotes and newlines. */
function parseCsv(text, sep) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && !cell.trim()) { quoted = true; cell = ''; }
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const ARROW = /\s*(?:->|→|=>|⇒)\s*/;          // "x field -> Higgsfield": heard, then the word
const EQUALS = /\s*(?:=|:(?=\s))\s*/;          // "Higgsfield = x field": the word, then heard
const COMMENT = /^\s*(?:#|\/\/|```)/;

function meaningfulLines(text) {
  return text.split(/\r?\n/).filter((l) => l.trim() && !COMMENT.test(l) && !/^\s*sep=.\s*$/i.test(l));
}

/** Which way the columns go, read from a header row; null when it is not a header. */
const HEARD_HEAD = /entend|entendu|hear|phrase|erreur|mal ecrit|transcri|variante|sound|son\b|devient|remplacer$|يسمع|سمع|听/;
const WORD_HEAD = /^(mot|mots|word|words|correct|terme|termes|vocabulaire|vocabulary|orthographe|spelling|bon mot|mot juste|ecrit|replacement|remplacement|remplacer par|ecrire|الكلمة|كلمة|الكلمات|正确|词语|单词)/;
function headerDirection(cells) {
  const c = cells.map((x) => fold(String(x || '').trim())).filter(Boolean);
  if (c.length < 1 || c.length > 12) return null;
  if (c.length === 1) return /^(mots?|words?|vocabulaire|vocabulary|mots? corrects?|liste)$/.test(c[0]) ? 'word-first' : null;
  const heard = (x) => HEARD_HEAD.test(x), word = (x) => WORD_HEAD.test(x) && !HEARD_HEAD.test(x);
  if (word(c[0]) && heard(c[1])) return 'word-first';
  if (heard(c[0]) && word(c[1])) return 'heard-first';
  return null;
}

// A correct spelling tends to have capitals, digits or no spaces; heard text is
// usually lowercase words. Used to guess the column order of a file without header.
function writtenScore(s) {
  let n = 0;
  if (/\p{Lu}/u.test(s.slice(1))) n += 1;
  if (/^\p{Lu}/u.test(s)) n += 0.5;
  if (/\p{N}/u.test(s)) n += 0.5;
  if (!/\s/.test(s.trim())) n += 0.5;
  if (s === s.toLowerCase()) n -= 0.25;
  return n;
}

function guessDirection(rows) {
  let wordFirst = 0, heardFirst = 0;
  for (const r of rows) {
    const cells = r.filter((c) => c.trim());
    if (cells.length < 2) continue;
    const a = writtenScore(cells[0]), b = writtenScore(cells[cells.length - 1]);
    if (a > b) wordFirst += 1; else if (b > a) heardFirst += 1;
  }
  return heardFirst > wordFirst ? 'heard-first' : 'word-first';
}

// Several variants in one cell: commas (what the template asks; also the Arabic and Chinese ones), "|" or ";".
function splitVariants(cell) {
  return String(cell || '').split(/\s*[|,;，、،；]\s*/).map((s) => s.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Rows -> entries
// ---------------------------------------------------------------------------
function collect() {
  const map = new Map();
  const skipped = [];
  return {
    skipped,
    add(word, sounds, line, raw) {
      const w = String(word || '').trim().replace(/^["'«“]+|["'»”]+$/g, '').trim();
      if (!w) { skipped.push({ line, text: raw, reason: 'pas de mot correct' }); return; }
      if (w.length > MAX_LEN) { skipped.push({ line, text: raw, reason: 'mot de plus de 120 caractères' }); return; }
      const ok = sounds.map((s) => s.replace(/^["'«“]+|["'»”]+$/g, '').trim()).filter((s) => s && s.length <= MAX_LEN);
      const key = w.toLowerCase();
      if (map.has(key)) map.get(key).sounds.push(...ok);
      else if (map.size >= MAX_ENTRIES) skipped.push({ line, text: raw, reason: 'plus de 5000 mots' });
      else map.set(key, { word: w, sounds: ok });
    },
    entries: () => normalizeVocab([...map.values()]),
  };
}

function fromRows(rows, { direction }) {
  const c = collect();
  // Columns left empty on every row (a sheet that starts in column B) do not count.
  const firstCol = Math.min(...rows.map((r) => r.findIndex((x) => String(x ?? '').trim())).filter((i) => i >= 0));
  if (firstCol > 0 && Number.isFinite(firstCol)) rows = rows.map((r) => r.slice(firstCol));
  let start = 0;
  while (start < rows.length && !rows[start].some((x) => String(x).trim())) start += 1;
  let dir = direction || null;
  const head = rows[start] ? headerDirection(rows[start]) : null;
  if (head) { dir = dir || head; start += 1; }
  const body = rows.slice(start);
  dir = dir || guessDirection(body);
  body.forEach((r, i) => {
    const cells = r.map((x) => String(x ?? '').trim());
    const filled = cells.filter(Boolean);
    if (!filled.length || COMMENT.test(filled[0]) || /^sep=.$/i.test(filled[0])) return;
    const raw = filled.join(' ; ');
    const line = start + i + 1;
    if (dir === 'word-first' && !cells[0]) { c.skipped.push({ line, text: raw, reason: 'pas de mot correct dans la 1ʳᵉ colonne' }); return; }
    if (filled.length === 1) { c.add(filled[0], [], line, raw); return; }
    if (dir === 'heard-first') {
      const word = filled[filled.length - 1];
      c.add(word, filled.slice(0, -1).flatMap((x) => splitVariants(x)), line, raw);
    } else {
      c.add(filled[0], filled.slice(1).flatMap((x) => splitVariants(x)), line, raw);
    }
  });
  return { entries: c.entries(), skipped: c.skipped, direction: dir, hasHeader: !!head };
}

function fromLines(text, { direction }) {
  const c = collect();
  const lines = text.split(/\r?\n/);
  lines.forEach((l, i) => {
    const raw = l.trim();
    if (!raw || COMMENT.test(raw)) return;
    const line = raw.replace(/^[-*•]\s+|^\d+[.)]\s+/, '');      // bullets and numbered lists
    if (ARROW.test(line)) {
      const [left, right] = line.split(ARROW);
      if (direction === 'word-first') c.add(left, splitVariants(right), i + 1, raw);
      else c.add(right, splitVariants(left), i + 1, raw);
    } else if (EQUALS.test(line)) {
      const k = line.search(EQUALS);
      const left = line.slice(0, k), right = line.slice(k).replace(EQUALS, '');
      if (direction === 'heard-first') c.add(right, splitVariants(left), i + 1, raw);
      else c.add(left, splitVariants(right), i + 1, raw);
    } else {
      c.add(line, [], i + 1, raw);
    }
  });
  return { entries: c.entries(), skipped: c.skipped, direction: direction || 'word-first', hasHeader: false };
}

function fromJson(data) {
  const c = collect();
  const list = Array.isArray(data) ? data
    : Array.isArray(data && data.dictionary) ? data.dictionary
      : Array.isArray(data && data.vocabulary) ? data.vocabulary
        : data && typeof data === 'object' ? Object.entries(data).map(([word, sounds]) => ({ word, sounds })) : [];
  list.forEach((e, i) => {
    const raw = JSON.stringify(e).slice(0, 120);
    if (typeof e === 'string') return c.add(e, [], i + 1, raw);
    if (!e || typeof e !== 'object') return c.skipped.push({ line: i + 1, text: raw, reason: 'élément illisible' });
    if ('phrase' in e) {                                        // Wispr Flow: phrase (heard) -> replacement
      return e.replacement ? c.add(e.replacement, [String(e.phrase)], i + 1, raw) : c.add(e.phrase, [], i + 1, raw);
    }
    const sounds = Array.isArray(e.sounds) ? e.sounds.map(String) : splitVariants(e.sounds || e.heard || '');
    return c.add(e.word || e.mot || '', sounds, i + 1, raw);
  });
  return { entries: c.entries(), skipped: c.skipped, direction: 'word-first', hasHeader: false };
}

/**
 * Parse a vocabulary file or pasted text.
 * @param {Buffer|ArrayBuffer|Uint8Array|string} input
 * @param {{name?:string, direction?:'word-first'|'heard-first'}} opts
 * @returns {{entries:{word:string,sounds:string[]}[], skipped:{line:number,text:string,reason:string}[],
 *            format:string, direction:string, swappable:boolean}}
 */
function toBuffer(input) {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof ArrayBuffer) return Buffer.from(input);
  return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
}

function parseVocabFile(input, opts = {}) {
  const name = String(opts.name || '').toLowerCase();
  const direction = opts.direction || null;
  if (typeof input !== 'string') input = toBuffer(input);
  const isZip = typeof input !== 'string' && input.length >= 4 && input.readUInt32LE(0) === 0x04034b50;
  if (name.endsWith('.xlsx') || isZip) {
    const res = fromRows(readXlsx(input), { direction });
    return { ...res, format: 'Excel', swappable: true };
  }
  if (name.endsWith('.xls') || name.endsWith('.numbers') || name.endsWith('.ods')) {
    throw new Error('Ce format n’est pas lu directement : enregistre le fichier en .xlsx ou en CSV, puis importe-le.');
  }
  const text = decodeText(input);
  const trimmed = text.trim();
  if (!trimmed) return { entries: [], skipped: [], format: 'vide', direction: 'word-first', swappable: false };
  if (name.endsWith('.json') || /^[[{]/.test(trimmed)) {
    try { return { ...fromJson(JSON.parse(trimmed)), format: 'JSON', swappable: false }; } catch (e) {
      if (name.endsWith('.json')) throw new Error('Ce fichier JSON est mal formé.');
    }
  }
  const lines = meaningfulLines(text);
  // Markdown table (what ChatGPT answers when it ignores "CSV only").
  if (lines.length && lines.filter((l) => l.trim().startsWith('|')).length >= Math.ceil(lines.length * 0.6)) {
    const rows = lines.filter((l) => l.trim().startsWith('|') && !/^\s*\|?[\s:|-]+\|?\s*$/.test(l))
      .map((l) => l.trim().replace(/^\||\|$/g, '').split('|'));
    return { ...fromRows(rows, { direction }), format: 'tableau', swappable: true };
  }
  const has = (re) => lines.filter((l) => re.test(l)).length;
  const marked = has(ARROW) + has(/[^:]=|:\s/);
  const seps = [[';', has(/;/)], ['\t', has(/\t/)], [',', has(/,/)]].sort((a, b) => b[1] - a[1]);
  if (marked >= seps[0][1] || (marked && seps[0][0] === ',')) {
    return { ...fromLines(text, { direction }), format: 'texte', swappable: false };
  }
  if (seps[0][1] > 0) {
    const sep = seps[0][0];
    const rows = parseCsv(text, sep);
    const label = sep === '\t' ? 'tableau (tabulations)' : `CSV (${sep === ';' ? 'point-virgule' : 'virgule'})`;
    return { ...fromRows(rows, { direction }), format: label, swappable: true };
  }
  return { ...fromLines(text, { direction }), format: 'liste de mots', swappable: false };
}

function csvCell(s) {
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Variants joined with commas, like the template asks (with "|" if one contains a comma).
function joinVariants(sounds) {
  return sounds.join(sounds.some((s) => s.includes(',')) ? ' | ' : ', ');
}

/** CSV for Excel (UTF-8 with BOM, ";" like French Excel), re-importable as is. */
function vocabToCsv(list, lang = 'fr') {
  const lines = [header(lang)];
  for (const e of normalizeVocab(list)) lines.push([e.word, joinVariants(e.sounds)].map(csvCell).join(';'));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// Excel files: "Mes mots" (the list) + "Mode d'emploi" (how to fill it)
// ---------------------------------------------------------------------------
const GUIDE_COLS = [32, 78];
// A merged, wrapped row does not grow by itself in Excel: give it a height for its text.
function guideRow(text, s = 'wrap') {
  const lines = Math.max(1, Math.ceil(text.length / 100));
  return { cells: [{ v: text, s }, ''], merge: true, height: s === 'wrap' || s === 'note' ? 15 * lines + 3 : undefined };
}

function guideSheet(lang) {
  const step = (k) => ({ cells: [{ v: t(lang, k), s: 'step' }, ''], merge: true, height: 21 });
  const row = (k, st) => guideRow(t(lang, k), st);
  return {
    name: t(lang, 'Mode d’emploi'),
    cols: GUIDE_COLS,
    rows: [
      { cells: [{ v: t(lang, 'FreeFlow · remplir ton dictionnaire'), s: 'title' }, ''], merge: true, height: 28 },
      row('Le dictionnaire apprend à FreeFlow à écrire tes mots (noms d’outils, de marques, de personnes…) même quand la dictée les entend de travers.', 'note'),
      { cells: [''] },
      step('1. Une ligne par mot, dans la feuille « Mes mots »'),
      row('Colonne A, « Mot correct » : le mot tel qu’il doit être écrit (n8n, Higgsfield, Claude Code…). Un mot ou une expression par ligne, à partir de la ligne 2.'),
      step('2. Colonne B : ce que la dictée écrit à la place'),
      row('Écris comment la dictée se trompe quand tu prononces ce mot. Plusieurs façons ? Sépare-les par des virgules, dans la même case : x field, higgs field, hicks field'),
      step('3. Tu ne sais pas quoi mettre en colonne B ? Laisse-la vide'),
      row('À l’import, laisse cochée la case « deviner ce que le modèle entend » : la voix de l’ordinateur prononce chaque mot et FreeFlow note ce que le modèle comprend. Tu peux aussi cliquer sur « Dis-le » à côté d’un mot et le prononcer toi-même.'),
      step('4. Majuscules, accents, tirets et chiffres : rien à faire'),
      row('« n huit n » reconnaît aussi « N-8-N », « n 8 n » ou « N8N ». « open router » est reconnu tout seul pour OpenRouter.'),
      step('5. Jamais de mot de tous les jours en colonne B'),
      row('Par exemple « clean » pour Kling : chaque « clean » de tes dictées deviendrait « Kling ». FreeFlow les signale à l’import.'),
      step('6. Importer le fichier dans FreeFlow'),
      row('Enregistre ce fichier, puis dans FreeFlow : Dictionnaire → Importer des mots → glisse le fichier. Un aperçu montre ce qui sera ajouté avant d’importer ; rien n’est jamais supprimé. Google Sheets : Fichier → Télécharger → Microsoft Excel (.xlsx). Numbers : Fichier → Exporter vers → Excel.'),
      { cells: [''] },
      { cells: [{ v: t(lang, 'Exemple'), s: 'step' }, ''], height: 21 },
      { cells: [{ v: t(lang, HEAD_WORD), s: 'tableHead' }, { v: t(lang, HEAD_HEARD), s: 'tableHead' }], height: 22 },
      ...exampleRows(lang).map(([w, h]) => ({ cells: [w, h || { v: t(lang, '(vide : FreeFlow devinera)'), s: 'note' }] })),
    ],
  };
}

function wordsSheet(rows, lang) {
  return {
    name: t(lang, 'Mes mots'),
    cols: [32, 78],
    freezeHeader: true,
    rows: [{ cells: [{ v: t(lang, HEAD_WORD), s: 'header' }, { v: t(lang, HEAD_HEARD), s: 'header' }], height: 24 }, ...rows.map((r) => ({ cells: r }))],
  };
}

/** Empty list to fill + the guide, in the app's language. */
function templateXlsx(lang = 'fr') { return buildXlsx([wordsSheet([], lang), guideSheet(lang)]); }
/** The list filled with examples (n8n, Higgsfield…) + the guide. */
function exampleXlsx(lang = 'fr') { return buildXlsx([wordsSheet(exampleRows(lang), lang), guideSheet(lang)]); }
/** The example as CSV text (what the window pastes for its screenshots). */
function exampleCsv(lang = 'fr') { return [header(lang), ...exampleRows(lang).map((r) => r.filter(Boolean).join(';'))].join('\n'); }
/** The user's dictionary, re-importable as is. */
function vocabToXlsx(list, lang = 'fr') {
  return buildXlsx([wordsSheet(normalizeVocab(list).map((e) => [e.word, joinVariants(e.sounds)]), lang), guideSheet(lang)]);
}

module.exports = { parseVocabFile, vocabToCsv, vocabToXlsx, templateXlsx, exampleXlsx, exampleCsv, decodeText, readXlsx, parseCsv, AI_PROMPT, aiPrompt, MAX_ENTRIES };
