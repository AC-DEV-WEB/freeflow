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

  setBars();
  window.freeflow.send('ff:overlay-ready');
})();
