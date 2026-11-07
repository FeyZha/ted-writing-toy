import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeShortGroups,mergeShortSentences,practiceGroups} from '../src/practice-groups.ts';
import {defaultMaterial,validMaterial} from '../src/material.ts';
import {answerSheetFor,answerSheetKey,editAnswer,loadSheet,storeSheet,freshSheet,validSheet} from '../src/answer-sheet.ts';
import {structureTedCaptions} from '../scripts/ted-structure.mjs';
import {sentences} from '../src/lesson-sentences.ts';

const groups=(durations:number[])=>{
  let start=0;return durations.map((duration,index)=>{const group={id:`s${index}`,start,end:start+duration,wordCount:12,sentenceIds:[`s${index}`]};start=group.end;return group;});
};
test('less than ten seconds merges forward repeatedly and a short final tail merges back',()=>{
  assert.deepEqual(mergeShortGroups(groups([4,3,6,12,2])).map(group=>group.sentenceIds),[['s0','s1','s2'],['s3','s4']]);
  assert.deepEqual(mergeShortGroups(groups([10,10])).map(group=>group.sentenceIds),[['s0'],['s1']]);
  assert.deepEqual(mergeShortGroups(groups([10,9.999])).map(group=>group.sentenceIds),[['s0','s1']]);
  assert.deepEqual(mergeShortGroups([]),[]);
});
test('word merging runs before duration merging, preserving whole existing groups and original pauses',()=>{
  const source=[{id:'a',start:0,end:3,wordCount:4},{id:'b',start:4,end:6,wordCount:7},{id:'c',start:7,end:12,wordCount:12}];
  const combined=mergeShortGroups(mergeShortSentences(source));
  assert.equal(combined.length,1);assert.equal(combined[0].start,0);assert.equal(combined[0].end,12);
  assert.deepEqual(combined[0].sentenceIds,['a','b','c']);assert.equal(combined[0].wordCount,23);
  assert.ok(defaultMaterial.groups.every(group=>group.end-group.start>=10&&group.wordCount>=10));assert.equal(validMaterial(defaultMaterial),true);
  assert.throws(()=>structureTedCaptions('WEBVTT\n\n00:00:00.000 --> 00:00:09.999\nOne two three four five six seven eight nine ten.\n',10),/不足 10 秒/);
});
test('duration migration keeps writing in order, preserves old storage and does not mark partially heard groups complete',()=>{
  const oldMaterial={...defaultMaterial,groups:practiceGroups,groupingVersion:undefined,previousGroups:undefined};
  const old=answerSheetFor(oldMaterial),records=new Map<string,string>(),storage={getItem:(key:string)=>records.get(key)??null,setItem:(key:string,value:string)=>{records.set(key,value);}};
  let sheet=old.freshSheet();
  sheet=editAnswer(old.completeSentence(sheet,0),0,'First old writing.');
  sheet=editAnswer(old.completeSentence(sheet,1),1,'Second old writing.');
  sheet=old.revealSentence(sheet,1,{sourceUrl:oldMaterial.referenceSourceUrl,retrievedAt:'now',cues:[{start:0,end:1,text:'Old reference.'}]});
  old.storeSheet(storage,sheet);const before=records.get(answerSheetKey(oldMaterial.id));
  const loaded=loadSheet(storage);assert.equal(loaded.blocked,false);assert.equal(loaded.sheet.version,3);assert.equal(validSheet(loaded.sheet),true);
  assert.equal(loaded.sheet.answers[0].text,'First old writing.');
  const index=defaultMaterial.groups.findIndex(group=>group.sentenceIds.includes(practiceGroups[1].sentenceIds[0]));
  assert.equal(loaded.sheet.activeIndex,index);assert.equal(loaded.sheet.answers[index].text,'Second old writing.');
  assert.equal(loaded.sheet.answers[index].heard,false);assert.equal(loaded.sheet.atBoundary,false);assert.equal(loaded.sheet.answers[index].reference,null);
  assert.equal(records.has(answerSheetKey(defaultMaterial.id,3)),false,'loading a migration is read-only');
  storeSheet(storage,loaded.sheet);assert.equal(records.get(answerSheetKey(defaultMaterial.id)),before);
  assert.deepEqual(loadSheet(storage).sheet.answers,loaded.sheet.answers);
  records.set(answerSheetKey(defaultMaterial.id,3),'{broken');assert.equal(loadSheet(storage).blocked,true);assert.equal(records.get(answerSheetKey(defaultMaterial.id,3)),'{broken');
});
test('completed merged groups carry all text once and retain the active position after the last constituent',()=>{
  const previous=groups([4,6,10]),material={...defaultMaterial,id:'ted-test-duration',duration:20,sourceStart:0,sourceEnd:20,sentences:previous,previousGroups:previous,groups:mergeShortGroups(previous)};
  const legacy={...material,groups:previous,previousGroups:undefined,groupingVersion:undefined};
  const old=answerSheetFor(legacy),records=new Map<string,string>(),storage={getItem:(key:string)=>records.get(key)??null,setItem:(key:string,value:string)=>{records.set(key,value);}};
  let sheet=old.freshSheet();for(let i=0;i<2;i++)sheet=editAnswer(old.completeSentence(sheet,i),i,`Part ${i+1}.`);old.storeSheet(storage,sheet);
  const loaded=loadSheet(storage,material).sheet;
  assert.equal(loaded.answers[0].text,'Part 1.\nPart 2.');assert.equal(loaded.answers[0].heard,true);assert.equal(loaded.atBoundary,true);assert.equal(loaded.activeIndex,0);
  const current=answerSheetFor(material);current.storeSheet(storage,editAnswer(loaded,0,'My combined summary.'));
  assert.equal(current.loadSheet(storage).sheet.answers[0].text,'My combined summary.');assert.equal(old.loadSheet(storage).sheet.answers[0].text,'Part 1.');
  assert.equal(freshSheet(material).answers.length,2);
});
test('the original v1 sentence layout migrates through the word layout without touching originals',()=>{
  const key=`english-writing-mvp:sentence-card:${defaultMaterial.id}:v1`;
  const old={version:1,lessonId:defaultMaterial.id,activeIndex:sentences.length-1,atBoundary:true,savedAt:'now',answers:sentences.map((sentence,index)=>({id:sentence.id,heard:true,text:`Original ${index+1}.`,initialText:null,reference:null}))};
  const raw=JSON.stringify(old),records=new Map([[key,raw]]),storage={getItem:(key:string)=>records.get(key)??null,setItem:(key:string,value:string)=>{records.set(key,value);}};
  const result=loadSheet(storage);assert.equal(result.blocked,false);assert.equal(result.sheet.version,3);assert.equal(result.sheet.atBoundary,true);
  assert.equal(result.sheet.activeIndex,defaultMaterial.groups.length-1);
  assert.equal(result.sheet.answers.map(answer=>answer.text).join('\n'),old.answers.map(answer=>answer.text).join('\n'));
  storeSheet(storage,result.sheet);assert.equal(records.get(key),raw);
});
