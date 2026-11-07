import {lesson} from './lesson.ts';
import {sentences} from './lesson-sentences.ts';
import {practiceGroups,mergeShortGroups} from './practice-groups.ts';
import type {PracticeGroup} from './practice-groups.ts';
import type {SentenceRange} from './lesson-sentences.ts';
import {pipelineRules} from './pipeline-rules.ts';

export type PracticeClip={groupId:string;video:string;sourceStart:number;sourceEnd:number;duration:number;bytes:number;sha256:string};

export type PracticeMaterial={
  schemaVersion:1; id:string; title:string; originalTitle:string; speaker:string; event:string;
  duration:number; sourceStart:number; sourceEnd:number; video:string; poster:string;
  sourceUrl:string; transcriptUrl:string; referenceSourceUrl:string;
  groups:readonly PracticeGroup[]; sentences:readonly SentenceRange[]; importedAt:string|null;
  pipelineVersion?:string; clips?:readonly PracticeClip[];
  groupingVersion?:string; previousGroups?:readonly PracticeGroup[];
};
export type MaterialSummary=Pick<PracticeMaterial,'id'|'originalTitle'|'speaker'|'event'|'duration'|'poster'|'sourceUrl'|'importedAt'> & {groupCount:number};
export const defaultMaterial:PracticeMaterial={...lesson,schemaVersion:1,referenceSourceUrl:lesson.transcriptUrl,groups:mergeShortGroups(practiceGroups),previousGroups:practiceGroups,groupingVersion:pipelineRules.groupingVersion,sentences,importedAt:null};

export function validMaterial(value:unknown):value is PracticeMaterial{
  if(!value||typeof value!=='object')return false;
  const material=value as PracticeMaterial;
  if(material.schemaVersion!==1||typeof material.id!=='string'||!/^[a-z0-9][a-z0-9-]{0,127}$/.test(material.id)
    ||!['originalTitle','title','speaker','event','video','poster','sourceUrl','transcriptUrl','referenceSourceUrl'].every(key=>typeof material[key as keyof PracticeMaterial]==='string')
    ||!Number.isFinite(material.duration)||material.duration<=0||material.duration>pipelineRules.maximumDuration
    ||!Number.isFinite(material.sourceStart)||material.sourceStart<0||!Number.isFinite(material.sourceEnd)||material.sourceEnd<=material.sourceStart||Math.abs(material.sourceEnd-material.sourceStart-material.duration)>.5
    ||!Array.isArray(material.groups)||material.groups.length===0||material.groups.length>5000||!Array.isArray(material.sentences)||material.sentences.length===0)return false;
  const validRange=(range:SentenceRange)=>range&&typeof range.id==='string'&&Number.isFinite(range.start)&&Number.isFinite(range.end)&&range.start>=0&&range.end>range.start&&range.end<=material.duration+.1;
  const sentenceIds=material.sentences.map(sentence=>sentence.id);
  if(material.pipelineVersion!==undefined&&material.clips===undefined)return false;
  if(material.pipelineVersion===pipelineRules.version&&(material.groupingVersion!==pipelineRules.groupingVersion||!material.previousGroups))return false;
  if(material.groupingVersion!==undefined&&material.groupingVersion!==pipelineRules.groupingVersion)return false;
  if(material.groupingVersion===pipelineRules.groupingVersion&&material.groups.some(group=>group.end-group.start<pipelineRules.minimumSeconds||group.wordCount<pipelineRules.minimumWords))return false;
  if(material.previousGroups!==undefined&&(!Array.isArray(material.previousGroups)||material.previousGroups.length===0
    ||!material.previousGroups.every((group,index)=>validRange(group)&&Number.isInteger(group.wordCount)&&group.wordCount>0&&Array.isArray(group.sentenceIds)&&(index===0||group.start>=material.previousGroups![index-1].end-.001))
    ||JSON.stringify(material.previousGroups.flatMap(group=>group.sentenceIds))!==JSON.stringify(sentenceIds)))return false;
  if(material.clips!==undefined&&(!Array.isArray(material.clips)||![pipelineRules.version,pipelineRules.previousVersion].some(version=>version===material.pipelineVersion)||material.clips.length!==material.groups.length||!material.clips.every((clip,index)=>{
    const group=material.groups[index];
    return clip&&clip.groupId===group.id&&clip.sourceStart===group.start&&clip.sourceEnd===group.end&&Number.isFinite(clip.duration)&&clip.duration>0
      &&Math.abs(clip.duration-(group.end-group.start))<=pipelineRules.clipDurationTolerance&&Number.isInteger(clip.bytes)&&clip.bytes>=1024
      &&typeof clip.sha256==='string'&&/^[a-f0-9]{64}$/.test(clip.sha256)&&typeof clip.video==='string'
      &&new RegExp(`^/media/${material.id}/clips-v1(?:-[a-f0-9-]{36})?/${String(index+1).padStart(4,'0')}\\.mp4$`).test(clip.video);
  })))return false;
  return new Set(sentenceIds).size===sentenceIds.length&&material.groups.every((group,index)=>validRange(group)&&Number.isInteger(group.wordCount)&&group.wordCount>0&&Array.isArray(group.sentenceIds)&&group.sentenceIds.length>0
    &&(index===0||group.start>=material.groups[index-1].end-.001))&&material.sentences.every(validRange)
    &&JSON.stringify(material.groups.flatMap(group=>group.sentenceIds))===JSON.stringify(sentenceIds);
}
export function materialSummary(material:PracticeMaterial):MaterialSummary{
  const {id,originalTitle,speaker,event,duration,poster,sourceUrl,importedAt}=material;
  return {id,originalTitle,speaker,event,duration,poster,sourceUrl,importedAt,groupCount:material.groups.length};
}
