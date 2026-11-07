import {useEffect,useMemo,useRef,useState} from 'react';
import type {PracticeMaterial} from './material.ts';
import {answerSheetFor,editAnswer} from './answer-sheet.ts';
import type {AnswerSheet} from './answer-sheet.ts';
import {parseClipVtt} from './session.ts';
import {attachSentencePlayer} from './sentence-player.ts';
import type {SentencePlayer,SentenceCallbacks} from './sentence-player.ts';
import {attachClipPlayer} from './clip-player.ts';
import {sentenceJump} from './sentence-navigation.ts';
import type {SentenceJump} from './sentence-navigation.ts';

function time(seconds:number){return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;}

export default function PracticeWorkspace({material:lesson,onLibrary}:{material:PracticeMaterial;onLibrary:()=>void}){
  const {freshSheet,loadSheet,storeSheet,completeSentence,revealSentence}=useMemo(()=>answerSheetFor(lesson),[lesson]);
  const practiceGroups=lesson.groups;
  const practiceStarts=useMemo(()=>practiceGroups.map(group=>group.start),[practiceGroups]);
  const segmentNav=useRef<HTMLElement>(null);
  const [boot]=useState(()=>{
    try{return loadSheet(window.localStorage);}
    catch{return {sheet:freshSheet(),blocked:true,issue:'无法读取已保存的内容，请刷新重试。'};}
  });
  const [sheet,setSheet]=useState(boot.sheet);
  const latest=useRef(sheet);
  const [saveIssue,setSaveIssue]=useState<string|null>(boot.issue);
  const [operationIssue,setOperationIssue]=useState<string|null>(null);
  const [videoIssue,setVideoIssue]=useState(false);
  const [playing,setPlaying]=useState(false);
  const [loadingIndex,setLoadingIndex]=useState<number|null>(null);
  const [compareOpen,setCompareOpen]=useState(()=>boot.sheet.answers[boot.sheet.activeIndex].reference!==null);
  const video=useRef<HTMLVideoElement>(null);
  const editor=useRef<HTMLTextAreaElement>(null);
  const player=useRef<SentencePlayer|null>(null);
  const composing=useRef(false);
  const request=useRef<AbortController|null>(null);
  const requestGeneration=useRef(0);
  const fullVtt=useRef<string|null>(null);
  const lastJump=useRef<SentenceJump|null>(null);

  function commit(next:AnswerSheet,mustSave=false):boolean{
    try{
      if(boot.blocked)throw Error('Cannot read existing writing');
      const saved=storeSheet(window.localStorage,next);
      latest.current=saved;setSheet(saved);setSaveIssue(null);return true;
    }catch{
      if(!mustSave){latest.current=next;setSheet(next);}
      setSaveIssue(boot.blocked?boot.issue:'尚未保存。关闭页面前请先复制文字，再重试。');
      return false;
    }
  }
  function readyToMove(){
    if(composing.current){setOperationIssue('请先完成当前输入。');return false;}
    return commit(latest.current,true);
  }
  function leave(){if(readyToMove()){video.current?.pause();onLibrary();}}
  function cancelReference(){
    requestGeneration.current++;request.current?.abort();setLoadingIndex(null);
  }

  useEffect(()=>{
    const element=video.current;
    if(!element)return;
    const callbacks:SentenceCallbacks={
      onActive(index){
        cancelReference();setCompareOpen(false);
        commit({...latest.current,activeIndex:index,atBoundary:false});setOperationIssue(null);
      },
      onBoundary(index){commit(completeSentence(latest.current,index));},
      onPlaying:setPlaying,
      beforeAdvance:readyToMove,
      onError:()=>setVideoIssue(true),
    };
    player.current=lesson.clips?attachClipPlayer(element,lesson.clips,callbacks,boot.sheet.activeIndex,boot.sheet.atBoundary)
      :attachSentencePlayer(element,practiceGroups,callbacks,boot.sheet.activeIndex,boot.sheet.atBoundary);
    return ()=>{requestGeneration.current++;request.current?.abort();player.current?.dispose();player.current=null;};
  },[]);

  useEffect(()=>{
    const nav=segmentNav.current,selected=nav?.querySelector<HTMLElement>('[aria-current="step"]');
    if(!nav||!selected)return;
    const center=()=>nav.scrollTo({left:nav.scrollLeft+selected.getBoundingClientRect().left-nav.getBoundingClientRect().left-nav.clientWidth/2+selected.clientWidth/2,behavior:'auto'});
    center();const resize=new ResizeObserver(center);resize.observe(nav);
    return()=>resize.disconnect();
  },[sheet.activeIndex]);

  useEffect(()=>{
    if(sheet.atBoundary&&!composing.current)editor.current?.focus({preventScroll:true});
  },[sheet.activeIndex,sheet.atBoundary]);

  useEffect(()=>{
    function onArrow(event:KeyboardEvent){
      if(!['ArrowLeft','ArrowRight'].includes(event.key)||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||event.isComposing)return;
      const element=video.current;
      if(!element)return;
      const editing=(target:EventTarget|null)=>target instanceof Element&&!!target.closest('textarea,input,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]');
      if(!event.composedPath().includes(element)&&(editing(event.target)||editing(document.activeElement)))return;
      event.preventDefault();event.stopPropagation();
      if(event.repeat||(!lesson.clips&&element.readyState<1)||!readyToMove())return;
      const range=practiceGroups[latest.current.activeIndex];
      const position=lesson.clips?range.start+Math.min(element.currentTime,range.end-range.start-.002):element.currentTime;
      const jump=sentenceJump(practiceStarts,position,event.key==='ArrowLeft'?'previous':'next',lastJump.current,performance.now());
      if(jump){lastJump.current=jump;player.current?.replay(jump.index);}
    }
    window.addEventListener('keydown',onArrow,true);
    return ()=>window.removeEventListener('keydown',onArrow,true);
  },[]);

  function replay(){
    if(!readyToMove())return;
    lastJump.current=null;player.current?.replay(latest.current.activeIndex);
  }
  function select(index:number){
    if(index===latest.current.activeIndex||!readyToMove())return;
    lastJump.current=null;player.current?.select(index);
  }
  async function reveal(){
    const index=latest.current.activeIndex,answer=latest.current.answers[index];
    if(!answer.heard||loadingIndex!==null)return;
    if(composing.current){setOperationIssue('请先完成当前输入。');return;}
    video.current?.pause();
    if(answer.reference){setCompareOpen(true);return;}
    setLoadingIndex(index);setOperationIssue(null);
    const generation=++requestGeneration.current;
    try{
      let raw=fullVtt.current;
      if(raw===null){
        const controller=new AbortController();request.current=controller;
        const timeout=window.setTimeout(()=>controller.abort(),15000);
        try{
          const response=await fetch(lesson.transcriptUrl,{signal:controller.signal});
          if(!response.ok)throw Error('Cannot read official captions');
          raw=await response.text();
          if(generation===requestGeneration.current)fullVtt.current=raw;
        }finally{window.clearTimeout(timeout);if(request.current===controller)request.current=null;}
      }
      if(generation!==requestGeneration.current)return;
      const range=practiceGroups[index];
      const reference={sourceUrl:lesson.referenceSourceUrl,retrievedAt:new Date().toISOString(),cues:parseClipVtt(raw,lesson.sourceStart+range.start,lesson.sourceStart+range.end)};
      if(commit(revealSentence(latest.current,index,reference),true))setCompareOpen(true);
    }catch{
      if(generation===requestGeneration.current)setOperationIssue('原文读取失败，请重试。');
    }finally{if(generation===requestGeneration.current)setLoadingIndex(null);}
  }

  const active=sheet.activeIndex,answer=sheet.answers[active],range=practiceGroups[active];
  const originalOpen=compareOpen&&answer.reference!==null;
  const step=playing||!answer.heard?0:originalOpen?2:1;
  const atLast=active===practiceGroups.length-1;
  const primaryLabel=loadingIndex!==null?'正在读取…':playing?'暂停播放':!answer.heard?'播放这一段':!originalOpen?'对照原文':atLast?'已到最后一段':'下一段';
  function primaryAction(){
    if(playing){video.current?.pause();return;}
    if(!answer.heard){player.current?.play();return;}
    if(!originalOpen){void reveal();return;}
    player.current?.next();
  }

  return <div className="practice-app">
    <header className="site-header">
      <a className="wordmark" href="/" onClick={event=>{event.preventDefault();leave();}} aria-label="返回素材">英语写作<span>练习</span></a>
      <div className="header-actions"><button className="text-button" type="button" onClick={leave}>素材</button><a className="source-link" href={lesson.sourceUrl} target="_blank" rel="noreferrer">TED 原视频 <span aria-hidden="true">↗</span></a></div>
    </header>
    <main className="study-layout" aria-label="视频与写作工作区">
      <section className="watch-column" aria-labelledby="lesson-title">
        <div className="video-stage"><video ref={video} src={lesson.clips?undefined:lesson.video} poster={lesson.poster} controls playsInline preload="auto" aria-label={`${lesson.originalTitle}，英文视频`} aria-describedby="video-shortcuts" onPointerDown={()=>{lastJump.current=null;}} onError={()=>setVideoIssue(true)} onCanPlay={()=>setVideoIssue(false)}/></div>
        <div className="playback-toolbar">
          <button className="replay-button" type="button" onClick={replay} title="← 重听本段，连按回到上一段"><span aria-hidden="true">↺</span> 重听</button>
          <span className="range-time">{time(range.start)} — {time(range.end)}</span>
          <span className="playback-state" role="status">{playing?'播放中':sheet.atBoundary?'已暂停':''}</span>
        </div>
        <nav className="segment-navigation" ref={segmentNav} aria-label="段落进度" style={{gridTemplateColumns:`repeat(${practiceGroups.length},minmax(28px,1fr))`}}>
          {practiceGroups.map((group,index)=><button key={group.id} type="button" className={`segment-button ${sheet.answers[index].text.trim()?'written':''} ${index===active?'current':''}`} aria-label={`第 ${index+1} 段，${sheet.answers[index].text.trim()?'已写':sheet.answers[index].heard?'已听':'未听'}`} aria-current={index===active?'step':undefined} title={`第 ${index+1} 段 · ${time(group.start)}–${time(group.end)}`} onClick={()=>select(index)}><span>{String(index+1).padStart(2,'0')}</span><i/></button>)}
        </nav>
        <div className="lesson-heading"><h1 id="lesson-title">{lesson.originalTitle}</h1><p>{lesson.speaker}<span aria-hidden="true"> · </span>{lesson.event}</p></div>
        <p id="video-shortcuts" className="sr-only">左方向键重听当前段，连按退到上一段；右方向键播放下一段。写作框内的方向键移动光标。</p>
        {videoIssue&&<div className="notice" role="alert">视频加载失败。<button type="button" onClick={()=>{setVideoIssue(false);video.current?.load();}}>重试</button></div>}
      </section>

      <section className="writing-workspace" aria-labelledby="writing-title" data-active-index={active}>
        <div className="workspace-topline"><span className="segment-count"><strong>{String(active+1).padStart(2,'0')}</strong><span>/ {practiceGroups.length}</span></span><span className={`save-state ${saveIssue?'failed':''}`} role="status" title="保存在当前浏览器">{saveIssue?'未保存':sheet.savedAt?'已保存':''}</span></div>
        <ol className="flow-state" aria-label="练习进度">{['听','写','对照'].map((title,index)=><li key={title} className={step===index?'active':''} aria-current={step===index?'step':undefined}>{title}{index<2&&<span aria-hidden="true">/</span>}</li>)}</ol>
        <div className="current-writing" key={answer.id}>
          <h2 id="writing-title"><label htmlFor="summary">用一句话概括</label></h2>
          <textarea id="summary" ref={editor} rows={4} value={answer.text} disabled={!answer.heard||playing} spellCheck lang="en" aria-label={`第 ${active+1} 段的概括`} placeholder={answer.heard?'用自己的英文，写出这一段的意思。':'听完这一段，再写。'} onFocus={()=>video.current?.pause()} onChange={event=>commit(editAnswer(latest.current,latest.current.activeIndex,event.target.value))} onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={event=>{composing.current=false;commit(editAnswer(latest.current,latest.current.activeIndex,event.currentTarget.value));}}/>
          {originalOpen&&answer.reference&&<section className="original-text" aria-labelledby="original-title"><div className="original-heading"><h3 id="original-title">原文</h3><button className="text-button" type="button" onClick={()=>setCompareOpen(false)}>收起</button></div><p lang="en">{answer.reference.cues.map(cue=>cue.text).join(' ')}</p></section>}
        </div>
        {saveIssue&&<div className="notice" role="alert"><p>{saveIssue}</p><button type="button" onClick={()=>commit(latest.current,true)}>重试保存</button></div>}
        {operationIssue&&<p className="notice" role="alert">{operationIssue}</p>}
        <div className="task-actions">
          <button className="text-button previous-button" type="button" disabled={active===0||loadingIndex!==null} onClick={()=>select(active-1)}><span aria-hidden="true">←</span> 上一段</button>
          <button className="primary-button" type="button" disabled={loadingIndex!==null||(originalOpen&&atLast&&!playing)} onClick={primaryAction}>{primaryLabel}{originalOpen&&!atLast&&<span aria-hidden="true">→</span>}</button>
        </div>
        {answer.heard&&!originalOpen&&!playing&&!atLast&&<button className="text-button skip-compare" type="button" disabled={loadingIndex!==null} onClick={()=>player.current?.next()}>下一段 <span aria-hidden="true">→</span></button>}
      </section>
    </main>
  </div>;
}
