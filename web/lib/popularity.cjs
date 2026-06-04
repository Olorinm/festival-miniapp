const { Redis } = require('@upstash/redis')

const memory = globalThis.__festivalPopularityMemory || {
  users: new Map(),
  screeningUsers: new Map(),
  filmUsers: new Map()
}
globalThis.__festivalPopularityMemory = memory

let redisClient = null
let redisDisabledUntil = 0
const MAX_SELECTION_IDS = 120
const MAX_QUERY_IDS = 2000

function disableRedisTemporarily(error) {
  redisDisabledUntil = Date.now() + 10 * 60 * 1000
  return String(error && error.message || error || 'redis unavailable').slice(0, 160)
}

function uniqueIds(ids, limit) {
  const seen = {}
  return (Array.isArray(ids) ? ids : [])
    .map(id => String(id || '').trim())
    .filter(Boolean)
    .filter(id => {
      if (seen[id]) {
        return false
      }
      seen[id] = true
      return true
    })
    .slice(0, limit || MAX_QUERY_IDS)
}

function normalizeFestivalId(value) {
  return String(value || 'siff2026').replace(/[^\w.-]/g, '_').slice(0, 64)
}

function redisConfig() {
  return {
    url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN
  }
}

function hasRedisConfig() {
  const config = redisConfig()
  return !!(config.url && config.token)
}

function getRedis(options) {
  if (!(options && options.ignoreDisabled) && redisDisabledUntil > Date.now()) {
    return null
  }
  const config = redisConfig()
  if (!config.url || !config.token) {
    return null
  }
  if (!redisClient) {
    redisClient = new Redis({
      url: config.url,
      token: config.token
    })
  }
  return redisClient
}

function screeningKey(festivalId, screeningId) {
  return `festival:${festivalId}:screening:${screeningId}:users`
}

function filmKey(festivalId, filmId) {
  return `festival:${festivalId}:film:${filmId}:users`
}

function screeningCountKey(festivalId) {
  return `festival:${festivalId}:screeningCounts`
}

function filmCountKey(festivalId) {
  return `festival:${festivalId}:filmCounts`
}

function userKey(festivalId, anonUserId) {
  return `festival:${festivalId}:user:${anonUserId}:selection`
}

function setAdd(map, key, value) {
  if (!map.has(key)) {
    map.set(key, new Set())
  }
  map.get(key).add(value)
}

function setRemove(map, key, value) {
  const set = map.get(key)
  if (!set) {
    return
  }
  set.delete(value)
  if (!set.size) {
    map.delete(key)
  }
}

function normalizeScreenings(screenings) {
  return (Array.isArray(screenings) ? screenings : [])
    .map(item => ({
      screeningId: String((item && (item.screeningId || item.id)) || '').trim(),
      filmId: String((item && item.filmId) || '').trim()
    }))
    .filter(item => item.screeningId)
}

function memorySync(payload) {
  const festivalId = normalizeFestivalId(payload.festivalId)
  const anonUserId = String(payload.anonUserId || '').trim()
  const nextScreeningIds = uniqueIds(payload.screeningIds, MAX_SELECTION_IDS)
  const screenings = normalizeScreenings(payload.screenings)
  const filmByScreening = screenings.reduce((map, item) => {
    if (item.filmId) {
      map[item.screeningId] = item.filmId
    }
    return map
  }, {})
  const key = `${festivalId}:${anonUserId}`
  const previous = memory.users.get(key) || { screeningIds: [], filmIds: [] }
  const nextFilmIds = uniqueIds(nextScreeningIds.map(id => filmByScreening[id]).filter(Boolean))

  previous.screeningIds.forEach(id => setRemove(memory.screeningUsers, `${festivalId}:${id}`, anonUserId))
  previous.filmIds.forEach(id => setRemove(memory.filmUsers, `${festivalId}:${id}`, anonUserId))
  nextScreeningIds.forEach(id => setAdd(memory.screeningUsers, `${festivalId}:${id}`, anonUserId))
  nextFilmIds.forEach(id => setAdd(memory.filmUsers, `${festivalId}:${id}`, anonUserId))
  memory.users.set(key, { screeningIds: nextScreeningIds, filmIds: nextFilmIds })

  const queryScreeningIds = uniqueIds([].concat(payload.queryScreeningIds || [], nextScreeningIds), MAX_QUERY_IDS)
  const queryFilmIds = uniqueIds([].concat(payload.queryFilmIds || [], nextFilmIds), MAX_QUERY_IDS)
  return {
    screeningCounts: queryScreeningIds.reduce((counts, id) => {
      counts[id] = memory.screeningUsers.get(`${festivalId}:${id}`)?.size || 0
      return counts
    }, {}),
    filmCounts: queryFilmIds.reduce((counts, id) => {
      counts[id] = memory.filmUsers.get(`${festivalId}:${id}`)?.size || 0
      return counts
    }, {})
  }
}

function memoryGet(payload) {
  const festivalId = normalizeFestivalId(payload.festivalId)
  const screeningIds = uniqueIds(payload.screeningIds, MAX_QUERY_IDS)
  const filmIds = uniqueIds(payload.filmIds, MAX_QUERY_IDS)
  return {
    screeningCounts: screeningIds.reduce((counts, id) => {
      counts[id] = memory.screeningUsers.get(`${festivalId}:${id}`)?.size || 0
      return counts
    }, {}),
    filmCounts: filmIds.reduce((counts, id) => {
      counts[id] = memory.filmUsers.get(`${festivalId}:${id}`)?.size || 0
      return counts
    }, {})
  }
}

function hmgetValue(values, id, index) {
  if (Array.isArray(values)) {
    return values[index]
  }
  if (values && typeof values === 'object') {
    return values[id]
  }
  return undefined
}

async function redisSync(payload) {
  const redis = getRedis()
  if (!redis) {
    return {
      ...memorySync(payload),
      stored: 'memory'
    }
  }
  const festivalId = normalizeFestivalId(payload.festivalId)
  const anonUserId = String(payload.anonUserId || '').trim()
  const nextScreeningIds = uniqueIds(payload.screeningIds, MAX_SELECTION_IDS)
  const screenings = normalizeScreenings(payload.screenings)
  const filmByScreening = screenings.reduce((map, item) => {
    if (item.filmId) {
      map[item.screeningId] = item.filmId
    }
    return map
  }, {})
  let previous
  try {
    previous = await redis.get(userKey(festivalId, anonUserId)) || { screeningIds: [], filmIds: [] }
  } catch (error) {
    return {
      ...memorySync(payload),
      stored: 'memory',
      fallbackError: disableRedisTemporarily(error)
    }
  }
  const nextFilmIds = uniqueIds(nextScreeningIds.map(id => filmByScreening[id]).filter(Boolean))
  const previousScreeningIds = uniqueIds(previous.screeningIds, MAX_SELECTION_IDS)
  const previousFilmIds = uniqueIds(previous.filmIds, MAX_SELECTION_IDS)
  const previousScreeningSet = new Set(previousScreeningIds)
  const previousFilmSet = new Set(previousFilmIds)
  const nextScreeningSet = new Set(nextScreeningIds)
  const nextFilmSet = new Set(nextFilmIds)
  const removedScreeningIds = previousScreeningIds.filter(id => !nextScreeningSet.has(id))
  const removedFilmIds = previousFilmIds.filter(id => !nextFilmSet.has(id))
  const addedScreeningIds = nextScreeningIds.filter(id => !previousScreeningSet.has(id))
  const addedFilmIds = nextFilmIds.filter(id => !previousFilmSet.has(id))
  const pipeline = redis.pipeline()
  previousScreeningIds.forEach(id => pipeline.srem(screeningKey(festivalId, id), anonUserId))
  previousFilmIds.forEach(id => pipeline.srem(filmKey(festivalId, id), anonUserId))
  nextScreeningIds.forEach(id => pipeline.sadd(screeningKey(festivalId, id), anonUserId))
  nextFilmIds.forEach(id => pipeline.sadd(filmKey(festivalId, id), anonUserId))
  removedScreeningIds.forEach(id => pipeline.hincrby(screeningCountKey(festivalId), id, -1))
  removedFilmIds.forEach(id => pipeline.hincrby(filmCountKey(festivalId), id, -1))
  addedScreeningIds.forEach(id => pipeline.hincrby(screeningCountKey(festivalId), id, 1))
  addedFilmIds.forEach(id => pipeline.hincrby(filmCountKey(festivalId), id, 1))
  pipeline.set(userKey(festivalId, anonUserId), { screeningIds: nextScreeningIds, filmIds: nextFilmIds })
  try {
    await pipeline.exec()
  } catch (error) {
    return {
      ...memorySync(payload),
      stored: 'memory',
      fallbackError: disableRedisTemporarily(error)
    }
  }

  const counts = await redisGet({
    festivalId,
    screeningIds: uniqueIds([].concat(payload.queryScreeningIds || [], nextScreeningIds), MAX_QUERY_IDS),
    filmIds: uniqueIds([].concat(payload.queryFilmIds || [], nextFilmIds), MAX_QUERY_IDS)
  })
  return counts.stored === 'memory' ? counts : { ...counts, stored: 'redis' }
}

async function redisGet(payload) {
  const redisConfigured = hasRedisConfig()
  const redis = getRedis({ ignoreDisabled: true })
  if (!redis) {
    if (redisConfigured) {
      throw new Error('redis temporarily unavailable')
    }
    return {
      ...memoryGet(payload),
      stored: 'memory'
    }
  }

  const festivalId = normalizeFestivalId(payload.festivalId)
  const screeningIds = uniqueIds(payload.screeningIds, MAX_QUERY_IDS)
  const filmIds = uniqueIds(payload.filmIds, MAX_QUERY_IDS)
  const pipeline = redis.pipeline()
  if (screeningIds.length) {
    pipeline.hmget(screeningCountKey(festivalId), ...screeningIds)
  }
  if (filmIds.length) {
    pipeline.hmget(filmCountKey(festivalId), ...filmIds)
  }
  screeningIds.forEach(id => pipeline.scard(screeningKey(festivalId, id)))
  filmIds.forEach(id => pipeline.scard(filmKey(festivalId, id)))
  let result
  try {
    result = await pipeline.exec()
  } catch (error) {
    if (redisConfigured) {
      throw error
    }
    return {
      ...memoryGet(payload),
      stored: 'memory',
      fallbackError: disableRedisTemporarily(error)
    }
  }
  const screeningCounts = {}
  const filmCounts = {}
  let resultIndex = 0
  const screeningHashValues = screeningIds.length ? result[resultIndex++] : []
  const filmHashValues = filmIds.length ? result[resultIndex++] : []
  screeningIds.forEach((id, index) => {
    const hashCount = Math.max(0, Number(hmgetValue(screeningHashValues, id, index)) || 0)
    const setCount = Math.max(0, Number(result[resultIndex++]) || 0)
    screeningCounts[id] = Math.max(hashCount, setCount)
  })
  filmIds.forEach((id, index) => {
    const hashCount = Math.max(0, Number(hmgetValue(filmHashValues, id, index)) || 0)
    const setCount = Math.max(0, Number(result[resultIndex++]) || 0)
    filmCounts[id] = Math.max(hashCount, setCount)
  })
  return { screeningCounts, filmCounts, stored: 'redis' }
}

async function syncPopularity(payload) {
  const anonUserId = String(payload && payload.anonUserId || '').trim()
  if (!anonUserId) {
    throw new Error('missing anonUserId')
  }
  return redisSync(payload || {})
}

async function getPopularity(payload) {
  return redisGet(payload || {})
}

module.exports = {
  getPopularity,
  syncPopularity
}
