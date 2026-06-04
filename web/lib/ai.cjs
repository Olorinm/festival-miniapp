const https = require('https')
const fs = require('fs')
const path = require('path')
const filmSelection = require('./film-selection.cjs')

let localEnvCache = null

function readLocalEnv() {
  if (localEnvCache) {
    return localEnvCache
  }

  localEnvCache = {}
  const candidates = [
    path.join(process.cwd(), '.env.local'),
    path.join(process.cwd(), '.env'),
    path.join(__dirname, '.env')
  ]
  candidates.forEach(file => {
    try {
      const text = fs.readFileSync(file, 'utf8')
      text.split(/\r?\n/).forEach(line => {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) {
        return
      }
      const index = trimmed.indexOf('=')
      if (index <= 0) {
        return
      }
      const key = trimmed.slice(0, index).trim()
      const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')
        if (key && value) {
          localEnvCache[key] = value
        }
      })
    } catch (error) {}
  })
  return localEnvCache
}

function getEnv(name, fallback) {
  return readLocalEnv()[name] || process.env[name] || fallback
}

function errorCode(error) {
  const message = String((error && error.message) || error || '')
  if (/timeout/i.test(message)) {
    return 'timeout'
  }
  if (/(Ark|DeepSeek|AI) API\s+(\d+)/.test(message)) {
    const match = message.match(/(Ark|DeepSeek|AI) API\s+(\d+)/)
    return `${match[1].toLowerCase()}_http_${match[2]}`
  }
  if (/JSON|Unexpected token|Unexpected end/.test(message)) {
    return 'parse_error'
  }
  if (/ENOTFOUND|EAI_AGAIN/.test(message)) {
    return 'dns_error'
  }
  if (/ECONNRESET|ECONNREFUSED|ETIMEDOUT/.test(message)) {
    return 'network_error'
  }
  return 'unknown_error'
}

function isResponseFormatUnsupported(error) {
  const message = String((error && error.message) || error || '')
  return /response_format/i.test(message) && /InvalidParameter|(Ark|DeepSeek|AI) API\s+400/i.test(message)
}

function safeDebug(error, extra) {
  return Object.assign({
    code: errorCode(error),
    message: String((error && error.message) || error || '').slice(0, 120),
    hasArkApiKey: !!getEnv('ARK_API_KEY', ''),
    hasDeepSeekApiKey: !!getEnv('DEEPSEEK_API_KEY', ''),
    hasLocalArkEnv: !!readLocalEnv().ARK_API_KEY,
    hasLocalDeepSeekEnv: !!readLocalEnv().DEEPSEEK_API_KEY
  }, extra || {})
}

const ARK_API_BASE = getEnv('ARK_API_BASE', 'https://ark.cn-beijing.volces.com/api/coding/v3')
const ARK_MODEL = getEnv('ARK_MODEL', 'DeepSeek-V4-Flash')
const ARK_TIMEOUT_MS = Number(getEnv('ARK_TIMEOUT_MS', 45000))
const DEEPSEEK_API_BASE = getEnv('DEEPSEEK_API_BASE', 'https://api.deepseek.com')
const DEEPSEEK_MODEL = getEnv('DEEPSEEK_MODEL', 'deepseek-chat')
const DEEPSEEK_TIMEOUT_MS = Number(getEnv('DEEPSEEK_TIMEOUT_MS', ARK_TIMEOUT_MS))
const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const SMART_MODE_MARKED = 'schedule_marked'
const SMART_MODE_PICK = 'pick_and_schedule'
const TASK_CLASSIFY_INTENT = 'classifyIntent'
const TASK_PICK_FILMS = 'pickFilms'
const TASK_PARSE_PREFERENCES = 'parseSchedulePreferences'
const TASK_PARSE_SMART_REQUEST = 'parseSmartRequest'

function postJson(url, apiKey, body, options) {
  const config = options || {}
  const providerLabel = config.providerLabel || 'AI'
  const timeoutMs = Number(config.timeoutMs || ARK_TIMEOUT_MS)
  const target = new URL(url)
  const payload = JSON.stringify(body)

  return new Promise((resolve, reject) => {
    const request = https.request({
      method: 'POST',
      hostname: target.hostname,
      path: `${target.pathname}${target.search}`,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: timeoutMs
    }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`${providerLabel} API ${response.statusCode}: ${text.slice(0, 160)}`))
          return
        }
        try {
          resolve(JSON.parse(text))
        } catch (error) {
          reject(error)
        }
      })
    })

    request.on('timeout', () => {
      request.destroy(new Error(`${providerLabel} API timeout after ${timeoutMs}ms`))
    })
    request.on('error', reject)
    request.write(payload)
    request.end()
  })
}

function chatProviders(task) {
  const providers = [
    {
      key: 'ark',
      label: 'Ark',
      apiKey: getEnv('ARK_API_KEY', ''),
      apiBase: ARK_API_BASE,
      model: ARK_MODEL,
      timeoutMs: ARK_TIMEOUT_MS
    },
    {
      key: 'deepseek',
      label: 'DeepSeek',
      apiKey: getEnv('DEEPSEEK_API_KEY', ''),
      apiBase: DEEPSEEK_API_BASE,
      model: DEEPSEEK_MODEL,
      timeoutMs: DEEPSEEK_TIMEOUT_MS
    }
  ].filter(provider => provider.apiKey)
  return providers
}

async function callChatProvider(provider, requestBody) {
  const body = Object.assign({}, requestBody, {
    model: provider.model
  })
  const endpoint = `${provider.apiBase.replace(/\/$/, '')}/chat/completions`
  try {
    return await postJson(endpoint, provider.apiKey, body, {
      providerLabel: provider.label,
      timeoutMs: provider.timeoutMs
    })
  } catch (error) {
    if (!isResponseFormatUnsupported(error)) {
      throw error
    }
    const fallbackBody = Object.assign({}, body)
    delete fallbackBody.response_format
    return postJson(endpoint, provider.apiKey, fallbackBody, {
      providerLabel: provider.label,
      timeoutMs: provider.timeoutMs
    })
  }
}

function stripJsonFence(text) {
  return String(text || '')
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim()
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
  const number = Number(value)
  if (!Number.isFinite(number)) {
    return null
  }
  return Math.max(0, Math.min(10, Math.round(number * 10) / 10))
}

function sanitizeBusyRules(rules) {
  if (!Array.isArray(rules)) {
    return []
  }

  return rules
    .reduce((list, rule) => {
      const days = uniqueDays([]
        .concat(expandDayValue(rule.day))
        .concat(expandDayValue(rule.days))
        .concat(expandDayValue(rule.weekdays)))
      const start = clamp(rule.start, 0, 24 * 60)
      const end = clamp(rule.end, 0, 24 * 60)
      if (!days.length || start === null || end === null || end <= start) {
        return list
      }
      return list.concat(days.map(day => ({
        day,
        start,
        end,
        label: String(rule.label || '不可用').slice(0, 18)
      })))
    }, [])
}

function sanitizeStringList(items) {
  if (!Array.isArray(items)) {
    return []
  }

  const seen = {}
  return items
    .map(item => String(item || '').trim().slice(0, 24))
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

function isScheduleTerm(value) {
  const text = String(value || '').trim()
  return /^(周末|工作日|平日|平常|平时|周[一二三四五六日天]|星期[一二三四五六日天]|今天|明天|后天|上午|中午|下午|晚上|早上|夜场|白天)$/.test(text)
}

function sanitizeCinemaStringList(items) {
  return sanitizeStringList(items).filter(item => !isScheduleTerm(item))
}

function normalizeDayValue(value) {
  const text = String(value || '').trim()
  if (DAYS.includes(text)) {
    return text
  }
  const number = Number(text)
  if (Number.isInteger(number)) {
    if (number >= 1 && number <= 7) {
      return DAYS[number - 1]
    }
  }
  const lower = text.toLowerCase()
  const aliases = {
    monday: '周一',
    mon: '周一',
    tuesday: '周二',
    tue: '周二',
    wednesday: '周三',
    wed: '周三',
    thursday: '周四',
    thu: '周四',
    friday: '周五',
    fri: '周五',
    saturday: '周六',
    sat: '周六',
    sunday: '周日',
    sun: '周日'
  }
  return aliases[lower] || ''
}

function expandDayValue(value) {
  if (Array.isArray(value)) {
    return value.reduce((list, item) => list.concat(expandDayValue(item)), [])
  }
  const text = String(value || '').trim()
  if (/工作日|平日|平常|平时|weekday/i.test(text)) {
    return DAYS.slice(0, 5)
  }
  if (/周末|weekend/i.test(text)) {
    return DAYS.slice(5)
  }
  const day = normalizeDayValue(text)
  return day ? [day] : []
}

function uniqueDays(days) {
  const seen = {}
  return days
    .filter(day => DAYS.includes(day))
    .filter(day => {
      if (seen[day]) {
        return false
      }
      seen[day] = true
      return true
    })
}

function sanitizeDayList(items) {
  if (!Array.isArray(items)) {
    return []
  }

  return uniqueDays(items.reduce((list, item) => list.concat(expandDayValue(item)), []))
}

function sanitizeDayNumberMap(map, min, max) {
  if (!map || typeof map !== 'object') {
    return {}
  }

  return DAYS.reduce((next, day) => {
    const value = clamp(map[day], min, max)
    if (value !== null) {
      next[day] = value
    }
    return next
  }, {})
}

function sanitizeTargetCount(targetCount) {
  if (typeof targetCount === 'number' || (typeof targetCount === 'string' && targetCount.trim())) {
    const ideal = clamp(targetCount, 1, 80)
    return ideal === null ? null : {
      maximize: false,
      min: ideal,
      ideal,
      max: ideal
    }
  }
  if (!targetCount || typeof targetCount !== 'object') {
    return null
  }

  const maximize = !!targetCount.maximize
  const min = clamp(targetCount.min, 1, 80)
  const ideal = clamp(targetCount.ideal, 1, 80)
  const max = clamp(targetCount.max, 1, 80)
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

function sanitizeDayPreferences(dayPreferences) {
  if (!dayPreferences || typeof dayPreferences !== 'object') {
    return null
  }

  const result = {
    preferredDays: sanitizeDayList(dayPreferences.preferredDays),
    relaxedDays: sanitizeDayList(dayPreferences.relaxedDays),
    maxPerDayByDay: sanitizeDayNumberMap(dayPreferences.maxPerDayByDay, 1, 8),
    minGapByDay: sanitizeDayNumberMap(dayPreferences.minGapByDay, 0, 180)
  }
  if (!result.preferredDays.length && !result.relaxedDays.length && !Object.keys(result.maxPerDayByDay).length && !Object.keys(result.minGapByDay).length) {
    return null
  }
  return result
}

function hasTargetCountIntent(instruction) {
  const text = String(instruction || '')
  if (/尽量多|多看|能排多少排多少|越多越好|拉满|极限/.test(text) ||
    /[一二两三四五六七八九十\d]{1,3}\s*部(?:左右|上下|附近)?/.test(text) ||
    /(?:排|看|选|挑)(?:个|出)?\s*[一二两三四五六七八九十\d]{1,3}\s*部(?:左右|上下|附近)?/.test(text) ||
    /(?:最多|不超过|别超过|至多)\s*[一二两三四五六七八九十\d]{1,3}\s*场/.test(text) ||
    /(?:排|看|选|挑)(?:个|出)?\s*[一二两三四五六七八九十\d]{1,3}\s*(?:个|场)(?:左右|上下|附近)?/.test(text)) {
    return true
  }

  const sceneMatch = text.match(/(?:排|看|选|挑)(?:个|出)?\s*[一二两三四五六七八九十\d]{1,3}\s*(?:个|场)(?:左右|上下|附近)?/)
  if (!sceneMatch) {
    return false
  }
  const before = text.slice(Math.max(0, sceneMatch.index - 8), sceneMatch.index)
  return !/(每天|每日|每晚|一天|每一天)/.test(before)
}

function chineseNumberValue(text) {
  const value = String(text || '').trim()
  const direct = Number(value)
  if (Number.isFinite(direct)) {
    return direct
  }
  const map = {
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
  if (map[value]) {
    return map[value]
  }
  const tenMatch = value.match(/^十([一二三四五六七八九])?$/)
  if (tenMatch) {
    return 10 + (map[tenMatch[1]] || 0)
  }
  const compound = value.match(/^([一二两三四五六七八九])十([一二三四五六七八九])?$/)
  if (compound) {
    return (map[compound[1]] || 0) * 10 + (map[compound[2]] || 0)
  }
  return null
}

function parseCount(text, unit) {
  const pattern = new RegExp(`([一二两三四五六七八九十\\d]{1,3})\\s*${unit}`)
  const match = String(text || '').match(pattern)
  return match ? chineseNumberValue(match[1]) : null
}

function parseViewingCount(text) {
  const source = String(text || '')
  const exact = source.match(/(?:排|看|选|挑)(?:个|出)?\\s*([一二两三四五六七八九十\\d]{1,3})\\s*(?:个|部|场)/)
  if (exact) {
    return chineseNumberValue(exact[1])
  }
  const capped = source.match(/(?:最多|不超过|别超过|至多)\\s*([一二两三四五六七八九十\\d]{1,3})\\s*场/)
  if (capped) {
    return chineseNumberValue(capped[1])
  }
  return null
}

function parseAfterTimeMinutes(text) {
  const source = String(text || '')
  const match = source.match(/(?:(上午|早上|中午|下午|晚上|晚间|夜里)\s*)?([01]?\d|2[0-3]|[一二两三四五六七八九十])\s*(?::|：|点)\s*(\d{1,2})?\s*(?:以后|之后|后|开始|再看)/)
  if (!match) {
    return null
  }
  const period = match[1] || ''
  let hour = chineseNumberValue(match[2])
  const minute = match[3] === undefined || match[3] === '' ? 0 : Number(match[3])
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute < 0 || minute > 59) {
    return null
  }
  if (/下午|晚上|晚间|夜里/.test(period) && hour >= 1 && hour < 12) {
    hour += 12
  }
  if (/中午/.test(period) && hour >= 1 && hour < 11) {
    hour += 12
  }
  if (hour < 0 || hour > 23) {
    return null
  }
  return hour * 60 + minute
}

function appendUnique(list, values) {
  values.forEach(value => {
    if (value && !list.includes(value)) {
      list.push(value)
    }
  })
}

const SMART_FILM_GENRES = [
  '纪录片',
  '动画',
  '喜剧',
  '爱情',
  '恐怖',
  '惊悚',
  '悬疑',
  '犯罪',
  '家庭',
  '音乐',
  '科幻',
  '剧情',
  '动作',
  '传记',
  '历史',
  '战争',
  '短片',
  '儿童',
  '歌舞',
  '冒险',
  '奇幻',
  '运动'
]

const SMART_NEGATIVE_FILM_TERMS = ['恐怖', '惊悚', '暴力', '血腥']
const SMART_MEETUP_TERMS = ['映后', '见面', '主创', '嘉宾', '交流']

function splitCriteriaTerms(value) {
  return String(value || '')
    .split(/[、,，/;；\s]+/)
    .map(item => item.trim())
    .filter(Boolean)
}

function hasDirectNegation(text, term) {
  const escaped = String(term || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (!escaped) {
    return false
  }
  return new RegExp(`(?:不要|不想|不看|别|避开|排除)\\s*(?:看|要|选|排)?\\s*(?:${escaped})(?:片|电影)?`).test(text) ||
    new RegExp(`(?:不要|不想|不看|别|避开|排除)[^，。；,;]{0,12}(?:${escaped})(?:片|电影)?`).test(text) ||
    new RegExp(`(?:${escaped})(?:片|电影)?\\s*(?:不要|不想|不看|别了|避开|排除|算了|先算了|就算了|免了|不用了?)`).test(text)
}

function addCountryHints(criteria, text) {
  if (/日本|日影|日片/.test(text)) appendUnique(criteria.countries, ['日本'])
  if (/韩国|韩影|韩片/.test(text)) appendUnique(criteria.countries, ['韩国'])
  if (/法国|法影|法片/.test(text)) appendUnique(criteria.countries, ['法国'])
  if (/华语|国产|中国|内地/.test(text)) appendUnique(criteria.countries, ['中国'])
  if (/香港|港片/.test(text)) appendUnique(criteria.countries, ['中国香港'])
  if (/台湾|台片/.test(text)) appendUnique(criteria.countries, ['中国台湾'])
}

// Fallback-only parser for cases where the AI provider is unavailable or fails.
function scriptSmartRequest(instruction, options) {
  const text = String(instruction || '')
  const hasMarkedFilms = !!(options && options.hasMarkedFilms)
  const explicitAddFilms = /推荐|挑片|挑几部|帮我挑|补片|补几部|新增|加几部|没选|还没选|不知道看什么|从片单|随便推|适合.*电影/.test(text)
  const allowAddFilms = !hasMarkedFilms || explicitAddFilms
  const keepCurrentFilms = hasMarkedFilms && allowAddFilms && /再|补|加|不够|当前|现在|已选|标星|原来|已有|基础|保留|一起/.test(text)
  const currentFilmsFit = hasMarkedFilms && (!allowAddFilms || keepCurrentFilms)
  const filmCriteria = {
    countries: [],
    genres: [],
    sections: [],
    directors: [],
    casts: [],
    keywords: [],
    avoidKeywords: []
  }
  const preferences = {}

  addCountryHints(filmCriteria, text)
  SMART_FILM_GENRES.forEach(genre => {
    if (text.includes(genre) && !hasDirectNegation(text, genre)) appendUnique(filmCriteria.genres, [genre])
  })
  if (/女性|女人|女孩|少女|女儿|母亲|妈妈|她/.test(text)) appendUnique(filmCriteria.keywords, ['女性'])
  if (/修复|经典|4K/i.test(text)) appendUnique(filmCriteria.keywords, ['修复'])
  if (/轻松|治愈|温暖|暖心/.test(text)) appendUnique(filmCriteria.keywords, ['轻松'])
  if (/高分|口碑|评分/.test(text)) {
    appendUnique(filmCriteria.keywords, ['高分'])
    filmCriteria.minDoubanRating = 7.8
  }
  if (/冷门|小众/.test(text)) {
    appendUnique(filmCriteria.keywords, ['冷门'])
    filmCriteria.preferRare = true
  }
  if (/映后|见面|主创|嘉宾/.test(text)) {
    filmCriteria.preferMeetup = true
    preferences.meetupBonus = 60
  }
  SMART_NEGATIVE_FILM_TERMS.forEach(word => {
    if (hasDirectNegation(text, word)) appendUnique(filmCriteria.avoidKeywords, [word])
  })
  const runtimeMatch = text.match(/(\d{2,3})\s*分钟(?:以内|以下|内)/)
  if (runtimeMatch) {
    filmCriteria.maxRuntime = Number(runtimeMatch[1])
  } else if (/不太长|不要太长|短一点|短片长|别太长|时间短/.test(text)) {
    filmCriteria.maxRuntime = 120
  }
  const filmCount = parseCount(text, '部')
  if (filmCount) {
    filmCriteria.targetFilmCount = {
      maximize: false,
      min: filmCount,
      ideal: filmCount,
      max: filmCount
    }
  } else if (/几部|推荐|挑片|帮我挑|适合.*电影/.test(text)) {
    filmCriteria.targetFilmCount = {
      maximize: false,
      min: 3,
      ideal: 5,
      max: 8
    }
  }

  const sceneCount = parseCount(text, '场') || parseViewingCount(text)
  if (sceneCount && hasTargetCountIntent(text)) {
    preferences.targetCount = {
      maximize: false,
      min: sceneCount,
      ideal: sceneCount,
      max: sceneCount
    }
    preferences.maximizeCount = false
  }
  const maxPerDayMatch = text.match(/(?:一天|每天|每日)[^一二两三四五六七八九十\d]{0,8}(?:最多|不超过|别超过)?\s*([一二两三四五六七八九十\d]{1,2})\s*场/)
  if (maxPerDayMatch) {
    preferences.maxPerDay = chineseNumberValue(maxPerDayMatch[1])
  }
  if (/周末/.test(text)) {
    preferences.dayPreferences = Object.assign({}, preferences.dayPreferences || {}, {
      preferredDays: ['周六', '周日']
    })
  }
  if (/工作日|平日|平常|平时/.test(text)) {
    preferences.dayPreferences = Object.assign({}, preferences.dayPreferences || {}, {
      preferredDays: ['周一', '周二', '周三', '周四', '周五']
    })
  }
  DAYS.forEach(day => {
    if (text.includes(day)) {
      const current = preferences.dayPreferences || {}
      preferences.dayPreferences = Object.assign({}, current, {
        preferredDays: Array.from(new Set([].concat(current.preferredDays || [], day)))
      })
    }
  })
  if (/别太紧|不要太紧|太赶|别太赶|不要太赶|宽松|休息|吃饭|留时间/.test(text)) {
    preferences.minGap = /吃饭/.test(text) ? 90 : 60
  }
  const afterMinutes = parseAfterTimeMinutes(text)
  if (/早上|太早|别太早|不要太早/.test(text)) {
    preferences.avoidMorningBefore = 10 * 60
  }
  if (/太晚|别太晚|不要太晚|早回/.test(text)) {
    preferences.avoidLateAfter = 23 * 60
  }
  const cinemaMatch = text.match(/(?:优先|只去|只看|尽量在)\s*([A-Za-z0-9\u4e00-\u9fa5·.\s-]{2,30}?)(?:影院|影城|电影城|IMAX|，|,|。|；|;|$)/)
  if (cinemaMatch) {
    const cinema = cinemaMatch[1].trim()
    if (/只去|只看/.test(cinemaMatch[0])) {
      preferences.onlyCinemas = [cinema]
    } else {
      preferences.preferredCinemas = [cinema]
    }
  }
  if (/少换|别折腾|少移动|同影院|同一个影院/.test(text)) {
    preferences.sameCinemaBonus = 40
    preferences.cinemaSwitchPenalty = 60
  }
  if (afterMinutes !== null) {
    const hour = Math.floor(afterMinutes / 60)
    const minute = afterMinutes % 60
    const day = /工作日|平日|平常|平时/.test(text) ? '工作日' : DAYS.find(item => text.includes(item)) || '工作日'
    preferences.busyRules = [{ day, start: 0, end: afterMinutes, label: `${hour}:${String(minute).padStart(2, '0')}前不可用` }]
  }

  return {
    task: TASK_PARSE_SMART_REQUEST,
    mode: allowAddFilms ? SMART_MODE_PICK : SMART_MODE_MARKED,
    currentFilmsFit,
    allowAddFilms,
    keepCurrentFilms,
    filmCriteria: filmSelection.normalizeFilmCriteria(filmCriteria),
    preferences: sanitizeSchedulePreferencesPayload({ preferences }, { instruction }).preferences
  }
}

function sanitizeFilmCatalog(films) {
  if (!Array.isArray(films)) {
    return []
  }

  return films
    .map(film => {
      const id = String((film && film.id) || '').trim()
      const title = String((film && (film.title || film.cnTitle)) || '').trim().slice(0, 36)
      if (!id || !title) {
        return null
      }
      const item = {
        id,
        title
      }
      ;[
        ['enTitle', 42],
        ['section', 32],
        ['director', 32],
        ['country', 24],
        ['genre', 32],
        ['recommendation', 90]
      ].forEach(([key, limit]) => {
        const value = String((film && film[key]) || '').trim().slice(0, limit)
        if (value) {
          item[key] = value
        }
      })
      const year = clamp(film && film.year, 1800, 2100)
      const runtime = clamp(film && film.runtime, 1, 600)
      const doubanRating = clampRating(film && film.doubanRating)
      const doubanRatingCount = clamp(film && film.doubanRatingCount, 0, 10000000)
      const imdbRating = clampRating(film && film.imdbRating)
      const screeningCount = clamp(film && film.screeningCount, 0, 100)
      if (year !== null) {
        item.year = year
      }
      if (runtime !== null) {
        item.runtime = runtime
      }
      if (doubanRating !== null) {
        item.doubanRating = doubanRating
      }
      if (doubanRatingCount !== null) {
        item.doubanRatingCount = doubanRatingCount
      }
      if (imdbRating !== null) {
        item.imdbRating = imdbRating
      }
      if (screeningCount !== null) {
        item.screeningCount = screeningCount
      }
      return item
    })
    .filter(Boolean)
}

function sanitizeFilmIds(ids, allowedFilmIds) {
  if (!Array.isArray(ids)) {
    return []
  }

  const seen = {}
  return ids
    .map(id => String(id || '').trim())
    .filter(id => id && allowedFilmIds[id])
    .filter(id => {
      if (seen[id]) {
        return false
      }
      seen[id] = true
      return true
    })
    .slice(0, 80)
}

function sanitizeFilmWeights(weights, allowedFilmIds) {
  if (!weights || typeof weights !== 'object') {
    return {}
  }

  return Object.keys(weights).reduce((map, id) => {
    const filmId = String(id || '').trim()
    const weight = clamp(weights[id], 0, 100)
    if (filmId && allowedFilmIds[filmId] && weight !== null && weight > 0) {
      map[filmId] = weight
    }
    return map
  }, {})
}

function normalizeTask(task) {
  if (task === TASK_PARSE_SMART_REQUEST || task === TASK_PICK_FILMS || task === TASK_PARSE_PREFERENCES) {
    return task
  }
  return TASK_CLASSIFY_INTENT
}

function sanitizeSchedulePreferencesPayload(payload, options) {
  const input = payload && typeof payload === 'object' ? payload : {}
  const preferences = input.preferences && typeof input.preferences === 'object' ? Object.assign({}, input.preferences) : Object.assign({}, input)
  if (!preferences.targetCount && preferences.targetScreeningCount) {
    preferences.targetCount = preferences.targetScreeningCount
  }
  if (!preferences.dayPreferences) {
    const dayPreferences = {}
    ;['preferredDays', 'relaxedDays', 'maxPerDayByDay', 'minGapByDay'].forEach(key => {
      if (preferences[key] !== undefined) {
        dayPreferences[key] = preferences[key]
      }
    })
    if (Object.keys(dayPreferences).length) {
      preferences.dayPreferences = dayPreferences
    }
  }
  const result = {}
  const numberFields = [
    ['maxPerDay', 1, 8],
    ['minGap', 0, 120],
    ['sameCinemaBonus', 0, 60],
    ['cinemaSwitchPenalty', 0, 80],
    ['meetupBonus', 0, 80],
    ['rareBonus', 0, 80],
    ['avoidMorningBefore', 0, 24 * 60],
    ['avoidLateAfter', 0, 24 * 60]
  ]

  numberFields.forEach(([key, min, max]) => {
    const value = clamp(preferences[key], min, max)
    if (value !== null) {
      result[key] = value
    }
  })

  result.busyRules = sanitizeBusyRules(preferences.busyRules)
  const targetCount = sanitizeTargetCount(preferences.targetCount)
  if (targetCount) {
    result.targetCount = targetCount
    result.maximizeCount = !!targetCount.maximize
  }
  if (preferences.maximizeCount) {
    result.maximizeCount = true
    if (!result.targetCount) {
      result.targetCount = { maximize: true }
    }
  }
  const dayPreferences = sanitizeDayPreferences(preferences.dayPreferences)
  if (dayPreferences) {
    result.dayPreferences = dayPreferences
  }
  ;[
    'onlyCinemas',
    'preferredCinemas',
    'avoidCinemas'
  ].forEach(key => {
    const values = sanitizeCinemaStringList(preferences[key])
    if (values.length) {
      result[key] = values
    }
  })
  ;[
    'preferredSections',
    'avoidSections',
    'preferredKeywords',
    'avoidKeywords'
  ].forEach(key => {
    const values = sanitizeStringList(preferences[key])
    if (values.length) {
      result[key] = values
    }
  })

  return {
    task: TASK_PARSE_PREFERENCES,
    preferences: result
  }
}

function sanitizeIntentPayload(payload, options) {
  const input = payload && typeof payload === 'object' ? payload : {}
  const hasMarkedFilms = !!(options && options.hasMarkedFilms)
  const allowAddFilms = !hasMarkedFilms || input.allowAddFilms === true
  return {
    task: TASK_CLASSIFY_INTENT,
    mode: allowAddFilms ? SMART_MODE_PICK : SMART_MODE_MARKED,
    allowAddFilms
  }
}

function sanitizeFilmPickPayload(payload, options) {
  const input = payload && typeof payload === 'object' ? payload : {}
  const allowedFilmIds = (options && options.allowedFilmIds) || {}
  return {
    task: TASK_PICK_FILMS,
    selectedFilmIds: sanitizeFilmIds(input.selectedFilmIds, allowedFilmIds),
    filmWeights: sanitizeFilmWeights(input.filmWeights, allowedFilmIds)
  }
}

function canonicalCountryTerm(term) {
  const text = String(term || '').trim()
  if (!text) return ''
  if (/日本|日影|日片/.test(text)) return '日本'
  if (/韩国|韩影|韩片/.test(text)) return '韩国'
  if (/法国|法影|法片/.test(text)) return '法国'
  if (/香港|港片/.test(text)) return '中国香港'
  if (/台湾|台片/.test(text)) return '中国台湾'
  if (/华语|国产|中国|内地/.test(text)) return '中国'
  return ''
}

function canonicalGenreTerm(term) {
  const text = String(term || '').trim()
  return SMART_FILM_GENRES.find(genre => text === genre || text === `${genre}片` || text === `${genre}电影`) || ''
}

function normalizeFilmCriteriaBuckets(criteria) {
  const source = criteria && typeof criteria === 'object' ? criteria : {}
  const next = Object.assign({}, source, {
    countries: Array.isArray(source.countries) ? source.countries.slice() : [],
    genres: Array.isArray(source.genres) ? source.genres.slice() : [],
    keywords: [],
    avoidKeywords: Array.isArray(source.avoidKeywords) ? source.avoidKeywords.slice() : []
  })

  ;(Array.isArray(source.keywords) ? source.keywords : []).forEach(keyword => {
    const terms = splitCriteriaTerms(keyword)
    let moved = false
    terms.forEach(term => {
      const genre = canonicalGenreTerm(term)
      const country = canonicalCountryTerm(term)
      if (genre) {
        appendUnique(next.genres, [genre])
        moved = true
      } else if (country) {
        appendUnique(next.countries, [country])
        moved = true
      } else if (SMART_MEETUP_TERMS.some(word => term.includes(word))) {
        next.preferMeetup = true
        moved = true
      } else if (/修复.*经典|经典.*修复/.test(term)) {
        appendUnique(next.keywords, ['修复', '经典'])
        moved = true
      }
    })
    if (!moved) {
      appendUnique(next.keywords, [keyword])
    }
  })

  const normalized = filmSelection.normalizeFilmCriteria(next)
  if (normalized.avoidKeywords.length && normalized.genres.length) {
    normalized.genres = normalized.genres.filter(genre => {
      return !normalized.avoidKeywords.some(keyword => {
        return genre === keyword || genre.includes(keyword) || keyword.includes(genre)
      })
    })
  }
  return normalized
}

function sanitizeSmartRequestPayload(payload, options) {
  const input = payload && typeof payload === 'object' ? payload : {}
  const hasMarkedFilms = !!(options && options.hasMarkedFilms)
  // Successful AI responses are sanitized only; do not merge scriptSmartRequest hints here.
  const allowInput = input.allowAddFilms !== undefined ? input.allowAddFilms : input.shouldExpandFilms
  const hasCurrentFilmsFitInput = input.currentFilmsFit === true || input.currentFilmsFit === false
  const currentFilmsFit = hasMarkedFilms ? input.currentFilmsFit === true : false
  let allowAddFilms = false
  if (!hasMarkedFilms) {
    allowAddFilms = true
  } else if (allowInput !== undefined) {
    allowAddFilms = allowInput === true
  } else if (hasCurrentFilmsFitInput) {
    allowAddFilms = currentFilmsFit === false
  }
  let keepCurrentFilms = hasMarkedFilms && allowAddFilms && input.keepCurrentFilms === true
  if (!allowAddFilms) {
    keepCurrentFilms = false
  }
  const filmCriteria = normalizeFilmCriteriaBuckets(
    input.filmCriteria || input.filmSelection || input.filmFilters || {}
  )
  const preferencesInput = input.screeningCriteria || input.screeningRules || input.preferences || {}
  const preferences = sanitizeSchedulePreferencesPayload({ preferences: preferencesInput }, options).preferences
  return {
    task: TASK_PARSE_SMART_REQUEST,
    mode: allowAddFilms ? SMART_MODE_PICK : SMART_MODE_MARKED,
    currentFilmsFit,
    allowAddFilms,
    keepCurrentFilms,
    filmCriteria,
    preferences
  }
}

function buildFilmLines(films) {
  return films.map(film => {
    return [
      `id=${film.id}`,
      `片名=${film.title}`,
      film.enTitle ? `外文=${film.enTitle}` : '',
      film.section ? `单元=${film.section}` : '',
      film.director ? `导演=${film.director}` : '',
      film.country ? `国家=${film.country}` : '',
      film.year ? `年份=${film.year}` : '',
      film.runtime ? `片长=${film.runtime}分钟` : '',
      film.genre ? `类型=${film.genre}` : '',
      film.recommendation ? `官方推荐语=${film.recommendation}` : '',
      film.doubanRating ? `豆瓣=${film.doubanRating}` : '',
      film.doubanRatingCount ? `豆瓣人数=${film.doubanRatingCount}` : '',
      film.imdbRating ? `IMDb=${film.imdbRating}` : '',
      film.screeningCount !== undefined ? `可选场次数=${film.screeningCount}` : ''
    ].filter(Boolean).join('；')
  })
}

function buildIntentMessages(instruction, context) {
  const hasMarkedFilms = !!(context && context.hasMarkedFilms)

  return [
    {
      role: 'system',
      content: [
        '你是电影节智能排片的意图分类器。只输出 JSON，不输出解释。',
        `上下文：已有标星影片=${hasMarkedFilms ? '有' : '没有'}。`,
        `mode=${SMART_MODE_MARKED} 表示只排已标星影片；mode=${SMART_MODE_PICK} 表示允许先选/补影片再排片。`,
        '已有标星且用户没有明确选片/补片/推荐意图时，allowAddFilms=false。',
        '没有标星时，allowAddFilms=true。',
        '影院、日期、时间、数量、路线、松紧、场次类型，只是排片偏好，不等于选片/补片。'
      ].join('\n')
    },
    {
      role: 'user',
      content: [
        '输出 JSON 结构：',
        '{"mode":"schedule_marked","allowAddFilms":false}',
        '',
        `用户偏好：${instruction}`
      ].join('\n')
    }
  ]
}

function buildSchedulePreferenceMessages(instruction) {
  return [
    {
      role: 'system',
      content: [
        '你是电影节排片参数解析器。只输出 JSON，不输出解释。',
        '任务：把用户一句话转换成 preferences；不要判断是否补片，不要返回影片 id。',
        '读完整句话，可以同时填写多个字段；没提到的字段不要输出，不要为了填格式输出 null。',
        '周几只用周一到周日。工作日=周一至周五，平常/平日也按工作日处理；周末=周六周日。时间用当天 0 点后的分钟数，例如 19:00=1140。',
        'targetCount：用户表达总片数目标时填写；精确数量、范围、无具体数字但希望总量最大化，都属于总量目标。',
        'maxPerDay：用户表达每天数量上限时填写；如果只限定某些周几，用 dayPreferences.maxPerDayByDay。',
        'dayPreferences：preferredDays 是日期偏好，relaxedDays 是希望这些天节奏更松；minGapByDay/maxPerDayByDay 是按周几覆盖全局规则。',
        'busyRules：用户表达不可用时间或只能在某时之后看时填写，是硬约束，格式 [{day,start,end,label}]。',
        'minGap：用户表达观影节奏、餐饮、休息、缓冲或两场之间不要太紧时填写；即使没有具体分钟数，也要给出合理正数。普通“别太赶/别太紧”给 60；“吃饭/吃饭时间/吃饭时间留出来”给 90。',
        'avoidMorningBefore / avoidLateAfter：用户表达不喜欢太早或太晚但不是硬性不可用时填写，是软偏好。',
        'onlyCinemas：用户表达只接受某些影院时填写。preferredCinemas / avoidCinemas：用户表达影院软偏好或软规避时填写。',
        'preferredSections / avoidSections：只在用户表达明确的电影节正式单元偏好时填写；不能确认是正式单元时不要放这里。',
        'preferredKeywords / avoidKeywords：不是影院名或正式单元名的内容、风格、主题、评分、导演特征、国家地区、类型、票种、活动、区域等偏好或规避项。',
        'sameCinemaBonus / cinemaSwitchPenalty：用户表达少移动、少换影院或不想折腾时填写，数值越大表示越强调。meetupBonus：用户表达偏好特殊活动场次时填写。rareBonus：用户表达偏好机会少的影片或场次时填写。',
        '标星、已选、未选、帮我排、帮我挑只是操作语境，不是影片关键词。'
      ].join('\n')
    },
    {
      role: 'user',
      content: [
        '输出 JSON，只包含命中的字段。targetCount 必须是对象；busyRules.day 必须是周一到周日。',
        '示例：{"preferences":{"targetCount":{"min":8,"ideal":10,"max":12,"maximize":false},"minGap":90,"busyRules":[{"day":"周一","start":0,"end":1140,"label":"不可用"}],"dayPreferences":{"preferredDays":["周六","周日"]}}}',
        '',
        `用户偏好：${instruction}`
      ].join('\n')
    }
  ]
}

function buildSmartRequestMessages(instruction, context) {
  const hasMarkedFilms = !!(context && context.hasMarkedFilms)
  const currentFilms = sanitizeFilmCatalog(context && context.currentFilms)
  const currentFilmLines = buildFilmLines(currentFilms)

  return [
    {
      role: 'system',
      content: [
        '你是电影节智能排片的需求解析器。只输出 JSON，不输出解释，不要返回影片 id 或场次 id。',
        `上下文：用户已有影片池=${hasMarkedFilms ? '有' : '没有'}。`,
        '你会看到用户当前标星/已选影片摘要。先判断这些当前影片是否能满足用户这句话的影片需求，再决定是否需要新增影片。',
        'currentFilmsFit：当前已有影片池是否应该继续作为这次方案的基础。若用户只是在说排场次、时间、影院、松紧、路线，且已有影片池不为空，currentFilmsFit=true。若用户说“不够/再补/加几部/在当前基础上/保留已选/一起排”，表示当前影片仍是方案基础，currentFilmsFit=true。若用户是在重新要一批新推荐，例如高分恐怖片、日影、女性向、纪录片等，而当前影片明显不符合，currentFilmsFit=false。',
        'allowAddFilms：是否需要从全片库新增候选影片。没有已有影片池时必须为 true。当前影片不满足需求、用户明确要求推荐/挑几部/补几部/新增/换一批/不知道看什么时为 true。只是在当前影片上排场次或筛选时为 false。',
        'keepCurrentFilms：只有 allowAddFilms=true 时才有意义。若用户表达“再补/不够/加几部/在当前基础上/保留已选/一起排”，表示当前影片要无条件保留，keepCurrentFilms=true。若用户是在重新推荐一批，例如“给我推荐几个高分恐怖片/换一批轻松的”，keepCurrentFilms=false；当前影片若也符合 filmCriteria，后续脚本会自然把它选回来，不需要你保留。',
        '当 keepCurrentFilms=true 时，filmCriteria 描述要新增/补充的影片，不用拿它反向排除当前影片；当前影片已经由 keepCurrentFilms 保留。',
        'filmCriteria 是选片/筛片参数：countries 国家地区；genres 类型，例如 纪录片/动画/喜剧/恐怖；sections 单元；directors 导演；casts 演员；keywords 主题/风格/人群/品质，例如 女性/高分/修复/经典/轻松/冷门；avoidKeywords 明确不想看的主题/类型；minDoubanRating/minImdbRating 评分下限；maxRuntime/minRuntime 片长；targetFilmCount 想推荐或纳入候选的电影数量；preferRare 偏冷门；preferMeetup 偏映后/主创/嘉宾活动。',
        'preferences 是选场次/排片参数：targetCount 最终排几场；maxPerDay 每天最多几场；dayPreferences 日期偏好；busyRules 硬不可用时间；minGap 场次间隔；avoidMorningBefore/avoidLateAfter 不想太早/太晚；onlyCinemas/preferredCinemas/avoidCinemas 影院；sameCinemaBonus/cinemaSwitchPenalty 少换影院；meetupBonus 偏活动场；rareBonus 偏稀缺场。busyRules 每条必须带 day 或 days 或 weekdays。',
        '时间用当天 0 点后的分钟数，例如 19:00=1140。周几只用周一到周日，周末=周六周日，工作日=周一至周五。',
        'filmCriteria.targetFilmCount 表示想推荐/纳入候选的电影数量；preferences.targetCount 表示最终排几场。',
        '“最多/不超过/别超过 N 场”且没有“每天/一天”修饰时，表示 preferences.targetCount.max=N，不是 maxPerDay。只有“每天/一天/每日最多 N 场”才填 maxPerDay。',
        '“挑一个/选一个/看一部/排一场”表示 preferences.targetCount 精确为 1；“两三场/四五场/3到5场”表示 preferences.targetCount 范围。',
        '“纪录片/动画/喜剧/恐怖/惊悚/悬疑/爱情/犯罪/家庭/音乐/科幻/剧情”必须放 genres，不要放 keywords。“日影/韩国/法国/华语/香港/台湾”放 countries。',
        '否定类型只放 avoidKeywords，不要同时放 genres。例如“恐怖算了/不要血腥恐怖/不要恐怖惊悚”只能放 avoidKeywords，不要放 genres=["恐怖"] 或 genres=["惊悚"]。',
        '“映后/主创/嘉宾/见面”放 filmCriteria.preferMeetup=true，若用户是在说排场次偏好，也可同时给 preferences.meetupBonus。',
        '“不要恐怖/避开惊悚/不想血腥/恐怖先算了”放 filmCriteria.avoidKeywords，不要放 genres。“不要太长/短一点/120分钟以内”放 filmCriteria.maxRuntime。“别太晚/不要太早”放 preferences.avoidLateAfter/avoidMorningBefore。“太赶/别太赶/不要太赶/别太紧”放 preferences.minGap，至少 60；“吃饭时间留出来”放 preferences.minGap=90。',
        '“X点以后/之后/后/开始/才有空/才能看/再看”放 busyRules，表示 X 点前不可用。若用户没有说周几，用 days=["周一","周二","周三","周四","周五","周六","周日"]。例如“下午三点以后才有空”=> busyRules days=全周,start=0,end=900；“晚上七点后再看”=> days=全周,end=1140；“周六下午开始”且没有具体点数时，day="周六",start=0,end=720。',
        '如果用户说“适合女性看的电影”，放 filmCriteria.keywords=["女性"]，由后续选片器判断候选，不要编造具体影片。',
        '输出字段只能是 currentFilmsFit、allowAddFilms、keepCurrentFilms、filmCriteria、preferences。没提到的字段不要输出。'
      ].join('\n')
    },
    {
      role: 'user',
      content: [
        '输出 JSON 示例 1：',
        '{"currentFilmsFit":false,"allowAddFilms":true,"keepCurrentFilms":false,"filmCriteria":{"countries":["日本"],"genres":["纪录片"],"keywords":["高分"],"minDoubanRating":7.5,"targetFilmCount":{"min":3,"ideal":5,"max":8,"maximize":false}},"preferences":{"dayPreferences":{"preferredDays":["周六","周日"]},"maxPerDay":3,"minGap":60}}',
        '输出 JSON 示例 2：',
        '{"currentFilmsFit":true,"allowAddFilms":false,"keepCurrentFilms":false,"filmCriteria":{"avoidKeywords":["恐怖"],"maxRuntime":120},"preferences":{"avoidLateAfter":1380,"sameCinemaBonus":40,"cinemaSwitchPenalty":60}}',
        '输出 JSON 示例 3：',
        '{"currentFilmsFit":true,"allowAddFilms":true,"keepCurrentFilms":true,"filmCriteria":{"genres":["纪录片"],"targetFilmCount":{"min":2,"ideal":4,"max":6,"maximize":false}},"preferences":{}}',
        '示例 3 对应“标星的不够，再推荐几部纪录片”：即使当前标星片本身不是纪录片，也要 currentFilmsFit=true、keepCurrentFilms=true，因为用户是在当前方案基础上补片。',
        '',
        '用户当前标星/已选影片：',
        currentFilmLines.length ? currentFilmLines.join('\n') : '无',
        '',
        `用户偏好：${instruction}`
      ].join('\n')
    }
  ]
}

function buildFilmPickMessages(instruction, context) {
  const films = context && context.films ? context.films : []
  const filmLines = buildFilmLines(films)

  return [
    {
      role: 'system',
      content: [
        '你是电影节选片助手。只输出 JSON，不输出解释。',
        '只从候选影片列表中选择适合用户偏好的电影；不要解析排片时间、影院路线或场次参数。',
        '根据片名、导演、单元、类型、评分、推荐语和可选场次数判断用户说的高分、冷门、作者性、经典修复等选片偏好。',
        'selectedFilmIds 最多 40 个，只能使用列表里的 id。',
        'filmWeights 是 id 到 0-100 的推荐权重，只给 selectedFilmIds 中的 id。',
        '不要选择可选场次数为 0 的影片，不要编造影片 id。'
      ].join('\n')
    },
    {
      role: 'user',
      content: [
        '输出 JSON 结构：',
        '{"selectedFilmIds":["film_id"],"filmWeights":{"film_id":92}}',
        '',
        `用户偏好：${instruction}`,
        '',
        '候选影片列表：',
        filmLines.length ? filmLines.join('\n') : '未提供'
      ].join('\n')
    }
  ]
}

function buildMessages(task, instruction, context) {
  if (task === TASK_PARSE_SMART_REQUEST) {
    return buildSmartRequestMessages(instruction, context)
  }
  if (task === TASK_PICK_FILMS) {
    return buildFilmPickMessages(instruction, context)
  }
  if (task === TASK_PARSE_PREFERENCES) {
    return buildSchedulePreferenceMessages(instruction)
  }
  return buildIntentMessages(instruction, context)
}

function sanitizeTaskPayload(task, payload, options) {
  if (task === TASK_PARSE_SMART_REQUEST) {
    return sanitizeSmartRequestPayload(payload, options)
  }
  if (task === TASK_PICK_FILMS) {
    return sanitizeFilmPickPayload(payload, options)
  }
  if (task === TASK_PARSE_PREFERENCES) {
    return sanitizeSchedulePreferencesPayload(payload, options)
  }
  return sanitizeIntentPayload(payload, options)
}

function fallbackForTask(task, options) {
  const hasMarkedFilms = !!(options && options.hasMarkedFilms)
  const instruction = String((options && options.instruction) || '')
  if (task === TASK_PARSE_SMART_REQUEST) {
    return scriptSmartRequest(instruction, { hasMarkedFilms, currentFilms: options && options.currentFilms })
  }
  if (task === TASK_PICK_FILMS) {
    return {
      task,
      selectedFilmIds: [],
      filmWeights: {}
    }
  }
  if (task === TASK_PARSE_PREFERENCES) {
    return {
      task,
      preferences: {}
    }
  }
  const allowAddFilms = !hasMarkedFilms
  return {
    task: TASK_CLASSIFY_INTENT,
    mode: allowAddFilms ? SMART_MODE_PICK : SMART_MODE_MARKED,
    allowAddFilms
  }
}

function maxTokensForTask(task, filmCount) {
  if (task === TASK_PARSE_SMART_REQUEST) {
    return 1200
  }
  if (task === TASK_PICK_FILMS) {
    return filmCount ? 4096 : 600
  }
  if (task === TASK_PARSE_PREFERENCES) {
    return 1800
  }
  return 400
}

async function parsePreference(event) {
  const instruction = String((event && event.instruction) || '').trim().slice(0, 500)
  const task = normalizeTask(event && event.task)
  const films = sanitizeFilmCatalog(event && event.films)
  const currentFilms = sanitizeFilmCatalog(event && event.currentFilms)
  const allowedFilmIds = films.reduce((map, film) => {
    map[film.id] = true
    return map
  }, {})
  const hasMarkedFilms = !!(event && event.hasMarkedFilms)
  if (!instruction) {
    return Object.assign(fallbackForTask(task, { hasMarkedFilms, instruction, currentFilms }), { source: 'script' })
  }

  const providers = chatProviders(task)
  if (!providers.length) {
    return Object.assign(fallbackForTask(task, { hasMarkedFilms, instruction, currentFilms }), {
      source: 'fallback',
      errorCode: 'missing_api_key',
      debug: safeDebug('missing_api_key')
    })
  }

  try {
    const requestBody = {
      messages: buildMessages(task, instruction, { films, currentFilms, hasMarkedFilms }),
      temperature: 0.1,
      max_tokens: maxTokensForTask(task, films.length),
      response_format: { type: 'json_object' }
    }
    let sanitized = null
    let providerUsed = null
    const failures = []
    for (const provider of providers) {
      try {
        const data = await callChatProvider(provider, requestBody)
        const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
        const parsed = JSON.parse(stripJsonFence(content))
        sanitized = sanitizeTaskPayload(task, parsed, { allowedFilmIds, hasMarkedFilms, instruction, currentFilms })
        providerUsed = provider
        break
      } catch (error) {
        failures.push({
          provider: provider.key,
          code: errorCode(error),
          message: String((error && error.message) || error || '').slice(0, 120)
        })
        console.warn('[parsePreference] provider failed', safeDebug(error, {
          provider: provider.key,
          model: provider.model,
          baseHost: (() => {
            try {
              return new URL(provider.apiBase).hostname
            } catch (error) {
              return ''
            }
          })()
        }))
      }
    }
    if (!sanitized || !providerUsed) {
      const lastFailure = failures[failures.length - 1]
      throw new Error(lastFailure ? `${lastFailure.provider} ${lastFailure.code}: ${lastFailure.message}` : 'all providers failed')
    }

    return Object.assign({}, sanitized, {
      source: 'ai',
      provider: providerUsed.key,
      model: providerUsed.model
    })
  } catch (error) {
    console.error('[parsePreference] AI failed', safeDebug(error))
    return Object.assign(fallbackForTask(task, { hasMarkedFilms, instruction, currentFilms }), {
      source: 'fallback',
      errorCode: errorCode(error),
      debug: safeDebug(error)
    })
  }
}

module.exports = {
  parsePreference,
  TASK_CLASSIFY_INTENT,
  TASK_PICK_FILMS,
  TASK_PARSE_PREFERENCES,
  TASK_PARSE_SMART_REQUEST,
  SMART_MODE_MARKED,
  SMART_MODE_PICK
}
