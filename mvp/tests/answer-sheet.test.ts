import test from 'node:test';
import assert from 'node:assert/strict';
import {ANSWER_SHEET_KEY,LEGACY_ANSWER_SHEET_KEY,completeSentence,editAnswer,freshSheet,loadSheet,revealSentence,storeSheet,validSheet} from './legacy-answer-sheet.ts';
import {sentences as originalSentences} from '../src/lesson-sentences.ts';
import {practiceGroups as sentences} from '../src/practice-groups.ts';
import {lesson} from '../src/lesson.ts';
const reference={sourceUrl:lesson.transcriptUrl,retrievedAt:'2026-11-07T00:00:00Z',cues:[{start:0,end:1.5,text:'Original test wording.'}]};

test('one card has one stable answer row for each merged practice group',()=>{
  const sheet=freshSheet();
  assert.equal(sheet.answers.length,12);
  assert.equal(validSheet(sheet),true);
  assert.ok(sentences.every((range,i)=>range.end>range.start&&(i===0||range.start>sentences[i-1].end)));
  assert.ok(sheet.answers.every((answer,i)=>answer.id===sentences[i].id&&!answer.heard&&answer.text===''));
});

function legacySheet(){
  return {version:1,lessonId:lesson.id,activeIndex:2,atBoundary:true,savedAt:'2026-11-07T00:00:00Z',
    answers:originalSentences.map((sentence,index)=>({id:sentence.id,heard:index<=2,text:`Old ${index+1}`,initialText:null as string|null,reference:null as typeof reference|null}))};
}
function memoryStorage(records=new Map<string,string>()){
  return {records,getItem:(key:string)=>records.get(key)??null,setItem:(key:string,value:string)=>{records.set(key,value);}};
}
test('migration joins the correct old rows, keeps originals and initial drafts, and never changes the old record',()=>{
  const old=legacySheet();old.answers[1].initialText='Before second revision';old.answers[1].reference=reference;
  const raw=JSON.stringify(old),storage=memoryStorage(new Map([[LEGACY_ANSWER_SHEET_KEY,raw]]));
  const {sheet,blocked}=loadSheet(storage);
  assert.equal(blocked,false);assert.equal(sheet.activeIndex,1);assert.equal(sheet.atBoundary,true);
  assert.equal(sheet.answers[0].text,'Old 1');assert.equal(sheet.answers[1].text,'Old 2\nOld 3');assert.equal(sheet.answers[2].text,'Old 4');
  assert.equal(sheet.answers[1].heard,true);
  assert.equal(sheet.answers[1].reference,null);assert.equal(sheet.answers[1].initialText,null);
  assert.deepEqual(sheet.answers[1].previousAnswers,old.answers.slice(1,3));
  assert.equal(storage.records.has(ANSWER_SHEET_KEY),false);
  storeSheet(storage,sheet);
  assert.equal(storage.records.get(LEGACY_ANSWER_SHEET_KEY),raw);
  assert.deepEqual(loadSheet(storage).sheet.answers,sheet.answers);
});
test('hearing only the short first sentence does not unlock or complete its merged group',()=>{
  const old=legacySheet();old.activeIndex=1;old.answers[2].heard=false;
  const loaded=loadSheet(memoryStorage(new Map([[LEGACY_ANSWER_SHEET_KEY,JSON.stringify(old)]])));
  assert.equal(loaded.blocked,false);assert.equal(loaded.sheet.activeIndex,1);assert.equal(loaded.sheet.atBoundary,false);
  assert.equal(loaded.sheet.answers[1].heard,false);assert.equal(loaded.sheet.answers[1].text,'Old 2\nOld 3');
  assert.throws(()=>editAnswer(loaded.sheet,1,'Not yet'),/Listen/);
});
test('unchanged sentence comparisons migrate with their own text and frozen draft',()=>{
  const old=legacySheet();old.activeIndex=3;old.answers[3].heard=true;
  old.answers[3].reference=reference;old.answers[3].initialText='Fourth initial';
  const loaded=loadSheet(memoryStorage(new Map([[LEGACY_ANSWER_SHEET_KEY,JSON.stringify(old)]])));
  assert.equal(loaded.sheet.activeIndex,2);assert.equal(loaded.sheet.atBoundary,true);
  assert.deepEqual(loaded.sheet.answers[2],old.answers[3]);
});
test('latest card takes priority and corrupt legacy data is preserved without writes',()=>{
  const storage=memoryStorage(new Map([[LEGACY_ANSWER_SHEET_KEY,'{broken']]));
  assert.equal(loadSheet(storage).blocked,true);assert.equal(storage.records.size,1);
  storeSheet(storage,freshSheet());
  assert.equal(loadSheet(storage).blocked,false);assert.equal(storage.records.get(LEGACY_ANSWER_SHEET_KEY),'{broken');
});
test('a sentence boundary unlocks only its own row and keeps neighbouring answers',()=>{
  let sheet=completeSentence(freshSheet(),0);
  sheet=editAnswer(sheet,0,'My first sentence.');
  sheet=completeSentence(sheet,1);
  assert.equal(sheet.activeIndex,1);assert.equal(sheet.atBoundary,true);
  assert.equal(sheet.answers[0].text,'My first sentence.');assert.equal(sheet.answers[1].heard,true);assert.equal(sheet.answers[2].heard,false);
  assert.throws(()=>editAnswer(sheet,2,'Too early.'),/Listen/);
});
test('comparison freezes each row independently and preserves revisions',()=>{
  let sheet=completeSentence(freshSheet(),0);
  sheet=editAnswer(sheet,0,'First initial.');sheet=revealSentence(sheet,0,reference);
  sheet=editAnswer(sheet,0,'First revision.');sheet=revealSentence(sheet,0,reference);
  sheet=completeSentence(sheet,1);sheet=editAnswer(sheet,1,'Second initial.');sheet=revealSentence(sheet,1,reference);
  assert.equal(sheet.answers[0].initialText,'First initial.');assert.equal(sheet.answers[0].text,'First revision.');assert.equal(sheet.answers[1].initialText,'Second initial.');
});
test('a blank initial line stays blank after later edits',()=>{
  let sheet=revealSentence(completeSentence(freshSheet(),0),0,reference);
  sheet=editAnswer(sheet,0,'A later thought.');
  assert.equal(revealSentence(sheet,0,reference).answers[0].initialText,'');
});
test('refresh restores active sentence, pause state, all rows and originals under a new key',()=>{
  const records=new Map<string,string>([['english-writing-mvp:thirty-days-01:v1','old draft'],['english-writing-mvp:thirty-days-01-meaning-01:v1','old unit draft']]);
  const storage={getItem:(key:string)=>records.get(key)??null,setItem:(key:string,value:string)=>{records.set(key,value);}};
  const sheet=revealSentence(editAnswer(completeSentence(freshSheet(),1),1,'Saved second row.'),1,reference);
  storeSheet(storage,sheet);
  const loaded=loadSheet(storage);
  assert.equal(loaded.blocked,false);assert.equal(loaded.sheet.activeIndex,1);assert.equal(loaded.sheet.atBoundary,true);
  assert.equal(loaded.sheet.answers[1].text,'Saved second row.');assert.deepEqual(loaded.sheet.answers[1].reference,reference);
  assert.equal(records.get('english-writing-mvp:thirty-days-01:v1'),'old draft');assert.equal(records.get('english-writing-mvp:thirty-days-01-meaning-01:v1'),'old unit draft');
  assert.ok(records.has(ANSWER_SHEET_KEY));
});
test('bad storage or a reference from outside the sentence cannot replace the card',()=>{
  let writes=0;
  const storage={getItem:()=>'{broken',setItem:()=>{writes++;}};
  assert.equal(loadSheet(storage).blocked,true);assert.equal(writes,0);
  assert.throws(()=>revealSentence(completeSentence(freshSheet(),1),1,{...reference,cues:[{start:0,end:12,text:'Outside.'}]}),/Invalid/);
  assert.throws(()=>storeSheet({getItem:()=>null,setItem:()=>{throw Error('Full');}},freshSheet()),/Full/);
});
