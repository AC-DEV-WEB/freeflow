'use strict';
// The dictionary learns from your corrections (like Wispr Flow's "user edits"):
// FreeFlow reads the text field right after it pasted, then again a few seconds
// later. A word you replaced INSIDE the pasted text ("inksfield" -> "Higgsfield")
// is offered for the dictionary: word = what you typed, heard = what was there.
// Also used when you correct a dictation in the History.
const { fold, applyVocabulary } = require('./vocab');
const { isRisky } = require('./guess');

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’\-.@_]*/gu;

function words(text) {
  return [...String(text || '').matchAll(WORD)].map((m) => ({ w: m[0], i: m.index, end: m.index + m[0].length }));
}

// Longest common subsequence of word lists -> replaced runs (old words, new words).
function replacedRuns(a, b) {
  const n = a.length, m = b.length;
  if (!n || !m || n * m > 250000) return [];
  const eq = (x, y) => x.w === y.w;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = eq(a[i], b[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const runs = [];
  let i = 0, j = 0, del = [], ins = [];
  const flush = () => { if (del.length || ins.length) runs.push({ del, ins }); del = []; ins = []; };
  while (i < n && j < m) {
    if (eq(a[i], b[j])) { flush(); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) del.push(a[i++]);
    else ins.push(b[j++]);
  }
  while (i < n) del.push(a[i++]);
  while (j < m) ins.push(b[j++]);
  flush();
  return runs;
}

/**
 * Corrections worth a dictionary entry between the text FreeFlow pasted and
 * what it became. Only replacements (not deletions or additions), of 1 to 4
 * words, never a plain everyday word as the "correct" spelling.
 * @param {string} before text of the field right after the paste (or the dictation)
 * @param {string} after  the same field later (or the corrected dictation)
 * @param {string} pasted what FreeFlow inserted
 * @returns {{word:string, sounds:string[]}[]}
 */
function findCorrections(before, after, pasted, { vocab = [], lang = 'fr' } = {}) {
  before = String(before || ''); after = String(after || ''); pasted = String(pasted || '');
  const at = before.lastIndexOf(pasted);
  if (!pasted || at < 0 || before === after) return [];
  // The text around the dictation must be untouched, otherwise we cannot tell where it went.
  const head = before.slice(0, at), tail = before.slice(at + pasted.length);
  if (!after.startsWith(head) || !after.endsWith(tail) || after.length < head.length + tail.length) return [];
  const region = after.slice(head.length, after.length - tail.length);
  const out = [];
  const seen = new Set();
  for (const { del, ins } of replacedRuns(words(pasted), words(region))) {
    if (!del.length || !ins.length || del.length > 4 || ins.length > 4) continue;
    const heard = pasted.slice(del[0].i, del[del.length - 1].end);
    const word = region.slice(ins[0].i, ins[ins.length - 1].end);
    if (word.length > 40 || heard.length > 40) continue;
    const casing = fold(word) === fold(heard);
    const bare = (s) => fold(s).replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
    if (!casing && bare(word) === bare(heard)) continue;      // punctuation only ("e-mail" / "email"); "supa base" -> "Supabase" stays
    // Everyday word replaced by another everyday word ("ses" -> "ces"): grammar, not vocabulary.
    if (isRisky(word, lang) && heard.split(/\s+/).every((t) => isRisky(t, lang))) continue;
    if (applyVocabulary(heard, vocab) === word) continue;     // already known
    const key = fold(word) + '|' + fold(heard);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ word, sounds: casing ? [] : [heard.toLowerCase()] });
  }
  return out;
}

module.exports = { findCorrections, replacedRuns, words };
