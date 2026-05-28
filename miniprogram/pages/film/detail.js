const {
  buildScreenings,
  compactMeta,
  findConflicts,
  findFilm,
  getInterestMeta,
  runtimeText
} = require('../../utils/schedule')

const app = getApp()

Page({
  data: {
    filmId: '',
    film: null,
    screenings: [],
    markOptions: app.globalData.interestOptions
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
  },

  renderFilm() {
    const rawFilm = findFilm(app.globalData.films, this.data.filmId)
    if (!rawFilm) {
      return
    }

    const marks = app.getFilmMarks()
    const selectedIds = app.getSelectedScreeningIds()
    const interest = getInterestMeta(marks[rawFilm.id] || rawFilm.defaultInterest)
    const mark = interest.key
    const allScreenings = buildScreenings(app.globalData.films, marks)
    const screenings = allScreenings
      .filter(screening => screening.filmId === rawFilm.id)
      .map(screening => {
        const conflicts = findConflicts(screening, selectedIds.filter(id => id !== screening.id), allScreenings)
        return {
          ...screening,
          selected: selectedIds.includes(screening.id),
          conflict: conflicts.length > 0,
          conflictText: conflicts.map(item => `${item.timeRange} ${item.cnTitle}`).join(' / ')
        }
      })

    this.setData({
      markOptions: app.globalData.interestOptions,
      film: {
        ...rawFilm,
        mark,
        interest,
        runtimeLabel: runtimeText(rawFilm.runtime),
        metaLine1: compactMeta([rawFilm.section, rawFilm.year, runtimeText(rawFilm.runtime)]),
        metaLine2: compactMeta([rawFilm.director, rawFilm.country]),
        selectedCount: screenings.filter(screening => screening.selected).length
      },
      screenings
    })
  }
})
