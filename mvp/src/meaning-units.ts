import {lesson} from './lesson.ts';
import {sentenceStarts} from './lesson-sentences.ts';

export type PracticeMaterial = Pick<typeof lesson, 'originalTitle' | 'speaker' | 'event' | 'sourceUrl' | 'transcriptUrl'> & {
  id: string;
  number: number | null;
  sentenceCount: number | null;
  title: string;
  clipStart: number;
  clipEnd: number;
  duration: number;
  sourceStart: number;
  sourceEnd: number;
  video: string;
  poster: string;
  sentenceStarts: readonly number[];
};

// Semantic groups, not equal-duration slices. Boundaries sit between caption cues.
// Each tuple: clip start, clip end, spoken sentence count, internal review description.
const plans = [
  [0, 13.1035, 1, '感到停滞，因此决定尝试三十天挑战'],
  [13.1035, 21.2905, 2, '简单的做法：选择想尝试的事，持续三十天'],
  [21.2905, 30.842, 1, '三十天与增加或减少一种习惯'],
  [30.842, 41.842, 2, '挑战中的第一个发现：时间变得更值得记住'],
  [41.842, 50.4305, 2, '每天拍照的做法，以及记住当天情景的结果'],
  [50.4305, 57.1315, 1, '挑战逐渐变难，自信随之增加'],
  [57.1315, 65.085, 2, '从久坐工作到为了乐趣骑车上班'],
  [65.085, 75.3655, 2, '登山经历，以及比挑战前更敢冒险的变化'],
  [75.3655, lesson.duration, 1, '想做的事足够重要，就可以尝试坚持三十天'],
] as const;

export const meaningUnits: PracticeMaterial[] = plans.map(([clipStart, clipEnd, sentenceCount, title], index) => {
  const number = index + 1;
  const label = String(number).padStart(2, '0');
  const speechStarts = sentenceStarts.filter(start => start >= clipStart && start < clipEnd);
  return {
    ...lesson, id: `${lesson.id}-meaning-${label}`, number, sentenceCount, title,
    clipStart, clipEnd, duration: clipEnd - clipStart,
    sourceStart: lesson.sourceStart + clipStart, sourceEnd: Math.min(lesson.sourceEnd, lesson.sourceStart + clipEnd),
    video: `/units/${label}.mp4`, poster: `/units/${label}.jpg`,
    sentenceStarts: [0, ...speechStarts.slice(1).map(start => Number((start - clipStart).toFixed(4)))],
  };
});

export const legacyMaterial: PracticeMaterial = {
  ...lesson, number: null, sentenceCount: null, clipStart: 0, clipEnd: lesson.duration, sentenceStarts,
};
export const ACTIVE_MATERIAL_KEY = 'english-writing-mvp:active-meaning-unit:v1';
