const {
  collectStats,
  compactMeta,
  filmCoreMeta,
  filmCountry,
  filmDirector,
  filmDisplayTitle,
  filmEnTitle,
  filmGenre,
  filmPosterSrc,
  filmRatingSummary,
  filmRuntimeMinutes,
  filmSection,
  filmYear,
  getInterestMeta,
  runtimeText
} = require('../../utils/schedule')
const { getNavMetrics } = require('../../utils/nav')

const app = getApp()

const DEFAULT_SORT = 'default'
const DEFAULT_GROUP = 'section'
const VIEW_STATE_KEY = 'festival.filmViewState'
const VIEW_STATE_VERSION = 2

const FIELD_CONFIG_KEY = 'festival.filmFieldConfig'
const FIELD_OPTIONS = [
  { key: 'info', label: '影片信息', desc: '年份 · 导演 · 片长 · 单元' },
  { key: 'rating', label: '影片评分', desc: '豆瓣 / IMDb 评分' }
]
const DEFAULT_FIELD_CONFIG = { info: true, rating: true }

function readFieldConfig() {
  try {
    const stored = wx.getStorageSync(FIELD_CONFIG_KEY)
    if (stored && typeof stored === 'object') {
      return Object.assign({}, DEFAULT_FIELD_CONFIG, stored)
    }
  } catch (error) {}
  return Object.assign({}, DEFAULT_FIELD_CONFIG)
}

const ALL_SECTION = 'all'
const ALL_DIRECTOR = 'all'

function ratingValue(value) {
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? num : 0
}

function countOptions(items, getKey) {
  const map = {}
  items.forEach(item => {
    const key = getKey(item)
    if (!map[key]) {
      map[key] = { key, label: key, count: 0 }
    }
    map[key].count += 1
  })
  return Object.keys(map)
    .map(key => map[key])
    .sort((a, b) => b.count - a.count || String(a.label).localeCompare(String(b.label), 'zh-Hans-CN'))
}

function writeFieldConfig(config) {
  try {
    wx.setStorageSync(FIELD_CONFIG_KEY, config)
  } catch (error) {}
}

const sortOptions = [
  { key: 'section', label: '单元', shortLabel: '单元' },
  { key: 'director', label: '导演', shortLabel: '导演' },
  { key: 'interest', label: '想看程度', shortLabel: '想看' },
  { key: DEFAULT_SORT, label: '无', shortLabel: '无' }
]

function sortFilterLabel(sortKey) {
  const option = sortOptions.find(item => item.key === sortKey) || sortOptions[0]
  return `分组 · ${option.shortLabel}`
}

function isKnownSort(sortKey) {
  return sortOptions.some(item => item.key === sortKey)
}

function readStoredViewState() {
  try {
    const state = wx.getStorageSync(VIEW_STATE_KEY)
    return state && typeof state === 'object' ? state : {}
  } catch (error) {
    return {}
  }
}

function writeStoredViewState(state) {
  try {
    wx.setStorageSync(VIEW_STATE_KEY, state)
  } catch (error) {}
}

function normalizeViewState(state) {
  const next = Object.assign({}, state || {})
  if (!isKnownSort(next.activeSort) || next.viewVersion !== VIEW_STATE_VERSION) {
    next.activeSort = DEFAULT_GROUP
    next.collapsedGroups = {}
    next.groupHeaderFallback = defaultGroupHeader(DEFAULT_GROUP)
  }
  next.viewVersion = VIEW_STATE_VERSION
  return next
}

function defaultGroupHeader(sortKey) {
  return fallbackGroupLabel(sortKey)
}

function fallbackGroupLabel(sortKey) {
  if (sortKey === 'director') {
    return '未知导演'
  }
  if (sortKey === 'section') {
    return '其他'
  }
  if (sortKey === 'interest') {
    return '未标星'
  }
  return ''
}

function compareText(a, b) {
  return String(a || '').localeCompare(String(b || ''), 'zh-Hans-CN')
}

function compareByTitle(a, b) {
  return compareText(a.cnTitle, b.cnTitle) || compareText(a.enTitle, b.enTitle) || a.originalIndex - b.originalIndex
}

function sortFilms(films, sortKey) {
  const sorted = films.slice()
  if (sortKey === 'director') {
    return sorted.sort((a, b) => compareText(a.director || '未知导演', b.director || '未知导演') || compareByTitle(a, b))
  }
  if (sortKey === 'section') {
    return sorted.sort((a, b) => compareText(a.section || '其他', b.section || '其他') || compareByTitle(a, b))
  }
  if (sortKey === 'interest') {
    return sorted.sort((a, b) => b.interest.rank - a.interest.rank || compareByTitle(a, b))
  }
  return sorted.sort((a, b) => a.originalIndex - b.originalIndex)
}

function groupInfo(film, sortKey) {
  if (sortKey === 'director') {
    const label = film.director || '未知导演'
    return { key: `director:${label}`, label }
  }
  if (sortKey === 'section') {
    const label = film.section || '其他'
    return { key: `section:${label}`, label }
  }
  if (sortKey === 'interest') {
    const rank = film.interest.rank || 0
    return {
      key: `interest:${rank}`,
      label: rank ? film.interest.label : '未标星'
    }
  }
  return { key: DEFAULT_SORT, label: '' }
}

function buildFilmGroups(films, sortKey, collapsedGroups) {
  const sorted = sortFilms(films, sortKey)
  if (sortKey === DEFAULT_SORT) {
    return [{
      key: DEFAULT_SORT,
      label: '',
      headerText: '',
      count: sorted.length,
      collapsed: false,
      expanded: true,
      items: sorted
    }]
  }

  return sorted.reduce((groups, film) => {
    const info = groupInfo(film, sortKey)
    let group = groups.find(item => item.key === info.key)
    if (!group) {
      const collapsed = !!collapsedGroups[info.key]
      const label = info.label || fallbackGroupLabel(sortKey)
      const expanded = !collapsed
      group = {
        key: info.key,
        label,
        headerText: label,
        count: 0,
        collapsed,
        expanded,
        items: []
      }
      groups.push(group)
    }
    group.count += 1
    group.items.push(film)
    return groups
  }, [])
}

const initialViewState = normalizeViewState(readStoredViewState())
const initialActiveSort = isKnownSort(initialViewState.activeSort) ? initialViewState.activeSort : DEFAULT_GROUP

function normalizeInterestFilter(filter) {
  return filter === 'marked' ? 'marked' : 'all'
}

const initialActiveInterest = normalizeInterestFilter(initialViewState.activeInterest)

function objectSignature(source) {
  return Object.keys(source || {})
    .sort()
    .map(key => `${key}:${source[key]}`)
    .join('|')
}

function listSignature(source) {
  return (Array.isArray(source) ? source : [])
    .slice()
    .sort()
    .join('|')
}

Page({
  data: {
    festivalName: app.globalData.festivalMeta.name,
    query: '',
    activeInterest: initialActiveInterest,
    activeSort: initialActiveSort,
    sortOpen: false,
    sortFilterLabel: sortFilterLabel(initialActiveSort),
    sortOptions,
    collapsedGroups: initialViewState.collapsedGroups || {},
    stats: {},
    films: [],
    filmGroups: [],
    groupHeaderFallback: initialViewState.groupHeaderFallback || defaultGroupHeader(initialActiveSort),
    grouped: false,
    navTop: 0,
    navHeight: 44,
    navRight: 120,
    navTotalHeight: 88,
    contentTop: 92,
    filters: [
      { key: 'all', label: '全部影片' },
      { key: 'marked', label: '已标星影片' },
      { key: 'sort', label: '分组', type: 'sort' }
    ],
    markOptions: app.globalData.interestOptions,
    starSlots: [
      { n: 1, mark: 'want1' },
      { n: 2, mark: 'want2' },
      { n: 3, mark: 'want3' }
    ],
    fieldOptions: FIELD_OPTIONS,
    fieldConfig: readFieldConfig(),
    fieldPanelOpen: false,
    filterPanelOpen: false,
    activeSection: ALL_SECTION,
    activeDirector: ALL_DIRECTOR,
    doubanMin: 0,
    imdbMin: 0,
    sectionOptions: [],
    directorFilterOptions: [],
    filterActiveCount: 0
  },

  onLoad() {
    this.setNavMetrics()
    this.refreshFilmsAfterVisible()
  },

  onShow() {
    this.setNavMetrics()
    this.refreshFilmsAfterVisible()
    app.whenFestivalDataReady().then(() => {
      this.refreshFilmsAfterVisible()
    })
  },

  onTabItemTap() {
    this.refreshFilmsAfterVisible()
  },

  setNavMetrics() {
    this.setData(getNavMetrics())
  },

  refreshFilmsAfterVisible() {
    const viewState = this.loadViewState()
    const activeSort = isKnownSort(viewState.activeSort) ? viewState.activeSort : (this.data.activeSort || DEFAULT_GROUP)
    const activeInterest = normalizeInterestFilter(viewState.activeInterest || this.data.activeInterest)
    const collapsedGroups = viewState.collapsedGroups || this.data.collapsedGroups || {}
    const groupHeaderFallback = viewState.groupHeaderFallback || this.data.groupHeaderFallback || defaultGroupHeader(activeSort)
    const signature = this.buildFilmRenderSignature({
      activeSort,
      activeInterest,
      collapsedGroups
    })

    if (this._lastFilmRenderSignature === signature) {
      return
    }
    this._lastFilmRenderSignature = signature

    this.setData({
      activeSort,
      activeInterest,
      collapsedGroups,
      groupHeaderFallback,
      sortFilterLabel: sortFilterLabel(activeSort)
    }, () => this.renderFilms())
  },

  loadViewState() {
    const storedState = readStoredViewState()
    const memoryState = app.globalData.filmViewState || {}
    const viewState = normalizeViewState(Object.assign({}, memoryState, storedState))
    app.globalData.filmViewState = viewState
    writeStoredViewState(viewState)
    return viewState
  },

  toggleSort() {
    this.setData({ sortOpen: !this.data.sortOpen })
  },

  onSearchInput(event) {
    this.setData({ query: event.detail.value }, () => this.renderFilms())
  },

  openSmartPlan() {
    const smartPlan = this.selectComponent('#smartPlan')
    if (smartPlan) {
      smartPlan.open()
    }
  },

  toggleFieldPanel() {
    this.setData({
      fieldPanelOpen: !this.data.fieldPanelOpen,
      sortOpen: false,
      filterPanelOpen: false
    })
  },

  toggleField(event) {
    const key = event.currentTarget.dataset.key
    const next = Object.assign({}, this.data.fieldConfig, {
      [key]: !this.data.fieldConfig[key]
    })
    writeFieldConfig(next)
    this.setData({ fieldConfig: next })
  },

  toggleFilterPanel() {
    this.setData({
      filterPanelOpen: !this.data.filterPanelOpen,
      sortOpen: false,
      fieldPanelOpen: false
    })
  },

  selectFilterOption(event) {
    const { type, value } = event.currentTarget.dataset
    const updates = {}
    if (type === 'section') {
      updates.activeSection = value || ALL_SECTION
    }
    if (type === 'director') {
      updates.activeDirector = value || ALL_DIRECTOR
    }
    this.setData(updates, () => this.renderFilms())
  },

  onDoubanChanging(event) {
    this.setData({ doubanMin: event.detail.value })
  },

  onDoubanChange(event) {
    this.setData({ doubanMin: event.detail.value }, () => this.renderFilms())
  },

  onImdbChanging(event) {
    this.setData({ imdbMin: event.detail.value })
  },

  onImdbChange(event) {
    this.setData({ imdbMin: event.detail.value }, () => this.renderFilms())
  },

  resetFilters() {
    this.setData({
      activeSection: ALL_SECTION,
      activeDirector: ALL_DIRECTOR,
      doubanMin: 0,
      imdbMin: 0
    }, () => this.renderFilms())
  },

  handleFilterTap(event) {
    const { key, type } = event.currentTarget.dataset
    if (type === 'sort') {
      this.setData({ sortOpen: !this.data.sortOpen, fieldPanelOpen: false, filterPanelOpen: false })
      return
    }

    this.setData({
      activeInterest: key,
      sortOpen: false,
      filterPanelOpen: false
    }, () => {
      this.saveViewState()
      this.renderFilms()
    })
  },

  selectSort(event) {
    const sort = event.currentTarget.dataset.sort
    const groupHeaderFallback = defaultGroupHeader(sort)
    const viewState = Object.assign({}, app.globalData.filmViewState || {}, {
      viewVersion: VIEW_STATE_VERSION,
      activeSort: sort,
      collapsedGroups: {},
      groupHeaderFallback
    })
    app.globalData.filmViewState = viewState
    writeStoredViewState(viewState)
    this.setData({
      activeSort: sort,
      sortFilterLabel: sortFilterLabel(sort),
      sortOpen: false,
      groupHeaderFallback,
      collapsedGroups: {}
    }, () => this.renderFilms())
  },

  toggleGroup(event) {
    const key = event.currentTarget.dataset.key
    const collapsedGroups = Object.assign({}, this.data.collapsedGroups)
    collapsedGroups[key] = !collapsedGroups[key]
    this.setData({ collapsedGroups }, () => {
      this.saveViewState()
      this.renderFilms()
    })
  },

  saveViewState(extra) {
    const viewState = Object.assign({}, app.globalData.filmViewState || {}, {
      viewVersion: VIEW_STATE_VERSION,
      activeSort: this.data.activeSort,
      activeInterest: this.data.activeInterest,
      collapsedGroups: this.data.collapsedGroups,
      groupHeaderFallback: this.data.groupHeaderFallback
    }, extra || {})
    app.globalData.filmViewState = viewState
    writeStoredViewState(viewState)
  },

  markFilm(event) {
    const { filmId, groupIndex, filmIndex, mark, currentMark } = event.currentTarget.dataset
    const nextMark = currentMark === mark ? null : mark
    const nextInterest = getInterestMeta(nextMark)
    const needsFullRender = this.data.activeSort === 'interest' || (
      this.data.activeInterest !== 'all' &&
      this.data.activeInterest !== 'selected'
    )
    const updates = {}
    const groupPath = `filmGroups[${groupIndex}].items[${filmIndex}]`
    const filmDataIndex = this.data.films.findIndex(film => film.id === filmId)

    updates[`${groupPath}.mark`] = nextInterest.key
    updates[`${groupPath}.interest`] = nextInterest
    if (filmDataIndex >= 0) {
      updates[`films[${filmDataIndex}].mark`] = nextInterest.key
      updates[`films[${filmDataIndex}].interest`] = nextInterest
    }

    this.setData(updates, () => {
      app.setFilmMark(filmId, nextMark)
      if (needsFullRender) {
        this.renderFilms()
      }
    })
  },

  noop() {},

  openFilm(event) {
    wx.navigateTo({
      url: `/pages/film/detail?id=${event.currentTarget.dataset.id}`
    })
  },

  buildFilmRenderSignature(overrides) {
    const source = Object.assign({
      activeSort: this.data.activeSort,
      activeInterest: this.data.activeInterest,
      collapsedGroups: this.data.collapsedGroups,
      query: this.data.query,
      activeSection: this.data.activeSection,
      activeDirector: this.data.activeDirector,
      doubanMin: this.data.doubanMin,
      imdbMin: this.data.imdbMin
    }, overrides || {})
    const meta = app.globalData.festivalMeta || {}
    return [
      app.globalData.festivalDataVersion || '',
      meta.name || '',
      (app.globalData.films || []).length,
      source.activeSort,
      source.activeInterest,
      source.query,
      source.activeSection,
      source.activeDirector,
      source.doubanMin,
      source.imdbMin,
      objectSignature(source.collapsedGroups),
      objectSignature(app.getFilmMarks()),
      listSignature(app.getSelectedScreeningIds())
    ].join('\n')
  },

  renderFilms() {
    const marks = app.getFilmMarks()
    const selectedIds = app.getSelectedScreeningIds()
    const keyword = this.data.query.trim().toLowerCase()
    const active = this.data.activeInterest

    const films = app.globalData.films.map((film, index) => {
      const interest = getInterestMeta(marks[film.id] || film.defaultInterest)
      const mark = interest.key
      const selectedCount = film.screenings.filter(screening => selectedIds.includes(screening.id)).length
      const cnTitle = filmDisplayTitle(film)
      const enTitle = filmEnTitle(film)
      const director = filmDirector(film)
      const section = filmSection(film)
      const country = filmCountry(film)
      const year = filmYear(film)
      const genre = filmGenre(film)
      const runtime = filmRuntimeMinutes(film)
      const posterSrc = filmPosterSrc(film)
      const ratingSummary = filmRatingSummary(film)
      const searchText = [
        cnTitle,
        enTitle,
        director,
        section,
        country,
        year,
        genre,
        film.screenings.map(screening => `${screening.cinema} ${screening.hall}`).join(' ')
      ].join(' ').toLowerCase()

      return {
        ...film,
        cnTitle,
        enTitle,
        originalIndex: index,
        mark,
        interest,
        selectedCount,
        screeningCount: film.screenings.length,
        runtime,
        posterSrc,
        hasPoster: !!posterSrc,
        directorLine: director,
        sectionLabel: section,
        ratingSummary,
        runtimeLabel: runtimeText(runtime),
        metaText: compactMeta([filmCoreMeta(film), director]),
        searchText
      }
    }).filter(film => {
      const matchesKeyword = !keyword || film.searchText.includes(keyword)
      const matchesInterest = active === 'all' || (active === 'marked' && film.interest.rank > 0)
      return matchesKeyword && matchesInterest
    })

    // 基于关键词/标星后的集合，计算可选的单元、导演（带数量）
    const sectionOptions = [{ key: ALL_SECTION, label: '全部单元', count: films.length }]
      .concat(countOptions(films, film => film.sectionLabel || '其他'))
    const directorFilterOptions = [{ key: ALL_DIRECTOR, label: '全部导演', count: films.length }]
      .concat(countOptions(films, film => film.directorLine || '未知导演'))
    const activeSection = sectionOptions.some(item => item.key === this.data.activeSection) ? this.data.activeSection : ALL_SECTION
    const activeDirector = directorFilterOptions.some(item => item.key === this.data.activeDirector) ? this.data.activeDirector : ALL_DIRECTOR
    const doubanMin = this.data.doubanMin || 0
    const imdbMin = this.data.imdbMin || 0

    const filteredFilms = films.filter(film => {
      if (activeSection !== ALL_SECTION && (film.sectionLabel || '其他') !== activeSection) {
        return false
      }
      if (activeDirector !== ALL_DIRECTOR && (film.directorLine || '未知导演') !== activeDirector) {
        return false
      }
      if (doubanMin > 0 && ratingValue(film.doubanRating) < doubanMin) {
        return false
      }
      if (imdbMin > 0 && ratingValue(film.imdbRating) < imdbMin) {
        return false
      }
      return true
    })

    const filterActiveCount =
      (activeSection !== ALL_SECTION ? 1 : 0) +
      (activeDirector !== ALL_DIRECTOR ? 1 : 0) +
      (doubanMin > 0 ? 1 : 0) +
      (imdbMin > 0 ? 1 : 0)

    const markPicked = (options, activeValue) => options.map(item => Object.assign({}, item, {
      picked: item.key === activeValue
    }))

    const filmGroups = buildFilmGroups(filteredFilms, this.data.activeSort, this.data.collapsedGroups)
    const firstHeader = filmGroups[0] && filmGroups[0].headerText

    const groupHeaderFallback = firstHeader || defaultGroupHeader(this.data.activeSort)
    this._lastFilmRenderSignature = this.buildFilmRenderSignature({ activeSection, activeDirector })

    this.setData({
      festivalName: app.globalData.festivalMeta.name,
      markOptions: app.globalData.interestOptions,
      films: filteredFilms,
      filmGroups,
      groupHeaderFallback,
      grouped: this.data.activeSort !== DEFAULT_SORT,
      sortFilterLabel: sortFilterLabel(this.data.activeSort),
      stats: collectStats(app.globalData.films, selectedIds, marks),
      activeSection,
      activeDirector,
      sectionOptions: markPicked(sectionOptions, activeSection),
      directorFilterOptions: markPicked(directorFilterOptions, activeDirector),
      filterActiveCount
    }, () => {
      this.saveViewState({ groupHeaderFallback })
    })
  }
})
