import {sentences} from './lesson-sentences.ts';
import type {SentenceRange} from './lesson-sentences.ts';
import {pipelineRules} from './pipeline-rules.ts';

export type CountedSentence = SentenceRange & {wordCount:number};
export type PracticeGroup = CountedSentence & {sentenceIds:string[]};

// Apostrophes and hyphens inside words stay together; punctuation is not a word.
export function countEnglishWords(text:string):number {
  return text.match(/[A-Za-z0-9]+(?:['’\-][A-Za-z0-9]+)*/g)?.length??0;
}

/** Append following complete sentences until a practice group reaches the minimum. */
export function mergeShortSentences(input:readonly CountedSentence[],minimum:number=pipelineRules.minimumWords):PracticeGroup[] {
  if(!Number.isInteger(minimum)||minimum<1)throw Error('Invalid minimum');
  const groups:PracticeGroup[]=[];
  const join=(first:PracticeGroup,second:PracticeGroup):PracticeGroup=>({...first,id:`${first.id}+${second.id}`,end:second.end,
    wordCount:first.wordCount+second.wordCount,sentenceIds:[...first.sentenceIds,...second.sentenceIds]});
  for(const sentence of input){
    if(!Number.isInteger(sentence.wordCount)||sentence.wordCount<1)throw Error('Invalid word count');
    const previous=groups.at(-1),next={...sentence,sentenceIds:[sentence.id]};
    if(previous&&previous.wordCount<minimum)groups[groups.length-1]=join(previous,next);
    else groups.push(next);
  }
  // With no following sentence, attach a short tail to the previous group.
  if(groups.length>1&&groups.at(-1)!.wordCount<minimum){
    const tail=groups.pop()!;
    groups[groups.length-1]=join(groups.at(-1)!,tail);
  }
  return groups;
}

// Counts from the same official VTT and complete-sentence ranges as lesson-sentences.ts.
// Source VTT SHA256: 1fe760348a950cb940f87469cb54e7e7794ae364cc403fc80288970a3beead4d
// Standalone laughter is excluded. No transcript text is bundled.
export const sentenceWordCounts:readonly number[]=[35,6,19,29,11,16,17,14,17,15,2,15,13,19];
export const practiceGroups:readonly PracticeGroup[]=mergeShortSentences(sentences.map((sentence,index)=>({...sentence,wordCount:sentenceWordCounts[index]})));
export const practiceStarts:readonly number[]=practiceGroups.map(group=>group.start);

/** Merge adjacent whole practice groups forward; preserve existing group boundaries inside each result. */
export function mergeShortGroups(input:readonly PracticeGroup[],minimumSeconds:number=pipelineRules.minimumSeconds):PracticeGroup[]{
  if(!Number.isFinite(minimumSeconds)||minimumSeconds<0)throw Error('Invalid minimum duration');
  const groups:PracticeGroup[]=[];
  const tooShort=(group:PracticeGroup)=>group.end-group.start<minimumSeconds;
  const join=(first:PracticeGroup,second:PracticeGroup):PracticeGroup=>({...first,id:`${first.id}+${second.id}`,end:second.end,wordCount:first.wordCount+second.wordCount,sentenceIds:[...first.sentenceIds,...second.sentenceIds]});
  for(const group of input){
    if(!Number.isFinite(group.start)||!Number.isFinite(group.end)||group.end<=group.start)throw Error('Invalid group duration');
    const previous=groups.at(-1);
    if(previous&&group.start<previous.end-.001)throw Error('Groups must be ordered');
    if(previous&&tooShort(previous))groups[groups.length-1]=join(previous,group);
    else groups.push({...group,sentenceIds:[...group.sentenceIds]});
  }
  if(groups.length>1&&tooShort(groups.at(-1)!)){
    const tail=groups.pop()!;groups[groups.length-1]=join(groups.at(-1)!,tail);
  }
  return groups;
}
