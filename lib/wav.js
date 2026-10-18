'use strict';
// WAV helpers: wrap raw PCM16 little-endian samples in a RIFF header.

function pcm16ToWav(pcm, sampleRate, channels = 1) {
  const dataLen = pcm.length;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLen, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);                 // PCM chunk size
  header.writeUInt16LE(1, 20);                  // audio format = PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);                 // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(dataLen, 40);
  return Buffer.concat([header, pcm]);
}

function wavDurationMs(wav) {
  if (wav.length < 44) return 0;
  const rate = wav.readUInt32LE(24);
  const block = wav.readUInt16LE(32) || 2;
  return Math.round(((wav.length - 44) / block / rate) * 1000);
}

module.exports = { pcm16ToWav, wavDurationMs };
