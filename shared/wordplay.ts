import type { WordEffect, WordPlay } from './contracts';

// Public, centered percentage bounds shared by the stage and the rule engine.
export const WORD_ZONES = [
  { id: 'ten', x: 28, y: 25, width: 32, height: 22, rotation: 0 },
  { id: 'bridge', x: 70, y: 50, width: 32, height: 20, rotation: 90 },
  { id: 'equal', x: 30, y: 78, width: 34, height: 20, rotation: 90 },
] as const;

export function wordEffect(x: number, y: number, rotation: WordPlay['rotation']): WordEffect {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 'none';
  return WORD_ZONES.find(zone => rotation === zone.rotation
    && x >= zone.x - zone.width / 2 && x <= zone.x + zone.width / 2
    && y >= zone.y - zone.height / 2 && y <= zone.y + zone.height / 2)?.id ?? 'none';
}
