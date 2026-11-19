import type { EpisodeId, PlayerView } from '../../shared/contracts';

export function Cat({ angry = false, direction = 0 }: { angry?: boolean; direction?: number }) {
  return <g>
    <ellipse cx="180" cy="212" rx="76" ry="57" fill="#c6c9b7" />
    <g transform={`translate(${direction * 12},0) rotate(${direction * 8} 180 200)`}>
      <path d="M109 131 104 73 150 101M207 101 254 73 250 140" fill="#bfc3af" stroke="#414837" strokeWidth="3" />
      <path d="m115 110-2-22 23 19m85 0 23-19-1 27" fill="#deaa99" />
      <ellipse cx="180" cy="147" rx="85" ry="72" fill="#d7dbcb" />
      <path d="m143 105 18 33m24-40-5 35m29-28-17 31m-84 12 32 7m101-7-29 7" stroke="#949a84" strokeWidth="8" strokeLinecap="round" />
      <path d="m132 153 24 5m48 0 24-5" stroke="#303b30" strokeWidth="6" strokeLinecap="round" />
      <path d="m171 177 9 6 9-6" fill="#84675a" />
      {angry ? <><ellipse cx="180" cy="199" rx="17" ry="14" fill="#3d392e" /><path d="m167 190 7 9 2-10m18 1-7 9-2-10" fill="#ffffed" /></> : <path d="m165 192 15 7 15-7" fill="none" stroke="#514b3c" strokeWidth="3" />}
      <path d="M143 185H94m47 11-43 9m117-20h48m-46 11 43 9" stroke="#7d8470" strokeWidth="2" />
    </g>
    <ellipse cx="149" cy="252" rx="22" ry="12" fill="#d7dbcb" /><ellipse cx="211" cy="252" rx="22" ry="12" fill="#d7dbcb" />
  </g>;
}

export default function Art({ episode, className = '', changed = false, view, frame = 0 }: { episode: EpisodeId; className?: string; changed?: boolean; view?: PlayerView; frame?: number }) {
  const p = view?.presentation ?? {};
  const ending = view?.ending?.id;
  const gesture = String(p.lastGesture ?? '');
  const credits = p.creditsUpdated || changed;
  const screen = String(p.screen ?? 'waiting');
  const playerSpeech = view && [...view.visibleEvents].reverse().find(e => ['player_hiss', 'player_word_recorded'].includes(e.kind))?.text;
  const labels = { wedding: '聚光灯下的婚礼大屏和十二桌', office: '排班会议桌上的来电手机', romance: '同时亮起的两个聊天窗口', hiss: '矮柜上朝玩家哈气的原创圆头猫', reply: '纸团、垃圾桶和等待上场的数字1' };
  return <svg data-scene-art={episode} className={className} viewBox="0 0 360 300" role="img" aria-label={view ? `${view.scene.prop}${gesture ? `；玩家动作：${gesture}` : ''}` : labels[episode]}>
    <defs><pattern id={`grain-${episode}`} width="15" height="15" patternUnits="userSpaceOnUse"><circle cx="2" cy="3" r="0.7" fill="currentColor" opacity=".13" /><circle cx="11" cy="10" r=".6" fill="currentColor" opacity=".1" /></pattern></defs>
    {episode === 'wedding' && <>
      <path d="M20 0h320v266H20z" fill="#b55c52" /><path d="M42 0 97 272H0V0m318 0-55 272h97V0" fill="#833b37" />
      <path d="M59 36h242v151H59z" fill="#f5dcba" /><path d="M67 44h226v135H67z" fill="#273529" />
      {screen === 'photos' ? <><circle cx="163" cy="90" r="15" fill="#e4ccab" /><circle cx="203" cy="90" r="15" fill="#e4ccab" /><path d="M139 139v-18q24-28 48 0v18m-9 0v-18q24-28 48 0v18" fill="#b55c52" /></> : <path d="m165 74 43 26-43 26z" fill="#dce9a0" />}
      <text x="180" y="154" textAnchor="middle" fontSize="13" fill="#e4ccab">{credits ? '本人确认的新片尾' : screen === 'photos' ? '婚礼照片' : screen === 'intro' ? '只播放片头' : screen === 'original' ? '旧片准点播放' : '大屏等待播放'}</text>
      {credits && <text x="180" y="174" textAnchor="middle" fontSize="14" fill="#dce9a0">编剧 · 林禾</text>}
      <path d="M70 289v-39h34v39m157 0v-39h34v39" fill="#71392f" /><ellipse cx="183" cy="250" rx="64" ry="20" fill="#d2a082" /><path d="M132 250v36h102v-36" fill="#bc8167" /><ellipse cx="183" cy="249" rx="64" ry="18" fill="#edd1ad" />
      <circle cx="183" cy="243" r="22" fill="#aa5547" /><text x="183" y="250" textAnchor="middle" fontSize="20" fill="#f6dfc0">12</text>
      {ending === 'wedding.fish' && <g data-prop="fish-and-mic"><ellipse cx="183" cy="260" rx="43" ry="10" fill="#f5ead5" /><ellipse cx="180" cy="260" rx="25" ry="7" fill="#78836a" /><path d="m201 259 12-7v14z" fill="#78836a" /><circle cx="100" cy="205" r="13" fill="#e8bf9d" /><path d="M86 221h27v37H86z" fill="#eee7cb" /><path d="m108 227 19-13" stroke="#e8bf9d" strokeWidth="7" /><path d="m124 211 6-13" stroke="#273529" strokeWidth="5" /><circle cx="132" cy="195" r="6" fill="#273529" /><text x="70" y="285" fill="#f6dfc0" fontSize="11">服务员接麦 · 先上鱼</text></g>}
      {ending === 'wedding.on_time' && <g data-prop="green-handover"><path d="M20 197h95v77H20z" fill="#dce9a0" /><text x="68" y="214" textAnchor="middle" fontSize="12" fill="#273529">设备交接单</text>{[0, 1, 2].map(i => <path key={i} d={`M31 ${227 + i * 15}l4 4 7-8m7 4h48`} stroke="#547243" strokeWidth="3" fill="none" />)}<path d="M272 212h37v40h-37zm-3 40h43m-37 0v28m31-28v28" fill="none" stroke="#f5dcba" strokeWidth="4" /><text x="290" y="205" textAnchor="middle" fontSize="11" fill="#f5dcba">空椅</text></g>}
    </>}
    {episode === 'office' && <>
      <path d="M0 0h360v300H0z" fill="#b8c5bf" /><path d="M35 10h290v155H35z" fill="#dbe4d8" /><path d="M50 20v135m65-135v135m65-135v135m65-135v135m65-135v135" stroke="#9faea5" strokeWidth="3" />
      <path d="m0 260 180-130 180 130v40H0z" fill="#759183" />
      {ending === 'office.rest' || ending === 'office.handover' ? <g data-prop={ending === 'office.rest' ? 'meeting-minutes' : 'signed-hours'}><rect x="36" y="121" width="202" height="155" rx="4" fill="#f2efd9" /><text x="53" y="145" fill="#293e35" fontSize="16">{ending === 'office.rest' ? '会议纪要 · 补记' : '书面交接 · 已签'}</text><text x="53" y="175" fill="#293e35" fontSize="13">{ending === 'office.rest' ? '夜间人工值守：老组长' : '工作时段接听'}</text><text x="53" y="199" fill="#293e35" fontSize="13">{ending === 'office.rest' ? '轮班安排：待排定' : '夜间：按值守表转接'}</text><path d="M53 218h164" stroke="#849087" strokeWidth="2" /><text x="132" y="249" fill="#547243" fontSize="17">{ending === 'office.rest' ? '人事已记录' : '老组长 ✓'}</text></g> : <><path d="m29 215 102-45 109 70-89 49z" fill="#e6e7ca" /><path d="m67 212 73-24m-50 38 75-24m-48 40 57-20" stroke="#849087" strokeWidth="4" /></>}
      <g transform="translate(252 139) rotate(10)"><rect width="77" height="132" rx="13" fill="#293e35" /><rect x="6" y="12" width="65" height="107" rx="7" fill="#152a22" /><text x="39" y="42" fill="#e5eccd" textAnchor="middle" fontSize="14">{ending === 'office.promoted' ? '23:00' : p.call || p.transfer_log || p.minutesUpdated ? '老组长' : '来电'}</text><path d="M20 59h38m-32 13h28" stroke="#7c9e81" strokeWidth="3" /><circle cx="39" cy="94" r="13" fill="#cadd84" /><path d="m34 90 9 9" stroke="#2b442e" strokeWidth="5" /></g>
    </>}
    {episode === 'romance' && <>
      <path d="M0 0h360v300H0z" fill="#bcadd0" /><path d="M22 20h144v258H22z" fill="#e9dfed" /><path d="M194 35h144v258H194z" fill="#e9dfed" /><path d="M22 20h144v37H22z" fill="#5e466e" /><path d="M194 35h144v37H194z" fill="#5e466e" /><text x="94" y="44" fill="#f6e9f6" fontSize="16" textAnchor="middle">汽水</text><text x="266" y="59" fill="#f6e9f6" fontSize="16" textAnchor="middle">退堂鼓</text>
      {[0, 1, 2].map(i => <g key={i}><rect x={i % 2 ? 65 : 32} y={78 + i * 54} width="91" height="34" rx="8" fill={i % 2 ? '#afa97e' : '#cbbbcc'} /><path d={`M${i % 2 ? 77 : 43} ${94 + i * 54}h60`} stroke="#615467" strokeWidth="3" /><rect x={i % 2 ? 206 : 235} y={92 + i * 54} width="91" height="34" rx="8" fill={i % 2 ? '#cbbbcc' : '#afa97e'} /><path d={`M${i % 2 ? 218 : 246} ${108 + i * 54}h60`} stroke="#615467" strokeWidth="3" /></g>)}
      <text x="180" y="270" fill="#5e466e" fontSize="13" textAnchor="middle">两窗 · 各自的消息</text>
    </>}
    {episode === 'hiss' && <>
      <path d="M0 0h360v300H0z" fill="#d6dbaa" /><circle cx="180" cy="141" r="112" fill="#e5e8bf" /><path d="M46 247h268v23H46z" fill="#898b59" /><path d="M57 269v31h246v-31" fill="#b3b581" />
      {view ? <><g transform="translate(127 42) scale(.73)"><Cat angry={Number(p.hissCount) > 0} direction={p.position === 'left' ? -1 : p.position === 'far' ? 1 : 0} /></g><g data-prop="player-performance" transform={p.position === 'far' ? 'translate(28 84) scale(.65)' : 'translate(20 39)'}><path d="M38 138v80m47-80v80" stroke="#3c5146" strokeWidth="12" strokeLinecap="round" /><g transform={gesture === 'bow' ? 'rotate(40 60 140)' : undefined}><path d="M32 87h58v67H32z" fill="#597b71" /><circle cx="61" cy="58" r="25" fill="#e9bc96" /><path d={gesture === 'hiss_back' ? 'M33 100 8 72m80 28 27-29' : gesture === 'freeze' ? 'M32 100v42m58-42v42' : 'M33 104 18 126m71-22 16 23'} stroke="#e9bc96" strokeWidth="10" strokeLinecap="round" />{gesture === 'hiss_back' && <ellipse cx="72" cy="63" rx="7" ry="9" fill="#3d392e" />}</g></g><text x="67" y="281" textAnchor="middle" fontSize="12" fill="#37492e">你 · {({ bow: '鞠躬', hiss_back: '对哈', freeze: '装加载', move_aside: '移到左边', step_back: '退一步' } as Record<string, string>)[gesture] ?? (gesture ? '自由动作' : '等你上场')}</text>{playerSpeech && <text x="20" y="25" fill="#37492e" fontSize="12">{playerSpeech.slice(0, 22)}</text>}{ending === 'hiss.duet' && <path d="M173 38v214" stroke="#597b71" strokeWidth="3" strokeDasharray="6 5" />}</> : <Cat angry={changed} />}
      {(changed || Number(p.hissCount) > 0) && <text x="281" y="130" fill="#37492e" fontSize="25" transform="rotate(12 281 130)">哈—</text>}
    </>}
    {episode === 'reply' && (ending === 'reply.screen' ? <>
      <path d="M0 0h360v300H0z" fill="#c5aa7d" /><path d="M18 18h324v264H18zM180 18v264" stroke="#f5ecd2" strokeWidth="3" fill="none" /><circle cx="180" cy="150" r="42" stroke="#f5ecd2" strokeWidth="3" fill="none" />
      {Array.from({ length: 9 }, (_, i) => <g key={i} transform={`translate(${180 + Math.cos(i * Math.PI * 2 / 9) * 120} ${150 + Math.sin(i * Math.PI * 2 / 9) * 110})`} data-prop="court-avatar"><circle r="17" fill={i % 2 ? '#597b71' : '#6a534a'} /><text y="5" fill="#f5ecd2" textAnchor="middle" fontSize="12">{i + 1}</text></g>)}<text x="180" y="184" textAnchor="middle" fontSize="72" fill="#37492e" transform={changed ? 'rotate(90 180 155)' : undefined}>1</text>
    </> : <>
      <path d="M0 0h360v300H0z" fill="#d7b185" /><path d="M0 226h360v74H0z" fill="#b99169" /><path d="M0 246h360m-320 0-20 54m115-54-6 54m126-54 14 54" stroke="#967252" strokeWidth="2" />
      {frame === 2 && view && view.stage >= 2 && ending !== 'reply.bucket' ? <g data-prop="math-paper"><path d="M65 37h230v206H65z" fill="#f6e9ce" /><path d="M84 74h190" stroke="#c5b49a" strokeWidth="2" /><text x="180" y="63" textAnchor="middle" fontSize="17" fill="#594838">原题 · 纸背面</text><text x="86" y="116" fontSize="20" fill="#594838">2x + 3 = 7</text><text x="86" y="154" fontSize="18" fill="#594838">x = ______</text><text x="86" y="208" fontSize="13" fill="#594838">十年前 · 暑假作业</text></g> : <><g transform={frame === 1 && view && view.stage >= 2 && ending !== 'reply.bucket' ? 'translate(-55 0)' : undefined} data-prop={ending === 'reply.bucket' ? 'bucket-returned' : frame === 1 ? 'bucket-moved' : 'bucket-rim'}><path d="m234 174 8 91h71l8-91" fill="#6e7869" /><ellipse cx="277" cy="175" rx="43" ry="12" fill="#3c5146" /><path d="M249 196h57m-54 18h51m-48 18h44" stroke="#949781" strokeWidth="3" /></g><path d="M111 53q120-18 124 120" fill="none" stroke="#9b7456" strokeWidth="2" strokeDasharray="6 6" /><path d="m225 161 18-9 20 13-3 18-23 5-17-15z" fill="#f6e9ce" />{frame === 1 && view && view.stage >= 2 && <><path d="m331 211-58 27" stroke="#594838" strokeWidth="10" /><path d="M256 285h-53m10-7-10 7 10 7" fill="none" stroke="#594838" strokeWidth="3" /><text x="260" y="110" fill="#594838" fontSize="12">{ending === 'reply.bucket' ? '桶归位 · 撤销两分' : '踢桶 · 左移半米'}</text></>}</>}
      {(ending === 'reply.bucket' || !view) && <text x="93" y="227" fill="#594838" fontSize="143" fontFamily="Georgia,serif">1</text>}
    </>)}
    <path d="M0 0h360v300H0z" fill={`url(#grain-${episode})`} />
  </svg>;
}
