const {
  buildScreenings,
  findConflicts,
  findScreening,
  groupByDay
} = require('../../utils/schedule')
const {
  buildSmartPlan,
  mergePreferenceOverrides,
  parsePreferenceInstruction,
  SMART_MODE_MARKED,
  SMART_MODE_PICK
} = require('../../utils/smart-plan')
const { getNavMetrics } = require('../../utils/nav')

const app = getApp()
const ALL_DAYS = 'all'
const SCOPE_WANTED = 'wanted'
const SCOPE_ALL = 'all'
const ALL_DIRECTORS = 'all'
const ALL_CINEMAS = 'all'
const EMPTY_WANTED_TITLE = '请先到「选电影」里挑选你喜欢的电影'
const EMPTY_WANTED_HINT = '也可以看完整时间表，或者让 AI 先帮你排一版'
const PROGRESSIVE_RENDER_THRESHOLD = 180
const PROGRESSIVE_GROUP_BATCH_SIZE = 1
const PROGRESSIVE_GROUP_DELAY = 40

function buildWantedScreenings(marks) {
  return buildScreenings(app.globalData.films, marks).filter(screening => screening.interest.rank > 0)
}

function buildAllScreenings(marks) {
  return buildScreenings(app.globalData.films, marks)
}

function getSmartToastTitle(instruction, source) {
  if (!instruction) {
    return '已生成排片'
  }
  return source === 'ai' ? 'AI已解析' : '本地排片'
}

function matchesKeyword(screening, keyword) {
  if (!keyword) {
    return true
  }

  return [
    screening.searchText,
    screening.country,
    screening.year,
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

function shortCinemaName(cinema) {
  return String(cinema || '')
    .replace(/（.*?）/g, '')
    .replace(/\(.*?\)/g, '')
    .slice(0, 8)
}

function detectSmartMode(instruction, hasMarkedFilms) {
  if (!hasMarkedFilms) {
    return SMART_MODE_PICK
  }

  const text = String(instruction || '')
  return /帮我选|推荐|选几部|挑几部|随便|不知道看什么|没选|没有标|补几部|补一些|也可以帮我选|帮我挑/.test(text)
    ? SMART_MODE_PICK
    : SMART_MODE_MARKED
}

function normalizeSmartMode(mode, instruction, hasMarkedFilms) {
  if (mode === SMART_MODE_PICK) {
    return SMART_MODE_PICK
  }
  if (mode === SMART_MODE_MARKED && hasMarkedFilms) {
    return SMART_MODE_MARKED
  }
  return detectSmartMode(instruction, hasMarkedFilms)
}

function cleanFilmIntro(film) {
  return String(film.summary || film.synopsis || film.intro || film.logline || '')
    .replace(/^\d{4}\s*BJIFF片单导入\s*·?\s*/i, '')
    .replace(/共\s*\d+\s*场/g, '')
    .replace(/\s*·\s*$/g, '')
    .trim()
    .slice(0, 48)
}

function buildSmartFilmCatalog(films) {
  return (films || []).map(film => {
    const item = {
      id: film.id,
      title: film.cnTitle || film.enTitle || '',
      year: film.year || '',
      section: film.section || ''
    }
    if (film.enTitle) {
      item.enTitle = film.enTitle
    }
    if (film.director) {
      item.director = film.director
    }
    if (film.country) {
      item.country = film.country
    }
    if (film.runtime) {
      item.runtime = film.runtime
    }
    const intro = cleanFilmIntro(film)
    if (intro && intro !== String(film.year || '')) {
      item.intro = intro
    }
    return item
  })
}

function normalizeFilmWeights(weights) {
  if (!weights || typeof weights !== 'object') {
    return {}
  }

  return Object.keys(weights).reduce((map, id) => {
    const value = Number(weights[id])
    if (id && Number.isFinite(value) && value > 0) {
      map[id] = Math.max(0, Math.min(100, Math.round(value)))
    }
    return map
  }, {})
}

function normalizeSelectedFilmIds(ids) {
  if (!Array.isArray(ids)) {
    return []
  }

  const seen = {}
  return ids
    .map(id => String(id || '').trim())
    .filter(Boolean)
    .filter(id => {
      if (seen[id]) {
        return false
      }
      seen[id] = true
      return true
    })
    .slice(0, 80)
}

Page({
  data: {
    festivalName: app.globalData.festivalMeta.name,
    query: '',
    activeScope: SCOPE_WANTED,
    activeFilter: '',
    activeDay: '',
    activeDirector: ALL_DIRECTORS,
    activeCinema: ALL_CINEMAS,
    filterChips: [],
    filterOptions: [],
    dayTabs: [],
    screeningCount: 0,
    screeningGroups: [],
    collapsedDays: {},
    showDayHeaders: false,
    emptyTitle: EMPTY_WANTED_TITLE,
    emptyHint: '',
    emptyShowActions: false,
    smartSheetOpen: false,
    smartInstruction: '',
    smartInputFocus: false,
    smartPlanning: false,
    smartPrimaryLabel: 'AI 直接排片',
    navTop: 0,
    navHeight: 44,
    navRight: 120,
    navTotalHeight: 88,
    contentTop: 92
  },

  onLoad() {
    this.setNavMetrics()
    this.resetInitialScope()
  },

  onUnload() {
    this.clearDeferredGroupRender()
  },

  onShow() {
    this.setNavMetrics()
    if (!this._hasEnteredSchedule) {
      this._hasEnteredSchedule = true
      this.resetInitialScope()
    }
    this.renderSchedule()
    app.whenFestivalDataReady().then(() => {
      this.renderSchedule()
    })
    if (app.globalData.pendingOpenSmartPlan) {
      app.globalData.pendingOpenSmartPlan = false
      setTimeout(() => this.openSmartPlan(), 0)
    }
  },

  setNavMetrics() {
    this.setData(getNavMetrics())
  },

  resetInitialScope() {
    this.setData({
      activeScope: SCOPE_WANTED,
      activeFilter: '',
      activeDay: ALL_DAYS,
      activeDirector: ALL_DIRECTORS,
      activeCinema: ALL_CINEMAS,
      collapsedDays: {}
    })
  },

  tapFilter(event) {
    const { type, value } = event.currentTarget.dataset
    if (type === 'scope') {
      this.setData({
        activeScope: value === SCOPE_ALL ? SCOPE_ALL : SCOPE_WANTED,
        activeFilter: '',
        activeDay: ALL_DAYS,
        activeDirector: ALL_DIRECTORS,
        activeCinema: ALL_CINEMAS,
        collapsedDays: {}
      }, () => this.renderSchedule())
      return
    }

    this.setData({
      activeFilter: this.data.activeFilter === type ? '' : type
    }, () => this.renderSchedule())
  },

  selectFilterOption(event) {
    const { type, value } = event.currentTarget.dataset
    const updates = { activeFilter: '' }
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
    this.setData(updates, () => this.renderSchedule())
  },

  goFilms() {
    wx.switchTab({ url: '/pages/films/index' })
  },

  showAllScreenings() {
    this.setData({
      activeScope: SCOPE_ALL,
      activeFilter: '',
      activeDay: ALL_DAYS,
      activeDirector: ALL_DIRECTORS,
      activeCinema: ALL_CINEMAS,
      collapsedDays: {}
    }, () => this.renderSchedule())
  },

  toggleDayGroup(event) {
    const date = event.currentTarget.dataset.day
    const collapsedDays = Object.assign({}, this.data.collapsedDays)
    collapsedDays[date] = !collapsedDays[date]
    this.setData({ collapsedDays }, () => this.renderSchedule())
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
    const sameFilmSelectedIds = allScreenings
      .filter(item => item.filmId === screening.filmId && selectedIds.includes(item.id))
      .map(item => item.id)
    const nextSelectedIds = selected
      ? selectedIds.filter(item => item !== id)
      : selectedIds.filter(item => !sameFilmSelectedIds.includes(item)).concat(id)
    const conflicts = selected
      ? []
      : findConflicts(screening, nextSelectedIds.filter(item => item !== id), allScreenings)
    const swapped = !selected && sameFilmSelectedIds.length > 0

    app.globalData.smartPlanMeta = null
    app.setSelectedScreeningIds(nextSelectedIds)
    wx.showToast({
      title: selected
        ? '已移除'
        : swapped && conflicts.length
          ? '已换场，时间重叠'
          : swapped
            ? '已换到这场'
            : conflicts.length
              ? '已加入，时间重叠'
              : '已加入排片',
      icon: 'none',
      duration: 1000
    })
    this.renderSchedule()
  },

  openSmartPlan() {
    const hasMarkedFilms = buildWantedScreenings(app.getFilmMarks()).length > 0
    this.setData({
      smartSheetOpen: true,
      smartInputFocus: false,
      smartPrimaryLabel: this.data.smartInstruction.trim()
        ? 'AI 解析并排片'
        : hasMarkedFilms
          ? 'AI 直接排片'
          : 'AI 选片并排片'
    })
  },

  closeSmartPlan() {
    if (this.data.smartPlanning) {
      return
    }
    this.setData({ smartSheetOpen: false, smartInputFocus: false })
  },

  noop() {},

  focusSmartInput() {
    this.setData({ smartInputFocus: true })
  },

  blurSmartInput() {
    this.setData({ smartInputFocus: false })
  },

  inputSmartInstruction(event) {
    const value = event.detail.value || ''
    const hasMarkedFilms = buildWantedScreenings(app.getFilmMarks()).length > 0
    this.setData({
      smartInstruction: value,
      smartPrimaryLabel: value.trim()
        ? 'AI 解析并排片'
        : hasMarkedFilms
          ? 'AI 直接排片'
          : 'AI 选片并排片'
    })
  },

  onSearchInput(event) {
    this.setData({ query: event.detail.value || '' }, () => this.renderSchedule())
  },

  parseWithAI(instruction, localParsed, context) {
    if (!instruction || !wx.cloud || !wx.cloud.callFunction) {
      return Promise.resolve(Object.assign({ source: instruction ? 'fallback' : 'script' }, localParsed))
    }

    return new Promise(resolve => {
      wx.cloud.callFunction({
        name: 'parsePreference',
        data: {
          instruction,
          hasMarkedFilms: !!(context && context.hasMarkedFilms),
          films: context && context.films ? context.films : []
        },
        success: res => {
          const result = res && res.result
          if (!result || !result.preferences) {
            console.warn('[smart-plan] AI解析失败，使用本地规则', result || res)
            resolve(Object.assign({ source: 'fallback' }, localParsed))
            return
          }

          console.info('[smart-plan] 偏好解析结果', {
            source: result.source === 'ai' ? 'ai' : 'fallback',
            labels: result.labels || [],
            preferences: result.preferences || {}
          })
          resolve({
            source: result.source === 'ai' ? 'ai' : 'fallback',
            mode: result.mode,
            selectedFilmIds: normalizeSelectedFilmIds(result.selectedFilmIds),
            filmWeights: normalizeFilmWeights(result.filmWeights),
            preferences: mergePreferenceOverrides(localParsed.preferences, result.preferences),
            labels: Array.isArray(result.labels) && result.labels.length ? result.labels : localParsed.labels
          })
        },
        fail: error => {
          console.warn('[smart-plan] AI云函数调用失败，使用本地规则', error)
          resolve(Object.assign({ source: 'fallback' }, localParsed))
        }
      })
    })
  },

  runSmartPlan() {
    if (this.data.smartPlanning) {
      return
    }

    const marks = app.getFilmMarks()
    const allScreenings = buildAllScreenings(marks)
    const wantedScreenings = allScreenings.filter(screening => screening.interest.rank > 0)
    if (!allScreenings.length) {
      wx.showToast({ title: '暂无场次', icon: 'none' })
      return
    }

    this.setData({ smartPlanning: true })
    const instruction = this.data.smartInstruction.trim()
    const hasMarkedFilms = wantedScreenings.length > 0
    const aiInstruction = instruction || (hasMarkedFilms ? '' : '请根据片单帮我选一组值得看的电影并排片')
    const localMode = detectSmartMode(instruction, hasMarkedFilms)
    const localParsed = Object.assign(parsePreferenceInstruction(instruction), {
      mode: localMode,
      selectedFilmIds: [],
      filmWeights: {}
    })

    this.parseWithAI(aiInstruction, localParsed, {
      hasMarkedFilms,
      films: buildSmartFilmCatalog(app.globalData.films)
    }).then(parsed => {
      const mode = normalizeSmartMode(parsed.mode, instruction, hasMarkedFilms)
      const candidateScreenings = mode === SMART_MODE_PICK ? allScreenings : wantedScreenings
      const result = buildSmartPlan(candidateScreenings, parsed.preferences, {
        mode,
        selectedFilmIds: parsed.selectedFilmIds,
        filmWeights: parsed.filmWeights
      })

      this.setData({ smartPlanning: false })
      if (!result.selectedIds.length) {
        wx.showToast({ title: mode === SMART_MODE_PICK ? '没有可排场次' : '先标星', icon: 'none' })
        return
      }

      app.globalData.smartPlanMeta = {
        mode,
        source: parsed.source,
        labels: parsed.labels || [],
        preferences: result.preferences
      }
      app.setSelectedScreeningIds(result.selectedIds)
      this.setData({ smartSheetOpen: false }, () => {
        this.renderSchedule()
        wx.showToast({
          title: mode === SMART_MODE_PICK && parsed.source === 'ai' ? 'AI已选片' : getSmartToastTitle(instruction, parsed.source),
          icon: 'none',
          duration: 900
        })
        setTimeout(() => {
          wx.switchTab({ url: '/pages/plan/index' })
        }, 260)
      })
    })
  },

  openFilm(event) {
    wx.navigateTo({
      url: `/pages/film/detail?id=${event.currentTarget.dataset.filmId}`
    })
  },

  renderSchedule() {
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
    const activeDirector = directorOptions.some(item => item.key === this.data.activeDirector) ? this.data.activeDirector : ALL_DIRECTORS
    const activeCinema = cinemaOptions.some(item => item.key === this.data.activeCinema) ? this.data.activeCinema : ALL_CINEMAS
    const byDirector = activeDirector === ALL_DIRECTORS
      ? scopeScreenings
      : scopeScreenings.filter(screening => (screening.director || '未知导演') === activeDirector)
    const byCinema = activeCinema === ALL_CINEMAS
      ? byDirector
      : byDirector.filter(screening => (screening.cinema || '未知影院') === activeCinema)
    const grouped = groupByDay(byCinema)
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
      ? byCinema
      : byCinema.filter(screening => screening.date === activeDay)
    const selectedScreeningById = allScreenings.reduce((map, screening) => {
      if (selectedIds.includes(screening.id)) {
        map[screening.id] = screening
      }
      return map
    }, {})
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
          : selectedIds.filter(id => {
            const selectedScreening = selectedScreeningById[id]
            return selectedScreening && selectedScreening.filmId !== screening.filmId
          })
        const selectedConflicts = findConflicts(screening, conflictBaseIds, allScreenings)
        const conflict = selected && selectedConflicts.length > 0
        const pickConflict = !selected && selectedConflicts.length > 0
        return {
          id: screening.id,
          filmId: screening.filmId,
          cnTitle: screening.cnTitle,
          screenMeta: screening.screenMeta,
          cinema: screening.cinema,
          hall: screening.hall,
          date: screening.date,
          dayLabel: screening.dayLabel,
          start: screening.start,
          end: screening.end,
          price: screening.price,
          ticket: screening.ticket,
          selected,
          filmScheduled,
          interestLabel: screening.interest.label || '未标星',
          interestTone: screening.interest.label ? screening.interest.tone : 'gray',
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
    const activeDayTab = dayTabs.find(day => day.date === activeDay)
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
        active: this.data.activeScope === SCOPE_WANTED,
        dividerAfter: true
      },
      {
        key: 'filter:date',
        type: 'date',
        value: activeDay,
        label: activeDay === ALL_DAYS ? '日期' : `日期·${(activeDayTab && activeDayTab.dayLabel) || activeDay}`,
        active: activeDay !== ALL_DAYS || this.data.activeFilter === 'date'
      },
      {
        key: 'filter:director',
        type: 'director',
        value: activeDirector,
        label: activeDirector === ALL_DIRECTORS ? '导演' : `导演·${activeDirector}`,
        active: activeDirector !== ALL_DIRECTORS || this.data.activeFilter === 'director'
      },
      {
        key: 'filter:cinema',
        type: 'cinema',
        value: activeCinema,
        label: activeCinema === ALL_CINEMAS ? '影院' : `影院·${shortCinemaName(activeCinema)}`,
        active: activeCinema !== ALL_CINEMAS || this.data.activeFilter === 'cinema'
      }
    ]
    const rawFilterOptions = this.data.activeFilter === 'date'
      ? [{ key: ALL_DAYS, label: '全部日期', count: byCinema.length }].concat(dayTabs.map(day => ({
        key: day.date,
        label: day.dayLabel,
        count: day.count
      })))
      : this.data.activeFilter === 'director'
        ? [{ key: ALL_DIRECTORS, label: '全部导演', count: scopeScreenings.length }].concat(directorOptions)
        : this.data.activeFilter === 'cinema'
          ? [{ key: ALL_CINEMAS, label: '全部影院', count: scopeScreenings.length }].concat(cinemaOptions)
          : []
    const activeFilterValue = this.data.activeFilter === 'date'
      ? activeDay
      : this.data.activeFilter === 'director'
        ? activeDirector
        : this.data.activeFilter === 'cinema'
          ? activeCinema
          : ''
    const filterOptions = rawFilterOptions.map(item => Object.assign({}, item, {
      picked: item.key === activeFilterValue
    }))
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

    this.setData({
      festivalName: app.globalData.festivalMeta.name,
      activeDirector,
      activeCinema,
      activeDay,
      filterChips,
      filterOptions,
      dayTabs,
      screeningCount: screenings.length,
      screeningGroups: initialGroups,
      showDayHeaders,
      emptyTitle,
      emptyHint: emptyShowActions ? EMPTY_WANTED_HINT : '',
      emptyShowActions
    }, () => {
      if (shouldProgressivelyRender && this._renderToken === renderToken) {
        this.queueDeferredGroups(renderToken, screeningGroups, initialGroups.length)
      }
    })
  }
})
