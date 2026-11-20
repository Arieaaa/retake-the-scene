import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ChevronRight, Clapperboard, Copy, Download, Film, FolderOpen, LoaderCircle, Maximize, Minimize, Pause, RotateCcw, Volume2, VolumeX, X } from 'lucide-react';
import { GameError, type AcceptedTurn, type Choice, type EpisodeId, type EpisodeSummary, type GameTransport, type PlayerView, type TurnInput } from '../shared/contracts';
import { getTransport } from './transport';
import Stage from './stages/Stage';
import Art from './stages/Art';
import FreePlayForm from './stages/FreePlayForm';
import { saveCover } from './cover';
import { firstVisibleDifference } from './compare';

const transportPromise = getTransport();
const isView = (v: PlayerView | AcceptedTurn): v is PlayerView => 'branchId' in v;
const episodesAllowed = ['wedding', 'office', 'romance', 'hiss', 'reply'];
const readPreference = <T,>(key: string, fallback: T): T => { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } };
const writePreference = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Preferences do not gate play when storage is unavailable. */ } };
const sourceLabel = { authored: '编剧预写', rules: '现场规则', live: '现场接戏' };

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} aria-label={title} onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }}><div className="modal-head"><h2>{title}</h2><button onClick={onClose} className="icon-button" aria-label="关闭"><X size={20} /></button></div>{children}</dialog>;
}

export default function App() {
  const [route, setRoute] = useState(location.hash.replace(/^#\/?/, ''));
  const [catalog, setCatalog] = useState<EpisodeSummary[]>([]);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [transport, setTransport] = useState<GameTransport | null>(null);
  const [view, setView] = useState<PlayerView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<GameError | null>(null);
  const [notice, setNotice] = useState('');
  const [shareLink, setShareLink] = useState('');
  const [coverFeedback, setCoverFeedback] = useState('');
  const [savingCover, setSavingCover] = useState(false);
  const [muted, setMuted] = useState(() => readPreference('retake.muted', true));
  const [dialog, setDialog] = useState<'clues' | 'rewind' | 'help' | 'say' | 'quote' | 'forward' | 'pause' | null>(null);
  const shell = useRef<HTMLDivElement>(null);
  const activeAudio = useRef<HTMLAudioElement | null>(null);
  const wantsImmersion = useRef(Boolean(route));
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenNote, setFullscreenNote] = useState('');
  const [selectedChoice, setSelectedChoice] = useState<Choice | null>(null);
  const [compared, setCompared] = useState<PlayerView | null>(null);
  const [text, setText] = useState('');
  const [target, setTarget] = useState('');
  const [sample, setSample] = useState('cat_hiss');
  const [elapsed, setElapsed] = useState(0);
  const intent = useRef<{ route: string; key: string } | null>(null);
  const retry = useRef<TurnInput | null>(null);
  const forkRetry = useRef<{ checkpointId: string; forkKey: string } | null>(null);
  const routeGeneration = useRef(0);
  const submittingId = retry.current?.requestId;
  const submittedChoice = view?.choices.find(choice => choice.actionId === retry.current?.actionId) ?? (retry.current ? { actionId: retry.current.actionId, label: ({ free_dialogue: '自由发言 / 行动', move_one: '移动文字 1', finish_wordplay: '用文字场景谢幕' } as Record<string, string>)[retry.current.actionId] ?? '提交动作', targets: view?.freePlay?.targets } : undefined);
  const submittedTarget = submittedChoice?.targets?.find(target => target.id === retry.current?.params.target && (!retry.current.params.channel || target.channel === retry.current.params.channel));
  const mode = transport?.mode ?? (import.meta.env.VITE_GAME_MODE === 'site' ? 'site' : 'authored');
  const preview = route.startsWith('preview/');
  const episode = catalog.find(e => e.id === view?.episodeId);
  const quoteTarget = selectedChoice?.targets?.[0];
  const quotedEvent = view?.visibleEvents.find(event => event.eventId === view.presentation[`${selectedChoice?.actionId}ParentMessageId`] && event.actorId === quoteTarget?.id && event.channel === quoteTarget.channel);
  const firstChange = view?.visibleEvents.find(event => event.eventId === view.presentation.firstChangedEventId && event.audience.includes('player'));
  const forwardTarget = selectedChoice?.targets?.find(target => target.id === 'friend' && target.channel === 'friend');
  const forwardEvent = view?.visibleEvents.find(event => event.eventId === view.presentation.friendForwardPreviewEventId && event.actorId === 'soda' && event.audience.includes('player') && ['soda', 'coach'].includes(event.channel));
  const progress = readPreference<Record<string, { runId: string; branchId: string; ending?: string }>>(`retake.progress.${mode}`, {});
  const recoveryEpisode = route.startsWith('episode/') ? route.split('/')[1] : Object.entries(progress).find(([, saved]) => route === `play/${saved.runId}/${saved.branchId}`)?.[0];
  const asError = (e: unknown) => e instanceof GameError ? e : new GameError('UNEXPECTED', e instanceof Error ? e.message : '这一拍没接上，请重试。', true, 503);

  function accept(next: PlayerView) {
    setView(next); setError(null); retry.current = null; forkRetry.current = null;
    if (!preview) { const saved = readPreference<typeof progress>(`retake.progress.${mode}`, {}); saved[next.episodeId] = { runId: next.runId, branchId: next.branchId, ending: next.ending?.title ?? saved[next.episodeId]?.ending }; writePreference(`retake.progress.${mode}`, saved); }
  }
  function navigate(path: string) {
    wantsImmersion.current = Boolean(path);
    if (!path && document.fullscreenElement === shell.current) void document.exitFullscreen().catch(() => setFullscreenNote('浏览器未退出全屏，可按 Esc 退出。'));
    location.hash = path ? `/${path}` : '';
  }
  async function requestFullscreen() {
    if (!shell.current?.requestFullscreen) { setFullscreenNote('此浏览器不支持原生全屏，已使用满视口舞台。'); return; }
    try {
      await shell.current.requestFullscreen();
      setFullscreenNote('');
      if (!wantsImmersion.current && document.fullscreenElement === shell.current) await document.exitFullscreen();
    } catch { setFullscreenNote('浏览器未开启原生全屏，满视口舞台仍可游玩。'); }
  }
  function enterEpisode(id: EpisodeId) {
    wantsImmersion.current = true;
    void requestFullscreen();
    navigate(`episode/${id}`);
  }
  async function refreshCatalog() {
    try { const t = await transportPromise; setTransport(t); setCatalog(await t.catalog()); } catch (e) { setError(asError(e)); }
  }
  useEffect(() => { void refreshCatalog(); const listener = () => { const next = location.hash.replace(/^#\/?/, ''); wantsImmersion.current = Boolean(next); setRoute(next); }; window.addEventListener('hashchange', listener); return () => window.removeEventListener('hashchange', listener); }, []);
  useEffect(() => {
    const changed = () => setFullscreen(document.fullscreenElement === shell.current);
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);
  useEffect(() => {
    if (!route) {
      if (document.fullscreenElement === shell.current) void document.exitFullscreen().catch(() => setFullscreenNote('可按 Esc 退出浏览器全屏。'));
      return;
    }
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [Boolean(route)]);
  useEffect(() => {
    const generation = ++routeGeneration.current;
    setDialog(null); setCompared(null); setError(null); setView(null); setNotice(''); setShareLink(''); setCoverFeedback(''); setSavingCover(false); retry.current = null; forkRetry.current = null;
    if (!route) { setBusy(false); return; }
    if (intent.current?.route !== route) intent.current = { route, key: crypto.randomUUID() };
    const createKey = intent.current.key;
    setBusy(true);
    (async () => {
      const t = await transportPromise;
      let next: PlayerView;
      if (route.startsWith('preview/') && import.meta.env.VITE_GAME_MODE !== 'site') {
        const fixtures = await import('../fixtures/public/views');
        next = fixtures.previewViews[route.split('/')[1] as keyof typeof fixtures.previewViews];
        if (!next) throw new GameError('NOT_FOUND', '这个交接预览不存在。', false, 404);
      } else if (route.startsWith('episode/') || route.startsWith('new/')) {
        const id = route.split('/')[1] as EpisodeId;
        if (!episodesAllowed.includes(id)) throw new GameError('NOT_FOUND', '片单里没有这部剧。', false, 404);
        const saved = readPreference<Record<string, { runId: string; branchId: string }>>(`retake.progress.${t.mode}`, {})[id];
        next = saved && !route.startsWith('new/') ? await t.read(saved.runId, saved.branchId) : await t.create(id, createKey);
      } else if (route.startsWith('play/')) {
        const [, r, b] = route.split('/');
        if (!r || !b) throw new GameError('NOT_FOUND', '存档地址不完整。', false, 404);
        next = await t.read(r, b);
      } else throw new GameError('NOT_FOUND', '这个现场不存在。', false, 404);
      if (generation !== routeGeneration.current) return;
      accept(next);
      if (route.startsWith('episode/') || route.startsWith('new/')) navigate(`play/${next.runId}/${next.branchId}`);
    })().catch(e => { if (generation === routeGeneration.current) setError(asError(e)); }).finally(() => { if (generation === routeGeneration.current) setBusy(false); });
  }, [route, reloadNonce]);

  useEffect(() => {
    if (!view?.activeRequest || view.status !== 'pending' || !transport || preview) return;
    const r = view.runId, b = view.branchId, id = view.activeRequest.requestId;
    let stopped = false; let timer: ReturnType<typeof setTimeout>; let attempt = 0; let polling = false;
    const tick = async () => {
      if (stopped || polling) return; polling = true;
      try { const next = await transport.poll(r, b, id); if (!stopped && isView(next)) { accept(next); return; } }
      catch (e) { if (!stopped) setError(asError(e)); }
      finally { polling = false; }
      if (!stopped) timer = setTimeout(tick, Math.min(1000 + ++attempt * 500, 3000));
    };
    timer = setTimeout(tick, 1000);
    const visible = () => { if (document.visibilityState === 'visible') { clearTimeout(timer); void tick(); } };
    document.addEventListener('visibilitychange', visible);
    return () => { stopped = true; clearTimeout(timer); document.removeEventListener('visibilitychange', visible); };
  }, [view?.activeRequest?.requestId, transport, preview]);
  useEffect(() => {
    if (!view?.activeRequest) { setElapsed(0); return; }
    const started = view.activeRequest.startedAt;
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - started) / 1000)));
    tick(); const timer = setInterval(tick, 1000); return () => clearInterval(timer);
  }, [view?.activeRequest?.requestId]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 4000); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => { if (view?.episodeId === 'hiss' && view.revision > 0 && !muted && !preview) void sound(); }, [view?.branchId, view?.revision]);
  useEffect(() => { document.title = view?.ending ? `${view.ending.title} · 这集我来演` : episode ? `${episode.shortTitle} · 这集我来演` : '这集我来演 · Retake the Scene'; }, [episode, view?.ending]);
  useEffect(() => {
    if (!view || !episode) return;
    document.querySelector<HTMLElement>(view.ending ? '.scene-title .last-line' : '.scene-title h1')?.focus();
  }, [view?.branchId, view?.stage, view?.ending?.id, episode]);
  useEffect(() => {
    const dialogue = document.querySelector<HTMLElement>('.dialogue');
    if (dialogue) dialogue.scrollTop = dialogue.scrollHeight;
    if (view?.status === 'ready' && view.visibleEvents.slice(-3).some(event => event.kind === 'word_moved')) {
      dialogue?.scrollIntoView({ block: 'nearest' });
      document.querySelector<HTMLElement>('.word-token')?.focus({ preventScroll: true });
    }
  }, [view?.branchId, view?.revision, episode]);

  useEffect(() => { if (submittingId) document.querySelector<HTMLElement>('.submission-panel')?.focus(); }, [submittingId]);

  useEffect(() => { if (dialog === 'pause' || muted || !route) activeAudio.current?.pause(); }, [dialog, muted, route]);

  async function sound() {
    if (dialog === 'pause') return;
    try { activeAudio.current?.pause(); const audio = new Audio('/sound/cat-hiss.wav'); activeAudio.current = audio; audio.volume = 0.25; await audio.play(); } catch { setNotice('声音没能播放，字幕和声纹仍可完成操作。'); }
  }
  async function act(choice: Choice, params: Record<string, string> = {}) {
    if (!view || !transport || busy || preview || forkRetry.current || view.status !== 'ready') return;
    const generation = routeGeneration.current;
    const actionParams = { ...params };
    if (choice.targets?.length && !actionParams.target) actionParams.target = choice.targets[0].id;
    if (view.episodeId === 'hiss' && view.stage === 2) actionParams.sample = sample;
    const input = retry.current ?? { requestId: crypto.randomUUID(), expectedRevision: view.revision, stage: view.stage, actionId: choice.actionId, params: actionParams };
    retry.current = input; setBusy(true); setError(null); setDialog(null);
    try {
      const next = await transport.turn(view.runId, view.branchId, input);
      if (generation !== routeGeneration.current) return;
      const resolved = isView(next) ? next : await transport.read(view.runId, view.branchId);
      if (generation === routeGeneration.current) { accept(resolved); return true; }
    } catch (e) {
      if (generation !== routeGeneration.current) return;
      const err = asError(e);
      if (err.status === 409) {
        retry.current = null;
        try { const latest = await transport.read(view.runId, view.branchId); if (generation !== routeGeneration.current) return; accept(latest); } catch { }
      }
      if (generation !== routeGeneration.current) return;
      if (!err.retryable) retry.current = null;
      setError(err);
    } finally { if (generation === routeGeneration.current) setBusy(false); }
  }
  async function retryAction() {
    if (busy) return;
    if (!view || !transport) { if (route) setReloadNonce(n => n + 1); else { setError(null); void refreshCatalog(); } return; }
    if (retry.current) { const input = retry.current; void act({ actionId: input.actionId, label: '重试', control: 'button' }, input.params); }
    else if (forkRetry.current) void fork(forkRetry.current.checkpointId);
    else {
      const generation = routeGeneration.current;
      setBusy(true); setError(null);
      try { const next = await transport.read(view.runId, view.branchId); if (generation === routeGeneration.current) accept(next); }
      catch (e) { if (generation === routeGeneration.current) setError(asError(e)); }
      finally { if (generation === routeGeneration.current) setBusy(false); }
    }
  }
  async function fork(checkpointId: string) {
    if (!transport || !view || preview || busy || retry.current) return;
    const generation = routeGeneration.current;
    const input = forkRetry.current ?? { checkpointId, forkKey: crypto.randomUUID() };
    forkRetry.current = input; setBusy(true); setError(null); setDialog(null);
    try {
      const next = await transport.fork(view.runId, view.branchId, input.checkpointId, input.forkKey);
      if (generation !== routeGeneration.current) return;
      accept(next); navigate(`play/${next.runId}/${next.branchId}`);
    } catch (e) {
      if (generation !== routeGeneration.current) return;
      const err = asError(e);
      if (!err.retryable) forkRetry.current = null;
      setError(err);
    } finally { if (generation === routeGeneration.current) setBusy(false); }
  }
  async function fallback() {
    if (!transport || !view?.activeRequest || busy || preview) return;
    const generation = routeGeneration.current;
    setBusy(true); setError(null);
    try { const next = await transport.fallback(view.runId, view.branchId, view.activeRequest.requestId); if (generation === routeGeneration.current) accept(next); }
    catch (e) { if (generation === routeGeneration.current) setError(asError(e)); }
    finally { if (generation === routeGeneration.current) setBusy(false); }
  }
  async function compare(branchId: string) {
    if (!transport || !view || busy || preview) return;
    const generation = routeGeneration.current;
    setBusy(true);
    try { const next = await transport.read(view.runId, branchId); if (generation === routeGeneration.current) setCompared(next); }
    catch (e) { if (generation === routeGeneration.current) { setDialog(null); setError(asError(e)); } }
    finally { if (generation === routeGeneration.current) setBusy(false); }
  }
  async function share() {
    if (!view) return;
    const generation = routeGeneration.current;
    const url = `${location.origin}${location.pathname}#/episode/${view.episodeId}`;
    try {
      await navigator.clipboard.writeText(url);
      if (generation === routeGeneration.current) { setShareLink(''); setNotice('已复制开场链接，不包含结局或存档。'); }
    } catch { if (generation === routeGeneration.current) setShareLink(url); }
  }
  async function downloadCover() {
    if (!episode || !view?.ending || savingCover) return;
    const generation = routeGeneration.current;
    setSavingCover(true); setCoverFeedback('');
    try {
      await saveCover(episode, view);
      if (generation === routeGeneration.current) setCoverFeedback('已请求保存封面；若未出现下载，可直接截图保存上方舞台和结局。');
    } catch { if (generation === routeGeneration.current) setCoverFeedback('封面生成失败，可直接截图保存上方舞台和结局。'); }
    finally { if (generation === routeGeneration.current) setSavingCover(false); }
  }
  function say(choice: Choice) { setSelectedChoice(choice); setText(''); setTarget(choice.targets?.[0]?.id ?? ''); setDialog(view?.episodeId === 'romance' && choice.actionId === 'ask_friend' ? 'forward' : 'say'); }

  return <div ref={shell} className={`app-shell${route ? ' immersive' : ''}${dialog === 'pause' ? ' is-paused' : ''}`}>
    <a className="skip-link" href="#main-content" onClick={e => { e.preventDefault(); document.getElementById('main-content')?.focus(); }}>跳到主要内容</a>
    {!route && <header className="site-header"><button className="brand" onClick={() => navigate('')} aria-label="这集我来演，返回片单"><span className="brand-icon"><Clapperboard size={23} /></span><span>这集我来演<small>RETAKE THE SCENE</small></span></button><div className="header-tools"><span className="mode-pill"><i />{mode === 'authored' ? '编剧预写 · 本机存档' : '在线演出'}</span><button className="icon-button" onClick={() => { setMuted(!muted); writePreference('retake.muted', !muted); }} aria-label={muted ? '开启声音' : '静音'} aria-pressed={!muted}>{muted ? <VolumeX size={20} /> : <Volume2 size={20} />}</button><button className="help-button" onClick={() => setDialog('help')}>怎么玩<ChevronRight size={14} /></button></div></header>}
    <main id="main-content" tabIndex={-1}>
      {!route && <div className="catalog-page"><div className="catalog-intro"><div><p className="eyebrow"><span />选角现场 / CASTING OPEN</p><h1>这一次，<br className="mobile-br" />别按剧本来。</h1><p className="intro-copy">穿进配角，动一次道具。<br className="mobile-br" />你的一句话，也许会让这集重拍。</p></div><div className="catalog-stamp"><span>5 部短剧</span><span>自由探索</span><span>随时倒带</span></div></div>
        <div className="section-label"><h2>今天，换你上场</h2><span>全部 5 部 <span className="slash">/</span> 手机竖屏优先</span></div>
        <div className="poster-grid">{catalog.map((e, i) => <button className={`poster-card ${i === 0 ? 'featured' : ''}`} key={e.id} onClick={() => enterEpisode(e.id)} style={{ '--poster-color': e.color } as React.CSSProperties} data-episode={e.id}><div className="poster-top"><span>EP. {e.number}</span><span>{e.genre}</span></div><div className="poster-art"><Art episode={e.id} /><span className="poster-role">你是 / {e.role}</span></div><div className="poster-content"><span className="poster-short">{e.shortTitle}</span><h3>{e.title}</h3><p>{progress[e.id]?.ending ? `上次收场：${progress[e.id].ending}` : e.hook}</p><div className="poster-cta"><span>{progress[e.id] ? '继续这场戏' : e.cta}</span><span className="poster-arrow"><ArrowRight size={18} /></span></div></div></button>)}</div>
        {!catalog.length && !error && <div className="loading-block"><LoaderCircle className="spin" />正在整理片单…</div>}
        <div className="catalog-footnote"><RotateCcw size={18} /><span>结局不是终点。倒回关键一拍，看看同一句话说给不同的人听，会怎样。</span><b>原创短剧 · 单人游玩</b></div>
      </div>}
      {route && !view && <div className="loading-exit"><button className="text-button" onClick={() => navigate('')}><ArrowLeft size={16} />退出舞台</button><span>{mode === 'authored' ? '本机预演' : '在线演出'}</span></div>}
      {route && !view && !error && <div className="loading-block"><LoaderCircle className="spin" /><p>道具就位，等你接戏。</p></div>}
      {view && episode && <div className={`play-page episode-${view.episodeId}`}><div className="play-topline"><button className="text-button" onClick={() => navigate('')}><ArrowLeft size={16} />回片单</button><span className="play-identity">{preview ? 'A / B 固定交接预览' : `EP. ${episode.number} / ${episode.shortTitle}`}<small>{mode === 'authored' ? '编剧预写 · 本机存档' : '在线演出'}</small></span><div className="play-tools"><button className="icon-button" aria-label={muted ? '开启声音' : '静音'} aria-pressed={!muted} onClick={() => { setMuted(!muted); writePreference('retake.muted', !muted); }}>{muted ? <VolumeX size={18} /> : <Volume2 size={18} />}</button><button className="icon-button" aria-label={fullscreen ? '退出浏览器全屏' : '开启浏览器全屏'} onClick={() => { if (fullscreen) void document.exitFullscreen().catch(() => setFullscreenNote('可按 Esc 退出浏览器全屏。')); else void requestFullscreen(); }}>{fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}</button><button className="icon-button" aria-label="暂停演出" onClick={() => setDialog('pause')}><Pause size={18} /></button><button className="text-button" onClick={() => setDialog('rewind')} disabled={busy || Boolean(retry.current || forkRetry.current) || (!view.checkpoints.length && !view.branches.some(branch => branch.branchId !== view.branchId)) || view.status === 'pending'}><RotateCcw size={16} />倒带</button></div></div>{fullscreenNote && <p className="fullscreen-note" role="status">{fullscreenNote}</p>}<div className="play-layout"><div className="stage-column"><Stage key={`${view.branchId}-${view.ending?.id ?? 'playing'}`} view={view} onSound={() => void sound()} disabled={busy || preview || Boolean(retry.current || forkRetry.current) || view.status !== 'ready'} onAction={(actionId, params) => { void act({ actionId, label: actionId === 'move_one' ? '移动文字 1' : '用文字场景谢幕', control: 'gesture' }, params); }} /><div className="stage-note"><Film size={14} /><span>{view.wordPlay ? '移动、旋转可反复尝试；落位才记入存档，谢幕由你决定。' : '原创道具与画面 · 阅读、查看、试听不消耗行动'}</span></div></div><div className="script-column"><div className="scene-title">{view.ending && <p className="last-line" tabIndex={-1}>“{view.ending.line}”</p>}<p className="eyebrow">{view.status === 'ended' ? 'CUT / 谢幕' : view.wordPlay ? 'WORD PLAY / 文字没有固定走法' : `SCENE ${String(view.stage).padStart(2, '0')} / ${view.freePlay ? '可以自由接戏' : '剧情节点'}`}</p><h1 tabIndex={-1}>{view.ending?.title ?? view.scene.title}</h1><p>{view.ending?.text ?? view.scene.text}</p><div className="beat-progress" aria-label={`当前第${Math.min(view.stage, 3)}拍，共3拍`}>{[1, 2, 3].map(n => <i key={n} className={view.stage >= n ? 'filled' : ''} />)}</div></div>
        {view.freePlay && !view.ending && <FreePlayForm key={view.branchId} play={view.freePlay} disabled={busy || preview || Boolean(retry.current || forkRetry.current) || view.status !== 'ready'} onSubmit={async params => Boolean(await act({ actionId: view.freePlay!.actionId, label: '自由接戏', control: 'message' }, params))} />}
        {view.ending && <section className="ending-change" aria-label="第一处被你改变的事件"><h2>第一处被你改变的事件</h2>{firstChange ? <><div className="dialogue-meta"><b>{firstChange.actorName}</b><span>{firstChange.channel === 'public' ? '现场' : firstChange.channel === 'private' ? '私下' : firstChange.channel}</span><small>{sourceLabel[firstChange.source]}</small></div><p className="ending-change-text">{firstChange.text}</p></> : <p>当前视图没有提供可核对的首个改动事件。</p>}</section>}
        <div className="action-heading"><span>对白记录 · {view.visibleEvents.length} 条 · 可滚动回看</span><button className="text-button" onClick={() => setDialog('clues')}><FolderOpen size={15} />已获物证 {view.inventory.length}</button></div><div className="dialogue" role="log" tabIndex={0} aria-live="polite" aria-label="已发生的玩家可见对白">{view.visibleEvents.map(event => <div className={`dialogue-line ${event.actorId === 'player' ? 'player-line' : ''}`} key={event.eventId}><div className="dialogue-meta"><b>{event.actorName}</b><span>{event.channel === 'public' ? '现场' : event.channel === 'private' ? '私下' : event.channel}</span><small>{sourceLabel[event.source]}</small></div><p>{event.text}</p></div>)}</div>
        {view.episodeId === 'office' && !view.freePlay && !view.ending && view.status === 'ready' && <p className="capability-note">演出服务尚未开放自由接戏；当前仅能体验剧情节点。</p>}
        {view.status === 'ready' && <section className="action-panel" aria-label="当拍操作"><div className="action-heading"><span>{submittedChoice ? '你的这一拍' : view.wordPlay ? '也可以回看原版引用剧情' : view.freePlay ? '推动剧情节点（可选）' : '现在，轮到你'}</span></div>{submittedChoice && <section className="submission-panel" tabIndex={-1} aria-live="polite" aria-label="正在提交的原操作"><div>{busy && <LoaderCircle size={17} className="spin" />}<b>{busy ? '正在提交你的动作' : '这次操作尚未确认'}</b></div><p>{submittedChoice.label}</p>{submittedTarget && <p>对象：{submittedTarget.label} · {submittedTarget.channel}</p>}{retry.current?.params.text && <p className="submission-text">{retry.current.params.text}</p>}<small>{busy ? '尚未收到回执，请勿重复提交。' : '重试会沿用这一次提交，不改变动作或台词。'}</small></section>}{view.episodeId === 'hiss' && view.stage === 2 && <label className="sample-picker">要使用哪段声音？<select value={sample} onChange={e => setSample(e.target.value)}><option value="cat_hiss">猫刚才的哈气（预制声纹）</option><option value="player_word">我自己念的词（剧内样本）</option></select></label>}<div className="choices">{view.choices.map(choice => <div key={choice.actionId} className="choice-wrap"><button className="choice" disabled={busy || preview || Boolean(retry.current || forkRetry.current)} onClick={() => { if (view.episodeId === 'reply' && choice.control === 'message') { setSelectedChoice(choice); setDialog('quote'); } else if ((choice.control === 'gesture' && choice.actionId === 'custom_gesture') || (view.episodeId === 'romance' && choice.actionId === 'ask_friend')) say(choice); else void act(choice); }} data-action={choice.actionId}><span><b>{choice.label}</b>{choice.hint && <small>{choice.hint}</small>}</span>{busy && retry.current?.actionId === choice.actionId ? <LoaderCircle size={17} className="spin" /> : <ArrowRight size={17} />}</button>{choice.control === 'message' && view.episodeId !== 'reply' && <button className="say-button" disabled={busy || preview || Boolean(retry.current || forkRetry.current)} onClick={() => say(choice)}>换一句自己的话</button>}</div>)}</div>{preview && <p className="preview-note">固定交接状态仅供核对字段和画面。回片单可实际游玩。</p>}</section>}
        {view.status === 'pending' && <section className="pending-panel" aria-live="polite"><div><LoaderCircle className="spin" /><b>{mode === 'authored' ? view.activeRequest?.actionId === 'free_dialogue' ? '正在记录原文 · NPC 未接入' : '编剧正在把这一拍接下去' : '演员正在接戏'}</b></div><p>你已选择：{view.activeRequest?.label}</p><small>离开或刷新后，可以回来继续这一拍。</small>{elapsed >= 8 && view.activeRequest?.allowFallback && <div className="inline-buttons"><button onClick={() => setNotice('会继续等待，回来时自动查询。')}>继续等</button><button disabled={busy || preview} onClick={() => void fallback()}>用编剧预写接下去</button></div>}</section>}
        {view.ending && <section className="ending-panel"><div className="ending-actions"><button className="primary-button" disabled={busy || preview || Boolean(forkRetry.current)} onClick={() => setDialog('rewind')}><RotateCcw size={17} />倒回去，换个演法</button><button className="secondary-button" onClick={() => void share()}><Copy size={17} />分享开场</button><button className="secondary-button" disabled={savingCover} aria-busy={savingCover} onClick={() => void downloadCover()}>{savingCover ? <LoaderCircle size={17} className="spin" /> : <Download size={17} />}{savingCover ? '正在生成剧照' : '保存这张剧照'}</button><button className="text-button" disabled={busy || preview} onClick={() => navigate(`new/${view.episodeId}`)}>另开一局</button></div>{shareLink && <div className="share-fallback"><p role="status">自动复制不可用，请长按链接或使用键盘复制。不包含结局或存档。</p><label className="field">手动复制开场链接<input readOnly value={shareLink} autoFocus onFocus={e => e.currentTarget.select()} /></label></div>}{coverFeedback && <p className="cover-feedback" role="status">{coverFeedback}</p>}</section>}
      </div></div></div>}
      {error && <div className="error-panel" role="alert"><b>{error.status === 404 ? '这个存档暂时找不到' : '这一拍没有接上'}</b><p>{error.message}</p>{!view && episodesAllowed.includes(recoveryEpisode ?? '') && <p>另开只创建新局，不删除旧存档。</p>}<div className="inline-buttons">{error.retryable && <button onClick={() => void retryAction()} disabled={busy}>重试原操作</button>}{!view && episodesAllowed.includes(recoveryEpisode ?? '') && <button disabled={busy} onClick={() => navigate(`new/${recoveryEpisode}`)}>另开一局</button>}<button onClick={() => navigate('')}>回片单</button></div><small>{error.code}</small></div>}
    </main>
    {!route && <footer className="site-footer"><span>这集我来演<span className="slash">/</span>RETAKE THE SCENE</span><span>{mode === 'authored' ? '作者预演 · 不代表实时 Agent 或云端存档' : '实时与预写来源逐条标记'}</span></footer>}
    {notice && <div className="toast" role="status"><Check size={17} />{notice}</div>}
    {dialog === 'pause' && <Modal title="暂时离开现场" onClose={() => setDialog(null)}><p>已暂停舞台操作和动画，已提交的回合仍会在后台完成。退出全屏或回片单不会丢失已确认的进度；尚未落位的移动和未发送的台词不是存档。</p><div className="inline-buttons"><button onClick={() => setDialog(null)}>继续演出</button><button onClick={() => setDialog('help')}>怎么玩</button><button onClick={() => navigate('')}>保存进度并回片单</button></div></Modal>}
    {dialog === 'help' && <Modal title="四步，换你来演" onClose={() => setDialog(null)}><ol className="help-steps"><li><b>选一部戏</b><p>五部原创短剧，直接进配角的现场。</p></li><li><b>接一拍戏</b><p>扣 1 的舞台可以拖动和旋转文字；职场本有独立的自由表达框。预设动作只负责推动剧情节点，不限制探索次数。</p></li><li><b>看这次收场</b><p>原有结局之外，文字组合可以产生新的收场。看物证、试听与切窗口不消耗回合；本机自由表达仅记录，不冒充 NPC 回复。</p></li><li><b>倒带，试另一条线</b><p>你的旧结局仍保留，角色不会带着未来的秘密回来。</p></li></ol><p className="mode-explanation">{mode === 'authored' ? '当前是编剧预写模式，存档只在这个浏览器。无需登录、麦克风或声音权限。线上双角色与云存档由 B 接入后另行验收。' : '匿名会话通过本站 Cookie 保存。清除 Cookie 后，旧存档将无法找回。'}</p></Modal>}
    {dialog === 'clues' && view && <Modal title="你已经拿到的物证" onClose={() => setDialog(null)}>{view.inventory.length ? view.inventory.map(clue => <article key={clue.id} className="clue-card"><h3>{clue.title}</h3><p>{clue.text}</p><small>重看不消耗行动</small></article>) : <p>还没有获得物证。继续接戏，现场会给你线索。</p>}</Modal>}
    {dialog === 'rewind' && view && <Modal title="倒回哪一刻？" onClose={() => setDialog(null)}><p>另开一条分支。旧线保留，但新线不继承之后发生的秘密。</p>{!view.checkpoints.length && <p>这条线还没有可倒带的决策点，可以先回看或对照旧线。</p>}<div className="rewind-list">{view.checkpoints.map(checkpoint => <button key={checkpoint.id} disabled={busy || preview} onClick={() => void fork(checkpoint.id)}><RotateCcw size={18} /><span>{checkpoint.label}<small>第 {checkpoint.stage} 拍之前</small></span><ArrowRight size={17} /></button>)}</div><h3>回看旧线</h3><div className="rewind-list">{view.branches.map(branch => <button key={branch.branchId} disabled={branch.branchId === view.branchId || preview} onClick={() => { setDialog(null); navigate(`play/${view.runId}/${branch.branchId}`); }}><Film size={18} /><span>{branch.endingTitle ?? branch.label}<small>{branch.branchId === view.branchId ? '正在这条线' : '读取已发生的事件，不重新接戏'}</small></span><ArrowRight size={17} /></button>)}</div>{!preview && view.branches.filter(b => b.branchId !== view.branchId).map(branch => <button className="secondary-button compare-button" key={`compare-${branch.branchId}`} disabled={busy} onClick={() => void compare(branch.branchId)}>对照：{branch.endingTitle ?? branch.label}</button>)}{compared && <div className="branch-compare"><h3>玩家可见的第一处差异</h3>{(() => { const difference = firstVisibleDifference(view, compared); return difference ? <div><p><b>当前线</b>{difference.left?.text ?? '这条线还没有发生这一拍'}</p><p><b>对照线</b>{difference.right?.text ?? '这条线还没有发生这一拍'}</p></div> : <p>已发生的可见事件相同。不比较角色私聊或未来秘密。</p>; })()}</div>}</Modal>}
    {dialog === 'quote' && selectedChoice && <Modal title="确认引用这条消息" onClose={() => setDialog(null)}><p>回复对象：{quoteTarget?.label}。这还是草稿，确认发送才消耗一拍。</p>{quotedEvent ? <article className="quote-parent"><b>{quotedEvent.actorName} · 群聊</b><p>{quotedEvent.text}</p></article> : <p role="alert">该引用楼层暂不可见，请返回重新选楼；不会代你发送。</p>}<label className="field">发送正文<input readOnly value="1" /></label><div className="inline-buttons"><button data-confirm-quote disabled={!quotedEvent || !quoteTarget || busy} onClick={() => { if (quotedEvent && quoteTarget) void act(selectedChoice, { parentMessageId: quotedEvent.eventId, target: quoteTarget.id, channel: quoteTarget.channel, text: '1' }); }}>确认引用并发送 1</button><button onClick={() => setDialog(null)}>撤回草稿，重新选楼</button></div></Modal>}
    {dialog === 'forward' && selectedChoice && <Modal title="确认转发给阿圆" onClose={() => setDialog(null)}><p>转发给阿圆 · 私聊。只发送下面这一条历史消息和你的附言，不包含其他窗口或未发送草稿。</p>{forwardEvent && forwardTarget ? <article className="quote-parent forward-preview"><b>{forwardEvent.actorName} · {forwardEvent.channel === 'soda' ? '汽水窗口' : '退堂鼓窗口'}</b><p>{forwardEvent.text}</p></article> : <p role="alert">暂不能确认转发：原消息或收件范围不符合当前视图，请返回重新读取；不会代你发送。</p>}<label className="field">给阿圆的附言（可选）<textarea maxLength={80} rows={2} value={text} onChange={e => setText(e.target.value)} /></label><div className="text-count">{Array.from(text).length} / 80</div><div className="inline-buttons"><button data-confirm-forward disabled={!forwardEvent || !forwardTarget || busy} onClick={() => { if (forwardEvent && forwardTarget) void act(selectedChoice, { forwardEventId: forwardEvent.eventId, target: forwardTarget.id, channel: forwardTarget.channel, ...(text.trim() ? { text: text.trim() } : {}) }); }}>确认转发给阿圆</button><button onClick={() => setDialog(null)}>取消转发</button></div></Modal>}
    {dialog === 'say' && selectedChoice && <Modal title={selectedChoice.control === 'gesture' ? '自己写一个动作' : '先选对象，再说这句话'} onClose={() => setDialog(null)}><p>本拍意图：{selectedChoice.label}。措辞不会赋予角色越权道具或秘密。</p>{selectedChoice.targets?.length ? <label className="field">说给谁听<select value={target} onChange={e => setTarget(e.target.value)}>{selectedChoice.targets.map(t => <option value={t.id} key={t.id}>{t.label} · {t.channel}</option>)}</select></label> : null}<label className="field" htmlFor="player-text">{selectedChoice.control === 'gesture' ? '你的动作' : '你的台词'}<textarea id="player-text" maxLength={80} rows={3} value={text} onChange={e => setText(e.target.value)} placeholder={selectedChoice.control === 'gesture' ? '我把刚才它哈我的声音设成返回键' : '只说你想说的那一句'} autoFocus /></label><div className="text-count">{Array.from(text).length} / 80</div><button className="primary-button" disabled={!text.trim() || busy} onClick={() => void act(selectedChoice, { text: text.trim(), ...(target ? { target } : {}) })}>确认{selectedChoice.control === 'gesture' ? '行动' : '收件人与发送'}<ArrowRight size={16} /></button></Modal>}
  </div>;
}
