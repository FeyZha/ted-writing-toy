import test from 'node:test';
import assert from 'node:assert/strict';
import {meaningUnits, legacyMaterial} from '../src/meaning-units.ts';
import {sentenceStarts} from '../src/lesson-sentences.ts';
import {freshSession, loadSession, openReference, storageKey, storeSession, STORAGE_KEY} from '../src/session.ts';

test('semantic units cover the source in order with one or two whole sentences each', () => {
  assert.equal(meaningUnits.length,9);
  assert.equal(meaningUnits[0].clipStart,0);
  assert.equal(meaningUnits.at(-1)?.clipEnd,legacyMaterial.duration);
  assert.equal(meaningUnits.reduce((sum,unit)=>sum+unit.sentenceCount!,0),14);
  for(const [index,unit] of meaningUnits.entries()){
    assert.ok(unit.sentenceCount===1||unit.sentenceCount===2);
    assert.equal(sentenceStarts.filter(start=>start>=unit.clipStart&&start<unit.clipEnd).length,unit.sentenceCount);
    assert.equal(unit.sentenceStarts.length,unit.sentenceCount);
    assert.equal(unit.sentenceStarts[0],0);
    assert.ok(unit.sentenceStarts.every(start=>start>=0&&start<unit.duration));
    assert.ok(unit.sourceStart>=legacyMaterial.sourceStart&&unit.sourceEnd<=legacyMaterial.sourceEnd);
    if(index>0)assert.equal(unit.clipStart,meaningUnits[index-1].clipEnd);
  }
});
test('each unit keeps its own initial and current draft without modifying the old whole-video draft', () => {
  const records=new Map<string,string>();
  const storage={getItem:(key:string)=>records.get(key)??null,setItem:(key:string,value:string)=>{records.set(key,value);}};
  storeSession(storage,{...freshSession(),summary:'Old whole-video draft.'});
  const old=records.get(STORAGE_KEY);
  const [one,two]=meaningUnits;
  const reference={sourceUrl:'https://example.com/official.vtt',retrievedAt:'2026-11-07T00:00:00Z',cues:[{start:0,end:3,text:'One complete idea.'}]};
  storeSession(storage,openReference({...freshSession(one.id),summary:'First unit initial.'},reference));
  storeSession(storage,{...loadSession(storage,one.id).session,summary:'First unit revision.'});
  storeSession(storage,openReference({...freshSession(two.id),summary:'Second unit initial.'},reference));
  assert.equal(loadSession(storage,one.id).session.summary,'First unit revision.');
  assert.equal(loadSession(storage,one.id).session.initialSummary,'First unit initial.');
  assert.equal(loadSession(storage,two.id).session.initialSummary,'Second unit initial.');
  assert.equal(loadSession(storage,meaningUnits[2].id).session.summary,'');
  assert.equal(records.get(STORAGE_KEY),old);
  assert.equal(storageKey(),STORAGE_KEY);
});
test('a record belonging to another unit is rejected without overwriting it', () => {
  const raw=JSON.stringify(freshSession(meaningUnits[0].id));
  let writes=0;
  const loaded=loadSession({getItem:()=>raw,setItem:()=>{writes++;}},meaningUnits[1].id);
  assert.equal(loaded.blocked,true);
  assert.equal(loaded.session.lessonId,meaningUnits[1].id);
  assert.equal(writes,0);
});
