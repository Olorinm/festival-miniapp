const {
  buildScreenings
} = require('../../utils/schedule')
const { getNavMetrics } = require('../../utils/nav')
const { createPopularityPoster } = require('../../utils/popularity-poster')
const { enableShareMenu, shareAppMessage, shareTimeline } = require('../../utils/share')
const { setTabBarHidden, syncTabBar } = require('../../utils/tab-bar')

const app = getApp()

const INITIAL_LIMIT = 20
const STEP = 10
const MAX_LIMIT = 50
const QUERY_CHUNK_SIZE = 200
const REFRESH_INTERVAL = 5 * 60 * 1000
const APP_SHARE_NAME = '赶场愉快'
const EXPORT_LIMIT_OPTIONS = [
  { limit: 10, label: '前 10' },
  { limit: 20, label: '前 20' },
  { limit: 50, label: '前 50' }
]
const RANK_TABS = [
  { key: 'screening', label: '场次榜' },
  { key: 'film', label: '影片榜' },
  { key: 'cinema', label: '影院榜' }
]

function festivalDisplayName() {
  const meta = app.globalData.festivalMeta || {}
  return meta.displayName || meta.name || '电影节'
}

function formatVenueLine(item) {
  return [item.cinema, item.hall]
    .map(part => String(part || '').trim())
    .filter(Boolean)
    .join(' · ')
}

function formatRankUpdatedAt(value) {
  const date = value ? new Date(value) : null
  if (!date || Number.isNaN(date.getTime())) {
    return '刚刚更新'
  }
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${hour}:${minute} 更新`
}

function chunk(items, size) {
  const chunks = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

function compareText(a, b) {
  return String(a || '').localeCompare(String(b || ''), 'zh-Hans-CN')
}

function compact(parts) {
  return parts.map(part => String(part || '').trim()).filter(Boolean).join(' · ')
}

function runtimeLabel(minutes) {
  const value = Math.round(Number(minutes) || 0)
  if (value <= 0) return ''
  return `${Math.floor(value / 60)}小时${value % 60}分`
}

function rankifyRows(rows, limit) {
  const ranked = rows
    .filter(item => item.popularityCount > 0)
    .sort((a, b) => {
      return b.popularityCount - a.popularityCount ||
        compareText(a.sortDate, b.sortDate) ||
        (a.sortMinutes || 0) - (b.sortMinutes || 0) ||
        compareText(a.cnTitle, b.cnTitle)
    })
    .slice(0, MAX_LIMIT)

  const max = ranked[0] && ranked[0].popularityCount || 1
  return ranked.slice(0, limit).map((item, index) => Object.assign({}, item, {
    rank: index + 1,
    isTop: index < 3,
    barWidth: Math.max(4, Math.round((item.popularityCount / max) * 100))
  }))
}

function buildScreeningRankRows(screenings, counts, limit) {
  const countMap = counts && typeof counts === 'object' ? counts : {}
  return rankifyRows((Array.isArray(screenings) ? screenings : [])
    .map(screening => Object.assign({}, screening, {
      popularityCount: Number(countMap[screening.id]) || 0,
      venueLine: formatVenueLine(screening),
      primaryMeta: compact([screening.dayLabel, screening.timeRange]),
      secondaryMeta: formatVenueLine(screening),
      posterText: String(screening.cnTitle || '').replace(/\s*\(4K\)/, ''),
      sortDate: screening.date,
      sortMinutes: screening.startMinutes,
      rankType: 'screening'
    })), limit)
}

function buildFilmRankRows(screenings, counts, limit) {
  const countMap = counts && typeof counts === 'object' ? counts : {}
  const grouped = {}
  ;(Array.isArray(screenings) ? screenings : []).forEach(screening => {
    const count = Number(countMap[screening.id]) || 0
    if (count <= 0) return
    const key = screening.filmId || screening.cnTitle
    if (!grouped[key]) {
      grouped[key] = {
        id: `film:${key}`,
        filmId: screening.filmId,
        cnTitle: screening.cnTitle,
        posterSrc: screening.posterSrc,
        posterCanvasSrc: screening.posterCanvasSrc,
        posterCanvasSrcs: screening.posterCanvasSrcs,
        posterText: String(screening.cnTitle || '').replace(/\s*\(4K\)/, ''),
        popularityCount: 0,
        screeningCount: 0,
        sortDate: screening.date,
        sortMinutes: screening.startMinutes,
        primaryMeta: compact([screening.year, screening.country, runtimeLabel(screening.runtime)]),
        secondaryMeta: '',
        rankType: 'film'
      }
    }
    const row = grouped[key]
    row.popularityCount += count
    row.screeningCount += 1
    row.sortDate = compareText(screening.date, row.sortDate) < 0 ? screening.date : row.sortDate
    row.sortMinutes = Math.min(row.sortMinutes || screening.startMinutes || 0, screening.startMinutes || 0)
  })

  Object.keys(grouped).forEach(key => {
    const row = grouped[key]
    row.secondaryMeta = `${row.screeningCount} 个热门场次`
  })
  return rankifyRows(Object.keys(grouped).map(key => grouped[key]), limit)
}

function buildCinemaRankRows(screenings, counts, limit) {
  const countMap = counts && typeof counts === 'object' ? counts : {}
  const grouped = {}
  ;(Array.isArray(screenings) ? screenings : []).forEach(screening => {
    const count = Number(countMap[screening.id]) || 0
    if (count <= 0) return
    const cinema = String(screening.cinema || '').trim() || '未标注影院'
    if (!grouped[cinema]) {
      grouped[cinema] = {
        id: `cinema:${cinema}`,
        cnTitle: cinema,
        posterText: '影院',
        popularityCount: 0,
        screeningCount: 0,
        filmTitles: [],
        filmTitleMap: {},
        sortDate: screening.date,
        sortMinutes: screening.startMinutes,
        primaryMeta: '',
        secondaryMeta: '',
        hidePoster: true,
        rankType: 'cinema'
      }
    }
    const row = grouped[cinema]
    row.popularityCount += count
    row.screeningCount += 1
    if (screening.cnTitle && !row.filmTitleMap[screening.cnTitle]) {
      row.filmTitleMap[screening.cnTitle] = true
      row.filmTitles.push(screening.cnTitle)
    }
    row.sortDate = compareText(screening.date, row.sortDate) < 0 ? screening.date : row.sortDate
    row.sortMinutes = Math.min(row.sortMinutes || screening.startMinutes || 0, screening.startMinutes || 0)
  })

  Object.keys(grouped).forEach(key => {
    const row = grouped[key]
    row.primaryMeta = `${row.screeningCount} 个热门场次`
    row.secondaryMeta = row.filmTitles.slice(0, 3).join('、')
  })
  return rankifyRows(Object.keys(grouped).map(key => grouped[key]), limit)
}

function buildRankRowsByType(type, screenings, counts, limit) {
  if (type === 'film') return buildFilmRankRows(screenings, counts, limit)
  if (type === 'cinema') return buildCinemaRankRows(screenings, counts, limit)
  return buildScreeningRankRows(screenings, counts, limit)
}

function rankLabel(type) {
  const tab = RANK_TABS.find(item => item.key === type)
  return tab ? tab.label : '场次榜'
}

Page({
  data: {
    festivalName: festivalDisplayName(),
    metaText: `来自「${APP_SHARE_NAME}」用户的真实选场数据`,
    rankTabs: RANK_TABS,
    activeRankType: 'screening',
    activeRankLabel: '场次榜',
    rows: [],
    loading: false,
    error: '',
    updatedAtText: '刚刚更新',
    visibleLimit: INITIAL_LIMIT,
    canLoadMore: false,
    exportSheetOpen: false,
    exportLimit: 20,
    exportLimitOptions: EXPORT_LIMIT_OPTIONS,
    exportPosterWidth: 750,
    exportPosterHeight: 1200,
    exporting: false,
    navTop: 0,
    navHeight: 44,
    navRight: 120,
    navTotalHeight: 88,
    contentTop: 92,
    showScrollTop: false
  },

  noop() {},

  onLoad() {
    this.setNavMetrics()
  },

  onShow() {
    syncTabBar(this, 3)
    enableShareMenu()
    this.setNavMetrics()
    this.ensureFreshFestivalData().then(() => {
      this.setData({
        festivalName: festivalDisplayName()
      })
      this.renderRows()
      const shouldRefresh = !this._lastRefreshAt ||
        Date.now() - this._lastRefreshAt > REFRESH_INTERVAL ||
        !this.data.rows.length
      if (shouldRefresh) {
        this.refreshPopularity()
      }
    }).catch(error => {
      console.warn('[popularity] festival data refresh failed', error)
      this.renderRows()
    })
  },

  onReachBottom() {
    this.loadMore()
  },

  onPageScroll(event) {
    const showScrollTop = Number(event.scrollTop) > 520
    if (showScrollTop !== this.data.showScrollTop) {
      this.setData({ showScrollTop })
    }
  },

  onShareAppMessage() {
    return shareAppMessage({
      title: '热度榜',
      path: '/pages/popularity/index'
    })
  },

  onShareTimeline() {
    return shareTimeline({
      title: '热度榜',
      path: '/pages/popularity/index'
    })
  },

  setNavMetrics() {
    this.setData(getNavMetrics())
  },

  scrollToTop() {
    wx.pageScrollTo({
      scrollTop: 0,
      duration: 260
    })
  },

  ensureFreshFestivalData() {
    return app.whenFestivalDataReady().then(() => {
      if (app.ensureFestivalDataFresh) {
        return app.ensureFestivalDataFresh()
      }
      return null
    })
  },

  allScreenings() {
    return buildScreenings(app.globalData.films, app.getFilmMarks())
  },

  renderRows() {
    const screenings = this.allScreenings()
    const source = app.globalData.screeningPopularity || {}
    const counts = screenings.reduce((map, item) => {
      map[item.id] = source[item.id] || 0
      return map
    }, {})
    const activeRankType = this.data.activeRankType || 'screening'
    const rankRows = buildRankRowsByType(activeRankType, screenings, counts, MAX_LIMIT)
    const visibleLimit = Math.min(this.data.visibleLimit || INITIAL_LIMIT, MAX_LIMIT)
    this.setData({
      rows: rankRows.slice(0, visibleLimit),
      canLoadMore: visibleLimit < rankRows.length,
      activeRankLabel: rankLabel(activeRankType),
      metaText: `来自「${APP_SHARE_NAME}」用户的真实选场数据 · ${this.data.updatedAtText}`
    })
  },

  buildRankRows(limit, counts) {
    const screenings = this.allScreenings()
    const source = counts || app.globalData.screeningPopularity || {}
    const popularityCounts = screenings.reduce((map, item) => {
      map[item.id] = source[item.id] || 0
      return map
    }, {})
    return buildRankRowsByType(this.data.activeRankType || 'screening', screenings, popularityCounts, limit)
  },

  switchRankTab(event) {
    const type = event.currentTarget.dataset.type || 'screening'
    if (type === this.data.activeRankType) {
      return
    }
    this.setData({
      activeRankType: type,
      activeRankLabel: rankLabel(type),
      visibleLimit: INITIAL_LIMIT
    }, () => {
      this.renderRows()
      wx.pageScrollTo({
        scrollTop: 0,
        duration: 180
      })
    })
  },

  refreshPopularity() {
    if (this.data.loading) {
      return
    }
    const screenings = this.allScreenings()
    const ids = screenings.map(item => item.id)
    if (!ids.length) {
      this.renderRows()
      return
    }

    const token = Date.now()
    this._refreshToken = token
    this.setData({
      loading: true,
      error: ''
    })

    const chunks = chunk(ids, QUERY_CHUNK_SIZE)
    const run = chunks.reduce((promise, idsChunk) => {
      return promise.then(() => app.fetchScreeningPopularity(idsChunk, { force: true }))
        .then(() => {
          if (this._refreshToken === token) {
            this.renderRows()
          }
        })
    }, Promise.resolve())

    run.then(() => {
      if (this._refreshToken !== token) {
        return
      }
      this._lastRefreshAt = Date.now()
      const updatedAtText = formatRankUpdatedAt(Date.now())
      this.setData({
        loading: false,
        updatedAtText,
        metaText: `来自「${APP_SHARE_NAME}」用户的真实选场数据 · ${updatedAtText}`
      })
      this.renderRows()
    }).catch(error => {
      if (this._refreshToken !== token) {
        return
      }
      console.warn('[popularity] refresh failed', error)
      this.setData({
        loading: false,
        error: '热度更新失败，可以稍后重试'
      })
      this.renderRows()
    })
  },

  loadMore() {
    if (!this.data.canLoadMore || this.data.loading) {
      return
    }
    this.setData({
      visibleLimit: Math.min(MAX_LIMIT, (this.data.visibleLimit || INITIAL_LIMIT) + STEP)
    }, () => this.renderRows())
  },

  openFilm(event) {
    const filmId = event.currentTarget.dataset.filmId
    if (!filmId) {
      return
    }
    wx.navigateTo({
      url: `/pages/film/detail?id=${encodeURIComponent(filmId)}`
    })
  },

  refreshTap() {
    this.setData({
      visibleLimit: INITIAL_LIMIT
    }, () => {
      this.ensureFreshFestivalData()
        .then(() => this.refreshPopularity())
        .catch(error => {
          console.warn('[popularity] refresh data failed', error)
          this.refreshPopularity()
        })
    })
  },

  openExportSheet() {
    const rows = this.buildRankRows(10)
    if (!rows.length) {
      wx.showToast({ title: '暂无热度数据', icon: 'none' })
      return
    }
    setTabBarHidden(this, true)
    this.setData({ exportSheetOpen: true })
  },

  closeExportSheet() {
    this.setData({ exportSheetOpen: false }, () => setTabBarHidden(this, false))
  },

  selectExportLimit(event) {
    const limit = Number(event.currentTarget.dataset.limit) || 20
    this.setData({ exportLimit: limit })
  },

  confirmExport() {
    if (this.data.exporting) {
      return
    }
    const limit = Number(this.data.exportLimit) || 20
    this.setData({ exportSheetOpen: false }, () => {
      setTabBarHidden(this, false)
      this.generatePopularityPoster(limit)
    })
  },

  generatePopularityPoster(limit) {
    if (this.data.exporting) {
      return
    }
    wx.showLoading({ title: '生成中' })
    this.setData({
      exporting: true,
      exportPosterWidth: 750,
      exportPosterHeight: 1200
    })

    const finish = () => {
      this.setData({ exporting: false })
      wx.hideLoading()
    }

    const run = () => {
      const screenings = this.allScreenings()
      const ids = screenings.map(item => item.id)
      if (!ids.length) {
        throw new Error('empty_screenings')
      }
      return app.fetchScreeningPopularity(ids)
        .then(counts => {
          const rows = this.buildRankRows(limit, counts)
            .slice(0, limit)
            .map(item => Object.assign({}, item, {
              posterSrcs: item.posterCanvasSrcs || [item.posterCanvasSrc || item.posterSrc || '']
            }))
          if (!rows.length) {
            throw new Error('empty_popularity')
          }

          return new Promise((resolve, reject) => {
            this.createSelectorQuery()
              .select('#popularityPoster')
              .fields({ node: true, size: true })
              .exec(res => {
                const canvas = res && res[0] && res[0].node
                if (!canvas) {
                  reject(new Error('canvas_not_found'))
                  return
                }
                createPopularityPoster(canvas, {
                  festivalName: this.data.festivalName,
                  rankLabel: this.data.activeRankLabel,
                  metaText: this.data.metaText,
                  rows
                }).then(poster => {
                  this.setData({
                    exportPosterWidth: poster.width,
                    exportPosterHeight: poster.height
                  })
                  wx.canvasToTempFilePath({
                    canvas,
                    width: poster.width,
                    height: poster.height,
                    destWidth: Math.round(poster.width * (poster.pixelRatio || 1)),
                    destHeight: Math.round(poster.height * (poster.pixelRatio || 1)),
                    fileType: 'png',
                    quality: 1,
                    success: file => resolve(file.tempFilePath),
                    fail: reject
                  }, this)
                }).catch(reject)
              })
          })
        })
    }

    this.ensureFreshFestivalData()
      .then(run)
      .then(tempFilePath => {
        finish()
        wx.previewImage({
          urls: [tempFilePath],
          current: tempFilePath
        })
      })
      .catch(error => {
        console.warn('[popularity] export failed', error)
        finish()
        wx.showToast({ title: '导出失败', icon: 'none' })
      })
  }
})
