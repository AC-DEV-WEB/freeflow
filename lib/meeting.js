'use strict';
// Meetings, the FreeFlow way of omarchy-meeting-recorder: your microphone and the
// computer's sound are recorded as two tracks, transcribed separately on this
// machine, then merged by time into "who said what" (microphone = Moi, computer
// = the other participants). Without headphones the microphone also hears the
// others: a microphone segment repeating a computer segment at the same moment
// is dropped.
const { fold } = require('./vocab');

const LABELS = { mic: 'Moi', computer: 'Eux', file: 'Intervenant' };

function tokens(s) { return fold(s).split(/[^a-z0-9]+/).filter(Boolean); }
function similarity(a, b) {
  const A = new Set(tokens(a)), B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let k = 0;
  for (const t of A) if (B.has(t)) k += 1;
  return k / Math.min(A.size, B.size);
}
function overlap(a, b) { return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start)); }

// Lines Whisper is known to invent on silence or music (subtitles credits of its training videos).
const PHANTOMS = [
  /sous[- ]?titr\w* (realise|fait|par)/, /amara\.?org/, /merci d.avoir regarde/, /abonnez[- ]vous/,
  /thanks? (you )?for watching/, /subtitles? by/, /like and subscribe/,
];
function phantom(text) {
  const t = fold(text);
  return t.length < 80 && PHANTOMS.some((re) => re.test(t));
}

/**
 * @param {{track:string,start:number,end:number,text:string}[]} segments
 * @returns {{start:number,end:number,speaker:string,track:string,text:string}[]}
 */
function mergeSegments(segments) {
  const computer = segments.filter((s) => s.track === 'computer');
  const echo = (m) => computer.some((c) => overlap(m, c) > 0.3 * Math.max(0.5, m.end - m.start) && similarity(m.text, c.text) >= 0.5);
  const kept = segments
    .filter((s) => s.text && s.text.trim() && !phantom(s.text) && !(s.track === 'mic' && echo(s)))
    .sort((a, b) => a.start - b.start || (a.track === 'mic' ? -1 : 1));
  // Consecutive segments of the same speaker less than 2 s apart form one line.
  const lines = [];
  for (const s of kept) {
    const last = lines[lines.length - 1];
    if (last && last.track === s.track && s.start - last.end < 2 && last.text.length < 700) {
      last.text += ' ' + s.text.trim();
      last.end = s.end;
    } else {
      lines.push({ start: s.start, end: s.end, speaker: LABELS[s.track] || s.track, track: s.track, text: s.text.trim() });
    }
  }
  return lines;
}

function clock(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const two = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(r)}` : `${two(m)}:${two(r)}`;
}

function meetingTitleDate(ts) {
  return new Date(ts).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
}

/** Plain text, one line per speech turn: "[03:12] Moi : …". */
function meetingText(m) {
  return (m.lines || []).map((l) => `[${clock(l.start)}] ${l.speaker} : ${l.text}`).join('\n');
}

/** Markdown export (notes apps, Obsidian…). */
function meetingMarkdown(m) {
  const head = `# ${m.name}\n\n_${meetingTitleDate(m.createdAt)} · ${clock(m.durationSec)}_\n\n`;
  return head + (m.lines || []).map((l) => `**[${clock(l.start)}] ${l.speaker}** : ${l.text}`).join('\n\n') + '\n';
}

module.exports = { mergeSegments, meetingText, meetingMarkdown, clock, similarity, LABELS };
