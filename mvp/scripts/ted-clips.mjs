import path from 'node:path';
import {mkdir,stat} from 'node:fs/promises';
import {child,sha256} from './media-process.mjs';
import {pipelineRules} from '../src/pipeline-rules.ts';

/** Decode at the requested boundary; stream-copy would keep pre-keyframe speech. */
export async function createPracticeClips({folder,material,sourceFile=path.join(folder,'video.mp4'),clipDirectory='clips-v1',signal,onProgress=()=>{}}){
  if(!/^clips-v1(?:-[a-f0-9-]{36})?$/.test(clipDirectory))throw Error('Invalid clip directory');
  const target=path.join(folder,clipDirectory);await mkdir(target,{recursive:true});
  const clips=[];
  for(const [index,group] of material.groups.entries()){
    signal?.throwIfAborted();
    const filename=`${String(index+1).padStart(4,'0')}.mp4`,output=path.join(target,filename),requested=group.end-group.start;
    await child('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-ss',String(group.start),'-accurate_seek','-i',sourceFile,
      '-t',String(requested),'-map','0:v:0','-map','0:a:0','-sn','-dn','-map_metadata','-1',
      '-c:v','libx264','-preset','fast','-crf','20','-threads','2','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k','-movflags','+faststart',output],{signal});
    const probe=JSON.parse(await child('ffprobe',['-v','error','-show_format','-show_streams','-of','json',output],{signal,timeout:30000}));
    const video=probe.streams.find(stream=>stream.codec_type==='video'),audio=probe.streams.find(stream=>stream.codec_type==='audio');
    const duration=Number(probe.format.duration),bytes=(await stat(output)).size;
    if(!video||!audio||video.codec_name!=='h264'||audio.codec_name!=='aac'||probe.streams.some(stream=>stream.codec_type==='subtitle')
      ||!Number.isFinite(duration)||Math.abs(duration-requested)>pipelineRules.clipDurationTolerance||bytes<1024
      ||Math.abs(Number(video.start_time??0))>pipelineRules.clipStartTolerance||Math.abs(Number(audio.start_time??0))>pipelineRules.clipStartTolerance)
      throw Error(`第 ${index+1} 段的视频检查未通过，未加入素材。`);
    clips.push({groupId:group.id,video:`/media/${material.id}/${clipDirectory}/${filename}`,sourceStart:group.start,sourceEnd:group.end,duration,bytes,sha256:await sha256(output)});
    onProgress((index+1)/material.groups.length);
  }
  return clips;
}
