import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const festival = require('../../../lib/festival')
const schedule = require('../../../lib/schedule.cjs')
const smartPlan = require('../../../lib/smart-plan.cjs')
const ai = require('../../../lib/ai.cjs')

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

function buildFilmCatalog(films) {
  return films.map(film => ({
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
  }))
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
    const body = await request.json()
    const instruction = String(body && body.instruction || '').trim().slice(0, 500)
    const marks = normalizeMarks(body && body.marks)
    const films = festival.films || []
    const allScreenings = schedule.buildScreenings(films, marks)
    const selectedMarkedFilmIds = markedFilmIds(films, marks)
    const hasMarkedFilms = selectedMarkedFilmIds.length > 0

    if (!instruction) {
      return Response.json({
        ok: false,
        error: 'missing_instruction'
      }, { status: 400 })
    }

    const intent = await ai.parsePreference({
      task: ai.TASK_CLASSIFY_INTENT,
      instruction,
      hasMarkedFilms
    })

    const allowAddFilms = intent.allowAddFilms === true
    let pick = {
      task: ai.TASK_PICK_FILMS,
      selectedFilmIds: [],
      filmWeights: {},
      source: 'skipped'
    }
    if (allowAddFilms) {
      pick = await ai.parsePreference({
        task: ai.TASK_PICK_FILMS,
        instruction,
        hasMarkedFilms,
        films: buildFilmCatalog(films)
      })
      if (!Array.isArray(pick.selectedFilmIds) || !pick.selectedFilmIds.length) {
        return Response.json({
          ok: false,
          error: 'pick_films_failed',
          message: 'AI 未能选出影片，请换个说法再试',
          ai: {
            intent: {
              source: intent.source,
              provider: intent.provider,
              model: intent.model,
              errorCode: intent.errorCode
            },
            pick: {
              source: pick.source,
              provider: pick.provider,
              model: pick.model,
              errorCode: pick.errorCode,
              selectedFilmCount: 0
            },
            elapsedMs: Date.now() - startedAt
          }
        }, { status: 502 })
      }
    }

    const preferenceResult = await ai.parsePreference({
      task: ai.TASK_PARSE_PREFERENCES,
      instruction,
      hasMarkedFilms
    })
    const preferences = smartPlan.mergePreferenceOverrides({}, preferenceResult.preferences || {})
    const mode = allowAddFilms ? smartPlan.SMART_MODE_PICK : smartPlan.SMART_MODE_MARKED
    const selectedFilmIds = allowAddFilms
      ? uniqueIds(selectedMarkedFilmIds.concat(pick.selectedFilmIds || []))
      : selectedMarkedFilmIds

    const plan = smartPlan.buildSmartPlan(allScreenings, preferences, {
      mode,
      selectedFilmIds,
      filmWeights: pick.filmWeights || {},
      nowMs: Number(body && body.nowMs) || Date.now()
    })

    return Response.json({
      ok: true,
      selectedIds: plan.selectedIds,
      selectedFilmIds,
      mode,
      allowAddFilms,
      instruction,
      preferences: plan.preferences,
      ai: {
        intent: {
          source: intent.source,
          provider: intent.provider,
          model: intent.model,
          errorCode: intent.errorCode
        },
        pick: {
          source: pick.source,
          provider: pick.provider,
          model: pick.model,
          errorCode: pick.errorCode,
          selectedFilmCount: (pick.selectedFilmIds || []).length
        },
        preferences: {
          source: preferenceResult.source,
          provider: preferenceResult.provider,
          model: preferenceResult.model,
          errorCode: preferenceResult.errorCode
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
