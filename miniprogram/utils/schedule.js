// @paired-with web/lib/schedule.cjs
// @platform-divergence: getCommuteRoutes reads app globalData; miniapp poster canvas asset handling; slash card meta
const { interestOptions: fallbackInterestOptions } = require('../data/festival-lite')
const {
  buildPlan,
  byScreeningTime,
  findConflicts,
  groupByDay,
  resolveScreeningTiming,
  toMinutes
} = require('./generated/schedule-core')

const MAX_WALKING_COMMUTE_MIN = 75
const MAX_WALKING_ROUTE_RATIO = 3

const noInterest = {
  key: 'none',
  label: '',
  shortLabel: '',
  rank: 0,
  tone: 'gray'
}

function getInterestMeta(key) {
  if (!key || key === 'none' || key === 'pending') {
    return noInterest
  }
  let app = null
  try {
    app = typeof getApp === 'function' ? getApp() : null
  } catch (error) {}
  const interestOptions = app && app.globalData && Array.isArray(app.globalData.interestOptions)
    ? app.globalData.interestOptions
    : fallbackInterestOptions
  return interestOptions.find(item => item.key === key) || noInterest
}

function markIdsForFilm(film) {
  const ids = [film && film.id]
    .concat(Array.isArray(film && film.markAliasFilmIds) ? film.markAliasFilmIds : [])
    .filter(Boolean)
  return Array.from(new Set(ids))
}

function getFilmMark(film, filmMarks) {
  const marks = filmMarks || {}
  const markedId = markIdsForFilm(film).find(id => marks[id])
  return markedId ? marks[markedId] : (film && film.defaultInterest)
}

function getFilmInterest(film, filmMarks) {
  return getInterestMeta(getFilmMark(film, filmMarks))
}

function resolveScreeningInterest(film, filmById, filmMarks) {
  const ids = [film.id].concat(Array.isArray(film.memberFilmIds) ? film.memberFilmIds : [])
  return ids.reduce((best, id) => {
    const sourceFilm = id === film.id ? film : filmById.get(id)
    const interest = getFilmInterest(sourceFilm, filmMarks)
    return interest.rank > best.rank ? interest : best
  }, noInterest)
}

function routeKey(from, to) {
  return `${from}__${to}`
}

function commutePairKey(a, b) {
  return [a, b].sort().join('__')
}

function validRoute(route) {
  return route && !route.error ? route : null
}

function getCommuteRoutes() {
  try {
    const app = typeof getApp === 'function' ? getApp() : null
    return app && app.globalData && app.globalData.commuteRoutes || {}
  } catch (error) {
    return {}
  }
}

function usableWalkingRoute(route, directDistance) {
  const walking = validRoute(route)
  if (!walking) {
    return null
  }
  const directKm = numericValue(directDistance)
  const walkingKm = numericValue(walking.distanceKm)
  const walkingMin = numericValue(walking.durationMin)
  if (walkingMin > MAX_WALKING_COMMUTE_MIN) {
    return null
  }
  if (directKm && walkingKm && walkingKm / directKm > MAX_WALKING_ROUTE_RATIO) {
    return null
  }
  return walking
}

function formatCommuteDistance(value) {
  const distance = numericValue(value)
  if (!distance) {
    return ''
  }
  if (distance < 10) {
    return `${distance.toFixed(1).replace(/\.0$/, '')}km`
  }
  return `${Math.round(distance)}km`
}

function formatCommuteDuration(value) {
  const minutes = Math.round(numericValue(value))
  return minutes > 0 ? `${minutes}分` : ''
}

function makeCommuteMode(key, label, route) {
  const duration = formatCommuteDuration(route && route.durationMin)
  if (!duration) {
    return null
  }
  const icons = {
    transit: '🚌',
    cycling: '🚲',
    walking: '🚶'
  }
  return {
    key,
    label,
    durationMin: Math.round(numericValue(route.durationMin)),
    distanceKm: numericValue(route.distanceKm),
    text: `${icons[key] || ''}${duration}`
  }
}

function commuteBetween(fromScreening, toScreening) {
  if (!fromScreening || !toScreening || fromScreening.date !== toScreening.date) {
    return null
  }

  const from = firstText(fromScreening.cinema)
  const to = firstText(toScreening.cinema)
  if (!from || !to) {
    return null
  }

  if (from === to) {
    return {
      kind: 'same',
      from,
      to,
      distanceText: '同影院',
      modes: []
    }
  }

  const commuteRoutes = getCommuteRoutes()
  const directDistance = numericValue(commuteRoutes.direct && commuteRoutes.direct[commutePairKey(from, to)])
  const transit = validRoute(commuteRoutes.transit && commuteRoutes.transit[routeKey(from, to)])
  const walking = usableWalkingRoute(commuteRoutes.walking && commuteRoutes.walking[commutePairKey(from, to)], directDistance)
  const cycling = validRoute(commuteRoutes.cycling && commuteRoutes.cycling[commutePairKey(from, to)])
  const modes = walking
    ? [makeCommuteMode('transit', '公交', transit), makeCommuteMode('walking', '步行', walking)].filter(Boolean)
    : [makeCommuteMode('transit', '公交', transit), makeCommuteMode('cycling', '骑车', cycling)].filter(Boolean)

  if (!modes.length) {
    return null
  }

  const distanceText = formatCommuteDistance(directDistance)

  return {
    kind: walking ? 'near' : 'far',
    from,
    to,
    distanceText,
    modes
  }
}

function buildScreenings(films, marks) {
  const filmMarks = marks || {}
  const filmById = new Map(films.map(film => [film.id, film]))
  return films
    .reduce((list, film) => {
      const memberFilms = Array.isArray(film.memberFilmIds)
        ? film.memberFilmIds.map(id => filmById.get(id)).filter(Boolean)
        : []
      const interest = resolveScreeningInterest(film, filmById, filmMarks)
      const interestKey = interest.key
      const rows = film.screenings.map(screening => {
        const ticket = sanitizeTicketText(screening.ticket)
        const ticketPlan = sanitizeTicketText(screening.ticketPlan || ticket)
        const runtime = filmRuntimeMinutes(film)
        const timing = resolveScreeningTiming(screening, runtime)
        return {
          filmId: film.id,
          cnTitle: filmDisplayTitle(film),
          enTitle: filmEnTitle(film),
          section: filmSection(film),
          director: filmDirector(film),
          country: filmCountry(film),
          year: filmYear(film),
          runtime,
          posterSrc: filmPosterSrc(film),
          posterCanvasSrc: filmPosterCanvasSrc(film),
          posterCanvasSrcs: filmPosterCanvasSrcs(film),
          cardMeta: slashMeta([filmCoreMeta(film), filmDirector(film)]),
          sectionLabel: filmSection(film),
          ratingSummary: filmRatingSummary(film),
          synopsis: filmSynopsis(film),
          doubanRating: film.doubanRating,
          imdbRating: film.imdbRating,
          memberFilmIds: Array.isArray(film.memberFilmIds) ? film.memberFilmIds : [],
          memberCnTitles: Array.isArray(film.memberCnTitles) ? film.memberCnTitles : [],
          programType: film.programType || '',
          interestKey,
          interest,
          timeRange: screening.end ? `${screening.start}-${screening.end}` : screening.start,
          startMinutes: timing.startMinutes,
          endMinutes: timing.endMinutes,
          duration: timing.duration,
          durationKnown: timing.durationKnown,
          hasUnknownDuration: !timing.durationKnown,
          screenMeta: filmScreeningMeta(film),
          searchText: [
            filmDisplayTitle(film),
            filmEnTitle(film),
            filmDirector(film),
            filmSection(film),
            filmCountry(film),
            filmGenre(film),
            filmSynopsis(film),
            film.memberCnTitles,
            memberFilms.map(member => [
              filmDisplayTitle(member),
              filmEnTitle(member),
              filmDirector(member),
              filmSection(member),
              filmGenre(member)
            ].join(' ')),
            screening.cinema,
            screening.hall
          ].join(' ').toLowerCase(),
          ...screening,
          ticket,
          ticketPlan
        }
      })
      return list.concat(rows)
    }, [])
    .sort(byScreeningTime)
}

function compactMeta(items) {
  return items
    .map(item => String(item || '').trim())
    .filter(Boolean)
    .join(' · ')
}

function slashMeta(items) {
  return items
    .map(item => String(item || '').trim().replace(/\s+·\s+/g, ' / '))
    .filter(Boolean)
    .join(' / ')
}

function firstText(items) {
  const list = Array.isArray(items) ? items : [items]
  const value = list.find(item => String(item || '').trim())
  return value === undefined ? '' : String(value).trim()
}

function sanitizeTicketText(value) {
  const text = firstText(value)
  if (!text) {
    return ''
  }

  return text
    .split(/\s*[·,，、|｜/]\s*/)
    .map(item => item.trim())
    .filter(item => item && item !== '测试场次')
    .join(' · ')
}

function filmDisplayTitle(film) {
  return firstText([film.cnTitle, film.officialTitle, film.title, film.doubanTitle])
}

function filmEnTitle(film) {
  return firstText([film.enTitle, film.titleEn, film.originalTitle])
}

function filmSection(film) {
  return firstText([film.section, film.unit])
}

function filmDirector(film) {
  return firstText([film.director, film.directors])
}

function filmCast(film) {
  return firstText([film.cast, film.actors, film.actor, film.starring])
}

function filmImdbId(film) {
  const imdbId = firstText([film.imdbId, film.imdbID])
  if (imdbId) {
    return imdbId
  }
  const matched = firstText(film.imdbUrl).match(/\/title\/(tt\d+)/)
  return matched ? matched[1] : ''
}

function filmAwards(film) {
  return firstText([film.awards, film.awardText])
}

function filmSynopsis(film) {
  return firstText([film && film.synopsis, film && film.tmdbOverview, film && film.overview])
}

function filmCountry(film) {
  return firstText([film.country, film.region, film.countries])
}

function filmGenre(film) {
  if (Array.isArray(film.genre)) {
    return film.genre.filter(Boolean).join(' ')
  }
  if (Array.isArray(film.genres)) {
    return film.genres.filter(Boolean).join(' ')
  }
  return firstText([film.genre, film.genres])
}

function filmYear(film) {
  const year = firstText([film.year, film.doubanYear, film.excelYear])
  return year ? String(year) : ''
}

function numericValue(value) {
  if (value === null || value === undefined || value === '') {
    return 0
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }
  const matched = String(value).replace(/,/g, '').match(/\d+(?:\.\d+)?/)
  return matched ? Number(matched[0]) : 0
}

function filmRuntimeMinutes(film) {
  const value = numericValue(firstText([film.runtimeMinutes, film.runtime, film.duration]))
  return value > 0 ? Math.round(value) : 0
}

function isDefaultPosterSrc(src) {
  return /\/pics\/subject\/movie_(large|mid|small)\.jpg(?:\?|$)/.test(String(src || ''))
}

function isIgnoredLocalPosterSrc(src) {
  return /^\/?(?:miniprogram\/)?assets\/posters\//.test(String(src || '').trim())
}

function normalizeLocalAssetSrc(src) {
  const value = firstText(src)
  if (!value) {
    return ''
  }
  return `/${value.replace(/^\/?miniprogram\//, '').replace(/^\/+/, '')}`
}

function uniqueTextValues(items) {
  const seen = {}
  return (items || [])
    .map(firstText)
    .filter(Boolean)
    .filter(item => {
      if (seen[item]) {
        return false
      }
      seen[item] = true
      return true
    })
}

function filmPosterSrc(film) {
  const remoteCandidates = [
    film.posterCloudFileId,
    film.posterUrl,
    film.coverUrl,
    film.cover,
    film.poster
  ].map(firstText).filter(Boolean)
  const remote = remoteCandidates.find(src => !isDefaultPosterSrc(src))
  if (remote) {
    return remote
  }

  const local = firstText(film.posterAssetPath)
  return isIgnoredLocalPosterSrc(local) ? '' : local
}

function filmPosterCanvasSrc(film) {
  return filmPosterCanvasSrcs(film)[0] || ''
}

function filmPosterCanvasSrcs(film) {
  return uniqueTextValues([
    film.posterCloudFileId,
    normalizeLocalAssetSrc(film.posterAssetPath),
    film.posterUrl,
    film.coverUrl,
    film.cover,
    film.poster
  ])
}

function formatRating(value) {
  const rating = numericValue(value)
  return rating > 0 ? rating.toFixed(1).replace(/\.0$/, '') : ''
}

function formatRatingCount(value) {
  const count = Math.round(numericValue(value))
  if (count <= 0) {
    return ''
  }
  if (count >= 10000) {
    const rounded = count >= 100000 ? Math.round(count / 10000) : Math.round(count / 1000) / 10
    return `${rounded}万人`
  }
  return `${count}人`
}

function filmRatingItems(film) {
  const douban = formatRating(film.doubanRating)
  const imdb = formatRating(film.imdbRating)
  const items = []
  if (douban) {
    items.push({
      key: 'douban',
      label: '豆瓣',
      value: douban,
      extra: formatRatingCount(film.doubanRatingCount)
    })
  }
  if (imdb) {
    items.push({
      key: 'imdb',
      label: 'IMDb',
      value: imdb,
      extra: formatRatingCount(film.imdbRatingCount)
    })
  }
  return items
}

function filmRatingSummary(film) {
  return filmRatingItems(film)
    .map(item => `${item.label} ${item.value}`)
    .join(' · ')
}

function filmCoreMeta(film) {
  return compactMeta([filmYear(film), filmCountry(film), runtimeText(filmRuntimeMinutes(film))])
}

function filmScreeningMeta(film) {
  return compactMeta([filmSection(film), filmYear(film), runtimeText(filmRuntimeMinutes(film))])
}

function findFilm(films, filmId) {
  return films.find(film => film.id === filmId)
}

function findScreening(screenings, screeningId) {
  return screenings.find(screening => screening.id === screeningId)
}

function isRelatedScreeningForFilm(screening, film) {
  if (!screening || !film) {
    return false
  }
  return screening.filmId === film.id ||
    (film.mappedProgramFilmId && screening.filmId === film.mappedProgramFilmId) ||
    (Array.isArray(screening.memberFilmIds) && screening.memberFilmIds.includes(film.id))
}

function findFilmScreenings(film, allScreenings) {
  return (allScreenings || []).filter(screening => isRelatedScreeningForFilm(screening, film))
}

function collectStats(films, selectedIds, marks) {
  const allScreenings = buildScreenings(films, marks)
  const selected = allScreenings.filter(screening => selectedIds.includes(screening.id))
  const selectedFilmIds = {}
  selected.forEach(screening => {
    selectedFilmIds[screening.filmId] = true
  })
  return {
    filmCount: films.length,
    selectedCount: selected.length,
    selectedFilmCount: Object.keys(selectedFilmIds).length,
    totalPrice: selected.reduce((sum, item) => sum + (Number(item.price) || 0), 0)
  }
}

function runtimeText(runtime) {
  const minutes = Math.round(numericValue(runtime))
  if (!minutes) {
    return ''
  }
  const hour = Math.floor(minutes / 60)
  const minute = minutes % 60
  return hour ? `${hour}小时${minute ? `${minute}分` : ''}` : `${minute}分`
}

module.exports = {
  buildPlan,
  buildScreenings,
  collectStats,
  commuteBetween,
  compactMeta,
  filmAwards,
  filmCast,
  filmCoreMeta,
  filmCountry,
  filmDirector,
  filmDisplayTitle,
  filmEnTitle,
  filmGenre,
  filmImdbId,
  filmPosterSrc,
  filmRatingItems,
  filmRatingSummary,
  filmRuntimeMinutes,
  filmScreeningMeta,
  filmSection,
  filmSynopsis,
  filmYear,
  findConflicts,
  findFilmScreenings,
  findFilm,
  findScreening,
  firstText,
  formatRatingCount,
  getFilmInterest,
  getFilmMark,
  getInterestMeta,
  groupByDay,
  slashMeta,
  runtimeText
}
