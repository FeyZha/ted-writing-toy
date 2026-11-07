import type {SentenceRange} from './lesson-sentences.ts';

export type SentenceCallbacks = {
  onActive:(index:number)=>void;
  onBoundary:(index:number)=>void;
  onPlaying:(playing:boolean)=>void;
  beforeAdvance:()=>boolean;
  onError:()=>void;
};
export type SentencePlayer = {play:()=>void; replay:(index:number)=>void; next:()=>void; select:(index:number)=>void; dispose:()=>void};

/** Native hidden metadata cues pause playback; the timer is a foreground fallback. */
export function attachSentencePlayer(video:HTMLVideoElement,ranges:readonly SentenceRange[],callbacks:SentenceCallbacks,initialIndex=0,initialBoundary=false):SentencePlayer {
  let active=initialIndex;
  let boundary=initialBoundary;
  let internalSeek=false;
  let disposed=false;
  let timer:ReturnType<typeof setTimeout>|undefined;
  const track=[...video.textTracks].find(item=>item.kind==='metadata'&&item.label==='练习句界')??video.addTextTrack('metadata','练习句界','en');
  track.mode='hidden';
  for(const cue of [...(track.cues??[])])track.removeCue(cue);
  const cues=ranges.map((range,index)=>{
    const cue=new VTTCue(range.start,range.end,'');
    cue.id=range.id;
    cue.pauseOnExit=index===active&&!boundary;
    cue.onexit=()=>{if(!video.seeking&&index===active&&video.currentTime>=range.end-0.01&&video.currentTime<range.end+0.5)finish();};
    track.addCue(cue);
    return cue;
  });

  function seek(time:number){
    if(Math.abs(video.currentTime-time)<0.001)return;
    internalSeek=true;
    video.currentTime=time;
  }
  function finish(){
    if(disposed||boundary)return;
    boundary=true;
    cues[active].pauseOnExit=false;
    video.pause();
    seek(ranges[active].end);
    callbacks.onPlaying(false);
    callbacks.onBoundary(active);
  }
  function check(){if(!video.paused&&!video.seeking&&video.currentTime>=ranges[active].end)finish();}
  function arm(){
    clearTimeout(timer);
    if(disposed||video.paused||video.seeking)return;
    timer=setTimeout(()=>{check();arm();},Math.max(8,Math.min(100,(ranges[active].end-video.currentTime)/video.playbackRate*1000)));
  }
  function move(index:number,fromStart:boolean){
    active=index;boundary=false;
    cues.forEach((cue,i)=>{cue.pauseOnExit=i===active;});
    callbacks.onActive(active);
    if(fromStart)seek(ranges[active].start);
  }
  function play(){
    if(disposed)return;
    void video.play().catch((error:unknown)=>{if(!(error instanceof DOMException&&error.name==='AbortError'))callbacks.onError();});
  }
  function advance(){
    if(active>=ranges.length-1||!callbacks.beforeAdvance())return false;
    move(active+1,true);
    return true;
  }
  function onPlay(){
    if(boundary){
      if(active===ranges.length-1)move(active,true);
      else if(!advance()){video.pause();return;}
    }
    callbacks.onPlaying(true);arm();
  }
  function onPause(){
    clearTimeout(timer);callbacks.onPlaying(false);
    if(!video.seeking&&video.currentTime>=ranges[active].end-0.01&&video.currentTime<ranges[active].end+0.5)finish();
  }
  function onSeeked(){
    if(internalSeek)internalSeek=false;
    else {
      let index=0;
      for(let i=1;i<ranges.length&&ranges[i].start<=video.currentTime;i++)index=i;
      move(index,false);
    }
    check();arm();
  }
  function onTime(){check();}
  function onMetadata(){seek(boundary?ranges[active].end:ranges[active].start);}
  function onEnded(){finish();}
  const handlers:{[event:string]:()=>void}={play:onPlay,pause:onPause,seeked:onSeeked,timeupdate:onTime,ratechange:arm,loadedmetadata:onMetadata,ended:onEnded};
  for(const [event,handler] of Object.entries(handlers))video.addEventListener(event,handler);
  if(video.readyState>=1)onMetadata();
  return {
    play,
    replay(index){if(!ranges[index]||disposed)return;video.pause();move(index,true);play();},
    next(){if(disposed)return;video.pause();if(advance())play();},
    select(index){if(!ranges[index]||disposed)return;video.pause();move(index,true);},
    dispose(){disposed=true;clearTimeout(timer);for(const [event,handler] of Object.entries(handlers))video.removeEventListener(event,handler);for(const cue of cues){cue.onexit=null;cue.pauseOnExit=false;if(cue.track===track)track.removeCue(cue);}video.pause();},
  };
}
