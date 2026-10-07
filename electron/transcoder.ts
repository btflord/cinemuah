// FFmpeg-backed probing and on-the-fly transcoding to browser-playable fragmented MP4 (H.264 + AAC).
import { spawn, ChildProcess } from 'child_process';
import http from 'http';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffmpegStatic: string | null = require('ffmpeg-static');
// In a packaged app the binary lives outside the asar archive.
const FFMPEG = ffmpegStatic ? ffmpegStatic.replace('app.asar', 'app.asar.unpacked') : 'ffmpeg';

const DIRECT_VIDEO = new Set(['h264', 'vp8', 'vp9', 'av1']);
const DIRECT_AUDIO = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac']);
const DIRECT_CONTAINERS = ['mp4', 'mov', 'matroska', 'webm'];

export interface ProbeResult {
  duration: number; // seconds, 0 if unknown
  video: string; // codec name, '' if none
  audio: string; // codec name, '' if none
  container: string;
  direct: boolean; // true if Chromium can play it as-is
}

const probeCache = new Map<string, ProbeResult>();

/** Runs `ffmpeg -i` and parses the stream summary from stderr (no ffprobe needed). */
export function probe(input: string): Promise<ProbeResult> {
  const cached = probeCache.get(input);
  if (cached) return Promise.resolve(cached);

  return new Promise(resolve => {
    const proc = spawn(FFMPEG, ['-hide_banner', '-i', input], { windowsHide: true });
    let err = '';
    proc.stderr.on('data', d => { err += d.toString(); });
    const done = () => {
      const dur = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(err);
      const video = /Stream #\d+:\d+[^:]*: Video: (\w+)/.exec(err)?.[1] || '';
      const audio = /Stream #\d+:\d+[^:]*: Audio: (\w+)/.exec(err)?.[1] || '';
      const container = /Input #0, ([^,]+(?:,[^,]+)*), from/.exec(err)?.[1] || '';
      const result: ProbeResult = {
        duration: dur ? +dur[1] * 3600 + +dur[2] * 60 + parseFloat(dur[3]) : 0,
        video,
        audio,
        container,
        direct:
          DIRECT_VIDEO.has(video) &&
          (!audio || DIRECT_AUDIO.has(audio)) &&
          DIRECT_CONTAINERS.some(c => container.includes(c)),
      };
      // Don't cache failed probes (e.g. a torrent that hadn't buffered enough yet)
      if (video) probeCache.set(input, result);
      resolve(result);
    };
    let finished = false;
    const timer = setTimeout(() => proc.kill(), 30000);
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      done();
    };
    proc.on('close', finish);
    proc.on('error', err => { console.error('[ffmpeg] probe failed to start:', err.message); finish(); });
  });
}

interface Encoder { name: string; args: string[] }

const ENCODERS: Encoder[] = [
  // Apple hardware encoder (macOS); the probe below simply fails elsewhere.
  ...(process.platform === 'darwin'
    ? [{ name: 'h264_videotoolbox', args: ['-c:v', 'h264_videotoolbox', '-b:v', '8M', '-maxrate', '12M', '-bufsize', '16M', '-allow_sw', '1'] }]
    : []),
  { name: 'h264_nvenc', args: ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', '23', '-b:v', '0'] },
  { name: 'h264_qsv', args: ['-c:v', 'h264_qsv', '-preset', 'veryfast', '-global_quality', '23'] },
  { name: 'h264_amf', args: ['-c:v', 'h264_amf', '-usage', 'transcoding', '-quality', 'speed', '-rc', 'cqp', '-qp_i', '23', '-qp_p', '23'] },
];
const SOFTWARE_ENCODER: Encoder = {
  name: 'libx264',
  args: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23'],
};

let encoderPromise: Promise<Encoder> | null = null;

/** Tries each GPU encoder with a tiny real encode; the first that works wins, else libx264. */
function pickEncoder(): Promise<Encoder> {
  if (encoderPromise) return encoderPromise;
  encoderPromise = (async () => {
    for (const enc of ENCODERS) {
      const ok = await new Promise<boolean>(resolve => {
        const p = spawn(FFMPEG, [
          '-hide_banner', '-loglevel', 'error',
          '-f', 'lavfi', '-i', 'color=black:s=320x240:d=0.2:r=24',
          ...enc.args, '-pix_fmt', 'yuv420p', '-f', 'null', '-',
        ], { windowsHide: true, stdio: 'ignore' });
        const t = setTimeout(() => { p.kill(); resolve(false); }, 10000);
        p.on('close', code => { clearTimeout(t); resolve(code === 0); });
        p.on('error', () => { clearTimeout(t); resolve(false); });
      });
      if (ok) {
        console.log(`[transcoder] using GPU encoder ${enc.name}`);
        return enc;
      }
    }
    console.log('[transcoder] no GPU encoder available, using libx264 (CPU)');
    return SOFTWARE_ENCODER;
  })();
  return encoderPromise;
}

/** Warm the encoder detection at startup so the first transcode isn't delayed. */
export function initTranscoder() {
  pickEncoder().catch(() => undefined);
}

/** Streams `input` as fragmented MP4 starting at `startSec`, remuxing video if it is already H.264. */
export async function transcodeTo(
  input: string,
  startSec: number,
  req: http.IncomingMessage,
  res: http.ServerResponse
) {
  const info = await probe(input);
  if (!info.video && !/^https?:/i.test(input)) {
    // A local file ffmpeg can't read at all. (Torrent streams may just not have buffered yet, so let them try.)
    res.writeHead(415, { 'Content-Type': 'text/plain' });
    res.end('No playable video stream found');
    return;
  }
  const copyVideo = info.video === 'h264';

  const encoder = copyVideo ? null : await pickEncoder();
  const args = ['-hide_banner', '-loglevel', 'error'];
  // GPU decode for the source too (HEVC/AV1 etc.); falls back to software automatically.
  if (!copyVideo) args.push('-hwaccel', 'auto');
  if (startSec > 0) args.push('-ss', String(startSec));
  args.push('-i', input, '-map', '0:v:0', '-map', '0:a:0?', '-sn');
  if (encoder) {
    args.push(...encoder.args, '-pix_fmt', 'yuv420p');
  } else {
    args.push('-c:v', 'copy');
  }
  args.push(
    '-c:a', 'aac', '-b:a', '192k', '-ac', '2',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-f', 'mp4', 'pipe:1'
  );

  const proc: ChildProcess = spawn(FFMPEG, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stderr!.on('data', d => console.error('[ffmpeg]', d.toString().trim()));

  res.writeHead(200, { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-cache' });
  if (req.method === 'HEAD') {
    proc.kill();
    res.end();
    return;
  }
  proc.stdout!.pipe(res);

  // Seeking aborts the request; make sure ffmpeg dies with it.
  const kill = () => { if (!proc.killed) proc.kill('SIGKILL'); };
  res.on('close', kill);
  proc.on('error', err => { console.error('[ffmpeg] spawn failed:', err.message); res.destroy(); });
}
