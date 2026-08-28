const {
  buildScreenings,
  findConflicts,
  findScreening,
  groupByDay
} = require('../../utils/schedule')
const { getNavMetrics } = require('../../utils/nav')
const { enableShareMenu, shareAppMessage, shareTimeline } = require('../../utils/share')
const { syncTabBar } = require('../../utils/tab-bar')

const app = getApp()

function festivalDisplayName() {
  const meta = app.globalData.festivalMeta || {}
  return meta.displayName || meta.name || '电影节'
}

const ALL_DAYS = 'all'
const SCOPE_WANTED = 'wanted'
const SCOPE_ALL = 'all'
const ALL_DIRECTORS = 'all'
const ALL_CINEMAS = 'all'
const ALL_SECTIONS = 'all'

function ratingValue(value) {
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? num : 0
}
const EMPTY_WANTED_TITLE = '请先到「选电影」里挑选你喜欢的电影'
const EMPTY_WANTED_HINT = '也可以看完整时间表，或者让 AI 先帮你排一版'
const PROGRESSIVE_RENDER_THRESHOLD = 180
const PROGRESSIVE_GROUP_BATCH_SIZE = 1
const PROGRESSIVE_GROUP_DELAY = 40

const VIEW_STATE_KEY = 'festival.scheduleViewState'
const VIEW_STATE_VERSION = 1
const FIELD_CONFIG_KEY = 'festival.scheduleFieldConfig'
const FIELD_OPTIONS = [
  { key: 'info', label: '影片信息', desc: '年份 · 导演 · 片长' },
  { key: 'rating', label: '影片评分', desc: '豆瓣 / IMDb 评分' },
  { key: 'synopsis', label: '简介', desc: '剧情简介 / 一句话介绍' },
  { key: 'ticket', label: '特殊场次', desc: '4K修复 · 映后交流等标签' },
  { key: 'popularity', label: '热度情况', desc: '关闭后不显示热度，也停止统计你选择的场次' }
]
const DEFAULT_FIELD_CONFIG = { info: true, rating: false, synopsis: false, ticket: true, popularity: true }

function readFieldConfig() {
  try {
    const stored = wx.getStorageSync(FIELD_CONFIG_KEY)
    if (stored && typeof stored === 'object') {
      return Object.assign({}, DEFAULT_FIELD_CONFIG, stored)
    }
  } catch (error) {}
  return Object.assign({}, DEFAULT_FIELD_CONFIG)
}

function writeFieldConfig(config) {
  try {
    wx.setStorageSync(FIELD_CONFIG_KEY, config)
  } catch (error) {}
}

function screeningIdsFromGroups(groups) {
  return (Array.isArray(groups) ? groups : []).reduce((ids, group) => {
    return ids.concat((group && Array.isArray(group.items) ? group.items : []).map(screening => screening.id).filter(Boolean))
  }, [])
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

function normalizeScope(value) {
  return value === SCOPE_ALL ? SCOPE_ALL : SCOPE_WANTED
}

function normalizeViewState(state) {
  const next = Object.assign({}, state || {})
  if (next.viewVersion !== VIEW_STATE_VERSION) {
    return {
      viewVersion: VIEW_STATE_VERSION,
      activeScope: SCOPE_WANTED,
      activeDay: ALL_DAYS,
      activeDirector: ALL_DIRECTORS,
      activeCinema: ALL_CINEMAS,
      activeSection: ALL_SECTIONS,
      doubanMin: 0,
      imdbMin: 0,
      collapsedDays: {}
    }
  }
  return {
    viewVersion: VIEW_STATE_VERSION,
    activeScope: normalizeScope(next.activeScope),
    activeDay: next.activeDay || ALL_DAYS,
    activeDirector: next.activeDirector || ALL_DIRECTORS,
    activeCinema: next.activeCinema || ALL_CINEMAS,
    activeSection: next.activeSection || ALL_SECTIONS,
    doubanMin: Number(next.doubanMin) || 0,
    imdbMin: Number(next.imdbMin) || 0,
    collapsedDays: next.collapsedDays && typeof next.collapsedDays === 'object' ? next.collapsedDays : {}
  }
}

function buildWantedScreenings(marks) {
  return buildScreenings(app.globalData.films, marks).filter(screening => screening.interest.rank > 0)
}

function buildAllScreenings(marks) {
  return buildScreenings(app.globalData.films, marks)
}

function matchesKeyword(screening, keyword) {
  if (!keyword) {
    return true
  }

  return [
    screening.searchText,
    screening.country,
    screening.year,
    screening.synopsis,
    screening.dayLabel,
    screening.date,
    screening.ticket,
    screening.price
  ].join(' ').toLowerCase().includes(keyword)
}

function compareText(a, b) {
  return String(a || '').localeCompare(String(b || ''), 'zh-Hans-CN')
}

function countOptions(items, getKey, getLabel) {
  const map = {}
  items.forEach(item => {
    const key = getKey(item)
    const label = getLabel ? getLabel(item) : key
    if (!map[key]) {
      map[key] = { key, label, count: 0 }
    }
    map[key].count += 1
  })
  return Object.keys(map)
    .map(key => map[key])
    .sort((a, b) => b.count - a.count || compareText(a.label, b.label))
}

function popularityText(count) {
  const value = Number(count) || 0
  return value > 0 ? `${value} 人已排` : ''
}

const initialViewState = normalizeViewState(readStoredViewState())

Page({
  data: {
    festivalName: festivalDisplayName(),
    query: '',
    dataLoading: true,
    activeScope: initialViewState.activeScope,
    activeDay: initialViewState.activeDay,
    activeDirector: initialViewState.activeDirector,
    activeCinema: initialViewState.activeCinema,
    activeSection: initialViewState.activeSection,
    doubanMin: initialViewState.doubanMin,
    imdbMin: initialViewState.imdbMin,
    filterChips: [],
    filterGroups: [],
    filterActiveCount: 0,
    filterPanelOpen: false,
    dayTabs: [],
    screeningCount: 0,
    screeningGroups: [],
    collapsedDays: initialViewState.collapsedDays,
    showDayHeaders: false,
    hasDayGroups: false,
    allDaysCollapsed: false,
    emptyTitle: EMPTY_WANTED_TITLE,
    emptyHint: '',
    emptyShowActions: false,
    fieldOptions: FIELD_OPTIONS,
    fieldConfig: readFieldConfig(),
    fieldPanelOpen: false,
    navTop: 0,
    navHeight: 44,
    navRight: 120,
    navTotalHeight: 88,
    contentTop: 92,
    showScrollTop: false
  },

  onLoad() {
    this.setNavMetrics()
  },

  onUnload() {
    this.clearDeferredGroupRender()
  },

  onShow() {
    syncTabBar(this, 1)
    enableShareMenu()
    this.setNavMetrics()
    this.restoreViewState()
    this.renderWhenDataReady()
  },

  onPageScroll(event) {
    const showScrollTop = Number(event.scrollTop) > 520
    if (showScrollTop !== this.data.showScrollTop) {
      this.setData({ showScrollTop })
    }
  },

  onShareAppMessage() {
    return shareAppMessage({
      title: '挑场次',
      path: '/pages/schedule/index'
    })
  },

  onShareTimeline() {
    return shareTimeline({
      title: '挑场次',
      path: '/pages/schedule/index'
    })
  },

  setNavMetrics() {
    this.setData(getNavMetrics())
  },

  hasUsableFestivalData() {
    return !!(app.hasUsableFestivalData && app.hasUsableFestivalData())
  },

  showDataLoading() {
    const renderToken = (this._renderToken || 0) + 1
    this._renderToken = renderToken
    this.clearDeferredGroupRender()
    this.setData({
      dataLoading: true,
      dayTabs: [],
      screeningCount: 0,
      screeningGroups: [],
      showDayHeaders: false,
      hasDayGroups: false,
      allDaysCollapsed: false,
      emptyTitle: '片单加载中',
      emptyHint: '',
      emptyShowActions: false
    })
  },

  showDataUnavailable() {
    const renderToken = (this._renderToken || 0) + 1
    this._renderToken = renderToken
    this.clearDeferredGroupRender()
    this.setData({
      dataLoading: false,
      dayTabs: [],
      screeningCount: 0,
      screeningGroups: [],
      showDayHeaders: false,
      hasDayGroups: false,
      allDaysCollapsed: false,
      emptyTitle: '片单加载失败，请稍后重试',
      emptyHint: '',
      emptyShowActions: false
    })
  },

  renderWhenDataReady() {
    const token = (this._dataReadyToken || 0) + 1
    this._dataReadyToken = token
    this._festivalDataLoadResolved = false
    if (this.hasUsableFestivalData()) {
      this._festivalDataLoadResolved = true
      this.setData({ dataLoading: false }, () => this.renderSchedule())
      return
    }

    this.showDataLoading()
    app.whenFestivalDataReady().then(() => {
      if (this._dataReadyToken !== token) {
        return
      }
      this._festivalDataLoadResolved = true
      if (!this.hasUsableFestivalData()) {
        this.showDataUnavailable()
        return
      }
      this.setData({ dataLoading: false }, () => this.renderSchedule())
    }).catch(() => {
      if (this._dataReadyToken === token) {
        this._festivalDataLoadResolved = true
        this.showDataUnavailable()
      }
    })
  },

  scrollToTop() {
    wx.pageScrollTo({
      scrollTop: 0,
      duration: 260
    })
  },

  restoreViewState() {
    const viewState = normalizeViewState(Object.assign({}, readStoredViewState(), app.globalData.scheduleViewState || {}))
    this.setData({
      activeScope: viewState.activeScope,
      activeDay: viewState.activeDay,
      activeDirector: viewState.activeDirector,
      activeCinema: viewState.activeCinema,
      activeSection: viewState.activeSection,
      doubanMin: viewState.doubanMin,
      imdbMin: viewState.imdbMin,
      collapsedDays: viewState.collapsedDays
    })
  },

  persistViewState() {
    const viewState = {
      viewVersion: VIEW_STATE_VERSION,
      activeScope: normalizeScope(this.data.activeScope),
      activeDay: this.data.activeDay || ALL_DAYS,
      activeDirector: this.data.activeDirector || ALL_DIRECTORS,
      activeCinema: this.data.activeCinema || ALL_CINEMAS,
      activeSection: this.data.activeSection || ALL_SECTIONS,
      doubanMin: Number(this.data.doubanMin) || 0,
      imdbMin: Number(this.data.imdbMin) || 0,
      collapsedDays: this.data.collapsedDays || {}
    }
    app.globalData.scheduleViewState = viewState
    writeStoredViewState(viewState)
  },

  tapFilter(event) {
    const { type, value } = event.currentTarget.dataset
    if (type === 'scope') {
      this.setData({
        activeScope: value === SCOPE_ALL ? SCOPE_ALL : SCOPE_WANTED,
        activeDay: ALL_DAYS,
        activeDirector: ALL_DIRECTORS,
        activeCinema: ALL_CINEMAS,
        collapsedDays: {}
      }, () => {
        this.persistViewState()
        this.renderSchedule()
      })
    }
  },

  noop() {},

  toggleFilterPanel() {
    this.setData({
      filterPanelOpen: !this.data.filterPanelOpen,
      fieldPanelOpen: false
    })
  },

  closeFilterPanel() {
    this.setData({ filterPanelOpen: false })
  },

  toggleFieldPanel() {
    this.setData({
      fieldPanelOpen: !this.data.fieldPanelOpen,
      filterPanelOpen: false
    })
  },

  toggleField(event) {
    const key = event.currentTarget.dataset.key
    const next = Object.assign({}, this.data.fieldConfig, {
      [key]: !this.data.fieldConfig[key]
    })
    writeFieldConfig(next)
    this.setData({ fieldConfig: next }, () => {
      if (key === 'popularity') {
        if (next.popularity) {
          app.queueScreeningPopularitySync(0)
        } else {
          app.clearScreeningPopularitySelection()
        }
        this.renderSchedule()
      }
    })
  },

  resetFilters() {
    this.setData({
      activeDay: ALL_DAYS,
      activeDirector: ALL_DIRECTORS,
      activeCinema: ALL_CINEMAS,
      activeSection: ALL_SECTIONS,
      doubanMin: 0,
      imdbMin: 0,
      collapsedDays: {}
    }, () => {
      this.persistViewState()
      this.renderSchedule()
    })
  },

  selectFilterOption(event) {
    const { type, value } = event.currentTarget.dataset
    const updates = {}
    if (type === 'date') {
      updates.activeDay = value || ALL_DAYS
      updates.collapsedDays = {}
    }
    if (type === 'director') {
      updates.activeDirector = value || ALL_DIRECTORS
    }
    if (type === 'cinema') {
      updates.activeCinema = value || ALL_CINEMAS
    }
    if (type === 'section') {
      updates.activeSection = value || ALL_SECTIONS
    }
    this.setData(updates, () => {
      this.persistViewState()
      this.renderSchedule()
    })
  },

  onDoubanChanging(event) {
    this.setData({ doubanMin: event.detail.value })
  },

  onDoubanChange(event) {
    this.setData({ doubanMin: event.detail.value }, () => {
      this.persistViewState()
      this.renderSchedule()
    })
  },

  onImdbChanging(event) {
    this.setData({ imdbMin: event.detail.value })
  },

  onImdbChange(event) {
    this.setData({ imdbMin: event.detail.value }, () => {
      this.persistViewState()
      this.renderSchedule()
    })
  },

  goFilms() {
    wx.switchTab({ url: '/pages/films/index' })
  },

  showAllScreenings() {
    this.setData({
      activeScope: SCOPE_ALL,
      activeDay: ALL_DAYS,
      activeDirector: ALL_DIRECTORS,
      activeCinema: ALL_CINEMAS,
      collapsedDays: {}
    }, () => {
      this.persistViewState()
      this.renderSchedule()
    })
  },

  toggleDayGroup(event) {
    const date = event.currentTarget.dataset.day
    const collapsedDays = Object.assign({}, this.data.collapsedDays)
    collapsedDays[date] = !collapsedDays[date]
    this.setData({ collapsedDays }, () => {
      this.persistViewState()
      this.renderSchedule()
    })
  },

  toggleAllDayGroups() {
    if (!this.data.hasDayGroups) {
      return
    }
    const collapsedDays = Object.assign({}, this.data.collapsedDays)
    if (this.data.allDaysCollapsed) {
      ;(this._lastFullScreeningGroups || this.data.screeningGroups || []).forEach(group => {
        delete collapsedDays[group.date]
      })
    } else {
      ;(this._lastFullScreeningGroups || this.data.screeningGroups || []).forEach(group => {
        collapsedDays[group.date] = true
      })
    }
    this.setData({ collapsedDays }, () => {
      this.persistViewState()
      this.renderSchedule()
    })
  },

  clearDeferredGroupRender() {
    ;(this._screeningGroupTimers || []).forEach(timer => clearTimeout(timer))
    this._screeningGroupTimers = []
  },

  queueDeferredGroups(renderToken, groups, startIndex) {
    if (startIndex >= groups.length) {
      return
    }

    const timer = setTimeout(() => {
      if (this._renderToken !== renderToken) {
        return
      }

      const updates = {}
      const endIndex = Math.min(startIndex + PROGRESSIVE_GROUP_BATCH_SIZE, groups.length)
      groups.slice(startIndex, endIndex).forEach((group, index) => {
        updates[`screeningGroups[${startIndex + index}]`] = group
      })
      this.setData(updates, () => {
        if (this.data.fieldConfig && this.data.fieldConfig.popularity) {
          this.refreshPopularity(screeningIdsFromGroups(groups.slice(startIndex, endIndex)), renderToken)
        }
        this.queueDeferredGroups(renderToken, groups, endIndex)
      })
    }, PROGRESSIVE_GROUP_DELAY)

    this._screeningGroupTimers.push(timer)
  },

  toggleScreening(event) {
    const id = event.currentTarget.dataset.id
    const marks = app.getFilmMarks()
    const allScreenings = buildAllScreenings(marks)
    const selectedIds = app.getSelectedScreeningIds()
    const screening = findScreening(allScreenings, id)
    if (!screening) {
      return
    }

    const selected = selectedIds.includes(id)
    const nextSelectedIds = selected
      ? selectedIds.filter(item => item !== id)
      : selectedIds.concat(id)
    const conflicts = selected
      ? []
      : findConflicts(screening, nextSelectedIds.filter(item => item !== id), allScreenings)

    app.globalData.smartPlanMeta = null
    app.setSelectedScreeningIds(nextSelectedIds)
    wx.showToast({
      title: selected
        ? '已移除'
        : conflicts.length
          ? '已加入，时间重叠'
          : '已加入排片',
      icon: 'none',
      duration: 1000
    })
    this.renderSchedule()
    app.syncScreeningPopularity({
      queryScreeningIds: nextSelectedIds.concat(id)
    }).then(() => this.renderSchedule())
  },

  openSmartPlan() {
    const smartPlan = this.selectComponent('#smartPlan')
    if (smartPlan) {
      smartPlan.open()
    }
  },

  onSearchInput(event) {
    this.setData({ query: event.detail.value || '' }, () => this.renderSchedule())
  },

  openFilm(event) {
    wx.navigateTo({
      url: `/pages/film/detail?id=${event.currentTarget.dataset.filmId}`
    })
  },

  renderSchedule() {
    if (!this.hasUsableFestivalData()) {
      if (this._festivalDataLoadResolved) {
        this.showDataUnavailable()
      } else {
        this.showDataLoading()
      }
      return
    }

    const renderToken = (this._renderToken || 0) + 1
    this._renderToken = renderToken
    this.clearDeferredGroupRender()

    const marks = app.getFilmMarks()
    const selectedIds = app.getSelectedScreeningIds()
    const allScreenings = buildAllScreenings(marks)
    const wantedScreenings = allScreenings.filter(screening => screening.interest.rank > 0)
    const scopeScreenings = this.data.activeScope === SCOPE_ALL ? allScreenings : wantedScreenings
    const keyword = this.data.query.trim().toLowerCase()
    const directorOptions = countOptions(scopeScreenings, screening => screening.director || '未知导演')
    const cinemaOptions = countOptions(scopeScreenings, screening => screening.cinema || '未知影院', screening => screening.cinema || '未知影院')
    const sectionOptions = countOptions(scopeScreenings, screening => screening.sectionLabel || '其他')
    const activeDirector = directorOptions.some(item => item.key === this.data.activeDirector) ? this.data.activeDirector : ALL_DIRECTORS
    const activeCinema = cinemaOptions.some(item => item.key === this.data.activeCinema) ? this.data.activeCinema : ALL_CINEMAS
    const activeSection = sectionOptions.some(item => item.key === this.data.activeSection) ? this.data.activeSection : ALL_SECTIONS
    const doubanMin = this.data.doubanMin || 0
    const imdbMin = this.data.imdbMin || 0
    const byDirector = activeDirector === ALL_DIRECTORS
      ? scopeScreenings
      : scopeScreenings.filter(screening => (screening.director || '未知导演') === activeDirector)
    const byCinema = activeCinema === ALL_CINEMAS
      ? byDirector
      : byDirector.filter(screening => (screening.cinema || '未知影院') === activeCinema)
    const bySection = activeSection === ALL_SECTIONS
      ? byCinema
      : byCinema.filter(screening => (screening.sectionLabel || '其他') === activeSection)
    const byRating = bySection.filter(screening => {
      if (doubanMin > 0 && ratingValue(screening.doubanRating) < doubanMin) {
        return false
      }
      if (imdbMin > 0 && ratingValue(screening.imdbRating) < imdbMin) {
        return false
      }
      return true
    })
    const grouped = groupByDay(byRating)
    const dayTabs = grouped.map(day => ({
      date: day.date,
      dayLabel: day.dayLabel,
      count: day.items.length
    }))
    const activeDay = this.data.activeDay === ALL_DAYS || dayTabs.some(day => day.date === this.data.activeDay)
      ? this.data.activeDay
      : ALL_DAYS
    const showDayHeaders = activeDay === ALL_DAYS
    const visibleScreenings = showDayHeaders
      ? byRating
      : byRating.filter(screening => screening.date === activeDay)
    const popularityMap = app.getScreeningPopularityMap(visibleScreenings.map(screening => screening.id))
    const selectedFilmIds = allScreenings.reduce((map, screening) => {
      if (selectedIds.includes(screening.id)) {
        map[screening.filmId] = true
      }
      return map
    }, {})

    const screenings = visibleScreenings
      .filter(screening => matchesKeyword(screening, keyword))
      .map(screening => {
        const selected = selectedIds.includes(screening.id)
        const filmScheduled = !!selectedFilmIds[screening.filmId]
        const conflictBaseIds = selected
          ? selectedIds.filter(id => id !== screening.id)
          : selectedIds
        const selectedConflicts = findConflicts(screening, conflictBaseIds, allScreenings)
        const conflict = selected && selectedConflicts.length > 0
        const pickConflict = !selected && selectedConflicts.length > 0
        return {
          ...screening,
          selected,
          filmScheduled,
          interestLabel: screening.interest.label || '未标星',
          interestWord: ['未标星', '待定', '想看', '必看'][screening.interest.rank] || '未标星',
          interestStars: screening.interest.shortLabel || '',
          interestTone: screening.interest.label ? screening.interest.tone : 'gray',
          popularityCount: popularityMap[screening.id] || 0,
          popularityText: popularityText(popularityMap[screening.id]),
          conflict,
          pickConflict
        }
      })
    const emptyShowActions = this.data.activeScope === SCOPE_WANTED && !wantedScreenings.length && !keyword
    const emptyTitle = emptyShowActions
      ? EMPTY_WANTED_TITLE
        : scopeScreenings.length
          ? '无结果'
          : '暂无场次'
    const filterChips = [
      {
        key: `scope:${SCOPE_ALL}`,
        type: 'scope',
        value: SCOPE_ALL,
        label: '全部影片',
        active: this.data.activeScope === SCOPE_ALL
      },
      {
        key: `scope:${SCOPE_WANTED}`,
        type: 'scope',
        value: SCOPE_WANTED,
        label: '已标星影片',
        active: this.data.activeScope === SCOPE_WANTED
      }
    ]
    const dateOptions = [{ key: ALL_DAYS, label: '全部日期', count: byCinema.length }].concat(dayTabs.map(day => ({
      key: day.date,
      label: day.dayLabel,
      count: day.count
    })))
    const directorFilterOptions = [{ key: ALL_DIRECTORS, label: '全部导演', count: scopeScreenings.length }].concat(directorOptions)
    const cinemaFilterOptions = [{ key: ALL_CINEMAS, label: '全部影院', count: scopeScreenings.length }].concat(cinemaOptions)
    const sectionFilterOptions = [{ key: ALL_SECTIONS, label: '全部单元', count: scopeScreenings.length }].concat(sectionOptions)
    const markPicked = (options, activeValue) => options.map(item => Object.assign({}, item, {
      picked: item.key === activeValue
    }))
    const filterGroups = [
      { type: 'date', label: '日期', options: markPicked(dateOptions, activeDay) },
      { type: 'cinema', label: '影院', options: markPicked(cinemaFilterOptions, activeCinema) },
      { type: 'section', label: '单元', options: markPicked(sectionFilterOptions, activeSection) },
      { type: 'director', label: '导演', options: markPicked(directorFilterOptions, activeDirector) }
    ]
    const filterActiveCount =
      (activeDay !== ALL_DAYS ? 1 : 0) +
      (activeCinema !== ALL_CINEMAS ? 1 : 0) +
      (activeSection !== ALL_SECTIONS ? 1 : 0) +
      (activeDirector !== ALL_DIRECTORS ? 1 : 0) +
      (doubanMin > 0 ? 1 : 0) +
      (imdbMin > 0 ? 1 : 0)
    const screeningGroups = groupByDay(screenings).map(day => {
      const collapsed = showDayHeaders && !!this.data.collapsedDays[day.date]
      return {
        date: day.date,
        dayLabel: day.dayLabel,
        count: day.items.length,
        items: collapsed ? [] : day.items,
        headerText: day.dayLabel,
        collapsed,
        expanded: !collapsed
      }
    })
    const shouldProgressivelyRender = showDayHeaders && screenings.length > PROGRESSIVE_RENDER_THRESHOLD
    const initialGroups = shouldProgressivelyRender ? screeningGroups.slice(0, 1) : screeningGroups
    const hasDayGroups = showDayHeaders && screeningGroups.length > 0
    const allDaysCollapsed = hasDayGroups && screeningGroups.every(group => this.data.collapsedDays && this.data.collapsedDays[group.date])
    this._lastFullScreeningGroups = screeningGroups

    this.setData({
      festivalName: festivalDisplayName(),
      activeDirector,
      activeCinema,
      activeSection,
      activeDay,
      filterChips,
      filterGroups,
      filterActiveCount,
      dayTabs,
      screeningCount: screenings.length,
      screeningGroups: initialGroups,
      showDayHeaders,
      hasDayGroups,
      allDaysCollapsed,
      emptyTitle,
      emptyHint: emptyShowActions ? EMPTY_WANTED_HINT : '',
      emptyShowActions
    }, () => {
      if (shouldProgressivelyRender && this._renderToken === renderToken) {
        this.queueDeferredGroups(renderToken, screeningGroups, initialGroups.length)
      }
      if (this.data.fieldConfig.popularity) {
        this.refreshPopularity(screeningIdsFromGroups(initialGroups), renderToken)
      }
    })
  },

  refreshPopularity(screeningIds, renderToken) {
    app.fetchScreeningPopularity(screeningIds).then(counts => {
      if (this._renderToken !== renderToken) {
        return
      }
      const updates = {}
      ;(this.data.screeningGroups || []).forEach((group, groupIndex) => {
        ;(group.items || []).forEach((screening, screeningIndex) => {
          const count = counts[screening.id] || 0
          if (screening.popularityCount !== count) {
            updates[`screeningGroups[${groupIndex}].items[${screeningIndex}].popularityCount`] = count
            updates[`screeningGroups[${groupIndex}].items[${screeningIndex}].popularityText`] = popularityText(count)
          }
        })
      })
      if (Object.keys(updates).length) {
        this.setData(updates)
      }
    })
  }
})
