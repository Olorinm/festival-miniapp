const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const SELECTION_COLLECTION = 'user_screening_selection'
const ACTION_COLLECTION = 'user_screening_action'
const MAX_IDS = 500
const QUERY_CHUNK_SIZE = 80
const QUERY_PAGE_SIZE = 100

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
  for (const name of [SELECTION_COLLECTION, ACTION_COLLECTION]) {
    try {
      await db.createCollection(name)
    } catch (error) {}
  }
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
      const res = await db.collection(ACTION_COLLECTION)
        .where({
          festivalId,
          planned: true,
          screeningId: _.in(idsChunk)
        })
        .field({
          screeningId: true
        })
        .skip(offset)
        .limit(QUERY_PAGE_SIZE)
        .get()
      const rows = res && Array.isArray(res.data) ? res.data : []
      rows.forEach(row => {
        if (row.screeningId && counts[row.screeningId] !== undefined) {
          counts[row.screeningId] += 1
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

  const relatedIds = uniqueIds(screeningIds.concat(added, removed, event && event.queryScreeningIds || []))
  const counts = await countPopularity(relatedIds, festivalId)
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
  const counts = await countPopularity(screeningIds, festivalId)
  return {
    ok: true,
    action: 'get',
    counts
  }
}

exports.main = async event => {
  const action = String(event && event.action || 'get')
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID || ''
  const festivalId = normalizeFestivalId(event || {})

  try {
    await ensureCollections()
    if (action === 'sync') {
      if (!openid) {
        return { ok: false, error: 'missing_openid' }
      }
      return await syncPopularity(event || {}, openid, festivalId)
    }
    return await getPopularity(event || {}, festivalId)
  } catch (error) {
    return {
      ok: false,
      error: error.message || 'screening_popularity_failed'
    }
  }
}
