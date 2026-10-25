'use strict';
// Finding what the model hears instead of a word, two ways:
//  - "Deviner": the computer's own voice says the word (Windows SAPI voices,
//    macOS `say`), the local model transcribes it WITHOUT the dictionary, and
//    whatever it wrote instead becomes a suggested variant ("Kling" -> "cling").
//  - "Dis-le": the user says the word, same transcription, same suggestions.
// A suggestion that is a common word ("clean") is flagged: as a variant it
// would be replaced everywhere, so it starts unticked.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { applyVocabulary, fold } = require('./vocab');

// Everyday words per dictation language ("cling" is common in English, never in French).
const COMMON = {};
function commonWords(lang) {
  const l = lang === 'en' ? 'en' : 'fr';
  if (!COMMON[l]) {
    try { COMMON[l] = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, 'common-words.json'), 'utf8'))[l].split(' ')); } catch { COMMON[l] = new Set(); }
  }
  return COMMON[l];
}

/** A single everyday word: as a variant it would replace that word in every dictation. */
function isRisky(text, lang = 'fr') {
  const toks = fold(text).split(/[^a-z0-9]+/).filter(Boolean);
  return toks.length === 1 && commonWords(lang).has(toks[0]);
}

// The word is said inside a short sentence (closer to real dictation than a
// word alone), then cut out of the transcript.
const CARRIERS = {
  fr: { make: (w) => `J'utilise ${w} tous les jours.`, re: /^\W*j\W*utilis\p{L}*\s+(.+?)\s+tous\s+les\s+jours\W*$/iu },
  en: { make: (w) => `I use ${w} every day.`, re: /^\W*i\s+use\s+(.+?)\s+every\s*day\W*$/iu },
};

function clean(s) {
  return String(s || '').replace(/^[\s"'«“‘.,;:!?…-]+|[\s"'»”’.,;:!?…-]+$/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Suggested variants for `word` from what the model wrote. Drops what the
 * dictionary already corrects (the word, its known variants, its casing).
 * @returns {{text:string, risky:boolean}[]}
 */
function suggestionsFor(word, heard, known = [], lang = 'fr') {
  const entry = [{ word, sounds: known }];
  const maxWords = Math.max(4, word.split(/\s+/).length + 2);
  const out = [];
  const seen = new Set();
  for (const h of heard) {
    const t = clean(h);
    if (!t || t.length > 60 || t.split(' ').length > maxWords) continue;
    const key = fold(t).replace(/[^a-z0-9]+/g, ' ').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (applyVocabulary(t, entry) === word) continue;
    out.push({ text: t.toLowerCase(), risky: isRisky(t, lang) });
  }
  return out;
}

/** "Dis-le": the user may say the word several times; each piece is a candidate. */
function splitSpoken(text) {
  return String(text || '').split(/[,.;!?…]+|\s+(?:et|puis|and)\s+/i).map(clean).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Text to speech, 16 kHz mono WAV (what the engine expects)
// ---------------------------------------------------------------------------
function run(cmd, args, timeout) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(String(stderr || err.message).trim().split(/\r?\n/).pop() || err.message));
      else resolve(String(stdout));
    });
  });
}

// ASCII only: Windows PowerShell 5.1 reads a .ps1 without BOM as ANSI. The words
// travel in a UTF-8 jobs file (one "lang<TAB>output<TAB>text" per line).
const WIN_SCRIPT = `param([string]$JobsFile)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$probe = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voices = @($probe.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { $_.VoiceInfo })
$probe.Dispose()
foreach ($line in [System.IO.File]::ReadAllLines($JobsFile, [System.Text.Encoding]::UTF8)) {
  $p = $line.Split([char]9)
  if ($p.Length -lt 3) { continue }
  $v = $voices | Where-Object { $_.Culture.Name -like ($p[0] + '*') } | Select-Object -First 1
  if (-not $v) { continue }
  $sp = New-Object System.Speech.Synthesis.SpeechSynthesizer
  try { $sp.SelectVoice($v.Name); $sp.SetOutputToWaveFile($p[1], $fmt); $sp.Speak($p[2]) } finally { $sp.Dispose() }
}
`;

let macVoiceCache = null;
async function macVoice(lang) {
  if (!macVoiceCache) {
    macVoiceCache = [];
    for (const l of (await run('say', ['-v', '?'], 10000)).split('\n')) {
      const m = l.match(/^(.+?)\s{2,}([a-z]{2,3})_[A-Za-z0-9]+\s+#/);
      if (m) macVoiceCache.push({ name: m[1].trim(), lang: m[2] });
    }
  }
  const preferred = { fr: ['Thomas', 'Amélie', 'Audrey', 'Aurélie', 'Jacques'], en: ['Samantha', 'Alex', 'Daniel', 'Karen'] }[lang] || [];
  const ofLang = macVoiceCache.filter((v) => v.lang === lang);
  return (preferred.map((n) => ofLang.find((v) => v.name === n)).find(Boolean) || ofLang[0] || {}).name || null;
}

/** Writes each job's WAV file; jobs without a voice for their language are skipped. */
async function synthesize(jobs, dir) {
  if (process.platform === 'win32') {
    const script = path.join(dir, 'speak.ps1');
    if (!fs.existsSync(script)) fs.writeFileSync(script, WIN_SCRIPT, 'ascii');
    const list = path.join(dir, `jobs-${Date.now()}.tsv`);
    fs.writeFileSync(list, jobs.map((j) => [j.lang, j.out, j.text.replace(/[\t\r\n]+/g, ' ')].join('\t')).join('\n'), 'utf8');
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, list], 30000 + 4000 * jobs.length);
  } else if (process.platform === 'darwin') {
    for (const j of jobs) {
      const voice = await macVoice(j.lang);
      if (voice) await run('say', ['-v', voice, '-o', j.out, '--file-format=WAVE', '--data-format=LEI16@16000', j.text], 30000);
    }
  } else {
    throw new Error('La synthèse vocale n’est disponible que sous Windows et macOS.');
  }
}

/**
 * "Deviner": for each entry, the computer says the word (in a sentence, then
 * alone with a voice of the other language) and the model transcribes it.
 * @param {{word:string, sounds:string[]}[]} entries
 * @param {{lang?:string, transcribe:(wav:Buffer, lang:string)=>Promise<{text:string}>,
 *          onProgress?:Function, cancelled?:()=>boolean}} opts
 * @returns {Promise<{word:string, heard:string[], suggestions:{text:string,risky:boolean}[]}[]>}
 */
async function guessVariants(entries, { lang = 'fr', transcribe, onProgress = () => {}, cancelled = () => false }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freeflow-guess-'));
  const carrier = CARRIERS[lang] || CARRIERS.fr;
  const other = lang === 'en' ? 'fr' : 'en';
  const results = [];
  let voiced = 0;
  try {
    for (let i = 0; i < entries.length && !cancelled(); i += 10) {
      const batch = entries.slice(i, i + 10).map((e, k) => ({
        entry: e,
        jobs: [
          { lang, text: carrier.make(e.word), out: path.join(dir, `${i + k}-phrase.wav`), carrier: true },
          { lang: other, text: e.word, out: path.join(dir, `${i + k}-mot.wav`), carrier: false },
        ],
      }));
      await synthesize(batch.flatMap((b) => b.jobs), dir);
      for (const { entry, jobs } of batch) {
        if (cancelled()) break;
        const heard = [];
        for (const j of jobs) {
          if (!fs.existsSync(j.out)) continue;
          voiced += 1;
          const res = await transcribe(fs.readFileSync(j.out), lang);
          const text = clean(res && res.text);
          if (!text) continue;
          if (j.carrier) { const m = text.match(carrier.re); if (m) heard.push(m[1]); } else heard.push(text);
        }
        results.push({ word: entry.word, heard, suggestions: suggestionsFor(entry.word, heard, entry.sounds || [], lang) });
        onProgress({ done: results.length, total: entries.length, word: entry.word });
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (entries.length && !voiced && !cancelled()) throw new Error('Aucune voix de synthèse n’est installée sur cet ordinateur.');
  return results;
}

module.exports = { guessVariants, suggestionsFor, splitSpoken, isRisky, CARRIERS };
