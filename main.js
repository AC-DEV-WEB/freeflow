'use strict';
// FreeFlow main process: tray, global shortcut, overlay pill, hub window,
// dictation pipeline (overlay mic -> WAV -> local STT sidecar -> formatting ->
// clipboard + simulated paste -> history).
const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, clipboard, screen, nativeImage, shell, session, dialog, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { createStore } = require('./lib/store');
const { formatText, countWords } = require('./lib/format');
const { pcm16ToWav, wavDurationMs } = require('./lib/wav');
const { Sidecar } = require('./lib/sidecar');
const { paste, pasteMac } = require('./lib/paste');
const { DEFAULT_VOCAB, normalizeVocab, parseSounds, mergeVocab, fold } = require('./lib/vocab');
const { parseVocabFile, vocabToCsv, vocabToXlsx, templateXlsx, exampleXlsx, AI_PROMPT } = require('./lib/vocab-file');
const { guessVariants, suggestionsFor, splitSpoken } = require('./lib/guess');
const { wisprDbPath, readWisprDictionary } = require('./lib/wispr');
const { execFile } = require('child_process');

app.setName('FreeFlow');
app.setAppUserModelId('com.alan.freeflow');

const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';
const ROOT = __dirname;
const ASSETS = path.join(ROOT, 'assets');
const DEFAULT_SETTINGS = {
  // Option+Space on a Mac (Ctrl+Option+Space switches the input source there).
  shortcut: IS_MAC ? 'Alt+Space' : 'Ctrl+Alt+Space',
  mode: 'toggle',               // 'toggle' | 'ptt'
  language: 'auto',             // 'auto' | 'fr' | 'en'
  autoPaste: true,
  launchAtLogin: false,
  microphoneId: 'default',
  pasteDelayMs: 60,
  restoreClipboardMs: 400,
  modelCache: '',               // empty = %LOCALAPPDATA%\FreeFlow\models, ~/Library/Application Support/FreeFlow/models on a Mac
  model: 'auto',                // 'auto' | 'small' | 'medium' | 'large-v3-turbo' | 'large-v3'
  sidecarPort: 48123,
  maxDictationSec: 300,
  showHubAtStart: true,
  vocabSeeded: false,           // default vocabulary (n8n, Higgsfield...) added once
};
const MODELS = ['auto', 'small', 'medium', 'large-v3-turbo', 'large-v3'];
const OVERLAY_W = 420;
const OVERLAY_H = 120;

// ---- CLI flags (dev/verification) ------------------------------------------
const argv = {};
for (const a of process.argv.slice(1)) {
  const m = a.match(/^--([a-z-]+)(?:=(.*))?$/i);
  if (m) argv[m[1]] = m[2] === undefined ? true : m[2];
}
const DEV_MODE = !!(argv['test-pipeline'] || argv.screenshots || argv['ui-test'] || argv['guess-test'] || argv['learn-test']);
// --user-data-dir=<dir>: separate profile (tests, portable use); Windows ignores %APPDATA% for Electron.
if (typeof argv['user-data-dir'] === 'string' && argv['user-data-dir']) app.setPath('userData', path.resolve(argv['user-data-dir']));

// ---- Single instance -------------------------------------------------------
if (!app.requestSingleInstanceLock() && !DEV_MODE) {
  app.quit();
}

let userData, logDir, logFile;
let settings, dictionary, snippets, history;
let hub = null, overlay = null, tray = null, sidecar = null;
let quitting = false;
let shortcutOk = false;
let pttAvailable = false;
let uiohookMod = null;
// learn = the word being said in "Dis-le" (Dictionnaire): that dictation teaches a variant instead of typing.
const dictation = { phase: 'idle', startedAt: 0, stoppedAt: 0, toHub: false, noPaste: false, learn: null, timer: null, idleTimer: null };
const guessJob = { running: false, cancel: false };
const wisprInstalled = !!wisprDbPath();   // offers "Reprendre mon dictionnaire Wispr Flow"

function log(...parts) {
  const line = `${new Date().toISOString()} ${parts.map((p) => (p instanceof Error ? (p.stack || p.message) : typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}`;
  if (!app.isPackaged || DEV_MODE) console.log(line);
  try { fs.appendFileSync(logFile, line + '\n'); } catch { /* ignore */ }
}

// ---- Stores ----------------------------------------------------------------
function initStores() {
  userData = app.getPath('userData');
  logDir = path.join(userData, 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  logFile = path.join(logDir, 'freeflow.log');
  settings = createStore(path.join(userData, 'settings.json'), DEFAULT_SETTINGS);
  if (!fs.existsSync(settings.path)) settings.set(settings.get()); // write defaults so the file is discoverable
  // Models (0,5 to 3 GB) go to %LOCALAPPDATA%\FreeFlow\models, never to the roaming profile.
  if (!settings.get().modelCache) settings.update({ modelCache: path.join(process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'FreeFlow') : userData, 'models') });
  dictionary = createStore(path.join(userData, 'dictionary.json'), []);
  // Vocabulary entries are { word, sounds[] }; migrate legacy string lists and seed the defaults once.
  let vocab = normalizeVocab(dictionary.get());
  if (!settings.get().vocabSeeded) {
    const have = new Set(vocab.map((e) => e.word.toLowerCase()));
    vocab = [...vocab, ...normalizeVocab(DEFAULT_VOCAB).filter((e) => !have.has(e.word.toLowerCase()))];
    settings.update({ vocabSeeded: true });
  }
  dictionary.set(vocab);
  snippets = createStore(path.join(userData, 'snippets.json'), []);
  history = createStore(path.join(userData, 'history.json'), []);
}

function computeStats(hist) {
  const today = new Date().toDateString();
  let wordsToday = 0, total = 0, audioMs = 0, wordsTimed = 0, latency = 0, latencyN = 0;
  for (const h of hist) {
    total += h.words || 0;
    if (new Date(h.ts).toDateString() === today) wordsToday += h.words || 0;
    if (h.audioMs > 0) { audioMs += h.audioMs; wordsTimed += h.words || 0; }
    if (h.latencyMs > 0) { latency += h.latencyMs; latencyN += 1; }
  }
  return {
    wordsToday,
    totalWords: total,
    dictations: hist.length,
    avgWpm: audioMs > 0 ? Math.round(wordsTimed / (audioMs / 60000)) : 0,
    avgLatencyMs: latencyN ? Math.round(latency / latencyN) : 0,
    minutesSpoken: Math.round(audioMs / 60000),
  };
}

function buildState() {
  const hist = history.get();
  return {
    version: app.getVersion(),
    // First name only ("Bonjour, Alan"); --display-name=<x> overrides it for screenshots.
    user: typeof argv['display-name'] === 'string' ? argv['display-name'] : String(os.userInfo().username || '').split(/[\s._-]+/)[0],
    settings: settings.get(),
    dictionary: dictionary.get(),
    snippets: snippets.get(),
    history: hist.slice(0, 300),
    stats: computeStats(hist),
    sidecar: sidecar ? { ...sidecar.info, port: sidecar.port, external: sidecar.external } : { ready: false, loading: true },
    loadingLabel: loadingLabel(sidecar ? sidecar.info : null),
    loadingShort: loadingLabel(sidecar ? sidecar.info : null, true),
    pttAvailable: hookAvailable(),
    shortcutOk,
    shortcutSuspended,
    phase: dictation.phase,
    platform: process.platform,
    permissions: macPermissions(),
    wispr: wisprInstalled,
    guessing: guessJob.running,
    learning: dictation.learn,
    paths: { userData, logs: logDir, pasteHelper: pasteHelperPath() },
  };
}

function sendHub(channel, payload) {
  if (hub && !hub.isDestroyed()) hub.webContents.send(channel, payload);
}

// ---- macOS permissions -------------------------------------------------------
// Accessibility covers both the keyboard hook (push-to-talk, modifier-only
// chords) and the simulated Cmd+V; the microphone has its own prompt.
function macTrusted() {
  return IS_MAC ? systemPreferences.isTrustedAccessibilityClient(false) : true;
}

function macPermissions() {
  if (!IS_MAC) return null;
  return { accessibility: macTrusted(), microphone: systemPreferences.getMediaAccessStatus('microphone') };
}

function hookAvailable() {
  return !!(uiohookMod && uiohookMod.uIOhook) && macTrusted();
}

function pushState() {
  if (hub && !hub.isDestroyed()) hub.webContents.send('ff:state', buildState());
}

// ---- Paths -----------------------------------------------------------------
function pasteHelperPath() {
  const candidates = [
    path.join(process.resourcesPath || '', 'PasteHelper.exe'),
    path.join(ROOT, 'native', 'PasteHelper.exe'),
  ];
  return candidates.find((p) => p && fs.existsSync(p)) || candidates[1];
}

// ---- Windows ---------------------------------------------------------------
function createHub() {
  hub = new BrowserWindow({
    width: 1100, height: 720, minWidth: 900, minHeight: 600,
    title: 'FreeFlow',
    backgroundColor: '#fcfcfb',
    icon: path.join(ASSETS, 'icon.ico'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  hub.loadFile(path.join(ROOT, 'renderer', 'hub', 'index.html'));
  hub.on('page-title-updated', (e) => e.preventDefault());
  hub.on('close', (e) => { if (!quitting) { e.preventDefault(); hub.hide(); } });
  hub.on('hide', () => { if (shortcutSuspended) { shortcutSuspended = false; registerShortcut(); pushState(); } });
  hub.webContents.on('did-finish-load', pushState);
  hub.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  hub.webContents.on('will-navigate', (e) => e.preventDefault());   // a dropped file or a link never replaces the app page
}

function showHub() {
  if (!hub || hub.isDestroyed()) createHub();
  if (!hub.isVisible()) hub.show();
  hub.focus();
  pushState();
}

function createOverlay() {
  overlay = new BrowserWindow({
    width: OVERLAY_W, height: OVERLAY_H, show: false,
    ...(IS_MAC ? { type: 'panel' } : {}),   // a panel floats over full-screen apps without taking the focus
    frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
    alwaysOnTop: true, skipTaskbar: true, focusable: false, resizable: false, movable: false,
    minimizable: false, maximizable: false, fullscreenable: false,
    webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.loadFile(path.join(ROOT, 'renderer', 'overlay', 'index.html'));
  overlay.webContents.on('will-navigate', (e) => e.preventDefault());
  overlay.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  positionOverlay();
}

function positionOverlay() {
  if (!overlay) return;
  const wa = screen.getPrimaryDisplay().workArea;
  overlay.setBounds({
    x: Math.round(wa.x + (wa.width - OVERLAY_W) / 2),
    y: Math.round(wa.y + wa.height - OVERLAY_H - 12),
    width: OVERLAY_W, height: OVERLAY_H,
  });
}

function overlaySend(channel, payload) {
  if (overlay && !overlay.isDestroyed()) overlay.webContents.send(channel, payload);
}

function showOverlay() {
  positionOverlay();
  if (!overlay.isVisible()) overlay.showInactive();
  overlay.setAlwaysOnTop(true, 'screen-saver');
}

// ---- Tray ------------------------------------------------------------------
// The macOS menu bar wants black "Template" images (tinted by the system for
// light and dark menu bars) at 16 px plus an @2x file.
const TRAY_ICONS = IS_MAC
  ? { idle: 'trayTemplate.png', loading: 'trayLoadingTemplate.png', rec: 'tray-mac-rec.png' }
  : { idle: 'tray.png', loading: 'tray-loading.png', rec: 'tray-rec.png' };

function trayIcon(state) {
  return nativeImage.createFromPath(path.join(ASSETS, TRAY_ICONS[state]));
}

function createTray() {
  tray = new Tray(trayIcon('loading'));
  tray.setToolTip('FreeFlow — Chargement du modèle…');
  tray.on('click', showHub);
  tray.on('double-click', showHub);
  updateTray();
}

const KEY_NAMES = IS_MAC
  ? { Super: '⌘ Cmd', Space: 'Espace', Ctrl: '⌃ Ctrl', Alt: '⌥ Option', Shift: '⇧ Maj' }
  : { Super: 'Win', Space: 'Espace', Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Maj' };

function prettyShortcut(acc) {
  return String(acc || '').split('+').map((k) => KEY_NAMES[k] || k).join(' + ');
}

// "Téléchargement du modèle · 42 % (1,3 / 3,1 Go)" on first start (short: "Téléchargement · 42 %"),
// else "Chargement du modèle…".
function loadingLabel(info, short = false) {
  const d = info && info.phase === 'downloading' ? info.download : null;
  if (!d) return 'Chargement du modèle…';
  const go = (b) => (b / 1e9).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (!d.total) return short ? 'Téléchargement…' : `Téléchargement du modèle · ${go(d.done || 0)} Go`;
  const pct = Math.min(99, Math.floor((100 * (d.done || 0)) / d.total));
  return short ? `Téléchargement · ${pct} %` : `Téléchargement du modèle · ${pct} % (${go(d.done || 0)} / ${go(d.total)} Go)`;
}

function updateTray() {
  if (!tray) return;
  const s = settings.get();
  const listening = dictation.phase === 'listening';
  const busy = dictation.phase === 'transcribing' || dictation.phase === 'formatting';
  const info = sidecar ? sidecar.info : {};
  tray.setImage(trayIcon(listening ? 'rec' : info.ready ? 'idle' : 'loading'));
  const engine = info.ready ? `${info.device === 'cuda' ? 'GPU' : 'CPU'} · ${info.model}` : info.loading ? loadingLabel(info) : (info.error ? 'Moteur indisponible' : '…');
  tray.setToolTip(`FreeFlow — ${listening ? 'Écoute…' : busy ? 'Transcription…' : engine}\nRaccourci : ${prettyShortcut(s.shortcut)}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Ouvrir FreeFlow', click: showHub },
    { label: listening ? 'Arrêter la dictée (mains libres)' : 'Démarrer la dictée (mains libres)', enabled: !!info.ready && !busy, click: () => toggleDictation() },
    { type: 'separator' },
    { label: `Raccourci : ${prettyShortcut(s.shortcut)}${shortcutOk ? '' : ' (indisponible)'}`, enabled: false },
    { label: info.ready ? `Moteur : ${engine} (${info.compute_type})` : `Moteur : ${engine}`, enabled: false },
    { type: 'separator' },
    { label: 'Quitter', click: quitApp },
  ]));
}

// ---- Dictation state machine ----------------------------------------------
function setPhase(phase, payload = {}) {
  dictation.phase = phase;
  overlaySend('ff:overlay', { phase, ...payload });
  if (hub && !hub.isDestroyed()) hub.webContents.send('ff:dictation', { phase, ...payload });
  updateTray();
}

function scheduleIdle(ms) {
  clearTimeout(dictation.idleTimer);
  dictation.idleTimer = setTimeout(() => {
    setPhase('idle');
    setTimeout(() => { if (dictation.phase === 'idle' && overlay && overlay.isVisible()) overlay.hide(); }, 420);
    pushState();
  }, ms);
}

function flashOverlay(phase, message, ms = 1600) {
  showOverlay();
  setPhase(phase, { message });
  scheduleIdle(ms);
}

function startDictation(opts = {}) {
  if (dictation.phase !== 'idle') return false;
  if (!sidecar || !sidecar.ready) {
    flashOverlay('error', sidecar && sidecar.info.loading ? (sidecar.info.phase === 'downloading' ? `Modèle en téléchargement${(loadingLabel(sidecar.info, true).match(/\d+ %/) || ['…'])[0].replace(/^(\d)/, ' · $1')}` : 'Modèle en cours de chargement…') : 'Moteur de transcription indisponible');
    return false;
  }
  clearTimeout(dictation.idleTimer);
  dictation.toHub = !!opts.toHub;
  dictation.noPaste = !!opts.noPaste;
  dictation.learn = opts.learn ? String(opts.learn) : null;
  dictation.startedAt = Date.now();
  dictation.stoppedAt = 0;
  showOverlay();
  setPhase('listening');
  const s = settings.get();
  overlaySend('ff:rec-start', { deviceId: s.microphoneId, maxSec: s.maxDictationSec });
  clearTimeout(dictation.timer);
  dictation.timer = setTimeout(() => stopDictation(), (s.maxDictationSec || 300) * 1000);
  log('dictation: listening', opts);
  return true;
}

function stopDictation() {
  if (dictation.phase !== 'listening') return false;
  clearTimeout(dictation.timer);
  dictation.stoppedAt = Date.now();
  setPhase('transcribing');
  overlaySend('ff:rec-stop');
  return true;
}

function cancelDictation() {
  clearTimeout(dictation.timer);
  dictation.learn = null;
  overlaySend('ff:rec-cancel');
  setPhase('idle');
  scheduleIdle(0);
}

function toggleDictation(opts = {}) {
  if (dictation.phase === 'listening') return stopDictation();
  if (dictation.phase === 'idle') return startDictation(opts);
  return false;
}

ipcMain.on('ff:audio-done', (_e, payload) => {
  const pcm = Buffer.from(payload.pcm);
  const wav = pcm16ToWav(pcm, payload.sampleRate || 16000, 1);
  log(`audio: ${wavDurationMs(wav)} ms @ ${payload.sampleRate} Hz (${(wav.length / 1024).toFixed(0)} KiB)`);
  const learn = dictation.learn;
  dictation.learn = null;
  if (wavDurationMs(wav) < 250) {
    if (learn) sendHub('ff:learn', { word: learn, heard: '', suggestions: [], error: 'Rien entendu' });
    setPhase('error', { message: 'Rien entendu' });
    scheduleIdle(1200);
    return;
  }
  if (learn) runLearn(wav, learn).catch(() => {});
  else runPipeline(wav, { toHub: dictation.toHub, noPaste: dictation.noPaste }).catch(() => {});
});

ipcMain.on('ff:audio-error', (_e, message) => {
  log('audio error:', message);
  if (dictation.learn) sendHub('ff:learn', { word: dictation.learn, heard: '', suggestions: [], error: message || 'Micro indisponible' });
  dictation.learn = null;
  setPhase('error', { message: message || 'Micro indisponible' });
  scheduleIdle(2000);
});

// The dictionary words become Whisper's prompt, which keeps only its last
// ~220 tokens: past ~50 words, the ones used most in recent dictations go
// last so they are never cut off.
function hintWords() {
  const vocab = dictionary.get();
  if (vocab.length <= 50) return vocab.map((e) => e.word);
  const recent = fold(history.get().slice(0, 300).map((h) => h.text).join('\n'));
  const scored = vocab.map((e, i) => ({ word: e.word, i, n: recent.split(fold(e.word)).length - 1 }));
  scored.sort((a, b) => b.n - a.n || b.i - a.i);
  return scored.slice(0, 50).reverse().map((x) => x.word);
}

/** "Dis-le": transcribe WITHOUT the dictionary and offer what the model wrote as variants. */
async function runLearn(wav, word) {
  if (dictation.phase !== 'transcribing') setPhase('transcribing');
  try {
    const res = await sidecar.transcribe(wav, { lang: settings.get().language, hints: [] });
    const entry = dictionary.get().find((e) => e.word.toLowerCase() === word.toLowerCase());
    const suggestions = suggestionsFor(word, splitSpoken(res.text), entry ? entry.sounds : [], guessLanguage());
    log(`learn "${word}": heard "${res.text}" -> ${suggestions.length} suggestion(s)`);
    sendHub('ff:learn', { word, heard: res.text, suggestions });
    setPhase('done', { text: res.text, latencyMs: Date.now() - (dictation.stoppedAt || Date.now()) });
    scheduleIdle(900);
  } catch (err) {
    log('learn error:', err);
    sendHub('ff:learn', { word, heard: '', suggestions: [], error: err.message || String(err) });
    setPhase('error', { message: err.message || String(err) });
    scheduleIdle(2200);
  }
}

/**
 * WAV -> STT -> format -> clipboard (+ paste) -> history.
 * @param {Buffer} wav
 * @param {{toHub?:boolean, noPaste?:boolean}} opts
 */
async function runPipeline(wav, opts = {}) {
  const t0 = Date.now();
  const s = settings.get();
  if (dictation.phase !== 'transcribing') setPhase('transcribing');
  try {
    const res = await sidecar.transcribe(wav, { lang: s.language, hints: hintWords() });
    setPhase('formatting');
    const text = formatText(res.text, { language: res.language, snippets: snippets.get(), dictionary: dictionary.get() });
    if (!text) {
      setPhase('error', { message: 'Rien entendu' });
      scheduleIdle(1200);
      return { text: '', raw: res.text, sttMs: res.duration_ms, audioMs: res.audio_ms };
    }
    // Electron >= 44: clipboard.readText()/writeText() return Promises; awaiting a plain value is harmless.
    const previousClipboard = await clipboard.readText();
    await clipboard.writeText(text);
    let pasteOutcome = null;
    const shouldPaste = s.autoPaste && !opts.noPaste && !opts.toHub;
    if (opts.toHub && hub && !hub.isDestroyed()) hub.webContents.send('ff:insert', text);
    if (shouldPaste) {
      pasteOutcome = IS_MAC
        ? await pasteMac({ uiohook: uiohookMod && uiohookMod.uIOhook ? uiohookMod : null, trusted: macTrusted(), delayMs: s.pasteDelayMs, log })
        : await paste(pasteHelperPath(), { delayMs: s.pasteDelayMs, log });
      if (pasteOutcome.outcome === 'pasted' && previousClipboard !== text) {
        setTimeout(async () => {
          try { if ((await clipboard.readText()) === text) await clipboard.writeText(previousClipboard); } catch (e) { log('clipboard restore:', e.message); }
        }, s.restoreClipboardMs || 400);
      }
    }
    const latencyMs = Date.now() - (dictation.stoppedAt || t0);
    const entry = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      ts: new Date().toISOString(),
      text,
      raw: res.text,
      words: countWords(text),
      audioMs: res.audio_ms || wavDurationMs(wav),
      sttMs: res.duration_ms,
      latencyMs,
      language: res.language,
      app: pasteOutcome ? pasteOutcome.process : (opts.toHub ? 'FreeFlow' : null),
      pasted: pasteOutcome ? pasteOutcome.outcome : (opts.toHub ? 'hub' : 'clipboard'),
    };
    history.set([entry, ...history.get()].slice(0, 2000));
    log(`dictation: ${entry.words} words, stt ${entry.sttMs} ms, latency ${latencyMs} ms, paste=${entry.pasted}`);
    setPhase('done', { text, latencyMs, pasted: entry.pasted });
    scheduleIdle(pasteOutcome && pasteOutcome.outcome === 'blocked' ? 2200 : 900);
    if (pasteOutcome && pasteOutcome.outcome === 'blocked') {
      setPhase('error', { message: pasteOutcome.reason === 'accessibility' ? 'Autorise FreeFlow dans Accessibilité — texte copié' : 'Collage bloqué — texte copié dans le presse-papiers' });
    }
    pushState();
    return entry;
  } catch (err) {
    log('pipeline error:', err);
    setPhase('error', { message: err.message || String(err) });
    scheduleIdle(2200);
    throw err;
  }
}

// ---- Shortcut / push-to-talk ----------------------------------------------
const MOD_KEYS = new Set(['ctrl', 'control', 'alt', 'shift', 'super', 'meta', 'cmd', 'command', 'commandorcontrol', 'cmdorctrl']);

function parseAccelerator(acc) {
  const parts = String(acc || '').split('+').map((p) => p.trim()).filter(Boolean);
  const out = { ctrl: false, alt: false, shift: false, meta: false, key: null };
  for (const p of parts) {
    const l = p.toLowerCase();
    if (l === 'ctrl' || l === 'control' || l === 'commandorcontrol' || l === 'cmdorctrl') out.ctrl = true;
    else if (l === 'alt') out.alt = true;
    else if (l === 'shift') out.shift = true;
    else if (l === 'super' || l === 'meta' || l === 'cmd' || l === 'command') out.meta = true;
    else out.key = p;
  }
  return out;
}

function uiohookKeycode(key) {
  if (!uiohookMod || !key) return null;
  const K = uiohookMod.UiohookKey;
  const map = {
    Space: 'Space', Enter: 'Enter', Return: 'Enter', Tab: 'Tab', Esc: 'Escape', Escape: 'Escape', Backspace: 'Backspace', Delete: 'Delete',
    Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Up: 'ArrowUp', Down: 'ArrowDown', Left: 'ArrowLeft',
    Right: 'ArrowRight', CapsLock: 'CapsLock', Capslock: 'CapsLock', Plus: 'Equal', Minus: 'Minus', Comma: 'Comma', Period: 'Period', Slash: 'Slash',
    Semicolon: 'Semicolon', Quote: 'Quote', Backslash: 'Backslash', '-': 'Minus', '=': 'Equal', ',': 'Comma', '.': 'Period', '/': 'Slash',
    ';': 'Semicolon', "'": 'Quote', '\\': 'Backslash', '[': 'BracketLeft', ']': 'BracketRight', '`': 'Backquote',
  };
  let name = map[key];
  if (!name && /^num\d$/i.test(key)) name = 'Numpad' + key.slice(3);
  if (!name) name = /^[a-z]$/i.test(key) ? key.toUpperCase() : /^[0-9]$/.test(key) ? key : /^F\d{1,2}$/i.test(key) ? key.toUpperCase() : key;
  return K[name] ?? null;
}

// One low-level keyboard hook (uiohook) handles push-to-talk AND modifier-only
// chords such as Ctrl+Win (Electron's globalShortcut cannot register those).
// It never blocks keys; for chords containing Win it taps an unassigned key so
// Windows does not open the Start menu on release (like Wispr's masking).
const hook = { active: false, mode: 'toggle', combo: null, modOf: null, down: new Map(), comboDown: false, pressedAt: 0, handsFree: false, spoiled: false };
let shortcutSuspended = false;     // true while the hub records a new shortcut

function comboActive() {
  const c = hook.combo;
  const mods = { ctrl: false, alt: false, shift: false, meta: false };
  let keyDown = false, others = 0;
  for (const code of hook.down.keys()) {
    const m = hook.modOf.get(code);
    if (m) mods[m] = true;
    else if (c.keycode != null && code === c.keycode) keyDown = true;
    else others += 1;
  }
  if (mods.ctrl !== c.ctrl || mods.alt !== c.alt || mods.shift !== c.shift || mods.meta !== c.meta) return false;
  if (others) return false;
  return c.keycode == null ? true : keyDown;
}

function foreignKeyHeld() {
  for (const code of hook.down.keys()) if (!hook.modOf.has(code) && code !== hook.combo.keycode) return true;
  return false;
}

function maskWinKey() {
  execFile(pasteHelperPath(), ['--mask'], { windowsHide: true, timeout: 3000 }, () => {});
}

function onComboDown() {
  if (hook.combo.meta && IS_WIN) maskWinKey();
  if (hook.mode === 'ptt') {
    if (dictation.phase === 'listening' && hook.handsFree) { hook.handsFree = false; stopDictation(); return; }
    if (dictation.phase === 'idle') startDictation();
  }
}

function onComboUp() {
  const held = Date.now() - hook.pressedAt;
  if (hook.mode === 'ptt') {
    if (dictation.phase !== 'listening') return;
    if (hook.spoiled && held < 700) { cancelDictation(); return; }   // e.g. Ctrl+Win+D: not a dictation
    if (held < 300) { hook.handsFree = true; return; }                // tap = hands-free, like Wispr
    stopDictation();
  } else if (!hook.spoiled) {
    toggleDictation();                                                // modifier-only chord fires on release
  }
}

function stopHook() {
  if (hook.active && uiohookMod) {
    try { uiohookMod.uIOhook.removeAllListeners(); uiohookMod.uIOhook.stop(); } catch (e) { log('uiohook stop:', e.message); }
  }
  hook.active = false; hook.comboDown = false; hook.handsFree = false; hook.down.clear();
}

function startHook(acc, mode) {
  const combo = parseAccelerator(acc);
  combo.keycode = combo.key ? uiohookKeycode(combo.key) : null;
  if (combo.key && combo.keycode == null) { log(`hook: unknown key in "${acc}"`); return false; }
  const K = uiohookMod.UiohookKey;
  hook.modOf = new Map([[K.Ctrl, 'ctrl'], [K.CtrlRight, 'ctrl'], [K.Alt, 'alt'], [K.AltRight, 'alt'], [K.Shift, 'shift'], [K.ShiftRight, 'shift'], [K.Meta, 'meta'], [K.MetaRight, 'meta']]);
  hook.combo = combo; hook.mode = mode; hook.down.clear(); hook.comboDown = false; hook.handsFree = false;
  const { uIOhook } = uiohookMod;
  uIOhook.on('keydown', (e) => {
    const now = Date.now();
    if (!hook.comboDown) for (const [code, t] of hook.down) if (now - t > 8000) hook.down.delete(code); // missed key-ups (lock screen...)
    if (!hook.down.has(e.keycode)) hook.down.set(e.keycode, now);
    if (!hook.comboDown) {
      if (comboActive()) { hook.comboDown = true; hook.spoiled = false; hook.pressedAt = now; onComboDown(); }
    } else if (!comboActive()) {
      hook.spoiled = true;                                            // another key joined the chord
    }
  });
  uIOhook.on('keyup', (e) => {
    hook.down.delete(e.keycode);
    if (!hook.comboDown || comboActive()) return;
    if (foreignKeyHeld()) { hook.spoiled = true; return; }            // wait until the foreign key is released
    hook.comboDown = false;
    onComboUp();
  });
  try { uIOhook.start(); hook.active = true; log(`hook: started for ${acc} (${mode}${combo.key ? '' : ', modifier-only'})`); return true; } catch (e) { log('uiohook start failed:', e.message); return false; }
}

function registerShortcut() {
  globalShortcut.unregisterAll();
  stopHook();
  shortcutOk = false;
  if (shortcutSuspended) { log('shortcut: suspended while recording'); updateTray(); return; }
  const s = settings.get();
  const combo = parseAccelerator(s.shortcut);
  const modifierOnly = !combo.key;
  if ((s.mode === 'ptt' || modifierOnly) && hookAvailable()) {
    shortcutOk = startHook(s.shortcut, s.mode);
    if (!shortcutOk && s.mode === 'ptt' && !modifierOnly) { settings.update({ mode: 'toggle' }); return registerShortcut(); }
  } else if (modifierOnly) {
    log(`shortcut ${s.shortcut}: modifier-only chords need uiohook-napi${IS_MAC ? ' and the Accessibility permission' : ''}`);
  } else {
    // Push-to-talk waiting for the macOS Accessibility permission: the same keys toggle meanwhile.
    try { shortcutOk = globalShortcut.register(s.shortcut, () => toggleDictation()); } catch (e) { log('shortcut error:', e.message); shortcutOk = false; }
    log(`shortcut ${s.shortcut}: ${shortcutOk ? 'registered' : 'FAILED'}`);
  }
  updateTray();
}

// ---- IPC (hub) --------------------------------------------------------------
ipcMain.handle('ff:get-state', () => buildState());

ipcMain.handle('ff:set-settings', (_e, patch) => {
  const before = settings.get();
  if (patch && patch.model && !MODELS.includes(patch.model)) delete patch.model;
  const next = settings.update(patch || {});
  if (next.shortcut !== before.shortcut || next.mode !== before.mode) registerShortcut();
  if (next.model !== before.model && sidecar && !process.env.FREEFLOW_NO_SIDECAR) {
    log(`model: ${before.model} -> ${next.model}, restarting the engine`);
    sidecar.restart({ model: next.model }).then(() => { updateTray(); pushState(); }).catch((e) => log('restart:', e));
  }
  if (next.launchAtLogin !== before.launchAtLogin) {
    try { app.setLoginItemSettings({ openAtLogin: !!next.launchAtLogin, path: process.execPath, args: app.isPackaged ? [] : [ROOT] }); } catch (e) { log('login item:', e.message); }
  }
  updateTray();
  const state = buildState();
  pushState();
  return state;
});

ipcMain.handle('ff:shortcut-test', (_e, acc) => {
  const c = parseAccelerator(acc);
  const nMods = [c.ctrl, c.alt, c.shift, c.meta].filter(Boolean).length;
  if (!c.key) {
    if (!hookAvailable()) {
      return { ok: false, error: IS_MAC && pttAvailable
        ? 'Les raccourcis sans touche normale demandent l’autorisation Accessibilité (Réglages Système → Confidentialité et sécurité).'
        : 'Les raccourcis sans touche normale demandent le module uiohook-napi.' };
    }
    if (nMods < 2) return { ok: false, error: `Avec seulement des touches de modification, il en faut au moins deux (ex. ${IS_MAC ? '⌃ Ctrl + ⌥ Option' : 'Ctrl + Win'}).` };
    return { ok: true };
  }
  if (!nMods && !/^F\d{1,2}$/i.test(c.key)) return { ok: false, error: `Ajoute au moins une touche de modification (${IS_MAC ? '⌃ Ctrl, ⌥ Option, ⇧ Maj, ⌘ Cmd' : 'Ctrl, Alt, Maj, Win'}), ou utilise une touche F1 à F12.` };
  if (settings.get().mode === 'ptt' && hookAvailable()) {
    return uiohookKeycode(c.key) != null ? { ok: true } : { ok: false, error: `La touche « ${c.key} » n’est pas reconnue en mode maintenu.` };
  }
  if (acc === settings.get().shortcut && shortcutOk) return { ok: true };
  try {
    const ok = globalShortcut.register(acc, () => {});
    if (ok) globalShortcut.unregister(acc);
    return ok ? { ok } : { ok, error: 'Déjà utilisé par une autre application.' };
  } catch (e) { return { ok: false, error: e.message }; }
});

// While the hub records a shortcut, release the current one so the keys reach the recorder
// (and do not start a dictation).
ipcMain.handle('ff:shortcut-suspend', (_e, on) => {
  const next = !!on;
  if (next !== shortcutSuspended) { shortcutSuspended = next; registerShortcut(); }
  return { suspended: shortcutSuspended, ok: shortcutOk };
});

ipcMain.handle('ff:dictionary', (_e, { action, word, sounds, previous } = {}) => {
  let list = normalizeVocab(dictionary.get());
  const w = String(word || '').trim();
  const snd = parseSounds(sounds);
  const find = (k) => list.find((e) => e.word.toLowerCase() === String(k || '').trim().toLowerCase());
  if (action === 'add' && w) {
    const ex = find(w);
    if (ex) ex.sounds = [...ex.sounds, ...snd]; else list.push({ word: w, sounds: snd });
  }
  if (action === 'update' && w) {
    const ex = find(previous || w);
    if (ex) { ex.word = w; ex.sounds = snd; } else list.push({ word: w, sounds: snd });
  }
  if (action === 'remove') list = list.filter((e) => e.word !== w);
  if (action === 'restore-defaults') {
    const have = new Set(list.map((e) => e.word.toLowerCase()));
    list = [...list, ...normalizeVocab(DEFAULT_VOCAB).filter((e) => !have.has(e.word.toLowerCase()))];
  }
  dictionary.set(normalizeVocab(list));
  pushState();
  return dictionary.get();
});

// ---- Dictionary as a file: import (preview, then apply), export, template ---------
// What an import would do to the current dictionary, entry by entry.
function importPreview(entries, snips = []) {
  const current = new Map(dictionary.get().map((e) => [e.word.toLowerCase(), e]));
  const counts = { new: 0, merge: 0, same: 0 };
  const rows = entries.map((e) => {
    const ex = current.get(e.word.toLowerCase());
    let status = 'new', newSounds = e.sounds;
    if (ex) {
      newSounds = mergeVocab([ex], [e]).list[0].sounds.slice(ex.sounds.length);
      status = newSounds.length ? 'merge' : 'same';
    }
    counts[status] += 1;
    return { word: e.word, sounds: e.sounds, status, newSounds };
  });
  const triggers = new Set(snippets.get().map((x) => x.trigger.toLowerCase()));
  const newSnippets = snips.filter((x) => !triggers.has(x.trigger.toLowerCase()));
  return { entries: rows, counts, snippets: newSnippets };
}

ipcMain.handle('ff:vocab-parse', (_e, { data, name, direction } = {}) => {
  const size = typeof data === 'string' ? data.length : (data && data.byteLength) || 0;
  if (size > 20 * 1024 * 1024) return { ok: false, error: 'Fichier trop lourd (20 Mo au plus).' };
  try {
    const res = parseVocabFile(data, { name, direction });
    log(`import: ${name || 'pasted text'} -> ${res.format}, ${res.entries.length} words, ${res.skipped.length} skipped (${res.direction})`);
    return { ok: true, ...importPreview(res.entries), skipped: res.skipped.slice(0, 200), skippedCount: res.skipped.length, format: res.format, direction: res.direction, swappable: res.swappable, source: name || null };
  } catch (e) {
    log('import parse error:', e);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('ff:vocab-wispr', async () => {
  try {
    const res = await readWisprDictionary();
    log(`import: Wispr Flow -> ${res.entries.length} words, ${res.snippets.length} snippets`);
    return { ok: true, ...importPreview(normalizeVocab(res.entries), res.snippets), skipped: [], skippedCount: 0, format: 'Wispr Flow', direction: 'word-first', swappable: false, source: 'Wispr Flow' };
  } catch (e) {
    log('wispr import error:', e);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('ff:vocab-apply', (_e, { entries = [], snippets: snips = [] } = {}) => {
  const res = mergeVocab(dictionary.get(), entries.map((e) => ({ word: e.word, sounds: e.sounds || [] })));
  dictionary.set(res.list);
  let addedSnippets = 0;
  if (snips.length) {
    const list = snippets.get();
    const triggers = new Set(list.map((x) => x.trigger.toLowerCase()));
    for (const sn of snips) {
      const t = String(sn.trigger || '').trim();
      if (!t || triggers.has(t.toLowerCase())) continue;
      triggers.add(t.toLowerCase());
      list.push({ id: `${Date.now().toString(36)}${addedSnippets}`, trigger: t, expansion: String(sn.expansion || '') });
      addedSnippets += 1;
    }
    snippets.set(list);
  }
  log(`import applied: +${res.added} words, ${res.merged} completed, +${addedSnippets} snippets`);
  pushState();
  return { added: res.added, merged: res.merged, snippets: addedSnippets };
});

// Save dialog for an Excel file (or CSV when that is what the user picks), then show it in the folder.
async function saveSheet(title, defaultName, makeXlsx, makeCsv) {
  const r = await dialog.showSaveDialog(hub, {
    title,
    defaultPath: path.join(app.getPath('documents'), defaultName),
    filters: [
      { name: 'Excel (.xlsx)', extensions: ['xlsx'] },
      ...(makeCsv ? [{ name: 'CSV (Google Sheets, Numbers)', extensions: ['csv'] }] : []),
    ],
  });
  if (r.canceled || !r.filePath) return null;
  const csv = makeCsv && /\.csv$/i.test(r.filePath);
  fs.writeFileSync(r.filePath, csv ? makeCsv() : makeXlsx(), csv ? 'utf8' : undefined);
  shell.showItemInFolder(r.filePath);
  return r.filePath;
}

ipcMain.handle('ff:vocab-export', () => saveSheet('Exporter le dictionnaire', 'freeflow-dictionnaire.xlsx', () => vocabToXlsx(dictionary.get()), () => vocabToCsv(dictionary.get())));
ipcMain.handle('ff:vocab-template', () => saveSheet('Enregistrer le modèle Excel', 'freeflow-dictionnaire-modele.xlsx', templateXlsx));
ipcMain.handle('ff:vocab-example', () => saveSheet('Enregistrer l’exemple rempli', 'freeflow-dictionnaire-exemple.xlsx', exampleXlsx));
ipcMain.handle('ff:vocab-ai-prompt', async () => { await clipboard.writeText(AI_PROMPT); return true; });

// ---- "Deviner" / "Dis-le": find what the model hears ------------------------------
function guessLanguage() {
  const l = settings.get().language;
  if (l === 'fr' || l === 'en') return l;
  return /^en/i.test(app.getLocale()) ? 'en' : 'fr';
}

ipcMain.handle('ff:vocab-guess', (_e, { words = [] } = {}) => {
  if (guessJob.running) return { ok: false, error: 'Une écoute est déjà en cours.' };
  if (!sidecar || !sidecar.ready) return { ok: false, error: 'Le modèle n’est pas encore prêt.' };
  const byWord = new Map(dictionary.get().map((e) => [e.word.toLowerCase(), e]));
  const list = words.map((w) => byWord.get(String(w).toLowerCase()) || { word: String(w), sounds: [] }).filter((e) => e.word.trim());
  if (!list.length) return { ok: false, error: 'Aucun mot à écouter.' };
  guessJob.running = true; guessJob.cancel = false;
  const lang = guessLanguage();
  log(`guess: ${list.length} word(s), ${lang}`);
  sendHub('ff:guess', { phase: 'start', done: 0, total: list.length });
  guessVariants(list, {
    lang,
    transcribe: (wav, l) => sidecar.transcribe(wav, { lang: l, hints: [] }),
    onProgress: (p) => sendHub('ff:guess', { phase: 'progress', ...p }),
    cancelled: () => guessJob.cancel,
  }).then((results) => {
    log(`guess: done, ${results.reduce((n, r) => n + r.suggestions.length, 0)} suggestion(s)`);
    sendHub('ff:guess', { phase: 'done', results, cancelled: guessJob.cancel });
  }).catch((e) => {
    log('guess error:', e);
    sendHub('ff:guess', { phase: 'error', error: e.message || String(e) });
  }).finally(() => { guessJob.running = false; pushState(); });
  return { ok: true, total: list.length };
});

ipcMain.handle('ff:vocab-guess-cancel', () => { guessJob.cancel = true; return true; });

ipcMain.handle('ff:vocab-learn', (_e, { word } = {}) => {
  const w = String(word || '').trim();
  if (dictation.phase === 'listening') return { ok: stopDictation(), phase: 'transcribing' };
  if (!w) return { ok: false, error: 'Écris d’abord le mot.' };
  return { ok: startDictation({ toHub: true, learn: w }), phase: dictation.phase };
});

// ---- macOS: ask for / open the permissions -------------------------------------
ipcMain.handle('ff:mac-permission', async (_e, kind) => {
  if (!IS_MAC) return null;
  if (kind === 'microphone') {
    if (systemPreferences.getMediaAccessStatus('microphone') === 'not-determined') await systemPreferences.askForMediaAccess('microphone');
    else shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone');
  } else if (kind === 'accessibility') {
    if (!systemPreferences.isTrustedAccessibilityClient(true)) shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
  }
  pushState();
  return macPermissions();
});

// Live preview of the formatting + vocabulary on typed text (Dictionnaire > Tester).
ipcMain.handle('ff:format-preview', (_e, text) => {
  const s = settings.get();
  return formatText(String(text || ''), { language: s.language === 'en' ? 'en' : 'fr', snippets: snippets.get(), dictionary: dictionary.get() });
});

ipcMain.handle('ff:snippets', (_e, { action, id, trigger, expansion }) => {
  let list = snippets.get();
  if (action === 'add' && trigger && trigger.trim()) list = [...list, { id: Date.now().toString(36), trigger: trigger.trim(), expansion: String(expansion || '') }];
  if (action === 'remove') list = list.filter((x) => x.id !== id);
  snippets.set(list);
  pushState();
  return list;
});

ipcMain.handle('ff:history', (_e, { action, id }) => {
  let list = history.get();
  if (action === 'delete') list = list.filter((x) => x.id !== id);
  if (action === 'clear') list = [];
  history.set(list);
  pushState();
  return list;
});

ipcMain.handle('ff:dictation-toggle', (_e, opts) => { toggleDictation(opts || {}); return dictation.phase; });
ipcMain.handle('ff:dictation-cancel', () => { cancelDictation(); return dictation.phase; });
ipcMain.handle('ff:copy', async (_e, text) => { await clipboard.writeText(String(text || '')); return true; });
ipcMain.handle('ff:open-logs', () => shell.openPath(logDir));
// Only FreeFlow's own folders: a window must never be able to open (run) an arbitrary path.
ipcMain.handle('ff:open-path', (_e, p) => {
  const allowed = [userData, logDir, settings.get().modelCache].filter(Boolean).map((d) => path.resolve(d));
  return allowed.includes(path.resolve(String(p || ''))) ? shell.openPath(path.resolve(p)) : 'refusé';
});

// Dev / verification commands (read a WAV, write screenshots): only in the dev modes.
if (DEV_MODE) {
  ipcMain.handle('ff:test-pipeline', async (_e, wavPath) => testPipeline(wavPath));
  ipcMain.handle('ff:screenshot', async (_e, { which, out }) => takeScreenshot(which, out));
}

async function testPipeline(wavPath) {
  const wav = fs.readFileSync(wavPath);
  const previousClipboard = await clipboard.readText();
  showOverlay();
  setPhase('transcribing');
  dictation.stoppedAt = Date.now();
  try {
    const entry = await runPipeline(wav, { noPaste: true });
    return { ...entry, clipboard: await clipboard.readText() };
  } finally {
    await clipboard.writeText(previousClipboard);   // a test must not leave text in the user's clipboard
  }
}

// UI self-test of the shortcut recorder and the vocabulary page. Key events are
// dispatched INSIDE the hub page only (never sent to the OS / other windows).
async function uiTest(dir) {
  const wc = hub.webContents;
  const js = (code) => wc.executeJavaScript(code, true);
  const shot = async (name) => { await new Promise((r) => setTimeout(r, 350)); const img = await wc.capturePage(); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, name + '.png'), img.toPNG()); };
  const key = (type, code, keyName, mods) => js(`window.dispatchEvent(new KeyboardEvent('${type}', { code: '${code}', key: '${keyName}', ctrlKey: ${!!mods.ctrl}, altKey: ${!!mods.alt}, shiftKey: ${!!mods.shift}, metaKey: ${!!mods.meta}, bubbles: true, cancelable: true }))`);
  const original = settings.get().shortcut;
  showHub(); wc.send('ff:navigate', 'settings');
  await shot('01-settings');
  await js(`document.querySelector('#shortcut-record').click()`);
  await shot('02-recording-empty');
  console.log('UI suspended=' + shortcutSuspended);
  await key('keydown', 'ControlLeft', 'Control', { ctrl: true });
  await key('keydown', 'MetaLeft', 'Meta', { ctrl: true, meta: true });
  await shot('03-recording-ctrl-win');
  await key('keyup', 'MetaLeft', 'Meta', { ctrl: true });
  await key('keyup', 'ControlLeft', 'Control', {});
  // a second chord replaces the first one
  await key('keydown', 'ControlLeft', 'Control', { ctrl: true });
  await key('keydown', 'AltLeft', 'Alt', { ctrl: true, alt: true });
  await key('keydown', 'KeyD', 'd', { ctrl: true, alt: true });
  await key('keyup', 'KeyD', 'd', { ctrl: true, alt: true });
  await key('keyup', 'AltLeft', 'Alt', { ctrl: true });
  await key('keyup', 'ControlLeft', 'Control', {});
  await shot('04-recording-ctrl-alt-d');
  await js(`document.querySelector('#shortcut-record').click()`);
  await shot('05-stopped-pending');
  console.log('UI confirmDisabled=' + await js(`document.querySelector('#shortcut-confirm').disabled`) + ' suspended=' + shortcutSuspended);
  await js(`document.querySelector('#shortcut-confirm').click()`);
  await new Promise((r) => setTimeout(r, 600));
  console.log('UI after confirm shortcut=' + settings.get().shortcut + ' ok=' + shortcutOk);
  await shot('06-confirmed');
  // modifier-only chord through the low-level hook
  await js(`document.querySelector('#shortcut-record').click()`);
  await key('keydown', 'ControlLeft', 'Control', { ctrl: true });
  await key('keydown', 'MetaLeft', 'Meta', { ctrl: true, meta: true });
  await key('keyup', 'MetaLeft', 'Meta', { ctrl: true });
  await key('keyup', 'ControlLeft', 'Control', {});
  await js(`document.querySelector('#shortcut-confirm').click()`);
  await new Promise((r) => setTimeout(r, 800));
  console.log('UI modifier-only shortcut=' + settings.get().shortcut + ' ok=' + shortcutOk + ' hook=' + hook.active);
  await shot('07-confirmed-ctrl-win');
  // restore the user's shortcut
  settings.update({ shortcut: original }); registerShortcut(); pushState();
  console.log('UI restored shortcut=' + settings.get().shortcut + ' ok=' + shortcutOk);
  // vocabulary page
  wc.send('ff:navigate', 'dictionary');
  await js(`(() => { const i = document.querySelector('#dict-test'); i.value = "euh j'automatise tout avec N huit N et x field, puis je poste sur tic toc avec post iz"; i.dispatchEvent(new Event('input')); })()`);
  await new Promise((r) => setTimeout(r, 500));
  console.log('UI preview=' + await js(`document.querySelector('#dict-test-out').textContent`));
  await shot('08-dictionary');
  console.log('UI vocab entries=' + dictionary.get().length);
  // import: a pasted list -> preview -> apply
  await js(`document.querySelector('#dict-import-open').click()`);
  await shot('09-import-source');
  await js(`(() => { const t = document.querySelector('#import-paste'); t.value = ${JSON.stringify('Mot correct;Ce que le modèle entend\nKling;cling | clean\nComfyUI;confui | comfy ui\nn8n;nuit n\nSupabase\nHiggsfield;x field')}; document.querySelector('#import-paste-read').click(); })()`);
  await new Promise((r) => setTimeout(r, 700));
  await shot('10-import-preview');
  console.log('UI import summary=' + await js(`document.querySelector('#import-summary').textContent`) + ' | ' + await js(`document.querySelector('#import-format').textContent`));
  await js(`document.querySelector('#import-guess').checked = false; document.querySelector('#import-apply').click()`);
  await new Promise((r) => setTimeout(r, 700));
  const k = dictionary.get().find((e) => e.word === 'Kling');
  console.log('UI after import entries=' + dictionary.get().length + ' Kling=' + JSON.stringify(k && k.sounds));
  await shot('11-imported');
  // Wispr Flow's dictionary (read from a copy of its database), preview only
  if (wisprDbPath()) {
    await js(`document.querySelector('#dict-import-open').click(); document.querySelector('#import-wispr').click()`);
    await new Promise((r) => setTimeout(r, 2500));
    await shot('11b-wispr-preview');
    console.log('UI wispr summary=' + await js(`document.querySelector('#import-summary').textContent`));
    await js(`document.querySelector('#import-close').click()`);
  }
  // "Deviner" on one word, through the button of its row
  if (sidecar.ready) {
    await js(`[...document.querySelectorAll('.vocab-item')].find((n) => n.querySelector('.word').textContent === 'Supabase').querySelector('[data-act=guess]').click()`);
    for (let i = 0; i < 40 && (guessJob.running || i < 2); i++) await new Promise((r) => setTimeout(r, 500));
    await shot('12-guess');
    console.log('UI guess panel=' + await js(`document.querySelector('#suggest-list').textContent.replace(/\\s+/g, ' ')`));
  }
}

// Dev: "Deviner" on a few words through the real engine and the system voices.
async function guessTest(words) {
  const t0 = Date.now();
  const res = await guessVariants(words.map((word) => ({ word, sounds: [] })), {
    lang: guessLanguage(),
    transcribe: (wav, l) => sidecar.transcribe(wav, { lang: l, hints: [] }),
    onProgress: (p) => console.log(`GUESS_PROGRESS ${p.done}/${p.total} ${p.word}`),
  });
  for (const r of res) console.log(`GUESS ${r.word} | heard=${JSON.stringify(r.heard)} | ${r.suggestions.map((s) => s.text + (s.risky ? ' (courant)' : '')).join(', ')}`);
  console.log(`GUESS_DONE ${Date.now() - t0} ms`);
}

const SAMPLE_IMPORT = 'Mot correct;Ce que le modèle entend (séparé par des virgules)\nKling;cling\nComfyUI;confui, confy ui\nSupabase\nCursor\nn8n;nuit n';

async function takeScreenshot(which, out) {
  let win = which.startsWith('overlay') ? overlay : hub;
  if (which === 'hub:import') {
    // the import preview, filled with a sample list (nothing is imported)
    showHub(); hub.webContents.send('ff:navigate', 'dictionary');
    await hub.webContents.executeJavaScript(`(() => { document.querySelector('#dict-import-open').click(); document.querySelector('#import-paste').value = ${JSON.stringify(SAMPLE_IMPORT)}; document.querySelector('#import-paste-read').click(); })()`, true);
    await new Promise((r) => setTimeout(r, 900));
    const img = await hub.webContents.capturePage();
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, img.toPNG());
    await hub.webContents.executeJavaScript(`document.querySelector('#import-close').click()`, true);
    return out;
  }
  if (win === hub) { showHub(); const section = which.split(':')[1]; if (section) hub.webContents.send('ff:navigate', section); }
  else {
    showOverlay();
    const phase = which.split(':')[1] || 'listening';
    overlaySend('ff:overlay', { phase, demo: true, message: phase === 'error' ? 'Collage bloqué' : undefined, latencyMs: 640 });
  }
  await new Promise((r) => setTimeout(r, which.startsWith('overlay') ? 700 : 900));
  const img = await win.webContents.capturePage();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, img.toPNG());
  return out;
}

async function waitReady(timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (sidecar.ready) return true;
    if (!sidecar.info.loading && sidecar.info.error) return false;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function runDevCommands() {
  try {
    if (argv['test-pipeline']) {
      const ok = await waitReady(240000);
      console.log('TEST_SIDECAR ' + JSON.stringify(sidecar.info));
      if (!ok) throw new Error('sidecar not ready: ' + sidecar.info.error);
      const res = await testPipeline(String(argv['test-pipeline']));
      console.log('TEST_PIPELINE_RESULT ' + JSON.stringify(res));
    }
    if (argv.screenshots) {
      const dir = typeof argv.screenshots === 'string' ? argv.screenshots : path.join(ROOT, 'screenshots');
      if (argv['wait-ready']) await waitReady(240000);
      await new Promise((r) => setTimeout(r, 1200));
      for (const which of ['hub:home', 'hub:history', 'hub:dictionary', 'hub:import', 'hub:snippets', 'hub:settings', 'overlay:listening', 'overlay:transcribing', 'overlay:done', 'overlay:error']) {
        const out = path.join(dir, which.replace(':', '-') + '.png');
        await takeScreenshot(which, out);
        console.log('SCREENSHOT ' + out);
      }
      setPhase('idle');
      overlay.hide();
    }
    if (argv['ui-test']) {
      await new Promise((r) => setTimeout(r, 1500));
      await uiTest(String(argv['ui-test']));
      console.log('UI_TEST_DONE');
    }
    if (argv['guess-test']) {
      if (!(await waitReady(240000))) throw new Error('sidecar not ready: ' + sidecar.info.error);
      await guessTest(String(argv['guess-test']).split(',').map((w) => w.trim()).filter(Boolean));
    }
    if (argv['learn-test']) {
      // --learn-test=<word>=<wav>: "Dis-le" on a recording instead of the microphone
      const [word, wavPath] = String(argv['learn-test']).split('=');
      if (!(await waitReady(240000))) throw new Error('sidecar not ready: ' + sidecar.info.error);
      showHub(); hub.webContents.send('ff:navigate', 'dictionary');
      dictation.stoppedAt = Date.now();
      await runLearn(fs.readFileSync(wavPath), word);
      await new Promise((r) => setTimeout(r, 800));
      const out = path.join(path.dirname(wavPath), 'learn-panel.png');
      fs.writeFileSync(out, (await hub.webContents.capturePage()).toPNG());
      console.log('LEARN_PANEL ' + await hub.webContents.executeJavaScript(`document.querySelector('#suggest').hidden + ' ' + document.querySelector('#suggest-list').textContent.replace(/\\s+/g, ' ')`, true));
    }
  } catch (e) {
    console.log('DEV_ERROR ' + (e.stack || e.message));
  }
  if (argv.exit) setTimeout(quitApp, 300);
}

// ---- Lifecycle ---------------------------------------------------------------
async function quitApp() {
  if (quitting) return;
  quitting = true;
  log('quitting');
  try { globalShortcut.unregisterAll(); } catch { /* ignore */ }
  stopHook();
  if (sidecar) await sidecar.stop();
  if (tray) tray.destroy();
  app.exit(0);
}

app.on('second-instance', () => showHub());
app.on('activate', () => { if (app.isReady()) showHub(); });   // macOS: click on the Dock icon
app.on('window-all-closed', () => { /* keep running in the tray */ });
app.on('before-quit', (e) => { if (!quitting) { e.preventDefault(); quitApp(); } });

app.whenReady().then(async () => {
  initStores();
  log(`FreeFlow ${app.getVersion()} starting (packaged=${app.isPackaged}, electron=${process.versions.electron})`);

  // Microphone permission for our own renderers.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media' || permission === 'audioCapture'));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media' || permission === 'audioCapture');

  try { uiohookMod = require('uiohook-napi'); pttAvailable = !!(uiohookMod && uiohookMod.uIOhook); } catch (e) { pttAvailable = false; log('uiohook-napi unavailable:', e.message); }

  const s = settings.get();
  if (IS_MAC) {
    // The Accessibility switch is flipped in System Settings while FreeFlow runs:
    // watch it, then (re)start the keyboard hook that depends on it.
    let trusted = macTrusted();
    log(`macOS permissions: ${JSON.stringify(macPermissions())}`);
    setInterval(() => {
      const now = macTrusted();
      if (now !== trusted) { trusted = now; log(`accessibility: ${now}`); registerShortcut(); pushState(); }
    }, 2500);
    if (!DEV_MODE && systemPreferences.getMediaAccessStatus('microphone') === 'not-determined') {
      systemPreferences.askForMediaAccess('microphone').then(pushState).catch(() => {});
    }
  }
  sidecar = new Sidecar({ port: s.sidecarPort, hfHome: s.modelCache, model: s.model, log, appPath: ROOT, resourcesPath: process.resourcesPath, isPackaged: app.isPackaged });
  sidecar.on('ready', (info) => { log('sidecar ready', info); updateTray(); pushState(); });
  sidecar.on('failed', (err) => { log('sidecar failed', err); updateTray(); pushState(); });
  sidecar.on('exit', () => { updateTray(); pushState(); });
  sidecar.on('progress', () => { updateTray(); pushState(); });

  createTray();
  createOverlay();
  createHub();
  registerShortcut();
  screen.on('display-metrics-changed', positionOverlay);
  if (s.showHubAtStart || DEV_MODE) showHub();
  if (process.env.FREEFLOW_NO_SIDECAR) {
    // UI-only development: skip the engine entirely.
    sidecar.info = { ...sidecar.info, loading: false, error: 'Moteur désactivé (FREEFLOW_NO_SIDECAR)' };
    updateTray();
  } else {
    sidecar.start();
  }
  if (DEV_MODE) runDevCommands();
});
