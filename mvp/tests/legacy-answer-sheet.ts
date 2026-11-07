// Exercise the frozen v2 layout separately from the current duration-based layout.
import * as writing from '../src/answer-sheet.ts';
import {defaultMaterial} from '../src/material.ts';
import {practiceGroups} from '../src/practice-groups.ts';
import type {StoragePort,Reference} from '../src/session.ts';
import type {AnswerSheet} from '../src/answer-sheet.ts';
const material={...defaultMaterial,groups:practiceGroups,groupingVersion:undefined,previousGroups:undefined};
export const {LEGACY_ANSWER_SHEET_KEY,editAnswer}=writing;
export const ANSWER_SHEET_KEY=writing.PREVIOUS_ANSWER_SHEET_KEY;
export const freshSheet=()=>writing.freshSheet(material);
export const validSheet=(value:unknown)=>writing.validSheet(value,material);
export const loadSheet=(storage:StoragePort)=>writing.loadSheet(storage,material);
export const storeSheet=(storage:StoragePort,sheet:AnswerSheet)=>writing.storeSheet(storage,sheet,undefined,material);
export const completeSentence=(sheet:AnswerSheet,index:number)=>writing.completeSentence(sheet,index,material);
export const revealSentence=(sheet:AnswerSheet,index:number,reference:Reference)=>writing.revealSentence(sheet,index,reference,material);
