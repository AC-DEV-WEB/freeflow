'use strict';
// Hub renderer: dashboard, history, dictionary, snippets, settings.
(() => {
  const $ = (sel) => document.querySelector(sel);
  const ff = window.freeflow;
  let state = null;
  let phase = 'idle';
  let hubDictation = false;      // the current dictation targets the "try here" box
  let previewTimer = null;

  // ---- navigation
  function navigate(section) {
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.section === section));
    document.querySelectorAll('.section').forEach((s) => s.classList.toggle('active', s.id === `section-${section}`));
    try { localStorage.setItem('ff.section', section); } catch { /* ignore */ }
  }
  document.querySelectorAll('.nav-item').forEach((b) => b.addEventListener('click', () => navigate(b.dataset.section)));
  ff.on('ff:navigate', navigate);
  try { navigate(localStorage.getItem('ff.section') || 'home'); } catch { navigate('home'); }

  // ---- helpers
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 1800);
  }
  function fmtNum(n) { return new Intl.NumberFormat('fr-FR').format(n || 0); }
  function relTime(iso) {
    const d = new Date(iso); const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return 'à l’instant';
    if (diff < 3600) return `il y a ${Math.round(diff / 60)} min`;
    if (diff < 86400 && d.toDateString() === new Date().toDateString()) return `aujourd’hui à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
    return d.toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function el(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }

  // ---- render
  function render() {
    if (!state) return;
    const s = state.settings, st = state.stats, eng = state.sidecar || {};
    const hour = new Date().getHours();
    const name = state.user ? state.user.charAt(0).toUpperCase() + state.user.slice(1) : '';
    $('#greeting').textContent = `${hour < 18 && hour >= 5 ? 'Bonjour' : 'Bonsoir'}${name ? ', ' + name : ''}`;
    $('#stat-today').textContent = fmtNum(st.wordsToday);
    $('#stat-total').textContent = fmtNum(st.totalWords);
    $('#stat-wpm').textContent = fmtNum(st.avgWpm);
    $('#stat-count').textContent = fmtNum(st.dictations);
    $('#howto-shortcut').textContent = prettyAcc(s.shortcut);
    const ptt = s.mode === 'ptt';
    $('#howto-mode').textContent = ptt ? 'et garde la touche enfoncée : la pastille apparaît en bas de l’écran et écoute.' : ': la pastille apparaît en bas de l’écran et écoute.';
    $('#howto-stop').textContent = ptt ? 'Relâche la touche' : 'Appuie à nouveau';
    $('#howto-paste').textContent = s.autoPaste ? 'Collage automatique activé. Le presse-papiers est restauré juste après.' : 'Collage automatique désactivé : le texte est copié dans le presse-papiers, colle-le avec Ctrl+V.';

    // Engine pill
    const pill = $('#engine-pill');
    pill.className = 'engine ' + (phase === 'listening' ? 'listening' : eng.ready ? 'ready' : eng.error && !eng.loading ? 'error' : '');
    $('#engine-text').textContent = phase === 'listening' ? 'Écoute…' : eng.ready ? `${eng.device === 'cuda' ? 'GPU' : 'CPU'} · ${eng.model} · prêt` : eng.loading ? (state.loadingShort || 'Chargement du modèle…') : (eng.error ? 'Moteur indisponible' : '…');

    // History
    const hl = $('#history-list'); hl.innerHTML = '';
    if (!state.history.length) hl.appendChild(el('<div class="empty">Aucune dictée pour le moment. Appuie sur le raccourci et parle.</div>'));
    for (const h of state.history) {
      const node = el(`<div class="item" data-id="${esc(h.id)}">
        <div><div class="text">${esc(h.text)}</div>
          <div class="meta"><span>${esc(relTime(h.ts))}</span><span>${h.words} mots</span>${h.latencyMs ? `<span>${(h.latencyMs / 1000).toFixed(1)} s</span>` : ''}${h.app ? `<span>→ ${esc(h.app)}</span>` : ''}${h.language ? `<span>${esc(h.language)}</span>` : ''}</div></div>
        <div class="actions"><button class="btn small" data-act="copy">Copier</button><button class="btn small danger" data-act="del">Supprimer</button></div></div>`);
      node.querySelector('[data-act=copy]').addEventListener('click', async () => { await ff.invoke('ff:copy', h.text); toast('Copié'); });
      node.querySelector('[data-act=del]').addEventListener('click', () => ff.invoke('ff:history', { action: 'delete', id: h.id }));
      hl.appendChild(node);
    }

    // Dictionary (vocabulary): word + what the model hears instead
    const dl = $('#dict-list'); dl.innerHTML = '';
    $('#dict-count').textContent = `${state.dictionary.length} mot${state.dictionary.length > 1 ? 's' : ''}`;
    if (!state.dictionary.length) dl.appendChild(el('<div class="empty">Aucun mot. Ajoute les noms que le modèle écorche.</div>'));
    for (const v of state.dictionary) {
      const sounds = (v.sounds || []).length
        ? v.sounds.map((x) => `<span class="sound">${esc(x)}</span>`).join('')
        : '<span class="sound none">casse uniquement</span>';
      const node = el(`<div class="item vocab-item"><div><div class="word">${esc(v.word)}</div><div class="sounds">${sounds}</div></div>
        <div class="actions"><button class="btn small" data-act="edit">Modifier</button><button class="btn small danger" data-act="del">Supprimer</button></div></div>`);
      node.querySelector('[data-act=edit]').addEventListener('click', () => editVocab(v));
      node.querySelector('[data-act=del]').addEventListener('click', () => ff.invoke('ff:dictionary', { action: 'remove', word: v.word }));
      dl.appendChild(node);
    }
    refreshPreview();

    // Snippets
    const sl = $('#snippet-list'); sl.innerHTML = '';
    if (!state.snippets.length) sl.appendChild(el('<div class="empty">Aucun snippet. Exemple : « ma signature » → « Bonne journée et à très vite ! ».</div>'));
    for (const sn of state.snippets) {
      const node = el(`<div class="item"><div><span class="trigger">${esc(sn.trigger)}</span> → <span class="text">${esc(sn.expansion)}</span></div>
        <div class="actions"><button class="btn small danger">Supprimer</button></div></div>`);
      node.querySelector('button').addEventListener('click', () => ff.invoke('ff:snippets', { action: 'remove', id: sn.id }));
      sl.appendChild(node);
    }

    // Settings
    updateShortcutUi();
    document.querySelectorAll('input[name=mode]').forEach((r) => { r.checked = r.value === s.mode; });
    const pttInput = document.querySelector('input[name=mode][value=ptt]');
    pttInput.disabled = !state.pttAvailable;
    $('#mode-ptt-label').classList.toggle('disabled', !state.pttAvailable);
    $('#ptt-hint').textContent = state.pttAvailable ? 'Garde la touche enfoncée pendant que tu parles ; un appui bref passe en mains libres.' : 'Indisponible : le module uiohook-napi n’a pas pu être chargé.';
    $('#set-language').value = s.language;
    $('#set-autopaste').checked = !!s.autoPaste;
    $('#set-login').checked = !!s.launchAtLogin;
    $('#eng-state').textContent = eng.ready ? 'Prêt' : eng.loading ? (eng.phase === 'downloading' ? state.loadingLabel : 'Chargement…') : 'Erreur';
    $('#eng-device').textContent = eng.device ? (eng.device === 'cuda' ? 'GPU (CUDA)' : 'CPU') : '—';
    $('#eng-model').textContent = eng.model ? `faster-whisper ${eng.model}` : '—';
    $('#eng-compute').textContent = eng.compute_type || '—';
    $('#eng-port').textContent = eng.port ? `127.0.0.1:${eng.port}${eng.external ? ' (externe)' : ''}` : '—';
    $('#eng-latency').textContent = st.avgLatencyMs ? `${(st.avgLatencyMs / 1000).toFixed(1)} s` : '—';
    $('#eng-error').textContent = eng.error && !eng.ready ? eng.error : '';
    $('#eng-cache').textContent = s.modelCache;
    $('#version').textContent = `FreeFlow ${state.version} · données : ${state.paths.userData}`;
    const micSel = $('#set-mic');
    if (micSel.querySelector(`option[value="${s.microphoneId}"]`)) micSel.value = s.microphoneId;
    renderTry();
  }

  function renderTry() {
    const btn = $('#mic-btn'), status = $('#try-status');
    btn.classList.toggle('listening', phase === 'listening' && hubDictation);
    btn.classList.toggle('busy', (phase === 'transcribing' || phase === 'formatting') && hubDictation);
    const map = { idle: 'Prêt', listening: 'Écoute… clique pour arrêter', transcribing: 'Transcription…', formatting: 'Mise en forme…', done: 'Terminé', error: 'Erreur' };
    status.textContent = hubDictation || phase === 'idle' ? map[phase] || 'Prêt' : `Dictée en cours (${map[phase] || phase})`;
  }

  // ---- microphones
  async function loadMics() {
    try {
      // Ask once so device labels are populated, then release the stream.
      const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
      tmp.getTracks().forEach((t) => t.stop());
    } catch { /* labels may stay empty */ }
    try {
      const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
      const sel = $('#set-mic');
      const current = state ? state.settings.microphoneId : 'default';
      sel.innerHTML = '<option value="default">Micro par défaut</option>';
      for (const d of devs) {
        if (d.deviceId === 'default' || d.deviceId === 'communications') continue;
        const o = document.createElement('option');
        o.value = d.deviceId; o.textContent = d.label || `Micro ${sel.options.length}`;
        sel.appendChild(o);
      }
      if (sel.querySelector(`option[value="${current}"]`)) sel.value = current;
    } catch { /* ignore */ }
  }

  // ---- events
  $('#mic-btn').addEventListener('click', async () => {
    if (phase === 'idle') { hubDictation = true; $('#try-area').focus(); }
    await ff.invoke('ff:dictation-toggle', { toHub: true });
  });
  $('#history-clear').addEventListener('click', () => { if (state && state.history.length && confirm('Effacer tout l’historique ?')) ff.invoke('ff:history', { action: 'clear' }); });
  // ---- dictionary form (add / edit) + live test
  function resetVocabForm() {
    const f = $('#dict-form');
    delete f.dataset.editing;
    $('#dict-word').value = ''; $('#dict-sounds').value = '';
    $('#dict-submit').textContent = 'Ajouter';
    $('#dict-edit-cancel').hidden = true;
  }
  function editVocab(v) {
    const f = $('#dict-form');
    f.dataset.editing = v.word;
    $('#dict-word').value = v.word;
    $('#dict-sounds').value = (v.sounds || []).join(', ');
    $('#dict-submit').textContent = 'Enregistrer';
    $('#dict-edit-cancel').hidden = false;
    $('#dict-sounds').focus();
    f.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  $('#dict-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const word = $('#dict-word').value.trim();
    if (!word) { $('#dict-word').focus(); return; }
    const editing = $('#dict-form').dataset.editing;
    await ff.invoke('ff:dictionary', { action: editing ? 'update' : 'add', word, sounds: $('#dict-sounds').value, previous: editing });
    toast(editing ? 'Mot mis à jour' : 'Mot ajouté');
    resetVocabForm();
  });
  $('#dict-edit-cancel').addEventListener('click', resetVocabForm);
  $('#dict-restore').addEventListener('click', async () => { await ff.invoke('ff:dictionary', { action: 'restore-defaults' }); toast('Mots par défaut ajoutés'); });
  function refreshPreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(async () => {
      const text = $('#dict-test').value;
      const out = $('#dict-test-out');
      if (!text.trim()) { out.textContent = 'Le résultat corrigé s’affiche ici.'; out.classList.add('muted'); return; }
      out.classList.remove('muted');
      out.textContent = await ff.invoke('ff:format-preview', text);
    }, 120);
  }
  $('#dict-test').addEventListener('input', refreshPreview);
  $('#snippet-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const trig = $('#snippet-trigger'), exp = $('#snippet-expansion');
    if (trig.value.trim()) { await ff.invoke('ff:snippets', { action: 'add', trigger: trig.value, expansion: exp.value }); trig.value = ''; exp.value = ''; }
  });
  document.querySelectorAll('input[name=mode]').forEach((r) => r.addEventListener('change', () => ff.invoke('ff:set-settings', { mode: r.value })));
  $('#set-language').addEventListener('change', (e) => ff.invoke('ff:set-settings', { language: e.target.value }));
  $('#set-mic').addEventListener('change', (e) => ff.invoke('ff:set-settings', { microphoneId: e.target.value }));
  $('#set-autopaste').addEventListener('change', (e) => ff.invoke('ff:set-settings', { autoPaste: e.target.checked }));
  $('#set-login').addEventListener('change', (e) => ff.invoke('ff:set-settings', { launchAtLogin: e.target.checked }));
  $('#open-logs').addEventListener('click', () => ff.invoke('ff:open-logs'));
  $('#open-data').addEventListener('click', () => ff.invoke('ff:open-path', state.paths.userData));

  // Shortcut recorder: "Enregistrer" starts listening (the active shortcut is
  // suspended so the keys reach this window), every new chord replaces the
  // previous one, "Arrêter" stops listening, "Confirmer" saves. Modifier-only
  // chords such as Ctrl+Win are allowed (handled by the low-level hook).
  const CODE_MAP = { Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Minus: '-', Equal: '=', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", Backslash: '\\', BracketLeft: '[', BracketRight: ']', Backquote: '`', CapsLock: 'Capslock' };
  function codeToKey(code) {
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
    if (/^F\d{1,2}$/.test(code)) return code;
    if (/^Numpad\d$/.test(code)) return 'num' + code.slice(6);
    return CODE_MAP[code] || null;
  }
  const MOD_ORDER = ['Ctrl', 'Alt', 'Shift', 'Super'];
  const MOD_CODES = { ControlLeft: 'Ctrl', ControlRight: 'Ctrl', AltLeft: 'Alt', AltRight: 'Alt', ShiftLeft: 'Shift', ShiftRight: 'Shift', MetaLeft: 'Super', MetaRight: 'Super', OSLeft: 'Super', OSRight: 'Super' };
  const MOD_FLAG = { Ctrl: 'ctrlKey', Alt: 'altKey', Shift: 'shiftKey', Super: 'metaKey' };
  const KEY_LABEL = { Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Maj', Super: 'Win', Space: 'Espace', Enter: 'Entrée', Backspace: 'Retour', Delete: 'Suppr', Insert: 'Inser', Up: '↑', Down: '↓', Left: '←', Right: '→', Capslock: 'Verr. Maj' };
  const sc = { recording: false, held: new Set(), mods: new Set(), key: null, pending: null, error: null };

  function prettyAcc(acc) { return String(acc || '').split('+').filter(Boolean).map((k) => KEY_LABEL[k] || k).join(' + '); }
  function accFrom(mods, key) { return [...MOD_ORDER.filter((m) => mods.has(m)), ...(key ? [key] : [])].join('+'); }
  function localCheck(acc) {
    const parts = String(acc || '').split('+').filter(Boolean);
    const mods = parts.filter((p) => MOD_ORDER.includes(p));
    const key = parts.find((p) => !MOD_ORDER.includes(p));
    if (!parts.length) return 'Appuie sur au moins une combinaison.';
    if (!key) return mods.length >= 2 ? null : 'Avec seulement des touches de modification, il en faut au moins deux (ex. Ctrl + Win).';
    if (!mods.length && !/^F\d{1,2}$/.test(key)) return 'Ajoute Ctrl, Alt, Maj ou Win (ou utilise une touche F1 à F12).';
    return null;
  }
  function renderKeys(acc, cls, placeholder) {
    const box = $('#shortcut-keys');
    box.className = 'shortcut-keys' + (cls ? ' ' + cls : '');
    if (!acc) { box.innerHTML = `<span class="placeholder">${esc(placeholder || '—')}</span>`; return; }
    box.innerHTML = acc.split('+').map((k) => `<kbd>${esc(KEY_LABEL[k] || k)}</kbd>`).join('<span class="plus">+</span>');
  }
  function updateShortcutUi() {
    if (!state) return;
    const current = state.settings.shortcut;
    const pending = sc.pending && sc.pending !== current ? sc.pending : null;
    const problem = pending ? localCheck(pending) : null;
    let hint;
    if (sc.recording) {
      renderKeys(sc.pending, 'recording', 'Appuie sur tes touches…');
      hint = problem || 'Appuie sur la combinaison voulue (tu peux recommencer). Clique sur Arrêter quand c’est bon, puis sur Confirmer.';
    } else if (pending) {
      renderKeys(pending, problem || sc.error ? 'bad' : 'pending');
      hint = sc.error || problem || 'Nouveau raccourci prêt : clique sur Confirmer pour l’utiliser.';
    } else {
      renderKeys(current, state.shortcutOk ? '' : 'bad');
      hint = sc.error || (state.shortcutOk ? 'Raccourci actif. Clique sur Enregistrer pour en choisir un autre.' : 'Ce raccourci ne fonctionne pas (déjà pris par une autre application ?). Enregistres-en un autre.');
    }
    $('#shortcut-hint').textContent = hint;
    $('#shortcut-hint').classList.toggle('bad', !!(sc.error || (problem && !sc.recording)));
    const rb = $('#shortcut-record');
    rb.innerHTML = sc.recording ? '<span class="rec-dot"></span>Arrêter' : 'Enregistrer';
    rb.classList.toggle('recording', sc.recording);
    $('#shortcut-confirm').disabled = !pending || !!problem;
    $('#shortcut-cancel').hidden = !(sc.recording || pending);
  }
  async function setRecording(on) {
    sc.recording = on; sc.held.clear(); sc.error = null;
    if (on) { sc.pending = null; sc.mods = new Set(); sc.key = null; }
    updateShortcutUi();
    try { await ff.invoke('ff:shortcut-suspend', on); } catch { /* ignore */ }
  }
  $('#shortcut-record').addEventListener('click', () => setRecording(!sc.recording));
  $('#shortcut-cancel').addEventListener('click', async () => { sc.pending = null; sc.error = null; if (sc.recording) await setRecording(false); updateShortcutUi(); });
  $('#shortcut-confirm').addEventListener('click', async () => {
    const acc = sc.pending;
    if (!acc) return;
    if (sc.recording) await setRecording(false);
    const test = await ff.invoke('ff:shortcut-test', acc);
    if (!test.ok) { sc.error = test.error || `« ${prettyAcc(acc)} » est indisponible.`; updateShortcutUi(); return; }
    await ff.invoke('ff:set-settings', { shortcut: acc });
    sc.pending = null; sc.error = null;
    toast(`Raccourci : ${prettyAcc(acc)}`);
    updateShortcutUi();
  });
  window.addEventListener('keydown', (e) => {
    if (!sc.recording) return;
    e.preventDefault(); e.stopPropagation();
    if (e.repeat) return;
    // Forget modifiers the OS released without telling us (e.g. Win opening the Start menu).
    for (const c of [...sc.held]) { const m = MOD_CODES[c]; if (m && c !== e.code && !e[MOD_FLAG[m]]) sc.held.delete(c); }
    if (!sc.held.size) { sc.mods = new Set(); sc.key = null; }    // a new chord replaces the previous one
    sc.held.add(e.code);
    const mod = MOD_CODES[e.code];
    if (mod) sc.mods.add(mod);
    else {
      const k = codeToKey(e.code);
      if (!k) { sc.error = `La touche « ${e.key} » n’est pas prise en charge.`; updateShortcutUi(); return; }
      sc.key = k;
    }
    sc.error = null;
    sc.pending = accFrom(sc.mods, sc.key);
    updateShortcutUi();
  }, true);
  window.addEventListener('keyup', (e) => {
    if (!sc.recording) return;
    e.preventDefault(); e.stopPropagation();
    sc.held.delete(e.code);
  }, true);
  window.addEventListener('blur', () => { sc.held.clear(); });

  // ---- IPC from main
  ff.on('ff:state', (s) => { state = s; phase = s.phase || phase; render(); });
  ff.on('ff:dictation', (p) => {
    phase = p.phase;
    if (phase === 'idle' || phase === 'error') { if (phase === 'idle') hubDictation = false; }
    if (phase === 'error' && p.message) toast(p.message);
    render();
  });
  ff.on('ff:insert', (text) => {
    const ta = $('#try-area');
    const start = ta.selectionStart ?? ta.value.length, end = ta.selectionEnd ?? ta.value.length;
    const before = ta.value.slice(0, start), after = ta.value.slice(end);
    const sep = before && !/\s$/.test(before) ? ' ' : '';
    ta.value = before + sep + text + after;
    const pos = (before + sep + text).length;
    ta.setSelectionRange(pos, pos);
    ta.focus();
  });

  // ---- init
  ff.invoke('ff:get-state').then((s) => { state = s; phase = s.phase; render(); loadMics(); });
  ff.send('ff:hub-ready');
})();
