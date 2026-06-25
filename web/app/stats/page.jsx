import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { EVENT_NAMES, getEventSummary, isSummaryAuthorized } = require('../../lib/event-stats.cjs')

export const dynamic = 'force-dynamic'
export const metadata = {
  title: '统计 | 赶场愉快',
  robots: {
    index: false,
    follow: false
  }
}

const EVENT_LABELS = {
  app_open: '打开网页',
  tab_films: '切到选电影',
  tab_schedule: '切到挑场次',
  tab_plan: '切到排片表',
  film_detail_open: '打开详情',
  mark_film: '标记想看',
  unmark_film: '取消标记',
  select_screening: '选择场次',
  unselect_screening: '取消场次',
  smart_open: '打开 AI',
  smart_submit: '提交 AI',
  smart_success: 'AI 成功',
  smart_error: 'AI 失败',
  export_open: '打开导出',
  export_text: '导出文字',
  export_ticket: '导出票图',
  export_poster: '导出长图',
  import_open: '打开导入',
  import_success: '导入成功',
  about_open: '打开关于',
  community_open: '查看社群'
}

const PRIMARY_EVENTS = [
  'app_open',
  'film_detail_open',
  'mark_film',
  'select_screening',
  'smart_submit',
  'smart_success',
  'export_text',
  'export_ticket',
  'export_poster',
  'import_success'
]

function cleanDays(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 7
  return Math.max(1, Math.min(Math.round(number), 30))
}

function totalForDay(day) {
  return EVENT_NAMES.reduce((sum, event) => sum + (Number(day.events[event]) || 0), 0)
}

function eventTotal(days, event) {
  return days.reduce((sum, day) => sum + (Number(day.events[event]) || 0), 0)
}

function percent(value, max) {
  if (!max) return '0%'
  return `${Math.max(2, Math.round((value / max) * 100))}%`
}

export default async function StatsPage({ searchParams }) {
  const params = await searchParams
  const token = String(params?.k || '').trim()
  const festivalId = String(params?.festivalId || 'SIFF 2026').trim()
  const daysCount = cleanDays(params?.days)

  if (!isSummaryAuthorized(token)) {
    return (
      <main className="stats-page">
        <section className="stats-shell">
          <h1>链接无效</h1>
          <p className="stats-muted">这个统计页需要私密访问密钥。</p>
        </section>
      </main>
    )
  }

  let summary
  try {
    summary = await getEventSummary({ festivalId, days: daysCount })
  } catch (error) {
    return (
      <main className="stats-page">
        <section className="stats-shell">
          <h1>统计暂不可用</h1>
          <p className="stats-muted">{String(error && error.message || error || 'summary failed').slice(0, 160)}</p>
        </section>
      </main>
    )
  }
  const days = summary.days || []
  const dailyMax = Math.max(...days.map(totalForDay), 0)
  const totalEvents = days.reduce((sum, day) => sum + totalForDay(day), 0)
  const visitors = eventTotal(days, 'app_open')
  const selected = eventTotal(days, 'select_screening')
  const marks = eventTotal(days, 'mark_film')
  const aiRuns = eventTotal(days, 'smart_submit')
  const exportCount = eventTotal(days, 'export_text') + eventTotal(days, 'export_ticket') + eventTotal(days, 'export_poster')
  const eventRows = PRIMARY_EVENTS
    .map(event => ({ event, label: EVENT_LABELS[event] || event, count: eventTotal(days, event) }))
    .filter(item => item.count > 0 || ['app_open', 'mark_film', 'select_screening', 'smart_submit'].includes(item.event))
  const eventMax = Math.max(...eventRows.map(item => item.count), 0)

  return (
    <main className="stats-page">
      <section className="stats-shell">
        <div className="stats-head">
          <div>
            <p className="stats-kicker">{festivalId}</p>
            <h1>使用统计</h1>
          </div>
          <div className="stats-meta">{daysCount} 天 · {summary.stored === 'redis' ? 'Redis' : 'Memory'}</div>
        </div>
        {summary.fallbackError ? (
          <p className="stats-muted">Redis 暂不可用，当前显示临时内存统计：{summary.fallbackError}</p>
        ) : null}

        <div className="stats-metrics">
          <div className="stats-metric"><span>打开网页</span><strong>{visitors}</strong></div>
          <div className="stats-metric"><span>标记想看</span><strong>{marks}</strong></div>
          <div className="stats-metric"><span>选择场次</span><strong>{selected}</strong></div>
          <div className="stats-metric"><span>AI 提交</span><strong>{aiRuns}</strong></div>
          <div className="stats-metric"><span>导出</span><strong>{exportCount}</strong></div>
          <div className="stats-metric"><span>总事件</span><strong>{totalEvents}</strong></div>
        </div>

        <section className="stats-section">
          <div className="stats-section-title">每日活跃</div>
          <div className="stats-bars">
            {days.map(day => {
              const total = totalForDay(day)
              return (
                <div className="stats-bar-row" key={day.day}>
                  <span className="stats-bar-label">{day.day.slice(5)}</span>
                  <div className="stats-bar-track"><span className="stats-bar-fill" style={{ width: percent(total, dailyMax) }} /></div>
                  <strong>{total}</strong>
                </div>
              )
            })}
          </div>
        </section>

        <section className="stats-section">
          <div className="stats-section-title">功能点击</div>
          <div className="stats-bars">
            {eventRows.map(item => (
              <div className="stats-bar-row" key={item.event}>
                <span className="stats-bar-label">{item.label}</span>
                <div className="stats-bar-track"><span className="stats-bar-fill is-accent" style={{ width: percent(item.count, eventMax) }} /></div>
                <strong>{item.count}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="stats-section">
          <div className="stats-section-title">原始计数</div>
          <div className="stats-table">
            <div className="stats-table-row is-head">
              <span>日期</span>
              <span>打开</span>
              <span>标星</span>
              <span>选场</span>
              <span>AI</span>
              <span>文字</span>
              <span>票图</span>
              <span>长图</span>
            </div>
            {days.map(day => (
              <div className="stats-table-row" key={day.day}>
                <span>{day.day}</span>
                <span>{day.events.app_open || 0}</span>
                <span>{day.events.mark_film || 0}</span>
                <span>{day.events.select_screening || 0}</span>
                <span>{day.events.smart_submit || 0}</span>
                <span>{day.events.export_text || 0}</span>
                <span>{day.events.export_ticket || 0}</span>
                <span>{day.events.export_poster || 0}</span>
              </div>
            ))}
          </div>
        </section>
      </section>
    </main>
  )
}
