const https = require('https')
const fs = require('fs')
const path = require('path')
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

let localEnvCache = null

function readLocalEnv() {
  if (localEnvCache) {
    return localEnvCache
  }

  localEnvCache = {}
  try {
    const text = fs.readFileSync(path.join(__dirname, '.env'), 'utf8')
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

function chatProviders() {
  return [
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
    /(?:排|看|选|挑)(?:个|出)?\s*[一二两三四五六七八九十\d]{1,3}\s*部(?:左右|上下|附近)?/.test(text)) {
    return true
  }

  const sceneMatch = text.match(/(?:排|看|选|挑)(?:个|出)?\s*[一二两三四五六七八九十\d]{1,3}\s*场(?:左右|上下|附近)?/)
  if (!sceneMatch) {
    return false
  }
  const before = text.slice(Math.max(0, sceneMatch.index - 8), sceneMatch.index)
  return !/(周末|工作日|平日|平常|平时|每天|一天|周[一二三四五六日天]|星期[一二三四五六日天])/.test(before)
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
  return task === TASK_PICK_FILMS || task === TASK_PARSE_PREFERENCES ? task : TASK_CLASSIFY_INTENT
}

function sanitizeSchedulePreferencesPayload(payload, options) {
  const input = payload && typeof payload === 'object' ? payload : {}
  const preferences = input.preferences && typeof input.preferences === 'object' ? input.preferences : input
  const instruction = String((options && options.instruction) || '')
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
  if (hasTargetCountIntent(instruction)) {
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
  }
  const dayPreferences = sanitizeDayPreferences(preferences.dayPreferences)
  if (dayPreferences) {
    result.dayPreferences = dayPreferences
  }
  ;[
    'onlyCinemas',
    'preferredCinemas',
    'avoidCinemas',
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
        'minGap：用户表达观影节奏、餐饮、休息、缓冲或两场之间不要太紧时填写；即使没有具体分钟数，也要给出合理正数。',
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
  if (task === TASK_PICK_FILMS) {
    return buildFilmPickMessages(instruction, context)
  }
  if (task === TASK_PARSE_PREFERENCES) {
    return buildSchedulePreferenceMessages(instruction)
  }
  return buildIntentMessages(instruction, context)
}

function sanitizeTaskPayload(task, payload, options) {
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
  if (task === TASK_PICK_FILMS) {
    return filmCount ? 4096 : 600
  }
  if (task === TASK_PARSE_PREFERENCES) {
    return 1800
  }
  return 400
}

exports.main = async event => {
  const instruction = String((event && event.instruction) || '').trim().slice(0, 500)
  const task = normalizeTask(event && event.task)
  const films = sanitizeFilmCatalog(event && event.films)
  const allowedFilmIds = films.reduce((map, film) => {
    map[film.id] = true
    return map
  }, {})
  const hasMarkedFilms = !!(event && event.hasMarkedFilms)
  if (!instruction) {
    return Object.assign(fallbackForTask(task, { hasMarkedFilms }), { source: 'script' })
  }

  const providers = chatProviders()
  if (!providers.length) {
    return Object.assign(fallbackForTask(task, { hasMarkedFilms }), {
      source: 'fallback',
      errorCode: 'missing_api_key',
      debug: safeDebug('missing_api_key')
    })
  }

  try {
    const requestBody = {
      messages: buildMessages(task, instruction, { films, hasMarkedFilms }),
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
        sanitized = sanitizeTaskPayload(task, parsed, { allowedFilmIds, hasMarkedFilms, instruction })
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
    return Object.assign(fallbackForTask(task, { hasMarkedFilms }), {
      source: 'fallback',
      errorCode: errorCode(error),
      debug: safeDebug(error)
    })
  }
}
