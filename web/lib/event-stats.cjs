const { Redis } = require('@upstash/redis')

const EVENT_NAMES = [
  'app_open',
  'tab_films',
  'tab_schedule',
  'tab_plan',
  'film_detail_open',
  'mark_film',
  'unmark_film',
  'select_screening',
  'unselect_screening',
  'smart_open',
  'smart_submit',
  'smart_success',
  'smart_error',
  'export_open',
  'export_text',
  'export_poster',
  'import_open',
  'import_success',
  'about_open',
  'community_open'
]
const EVENT_SET = new Set(EVENT_NAMES)
const RETENTION_DAYS = 120

const memory = globalThis.__festivalEventStatsMemory || new Map()
globalThis.__festivalEventStatsMemory = memory

let redisClient = null

function getRedis() {
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN
  if (!redisUrl || !redisToken) {
    return null
  }
  if (!redisClient) {
    redisClient = new Redis({
      url: redisUrl,
      token: redisToken
    })
  }
  return redisClient
}

function normalizeFestivalId(value) {
  return String(value || 'siff2026').replace(/[^\w.-]/g, '_').slice(0, 64)
}

function normalizeEventName(value) {
  const event = String(value || '').trim()
  return EVENT_SET.has(event) ? event : ''
}

function shanghaiDay(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date || new Date()).reduce((map, part) => {
    map[part.type] = part.value
    return map
  }, {})
  return `${parts.year}${parts.month}${parts.day}`
}

function dayLabel(day) {
  const text = String(day || '')
  return text.length === 8 ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}` : text
}

function recentDays(count) {
  const size = Math.max(1, Math.min(Number(count) || 14, 60))
  const now = Date.now()
  return Array.from({ length: size }, (_, index) => shanghaiDay(new Date(now - index * 86400000))).reverse()
}

function dailyKey(festivalId, day, event) {
  return `festival:${festivalId}:events:${day}:${event}`
}

function totalKey(festivalId, event) {
  return `festival:${festivalId}:events:total:${event}`
}

function incrementMemory(festivalId, day, event) {
  const daily = dailyKey(festivalId, day, event)
  const total = totalKey(festivalId, event)
  memory.set(daily, (memory.get(daily) || 0) + 1)
  memory.set(total, (memory.get(total) || 0) + 1)
}

async function trackEvent(payload) {
  const festivalId = normalizeFestivalId(payload && payload.festivalId)
  const event = normalizeEventName(payload && payload.event)
  if (!event) {
    throw new Error('unknown event')
  }
  const day = shanghaiDay(new Date())
  const redis = getRedis()
  if (!redis) {
    incrementMemory(festivalId, day, event)
    return { event, day, stored: 'memory' }
  }

  const pipeline = redis.pipeline()
  pipeline.incr(dailyKey(festivalId, day, event))
  pipeline.expire(dailyKey(festivalId, day, event), RETENTION_DAYS * 86400)
  pipeline.incr(totalKey(festivalId, event))
  await pipeline.exec()
  return { event, day, stored: 'redis' }
}

async function getEventSummary(payload) {
  const festivalId = normalizeFestivalId(payload && payload.festivalId)
  const days = recentDays(payload && payload.days)
  const events = EVENT_NAMES
  const redis = getRedis()

  if (!redis) {
    return {
      stored: 'memory',
      days: days.map(day => ({
        day: dayLabel(day),
        events: events.reduce((counts, event) => {
          counts[event] = Number(memory.get(dailyKey(festivalId, day, event))) || 0
          return counts
        }, {})
      })),
      totals: events.reduce((counts, event) => {
        counts[event] = Number(memory.get(totalKey(festivalId, event))) || 0
        return counts
      }, {})
    }
  }

  const pipeline = redis.pipeline()
  days.forEach(day => {
    events.forEach(event => pipeline.get(dailyKey(festivalId, day, event)))
  })
  events.forEach(event => pipeline.get(totalKey(festivalId, event)))
  const values = await pipeline.exec()
  let index = 0
  const daily = days.map(day => {
    const counts = {}
    events.forEach(event => {
      counts[event] = Number(values[index]) || 0
      index += 1
    })
    return { day: dayLabel(day), events: counts }
  })
  const totals = {}
  events.forEach(event => {
    totals[event] = Number(values[index]) || 0
    index += 1
  })
  return { stored: 'redis', days: daily, totals }
}

module.exports = {
  EVENT_NAMES,
  getEventSummary,
  trackEvent
}
