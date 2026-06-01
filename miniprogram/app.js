const fallbackFestivalData = require('./data/festival')

const CLOUD_ENV_ID = 'cloud1-d7gzforb6cdf2aa48'

const STORAGE_KEYS = {
  festivalData: 'festival.remoteFestivalData',
  selectedScreeningIds: 'festival.selectedScreeningIds',
  filmMarks: 'festival.filmMarks',
  planSchemes: 'festival.planSchemes',
  activePlanSchemeId: 'festival.activePlanSchemeId'
}

const DEFAULT_PLAN_SCHEME_ID = 'plan_default'
const POPULARITY_SYNC_DELAY = 600
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
    dataVersion: data.dataVersion || festivalMeta.dataVersion || ''
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

function readScreeningPopularityEnabled() {
  try {
    const config = wx.getStorageSync(SCHEDULE_FIELD_CONFIG_KEY)
    if (config && typeof config === 'object' && config.popularity === false) {
      return false
    }
  } catch (error) {}
  return true
}

function makePlanScheme(options) {
  const now = Date.now()
  const source = options || {}
  return {
    id: source.id || `plan_${now}_${Math.floor(Math.random() * 1000)}`,
    name: source.name || '方案',
    selectedIds: uniqueIds(source.selectedIds),
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
    selectedScreeningIds: [],
    planSchemes: [],
    activePlanSchemeId: DEFAULT_PLAN_SCHEME_ID,
    filmMarks: {},
    filmViewState: {},
    screeningPopularity: {},
    smartPlanMeta: null
  },

  onLaunch() {
    if (wx.cloud) {
      try {
        wx.cloud.init({ env: CLOUD_ENV_ID, traceUser: true })
      } catch (error) {}
    }
    this.loadLocalState()
    this.globalData.festivalDataPromise = this.refreshFestivalData()
    this.queueScreeningPopularitySync(1200)
  },

  loadLocalState() {
    try {
      const festivalData = wx.getStorageSync(STORAGE_KEYS.festivalData)
      const selectedScreeningIds = wx.getStorageSync(STORAGE_KEYS.selectedScreeningIds)
      const planSchemes = wx.getStorageSync(STORAGE_KEYS.planSchemes)
      const activePlanSchemeId = wx.getStorageSync(STORAGE_KEYS.activePlanSchemeId)
      const filmMarks = wx.getStorageSync(STORAGE_KEYS.filmMarks)
      if (isCurrentFestivalData(festivalData && festivalData.data)) {
        this.applyFestivalData(festivalData.data, {
          source: 'cache',
          dataVersion: festivalData.dataVersion || 'cached'
        })
      } else if (festivalData && festivalData.data) {
        wx.removeStorageSync(STORAGE_KEYS.festivalData)
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

  applyFestivalData(data, meta) {
    const normalized = normalizeFestivalData(data)
    this.globalData.films = normalized.films
    this.globalData.festivalMeta = normalized.festivalMeta
    this.globalData.interestOptions = normalized.interestOptions
    this.globalData.festivalDataVersion = (meta && meta.dataVersion) || normalized.dataVersion || 'remote'
    this.globalData.festivalDataSource = (meta && meta.source) || 'remote'
    this.pruneLocalState()
    this.queueScreeningPopularitySync(1200)
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
      if (!result || !result.ok || !isValidFestivalData(result.data)) {
        console.warn('[festival-data] 云数据未加载，使用内置数据', result || res)
        return { source: 'builtin' }
      }
      if (!isCurrentFestivalData(result.data)) {
        wx.removeStorageSync(STORAGE_KEYS.festivalData)
        console.warn('[festival-data] 云数据不是当前片单，使用内置数据', {
          current: fallbackFestivalData.festivalMeta && fallbackFestivalData.festivalMeta.name,
          remote: result.data.festivalMeta && result.data.festivalMeta.name
        })
        return { source: 'builtin' }
      }

      this.applyFestivalData(result.data, {
        source: result.source || 'cloud',
        dataVersion: result.dataVersion
      })
      wx.setStorageSync(STORAGE_KEYS.festivalData, {
        data: normalizeFestivalData(result.data),
        dataVersion: result.dataVersion || '',
        updatedAt: result.updatedAt || Date.now()
      })
      console.info('[festival-data] 云数据已加载', {
        name: this.globalData.festivalMeta.name,
        films: this.globalData.films.length,
        version: this.globalData.festivalDataVersion
      })
      return result
    }).catch(error => {
      console.warn('[festival-data] 云函数调用失败，使用内置数据', error)
      return { source: 'builtin' }
    })
  },

  whenFestivalDataReady() {
    return this.globalData.festivalDataPromise || Promise.resolve({ source: this.globalData.festivalDataSource })
  },

  pruneLocalState() {
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
        smartPlanMeta: normalizeSmartPlanMeta(scheme.smartPlanMeta)
      }))
    const activePlanSchemeId = schemes.some(scheme => scheme.id === this.globalData.activePlanSchemeId)
      ? this.globalData.activePlanSchemeId
      : schemes[0].id
    const activeScheme = schemes.find(scheme => scheme.id === activePlanSchemeId) || schemes[0]
    const selectedIds = activeScheme ? activeScheme.selectedIds : []
    const marks = Object.keys(this.globalData.filmMarks || {}).reduce((next, filmId) => {
      if (validFilmIds[filmId]) {
        next[filmId] = this.globalData.filmMarks[filmId]
      }
      return next
    }, {})

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

  createPlanScheme(selectedIds, name) {
    this.ensurePlanSchemes()
    const nextIndex = this.globalData.planSchemes.length + 1
    const scheme = makePlanScheme({
      name: name || `方案 ${nextIndex}`,
      selectedIds: selectedIds || []
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
        smartPlanMeta: normalizeSmartPlanMeta(this.globalData.smartPlanMeta),
        updatedAt: Date.now()
      })
    })
    this.persistPlanState()
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

  getAllPlannedScreeningIds() {
    this.ensurePlanSchemes()
    const ids = []
    ;(this.globalData.planSchemes || []).forEach(scheme => {
      ;(scheme.selectedIds || []).forEach(id => ids.push(id))
    })
    return uniqueIds(ids)
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
    if (!this.isScreeningPopularityEnabled()) {
      this._screeningPopularityQueuedQueryIds = []
      return Promise.resolve(this.globalData.screeningPopularity || {})
    }
    this._screeningPopularityQueuedQueryIds = uniqueIds([].concat(
      this._screeningPopularityQueuedQueryIds || [],
      options && options.queryScreeningIds || []
    ))
    const run = () => {
      const queuedQueryIds = this._screeningPopularityQueuedQueryIds || []
      this._screeningPopularityQueuedQueryIds = []
      if (!wx.cloud || !wx.cloud.callFunction) {
        return Promise.resolve(this.globalData.screeningPopularity || {})
      }
      const ids = this.getAllPlannedScreeningIds()
      const queryIds = uniqueIds([].concat(ids, queuedQueryIds))
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
    }
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

  fetchScreeningPopularity(screeningIds) {
    const ids = uniqueIds(screeningIds)
    if (!ids.length || !this.isScreeningPopularityEnabled() || !wx.cloud || !wx.cloud.callFunction) {
      return Promise.resolve(this.getScreeningPopularityMap(ids))
    }
    return wx.cloud.callFunction({
      name: 'screeningPopularity',
      data: {
        action: 'get',
        festivalId: this.getFestivalPopularityId(),
        screeningIds: ids
      }
    }).then(res => {
      const result = res && res.result
      if (result && result.ok) {
        this.mergeScreeningPopularity(result.counts)
      }
      return this.getScreeningPopularityMap(ids)
    }).catch(error => {
      console.warn('[screening-popularity] fetch failed', error)
      return this.getScreeningPopularityMap(ids)
    })
  }
})
