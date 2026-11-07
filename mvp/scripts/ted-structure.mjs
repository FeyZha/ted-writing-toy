import {parseClipVtt} from '../src/session.ts';
import {countEnglishWords,mergeShortSentences,mergeShortGroups} from '../src/practice-groups.ts';
import {pipelineRules} from '../src/pipeline-rules.ts';

export function canonicalTedUrl(input){
  let url;try{url=new URL(String(input).trim());}catch{throw Error('请粘贴完整的 TED 演讲链接。');}
  const match=url.pathname.match(/^\/talks\/(?:lang\/[a-z-]+\/)?([a-z0-9][a-z0-9_-]*)(?:\/transcript)?\/?$/i);
  if(!['http:','https:'].includes(url.protocol)||!['ted.com','www.ted.com'].includes(url.hostname)||url.username||url.password||url.port||!match)throw Error('目前只支持 ted.com/talks/ 下的单场演讲链接。');
  return `https://www.ted.com/talks/${match[1].toLowerCase()}`;
}
export function trustedTedResource(input){
  const url=new URL(input);
  if(url.protocol!=='https:'||url.username||url.password||url.port||!(['www.ted.com','ted.com','hls.ted.com','download.ted.com'].includes(url.hostname)||url.hostname.endsWith('.tedcdn.com')))throw Error('未找到可使用的 TED 官方资源。');
  return url.href;
}
export function readTedPage(html,sourceUrl){
  const match=html.match(/<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if(!match)throw Error('暂时无法读取这场演讲的信息，请稍后重试。');
  let data;try{data=JSON.parse(match[1]).props.pageProps.videoData;}catch{throw Error('TED 页面信息暂时无法解析。');}
  const player=data?.videoPlayerData??(typeof data?.playerData==='string'?JSON.parse(data.playerData):data?.playerData);
  if(!data?.id||!data?.title||!player)throw Error('这条链接没有可下载的演讲视频。');
  const spokenLanguage=player.nativeLanguage??data.audioInternalLanguageCode??data.internalLanguageCode??data.language;
  if(typeof spokenLanguage!=='string'||!/^en(?:-|$)/i.test(spokenLanguage))throw Error('目前只导入英文原声的 TED 演讲。');
  const hls=player.resources?.hls?.stream??data.hlsUrl;
  if(!hls)throw Error('这场演讲暂时没有支持的 TED 官方视频资源。');
  return {tedId:String(data.id),title:data.title,speaker:data.presenterDisplayName??player.speaker??'',event:player.event??(typeof data.videoContext==='string'?data.videoContext:data.videoContext?.name)??'',sourceUrl,
    masterUrl:trustedTedResource(hls),declaredDuration:Number(data.duration??player.duration),mediaProject:player.mediaProjectVersionIdentifier??null};
}
function attributes(line){
  const result={};for(const match of line.matchAll(/([A-Z0-9-]+)=(?:"([^"]*)"|([^,]*))/g))result[match[1]]=match[2]??match[3];return result;
}
export function readMasterPlaylist(raw,masterUrl){
  if(!raw.startsWith('#EXTM3U'))throw Error('TED 视频资源格式暂不支持。');
  const lines=raw.split(/\r?\n/),variants=[],media=[];
  for(let index=0;index<lines.length;index++){
    if(lines[index].startsWith('#EXT-X-STREAM-INF:')){
      const attr=attributes(lines[index]);const next=lines.slice(index+1).find(line=>line.trim()&&!line.startsWith('#'));
      if(next)variants.push({url:trustedTedResource(new URL(next.trim(),masterUrl).href),height:Number(attr.RESOLUTION?.split('x')[1]??0),bandwidth:Number(attr.BANDWIDTH??0),audio:attr.AUDIO});
    }else if(lines[index].startsWith('#EXT-X-MEDIA:'))media.push(attributes(lines[index]));
  }
  const candidates=variants.filter(variant=>variant.height>0&&variant.height<=480).sort((a,b)=>b.height-a.height||b.bandwidth-a.bandwidth);
  const video=candidates[0]??variants.filter(variant=>variant.height>0).sort((a,b)=>a.height-b.height||a.bandwidth-b.bandwidth)[0];
  if(!video)throw Error('没有找到可下载的视频画面。');
  const english=media.find(item=>item.TYPE==='SUBTITLES'&&/^en(?:-|$)/i.test(item.LANGUAGE??'')&&item.URI);
  if(!english)throw Error('这场演讲没有可用的官方英文字幕。');
  const subtitlePlaylist=trustedTedResource(new URL(english.URI,masterUrl).href);
  const subtitle=new URL(subtitlePlaylist);subtitle.pathname=subtitle.pathname.replace(/\/([^/]+)\.m3u8$/,'/$1/full.vtt');
  const audios=media.filter(item=>item.TYPE==='AUDIO'&&item['GROUP-ID']===video.audio&&item.URI&&(!item.LANGUAGE||/^en(?:-|$)/i.test(item.LANGUAGE)));
  const audio=audios.find(item=>item.DEFAULT==='YES')??audios[0];
  return {videoUrl:video.url,audioUrl:audio?trustedTedResource(new URL(audio.URI,masterUrl).href):null,subtitlePlaylist,subtitleUrl:trustedTedResource(subtitle.href),height:video.height};
}
export function validateMediaPlaylist(raw,url){
  if(!raw.startsWith('#EXTM3U')||!raw.includes('#EXT-X-ENDLIST'))throw Error('这场视频不是可离线下载的完整演讲。');
  for(const line of raw.split(/\r?\n/)){
    if(line.trim()&&!line.startsWith('#'))trustedTedResource(new URL(line.trim(),url).href);
    for(const match of line.matchAll(/\bURI="([^"]+)"/g))trustedTedResource(new URL(match[1],url).href);
  }
}

const stageDirections=/\((?:laughter|applause|music|cheering|audience laughs|audience applause|laughs|sighs|silence|inaudible)\)|\[(?:laughter|applause|music|cheering|silence|inaudible)\]/gi;
function speech(text){return text.replace(stageDirections,'').replace(/\s+/g,' ').trim();}
function terminal(text){
  const end=text.replace(/["'”’\])]+$/g,'').trim();
  if(/(?:\b(?:Mr|Mrs|Ms|Dr|Prof|St|Mt|vs|etc)|\b(?:e\.g|i\.e|U\.S|U\.K|Ph\.D|a\.m|p\.m)|\b[A-Z])\.$/i.test(end)||/\.{2,}$/.test(end))return false;
  return /[.!?]$/.test(end);
}
export function structureTedCaptions(raw,duration){
  if(!Number.isFinite(duration)||duration<=0||duration>pipelineRules.maximumDuration)throw Error('演讲时长暂不支持。');
  const cues=parseClipVtt(raw,0,86400).filter(cue=>speech(cue.text));
  if(cues.length===0)throw Error('英文字幕中没有可用于练习的内容。');
  let pending=null;const sentences=[];
  const finish=()=>{if(pending){sentences.push({...pending,id:`sentence-${String(sentences.length+1).padStart(4,'0')}`,wordCount:countEnglishWords(pending.text)});pending=null;}};
  for(const cue of cues){
    if(cue.end>duration+.1||cue.start<0||cue.end<=cue.start)throw Error('英文字幕与视频时间不匹配。');
    if(pending&&cue.start<pending.start-.001)throw Error('英文字幕的时间顺序异常。');
    const text=speech(cue.text);
    pending=pending?{...pending,end:Math.max(pending.end,cue.end),text:pending.text+' '+text}:{start:cue.start,end:cue.end,text};
    if(terminal(text))finish();
  }
  if(pending){
    const previous=sentences.pop();
    if(previous){sentences.push({...previous,end:pending.end,text:previous.text+' '+pending.text,wordCount:countEnglishWords(previous.text+' '+pending.text)});pending=null;}
    else finish();
  }
  if(!sentences.length||sentences.some(sentence=>sentence.wordCount<1)||sentences.length>5000)throw Error('无法整理成可练习的完整内容。');
  const previousGroups=mergeShortSentences(sentences.map(({id,start,end,wordCount})=>({id,start,end,wordCount})));
  const groups=mergeShortGroups(previousGroups);
  if(groups.some(group=>group.wordCount<pipelineRules.minimumWords))throw Error('这份字幕的信息量不足，无法整理成练习段。');
  if(groups.some(group=>group.end-group.start<pipelineRules.minimumSeconds))throw Error('这份素材不足 10 秒，无法整理成独立练习段。');
  const byId=new Map(sentences.map(sentence=>[sentence.id,sentence]));
  return {language:'en',minimumWords:pipelineRules.minimumWords,minimumSeconds:pipelineRules.minimumSeconds,segmentationVersion:pipelineRules.segmentationVersion,cues,sentences,previousGroups,groups:groups.map(group=>({...group,text:group.sentenceIds.map(id=>byId.get(id).text).join(' ')}))};
}
