import { SCRIPT_VERSION, type Choice, type Clue, type Ending, type EpisodeId, type EpisodeSummary, type Scene } from '../../shared/contracts';

// Author-preview content only. The site catalog must project `episodes`, not these packages.
export interface AuthoredActor { id: string; name: string; channels: string[] }
export interface AuthoredLine { actorId: string; actorName?: string; channel: string; audience: string[]; text: string; kind?: string }
export interface AuthoredStage { scene: Scene; lines: AuthoredLine[] }
export interface AuthoredAction {
  id: string;
  label: string;
  stage: number;
  control: Choice['control'];
  allowedTargets: NonNullable<Choice['targets']>;
  preconditions: string[];
  effects: string[];
  recipients: string[];
  next: number | 'ending';
  fallbackLine: string;
  endingId?: string;
}
export interface AuthoredEnding extends Ending {
  visibleResult: string;
  trigger: { actionId: string; facts: string[] };
  path: string[];
}
export interface EpisodePackage {
  manifest: EpisodeSummary;
  actors: AuthoredActor[];
  stages: Record<1 | 2 | 3, AuthoredStage>;
  actions: Record<1 | 2 | 3, AuthoredAction[]>;
  facts: Record<string, Clue>;
  endings: Record<string, AuthoredEnding>;
}

export const episodes: EpisodeSummary[] = [
  { id: 'wedding', title: '婚礼上，三个前任坐一桌', shortTitle: '接管大屏', role: '婚庆控屏实习生', cta: '我来控屏', poster: '/art/wedding.svg', color: '#d75f4e', version: SCRIPT_VERSION, hook: '新娘说放，新郎说别放。你的鼠标正对着第二个文件。', number: '01', genre: '婚礼现场' },
  { id: 'office', title: '裁员名单上，只有我升职了', shortTitle: '坐上主位', role: '新任客服组长', cta: '我来开会', poster: '/art/office.svg', color: '#727da8', version: SCRIPT_VERSION, hook: '老板夸系统辛苦了，老组长的口袋却亮了一下。', number: '02', genre: '职场喜剧' },
  { id: 'romance', title: '我的网恋对象，正在教我怎么跟他分手', shortTitle: '打开双窗', role: '犹豫赴约的人', cta: '打开聊天', poster: '/art/romance.svg', color: '#d98d9f', version: SCRIPT_VERSION, hook: '你发给军师的截图，刚好截进了汽水的头像。', number: '03', genre: '双窗网恋' },
  { id: 'hiss', title: '耄耋哈我，我把它设成了声控键', shortTitle: '有本事你进来', role: '刚说“换我来”的网友', cta: '换我来', poster: '/art/hiss.svg', color: '#baa05d', version: SCRIPT_VERSION, hook: '换好了，老师请。矮柜前的位置现在是你的。', number: '04', genre: '声控闹剧' },
  { id: 'reply', title: '扣 1 复活，我是那个 1', shortTitle: '选择回复对象', role: '一条尚未发送的“1”', cta: '选择楼层', poster: '/art/reply.svg', color: '#6d9e83', version: SCRIPT_VERSION, hook: '原片、球局、作业都等着复活，而你只能发一个 1。', number: '05', genre: '引用接龙' },
];

const target = (id: string, label: string, channel: string) => ({ id, label, channel });
const line = (actorId: string, channel: string, audience: string[], text: string, actorName?: string): AuthoredLine => ({ actorId, channel, audience, text, ...(actorName ? { actorName } : {}) });
const scene = (title: string, kicker: string, text: string, prop: string): Scene => ({ title, kicker, text, prop });
const action = (stage: number, id: string, label: string, targets: NonNullable<Choice['targets']>, fallbackLine: string, effects: string[], preconditions: string[] = [], endingId?: string, control: Choice['control'] = 'button'): AuthoredAction => ({
  id, label, stage, control, allowedTargets: targets, preconditions, effects,
  recipients: [...new Set(['player', ...targets.map(item => item.id)])],
  next: endingId ? 'ending' : stage === 3 ? 2 : stage + 1, fallbackLine,
  ...(endingId ? { endingId } : {}),
});
const clue = (id: string, title: string, text: string): Clue => ({ id, title, text });
const ending = (id: string, title: string, visibleResult: string, closingLine: string, actionId: string, path: string[], facts: string[] = []): AuthoredEnding => ({ id, title, text: visibleResult, line: closingLine, visibleResult, trigger: { actionId, facts }, path });
const manifest = (id: EpisodeId) => episodes.find(item => item.id === id)!;

const weddingAudience = ['player', 'writer', 'bride', 'groom', 'boss', 'host', 'guests'];
const meetingAudience = ['player', 'old_lead', 'boss', 'hr'];
const groupAudience = ['player', 'owner', 'baller', 'rep', 'filmer'];

export const replyTargets = {
  quote_clip: { parentMessageId: 'reply.initial.clip', target: 'owner', channel: 'group' },
  quote_game: { parentMessageId: 'reply.initial.game', target: 'baller', channel: 'group' },
  quote_homework: { parentMessageId: 'reply.initial.homework', target: 'rep', channel: 'group' },
  reply_clip: { parentMessageId: 'reply.final.clip', target: 'owner', channel: 'group' },
  reply_game: { parentMessageId: 'reply.final.game', target: 'baller', channel: 'group' },
  reply_homework: { parentMessageId: 'reply.final.homework', target: 'rep', channel: 'group' },
} as const;

export const episodePackages: Record<EpisodeId, EpisodePackage> = {
  wedding: {
    manifest: manifest('wedding'),
    actors: [
      { id: 'writer', name: '原编剧林禾', channels: ['private', 'screen', 'hall'] },
      { id: 'bride', name: '新娘', channels: ['headset', 'hall'] },
      { id: 'groom', name: '新郎', channels: ['headset', 'hall'] },
      { id: 'boss', name: '婚庆老板', channels: ['headset', 'hall'] },
      { id: 'host', name: '主持人', channels: ['hall'] },
      { id: 'waiter', name: '服务员', channels: ['hall'] },
    ],
    stages: {
      1: { scene: scene('鼠标别抖', '第一幕 · 开席', '台上已经报幕，第二个文件还没上大屏。', '控屏电脑：照片 / 片头 / 片尾预览；大屏等待播放'), lines: [line('host', 'hall', weddingAudience, '请欣赏他们相爱的八年。'), line('bride', 'headset', ['player', 'bride'], '放第二个，大学拍的那条。'), line('groom', 'headset', ['player', 'groom'], '先别放，最后那一页再看一眼。'), line('boss', 'headset', ['player', 'boss'], '鼠标别抖，四十桌等着呢。')] },
      2: { scene: scene('十二桌的空隙', '第二幕 · 认错片', '你可以在电脑上调出旧片尾，只给桌边的人看。', '电脑小窗与全场投影分离；十二桌一把椅子向外挪'), lines: [line('bride', 'headset', ['player', 'bride'], '那桌是老剧组，不是审判席。'), line('writer', 'private', ['player', 'writer'], '我去桌边拿杯水。先别把我名字报出去。')] },
      3: { scene: scene('把控台交给谁', '第三幕 · 收场', '大屏还在等你的最后一次确认。', '电脑、桌边话筒和原片播放键'), lines: [line('boss', 'headset', ['player', 'boss'], '还有半分钟，我先把交接单拿来。'), line('host', 'hall', weddingAudience, '请大家稍候，主菜马上就到。')] },
    },
    actions: {
      1: [action(1, 'preview_tail', '拖到片尾预览', [target('player', '控台小窗', 'local')], '小窗最后一页有一行空白，大屏没有变化。', ['missing_credit']), action(1, 'hold_photos', '先留在照片', [target('guests', '全场大屏', 'screen')], '照片留在大屏，十二桌还在吃席。', ['screen_photos']), action(1, 'play_intro', '只播放片头', [target('guests', '全场大屏', 'screen')], '片头亮起，老剧组的合影掠过屏幕。', ['intro_screened'])],
      2: [action(2, 'private_preview', '现在播放给编剧私看', [target('writer', '编剧 · 私下', 'private')], '让我自己改。我点头的是这个版本。', ['missing_credit', 'consent_granted'], [], undefined, 'message'), action(2, 'watch_table', '看向十二桌', [target('player', '桌边观察', 'local')], '她把椅子向外挪了一点，没有走向话筒。', ['chair_seen'])],
      3: [action(3, 'lend_laptop', '把电脑交给她编辑', [target('writer', '编剧 · 控台', 'private')], '名字我自己敲。现在可以放了。', ['credits_updated'], ['consent'], 'wedding.credits', 'message'), action(3, 'offer_mic', '把麦递到桌边', [target('writer', '编剧 · 全场', 'hall')], '她没有接过发言的位置，把麦递给了服务员。', ['mic_declined'], [], 'wedding.fish', 'message'), action(3, 'play_original', '按原方案准点播放', [target('guests', '全场大屏', 'screen')], '原片播完，交接单亮起最后一个绿勾。', ['original_screened'], [], 'wedding.on_time')],
    },
    facts: {
      missing_credit: clue('missing_credit', '片尾空了一行', '旧短剧片尾有演员、摄影，却没有原编剧林禾的署名。仅在控台预览时发现。'),
      chair_seen: clue('chair_seen', '向外挪的椅子', '十二桌按旧剧组排座，林禾把椅子挪向过道。'),
      consent_granted: clue('consent_granted', '她确认的版本', '林禾在私下看过片尾，点头同意亲自补写署名；不是公开发言许可。'),
      credits_updated: clue('credits_updated', '本人确认的新片尾', '林禾亲手敲入署名并确认播放。'),
    },
    endings: {
      'wedding.credits': ending('wedding.credits', '婚礼现场返工版', '片尾出现编剧亲手确认的名字', '这一行我自己写的。现在，大家吃饭吧。', 'lend_laptop', ['preview_tail', 'private_preview', 'lend_laptop'], ['consent']),
      'wedding.fish': ending('wedding.fish', '这桌先上鱼', '麦递给服务员，响起“小心盘子烫”', '我不占这个麦。师傅，这桌鱼先放中间。', 'offer_mic', ['hold_photos', 'watch_table', 'offer_mic']),
      'wedding.on_time': ending('wedding.on_time', '准点交付', '设备交接单全绿，合照空一把椅子', '设备都齐了。合照里那把椅子，就先空着吧。', 'play_original', ['play_intro', 'watch_table', 'play_original']),
    },
  },
  office: {
    manifest: manifest('office'),
    actors: [{ id: 'boss', name: '老板', channels: ['meeting', 'work'] }, { id: 'hr', name: '人事', channels: ['meeting'] }, { id: 'old_lead', name: '老组长', channels: ['private', 'phone', 'meeting'] }],
    stages: {
      1: { scene: scene('主位留给你', '第一幕 · 被升职', '升职通知后面紧跟着夜班需求会议邀请。', '新排班表；来电手机；主位的会议牌'), lines: [line('boss', 'work', ['player', 'boss'], '年轻人就要敢上。昨晚系统又辛苦了。'), line('hr', 'meeting', ['player', 'hr', 'boss'], '请新组长确认今晚的接听人。')] },
      2: { scene: scene('自动接管的叮声', '第二幕 · 夜班', '你能问老组长，也能查上周的转接记录。', '电话背景的微波炉；夜间人工转接日志'), lines: [line('old_lead', 'private', ['player', 'old_lead'], '别急着在会上说全自动。你再拨一次试试。'), line('boss', 'meeting', ['player', 'boss', 'hr'], '汇总报表上的解决率挺好。')] },
      3: { scene: scene('纪要等一个名字', '第三幕 · 确认方案', '一份夜班表，一次转接演示，或者一张书面交接单。', '空白会议纪要；老组长的手机；新排班确认键'), lines: [line('hr', 'meeting', meetingAudience, '方案确认后，我把负责人写进去。'), line('old_lead', 'private', ['player', 'old_lead'], '我想交接的是那部半夜会亮的手机。')] },
    },
    actions: {
      1: [action(1, 'read_roster', '先看排班表', [target('player', '自己的排班表', 'local')], '夜班一栏写着自动接管，人工联系人却没有填。', ['roster']), action(1, 'answer_call', '接起测试电话', [target('old_lead', '老组长 · 电话', 'phone')], '欢迎致电。背景里响了一声微波炉的叮。', ['call']), action(1, 'open_meeting', '直接坐下开会', [target('boss', '老板 · 会议', 'meeting')], '主位的名字换了，夜班一栏还没有换。', ['meeting_opened'])],
      2: [action(2, 'ask_permission', '私下问他愿不愿复现', [target('old_lead', '老组长 · 私聊', 'private')], '可以，当着大家打。我自己解释转到哪儿。', ['consent_granted'], [], undefined, 'message'), action(2, 'inspect_log', '查看人工转接记录', [target('player', '交接日志', 'local')], '未解决的夜间来电，最终转到了老组长的号码。', ['transfer_log'])],
      3: [action(3, 'demo_transfer', '在会上复现转接', [target('old_lead', '老组长 · 会议', 'meeting')], '自动部分结束以后，是我在接。这一段请写进纪要。', ['transfer_demonstrated'], ['consent'], 'office.rest'), action(3, 'write_handover', '写明接听时段', [target('old_lead', '老组长 · 书面交接', 'private')], '工作时段、值守安排都写清楚了。我签这一份。', ['handover_signed'], ['transfer_log'], 'office.handover', 'message'), action(3, 'confirm_roster', '照稿确认全自动', [target('hr', '人事 · 会议', 'meeting')], '已确认。新的异常转接联系人是新组长。', ['forwarding_changed'], [], 'office.promoted')],
    },
    facts: {
      roster: clue('roster', '新排班表', '夜间一栏是自动接管，人工联系人空白。'),
      call: clue('call', '通话里的叮', '自动语音后有一声微波炉提示音，来自仍在接听的现场。'),
      consent_granted: clue('consent_granted', '老组长的同意', '老组长同意在会上复现转接并由本人解释。人事尚未听到私聊。'),
      transfer_log: clue('transfer_log', '人工转接日志', '上周夜间未解决的来电最终转往老组长的手机号。'),
      handover_signed: clue('handover_signed', '有时段的交接单', '本人签署的书面交接明确工作时段和夜间值守安排。'),
    },
    endings: {
      'office.rest': ending('office.rest', '系统申请调休', '纪要列出夜间人工值守与负责人', '系统不用枕头，我需要。把值守人也写上吧。', 'demo_transfer', ['read_roster', 'ask_permission', 'demo_transfer'], ['consent']),
      'office.handover': ending('office.handover', '请在工作时间来电', '交接纪要明确接听时段', '这回我签的不是全天候，是下班时间。', 'write_handover', ['answer_call', 'inspect_log', 'write_handover'], ['transfer_log']),
      'office.promoted': ending('office.promoted', '恭喜接任', '深夜电话响在玩家手机', '收到。原来主位还配一张夜班床。', 'confirm_roster', ['open_meeting', 'inspect_log', 'confirm_roster']),
    },
  },
  romance: {
    manifest: manifest('romance'),
    actors: [{ id: 'soda', name: '汽水 / 退堂鼓', channels: ['soda', 'coach'] }, { id: 'friend', name: '阿圆', channels: ['friend'] }],
    stages: {
      1: { scene: scene('截图截进头像了', '第一幕 · 两个窗口', '汽水的消息刚撤回，军师窗口还开着。', '汽水 / 退堂鼓双窗；只有玩家能看见的转发预览'), lines: [line('soda', 'soda', ['player', 'soda'], '今天 21:10 · 那张截图，把我头像也截进去了。', '汽水'), line('soda', 'coach', ['player', 'soda'], '今天 21:10 · 你想让我帮你写哪一句？', '退堂鼓')] },
      2: { scene: scene('星期四的停笔', '第二幕 · 找日期', '对齐两窗的时间，或者翻回自己的草稿。', '双窗时间轴；仅自己可见的未发送草稿栏'), lines: [line('soda', 'coach', ['player', 'soda'], '今天 21:11 · 先不用漂亮话。你自己的意思是什么？', '退堂鼓'), line('soda', 'soda', ['player', 'soda'], '今天 21:11 · 我等你，不催。', '汽水')] },
      3: { scene: scene('只发一次', '第三幕 · 发给谁', '先选一个窗口。一条消息，不必替两个窗口各写一份。', '单次发送键；收件人标签；未发送内容不转给好友'), lines: [line('soda', 'coach', ['player', 'soda'], '今天 21:12 · 如果不用我拟，你会怎么说？', '退堂鼓'), line('soda', 'soda', ['player', 'soda'], '今天 21:12 · 明天的安排还可以改。', '汽水')] },
    },
    actions: {
      1: [action(1, 'open_chats', '打开两窗历史', [target('player', '自己的双窗', 'local')], '两边的时间戳并排亮起来。', ['chats_opened']), action(1, 'ask_friend', '把已预览的一段转给阿圆', [target('friend', '阿圆 · 私聊', 'friend')], '就给我看这一段？你把我当验证码呢。', ['message_forwarded'], [], undefined, 'message')],
      2: [action(2, 'compare_thursday', '对齐上周四', [target('player', '双窗时间轴', 'local')], '他停止拟回复的那一分钟，另一窗也停在正在输入。', ['thursday']), action(2, 'find_draft', '找回自己的六字草稿', [target('player', '未发送草稿', 'local')], '见。想吃烤肉。', ['draft'])],
      3: [action(3, 'ask_coach', '问军师自己会怎么约', [target('soda', '退堂鼓窗口', 'coach')], '我先把排号发你，等一下，发错窗口了。', ['tickets_sent'], [], 'romance.queues', 'message'), action(3, 'disclose_forwarding', '向汽水坦白转发范围', [target('soda', '汽水窗口', 'soda')], '上周四我认出来了。明天先不见，边界说清再约。', ['forwarding_disclosed'], ['thursday'], 'romance.tomorrow', 'message'), action(3, 'send_original', '发送自己的原稿', [target('soda', '汽水窗口', 'soda')], '好。我把另两家取消。', ['draft_sent'], ['draft'], 'romance.bbq', 'message')],
    },
    facts: {
      thursday: clue('thursday', '同一分钟停笔', '上周四 21:14，你说“我喜欢他，就是怕以后每句话都得这么斟酌”。军师停止代写，汽水取消输入。'),
      draft: clue('draft', '未发送 · 只属于自己', '见。想吃烤肉。'),
      message_forwarded: clue('message_forwarded', '阿圆收到的一段', '阿圆只收到经玩家预览并明确转发的历史消息，不会看到其他窗口或草稿。'),
    },
    endings: {
      'romance.queues': ending('romance.queues', '过号请重排', '两个窗口先后泄露同一份餐厅排号', '我排的是三家店，不是三个人。你先别把我过号。', 'ask_coach', ['open_chats', 'compare_thursday', 'ask_coach']),
      'romance.tomorrow': ending('romance.tomorrow', '已读，明天再回', '汽水说明认出日期，两人暂停见面', '这句不用军师转述。明天不见，明天再聊。', 'disclose_forwarding', ['ask_friend', 'compare_thursday', 'disclose_forwarding'], ['thursday']),
      'romance.bbq': ending('romance.bbq', '原稿就很好', '只亮起汽水窗口，回复取消了另两家', '那就烤肉。另两家我取消，这一句不用重写。', 'send_original', ['open_chats', 'find_draft', 'send_original'], ['draft']),
    },
  },
  hiss: {
    manifest: manifest('hiss'),
    actors: [{ id: 'cat', name: '耄耋', channels: ['scene'] }, { id: 'camera', name: '拍摄者', channels: ['scene'] }, { id: 'editor', name: '剪辑号', channels: ['export'] }, { id: 'comments', name: '弹幕', channels: ['comments'] }],
    stages: {
      1: { scene: scene('换好了，老师请', '第一幕 · 理论派下场', '画面里的手缩回去了。矮柜前的位置现在属于你。', '圆头猫在矮柜上；你的头像还挂在“换我来”弹幕旁'), lines: [line('comments', 'comments', ['player', 'comments'], '换好了，老师请。先慢慢眨眼。'), line('camera', 'scene', ['player', 'camera'], '先别碰柜子，我想一镜到底。')] },
      2: { scene: scene('和播放器谈', '第二幕 · 绑定声控键', '这是剧内预制声纹，无需麦克风。录入只收样本，松开才生效。', '声控快捷键：返回 / 封面 / 合拍；cat_hiss 与 player_word 波形'), lines: [line('camera', 'scene', ['player', 'camera'], '曼波。看，机位变了。把刚才那声录进设置里。'), line('camera', 'scene', ['player', 'camera'], '录音期间不会触发，松手以后再试。静音也能用波形。')] },
      3: { scene: scene('下一声才算', '第三幕 · 试一次', '录制结束了。再接一次戏，等猫产生一声新的哈气。', '已松开录音键；快捷键待命；旧波形只供重看'), lines: [line('camera', 'scene', ['player', 'camera'], '已经松开了。现在再试一次。'), line('camera', 'scene', ['player', 'camera'], '它不会跟你念口令，还是只会朝你哈。')] },
    },
    actions: {
      1: [action(1, 'step_back', '收手后退', [target('cat', '猫 · 现场', 'scene')], '你退了一步，圆脑袋也往前探了一点。', ['gesture']), action(1, 'hiss_back', '跟它对哈', [target('cat', '猫 · 现场', 'scene')], '字幕多了第二个发言人，底色和你的头像一样。', ['player_spoke'], [], undefined, 'message'), action(1, 'freeze', '原地装加载', [target('cat', '猫 · 现场', 'scene')], '你不动，猫盯着这张还没加载完的脸。', ['gesture']), action(1, 'custom_gesture', '自己写一个动作', [target('cat', '猫 · 现场', 'scene')], '拍摄者记下你的姿态，猫仍然只朝你哈。', ['gesture'], [], undefined, 'gesture')],
      2: [action(2, 'bind_back', '使用这声哈 · 返回', [target('player', '播放器 · 声控设置', 'local')], '波形收好，返回键已绑定；松开后待命。', ['sample_captured', 'shortcut_bound', 'shortcut_armed']), action(2, 'bind_cover', '使用这声哈 · 封面', [target('player', '播放器 · 声控设置', 'local')], '波形收好，封面键已绑定；松开后待命。', ['sample_captured', 'shortcut_bound', 'shortcut_armed']), action(2, 'bind_duet', '使用这声哈 · 合拍', [target('player', '播放器 · 声控设置', 'local')], '波形收好，合拍键已绑定；松开后待命。', ['sample_captured', 'shortcut_bound', 'shortcut_armed'])],
      3: [action(3, 'bow', '很有礼貌地告辞', [target('cat', '猫 · 现场', 'scene')], '你鞠了一躬，它把这一声哈送得很完整。', ['try_shortcut'], ['armed']), action(3, 'hiss_back', '不服，再哈一个', [target('cat', '猫 · 现场', 'scene')], '两位发言人同时亮起字幕。', ['player_spoke', 'try_shortcut'], ['armed'], undefined, 'message'), action(3, 'move_aside', '站到镜头另一边', [target('cat', '猫 · 现场', 'scene')], '你移到左边，猫留在右边。', ['gesture', 'try_shortcut'], ['armed']), action(3, 'custom_gesture', '自己写最后一个动作', [target('cat', '猫 · 现场', 'scene')], '镜头保留你的最后姿态，等待新的哈气匹配。', ['gesture', 'try_shortcut'], ['armed'], undefined, 'gesture')],
    },
    facts: {
      cat_hiss: clue('cat_hiss', '已获 · 猫的哈气波形', '剧内预制声纹 cat_hiss；猫朝玩家哈时录入，不需要真实麦克风。'),
      player_word: clue('player_word', '已试 · 玩家念词波形', '剧内预制声纹 player_word；与猫下一声哈气不匹配，可保留并重录。'),
    },
    endings: {
      'hiss.back': ending('hiss.back', '我先哈一步', '声控送玩家回到本集的虚构评论区', '老师先走一步，这节信任课留给评论区复习。', 'bind_back', ['step_back', 'bind_back', 'bow'], ['armed', 'cat_hiss']),
      'hiss.cover': ending('hiss.cover', '两只都挺凶', '封面定格双方对哈，热评匹配最后动作', '这一帧别裁，左边那只也是临时演员。', 'bind_cover', ['hiss_back', 'bind_cover', 'hiss_back'], ['armed', 'cat_hiss']),
      'hiss.duet': ending('hiss.duet', '原版在右，翻唱在左', '静默玩家获得“特邀嘉宾负责挨哈”合拍', '右边主唱，左边负责把这声哈完整接住。', 'bind_duet', ['freeze', 'bind_duet', 'move_aside'], ['armed', 'cat_hiss']),
    },
  },
  reply: {
    manifest: manifest('reply'),
    actors: [{ id: 'owner', name: '老群主', channels: ['group'] }, { id: 'baller', name: '球友', channels: ['group'] }, { id: 'rep', name: '课代表', channels: ['group'] }, { id: 'filmer', name: '原拍摄者', channels: ['group'] }],
    stages: {
      1: { scene: scene('你就是那个 1', '第一幕 · 选择楼层', '十年前的动图卡在筐沿；三条楼层都在等你。', '引用树；尚未发送的数字 1；只到筐沿的动图'), lines: [line('owner', 'group', groupAudience, '扣 1 复活完整版。'), line('baller', 'group', groupAudience, '周六打球差一个。'), line('rep', 'group', groupAudience, '十年前 · 暑假作业收到扣 1。')] },
      2: { scene: scene('真人上线', '第二幕 · 查原片', '原拍摄者回来了，完整版已经加载。你可以逐帧看。', '原创关键帧：纸团打铁 / 垃圾桶移动 / 纸背的数学题'), lines: [line('filmer', 'group', groupAudience, '找到硬盘了，第一条没进，后面还有一条。'), line('baller', 'group', groupAudience, '先别剪，筐沿那帧给我停住。'), line('rep', 'group', groupAudience, '纸背面是不是还有字？')] },
      3: { scene: scene('最后一次接龙', '第三幕 · 只发 1', '三条目标楼都出现了。可以跨线选择，但正文始终只有 1。', '完整版楼 / 缺人球局楼 / 订正作业楼；最后一次发送键'), lines: [line('owner', 'group', groupAudience, '要完整版的扣 1。'), line('baller', 'group', groupAudience, '名单还差最后一个，周六上场的扣 1。'), line('rep', 'group', groupAudience, '认领原题、参加订正的扣 1。')] },
    },
    actions: {
      1: [action(1, 'quote_clip', '引用 · 原动图', [target('owner', '群主的原片楼', 'group')], '先把原拍摄者叫回来找文件。', ['quoted'], [], undefined, 'message'), action(1, 'quote_game', '引用 · 缺人球局', [target('baller', '球友的球局楼', 'group')], '名单第十个位置先挂上一个 1。', ['quoted'], [], undefined, 'message'), action(1, 'quote_homework', '引用 · 暑假作业', [target('rep', '课代表的作业楼', 'group')], '好，还差三十七个。原拍摄者，你留过那张纸吗？', ['quoted'], [], undefined, 'message')],
      2: [action(2, 'inspect_bucket', '看垃圾桶的移动', [target('player', '完整版回放', 'local')], '纸团先打铁，老板把桶往左踢了半米再拍。', ['bucket']), action(2, 'inspect_frame', '看缺人通知的帧', [target('player', '球局关键帧', 'local')], '名单只剩第十格，头像预览是一根筷子。', ['frame']), action(2, 'zoom_paper', '放大纸背的原题', [target('player', '作业关键帧', 'local')], '纸团背面露出一道当年的数学题。', ['paper'])],
      3: [action(3, 'reply_clip', '1 → 完整版楼', [target('owner', '群主的完整版楼', 'group')], '原文件复活了，这回桶也得站回原位。', ['clip_restored'], [], 'reply.bucket', 'message'), action(3, 'reply_game', '1 → 缺人球局楼', [target('baller', '球友的球局楼', 'group')], '名单齐了。你先上场，横过来就是挡拆。', ['player_registered'], [], 'reply.screen', 'message'), action(3, 'reply_homework', '1 → 订正作业楼', [target('rep', '课代表的订正楼', 'group')], '原题恢复了。下面三十七位，现在订正。', ['homework_reopened'], [], 'reply.class', 'message')],
    },
    facts: {
      bucket: clue('bucket', '移动过的桶', '第一条纸团打铁，第二条拍摄前老板把桶往左挪了半米。'),
      frame: clue('frame', '名单第十格', '九个球友头像旁有一个空位，数字 1 可成为第十个人。'),
      paper: clue('paper', '纸背的数学题', '原作业题在纸团背面，放大后能看清。'),
    },
    endings: {
      'reply.bucket': ending('reply.bucket', '赛后撤销本桶两分', '原文件回放中垃圾桶被挪回去', '人可以后仰，桶别跟着跑位。这两分先撤了。', 'reply_clip', ['quote_clip', 'inspect_bucket', 'reply_clip']),
      'reply.screen': ending('reply.screen', '这人打球有点直', '赛后动作可拖动或按键让数字横过来挡拆', '别站得那么端正，横过来，你就是我们的战术。', 'reply_game', ['quote_game', 'inspect_frame', 'reply_game']),
      'reply.class': ending('reply.class', '成功复活全群', '三十七个旧头像同时进入输入状态', '人都复活了？那先订正，解散申请下课再看。', 'reply_homework', ['quote_homework', 'zoom_paper', 'reply_homework']),
    },
  },
};
