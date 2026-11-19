import { expect, it } from 'vitest';
import type { PlayerView, VisibleEvent } from '../shared/contracts';
import { firstVisibleDifference } from '../src/compare';

const event = (text: string, audience = ['player']): VisibleEvent => ({ eventId: text, stage: 1, kind: 'dialogue', actorId: 'writer', actorName: '编剧', channel: 'private', audience, text, source: 'authored', causeIds: [] });
const view = (events: VisibleEvent[]) => ({ visibleEvents: events } as PlayerView);
it('只展示第一处玩家可见差异，不泄露角色间私聊', () => {
  const a = view([event('相同'), event('角色秘密', ['writer']), event('公开递麦'), event('后续A')]);
  const b = view([event('相同'), event('私下看片'), event('后续B')]);
  expect(firstVisibleDifference(a, b)).toMatchObject({ left: { text: '公开递麦' }, right: { text: '私下看片' } });
});
it('分支事件ID不同不是剧情差异，相同历史给出空差异', () => {
  expect(firstVisibleDifference(view([event('相同')]), view([{ ...event('相同'), eventId: 'new-id' }]))).toBeNull();
});
