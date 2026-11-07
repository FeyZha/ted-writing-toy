import {spawn} from 'node:child_process';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {rename} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';

export function child(command,args,{signal,onProgress,timeout=600000}={}){
  return new Promise((resolve,reject)=>{
    const process=spawn(command,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],signal});
    let stdout='',stderr='',buffer='',failure=null;
    const timer=setTimeout(()=>{failure=Error('视频处理超时，请重试。');process.kill();},timeout);
    process.stdout.on('data',chunk=>{
      stdout=(stdout+chunk.toString()).slice(-1024*1024);buffer+=chunk.toString();
      const lines=buffer.split(/\r?\n/);buffer=lines.pop()??'';
      for(const line of lines){const match=line.match(/^out_time_us=(\d+)$/);if(match)onProgress?.(Number(match[1])/1000000);}
    });
    process.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-12000);});
    // Wait for close even on cancellation: cleanup must not race an encoder.
    process.on('error',error=>{failure=error.code==='ENOENT'?Error(`缺少 ${command}，请联系我补齐处理环境。`):signal?.aborted?Error('已取消导入。'):error;});
    process.on('close',code=>{
      clearTimeout(timer);
      if(failure)reject(failure);
      else if(code===0)resolve(stdout);
      else reject(Error(signal?.aborted?'已取消导入。':`${command==='ffmpeg'?'视频处理失败':'视频检查失败'}，请重试。`,{cause:stderr}));
    });
  });
}
export async function sha256(file){
  const hash=createHash('sha256'),stream=createReadStream(file);
  const closed=new Promise(resolve=>stream.once('close',resolve));
  try{for await(const chunk of stream)hash.update(chunk);}finally{await closed;}
  return hash.digest('hex');
}

// Windows scanners may briefly hold newly encoded files; never replace by deleting.
export async function publishRename(source,destination){
  for(let attempt=0;attempt<8;attempt++){
    try{await rename(source,destination);return;}
    catch(error){
      if(!['EPERM','EACCES','EBUSY'].includes(error.code)||attempt===7)throw Error('素材保存失败，请重新导入。',{cause:error});
      await delay(100*(attempt+1));
    }
  }
}
