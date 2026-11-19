import type { PlayerView, VisibleEvent } from '../shared/contracts';

export function firstVisibleDifference(left: PlayerView, right: PlayerView): { left: VisibleEvent | null; right: VisibleEvent | null } | null {
  const a = left.visibleEvents.filter(e => e.audience.includes('player'));
  const b = right.visibleEvents.filter(e => e.audience.includes('player'));
  const key = (e: VisibleEvent | undefined) => e ? JSON.stringify([e.kind, e.actorId, e.channel, e.text]) : null;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (key(a[i]) !== key(b[i])) return { left: a[i] ?? null, right: b[i] ?? null };
  }
  return null;
}
