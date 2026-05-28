const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const CONFIG_COLLECTION = process.env.FESTIVAL_CONFIG_COLLECTION || 'festival_config'
const CONFIG_DOC_ID = process.env.FESTIVAL_CONFIG_DOC_ID || 'current'

function isValidFestivalData(data) {
  return !!(
    data &&
    data.festivalMeta &&
    typeof data.festivalMeta === 'object' &&
    Array.isArray(data.films) &&
    data.films.length
  )
}

function parseFestivalData(buffer) {
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '')
  const payload = JSON.parse(text)
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

async function getConfigFromDatabase() {
  try {
    const res = await db.collection(CONFIG_COLLECTION).doc(CONFIG_DOC_ID).get()
    return res && res.data ? res.data : {}
  } catch (error) {
    return {}
  }
}

exports.main = async event => {
  try {
    const config = await getConfigFromDatabase()
    const fileID = String(
      (event && event.fileID) ||
      process.env.FESTIVAL_DATA_FILE_ID ||
      config.fileID ||
      ''
    ).trim()

    if (!fileID) {
      return {
        ok: false,
        source: 'fallback',
        code: 'NO_DATA_FILE',
        message: 'Festival data file is not configured.'
      }
    }

    const file = await cloud.downloadFile({ fileID })
    const data = parseFestivalData(file.fileContent)

    return {
      ok: true,
      source: 'cloud',
      data,
      dataVersion: config.dataVersion || data.dataVersion || '',
      updatedAt: config.updatedAt || data.updatedAt || ''
    }
  } catch (error) {
    return {
      ok: false,
      source: 'fallback',
      code: 'LOAD_FAILED',
      message: error.message || 'Failed to load festival data.'
    }
  }
}
