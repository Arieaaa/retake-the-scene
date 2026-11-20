import { useEffect, useState } from 'react';
import { Play, Phone, Volume2, MessageSquare, ArrowLeft } from 'lucide-react';
import type { PlayerView } from '../../shared/contracts';
import Art from './Art';
import WordBoard from './WordBoard';

export default function Stage({ view, onSound, disabled, onAction }: { view: PlayerView; onSound: () => void; disabled: boolean; onAction: (actionId: string, params: Record<string, string>) => void }) {
  const [chat, setChat] = useState('soda');
  const [frame, setFrame] = useState(0);
  const [screen, setScreen] = useState(false);
  const [comment, setComment] = useState('首先，要和小动物建立信任');
  const [posted, setPosted] = useState(false);
  const p = view.presentation;
  const lastText = view.visibleEvents.at(-1)?.text ?? view.scene.text;
  const credits = Boolean(p.creditsUpdated);
  const activeChat = p.activeWindow === 'soda' ? 'soda' : chat;
  const playerSpeech = [...view.visibleEvents].reverse().find(e => ['player_hiss', 'player_word_recorded'].includes(e.kind))?.text;
  useEffect(() => { document.querySelectorAll<HTMLElement>('.chat-scroll').forEach(el => { el.scrollTop = el.scrollHeight; }); }, [view.revision, activeChat]);
  return <section className={`stage stage-${view.episodeId}`} aria-label="道具舞台">
    <div className="stage-heading"><span className="live-dot" /><span>{view.scene.kicker}</span><span className="stage-caption">{view.status === 'ended' ? '最后一个镜头' : `SCENE 0${view.stage}`}</span></div>
    {view.episodeId === 'wedding' && <>
      <Art episode="wedding" view={view} />
      <div className="prop-panel"><span>婚礼控屏台 / 仅你可见</span><div className="file-row"><Play size={17} /><b>大学短剧_最终版.mp4</b><span>{credits ? '已更新' : '00:38'}</span></div>
        <div className="timeline" aria-label="视频片尾位置"><i /></div><div className="prop-bottom"><span>{credits ? '片尾：本人已确认署名' : p.missing_credit ? '小窗片尾：少了一行名字' : '控台预览不会投到全场大屏'}</span><span>十二桌</span></div>
      </div>
    </>}
    {view.episodeId === 'office' && <>
      <Art episode="office" view={view} />
      <div className="prop-panel"><span>会议控台 / 运营记录</span><div className="file-row"><Phone size={18} /><b>{view.ending?.id === 'office.promoted' ? '你的手机 · 23:00' : p.transfer_log || p.minutesUpdated ? '已查明人工转接' : '新排班表 · 来电待核对'}</b></div><p>{view.scene.prop}</p></div>
    </>}
    {view.episodeId === 'romance' && <>
      <div className="chat-tabs" role="tablist" aria-label="聊天窗口">{[['soda', '汽水'], ['coach', '退堂鼓']].map(([id, label]) => <button key={id} role="tab" aria-selected={activeChat === id} aria-controls={`chat-${id}`} id={`tab-${id}`} disabled={p.activeWindow === 'soda' && id === 'coach'} onClick={() => setChat(id)}><MessageSquare size={16} />{label}</button>)}</div>
      <div className="dual-chats">{[['soda', '汽水'], ['coach', '退堂鼓']].map(([id, label]) => <div key={id} id={`chat-${id}`} role="tabpanel" aria-labelledby={`tab-${id}`} className={`chat-window ${activeChat === id ? 'selected-chat' : ''} ${p.activeWindow === 'soda' && id === 'coach' ? 'inactive-chat' : ''}`}><h3>{label}<small>{p.activeWindow === 'soda' && id === 'coach' ? '已停止发送' : '当前可见消息'}</small></h3><div className="chat-scroll">{view.visibleEvents.filter(e => e.channel === id).map(e => <p key={e.eventId} className={`bubble ${e.actorId === 'player' ? 'own' : ''}`}>{e.text}</p>)}</div></div>)}</div>
      {view.inventory.length > 0 && <div className="prop-panel">{view.inventory.map(clue => <p key={clue.id}><b>{clue.id === 'draft' && p.draftSent ? '原稿 · 已发给汽水' : clue.title}</b><br />{clue.text}</p>)}</div>}
    </>}
    {view.episodeId === 'hiss' && <>
      <div className={`cat-shot ${Number(p.hissCount) ? 'has-hissed' : ''}`} key={`${view.branchId}-${view.revision}`}><Art episode="hiss" view={view} /><div className="video-badge">换好了，老师请。</div><div className="video-subtitle">{Number(p.hissCount) > 0 ? '猫：哈——（朝你）' : '你：这有啥，换我来。'}</div></div>
      <div className="prop-panel"><span>声控快捷键 · 剧内预制样本</span><div className="wave-row"><button onClick={onSound} aria-label="试听猫的哈气"><Volume2 size={18} /></button><div className="waveform" aria-label={p.sample === 'player_word' ? '玩家念词的声纹波形' : '猫哈气的声纹波形'}>{Array.from({ length: 32 }, (_, i) => <i key={i} style={{ height: `${10 + ((i * (p.sample === 'player_word' ? 7 : 17)) % 30)}px` }} />)}</div><span>00:01</span></div><p>{p.binding ? `已绑定：${({ back: '返回上一页', cover: '定格封面', duet: '左右合拍' } as Record<string, string>)[String(p.binding)]} · ${p.sample === 'player_word' ? '玩家念词' : '猫的哈气'} · ${view.ending ? '已触发' : p.armed ? '已松开，等下一声新哈' : '未匹配，请重新绑定'}` : '录制只收音，松开才生效。无需麦克风权限。'}</p>
        {p.lastGesture && <p className="recorded-performance">最后动作：{({ bow: '鞠躬告辞', hiss_back: '跟猫对哈', move_aside: '移到镜头左边', step_back: '收手后退', freeze: '原地装加载' } as Record<string, string>)[String(p.lastGesture)] ?? p.lastGesture}{playerSpeech && <><br />已录发言：{playerSpeech}</>}</p>}
        {view.ending?.id === 'hiss.cover' && <p className="cover-comment">定格热评：{p.coverComment}</p>}
        {view.ending?.id === 'hiss.back' && <div className="fictional-comments"><b><ArrowLeft size={14} /> 已返回剧内评论区</b><p>你：这有啥，换我来。</p><p>楼下：老师，怎么做到的？</p>{posted ? <p>你：{comment || '默默删掉了草稿。'}</p> : <><label htmlFor="final-comment">你的回复</label><input id="final-comment" maxLength={80} value={comment} onChange={e => setComment(e.target.value)} /><div className="inline-buttons"><button onClick={() => setPosted(true)}>发出</button><button onClick={() => { setComment(''); setPosted(true); }}>默默删掉</button></div></>}</div>}
        {view.ending?.id === 'hiss.duet' && <><p className="duet-title">{p.duetTitle}</p><div className="duet-layout"><span>玩家录像在左<br />{playerSpeech ?? '特邀嘉宾负责挨哈'}</span><span>原版在右<br />猫：哈——</span></div></>}
      </div>
    </>}
    {view.wordPlay && <WordBoard view={view} disabled={disabled} onAction={onAction} />}
    {view.episodeId === 'reply' && view.ending?.id !== 'reply.wordplay' && <>
      <div className="group-bar"><MessageSquare size={16} /><b>十年老群</b><span>38 人</span></div>
      <div className="clip-player"><Art episode="reply" view={view} frame={view.ending?.id === 'reply.class' ? 2 : frame} changed={screen} /><span className="clip-name">{view.ending?.id === 'reply.bucket' ? '最终版别发这个.gif' : view.ending?.id === 'reply.screen' ? '球局已齐 · 九个队友和你' : view.ending?.id === 'reply.class' ? '原题恢复 · 订正接龙' : '牢大最后一投.gif'}</span><span className="frame-label">{view.ending ? '最后一个镜头' : view.stage >= 2 ? `关键帧 ${frame + 1} / 3` : '原图停在筐沿'}</span></div>
      {view.stage >= 2 && !view.ending && <div className="frame-controls" aria-label="查看原创动图关键帧">{['打铁', '桶左移', '纸背原题'].map((label, i) => <button key={label} aria-pressed={frame === i} onClick={() => setFrame(i)}>{label}</button>)}</div>}
      <div className="prop-panel"><span>消息引用 / 正文始终只有 1</span><div className="quoted-message">{p.replyTarget ? `当前引用：${p.replyTarget}` : '老群主：扣1复活完整版'}</div><p>{view.ending?.text ?? lastText}</p>{view.ending?.id === 'reply.screen' && <button className="court-action" onPointerDown={e => e.currentTarget.setPointerCapture(e.pointerId)} onPointerUp={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) setScreen(true); }} onClick={() => setScreen(true)}><span className={screen ? 'one horizontal' : 'one'}>1</span>{screen ? '已横过来 · 挡拆成功' : '横过来挡拆'}</button>}{view.ending?.id === 'reply.class' && <div className="typing-avatars" aria-label="37个旧头像正在输入">{Array.from({ length: 37 }, (_, i) => <span key={i}>{i + 1}<small>···</small></span>)}</div>}</div>
    </>}
  </section>;
}
