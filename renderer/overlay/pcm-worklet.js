// AudioWorklet: batches mono Float32 frames (~100 ms) and posts them to the
// overlay page, which converts to PCM16 for the STT sidecar.
class PcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunks = [];
    this.count = 0;
    this.port.onmessage = (e) => {
      if (e.data && e.data.cmd === 'flush') { this.flush(); this.port.postMessage({ done: true }); }
    };
  }
  flush() {
    if (!this.count) return;
    const out = new Float32Array(this.count);
    let o = 0;
    for (const c of this.chunks) { out.set(c, o); o += c.length; }
    this.chunks = []; this.count = 0;
    this.port.postMessage(out, [out.buffer]);
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) {
      this.chunks.push(new Float32Array(ch));
      this.count += ch.length;
      if (this.count >= sampleRate / 10) this.flush();
    }
    return true;
  }
}
registerProcessor('ff-pcm', PcmProcessor);
