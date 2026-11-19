import { SCRIPT_VERSION, type PlayerView, type VisibleEvent } from '../../shared/contracts';

// Fixed UI review fixtures, not a site catalog or a future-script payload.
// Deliberately do not import the author engine or full episode packages here.
const runId = '00000000-0000-4000-8000-000000000001';
const branchId = '00000000-0000-4000-8000-000000000002';
const rewindId = '00000000-0000-4000-8000-000000000003';
const opening: VisibleEvent[] = [
  { eventId: '00000000-0000-4000-8000-000000000010', stage: 1, kind: 'dialogue', actorId: 'bride', actorName: '新娘', audience: ['player', 'bride'], channel: 'headset', causeIds: [], text: '放第二个，大学拍的那条。', source: 'authored' },
  { eventId: '00000000-0000-4000-8000-000000000011', stage: 1, kind: 'dialogue', actorId: 'groom', actorName: '新郎', audience: ['player', 'groom'], channel: 'headset', causeIds: [], text: '先别放，最后那一页再看一眼。', source: 'authored' },
];
const tail: VisibleEvent = { eventId: '00000000-0000-4000-8000-000000000012', stage: 1, kind: 'tail_previewed', actorId: 'player', actorName: '你', audience: ['player'], channel: 'local', causeIds: [opening[1].eventId], text: '小窗最后一页有一行空白，大屏没有变化。', source: 'rules' };
const privatePreview: VisibleEvent = { eventId: '00000000-0000-4000-8000-000000000013', stage: 2, kind: 'private_previewed', actorId: 'player', actorName: '你', audience: ['player', 'writer'], channel: 'private', causeIds: [tail.eventId], text: '电脑调出旧片尾，林禾看见空着的署名行。大屏没有同步。', source: 'rules' };
const consentEvent: VisibleEvent = { eventId: '00000000-0000-4000-8000-000000000014', stage: 2, kind: 'consent_granted', actorId: 'writer', actorName: '原编剧林禾', audience: ['player', 'writer'], channel: 'private', causeIds: [privatePreview.eventId], text: '让我自己改。我点头的是这个版本。', source: 'authored' };
const updateEvent: VisibleEvent = { eventId: '00000000-0000-4000-8000-000000000015', stage: 3, kind: 'credits_updated', actorId: 'writer', actorName: '原编剧林禾', audience: ['player', 'writer', 'bride', 'groom', 'boss', 'host', 'guests'], channel: 'screen', causeIds: [consentEvent.eventId], text: '林禾亲手确认的新片尾上了大屏：编剧 林禾。', source: 'rules' };
const firstCheckpoint = { id: '00000000-0000-4000-8000-000000000020', stage: 1, label: '第 1 拍前 · 拖到片尾预览' };
const secondCheckpoint = { id: '00000000-0000-4000-8000-000000000021', stage: 2, label: '第 2 拍前 · 现在播放给编剧私看' };
const thirdCheckpoint = { id: '00000000-0000-4000-8000-000000000022', stage: 3, label: '第 3 拍前 · 把电脑交给她编辑' };
const tailClue = { id: 'missing_credit', title: '片尾空了一行', text: '旧短剧片尾有演员、摄影，却没有原编剧林禾的署名。' };
const consentClue = { id: 'consent_granted', title: '她确认的版本', text: '林禾私下看过片尾，点头同意亲自补写署名；不是公开发言许可。' };
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const ready: PlayerView = {
  runId, branchId, episodeId: 'wedding', scriptVersion: SCRIPT_VERSION, revision: 0, stage: 1, status: 'ready',
  scene: { title: '鼠标别抖', kicker: '第一幕 · 开席', text: '台上已经报幕，第二个文件还没上大屏。', prop: '控屏电脑：照片 / 片头 / 片尾预览；大屏等待播放' },
  choices: [
    { actionId: 'preview_tail', label: '拖到片尾预览', control: 'button', targets: [{ id: 'player', label: '控台小窗', channel: 'local' }] },
    { actionId: 'hold_photos', label: '先留在照片', control: 'button', targets: [{ id: 'guests', label: '全场大屏', channel: 'screen' }] },
    { actionId: 'play_intro', label: '只播放片头', control: 'button', targets: [{ id: 'guests', label: '全场大屏', channel: 'screen' }] },
  ],
  visibleEvents: clone(opening), inventory: [], checkpoints: [], branches: [{ branchId, parentBranchId: null, label: '第一遍', endingTitle: null }], activeRequest: null, ending: null,
  presentation: { mode: 'authored', sourceLabel: '作者预演 · 预写对白', creditsUpdated: false, consent: false, playerSpoke: false, lastGesture: '', binding: '', sample: '', hissCount: 0, replyTarget: '', armed: false, sent: false },
};
const pending: PlayerView = {
  ...clone(ready), status: 'pending', choices: [],
  activeRequest: { requestId: 'fixture-pending-turn', actionId: 'preview_tail', label: '等待回合结果（固定 UI 样例）', startedAt: 1795046400000, allowFallback: true },
  presentation: { ...ready.presentation, fixtureOnly: true, pendingLabel: '仅用于核对等待状态；同步作者引擎不产生 pending' },
};
const consent: PlayerView = {
  ...clone(ready), revision: 2, stage: 3,
  scene: { title: '把控台交给谁', kicker: '第三幕 · 收场', text: '她点头同意亲自编辑，大屏还没有更新。', prop: '电脑小窗：林禾已点头，待本人编辑；大屏仍是旧内容；桌边话筒' },
  choices: [
    { actionId: 'lend_laptop', label: '把电脑交给她编辑', control: 'message', targets: [{ id: 'writer', label: '编剧 · 控台', channel: 'private' }] },
    { actionId: 'offer_mic', label: '把麦递到桌边', control: 'message', targets: [{ id: 'writer', label: '编剧 · 全场', channel: 'hall' }] },
    { actionId: 'play_original', label: '按原方案准点播放', control: 'button', targets: [{ id: 'guests', label: '全场大屏', channel: 'screen' }] },
  ],
  visibleEvents: clone([...opening, tail, privatePreview, consentEvent]), inventory: clone([tailClue, consentClue]), checkpoints: clone([firstCheckpoint, secondCheckpoint]),
  presentation: { ...ready.presentation, firstChangedEventId: tail.eventId, missing_credit: true, consent_granted: true, consent: true, consentEventId: consentEvent.eventId },
};
const ended: PlayerView = {
  ...clone(consent), revision: 3, status: 'ended', choices: [],
  scene: { title: '婚礼现场返工版', kicker: '谢幕 · 作者预演', text: '片尾出现编剧亲手确认的名字', prop: '全场片尾：编剧 林禾；电脑显示本人已确认的新版本' },
  visibleEvents: clone([...consent.visibleEvents, updateEvent]),
  inventory: clone([...consent.inventory, { id: 'credits_updated', title: '本人确认的新片尾', text: '林禾亲手敲入署名并确认播放。' }]),
  checkpoints: clone([firstCheckpoint, secondCheckpoint, thirdCheckpoint]),
  branches: [{ branchId, parentBranchId: null, label: '第一遍', endingTitle: '婚礼现场返工版' }],
  ending: { id: 'wedding.credits', title: '婚礼现场返工版', text: '片尾出现编剧亲手确认的名字', line: '这一行我自己写的。现在，大家吃饭吧。' },
  presentation: { ...consent.presentation, creditsUpdated: true, credits_updated: true, screen: 'updated_credits' },
};
const rewind: PlayerView = {
  ...clone(ready), branchId: rewindId, revision: 0, stage: 2,
  scene: { title: '十二桌的空隙', kicker: '第二幕 · 倒带后重新接戏', text: '玩家记得旧结局，现场还停在私看之前。', prop: '电脑小窗与全场投影分离；十二桌一把椅子向外挪' },
  choices: [
    { actionId: 'private_preview', label: '现在播放给编剧私看', control: 'message', targets: [{ id: 'writer', label: '编剧 · 私下', channel: 'private' }] },
    { actionId: 'watch_table', label: '看向十二桌', control: 'button', targets: [{ id: 'player', label: '桌边观察', channel: 'local' }] },
  ],
  visibleEvents: clone([...opening, tail]), inventory: clone([tailClue]), checkpoints: clone([firstCheckpoint]),
  branches: [{ branchId, parentBranchId: null, label: '第一遍', endingTitle: '婚礼现场返工版' }, { branchId: rewindId, parentBranchId: branchId, label: '倒带 · 第 2 拍', endingTitle: null }],
  presentation: { ...ready.presentation, firstChangedEventId: tail.eventId, missing_credit: true, rewind: true },
};

export const previewViews: Record<'ready' | 'pending' | 'consent' | 'ended' | 'rewind', PlayerView> = { ready, pending, consent, ended, rewind };
