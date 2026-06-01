const {
  buildScreenings,
  compactMeta,
  filmCoreMeta,
  filmDirector,
  filmDisplayTitle,
  filmEnTitle,
  filmGenre,
  filmPosterSrc,
  filmRatingItems,
  filmRuntimeMinutes,
  filmSection,
  formatRatingCount,
  findConflicts,
  findFilm,
  getInterestMeta,
  runtimeText
} = require('../../utils/schedule')

const app = getApp()

function infoRow(label, value) {
  const text = String(value || '').trim()
  return text ? { label, value: text } : null
}

function buildInfoRows(film) {
  const rows = [
    infoRow('豆瓣评分人数', formatRatingCount(film.doubanRatingCount))
  ]
  return rows.filter(Boolean)
}

function popularityText(count) {
  const value = Number(count) || 0
  return value > 0 ? `${value} 人已排` : ''
}

Page({
  data: {
    filmId: '',
    film: null,
    screenings: [],
    markOptions: app.globalData.interestOptions,
    starSlots: [
      { n: 1, mark: 'want1' },
      { n: 2, mark: 'want2' },
      { n: 3, mark: 'want3' }
    ]
  },

  onLoad(options) {
    this.setData({ filmId: options.id || '' })
  },

  onShow() {
    this.renderFilm()
    app.whenFestivalDataReady().then(() => {
      this.renderFilm()
    })
  },

  markFilm(event) {
    const { mark, currentMark } = event.currentTarget.dataset
    app.setFilmMark(this.data.filmId, currentMark === mark ? null : mark)
    this.renderFilm()
  },

  toggleScreening(event) {
    const id = event.currentTarget.dataset.id
    const marks = app.getFilmMarks()
    const allScreenings = buildScreenings(app.globalData.films, marks)
    const selectedIds = app.getSelectedScreeningIds()
    const screening = allScreenings.find(item => item.id === id)
    const conflicts = screening ? findConflicts(screening, selectedIds.filter(item => item !== id), allScreenings) : []
    app.globalData.smartPlanMeta = null
    const added = app.toggleScreening(id)

    wx.showToast({
      title: added && conflicts.length ? '已加入，有冲突' : added ? '已加入排片' : '已移除',
      icon: 'none',
      duration: 1000
    })
    this.renderFilm()
    app.syncScreeningPopularity({
      queryScreeningIds: app.getSelectedScreeningIds().concat(id)
    }).then(() => this.renderFilm())
  },

  renderFilm() {
    const renderToken = (this._renderToken || 0) + 1
    this._renderToken = renderToken
    const rawFilm = findFilm(app.globalData.films, this.data.filmId)
    if (!rawFilm) {
      return
    }

    const marks = app.getFilmMarks()
    const selectedIds = app.getSelectedScreeningIds()
    const interest = getInterestMeta(marks[rawFilm.id] || rawFilm.defaultInterest)
    const mark = interest.key
    const interestWord = ['未标记', '待定', '想看', '必看'][interest.rank] || '未标记'
    const runtime = filmRuntimeMinutes(rawFilm)
    const section = filmSection(rawFilm)
    const genre = filmGenre(rawFilm)
    const ratingItems = filmRatingItems(rawFilm)
    const infoRows = buildInfoRows(rawFilm)
    const posterSrc = filmPosterSrc(rawFilm)
    const popularityMap = app.getScreeningPopularityMap((rawFilm.screenings || []).map(screening => screening.id))
    const allScreenings = buildScreenings(app.globalData.films, marks)
    const screenings = allScreenings
      .filter(screening => screening.filmId === rawFilm.id)
      .map(screening => {
        const conflicts = findConflicts(screening, selectedIds.filter(id => id !== screening.id), allScreenings)
        return {
          ...screening,
          selected: selectedIds.includes(screening.id),
          conflict: conflicts.length > 0,
          conflictText: conflicts.map(item => `${item.timeRange} ${item.cnTitle}`).join(' / '),
          popularityCount: popularityMap[screening.id] || 0,
          popularityText: popularityText(popularityMap[screening.id])
        }
      })

    this.setData({
      markOptions: app.globalData.interestOptions,
      film: {
        ...rawFilm,
        cnTitle: filmDisplayTitle(rawFilm),
        enTitle: filmEnTitle(rawFilm),
        mark,
        interest,
        interestWord,
        runtime,
        runtimeLabel: runtimeText(runtime),
        posterSrc,
        hasPoster: !!posterSrc,
        primaryMeta: compactMeta([filmCoreMeta(rawFilm), filmDirector(rawFilm)]),
        directorLine: filmDirector(rawFilm),
        recommendation: rawFilm.recommendation || rawFilm.doulistComment || '',
        detailTags: [section, genre].filter(Boolean),
        ratingItems,
        infoRows,
        hasInfoRows: infoRows.length > 0,
        selectedCount: screenings.filter(screening => screening.selected).length
      },
      screenings
    })
    this.refreshPopularity(screenings.map(screening => screening.id), renderToken)
  },

  refreshPopularity(screeningIds, renderToken) {
    app.fetchScreeningPopularity(screeningIds).then(counts => {
      if (this._renderToken !== renderToken) {
        return
      }
      const updates = {}
      ;(this.data.screenings || []).forEach((screening, index) => {
        const count = counts[screening.id] || 0
        if (screening.popularityCount !== count) {
          updates[`screenings[${index}].popularityCount`] = count
          updates[`screenings[${index}].popularityText`] = popularityText(count)
        }
      })
      if (Object.keys(updates).length) {
        this.setData(updates)
      }
    })
  }
})
