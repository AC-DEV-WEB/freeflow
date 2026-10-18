'use strict';
// Minimal JSON file store (stand-in for electron-store + the sqlite3 history
// database Wispr uses). Writes are atomic (tmp file + rename).
const fs = require('fs');
const path = require('path');

function createStore(file, defaults) {
  let data;
  try {
    const raw = fs.readFileSync(file, 'utf8').replace(/^﻿/, ''); // tolerate a BOM (PowerShell's -Encoding utf8)
    data = JSON.parse(raw);
    if (defaults && typeof defaults === 'object' && !Array.isArray(defaults)) {
      data = { ...defaults, ...data };
    }
  } catch {
    data = Array.isArray(defaults) ? [...defaults] : { ...(defaults || {}) };
  }
  function save() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  }
  return {
    path: file,
    get: () => data,
    set(next) { data = next; save(); return data; },
    update(patch) { data = { ...data, ...patch }; save(); return data; },
  };
}

module.exports = { createStore };
