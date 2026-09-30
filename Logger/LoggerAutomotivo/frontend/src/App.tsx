import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, NavLink, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Activity, AlertTriangle, Battery, Bell, ChevronRight, CircleGauge, Clock3, CloudDownload, Cpu, Database, Gauge, History, Info, LayoutDashboard, Menu, Radio, RefreshCw, Search, Settings, ShieldAlert, Signal, SlidersHorizontal, Wrench, X, XCircle } from 'lucide-react'
import { API_URL, getJson, type EventItem, type Level, type Logger, type Part, type Status } from './api'

const dateTime = (value?: string | null) => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value)) : 'Sem comunicação'

function useApi<T>(path: string, refreshMs = 0) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    let controller: AbortController | undefined
    const load = async () => {
      controller?.abort()
      controller = new AbortController()
      try {
        const result = await getJson<T>(path, controller.signal)
        if (active) { setData(result); setError('') }
      } catch (err) {
        if (active && (err as Error).name !== 'AbortError') setError((err as Error).message)
      } finally { if (active) setLoading(false) }
    }
    if (!path) { setData(null); setLoading(false); return }
    setLoading(true)
    load()
    const timer = refreshMs ? window.setInterval(load, refreshMs) : undefined
    return () => { active = false; controller?.abort(); if (timer) window.clearInterval(timer) }
  }, [path, refreshMs])
  return { data, error, loading }
}

const levelIcon: Record<Level, ReactNode> = { INFO: <Info />, WARNING: <AlertTriangle />, ERROR: <XCircle />, CRITICAL: <ShieldAlert /> }
function Badge({ value }: { value: Level | Status }) {
  const icon = value === 'ONLINE' ? <Activity /> : value === 'OFFLINE' ? <XCircle /> : value === 'WARNING' ? <AlertTriangle /> : levelIcon[value as Level]
  return <span className={`badge badge-${value.toLowerCase()}`}>{icon}{value}</span>
}

function State({ loading, error, empty, children }: { loading: boolean; error?: string; empty?: boolean; children: ReactNode }) {
  if (loading) return <div className="state"><RefreshCw className="spin" /><strong>Carregando dados...</strong></div>
  if (error) return <div className="state state-error"><XCircle /><strong>Não foi possível carregar</strong><span>{error}</span></div>
  if (empty) return <div className="state"><Database /><strong>Nenhum registro encontrado</strong><span>Ajuste os filtros ou faça uma nova pesquisa.</span></div>
  return <>{children}</>
}

function Layout({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const location = useLocation()
  useEffect(() => setOpen(false), [location.pathname])
  const links = [
    ['/', LayoutDashboard, 'Dashboard'], ['/search', Search, 'Pesquisar Peça'], ['/devices', Cpu, 'Dispositivos'],
    ['/alerts', Bell, 'Alertas'], ['/settings', Settings, 'Configurações'],
  ] as const
  return <div className="shell">
    <button className="mobile-menu" onClick={() => setOpen(true)} aria-label="Abrir menu"><Menu /></button>
    {open && <button className="backdrop" onClick={() => setOpen(false)} aria-label="Fechar menu" />}
    <aside className={open ? 'sidebar open' : 'sidebar'}>
      <div className="brand"><span className="brand-mark"><Activity /></span><div><b>LOGGER AUTO</b><small>DIAGNÓSTICO IoT</small></div></div>
      <nav>{links.map(([to, Icon, label]) => <NavLink key={to} to={to} end={to === '/'}><Icon />{label}</NavLink>)}</nav>
      <div className="sidebar-foot"><span className="system-dot" /> <div><b>Sistema operacional</b><small>API monitorada</small></div></div>
    </aside>
    <main className="main"><header className="topbar"><div><span>Central técnica</span><b>Ambiente de demonstração</b></div><div className="operator"><span>ST</span><div><b>Suporte Técnico</b><small>Operador</small></div></div></header>{children}</main>
  </div>
}

function PageTitle({ eyebrow, title, text, action }: { eyebrow?: string; title: string; text?: string; action?: ReactNode }) {
  return <div className="page-title"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h1>{title}</h1>{text && <p>{text}</p>}</div>{action}</div>
}

function Home() {
  const { data, error, loading } = useApi<{ summary: { online: number; offline: number; warning: number; critical: number; failures24h: number }; recentEvents: EventItem[] }>('/api/dashboard', 15000)
  return <section className="content"><PageTitle eyebrow="VISÃO OPERACIONAL" title="Dashboard" text="Resumo da frota monitorada e ocorrências que exigem atenção." action={<Link className="button primary" to="/search"><Search />Pesquisar peça</Link>} />
    <State loading={loading} error={error}><div className="metric-grid">
      <Metric icon={<Radio />} label="Loggers online" value={data?.summary.online ?? 0} tone="green" detail="com comunicação recente" />
      <Metric icon={<Signal />} label="Loggers offline" value={data?.summary.offline ?? 0} tone="neutral" detail="fora do limite de heartbeat" />
      <Metric icon={<ShieldAlert />} label="Falhas críticas" value={data?.summary.critical ?? 0} tone="red" detail="nas últimas 24 horas" />
      <Metric icon={<AlertTriangle />} label="Falhas em 24h" value={data?.summary.failures24h ?? 0} tone="amber" detail="erros e eventos críticos" />
    </div>
    <div className="panel"><div className="panel-head"><div><h2>Ocorrências recentes</h2><p>Eventos relevantes, sem o ruído dos registros informativos.</p></div><Link to="/alerts">Ver alertas <ChevronRight /></Link></div>
      {data?.recentEvents.length ? <div className="event-list">{data.recentEvents.map(e => <EventRow key={e.id} event={e} />)}</div> : <div className="mini-empty">Nenhuma ocorrência relevante.</div>}
    </div></State>
  </section>
}

function Metric({ icon, label, value, tone, detail }: { icon: ReactNode; label: string; value: number; tone: string; detail: string }) {
  return <article className={`metric tone-${tone}`}><div className="metric-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></article>
}

function EventRow({ event }: { event: EventItem }) {
  return <div className="event-row"><Badge value={event.level} /><div className="event-main"><b>{event.event}</b><span>{event.pieceId || 'Peça não associada'} · {event.loggerId}</span></div><div className="event-cause">{event.possibleCause || `${event.signal ?? 'Sinal'} recebido conforme esperado.`}</div><time>{dateTime(event.timestamp)}</time>{event.pieceId && <Link aria-label={`Ver diagnóstico de ${event.pieceId}`} to={`/parts/${event.pieceId}?tab=diagnosis`}><ChevronRight /></Link>}</div>
}

function SearchPage() {
  const [input, setInput] = useState('PT-00018429')
  const [query, setQuery] = useState('')
  const { data, error, loading } = useApi<{ items: Part[]; count: number }>(query ? `/api/parts?search=${encodeURIComponent(query)}` : '', 15000)
  const submitted = Boolean(query)
  return <section className="content"><PageTitle eyebrow="LOCALIZAÇÃO RÁPIDA" title="Pesquisar peça" text="Busque pelo ID da peça, número de série ou Logger associado." />
    <div className="search-hero"><form onSubmit={e => { e.preventDefault(); setQuery(input.trim()) }}><Search /><input value={input} onChange={e => setInput(e.target.value)} placeholder="Digite o ID da peça" aria-label="ID da peça, série ou Logger" /><button className="button primary" disabled={!input.trim()}>Pesquisar</button></form><div className="search-hint"><Info />Use, por exemplo, <button onClick={() => { setInput('PT-00018429'); setQuery('PT-00018429') }}>PT-00018429</button>, <button onClick={() => { setInput('SN-2026-18429'); setQuery('SN-2026-18429') }}>SN-2026-18429</button> ou <button onClick={() => { setInput('LOGGER-001'); setQuery('LOGGER-001') }}>LOGGER-001</button>.</div></div>
    {submitted && <State loading={loading} error={error} empty={!data?.items.length}><div className="results-label">{data?.count} resultado encontrado</div>{data?.items.map(part => <PartResult key={part.id} part={part} />)}</State>}
  </section>
}

function PartResult({ part }: { part: Part }) {
  return <article className="part-result"><div className="part-result-top"><div className="part-icon"><Wrench /></div><div><span>ID DA PEÇA</span><h2>{part.pieceId}</h2><p>{part.model}</p></div><Badge value={part.status} /></div><div className="part-facts"><Fact label="Número de série" value={part.serialNumber} /><Fact label="Logger associado" value={part.loggerId ?? 'Não associado'} /><Fact label="Última comunicação" value={dateTime(part.lastSeen)} /><Fact label="Última falha" value={part.latestFailure ? dateTime(part.latestFailure.timestamp) : 'Consulte os detalhes'} /></div><Link className="button primary" to={`/parts/${part.pieceId}`}>Abrir dispositivo <ChevronRight /></Link></article>
}

function Fact({ label, value }: { label: string; value: ReactNode }) { return <div className="fact"><span>{label}</span><strong>{value}</strong></div> }

function Devices() {
  const { data, error, loading } = useApi<{ items: Logger[] }>('/api/loggers', 15000)
  return <section className="content"><PageTitle eyebrow="EQUIPAMENTOS DE CAMPO" title="Dispositivos" text="Estado resumido dos Loggers e suas peças atualmente associadas." /><State loading={loading} error={error} empty={!data?.items.length}><div className="panel table-wrap"><table><thead><tr><th>Logger ID</th><th>Peça associada</th><th>Status</th><th>Última comunicação</th><th>Firmware</th><th>Comunicação</th></tr></thead><tbody>{data?.items.map(x => <tr key={x.id}><td><b>{x.loggerId}</b></td><td>{x.pieceId ? <Link to={`/parts/${x.pieceId}`}>{x.pieceId}</Link> : '—'}</td><td><Badge value={x.status} /></td><td>{dateTime(x.lastSeen)}</td><td>{x.firmwareVersion ?? '—'}</td><td>{x.communicationMode ?? '—'}</td></tr>)}</tbody></table></div></State></section>
}

function Alerts() {
  const { data, error, loading } = useApi<{ items: EventItem[] }>('/api/alerts', 15000)
  return <section className="content"><PageTitle eyebrow="TRIAGEM TÉCNICA" title="Alertas" text="Ocorrências ordenadas por prioridade e data." /><State loading={loading} error={error} empty={!data?.items.length}><div className="panel table-wrap"><table><thead><tr><th>Severidade</th><th>Peça</th><th>Logger</th><th>Problema</th><th>Data/hora</th><th>Status</th><th></th></tr></thead><tbody>{data?.items.map(x => <tr key={x.id}><td><Badge value={x.level} /></td><td><b>{x.pieceId ?? '—'}</b></td><td>{x.loggerId}</td><td>{x.event}<small className="cell-sub">{x.possibleCause}</small></td><td>{dateTime(x.timestamp)}</td><td><span className={x.result === 'FAIL' ? 'result-fail' : ''}>{x.result ?? 'REGISTRADO'}</span></td><td>{x.pieceId && <Link className="row-action" to={`/parts/${x.pieceId}?tab=diagnosis`}>Ver diagnóstico</Link>}</td></tr>)}</tbody></table></div></State></section>
}

function SettingsPage() {
  return <section className="content"><PageTitle eyebrow="PARÂMETROS DO MVP" title="Configurações" text="Referências operacionais desta demonstração." /><div className="settings-grid"><Setting icon={<Clock3 />} title="Heartbeat" value="Recomendado a cada 60 segundos" text="Eventos válidos também atualizam a última comunicação." /><Setting icon={<Signal />} title="Limite offline" value="10 minutos" text="Configurável por OFFLINE_THRESHOLD_MINUTES no backend." /><Setting icon={<Database />} title="Retenção de logs" value="Sem expiração no MVP" text="Política de retenção será definida na etapa de produção." /><Setting icon={<ShieldAlert />} title="Autenticação de dispositivo" value="Preparada para evolução" text="A API possui um ponto único de ingestão; chaves por Logger serão adicionadas futuramente." /></div></section>
}
function Setting({ icon, title, value, text }: { icon: ReactNode; title: string; value: string; text: string }) { return <article className="setting"><div>{icon}</div><span>{title}</span><strong>{value}</strong><p>{text}</p></article> }

type Tab = 'overview' | 'log' | 'diagnosis' | 'history'
function PartDetail() {
  const { pieceId = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const selected = (['overview','log','diagnosis','history'].includes(params.get('tab') ?? '') ? params.get('tab') : 'overview') as Tab
  const { data: part, error, loading } = useApi<Part>(`/api/parts/${encodeURIComponent(pieceId)}`, 15000)
  const tabs: [Tab, string][] = [['overview','Visão geral'],['log','Log'],['diagnosis','Diagnóstico'],['history','Histórico']]
  return <section className="content"><State loading={loading} error={error}>{part && <>
    <div className="device-head"><Link to="/search" className="back-link">← Voltar à pesquisa</Link><div className="device-title"><div><span className="eyebrow">DETALHES DA PEÇA</span><h1>{part.pieceId}</h1><p>{part.model}</p></div><Badge value={part.status} /></div><div className="device-facts"><Fact label="Número de série" value={part.serialNumber} /><Fact label="Logger associado" value={part.loggerId || 'Não associado'} /><Fact label="Status atual" value={<Badge value={part.status} />} /><Fact label="Última comunicação" value={dateTime(part.lastSeen)} /></div></div>
    <div className="tabs" role="tablist">{tabs.map(([id,label]) => <button key={id} role="tab" aria-selected={selected === id} onClick={() => setParams(id === 'overview' ? {} : { tab: id })}>{label}</button>)}</div>
    {selected === 'overview' && <Overview part={part} />}{selected === 'log' && <LogTab pieceId={pieceId} />}{selected === 'diagnosis' && <Diagnosis pieceId={pieceId} />}{selected === 'history' && <HistoryTab pieceId={pieceId} setTab={tab => setParams({ tab })} />}
  </>}</State></section>
}

function Overview({ part }: { part: Part }) {
  const { data, error, loading } = useApi<{ items: EventItem[] }>(`/api/parts/${part.pieceId}/events?limit=6`)
  return <div className="tab-content"><div className="overview-grid"><div className="panel status-panel"><div className="panel-head"><div><h2>Estado operacional</h2><p>Telemetria mais recente do Logger.</p></div><CircleGauge /></div><div className="telemetry"><Fact label="Logger" value={part.loggerId} /><Fact label="Firmware" value={part.firmwareVersion ?? '—'} /><Fact label="Tensão reportada" value={part.batteryVoltage != null ? `${part.batteryVoltage.toFixed(1)} V` : '—'} /><Fact label="Eventos pendentes" value={part.pendingEvents ?? 0} /><Fact label="Comunicação" value={part.communicationMode ?? '—'} /><Fact label="Última falha" value={part.latestFailure ? dateTime(part.latestFailure.timestamp) : 'Nenhuma'} /></div></div><div className="panel latest-failure"><div className="panel-head"><div><h2>Última falha</h2><p>Ocorrência relevante mais recente.</p></div><AlertTriangle /></div>{part.latestFailure ? <><Badge value={part.latestFailure.level} /><h3>{part.latestFailure.event}</h3><p>{part.latestFailure.possibleCause}</p><div className="compare"><Fact label="Esperado" value={part.latestFailure.expected ?? '—'} /><Fact label="Recebido" value={part.latestFailure.received ?? '—'} /></div></> : <div className="mini-empty">Nenhuma falha registrada.</div>}</div></div>
    <div className="panel"><div className="panel-head"><div><h2>Últimos sinais e ocorrências</h2><p>Amostra dos eventos mais recentes.</p></div></div><State loading={loading} error={error} empty={!data?.items.length}><div className="event-list">{data?.items.map(e => <EventRow key={e.id} event={e} />)}</div></State></div>
  </div>
}

function LogTab({ pieceId }: { pieceId: string }) {
  const [period, setPeriod] = useState('24h'), [level, setLevel] = useState(''), [event, setEvent] = useState(''), [page, setPage] = useState(1)
  const [start, setStart] = useState(''), [end, setEnd] = useState('')
  const query = useMemo(() => {
    const next = new URLSearchParams({ limit: '25', page: String(page) })
    if (level) next.set('level', level)
    if (event) next.set('event', event)
    const ago = period === '1h' ? 1 : period === '24h' ? 24 : period === '7d' ? 168 : period === '30d' ? 720 : 0
    if (ago) next.set('startDate', new Date(Date.now() - ago * 3_600_000).toISOString())
    if (period === 'custom' && start) next.set('startDate', new Date(start).toISOString())
    if (period === 'custom' && end) next.set('endDate', new Date(end).toISOString())
    return next
  }, [end, event, level, page, period, start])
  const { data, error, loading } = useApi<{ items: EventItem[]; count: number; limit: number }>(`/api/parts/${pieceId}/events?${query}`)
  const download = () => { const exportQuery = new URLSearchParams(query); exportQuery.delete('page'); exportQuery.delete('limit'); window.location.href = `${API_URL}/api/parts/${encodeURIComponent(pieceId)}/events/export?${exportQuery}` }
  return <div className="tab-content"><div className="panel filters"><div className="filter-head"><div><SlidersHorizontal /><div><h2>Consulta de eventos</h2><p>Filtre o período e a severidade dos registros.</p></div></div><button className="button primary" onClick={download}><CloudDownload />Download log</button></div><div className="filter-grid"><label>Período<select value={period} onChange={e => { setPeriod(e.target.value); setPage(1) }}><option value="1h">Última hora</option><option value="24h">Últimas 24 horas</option><option value="7d">Últimos 7 dias</option><option value="30d">Últimos 30 dias</option><option value="all">Todo o período</option><option value="custom">Personalizado</option></select></label><label>Severidade<select value={level} onChange={e => { setLevel(e.target.value); setPage(1) }}><option value="">Todas</option><option>INFO</option><option>WARNING</option><option>ERROR</option><option>CRITICAL</option></select></label><label>Evento<input value={event} onChange={e => { setEvent(e.target.value); setPage(1) }} placeholder="Ex.: TIMEOUT" /></label>{period === 'custom' && <><label>Início<input type="datetime-local" value={start} onChange={e => setStart(e.target.value)} /></label><label>Fim<input type="datetime-local" value={end} onChange={e => setEnd(e.target.value)} /></label></>}</div></div>
    <State loading={loading} error={error} empty={!data?.items.length}><div className="panel table-wrap"><div className="table-title"><b>{data?.count ?? 0} registros</b><span>Página {page}</span></div><table><thead><tr><th>Data/hora</th><th>Nível</th><th>Evento</th><th>Sinal</th><th>Esperado</th><th>Recebido</th><th>Resultado</th><th>Possível causa</th></tr></thead><tbody>{data?.items.map(x => <tr key={x.id}><td className="nowrap">{dateTime(x.timestamp)}</td><td><Badge value={x.level} /></td><td><b>{x.event}</b></td><td>{x.signal ?? '—'}</td><td>{x.expected ?? '—'}</td><td>{x.received ?? '—'}</td><td className={x.result === 'FAIL' ? 'result-fail' : 'result-ok'}>{x.result ?? '—'}</td><td className="cause-cell">{x.possibleCause ?? '—'}</td></tr>)}</tbody></table><div className="pagination"><button disabled={page === 1} onClick={() => setPage(x => x - 1)}>Anterior</button><span>{(page - 1) * 25 + 1}–{Math.min(page * 25, data?.count ?? 0)} de {data?.count}</span><button disabled={page * 25 >= (data?.count ?? 0)} onClick={() => setPage(x => x + 1)}>Próxima</button></div></div></State>
  </div>
}

function Diagnosis({ pieceId }: { pieceId: string }) {
  const { data, error, loading } = useApi<{ diagnosis: EventItem | null }>(`/api/parts/${pieceId}/diagnosis`, 15000)
  const d = data?.diagnosis
  return <div className="tab-content"><State loading={loading} error={error} empty={!d}>{d && <article className="diagnosis"><div className="diagnosis-head"><div className="failure-icon"><ShieldAlert /></div><div><span>FALHA DETECTADA</span><h2>{d.event}</h2><p>{dateTime(d.timestamp)} · Sinal {d.signal ?? 'não informado'}</p></div><Badge value={d.level} /></div><div className="diagnosis-compare"><div><span>ESPERADO</span><strong>{d.expected ?? 'Não informado'}</strong></div><div className="versus">×</div><div><span>RECEBIDO</span><strong>{d.received ?? 'Não informado'}</strong></div></div><div className="diagnosis-block"><span>POSSÍVEL CAUSA</span><p>{d.possibleCause ?? 'Os dados disponíveis ainda não permitem sugerir uma causa.'}</p></div><div className="diagnosis-block"><span>EVIDÊNCIAS</span>{d.evidence.length ? <ul>{d.evidence.map((x,i) => <li key={i}><span>{i + 1}</span>{x}</li>)}</ul> : <p>Nenhuma evidência adicional registrada.</p>}</div><div className="diagnosis-note"><Info />Esta análise apresenta possibilidades baseadas nos sinais registrados. Confirme a causa com inspeção técnica.</div></article>}</State></div>
}

function HistoryTab({ pieceId, setTab }: { pieceId: string; setTab: (tab: Tab) => void }) {
  const { data, error, loading } = useApi<{ items: EventItem[] }>(`/api/parts/${pieceId}/events?limit=100`)
  const failures = data?.items.filter(x => x.level !== 'INFO') ?? []
  return <div className="tab-content"><State loading={loading} error={error} empty={!failures.length}><div className="panel table-wrap"><table><thead><tr><th>Data/hora</th><th>Evento</th><th>Severidade</th><th>Possível causa</th><th>Status</th><th></th></tr></thead><tbody>{failures.map(x => <tr key={x.id}><td>{dateTime(x.timestamp)}</td><td><b>{x.event}</b></td><td><Badge value={x.level} /></td><td className="cause-cell">{x.possibleCause ?? 'Não informada'}</td><td><span className={x.result === 'FAIL' ? 'result-fail' : ''}>{x.result ?? 'REGISTRADO'}</span></td><td><button className="row-action button-link" onClick={() => setTab('diagnosis')}>Ver diagnóstico</button></td></tr>)}</tbody></table></div></State></div>
}

function NotFound() { const navigate = useNavigate(); return <section className="content"><div className="state"><X /><strong>Página não encontrada</strong><button className="button" onClick={() => navigate('/')}>Voltar ao dashboard</button></div></section> }

export default function App() {
  return <Layout><Routes><Route path="/" element={<Home />} /><Route path="/search" element={<SearchPage />} /><Route path="/devices" element={<Devices />} /><Route path="/alerts" element={<Alerts />} /><Route path="/settings" element={<SettingsPage />} /><Route path="/parts/:pieceId" element={<PartDetail />} /><Route path="*" element={<NotFound />} /></Routes></Layout>
}
