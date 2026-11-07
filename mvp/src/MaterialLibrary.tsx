import {useEffect,useRef,useState} from 'react';
import {apiJson} from './api.ts';
import type {ImportJob} from './api.ts';
import type {MaterialSummary} from './material.ts';

function duration(seconds:number){return `${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;}
const stages={metadata:'读取演讲',subtitles:'获取英文字幕',video:'下载视频',structure:'整理练习段',clips:'生成练习片段',ready:'素材已就绪'};

export default function MaterialLibrary({onOpen,opening,openIssue}:{onOpen:(id:string)=>void;opening:boolean;openIssue:string|null}){
  const [url,setUrl]=useState('');
  const [materials,setMaterials]=useState<MaterialSummary[]>([]);
  const [job,setJob]=useState<ImportJob|null>(null);
  const [submitting,setSubmitting]=useState(false);
  const [issue,setIssue]=useState<string|null>(null);
  const [loading,setLoading]=useState(true);
  const mounted=useRef(false);
  const currentRequest=useRef<AbortController|null>(null);

  async function loadMaterials(){const result=await apiJson<{materials:MaterialSummary[]}>('/api/materials');if(mounted.current)setMaterials(result.materials);}
  useEffect(()=>{
    mounted.current=true;
    Promise.all([loadMaterials(),apiJson<{job:ImportJob|null}>('/api/imports/current').then(result=>{if(mounted.current&&result.job){setJob(result.job);setUrl(result.job.sourceUrl);}})])
      .catch(()=>{if(mounted.current)setIssue('暂时无法读取素材，请刷新重试。');})
      .finally(()=>{if(mounted.current)setLoading(false);});
    return()=>{mounted.current=false;currentRequest.current?.abort();};
  },[]);
  useEffect(()=>{
    if(job?.status!=='running')return;
    let disposed=false;let timer:ReturnType<typeof setTimeout>;
    const controller=new AbortController();currentRequest.current=controller;
    async function poll(){
      try{
        const next=await apiJson<ImportJob>(`/api/imports/${job!.id}`,{signal:controller.signal});
        if(disposed)return;
        if(next.status==='ready')await loadMaterials();
        if(disposed)return;
        setJob(next);setIssue(null);
        if(next.status==='running')timer=setTimeout(poll,1000);
      }catch(error){
        if(!disposed){
          if((error as {status?:number}).status===404){setJob(previous=>previous?{...previous,status:'failed',error:'导入已中断，请重新导入。'}:null);setIssue(null);}
          else{setIssue('连接中断，正在重试。');timer=setTimeout(poll,2500);}
        }
      }
    }
    timer=setTimeout(poll,600);
    return()=>{disposed=true;controller.abort();clearTimeout(timer);};
  },[job?.id,job?.status]);

  async function submit(event:React.FormEvent){
    event.preventDefault();if(!url.trim()||submitting||job?.status==='running')return;
    setSubmitting(true);setIssue(null);setJob(null);
    try{const next=await apiJson<ImportJob>('/api/imports',{method:'POST',body:JSON.stringify({url:url.trim()})});if(mounted.current)setJob(next);}
    catch(error){if(mounted.current)setIssue(error instanceof Error?error.message:'导入失败，请重试。');}
    finally{if(mounted.current)setSubmitting(false);}
  }
  const running=job?.status==='running';
  const ready=job?.status==='ready'?materials.find(material=>material.id===job.materialId):null;
  const visible=ready?materials.filter(material=>material.id!==ready.id):materials;

  function card(material:MaterialSummary,featured=false){return <article key={material.id} className={`material-card ${featured?'imported-card':''}`}>
    <button className="material-image" type="button" onClick={()=>onOpen(material.id)} disabled={opening} aria-label={`开始练习：${material.originalTitle}`}><img src={material.poster} alt="" loading="lazy"/><span>{duration(material.duration)}</span></button>
    <div className="material-details"><h2>{material.originalTitle}</h2><p>{material.speaker}<span> · </span>{material.groupCount} 段</p><button className={featured?'primary-button':'text-button'} type="button" disabled={opening} onClick={()=>onOpen(material.id)}>{opening?'正在打开…':'开始练习'} <span aria-hidden="true">→</span></button></div>
  </article>;}

  return <div className="practice-app library-app">
    <header className="site-header"><a className="wordmark" href="/">英语写作<span>练习</span></a><span className="library-header-label">素材</span></header>
    <main className="library-main">
      <section className="import-section" aria-labelledby="import-title"><h1 id="import-title">导入 TED</h1>
        <form className="import-form" onSubmit={event=>void submit(event)}><label className="sr-only" htmlFor="ted-url">TED 演讲链接</label><input id="ted-url" type="url" autoComplete="url" placeholder="https://www.ted.com/talks/…" required value={url} onChange={event=>setUrl(event.target.value)} disabled={running||submitting}/><button className="primary-button" type="submit" disabled={running||submitting||!url.trim()}>{submitting?'正在连接…':running?'导入中…':'导入'}</button></form>
        {running&&job&&<section className="import-progress" aria-label="导入进度"><div><strong>{job.title??'正在读取 TED 链接'}</strong><button className="text-button" type="button" onClick={()=>void apiJson<ImportJob>(`/api/imports/${job.id}/cancel`,{method:'POST',body:'{}'}).then(setJob).catch(()=>setIssue('取消失败，请重试。'))}>取消</button></div><progress max={1} value={job.progress}/><span role="status">{stages[job.stage]}{job.stage==='video'?` · ${Math.round(job.progress*100)}%`:''}</span></section>}
        {job?.status==='failed'&&<p className="notice" role="alert">{job.error??'导入失败，请重试。'}</p>}
        {issue&&<p className="notice" role="alert">{issue}</p>}
        {openIssue&&<p className="notice" role="alert">{openIssue}</p>}
      </section>
      {ready&&<section className="import-result" aria-label="导入完成"><p className="ready-label" role="status">已就绪</p>{card(ready,true)}</section>}
      <section className="material-library" aria-labelledby="materials-title"><div className="library-heading"><h2 id="materials-title">我的素材</h2><span>{materials.length||''}</span></div>
        {loading?<p className="library-loading" role="status">正在读取…</p>:<div className="material-grid">{visible.map(material=>card(material))}</div>}
      </section>
    </main>
  </div>;
}
