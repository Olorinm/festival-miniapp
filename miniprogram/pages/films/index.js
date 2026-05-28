const {
  collectStats,
  compactMeta,
  getInterestMeta,
  runtimeText
} = require('../../utils/schedule')
const { getNavMetrics } = require('../../utils/nav')

const app = getApp()

const DEFAULT_SORT = 'default'
const DEFAULT_GROUP = 'section'
const VIEW_STATE_KEY = 'festival.filmViewState'
const VIEW_STATE_VERSION = 2

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

function buildFilmGroups(films, sortKey, collapsedGroups, renderVersion) {
  const sorted = sortFilms(films, sortKey)
  if (sortKey === DEFAULT_SORT) {
    return [{
      key: DEFAULT_SORT,
      renderKey: `${DEFAULT_SORT}:${renderVersion}`,
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
        renderKey: `${info.key}:${renderVersion}`,
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

function keepTogether(text) {
  return String(text || '').split('').join('\u2060')
}

const initialViewState = normalizeViewState(readStoredViewState())
const initialActiveSort = isKnownSort(initialViewState.activeSort) ? initialViewState.activeSort : DEFAULT_GROUP

function normalizeInterestFilter(filter) {
  return filter === 'marked' ? 'marked' : 'all'
}

const initialActiveInterest = normalizeInterestFilter(initialViewState.activeInterest)

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
    renderVersion: 0,
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
    markOptions: app.globalData.interestOptions
  },

  onLoad() {
    this.setNavMetrics()
    this.refreshFilmsAfterVisible()
  },

  onReady() {
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
    const renderVersion = (this.data.renderVersion || 0) + 1
    this.setData({
      activeSort,
      activeInterest,
      collapsedGroups: viewState.collapsedGroups || this.data.collapsedGroups || {},
      groupHeaderFallback: viewState.groupHeaderFallback || this.data.groupHeaderFallback || defaultGroupHeader(activeSort),
      sortFilterLabel: sortFilterLabel(activeSort),
      renderVersion
    }, () => this.renderFilms())
    if (this._visibleRenderTimer) {
      clearTimeout(this._visibleRenderTimer)
    }
    this._visibleRenderTimer = setTimeout(() => {
      const nextVersion = (this.data.renderVersion || 0) + 1
      this.setData({ renderVersion: nextVersion }, () => this.renderFilms())
    }, 80)
  },

  onHide() {
    if (this._visibleRenderTimer) {
      clearTimeout(this._visibleRenderTimer)
      this._visibleRenderTimer = null
    }
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
    app.globalData.pendingOpenSmartPlan = true
    wx.switchTab({ url: '/pages/schedule/index' })
  },

  handleFilterTap(event) {
    const { key, type } = event.currentTarget.dataset
    if (type === 'sort') {
      this.setData({ sortOpen: !this.data.sortOpen })
      return
    }

    this.setData({
      activeInterest: key,
      sortOpen: false
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

  renderFilms() {
    const marks = app.getFilmMarks()
    const selectedIds = app.getSelectedScreeningIds()
    const keyword = this.data.query.trim().toLowerCase()
    const active = this.data.activeInterest

    const films = app.globalData.films.map((film, index) => {
      const interest = getInterestMeta(marks[film.id] || film.defaultInterest)
      const mark = interest.key
      const selectedCount = film.screenings.filter(screening => selectedIds.includes(screening.id)).length
      const searchText = [
        film.cnTitle,
        film.enTitle,
        film.director,
        film.section,
        film.country,
        film.year,
        film.screenings.map(screening => `${screening.cinema} ${screening.hall}`).join(' ')
      ].join(' ').toLowerCase()

      return {
        ...film,
        originalIndex: index,
        mark,
        interest,
        selectedCount,
        screeningCount: film.screenings.length,
        runtimeLabel: runtimeText(film.runtime),
        metaText: compactMeta([film.section, film.year, film.director, keepTogether(runtimeText(film.runtime))]),
        searchText
      }
    }).filter(film => {
      const matchesKeyword = !keyword || film.searchText.includes(keyword)
      const matchesInterest = active === 'all' || (active === 'marked' && film.interest.rank > 0)
      return matchesKeyword && matchesInterest
    })

    const filmGroups = buildFilmGroups(films, this.data.activeSort, this.data.collapsedGroups, this.data.renderVersion)
    const firstHeader = filmGroups[0] && filmGroups[0].headerText

    const groupHeaderFallback = firstHeader || defaultGroupHeader(this.data.activeSort)

    this.setData({
      festivalName: app.globalData.festivalMeta.name,
      markOptions: app.globalData.interestOptions,
      films,
      filmGroups,
      groupHeaderFallback,
      grouped: this.data.activeSort !== DEFAULT_SORT,
      sortFilterLabel: sortFilterLabel(this.data.activeSort),
      stats: collectStats(app.globalData.films, selectedIds, marks)
    }, () => {
      this.saveViewState({ groupHeaderFallback })
    })
  }
})
