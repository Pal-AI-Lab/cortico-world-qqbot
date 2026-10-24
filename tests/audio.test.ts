import { describe, expect, it } from 'vitest';
import { audioToSilk, audioToWav, isSilk, pcmToWav } from '../src/audio.ts';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function tone(): Uint8Array {
  const pcm = Buffer.alloc(24000 * 2 / 5);
  for (let i = 0; i < pcm.length / 2; i++) pcm.writeInt16LE(Math.round(Math.sin(i / 24000 * Math.PI * 2 * 440) * 10000), i * 2);
  return pcmToWav(pcm);
}
const options = () => ({ ffmpegPath: 'ffmpeg', signal: new AbortController().signal, timeoutMs: 10000 });
describe('real audio conversion', () => {
  it('encodes a WAV to Tencent SILK and decodes it into a playable mono WAV', async () => {
    const silk = await audioToSilk(tone(), options());
    expect(isSilk(silk)).toBe(true);
    expect(await audioToSilk(silk, options())).toBe(silk);
    const wav = Buffer.from(await audioToWav(silk, options()));
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.readUInt32LE(24)).toBe(24000);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.length).toBeGreaterThan(8000);
  });

  it('reports missing FFmpeg and rejects malformed media instead of sending it', async () => {
    await expect(audioToSilk(tone(), { ...options(), ffmpegPath: '/nonexistent/ffmpeg' })).rejects.toThrow('FFmpeg');
    await expect(audioToSilk(Buffer.from('not audio'), options())).rejects.toThrow('decode');
  });

  it('honors cancellation before starting a conversion', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(audioToSilk(tone(), { ...options(), signal: controller.signal })).rejects.toThrow();
  });

  it('refuses audio playlists that try to load a local file or network resource', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qq-audio-boundary-'));
    try {
      const file = join(dir, 'private.wav');
      await writeFile(file, tone());
      for (const source of [file, 'file:' + file, 'http://127.0.0.1/private.wav']) {
        const playlist = Buffer.from('ffconcat version 1.0\nfile ' + source + '\n');
        await expect(audioToSilk(playlist, options())).rejects.toThrow('decode');
      }
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
