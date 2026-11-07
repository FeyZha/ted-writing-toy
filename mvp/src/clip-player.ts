import type {PracticeClip} from './material.ts';
import type {SentencePlayer,SentenceCallbacks} from './sentence-player.ts';

/** One prepared file per practice group; reaching EOF opens writing, never auto-plays the next. */
export function attachClipPlayer(video:HTMLVideoElement,clips:readonly PracticeClip[],callbacks:SentenceCallbacks,initialIndex=0,initialBoundary=false):SentencePlayer{
  let active=initialIndex,boundary=initialBoundary,disposed=false,generation=0;
  function playFile(){
    const current=generation;
    void video.play().catch((error:unknown)=>{
      if(!disposed&&current===generation&&!(error instanceof DOMException&&error.name==='AbortError'))callbacks.onError();
    });
  }
  function load(){
    generation++;video.pause();video.src=clips[active].video;video.load();
  }
  function move(index:number,autoplay:boolean){
    if(disposed||!clips[index])return;
    active=index;boundary=false;callbacks.onActive(active);load();
    if(autoplay)playFile();
  }
  function next(){if(active<clips.length-1&&callbacks.beforeAdvance()){move(active+1,true);return true;}return false;}
  function play(){
    if(disposed)return;
    if(boundary){if(active===clips.length-1){if(callbacks.beforeAdvance())move(active,true);}else next();}
    else playFile();
  }
  function onPlay(){
    if(boundary){video.pause();play();return;}
    callbacks.onPlaying(true);
  }
  function onEnded(){
    if(disposed||boundary||!video.ended)return;
    boundary=true;callbacks.onPlaying(false);callbacks.onBoundary(active);
  }
  function onMetadata(){if(boundary)video.currentTime=video.duration;}
  function onSeeked(){
    if(boundary&&!video.ended&&video.currentTime<video.duration-.05){boundary=false;callbacks.onActive(active);}
  }
  const handlers:{[event:string]:()=>void}={play:onPlay,pause:()=>callbacks.onPlaying(false),ended:onEnded,loadedmetadata:onMetadata,seeked:onSeeked};
  for(const [event,handler] of Object.entries(handlers))video.addEventListener(event,handler);
  load();
  return {play,replay:index=>move(index,true),select:index=>move(index,false),next:()=>{if(!disposed)next();},dispose(){
    disposed=true;generation++;for(const [event,handler] of Object.entries(handlers))video.removeEventListener(event,handler);video.pause();
  }};
}
