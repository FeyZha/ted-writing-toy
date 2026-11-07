import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalTedUrl,readTedPage,readMasterPlaylist,validateMediaPlaylist,structureTedCaptions,trustedTedResource} from '../scripts/ted-structure.mjs';
import {localPlaylist} from '../scripts/ted-download.mjs';
import {answerSheetFor,editAnswer,validSheet} from '../src/answer-sheet.ts';
import {defaultMaterial,validMaterial} from '../src/material.ts';

test('TED links normalize tracking and language routes while arbitrary hosts and credentials are rejected',()=>{
  assert.equal(canonicalTedUrl('http://ted.com/talks/lang/en/a_real_talk/transcript?language=zh-cn#t-20'),'https://www.ted.com/talks/a_real_talk');
  for(const url of ['https://www.ted.com.evil.example/talks/x','https://www.ted.com@127.0.0.1/talks/x','file:///talks/x','https://www.ted.com:444/talks/x','https://www.ted.com/playlists/1','https://www.ted.com/talks/../../etc'])assert.throws(()=>canonicalTedUrl(url));
  assert.throws(()=>trustedTedResource('https://localhost/private'));assert.throws(()=>trustedTedResource('http://hls.ted.com/anything'));
});
test('page parsing requires original English and a native TED video stream',()=>{
  const data={id:'12',title:'A talk',language:'en',duration:120,videoPlayerData:{nativeLanguage:'en',resources:{hls:{stream:'https://hls.ted.com/project_masters/12/manifest.m3u8'}}}};
  const html=(value:unknown)=>`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({props:{pageProps:{videoData:value}}})}</script>`;
  assert.equal(readTedPage(html(data),'https://www.ted.com/talks/a_talk').tedId,'12');
  assert.throws(()=>readTedPage(html({...data,videoPlayerData:{...data.videoPlayerData,nativeLanguage:'es'}}),'x'),/英文原声/);
  assert.throws(()=>readTedPage(html({...data,videoPlayerData:{nativeLanguage:'en',external:{service:'YouTube'}}}),'x'),/官方视频/);
});
test('manifest selection uses at most 480p, English captions and matching default audio',()=>{
  const raw=`#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,AUDIO="a"\n720.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=854x480,AUDIO="a"\n480.m3u8\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",LANGUAGE="en",DEFAULT=YES,URI="audio.m3u8"\n#EXT-X-MEDIA:TYPE=SUBTITLES,LANGUAGE="en",URI="/project_masters/12/subtitles/en.m3u8?intro_master_id=2"`;
  const result=readMasterPlaylist(raw,'https://hls.ted.com/project_masters/12/manifest.m3u8');
  assert.equal(result.height,480);assert.match(result.videoUrl,/480.m3u8$/);assert.match(result.audioUrl,/audio.m3u8$/);assert.match(result.subtitleUrl,/\/en\/full.vtt\?intro_master_id=2$/);
  assert.throws(()=>readMasterPlaylist(raw.replace('TYPE=SUBTITLES,LANGUAGE="en"','TYPE=SUBTITLES,LANGUAGE="fr"'),'https://hls.ted.com/test'),/英文字幕/);
});
const vtt=`WEBVTT\n\n00:00:00.000 --> 00:00:04.000\nA simple idea.\n\n00:00:04.500 --> 00:00:06.500\nWe can choose one new thing and try it together.\n\n00:00:07.000 --> 00:00:08.000\n(Laughter)\n\n00:00:09.000 --> 00:00:11.000\nA second complete thought contains ten different useful English words.\n`;
test('whole caption sentences merge forward, retain their gaps and exclude standalone stage directions',()=>{
  const structure=structureTedCaptions(vtt,15);
  assert.equal(structure.sentences.length,3);assert.equal(structure.groups.length,1);
  assert.equal(structure.groups[0].start,0);assert.equal(structure.groups[0].end,11);
  assert.equal(structure.previousGroups.length,2);assert.ok(structure.groups[0].text.includes('A simple idea. We can choose one new thing and try it together.'));
  assert.ok(structure.cues.every(cue=>!cue.text.includes('Laughter')));
  assert.throws(()=>structureTedCaptions(vtt,5),/时间不匹配/);
  assert.throws(()=>structureTedCaptions('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nOnly three words.\n',3),/信息量不足/);
});
test('abbreviations and unfinished final text are kept with adjacent complete content',()=>{
  const raw=`WEBVTT\n\n00:00:00.000 --> 00:00:04.000\nWe met Dr.\n\n00:00:04.000 --> 00:00:12.000\nSmith and learned ten new things about his work today.\n\n00:00:12.000 --> 00:00:15.000\nOne last unfinished thought\n`;
  const result=structureTedCaptions(raw,18);assert.equal(result.sentences.length,1);assert.equal(result.groups[0].end,15);assert.match(result.groups[0].text,/Dr. Smith/);
});
test('localized media playlists keep maps and byteranges and reject non-TED resources',()=>{
  const raw='#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:5,\npart.m4s\n#EXT-X-BYTERANGE:10@2\npart.m4s\n#EXT-X-ENDLIST\n';
  const value=localPlaylist(raw,'https://hls.ted.com/project_masters/12/video.m3u8','video');
  assert.equal(value.entries.length,2);assert.match(value.text,/video-00000.mp4/);assert.match(value.text,/#EXT-X-BYTERANGE:10@2/);
  assert.throws(()=>validateMediaPlaylist(raw.replace('part.m4s','http://127.0.0.1/secret'),'https://hls.ted.com/a.m3u8'));
  assert.throws(()=>validateMediaPlaylist(raw.replace('#EXT-X-ENDLIST',''),'https://hls.ted.com/a.m3u8'),/完整演讲/);
});
test('material-specific drafts and references cannot cross between two TED videos',()=>{
  const material={...defaultMaterial,id:'ted-12-abc',transcriptUrl:'/media/ted-12-abc/source.en.vtt',referenceSourceUrl:'https://hls.ted.com/project_masters/12/subtitles/en/full.vtt'};
  assert.equal(validMaterial(material),true);
  const records=new Map<string,string>();const storage={getItem:(key:string)=>records.get(key)??null,setItem:(key:string,value:string)=>{records.set(key,value);}};
  const first=answerSheetFor(defaultMaterial),second=answerSheetFor(material);
  first.storeSheet(storage,editAnswer(first.completeSentence(first.freshSheet(),0),0,'First video.'));
  second.storeSheet(storage,editAnswer(second.completeSentence(second.freshSheet(),0),0,'Second video.'));
  assert.equal(first.loadSheet(storage).sheet.answers[0].text,'First video.');assert.equal(second.loadSheet(storage).sheet.answers[0].text,'Second video.');
  assert.equal(validSheet(second.loadSheet(storage).sheet,defaultMaterial),false);
  assert.throws(()=>second.revealSentence(second.loadSheet(storage).sheet,0,{sourceUrl:defaultMaterial.referenceSourceUrl,retrievedAt:'now',cues:[{start:0,end:1,text:'Wrong source.'}]}),/Invalid/);
});
