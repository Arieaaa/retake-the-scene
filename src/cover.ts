import type { EpisodeSummary, PlayerView } from '../shared/contracts';

export async function saveCover(episode: EpisodeSummary, view: PlayerView): Promise<void> {
  if (!view.ending) return;
  const canvas = document.createElement('canvas');
  canvas.width = 900; canvas.height = 1200;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前浏览器无法生成封面，可直接截图保存。');
  ctx.fillStyle = '#191d18'; ctx.fillRect(0, 0, 900, 1200);
  ctx.fillStyle = episode.color; ctx.fillRect(60, 60, 780, 710);
  const svg = document.querySelector('.stage svg[data-scene-art]') as SVGSVGElement | null;
  if (view.wordPlay && view.ending.id === 'reply.wordplay') {
    const board = view.wordPlay;
    ctx.fillStyle = '#e3e8c8'; ctx.fillRect(80, 100, 740, 620);
    ctx.save(); ctx.translate(80, 100);
    ctx.fillStyle = '#273529'; ctx.font = 'bold 40px sans-serif'; ctx.fillText('1 的文字现场', 30, 55);
    ctx.font = '28px sans-serif'; ctx.fillText('名单', 75, 112);
    ctx.strokeStyle = '#6d9e83'; ctx.lineWidth = 4; ctx.strokeRect(382, 230, 266, 170);
    ctx.fillText(board.effect === 'bridge' ? '横过来 · 挡拆' : '球场', 410, 276);
    ctx.save(); ctx.font = 'bold 64px Arial,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('0', 0.37 * 740, 0.25 * 620);
    ctx.fillText('0', 0.19 * 740, 0.8 * 620); ctx.fillText('0', 0.41 * 740, 0.8 * 620);
    ctx.strokeStyle = '#273529'; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(0.25 * 740, 0.818 * 620); ctx.lineTo(0.35 * 740, 0.818 * 620); ctx.stroke(); ctx.restore();
    ctx.save(); ctx.translate(board.x * 7.4, board.y * 6.2); ctx.rotate(board.rotation * Math.PI / 180);
    ctx.fillStyle = '#273529'; ctx.font = 'bold 76px Arial,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('1', 0, 0); ctx.restore();
    ctx.font = '22px sans-serif'; ctx.fillText(`已发现：${board.discovered.map(effect => ({ ten: '10人名单', bridge: '横向挡拆', equal: '原题等式' })[effect]).join(' / ')}`, 30, 584);
    ctx.restore();
  } else if (svg) {
    const copy = svg.cloneNode(true) as SVGSVGElement;
    copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); copy.setAttribute('width', '780'); copy.setAttribute('height', '650');
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }));
    try { const image = new Image(); image.src = url; await image.decode(); ctx.drawImage(image, 60, 120, 780, 650); } finally { URL.revokeObjectURL(url); }
  } else if (view.episodeId === 'romance') {
    const windows = view.presentation.activeWindow === 'soda' ? [['soda', '汽水']] : [['soda', '汽水'], ['coach', '退堂鼓']];
    const width = windows.length === 1 ? 740 : 355;
    windows.forEach(([channel, label], index) => {
      const x = 80 + index * 385;
      ctx.fillStyle = '#e9dfed'; ctx.fillRect(x, 100, width, 630);
      ctx.fillStyle = '#5e466e'; ctx.fillRect(x, 100, width, 65);
      ctx.fillStyle = '#f6e9f6'; ctx.font = 'bold 28px sans-serif'; ctx.fillText(label, x + 20, 143);
      ctx.save(); ctx.beginPath(); ctx.rect(x + 15, 175, width - 30, 540); ctx.clip();
      ctx.font = '26px sans-serif'; ctx.fillStyle = '#392b40';
      let y = 205;
      for (const event of view.visibleEvents.filter(e => e.channel === channel).slice(-4)) y = wrap(ctx, event.text, x + 20, y, width - 40, 36) + 26;
      ctx.restore();
    });
  }
  ctx.fillStyle = '#f4f0df'; ctx.font = '24px sans-serif'; ctx.fillText('这集我来演 / RETAKE THE SCENE', 60, 830);
  ctx.font = 'bold 48px sans-serif';
  wrap(ctx, view.ending.title, 60, 915, 780, 62);
  ctx.font = '24px sans-serif'; wrap(ctx, view.ending.line, 60, 1010, 780, 32);
  const source = view.visibleEvents.some(e => e.source === 'live') ? '现场接戏（含规则衔接）' : '编剧预写';
  ctx.font = '20px sans-serif'; ctx.fillStyle = '#c2c6b7'; ctx.fillText(`${source} / ${episode.shortTitle} / 你的这一条分支`, 60, 1160);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('保存失败，可截图保留这张结局卡。')), 'image/png'));
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `这集我来演-${view.ending.id}.png`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, height: number) {
  let line = ''; let row = 0;
  for (const char of text) { if (ctx.measureText(line + char).width > max) { ctx.fillText(line, x, y + row++ * height); line = ''; } line += char; }
  ctx.fillText(line, x, y + row * height);
  return y + (row + 1) * height;
}
