import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {child,sha256} from '../scripts/media-process.mjs';
import {TedImporter} from '../scripts/ted-importer.mjs';
import {validMaterial} from '../src/material.ts';
import {pipelineRules} from '../src/pipeline-rules.ts';
import {answerSheetFor,editAnswer,validSheet,migrateDurationSheet} from '../src/answer-sheet.ts';

test('cached sources produce accurate standalone clips, preserve writing IDs and reuse without the network',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'english-ted-clips-')),id='ted-12-clip-fixture',folder=path.join(root,id);
  await mkdir(folder);
  const groups=[{id:'sentence-0001',start:.7,end:10.7,wordCount:10,sentenceIds:['sentence-0001']},{id:'sentence-0002',start:12.3,end:22.3,wordCount:10,sentenceIds:['sentence-0002']}];
  const material={schemaVersion:1 as const,id,title:'Fixture',originalTitle:'Fixture',speaker:'Fixture',event:'Test',duration:24,sourceStart:0,sourceEnd:24,
    video:`/media/${id}/video.mp4`,poster:`/media/${id}/poster.jpg`,sourceUrl:'https://www.ted.com/talks/clip_fixture',transcriptUrl:`/media/${id}/source.en.vtt`,referenceSourceUrl:'https://hls.ted.com/fixture/en/full.vtt',groups,sentences:groups,importedAt:'2026-11-07T00:00:00Z'};
  try{
    await child('ffmpeg',['-v','error','-nostdin','-f','lavfi','-i','color=c=red:s=160x90:r=25:d=12','-f','lavfi','-i','color=c=blue:s=160x90:r=25:d=12','-f','lavfi','-i','sine=frequency=440:duration=24','-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0[v]','-map','[v]','-map','2:a','-c:v','libx264','-g','250','-c:a','aac',path.join(folder,'video.mp4')]);
    for(const [file,content] of [['manifest.json',JSON.stringify(material)],['source.en.vtt','WEBVTT\n'],['structure.json','{}'],['poster.jpg','fixture']])await writeFile(path.join(folder,file),content);
    const sourceHash=await sha256(path.join(folder,'video.mp4'));
    const old=answerSheetFor(material),sheet=editAnswer(old.completeSentence(old.freshSheet(),0),0,'My existing writing must survive.');
    const importer=new TedImporter(root);
    let job=await importer.start(material.sourceUrl);
    while(job.status==='running'){await new Promise(resolve=>setTimeout(resolve,25));job=importer.status(job.id);}
    assert.equal(job.status,'ready',job.error??'');
    const result=await importer.material(id);assert.ok(result?.clips);assert.equal(validMaterial(result),true);
    assert.equal(validSheet(migrateDurationSheet(sheet,result),result),true);assert.equal(sheet.answers[0].text,'My existing writing must survive.');
    assert.deepEqual(result.groups,material.groups);assert.equal(await sha256(path.join(folder,'video.mp4')),sourceHash);
    assert.equal((JSON.parse(await readFile(path.join(folder,'manifest.before-clips.json'),'utf8'))).clips,undefined);
    for(const [index,clip] of result.clips.entries()){
      assert.ok(Math.abs(clip.duration-10)<=pipelineRules.clipDurationTolerance);
      const source=path.join(folder,clip.video.slice(`/media/${id}/`.length)),pixel=path.join(root,`pixel-${index}.rgb`);
      await child('ffmpeg',['-v','error','-nostdin','-i',source,'-frames:v','1','-vf','scale=1:1','-f','rawvideo','-pix_fmt','rgb24',pixel]);
      const rgb=await readFile(pixel);assert.ok(index===0?rgb[0]>200&&rgb[2]<40:rgb[2]>200&&rgb[0]<40,'non-keyframe trim must start in the requested color, not the earlier keyframe');
      await child('ffmpeg',['-v','error','-xerror','-nostdin','-i',source,'-f','null','-']);
    }
    for(const change of [{clips:result.clips.slice(1)},{clips:result.clips.map((clip,index)=>index===0?{...clip,sourceStart:0}:clip)},{clips:result.clips.map((clip,index)=>index===0?{...clip,video:'/media/escape/0001.mp4'}:clip)}])assert.equal(validMaterial({...result,...change}),false);
    const manifestBefore=await readFile(path.join(folder,'manifest.json'),'utf8');
    job=await importer.start(material.sourceUrl);while(job.status==='running'){await new Promise(resolve=>setTimeout(resolve,10));job=importer.status(job.id);}
    assert.equal(job.status,'ready');assert.equal(job.reused,true);assert.equal(await readFile(path.join(folder,'manifest.json'),'utf8'),manifestBefore);
    await rm(path.join(folder,result.clips[0].video.slice(`/media/${id}/`.length)));
    assert.equal(await importer.material(id),null);
    job=await importer.start(material.sourceUrl);importer.cancel(job.id);
    while(job.status==='running'){await new Promise(resolve=>setTimeout(resolve,10));job=importer.status(job.id);}
    assert.equal(job.status,'cancelled');assert.equal(await readFile(path.join(folder,'manifest.json'),'utf8'),manifestBefore,'cancellation cannot publish a partial repair');
    job=await importer.start(material.sourceUrl);while(job.status==='running'){await new Promise(resolve=>setTimeout(resolve,25));job=importer.status(job.id);}
    assert.equal(job.status,'ready',job.error??'');const repaired=await importer.material(id);assert.ok(repaired?.clips);assert.equal(validSheet(migrateDurationSheet(sheet,repaired),repaired),true);
    assert.equal(await sha256(path.join(folder,'video.mp4')),sourceHash);
    const badId='ted-13-broken-fixture',badFolder=path.join(root,badId),bad={...material,id:badId,sourceUrl:'https://www.ted.com/talks/broken_fixture',video:`/media/${badId}/video.mp4`,poster:`/media/${badId}/poster.jpg`,transcriptUrl:`/media/${badId}/source.en.vtt`};
    await mkdir(badFolder);for(const file of ['video.mp4','source.en.vtt','structure.json','poster.jpg'])await writeFile(path.join(badFolder,file),'broken fixture');
    await writeFile(path.join(badFolder,'manifest.json'),JSON.stringify(bad));
    job=await importer.start(bad.sourceUrl);while(job.status==='running'){await new Promise(resolve=>setTimeout(resolve,25));job=importer.status(job.id);}
    assert.equal(job.status,'failed');assert.deepEqual(JSON.parse(await readFile(path.join(badFolder,'manifest.json'),'utf8')),bad,'failed processing must preserve original metadata');
    const abort=new AbortController();abort.abort();
    await assert.rejects(child('ffmpeg',['-version'],{signal:abort.signal}));
  }finally{
    const resolved=path.resolve(root);if(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('english-ted-clips-'))await rm(resolved,{recursive:true,force:true,maxRetries:3});
  }
});
