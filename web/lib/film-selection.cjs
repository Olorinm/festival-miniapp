const schedule = require('./schedule.cjs')

const DEFAULT_EXPAND_FILM_COUNT = {
  min: 3,
  ideal: 5,
  max: 8,
  maximize: false
}

function clamp(value, min, max) {
  if (value === null || value === undefined || value === '') {
    return null
  }
  const number = Number(value)
  if (!Number.isFinite(number)) {
    return null
  }
  return Math.max(min, Math.min(max, Math.round(number)))
}

function clampRating(value) {
  if (value === null || value === undefined || value === '') {
    return null
  }
  const number = Number(value)
  if (!Number.isFinite(number)) {
    return null
  }
  return Math.max(0, Math.min(10, Math.round(number * 10) / 10))
}

function cleanStringList(items, limit) {
  if (!Array.isArray(items)) {
    return []
  }

  const seen = {}
  return items
    .map(item => String(item || '').trim())
    .filter(Boolean)
    .filter(item => {
      if (seen[item]) {
        return false
      }
      seen[item] = true
      return true
    })
    .slice(0, limit || 10)
}

function cleanTargetCount(input) {
  if (typeof input === 'number' || (typeof input === 'string' && input.trim())) {
    const ideal = clamp(input, 1, 80)
    return ideal === null ? null : {
      maximize: false,
      min: ideal,
      ideal,
      max: ideal
    }
  }
  if (!input || typeof input !== 'object') {
    return null
  }

  const maximize = !!input.maximize
  const min = clamp(input.min, 1, 80)
  const ideal = clamp(input.ideal, 1, 80)
  const max = clamp(input.max, 1, 80)
  const values = [min, ideal, max].filter(value => value !== null)
  if (!maximize && !values.length) {
    return null
  }

  const result = { maximize }
  if (values.length) {
    const low = min !== null ? min : Math.min.apply(null, values)
    const high = max !== null ? max : Math.max.apply(null, values)
    const middle = ideal !== null ? ideal : Math.round((low + high) / 2)
    result.min = Math.min(low, middle, high)
    result.ideal = Math.max(result.min, Math.min(middle, high))
    result.max = Math.max(result.ideal, high)
  }
  return result
}

function normalizeFilmCriteria(input) {
  const source = input && typeof input === 'object' ? input : {}
  const minDoubanRating = clampRating(source.minDoubanRating)
  const minImdbRating = clampRating(source.minImdbRating)
  return {
    countries: cleanStringList(source.countries, 8),
    genres: cleanStringList(source.genres, 8),
    sections: cleanStringList(source.sections, 8),
    directors: cleanStringList(source.directors, 8),
    casts: cleanStringList(source.casts, 8),
    keywords: cleanStringList(source.keywords, 12),
    avoidKeywords: cleanStringList(source.avoidKeywords, 12),
    minDoubanRating: minDoubanRating && minDoubanRating > 0 ? minDoubanRating : null,
    minDoubanRatingCount: clamp(source.minDoubanRatingCount, 0, 10000000),
    minImdbRating: minImdbRating && minImdbRating > 0 ? minImdbRating : null,
    minImdbRatingCount: clamp(source.minImdbRatingCount, 0, 10000000),
    maxRuntime: clamp(source.maxRuntime, 1, 600),
    minRuntime: clamp(source.minRuntime, 1, 600),
    targetFilmCount: cleanTargetCount(source.targetFilmCount),
    preferRare: !!source.preferRare,
    preferMeetup: !!source.preferMeetup
  }
}

function splitValues(value) {
  return String(value || '')
    .split(/[、,，/;；\s]+/)
    .map(item => item.trim())
    .filter(Boolean)
}

function includesAny(text, words) {
  return (words || []).some(word => text.includes(word))
}

function containsAllWhenPresent(text, words) {
  return !(words || []).length || includesAny(text, words)
}

function normalizeCountryAliases(words) {
  return (words || []).reduce((list, word) => {
    list.push(word)
    if (/日影|日本/.test(word)) list.push('日本')
    if (/韩影|韩国/.test(word)) list.push('韩国')
    if (/华语|国产|中国/.test(word)) list.push('中国', '中国大陆', '中国内地', '中国香港', '中国台湾')
    if (/港片|香港/.test(word)) list.push('中国香港', '香港')
    if (/台湾|台片/.test(word)) list.push('中国台湾', '台湾')
    if (/法影|法国/.test(word)) list.push('法国')
    return list
  }, [])
}

function expandedKeywords(criteria, instruction) {
  const text = `${instruction || ''} ${criteria.keywords.join(' ')}`
  const words = criteria.keywords.slice()
  if (/女性|女人|女孩|少女|女儿|母亲|妈妈|姐妹|她/.test(text)) {
    words.push('女性', '女人', '女孩', '少女', '女儿', '母亲', '她', '成长', '家庭')
  }
  if (/高分|口碑|评分/.test(text)) {
    words.push('高分', '豆瓣', '口碑')
  }
  if (/修复|经典/.test(text)) {
    words.push('修复', '经典', '4K')
  }
  if (/轻松|治愈|温暖|暖心/.test(text)) {
    words.push('治愈', '温暖', '暖心', '喜剧')
  }
  if (/作者|大师|名导/.test(text)) {
    words.push('作者', '大师', '名导')
  }
  return cleanStringList(words, 24)
}

function hardKeywordHints(criteria, instruction) {
  const text = `${instruction || ''} ${criteria.keywords.join(' ')}`
  const words = []
  criteria.keywords.forEach(word => {
    if (!/高分|口碑|评分|轻松|好看|冷门|小众/.test(word)) {
      words.push(word)
    }
  })
  if (/女性|女人|女孩|少女|女儿|母亲|妈妈|姐妹|她/.test(text)) {
    words.push('女性', '女人', '女孩', '少女', '女儿', '母亲', '妈妈')
  }
  if (/修复|经典|4K/i.test(text)) {
    words.push('修复', '经典', '4K')
  }
  return cleanStringList(words, 18)
}

function filmText(film) {
  return [
    film.cnTitle,
    film.enTitle,
    film.section,
    film.director,
    film.cast,
    film.country,
    film.genre,
    film.recommendation,
    film.logline,
    film.synopsis,
    film.doulistComment
  ].join(' ')
}

function filmHardText(film) {
  return [
    film.cnTitle,
    film.enTitle,
    film.section,
    film.director,
    film.cast,
    film.country,
    film.genre,
    film.recommendation,
    film.logline,
    film.doulistComment
  ].join(' ')
}

function countFilmScreenings(film) {
  return Array.isArray(film && film.screenings) ? film.screenings.length : 0
}

function hasMeetup(film) {
  return (film.screenings || []).some(screening => /见面|映后|主创|嘉宾/.test(`${screening.ticket || ''}${screening.ticketPlan || ''}`))
}

function passesRatingFloor(primaryRating, fallbackRating, minRating, relaxedNumbers) {
  if (minRating === null) {
    return true
  }
  if (!relaxedNumbers) {
    return primaryRating !== null && primaryRating >= minRating
  }
  const relaxedPrimaryFloor = Math.max(7.4, minRating - 0.4)
  const relaxedFallbackFloor = Math.max(7.5, minRating - 0.3)
  if (primaryRating !== null) {
    return primaryRating >= relaxedPrimaryFloor
  }
  return fallbackRating !== null && fallbackRating >= relaxedFallbackFloor
}

function filmMatchesHardCriteria(film, criteria, options, relaxedNumbers) {
  const text = filmHardText(film)
  const hardKeywords = hardKeywordHints(criteria, options && options.instruction)
  const countries = normalizeCountryAliases(criteria.countries)
  const countryText = splitValues(schedule.filmCountry(film)).join(' ')
  const genreText = splitValues(schedule.filmGenre(film)).join(' ')
  const sectionText = schedule.filmSection(film)
  const directorText = schedule.filmDirector(film)
  const castText = String(film.cast || '')
  const runtime = schedule.filmRuntimeMinutes(film)
  const doubanRating = clampRating(film.doubanRating)
  const doubanRatingCount = clamp(film.doubanRatingCount, 0, 10000000)
  const imdbRating = clampRating(film.imdbRating)
  const imdbRatingCount = clamp(film.imdbRatingCount, 0, 10000000)

  if (countries.length && !containsAllWhenPresent(countryText, countries)) return false
  if (criteria.genres.length && !containsAllWhenPresent(genreText, criteria.genres)) return false
  if (criteria.sections.length && !containsAllWhenPresent(sectionText, criteria.sections)) return false
  if (criteria.directors.length && !containsAllWhenPresent(directorText, criteria.directors)) return false
  if (criteria.casts.length && !containsAllWhenPresent(castText, criteria.casts)) return false
  if (hardKeywords.length && !includesAny(text, hardKeywords)) return false
  if (criteria.avoidKeywords.length && includesAny(text, criteria.avoidKeywords)) return false
  if (!passesRatingFloor(doubanRating, imdbRating, criteria.minDoubanRating, relaxedNumbers)) return false
  if (!passesRatingFloor(imdbRating, doubanRating, criteria.minImdbRating, relaxedNumbers)) return false
  if (!relaxedNumbers) {
    if (criteria.minDoubanRatingCount !== null && (doubanRatingCount === null || doubanRatingCount < criteria.minDoubanRatingCount)) return false
    if (criteria.minImdbRatingCount !== null && (imdbRatingCount === null || imdbRatingCount < criteria.minImdbRatingCount)) return false
  }
  if (criteria.maxRuntime !== null && (runtime === null || runtime > criteria.maxRuntime)) return false
  if (criteria.minRuntime !== null && (runtime === null || runtime < criteria.minRuntime)) return false
  return true
}

function scoreFilm(film, criteria, options) {
  const instruction = options && options.instruction
  const text = filmText(film)
  const countries = normalizeCountryAliases(criteria.countries)
  const keywords = expandedKeywords(criteria, instruction)
  const countryText = splitValues(schedule.filmCountry(film)).join(' ')
  const genreText = splitValues(schedule.filmGenre(film)).join(' ')
  const sectionText = schedule.filmSection(film)
  const directorText = schedule.filmDirector(film)
  const castText = String(film.cast || '')
  const runtime = schedule.filmRuntimeMinutes(film)
  const doubanRating = clampRating(film.doubanRating)
  const imdbRating = clampRating(film.imdbRating)
  const doubanRatingCount = clamp(film.doubanRatingCount, 0, 10000000)
  const imdbRatingCount = clamp(film.imdbRatingCount, 0, 10000000)
  const screeningCount = countFilmScreenings(film)
  let score = 0

  if (doubanRating !== null) score += doubanRating * 12
  if (imdbRating !== null) score += imdbRating * 7
  if (doubanRatingCount !== null && doubanRatingCount > 0) score += Math.min(35, Math.log10(doubanRatingCount + 1) * 7)
  if (imdbRatingCount !== null && imdbRatingCount > 0) score += Math.min(24, Math.log10(imdbRatingCount + 1) * 4)
  score += Math.min(28, screeningCount * 4)
  if (criteria.preferRare && screeningCount <= 1) score += 34
  if (criteria.preferMeetup && hasMeetup(film)) score += 32
  if (countries.length && includesAny(countryText, countries)) score += 44
  if (criteria.genres.length && includesAny(genreText, criteria.genres)) score += 32
  if (criteria.sections.length && includesAny(sectionText, criteria.sections)) score += 28
  if (criteria.directors.length && includesAny(directorText, criteria.directors)) score += 42
  if (criteria.casts.length && includesAny(castText, criteria.casts)) score += 36
  keywords.forEach(word => {
    if (word && text.includes(word)) score += 28
  })
  criteria.avoidKeywords.forEach(word => {
    if (word && text.includes(word)) score -= 80
  })
  if (/女性|女人|女孩|少女|女儿|母亲|她/.test(`${instruction || ''} ${criteria.keywords.join(' ')}`) && /女性|女人|女孩|少女|女儿|母亲|她|成长|家庭/.test(text)) {
    score += 58
  }
  if (/高分|口碑|评分/.test(`${instruction || ''} ${criteria.keywords.join(' ')}`) && doubanRating !== null && doubanRating >= 8) {
    score += 36
  }
  if (criteria.maxRuntime !== null && runtime !== null) {
    score += Math.max(0, criteria.maxRuntime - runtime) / 8
  }
  if (!screeningCount) score -= 120
  return Math.round(score)
}

function filmIdSet(ids) {
  return (Array.isArray(ids) ? ids : []).reduce((map, id) => {
    const value = String(id || '').trim()
    if (value) map[value] = true
    return map
  }, {})
}

function targetLimit(criteria, fallback) {
  const target = cleanTargetCount(criteria.targetFilmCount)
  if (target && target.max) return target.max
  if (target && target.ideal) return target.ideal
  return fallback || DEFAULT_EXPAND_FILM_COUNT.max
}

function selectFilms(films, criteriaInput, optionsInput) {
  const criteria = normalizeFilmCriteria(criteriaInput)
  const options = optionsInput || {}
  const baseIds = filmIdSet(options.baseFilmIds)
  const includeBaseOnly = options.baseOnly === true
  const baseFilms = includeBaseOnly
    ? (films || []).filter(film => baseIds[film.id])
    : (films || [])
  const fallbackFilms = includeBaseOnly && !baseFilms.length ? [] : baseFilms
  const minNeeded = (criteria.targetFilmCount && criteria.targetFilmCount.min) || 1
  let hardMatches = fallbackFilms.filter(film => filmMatchesHardCriteria(film, criteria, options, false))
  let relaxed = false
  if (hardMatches.length < minNeeded) {
    const relaxedMatches = fallbackFilms.filter(film => filmMatchesHardCriteria(film, criteria, options, true))
    if (relaxedMatches.length > hardMatches.length) {
      hardMatches = relaxedMatches
      relaxed = true
    }
  }
  const pool = hardMatches.length ? hardMatches : fallbackFilms
  const limit = Math.max(1, Math.min(80, targetLimit(criteria, options.limit || DEFAULT_EXPAND_FILM_COUNT.max)))
  const ranked = pool
    .map(film => ({
      film,
      score: scoreFilm(film, criteria, options)
    }))
    .sort((a, b) => b.score - a.score || schedule.filmDisplayTitle(a.film).localeCompare(schedule.filmDisplayTitle(b.film), 'zh-Hans-CN'))
    .slice(0, limit)

  const selectedFilmIds = ranked.map(item => item.film.id)
  const filmWeights = ranked.reduce((map, item, index) => {
    const rankBonus = Math.max(0, ranked.length - index)
    map[item.film.id] = Math.max(1, Math.min(100, Math.round(item.score / 2 + rankBonus)))
    return map
  }, {})

  return {
    selectedFilmIds,
    filmWeights,
    criteria,
    matchedFilmCount: hardMatches.length,
    consideredFilmCount: fallbackFilms.length,
    relaxed: relaxed || (!hardMatches.length && fallbackFilms.length > 0),
    source: 'script'
  }
}

module.exports = {
  DEFAULT_EXPAND_FILM_COUNT,
  normalizeFilmCriteria,
  selectFilms
}
