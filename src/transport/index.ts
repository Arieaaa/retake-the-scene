import type { GameTransport } from '../../shared/contracts';
import { createSiteTransport } from './site';

export async function getTransport(): Promise<GameTransport> {
  if (import.meta.env.VITE_GAME_MODE === 'site') return createSiteTransport();
  return (await import('./authored')).createAuthoredTransport();
}
