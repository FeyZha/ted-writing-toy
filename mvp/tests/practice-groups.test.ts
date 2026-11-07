import test from 'node:test';
import assert from 'node:assert/strict';
import {countEnglishWords,mergeShortSentences,practiceGroups,practiceStarts} from '../src/practice-groups.ts';
import {sentences} from '../src/lesson-sentences.ts';

const ranges=(counts:number[])=>counts.map((wordCount,index)=>({id:`s${index}`,start:index*3,end:index*3+2,wordCount}));

test('English contractions and hyphenated words count once; punctuation does not count',()=>{
  assert.equal(countEnglishWords('The idea is actually pretty simple.'),6);
  assert.equal(countEnglishWords('For fun!'),2);
  assert.equal(countEnglishWords("There's a 30-day challenge for self-confidence."),6);
  assert.equal(countEnglishWords('… — !'),0);
});
test('a short sentence joins forward, repeatedly until at least ten words',()=>{
  const groups=mergeShortSentences(ranges([12,2,3,4,8,15]));
  assert.deepEqual(groups.map(group=>group.sentenceIds),[['s0'],['s1','s2','s3','s4'],['s5']]);
  assert.equal(groups[1].wordCount,17);assert.equal(groups[1].start,3);assert.equal(groups[1].end,14);
});
test('exactly ten words stays independent, including sums that reach ten',()=>{
  const groups=mergeShortSentences(ranges([10,4,6,10]));
  assert.deepEqual(groups.map(group=>group.wordCount),[10,10,10]);
  assert.deepEqual(groups[1].sentenceIds,['s1','s2']);
});
test('a short trailing sentence joins back only when no following sentence exists',()=>{
  assert.deepEqual(mergeShortSentences(ranges([12,2])).map(group=>group.sentenceIds),[['s0','s1']]);
  assert.deepEqual(mergeShortSentences(ranges([2,3])).map(group=>group.sentenceIds),[['s0','s1']]);
  assert.deepEqual(mergeShortSentences([]),[]);
});
test('current video becomes twelve contiguous-content groups with only the requested forward merges',()=>{
  assert.equal(practiceGroups.length,12);assert.ok(practiceGroups.every(group=>group.wordCount>=10));
  assert.deepEqual(practiceGroups.flatMap(group=>group.sentenceIds),sentences.map(sentence=>sentence.id));
  assert.deepEqual(practiceGroups[1],{id:'sentence-02+sentence-03',start:13.377,end:20.83,wordCount:25,sentenceIds:['sentence-02','sentence-03']});
  assert.deepEqual(practiceGroups[9],{id:'sentence-11+sentence-12',start:62.451,end:69.83,wordCount:17,sentenceIds:['sentence-11','sentence-12']});
  assert.equal(practiceStarts.includes(15.529),false);assert.equal(practiceStarts.includes(65.097),false);
  assert.equal(practiceGroups.at(-1)?.end,sentences.at(-1)?.end);
});
