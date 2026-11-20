import { GameError, SCRIPT_VERSION, type Checkpoint, type Choice, type EpisodeId, type FreePlay, type PlayerView, type TurnInput, type VisibleEvent, type WordPlay } from '../shared/contracts';
import { wordEffect } from '../shared/wordplay';
import { episodePackages, replyTargets, type AuthoredAction, type AuthoredLine, type EpisodePackage } from '../content/episodes';

// Plain JSON state. No timers, network, microphone, executable scripts or live actors.
type BranchState = Omit<PlayerView, 'checkpoints' | 'branches'>;
interface SavedCheckpoint { checkpoint: Checkpoint; state: BranchState }
interface SavedRequest { fingerprint: string; result: PlayerView }
interface AuthoredBranch {
  parentBranchId: string | null;
  label: string;
  state: BranchState;
  checkpoints: SavedCheckpoint[];
  requests: Record<string, SavedRequest>;
}
interface AuthoredRun {
  episodeId: EpisodeId;
  scriptVersion: string;
  branches: Record<string, AuthoredBranch>;
  forkKeys: Record<string, SavedRequest>;
}
export interface AuthoredStore {
  runs: Record<string, AuthoredRun>;
  createKeys: Record<string, SavedRequest>;
}

export function emptyStore(): AuthoredStore { return { runs: {}, createKeys: {} }; }
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const uuid = () => crypto.randomUUID();
const key = (value: string) => JSON.stringify(value);
const own = <T>(record: Record<string, T>, id: string): T | undefined => Object.hasOwn(record, id) ? record[id] : undefined;
function invalid(message: string): never { throw new GameError('ACTION_UNAVAILABLE', message, false, 422); }
function conflict(message: string): never { throw new GameError('VERSION_CONFLICT', message, false, 409); }
const latest = (state: BranchState) => state.visibleEvents.at(-1)?.eventId;
const causes = (...ids: (string | undefined)[]) => [...new Set(ids.filter((id): id is string => !!id))];
function validKey(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 128) invalid(`${label} 必须是 1–128 字符的非空字符串。`);
}
function getRun(store: AuthoredStore, runId: string): AuthoredRun {
  const run = own(store.runs, runId);
  if (!run) throw new GameError('NOT_FOUND', '找不到这场演出。', false, 404);
  return run;
}
function getBranch(run: AuthoredRun, branchId: string): AuthoredBranch {
  const branch = own(run.branches, branchId);
  if (!branch) throw new GameError('NOT_FOUND', '找不到这个分支。', false, 404);
  return branch;
}
function packageFor(state: BranchState): EpisodePackage { return episodePackages[state.episodeId]; }
function known(state: BranchState, fact: string): boolean {
  return state.presentation[fact] === true || state.inventory.some(item => item.id === fact);
}
function available(state: BranchState): AuthoredAction[] {
  if (state.status === 'ended') return [];
  return packageFor(state).actions[state.stage as 1 | 2 | 3].filter(item => item.preconditions.every(fact => known(state, fact)));
}
function choices(state: BranchState): Choice[] {
  return available(state).map(item => ({ actionId: item.id, label: item.label, control: item.control, targets: copy(item.allowedTargets),
    ...(state.episodeId === 'reply' && item.id in replyTargets ? { hint: `引用 ${String(state.presentation[`${item.id}ParentMessageId`])} · 正文只能是 1` } : {}),
  }));
}
function initialWordPlay(): WordPlay { return { x: 50, y: 90, rotation: 0, effect: 'none', discovered: [] }; }
function freePlayOf(state: BranchState): FreePlay | undefined {
  if (state.episodeId !== 'office' || state.status !== 'ready' || ![1, 2, 3].includes(state.stage)) return undefined;
  const candidates = [
    { id: 'boss', label: '老板 · 工作', channel: 'work' },
    { id: 'old_lead', label: '老组长 · 私聊', channel: 'private' },
    { id: 'old_lead', label: '老组长 · 电话', channel: 'phone' },
    { id: 'hr', label: '人事 · 会议', channel: 'meeting' },
  ];
  const targets = candidates.filter(target => state.visibleEvents.some(event => event.actorId === target.id
    && event.channel === target.channel && event.audience.includes('player')));
  return targets.length ? { actionId: 'free_dialogue', maxLength: 500, responseMode: 'local_echo', targets } : undefined;
}
const rootKinds = new Set(['player_action', 'reply_sent', 'word_moved', 'wordplay_finished', 'free_speech', 'free_action']);
function viewOf(run: AuthoredRun, branch: AuthoredBranch): PlayerView {
  // Later forks keep the opening checkpoint; rewinding the first decision clears it.
  const openingCount = branch.checkpoints[0]?.state.visibleEvents.length;
  const firstChangedEvent = openingCount === undefined ? undefined : branch.state.visibleEvents.slice(openingCount)
    .find(event => event.audience.includes('player') && !rootKinds.has(event.kind));
  return copy({ ...branch.state,
    // Derive capabilities even for old saves; ending/pending states cannot retain stale permissions.
    freePlay: freePlayOf(branch.state),
    ...(branch.state.episodeId === 'reply' ? { wordPlay: branch.state.wordPlay ?? initialWordPlay() } : {}),
    presentation: { ...branch.state.presentation, ...(firstChangedEvent ? { firstChangedEventId: firstChangedEvent.eventId } : {}) },
    visibleEvents: branch.state.visibleEvents.filter(event => event.audience.includes('player')),
    checkpoints: branch.checkpoints.map(item => item.checkpoint),
    branches: Object.entries(run.branches).map(([branchId, item]) => ({ branchId, parentBranchId: item.parentBranchId, label: item.label, endingTitle: item.state.ending?.title ?? null })),
  });
}
function emit(state: BranchState, kind: string, actorId: string, text: string, audience: string[], channel: string, causeIds: string[], source: 'rules' | 'authored' = 'rules', actorName?: string): VisibleEvent {
  const event: VisibleEvent = { eventId: uuid(), stage: state.stage, kind, actorId,
    actorName: actorName ?? (actorId === 'player' ? '你' : packageFor(state).actors.find(actor => actor.id === actorId)?.name ?? actorId),
    audience: [...new Set(audience)], channel, causeIds: causes(...causeIds), text, source };
  // This fixture retains only the player's observable log, with exact delivery audiences.
  if (!event.audience.includes('player')) throw new Error('Author event is outside the player projection.');
  state.visibleEvents.push(event);
  return event;
}
function speak(state: BranchState, actorId: string, text: string, audience: string[], channel: string, causeIds: string[], actorName?: string) {
  return emit(state, 'dialogue', actorId, text, audience, channel, causeIds, 'authored', actorName);
}
function gain(state: BranchState, fact: string) {
  const item = packageFor(state).facts[fact];
  if (item && !state.inventory.some(entry => entry.id === fact)) state.inventory.push(copy(item));
  state.presentation[fact] = true;
}
function stageLines(state: BranchState, lines: AuthoredLine[], causeIds: string[]) {
  lines.forEach((item, index) => {
    // Stage progression is not disclosure: a generic line cannot cite another actor's private evidence.
    const observedCauses = causeIds.filter(id => state.visibleEvents.some(event => event.eventId === id && event.audience.includes(item.actorId)));
    const event = emit(state, item.kind ?? 'dialogue', item.actorId, item.text, item.audience, item.channel, observedCauses, 'authored', item.actorName);
    if (state.episodeId === 'reply' && (state.stage === 1 || state.stage === 3)) {
      const suffix = ['clip', 'game', 'homework'][index];
      if (suffix) state.presentation[`${state.stage === 1 ? 'quote' : 'reply'}_${suffix}ParentMessageId`] = event.eventId;
    }
  });
}
function enterStage(state: BranchState, stage: number, causeIds: string[]) {
  state.stage = stage;
  const content = packageFor(state).stages[stage as 1 | 2 | 3];
  state.scene = copy(content.scene);
  if (state.episodeId === 'wedding' && stage === 3) state.scene.prop = state.presentation.consent
    ? '电脑小窗：林禾已点头，待本人编辑；大屏仍是旧内容；桌边话筒'
    : '十二桌椅子向外挪；桌边话筒；旧片播放键（尚无编辑许可）';
  if (state.episodeId === 'office' && stage === 3) state.scene.prop = state.presentation.consent
    ? '本人已同意的转接演示；会议纪要尚未公开人工值守事实'
    : known(state, 'transfer_log') ? '玩家已查看的转接日志；书面交接单；会议排班确认键' : '新排班表；会议纪要；尚未确认的异常接听人';
  if (state.episodeId === 'romance' && stage === 3) state.scene.prop = known(state, 'draft')
    ? '未发送草稿“见。想吃烤肉。”；只允许向选中窗口发送一次' : '已对齐的上周四时间轴；退堂鼓 / 汽水收件人选择';
  if (state.episodeId === 'hiss' && stage === 3) state.scene.prop = `声控键 ${state.presentation.binding}：${state.presentation.sample} 已录入并松开；下一声新哈气才匹配`;
  stageLines(state, content.lines, causeIds);
  state.choices = choices(state);
}
function initialState(episodeId: EpisodeId, runId: string, branchId: string): BranchState {
  const state: BranchState = {
    runId, branchId, episodeId, scriptVersion: SCRIPT_VERSION, revision: 0, stage: 1, status: 'ready',
    scene: copy(episodePackages[episodeId].stages[1].scene), choices: [], visibleEvents: [], inventory: [], activeRequest: null, ending: null,
    presentation: { mode: 'authored', sourceLabel: '作者预演 · 预写对白', creditsUpdated: false, consent: false, playerSpoke: false,
      lastGesture: '', binding: '', sample: '', hissCount: 0, replyTarget: '', armed: false, sent: false },
  };
  if (episodeId === 'reply') state.wordPlay = initialWordPlay();
  enterStage(state, 1, []);
  if (episodeId === 'romance') {
    state.presentation.friendForwardPreviewEventId = state.visibleEvents.find(event => event.channel === 'soda')!.eventId;
    state.presentation.friendForwardPreview = state.visibleEvents.find(event => event.channel === 'soda')!.text;
    state.presentation.friendReceivedEventId = '';
  }
  return state;
}

export function createRun(store: AuthoredStore, episodeId: EpisodeId, createKey: string): PlayerView {
  validKey(createKey, 'createKey');
  if (!Object.hasOwn(episodePackages, episodeId)) invalid('未知剧目。');
  const fingerprint = JSON.stringify({ episodeId });
  const saved = own(store.createKeys, key(createKey));
  if (saved) {
    if (saved.fingerprint !== fingerprint) conflict('同一个 createKey 不能创建不同剧目。');
    return copy(saved.result);
  }
  const runId = uuid(), branchId = uuid();
  const branch: AuthoredBranch = { parentBranchId: null, label: '第一遍', state: initialState(episodeId, runId, branchId), checkpoints: [], requests: {} };
  const run: AuthoredRun = { episodeId, scriptVersion: SCRIPT_VERSION, branches: { [branchId]: branch }, forkKeys: {} };
  const result = viewOf(run, branch);
  store.runs[runId] = run;
  store.createKeys[key(createKey)] = { fingerprint, result: copy(result) };
  return result;
}
export function readBranch(store: AuthoredStore, runId: string, branchId: string): PlayerView {
  const run = getRun(store, runId);
  return viewOf(run, getBranch(run, branchId));
}

function validateInput(input: TurnInput) {
  if (!input || typeof input !== 'object') invalid('回合输入无效。');
  validKey(input.requestId, 'requestId');
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0 || !Number.isInteger(input.stage) || input.stage < 1 || input.stage > 3) invalid('stage / expectedRevision 无效。');
  if (typeof input.actionId !== 'string' || !input.actionId) invalid('actionId 不能为空。');
  if (!input.params || typeof input.params !== 'object' || Array.isArray(input.params) || Object.values(input.params).some(value => typeof value !== 'string')) invalid('params 必须是字符串键值对象。');
}
function fingerprintOf(input: TurnInput) {
  return JSON.stringify({ requestId: input.requestId, expectedRevision: input.expectedRevision, stage: input.stage, actionId: input.actionId,
    params: Object.fromEntries(Object.entries(input.params).sort(([a], [b]) => a.localeCompare(b))) });
}
interface ValidatedAction { kind: 'authored'; action: AuthoredAction; target: string; channel: string; parentMessageId?: string; sample?: string; sampleEventId?: string; forwardEventId?: string }
type SpecialAction =
  | { kind: 'move_one'; label: string; x: number; y: number; rotation: WordPlay['rotation'] }
  | { kind: 'finish_wordplay'; label: string }
  | { kind: 'free_dialogue'; label: string; target: FreePlay['targets'][number]; inputKind: 'speech' | 'action' };
function exactParams(input: TurnInput, names: string[]) {
  if (Object.keys(input.params).length !== names.length || names.some(name => !Object.hasOwn(input.params, name))) invalid('这个动作需要且只接受指定参数。');
}
function coordinate(value: string): number {
  const number = Number(value);
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value) || !Number.isFinite(number) || number < 5 || number > 95) invalid('坐标必须是 5–95 之间的有限数值。');
  return number;
}
function validateAction(state: BranchState, input: TurnInput): ValidatedAction | SpecialAction {
  if (state.status !== 'ready') invalid('本分支当前不可操作；已谢幕时请先倒带。');
  if (input.actionId === 'move_one' || input.actionId === 'finish_wordplay') {
    if (state.episodeId !== 'reply') invalid('只有数字 1 的舞台允许文字摆放。');
    const pose = state.wordPlay ?? initialWordPlay();
    if (input.actionId === 'finish_wordplay') {
      exactParams(input, []);
      if (pose.effect === 'none') invalid('先保留一个有效组合，再主动谢幕。');
      return { kind: 'finish_wordplay', label: '以当前文字组合谢幕' };
    }
    exactParams(input, ['x', 'y', 'rotation']);
    const x = coordinate(input.params.x), y = coordinate(input.params.y);
    if (input.params.rotation !== '0' && input.params.rotation !== '90') invalid('数字 1 只能直立或旋转 90 度。');
    const rotation = input.params.rotation === '0' ? 0 : 90;
    if (pose.x === x && pose.y === y && pose.rotation === rotation) invalid('数字 1 的位置与方向没有变化。');
    return { kind: 'move_one', label: '移动数字 1', x, y, rotation };
  }
  if (input.actionId === 'free_dialogue') {
    exactParams(input, ['text', 'target', 'channel', 'kind']);
    const capability = freePlayOf(state);
    if (!capability) invalid('当前舞台没有自由输入能力。');
    const target = capability.targets.find(item => item.id === input.params.target && item.channel === input.params.channel);
    if (!target) invalid('只能向本分支已经看见的指定人物与频道发送。');
    if (!input.params.text.trim() || Array.from(input.params.text).length > capability.maxLength) invalid('原文必须是 1–500 个字符，不能只有空白。');
    if (input.params.kind !== 'speech' && input.params.kind !== 'action') invalid('自由输入只能是 speech 或 action。');
    return { kind: 'free_dialogue', label: `本机记录 · ${target.label}`, target, inputKind: input.params.kind };
  }
  const action = available(state).find(item => item.id === input.actionId);
  if (!action) invalid('当前幕没有解锁这个动作，或尚未满足前提。');
  const permitted = new Set(['target', 'channel', 'text']);
  const isBinding = state.episodeId === 'hiss' && state.stage === 2;
  if (isBinding) { permitted.add('sample'); permitted.add('sampleEventId'); }
  const replyRef = state.episodeId === 'reply' && Object.hasOwn(replyTargets, action.id)
    ? replyTargets[action.id as keyof typeof replyTargets] : undefined;
  if (replyRef) permitted.add('parentMessageId');
  if (state.episodeId === 'romance' && action.id === 'ask_friend') permitted.add('forwardEventId');
  if (Object.keys(input.params).some(name => !permitted.has(name))) invalid('这个动作不接受该参数。');
  const text = input.params.text;
  if (text !== undefined && (Array.from(text).length > 80 || !text.trim())) invalid('措辞必须是 1–80 个字符。');
  if (action.id === 'custom_gesture' && !text) invalid('请写下要表演的动作。');
  // Free text is inert wording for this already-unlocked action, never a fact/permission parser.
  const selected = action.allowedTargets.find(item => item.id === (input.params.target ?? action.allowedTargets[0].id)
    && item.channel === (input.params.channel ?? action.allowedTargets[0].channel));
  if (!selected) invalid('收件人或频道不属于这个动作。');
  const result: ValidatedAction = { kind: 'authored', action, target: selected.id, channel: selected.channel };
  if (replyRef) {
    if (text !== undefined && text !== '1') invalid('这个角色的正文始终只能是“1”。');
    const parentMessageId = String(state.presentation[`${action.id}ParentMessageId`] ?? '');
    const parent = state.visibleEvents.find(event => event.eventId === parentMessageId && event.audience.includes('player'));
    if (!parent || parent.actorId !== replyRef.target || parent.channel !== replyRef.channel || selected.id !== replyRef.target) invalid('引用楼层尚不可见或目标不匹配。');
    if (input.params.parentMessageId !== undefined && input.params.parentMessageId !== parentMessageId) invalid('parentMessageId 与当前动作、目标楼层不匹配。');
    result.parentMessageId = parentMessageId;
  }
  if (isBinding) {
    const sample = input.params.sample ?? 'cat_hiss';
    if (sample !== 'cat_hiss' && sample !== 'player_word') invalid('只能使用剧内 cat_hiss / player_word 样本。');
    if (input.params.sampleEventId !== undefined) {
      const event = state.visibleEvents.find(item => item.eventId === input.params.sampleEventId && item.audience.includes('player'));
      if (!event || (sample === 'cat_hiss' ? event.kind !== 'hiss_emitted' || event.actorId !== 'cat' : event.kind !== 'player_word_recorded' || event.actorId !== 'player')) invalid('声纹不是本分支已获得的对应样本。');
      result.sampleEventId = event.eventId;
    }
    result.sample = sample;
  }
  if (state.episodeId === 'romance' && action.id === 'ask_friend') {
    const forwardEventId = input.params.forwardEventId ?? String(state.presentation.friendForwardPreviewEventId);
    const original = state.visibleEvents.find(event => event.eventId === forwardEventId);
    if (!original || original.actorId !== 'soda' || !original.audience.includes('player') || !['soda', 'coach'].includes(original.channel)) invalid('只能转发本分支已预览的历史消息，不能转发草稿。');
    result.forwardEventId = original.eventId;
  }
  return result;
}

const weddingAudience = ['player', 'writer', 'bride', 'groom', 'boss', 'host', 'guests'];
const meetingAudience = ['player', 'old_lead', 'boss', 'hr'];
const groupAudience = ['player', 'owner', 'baller', 'rep', 'filmer'];
function actionEvent(state: BranchState, input: TurnInput, valid: ValidatedAction, causeIds: string[]) {
  const romanceSend = state.episodeId === 'romance' && state.stage === 3;
  const forwarding = state.episodeId === 'romance' && input.actionId === 'ask_friend';
  const defaultText = romanceSend ? input.actionId === 'send_original' ? '见。想吃烤肉。'
    : input.actionId === 'ask_coach' ? '你自己会怎么约？'
    : `我把聊天转给军师。${known(state, 'message_forwarded') ? '也把一段预览发给阿圆。' : '没有转给阿圆。'}你是从哪天认出我的？` : valid.action.label;
  const text = state.episodeId === 'reply' && valid.parentMessageId ? '1' : input.params.text ?? defaultText;
  const audience = state.episodeId === 'reply' && valid.parentMessageId ? groupAudience
    : forwarding ? ['player'] : state.episodeId === 'hiss' && state.stage !== 2 ? ['player', 'cat', 'camera']
    : state.episodeId === 'wedding' && ['hall', 'screen'].includes(valid.channel) ? weddingAudience
    : state.episodeId === 'office' && valid.channel === 'meeting' ? meetingAudience
    : valid.action.recipients;
  const kind = valid.parentMessageId ? 'reply_sent' : romanceSend
    ? input.actionId === 'send_original' ? 'draft_sent' : input.actionId === 'disclose_forwarding' ? 'forwarding_disclosed' : 'message_sent'
    : 'player_action';
  // A later scripted action must not forward a local/private free-input record by causal reference.
  const observedCauses = causeIds.filter(id => state.visibleEvents.some(event => event.eventId === id
    && audience.every(actorId => event.audience.includes(actorId))));
  return emit(state, kind, 'player', text, audience, forwarding ? 'local' : valid.channel, causes(...observedCauses, valid.parentMessageId));
}
function finish(state: BranchState, endingId: string, causeIds: string[], actorId: string, audience: string[], channel: string, prop?: string) {
  const content = packageFor(state).endings[endingId];
  // Only the reached ending is projected; author triggers and future paths never leave the fixture.
  state.ending = { id: content.id, title: content.title, text: content.visibleResult, line: content.line };
  if (state.episodeId === 'hiss') {
    const gesture = String(state.presentation.lastGesture);
    if (endingId === 'hiss.cover') {
      state.ending.line = gesture === 'hiss_back' ? '左边那只怎么还穿着衣服？别裁，他刚才也哈了。'
        : gesture === 'bow' ? '现在才鞠躬？行，这声哈就当替你签收了。' : `把“${gesture}”留在封面上，左边这位也算出镜。`;
    } else if (endingId === 'hiss.duet') {
      state.ending.line = state.presentation.playerSpoke ? `右边原版，左边翻唱；“${gesture}”这一拍别剪掉。`
        : `耄耋独唱，特邀嘉宾负责挨哈。左边这位的“${gesture}”保留。`;
    } else state.ending.line = gesture === 'bow' ? '礼貌告辞也得签收一声哈。老师，我先回评论区了。' : `这声哈把“${gesture}”一起送出去了。老师先走一步。`;
    state.presentation.exportPlayerSpoke = state.presentation.playerSpoke;
    state.presentation.exportLastGesture = gesture;
  }
  state.status = 'ended';
  state.choices = [];
  state.scene = { title: content.title, kicker: '谢幕 · 作者预演', text: content.visibleResult, prop: prop ?? content.visibleResult };
  speak(state, actorId, state.ending.line, audience, channel, causeIds,
    state.episodeId === 'romance' ? '汽水' : undefined);
}
function wedding(state: BranchState, valid: ValidatedAction, root: VisibleEvent) {
  const id = valid.action.id;
  const c = [root.eventId];
  switch (id) {
    case 'preview_tail': {
      gain(state, 'missing_credit');
      state.presentation.screen = 'waiting';
      emit(state, 'tail_previewed', 'player', valid.action.fallbackLine, ['player'], 'local', c);
      break;
    }
    case 'hold_photos': state.presentation.screen = 'photos'; emit(state, 'photos_held', 'player', valid.action.fallbackLine, weddingAudience, 'screen', c); break;
    case 'play_intro': state.presentation.screen = 'intro'; emit(state, 'intro_screened', 'player', valid.action.fallbackLine, weddingAudience, 'screen', c); break;
    case 'private_preview': {
      gain(state, 'missing_credit');
      const preview = emit(state, 'private_previewed', 'player', '电脑调出旧片尾，林禾看见空着的署名行。大屏没有同步。', ['player', 'writer'], 'private', c);
      const consent = emit(state, 'consent_granted', 'writer', valid.action.fallbackLine, ['player', 'writer'], 'private', [preview.eventId], 'authored');
      gain(state, 'consent_granted');
      state.presentation.consent = true;
      state.presentation.consentEventId = consent.eventId;
      break;
    }
    case 'watch_table': gain(state, 'chair_seen'); emit(state, 'chair_seen', 'player', valid.action.fallbackLine, ['player'], 'local', c); break;
    case 'lend_laptop': {
      const edited = speak(state, 'writer', valid.action.fallbackLine, ['player', 'writer'], 'private', causes(root.eventId, String(state.presentation.consentEventId)));
      const updated = emit(state, 'credits_updated', 'writer', '林禾亲手确认的新片尾上了大屏：编剧 林禾。', weddingAudience, 'screen', [edited.eventId, String(state.presentation.consentEventId)]);
      gain(state, 'credits_updated');
      state.presentation.creditsUpdated = true;
      state.presentation.screen = 'updated_credits';
      speak(state, 'boss', '实时改片怎么报价？我在交接单上加一行。', ['player', 'boss'], 'headset', [updated.eventId]);
      speak(state, 'bride', '这次名字都在了。谢谢，放完这一页。', weddingAudience, 'hall', [updated.eventId]);
      finish(state, 'wedding.credits', [updated.eventId], 'writer', weddingAudience, 'hall', '全场片尾：编剧 林禾；电脑显示本人已确认的新版本');
      return;
    }
    case 'offer_mic': {
      const declined = emit(state, 'mic_declined', 'writer', valid.action.fallbackLine, weddingAudience, 'hall', c, 'authored');
      const waiter = speak(state, 'waiter', '小心盘子烫。', [...weddingAudience, 'waiter'], 'hall', [declined.eventId]);
      state.presentation.micHolder = 'waiter';
      finish(state, 'wedding.fish', [waiter.eventId], 'writer', weddingAudience, 'hall', '麦在服务员手里；十二桌中央放下一盘鱼；署名未更新');
      return;
    }
    case 'play_original': {
      const original = emit(state, 'original_screened', 'player', valid.action.fallbackLine, weddingAudience, 'screen', c);
      state.presentation.screen = 'original';
      state.presentation.handoverGreen = true;
      finish(state, 'wedding.on_time', [original.eventId], 'boss', ['player', 'boss'], 'headset', '设备交接单全绿；十二桌合照空了一把椅子；旧片尾未补名');
      return;
    }
  }
  enterStage(state, state.stage + 1, causes(latest(state)));
}
function office(state: BranchState, valid: ValidatedAction, root: VisibleEvent) {
  const id = valid.action.id, c = [root.eventId];
  switch (id) {
    case 'read_roster': gain(state, 'roster'); emit(state, 'roster_read', 'player', valid.action.fallbackLine, ['player'], 'local', c); break;
    case 'answer_call': gain(state, 'call'); speak(state, 'old_lead', valid.action.fallbackLine, ['player', 'old_lead'], 'phone', c); break;
    case 'open_meeting': emit(state, 'meeting_opened', 'player', valid.action.fallbackLine, meetingAudience, 'meeting', c); break;
    case 'ask_permission': {
      const consent = emit(state, 'consent_granted', 'old_lead', valid.action.fallbackLine, ['player', 'old_lead'], 'private', c, 'authored');
      gain(state, 'consent_granted'); state.presentation.consent = true; state.presentation.consentEventId = consent.eventId;
      break;
    }
    case 'inspect_log': gain(state, 'transfer_log'); emit(state, 'log_inspected', 'player', valid.action.fallbackLine, ['player'], 'local', c); break;
    case 'demo_transfer': {
      const transfer = emit(state, 'transfer_demonstrated', 'old_lead', '会议现场再次拨号，老组长口袋里的手机亮起：夜间异常单人工接听。', meetingAudience, 'meeting', causes(root.eventId, String(state.presentation.consentEventId)));
      speak(state, 'old_lead', valid.action.fallbackLine, meetingAudience, 'meeting', [transfer.eventId]);
      speak(state, 'hr', '人工值守、负责人和轮班，我现在补进纪要。', meetingAudience, 'meeting', [transfer.eventId]);
      state.presentation.minutesUpdated = true;
      finish(state, 'office.rest', [transfer.eventId], 'old_lead', meetingAudience, 'meeting', '纪要：夜间人工值守；负责人老组长；轮班安排待排定'); return;
    }
    case 'write_handover': {
      const signed = emit(state, 'handover_signed', 'old_lead', valid.action.fallbackLine, ['player', 'old_lead'], 'private', c, 'authored');
      gain(state, 'handover_signed'); state.presentation.phoneAtBedside = false;
      finish(state, 'office.handover', [signed.eventId], 'old_lead', ['player', 'old_lead'], 'private', '已签书面纪要：工作时段接听，夜间按值守表转接；手机离开枕边'); return;
    }
    case 'confirm_roster': {
      const changed = emit(state, 'forwarding_changed', 'hr', valid.action.fallbackLine, meetingAudience, 'meeting', c);
      state.presentation.nightReceiver = 'player';
      const call = emit(state, 'night_call', 'player', '23:00，玩家自己的手机响了。', ['player'], 'phone', [changed.eventId]);
      finish(state, 'office.promoted', [call.eventId], 'player', ['player'], 'phone', '23:00 · 新组长手机来电；异常转接联系人已改成玩家'); return;
    }
  }
  enterStage(state, state.stage + 1, causes(latest(state)));
}
function romance(state: BranchState, input: TurnInput, valid: ValidatedAction, root: VisibleEvent) {
  const id = valid.action.id, c = [root.eventId];
  switch (id) {
    case 'open_chats': {
      emit(state, 'chats_opened', 'player', valid.action.fallbackLine, ['player'], 'local', c);
      speak(state, 'soda', '上周三 20:30 · 你喜欢吃什么？我先记一下。', ['player', 'soda'], 'soda', c, '汽水');
      speak(state, 'soda', '上周三 20:31 · 你可以先问他喜欢吃什么。', ['player', 'soda'], 'coach', c, '退堂鼓');
      break;
    }
    case 'ask_friend': {
      const original = state.visibleEvents.find(event => event.eventId === valid.forwardEventId)!;
      const forwarded = emit(state, 'message_forwarded', 'player', `转发预览已确认：${original.text}${input.params.text ? `\n附言：${input.params.text}` : ''}`, ['player', 'friend'], 'friend', [root.eventId, original.eventId]);
      state.presentation.friendReceivedEventId = forwarded.eventId;
      gain(state, 'message_forwarded');
      // Original event IDs are causal links, not delivery of the entire soda conversation.
      speak(state, 'friend', valid.action.fallbackLine, ['player', 'friend'], 'friend', [forwarded.eventId]);
      break;
    }
    case 'compare_thursday': {
      gain(state, 'thursday');
      const compared = emit(state, 'thursday_compared', 'player', packageFor(state).facts.thursday.text, ['player'], 'local', c);
      speak(state, 'soda', '上周四 21:14 · 你自己想说什么？这一句我不替你拟。', ['player', 'soda'], 'coach', [compared.eventId], '退堂鼓');
      emit(state, 'input_cancelled', 'soda', '上周四 21:14 · 汽水正在输入，随后取消。', ['player', 'soda'], 'soda', [compared.eventId], 'authored', '汽水');
      break;
    }
    case 'find_draft': gain(state, 'draft'); emit(state, 'draft_found', 'player', '未发送 · 见。想吃烤肉。', ['player'], 'local', c); break;
    case 'ask_coach': {
      state.presentation.sent = true; state.presentation.activeWindow = 'both';
      const first = emit(state, 'tickets_sent', 'soda', '退堂鼓 · 排号：烤肉 A17 / 面馆 B08 / 火锅 C12。', ['player', 'soda'], 'coach', c, 'authored', '退堂鼓');
      const second = emit(state, 'tickets_sent', 'soda', '汽水 · 排号：烤肉 A17 / 面馆 B08 / 火锅 C12。等等，刚才另一边也是我。', ['player', 'soda'], 'soda', [first.eventId], 'authored', '汽水');
      finish(state, 'romance.queues', [second.eventId], 'soda', ['player', 'soda'], 'soda', '两个窗口先后显示同一份三家餐厅排号'); return;
    }
    case 'disclose_forwarding': {
      state.presentation.sent = true; state.presentation.activeWindow = 'soda'; state.presentation.meetingPaused = true;
      speak(state, 'soda', valid.action.fallbackLine, ['player', 'soda'], 'soda', [root.eventId], '汽水');
      finish(state, 'romance.tomorrow', [root.eventId], 'soda', ['player', 'soda'], 'soda', '汽水窗口：认出日期为上周四；明天见面暂停；转发边界已说明'); return;
    }
    case 'send_original': {
      state.presentation.sent = true; state.presentation.activeWindow = 'soda'; state.presentation.draftSent = true;
      const reply = speak(state, 'soda', valid.action.fallbackLine, ['player', 'soda'], 'soda', [root.eventId], '汽水');
      finish(state, 'romance.bbq', [reply.eventId], 'soda', ['player', 'soda'], 'soda', '只亮汽水窗口：好。我把另两家取消。退堂鼓窗口不再发送'); return;
    }
  }
  enterStage(state, state.stage + 1, causes(latest(state)));
}
function hiss(state: BranchState, input: TurnInput, valid: ValidatedAction, root: VisibleEvent, newHiss: VisibleEvent) {
  const id = valid.action.id;
  gain(state, 'cat_hiss');
  if (state.stage === 2) {
    const sample = valid.sample!;
    let sampleEventId = valid.sampleEventId ?? newHiss.eventId;
    if (sample === 'player_word' && !valid.sampleEventId) {
      state.presentation.playerSpoke = true;
      sampleEventId = emit(state, 'player_word_recorded', 'player', '玩家念词；剧内预制声纹 player_word。', ['player', 'camera'], 'scene', [root.eventId]).eventId;
    }
    gain(state, sample);
    const captured = emit(state, 'sample_captured', 'player', `录入 ${sample}，录入期间只收音，不触发。`, ['player'], 'local', causes(root.eventId, sampleEventId));
    const binding = id.replace('bind_', '');
    const bound = emit(state, 'shortcut_bound', 'player', `${binding} 绑定到 ${sample}。`, ['player'], 'local', [captured.eventId]);
    const armed = emit(state, 'shortcut_armed', 'player', '松开录音键。只接受绑定之后的新哈气。', ['player'], 'local', [bound.eventId]);
    state.presentation.binding = binding; state.presentation.sample = sample; state.presentation.sampleEventId = sampleEventId;
    state.presentation.armed = true; state.presentation.armedEventId = armed.eventId;
    state.presentation.armedHissCount = Number(state.presentation.hissCount);
    enterStage(state, 3, [armed.eventId]);
    return;
  }
  state.presentation.lastGesture = id === 'custom_gesture' ? input.params.text : id;
  state.presentation.position = id === 'move_aside' ? 'left' : id === 'step_back' ? 'far' : 'front';
  if (id === 'hiss_back') {
    state.presentation.playerSpoke = true;
    emit(state, 'player_hiss', 'player', input.params.text ?? '哈！', ['player', 'camera'], 'scene', [root.eventId]);
  }
  speak(state, 'camera', valid.action.fallbackLine, ['player', 'camera'], 'scene', [root.eventId]);
  if (state.stage === 1) { enterStage(state, 2, [root.eventId, newHiss.eventId]); return; }
  if (state.presentation.sample !== 'cat_hiss') {
    const mismatch = emit(state, 'sample_mismatch', 'player', '口令没对上：猫哈的是 cat_hiss，不是 player_word。已试波形保留，请重绑。', ['player'], 'local', causes(newHiss.eventId, String(state.presentation.armedEventId)));
    state.presentation.armed = false;
    enterStage(state, 2, [mismatch.eventId]);
    state.scene.prop = '口令未匹配；已试 player_word 波形保留；回到绑定设置，可重录 cat_hiss';
    return;
  }
  if (Number(state.presentation.hissCount) <= Number(state.presentation.armedHissCount)) invalid('必须使用松开录音键之后的新哈气。');
  const fired = emit(state, 'shortcut_fired', 'player', `新的 cat_hiss 匹配，执行 ${state.presentation.binding}。`, ['player'], 'local', causes(newHiss.eventId, String(state.presentation.armedEventId)));
  state.presentation.armed = false;
  const binding = String(state.presentation.binding);
  const effect = binding === 'back' ? 'comment_returned' : binding === 'cover' ? 'cover_saved' : 'duet_created';
  const audience = binding === 'back' ? ['player', 'comments'] : ['player', 'editor'];
  let prop: string;
  if (binding === 'back') {
    state.presentation.commentDraft = '首先，要和小动物建立信任';
    prop = '本集虚构评论区：“换我来”仍在；输入框预填信任教程，尚未发送';
  } else if (binding === 'cover') {
    state.presentation.coverComment = state.presentation.lastGesture === 'hiss_back' ? '左边那只怎么穿衣服'
      : state.presentation.lastGesture === 'bow' ? '现在道歉是不是稍微有点晚了' : `左边那位的动作是：${state.presentation.lastGesture}`;
    prop = `封面：猫在右，玩家${state.presentation.position}；最后动作 ${state.presentation.lastGesture}；热评 ${state.presentation.coverComment}`;
  } else {
    state.presentation.duetTitle = state.presentation.playerSpoke ? '原版在右，翻唱在左' : '耄耋独唱，特邀嘉宾负责挨哈';
    prop = `左右合拍：玩家在左、猫在右；${state.presentation.duetTitle}；姿态 ${state.presentation.lastGesture}`;
  }
  const exported = emit(state, effect, 'player', prop, audience, binding === 'back' ? 'comments' : 'export', [fired.eventId]);
  finish(state, `hiss.${binding}`, [exported.eventId], binding === 'back' ? 'comments' : 'editor', audience, binding === 'back' ? 'comments' : 'export', prop);
}
function reply(state: BranchState, valid: ValidatedAction, root: VisibleEvent) {
  const id = valid.action.id;
  if (state.stage === 1) {
    state.presentation.replyTarget = valid.target;
    state.presentation.parentMessageId = valid.parentMessageId!;
    state.presentation.firstReplyTarget = valid.target;
    speak(state, valid.target, valid.action.fallbackLine, groupAudience, 'group', [root.eventId]);
    enterStage(state, 2, [root.eventId]); return;
  }
  if (state.stage === 2) {
    const fact = id === 'inspect_bucket' ? 'bucket' : id === 'inspect_frame' ? 'frame' : 'paper';
    gain(state, fact);
    const inspected = emit(state, 'frame_inspected', 'player', valid.action.fallbackLine, ['player'], 'local', [root.eventId]);
    if (fact === 'bucket') state.presentation.bucketMoved = true;
    if (fact === 'paper') state.presentation.originalQuestion = true;
    enterStage(state, 3, [inspected.eventId]); return;
  }
  state.presentation.replyTarget = valid.target;
  state.presentation.parentMessageId = valid.parentMessageId!;
  state.presentation.sent = true;
  const kind = valid.action.effects[0];
  let prop = valid.action.fallbackLine;
  if (id === 'reply_clip') { state.presentation.bucketReturned = true; prop = '最终版别发这个.gif · 原文件回放：垃圾桶被挪回原位'; }
  if (id === 'reply_game') { state.presentation.canScreen = true; state.presentation.digitOrientation = 'vertical'; prop = '九个圆头像围着数字 1；可拖动或按“横过来”挡拆（纯 UI 镜头交互）'; }
  if (id === 'reply_homework') { state.presentation.typingCount = 37; prop = '订正接龙恢复；三十七个旧头像同时变成“正在输入”'; }
  const effect = emit(state, kind, valid.target, prop, groupAudience, 'group', causes(root.eventId, valid.parentMessageId));
  finish(state, valid.action.endingId!, [effect.eventId], valid.target, groupAudience, 'group', prop);
}

const wordMeanings: Record<WordPlay['discovered'][number], string> = {
  ten: '10人名单', bridge: '横过来挡拆', equal: '把0－0变成0＝0唤醒订正接龙',
};
function specialTurn(state: BranchState, input: TurnInput, valid: SpecialAction) {
  if (valid.kind === 'free_dialogue') {
    const { target } = valid;
    const audience = target.channel === 'meeting' ? meetingAudience : ['player', target.id];
    // Free wording has no inferred intent, permissions or private causal context.
    const root = emit(state, valid.inputKind === 'speech' ? 'free_speech' : 'free_action', 'player', input.params.text, audience, target.channel, []);
    emit(state, 'free_input_recorded', 'local_record',
      `本机剧内记录：原文已送达 ${target.label}，频道 ${target.channel}；接收者：${audience.join('、')}。\n${input.params.text}\n仅本机回显，没有实时 NPC 回复；不授予事实、同意或剧情权限，不推进剧情状态。`,
      ['player'], 'local', [root.eventId], 'rules', '本机记录');
    return;
  }
  const previous = state.wordPlay ?? initialWordPlay();
  if (valid.kind === 'move_one') {
    const { x, y, rotation } = valid;
    const effect = wordEffect(x, y, rotation);
    const discovered = [...previous.discovered];
    if (effect !== 'none' && !discovered.includes(effect)) discovered.push(effect);
    state.wordPlay = { x, y, rotation, effect, discovered };
    const root = emit(state, 'word_moved', 'player', `把 1 移到 (${x}%, ${y}%)，旋转 ${rotation}°。`, groupAudience, 'group', []);
    const removed = previous.effect !== 'none' && previous.effect !== effect ? `已解除「${wordMeanings[previous.effect]}」，它不再生效。` : '';
    const changed = emit(state, 'word_effect', 'word_rules', `${removed}${effect === 'none'
      ? '当前位置与方向没有组成新意思；只保留数字 1 的位置，已发现的组合仍在记录中。'
      : `当前生效：${wordMeanings[effect]}。移走或转向后，组合会解除。`}`, groupAudience, 'group', [root.eventId], 'rules', '文字规则');
    const actor = effect === 'equal' ? 'rep' : effect === 'none' ? 'owner' : 'baller';
    const line = effect === 'ten' ? '这回 1 站在 0 前面，名单变成 10 人了。先别收走，你还可以继续摆。'
      : effect === 'bridge' ? '1 横过来挡拆了，这里现在能挡住。挪开可就不算了。'
      : effect === 'equal' ? '你把 0－0 摆成了 0＝0，订正接龙醒了；这是摆出来的，不是偷看原题。'
      : `1 现在在 (${x}%, ${y}%)，${rotation === 90 ? '横着' : '竖着'}。${removed ? '刚才的组合散开了。' : ''}这里还没接上，继续挪挪看。`;
    speak(state, actor, line, groupAudience, 'group', [changed.eventId]);
    return;
  }
  // A separate, rule-generated ending; legacy packages and their three endings remain untouched.
  state.wordPlay = previous;
  const current = wordMeanings[previous.effect as WordPlay['discovered'][number]];
  const history = previous.discovered.map(effect => wordMeanings[effect]).join('；');
  const root = emit(state, 'wordplay_finished', 'player', `保留「${current}」，主动结束这次文字摆放。`, groupAudience, 'group', []);
  state.ending = {
    id: 'reply.wordplay', title: '这次，1 不止一种意思',
    text: `当前保留：${current}。这个分支已经发现：${history}。这是文字摆放产生的独立结局，不揭示旧文件或私人事实。`,
    line: `这次的 1 留在「${current}」；一路试出的「${history}」也记下了。`,
  };
  state.status = 'ended';
  state.choices = [];
  state.scene = { title: state.ending.title, kicker: '谢幕 · 文字规则', text: state.ending.text, prop: state.ending.line };
  emit(state, 'wordplay_ended', 'word_rules', `${state.ending.text}\n${state.ending.line}`, groupAudience, 'group', [root.eventId], 'rules', '文字规则');
}

export function submitTurn(store: AuthoredStore, runId: string, branchId: string, input: TurnInput): PlayerView {
  validateInput(input);
  const run = getRun(store, runId), branch = getBranch(run, branchId);
  const fingerprint = fingerprintOf(input), saved = own(branch.requests, key(input.requestId));
  if (saved) {
    if (saved.fingerprint !== fingerprint) conflict('同一个 requestId 的内容不能改变。');
    return copy(saved.result);
  }
  if (input.expectedRevision !== branch.state.revision || input.stage !== branch.state.stage) conflict('舞台已变化，请读取最新 revision 后再提交。');
  const valid = validateAction(branch.state, input);
  // All validation and effects happen on a detached draft; rejected turns never mutate store.
  const state = copy(branch.state);
  const label = valid.kind === 'authored' ? valid.action.label : valid.label;
  const checkpoint: SavedCheckpoint = { checkpoint: { id: uuid(), stage: state.stage, label: `第 ${state.stage} 拍前 · ${label}` }, state: copy(state) };
  if (valid.kind !== 'authored') specialTurn(state, input, valid);
  else {
    let newHiss: VisibleEvent | undefined;
    if (state.episodeId === 'hiss') {
      newHiss = emit(state, 'hiss_emitted', 'cat', '哈——朝玩家。target=player', ['player', 'camera'], 'scene', causes(latest(state)));
      state.presentation.hissCount = Number(state.presentation.hissCount) + 1;
      state.presentation.hissTarget = 'player';
      state.presentation.lastHissEventId = newHiss.eventId;
    }
    const root = actionEvent(state, input, valid, newHiss ? [newHiss.eventId] : causes(latest(state)));
    if (state.episodeId === 'wedding') wedding(state, valid, root);
    if (state.episodeId === 'office') office(state, valid, root);
    if (state.episodeId === 'romance') romance(state, input, valid, root);
    if (state.episodeId === 'hiss') hiss(state, input, valid, root, newHiss!);
    if (state.episodeId === 'reply') reply(state, valid, root);
  }
  state.revision += 1;
  const next: AuthoredBranch = { ...branch, state, checkpoints: [...branch.checkpoints, checkpoint] };
  const result = viewOf(run, next);
  // Reflect this ending in its own branch link before installing the draft.
  const ownLink = result.branches.find(item => item.branchId === branchId)!;
  ownLink.endingTitle = state.ending?.title ?? null;
  next.requests = { ...branch.requests, [key(input.requestId)]: { fingerprint, result: copy(result) } };
  run.branches[branchId] = next;
  return result;
}
export function forkBranch(store: AuthoredStore, runId: string, branchId: string, checkpointId: string, forkKey: string): PlayerView {
  validKey(forkKey, 'forkKey');
  const run = getRun(store, runId), branch = getBranch(run, branchId);
  const fingerprint = JSON.stringify({ branchId, checkpointId }), saved = own(run.forkKeys, key(forkKey));
  if (saved) {
    if (saved.fingerprint !== fingerprint) conflict('同一个 forkKey 不能倒带到不同位置。');
    return copy(saved.result);
  }
  const index = branch.checkpoints.findIndex(item => item.checkpoint.id === checkpointId);
  if (index < 0) invalid('只能倒带到本分支已经提交的决策前状态。');
  const snapshot = branch.checkpoints[index];
  const state = copy(snapshot.state);
  state.branchId = uuid();
  state.revision = 0;
  const fork: AuthoredBranch = { parentBranchId: branchId, label: `倒带 · 第 ${state.stage} 拍 / 版本 ${state.revision}`, state,
    // Keep only checkpoints strictly preceding the chosen decision. No future consent or requests.
    checkpoints: copy(branch.checkpoints.slice(0, index)), requests: {} };
  const projectedRun = { ...run, branches: { ...run.branches, [state.branchId]: fork } };
  const result = viewOf(projectedRun, fork);
  run.branches[state.branchId] = fork;
  run.forkKeys[key(forkKey)] = { fingerprint, result: copy(result) };
  return result;
}
