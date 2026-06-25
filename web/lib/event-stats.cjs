const { Redis } = require('@upstash/redis')
const crypto = require('crypto')

const EVENT_NAMES = [
  'app_open',
  'tab_films',
  'tab_schedule',
  'tab_plan',
  'tab_popularity',
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
  'export_ticket',
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
let redisDisabledUntil = 0

function disableRedisTemporarily(error) {
  redisDisabledUntil = Date.now() + 10 * 60 * 1000
  return String(error && error.message || error || 'redis unavailable').slice(0, 160)
}

function getRedis() {
  if (redisDisabledUntil > Date.now()) {
    return null
  }
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

function summaryToken() {
  return String(process.env.EVENTS_SUMMARY_TOKEN || '').trim()
}

function isSummaryAuthorized(value) {
  const expected = summaryToken()
  const actual = String(value || '').trim()
  if (!expected || !actual) {
    return false
  }
  const expectedBuffer = Buffer.from(expected)
  const actualBuffer = Buffer.from(actual)
  return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer)
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

function incrementMemory(festivalId, day, event, count) {
  const amount = Math.max(1, Math.min(Number(count) || 1, 1000))
  const daily = dailyKey(festivalId, day, event)
  const total = totalKey(festivalId, event)
  memory.set(daily, (memory.get(daily) || 0) + amount)
  memory.set(total, (memory.get(total) || 0) + amount)
}

function normalizeEventItems(payload) {
  const source = Array.isArray(payload && payload.events)
    ? payload.events
    : [{ event: payload && payload.event, count: payload && payload.count }]
  return source
    .map(item => ({
      event: normalizeEventName(item && item.event),
      count: Math.max(1, Math.min(Math.round(Number(item && item.count) || 1), 1000))
    }))
    .filter(item => item.event)
}

async function trackEvents(payload) {
  const festivalId = normalizeFestivalId(payload && payload.festivalId)
  const events = normalizeEventItems(payload)
  if (!events.length) {
    throw new Error('unknown event')
  }
  const day = shanghaiDay(new Date())
  const redis = getRedis()
  if (!redis) {
    events.forEach(item => incrementMemory(festivalId, day, item.event, item.count))
    return { events, day, stored: 'memory' }
  }

  const pipeline = redis.pipeline()
  events.forEach(item => {
    pipeline.incrby(dailyKey(festivalId, day, item.event), item.count)
    pipeline.expire(dailyKey(festivalId, day, item.event), RETENTION_DAYS * 86400)
    pipeline.incrby(totalKey(festivalId, item.event), item.count)
  })
  try {
    await pipeline.exec()
    return { events, day, stored: 'redis' }
  } catch (error) {
    const fallbackError = disableRedisTemporarily(error)
    events.forEach(item => incrementMemory(festivalId, day, item.event, item.count))
    return { events, day, stored: 'memory', fallbackError }
  }
}

async function trackEvent(payload) {
  return trackEvents(payload)
}

async function getEventSummary(payload) {
  const festivalId = normalizeFestivalId(payload && payload.festivalId)
  const days = recentDays(payload && payload.days)
  const events = EVENT_NAMES
  const redis = getRedis()

  if (!redis) {
    return memorySummary(festivalId, days, events)
  }

  const pipeline = redis.pipeline()
  days.forEach(day => {
    events.forEach(event => pipeline.get(dailyKey(festivalId, day, event)))
  })
  events.forEach(event => pipeline.get(totalKey(festivalId, event)))
  let values
  try {
    values = await pipeline.exec()
  } catch (error) {
    return {
      ...memorySummary(festivalId, days, events),
      fallbackError: disableRedisTemporarily(error)
    }
  }
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

function memorySummary(festivalId, days, events) {
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

module.exports = {
  EVENT_NAMES,
  getEventSummary,
  isSummaryAuthorized,
  trackEvent,
  trackEvents
}
