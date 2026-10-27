'use strict';
// Vocabulary correction: "what the model heard" -> "the word you meant".
// Each entry is { word: 'n8n', sounds: ['n huit n', 'aine huit aine', ...] }.
// Matching ignores case, accents, spaces/hyphens/dots between parts, and knows
// that number words and digits are the same thing ("huit" == "8" == "eight"),
// so a single sound "n huit n" also catches "N8N", "n-8-n", "N, huit, N"...
// The word itself is always a sound too, which fixes its casing ("N8N" -> "n8n"),
// and its parts may be heard apart: "OpenRouter" also catches "open router",
// "vidIQ" catches "vid i q", "MCP" catches "M. C. P.".

const DEFAULT_VOCAB = [
  { word: 'n8n', sounds: ['n huit n', 'aine huit aine', 'haine huit haine', 'en huit en', 'n eight n', 'n hit n', 'n 8 n', 'n y n', 'n oui n', 'n wi n', 'n h n'] },
  { word: 'Higgsfield', sounds: ['x field', 'xfield', 'ix field', 'iks field', 'hicks field', 'higgs field', 'higs field', 'hig field', 'iggs field', 'hix field', 'x fields', 'higgs fields'] },
  { word: 'Claude Code', sounds: ['clode code', 'clod code', 'cloud code', 'clôde code', 'claude codes'] },
  { word: 'Claude', sounds: ['clode', 'clôde'] },
  { word: 'GitHub', sounds: ['git hub', 'guit hub', 'guite hub', 'gîte hub', 'gît hub', 'guithub', 'githab'] },
  { word: 'ChatGPT', sounds: ['chat gpt', 'chat g p t', 'tchat gpt', 'tchat g p t', "chat j'ai pété", 'chat gé pé té'] },
  { word: 'GPT', sounds: ['g p t', 'gé pé té'] },
  { word: 'MCP', sounds: ['m c p', 'aime c p', 'aime ci pé', 'em c p'] },
  { word: 'API', sounds: ['a p i', 'a pé i'] },
  { word: 'REA', sounds: ['r e a', 'r.e.a', 'air e a'] },
  { word: 'Wispr Flow', sounds: ['whisper flow', 'wisper flow', 'wispeur flow', 'whispeur flow', 'wispr flo', 'whisper flo'] },
  { word: 'FreeFlow', sounds: ['free flow', 'fri flow', 'free flo'] },
  { word: 'Seedance', sounds: ['seed dance', 'seed danse', 'sid dance', 'sid danse', 'cid danse', 'si dance', 'sidance'] },
  { word: 'Postiz', sounds: ['post iz', 'postise', 'posties', 'postize', 'poste iz', 'postisse'] },
  { word: 'Remotion', sounds: ['re motion', 'ri motion', 'rimotion'] },
  { word: 'vidIQ', sounds: ['vid i q', 'vid iq', 'vide i q', 'vidi q'] },
  { word: 'TikTok', sounds: ['tic toc', 'tik tok', 'tiktoc'] },
  { word: 'YouTube', sounds: ['you tube', 'youtoube'] },
  { word: 'iAlan', sounds: ['i alan', 'aïe alan'] },
  { word: 'Hyperframes', sounds: ['hyper frames', 'hyper frame', 'hyperframe'] },
  { word: 'OpenRouter', sounds: ['open router', 'open routeur'] },
  { word: 'Anthropic', sounds: ['anthropique', 'anthropik', 'antropic'] },
  { word: 'DeepSeek', sounds: ['deep seek', 'dip sik', 'deep sic'] },
  { word: 'Midjourney', sounds: ['mid journey', 'mide journey'] },
  { word: 'Fish Audio', sounds: ['fish audio', 'fiche audio'] },
  { word: 'Opus', sounds: [] },
];

const NUMBERS = [
  ['0', 'zero', 'zéro'], ['1', 'un', 'une', 'one'], ['2', 'deux', 'two'], ['3', 'trois', 'three'],
  ['4', 'quatre', 'four'], ['5', 'cinq', 'five'], ['6', 'six'], ['7', 'sept', 'seven'],
  ['8', 'huit', 'eight'], ['9', 'neuf', 'nine'], ['10', 'dix', 'ten'],
];
const FOLD = { a: 'aàâäáã', e: 'eéèêë', i: 'iîïíì', o: 'oôöóò', u: 'uùûüú', c: 'cç', y: 'yÿ', n: 'nñ' };

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function fold(s) { return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

const NUM_INDEX = new Map();
for (const group of NUMBERS) for (const w of group) NUM_INDEX.set(fold(w), group);

function charClass(ch) {
  const f = fold(ch);
  if (FOLD[f]) return `[${FOLD[f]}]`;
  return escapeRe(ch.toLowerCase());
}
function literal(w) { return [...w].map(charClass).join(''); }

function tokenRe(tok) {
  const group = NUM_INDEX.get(fold(tok));
  if (group) return `(?:${group.map(literal).join('|')})`;
  return literal(tok);
}

const SPLIT = /[\s\-–—'’.,_]+/;
const SEP = "[\\s\\-–—'’.,_]*";

/** Regex source for one sound; null if empty. */
function soundPattern(sound) {
  const toks = String(sound || '').trim().split(SPLIT).filter(Boolean);
  if (!toks.length) return null;
  return toks.map(tokenRe).join(SEP);
}

// Parts of a written word that the model may write as separate words:
// camelCase humps, letters/digits boundaries, and the letters of an acronym.
const HUMPS = /(?<=\p{Ll})(?=\p{Lu})|(?<=\p{L})(?=\p{N})|(?<=\p{N})(?=\p{L})/u;
function wordParts(word) {
  const parts = [];
  for (const tok of String(word || '').trim().split(SPLIT).filter(Boolean)) {
    for (const p of tok.split(HUMPS)) {
      if (/^\p{Lu}{2,6}$/u.test(p)) parts.push(...p); else if (p) parts.push(p);
    }
  }
  return parts;
}

/** Regex source for the word itself (its parts may be heard apart). */
function wordPattern(word) {
  const parts = wordParts(word);
  return parts.length ? parts.map(tokenRe).join(SEP) : null;
}

/** Normalize a stored dictionary (legacy string[] or {word,sounds}[]). */
function normalizeVocab(list) {
  const out = [];
  const seen = new Set();
  for (const e of list || []) {
    const word = String(typeof e === 'string' ? e : (e && e.word) || '').trim();
    if (!word || seen.has(word.toLowerCase())) continue;
    seen.add(word.toLowerCase());
    const sounds = typeof e === 'string' ? [] : (Array.isArray(e.sounds) ? e.sounds : String(e.sounds || '').split(','));
    const clean = [];
    for (const s of sounds) {
      const v = String(s || '').trim();
      if (v && !clean.some((x) => fold(x) === fold(v)) && fold(v) !== fold(word)) clean.push(v);
    }
    out.push({ word, sounds: clean });
  }
  return out;
}

function parseSounds(text) {
  if (Array.isArray(text)) return text.map((s) => String(s).trim()).filter(Boolean);
  return String(text || '').split(/[,;\n，、،；]+/).map((s) => s.trim()).filter(Boolean);
}

/**
 * Merge incoming entries into a vocabulary without removing anything: new words
 * are appended, known words (case-insensitive) gain the variants they lacked.
 */
function mergeVocab(list, incoming) {
  const out = normalizeVocab(list).map((e) => ({ word: e.word, sounds: [...e.sounds] }));
  const index = new Map(out.map((e) => [e.word.toLowerCase(), e]));
  let added = 0, merged = 0, same = 0;
  for (const e of normalizeVocab(incoming)) {
    const ex = index.get(e.word.toLowerCase());
    if (!ex) {
      const n = { word: e.word, sounds: [...e.sounds] };
      out.push(n); index.set(e.word.toLowerCase(), n); added += 1;
      continue;
    }
    const before = ex.sounds.length;
    ex.sounds = normalizeVocab([{ word: ex.word, sounds: [...ex.sounds, ...e.sounds] }])[0].sounds;
    if (ex.sounds.length > before) merged += 1; else same += 1;
  }
  return { list: out, added, merged, same };
}

// A heard variant must not be glued to a letter or digit ("clean" stays in "cleaner"),
// except Chinese characters: Chinese is written without spaces between words.
const WORD_CHAR = '(?:(?!\\p{Script=Han})[\\p{L}\\p{N}])';

// Compiled rules are cached per vocabulary content (a few vocabularies at once:
// the real dictionary plus the one-word checks made while guessing variants).
const cache = new Map();
function compile(vocab) {
  const key = JSON.stringify(vocab);
  const hit = cache.get(key);
  if (hit) return hit;
  const rules = [];
  for (const { word, sounds } of normalizeVocab(vocab)) {
    for (const [s, p] of [[word, wordPattern(word)], ...sounds.map((x) => [x, soundPattern(x)])]) {
      if (!p) continue;
      rules.push({ word, len: fold(s).replace(/[^\p{L}\p{N}]/gu, '').length, re: new RegExp(`(?<!${WORD_CHAR})(?:${p})(?!${WORD_CHAR})`, 'giu') });
    }
  }
  rules.sort((a, b) => b.len - a.len); // longest first: "Claude Code" before "Claude"
  if (cache.size >= 4) cache.delete(cache.keys().next().value);
  cache.set(key, rules);
  return rules;
}

const PH_OPEN = '', PH_CLOSE = '';

/**
 * Replace every heard variant by its canonical word. Replacements are protected
 * by placeholders so later passes (capitalisation, other rules) cannot alter
 * them; call restore() at the very end.
 */
function protectVocabulary(text, vocab) {
  const slots = [];
  let out = text;
  for (const r of compile(vocab)) {
    out = out.replace(r.re, () => { slots.push(r.word); return `${PH_OPEN}${slots.length - 1}${PH_CLOSE}`; });
  }
  const restore = (t) => t.replace(new RegExp(`${PH_OPEN}(\\d+)${PH_CLOSE}`, 'g'), (_m, i) => slots[Number(i)] ?? '');
  return { text: out, restore };
}

function applyVocabulary(text, vocab) {
  const p = protectVocabulary(text, vocab);
  return p.restore(p.text);
}

module.exports = { DEFAULT_VOCAB, normalizeVocab, parseSounds, mergeVocab, applyVocabulary, protectVocabulary, fold, PH_OPEN, PH_CLOSE };
