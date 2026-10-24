import { parentPort, workerData } from 'node:worker_threads';
import { encode, decode, getDuration } from 'silk-wasm';

try {
  const { bytes, operation } = workerData;
  if (operation === 'decode' && getDuration(bytes) > 600000) throw new Error('Audio exceeds ten minutes');
  const result = operation === 'encode' ? await encode(bytes, 24000) : await decode(bytes, 24000);
  if (!result.data.length || result.duration > 600000) throw new Error('Invalid or oversized audio');
  parentPort.postMessage({ bytes: result.data });
} catch {
  parentPort.postMessage({ error: 'SILK codec failed: invalid audio or duration exceeds ten minutes' });
}
