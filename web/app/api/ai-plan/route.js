import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const festival = require('../../../lib/festival')
const schedule = require('../../../lib/schedule.cjs')
const smartPlan = require('../../../lib/smart-plan.cjs')
const ai = require('../../../lib/ai.cjs')
const filmSelection = require('../../../lib/film-selection.cjs')
const { checkRateLimit, rateLimitResponse } = require('../../../lib/rate-limit.cjs')

export const runtime = 'nodejs'
export const maxDuration = 300
export const preferredRegion = 'hkg1'

function uniqueIds(ids) {
  const seen = {}
  return (Array.isArray(ids) ? ids : [])
    .map(id => String(id || '').trim())
    .filter(Boolean)
    .filter(id => {
      if (seen[id]) {
        return false
      }
      seen[id] = true
      return true
    })
}

function markedFilmIds(films, marks) {
  const markMap = marks && typeof marks === 'object' ? marks : {}
  return films
    .filter(film => {
      const meta = schedule.getInterestMeta(markMap[film.id] || film.defaultInterest)
      return meta && meta.rank > 0 && markMap[film.id]
    })
    .map(film => film.id)
}

function normalizeScreeningIds(ids) {
  return uniqueIds(ids)
}

function filmIdsFromScreenings(screenings, screeningIds) {
  const selected = normalizeScreeningIds(screeningIds).reduce((map, id) => {
    map[id] = true
    return map
  }, {})
  return uniqueIds(screenings
    .filter(screening => selected[screening.id])
    .map(screening => screening.filmId))
}

function hasTargetCount(preferences) {
  return !!(preferences && preferences.targetCount)
}

function filmSummary(film) {
  return {
    id: film.id,
    title: schedule.filmDisplayTitle(film),
    enTitle: schedule.filmEnTitle(film),
    section: schedule.filmSection(film),
    director: schedule.filmDirector(film),
    country: schedule.filmCountry(film),
    genre: schedule.filmGenre(film),
    year: Number(schedule.filmYear(film)) || '',
    runtime: schedule.filmRuntimeMinutes(film),
    recommendation: String(film.recommendation || film.logline || '').trim(),
    doubanRating: film.doubanRating,
    doubanRatingCount: film.doubanRatingCount,
    imdbRating: film.imdbRating,
    screeningCount: Array.isArray(film.screenings) ? film.screenings.length : 0
  }
}

function filmSummariesByIds(films, ids) {
  const idSet = uniqueIds(ids).reduce((map, id) => {
    map[id] = true
    return map
  }, {})
  return films
    .filter(film => idSet[film.id])
    .map(filmSummary)
}

function cinemaTermKnown(term, knownCinemas) {
  const value = String(term || '').trim().toLowerCase()
  if (!value) {
    return false
  }
  return (knownCinemas || []).some(cinema => {
    const normalized = String(cinema || '').toLowerCase()
    return normalized === value || normalized.includes(value) || value.includes(normalized)
  })
}

function normalizeCinemaList(items, knownCinemas) {
  return (Array.isArray(items) ? items : [])
    .map(item => String(item || '').trim())
    .filter(Boolean)
    .filter(item => cinemaTermKnown(item, knownCinemas))
}

function knownCinemaNames(screenings) {
  const seen = {}
  return (Array.isArray(screenings) ? screenings : [])
    .map(screening => String(screening && screening.cinema || '').trim())
    .filter(Boolean)
    .filter(cinema => {
      if (seen[cinema]) return false
      seen[cinema] = true
      return true
    })
}

function applyInstructionPreferenceHints(preferences, instruction, knownCinemas) {
  const next = Object.assign({}, preferences || {})
  next.onlyCinemas = normalizeCinemaList(next.onlyCinemas, knownCinemas)
  next.preferredCinemas = normalizeCinemaList(next.preferredCinemas, knownCinemas)
  next.avoidCinemas = normalizeCinemaList(next.avoidCinemas, knownCinemas)
  const cinemaTerms = []
  const cinemaMatch = String(instruction || '').match(/(?:优先|只去|只看|尽量在)\s*([A-Za-z0-9\u4e00-\u9fa5·.\s-]{2,30}?)(?:影院|影城|电影城|IMAX|，|,|。|；|;|$)/)
  if (cinemaMatch) {
    const cinema = cinemaMatch[1].trim()
    if (cinema && cinemaTermKnown(cinema, knownCinemas)) {
      cinemaTerms.push(cinema)
      if (/只去|只看/.test(cinemaMatch[0])) {
        if (!Array.isArray(next.onlyCinemas) || !next.onlyCinemas.length) {
          next.onlyCinemas = [cinema]
        }
      } else if (!Array.isArray(next.preferredCinemas) || !next.preferredCinemas.length) {
        next.preferredCinemas = [cinema]
      }
    }
  }
  return { preferences: next, cinemaTerms }
}

function removeCinemaKeywords(criteria, cinemaTerms) {
  const next = Object.assign({}, criteria || {})
  if (Array.isArray(next.keywords) && Array.isArray(cinemaTerms) && cinemaTerms.length) {
    next.keywords = next.keywords.filter(keyword => !cinemaTerms.some(cinema => keyword === cinema || cinema.includes(keyword) || keyword.includes(cinema)))
  }
  return next
}

function normalizeMarks(marks) {
  if (!marks || typeof marks !== 'object') {
    return {}
  }
  const allowed = {
    want1: true,
    want2: true,
    want3: true
  }
  return Object.keys(marks).reduce((next, filmId) => {
    const id = String(filmId || '').trim()
    const mark = String(marks[filmId] || '').trim()
    if (id && allowed[mark]) {
      next[id] = mark
    }
    return next
  }, {})
}

export async function POST(request) {
  const startedAt = Date.now()
  try {
    const minuteLimit = checkRateLimit(request, 'ai-plan:minute', { windowMs: 60000, max: 4 })
    if (!minuteLimit.ok) return rateLimitResponse(minuteLimit)
    const hourLimit = checkRateLimit(request, 'ai-plan:hour', { windowMs: 60 * 60000, max: 30 })
    if (!hourLimit.ok) return rateLimitResponse(hourLimit)

    const body = await request.json()
    const instruction = String(body && body.instruction || '').trim().slice(0, 500)
    const marks = normalizeMarks(body && body.marks)
    const films = festival.films || []
    const allScreenings = schedule.buildScreenings(films, marks)
    const selectedMarkedFilmIds = markedFilmIds(films, marks)
    const currentScreeningFilmIds = filmIdsFromScreenings(
      allScreenings,
      body && (body.selectedIds || body.selectedScreeningIds)
    )
    const currentFilmIds = uniqueIds(selectedMarkedFilmIds.concat(currentScreeningFilmIds))
    const hasCurrentFilms = currentFilmIds.length > 0

    if (!instruction) {
      return Response.json({
        ok: false,
        error: 'missing_instruction'
      }, { status: 400 })
    }

    const requestResult = await ai.parsePreference({
      task: ai.TASK_PARSE_SMART_REQUEST,
      instruction,
      hasMarkedFilms: hasCurrentFilms,
      currentFilms: filmSummariesByIds(films, currentFilmIds)
    })
    const currentFilmsFit = hasCurrentFilms && requestResult.currentFilmsFit === true
    const allowAddFilms = hasCurrentFilms ? requestResult.allowAddFilms === true : true
    const keepCurrentFilms = hasCurrentFilms && allowAddFilms && requestResult.keepCurrentFilms === true
    const hinted = applyInstructionPreferenceHints(requestResult.preferences || {}, instruction, knownCinemaNames(allScreenings))
    const filmCriteria = removeCinemaKeywords(requestResult.filmCriteria || {}, hinted.cinemaTerms)
    const baseOnly = !allowAddFilms
    const selection = filmSelection.selectFilms(films, filmCriteria, {
      baseFilmIds: currentFilmIds,
      baseOnly,
      instruction,
      limit: baseOnly ? Math.max(1, currentFilmIds.length) : undefined
    })
    const selectedFilmIds = allowAddFilms
      ? uniqueIds((keepCurrentFilms ? currentFilmIds : []).concat(selection.selectedFilmIds || []))
      : uniqueIds((selection.selectedFilmIds || []).length ? selection.selectedFilmIds : currentFilmIds)
    const preferenceOverrides = Object.assign({}, hinted.preferences || {})
    if (allowAddFilms && !hasTargetCount(preferenceOverrides)) {
      preferenceOverrides.targetCount = filmCriteria.targetFilmCount || filmSelection.DEFAULT_EXPAND_FILM_COUNT
    }
    const preferences = smartPlan.mergePreferenceOverrides({}, preferenceOverrides)
    const mode = smartPlan.SMART_MODE_PICK

    const plan = smartPlan.buildSmartPlan(allScreenings, preferences, {
      mode,
      selectedFilmIds,
      filmWeights: selection.filmWeights || {},
      nowMs: Number(body && body.nowMs) || Date.now()
    })

    return Response.json({
      ok: true,
      selectedIds: plan.selectedIds,
      selectedFilmIds,
      mode,
      currentFilmsFit,
      allowAddFilms,
      keepCurrentFilms,
      instruction,
      preferences: plan.preferences,
      filmCriteria: selection.criteria,
      candidateFilmCount: selectedFilmIds.length,
      ai: {
        intent: {
          source: requestResult.source,
          provider: requestResult.provider,
          model: requestResult.model,
          errorCode: requestResult.errorCode
        },
        pick: {
          source: selection.source,
          selectedFilmCount: (selection.selectedFilmIds || []).length,
          matchedFilmCount: selection.matchedFilmCount,
          consideredFilmCount: selection.consideredFilmCount,
          relaxed: selection.relaxed
        },
        preferences: {
          source: requestResult.source,
          provider: requestResult.provider,
          model: requestResult.model,
          errorCode: requestResult.errorCode
        },
        elapsedMs: Date.now() - startedAt
      }
    })
  } catch (error) {
    return Response.json({
      ok: false,
      error: 'ai_plan_failed',
      message: String(error && error.message || error || '').slice(0, 160),
      elapsedMs: Date.now() - startedAt
    }, { status: 500 })
  }
}
