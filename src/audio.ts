import { spawn } from 'node:child_process';
import { Worker } from 'node:worker_threads';

export interface AudioOptions { signal: AbortSignal; timeoutMs: number; ffmpegPath: string }
const PCM_LIMIT = 24000 * 2 * 600;
export function isSilk(bytes: Uint8Array): boolean { return Buffer.from(bytes.subarray(0, 10)).toString('ascii').includes('#!SILK_V3'); }
export function isAudio(mime: string, name = ''): boolean { return /^(audio|voice)\//i.test(mime) || /\.(silk|amr|wav|mp3|m4a|ogg|flac|aac|opus)$/i.test(name); }

function codec(bytes: Uint8Array, operation: 'encode' | 'decode', options: AudioOptions): Promise<Uint8Array> {
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs)]);
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./audio-worker.js', import.meta.url), { workerData: { bytes, operation }, resourceLimits: { maxOldGenerationSizeMb: 128 } });
    let done = false;
    const finish = (error?: unknown, data?: Uint8Array) => {
      if (done) return; done = true;
      signal.removeEventListener('abort', abort);
      void worker.terminate();
      if (error) reject(error); else resolve(data!);
    };
    const abort = () => finish(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    worker.once('error', () => finish(new Error('SILK codec worker failed')));
    worker.once('exit', () => { if (!done) finish(new Error('SILK codec worker exited')); });
    worker.once('message', (result: { error?: string; bytes?: Uint8Array }) => result.error ? finish(new Error(result.error)) : finish(undefined, result.bytes));
  });
}

async function toPcm(bytes: Uint8Array, options: AudioOptions): Promise<Uint8Array> {
  if (isSilk(bytes)) return codec(bytes, 'decode', options);
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs)]);
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    // The decoder reads only stdin; nested file/network references in untrusted media are disabled.
    const child = spawn(options.ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'pipe', '-i', 'pipe:0', '-vn', '-ac', '1', '-ar', '24000', '-f', 's16le', 'pipe:1'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks: Buffer[] = []; let size = 0; let failure: Error | undefined;
    const abort = () => { failure = new Error('Audio conversion cancelled or timed out'); child.kill('SIGKILL'); };
    signal.addEventListener('abort', abort, { once: true });
    child.once('error', () => { failure = new Error('Cannot run FFmpeg; install it or set ffmpegPath in Configuration'); });
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > PCM_LIMIT) { failure = new Error('Audio exceeds ten minutes'); child.kill('SIGKILL'); }
      else chunks.push(chunk);
    });
    child.stderr.resume();
    child.stdin.on('error', () => {}); // Decoder failure is reported by its exit status, not EPIPE.
    child.once('close', (code) => {
      signal.removeEventListener('abort', abort);
      if (failure || code !== 0 || !size) reject(failure ?? new Error('FFmpeg could not decode this audio'));
      else resolve(Buffer.concat(chunks));
    });
    child.stdin.end(bytes);
  });
}

export function pcmToWav(pcm: Uint8Array): Uint8Array {
  const wav = Buffer.alloc(44 + pcm.byteLength);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(pcm.byteLength, 40); wav.set(pcm, 44);
  return wav;
}
export async function audioToSilk(bytes: Uint8Array, options: AudioOptions): Promise<Uint8Array> {
  options.signal.throwIfAborted();
  if (isSilk(bytes)) return bytes;
  return codec(await toPcm(bytes, options), 'encode', options);
}
export async function audioToWav(bytes: Uint8Array, options: AudioOptions): Promise<Uint8Array> {
  return pcmToWav(await toPcm(bytes, options));
}
