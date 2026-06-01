const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const CONFIG_COLLECTION = process.env.FESTIVAL_CONFIG_COLLECTION || 'festival_config'
const CONFIG_DOC_ID = process.env.FESTIVAL_CONFIG_DOC_ID || 'current'
const bundledPayload = require('./festival-data.json')

function isValidFestivalData(data) {
  return !!(
    data &&
    data.festivalMeta &&
    typeof data.festivalMeta === 'object' &&
    Array.isArray(data.films) &&
    data.films.length
  )
}

function normalizeFestivalPayload(payload) {
  const data = payload && payload.data && isValidFestivalData(payload.data)
    ? payload.data
    : payload

  if (!isValidFestivalData(data)) {
    throw new Error('Invalid festival data')
  }

  return Object.assign({}, data, {
    dataVersion: data.dataVersion || payload.dataVersion || ''
  })
}

function parseFestivalData(buffer) {
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '')
  return normalizeFestivalPayload(JSON.parse(text))
}

function getBundledFestivalData() {
  return normalizeFestivalPayload(bundledPayload)
}

function isSameFestival(data, reference) {
  const name = String(data && data.festivalMeta && data.festivalMeta.name || '').trim()
  const referenceName = String(reference && reference.festivalMeta && reference.festivalMeta.name || '').trim()
  return !!name && name === referenceName
}

async function getConfigFromDatabase() {
  try {
    const res = await db.collection(CONFIG_COLLECTION).doc(CONFIG_DOC_ID).get()
    return res && res.data ? res.data : {}
  } catch (error) {
    return {}
  }
}

exports.main = async event => {
  const bundledData = getBundledFestivalData()
  try {
    const config = await getConfigFromDatabase()
    const requestedFileID = String(event && event.fileID || '').trim()
    const fileID = String(
      requestedFileID ||
      process.env.FESTIVAL_DATA_FILE_ID ||
      config.fileID ||
      ''
    ).trim()

    if (!fileID) {
      return {
        ok: true,
        source: 'bundled',
        data: bundledData,
        dataVersion: bundledData.dataVersion || '',
        updatedAt: bundledPayload.updatedAt || ''
      }
    }

    const file = await cloud.downloadFile({ fileID })
    const data = parseFestivalData(file.fileContent)
    if (!isSameFestival(data, bundledData)) {
      return {
        ok: true,
        source: 'bundled',
        data: bundledData,
        dataVersion: bundledData.dataVersion || '',
        updatedAt: bundledPayload.updatedAt || '',
        ignoredRemote: data.festivalMeta && data.festivalMeta.name || ''
      }
    }

    return {
      ok: true,
      source: 'cloud',
      data,
      dataVersion: config.dataVersion || data.dataVersion || '',
      updatedAt: config.updatedAt || data.updatedAt || ''
    }
  } catch (error) {
    return {
      ok: true,
      source: 'bundled',
      data: bundledData,
      dataVersion: bundledData.dataVersion || '',
      updatedAt: bundledPayload.updatedAt || '',
      warning: error.message || 'Failed to load configured festival data.'
    }
  }
}
