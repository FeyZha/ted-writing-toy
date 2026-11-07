export type SentenceDirection = 'previous' | 'next';
export type SentenceJump = { index: number; time: number; direction: SentenceDirection; pressedAt: number };

/** Repeated left presses step back even while the restarted sentence is playing. */
export function sentenceJump(
  starts: readonly number[],
  currentTime: number,
  direction: SentenceDirection,
  last: SentenceJump | null,
  pressedAt: number,
): SentenceJump | null {
  if (!starts.length || !Number.isFinite(currentTime)) return null;
  let current = 0;
  for (let index = 1; index < starts.length && starts[index] <= currentTime + 0.001; index++) current = index;

  let index = current;
  if (direction === 'next') {
    if (current === starts.length - 1) return null;
    index += 1;
  } else if (last?.direction === 'previous' && last.index === current
    && ((pressedAt >= last.pressedAt && pressedAt - last.pressedAt <= 1500)
      || Math.abs(currentTime - last.time) <= 0.05)) {
    index = Math.max(0, current - 1);
  }
  return { index, time: starts[index], direction, pressedAt };
}
