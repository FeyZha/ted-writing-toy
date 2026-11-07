import path from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {trustedTedResource,validateMediaPlaylist} from './ted-structure.mjs';

export function localPlaylist(raw,url,prefix){
  validateMediaPlaylist(raw,url);
  const entries=new Map();
  function local(uri){
    const remote=trustedTedResource(new URL(uri,url).href);
    if(!entries.has(remote)){
      const ext=path.posix.extname(new URL(remote).pathname);
      entries.set(remote,{url:remote,file:`${prefix}-${String(entries.size).padStart(5,'0')}${/^\.[a-z0-9]{1,5}$/i.test(ext)?ext:'.ts'}`});
    }
    return entries.get(remote).file;
  }
  const text=raw.split(/\r?\n/).map(line=>line.trim()&&!line.startsWith('#')?local(line.trim()):line.replace(/\bURI="([^"]+)"/g,(_,uri)=>`URI="${local(uri)}"`)).join('\n');
  return {text,entries:[...entries.values()]};
}
async function bytes(input,signal){
  let url=trustedTedResource(input);
  for(let redirects=0;redirects<5;redirects++){
    const response=await fetch(url,{redirect:'manual',signal:AbortSignal.any([signal,AbortSignal.timeout(45000)])});
    if(response.status>=300&&response.status<400){const target=response.headers.get('location');await response.body?.cancel();if(!target)break;url=trustedTedResource(new URL(target,url).href);continue;}
    if(!response.ok){await response.body?.cancel();throw Error('视频下载失败，请检查网络后重试。');}
    const chunks=[];let size=0;
    for await(const chunk of response.body){size+=chunk.length;if(size>256*1024*1024)throw Error('视频分段大小异常。');chunks.push(chunk);}
    return Buffer.concat(chunks);
  }
  throw Error('视频资源跳转异常。');
}

/** Concurrent HTTPS fetches reuse Node's connections; FFmpeg only remuxes local files. */
export async function downloadPlaylists(inputs,folder,signal,onProgress){
  await mkdir(folder,{recursive:true});
  const playlists=inputs.map((input,index)=>localPlaylist(input.text,input.url,`track${index}`));
  const entries=playlists.flatMap(playlist=>playlist.entries);
  if(entries.length===0||entries.length>10000)throw Error('视频资源分段数量异常。');
  const controller=new AbortController(),combined=AbortSignal.any([signal,controller.signal]);
  let cursor=0,completed=0,totalBytes=0;
  async function worker(){
    while(cursor<entries.length){
      combined.throwIfAborted();const entry=entries[cursor++];let buffer;
      for(let attempt=0;attempt<2;attempt++){
        try{buffer=await bytes(entry.url,combined);break;}
        catch(error){if(combined.aborted||attempt===1)throw error;}
      }
      totalBytes+=buffer.length;
      if(totalBytes>1024*1024*1024)throw Error('视频超过本机导入大小上限。');
      await writeFile(path.join(folder,entry.file),buffer,{signal:combined});
      onProgress?.(++completed/entries.length);
    }
  }
  const workers=Array.from({length:Math.min(6,entries.length)},worker);
  try{await Promise.all(workers);}
  catch(error){controller.abort();await Promise.allSettled(workers);throw error;}
  const files=[];
  for(let index=0;index<playlists.length;index++){const file=path.join(folder,`track${index}.m3u8`);await writeFile(file,playlists[index].text);files.push(file);}
  return files;
}
