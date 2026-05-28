const https = require('https')
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const ARK_API_BASE = process.env.ARK_API_BASE || 'https://ark.cn-beijing.volces.com/api/coding/v3'
const ARK_MODEL = process.env.ARK_MODEL || 'DeepSeek-V4-Pro'
const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const SMART_MODE_MARKED = 'schedule_marked'
const SMART_MODE_PICK = 'pick_and_schedule'

function postJson(url, apiKey, body) {
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
      timeout: 12000
    }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`Ark API ${response.statusCode}: ${text.slice(0, 160)}`))
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
      request.destroy(new Error('Ark API timeout'))
    })
    request.on('error', reject)
    request.write(payload)
    request.end()
  })
}

function stripJsonFence(text) {
  return String(text || '')
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim()
}

function clamp(value, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) {
    return null
  }
  return Math.max(min, Math.min(max, Math.round(number)))
}

function sanitizeBusyRules(rules) {
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
        ['intro', 56]
      ].forEach(([key, limit]) => {
        const value = String((film && film[key]) || '').trim().slice(0, limit)
        if (value) {
          item[key] = value
        }
      })
      const year = clamp(film && film.year, 1800, 2100)
      const runtime = clamp(film && film.runtime, 1, 600)
      if (year !== null) {
        item.year = year
      }
      if (runtime !== null) {
        item.runtime = runtime
      }
      return item
    })
    .filter(Boolean)
    .slice(0, 260)
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

function sanitizePreferencePayload(payload, options) {
  const input = payload && typeof payload === 'object' ? payload : {}
  const preferences = input.preferences && typeof input.preferences === 'object' ? input.preferences : input
  const allowedFilmIds = (options && options.allowedFilmIds) || {}
  const hasMarkedFilms = !!(options && options.hasMarkedFilms)
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
  ;[
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

  const rawLabels = Array.isArray(input.labels) ? input.labels : []
  const labels = rawLabels
    .map(label => String(label || '').trim())
    .filter(Boolean)
    .slice(0, 4)

  const mode = input.mode === SMART_MODE_PICK
    ? SMART_MODE_PICK
    : input.mode === SMART_MODE_MARKED && hasMarkedFilms
      ? SMART_MODE_MARKED
      : hasMarkedFilms
        ? SMART_MODE_MARKED
        : SMART_MODE_PICK

  return {
    mode,
    selectedFilmIds: sanitizeFilmIds(input.selectedFilmIds, allowedFilmIds),
    filmWeights: sanitizeFilmWeights(input.filmWeights, allowedFilmIds),
    preferences: result,
    labels: labels.length ? labels : ['AI已解析']
  }
}

function buildMessages(instruction, context) {
  const films = context && context.films ? context.films : []
  const hasMarkedFilms = !!(context && context.hasMarkedFilms)
  const filmLines = films.map(film => {
    return [
      `id=${film.id}`,
      `片名=${film.title}`,
      film.enTitle ? `外文=${film.enTitle}` : '',
      film.section ? `单元=${film.section}` : '',
      film.director ? `导演=${film.director}` : '',
      film.country ? `国家=${film.country}` : '',
      film.year ? `年份=${film.year}` : '',
      film.runtime ? `片长=${film.runtime}分钟` : '',
      film.intro ? `简介=${film.intro}` : ''
    ].filter(Boolean).join('；')
  })

  return [
    {
      role: 'system',
      content: [
        '你是电影节智能排片意图解析器，只输出 JSON，不输出解释。',
        '你需要判断用户是只想基于已标星影片排片，还是需要你先帮忙选电影再排片。',
        `当前是否已有标星影片：${hasMarkedFilms ? '有' : '没有'}。`,
        `mode 只能是 ${SMART_MODE_MARKED} 或 ${SMART_MODE_PICK}。`,
        `默认用 ${SMART_MODE_MARKED}；如果没有标星影片，或用户说推荐/帮我选/随便/不知道看什么/补几部，使用 ${SMART_MODE_PICK}。`,
        '当 mode 是 pick_and_schedule 时，从给定影片列表里选择，不要编造影片 id。',
        'selectedFilmIds 放你较推荐的影片 id，最多 40 个；filmWeights 是影片 id 到 0-100 的推荐权重。',
        '不要根据影院、日期、场次数选择影片，这些后续由本地算法处理。',
        '把用户中文偏好同时转成排片算法参数。',
        '时间全部用当天 0 点后的分钟数，例如 10:00 是 600，19:00 是 1140。',
        'busyRules 的 day 只能是 周一 到 周日。',
        '用户偏好某个影院、单元、导演、片名、国家、关键词时，填到 preferredCinemas/preferredSections/preferredKeywords。',
        '用户明确排斥某个影院、单元、导演、片名、国家、关键词时，填到 avoidCinemas/avoidSections/avoidKeywords。',
        '用户说同一家影院、少换影院、少跑动时，sameCinemaBonus 至少 40，cinemaSwitchPenalty 至少 35，minGap 至少 30。',
        '用户说不要太早时，avoidMorningBefore 至少 660。',
        '不要编造影片或场次。'
      ].join('\n')
    },
    {
      role: 'user',
      content: [
        '输出 JSON 结构：',
        '{"mode":"pick_and_schedule","selectedFilmIds":["film_id"],"filmWeights":{"film_id":92},"preferences":{"maxPerDay":4,"minGap":30,"sameCinemaBonus":40,"cinemaSwitchPenalty":35,"meetupBonus":24,"rareBonus":18,"avoidMorningBefore":660,"avoidLateAfter":0,"preferredCinemas":["资料馆"],"avoidCinemas":[],"preferredSections":["大师回顾"],"avoidSections":[],"preferredKeywords":["赫尔佐格"],"avoidKeywords":[],"busyRules":[{"day":"周一","start":600,"end":1140,"label":"工作日不可用"}]},"labels":["少换影院","少早场"]}',
        '',
        `用户偏好：${instruction}`,
        '',
        '可选影片列表：',
        filmLines.length ? filmLines.join('\n') : '未提供'
      ].join('\n')
    }
  ]
}

exports.main = async event => {
  const instruction = String((event && event.instruction) || '').trim().slice(0, 500)
  const films = sanitizeFilmCatalog(event && event.films)
  const allowedFilmIds = films.reduce((map, film) => {
    map[film.id] = true
    return map
  }, {})
  const hasMarkedFilms = !!(event && event.hasMarkedFilms)
  if (!instruction) {
    return {
      mode: hasMarkedFilms ? SMART_MODE_MARKED : SMART_MODE_PICK,
      selectedFilmIds: [],
      filmWeights: {},
      preferences: {},
      labels: ['默认脚本'],
      source: 'script'
    }
  }

  const apiKey = process.env.ARK_API_KEY
  if (!apiKey) {
    return {
      mode: hasMarkedFilms ? SMART_MODE_MARKED : SMART_MODE_PICK,
      selectedFilmIds: [],
      filmWeights: {},
      preferences: {},
      labels: ['未配置AI'],
      source: 'fallback'
    }
  }

  try {
    const data = await postJson(`${ARK_API_BASE.replace(/\/$/, '')}/chat/completions`, apiKey, {
      model: ARK_MODEL,
      messages: buildMessages(instruction, { films, hasMarkedFilms }),
      temperature: 0.1,
      max_tokens: 900
    })

    const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
    const parsed = JSON.parse(stripJsonFence(content))
    const sanitized = sanitizePreferencePayload(parsed, { allowedFilmIds, hasMarkedFilms })

    return Object.assign({}, sanitized, {
      source: 'ai',
      model: ARK_MODEL
    })
  } catch (error) {
    return {
      mode: hasMarkedFilms ? SMART_MODE_MARKED : SMART_MODE_PICK,
      selectedFilmIds: [],
      filmWeights: {},
      preferences: {},
      labels: ['AI暂不可用'],
      source: 'fallback'
    }
  }
}
