export type Step = 'watch' | 'write' | 'compare';
export type Cue = { start: number; end: number; text: string };
export type Reference = { sourceUrl: string; retrievedAt: string; cues: Cue[] };
export type Session = {
  version: 1;
  lessonId: string;
  step: Step;
  summary: string;
  initialSummary: string | null;
  referenceOpenedAt: string | null;
  reference: Reference | null;
  savedAt: string | null;
};
export const STORAGE_KEY = 'english-writing-mvp:thirty-days-01:v1';
export function storageKey(lessonId = 'thirty-days-01'): string {
  return `english-writing-mvp:${lessonId}:v1`;
}
export type StoragePort = Pick<Storage, 'getItem' | 'setItem'>;

export function freshSession(lessonId = 'thirty-days-01'): Session {
  return { version: 1, lessonId, step: 'watch', summary: '', initialSummary: null, referenceOpenedAt: null, reference: null, savedAt: null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}
export function validReference(value: unknown,maxDuration=84): value is Reference {
  return isRecord(value) && typeof value.sourceUrl === 'string' && typeof value.retrievedAt === 'string'
    && Array.isArray(value.cues) && value.cues.length > 0 && value.cues.length < 500
    && value.cues.every(cue => isRecord(cue) && typeof cue.text === 'string' && cue.text.length > 0
      && typeof cue.start === 'number' && Number.isFinite(cue.start) && cue.start >= 0
      && typeof cue.end === 'number' && Number.isFinite(cue.end) && cue.end > cue.start && cue.end <= maxDuration);
}
export function validSession(value: unknown, lessonId = 'thirty-days-01'): value is Session {
  if (!isRecord(value) || value.version !== 1 || typeof value.lessonId !== 'string' || !value.lessonId || value.lessonId !== lessonId
    || !['watch', 'write', 'compare'].includes(String(value.step)) || typeof value.summary !== 'string'
    || !nullableString(value.initialSummary) || !nullableString(value.referenceOpenedAt)
    || !nullableString(value.savedAt)) return false;
  if (value.reference !== null && !validReference(value.reference)) return false;
  if ((value.initialSummary === null) !== (value.referenceOpenedAt === null)) return false;
  if (value.referenceOpenedAt !== null && !validReference(value.reference)) return false;
  return value.step !== 'compare' || value.referenceOpenedAt !== null;
}

export function loadSession(storage: StoragePort, lessonId = 'thirty-days-01'): { session: Session; blocked: boolean; issue: string | null } {
  try {
    const raw = storage.getItem(storageKey(lessonId));
    if (raw === null) return { session: freshSession(lessonId), blocked: false, issue: null };
    const parsed: unknown = JSON.parse(raw);
    if (!validSession(parsed, lessonId)) throw new Error('Invalid draft');
    return { session: parsed, blocked: false, issue: null };
  } catch {
    return { session: freshSession(lessonId), blocked: true, issue: '暂时无法读取之前的草稿，原记录没有被覆盖。请先保留当前文字，再尝试刷新页面。' };
  }
}

export function storeSession(storage: StoragePort, session: Session, now = new Date().toISOString()): Session {
  const saved = { ...session, savedAt: now };
  if (!validSession(saved, saved.lessonId)) throw new Error('Invalid draft');
  storage.setItem(storageKey(saved.lessonId), JSON.stringify(saved));
  return saved;
}

export function openReference(session: Session, reference: Reference, now = new Date().toISOString()): Session {
  if (!validReference(reference)) throw new Error('Invalid reference');
  return {
    ...session,
    step: 'compare',
    initialSummary: session.referenceOpenedAt === null ? session.summary : session.initialSummary,
    referenceOpenedAt: session.referenceOpenedAt ?? now,
    reference: session.reference ?? reference,
  };
}

function seconds(value: string): number {
  return value.replace(',', '.').split(':').reverse().reduce((total, part, index) => total + Number(part) * 60 ** index, 0);
}
function cleanText(value: string): string {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return value.replace(/<[^>]*>/g, '').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (original, code: string) => {
    if (!code.startsWith('#')) return named[code.toLowerCase()] ?? original;
    const number = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return Number.isFinite(number) && number >= 0 && number <= 0x10ffff ? String.fromCodePoint(number) : original;
  }).replace(/\s+/g, ' ').trim();
}

export function parseClipVtt(raw: string, clipStart: number, clipEnd: number): Cue[] {
  if (!raw.replace(/^\uFEFF/, '').startsWith('WEBVTT') || clipStart < 0 || clipEnd <= clipStart) throw new Error('Invalid subtitles');
  const cues: Cue[] = [];
  for (const block of raw.replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
    const lines = block.split('\n');
    const index = lines.findIndex(line => /^\s*(?:\d{2}:)?\d{2}:\d{2}[.,]\d+\s+-->/.test(line));
    if (index < 0) continue;
    const match = lines[index].match(/^\s*((?:\d{2}:)?\d{2}:\d{2}[.,]\d+)\s+-->\s+((?:\d{2}:)?\d{2}:\d{2}[.,]\d+)/);
    if (!match) continue;
    const start = seconds(match[1]);
    const end = seconds(match[2]);
    const text = cleanText(lines.slice(index + 1).join(' '));
    if (text && end > clipStart && start < clipEnd && end > start) {
      cues.push({ start: Math.max(0, start - clipStart), end: Math.min(clipEnd - clipStart, end - clipStart), text });
    }
  }
  if (cues.length === 0) throw new Error('No matching subtitles');
  return cues;
}

export function referenceParagraphs(cues: Cue[]): string[] {
  const paragraphs: string[] = [];
  let current = '';
  let sentences = 0;
  for (const cue of cues) {
    current += (current ? ' ' : '') + cue.text;
    if (/[.!?]["')]*$/.test(cue.text)) sentences += 1;
    if (sentences >= 2 || (sentences > 0 && current.length > 230)) {
      paragraphs.push(current); current = ''; sentences = 0;
    }
  }
  if (current) paragraphs.push(current);
  return paragraphs;
}
