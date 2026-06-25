const cloud = require('wx-server-sdk')
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const CONFIG_COLLECTION = process.env.FESTIVAL_CONFIG_COLLECTION || 'festival_config'
const CONFIG_DOC_ID = process.env.FESTIVAL_CONFIG_DOC_ID || 'current'
const EXPECTED_FESTIVAL_NAME = process.env.FESTIVAL_NAME || 'SIFF 2026'
const MIN_SCREENINGS = Number(process.env.FESTIVAL_MIN_SCREENINGS || 100)
const BUNDLED_DATA_GZIP = path.join(__dirname, 'festival-data.json.gz')
const BUNDLED_CLOUD_PATH = process.env.FESTIVAL_BUNDLED_CLOUD_PATH || 'festival-data/siff2026-current.json'

let bundledFestivalCache = null

function isValidFestivalData(data) {
  return !!(
    data &&
    data.festivalMeta &&
    typeof data.festivalMeta === 'object' &&
    Array.isArray(data.films) &&
    data.films.length
  )
}

function countScreenings(films) {
  return (Array.isArray(films) ? films : []).reduce((sum, film) => {
    return sum + (Array.isArray(film && film.screenings) ? film.screenings.length : 0)
  }, 0)
}

function normalizeFestivalPayload(payload) {
  const data = payload && payload.data && isValidFestivalData(payload.data)
    ? payload.data
    : payload

  if (!isValidFestivalData(data)) {
    throw new Error('Invalid festival data')
  }

  return Object.assign({}, data, {
    dataVersion: data.dataVersion || payload.dataVersion || (data.festivalMeta && data.festivalMeta.dataVersion) || ''
  })
}

function parseFestivalData(buffer) {
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '')
  return normalizeFestivalPayload(JSON.parse(text))
}

function loadBundledFestivalData() {
  if (bundledFestivalCache) {
    return bundledFestivalCache
  }
  const zipped = fs.readFileSync(BUNDLED_DATA_GZIP)
  const fileContent = zlib.gunzipSync(zipped)
  const text = fileContent.toString('utf8').replace(/^\uFEFF/, '')
  const payload = JSON.parse(text)
  const data = normalizeFestivalPayload(payload)
  bundledFestivalCache = {
    data,
    dataVersion: data.dataVersion || payload.dataVersion || '',
    updatedAt: payload.updatedAt || '',
    fileContent
  }
  return bundledFestivalCache
}

function isStaleVersion(version) {
  return /mock|lite-fallback/.test(String(version || '').toLowerCase())
}

function isStaleFestivalData(data) {
  const version = data && (data.dataVersion || (data.festivalMeta && data.festivalMeta.dataVersion))
  const screeningCount = countScreenings(data && data.films)
  return isStaleVersion(version) || screeningCount < MIN_SCREENINGS
}

function expectedFestivalName(event) {
  return String(
    process.env.FESTIVAL_NAME ||
    (event && event.festivalName) ||
    EXPECTED_FESTIVAL_NAME ||
    ''
  ).trim()
}

function festivalNameMatches(name, expected) {
  const current = String(name || '').trim()
  return !expected || current === expected
}

function configLooksUsable(config, expected) {
  const screenings = Number(config && config.screenings) || 0
  return !!(
    config &&
    config.fileID &&
    screenings >= MIN_SCREENINGS &&
    !isStaleVersion(config.dataVersion) &&
    festivalNameMatches(config.festivalName, expected)
  )
}

function configMatchesBundledData(config) {
  const bundled = loadBundledFestivalData()
  const bundledVersion = bundled && bundled.dataVersion || ''
  return !bundledVersion || String(config && config.dataVersion || '') === bundledVersion
}

function cleanText(value, maxLength) {
  const text = typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : ''
  return text.slice(0, maxLength)
}

function normalizeCommunityConfig(config) {
  const source = config && config.community && typeof config.community === 'object'
    ? config.community
    : (config && typeof config === 'object' ? config : {})
  const groupQrFileID = cleanText(
    source.groupQrFileID ||
    source.groupQrFileId ||
    source.groupQrCloudFileID ||
    source.groupQrCloudFileId ||
    process.env.COMMUNITY_GROUP_QR_FILE_ID ||
    '',
    512
  )
  const groupQrUrl = cleanText(
    source.groupQrUrl ||
    source.groupQrSrc ||
    source.feedbackGroupQrUrl ||
    source.feedbackGroupQrSrc ||
    process.env.COMMUNITY_GROUP_QR_URL ||
    '',
    512
  )

  return {
    groupName: cleanText(source.groupName || source.feedbackGroupName || process.env.COMMUNITY_GROUP_NAME || '赶场愉快反馈群', 80),
    groupHint: cleanText(source.groupHint || source.feedbackGroupHint || process.env.COMMUNITY_GROUP_HINT || '', 120),
    groupQrFileID,
    groupQrUrl,
    groupQrSrc: groupQrUrl || groupQrFileID
  }
}

async function resolveCommunityConfig(config) {
  const community = normalizeCommunityConfig(config)
  if (!community.groupQrUrl && community.groupQrFileID && cloud.getTempFileURL) {
    try {
      const res = await cloud.getTempFileURL({
        fileList: [community.groupQrFileID]
      })
      const file = res && res.fileList && res.fileList[0]
      if (file && file.tempFileURL) {
        community.groupQrUrl = file.tempFileURL
        community.groupQrSrc = file.tempFileURL
      }
    } catch (error) {}
  }
  return community
}

async function makeCommunityConfigResponse(config) {
  const community = await resolveCommunityConfig(config)
  return {
    ok: true,
    source: 'config',
    updatedAt: config.updatedAt || '',
    community
  }
}

async function makeConfigResponse(config, extra) {
  return Object.assign({
    ok: true,
    source: 'cloud-file',
    fileID: config.fileID || '',
    dataVersion: config.dataVersion || '',
    updatedAt: config.updatedAt || '',
    festivalName: config.festivalName || '',
    films: Number(config.films) || 0,
    screenings: Number(config.screenings) || 0,
    community: await resolveCommunityConfig(config)
  }, extra || {})
}

async function makeBundledFileResponse(expected, warning, previousConfig) {
  try {
    const bundled = loadBundledFestivalData()
    const data = bundled.data
    const festivalName = data.festivalMeta && data.festivalMeta.name || ''
    if (!festivalNameMatches(festivalName, expected)) {
      return {
        ok: false,
        error: `bundled_festival_mismatch:${festivalName || 'unknown'}`
      }
    }
    if (isStaleFestivalData(data)) {
      return {
        ok: false,
        error: `bundled_stale_festival_data:${data.dataVersion || ''}`
      }
    }
    const uploadRes = await cloud.uploadFile({
      cloudPath: BUNDLED_CLOUD_PATH,
      fileContent: bundled.fileContent
    })
    const fileID = uploadRes && uploadRes.fileID
    if (!fileID) {
      return {
        ok: false,
        error: 'failed_to_upload_bundled_festival_data'
      }
    }
    const config = await updateConfigForFile(fileID, data, 'bundled-gzip', previousConfig)
    return await makeConfigResponse(config, {
      repairedConfig: true,
      warning: warning || ''
    })
  } catch (error) {
    return {
      ok: false,
      error: error.message || 'failed_to_load_bundled_festival_data'
    }
  }
}

function configFileLooksWorthTrying(config, expected) {
  return !!(
    config &&
    config.fileID &&
    !isStaleVersion(config.dataVersion) &&
    festivalNameMatches(config.festivalName, expected)
  )
}

async function getConfigFromDatabase() {
  try {
    const res = await db.collection(CONFIG_COLLECTION).doc(CONFIG_DOC_ID).get()
    return res && res.data ? res.data : {}
  } catch (error) {
    return {}
  }
}

async function ensureConfigCollection() {
  try {
    await db.createCollection(CONFIG_COLLECTION)
  } catch (error) {}
}

function stripDatabaseMetadata(data) {
  const next = Object.assign({}, data || {})
  delete next._id
  return next
}

async function setConfigInDatabase(data) {
  await ensureConfigCollection()
  await db.collection(CONFIG_COLLECTION).doc(CONFIG_DOC_ID).set({ data: stripDatabaseMetadata(data) })
}

async function loadFestivalDataFromFile(fileID) {
  const file = await cloud.downloadFile({ fileID })
  return parseFestivalData(file.fileContent)
}

async function updateConfigForFile(fileID, data, source, previousConfig) {
  const nextConfig = Object.assign({}, stripDatabaseMetadata(previousConfig), {
    fileID,
    dataVersion: data.dataVersion || '',
    updatedAt: Date.now(),
    festivalName: data.festivalMeta && data.festivalMeta.name || '',
    films: Array.isArray(data.films) ? data.films.length : 0,
    screenings: countScreenings(data.films),
    source
  })
  await setConfigInDatabase(nextConfig)
  return nextConfig
}

exports.main = async event => {
  const expected = expectedFestivalName(event)
  const requestedFileID = String(event && event.fileID || '').trim()
  const envFileID = String(process.env.FESTIVAL_DATA_FILE_ID || '').trim()
  let config = {}

  try {
    config = await getConfigFromDatabase()
    if (event && event.action === 'getCommunityConfig') {
      return await makeCommunityConfigResponse(config)
    }

    if (!requestedFileID && !envFileID && configLooksUsable(config, expected)) {
      if (!configMatchesBundledData(config)) {
        return await makeBundledFileResponse(expected, `bundled_data_version_changed:${config.dataVersion || ''}`, config)
      }
      return await makeConfigResponse(config)
    }

    const configFileID = configFileLooksWorthTrying(config, expected)
      ? String(config && config.fileID || '').trim()
      : ''
    const fileID = requestedFileID || envFileID || configFileID
    if (!fileID) {
      return await makeBundledFileResponse(expected, 'missing_or_stale_festival_data_file_id', config)
    }

    const data = await loadFestivalDataFromFile(fileID)
    const festivalName = data.festivalMeta && data.festivalMeta.name || ''
    if (!festivalNameMatches(festivalName, expected)) {
      return await makeBundledFileResponse(expected, `festival_mismatch:${festivalName || 'unknown'}`, config)
    }
    if (isStaleFestivalData(data)) {
      return await makeBundledFileResponse(expected, `stale_festival_data:${data.dataVersion || ''}`, config)
    }

    const nextConfig = await updateConfigForFile(
      fileID,
      data,
      requestedFileID ? 'requested-file' : (envFileID ? 'env-file' : 'configured-file'),
      config
    )
    return await makeConfigResponse(nextConfig, {
      repairedConfig: !configLooksUsable(config, expected)
    })
  } catch (error) {
    return await makeBundledFileResponse(expected, error.message || 'failed_to_prepare_festival_data', config)
  }
}
