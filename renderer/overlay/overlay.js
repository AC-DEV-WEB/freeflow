'use strict';
// Overlay renderer: shows the pill states and captures the microphone
// (getUserMedia -> AudioWorklet -> PCM16) while "listening".
(() => {
  const pill = document.getElementById('pill');
  const barsEl = document.getElementById('bars');
  const labelEl = document.getElementById('label');
  const N_BARS = 22;
  const LABELS = {
    listening: 'Écoute',
    transcribing: 'Transcription',
    formatting: 'Mise en forme',
    done: 'Terminé',
    error: 'Erreur',
  };
  for (let i = 0; i < N_BARS; i++) barsEl.appendChild(document.createElement('span'));
  const bars = Array.from(barsEl.children);
  const levels = new Array(N_BARS).fill(0);

  // ---- audio capture state
  let ctx = null, stream = null, source = null, node = null, sink = null;
  let chunks = [], total = 0, recording = false, demoTimer = null, raf = null;
  let flushResolve = null;

  function setBars() {
    for (let i = 0; i < N_BARS; i++) {
      const h = 4 + Math.round(levels[i] * 22);
      bars[i].style.height = `${h}px`;
    }
  }
  function pushLevel(v) {
    levels.shift();
    levels.push(Math.max(0, Math.min(1, v)));
  }
  function renderLoop() {
    setBars();
    raf = requestAnimationFrame(renderLoop);
  }
  function stopRender() { if (raf) cancelAnimationFrame(raf); raf = null; }

  function show(phase, payload = {}) {
    pill.dataset.phase = phase;
    document.body.dataset.phase = phase;
    let text = LABELS[phase] || '';
    if (phase === 'done' && payload.latencyMs) text = `Terminé · ${(payload.latencyMs / 1000).toFixed(1)} s`;
    if (phase === 'error') text = payload.message || 'Erreur';
    labelEl.textContent = text;
    pill.classList.add('show');
    if (phase === 'listening') { if (!raf) renderLoop(); } else { stopRender(); }
    if (payload.demo && phase === 'listening') startDemoLevels(); else stopDemoLevels();
  }
  function hide() {
    pill.classList.remove('show');
    document.body.dataset.phase = 'idle';
    stopRender();
    stopDemoLevels();
  }

  function startDemoLevels() {
    stopDemoLevels();
    let t = 0;
    demoTimer = setInterval(() => {
      t += 0.35;
      pushLevel(0.25 + 0.45 * Math.abs(Math.sin(t)) * (0.6 + 0.4 * Math.random()));
      setBars();
    }, 50);
  }
  function stopDemoLevels() { if (demoTimer) clearInterval(demoTimer); demoTimer = null; }

  // ---- microphone
  async function startRecording({ deviceId } = {}) {
    await cleanupAudio();
    chunks = []; total = 0; recording = true;
    levels.fill(0);
    const constraints = {
      audio: {
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: true,
        autoGainControl: true,
      },
    };
    if (deviceId && deviceId !== 'default') constraints.audio.deviceId = { exact: deviceId };
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (e) {
      if (deviceId && deviceId !== 'default') {
        // The chosen device vanished: fall back to the default one.
        delete constraints.audio.deviceId;
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } else throw e;
    }
    try { ctx = new AudioContext({ sampleRate: 16000, latencyHint: 'interactive' }); }
    catch { ctx = new AudioContext({ latencyHint: 'interactive' }); }
    await ctx.audioWorklet.addModule('pcm-worklet.js');
    source = ctx.createMediaStreamSource(stream);
    node = new AudioWorkletNode(ctx, 'ff-pcm', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    node.port.onmessage = (e) => {
      if (e.data && e.data.done) { if (flushResolve) flushResolve(); return; }
      const f32 = e.data;
      if (!(f32 instanceof Float32Array)) return;
      if (recording) { chunks.push(f32); total += f32.length; }
      // RMS -> level for the waveform
      let sum = 0;
      for (let i = 0; i < f32.length; i += 4) sum += f32[i] * f32[i];
      const rms = Math.sqrt(sum / (f32.length / 4));
      pushLevel(Math.min(1, Math.pow(rms * 6, 0.7)));
    };
    sink = ctx.createGain();
    sink.gain.value = 0; // worklet needs a path to the destination to keep processing
    source.connect(node).connect(sink).connect(ctx.destination);
    if (ctx.state !== 'running') await ctx.resume();
  }

  async function finishRecording() {
    if (!node) return null;
    recording = true;
    await new Promise((resolve) => {
      flushResolve = resolve;
      node.port.postMessage({ cmd: 'flush' });
      setTimeout(resolve, 300);
    });
    flushResolve = null;
    recording = false;
    const sampleRate = ctx ? ctx.sampleRate : 16000;
    const pcm = new Int16Array(total);
    let o = 0;
    for (const c of chunks) {
      for (let i = 0; i < c.length; i++) {
        const s = Math.max(-1, Math.min(1, c[i]));
        pcm[o++] = s < 0 ? s * 32768 : s * 32767;
      }
    }
    chunks = []; total = 0;
    await cleanupAudio();
    return { pcm: pcm.buffer, sampleRate };
  }

  async function cleanupAudio() {
    recording = false;
    try { if (node) { node.port.onmessage = null; node.disconnect(); } } catch { /* ignore */ }
    try { if (source) source.disconnect(); } catch { /* ignore */ }
    try { if (sink) sink.disconnect(); } catch { /* ignore */ }
    try { if (stream) stream.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
    try { if (ctx) await ctx.close(); } catch { /* ignore */ }
    node = source = sink = stream = ctx = null;
  }

  // ---- IPC
  window.freeflow.on('ff:overlay', (payload) => {
    if (!payload) return;
    if (payload.phase === 'idle' || payload.phase === 'hide') hide();
    else show(payload.phase, payload);
  });

  window.freeflow.on('ff:rec-start', async (opts) => {
    try {
      await startRecording(opts || {});
    } catch (e) {
      await cleanupAudio();
      window.freeflow.send('ff:audio-error', e && e.name === 'NotAllowedError' ? 'Accès au micro refusé' : `Micro indisponible (${e && e.message})`);
    }
  });

  window.freeflow.on('ff:rec-stop', async () => {
    try {
      const out = await finishRecording();
      if (out) window.freeflow.send('ff:audio-done', out);
      else window.freeflow.send('ff:audio-error', 'Aucun audio capturé');
    } catch (e) {
      window.freeflow.send('ff:audio-error', `Erreur audio (${e && e.message})`);
    }
  });

  window.freeflow.on('ff:rec-cancel', () => { cleanupAudio(); hide(); });

  // ---- the bar, its panel and toasts --------------------------------------------
  const $ = (s) => document.getElementById(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let barState = null;

  // The window lets the clicks through except over these (main toggles it from here).
  let inside = false;
  function setInside(v) { if (v !== inside) { inside = v; window.freeflow.send('ff:bar-mouse', v); } }
  document.addEventListener('mousemove', (e) => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    setInside(!!(el && el.closest('.bar, body.panel-open .panel, .toast:not([hidden]), .pill.show .p-actions')));
  });
  document.addEventListener('mouseleave', () => setInside(false));

  function ago(iso) {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return 'à l’instant';
    if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
    if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
    return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  }
  function clock(ms) {
    const t = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    const two = (n) => String(n).padStart(2, '0');
    return h ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
  }

  function renderBar() {
    const st = barState;
    if (!st) return;
    const b = document.body;
    const rec = st.meeting.recording;
    b.classList.toggle('show-bar', !!st.showBar || rec);
    b.classList.toggle('panel-open', !!st.panelOpen);
    b.classList.toggle('recording', rec);
    b.classList.toggle('paused', rec && st.meeting.paused);
    $('b-dictate').title = `Dicter (${st.shortcut})`;
    $('b-panel').title = `Déroulé (${st.panelShortcut})`;
    $('rec-time').textContent = clock(st.meeting.elapsedMs);
    $('rec-pause').title = st.meeting.paused ? 'Reprendre' : 'Pause';
    $('rec-pause').innerHTML = st.meeting.paused
      ? '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10-6.5z"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M9 6v12M15 6v12"/></svg>';
    $('p-meeting-label').textContent = rec ? `Arrêter · ${clock(st.meeting.elapsedMs)}` : 'Réunion';
    // panel
    const last = st.recent[0];
    $('last-preview').textContent = last ? last.text : 'Aucune dictée pour le moment';
    const ul = $('recent');
    const key = JSON.stringify(st.recent.map((r) => [r.id, r.ts]));
    if (ul.dataset.key !== key || !st.recent.length) {
      ul.dataset.key = key;
      ul.innerHTML = st.recent.length
        ? st.recent.map((r) => `<li><div><div class="r-text">${esc(r.text)}</div><div class="r-meta">${esc(ago(r.ts))}${r.app ? ' · ' + esc(r.app) : ''}</div></div>
            <button class="icon small" data-act="copy" data-id="${esc(r.id)}" title="Copier"><svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"/></svg></button></li>`).join('')
        : '<li class="empty">Tes dernières dictées s’afficheront ici.</li>';
    }
    $('p-foot').textContent = `${st.shortcut} pour dicter · ${st.panelShortcut} pour ce menu`;
    // learned word
    const l = st.learned[0];
    const toast = $('learn');
    toast.hidden = !l;
    if (l) {
      $('learn-word').textContent = l.word;
      $('learn-heard').textContent = l.sounds.length ? `tu as corrigé « ${l.sounds[0]} »` : 'pour garder cette écriture';
      toast.dataset.word = l.word;
      toast.dataset.sounds = JSON.stringify(l.sounds);
    }
  }

  let flashTimer = null;
  function flash(text) {
    const f = $('flash');
    f.textContent = text;
    f.classList.add('show');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => f.classList.remove('show'), 1400);
  }

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'learn-accept' || act === 'learn-dismiss') {
      const t = $('learn');
      await window.freeflow.invoke('ff:learned', { action: act === 'learn-accept' ? 'accept' : 'dismiss', word: t.dataset.word, sounds: JSON.parse(t.dataset.sounds || '[]') });
      if (act === 'learn-accept') flash('Ajouté au dictionnaire');
      return;
    }
    await window.freeflow.invoke('ff:bar-action', { action: act, id: btn.dataset.id });
  });

  window.freeflow.on('ff:bar-state', (st) => { barState = st; renderBar(); });
  window.freeflow.on('ff:bar-flash', flash);

  setBars();
  window.freeflow.send('ff:overlay-ready');
})();
