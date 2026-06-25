const fallbackFestivalData = require('./data/festival-lite')

const CLOUD_ENV_ID = 'cloud1-d7gzforb6cdf2aa48'

const STORAGE_KEYS = {
  festivalData: 'festival.remoteFestivalData',
  festivalDataMeta: 'festival.remoteFestivalData.meta',
  festivalDataChunkPrefix: 'festival.remoteFestivalData.chunk.',
  selectedScreeningIds: 'festival.selectedScreeningIds',
  filmMarks: 'festival.filmMarks',
  planSchemes: 'festival.planSchemes',
  activePlanSchemeId: 'festival.activePlanSchemeId'
}

const DEFAULT_PLAN_SCHEME_ID = 'plan_default'
const POPULARITY_SYNC_DELAY = 600
const FESTIVAL_DATA_REFRESH_INTERVAL = 30 * 60 * 1000
const FESTIVAL_DATA_CACHE_CHUNK_SIZE = 320 * 1024
const POPULARITY_FETCH_CACHE_TTL = 5 * 60 * 1000
const POPULARITY_FETCH_CHUNK_SIZE = 500
const SCHEDULE_FIELD_CONFIG_KEY = 'festival.scheduleFieldConfig'

function isValidFestivalData(data) {
  return !!(
    data &&
    data.festivalMeta &&
    typeof data.festivalMeta === 'object' &&
    Array.isArray(data.films) &&
    data.films.length
  )
}

function normalizeFestivalData(data) {
  const festivalMeta = Object.assign({}, fallbackFestivalData.festivalMeta, data.festivalMeta || {})
  const interestOptions = Array.isArray(data.interestOptions) && data.interestOptions.length
    ? data.interestOptions
    : fallbackFestivalData.interestOptions

  return {
    festivalMeta,
    films: data.films,
    interestOptions,
    commuteRoutes: data.commuteRoutes && typeof data.commuteRoutes === 'object' ? data.commuteRoutes : null,
    dataVersion: data.dataVersion || festivalMeta.dataVersion || ''
  }
}

function normalizeFestivalPayload(payload) {
  const data = payload && payload.data && isValidFestivalData(payload.data)
    ? payload.data
    : payload
  if (!isValidFestivalData(data)) {
    return null
  }
  return Object.assign({}, data, {
    dataVersion: data.dataVersion || (payload && payload.dataVersion) || (data.festivalMeta && data.festivalMeta.dataVersion) || ''
  })
}

function cleanConfigText(value, maxLength) {
  const text = typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : ''
  return text.slice(0, maxLength)
}

function normalizeCommunityConfig(config) {
  const source = config && typeof config === 'object' ? config : {}
  const groupQrFileID = cleanConfigText(
    source.groupQrFileID ||
    source.groupQrFileId ||
    source.groupQrCloudFileID ||
    source.groupQrCloudFileId ||
    '',
    512
  )
  const groupQrUrl = cleanConfigText(
    source.groupQrUrl ||
    source.groupQrSrc ||
    source.feedbackGroupQrUrl ||
    source.feedbackGroupQrSrc ||
    '',
    512
  )

  return {
    groupName: cleanConfigText(source.groupName || source.feedbackGroupName || '赶场愉快反馈群', 80),
    groupHint: cleanConfigText(source.groupHint || source.feedbackGroupHint || '', 120),
    groupQrFileID,
    groupQrUrl,
    groupQrSrc: groupQrUrl || groupQrFileID
  }
}

function isCurrentFestivalData(data) {
  if (!isValidFestivalData(data)) {
    return false
  }
  const currentName = String(fallbackFestivalData.festivalMeta && fallbackFestivalData.festivalMeta.name || '').trim()
  const incomingName = String(data.festivalMeta && data.festivalMeta.name || '').trim()
  return !currentName || incomingName === currentName
}

function countFestivalScreenings(films) {
  return (Array.isArray(films) ? films : []).reduce((sum, film) => {
    return sum + (Array.isArray(film && film.screenings) ? film.screenings.length : 0)
  }, 0)
}

function hasMockScreenings(films) {
  return (Array.isArray(films) ? films : []).some(film => {
    return (Array.isArray(film && film.screenings) ? film.screenings : []).some(screening => {
      return !!(screening && (screening.isMock || screening.mockLabel))
    })
  })
}

function festivalDataLooksStale(data) {
  const meta = data && data.festivalMeta || {}
  const version = String((data && data.dataVersion) || meta.dataVersion || '').toLowerCase()
  const screeningCount = countFestivalScreenings(data && data.films)
  return /mock|lite-fallback/.test(version) || hasMockScreenings(data && data.films) || (screeningCount > 0 && screeningCount < 100)
}

function festivalDataCanPruneUserState(data) {
  if (!isValidFestivalData(data)) {
    return false
  }
  return countFestivalScreenings(data.films) >= 100 && !festivalDataLooksStale(data)
}

function normalizeTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
  }
  return 0
}

function festivalDataChunkKey(cacheId, index) {
  return `${STORAGE_KEYS.festivalDataChunkPrefix}${cacheId}.${index}`
}

function removeFestivalDataChunks(meta) {
  const cacheId = meta && meta.cacheId
  const chunkCount = Math.max(0, Math.min(100, Number(meta && meta.chunkCount) || 0))
  if (!cacheId || !chunkCount) {
    return
  }
  for (let index = 0; index < chunkCount; index += 1) {
    try {
      wx.removeStorageSync(festivalDataChunkKey(cacheId, index))
    } catch (error) {}
  }
}

function clearFestivalDataCache() {
  try {
    removeFestivalDataChunks(wx.getStorageSync(STORAGE_KEYS.festivalDataMeta))
  } catch (error) {}
  try {
    wx.removeStorageSync(STORAGE_KEYS.festivalDataMeta)
  } catch (error) {}
  try {
    wx.removeStorageSync(STORAGE_KEYS.festivalData)
  } catch (error) {}
}

function readFestivalDataCache() {
  try {
    const meta = wx.getStorageSync(STORAGE_KEYS.festivalDataMeta)
    const cacheId = meta && meta.cacheId
    const chunkCount = Math.max(0, Math.min(100, Number(meta && meta.chunkCount) || 0))
    if (cacheId && chunkCount) {
      const chunks = []
      for (let index = 0; index < chunkCount; index += 1) {
        const chunk = wx.getStorageSync(festivalDataChunkKey(cacheId, index))
        if (typeof chunk !== 'string') {
          throw new Error('missing festival data cache chunk')
        }
        chunks.push(chunk)
      }
      return JSON.parse(chunks.join(''))
    }
  } catch (error) {
    clearFestivalDataCache()
  }

  try {
    const legacy = wx.getStorageSync(STORAGE_KEYS.festivalData)
    return legacy && typeof legacy === 'object' ? legacy : null
  } catch (error) {
    return null
  }
}

function writeFestivalDataCache(payload) {
  const text = JSON.stringify(payload || {})
  const oldMeta = (() => {
    try {
      return wx.getStorageSync(STORAGE_KEYS.festivalDataMeta)
    } catch (error) {
      return null
    }
  })()
  const cacheId = `${Date.now()}_${Math.floor(Math.random() * 100000)}`
  const chunks = []
  for (let index = 0; index < text.length; index += FESTIVAL_DATA_CACHE_CHUNK_SIZE) {
    chunks.push(text.slice(index, index + FESTIVAL_DATA_CACHE_CHUNK_SIZE))
  }

  try {
    chunks.forEach((chunk, index) => {
      wx.setStorageSync(festivalDataChunkKey(cacheId, index), chunk)
    })
    wx.setStorageSync(STORAGE_KEYS.festivalDataMeta, {
      cacheId,
      chunkCount: chunks.length,
      length: text.length,
      dataVersion: payload && payload.dataVersion || '',
      fetchedAt: payload && payload.fetchedAt || Date.now()
    })
    try {
      wx.removeStorageSync(STORAGE_KEYS.festivalData)
    } catch (error) {}
    removeFestivalDataChunks(oldMeta)
  } catch (error) {
    removeFestivalDataChunks({ cacheId, chunkCount: chunks.length })
    throw error
  }
}

function uniqueIds(ids) {
  const seen = {}
  return (Array.isArray(ids) ? ids : []).filter(id => {
    if (!id || seen[id]) {
      return false
    }
    seen[id] = true
    return true
  })
}

function normalizeSmartPlanMeta(meta) {
  if (!meta || typeof meta !== 'object') {
    return null
  }
  const instruction = String(meta.instruction || '').trim().slice(0, 500)
  if (!instruction) {
    return null
  }
  return {
    mode: String(meta.mode || '').slice(0, 32),
    allowAddFilms: meta.allowAddFilms === true,
    source: String(meta.source || '').slice(0, 32),
    instruction,
    preferences: meta.preferences && typeof meta.preferences === 'object' ? meta.preferences : null,
    createdAt: meta.createdAt || Date.now()
  }
}

function normalizePlanNotes(notes, selectedIds) {
  const allowed = uniqueIds(selectedIds).reduce((map, id) => {
    map[id] = true
    return map
  }, {})
  if (!notes || typeof notes !== 'object') {
    return {}
  }
  return Object.keys(notes).reduce((next, id) => {
    const text = String(notes[id] || '').trim().slice(0, 40)
    if (text && (!selectedIds || !selectedIds.length || allowed[id])) {
      next[id] = text
    }
    return next
  }, {})
}

function readScreeningPopularityEnabled() {
  try {
    const config = wx.getStorageSync(SCHEDULE_FIELD_CONFIG_KEY)
    if (config && typeof config === 'object' && config.popularity === false) {
      return false
    }
  } catch (error) {}
  return true
}

function setupUpdateManager() {
  if (!wx.getUpdateManager) {
    return
  }
  const updateManager = wx.getUpdateManager()
  updateManager.onCheckForUpdate(res => {
    if (res && res.hasUpdate) {
      console.info('[update] 新版本下载中')
    }
  })
  updateManager.onUpdateReady(() => {
    wx.showModal({
      title: '新版本已准备好',
      content: '重启后使用最新版本。',
      confirmText: '立即重启',
      cancelText: '稍后',
      success: res => {
        if (res && res.confirm) {
          updateManager.applyUpdate()
        }
      }
    })
  })
  updateManager.onUpdateFailed(() => {
    wx.showModal({
      title: '更新失败',
      content: '新版本下载失败，可以稍后重新打开小程序。',
      showCancel: false,
      confirmText: '知道了'
    })
  })
}

function makePlanScheme(options) {
  const now = Date.now()
  const source = options || {}
  const selectedIds = uniqueIds(source.selectedIds)
  return {
    id: source.id || `plan_${now}_${Math.floor(Math.random() * 1000)}`,
    name: source.name || '方案',
    selectedIds,
    notes: normalizePlanNotes(source.notes, selectedIds),
    smartPlanMeta: normalizeSmartPlanMeta(source.smartPlanMeta),
    createdAt: source.createdAt || now,
    updatedAt: source.updatedAt || now
  }
}

function normalizePlanSchemes(schemes, fallbackSelectedIds) {
  const list = Array.isArray(schemes) ? schemes : []
  const normalized = list
    .filter(item => item && item.id)
    .map((item, index) => makePlanScheme({
      id: item.id,
      name: item.name || `方案 ${index + 1}`,
      selectedIds: item.selectedIds,
      notes: item.notes,
      smartPlanMeta: item.smartPlanMeta,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    }))

  if (normalized.length) {
    return normalized
  }

  return [
    makePlanScheme({
      id: DEFAULT_PLAN_SCHEME_ID,
      name: '方案 1',
      selectedIds: fallbackSelectedIds || []
    })
  ]
}

App({
  globalData: {
    films: fallbackFestivalData.films,
    festivalMeta: fallbackFestivalData.festivalMeta,
    interestOptions: fallbackFestivalData.interestOptions,
    festivalDataVersion: 'builtin',
    festivalDataSource: 'builtin',
    festivalDataPromise: null,
    commuteRoutes: fallbackFestivalData.commuteRoutes || null,
    selectedScreeningIds: [],
    planSchemes: [],
    activePlanSchemeId: DEFAULT_PLAN_SCHEME_ID,
    filmMarks: {},
    filmViewState: {},
    screeningPopularity: {},
    smartPlanMeta: null,
    communityConfig: normalizeCommunityConfig(null)
  },

  onLaunch() {
    if (wx.cloud) {
      try {
        wx.cloud.init({ env: CLOUD_ENV_ID, traceUser: true })
      } catch (error) {}
    }
    setupUpdateManager()
    this.loadLocalState()
    this.globalData.festivalDataPromise = this.shouldRefreshFestivalData()
      ? this.refreshFestivalData()
      : Promise.resolve({
        source: 'cache',
        skippedRefresh: true,
        dataVersion: this.globalData.festivalDataVersion
      })
  },

  loadLocalState() {
    try {
      const festivalData = readFestivalDataCache()
      const selectedScreeningIds = wx.getStorageSync(STORAGE_KEYS.selectedScreeningIds)
      const planSchemes = wx.getStorageSync(STORAGE_KEYS.planSchemes)
      const activePlanSchemeId = wx.getStorageSync(STORAGE_KEYS.activePlanSchemeId)
      const filmMarks = wx.getStorageSync(STORAGE_KEYS.filmMarks)
      const cachedFestivalData = festivalData && festivalData.data
      const cachedCommunityConfig = normalizeCommunityConfig(festivalData && festivalData.community)
      const cachedFetchedAt = normalizeTimestamp(festivalData && festivalData.fetchedAt)
      if (isCurrentFestivalData(cachedFestivalData) && !festivalDataLooksStale(cachedFestivalData)) {
        this._festivalDataCacheUsable = true
        this._festivalDataCacheFetchedAt = cachedFetchedAt
        this.globalData.communityConfig = cachedCommunityConfig
        this.applyFestivalData(cachedFestivalData, {
          source: 'cache',
          dataVersion: festivalData.dataVersion || 'cached'
        }, {
          skipPrune: true
        })
      } else if (cachedFestivalData) {
        this._festivalDataCacheUsable = false
        this._festivalDataCacheFetchedAt = 0
        clearFestivalDataCache()
      }
      this.globalData.planSchemes = normalizePlanSchemes(planSchemes, selectedScreeningIds)
      this.globalData.activePlanSchemeId = activePlanSchemeId || (this.globalData.planSchemes[0] && this.globalData.planSchemes[0].id) || DEFAULT_PLAN_SCHEME_ID
      this.syncActivePlanFromSchemes()
      this.globalData.filmMarks = filmMarks && typeof filmMarks === 'object' ? filmMarks : {}
      this.pruneLocalState()
    } catch (error) {
      this.globalData.selectedScreeningIds = []
      this.globalData.planSchemes = normalizePlanSchemes([], [])
      this.globalData.activePlanSchemeId = DEFAULT_PLAN_SCHEME_ID
      this.globalData.filmMarks = {}
    }
  },

  shouldRefreshFestivalData() {
    if (!this._festivalDataCacheUsable) {
      return true
    }
    const fetchedAt = normalizeTimestamp(this._festivalDataCacheFetchedAt)
    return !fetchedAt || Date.now() - fetchedAt > FESTIVAL_DATA_REFRESH_INTERVAL
  },

  applyFestivalData(data, meta, options) {
    const normalized = normalizeFestivalData(data)
    this.globalData.films = normalized.films
    this.globalData.festivalMeta = normalized.festivalMeta
    this.globalData.interestOptions = normalized.interestOptions
    this.globalData.commuteRoutes = normalized.commuteRoutes
    this.globalData.festivalDataVersion = (meta && meta.dataVersion) || normalized.dataVersion || 'remote'
    this.globalData.festivalDataSource = (meta && meta.source) || 'remote'
    if (meta && meta.community) {
      this.globalData.communityConfig = normalizeCommunityConfig(meta.community)
    }
    if (!options || options.skipPrune !== true) {
      this.pruneLocalState()
    }
    if (this.hasFullFestivalDataForPopularity()) {
      this.queueScreeningPopularitySync(1200)
    }
  },

  refreshFestivalData() {
    if (!wx.cloud || !wx.cloud.callFunction) {
      console.info('[festival-data] 未启用云开发，使用内置数据')
      return Promise.resolve({ source: 'builtin' })
    }

    return wx.cloud.callFunction({
      name: 'getFestivalData',
      data: {}
    }).then(res => {
      const result = res && res.result
      if (!result || !result.ok) {
        console.warn('[festival-data] 云数据未加载，使用内置数据', result || res)
        return { source: 'builtin' }
      }
      return this.resolveFestivalDataResult(result)
    }).then(payload => {
      const result = payload && payload.result
      const festivalData = payload && payload.data
      if (!isValidFestivalData(festivalData)) {
        console.warn('[festival-data] 云数据未加载，使用内置数据', result || payload)
        return { source: 'builtin' }
      }
      if (!isCurrentFestivalData(festivalData)) {
        clearFestivalDataCache()
        console.warn('[festival-data] 云数据不是当前片单，使用内置数据', {
          current: fallbackFestivalData.festivalMeta && fallbackFestivalData.festivalMeta.name,
          remote: festivalData.festivalMeta && festivalData.festivalMeta.name
        })
        return { source: 'builtin' }
      }
      if (festivalDataLooksStale(festivalData)) {
        clearFestivalDataCache()
        console.warn('[festival-data] 云数据疑似测试或不完整，已忽略', {
          films: Array.isArray(festivalData.films) ? festivalData.films.length : 0,
          screenings: countFestivalScreenings(festivalData.films),
          version: festivalData.dataVersion || (festivalData.festivalMeta && festivalData.festivalMeta.dataVersion) || ''
        })
        return { source: 'builtin', stale: true }
      }

      const communityConfig = normalizeCommunityConfig(payload.community)
      this.applyFestivalData(festivalData, {
        source: payload.source || 'cloud',
        dataVersion: payload.dataVersion,
        community: communityConfig
      })
      try {
        writeFestivalDataCache({
          data: normalizeFestivalData(festivalData),
          dataVersion: payload.dataVersion || '',
          updatedAt: payload.updatedAt || Date.now(),
          fetchedAt: Date.now(),
          community: communityConfig
        })
        this._festivalDataCacheUsable = true
        this._festivalDataCacheFetchedAt = Date.now()
      } catch (error) {
        console.warn('[festival-data] 云数据缓存失败，继续使用内存数据', error)
      }
      console.info('[festival-data] 云数据已加载', {
        name: this.globalData.festivalMeta.name,
        films: this.globalData.films.length,
        version: this.globalData.festivalDataVersion
      })
      return Object.assign({}, result || {}, {
        source: payload.source || 'cloud',
        dataVersion: payload.dataVersion || '',
        updatedAt: payload.updatedAt || Date.now(),
        community: communityConfig
      })
    }).catch(error => {
      console.warn('[festival-data] 云函数调用失败，使用内置数据', error)
      return { source: 'builtin' }
    })
  },

  resolveFestivalDataResult(result) {
    const inlineData = normalizeFestivalPayload(result)
    if (inlineData) {
      return Promise.resolve({
        result,
        data: inlineData,
        source: result.source || 'cloud',
        dataVersion: result.dataVersion || inlineData.dataVersion || '',
        updatedAt: result.updatedAt || Date.now(),
        community: normalizeCommunityConfig(result.community)
      })
    }

    const fileID = String(result && result.fileID || '').trim()
    if (!fileID || !wx.cloud || !wx.cloud.downloadFile) {
      return Promise.resolve({ result, data: null })
    }

    return wx.cloud.downloadFile({ fileID }).then(fileRes => {
      return this.readFestivalDataFile(fileRes && fileRes.tempFilePath)
    }).then(data => ({
      result,
      data,
      source: result.source || 'cloud-file',
      dataVersion: result.dataVersion || data.dataVersion || '',
      updatedAt: result.updatedAt || Date.now(),
      community: normalizeCommunityConfig(result.community)
    }))
  },

  readFestivalDataFile(filePath) {
    return new Promise((resolve, reject) => {
      const fs = wx.getFileSystemManager && wx.getFileSystemManager()
      if (!fs || !filePath) {
        reject(new Error('Missing festival data file'))
        return
      }
      fs.readFile({
        filePath,
        encoding: 'utf8',
        success: res => {
          try {
            const text = String(res && res.data || '').replace(/^\uFEFF/, '')
            const data = normalizeFestivalPayload(JSON.parse(text))
            if (!data) {
              reject(new Error('Invalid festival data file'))
              return
            }
            resolve(data)
          } catch (error) {
            reject(error)
          }
        },
        fail: reject
      })
    })
  },

  whenFestivalDataReady() {
    return this.globalData.festivalDataPromise || Promise.resolve({ source: this.globalData.festivalDataSource })
  },

  getCommunityConfig() {
    return normalizeCommunityConfig(this.globalData.communityConfig)
  },

  fetchCommunityConfig() {
    if (!wx.cloud || !wx.cloud.callFunction) {
      return Promise.resolve(this.getCommunityConfig())
    }
    if (this._communityConfigPromise) {
      return this._communityConfigPromise
    }
    this._communityConfigPromise = wx.cloud.callFunction({
      name: 'getFestivalData',
      data: {
        action: 'getCommunityConfig'
      }
    }).then(res => {
      const result = res && res.result
      if (result && result.ok) {
        const communityConfig = normalizeCommunityConfig(result.community)
        this.globalData.communityConfig = communityConfig
        try {
          const cached = readFestivalDataCache()
          if (cached && typeof cached === 'object') {
            writeFestivalDataCache(Object.assign({}, cached, {
              community: communityConfig
            }))
          }
        } catch (error) {}
      }
      return this.getCommunityConfig()
    }).catch(error => {
      console.warn('[community-config] 云配置读取失败，沿用当前配置', error)
      return this.getCommunityConfig()
    }).then(result => {
      this._communityConfigPromise = null
      return result
    }, error => {
      this._communityConfigPromise = null
      throw error
    })
    return this._communityConfigPromise
  },

  hasUsableFestivalData() {
    return festivalDataCanPruneUserState(this.getCurrentFestivalDataSnapshot())
  },

  isFestivalDataLikelyStale() {
    return festivalDataLooksStale({
      festivalMeta: Object.assign({}, this.globalData.festivalMeta || {}, {
        dataVersion: this.globalData.festivalDataVersion
      }),
      films: this.globalData.films,
      dataVersion: this.globalData.festivalDataVersion
    })
  },

  ensureFestivalDataFresh() {
    if (!this.isFestivalDataLikelyStale()) {
      return this.whenFestivalDataReady()
    }
    if (this._festivalDataFreshPromise) {
      return this._festivalDataFreshPromise
    }
    this._festivalDataFreshPromise = this.refreshFestivalData()
      .then(result => {
        this._festivalDataFreshPromise = null
        return result
      })
      .catch(error => {
        this._festivalDataFreshPromise = null
        throw error
      })
    return this._festivalDataFreshPromise
  },

  pruneLocalState() {
    const currentData = {
      festivalMeta: Object.assign({}, this.globalData.festivalMeta || {}, {
        dataVersion: this.globalData.festivalDataVersion
      }),
      films: this.globalData.films,
      dataVersion: this.globalData.festivalDataVersion
    }
    if (!festivalDataCanPruneUserState(currentData)) {
      console.warn('[local-state] 片单数据未完整加载，跳过本地用户数据清理', {
        films: Array.isArray(this.globalData.films) ? this.globalData.films.length : 0,
        screenings: countFestivalScreenings(this.globalData.films),
        version: this.globalData.festivalDataVersion
      })
      return false
    }

    const validFilmIds = {}
    const validScreeningIds = {}
    ;(this.globalData.films || []).forEach(film => {
      validFilmIds[film.id] = true
      ;(film.screenings || []).forEach(screening => {
        validScreeningIds[screening.id] = true
      })
    })

    const schemes = normalizePlanSchemes(this.globalData.planSchemes, this.globalData.selectedScreeningIds)
      .map((scheme, index) => Object.assign({}, scheme, {
        name: scheme.name || `方案 ${index + 1}`,
        selectedIds: uniqueIds(scheme.selectedIds).filter(id => validScreeningIds[id]),
        notes: normalizePlanNotes(scheme.notes, uniqueIds(scheme.selectedIds).filter(id => validScreeningIds[id])),
        smartPlanMeta: normalizeSmartPlanMeta(scheme.smartPlanMeta)
      }))
    const activePlanSchemeId = schemes.some(scheme => scheme.id === this.globalData.activePlanSchemeId)
      ? this.globalData.activePlanSchemeId
      : schemes[0].id
    const activeScheme = schemes.find(scheme => scheme.id === activePlanSchemeId) || schemes[0]
    const selectedIds = activeScheme ? activeScheme.selectedIds : []
    const rawMarks = this.globalData.filmMarks || {}
    const marks = Object.keys(rawMarks).reduce((next, filmId) => {
      if (validFilmIds[filmId]) {
        next[filmId] = rawMarks[filmId]
      }
      return next
    }, {})
    ;(this.globalData.films || []).forEach(film => {
      if (!film || marks[film.id]) {
        return
      }
      const aliasIds = Array.isArray(film.markAliasFilmIds) ? film.markAliasFilmIds : []
      const aliasId = aliasIds.find(id => rawMarks[id])
      if (aliasId) {
        marks[film.id] = rawMarks[aliasId]
      }
    })

    this.globalData.planSchemes = schemes
    this.globalData.activePlanSchemeId = activePlanSchemeId
    this.globalData.selectedScreeningIds = selectedIds
    this.globalData.smartPlanMeta = normalizeSmartPlanMeta(activeScheme && activeScheme.smartPlanMeta)
    this.globalData.filmMarks = marks
    try {
      wx.setStorageSync(STORAGE_KEYS.selectedScreeningIds, selectedIds)
      wx.setStorageSync(STORAGE_KEYS.planSchemes, schemes)
      wx.setStorageSync(STORAGE_KEYS.activePlanSchemeId, activePlanSchemeId)
      wx.setStorageSync(STORAGE_KEYS.filmMarks, marks)
    } catch (error) {}
    return true
  },

  ensurePlanSchemes() {
    this.globalData.planSchemes = normalizePlanSchemes(this.globalData.planSchemes, this.globalData.selectedScreeningIds)
    if (!this.globalData.planSchemes.some(scheme => scheme.id === this.globalData.activePlanSchemeId)) {
      this.globalData.activePlanSchemeId = this.globalData.planSchemes[0].id
    }
  },

  syncActivePlanFromSchemes() {
    this.ensurePlanSchemes()
    const active = this.globalData.planSchemes.find(scheme => scheme.id === this.globalData.activePlanSchemeId) || this.globalData.planSchemes[0]
    this.globalData.activePlanSchemeId = active.id
    this.globalData.selectedScreeningIds = uniqueIds(active.selectedIds)
    this.globalData.smartPlanMeta = normalizeSmartPlanMeta(active.smartPlanMeta)
  },

  persistPlanState() {
    try {
      wx.setStorageSync(STORAGE_KEYS.selectedScreeningIds, this.globalData.selectedScreeningIds || [])
      wx.setStorageSync(STORAGE_KEYS.planSchemes, this.globalData.planSchemes || [])
      wx.setStorageSync(STORAGE_KEYS.activePlanSchemeId, this.globalData.activePlanSchemeId)
    } catch (error) {}
    this.queueScreeningPopularitySync()
  },

  getPlanSchemes() {
    this.ensurePlanSchemes()
    return this.globalData.planSchemes || []
  },

  getActivePlanSchemeId() {
    this.ensurePlanSchemes()
    return this.globalData.activePlanSchemeId
  },

  setActivePlanScheme(id) {
    this.ensurePlanSchemes()
    if (!this.globalData.planSchemes.some(scheme => scheme.id === id)) {
      return false
    }
    this.globalData.activePlanSchemeId = id
    this.syncActivePlanFromSchemes()
    this.persistPlanState()
    return true
  },

  createPlanScheme(selectedIds, name, options) {
    this.ensurePlanSchemes()
    const nextIndex = this.globalData.planSchemes.length + 1
    const source = options || {}
    const scheme = makePlanScheme({
      name: name || `方案 ${nextIndex}`,
      selectedIds: selectedIds || [],
      notes: source.notes
    })
    this.globalData.planSchemes = this.globalData.planSchemes.concat(scheme)
    this.globalData.activePlanSchemeId = scheme.id
    this.globalData.smartPlanMeta = null
    this.syncActivePlanFromSchemes()
    this.persistPlanState()
    return scheme
  },

  renamePlanScheme(id, name) {
    this.ensurePlanSchemes()
    const nextName = String(name || '').trim().replace(/\s+/g, ' ')
    if (!nextName) {
      return false
    }
    let changed = false
    this.globalData.planSchemes = this.globalData.planSchemes.map(scheme => {
      if (scheme.id !== id) {
        return scheme
      }
      changed = true
      return Object.assign({}, scheme, {
        name: nextName.slice(0, 16),
        updatedAt: Date.now()
      })
    })
    if (!changed) {
      return false
    }
    this.persistPlanState()
    return true
  },

  deletePlanScheme(id) {
    this.ensurePlanSchemes()
    const index = this.globalData.planSchemes.findIndex(scheme => scheme.id === id)
    if (index < 0) {
      return null
    }

    const deleted = this.globalData.planSchemes[index]
    let nextSchemes = this.globalData.planSchemes.filter(scheme => scheme.id !== id)
    if (!nextSchemes.length) {
      nextSchemes = [makePlanScheme({ name: '方案 1', selectedIds: [] })]
    }

    const nextActive = nextSchemes[Math.min(index, nextSchemes.length - 1)] || nextSchemes[0]
    this.globalData.planSchemes = nextSchemes
    this.globalData.activePlanSchemeId = nextActive.id
    this.syncActivePlanFromSchemes()
    this.persistPlanState()
    return deleted
  },

  getSelectedScreeningIds() {
    return this.globalData.selectedScreeningIds || []
  },

  setSelectedScreeningIds(ids) {
    const selectedIds = uniqueIds(ids)
    this.ensurePlanSchemes()
    this.globalData.selectedScreeningIds = selectedIds
    this.globalData.planSchemes = this.globalData.planSchemes.map(scheme => {
      if (scheme.id !== this.globalData.activePlanSchemeId) {
        return scheme
      }
      return Object.assign({}, scheme, {
        selectedIds,
        notes: normalizePlanNotes(scheme.notes, selectedIds),
        smartPlanMeta: normalizeSmartPlanMeta(this.globalData.smartPlanMeta),
        updatedAt: Date.now()
      })
    })
    this.persistPlanState()
  },

  setPlanScreeningNote(screeningId, note) {
    this.ensurePlanSchemes()
    const id = String(screeningId || '').trim()
    if (!id) {
      return false
    }
    const text = String(note || '').trim().slice(0, 40)
    let changed = false
    this.globalData.planSchemes = this.globalData.planSchemes.map(scheme => {
      if (scheme.id !== this.globalData.activePlanSchemeId) {
        return scheme
      }
      const selectedIds = uniqueIds(scheme.selectedIds)
      if (!selectedIds.includes(id)) {
        return scheme
      }
      const notes = normalizePlanNotes(scheme.notes, selectedIds)
      if (text) {
        notes[id] = text
      } else {
        delete notes[id]
      }
      changed = true
      return Object.assign({}, scheme, {
        notes,
        updatedAt: Date.now()
      })
    })
    if (changed) {
      this.persistPlanState()
    }
    return changed
  },

  toggleScreening(screeningId) {
    const selected = this.getSelectedScreeningIds()
    const exists = selected.includes(screeningId)
    const next = exists ? selected.filter(id => id !== screeningId) : selected.concat(screeningId)
    this.setSelectedScreeningIds(next)
    return !exists
  },

  getFilmMarks() {
    return this.globalData.filmMarks || {}
  },

  setFilmMark(filmId, mark) {
    const next = Object.assign({}, this.getFilmMarks())
    if (mark) {
      next[filmId] = mark
    } else {
      delete next[filmId]
    }
    this.globalData.filmMarks = next
    wx.setStorageSync(STORAGE_KEYS.filmMarks, next)
  },

  getFestivalPopularityId() {
    const meta = this.globalData.festivalMeta || {}
    return String(meta.id || meta.slug || meta.name || this.globalData.festivalDataVersion || 'current')
  },

  getCurrentFestivalDataSnapshot() {
    return {
      festivalMeta: Object.assign({}, this.globalData.festivalMeta || {}, {
        dataVersion: this.globalData.festivalDataVersion
      }),
      films: this.globalData.films,
      dataVersion: this.globalData.festivalDataVersion
    }
  },

  hasFullFestivalDataForPopularity() {
    return festivalDataCanPruneUserState(this.getCurrentFestivalDataSnapshot())
  },

  whenFestivalDataReadyForPopularity() {
    if (this.hasFullFestivalDataForPopularity()) {
      return Promise.resolve(true)
    }
    const promise = this.globalData.festivalDataPromise
    if (promise && typeof promise.then === 'function') {
      return promise.then(() => this.hasFullFestivalDataForPopularity(), () => false)
    }
    return Promise.resolve(false)
  },

  getAllPlannedScreeningIds() {
    this.ensurePlanSchemes()
    const active = this.globalData.planSchemes.find(scheme => scheme.id === this.globalData.activePlanSchemeId) || this.globalData.planSchemes[0]
    return uniqueIds(active && active.selectedIds || [])
  },

  getScreeningFilmMap() {
    const map = {}
    ;(this.globalData.films || []).forEach(film => {
      ;(film.screenings || []).forEach(screening => {
        if (screening && screening.id) {
          map[screening.id] = film.id
        }
      })
    })
    return map
  },

  buildPopularityScreenings(screeningIds) {
    const filmMap = this.getScreeningFilmMap()
    return uniqueIds(screeningIds).map(id => ({
      screeningId: id,
      filmId: filmMap[id] || ''
    }))
  },

  mergeScreeningPopularity(counts) {
    const next = Object.assign({}, this.globalData.screeningPopularity || {})
    Object.keys(counts || {}).forEach(id => {
      const count = Number(counts[id])
      next[id] = Number.isFinite(count) && count > 0 ? count : 0
    })
    this.globalData.screeningPopularity = next
    return next
  },

  getScreeningPopularityMap(screeningIds) {
    if (!this.isScreeningPopularityEnabled()) {
      return uniqueIds(screeningIds).reduce((map, id) => {
        map[id] = 0
        return map
      }, {})
    }
    const source = this.globalData.screeningPopularity || {}
    return uniqueIds(screeningIds).reduce((map, id) => {
      map[id] = source[id] || 0
      return map
    }, {})
  },

  isScreeningPopularityEnabled() {
    return readScreeningPopularityEnabled()
  },

  queueScreeningPopularitySync(delay) {
    if (this._screeningPopularityTimer) {
      clearTimeout(this._screeningPopularityTimer)
      this._screeningPopularityTimer = null
    }
    if (!this.isScreeningPopularityEnabled()) {
      return
    }
    this._screeningPopularityTimer = setTimeout(() => {
      this._screeningPopularityTimer = null
      this.syncScreeningPopularity()
    }, Number.isFinite(delay) ? delay : POPULARITY_SYNC_DELAY)
  },

  syncScreeningPopularity(options) {
    if (this._screeningPopularityTimer) {
      clearTimeout(this._screeningPopularityTimer)
      this._screeningPopularityTimer = null
    }
    if (!this.isScreeningPopularityEnabled()) {
      this._screeningPopularityQueuedQueryIds = []
      return Promise.resolve(this.globalData.screeningPopularity || {})
    }
    this._screeningPopularityQueuedQueryIds = uniqueIds([].concat(
      this._screeningPopularityQueuedQueryIds || [],
      options && options.queryScreeningIds || []
    ))
    const run = () => this.whenFestivalDataReadyForPopularity().then(ready => {
      const queuedQueryIds = this._screeningPopularityQueuedQueryIds || []
      this._screeningPopularityQueuedQueryIds = []
      if (!ready) {
        return this.globalData.screeningPopularity || {}
      }
      if (!wx.cloud || !wx.cloud.callFunction) {
        return Promise.resolve(this.globalData.screeningPopularity || {})
      }
      const ids = this.getAllPlannedScreeningIds()
      const queryIds = uniqueIds([].concat(ids, queuedQueryIds))
      if (!ids.length && !queryIds.length) {
        return Promise.resolve(this.globalData.screeningPopularity || {})
      }
      return wx.cloud.callFunction({
        name: 'screeningPopularity',
        data: {
          action: 'sync',
          festivalId: this.getFestivalPopularityId(),
          screeningIds: ids,
          queryScreeningIds: queryIds,
          screenings: this.buildPopularityScreenings(queryIds)
        }
      }).then(res => {
        const result = res && res.result
        if (result && result.ok) {
          return this.mergeScreeningPopularity(result.counts)
        }
        return this.globalData.screeningPopularity || {}
      }).catch(error => {
        console.warn('[screening-popularity] sync failed', error)
        return this.globalData.screeningPopularity || {}
      })
    })
    this._screeningPopularitySyncChain = (this._screeningPopularitySyncChain || Promise.resolve()).then(run, run)
    return this._screeningPopularitySyncChain
  },

  clearScreeningPopularitySelection() {
    this._screeningPopularityQueuedQueryIds = []
    if (this._screeningPopularityTimer) {
      clearTimeout(this._screeningPopularityTimer)
      this._screeningPopularityTimer = null
    }
    if (!wx.cloud || !wx.cloud.callFunction) {
      return Promise.resolve(this.globalData.screeningPopularity || {})
    }
    const run = () => wx.cloud.callFunction({
      name: 'screeningPopularity',
      data: {
        action: 'sync',
        festivalId: this.getFestivalPopularityId(),
        screeningIds: [],
        queryScreeningIds: [],
        screenings: []
      }
    }).catch(error => {
      console.warn('[screening-popularity] clear failed', error)
      return null
    })
    this._screeningPopularitySyncChain = (this._screeningPopularitySyncChain || Promise.resolve()).then(run, run)
    return this._screeningPopularitySyncChain
  },

  fetchScreeningPopularity(screeningIds, options) {
    const ids = uniqueIds(screeningIds)
    const force = !!(options && options.force)
    const now = Date.now()
    const readMap = () => {
      const source = this.globalData.screeningPopularity || {}
      return ids.reduce((map, id) => {
        map[id] = source[id] || 0
        return map
      }, {})
    }
    if (!ids.length || (!force && !this.isScreeningPopularityEnabled()) || !wx.cloud || !wx.cloud.callFunction) {
      return Promise.resolve(this.getScreeningPopularityMap(ids))
    }
    this._screeningPopularityFetchedAt = this._screeningPopularityFetchedAt || {}
    const fetchedAt = this._screeningPopularityFetchedAt
    const idsToFetch = force
      ? ids
      : ids.filter(id => now - (fetchedAt[id] || 0) > POPULARITY_FETCH_CACHE_TTL)
    if (!idsToFetch.length) {
      return Promise.resolve(force ? readMap() : this.getScreeningPopularityMap(ids))
    }
    const chunks = []
    for (let index = 0; index < idsToFetch.length; index += POPULARITY_FETCH_CHUNK_SIZE) {
      chunks.push(idsToFetch.slice(index, index + POPULARITY_FETCH_CHUNK_SIZE))
    }
    return chunks.reduce((promise, idsChunk) => {
      return promise.then(() => this.fetchScreeningPopularityChunk(idsChunk, { force }))
    }, Promise.resolve()).then(() => {
      return force ? readMap() : this.getScreeningPopularityMap(ids)
    })
  },

  fetchScreeningPopularityChunk(ids, options) {
    const idsChunk = uniqueIds(ids)
    if (!idsChunk.length) {
      return Promise.resolve(this.globalData.screeningPopularity || {})
    }
    this._screeningPopularityFetchInflight = this._screeningPopularityFetchInflight || {}
    const festivalId = this.getFestivalPopularityId()
    const key = `${festivalId}:${idsChunk.join(',')}`
    if (this._screeningPopularityFetchInflight[key]) {
      return this._screeningPopularityFetchInflight[key]
    }
    const promise = wx.cloud.callFunction({
      name: 'screeningPopularity',
      data: {
        action: 'get',
        festivalId,
        screeningIds: idsChunk
      }
    }).then(res => {
      const result = res && res.result
      if (result && result.ok) {
        const now = Date.now()
        this.mergeScreeningPopularity(result.counts)
        this._screeningPopularityFetchedAt = this._screeningPopularityFetchedAt || {}
        idsChunk.forEach(id => {
          this._screeningPopularityFetchedAt[id] = now
        })
      }
      return this.globalData.screeningPopularity || {}
    }).catch(error => {
      console.warn('[screening-popularity] fetch failed', error)
      return this.globalData.screeningPopularity || {}
    }).then(result => {
      delete this._screeningPopularityFetchInflight[key]
      return result
    }, error => {
      delete this._screeningPopularityFetchInflight[key]
      throw error
    })
    this._screeningPopularityFetchInflight[key] = promise
    return promise
  }
})
