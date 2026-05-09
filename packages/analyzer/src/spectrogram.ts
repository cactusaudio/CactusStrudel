import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export interface SpectrogramOptions {
  width?: number;
  height?: number;
  /** Output PNG path. Created if missing. */
  outputPath: string;
  /** "fullband" | "lowband" | "loudness" */
  mode?: 'fullband' | 'lowband' | 'loudness';
}

export async function generateSpectrogram(wavPath: string, opts: SpectrogramOptions): Promise<string> {
  await fs.mkdir(path.dirname(opts.outputPath), { recursive: true });
  const width = opts.width ?? 1280;
  const height = opts.height ?? 360;
  const mode = opts.mode ?? 'fullband';

  let lavfi: string;
  switch (mode) {
    case 'fullband':
      lavfi = `showspectrumpic=s=${width}x${height}:legend=disabled:scale=log:color=intensity`;
      break;
    case 'lowband':
      lavfi = `lowpass=f=400,showspectrumpic=s=${width}x${height}:legend=disabled:scale=log:color=intensity`;
      break;
    case 'loudness':
      lavfi = `ebur128=video=1:size=${width}x${height},format=yuv420p`;
      break;
  }

  return new Promise((resolve, reject) => {
    const child = spawn(
      'ffmpeg',
      ['-y', '-i', wavPath, '-lavfi', lavfi, '-frames:v', '1', opts.outputPath],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let stderr = '';
    child.stderr.on('data', (b) => { stderr += b.toString(); });
    child.on('close', (code) => {
      if (code === 0) resolve(opts.outputPath);
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`));
    });
    child.on('error', reject);
  });
}
