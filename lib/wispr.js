'use strict';
// "Reprendre mon dictionnaire Wispr Flow": reads the Dictionary table of Wispr
// Flow's local SQLite database (flow.sqlite) from a temporary COPY, so Wispr's
// own file is never opened, locked or changed, even while it runs.
//   phrase only            -> a vocabulary word
//   phrase -> replacement  -> word = replacement, heard = phrase
//   isSnippet = 1          -> a FreeFlow snippet (trigger -> text)
const fs = require('fs');
const os = require('os');
const path = require('path');

function wisprDbPath() {
  const base = process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support')
    : process.env.APPDATA;
  const p = base ? path.join(base, 'Wispr Flow', 'flow.sqlite') : null;
  return p && fs.existsSync(p) ? p : null;
}

/** @returns {Promise<{entries:{word:string,sounds:string[]}[], snippets:{trigger:string,expansion:string}[]}>} */
async function readWisprDictionary(dbPath = wisprDbPath()) {
  if (!dbPath) throw new Error('Wispr Flow n’est pas installé sur cet ordinateur.');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'freeflow-wispr-'));
  try {
    const copy = path.join(tmp, 'flow.sqlite');
    for (const ext of ['', '-wal', '-shm']) {
      if (fs.existsSync(dbPath + ext)) await fs.promises.copyFile(dbPath + ext, copy + ext);
    }
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(copy);
    let rows;
    try {
      rows = db.prepare('SELECT phrase, replacement, isSnippet FROM Dictionary WHERE isDeleted = 0').all();
    } finally {
      db.close();
    }
    const entries = [], snippets = [];
    for (const r of rows) {
      const phrase = String(r.phrase || '').trim();
      const repl = r.replacement == null ? '' : String(r.replacement).trim();
      if (!phrase) continue;
      if (Number(r.isSnippet)) { if (repl) snippets.push({ trigger: phrase, expansion: repl }); }
      else if (repl) entries.push({ word: repl, sounds: [phrase] });
      else entries.push({ word: phrase, sounds: [] });
    }
    return { entries, snippets };
  } catch (e) {
    if (/no such table|no such column/i.test(e.message)) throw new Error('Cette version de Wispr Flow range son dictionnaire autrement : recopie tes mots dans un fichier CSV.');
    throw e;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

module.exports = { wisprDbPath, readWisprDictionary };
