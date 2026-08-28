const { Redis } = require('@upstash/redis')

const memory = globalThis.__festivalPopularityMemory || {
  users: new Map(),
  screeningUsers: new Map(),
  filmUsers: new Map(),
  wechatCache: new Map(),
  wechatSyncMeta: new Map()
}
globalThis.__festivalPopularityMemory = memory
memory.wechatCache = memory.wechatCache || new Map()
memory.wechatSyncMeta = memory.wechatSyncMeta || new Map()

let redisClient = null
let redisDisabledUntil = 0
let wechatAccessToken = null
let wechatAccessTokenExpiresAt = 0
const MAX_SELECTION_IDS = 120
const MAX_QUERY_IDS = 2000
const WECHAT_CACHE_TTL_MS = Math.max(5 * 60 * 1000, Number(process.env.WECHAT_POPULARITY_CACHE_TTL_MS) || 60 * 60 * 1000)
const WECHAT_SYNC_INTERVAL_MS = Math.max(5 * 60 * 1000, Number(process.env.WECHAT_POPULARITY_SYNC_INTERVAL_MS) || 60 * 60 * 1000)
const WECHAT_CACHE_EXPIRE_SECONDS = Math.ceil((WECHAT_CACHE_TTL_MS * 3) / 1000)

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

function wechatCloudConfig() {
  return {
    env: process.env.WECHAT_CLOUD_ENV_ID || process.env.TCB_ENV_ID || 'cloud1-d7gzforb6cdf2aa48',
    appId: process.env.WECHAT_APP_ID || process.env.WECHAT_MINIPROGRAM_APP_ID || 'wx6a7f5936120dd265',
    appSecret: process.env.WECHAT_APP_SECRET || process.env.WECHAT_MINIPROGRAM_APP_SECRET,
    functionName: process.env.WECHAT_POPULARITY_FUNCTION || 'screeningPopularity',
    syncToken: process.env.WECHAT_POPULARITY_SYNC_TOKEN || process.env.POPULARITY_WECHAT_SYNC_TOKEN || process.env.WEB_POPULARITY_SYNC_TOKEN
  }
}

function hasWechatCloudConfig() {
  const config = wechatCloudConfig()
  return !!(config.env && config.appId && config.appSecret)
}

async function getWechatAccessToken() {
  const config = wechatCloudConfig()
  if (!config.appId || !config.appSecret) {
    throw new Error('wechat app credentials not configured')
  }
  if (wechatAccessToken && Date.now() < wechatAccessTokenExpiresAt) {
    return wechatAccessToken
  }
  const url = new URL('https://api.weixin.qq.com/cgi-bin/token')
  url.searchParams.set('grant_type', 'client_credential')
  url.searchParams.set('appid', config.appId)
  url.searchParams.set('secret', config.appSecret)
  const response = await fetch(url)
  const result = await response.json()
  if (!response.ok || !result.access_token) {
    throw new Error(result && result.errmsg || 'wechat access token failed')
  }
  wechatAccessToken = result.access_token
  wechatAccessTokenExpiresAt = Date.now() + Math.max(60, Number(result.expires_in) - 300) * 1000
  return wechatAccessToken
}

async function callWechatPopularity(data) {
  const config = wechatCloudConfig()
  const accessToken = await getWechatAccessToken()
  const url = new URL('https://api.weixin.qq.com/tcb/invokecloudfunction')
  url.searchParams.set('access_token', accessToken)
  url.searchParams.set('env', config.env)
  url.searchParams.set('name', config.functionName)
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data || {})
  })
  const payload = await response.json()
  if (!response.ok || Number(payload.errcode) !== 0) {
    throw new Error(payload && payload.errmsg || 'wechat cloud function failed')
  }
  let result = payload.resp_data
  if (typeof result === 'string') {
    try {
      result = JSON.parse(result)
    } catch (error) {}
  }
  if (!result || result.ok === false) {
    throw new Error(result && result.error || 'wechat popularity failed')
  }
  return result
}

function normalizeCountMap(counts, limit, options) {
  const source = counts && typeof counts === 'object' ? counts : {}
  const result = {}
  const keepZero = !!(options && options.keepZero)
  Object.keys(source).slice(0, limit || MAX_QUERY_IDS).forEach(id => {
    const key = String(id || '').trim()
    const value = Math.max(0, Math.floor(Number(source[id]) || 0))
    if (key && (keepZero || value > 0)) {
      result[key] = value
    }
  })
  return result
}

function filterCounts(counts, ids) {
  const source = counts && typeof counts === 'object' ? counts : {}
  return uniqueIds(ids, MAX_QUERY_IDS).reduce((map, id) => {
    map[id] = Math.max(0, Math.floor(Number(source[id]) || 0))
    return map
  }, {})
}

function countMapTotal(counts) {
  return Object.keys(counts || {}).reduce((sum, id) => {
    return sum + Math.max(0, Math.floor(Number(counts[id]) || 0))
  }, 0)
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

function wechatCacheKey(festivalId) {
  return `festival:${festivalId}:wechatPopularityCache`
}

function wechatSyncMetaKey(festivalId) {
  return `festival:${festivalId}:wechatPopularitySyncMeta`
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

function shouldIncludeSetCounts(payload) {
  return !!(
    payload &&
    payload.includeSetCounts === true &&
    String(process.env.POPULARITY_INCLUDE_SET_COUNTS || '') === '1'
  )
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
  const includeSetCounts = shouldIncludeSetCounts(payload)
  const pipeline = redis.pipeline()
  if (screeningIds.length) {
    pipeline.hmget(screeningCountKey(festivalId), ...screeningIds)
  }
  if (filmIds.length) {
    pipeline.hmget(filmCountKey(festivalId), ...filmIds)
  }
  if (includeSetCounts) {
    screeningIds.forEach(id => pipeline.scard(screeningKey(festivalId, id)))
    filmIds.forEach(id => pipeline.scard(filmKey(festivalId, id)))
  }
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
    if (includeSetCounts) {
      const setCount = Math.max(0, Number(result[resultIndex++]) || 0)
      screeningCounts[id] = Math.max(hashCount, setCount)
    } else {
      screeningCounts[id] = hashCount
    }
  })
  filmIds.forEach((id, index) => {
    const hashCount = Math.max(0, Number(hmgetValue(filmHashValues, id, index)) || 0)
    if (includeSetCounts) {
      const setCount = Math.max(0, Number(result[resultIndex++]) || 0)
      filmCounts[id] = Math.max(hashCount, setCount)
    } else {
      filmCounts[id] = hashCount
    }
  })
  return { screeningCounts, filmCounts, stored: 'redis', countSource: includeSetCounts ? 'hash_set_max' : 'hash' }
}

async function readWechatCache(festivalId) {
  const normalizedFestivalId = normalizeFestivalId(festivalId)
  const redis = getRedis({ ignoreDisabled: true })
  if (redis) {
    try {
      const cached = await redis.get(wechatCacheKey(normalizedFestivalId))
      if (cached && typeof cached === 'object') {
        return cached
      }
    } catch (error) {}
  }
  return memory.wechatCache.get(normalizedFestivalId) || null
}

async function writeWechatCache(festivalId, counts, meta) {
  const normalizedFestivalId = normalizeFestivalId(festivalId)
  const previous = await readWechatCache(normalizedFestivalId)
  const mergedCounts = Object.assign(
    {},
    previous && previous.screeningCounts || {},
    normalizeCountMap(counts, MAX_QUERY_IDS, { keepZero: true })
  )
  const payload = {
    screeningCounts: mergedCounts,
    updatedAt: Date.now(),
    source: meta && meta.source || 'wechat',
    syncedAt: meta && meta.syncedAt || null
  }
  memory.wechatCache.set(normalizedFestivalId, payload)
  const redis = getRedis({ ignoreDisabled: true })
  if (redis) {
    try {
      await redis.set(wechatCacheKey(normalizedFestivalId), payload, { ex: WECHAT_CACHE_EXPIRE_SECONDS })
    } catch (error) {}
  }
  return payload
}

async function readWechatSyncMeta(festivalId) {
  const normalizedFestivalId = normalizeFestivalId(festivalId)
  const redis = getRedis({ ignoreDisabled: true })
  if (redis) {
    try {
      const meta = await redis.get(wechatSyncMetaKey(normalizedFestivalId))
      if (meta && typeof meta === 'object') {
        return meta
      }
    } catch (error) {}
  }
  return memory.wechatSyncMeta.get(normalizedFestivalId) || null
}

async function writeWechatSyncMeta(festivalId, meta) {
  const normalizedFestivalId = normalizeFestivalId(festivalId)
  const payload = Object.assign({}, meta || {}, { updatedAt: Date.now() })
  memory.wechatSyncMeta.set(normalizedFestivalId, payload)
  const redis = getRedis({ ignoreDisabled: true })
  if (redis) {
    try {
      await redis.set(wechatSyncMetaKey(normalizedFestivalId), payload, { ex: WECHAT_CACHE_EXPIRE_SECONDS })
    } catch (error) {}
  }
  return payload
}

async function getWechatPopularity(payload, options) {
  if (!hasWechatCloudConfig()) {
    return null
  }
  const festivalId = normalizeFestivalId(payload && payload.festivalId)
  const screeningIds = uniqueIds(payload && payload.screeningIds, MAX_QUERY_IDS)
  const force = !!(options && options.force)
  if (!screeningIds.length) {
    return { screeningCounts: {}, filmCounts: {}, stored: 'wechat-cache' }
  }
  const cached = await readWechatCache(festivalId)
  const cachedAt = Number(cached && cached.updatedAt) || 0
  if (!force && cached && cached.screeningCounts && Date.now() - cachedAt < WECHAT_CACHE_TTL_MS) {
    return {
      screeningCounts: filterCounts(cached.screeningCounts, screeningIds),
      filmCounts: {},
      stored: 'wechat-cache',
      source: cached.source || 'wechat-cache',
      cachedAt
    }
  }

  const counts = {}
  for (let index = 0; index < screeningIds.length; index += 500) {
    const idsChunk = screeningIds.slice(index, index + 500)
    const result = await callWechatPopularity({
      action: 'get',
      festivalId,
      screeningIds: idsChunk
    })
    Object.assign(counts, result.counts || result.screeningCounts || {})
  }
  await writeWechatCache(festivalId, counts, { source: 'wechat' })
  return {
    screeningCounts: filterCounts(counts, screeningIds),
    filmCounts: {},
    stored: 'wechat',
    source: 'wechat'
  }
}

async function syncWebSnapshotToWechat(options) {
  const festivalId = normalizeFestivalId(options && options.festivalId)
  const screeningIds = uniqueIds(options && options.screeningIds, MAX_QUERY_IDS)
  const force = !!(options && options.force)
  const config = wechatCloudConfig()
  if (!hasWechatCloudConfig()) {
    return { ok: false, skipped: true, reason: 'wechat_cloud_not_configured' }
  }
  if (!config.syncToken) {
    return { ok: false, skipped: true, reason: 'wechat_sync_token_not_configured' }
  }
  if (!screeningIds.length) {
    return { ok: false, skipped: true, reason: 'empty_screening_ids' }
  }
  const previousMeta = await readWechatSyncMeta(festivalId)
  if (!force && previousMeta && previousMeta.syncedAt && Date.now() - Number(previousMeta.syncedAt) < WECHAT_SYNC_INTERVAL_MS) {
    return {
      ok: true,
      skipped: true,
      reason: 'fresh',
      syncedAt: previousMeta.syncedAt,
      totalWeight: previousMeta.totalWeight || 0,
      screeningCount: previousMeta.screeningCount || 0
    }
  }

  const redisCounts = await redisGet({
    festivalId,
    screeningIds
  })
  const counts = normalizeCountMap(redisCounts.screeningCounts, MAX_QUERY_IDS)
  const totalWeight = countMapTotal(counts)
  if (!totalWeight) {
    await writeWechatSyncMeta(festivalId, {
      ok: false,
      skipped: true,
      reason: 'empty_redis_counts',
      syncedAt: Date.now(),
      totalWeight: 0,
      screeningCount: 0
    })
    return { ok: false, skipped: true, reason: 'empty_redis_counts' }
  }

  await callWechatPopularity({
    action: 'writeWebSnapshot',
    festivalId,
    webSyncToken: config.syncToken,
    source: 'web_redis',
    snapshotFetchedAt: new Date().toISOString(),
    counts,
    queryScreeningIds: screeningIds.slice(0, 500)
  })
  const syncedAt = Date.now()
  await writeWechatSyncMeta(festivalId, {
    ok: true,
    syncedAt,
    totalWeight,
    screeningCount: Object.keys(counts).length
  })

  await getWechatPopularity({ festivalId, screeningIds }, { force: true })

  return {
    ok: true,
    action: 'syncWebSnapshotToWechat',
    syncedAt,
    totalWeight,
    screeningCount: Object.keys(counts).length
  }
}

async function syncPopularity(payload) {
  const anonUserId = String(payload && payload.anonUserId || '').trim()
  if (!anonUserId) {
    throw new Error('missing anonUserId')
  }
  return redisSync(payload || {})
}

async function getPopularity(payload, options) {
  try {
    const wechatResult = await getWechatPopularity(payload || {}, options || {})
    if (wechatResult) {
      return wechatResult
    }
  } catch (error) {}
  return redisGet(payload || {})
}

module.exports = {
  getPopularity,
  syncWebSnapshotToWechat,
  syncPopularity
}
