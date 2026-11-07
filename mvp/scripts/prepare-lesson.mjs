import { readFile, copyFile, mkdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const app = fileURLToPath(new URL('../', import.meta.url));
const pack = path.resolve(app, '../练习素材/原生无字幕版');
let manifest;
try { manifest=JSON.parse(await readFile(path.join(pack,'segments.json'),'utf8')); }
catch(error){
  if(error.code!=='ENOENT')throw error;
  console.log('Optional local sample is not bundled. Import a TED talk after starting the app.');
  process.exit(0);
}
const first = manifest.segments.find(segment => segment.id === '01');
if (!first || first.source_ranges.length !== 1 || first.mask || first.crop) throw new Error('The approved continuous video clip is missing.');
const source = path.resolve(pack, first.file);
if (!source.startsWith(pack + path.sep)) throw new Error('Invalid video path.');
const bytes = await readFile(source);
if (createHash('sha256').update(bytes).digest('hex') !== first.sha256) throw new Error('Video file differs from the approved source.');
const destination = path.join(app, 'public', 'lesson.mp4');
await mkdir(path.dirname(destination), { recursive: true });
await copyFile(source, destination);
const posterFile=path.join(app,'public','lesson-poster.jpg');
try { await stat(posterFile); }
catch {
  const poster=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-ss','12','-i',source,'-frames:v','1','-q:v','3',posterFile],{encoding:'utf8',windowsHide:true});
  if(poster.status!==0)throw new Error(`Cannot prepare poster: ${poster.error?.message??poster.stderr}`);
}
console.log(`Prepared one approved continuous video (${(await stat(destination)).size} bytes); sentence pauses do not alter the source.`);
