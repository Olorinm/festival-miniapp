const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const SELECTION_COLLECTION = 'user_screening_selection'
const ACTION_COLLECTION = 'user_screening_action'
const DELTA_COLLECTION = 'screening_popularity_delta'
const WEB_SNAPSHOT_COLLECTION = 'screening_popularity_web_snapshot'
const privateConfig = (() => {
  try {
    return require('./private-config')
  } catch (error) {
    return {}
  }
})()
const cinehappyImportPayload = (() => {
  try {
    return require('./cinehappy-popularity-import-payload.json')
  } catch (error) {
    return null
  }
})()
const MAX_IDS = 500
const MAX_IMPORT_IDS = 2500
const QUERY_CHUNK_SIZE = 80
const QUERY_PAGE_SIZE = 100
const CINEHAPPY_IMPORT_MARKER_PREFIX = 'cinehappy_import_marker__'
let collectionsReady = false
let collectionsReadyPromise = null

function cleanId(value) {
  return String(value || '').trim().slice(0, 80)
}

function docSafe(value) {
  return cleanId(value).replace(/[^A-Za-z0-9_-]/g, '_') || 'default'
}

function uniqueIds(ids) {
  const seen = {}
  return (Array.isArray(ids) ? ids : [])
    .map(cleanId)
    .filter(id => {
      if (!id || seen[id]) {
        return false
      }
      seen[id] = true
      return true
    })
    .slice(0, MAX_IDS)
}

function normalizeFestivalId(event) {
  return docSafe(event && (event.festivalId || event.dataVersion || event.festivalName || 'current'))
}

function normalizeScreeningMap(screenings) {
  const map = {}
  ;(Array.isArray(screenings) ? screenings : []).forEach(item => {
    const screeningId = cleanId(item && (item.screeningId || item.id))
    if (!screeningId) {
      return
    }
    map[screeningId] = {
      screeningId,
      filmId: cleanId(item.filmId)
    }
  })
  return map
}

function chunk(items, size) {
  const chunks = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

async function ensureCollections() {
  if (collectionsReady) {
    return
  }
  if (collectionsReadyPromise) {
    return collectionsReadyPromise
  }
  collectionsReadyPromise = (async () => {
    for (const name of [SELECTION_COLLECTION, ACTION_COLLECTION, DELTA_COLLECTION, WEB_SNAPSHOT_COLLECTION]) {
      try {
        await db.createCollection(name)
      } catch (error) {}
    }
    collectionsReady = true
  })()
  return collectionsReadyPromise
}

async function ensureCollectionsForWrite() {
  if (collectionsReady) {
    return
  }
  if (collectionsReadyPromise) {
    return collectionsReadyPromise
  }
  for (const name of [SELECTION_COLLECTION, ACTION_COLLECTION, DELTA_COLLECTION, WEB_SNAPSHOT_COLLECTION]) {
    try {
      await db.createCollection(name)
    } catch (error) {}
  }
  collectionsReady = true
}

async function getSelection(docId) {
  try {
    const res = await db.collection(SELECTION_COLLECTION).doc(docId).get()
    return uniqueIds(res && res.data && res.data.screeningIds)
  } catch (error) {
    return []
  }
}

async function setSelection(docId, data) {
  await db.collection(SELECTION_COLLECTION).doc(docId).set({ data })
}

async function setAction(docId, data) {
  await db.collection(ACTION_COLLECTION).doc(docId).set({ data })
}

function diffIds(nextIds, previousIds) {
  const previousMap = previousIds.reduce((map, id) => {
    map[id] = true
    return map
  }, {})
  const nextMap = nextIds.reduce((map, id) => {
    map[id] = true
    return map
  }, {})

  return {
    added: nextIds.filter(id => !previousMap[id]),
    removed: previousIds.filter(id => !nextMap[id])
  }
}

async function countPopularity(screeningIds, festivalId) {
  const ids = uniqueIds(screeningIds)
  const counts = ids.reduce((map, id) => {
    map[id] = 0
    return map
  }, {})

  for (const idsChunk of chunk(ids, QUERY_CHUNK_SIZE)) {
    let offset = 0
    while (true) {
      let res = null
      try {
        res = await db.collection(ACTION_COLLECTION)
          .where({
            festivalId,
            planned: true,
            screeningId: _.in(idsChunk)
          })
          .field({
            screeningId: true,
            weight: true
          })
          .skip(offset)
          .limit(QUERY_PAGE_SIZE)
          .get()
      } catch (error) {
        break
      }
      const rows = res && Array.isArray(res.data) ? res.data : []
      rows.forEach(row => {
        if (row.screeningId && counts[row.screeningId] !== undefined) {
          const weight = Math.floor(Number(row.weight) || 0)
          counts[row.screeningId] += weight > 0 ? weight : 1
        }
      })
      if (rows.length < QUERY_PAGE_SIZE) {
        break
      }
      offset += QUERY_PAGE_SIZE
    }
  }

  return counts
}

function normalizeImportCounts(counts) {
  const source = counts && typeof counts === 'object' ? counts : {}
  return Object.keys(source)
    .map(id => ({
      screeningId: cleanId(id),
      weight: Math.max(0, Math.floor(Number(source[id]) || 0))
    }))
    .filter(item => item.screeningId && item.weight > 0)
    .slice(0, MAX_IMPORT_IDS)
}

function countsTotal(counts) {
  return Object.keys(counts || {}).reduce((sum, id) => {
    return sum + Math.max(0, Math.floor(Number(counts[id]) || 0))
  }, 0)
}

function countImportedPopularity(screeningIds) {
  const source = cinehappyImportPayload && cinehappyImportPayload.counts && typeof cinehappyImportPayload.counts === 'object'
    ? cinehappyImportPayload.counts
    : null
  if (!source) {
    return null
  }
  return uniqueIds(screeningIds).reduce((map, id) => {
    const count = Math.floor(Number(source[id]) || 0)
    map[id] = count > 0 ? count : 0
    return map
  }, {})
}

async function getWebSnapshot(festivalId) {
  try {
    const res = await db.collection(WEB_SNAPSHOT_COLLECTION)
      .doc(`web_snapshot__${festivalId}`)
      .get()
    return res && res.data || null
  } catch (error) {
    return null
  }
}

async function countWebSnapshotPopularity(screeningIds, festivalId) {
  const snapshot = await getWebSnapshot(festivalId)
  const source = snapshot && snapshot.counts && typeof snapshot.counts === 'object'
    ? snapshot.counts
    : null
  if (!source || !countsTotal(source)) {
    return null
  }
  return uniqueIds(screeningIds).reduce((map, id) => {
    const count = Math.floor(Number(source[id]) || 0)
    map[id] = count > 0 ? count : 0
    return map
  }, {})
}

async function countBaselinePopularity(screeningIds, festivalId) {
  const ids = uniqueIds(screeningIds)
  const imported = countImportedPopularity(ids)
  const webSnapshot = await countWebSnapshotPopularity(ids, festivalId)
  if (!imported && !webSnapshot) {
    return null
  }
  return ids.reduce((map, id) => {
    map[id] = Math.max(
      0,
      Number(imported && imported[id]) || 0,
      Number(webSnapshot && webSnapshot[id]) || 0
    )
    return map
  }, {})
}

async function countDeltaPopularity(screeningIds, festivalId) {
  const ids = uniqueIds(screeningIds)
  const counts = ids.reduce((map, id) => {
    map[id] = 0
    return map
  }, {})

  for (const idsChunk of chunk(ids, QUERY_CHUNK_SIZE)) {
    let res = null
    try {
      res = await db.collection(DELTA_COLLECTION)
        .where({
          festivalId,
          screeningId: _.in(idsChunk)
        })
        .field({
          screeningId: true,
          count: true
        })
        .limit(QUERY_PAGE_SIZE)
        .get()
    } catch (error) {
      continue
    }
    const rows = res && Array.isArray(res.data) ? res.data : []
    rows.forEach(row => {
      if (row.screeningId && counts[row.screeningId] !== undefined) {
        counts[row.screeningId] += Math.floor(Number(row.count) || 0)
      }
    })
  }

  return counts
}

async function countEffectivePopularity(screeningIds, festivalId) {
  const ids = uniqueIds(screeningIds)
  const baseline = await countBaselinePopularity(ids, festivalId)
  if (!baseline) {
    return await countPopularity(ids, festivalId)
  }

  const deltas = await countDeltaPopularity(ids, festivalId)
  return ids.reduce((map, id) => {
    map[id] = Math.max(0, (Number(baseline[id]) || 0) + (Number(deltas[id]) || 0))
    return map
  }, {})
}

async function adjustDeltaCount(screeningId, festivalId, delta) {
  const id = cleanId(screeningId)
  const value = Math.floor(Number(delta) || 0)
  if (!id || !value) {
    return
  }

  const docId = `delta__${festivalId}__${docSafe(id)}`
  const now = Date.now()
  try {
    await db.collection(DELTA_COLLECTION).doc(docId).update({
      data: {
        count: _.inc(value),
        updatedAt: now
      }
    })
  } catch (error) {
    if (value < 0) {
      return
    }
    await db.collection(DELTA_COLLECTION).doc(docId).set({
      data: {
        festivalId,
        screeningId: id,
        count: value,
        updatedAt: now
      }
    })
  }
}

async function applyPopularityDeltas(added, removed, festivalId) {
  const tasks = []
  uniqueIds(added).forEach(id => {
    tasks.push(adjustDeltaCount(id, festivalId, 1))
  })
  uniqueIds(removed).forEach(id => {
    tasks.push(adjustDeltaCount(id, festivalId, -1))
  })
  for (const taskChunk of chunk(tasks, 20)) {
    await Promise.all(taskChunk)
  }
}

function importTokenMatches(event) {
  const expected = String(process.env.POPULARITY_IMPORT_TOKEN || '').trim()
  const actual = String(event && event.importToken || '').trim()
  return !!expected && actual === expected
}

function webSnapshotTokenMatches(event) {
  const expected = String(
    process.env.WEB_POPULARITY_SYNC_TOKEN ||
    process.env.POPULARITY_WECHAT_SYNC_TOKEN ||
    privateConfig.WEB_POPULARITY_SYNC_TOKEN ||
    privateConfig.POPULARITY_WECHAT_SYNC_TOKEN ||
    ''
  ).trim()
  const actual = String(event && (event.webSyncToken || event.syncToken || event.importToken) || '').trim()
  return !!expected && actual === expected
}

async function setActionsInChunks(items) {
  for (const itemsChunk of chunk(items, 20)) {
    await Promise.all(itemsChunk.map(item => setAction(item.docId, item.data)))
  }
}

async function importPopularity(event, festivalId) {
  if (!importTokenMatches(event)) {
    return { ok: false, error: 'unauthorized' }
  }

  return writeImportedPopularity(event && event.counts, {
    festivalId,
    source: cleanId(event && event.source || 'cinehappy')
  })
}

async function importCinehappySnapshot(festivalId) {
  if (!cinehappyImportPayload || !cinehappyImportPayload.counts) {
    return { ok: false, error: 'missing_cinehappy_snapshot' }
  }
  return writeImportedPopularity(cinehappyImportPayload.counts, {
    festivalId,
    source: 'cinehappy_snapshot',
    snapshotFetchedAt: cinehappyImportPayload.fetchedAt || ''
  })
}

async function writeWebSnapshot(event, festivalId) {
  if (!webSnapshotTokenMatches(event)) {
    return { ok: false, error: 'unauthorized' }
  }

  const items = normalizeImportCounts(event && event.counts)
  if (!items.length) {
    return { ok: false, error: 'empty_web_snapshot' }
  }

  const counts = items.reduce((map, item) => {
    map[item.screeningId] = item.weight
    return map
  }, {})
  const timestamp = Date.now()
  const totalWeight = countsTotal(counts)
  await db.collection(WEB_SNAPSHOT_COLLECTION)
    .doc(`web_snapshot__${festivalId}`)
    .set({
      data: {
        festivalId,
        counts,
        screeningCount: items.length,
        totalWeight,
        source: cleanId(event && event.source || 'web_redis'),
        snapshotFetchedAt: String(event && event.snapshotFetchedAt || '').slice(0, 64),
        updatedAt: timestamp
      }
    })

  const queryIds = uniqueIds([].concat(event && event.queryScreeningIds || [], items.map(item => item.screeningId)))
  const effectiveCounts = queryIds.length
    ? await countEffectivePopularity(queryIds, festivalId)
    : {}
  return {
    ok: true,
    action: 'writeWebSnapshot',
    imported: items.length,
    totalWeight,
    counts: effectiveCounts,
    updatedAt: timestamp
  }
}

async function getImportMarker(markerId) {
  try {
    const res = await db.collection(ACTION_COLLECTION).doc(markerId).get()
    return res && res.data || null
  } catch (error) {
    return null
  }
}

function cinehappyImportMarkerMatches(marker) {
  return !!(
    marker &&
    marker.source === 'cinehappy_snapshot' &&
    marker.snapshotFetchedAt === (cinehappyImportPayload && cinehappyImportPayload.fetchedAt || '') &&
    Number(marker.importedScreenings) === Number(cinehappyImportPayload && cinehappyImportPayload.importedScreenings || 0) &&
    Number(marker.totalWeight) === Number(cinehappyImportPayload && cinehappyImportPayload.totalWeight || 0)
  )
}

function cinehappyImportSampleItems() {
  return normalizeImportCounts(cinehappyImportPayload && cinehappyImportPayload.counts)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
}

async function cinehappySnapshotLooksPresent(festivalId) {
  const sampleItems = cinehappyImportSampleItems()
  if (!sampleItems.length) {
    return false
  }
  const sampleIds = sampleItems.map(item => item.screeningId)
  const counts = await countPopularity(sampleIds, festivalId)
  return sampleItems.every(item => Number(counts[item.screeningId] || 0) >= item.weight)
}

async function writeCinehappyImportMarker(markerId, festivalId, result) {
  await setAction(markerId, {
    type: 'import_marker',
    festivalId,
    source: 'cinehappy_snapshot',
    snapshotFetchedAt: cinehappyImportPayload.fetchedAt || '',
    importedScreenings: result && result.imported || cinehappyImportPayload.importedScreenings || 0,
    totalWeight: result && result.totalWeight || cinehappyImportPayload.totalWeight || 0,
    updatedAt: Date.now()
  })
}

async function ensureCinehappySnapshotImported(festivalId) {
  if (!cinehappyImportPayload || !cinehappyImportPayload.counts) {
    return null
  }

  const markerId = `${CINEHAPPY_IMPORT_MARKER_PREFIX}${festivalId}`
  const marker = await getImportMarker(markerId)
  if (cinehappyImportMarkerMatches(marker)) {
    return { ok: true, action: 'import_skip_marker', imported: cinehappyImportPayload.importedScreenings || 0 }
  }

  const snapshotPresent = await cinehappySnapshotLooksPresent(festivalId)
  if (snapshotPresent) {
    await writeCinehappyImportMarker(markerId, festivalId)
    return { ok: true, action: 'import_skip', imported: cinehappyImportPayload.importedScreenings || 0 }
  }

  const result = await importCinehappySnapshot(festivalId)
  if (result && result.ok) {
    await writeCinehappyImportMarker(markerId, festivalId, result)
  }
  return result
}

async function writeImportedPopularity(counts, options) {
  const festivalId = options && options.festivalId || 'current'
  const source = cleanId(options && options.source || 'cinehappy')
  const timestamp = Date.now()
  const items = normalizeImportCounts(counts)
  const actions = items.map(item => ({
    docId: `cinehappy_import__${festivalId}__${docSafe(item.screeningId)}`,
    data: {
      openid: 'cinehappy_import',
      festivalId,
      screeningId: item.screeningId,
      filmId: '',
      planned: true,
      weight: item.weight,
      imported: true,
      source,
      updatedAt: timestamp
    }
  }))

  await setActionsInChunks(actions)

  return {
    ok: true,
    action: 'import',
    imported: actions.length,
    totalWeight: items.reduce((sum, item) => sum + item.weight, 0),
    snapshotFetchedAt: options && options.snapshotFetchedAt || ''
  }
}

async function syncPopularity(event, openid, festivalId) {
  const screeningIds = uniqueIds(event && event.screeningIds)
  const screeningMap = normalizeScreeningMap(event && event.screenings)
  const selectionDocId = `${docSafe(openid)}__${festivalId}`
  const previousIds = await getSelection(selectionDocId)
  const { added, removed } = diffIds(screeningIds, previousIds)
  const timestamp = Date.now()

  await Promise.all(added.map(screeningId => setAction(`${selectionDocId}__${docSafe(screeningId)}`, {
    openid,
    festivalId,
    screeningId,
    filmId: screeningMap[screeningId] && screeningMap[screeningId].filmId || '',
    planned: true,
    updatedAt: timestamp
  })))

  await Promise.all(removed.map(screeningId => setAction(`${selectionDocId}__${docSafe(screeningId)}`, {
    openid,
    festivalId,
    screeningId,
    filmId: screeningMap[screeningId] && screeningMap[screeningId].filmId || '',
    planned: false,
    updatedAt: timestamp
  })))

  await setSelection(selectionDocId, {
    openid,
    festivalId,
    screeningIds,
    updatedAt: timestamp
  })

  await applyPopularityDeltas(added, removed, festivalId)

  const relatedIds = uniqueIds(screeningIds.concat(added, removed, event && event.queryScreeningIds || []))
  const counts = await countEffectivePopularity(relatedIds, festivalId)
  return {
    ok: true,
    action: 'sync',
    added,
    removed,
    counts
  }
}

async function getPopularity(event, festivalId) {
  const screeningIds = uniqueIds(event && event.screeningIds)
  const counts = await countEffectivePopularity(screeningIds, festivalId)
  return {
    ok: true,
    action: 'get',
    source: countImportedPopularity(screeningIds) ? 'cinehappy_snapshot_with_delta' : 'actions',
    counts
  }
}

exports.main = async event => {
  const action = String(event && event.action || 'get')
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID || ''
  const festivalId = normalizeFestivalId(event || {})

  try {
    if (action === 'sync') {
      if (!openid) {
        return { ok: false, error: 'missing_openid' }
      }
      await ensureCollections()
      return await syncPopularity(event || {}, openid, festivalId)
    }
    if (action === 'import') {
      await ensureCollectionsForWrite()
      return await importPopularity(event || {}, festivalId)
    }
    if (action === 'importCinehappySnapshot') {
      await ensureCollectionsForWrite()
      return await importCinehappySnapshot(festivalId)
    }
    if (action === 'writeWebSnapshot') {
      await ensureCollectionsForWrite()
      return await writeWebSnapshot(event || {}, festivalId)
    }
    return await getPopularity(event || {}, festivalId)
  } catch (error) {
    return {
      ok: false,
      error: error.message || 'screening_popularity_failed'
    }
  }
}
