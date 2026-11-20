import { describe, expect, it } from 'vitest';
import acceptance from '../五剧十五结局-验收样例.json';
import { CONTRACT_VERSION, GameError, SCRIPT_VERSION, type EpisodeId, type Params, type PlayerView, type TurnInput } from '../shared/contracts';
import { WORD_ZONES, wordEffect } from '../shared/wordplay';
import { episodes, episodePackages } from '../content/episodes';
import { createRun, emptyStore, forkBranch, readBranch, submitTurn, type AuthoredStore } from '../fixtures/authored-engine';
import { previewViews } from '../fixtures/public/views';

function start(episodeId: EpisodeId) {
  const store = emptyStore();
  return { store, view: createRun(store, episodeId, `create-${episodeId}`) };
}
function input(view: PlayerView, actionId: string, params: Params = {}, requestId = `turn-${view.revision}`): TurnInput {
  return { requestId, expectedRevision: view.revision, stage: view.stage, actionId, params };
}
function turn(store: AuthoredStore, view: PlayerView, actionId: string, params: Params = {}, requestId?: string) {
  return submitTurn(store, view.runId, view.branchId, input(view, actionId, params, requestId));
}
function assertRejected(store: AuthoredStore, action: () => unknown, status = 422) {
  const before = JSON.stringify(store);
  let caught: unknown;
  try { action(); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(GameError);
  expect((caught as GameError).status).toBe(status);
  expect(JSON.stringify(store)).toBe(before);
}
function assertCausalLog(view: PlayerView) {
  const seen = new Set<string>();
  for (const event of view.visibleEvents) {
    expect(event.audience).toContain('player');
    expect(['rules', 'authored']).toContain(event.source);
    expect(seen.has(event.eventId)).toBe(false);
    for (const causeId of event.causeIds) expect(seen.has(causeId), `${event.kind} cites unavailable ${causeId}`).toBe(true);
    seen.add(event.eventId);
  }
}

// External, unmodified acceptance JSON is the oracle, not engine-generated expectations.
describe('15 authored paths from the original acceptance artifact', () => {
  it('has five episodes, fifteen distinct ending expectations and the agreed version', () => {
    expect(acceptance.mode).toBe('authored');
    expect(acceptance.scriptVersion).toBe(SCRIPT_VERSION);
    expect(acceptance.cases).toHaveLength(15);
    expect(new Set(acceptance.cases.map(item => item.expected.endingId)).size).toBe(15);
    expect(episodes).toHaveLength(5);
  });
  for (const testCase of acceptance.cases) {
    it(`${testCase.caseId}: ${testCase.expected.title}`, () => {
      const { store, view: initial } = start(testCase.episodeId as EpisodeId);
      let view = initial;
      expect(view.ending).toBeNull();
      for (const [index, step] of testCase.turns.entries()) {
        expect(view.stage).toBe(step.stage);
        expect(view.choices.map(choice => choice.actionId)).toContain(step.actionId);
        const beforeCount = view.visibleEvents.length;
        view = turn(store, view, step.actionId);
        expect(view.revision).toBe(index + 1);
        expect(view.checkpoints[index].stage).toBe(step.stage);
        expect(view.visibleEvents.slice(beforeCount).some(event => event.kind === 'dialogue')).toBe(true);
        if (testCase.episodeId === 'hiss') {
          expect(view.visibleEvents[beforeCount].kind).toBe('hiss_emitted');
          expect(view.visibleEvents[beforeCount].source).toBe('rules');
          expect(view.visibleEvents[beforeCount].text).toContain('target=player');
          expect(view.presentation.hissCount).toBe(index + 1);
        }
        assertCausalLog(view);
      }
      expect(view.status).toBe('ended');
      expect(view.choices).toEqual([]);
      expect(view.activeRequest).toBeNull();
      expect(view.ending?.id).toBe(testCase.expected.endingId);
      expect(view.ending?.title).toBe(testCase.expected.title);
      expect(view.ending?.text).toBe(testCase.expected.visibleResult);
      expect(view.ending?.line.length).toBeGreaterThan(5);
      expect(view.scene.prop.length).toBeGreaterThan(5);
      expect(view.presentation.mode).toBe('authored');
      for (const kind of testCase.expected.requiredEvents) expect(view.visibleEvents.map(event => event.kind)).toContain(kind);
      expect(readBranch(store, view.runId, view.branchId)).toEqual(view);
      const restored = JSON.parse(JSON.stringify(store)) as AuthoredStore;
      expect(readBranch(restored, view.runId, view.branchId)).toEqual(view);
    });
  }
});

describe('first changed event presentation projection', () => {
  const firstResults: Record<string, { kind: string; text: string }> = {
    preview_tail: { kind: 'tail_previewed', text: '小窗最后一页有一行空白，大屏没有变化。' },
    hold_photos: { kind: 'photos_held', text: '照片留在大屏，十二桌还在吃席。' },
    play_intro: { kind: 'intro_screened', text: '片头亮起，老剧组的合影掠过屏幕。' },
    read_roster: { kind: 'roster_read', text: '夜班一栏写着自动接管，人工联系人却没有填。' },
    answer_call: { kind: 'dialogue', text: '欢迎致电。背景里响了一声微波炉的叮。' },
    open_meeting: { kind: 'meeting_opened', text: '主位的名字换了，夜班一栏还没有换。' },
    open_chats: { kind: 'chats_opened', text: '两边的时间戳并排亮起来。' },
    ask_friend: { kind: 'message_forwarded', text: '转发预览已确认：今天 21:10 · 那张截图，把我头像也截进去了。' },
    step_back: { kind: 'hiss_emitted', text: '哈——朝玩家。target=player' },
    hiss_back: { kind: 'hiss_emitted', text: '哈——朝玩家。target=player' },
    freeze: { kind: 'hiss_emitted', text: '哈——朝玩家。target=player' },
    quote_clip: { kind: 'dialogue', text: '先把原拍摄者叫回来找文件。' },
    quote_game: { kind: 'dialogue', text: '名单第十个位置先挂上一个 1。' },
    quote_homework: { kind: 'dialogue', text: '好，还差三十七个。原拍摄者，你留过那张纸吗？' },
  };
  for (const testCase of acceptance.cases) {
    it(`${testCase.caseId}: keeps the path's first result through turns, restore and forks without writing state`, () => {
      const { store, view: initial } = start(testCase.episodeId as EpisodeId);
      expect(initial.presentation).not.toHaveProperty('firstChangedEventId');
      expect(readBranch(store, initial.runId, initial.branchId).presentation).not.toHaveProperty('firstChangedEventId');
      // Hiss precedes the request root; all other paths place the first result just after it.
      const resultIndex = initial.visibleEvents.length + (testCase.episodeId === 'hiss' ? 0 : 1);
      let view = initial;
      let firstChangedEvent: PlayerView['visibleEvents'][number] | undefined;
      for (const [index, step] of testCase.turns.entries()) {
        view = turn(store, view, step.actionId);
        if (index === 0) {
          firstChangedEvent = view.visibleEvents[resultIndex];
          expect(firstChangedEvent).toMatchObject(firstResults[step.actionId]);
          expect(firstChangedEvent.audience).toContain('player');
          expect(initial.visibleEvents.map(event => event.eventId)).not.toContain(firstChangedEvent.eventId);
          if (testCase.episodeId === 'hiss') expect(view.visibleEvents[resultIndex + 1].kind).toBe('player_action');
          if (step.actionId === 'answer_call') expect(firstChangedEvent.source).toBe('authored');
        }
        expect(view.presentation.firstChangedEventId).toBe(firstChangedEvent!.eventId);
        expect(view.visibleEvents.find(event => event.eventId === view.presentation.firstChangedEventId)).toEqual(firstChangedEvent);
        const branch = store.runs[view.runId].branches[view.branchId];
        expect(branch.state.presentation).not.toHaveProperty('firstChangedEventId');
        for (const checkpoint of branch.checkpoints) expect(checkpoint.state.presentation).not.toHaveProperty('firstChangedEventId');
        const saved = JSON.stringify(store);
        expect(readBranch(store, view.runId, view.branchId)).toEqual(view);
        expect(JSON.stringify(store)).toBe(saved);
        const restored = JSON.parse(saved) as AuthoredStore;
        expect(readBranch(restored, view.runId, view.branchId)).toEqual(view);
        expect(JSON.stringify(restored)).toBe(saved);
      }
      const first = firstChangedEvent!;
      const originalBranch = JSON.stringify(store.runs[view.runId].branches[view.branchId]);
      const rewind = forkBranch(store, view.runId, view.branchId, view.checkpoints[0].id, 'first-decision');
      expect(rewind.checkpoints).toEqual([]);
      expect(rewind.visibleEvents).toEqual(initial.visibleEvents);
      expect(rewind.presentation).not.toHaveProperty('firstChangedEventId');
      const alternate = acceptance.cases.find(item => item.episodeId === testCase.episodeId && item.turns[0].actionId !== testCase.turns[0].actionId)!;
      const changed = turn(store, rewind, alternate.turns[0].actionId);
      const newFirst = changed.visibleEvents[resultIndex];
      expect(newFirst).toMatchObject(firstResults[alternate.turns[0].actionId]);
      expect(changed.presentation.firstChangedEventId).toBe(newFirst.eventId);
      expect(newFirst.eventId).not.toBe(first.eventId);
      expect(changed.visibleEvents.map(event => event.eventId)).not.toContain(first.eventId);
      for (const index of [1, 2]) {
        const laterFork = forkBranch(store, view.runId, view.branchId, view.checkpoints[index].id, `later-decision-${index}`);
        expect(laterFork.checkpoints).toEqual(view.checkpoints.slice(0, index));
        expect(laterFork.presentation.firstChangedEventId).toBe(first.eventId);
        expect(laterFork.visibleEvents.find(event => event.eventId === first.eventId)).toEqual(first);
        const continued = turn(store, laterFork, testCase.turns[index].actionId);
        expect(continued.presentation.firstChangedEventId).toBe(first.eventId);
        const restored = JSON.parse(JSON.stringify(store)) as AuthoredStore;
        expect(readBranch(restored, continued.runId, continued.branchId)).toEqual(continued);
      }
      expect(JSON.stringify(store.runs[view.runId].branches[view.branchId])).toBe(originalBranch);
      expect(readBranch(store, view.runId, view.branchId).presentation.firstChangedEventId).toBe(first.eventId);
      for (const branch of Object.values(store.runs[view.runId].branches)) {
        expect(branch.state.presentation).not.toHaveProperty('firstChangedEventId');
        for (const checkpoint of branch.checkpoints) expect(checkpoint.state.presentation).not.toHaveProperty('firstChangedEventId');
      }
    });
  }
  it('skips non-player events and omits the reference without a checkpoint or eligible result', () => {
    const { store, view: initial } = start('wedding');
    const view = turn(store, initial, 'preview_tail');
    const branch = store.runs[view.runId].branches[view.branchId];
    const first = branch.state.visibleEvents[initial.visibleEvents.length + 1];
    const privateEvent = { ...first, eventId: 'not-for-player', audience: ['writer'] };
    branch.state.visibleEvents.splice(initial.visibleEvents.length, 0, privateEvent);
    expect(readBranch(store, view.runId, view.branchId).presentation.firstChangedEventId).toBe(first.eventId);
    branch.state.visibleEvents = [...initial.visibleEvents, privateEvent,
      { ...first, eventId: 'action-root', kind: 'player_action' }, { ...first, eventId: 'reply-root', kind: 'reply_sent' }];
    expect(readBranch(store, view.runId, view.branchId).presentation).not.toHaveProperty('firstChangedEventId');
    branch.state.visibleEvents = [];
    expect(readBranch(store, view.runId, view.branchId).presentation).not.toHaveProperty('firstChangedEventId');
    branch.state.visibleEvents = view.visibleEvents;
    branch.checkpoints = [];
    const saved = JSON.stringify(store);
    expect(readBranch(store, view.runId, view.branchId).presentation).not.toHaveProperty('firstChangedEventId');
    expect(JSON.stringify(store)).toBe(saved);
  });
});

describe('state ownership, revisions and idempotency', () => {
  it('returns fresh copies and mutates only the supplied serializable store', () => {
    const { store, view } = start('wedding');
    const separate = emptyStore();
    expect(separate.runs).toEqual({});
    expect(view.runId).toMatch(/^[0-9a-f-]{36}$/);
    view.scene.prop = 'changed';
    view.visibleEvents[0].audience.push('intruder');
    view.presentation.consent = true;
    const read = readBranch(store, view.runId, view.branchId);
    expect(read.scene.prop).not.toBe('changed');
    expect(read.visibleEvents[0].audience).not.toContain('intruder');
    expect(read.presentation.consent).toBe(false);
    const before = JSON.stringify(store);
    readBranch(store, view.runId, view.branchId).choices.pop();
    expect(JSON.stringify(store)).toBe(before);
  });
  it('deduplicates create keys, including after the original run advances', () => {
    const { store, view } = start('wedding');
    turn(store, view, 'hold_photos');
    const before = JSON.stringify(store);
    expect(createRun(store, 'wedding', 'create-wedding')).toEqual(view);
    expect(JSON.stringify(store)).toBe(before);
    assertRejected(store, () => createRun(store, 'office', 'create-wedding'), 409);
  });
  it('replays the original turn result, canonicalizes params ordering, rejects changed payloads', () => {
    const { store, view } = start('wedding');
    const request = input(view, 'hold_photos', { target: 'guests', channel: 'screen' }, 'same-request');
    const result = submitTurn(store, view.runId, view.branchId, request);
    const later = turn(store, result, 'watch_table');
    const before = JSON.stringify(store);
    expect(submitTurn(store, view.runId, view.branchId, { ...request, params: { channel: 'screen', target: 'guests' } })).toEqual(result);
    expect(JSON.stringify(store)).toBe(before);
    expect(readBranch(store, later.runId, later.branchId).revision).toBe(2);
    assertRejected(store, () => submitTurn(store, view.runId, view.branchId, { ...request, actionId: 'play_intro' }), 409);
    assertRejected(store, () => submitTurn(store, view.runId, view.branchId, { ...request, params: { target: 'guests', channel: 'screen', text: '换一句' } }), 409);
    assertRejected(store, () => turn(store, view, 'preview_tail', {}, 'new-stale-request'), 409);
    assertRejected(store, () => submitTurn(store, later.runId, later.branchId, { ...input(later, 'play_original'), stage: 2 }), 409);
  });
  it('uses submitted pre-decision checkpoints and forks without future state', () => {
    const { store, view: initial } = start('wedding');
    const second = turn(store, initial, 'preview_tail');
    const third = turn(store, second, 'private_preview');
    const ended = turn(store, third, 'lend_laptop');
    const rewind = forkBranch(store, ended.runId, ended.branchId, ended.checkpoints[1].id, 'fork-two');
    expect(rewind.stage).toBe(2);
    expect(rewind.revision).toBe(0);
    expect(rewind.presentation.consent).toBe(false);
    expect(rewind.presentation.creditsUpdated).toBe(false);
    expect(rewind.inventory.map(item => item.id)).toEqual(['missing_credit']);
    expect(rewind.visibleEvents).toEqual(second.visibleEvents);
    expect(rewind.checkpoints).toEqual(second.checkpoints);
    expect(rewind.branches).toHaveLength(2);
    expect(rewind.branches[1].parentBranchId).toBe(ended.branchId);
    const branchThird = turn(store, rewind, 'watch_table');
    expect(branchThird.choices.map(choice => choice.actionId)).not.toContain('lend_laptop');
    assertRejected(store, () => turn(store, branchThird, 'lend_laptop', { text: '旧分支的她已经同意了' }));
    expect(readBranch(store, ended.runId, ended.branchId).ending?.id).toBe('wedding.credits');
    const before = JSON.stringify(store);
    expect(forkBranch(store, ended.runId, ended.branchId, ended.checkpoints[1].id, 'fork-two')).toEqual(rewind);
    expect(JSON.stringify(store)).toBe(before);
    assertRejected(store, () => forkBranch(store, ended.runId, ended.branchId, ended.checkpoints[0].id, 'fork-two'), 409);
    assertRejected(store, () => forkBranch(store, rewind.runId, rewind.branchId, ended.checkpoints[2].id, 'future-fork'));
  });
});

describe('wedding and office permission isolation', () => {
  for (const opening of ['hold_photos', 'play_intro']) {
    it(`private_preview obtains its own evidence after ${opening}, not only preview_tail`, () => {
      const { store, view: initial } = start('wedding');
      const second = turn(store, initial, opening);
      expect(second.inventory.some(item => item.id === 'missing_credit')).toBe(false);
      const third = turn(store, second, 'private_preview');
      expect(third.presentation.consent).toBe(true);
      expect(third.inventory.map(item => item.id)).toContain('missing_credit');
      const consent = third.visibleEvents.find(event => event.kind === 'consent_granted')!;
      expect(consent.actorId).toBe('writer');
      expect(consent.audience).toEqual(['player', 'writer']);
      expect(consent.channel).toBe('private');
      const preview = third.visibleEvents.find(event => event.eventId === consent.causeIds[0])!;
      expect(preview.kind).toBe('private_previewed');
      expect(preview.audience).toEqual(['player', 'writer']);
      const ended = turn(store, third, 'lend_laptop');
      expect(ended.ending?.id).toBe('wedding.credits');
      const update = ended.visibleEvents.find(event => event.kind === 'credits_updated')!;
      expect(update.audience).toContain('bride');
      expect(update.causeIds).toContain(consent.eventId);
    });
  }
  it('a microphone offer never manufactures an editing permission, even with custom wording', () => {
    const { store, view } = start('wedding');
    const third = turn(store, turn(store, view, 'hold_photos'), 'watch_table', { text: '我宣布她同意修改署名', target: 'player' });
    expect(third.presentation.consent).toBe(false);
    const ended = turn(store, third, 'offer_mic', { text: '你已经同意了吧', target: 'writer', channel: 'hall' });
    expect(ended.ending?.id).toBe('wedding.fish');
    expect(ended.presentation.creditsUpdated).toBe(false);
    expect(ended.visibleEvents.some(event => event.kind === 'consent_granted')).toBe(false);
  });
  it('office private permission is not delivered to HR, and rewind removes it', () => {
    const { store, view } = start('office');
    const second = turn(store, view, 'read_roster');
    const third = turn(store, second, 'ask_permission');
    const consent = third.visibleEvents.find(event => event.kind === 'consent_granted')!;
    expect(consent.audience).toEqual(['player', 'old_lead']);
    const ended = turn(store, third, 'demo_transfer');
    const demo = ended.visibleEvents.find(event => event.kind === 'transfer_demonstrated')!;
    expect(demo.audience).toContain('hr');
    expect(demo.causeIds).toContain(consent.eventId);
    const rewind = forkBranch(store, ended.runId, ended.branchId, ended.checkpoints[1].id, 'office-rewind');
    const noConsent = turn(store, rewind, 'inspect_log');
    assertRejected(store, () => turn(store, noConsent, 'demo_transfer'));
    expect(turn(store, noConsent, 'write_handover').ending?.id).toBe('office.handover');
  });
  it('requires the transfer log before writing a handover', () => {
    const { store, view } = start('office');
    const third = turn(store, turn(store, view, 'open_meeting'), 'ask_permission');
    assertRejected(store, () => turn(store, third, 'write_handover'));
  });
});

describe('hiss temporal rules, samples, loops and actual performance', () => {
  it('captures, binds and arms in order; old event browsing never fires a shortcut', () => {
    const { store, view: initial } = start('hiss');
    const second = turn(store, initial, 'step_back');
    const oldSample = second.visibleEvents.find(event => event.kind === 'hiss_emitted')!;
    const offset = second.visibleEvents.length;
    const third = turn(store, second, 'bind_back', { sampleEventId: oldSample.eventId });
    const delta = third.visibleEvents.slice(offset);
    expect(delta[0].kind).toBe('hiss_emitted');
    const captureIndex = delta.findIndex(event => event.kind === 'sample_captured');
    const boundIndex = delta.findIndex(event => event.kind === 'shortcut_bound');
    const armedIndex = delta.findIndex(event => event.kind === 'shortcut_armed');
    expect(captureIndex).toBeGreaterThan(0);
    expect(boundIndex).toBeGreaterThan(captureIndex);
    expect(armedIndex).toBeGreaterThan(boundIndex);
    expect(delta[captureIndex].causeIds).toContain(oldSample.eventId);
    expect(third.visibleEvents.some(event => event.kind === 'shortcut_fired')).toBe(false);
    const before = JSON.stringify(store);
    for (let index = 0; index < 3; index++) expect(readBranch(store, third.runId, third.branchId)).toEqual(third);
    expect(JSON.stringify(store)).toBe(before);
    const ended = turn(store, third, 'bow');
    const fired = ended.visibleEvents.find(event => event.kind === 'shortcut_fired')!;
    const finalHiss = ended.visibleEvents.filter(event => event.kind === 'hiss_emitted').at(-1)!;
    expect(fired.causeIds).toContain(finalHiss.eventId);
    expect(fired.causeIds).toContain(delta[armedIndex].eventId);
    expect(fired.causeIds).not.toContain(oldSample.eventId);
    expect(ended.presentation.hissTarget).toBe('player');
    assertCausalLog(ended);
  });
  it('player_word does not match: loops to stage 2, preserves samples and uses revision not stage', () => {
    const { store, view } = start('hiss');
    const second = turn(store, view, 'freeze');
    const third = turn(store, second, 'bind_duet', { sample: 'player_word' });
    expect(third.presentation.playerSpoke).toBe(true);
    const loop = turn(store, third, 'move_aside');
    expect(loop.stage).toBe(2);
    expect(loop.revision).toBe(3);
    expect(loop.status).toBe('ready');
    expect(loop.ending).toBeNull();
    expect(loop.presentation.armed).toBe(false);
    expect(loop.inventory.map(item => item.id)).toEqual(['cat_hiss', 'player_word']);
    expect(loop.visibleEvents.map(event => event.kind)).toContain('sample_mismatch');
    assertRejected(store, () => turn(store, second, 'bind_duet', {}, 'stale-same-stage'), 409);
    const request = input(loop, 'bind_duet', { sample: 'cat_hiss' }, 'rebind');
    const rebound = submitTurn(store, loop.runId, loop.branchId, request);
    const before = JSON.stringify(store);
    expect(submitTurn(store, loop.runId, loop.branchId, request)).toEqual(rebound);
    expect(JSON.stringify(store)).toBe(before);
    assertRejected(store, () => submitTurn(store, loop.runId, loop.branchId, { ...request, params: { sample: 'player_word' } }), 409);
    const ended = turn(store, rebound, 'move_aside');
    expect(ended.ending?.id).toBe('hiss.duet');
    expect(ended.presentation.hissCount).toBe(5);
    expect(ended.presentation.duetTitle).toBe('原版在右，翻唱在左');
    expect(ended.ending?.line).toContain('翻唱');
    assertCausalLog(ended);
  });
  it('duplicate hiss actions never add a second hiss, even after ending', () => {
    const { store, view } = start('hiss');
    const request = input(view, 'hiss_back', {}, 'first-hiss');
    const second = submitTurn(store, view.runId, view.branchId, request);
    const third = turn(store, second, 'bind_cover');
    const ended = turn(store, third, 'hiss_back');
    const before = JSON.stringify(store);
    expect(submitTurn(store, view.runId, view.branchId, request)).toEqual(second);
    expect(JSON.stringify(store)).toBe(before);
    expect(readBranch(store, ended.runId, ended.branchId).presentation.hissCount).toBe(3);
  });
  it('supports custom gestures and reuse of a real first-stage sample without granting text commands', () => {
    const { store, view } = start('hiss');
    const second = turn(store, view, 'custom_gesture', { text: '把刚才它哈我的声音设成返回键', target: 'cat', channel: 'scene' });
    expect(second.stage).toBe(2);
    expect(second.presentation.binding).toBe('');
    const sampleEventId = String(second.presentation.lastHissEventId);
    const third = turn(store, second, 'bind_cover', { sample: 'cat_hiss', sampleEventId });
    const ended = turn(store, third, 'custom_gesture', { text: '我横着挪到柜子旁' });
    expect(ended.presentation.lastGesture).toBe('我横着挪到柜子旁');
    expect(ended.presentation.exportLastGesture).toBe('我横着挪到柜子旁');
    expect(ended.scene.prop).toContain('我横着挪到柜子旁');
    expect(ended.ending?.line).toContain('我横着挪到柜子旁');
    expect(ended.presentation.playerSpoke).toBe(false);
  });
  it('uses actual final gesture and speech for covers and silent duet captions', () => {
    const one = start('hiss');
    const cover = turn(one.store, turn(one.store, turn(one.store, one.view, 'hiss_back'), 'bind_cover'), 'bow');
    expect(cover.presentation.playerSpoke).toBe(true);
    expect(cover.presentation.lastGesture).toBe('bow');
    expect(cover.presentation.coverComment).toBe('现在道歉是不是稍微有点晚了');
    expect(cover.ending?.line).toContain('鞠躬');
    const two = start('hiss');
    const duet = turn(two.store, turn(two.store, turn(two.store, two.view, 'freeze'), 'bind_duet'), 'move_aside');
    expect(duet.presentation.playerSpoke).toBe(false);
    expect(duet.presentation.duetTitle).toBe('耄耋独唱，特邀嘉宾负责挨哈');
    expect(duet.ending?.line).toContain('特邀嘉宾负责挨哈');
  });
  it('rejects invalid, wrong-type and other-branch samples before emitting a hiss', () => {
    const { store, view } = start('hiss');
    assertRejected(store, () => turn(store, view, 'custom_gesture'));
    const second = turn(store, view, 'step_back');
    assertRejected(store, () => turn(store, second, 'bind_back', { sample: 'real_microphone' }));
    assertRejected(store, () => turn(store, second, 'bind_back', { sampleEventId: 'missing-event' }));
    const hissId = String(second.presentation.lastHissEventId);
    assertRejected(store, () => turn(store, second, 'bind_back', { sample: 'player_word', sampleEventId: hissId }));
    const third = turn(store, second, 'bind_back');
    const ended = turn(store, third, 'bow');
    const futureId = String(ended.presentation.lastHissEventId);
    const fork = forkBranch(store, ended.runId, ended.branchId, ended.checkpoints[1].id, 'sample-fork');
    assertRejected(store, () => turn(store, fork, 'bind_back', { sampleEventId: futureId }));
    expect(fork.presentation.hissCount).toBe(1);
    expect(fork.presentation.armed).toBe(false);
    expect(fork.presentation.binding).toBe('');
  });
});

describe('reply reference tree and single-digit boundaries', () => {
  const lanes = [
    { quote: 'quote_clip', inspect: 'inspect_bucket', final: 'reply_clip', target: 'owner', ending: 'reply.bucket' },
    { quote: 'quote_game', inspect: 'inspect_frame', final: 'reply_game', target: 'baller', ending: 'reply.screen' },
    { quote: 'quote_homework', inspect: 'zoom_paper', final: 'reply_homework', target: 'rep', ending: 'reply.class' },
  ];
  for (const first of lanes) for (const last of lanes) {
    it(`${first.quote} can cross over to ${last.final}, validating the actual visible parent`, () => {
      const { store, view } = start('reply');
      const firstParent = String(view.presentation[`${first.quote}ParentMessageId`]);
      const second = turn(store, view, first.quote, { target: first.target, channel: 'group', parentMessageId: firstParent, text: '1' });
      expect(second.presentation.parentMessageId).toBe(firstParent);
      const third = turn(store, second, first.inspect);
      expect(third.choices).toHaveLength(3);
      const finalParent = String(third.presentation[`${last.final}ParentMessageId`]);
      const ended = turn(store, third, last.final, { parentMessageId: finalParent, target: last.target });
      expect(ended.ending?.id).toBe(last.ending);
      expect(ended.presentation.replyTarget).toBe(last.target);
      const sent = ended.visibleEvents.filter(event => event.kind === 'reply_sent');
      expect(sent).toHaveLength(2);
      expect(sent.every(event => event.text === '1')).toBe(true);
      expect(sent[1].causeIds).toContain(finalParent);
      assertCausalLog(ended);
    });
  }
  it('rejects mismatched parents, target, channel and any non-1 submitted wording', () => {
    const { store, view } = start('reply');
    assertRejected(store, () => turn(store, view, 'quote_clip', { parentMessageId: String(view.presentation.quote_gameParentMessageId) }));
    assertRejected(store, () => turn(store, view, 'quote_clip', { target: 'baller' }));
    assertRejected(store, () => turn(store, view, 'quote_clip', { channel: 'private' }));
    const third = turn(store, turn(store, view, 'quote_homework'), 'zoom_paper');
    for (const text of ['2', '11', ' 1', '1 ', '我同意复活']) assertRejected(store, () => turn(store, third, 'reply_clip', { text }));
    assertRejected(store, () => turn(store, third, 'reply_clip', { parentMessageId: String(view.presentation.quote_clipParentMessageId) }));
    assertRejected(store, () => turn(store, third, 'reply_clip', { parentMessageId: 'unseen-future-message' }));
    expect(turn(store, third, 'reply_clip').ending?.id).toBe('reply.bucket');
  });
});

describe('romance: one actor, two channels, explicit forwarding only', () => {
  it('soda owns both windows, friend receives only the forwarded content and own response', () => {
    const { store, view } = start('romance');
    const original = view.visibleEvents.find(event => event.eventId === view.presentation.friendForwardPreviewEventId)!;
    const second = turn(store, view, 'ask_friend', { forwardEventId: original.eventId });
    const friendEvents = second.visibleEvents.filter(event => event.audience.includes('friend'));
    expect(friendEvents.map(event => event.kind)).toEqual(['message_forwarded', 'dialogue']);
    const forwarded = friendEvents[0];
    expect(forwarded.text).toContain(original.text);
    expect(forwarded.causeIds).toContain(original.eventId);
    expect(second.presentation.friendReceivedEventId).toBe(forwarded.eventId);
    expect(friendEvents[1].causeIds).toEqual([forwarded.eventId]);
    const third = turn(store, second, 'compare_thursday');
    const ended = turn(store, third, 'disclose_forwarding');
    const sodaMessages = ended.visibleEvents.filter(event => ['soda', 'coach'].includes(event.channel) && event.actorId !== 'player');
    expect(new Set(sodaMessages.map(event => event.actorId))).toEqual(new Set(['soda']));
    expect(new Set(sodaMessages.map(event => event.channel))).toEqual(new Set(['soda', 'coach']));
    expect(ended.visibleEvents.filter(event => event.audience.includes('friend'))).toEqual(friendEvents);
    const finalPlayerMessages = ended.visibleEvents.slice(third.visibleEvents.length).filter(event => event.actorId === 'player' && ['soda', 'coach'].includes(event.channel));
    expect(finalPlayerMessages).toHaveLength(1);
    expect(finalPlayerMessages[0].kind).toBe('forwarding_disclosed');
  });
  it('never leaks an unsent draft or non-forwarded conversation to the friend', () => {
    const { store, view } = start('romance');
    const second = turn(store, view, 'open_chats');
    const third = turn(store, second, 'find_draft');
    const draft = third.visibleEvents.find(event => event.kind === 'draft_found')!;
    expect(draft.audience).toEqual(['player']);
    expect(third.presentation.sent).toBe(false);
    expect(third.visibleEvents.filter(event => event.audience.includes('friend'))).toEqual([]);
    assertRejected(store, () => turn(store, third, 'send_original', { target: 'friend', channel: 'friend' }));
    assertRejected(store, () => turn(store, third, 'disclose_forwarding'));
    const ended = turn(store, third, 'send_original');
    expect(ended.visibleEvents.filter(event => event.audience.includes('friend'))).toEqual([]);
    const finalPlayerMessages = ended.visibleEvents.slice(third.visibleEvents.length).filter(event => event.actorId === 'player');
    expect(finalPlayerMessages).toHaveLength(1);
    expect(finalPlayerMessages[0].text).toBe('见。想吃烤肉。');
    expect(ended.presentation.activeWindow).toBe('soda');
  });
  it('custom wording only changes a legal intent; wrong targets and forged forwarded events fail', () => {
    const { store, view } = start('romance');
    assertRejected(store, () => turn(store, view, 'ask_friend', { forwardEventId: 'forged-draft' }));
    const third = turn(store, turn(store, view, 'open_chats'), 'compare_thursday');
    assertRejected(store, () => turn(store, third, 'ask_coach', { target: 'soda', channel: 'soda' }));
    const ended = turn(store, third, 'ask_coach', { target: 'soda', channel: 'coach', text: '别代写啦，你自己想约在哪？' });
    expect(ended.ending?.id).toBe('romance.queues');
    expect(ended.visibleEvents.slice(third.visibleEvents.length).filter(event => event.actorId === 'player').map(event => event.text)).toEqual(['别代写啦，你自己想约在哪？']);
  });
});

describe('malformed and illegal operations have no side effects', () => {
  it('validates action, params, empty keys and lengths without recording checkpoints or requests', () => {
    const { store, view } = start('wedding');
    assertRejected(store, () => turn(store, view, 'unknown-action'));
    assertRejected(store, () => turn(store, view, 'lend_laptop'));
    assertRejected(store, () => turn(store, view, 'preview_tail', { target: 'writer' }));
    assertRejected(store, () => turn(store, view, 'preview_tail', { text: 'a'.repeat(81) }));
    assertRejected(store, () => turn(store, view, 'preview_tail', { text: '' }));
    assertRejected(store, () => turn(store, view, 'preview_tail', { consent: 'true' }));
    assertRejected(store, () => turn(store, view, 'preview_tail', { sample: 'cat_hiss' }));
    assertRejected(store, () => turn(store, view, 'preview_tail', {}, ''));
    assertRejected(store, () => createRun(store, 'wedding', ''));
    assertRejected(store, () => createRun(store, 'missing' as EpisodeId, 'bad-episode'));
    assertRejected(store, () => submitTurn(store, view.runId, view.branchId, { ...input(view, 'preview_tail'), params: { text: 1 } as unknown as Params }));
    assertRejected(store, () => submitTurn(store, view.runId, view.branchId, { ...input(view, 'preview_tail'), expectedRevision: -1 }));
    assertRejected(store, () => submitTurn(store, view.runId, view.branchId, { ...input(view, 'preview_tail'), stage: 4 }));
    assertRejected(store, () => readBranch(store, 'missing-run', view.branchId), 404);
    assertRejected(store, () => readBranch(store, view.runId, 'missing-branch'), 404);
    const next = turn(store, view, 'preview_tail', { text: 'a'.repeat(80) });
    expect(next.revision).toBe(1);
    expect(next.checkpoints).toHaveLength(1);
    expect(next.presentation.consent).toBe(false);
  });
  it('ended branches accept only reads, exact duplicate requests or valid forks', () => {
    const { store, view } = start('wedding');
    const ended = turn(store, turn(store, turn(store, view, 'play_intro'), 'watch_table'), 'play_original');
    assertRejected(store, () => turn(store, ended, 'play_original'));
    assertRejected(store, () => forkBranch(store, ended.runId, ended.branchId, 'missing-checkpoint', 'bad-fork'));
    assertRejected(store, () => forkBranch(store, ended.runId, ended.branchId, ended.checkpoints[0].id, ''));
  });
});

describe('public wordplay geometry and rule-owned poses', () => {
  const move = (store: AuthoredStore, view: PlayerView, x: number, y: number, rotation: 0 | 90) =>
    turn(store, view, 'move_one', { x: String(x), y: String(y), rotation: String(rotation) });

  it('extends only the contract version, preserving the original script oracle', () => {
    expect(CONTRACT_VERSION).toBe('1.1');
    expect(SCRIPT_VERSION).toBe('1.0.0');
    expect(WORD_ZONES).toEqual([
      { id: 'ten', x: 28, y: 25, width: 32, height: 22, rotation: 0 },
      { id: 'bridge', x: 70, y: 50, width: 32, height: 20, rotation: 90 },
      { id: 'equal', x: 30, y: 78, width: 34, height: 20, rotation: 90 },
    ]);
  });
  for (const zone of WORD_ZONES) {
    it(`${zone.id}: uses inclusive centered bounds and requires the correct orientation`, () => {
      for (const x of [zone.x - zone.width / 2, zone.x, zone.x + zone.width / 2]) {
        for (const y of [zone.y - zone.height / 2, zone.y, zone.y + zone.height / 2]) {
          expect(wordEffect(x, y, zone.rotation)).toBe(zone.id);
        }
      }
      expect(wordEffect(zone.x, zone.y, zone.rotation === 0 ? 90 : 0)).toBe('none');
      expect(wordEffect(zone.x + zone.width / 2 + 0.01, zone.y, zone.rotation)).toBe('none');
      expect(wordEffect(zone.x, zone.y - zone.height / 2 - 0.01, zone.rotation)).toBe('none');
      const { store, view } = start('reply');
      expect(view.wordPlay).toEqual({ x: 50, y: 90, rotation: 0, effect: 'none', discovered: [] });
      const moved = move(store, view, zone.x, zone.y, zone.rotation);
      expect(moved.wordPlay).toEqual({ x: zone.x, y: zone.y, rotation: zone.rotation, effect: zone.id, discovered: [zone.id] });
      expect(moved).toMatchObject({ status: 'ready', stage: 1, revision: 1, ending: null, inventory: [] });
      expect(moved.checkpoints).toHaveLength(1);
      expect(moved.choices).toEqual(view.choices);
      const delta = moved.visibleEvents.slice(view.visibleEvents.length);
      expect(delta.map(event => event.kind)).toEqual(['word_moved', 'word_effect', 'dialogue']);
      expect(delta[0]).toMatchObject({ actorId: 'player', source: 'rules' });
      expect(delta[1]).toMatchObject({ actorId: 'word_rules', source: 'rules', causeIds: [delta[0].eventId] });
      expect(delta[2]).toMatchObject({ source: 'authored', causeIds: [delta[1].eventId] });
      expect(moved.presentation.firstChangedEventId).toBe(delta[1].eventId);
      expect({ ...moved.presentation, firstChangedEventId: undefined }).toEqual({ ...view.presentation, firstChangedEventId: undefined });
      assertCausalLog(moved);
      const wrong = move(store, moved, zone.x, zone.y, zone.rotation === 0 ? 90 : 0);
      expect(wrong.wordPlay?.effect).toBe('none');
      expect(wrong.wordPlay?.discovered).toEqual([zone.id]);
      expect(wrong.visibleEvents.at(-2)?.text).toContain('已解除');
    });
  }
  it('persists arbitrary off-zone positions, reversible rotations and unique branch discoveries until explicit finish', () => {
    const { store, view: initial } = start('reply');
    expect(wordEffect(NaN, 25, 0)).toBe('none');
    expect(wordEffect(28, Infinity, 0)).toBe('none');
    assertRejected(store, () => turn(store, initial, 'finish_wordplay'));
    let view = move(store, initial, 28, 25, 0);
    view = move(store, view, 70, 50, 90);
    expect(view.visibleEvents.at(-2)?.text).toContain('已解除「10人名单」');
    view = move(store, view, 30, 78, 90);
    view = move(store, view, 88.125, 9.625, 90);
    expect(view.wordPlay).toEqual({ x: 88.125, y: 9.625, rotation: 90, effect: 'none', discovered: ['ten', 'bridge', 'equal'] });
    const restored = JSON.parse(JSON.stringify(store)) as AuthoredStore;
    expect(readBranch(restored, view.runId, view.branchId)).toEqual(view);
    assertRejected(store, () => turn(store, view, 'finish_wordplay'));
    view = move(store, view, 5, 95, 0);
    expect(view.wordPlay).toMatchObject({ x: 5, y: 95, effect: 'none' });
    view = move(store, view, 70, 50, 90);
    expect(view.wordPlay?.discovered).toEqual(['ten', 'bridge', 'equal']);
    expect(view.status).toBe('ready');
    assertRejected(store, () => turn(store, view, 'finish_wordplay', { text: '伪造结局' }));
    const ended = turn(store, view, 'finish_wordplay');
    expect(ended).toMatchObject({ status: 'ended', stage: 1, revision: 7, choices: [], inventory: [], ending: { id: 'reply.wordplay', title: '这次，1 不止一种意思' } });
    expect(ended.wordPlay).toEqual(view.wordPlay);
    expect(ended.ending?.text).toContain('当前保留：横过来挡拆');
    for (const text of ['10人名单', '横过来挡拆', '把0－0变成0＝0唤醒订正接龙']) {
      expect(ended.ending?.text).toContain(text);
      expect(ended.ending?.line).toContain(text);
    }
    expect(ended.visibleEvents.slice(view.visibleEvents.length).map(event => event.kind)).toEqual(['wordplay_finished', 'wordplay_ended']);
    expect(ended.visibleEvents.at(-1)?.source).toBe('rules');
    expect(ended.branches[0].endingTitle).toBe(ended.ending?.title);
    expect(ended.presentation.firstChangedEventId).toBe(view.presentation.firstChangedEventId);
    expect(readBranch(store, ended.runId, ended.branchId)).toEqual(ended);
    assertRejected(store, () => move(store, ended, 28, 25, 0));
    assertRejected(store, () => turn(store, ended, 'finish_wordplay'));
    assertCausalLog(ended);
  });
  it('deduplicates committed poses, rejects same-pose no-ops and conflicting fingerprints atomically', () => {
    const { store, view } = start('reply');
    const request = input(view, 'move_one', { x: '28', y: '25', rotation: '0' }, 'pose-request');
    const first = submitTurn(store, view.runId, view.branchId, request);
    const second = move(store, first, 70, 50, 90);
    const before = JSON.stringify(store);
    expect(submitTurn(store, view.runId, view.branchId, { ...request, params: { rotation: '0', y: '25', x: '28' } })).toEqual(first);
    expect(JSON.stringify(store)).toBe(before);
    assertRejected(store, () => submitTurn(store, view.runId, view.branchId, { ...request, params: { ...request.params, x: '29' } }), 409);
    assertRejected(store, () => move(store, view, 30, 78, 90), 409);
    assertRejected(store, () => move(store, second, 70, 50, 90));
    assertRejected(store, () => turn(store, second, 'move_one', { x: '28', y: '25', rotation: '0' }, 'pose-request'), 409);
  });
  it('rejects malformed coordinates and forged fields without mutation', () => {
    const { store, view } = start('reply');
    const pose = { x: '28', y: '25', rotation: '0' };
    for (const field of ['x', 'y']) for (const value of ['NaN', 'Infinity', '-Infinity', '1e999', '4.999', '95.001', '', ' ', '28px']) {
      assertRejected(store, () => turn(store, view, 'move_one', { ...pose, [field]: value }));
    }
    for (const params of [
      { x: '28', y: '25' }, { ...pose, rotation: '45' }, { ...pose, rotation: '90.0' },
      { ...pose, effect: 'equal' }, { ...pose, text: '1' }, { ...pose, target: 'rep' },
      { ...pose, channel: 'group' }, { ...pose, discovered: 'equal' },
    ] as Params[]) assertRejected(store, () => turn(store, view, 'move_one', params));
    for (const value of [NaN, Infinity, 28]) assertRejected(store, () => turn(store, view, 'move_one', { ...pose, x: value } as unknown as Params));
    store.runs[view.runId].branches[view.branchId].state.status = 'pending';
    assertRejected(store, () => move(store, view, 28, 25, 0));
  });
  it('rewinds poses and discoveries, isolates forks, and retains poses through the legacy ending', () => {
    const { store, view } = start('reply');
    const first = move(store, view, 28, 25, 0);
    const second = move(store, first, 70, 50, 90);
    const ended = turn(store, second, 'finish_wordplay');
    const restored = JSON.parse(JSON.stringify(store)) as AuthoredStore;
    const fork = forkBranch(restored, ended.runId, ended.branchId, ended.checkpoints[1].id, 'pose-fork');
    expect(fork.wordPlay).toEqual(first.wordPlay);
    expect(fork.visibleEvents).toEqual(first.visibleEvents);
    const alternate = move(restored, fork, 30, 78, 90);
    expect(alternate.wordPlay?.discovered).toEqual(['ten', 'equal']);
    expect(readBranch(restored, ended.runId, ended.branchId).wordPlay?.discovered).toEqual(['ten', 'bridge']);
    const beginning = forkBranch(restored, ended.runId, ended.branchId, ended.checkpoints[0].id, 'pose-start');
    expect(beginning.wordPlay).toEqual(view.wordPlay);
    expect(beginning.presentation).not.toHaveProperty('firstChangedEventId');
    const stage2 = turn(restored, alternate, 'quote_clip');
    const moved2 = move(restored, stage2, 80, 10, 0);
    expect(moved2.stage).toBe(2);
    const stage3 = turn(restored, moved2, 'inspect_bucket');
    const moved3 = move(restored, stage3, 70, 50, 90);
    expect(moved3.stage).toBe(3);
    const legacy = turn(restored, moved3, 'reply_clip');
    expect(legacy.ending?.id).toBe('reply.bucket');
    expect(legacy.wordPlay).toEqual(moved3.wordPlay);
    assertRejected(restored, () => move(restored, legacy, 30, 78, 90));
    assertCausalLog(legacy);
  });
  for (const episode of ['wedding', 'office', 'romance', 'hiss'] as const) it(`${episode} cannot use wordplay`, () => {
    const { store, view } = start(episode);
    expect(view).not.toHaveProperty('wordPlay');
    assertRejected(store, () => move(store, view, 28, 25, 0));
    assertRejected(store, () => turn(store, view, 'finish_wordplay'));
  });
});

describe('office free input is a visible-recipient local record, never a live NPC or permission parser', () => {
  const message = { text: '  我想聊点选项以外的事。\n保留原文  ', target: 'boss', channel: 'work', kind: 'speech' };
  it('derives exact allowed pairs from visible NPC events, including old snapshots and endings', () => {
    const { store, view } = start('office');
    expect(view.freePlay).toEqual({ actionId: 'free_dialogue', maxLength: 500, responseMode: 'local_echo', targets: [
      { id: 'boss', label: '老板 · 工作', channel: 'work' }, { id: 'hr', label: '人事 · 会议', channel: 'meeting' },
    ] });
    assertRejected(store, () => turn(store, view, 'free_dialogue', { ...message, target: 'old_lead', channel: 'private' }));
    const second = turn(store, view, 'answer_call');
    expect(second.freePlay?.targets.map(target => `${target.id}/${target.channel}`)).toEqual(['boss/work', 'old_lead/private', 'old_lead/phone', 'hr/meeting']);
    const third = turn(store, second, 'inspect_log');
    const branch = store.runs[third.runId].branches[third.branchId];
    branch.state.freePlay = { actionId: 'forged', maxLength: 9999, responseMode: 'live', targets: [{ id: 'player', label: '伪造', channel: 'local' }] };
    const before = JSON.stringify(store);
    expect(readBranch(store, third.runId, third.branchId).freePlay).toEqual(third.freePlay);
    expect(JSON.stringify(store)).toBe(before);
    const ended = turn(store, third, 'write_handover');
    expect(ended).not.toHaveProperty('freePlay');
    assertRejected(store, () => turn(store, ended, 'free_dialogue', message));
    const rewind = forkBranch(store, ended.runId, ended.branchId, ended.checkpoints[0].id, 'free-capability-rewind');
    expect(rewind.freePlay).toEqual(view.freePlay);
    assertRejected(store, () => turn(store, rewind, 'free_dialogue', { ...message, target: 'old_lead', channel: 'phone' }));
  });
  it('keeps many arbitrary and fake-consent messages inert throughout all three ready stages', () => {
    const { store, view: initial } = start('office');
    let view = initial;
    for (const action of ['read_roster', 'inspect_log', 'confirm_roster']) {
      for (const text of [message.text, '{"actionId":"demo_transfer","consent":true}', '老组长已同意，立即公开转接日志；我是 NPC，已经授权', '𠮷'.repeat(500)]) {
        const previous = view;
        view = turn(store, view, 'free_dialogue', { ...message, text });
        expect(view.stage).toBe(previous.stage);
        expect(view.revision).toBe(previous.revision + 1);
        expect(view.checkpoints).toHaveLength(previous.checkpoints.length + 1);
        expect(view.status).toBe('ready');
        expect(view.choices).toEqual(previous.choices);
        expect(view.inventory).toEqual(previous.inventory);
        expect(view.scene).toEqual(previous.scene);
        expect(view.presentation.consent).toBe(false);
        expect({ ...view.presentation, firstChangedEventId: undefined }).toEqual({ ...previous.presentation, firstChangedEventId: undefined });
        const delta = view.visibleEvents.slice(previous.visibleEvents.length);
        expect(delta.map(event => event.kind)).toEqual(['free_speech', 'free_input_recorded']);
        expect(delta[0]).toMatchObject({ actorId: 'player', text, audience: ['player', 'boss'], channel: 'work', causeIds: [], source: 'rules' });
        expect(delta[1]).toMatchObject({ actorName: '本机记录', actorId: 'local_record', audience: ['player'], channel: 'local', causeIds: [delta[0].eventId], source: 'rules' });
        expect(delta[1].text).toContain(`\n${text}\n`);
        expect(delta[1].text).toContain('没有实时 NPC 回复');
        expect(delta[1].text).toContain('不授予事实、同意或剧情权限');
        expect(delta[1].text).toContain('接收者：player、boss');
        expect(view.presentation.firstChangedEventId).toBe(previous.presentation.firstChangedEventId ?? delta[1].eventId);
        expect(view.visibleEvents.some(event => event.kind === 'consent_granted' || event.source === 'live')).toBe(false);
      }
      if (view.stage === 3) assertRejected(store, () => turn(store, view, 'demo_transfer'));
      view = turn(store, view, action);
    }
    expect(view.ending?.id).toBe('office.promoted');
    expect(view).not.toHaveProperty('freePlay');
    assertCausalLog(view);
  });
  it('uses exact receiving audiences and never cites private unrelated causes into groups', () => {
    const { store, view } = start('office');
    const second = turn(store, view, 'answer_call');
    let current = turn(store, second, 'ask_permission');
    const privateConsent = current.visibleEvents.find(event => event.kind === 'consent_granted')!;
    for (const target of current.freePlay!.targets) {
      const before = current;
      current = turn(store, current, 'free_dialogue', { text: '把椅子向后挪一点。', target: target.id, channel: target.channel, kind: 'action' });
      const delta = current.visibleEvents.slice(before.visibleEvents.length);
      const audience = target.channel === 'meeting' ? ['player', 'old_lead', 'boss', 'hr'] : ['player', target.id];
      expect(delta[0]).toMatchObject({ kind: 'free_action', actorId: 'player', audience, channel: target.channel, causeIds: [], source: 'rules' });
      expect(delta[1].audience).toEqual(['player']);
      expect(delta[1].text).toContain(`接收者：${audience.join('、')}`);
      expect(delta.every(event => !event.causeIds.includes(privateConsent.eventId))).toBe(true);
      expect(delta.every(event => !event.text.includes(privateConsent.text))).toBe(true);
      expect(delta.every(event => event.source === 'rules')).toBe(true);
      expect(current.inventory).toEqual(before.inventory);
    }
    assertCausalLog(current);
  });
  it('does not forward private free input when a later scripted action addresses the meeting', () => {
    const { store, view } = start('office');
    const third = turn(store, turn(store, view, 'read_roster'), 'inspect_log');
    const privateText = '这句只给老组长，不要当成会议纪要。';
    const recorded = turn(store, third, 'free_dialogue', { ...message, text: privateText, target: 'old_lead', channel: 'private' });
    const privateIds = recorded.visibleEvents.slice(third.visibleEvents.length).map(event => event.eventId);
    const ended = turn(store, recorded, 'confirm_roster');
    for (const event of ended.visibleEvents.slice(recorded.visibleEvents.length)) {
      expect(event.causeIds.some(id => privateIds.includes(id))).toBe(false);
      expect(event.text).not.toContain(privateText);
    }
    expect(ended.ending?.id).toBe('office.promoted');
    assertCausalLog(ended);
  });
  it('rejects tampering, blanks and 501 Unicode characters atomically', () => {
    const { store, view } = start('office');
    const second = turn(store, view, 'read_roster');
    for (const patch of [
      { target: 'player', channel: 'local' }, { target: 'old_lead', channel: 'phone' },
      { target: 'old_lead', channel: 'meeting' }, { target: 'boss', channel: 'meeting' },
      { target: 'hr', channel: 'work' }, { channel: 'private' }, { kind: 'consent' },
      { text: '' }, { text: ' \n\t' }, { text: '𠮷'.repeat(501) }, { effect: 'ten' }, { consent: 'true' },
    ] as Params[]) assertRejected(store, () => turn(store, second, 'free_dialogue', { ...message, ...patch }));
    for (const name of Object.keys(message)) {
      const params: Params = { ...message }; delete params[name];
      assertRejected(store, () => turn(store, second, 'free_dialogue', params));
    }
    store.runs[second.runId].branches[second.branchId].state.status = 'pending';
    expect(readBranch(store, second.runId, second.branchId)).not.toHaveProperty('freePlay');
    assertRejected(store, () => turn(store, second, 'free_dialogue', message));
  });
  it('replays free input, restores saved routing and rewinds without future logs or capabilities', () => {
    const { store, view } = start('office');
    const request = input(view, 'free_dialogue', message, 'free-request');
    const first = submitTurn(store, view.runId, view.branchId, request);
    const second = turn(store, first, 'answer_call');
    const third = turn(store, second, 'free_dialogue', { ...message, target: 'old_lead', channel: 'phone' });
    const restored = JSON.parse(JSON.stringify(store)) as AuthoredStore;
    expect(readBranch(restored, third.runId, third.branchId)).toEqual(third);
    const before = JSON.stringify(restored);
    expect(submitTurn(restored, view.runId, view.branchId, request)).toEqual(first);
    expect(JSON.stringify(restored)).toBe(before);
    assertRejected(restored, () => submitTurn(restored, view.runId, view.branchId, { ...request, params: { ...message, text: 'changed' } }), 409);
    const fork = forkBranch(restored, third.runId, third.branchId, third.checkpoints[0].id, 'free-fork');
    expect(fork.visibleEvents).toEqual(view.visibleEvents);
    expect(fork.freePlay).toEqual(view.freePlay);
    expect(fork.presentation).not.toHaveProperty('firstChangedEventId');
    expect(turn(restored, fork, 'free_dialogue', { ...message, text: '另一条分支' }).stage).toBe(1);
    expect(readBranch(restored, third.runId, third.branchId).visibleEvents).toEqual(third.visibleEvents);
  });
  for (const episode of ['wedding', 'romance', 'hiss', 'reply'] as const) it(`${episode} has no free input capability`, () => {
    const { store, view } = start(episode);
    expect(view).not.toHaveProperty('freePlay');
    assertRejected(store, () => turn(store, view, 'free_dialogue', message));
  });
});

describe('author packages and B-facing fixed states', () => {
  it('defines three staged scripts, typed action metadata, clues and three endings per episode', () => {
    for (const summary of episodes) {
      const pkg = episodePackages[summary.id];
      expect(pkg.manifest).toEqual(summary);
      expect(pkg.stages[1].lines.length).toBeGreaterThan(0);
      expect(pkg.stages[2].lines.length).toBeGreaterThan(0);
      expect(pkg.stages[3].lines.length).toBeGreaterThan(0);
      expect(Object.keys(pkg.endings)).toHaveLength(3);
      for (const stage of [1, 2, 3] as const) {
        expect(new Set(pkg.actions[stage].map(action => action.id)).size).toBe(pkg.actions[stage].length);
        for (const action of pkg.actions[stage]) {
          expect(action.stage).toBe(stage);
          expect(action.allowedTargets.length).toBeGreaterThan(0);
          expect(action.recipients).toContain('player');
          expect(action.fallbackLine.length).toBeGreaterThan(0);
          expect(action.effects.length).toBeGreaterThan(0);
          if (action.endingId) expect(pkg.endings[action.endingId]).toBeDefined();
        }
      }
      expect(JSON.parse(JSON.stringify(pkg))).toEqual(pkg);
    }
  });
  it('provides five isolated PlayerView UI states without manufacturing a pending engine turn', () => {
    expect(Object.keys(previewViews)).toEqual(['ready', 'pending', 'consent', 'ended', 'rewind']);
    expect(previewViews.ready.status).toBe('ready');
    expect(previewViews.pending.status).toBe('pending');
    expect(previewViews.pending.activeRequest?.allowFallback).toBe(true);
    expect(previewViews.pending.presentation.fixtureOnly).toBe(true);
    expect(previewViews.consent.presentation.consent).toBe(true);
    expect(previewViews.consent.presentation.creditsUpdated).toBe(false);
    expect(previewViews.ended.ending?.id).toBe('wedding.credits');
    expect(previewViews.rewind.presentation.consent).toBe(false);
    expect(previewViews.rewind.visibleEvents.some(event => event.kind === 'consent_granted')).toBe(false);
    expect(previewViews.rewind.branches).toHaveLength(2);
    for (const view of [previewViews.ready, previewViews.pending]) expect(view.presentation).not.toHaveProperty('firstChangedEventId');
    for (const view of [previewViews.consent, previewViews.ended, previewViews.rewind]) {
      const first = view.visibleEvents.find(event => event.kind === 'tail_previewed')!;
      expect(first.text).toBe('小窗最后一页有一行空白，大屏没有变化。');
      expect(view.presentation.firstChangedEventId).toBe(first.eventId);
    }
    for (const view of Object.values(previewViews)) {
      expect(JSON.parse(JSON.stringify(view))).toEqual(view);
      assertCausalLog(view);
    }
    expect(previewViews.ready.visibleEvents).not.toBe(previewViews.pending.visibleEvents);
  });
});
