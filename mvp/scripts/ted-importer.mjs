import path from 'node:path';
import {mkdir,readdir,readFile,writeFile,stat,rm} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {defaultMaterial,validMaterial} from '../src/material.ts';
import {canonicalTedUrl,readTedPage,readMasterPlaylist,trustedTedResource,validateMediaPlaylist,structureTedCaptions} from './ted-structure.mjs';
import {downloadPlaylists} from './ted-download.mjs';
import {child,sha256,publishRename} from './media-process.mjs';
import {createPracticeClips} from './ted-clips.mjs';
import {pipelineRules} from '../src/pipeline-rules.ts';
import {mergeShortGroups} from '../src/practice-groups.ts';

async function fetchTextOnce(input,signal,maxBytes=4*1024*1024){
  let url=trustedTedResource(input);
  for(let redirects=0;redirects<5;redirects++){
    const response=await fetch(url,{redirect:'manual',signal:AbortSignal.any([signal,AbortSignal.timeout(30000)]),headers:{'User-Agent':'EnglishWritingPractice/0.1 (personal local tool)'}});
    if(response.status>=300&&response.status<400){const location=response.headers.get('location');await response.body?.cancel();if(!location)break;url=trustedTedResource(new URL(location,url).href);continue;}
    if(!response.ok){await response.body?.cancel();throw Error(response.status===404?'这场演讲或资源已经不可用。':'TED 资源暂时无法获取，请稍后重试。');}
    const chunks=[];let size=0;
    for await(const chunk of response.body){size+=chunk.length;if(size>maxBytes)throw Error('TED 返回的资源超出可处理大小。');chunks.push(chunk);}
    return Buffer.concat(chunks).toString('utf8');
  }
  throw Error('TED 资源跳转异常，请使用演讲原始链接。');
}
async function fetchText(input,signal,maxBytes){
  for(let attempt=0;attempt<2;attempt++){
    try{return await fetchTextOnce(input,signal,maxBytes);}
    catch(error){if(signal.aborted||attempt===1)throw error;}
  }
}
export class TedImporter{
  constructor(dataRoot,{sampleRoot=path.resolve(import.meta.dirname,'../dist')}={}){this.root=path.resolve(dataRoot);this.sampleRoot=path.resolve(sampleRoot);this.jobs=new Map();this.active=null;}
  async material(id,{allowMissingClips=false}={}){
    if(id===defaultMaterial.id){
      try{for(const file of ['lesson.mp4','lesson-poster.jpg']){const info=await stat(path.join(this.sampleRoot,file));if(!info.isFile()||info.size===0)return null;}return defaultMaterial;}
      catch{return null;}
    }
    if(!/^ted-[a-z0-9-]{1,123}$/.test(id))return null;
    try{
      const folder=path.join(this.root,id),value=JSON.parse(await readFile(path.join(folder,'manifest.json'),'utf8'));
      if(!validMaterial(value)||value.id!==id||value.video!==`/media/${id}/video.mp4`||value.transcriptUrl!==`/media/${id}/source.en.vtt`)return null;
      for(const file of ['video.mp4','source.en.vtt','structure.json','poster.jpg']){const info=await stat(path.join(folder,file));if(!info.isFile()||info.size===0)return null;}
      if(!allowMissingClips&&value.clips)for(const clip of value.clips){const info=await stat(path.join(folder,clip.video.slice(`/media/${id}/`.length)));if(!info.isFile()||info.size!==clip.bytes)return null;}
      return value;
    }catch{return null;}
  }
  async materials(options={}){
    await mkdir(this.root,{recursive:true});
    const entries=await readdir(this.root,{withFileTypes:true});
    const imported=(await Promise.all(entries.filter(entry=>entry.isDirectory()&&entry.name.startsWith('ted-')).map(entry=>this.material(entry.name,options)))).filter(Boolean);
    imported.sort((a,b)=>String(b.importedAt).localeCompare(String(a.importedAt)));
    const sample=await this.material(defaultMaterial.id);return sample?[...imported,sample]:imported;
  }
  async start(input){
    const sourceUrl=canonicalTedUrl(input);
    if(this.active)throw Object.assign(Error('已有视频正在导入，请稍候。'),{status:409});
    const id=randomUUID(),job={id,status:'running',stage:'metadata',progress:0,sourceUrl,title:null,materialId:null,error:null};
    this.jobs.set(id,job);this.active=id;
    const controller=new AbortController();job.controller=controller;
    void this.run(job,controller.signal).catch(error=>{job.status=controller.signal.aborted?'cancelled':'failed';job.error=controller.signal.aborted?'已取消导入。':/[\u4e00-\u9fff]/.test(error.message)?error.message:'无法获取 TED 资源，请检查网络后重试。';}).finally(()=>{if(this.active===id)this.active=null;delete job.controller;});
    return this.status(id);
  }
  status(id){const job=this.jobs.get(id);if(!job)return null;const {controller,...safe}=job;return {...safe};}
  current(){return this.active?this.status(this.active):null;}
  cancel(id){const job=this.jobs.get(id);if(job?.status==='running')job.controller?.abort();return this.status(id);}
  async prepareCached(cached,job,signal){
    const healthy=await this.material(cached.id);
    if(healthy?.clips&&healthy.pipelineVersion===pipelineRules.version&&healthy.groupingVersion===pipelineRules.groupingVersion){Object.assign(job,{status:'ready',stage:'ready',progress:1,title:cached.originalTitle,materialId:cached.id,reused:true});return;}
    const staged=path.resolve(this.root,'.staging',job.id),destination=path.join(this.root,cached.id),clipDirectory=`clips-v1-${job.id}`;
    if(!staged.startsWith(path.resolve(this.root,'.staging')+path.sep))throw Error('Invalid import folder');
    job.title=cached.originalTitle;job.stage='clips';job.progress=.1;
    await mkdir(staged,{recursive:true});
    try{
      const groups=mergeShortGroups(cached.groups);
      if(groups.some(group=>group.end-group.start<pipelineRules.minimumSeconds))throw Error('这份素材不足 10 秒，无法整理成独立练习段。');
      const regrouped={...cached,groups,groupingVersion:pipelineRules.groupingVersion,previousGroups:cached.previousGroups??cached.groups};
      const clips=await createPracticeClips({folder:staged,sourceFile:path.join(destination,'video.mp4'),material:regrouped,clipDirectory,signal,onProgress:progress=>{job.progress=.1+.85*progress;}});
      const manifest={...regrouped,pipelineVersion:pipelineRules.version,clips,provenance:{...cached.provenance,segmentationVersion:pipelineRules.segmentationVersion}};
      if(!validMaterial(manifest))throw Error('素材结构检查未通过。');
      signal.throwIfAborted();
      // Keep source files and original grouping; storage migrates to a separate key.
      await publishRename(path.join(staged,clipDirectory),path.join(destination,clipDirectory));
      const before=await readFile(path.join(destination,'manifest.json'));
      await writeFile(path.join(destination,'manifest.before-clips.json'),before,{flag:'wx'}).catch(error=>{if(error.code!=='EEXIST')throw error;});
      await writeFile(path.join(destination,`manifest.before-${job.id}.json`),before,{flag:'wx'});
      const oldStructureRaw=await readFile(path.join(destination,'structure.json'),'utf8'),oldStructure=JSON.parse(oldStructureRaw);
      await writeFile(path.join(destination,`structure.before-${job.id}.json`),oldStructureRaw,{flag:'wx'});
      const texts=new Map((oldStructure.sentences??[]).map(sentence=>[sentence.id,sentence.text]));
      const updatedStructure={...oldStructure,minimumSeconds:pipelineRules.minimumSeconds,segmentationVersion:pipelineRules.segmentationVersion,previousGroups:regrouped.previousGroups,groups:groups.map(group=>({...group,text:group.sentenceIds.map(id=>texts.get(id)??'').join(' ')}))};
      const pendingStructure=path.join(destination,`structure.${job.id}.json`);await writeFile(pendingStructure,JSON.stringify(updatedStructure,null,2));
      await publishRename(pendingStructure,path.join(destination,'structure.json'));
      const pending=path.join(destination,`manifest.${job.id}.json`);
      await writeFile(pending,JSON.stringify(manifest,null,2));
      await publishRename(pending,path.join(destination,'manifest.json'));
      Object.assign(job,{status:'ready',stage:'ready',progress:1,title:cached.originalTitle,materialId:cached.id,reused:true});
    }finally{
      if(staged.startsWith(path.resolve(this.root,'.staging')+path.sep))await rm(staged,{recursive:true,force:true,maxRetries:3,retryDelay:100}).catch(()=>{});
    }
  }
  async run(job,signal){
    const cached=(await this.materials({allowMissingClips:true})).find(material=>material.importedAt&&material.sourceUrl===job.sourceUrl);
    if(cached){await this.prepareCached(cached,job,signal);return;}
    const metadata=readTedPage(await fetchText(job.sourceUrl,signal),job.sourceUrl);job.title=metadata.title;
    if(!Number.isFinite(metadata.declaredDuration)||metadata.declaredDuration<=0||metadata.declaredDuration>pipelineRules.maximumDuration)throw Error('这场演讲的时长暂不支持。');
    const master=await fetchText(metadata.masterUrl,signal);
    const resources=readMasterPlaylist(master,metadata.masterUrl);
    job.stage='subtitles';job.progress=.08;
    const subtitleRaw=await fetchText(resources.subtitleUrl,signal);
    if(!subtitleRaw.replace(/^\uFEFF/,'').startsWith('WEBVTT'))throw Error('官方英文字幕暂时无法读取。');
    const subtitleSha=createHash('sha256').update(subtitleRaw).digest('hex');
    const materialId=`ted-${metadata.tedId}-${subtitleSha.slice(0,12)}`;
    if(!/^ted-[a-z0-9-]{1,123}$/.test(materialId))throw Error('演讲标识暂不支持。');
    const staged=path.resolve(this.root,'.staging',job.id);
    if(!staged.startsWith(path.resolve(this.root,'.staging')+path.sep))throw Error('Invalid import folder');
    await mkdir(staged,{recursive:true});
    try{
      await writeFile(path.join(staged,'source.en.vtt'),subtitleRaw);
      await writeFile(path.join(staged,'source-page.json'),JSON.stringify({...metadata,...resources,retrievedAt:new Date().toISOString()},null,2));
      const mediaPlaylists=await Promise.all([resources.videoUrl,...(resources.audioUrl?[resources.audioUrl]:[])].map(async url=>({url,text:await fetchText(url,signal)})));
      for(const playlist of mediaPlaylists)validateMediaPlaylist(playlist.text,playlist.url);
      job.stage='video';job.progress=.12;
      const mediaFolder=path.join(staged,'download-parts');
      const localInputs=await downloadPlaylists(mediaPlaylists,mediaFolder,signal,progress=>{job.progress=.12+.7*progress;});
      const args=['-hide_banner','-loglevel','error','-nostdin','-allowed_extensions','ALL','-i',localInputs[0]];
      if(resources.audioUrl)args.push('-allowed_extensions','ALL','-i',localInputs[1]);
      args.push('-map','0:v:0','-map',resources.audioUrl?'1:a:0':'0:a:0','-sn','-dn','-c','copy','-movflags','+faststart','-progress','pipe:1',path.join(staged,'video.mp4'));
      await child('ffmpeg',args,{signal,onProgress:seconds=>{job.progress=Math.max(job.progress,.12+.7*Math.min(.99,seconds/metadata.declaredDuration));}});
      if(path.resolve(mediaFolder).startsWith(staged+path.sep))await rm(mediaFolder,{recursive:true,force:true});
      const fileInfo=await stat(path.join(staged,'video.mp4'));
      if(fileInfo.size<1024||fileInfo.size>1024*1024*1024)throw Error('下载的视频大小异常，未加入素材。');
      const probe=JSON.parse(await child('ffprobe',['-v','error','-show_format','-show_streams','-of','json',path.join(staged,'video.mp4')],{signal,timeout:30000}));
      const video=probe.streams.find(stream=>stream.codec_type==='video'),audio=probe.streams.find(stream=>stream.codec_type==='audio'),duration=Number(probe.format.duration);
      if(!video||!audio||!Number.isFinite(duration)||duration<=0)throw Error('视频画面或声音不完整，未加入素材。');
      job.stage='structure';job.progress=.87;
      const structure=structureTedCaptions(subtitleRaw,duration);
      await writeFile(path.join(staged,'structure.json'),JSON.stringify(structure,null,2));
      const posterTime=Math.min(structure.groups[0].start+2,duration/2);
      await child('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-ss',String(posterTime),'-i',path.join(staged,'video.mp4'),'-frames:v','1','-q:v','3',path.join(staged,'poster.jpg')],{signal,timeout:30000});
      const importedAt=new Date().toISOString();
      const manifest={schemaVersion:1,id:materialId,title:metadata.title,originalTitle:metadata.title,speaker:metadata.speaker,event:metadata.event,
        duration,sourceStart:0,sourceEnd:duration,video:`/media/${materialId}/video.mp4`,poster:`/media/${materialId}/poster.jpg`,sourceUrl:job.sourceUrl,
        transcriptUrl:`/media/${materialId}/source.en.vtt`,referenceSourceUrl:resources.subtitleUrl,groups:structure.groups.map(({text,...group})=>group),
        sentences:structure.sentences.map(({text,...sentence})=>sentence),previousGroups:structure.previousGroups,groupingVersion:pipelineRules.groupingVersion,importedAt,
        provenance:{tedId:metadata.tedId,masterUrl:metadata.masterUrl,videoPlaylist:resources.videoUrl,audioPlaylist:resources.audioUrl,subtitleUrl:resources.subtitleUrl,subtitleSha256:subtitleSha,
          videoSha256:await sha256(path.join(staged,'video.mp4')),videoBytes:fileInfo.size,width:video.width,height:video.height,audioCodec:audio.codec_name,videoCodec:video.codec_name,segmentationVersion:structure.segmentationVersion}};
      job.stage='clips';job.progress=.89;
      manifest.clips=await createPracticeClips({folder:staged,material:manifest,signal,onProgress:progress=>{job.progress=.89+.1*progress;}});
      manifest.pipelineVersion=pipelineRules.version;
      if(!validMaterial(manifest))throw Error('素材结构检查未通过，未加入素材。');
      await writeFile(path.join(staged,'manifest.json'),JSON.stringify(manifest,null,2));
      signal.throwIfAborted();
      const destination=path.join(this.root,materialId);
      const existing=await this.material(materialId);
      if(!existing)await publishRename(staged,destination);
      Object.assign(job,{status:'ready',stage:'ready',progress:1,materialId,title:metadata.title});
    }finally{
      // Only this randomly named import staging folder is removable, never a material directory.
      if(staged.startsWith(path.resolve(this.root,'.staging')+path.sep))await rm(staged,{recursive:true,force:true,maxRetries:3,retryDelay:100}).catch(()=>{});
    }
  }
}
