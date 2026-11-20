import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import type { PlayerView } from '../../shared/contracts';
import { WORD_ZONES, wordEffect } from '../../shared/wordplay';
import './word-board.css';

type Props = {
  view: PlayerView;
  disabled: boolean;
  onAction: (actionId: string, params: Record<string, string>) => void;
};
type WordPlay = NonNullable<PlayerView['wordPlay']>;
type Pose = Pick<WordPlay, 'x' | 'y' | 'rotation'>;
type Drag = {
  pointerId: number;
  target: HTMLButtonElement;
  offsetX: number;
  offsetY: number;
};

const effects = {
  none: { name: '自由落位', description: '1 仍是一个字，画面还没有改变。' },
  ten: { name: '10 人签到', description: '1 站到 0 前面，旧名册变成 10 人签到。' },
  bridge: { name: '横过来挡拆', description: '1 横成一道挡拆，九个队友绕行，球被挡住。' },
  equal: { name: '原题恢复', description: '1 补上等号，0＝0；37 个旧头像正在输入。' },
};
const round = (value: number) => Math.round(value * 10) / 10;
const bound = (value: number) => Math.max(5, Math.min(95, value));
const poseOf = ({ x, y, rotation }: Pose): Pose => ({ x, y, rotation });
const samePose = (a: Pose, b: Pose) => round(a.x) === round(b.x) && round(a.y) === round(b.y) && a.rotation === b.rotation;
const courtRoute = [[-90, 65], [-112, 0], [-75, -72], [0, -110], [75, -72], [112, 0], [90, 65], [35, 112], [-35, 112]];

function One({ rotation }: { rotation: Pose['rotation'] }) {
  return <svg className="word-glyph" viewBox="-50 -50 100 100" aria-hidden="true" style={{ transform: `rotate(${rotation}deg)` }}>
    <text x="0" y="0" textAnchor="middle" dominantBaseline="central">1</text>
  </svg>;
}

export default function WordBoard(props: Props) {
  if (!props.view.wordPlay) return null;
  return <WordSurface key={`${props.view.runId}:${props.view.branchId}`} {...props} play={props.view.wordPlay} />;
}

function WordSurface({ view, play, disabled, onAction }: Props & { play: WordPlay }) {
  const id = useId();
  const boardRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [draft, setDraft] = useState<Pose>(() => poseOf(play));
  const draftRef = useRef(draft);
  const acceptedRef = useRef({ pose: poseOf(play), revision: view.revision, status: view.status });
  const submissionRef = useRef<{ sawBusy: boolean } | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const ended = view.status === 'ended';
  const locked = disabled || waiting || view.status !== 'ready';
  const pending = !ended && (waiting || disabled || view.status === 'pending');
  const dirty = !samePose(draft, play);
  const preview = wordEffect(draft.x, draft.y, draft.rotation);
  const active = play.effect;
  const ten = WORD_ZONES.find(zone => zone.id === 'ten')!;
  const bridge = WORD_ZONES.find(zone => zone.id === 'bridge')!;
  const equal = WORD_ZONES.find(zone => zone.id === 'equal')!;

  const updateDraft = useCallback((pose: Pose) => {
    draftRef.current = pose;
    setDraft(pose);
  }, []);

  const releaseDrag = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.target.hasPointerCapture(drag.pointerId)) drag.target.releasePointerCapture(drag.pointerId);
    setDragging(false);
  }, []);

  useLayoutEffect(() => {
    const previous = acceptedRef.current;
    // Pending revisions are transport updates, not acknowledgement of a new pose.
    if (view.status !== 'pending' && (previous.revision !== view.revision || !samePose(previous.pose, play) || previous.status !== view.status)) {
      acceptedRef.current = { pose: poseOf(play), revision: view.revision, status: view.status };
      releaseDrag();
      updateDraft(poseOf(play));
      submissionRef.current = null;
      setWaiting(false);
    } else if (submissionRef.current) {
      if (disabled || view.status === 'pending') submissionRef.current.sawBusy = true;
      else if (submissionRef.current.sawBusy) {
        submissionRef.current = null;
        setWaiting(false);
      }
    }
    if (disabled || view.status !== 'ready') releaseDrag();
  }, [view.revision, view.status, play.x, play.y, play.rotation, disabled, waiting, releaseDrag, updateDraft]);

  function resetDraft() {
    if (locked || submissionRef.current) return;
    releaseDrag();
    updateDraft(poseOf(play));
  }

  function commit(pose = draftRef.current) {
    if (locked || submissionRef.current) return;
    const next = { x: round(bound(pose.x)), y: round(bound(pose.y)), rotation: pose.rotation };
    updateDraft(next);
    if (samePose(next, play)) return;
    submissionRef.current = { sawBusy: false };
    setWaiting(true);
    onAction('move_one', { x: String(next.x), y: String(next.y), rotation: String(next.rotation) });
  }

  function pointerPose(event: PointerEvent<HTMLButtonElement>, drag: Drag): Pose {
    const rect = boardRef.current!.getBoundingClientRect();
    return {
      x: round(bound((event.clientX - rect.left) / rect.width * 100 - drag.offsetX)),
      y: round(bound((event.clientY - rect.top) / rect.height * 100 - drag.offsetY)),
      rotation: draftRef.current.rotation,
    };
  }

  function startDrag(event: PointerEvent<HTMLButtonElement>) {
    if (locked || submissionRef.current || dragRef.current || !event.isPrimary || event.button !== 0 || !boardRef.current) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    const rect = boardRef.current.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      target: event.currentTarget,
      offsetX: (event.clientX - rect.left) / rect.width * 100 - draftRef.current.x,
      offsetY: (event.clientY - rect.top) / rect.height * 100 - draftRef.current.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }

  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (locked || submissionRef.current || drag?.pointerId !== event.pointerId) return;
    event.preventDefault();
    updateDraft(pointerPose(event, drag));
  }

  function endDrag(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    event.preventDefault();
    if (locked || submissionRef.current) { releaseDrag(); return; }
    const next = pointerPose(event, drag);
    releaseDrag();
    commit(next);
  }

  function cancelDrag(event: PointerEvent<HTMLButtonElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    releaseDrag();
    if (!locked && !submissionRef.current) updateDraft(poseOf(play));
  }

  function rotate() {
    if (locked || submissionRef.current) return;
    updateDraft({ ...draftRef.current, rotation: draftRef.current.rotation === 0 ? 90 : 0 });
  }

  function moveBy(dx: number, dy: number) {
    if (locked || submissionRef.current) return;
    updateDraft({ ...draftRef.current, x: round(bound(draftRef.current.x + dx)), y: round(bound(draftRef.current.y + dy)) });
  }

  function keyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const step = event.shiftKey ? 10 : 2;
    const keys: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (keys[event.key]) {
      event.preventDefault();
      if (!dragRef.current) moveBy(...keys[event.key]);
    } else if (event.key.toLowerCase() === 'r') {
      event.preventDefault();
      if (!event.repeat && !dragRef.current) rotate();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!event.repeat && !dragRef.current) commit();
    }
  }

  function finish() {
    if (locked || submissionRef.current || dirty || active === 'none') return;
    submissionRef.current = { sawBusy: false };
    setWaiting(true);
    onAction('finish_wordplay', {});
  }

  return <section className="word-workbench" aria-labelledby={`${id}-title`} data-ended={ended} onKeyDownCapture={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); resetDraft(); }
  }}>
    <header className="word-heading">
      <div className="word-eyebrow"><span>十年老群 · 字面现场</span><span className="word-board-state" role="status">{pending ? '等待确认 · 位置已保留' : ended ? '已谢幕 · 画面留存' : dragging ? '移动中 · 松手落位' : dirty ? '草稿 · 还未生效' : '自由拖动 · 不限次数'}</span></div>
      <h2 id={`${id}-title`}>把 1 从回复框里拖出来</h2>
    </header>
    <div className="word-draft-actions">
      <button type="button" className="word-rotate" disabled={locked || dragging} onClick={rotate}><span aria-hidden="true">↻</span> 旋转 90°</button>
      <button type="button" className="word-cancel" disabled={locked || !dirty} onClick={resetDraft}>撤回草稿</button>
      <button type="button" className="word-confirm" disabled={locked || !dirty || dragging} onClick={() => commit()}>{pending ? '等待确认…' : '确认位置'}</button>
    </div>

    <div ref={boardRef} className="word-board" role="group" aria-label="自由移动数字 1 的留言板" aria-describedby={`${id}-instructions`} data-effect={active} data-dragging={dragging}>
      <svg className="word-paper-art" viewBox="0 0 1000 1000" role="img" aria-label={`旧名册、半场球场与纸背原题。已生效：${effects[active].description}`}>
        <path className="word-fold" d="M 15 662 L 520 647 L 535 941 L 28 954 Z" />
        <path className="word-paper-line" d="M 34 715 L 510 700 M 38 883 L 516 869 M 520 647 L 487 681 L 522 685" />
        <text className="word-board-small" x="55" y="75">群公告 / 留一笔空白</text>
        <text className="word-board-small" x="945" y="75" textAnchor="end">38 位旧友</text>
        <g transform={`translate(${ten.x * 10} ${ten.y * 10})`}>
          <text className="word-board-label" x="-155" y="-120">旧名册</text>
          <text className="word-board-small" x="-155" y="-66">9 人 / 差 1</text>
          <path className="word-writing-line" d="M -80 74 L 152 74" />
          <text className="word-static-digit" x="90" y="0" textAnchor="middle" dominantBaseline="central">0</text>
          <text className="word-board-small" x="156" y="26">人</text>
          {Array.from({ length: 9 }, (_, i) => <g key={i} transform={`translate(${-143 + i * 34} 128)`} className="word-roster-avatar">
            <circle cy="-8" r="8" /><path d="M -11 12 Q -11 0 0 0 Q 11 0 11 12" />
          </g>)}
        </g>
        <g transform="translate(717 196)">
          {active === 'ten' ? <g className="word-signature">
            <rect x="-140" y="-58" width="280" height="112" rx="3" transform="rotate(-7)" />
            <text x="0" y="8" textAnchor="middle">10 人签到</text>
            <text className="word-board-small" x="0" y="96" textAnchor="middle">九个队友，和你。</text>
          </g> : <g className="word-margin-note">
            <text x="0" y="-18" textAnchor="middle">正文只有一个字</text>
            <text x="0" y="28" textAnchor="middle">不必只是一句回复</text>
            <path d="M -127 52 Q 0 72 130 44" />
          </g>}
        </g>
        <g transform={`translate(${bridge.x * 10} ${bridge.y * 10})`}>
          <text className="word-board-label" x="-181" y="-167">课后 · 半场</text>
          <rect className="word-court-line" x="-184" y="-135" width="368" height="286" rx="5" />
          <path className="word-court-line" d="M -184 87 Q 0 -181 184 87 M -62 -135 V -54 H 62 V -135 M -62 -54 A 62 62 0 0 0 62 -54 M -35 -106 H 35" />
          <circle className="word-court-line" cy="-93" r="15" />
          {active === 'bridge' && <path className="word-route" d="M 0 112 Q -138 56 -100 -28 Q -75 -90 0 -110 Q 135 -35 104 37 Q 76 110 0 112" />}
          {courtRoute.map(([x, y], i) => <g key={i} className={active === 'bridge' ? 'word-court-avatar word-rerouting' : 'word-court-avatar'} transform={`translate(${active === 'bridge' ? x : -140 + i * 35} ${active === 'bridge' ? y : 119})`} style={{ animationDelay: `${-i * 0.9}s` }}>
            <circle cy="-9" r="10" /><path d="M -13 16 V 5 Q 0 -4 13 5 V 16" />
          </g>)}
          <g className={active === 'bridge' ? 'word-ball word-ball-blocked' : 'word-ball'} transform={active === 'bridge' ? 'translate(0 39)' : 'translate(94 -51)'}>
            <circle r="13" /><path d="M -12 0 H 12 M 0 -12 Q 10 0 0 12" />
          </g>
          {active === 'bridge' && <g className="word-blocked-arrow"><path d="M 0 105 V 63 M -9 75 L 0 63 L 9 75 M -24 17 L -31 8 M 24 17 L 31 8" /><text className="word-board-small" x="0" y="196" textAnchor="middle">球被挡住 · 九人绕行</text></g>}
        </g>
        <g transform={`translate(${equal.x * 10} ${equal.y * 10})`}>
          <text className="word-board-label" x="-172" y="-123">纸背原题</text>
          <text className="word-equation-digit" x="-110" y="20" textAnchor="middle" dominantBaseline="central">0</text>
          <path className="word-original-stroke" d="M -50 38 H 50" />
          <text className="word-equation-digit" x="110" y="20" textAnchor="middle" dominantBaseline="central">0</text>
          <text className="word-board-small" x="0" y="133" textAnchor="middle">{active === 'equal' ? '这次，等号成立。' : '原题还缺一笔。'}</text>
        </g>
      </svg>

      {WORD_ZONES.map(zone => <div key={zone.id} className="word-zone" aria-hidden="true" data-preview={dirty && preview === zone.id} data-active={active === zone.id} style={{ left: `${zone.x}%`, top: `${zone.y}%`, width: `${zone.width}%`, height: `${zone.height}%` }}>
        {dirty && preview === zone.id && <span className="word-zone-caption">落位预览</span>}
      </div>)}

      {active === 'equal' ? <div className="word-typing" aria-label="37 个旧头像正在输入">
        <b>37 个旧头像</b>
        <div className="word-typing-grid" aria-hidden="true">{Array.from({ length: 37 }, (_, i) => <span className="word-typing-avatar" key={i} style={{ animationDelay: `${i % 7 * -0.2}s` }}>{i + 1}</span>)}</div>
        <span className="word-typing-caption">正在输入<span className="word-typing-dots" aria-hidden="true">···</span></span>
      </div> : <div className="word-board-aside" aria-hidden="true"><span>不是选答案</span><b>是给 1<br />找个位置。</b><i /></div>}

      {dirty && <div className="word-committed-one" aria-hidden="true" style={{ left: `${play.x}%`, top: `${play.y}%` }}><One rotation={play.rotation} /></div>}
      <button type="button" className="word-token" disabled={locked} aria-label={`数字 1，横坐标 ${round(draft.x)}，纵坐标 ${round(draft.y)}，${draft.rotation === 0 ? '竖直' : '横向'}，${dirty ? '尚未落位' : '已落位'}`} aria-describedby={`${id}-instructions ${id}-preview`} aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight R Enter Space Escape" style={{ left: `${draft.x}%`, top: `${draft.y}%` }} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag} onKeyDown={keyDown} onKeyUp={event => { if (event.key === ' ') event.preventDefault(); }} onClick={event => event.preventDefault()}>
        <One rotation={draft.rotation} />
      </button>
    </div>

    <div className="word-tools">
      <p className="word-instructions" id={`${id}-instructions`}>拖动松手落位；方向键移动，R旋转，Enter落位；Esc撤回<span>Shift + 方向键快移；也可用下方按钮微调。</span></p>
      <div className="word-position"><span>中心 <b>{round(draft.x)}, {round(draft.y)}</b></span><span>旋转 <b>{draft.rotation}° · {draft.rotation === 0 ? '竖直' : '横向'}</b></span></div>
      <div className="word-adjust" role="group" aria-label="微调数字位置，每次移动 2 格">
        {([['←', '向左移动', -2, 0], ['↑', '向上移动', 0, -2], ['↓', '向下移动', 0, 2], ['→', '向右移动', 2, 0]] as const).map(([symbol, label, dx, dy]) => <button type="button" className="word-nudge" key={label} aria-label={label} disabled={locked || dragging} onClick={() => moveBy(dx, dy)}>{symbol}</button>)}
      </div>
      <div className="word-feedback">
        <p className="word-preview" id={`${id}-preview`} aria-live="polite" aria-atomic="true"><span>落位预览 · {dirty ? '未提交' : '当前坐标'}</span><b>{effects[preview].name}</b><small>{dirty ? '虚线只是预览，确认后才会改变画面。' : '移动或旋转 1，试试另一个位置。'}</small></p>
        <p className="word-acknowledged" aria-live="polite" aria-atomic="true"><span>已生效</span><b>{effects[active].name}</b><small>{effects[active].description}</small></p>
      </div>
      <ul className="word-discoveries" aria-label={`已探索 ${play.discovered.length} 种画面，共 3 种`}>
        {WORD_ZONES.map(zone => <li key={zone.id} data-found={play.discovered.includes(zone.id)}><span aria-hidden="true">{play.discovered.includes(zone.id) ? '✓' : '○'}</span>{effects[zone.id].name}<span className="word-sr-only">{play.discovered.includes(zone.id) ? '，已探索' : '，未探索'}</span></li>)}
      </ul>
      {!ended && <div className="word-finish-area">
        <p>{active === 'none' ? '先让一个画面生效。你可以一直移动，不必现在谢幕。' : dirty ? '还有未落位的草稿，先确认或撤回，再决定谢幕。' : '可以继续移动、收集其他画面；只有谢幕才结束。'}</p>
        {active !== 'none' && <button type="button" className="word-finish" disabled={locked || dirty || dragging} onClick={finish}>就用这个画面谢幕 <span aria-hidden="true">↗</span></button>}
      </div>}
    </div>
  </section>;
}
