import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createApplication} from '../scripts/server.mjs';
import {defaultMaterial} from '../src/material.ts';
import {pipelineRules} from '../src/pipeline-rules.ts';

test('local API preserves the library, serves seekable media and rejects unsafe writes',async()=>{
  const folder=await mkdtemp(path.join(os.tmpdir(),'english-ted-api-'));
  const id='ted-12-fixture',materialFolder=path.join(folder,'materials',id);
  await mkdir(materialFolder,{recursive:true});await mkdir(path.join(folder,'site'));
  const material={...defaultMaterial,id,video:`/media/${id}/video.mp4`,poster:`/media/${id}/poster.jpg`,transcriptUrl:`/media/${id}/source.en.vtt`,importedAt:'2026-11-07T00:00:00Z',sourceUrl:'https://www.ted.com/talks/fixture_only',pipelineVersion:pipelineRules.version,
    clips:defaultMaterial.groups.map((group,index)=>({groupId:group.id,video:`/media/${id}/clips-v1/${String(index+1).padStart(4,'0')}.mp4`,sourceStart:group.start,sourceEnd:group.end,duration:group.end-group.start,bytes:1024,sha256:'a'.repeat(64)}))};
  await mkdir(path.join(materialFolder,'clips-v1'));
  for(const clip of material.clips)await writeFile(path.join(materialFolder,path.basename(path.dirname(clip.video)),path.basename(clip.video)),Buffer.alloc(1024,5));
  await writeFile(path.join(materialFolder,'manifest.json'),JSON.stringify(material));
  for(const [file,text] of [['video.mp4','0123456789'],['source.en.vtt','WEBVTT\n'],['structure.json','{}'],['poster.jpg','fixture']])await writeFile(path.join(materialFolder,file),text);
  await writeFile(path.join(folder,'site','index.html'),'local application');
  await writeFile(path.join(folder,'site','lesson.mp4'),'optional sample');await writeFile(path.join(folder,'site','lesson-poster.jpg'),'sample poster');
  const {server}=createApplication({staticRoot:path.join(folder,'site'),dataRoot:path.join(folder,'materials')});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();if(!address||typeof address==='string')throw Error('No test address');
  const base=`http://127.0.0.1:${address.port}`;
  try{
    const library=await(await fetch(base+'/api/materials')).json();assert.equal(library.materials.length,2);
    const range=await fetch(base+material.video,{headers:{Range:'bytes=2-5'}});assert.equal(range.status,206);assert.equal(range.headers.get('content-range'),'bytes 2-5/10');assert.equal(await range.text(),'2345');
    const invalid=await fetch(base+material.video,{headers:{Range:'bytes=999-'}});assert.equal(invalid.status,416);
    const vtt=await fetch(base+material.transcriptUrl);assert.equal(vtt.status,200);assert.match(vtt.headers.get('content-type')??'',/text\/vtt/);
    const foreign=await fetch(base+'/api/imports',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:JSON.stringify({url:material.sourceUrl})});assert.equal(foreign.status,403);
    const wrongType=await fetch(base+'/api/imports',{method:'POST',headers:{'Content-Type':'text/plain'},body:'{}'});assert.equal(wrongType.status,415);
    const unsafe=await fetch(base+'/api/imports',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:'http://127.0.0.1/private'})});assert.equal(unsafe.status,400);
    const cached=await(await fetch(base+'/api/imports',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:material.sourceUrl})})).json();
    let result=cached;for(let i=0;i<50&&result.status==='running';i++){await new Promise(resolve=>setTimeout(resolve,10));result=await(await fetch(base+'/api/imports/'+cached.id)).json();}
    assert.equal(result.status,'ready');assert.equal(result.materialId,id);assert.equal(result.reused,true);
    assert.equal(await readFile(path.join(materialFolder,'video.mp4'),'utf8'),'0123456789');
    const clip=await fetch(base+material.clips[0].video,{headers:{Range:'bytes=2-5'}});assert.equal(clip.status,206);assert.equal((await clip.arrayBuffer()).byteLength,4);
    assert.equal((await fetch(base+material.clips[0].video.replace('0001','9999'))).status,404);
    assert.equal((await fetch(base+'/media/ted-12-fixture/source-page.json')).status,404);
    await rm(path.join(materialFolder,'clips-v1','0001.mp4'));
    assert.equal((await fetch(base+'/api/materials/'+id)).status,404,'missing clip must never be admitted as ready');
    await rm(path.join(folder,'site','lesson.mp4'));
    assert.equal((await(await fetch(base+'/api/materials')).json()).materials.length,0,'a clean source checkout must not advertise unavailable sample video');
    assert.equal((await fetch(base+'/api/materials/'+defaultMaterial.id)).status,404);
  }finally{
    await new Promise<void>(resolve=>server.close(()=>resolve()));
    const resolved=path.resolve(folder);if(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('english-ted-api-'))await rm(resolved,{recursive:true,force:true});
  }
});
