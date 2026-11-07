// Sentence starts derived from TED official English VTT; no transcript text is bundled.
// Source: https://hls.ted.com/project_masters/842/subtitles/en/full.vtt?intro_master_id=9294
// Source VTT SHA256: 1fe760348a950cb940f87469cb54e7e7794ae364cc403fc80288970a3beead4d
// Video interval: 3.65–87.05 seconds; cue times mapped to this clip.
// Joined continuation cues until terminal punctuation; excluded the standalone laughter cue.
export const sentenceStarts: readonly number[] = [0,13.377,15.529,21.751,30.854,34.476,41.854,45.45,50.986,57.433,62.451,65.097,69.854,75.854];
export const sentenceEnds: readonly number[] = [12.83,15.13,20.83,30.83,34.045,41.83,45.426,49.875,56.83,61.83,63.699,69.83,74.877,82.83];
export type SentenceRange = {id: string; start: number; end: number};
export const sentences: readonly SentenceRange[] = sentenceStarts.map((start,index)=>({id:`sentence-${String(index+1).padStart(2,'0')}`,start,end:sentenceEnds[index]}));
