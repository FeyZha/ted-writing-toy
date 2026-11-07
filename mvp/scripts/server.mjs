import http from 'node:http';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {TedImporter} from './ted-importer.mjs';

const app=fileURLToPath(new URL('../',import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.mp4':'video/mp4','.jpg':'image/jpeg','.svg':'image/svg+xml','.vtt':'text/vtt; charset=utf-8'};
function json(response,status,value){response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}).end(JSON.stringify(value));}
async function bodyJson(request){
  if(!/^application\/json(?:;|$)/i.test(request.headers['content-type']??''))throw Object.assign(Error('请求格式不正确。'),{status:415});
  let raw='';for await(const chunk of request){raw+=chunk;if(Buffer.byteLength(raw)>4096)throw Object.assign(Error('链接过长。'),{status:413});}
  try{return JSON.parse(raw);}catch{throw Object.assign(Error('请求格式不正确。'),{status:400});}
}
async function serveFile(request,response,filename){
  let info;try{info=await stat(filename);if(!info.isFile()||info.size===0)throw Error();}catch{response.writeHead(404).end('Not found');return;}
  const headers={'Content-Type':mime[path.extname(filename)]??'application/octet-stream','Accept-Ranges':'bytes','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'};
  let start=0,end=info.size-1,status=200;
  if(request.headers.range){
    const match=/^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
    if(!match||(!match[1]&&!match[2])){response.writeHead(416,{'Content-Range':`bytes */${info.size}`}).end();return;}
    if(!match[1])start=Math.max(0,info.size-Number(match[2]));else{start=Number(match[1]);if(match[2])end=Math.min(end,Number(match[2]));}
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=info.size){response.writeHead(416,{'Content-Range':`bytes */${info.size}`}).end();return;}
    headers['Content-Range']=`bytes ${start}-${end}/${info.size}`;status=206;
  }
  headers['Content-Length']=String(end-start+1);response.writeHead(status,headers);
  if(request.method==='HEAD'){response.end();return;}
  const stream=createReadStream(filename,{start,end});stream.on('error',()=>response.destroy());response.on('close',()=>stream.destroy());stream.pipe(response);
}
export function createApplication({staticRoot=path.join(app,'dist'),dataRoot=path.join(app,'data','materials')}={}){
  const root=path.resolve(staticRoot),importer=new TedImporter(dataRoot,{sampleRoot:root});
  const server=http.createServer(async(request,response)=>{
    try{
      const host=request.headers.host??'';
      if(!/^127\.0\.0\.1:\d+$/.test(host)){json(response,403,{error:'仅支持本机访问。'});return;}
      const origin=request.headers.origin;
      if(origin&&origin!==`http://${host}`&&origin!=='http://127.0.0.1:4398'){json(response,403,{error:'请求来源不受支持。'});return;}
      const url=new URL(request.url??'/',`http://${host}`),pathname=decodeURIComponent(url.pathname),method=request.method;
      if(pathname.startsWith('/api/')){
        if(method==='GET'&&pathname==='/api/health'){json(response,200,{id:'english-writing-mvp',apiVersion:1,features:['ted-import','practice-clips']});return;}
        if(method==='GET'&&pathname==='/api/materials'){json(response,200,{materials:(await importer.materials()).map(material=>({id:material.id,originalTitle:material.originalTitle,speaker:material.speaker,event:material.event,duration:material.duration,poster:material.poster,sourceUrl:material.sourceUrl,importedAt:material.importedAt,groupCount:material.groups.length}))});return;}
        const materialMatch=pathname.match(/^\/api\/materials\/([a-z0-9-]{1,128})$/);
        if(method==='GET'&&materialMatch){const material=await importer.material(materialMatch[1]);json(response,material?200:404,material??{error:'没有找到这份素材。'});return;}
        if(method==='GET'&&pathname==='/api/imports/current'){json(response,200,{job:importer.current()});return;}
        if(method==='POST'&&pathname==='/api/imports'){
          const body=await bodyJson(request);
          if(typeof body?.url!=='string'||body.url.length>2048){json(response,400,{error:'请提供 TED 演讲链接。'});return;}
          let job;try{job=await importer.start(body.url);}catch(error){json(response,error.status??400,{error:error.message});return;}
          json(response,202,job);return;
        }
        const jobMatch=pathname.match(/^\/api\/imports\/([a-f0-9-]{36})(\/cancel)?$/);
        if(jobMatch&&((method==='GET'&&!jobMatch[2])||(method==='POST'&&jobMatch[2]))){
          if(method==='POST'&&!/^application\/json(?:;|$)/i.test(request.headers['content-type']??'')){json(response,415,{error:'请求格式不正确。'});return;}
          const job=method==='POST'?importer.cancel(jobMatch[1]):importer.status(jobMatch[1]);json(response,job?200:404,job??{error:'导入任务已结束，请重新导入。'});return;
        }
        json(response,404,{error:'没有找到这个操作。'});return;
      }
      if(!['GET','HEAD'].includes(method??'')){response.writeHead(405,{Allow:'GET, HEAD'}).end();return;}
      if(pathname.startsWith('/media/')){
        const media=pathname.match(/^\/media\/(ted-[a-z0-9-]{1,123})\/(video\.mp4|poster\.jpg|source\.en\.vtt|structure\.json|clips-v1(?:-[a-f0-9-]{36})?\/\d{4}\.mp4)$/);
        const material=media?await importer.material(media[1]):null;
        if(!media||!material||(media[2].startsWith('clips-')&&!material.clips?.some(clip=>clip.video===pathname))){response.writeHead(404).end();return;}
        await serveFile(request,response,path.join(importer.root,media[1],media[2]));return;
      }
      const filename=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname)),relative=path.relative(root,filename);
      if(relative.startsWith('..')||path.isAbsolute(relative)||filename.includes('\0')){response.writeHead(403).end();return;}
      await serveFile(request,response,filename);
    }catch(error){if(!response.headersSent)json(response,error.status??500,{error:error.status?error.message:'处理失败，请重试。'});else response.destroy();}
  });
  return {server,importer};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const port=Number(process.env.ENGLISH_WRITING_PORT??4397);
  if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid port');
  const {server}=createApplication({dataRoot:process.env.ENGLISH_WRITING_DATA_DIR});
  server.on('error',error=>{console.error(error.code==='EADDRINUSE'?`Port ${port} is already in use.`:error.message);process.exitCode=1;});
  server.listen(port,'127.0.0.1',()=>console.log(`English writing practice: http://127.0.0.1:${port}`));
}
