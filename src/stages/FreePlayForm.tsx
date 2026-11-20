import { useState } from 'react';
import { Send } from 'lucide-react';
import type { FreePlay, Params } from '../../shared/contracts';

export default function FreePlayForm({ play, disabled, onSubmit }: { play: FreePlay; disabled: boolean; onSubmit: (params: Params) => Promise<boolean> }) {
  const [text, setText] = useState('');
  const [recipient, setRecipient] = useState('');
  const [kind, setKind] = useState('speech');
  const selected = play.targets.find(item => `${item.id}/${item.channel}` === recipient) ?? play.targets[0];
  const count = Array.from(text).length;
  return <form className="free-play" aria-label="自由接戏" onSubmit={async event => {
    event.preventDefault();
    if (disabled || !selected || !text.trim() || count > play.maxLength) return;
    if (await onSubmit({ text, target: selected.id, channel: selected.channel, kind })) setText('');
  }}>
    <div className="free-play-heading"><b>不用选台词，直接接戏</b><span>{play.responseMode === 'live' ? 'NPC 在线接戏' : '本机记录 · NPC 未接入'}</span></div>
    <p>{play.responseMode === 'live' ? '可以追问、辩论，也可以描述意外的举动。由演出服务决定角色反应，不会自动替你选择剧情动作。' : '可以试写任意台词或动作，原文会记录到所选频道；本机不生成 NPC 回复，也不会把你的描述直接变成事实。'}</p>
    <div className="free-play-routing">
      <label>说给谁听<select value={selected ? `${selected.id}/${selected.channel}` : ''} disabled={disabled} onChange={event => setRecipient(event.target.value)}>{play.targets.map(item => <option key={`${item.id}/${item.channel}`} value={`${item.id}/${item.channel}`}>{item.label}</option>)}</select></label>
      <label>表达方式<select value={kind} disabled={disabled} onChange={event => setKind(event.target.value)}><option value="speech">说一句话</option><option value="action">描述行动</option></select></label>
    </div>
    <label className="field">{kind === 'speech' ? '自由台词' : '自由行动'}<textarea rows={2} maxLength={play.maxLength * 2} value={text} disabled={disabled} onChange={event => setText(event.target.value)} placeholder={kind === 'speech' ? '例如：既然是系统在值夜班，为什么不让系统来开会？' : '例如：我把椅子转过去，邀请那台微波炉担任会议记录员。'} aria-describedby="free-play-limit" /></label>
    <div className="free-play-send"><span id="free-play-limit" role={count > play.maxLength ? 'alert' : undefined}>{count} / {play.maxLength} · 不自动推进剧情节点</span><button className="primary-button" type="submit" disabled={disabled || !selected || !text.trim() || count > play.maxLength}><Send size={16} />{play.responseMode === 'live' ? '发出，等对方接戏' : '记录这次自由表达'}</button></div>
  </form>;
}
