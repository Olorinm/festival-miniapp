const DEFAULT_PREFERENCES = {
  maxPerDay: 4,
  minGap: 20,
  sameCinemaBonus: 10,
  cinemaSwitchPenalty: 8,
  meetupBonus: 24,
  rareBonus: 18,
  avoidMorningBefore: 0,
  avoidLateAfter: 0,
  preferredCinemas: [],
  avoidCinemas: [],
  preferredSections: [],
  avoidSections: [],
  preferredKeywords: [],
  avoidKeywords: [],
  busyRules: []
}

const SMART_MODE_MARKED = 'schedule_marked'
const SMART_MODE_PICK = 'pick_and_schedule'
const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

const CHINESE_NUMBERS = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10
}

function clonePreferences(overrides) {
  const next = Object.assign({}, DEFAULT_PREFERENCES, overrides || {})
  next.busyRules = (next.busyRules || []).map(rule => Object.assign({}, rule))
  ;[
    'preferredCinemas',
    'avoidCinemas',
    'preferredSections',
    'avoidSections',
    'preferredKeywords',
    'avoidKeywords'
  ].forEach(key => {
    next[key] = Array.isArray(next[key]) ? next[key].slice() : []
  })
  return next
}

function clamp(value, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) {
    return null
  }
  return Math.max(min, Math.min(max, Math.round(number)))
}

function cleanBusyRules(rules) {
  if (!Array.isArray(rules)) {
    return []
  }

  return rules
    .map(rule => {
      const day = DAYS.includes(rule.day) ? rule.day : ''
      const start = clamp(rule.start, 0, 24 * 60)
      const end = clamp(rule.end, 0, 24 * 60)
      if (!day || start === null || end === null || end <= start) {
        return null
      }
      return {
        day,
        start,
        end,
        label: String(rule.label || '不可用').slice(0, 18)
      }
    })
    .filter(Boolean)
}

function cleanStringList(items) {
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
    .slice(0, 6)
}

function mergeStringList(a, b) {
  return cleanStringList((a || []).concat(b || []))
}

function mergePreferenceOverrides(base, overrides) {
  const next = clonePreferences(base)
  const patch = overrides || {}

  ;[
    ['maxPerDay', 1, 8, 'replace'],
    ['minGap', 0, 120, 'max'],
    ['sameCinemaBonus', 0, 80, 'max'],
    ['cinemaSwitchPenalty', 0, 100, 'max'],
    ['meetupBonus', 0, 90, 'max'],
    ['rareBonus', 0, 80, 'max'],
    ['avoidMorningBefore', 0, 24 * 60, 'max'],
    ['avoidLateAfter', 0, 24 * 60, 'minNonZero']
  ].forEach(([key, min, max, mode]) => {
    if (patch[key] !== undefined && patch[key] !== null) {
      const value = clamp(patch[key], min, max)
      if (value !== null) {
        if (mode === 'max') {
          next[key] = Math.max(next[key] || 0, value)
        } else if (mode === 'minNonZero') {
          next[key] = next[key] ? Math.min(next[key], value || next[key]) : value
        } else {
          next[key] = value
        }
      }
    }
  })

  ;[
    'preferredCinemas',
    'avoidCinemas',
    'preferredSections',
    'avoidSections',
    'preferredKeywords',
    'avoidKeywords'
  ].forEach(key => {
    next[key] = mergeStringList(next[key], patch[key])
  })

  if (patch.busyRules !== undefined) {
    const busyRules = cleanBusyRules(patch.busyRules)
    if (busyRules.length) {
      next.busyRules = busyRules
    }
  }

  return next
}

function parseChineseHour(value) {
  const text = String(value || '').trim()
  if (/^\d+$/.test(text)) {
    return Number(text)
  }

  if (text === '十') {
    return 10
  }

  if (text.startsWith('十')) {
    return 10 + (CHINESE_NUMBERS[text.slice(1)] || 0)
  }

  if (text.includes('十')) {
    const parts = text.split('十')
    return (CHINESE_NUMBERS[parts[0]] || 0) * 10 + (CHINESE_NUMBERS[parts[1]] || 0)
  }

  return CHINESE_NUMBERS[text]
}

function normalizeHour(hour, role, startHour, phrase) {
  if (typeof hour !== 'number' || Number.isNaN(hour)) {
    return null
  }

  const text = phrase || ''
  const shouldUsePm = /下午|晚上|下班/.test(text)
  if (shouldUsePm && hour < 12) {
    return hour + 12
  }

  if (role === 'end' && typeof startHour === 'number' && hour <= startHour && hour <= 8) {
    return hour + 12
  }

  return hour
}

function minutesFromHour(hour) {
  return hour * 60
}

function addBusyRule(preferences, days, start, end, label) {
  days.forEach(day => {
    preferences.busyRules.push({ day, start, end, label })
  })
}

function removeBusyRulesForDay(preferences, day) {
  preferences.busyRules = preferences.busyRules.filter(rule => rule.day !== day)
}

function parseRange(text) {
  const match = text.match(/([零一二两三四五六七八九十\d]{1,3})(?:点|:00)?\s*(?:到|至|-)\s*([零一二两三四五六七八九十\d]{1,3})(?:点|:00)?/)
  if (!match) {
    return null
  }

  const rawStart = parseChineseHour(match[1])
  const startHour = normalizeHour(rawStart, 'start', null, match[0])
  const rawEnd = parseChineseHour(match[2])
  const endHour = normalizeHour(rawEnd, 'end', startHour, match[0])
  if (startHour === null || endHour === null) {
    return null
  }

  return {
    start: minutesFromHour(startHour),
    end: minutesFromHour(endHour)
  }
}

function parsePreferenceInstruction(instruction) {
  const text = String(instruction || '').trim()
  const preferences = clonePreferences()
  const labels = []

  if (!text) {
    return {
      preferences,
      labels: ['默认脚本']
    }
  }

  const workdayRange = /工作日/.test(text) ? parseRange(text) : null
  if (workdayRange && /没空|不能|不行|上班/.test(text)) {
    addBusyRule(preferences, ['周一', '周二', '周三', '周四', '周五'], workdayRange.start, workdayRange.end, '工作日不可用')
    labels.push('避开工作日占用')
  }

  const fridayLeave = text.match(/周五.*?([零一二两三四五六七八九十\d]{1,3})(?:点|:00)?.*?下班/)
  if (fridayLeave) {
    const rawHour = parseChineseHour(fridayLeave[1])
    const endHour = normalizeHour(rawHour, 'end', 10, fridayLeave[0])
    if (endHour !== null) {
      removeBusyRulesForDay(preferences, '周五')
      addBusyRule(preferences, ['周五'], workdayRange ? workdayRange.start : minutesFromHour(10), minutesFromHour(endHour), '周五下班前不可用')
      labels.push(`周五${endHour}点后可用`)
    }
  }

  const maxMatch = text.match(/(?:每天|一天).*?(?:最多|不超过)\s*([一二两三四五六七八九十\d])\s*场/)
  if (maxMatch) {
    const max = parseChineseHour(maxMatch[1])
    if (max) {
      preferences.maxPerDay = max
      labels.push(`每天最多${max}场`)
    }
  }

  if (/少跑|少换|少赶|同影院|不要折腾/.test(text)) {
    preferences.sameCinemaBonus = 42
    preferences.cinemaSwitchPenalty = 38
    preferences.minGap = Math.max(preferences.minGap, 30)
    labels.push('少换影院')
  }

  if (/极限|多看|尽量多/.test(text)) {
    preferences.maxPerDay = Math.max(preferences.maxPerDay, 5)
    preferences.minGap = 10
    labels.push('多看片')
  }

  if (/不想早起|不要太早|早场少/.test(text)) {
    preferences.avoidMorningBefore = minutesFromHour(11)
    labels.push('少早场')
  }

  if (/不要太晚|别太晚|晚上少/.test(text)) {
    preferences.avoidLateAfter = minutesFromHour(21)
    labels.push('少晚场')
  }

  if (/见面场|映后|主创/.test(text)) {
    preferences.meetupBonus = 40
    labels.push('见面场优先')
  }

  ;[
    '资料馆',
    '英皇',
    '北京剧院',
    '卢米埃',
    '中间影院',
    '百老汇',
    '万达',
    '天幕',
    '耀莱',
    'UME',
    '深影'
  ].forEach(cinema => {
    if (text.includes(cinema)) {
      preferences.preferredCinemas.push(cinema)
      labels.push(`偏好${cinema}`)
    }
  })

  return {
    preferences,
    labels: labels.length ? labels : ['已解析偏好']
  }
}

function countScreeningsByFilm(screenings) {
  return screenings.reduce((map, screening) => {
    map[screening.filmId] = (map[screening.filmId] || 0) + 1
    return map
  }, {})
}

function isMeetup(screening) {
  return /见面|映后|主创|嘉宾/.test(`${screening.ticket || ''}${screening.ticketPlan || ''}`)
}

function screeningText(screening) {
  return [
    screening.cnTitle,
    screening.enTitle,
    screening.section,
    screening.director,
    screening.country,
    screening.year,
    screening.cinema,
    screening.hall,
    screening.ticket,
    screening.ticketPlan
  ].join(' ')
}

function includesAny(text, words) {
  return (words || []).some(word => text.includes(word))
}

function isBusy(screening, preferences) {
  return preferences.busyRules.some(rule => {
    return screening.dayLabel.includes(rule.day) && screening.startMinutes < rule.end && screening.endMinutes > rule.start
  })
}

function isCompatible(candidate, selected, preferences) {
  return selected.every(item => {
    if (item.date !== candidate.date) {
      return true
    }
    const gap = candidate.startMinutes >= item.endMinutes
      ? candidate.startMinutes - item.endMinutes
      : item.startMinutes - candidate.endMinutes
    return gap >= preferences.minGap
  })
}

function clampWeight(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) {
    return 0
  }
  return Math.max(0, Math.min(100, Math.round(number)))
}

function baseScore(screening, filmCounts, preferences, options) {
  const filmWeights = options && options.filmWeights ? options.filmWeights : {}
  const aiWeight = clampWeight(filmWeights[screening.filmId])
  const rankScore = (screening.interest.rank || 0) * 100
  const pickScore = aiWeight * 6
  const rare = filmCounts[screening.filmId] <= 1 ? preferences.rareBonus : 0
  const meetup = isMeetup(screening) ? preferences.meetupBonus : 0
  const text = screeningText(screening)
  const morningPenalty = preferences.avoidMorningBefore && screening.startMinutes < preferences.avoidMorningBefore ? -70 : 0
  const latePenalty = preferences.avoidLateAfter && screening.endMinutes > preferences.avoidLateAfter ? -56 : 0
  const preferredCinema = includesAny(screening.cinema || '', preferences.preferredCinemas) ? 64 : 0
  const avoidCinema = includesAny(screening.cinema || '', preferences.avoidCinemas) ? -96 : 0
  const preferredSection = includesAny(screening.section || '', preferences.preferredSections) ? 44 : 0
  const avoidSection = includesAny(screening.section || '', preferences.avoidSections) ? -72 : 0
  const preferredKeyword = includesAny(text, preferences.preferredKeywords) ? 36 : 0
  const avoidKeyword = includesAny(text, preferences.avoidKeywords) ? -54 : 0
  return rankScore + pickScore + rare + meetup + morningPenalty + latePenalty + preferredCinema + avoidCinema + preferredSection + avoidSection + preferredKeyword + avoidKeyword
}

function dynamicScore(screening, selected, filmCounts, preferences, options) {
  let score = baseScore(screening, filmCounts, preferences, options)
  selected.forEach(item => {
    if (item.date !== screening.date) {
      return
    }
    if (item.cinema === screening.cinema) {
      score += preferences.sameCinemaBonus
    } else {
      const gap = Math.min(
        Math.abs(screening.startMinutes - item.endMinutes),
        Math.abs(item.startMinutes - screening.endMinutes)
      )
      if (gap < 90) {
        score -= preferences.cinemaSwitchPenalty
      }
      if (preferences.sameCinemaBonus >= 30) {
        score -= Math.round(preferences.cinemaSwitchPenalty * 0.6)
      }
    }
  })
  return score
}

function normalizeMode(mode) {
  return mode === SMART_MODE_PICK ? SMART_MODE_PICK : SMART_MODE_MARKED
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

function normalizeFilmWeights(weights) {
  if (!weights || typeof weights !== 'object') {
    return {}
  }

  return Object.keys(weights).reduce((map, filmId) => {
    const id = String(filmId || '').trim()
    const weight = clampWeight(weights[filmId])
    if (id && weight > 0) {
      map[id] = weight
    }
    return map
  }, {})
}

function buildSmartPlan(screenings, preferencesInput, optionsInput) {
  const preferences = clonePreferences(preferencesInput)
  const filmCounts = countScreeningsByFilm(screenings)
  const options = Object.assign({}, optionsInput || {}, {
    mode: normalizeMode(optionsInput && optionsInput.mode),
    selectedFilmIds: normalizeSelectedFilmIds(optionsInput && optionsInput.selectedFilmIds),
    filmWeights: normalizeFilmWeights(optionsInput && optionsInput.filmWeights)
  })
  const pickedFilmIds = options.selectedFilmIds.reduce((map, id) => {
    map[id] = true
    return map
  }, {})
  const candidates = screenings
    .filter(screening => {
      if (options.mode === SMART_MODE_PICK) {
        return !options.selectedFilmIds.length || pickedFilmIds[screening.filmId]
      }
      return screening.interest.rank > 0
    })
    .filter(screening => !isBusy(screening, preferences))
    .map(screening => Object.assign({}, screening, {
      smartBaseScore: baseScore(screening, filmCounts, preferences, options)
    }))

  const selected = []
  const selectedFilmIds = {}
  const dayCounts = {}
  let remaining = candidates.slice()

  while (remaining.length) {
    let best = null
    let bestScore = -Infinity

    remaining.forEach(candidate => {
      if (selectedFilmIds[candidate.filmId]) {
        return
      }
      if ((dayCounts[candidate.date] || 0) >= preferences.maxPerDay) {
        return
      }
      if (!isCompatible(candidate, selected, preferences)) {
        return
      }

      const score = dynamicScore(candidate, selected, filmCounts, preferences, options)
      if (!best || score > bestScore || (score === bestScore && candidate.startMinutes < best.startMinutes)) {
        best = candidate
        bestScore = score
      }
    })

    if (!best) {
      break
    }

    selected.push(best)
    selectedFilmIds[best.filmId] = true
    dayCounts[best.date] = (dayCounts[best.date] || 0) + 1
    remaining = remaining.filter(candidate => candidate.id !== best.id && candidate.filmId !== best.filmId)
  }

  return {
    selectedIds: selected
      .sort((a, b) => a.date.localeCompare(b.date) || a.startMinutes - b.startMinutes)
      .map(screening => screening.id),
    selected,
    preferences,
    mode: options.mode
  }
}

module.exports = {
  buildSmartPlan,
  mergePreferenceOverrides,
  parsePreferenceInstruction,
  SMART_MODE_MARKED,
  SMART_MODE_PICK
}
