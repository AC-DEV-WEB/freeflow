'use strict';
// Self-tests of the vocabulary engine, the dictionary file formats and the
// "Deviner" suggestions. Plain Node, no dependency: `npm test`.
const assert = require('assert');
const zlib = require('zlib');
const { applyVocabulary, mergeVocab, DEFAULT_VOCAB } = require('../lib/vocab');
const { formatText } = require('../lib/format');
const { parseVocabFile, vocabToCsv, vocabToXlsx, templateXlsx, exampleXlsx } = require('../lib/vocab-file');
const { suggestionsFor, splitSpoken, isRisky, CARRIERS } = require('../lib/guess');

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; } catch (e) { console.error(`✗ ${name}\n  ${e.message}`); process.exitCode = 1; }
}
const words = (res) => Object.fromEntries(res.entries.map((e) => [e.word, e.sounds]));

// ---- matching -----------------------------------------------------------------
test('default vocabulary still corrects', () => {
  assert.strictEqual(formatText("euh j'automatise tout avec N huit N et x field", { language: 'fr', dictionary: DEFAULT_VOCAB }), "J'automatise tout avec n8n et Higgsfield");
  assert.strictEqual(applyVocabulary('je code avec clode code et claude', DEFAULT_VOCAB), 'je code avec Claude Code et Claude');
});
test('parts of a word are heard apart', () => {
  const v = [{ word: 'OpenRouter', sounds: [] }, { word: 'vidIQ', sounds: [] }, { word: 'MCP', sounds: [] }, { word: 'GPT4', sounds: [] }];
  assert.strictEqual(applyVocabulary("j'utilise open router, vid i q, M. C. P. et gpt 4", v), "j'utilise OpenRouter, vidIQ, MCP. et GPT4");
  assert.strictEqual(applyVocabulary('openrouter Open-Router', v), 'OpenRouter OpenRouter');
});
test('no match inside other words', () => {
  const v = [{ word: 'API', sounds: [] }, { word: 'REA', sounds: [] }];
  assert.strictEqual(applyVocabulary('une capitale et une area', v), 'une capitale et une area');
});

// ---- merge ----------------------------------------------------------------------
test('merge adds words and missing variants, never removes', () => {
  const r = mergeVocab([{ word: 'n8n', sounds: ['n huit n'] }], [{ word: 'N8N', sounds: ['n huit n', 'nuit n'] }, { word: 'Kling', sounds: [] }]);
  assert.deepStrictEqual(r.list, [{ word: 'n8n', sounds: ['n huit n', 'nuit n'] }, { word: 'Kling', sounds: [] }]);
  assert.deepStrictEqual([r.added, r.merged, r.same], [1, 1, 0]);
});

// ---- file formats ------------------------------------------------------------
test('Excel template: header only, the guide sheet is not imported', () => {
  const r = parseVocabFile(templateXlsx(), { name: 'freeflow-dictionnaire-modele.xlsx' });
  assert.deepStrictEqual([r.entries.length, r.skipped.length, r.format], [0, 0, 'Excel']);
});
test('Excel example reads back (commas in column B)', () => {
  const r = parseVocabFile(exampleXlsx(), { name: 'exemple.xlsx' });
  assert.strictEqual(r.direction, 'word-first');
  assert.deepStrictEqual(words(r).n8n, ['n huit n', 'aine huit aine', 'n 8 n']);
  assert.deepStrictEqual(words(r).Higgsfield, ['x field', 'higgs field', 'hicks field', 'inksfield']);
  assert.deepStrictEqual(words(r).Kling, []);
  assert.strictEqual(r.entries.length, 8);
});
test('export -> import round trip (Excel and CSV)', () => {
  const list = [{ word: 'Claude Code', sounds: ['cloud code', "clode c'ode"] }, { word: 'Opus', sounds: [] }, { word: 'Élodie & co', sounds: ['élo <di>'] }];
  assert.deepStrictEqual(parseVocabFile(vocabToXlsx(list), { name: 'x.xlsx' }).entries, list);
  assert.deepStrictEqual(parseVocabFile(Buffer.from(vocabToCsv(list), 'utf8'), { name: 'x.csv' }).entries, list);
});
test('Google Sheets CSV (comma separated, quoted cell with commas)', () => {
  const r = parseVocabFile('Mot correct,Ce que le modèle entend (séparé par des virgules)\nHiggsfield,"x field, higgs field"\nn8n,n huit n\n', { name: 'Feuille 1.csv' });
  assert.deepStrictEqual(words(r), { Higgsfield: ['x field', 'higgs field'], n8n: ['n huit n'] });
});
test('Wispr Flow CSV (phrase,replacement) is read heard-first, and can be swapped', () => {
  const csv = 'x field,Higgsfield\nn huit n,n8n\nPostiz\nclode,Claude';
  const r = parseVocabFile(csv, { name: 'wispr.csv' });
  assert.strictEqual(r.direction, 'heard-first');
  assert.deepStrictEqual(words(r), { Higgsfield: ['x field'], n8n: ['n huit n'], Postiz: [], Claude: ['clode'] });
  const s = parseVocabFile(csv, { name: 'wispr.csv', direction: 'word-first' });
  assert.deepStrictEqual(words(s)['x field'], ['Higgsfield']);
});
test('one variant per cell, header in English, tabs', () => {
  const r = parseVocabFile('word\theard\tother\nComfyUI\tconfui\tcomfy ui\n', { name: 'a.tsv' });
  assert.deepStrictEqual(words(r), { ComfyUI: ['confui', 'comfy ui'] });
});
test('plain text with = and ->, bullets and comments', () => {
  const r = parseVocabFile('# mes mots\nn8n = n huit n, aine huit aine\nx field -> Higgsfield\n- Kling\nSeedance: seed dance | ces danses\n', { name: 'mots.txt' });
  assert.deepStrictEqual(words(r), { n8n: ['n huit n', 'aine huit aine'], Higgsfield: ['x field'], Kling: [], Seedance: ['seed dance', 'ces danses'] });
});
test('ChatGPT answer: CSV in a code fence, or a Markdown table', () => {
  const fenced = 'Voici :\n```csv\nMot correct;Ce que le modèle entend (séparé par |)\nKling;cling | clean\n```';
  assert.deepStrictEqual(words(parseVocabFile(fenced, {})).Kling, ['cling', 'clean']);
  const md = '| Mot correct | Ce que le modèle entend |\n|---|---|\n| Kling | cling, klingue |\n| n8n | n huit n |';
  assert.deepStrictEqual(words(parseVocabFile(md, {})), { Kling: ['cling', 'klingue'], n8n: ['n huit n'] });
});
test('Windows-1252 and UTF-16 files (Excel exports)', () => {
  const ansi = Buffer.from('Mot correct;Ce que le modèle entend\nPokémon;pokemone | poké mone\n', 'latin1');
  assert.deepStrictEqual(words(parseVocabFile(ansi, { name: 'a.csv' })).Pokémon, ['pokemone', 'poké mone']);
  const u16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Mot\tEntendu\nÉlodie\télo die\n', 'utf16le')]);
  assert.deepStrictEqual(words(parseVocabFile(u16, { name: 'a.txt' })).Élodie, ['élo die']);
});
test('JSON: FreeFlow, Wispr-like and a plain list', () => {
  assert.deepStrictEqual(words(parseVocabFile('[{"word":"n8n","sounds":["n huit n"]},"Opus",{"phrase":"x field","replacement":"Higgsfield"}]', { name: 'd.json' })),
    { n8n: ['n huit n'], Opus: [], Higgsfield: ['x field'] });
});
test('a word list, duplicates merged, bad rows reported', () => {
  const r = parseVocabFile(`Kling\nkling;klingue\n;orphan\n${'x'.repeat(200)};y\n`, { name: 'l.csv' });
  assert.deepStrictEqual(words(r), { Kling: ['klingue'] });
  assert.deepStrictEqual(r.skipped.map((s) => s.line), [3, 4]);
});
test('Excel .xlsx (shared and inline strings)', () => {
  const r = parseVocabFile(makeXlsx([['Mot correct', 'Ce que le modèle entend'], ['Higgsfield', 'x field | hicks field'], ['Kling', 'cling']]), { name: 'mots.xlsx' });
  assert.deepStrictEqual(words(r), { Higgsfield: ['x field', 'hicks field'], Kling: ['cling'] });
});

// ---- "Deviner" / "Dis-le" ---------------------------------------------------------
test('carrier sentence is cut out', () => {
  assert.strictEqual("J'utilise Inksfield tous les jours.".match(CARRIERS.fr.re)[1], 'Inksfield');
  assert.strictEqual('I use Hicks Field every day.'.match(CARRIERS.en.re)[1], 'Hicks Field');
});
test('suggestions skip what is already corrected, flag common words', () => {
  const s = suggestionsFor('Kling', ['Clean.', 'Cling', 'KLING', 'cling'], []);
  assert.deepStrictEqual(s, [{ text: 'clean', risky: true }, { text: 'cling', risky: false }]);
  assert.deepStrictEqual(suggestionsFor('MiniMax', ['Minimax', 'Mini Max'], []), []);
  assert.deepStrictEqual(suggestionsFor('Claude Code', ['Cloud Code'], ['clode code']), [{ text: 'cloud code', risky: false }]);
  assert.strictEqual(isRisky('cling', 'en'), true);
});
test('a word said three times gives three candidates', () => {
  assert.deepStrictEqual(splitSpoken('Higgsfield. Hicks field, et x field !'), ['Higgsfield', 'Hicks field', 'x field']);
});

// ---- learning from corrections ------------------------------------------------------
const { findCorrections } = require('../lib/learn');
test('a word corrected inside the pasted dictation is learned', () => {
  const pasted = "J'automatise tout avec inksfield et n8n.";
  const before = `Salut,\n${pasted}`;
  const after = "Salut,\nJ'automatise tout avec Higgsfield et n8n.";
  assert.deepStrictEqual(findCorrections(before, after, pasted), [{ word: 'Higgsfield', sounds: ['inksfield'] }]);
});
test('two corrections, a casing fix, and what must be ignored', () => {
  const pasted = 'je code avec cloud code sur supa base, puis je relis ses notes';
  const after = 'je code avec Claude Code sur Supabase, puis je relis ces notes et je continue à écrire';
  const got = findCorrections(pasted, after, pasted);
  assert.deepStrictEqual(got.map((x) => x.word), ['Claude Code', 'Supabase']);          // ses -> ces: grammar, skipped
  assert.deepStrictEqual(findCorrections('chatgpt est là', 'ChatGPT est là', 'chatgpt est là'), [{ word: 'ChatGPT', sounds: [] }]);
  assert.deepStrictEqual(findCorrections('a b c', 'a b c d e', 'a b c'), []);             // only additions
  assert.deepStrictEqual(findCorrections('Avant. Bonjour inksfield. Après', 'Avant modifié. Bonjour Higgsfield. Après', 'Bonjour inksfield'), []); // text around changed
});

// ---- meetings -------------------------------------------------------------------------
const { mergeSegments, meetingText } = require('../lib/meeting');
test('meeting tracks merged by time, echo of the others removed from the mic', () => {
  const lines = mergeSegments([
    { track: 'mic', start: 0, end: 2, text: 'Bonjour à tous.' },
    { track: 'computer', start: 2.5, end: 5, text: 'Salut Alan, on commence ?' },
    { track: 'mic', start: 2.6, end: 5, text: 'salut alan on commence' },            // heard through the speakers
    { track: 'mic', start: 5.5, end: 7, text: 'Oui, allons-y.' },
    { track: 'mic', start: 7.5, end: 8, text: 'Premier point.' },
  ]);
  assert.deepStrictEqual(lines.map((l) => [l.speaker, l.text]), [['Moi', 'Bonjour à tous.'], ['Eux', 'Salut Alan, on commence ?'], ['Moi', 'Oui, allons-y. Premier point.']]);
  assert.strictEqual(meetingText({ lines }).split('\n')[1], '[00:02] Eux : Salut Alan, on commence ?');
  assert.deepStrictEqual(mergeSegments([{ track: 'computer', start: 0, end: 3, text: 'Sous-titres réalisés par la communauté d’Amara.org' }]), []);
});

console.log(`${passed} tests OK${process.exitCode ? ', some FAILED' : ''}`);

// Minimal .xlsx writer for the test (deflated sharedStrings, stored sheet with an inline string).
function makeXlsx(rows) {
  const strings = [];
  const sheetRows = rows.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => {
    const ref = `${String.fromCharCode(65 + j)}${i + 1}`;
    if (i === 2 && j === 1) return `<c r="${ref}" t="inlineStr"><is><t>${v}</t></is></c>`;
    strings.push(v);
    return `<c r="${ref}" t="s"><v>${strings.length - 1}</v></c>`;
  }).join('')}</row>`).join('');
  const files = {
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    'xl/workbook.xml': '<workbook xmlns:r="r"><sheets><sheet name="Mots" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml': `<sst>${strings.map((s) => `<si><t>${s}</t></si>`).join('')}</sst>`,
    'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${sheetRows}</sheetData></worksheet>`,
  };
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text, 'utf8');
    const deflate = name.includes('shared');
    const data = deflate ? zlib.deflateRawSync(raw) : raw;
    const nameBuf = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data); centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
