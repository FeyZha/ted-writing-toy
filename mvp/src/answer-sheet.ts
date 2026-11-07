import {lesson} from './lesson.ts';
import {sentences} from './lesson-sentences.ts';
import type {SentenceRange} from './lesson-sentences.ts';
import {practiceGroups} from './practice-groups.ts';
import {validReference} from './session.ts';
import type {Reference, StoragePort} from './session.ts';
import {defaultMaterial} from './material.ts';
import type {PracticeMaterial} from './material.ts';
import {pipelineRules} from './pipeline-rules.ts';

type SentenceAnswer = {id:string; heard:boolean; text:string; initialText:string|null; reference:Reference|null};
export type Answer = SentenceAnswer & {previousAnswers?:SentenceAnswer[]};
export type AnswerSheet = {version:2|3; lessonId:string; activeIndex:number; atBoundary:boolean; answers:Answer[]; savedAt:string|null};
type LegacySheet = Omit<AnswerSheet,'version'|'answers'> & {version:1; answers:SentenceAnswer[]};
export const LEGACY_ANSWER_SHEET_KEY = `english-writing-mvp:sentence-card:${lesson.id}:v1`;
export const PREVIOUS_ANSWER_SHEET_KEY = `english-writing-mvp:sentence-card:${lesson.id}:v2`;
export const ANSWER_SHEET_KEY = `english-writing-mvp:sentence-card:${lesson.id}:v3`;
export const answerSheetKey=(lessonId:string,version:2|3=2)=>`english-writing-mvp:sentence-card:${lessonId}:v${version}`;
const sheetVersion=(material:PracticeMaterial)=>material.groupingVersion===pipelineRules.groupingVersion?3:2;

export function freshSheet(material=defaultMaterial): AnswerSheet {
  return {version:sheetVersion(material),lessonId:material.id,activeIndex:0,atBoundary:false,answers:material.groups.map(group=>({id:group.id,heard:false,text:'',initialText:null,reference:null})),savedAt:null};
}
function validAnswer(answer:SentenceAnswer,range:SentenceRange,material=defaultMaterial):boolean {
  return !!answer&&answer.id===range.id&&typeof answer.heard==='boolean'&&typeof answer.text==='string'
    &&(answer.initialText===null||typeof answer.initialText==='string')&&(answer.reference===null)===(answer.initialText===null)
    &&(answer.reference===null||(answer.heard&&validReference(answer.reference,range.end-range.start+0.01)&&answer.reference.sourceUrl===material.referenceSourceUrl
      &&answer.reference.cues.every(cue=>cue.end<=range.end-range.start+0.01)));
}
function validShape(value:unknown,version:number,ranges:readonly SentenceRange[],material=defaultMaterial):boolean {
  if(typeof value!=='object'||value===null)return false;
  const sheet=value as AnswerSheet|LegacySheet;
  return sheet.version===version&&sheet.lessonId===material.id&&Number.isInteger(sheet.activeIndex)&&sheet.activeIndex>=0&&sheet.activeIndex<ranges.length
    &&typeof sheet.atBoundary==='boolean'&&(sheet.savedAt===null||typeof sheet.savedAt==='string')&&Array.isArray(sheet.answers)&&sheet.answers.length===ranges.length
    &&sheet.answers.every((answer,index)=>validAnswer(answer,ranges[index],material))&&(!sheet.atBoundary||sheet.answers[sheet.activeIndex].heard);
}
export function validSheet(value:unknown,material=defaultMaterial):value is AnswerSheet {
  if(!validShape(value,sheetVersion(material),material.groups,material))return false;
  return (value as AnswerSheet).answers.every((answer,index)=>{
    if(answer.previousAnswers===undefined)return true;
    const ids=material.groups[index].sentenceIds;
    return ids.length>1&&Array.isArray(answer.previousAnswers)&&answer.previousAnswers.length===ids.length
      &&answer.previousAnswers.every((previous,i)=>{const range=material.sentences.find(sentence=>sentence.id===ids[i]);return !!range&&validAnswer(previous,range,material);});
  });
}
function migrateSheet(old:LegacySheet):AnswerSheet {
  const activeId=sentences[old.activeIndex].id;
  const activeIndex=practiceGroups.findIndex(group=>group.sentenceIds.includes(activeId));
  const answers=practiceGroups.map(group=>{
    const parts=group.sentenceIds.map(id=>old.answers.find(answer=>answer.id===id)!);
    if(parts.length===1)return {...parts[0],id:group.id};
    const hasDraft=parts.some(part=>part.text!==''||part.initialText!==null);
    return {id:group.id,heard:parts.every(part=>part.heard),text:parts.map(part=>part.text).filter(text=>text!=='').join('\n'),
      initialText:null,reference:null,...(hasDraft?{previousAnswers:parts.map(part=>({...part}))}:{})};
  });
  const group=practiceGroups[activeIndex];
  return {version:2,lessonId:lesson.id,activeIndex,answers,savedAt:old.savedAt,
    atBoundary:old.atBoundary&&answers[activeIndex].heard&&group.sentenceIds.at(-1)===activeId};
}
/** Fold complete old groups into the new duration groups without rewriting old storage. */
export function migrateDurationSheet(old:AnswerSheet,material:PracticeMaterial):AnswerSheet{
  const previous=material.previousGroups;
  if(!previous||!validShape(old,2,previous,material))throw Error('Invalid previous grouping');
  const previousById=new Map(previous.map((group,index)=>[group.sentenceIds[0],{group,answer:old.answers[index],index}]));
  const groups=material.groups,activeSentence=previous[old.activeIndex].sentenceIds[0];
  const activeIndex=groups.findIndex(group=>group.sentenceIds.includes(activeSentence));
  if(activeIndex<0)throw Error('Missing active group');
  const answers=groups.map(group=>{
    const parts=group.sentenceIds.map(id=>previousById.get(id)).filter(part=>part!==undefined);
    if(!parts.length||JSON.stringify(parts.flatMap(part=>part.group.sentenceIds))!==JSON.stringify(group.sentenceIds))throw Error('Cannot split previous writing');
    if(parts.length===1&&parts[0].group.id===group.id)return {...parts[0].answer};
    return {id:group.id,heard:parts.every(part=>part.answer.heard),text:parts.map(part=>part.answer.text).filter(text=>text!=='').join('\n'),initialText:null,reference:null};
  });
  const activeParts=previous.filter(group=>groups[activeIndex].sentenceIds.includes(group.sentenceIds[0]));
  const sheet:AnswerSheet={version:3,lessonId:material.id,answers,activeIndex,savedAt:old.savedAt,
    atBoundary:old.atBoundary&&answers[activeIndex].heard&&activeParts.at(-1)?.id===previous[old.activeIndex].id};
  if(!validSheet(sheet,material))throw Error('Invalid migrated writing');
  return sheet;
}
export function loadSheet(storage: StoragePort,material=defaultMaterial): {sheet:AnswerSheet; blocked:boolean; issue:string|null} {
  try {
    const version=sheetVersion(material),raw=storage.getItem(answerSheetKey(material.id,version));
    if(raw!==null){
      const sheet:unknown=JSON.parse(raw);
      if(!validSheet(sheet,material))throw Error('Invalid answer sheet');
      return {sheet,blocked:false,issue:null};
    }
    if(version===3){
      const previousRaw=storage.getItem(answerSheetKey(material.id,2));
      if(previousRaw!==null)return {sheet:migrateDurationSheet(JSON.parse(previousRaw),material),blocked:false,issue:null};
    }
    const legacyRaw=material.id===defaultMaterial.id?storage.getItem(LEGACY_ANSWER_SHEET_KEY):null;
    if(legacyRaw===null)return {sheet:freshSheet(material),blocked:false,issue:null};
    const old:unknown=JSON.parse(legacyRaw);
    if(!validShape(old,1,sentences))throw Error('Invalid legacy answer sheet');
    const wordSheet=migrateSheet(old as LegacySheet);
    const sheet=version===3?migrateDurationSheet(wordSheet,material):wordSheet;
    if(!validSheet(sheet,material))throw Error('Invalid migration');
    // Read-only migration: keep the original record intact; future saves use v2.
    return {sheet,blocked:false,issue:null};
  } catch {
    return {sheet:freshSheet(material),blocked:true,issue:'无法读取已保存的内容，原记录未被覆盖。请保留当前文字后刷新重试。'};
  }
}
export function storeSheet(storage: StoragePort,sheet:AnswerSheet,now=new Date().toISOString(),material=defaultMaterial):AnswerSheet {
  const saved={...sheet,savedAt:now};
  if(!validSheet(saved,material))throw Error('Invalid answer sheet');
  storage.setItem(answerSheetKey(material.id,sheetVersion(material)),JSON.stringify(saved));
  return saved;
}
export function completeSentence(sheet:AnswerSheet,index:number,material=defaultMaterial):AnswerSheet {
  if(!material.groups[index])throw Error('Invalid practice group');
  return {...sheet,activeIndex:index,atBoundary:true,answers:sheet.answers.map((answer,i)=>i===index?{...answer,heard:true}:answer)};
}
export function editAnswer(sheet:AnswerSheet,index:number,text:string):AnswerSheet {
  if(!sheet.answers[index]?.heard)throw Error('Listen before writing');
  return {...sheet,answers:sheet.answers.map((answer,i)=>i===index?{...answer,text}:answer)};
}
export function revealSentence(sheet:AnswerSheet,index:number,reference:Reference,material=defaultMaterial):AnswerSheet {
  const answer=sheet.answers[index];
  if(!answer?.heard)throw Error('Listen before comparing');
  const next={...sheet,answers:sheet.answers.map((item,i)=>i===index?{...item,initialText:item.reference===null?item.text:item.initialText,reference:item.reference??reference}:item)};
  if(!validSheet(next,material))throw Error('Invalid sentence reference');
  return next;
}

export function answerSheetFor(material:PracticeMaterial){
  return {
    freshSheet:()=>freshSheet(material),loadSheet:(storage:StoragePort)=>loadSheet(storage,material),
    storeSheet:(storage:StoragePort,sheet:AnswerSheet)=>storeSheet(storage,sheet,undefined,material),
    completeSentence:(sheet:AnswerSheet,index:number)=>completeSentence(sheet,index,material),
    revealSentence:(sheet:AnswerSheet,index:number,reference:Reference)=>revealSentence(sheet,index,reference,material),
  };
}
