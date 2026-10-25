'use strict';
// Simulated paste. Windows: native/PasteHelper.exe (SendInput); macOS: Cmd+V
// through uiohook-napi. Mirrors Wispr's PasteText -> PasteOutcome
// {pasted|blocked|failed} with per-app overrides.
const { execFile } = require('child_process');

// Per-app overrides keyed by foreground process name (lowercase, no .exe).
// Wispr keeps a similar list (bundle IDs / windowsUri for Slack, Teams, Telegram,
// Discord, Signal...). Terminals want Shift+Insert, chat apps a longer delay.
const PER_APP = {
  windowsterminal: { shiftInsert: true },
  mintty: { shiftInsert: true },
  conhost: { shiftInsert: true },
  cmd: { shiftInsert: true },
  powershell: { shiftInsert: true },
  pwsh: { shiftInsert: true },
  alacritty: { shiftInsert: true },
  wezterm: { shiftInsert: true },
  slack: { delayMs: 120 },
  teams: { delayMs: 120 },
  'ms-teams': { delayMs: 120 },
  telegram: { delayMs: 100 },
  discord: { delayMs: 100 },
  signal: { delayMs: 100 },
};

function run(exe, args) {
  return new Promise((resolve) => {
    execFile(exe, args, { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      let out = null;
      try { out = JSON.parse(String(stdout).trim().split(/\r?\n/).pop()); } catch { /* ignore */ }
      if (!out) out = { outcome: err ? 'failed' : 'unknown', error: err ? String(err.message) : undefined };
      if (err && err.code && !out.exitCode) out.exitCode = err.code;
      resolve(out);
    });
  });
}

async function probeForeground(exe) {
  return run(exe, ['--info']);
}

/**
 * @param {string} exe path to PasteHelper.exe
 * @param {{dryRun?:boolean, delayMs?:number, shiftInsert?:boolean, log?:Function}} opts
 */
async function paste(exe, opts = {}) {
  const log = opts.log || (() => {});
  const fg = await probeForeground(exe);
  const proc = String(fg.process || '').toLowerCase();
  const override = PER_APP[proc] || {};
  const delayMs = override.delayMs ?? opts.delayMs ?? 60;
  const shiftInsert = override.shiftInsert ?? opts.shiftInsert ?? false;
  const args = ['--delay', String(delayMs)];
  if (shiftInsert) args.push('--shift-insert');
  if (opts.dryRun) args.push('--dry-run');
  const res = await run(exe, args);
  log(`paste -> ${res.outcome} (app=${fg.process || '?'} mode=${shiftInsert ? 'Shift+Insert' : 'Ctrl+V'} delay=${delayMs}ms)`);
  return { ...res, process: fg.process, title: fg.title, shiftInsert, delayMs };
}

// ---- macOS -------------------------------------------------------------------
// Cmd+V is posted with uiohook-napi (CGEventPost), which needs the Accessibility
// permission; osascript is the fallback when the native module is missing.
// The front app name comes from lsappinfo, which needs no permission at all.
function runText(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 1500 }, (err, stdout) => resolve(err ? '' : String(stdout)));
  });
}

async function frontAppMac() {
  const asn = (await runText('lsappinfo', ['front'])).trim();
  if (!asn) return null;
  const m = (await runText('lsappinfo', ['info', '-only', 'name', asn])).match(/"LSDisplayName"="([^"]*)"/);
  return m ? m[1] : null;
}

/**
 * @param {{uiohook?:object, trusted:boolean, delayMs?:number, log?:Function}} opts
 */
async function pasteMac(opts = {}) {
  const log = opts.log || (() => {});
  const app = await frontAppMac();
  if (!opts.trusted) {
    log(`paste -> blocked (app=${app || '?'}, Accessibility not granted)`);
    return { outcome: 'blocked', process: app, reason: 'accessibility' };
  }
  await new Promise((r) => setTimeout(r, opts.delayMs ?? 60));
  try {
    if (opts.uiohook) {
      opts.uiohook.uIOhook.keyTap(opts.uiohook.UiohookKey.V, [opts.uiohook.UiohookKey.Meta]);
    } else {
      await new Promise((resolve, reject) => execFile('osascript', ['-e', 'tell application "System Events" to keystroke "v" using command down'], { timeout: 4000 }, (err) => (err ? reject(err) : resolve())));
    }
    log(`paste -> pasted (app=${app || '?'} mode=Cmd+V)`);
    return { outcome: 'pasted', process: app };
  } catch (e) {
    log(`paste -> failed (${e.message})`);
    return { outcome: 'failed', process: app, error: e.message };
  }
}

module.exports = { paste, pasteMac, probeForeground, PER_APP };
