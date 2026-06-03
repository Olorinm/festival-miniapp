const { Redis } = require('@upstash/redis')

const memory = globalThis.__festivalPopularityMemory || {
  users: new Map(),
  screeningUsers: new Map(),
  filmUsers: new Map()
}
globalThis.__festivalPopularityMemory = memory

let redisClient = null
const MAX_SELECTION_IDS = 120
const MAX_QUERY_IDS = 2000

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

function screeningKey(festivalId, screeningId) {
  return `festival:${festivalId}:screening:${screeningId}:users`
}

function filmKey(festivalId, filmId) {
  return `festival:${festivalId}:film:${filmId}:users`
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

async function redisSync(payload) {
  const redis = getRedis()
  if (!redis) {
    return memorySync(payload)
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
  const previous = await redis.get(userKey(festivalId, anonUserId)) || { screeningIds: [], filmIds: [] }
  const nextFilmIds = uniqueIds(nextScreeningIds.map(id => filmByScreening[id]).filter(Boolean))

  const pipeline = redis.pipeline()
  uniqueIds(previous.screeningIds, MAX_SELECTION_IDS).forEach(id => pipeline.srem(screeningKey(festivalId, id), anonUserId))
  uniqueIds(previous.filmIds, MAX_SELECTION_IDS).forEach(id => pipeline.srem(filmKey(festivalId, id), anonUserId))
  nextScreeningIds.forEach(id => pipeline.sadd(screeningKey(festivalId, id), anonUserId))
  nextFilmIds.forEach(id => pipeline.sadd(filmKey(festivalId, id), anonUserId))
  pipeline.set(userKey(festivalId, anonUserId), { screeningIds: nextScreeningIds, filmIds: nextFilmIds })
  await pipeline.exec()

  return redisGet({
    festivalId,
    screeningIds: uniqueIds([].concat(payload.queryScreeningIds || [], nextScreeningIds), MAX_QUERY_IDS),
    filmIds: uniqueIds([].concat(payload.queryFilmIds || [], nextFilmIds), MAX_QUERY_IDS)
  })
}

async function redisGet(payload) {
  const redis = getRedis()
  if (!redis) {
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

  const festivalId = normalizeFestivalId(payload.festivalId)
  const screeningIds = uniqueIds(payload.screeningIds, MAX_QUERY_IDS)
  const filmIds = uniqueIds(payload.filmIds, MAX_QUERY_IDS)
  const pipeline = redis.pipeline()
  screeningIds.forEach(id => pipeline.scard(screeningKey(festivalId, id)))
  filmIds.forEach(id => pipeline.scard(filmKey(festivalId, id)))
  const result = await pipeline.exec()
  const screeningCounts = {}
  const filmCounts = {}
  screeningIds.forEach((id, index) => {
    screeningCounts[id] = Number(result[index]) || 0
  })
  filmIds.forEach((id, index) => {
    filmCounts[id] = Number(result[screeningIds.length + index]) || 0
  })
  return { screeningCounts, filmCounts }
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
