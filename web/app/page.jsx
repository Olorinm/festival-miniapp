'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpToLine, ChevronDown, ChevronRight, Maximize2, Minimize2, PencilLine, RefreshCw } from 'lucide-react'
import festival from '../lib/festival'
import schedule from '../lib/schedule.cjs'
import { createTicketPosterImage } from '../lib/ticketPoster'

const STORAGE_PREFIX = 'festival.web.siff2026.'
const MARK_OPTIONS = [
  { key: 'want3', label: '必看', stars: '★★★', rank: 3 },
  { key: 'want2', label: '想看', stars: '★★', rank: 2 },
  { key: 'want1', label: '待定', stars: '★', rank: 1 }
]
const STAR_SLOTS = [
  { key: 'want1', label: '待定', rank: 1 },
  { key: 'want2', label: '想看', rank: 2 },
  { key: 'want3', label: '必看', rank: 3 }
]
const DEFAULT_SCHEME_ID = 'plan_default'
const DEFAULT_FILM_FIELD_CONFIG = {
  info: true,
  rating: true,
  synopsis: false
}
const DEFAULT_SCHEDULE_FIELD_CONFIG = {
  info: true,
  rating: false,
  ticket: true,
  popularity: true,
  synopsis: false
}
const DEFAULT_SORT = 'section'
const PLAN_NOTE_MAX_LENGTH = 40
const SORT_OPTIONS = [
  { key: 'section', label: '单元', shortLabel: '单元' },
  { key: 'director', label: '导演', shortLabel: '导演' },
  { key: 'interest', label: '想看程度', shortLabel: '想看' },
  { key: 'default', label: '无', shortLabel: '无' }
]
const ALL_SECTION = 'all'
const ALL_DIRECTOR = 'all'
const ALL_DAYS = 'all'
const ALL_CINEMAS = 'all'
const POSTER_WIDTH = 750
const POSTER_FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", sans-serif'
const APP_SHARE_NAME = '赶场愉快'
const GITHUB_URL = 'https://github.com/Olorinm/festival-miniapp'
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect
const POPULARITY_RANK_REFRESH_MS = 5 * 60 * 1000
const POPULARITY_RANK_INITIAL_LIMIT = 20
const POPULARITY_RANK_STEP = 10
const POPULARITY_RANK_MAX_LIMIT = 50
const POSTER_THEMES = [
  {
    key: 'list',
    label: '清单',
    swatch: '#fdfdfb',
    layout: 'list',
    bg: '#fdfdfb',
    ink: '#171917',
    muted: '#686f69',
    subtle: '#9ca09a',
    faint: '#e4e6e0',
    ghost: '#f3f3f1',
    accent: '#171917',
    conflict: '#9a4d45'
  },
  {
    key: 'minimal',
    label: '极简',
    swatch: '#fdfdfb',
    layout: 'minimal',
    bg: '#fdfdfb',
    ink: '#1f201e',
    muted: '#71736f',
    subtle: '#989a96',
    faint: '#e8e8e6',
    ghost: '#f1f1ef',
    conflict: '#9a4d45'
  },
  {
    key: 'silver',
    label: '冷白',
    swatch: '#eef2f5',
    layout: 'silver',
    bg: '#f7f9fa',
    panel: '#ffffff',
    ink: '#182026',
    muted: '#6d7780',
    subtle: '#a2aab0',
    faint: '#dfe6ea',
    ghost: '#e5edf1',
    accent: '#3f6578',
    conflict: '#a94d52'
  },
  {
    key: 'noir',
    label: '夜场',
    swatch: '#17191c',
    layout: 'noir',
    bg: '#17191c',
    panel: '#22252a',
    ink: '#f4f2ec',
    muted: '#a8aaa6',
    subtle: '#71756f',
    faint: '#34383d',
    ghost: 'rgba(255, 255, 255, 0.055)',
    accent: '#c4d1d8',
    conflict: '#e19b9b'
  },
  {
    key: 'gallery',
    label: '票根',
    swatch: '#f2f3f1',
    layout: 'gallery',
    bg: '#f2f3f1',
    panel: '#ffffff',
    ink: '#151816',
    muted: '#666d69',
    subtle: '#9ca29e',
    faint: '#daddd8',
    ghost: '#e1e4df',
    accent: '#415363',
    conflict: '#9c5555'
  },
  {
    key: 'poster-wall',
    label: '海报墙',
    swatch: '#f2f3f1',
    layout: 'wall',
    bg: '#f2f3f1',
    ink: '#151816',
    muted: '#666d69',
    subtle: '#9ca29e',
    faint: '#daddd8',
    ghost: '#e1e4df',
    accent: '#415363',
    conflict: '#9c5555'
  }
]
const SMART_PROGRESS_STEPS = [
  { delay: 0, text: '理解需求中' },
  { delay: 700, text: '解析偏好中' },
  { delay: 1600, text: '匹配场次中' },
  { delay: 2800, text: '生成方案中' },
  { delay: 5200, text: '还在生成，请稍等' }
]

function safeRead(key, fallback) {
  if (typeof window === 'undefined') return fallback
  try {
    const value = window.localStorage.getItem(`${STORAGE_PREFIX}${key}`)
    return value ? JSON.parse(value) : fallback
  } catch (error) {
    return fallback
  }
}

function safeWrite(key, value) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(value))
  } catch (error) {}
}

function useStoredState(key, fallback) {
  const [value, setValue] = useState(() => {
    if (typeof window !== 'undefined' && window.__festivalStoredStateReady) {
      return safeRead(key, fallback)
    }
    return fallback
  })
  const loaded = useRef(false)
  const skippedInitialWrite = useRef(false)

  useIsomorphicLayoutEffect(() => {
    setValue(safeRead(key, fallback))
    loaded.current = true
    if (typeof window !== 'undefined') {
      window.__festivalStoredStateReady = true
    }
  }, [key])

  useEffect(() => {
    if (!loaded.current) return
    if (!skippedInitialWrite.current) {
      skippedInitialWrite.current = true
      return
    }
    if (loaded.current) safeWrite(key, value)
  }, [key, value])

  return [value, setValue]
}

function uniqueIds(ids) {
  const seen = {}
  return (Array.isArray(ids) ? ids : [])
    .map(id => String(id || '').trim())
    .filter(Boolean)
    .filter(id => {
      if (seen[id]) return false
      seen[id] = true
      return true
    })
}

function applyFilmMarkAliases(films, marks) {
  const source = marks && typeof marks === 'object' ? marks : {}
  let next = source
  ;(Array.isArray(films) ? films : []).forEach(film => {
    if (!film || source[film.id]) return
    const aliasIds = Array.isArray(film.markAliasFilmIds) ? film.markAliasFilmIds : []
    const aliasId = aliasIds.find(id => source[id])
    if (!aliasId) return
    if (next === source) next = { ...source }
    next[film.id] = source[aliasId]
  })
  return next
}

function compact(items) {
  return items.map(item => String(item || '').trim()).filter(Boolean).join(' · ')
}

function detailText(value) {
  return String(value || '').trim()
}

function detailMetaText(items) {
  return items
    .map(item => detailText(item).replace(/\s+·\s+/g, ' / '))
    .filter(Boolean)
    .join(' / ')
}

function detailInfoRow(label, value, options = {}) {
  const text = detailText(value)
  if (!text) return null
  const multiline = !!options.multiline
  return {
    label,
    value: text,
    multiline,
    lines: multiline ? text.split(/\r?\n/).map(item => item.trim()).filter(Boolean) : []
  }
}

function buildDetailInfoRows(film) {
  return [
    detailInfoRow('获奖情况', schedule.filmAwards(film), { multiline: true })
  ].filter(Boolean)
}

function buildDetailMetaRows(film) {
  const meta = detailMetaText([
    schedule.filmCoreMeta(film),
    schedule.filmDirector(film),
    schedule.filmCast(film)
  ])
  return meta ? [meta] : []
}

function filmSynopsis(film) {
  return detailText(film.synopsis || film.tmdbOverview || film.overview)
}

function ratingValue(value) {
  const match = String(value ?? '').replace(/,/g, '').match(/\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : 0
}

function compareText(a, b) {
  return String(a || '').localeCompare(String(b || ''), 'zh-Hans-CN')
}

function countOptions(items, getKey, getLabel) {
  const map = {}
  items.forEach(item => {
    const key = getKey(item)
    const label = getLabel ? getLabel(item) : key
    if (!map[key]) map[key] = { key, label, count: 0 }
    map[key].count += 1
  })
  return Object.keys(map)
    .map(key => map[key])
    .sort((a, b) => b.count - a.count || compareText(a.label, b.label))
}

function sortFilterLabel(sortKey) {
  const option = SORT_OPTIONS.find(item => item.key === sortKey) || SORT_OPTIONS[0]
  return `分组 · ${option.shortLabel}`
}

function getInterestRank(mark) {
  return MARK_OPTIONS.find(item => item.key === mark)?.rank || 0
}

function getInterestMeta(mark) {
  return schedule.getInterestMeta(mark)
}

function compareByFilmTitle(a, b) {
  return compareText(schedule.filmDisplayTitle(a), schedule.filmDisplayTitle(b)) ||
    compareText(schedule.filmEnTitle(a), schedule.filmEnTitle(b))
}

function sortFilms(films, sortKey, marks) {
  const sorted = films.slice()
  if (sortKey === 'director') {
    return sorted.sort((a, b) => compareText(schedule.filmDirector(a) || '未知导演', schedule.filmDirector(b) || '未知导演') || compareByFilmTitle(a, b))
  }
  if (sortKey === 'section') {
    return sorted.sort((a, b) => compareText(schedule.filmSection(a) || '其他', schedule.filmSection(b) || '其他') || compareByFilmTitle(a, b))
  }
  if (sortKey === 'interest') {
    return sorted.sort((a, b) => getInterestRank(schedule.getFilmMark(b, marks)) - getInterestRank(schedule.getFilmMark(a, marks)) || compareByFilmTitle(a, b))
  }
  return sorted
}

function filmGroupInfo(film, sortKey, marks) {
  if (sortKey === 'director') {
    const label = schedule.filmDirector(film) || '未知导演'
    return { key: `director:${label}`, label }
  }
  if (sortKey === 'section') {
    const label = schedule.filmSection(film) || '其他'
    return { key: `section:${label}`, label }
  }
  if (sortKey === 'interest') {
    const interest = schedule.getFilmInterest(film, marks)
    return { key: `interest:${interest.rank || 0}`, label: interest.label || '未标星' }
  }
  return { key: 'default', label: '' }
}

function buildFilmGroups(films, sortKey, marks) {
  const sorted = sortFilms(films, sortKey, marks)
  if (sortKey === 'default') {
    return [{ key: 'default', label: '', count: sorted.length, items: sorted }]
  }
  return sorted.reduce((groups, film) => {
    const info = filmGroupInfo(film, sortKey, marks)
    let group = groups.find(item => item.key === info.key)
    if (!group) {
      group = { key: info.key, label: info.label, count: 0, items: [] }
      groups.push(group)
    }
    group.count += 1
    group.items.push(film)
    return groups
  }, [])
}

function createScheme(name, selectedIds = []) {
  const now = Date.now()
  return {
    id: `plan_${now}_${Math.floor(Math.random() * 1000)}`,
    name,
    selectedIds: uniqueIds(selectedIds),
    notes: {},
    smartPlanMeta: null,
    createdAt: now,
    updatedAt: now
  }
}

function initialSchemes() {
  return [{
    id: DEFAULT_SCHEME_ID,
    name: '方案 1',
    selectedIds: [],
    notes: {},
    smartPlanMeta: null,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }]
}

function getAnonUserId() {
  if (typeof window === 'undefined') return ''
  const key = `${STORAGE_PREFIX}anonUserId`
  let value = window.localStorage.getItem(key)
  if (!value) {
    value = window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : `anon_${Date.now()}`
    window.localStorage.setItem(key, value)
  }
  return value
}

const USAGE_EVENT_FLUSH_DELAY = 60000
const USAGE_EVENT_MIN_FLUSH_INTERVAL = 45000

function getUsageEventState() {
  if (typeof window === 'undefined') return null
  if (!window.__festivalUsageEventState) {
    window.__festivalUsageEventState = {
      festivalId: '',
      events: {},
      timer: null,
      lastFlushAt: 0,
      bound: false
    }
  }
  const state = window.__festivalUsageEventState
  if (!state.bound) {
    state.bound = true
    window.addEventListener('pagehide', () => flushUsageEvents({ force: true }))
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushUsageEvents({ force: true })
    })
  }
  return state
}

function flushUsageEvents(options) {
  const state = getUsageEventState()
  if (!state) return
  if (state.timer) {
    window.clearTimeout(state.timer)
    state.timer = null
  }
  const events = Object.entries(state.events)
    .map(([event, count]) => ({ event, count }))
    .filter(item => item.count > 0)
  if (!events.length) return
  const force = !!(options && options.force)
  const now = Date.now()
  if (!force && state.lastFlushAt && now - state.lastFlushAt < USAGE_EVENT_MIN_FLUSH_INTERVAL) {
    state.timer = window.setTimeout(() => flushUsageEvents(), USAGE_EVENT_FLUSH_DELAY)
    return
  }
  state.lastFlushAt = now
  state.events = {}
  const payload = JSON.stringify({
    festivalId: state.festivalId || 'siff2026',
    events
  })
  try {
    if (window.navigator && typeof window.navigator.sendBeacon === 'function') {
      const blob = new Blob([payload], { type: 'application/json' })
      if (window.navigator.sendBeacon('/api/events/track', blob)) return
    }
  } catch (error) {}
  fetch('/api/events/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    keepalive: true
  }).catch(() => {})
}

function trackUsageEvent(event, festivalId) {
  if (typeof window === 'undefined') return
  const state = getUsageEventState()
  if (!state) return
  const nextFestivalId = festivalId || 'siff2026'
  if (state.festivalId && state.festivalId !== nextFestivalId) {
    flushUsageEvents()
  }
  state.festivalId = nextFestivalId
  state.events[event] = (state.events[event] || 0) + 1
  if (!state.timer) {
    state.timer = window.setTimeout(() => flushUsageEvents(), USAGE_EVENT_FLUSH_DELAY)
  }
}

function posterSrc(film) {
  const asset = String(film.posterAssetPath || '').trim()
  if (asset) return asset.replace(/^\/assets\/posters\//, '/posters/')
  return schedule.filmPosterSrc(film)
}

function filmSearchText(film) {
  return [
    schedule.filmDisplayTitle(film),
    schedule.filmEnTitle(film),
    schedule.filmDirector(film),
    schedule.filmSection(film),
    schedule.filmCountry(film),
    schedule.filmGenre(film),
    filmSynopsis(film)
  ].join(' ').toLowerCase()
}

function exportText(payload) {
  return `赶场愉快排片导出\n${JSON.stringify(payload)}`
}

function formatMinutes(minutes) {
  const hour = Math.floor((Number(minutes) || 0) / 60)
  const minute = (Number(minutes) || 0) % 60
  return `${hour}小时${minute ? `${minute}分` : ''}`
}

function formatVenueLine(item) {
  return compact([item.cinema, item.hall])
}

function formatRankUpdatedAt(value) {
  const date = value ? new Date(value) : null
  if (!date || Number.isNaN(date.getTime())) return '打开热度榜时更新'
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `截至 ${hour}:${minute}`
}

function buildPopularityRows(screenings, counts, limit = POPULARITY_RANK_INITIAL_LIMIT) {
  const countMap = counts && typeof counts === 'object' ? counts : {}
  return (Array.isArray(screenings) ? screenings : [])
    .map(item => ({
      ...item,
      popularityCount: Math.max(0, Number(countMap[item.id]) || 0)
    }))
    .filter(item => item.popularityCount > 0)
    .sort((a, b) => b.popularityCount - a.popularityCount || compareText(a.date || '', b.date || '') || (a.startMinutes || 0) - (b.startMinutes || 0) || compareText(a.cnTitle, b.cnTitle))
    .slice(0, limit)
}

function hasPositivePopularityCounts(counts) {
  return Object.values(counts && typeof counts === 'object' ? counts : {})
    .some(value => Number(value) > 0)
}

function formatPlanText(plan, options) {
  const source = options || {}
  const notes = source.notes && typeof source.notes === 'object' ? source.notes : {}
  const lines = [
    `赶场愉快｜${source.festivalName || '电影节'}排片`,
    source.schemeName ? `${source.schemeName} · ${plan.selected.length} 场 · ${formatMinutes(plan.totalMinutes)}` : `${plan.selected.length} 场 · ${formatMinutes(plan.totalMinutes)}`,
    ''
  ]
  plan.days.forEach(day => {
    lines.push(day.dayLabel)
    day.items.forEach(item => {
      const note = notes[item.id]
      lines.push(`${item.timeRange}｜${item.cnTitle}${item.conflict ? ' [冲突]' : ''}`)
      lines.push(formatVenueLine(item))
      if (note) lines.push(`备注：${note}`)
      lines.push('')
    })
  })
  if (plan.conflictPairs.length) {
    lines.push('待处理冲突')
    plan.conflictPairs.forEach(pair => lines.push(pair.label))
    lines.push('')
  }
  lines.push(`导入码：${plan.selected.map(item => item.id).join(',')}`)
  lines.push('用「赶场愉快」导入：复制全文或底部导入码。')
  return lines.join('\n')
}

function parseImportText(text) {
  const start = String(text || '').indexOf('{')
  if (start < 0) throw new Error('没有找到可导入的数据')
  const payload = JSON.parse(String(text).slice(start))
  if (!payload || payload.type !== 'festival-plan' || !Array.isArray(payload.schemes)) {
    throw new Error('导入内容不是赶场愉快排片数据')
  }
  return payload
}

function parseImportScreeningIds(text, validScreeningIds) {
  const match = String(text || '').match(/导入码[:：]\s*([^\n\r]+)/)
  if (!match) return []
  return uniqueIds(match[1].split(/[,，、\s]+/).map(item => item.trim())).filter(id => validScreeningIds[id])
}

function sanitizePlanNotes(notes, validScreeningIds, selectedIds) {
  if (!notes || typeof notes !== 'object') return {}
  const selectedMap = Array.isArray(selectedIds)
    ? selectedIds.reduce((map, id) => {
        map[id] = true
        return map
      }, {})
    : null
  return Object.entries(notes).reduce((next, [id, value]) => {
    if (validScreeningIds && !validScreeningIds[id]) return next
    if (selectedMap && !selectedMap[id]) return next
    const text = String(value || '').trim().slice(0, PLAN_NOTE_MAX_LENGTH)
    if (text) next[id] = text
    return next
  }, {})
}

function getPosterTheme(key) {
  return POSTER_THEMES.find(theme => theme.key === key) || POSTER_THEMES[0]
}

function estimateTextWidth(text, size) {
  return Array.from(String(text || '')).reduce((sum, char) => {
    return sum + (/[\x00-\x7F]/.test(char) ? size * 0.56 : size)
  }, 0)
}

function wrapPosterText(text, maxWidth, size, maxLines) {
  const chars = Array.from(String(text || ''))
  const lines = []
  let line = ''

  chars.forEach(char => {
    const next = `${line}${char}`
    if (line && estimateTextWidth(next, size) > maxWidth) {
      lines.push(line)
      line = char
    } else {
      line = next
    }
  })

  if (line) lines.push(line)

  if (maxLines && lines.length > maxLines) {
    const next = lines.slice(0, maxLines)
    let last = next[maxLines - 1]
    while (last && estimateTextWidth(`${last}…`, size) > maxWidth) {
      last = last.slice(0, -1)
    }
    next[maxLines - 1] = `${last}…`
    return next
  }

  return lines.length ? lines : ['']
}

function posterVenue(item) {
  return formatVenueLine(item) || item.cinema || ''
}

function posterFestivalName(name) {
  return String(name || '电影节').trim() || '电影节'
}

function posterFestivalTitle(name) {
  return `我的 ${posterFestivalName(name)}`
}

function posterDayNumber(day) {
  const text = `${day.dayLabel || ''} ${day.date || ''}`
  const slashMatch = text.match(/\d{1,2}\/(\d{1,2})/)
  if (slashMatch) return slashMatch[1]
  const dateMatch = text.match(/\d{4}[-/](\d{1,2})[-/](\d{1,2})/)
  return dateMatch ? dateMatch[2] : ''
}

function formatPosterDuration(minutes) {
  const hour = Math.floor((Number(minutes) || 0) / 60)
  const minute = (Number(minutes) || 0) % 60
  return `${hour}h${minute ? `${minute}m` : ''}`
}

function posterPopularityText(item, options) {
  if (!options || options.includePopularity === false) return ''
  const count = Number(options.popularity && options.popularity[item.id])
  if (!Number.isFinite(count) || count <= 0) return ''
  return `${Math.round(count)}人已排`
}

function posterNoteText(item, options) {
  if (!options || options.includeNotes === false) return ''
  const note = String(options.notes && options.notes[item.id] || '').trim()
  return note
}

function buildPosterWall(plan, options, theme) {
  const width = POSTER_WIDTH
  const columns = 3
  const posterWidth = Math.floor(width / columns)
  const posterHeight = Math.round(posterWidth * 1.46)
  const seenFilms = new Set()
  const items = (plan.days || []).flatMap(day => day.items || []).filter(item => {
    const key = item.filmId || item.cnTitle || item.id
    if (seenFilms.has(key)) return false
    seenFilms.add(key)
    return true
  })
  const blocks = []
  let y = 0

  for (let index = 0; index < items.length; index += columns) {
    const rowItems = items.slice(index, index + columns)
    rowItems.forEach((item, column) => {
      blocks.push({
        type: 'wallPoster',
        posterX: column * posterWidth,
        posterY: y,
        posterWidth,
        posterHeight,
        posterRadius: 0,
        posterCropInset: 0.04,
        posterSeamless: true,
        posterStroke: false,
        posterSrc: String((options && options.posterSrcByFilmId && options.posterSrcByFilmId[item.filmId]) || item.posterSrc || '').replace(/^\/assets\/posters\//, '/posters/')
      })
    })

    y += posterHeight
  }

  return {
    width,
    height: Math.max(420, y),
    blocks,
    theme,
    pixelRatio: 1,
    includePosters: true,
    includeCode: false,
    summary: {
      title: `${posterFestivalName(options && options.festivalName)} 海报墙`,
      count: `${items.length} 部`,
      screenings: items.length,
      duration: ''
    }
  }
}

function buildPoster(plan, options) {
  const theme = getPosterTheme(options && options.theme)
  const layout = theme.layout || 'minimal'
  if (layout === 'wall') return buildPosterWall(plan, options, theme)
  const includePosters = Boolean(options && options.includePosters)
  const width = POSTER_WIDTH
  const margin = layout === 'gallery' ? 58 : layout === 'list' ? 62 : 74
  const contentWidth = width - margin * 2
  const timeX = margin
  const baseMainX = layout === 'gallery' ? 188 : layout === 'list' ? 184 : 216
  const posterSlot = includePosters
    ? {
        width: layout === 'gallery' ? 92 : layout === 'list' ? 76 : 80,
        height: layout === 'gallery' ? 130 : layout === 'list' ? 108 : 114,
        gap: layout === 'list' ? 18 : 18,
        radius: layout === 'gallery' ? 8 : 7
      }
    : null
  const mainX = posterSlot ? baseMainX + posterSlot.width + posterSlot.gap : baseMainX
  const mainWidth = width - mainX - margin
  const blocks = []
  const festivalName = posterFestivalName(options && options.festivalName)
  let y = layout === 'noir' ? 52 : layout === 'list' ? 48 : 56

  blocks.push({
    type: 'header',
    x: margin,
    y,
    width: contentWidth,
    height: layout === 'noir' ? 214 : layout === 'list' ? 188 : 204,
    festivalName,
    title: posterFestivalTitle(festivalName)
  })
  y += layout === 'noir' ? 292 : layout === 'list' ? 238 : 284

  plan.days.forEach(day => {
    y += layout === 'minimal' ? 34 : layout === 'list' ? 24 : 26
    const dayStartY = y

    blocks.push({
      type: 'dayStart',
      x: margin,
      y: dayStartY,
      width: contentWidth,
      label: day.dayLabel,
      number: posterDayNumber(day)
    })
    y += layout === 'minimal' ? 72 : layout === 'list' ? 58 : 58

    day.items.forEach(item => {
      const titleSize = layout === 'noir' ? 28 : layout === 'list' ? 28 : 29
      const venueSize = layout === 'noir' ? 20 : layout === 'list' ? 20 : 21
      const titleLineHeight = layout === 'list' ? 34 : 36
      const venueLineHeight = layout === 'list' ? 26 : 28
      const titleLines = wrapPosterText(item.cnTitle, mainWidth, titleSize)
      const popularityText = posterPopularityText(item, options)
      const noteText = posterNoteText(item, options)
      const venueLines = wrapPosterText(posterVenue(item), mainWidth, venueSize)
      const accentLines = wrapPosterText(compact([popularityText, noteText]), mainWidth, venueSize, 2).filter(Boolean)
      const metaLineCount = venueLines.length + accentLines.length
      const itemHeight = Math.max(
        layout === 'gallery' ? 116 : layout === 'list' ? 98 : 106,
        posterSlot ? posterSlot.height + 12 : 0,
        26 + titleLines.length * titleLineHeight + metaLineCount * venueLineHeight
      )
      const posterY = posterSlot
        ? layout === 'gallery'
          ? Math.round((y - 18) + Math.max(0, ((itemHeight + 12) - posterSlot.height) / 2))
          : y + Math.max(0, Math.round((itemHeight - posterSlot.height) / 2) - 2)
        : 0

      blocks.push({
        type: 'item',
        x: margin,
        y,
        height: itemHeight,
        timeX,
        mainX,
        mainWidth,
        ruleWidth: contentWidth,
        panelWidth: contentWidth + 34,
        posterX: posterSlot ? baseMainX : 0,
        posterY,
        posterWidth: posterSlot?.width || 0,
        posterHeight: posterSlot?.height || 0,
        posterRadius: posterSlot?.radius || 0,
        posterSrc: posterSlot ? String((options && options.posterSrcByFilmId && options.posterSrcByFilmId[item.filmId]) || item.posterSrc || '').replace(/^\/assets\/posters\//, '/posters/') : '',
        start: item.start,
        end: item.end,
        titleLines,
        venueLines,
        accentLines,
        conflict: item.conflict
      })
      y += itemHeight + (layout === 'gallery' ? 18 : layout === 'list' ? 18 : 28)
    })

    y += layout === 'minimal' ? 54 : layout === 'list' ? 36 : 44
  })

  y += 18
  blocks.push({
    type: 'footer',
    x: margin,
    y,
    width: contentWidth,
    height: 46,
    codePath: ''
  })
  y += 76

  return {
    width,
    height: Math.max(420, y),
    blocks,
    theme,
    includePosters,
    includeCode: false,
    summary: {
      title: `${festivalName} 我的排片`,
      count: `${plan.selected.length} 场 · ${formatPosterDuration(plan.totalMinutes)}`,
      screenings: plan.selected.length,
      duration: formatPosterDuration(plan.totalMinutes)
    }
  }
}

function canvasFontWeight(weight) {
  if (String(weight || '').toLowerCase() === 'bold') return 'bold'
  return Number(weight) >= 560 ? 'bold' : 'normal'
}

function setPosterText(ctx, size, color, weight) {
  ctx.fillStyle = color
  ctx.font = `${canvasFontWeight(weight)} ${size}px ${POSTER_FONT_FAMILY}`
}

function drawRoundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + width - radius, y)
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius)
  ctx.lineTo(x + width, y + height - radius)
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height)
  ctx.lineTo(x + radius, y + height)
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius)
  ctx.lineTo(x, y + radius)
  ctx.quadraticCurveTo(x, y, x + radius, y)
  ctx.closePath()
}

function fillRoundRect(ctx, x, y, width, height, radius, color) {
  ctx.fillStyle = color
  drawRoundRect(ctx, x, y, width, height, radius)
  ctx.fill()
}

function drawPosterTextLines(ctx, lines, x, y, lineHeight) {
  lines.forEach((line, index) => {
    ctx.fillText(line, x, y + index * lineHeight)
  })
}

function posterPopularityColor(colors) {
  // 备注/热度是次要信息：用主题正文色降透明度，永远与主题同色系。
  // 夜场（深底白字）单独抬高不透明度，避免在深色上发糊。
  const alpha = (colors.layout || '') === 'noir' ? 0.55 : 0.45
  const ink = String(colors.ink || '#171917').replace('#', '')
  const r = parseInt(ink.slice(0, 2), 16)
  const g = parseInt(ink.slice(2, 4), 16)
  const b = parseInt(ink.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function drawPosterMetaLines(ctx, block, x, y, lineHeight, colors, size, weight) {
  let lineIndex = 0
  const drawLines = (lines, color) => {
    if (!Array.isArray(lines) || !lines.length) return
    setPosterText(ctx, size, color, weight)
    lines.forEach(line => {
      ctx.fillText(line, x, y + lineIndex * lineHeight)
      lineIndex += 1
    })
  }

  drawLines(block.venueLines, colors.muted)
  drawLines(block.accentLines, posterPopularityColor(colors))
}

function isCanvasSafePosterSrc(src) {
  const value = String(src || '').trim()
  if (!value) return false
  if (value.startsWith('/posters/')) return true
  if (typeof window === 'undefined') return false
  try {
    const url = new URL(value, window.location.href)
    return url.origin === window.location.origin && url.pathname.startsWith('/posters/')
  } catch (error) {
    return false
  }
}

function loadPosterImage(src) {
  if (typeof window === 'undefined' || !isCanvasSafePosterSrc(src)) {
    return Promise.resolve(null)
  }
  return new Promise(resolve => {
    const image = new window.Image()
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    image.src = src
  })
}

async function hydratePosterImages(poster) {
  const imageBlocks = poster.blocks.filter(block => (block.type === 'item' || block.type === 'wallPoster') && block.posterWidth > 0)
  await Promise.all(imageBlocks.map(async block => {
    block.posterImage = await loadPosterImage(block.posterSrc)
  }))
}

function drawCanvasPosterImage(ctx, block, colors) {
  if (!block.posterWidth || !block.posterHeight) return

  const x = block.posterX
  const y = block.posterY
  const width = block.posterWidth
  const height = block.posterHeight
  const radius = block.posterRadius ?? 7
  const image = block.posterImage
  const seamless = block.posterSeamless === true
  const bleed = 0
  const drawX = x - bleed
  const drawY = y - bleed
  const drawWidth = width + bleed * 2
  const drawHeight = height + bleed * 2

  ctx.save()
  if (!seamless) {
    drawRoundRect(ctx, x, y, width, height, radius)
    ctx.clip()
  }

  if (image && (image.naturalWidth || image.width) && (image.naturalHeight || image.height)) {
    const sourceWidth = image.naturalWidth || image.width
    const sourceHeight = image.naturalHeight || image.height
    const scale = Math.max(drawWidth / sourceWidth, drawHeight / sourceHeight)
    const cropWidth = drawWidth / scale
    const cropHeight = drawHeight / scale
    const cropInset = Math.max(0, Math.min(0.12, Number(block.posterCropInset) || 0))
    const insetX = cropWidth * cropInset
    const insetY = cropHeight * cropInset
    const sourceX = Math.max(0, (sourceWidth - cropWidth) / 2 + insetX)
    const sourceY = Math.max(0, (sourceHeight - cropHeight) / 2 + insetY)
    const sourceCropWidth = Math.max(1, cropWidth - insetX * 2)
    const sourceCropHeight = Math.max(1, cropHeight - insetY * 2)
    ctx.drawImage(image, sourceX, sourceY, sourceCropWidth, sourceCropHeight, drawX, drawY, drawWidth, drawHeight)
  } else {
    ctx.fillStyle = colors.ghost || colors.faint || '#f1f1ef'
    ctx.fillRect(drawX, drawY, drawWidth, drawHeight)
  }

  ctx.restore()
  if (block.posterStroke === false) return
  ctx.strokeStyle = colors.faint || 'rgba(0,0,0,0.08)'
  ctx.lineWidth = 1
  drawRoundRect(ctx, x, y, width, height, radius)
  ctx.stroke()
}

function drawPosterTitleBlock(ctx, block, poster, colors) {
  const layout = colors.layout || 'minimal'
  const titleSize = layout === 'list' ? 44 : layout === 'noir' ? 42 : 41
  const brandY = layout === 'list' ? block.y + 30 : block.y + 50
  const titleY = layout === 'list' ? block.y + 90 : block.y + 124
  const summaryY = layout === 'list' ? block.y + 134 : block.y + 168
  const lineY = layout === 'list' ? block.y + 174 : block.y + 204
  const tagHeight = layout === 'list' ? 32 : 30
  const tagBg = colors.accent || colors.ink
  const tagInk = colors.bg
  const title = block.festivalName || posterFestivalName()

  ctx.save()
  setPosterText(ctx, 18, colors.muted || colors.subtle, '520')
  ctx.fillText(APP_SHARE_NAME, block.x, brandY)

  setPosterText(ctx, titleSize, colors.ink, '650')
  ctx.fillText(title, block.x, titleY)

  const tagWidth = 68
  const tagX = block.x + ctx.measureText(title).width + 16
  const tagY = titleY - tagHeight + 4
  if (tagX + tagWidth <= block.x + block.width) {
    fillRoundRect(ctx, tagX, tagY, tagWidth, tagHeight, tagHeight / 2, tagBg)
    setPosterText(ctx, 17, tagInk, '620')
    ctx.fillText('排片', tagX + 17, tagY + 22)
  }

  setPosterText(ctx, 20, colors.muted || colors.subtle, '420')
  ctx.fillText(poster.summary.count, block.x, summaryY)

  ctx.strokeStyle = colors.faint || colors.ghost
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(block.x, lineY)
  ctx.lineTo(block.x + block.width, lineY)
  ctx.stroke()
  ctx.restore()
}

function drawPosterHeader(ctx, block, poster, colors) {
  drawPosterTitleBlock(ctx, block, poster, colors)
}

function paintPlanPoster(ctx, poster) {
  const colors = poster.theme
  const layout = colors.layout || 'minimal'

  if (layout !== 'wall') {
    ctx.fillStyle = colors.bg
    ctx.fillRect(0, 0, poster.width, poster.height)
  }

  poster.blocks.forEach(block => {
    if (block.type === 'header') {
      drawPosterHeader(ctx, block, poster, colors)
      return
    }

    if (block.type === 'dayStart') {
      if (layout === 'list') {
        setPosterText(ctx, 23, colors.ink, '650')
        ctx.fillText(block.label, block.x, block.y + 28)
        ctx.strokeStyle = colors.faint
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(block.x, block.y + 48)
        ctx.lineTo(block.x + block.width, block.y + 48)
        ctx.stroke()
        return
      }

      if (layout === 'minimal') {
        if (block.number) {
          setPosterText(ctx, 220, colors.ghost || colors.faint, '260')
          ctx.fillText(block.number, 328, block.y + 196)
        }
        return
      }

      if (layout === 'silver') {
        setPosterText(ctx, 22, colors.accent, '560')
        ctx.fillText(block.label, block.x, block.y + 31)
        ctx.strokeStyle = colors.faint
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(block.x, block.y + 48)
        ctx.lineTo(block.x + block.width, block.y + 50)
        ctx.stroke()
        return
      }

      if (layout === 'noir') {
        fillRoundRect(ctx, block.x, block.y, 160, 42, 21, colors.panel)
        setPosterText(ctx, 20, colors.ink, '520')
        ctx.fillText(block.label, block.x + 20, block.y + 28)
        ctx.strokeStyle = colors.faint
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(block.x + 178, block.y + 21)
        ctx.lineTo(block.x + block.width, block.y + 21)
        ctx.stroke()
        return
      }

      if (layout === 'gallery') {
        fillRoundRect(ctx, block.x, block.y, 112, 42, 8, colors.ink)
        setPosterText(ctx, 19, colors.bg, '560')
        ctx.fillText(block.label, block.x + 14, block.y + 28)
        ctx.strokeStyle = colors.faint
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(block.x + 128, block.y + 21)
        ctx.lineTo(block.x + block.width, block.y + 21)
        ctx.stroke()
      }
      return
    }

    if (block.type === 'item') {
      if (layout === 'list') {
        setPosterText(ctx, 28, colors.ink, '660')
        ctx.fillText(block.start, block.timeX, block.y + 30)
        setPosterText(ctx, 17, colors.subtle || colors.muted, '400')
        ctx.fillText(block.end, block.timeX + 7, block.y + 62)
        drawCanvasPosterImage(ctx, block, colors)
        setPosterText(ctx, 28, colors.ink, '570')
        drawPosterTextLines(ctx, block.titleLines, block.mainX, block.y + 30, 34)
        const venueY = block.y + 32 + block.titleLines.length * 34 + 7
        drawPosterMetaLines(ctx, block, block.mainX, venueY, 26, colors, 20, '340')
      } else if (layout === 'silver') {
        ctx.strokeStyle = colors.faint
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(block.x, block.y - 12)
        ctx.lineTo(block.x + (block.ruleWidth || block.mainWidth + 142), block.y - 12)
        ctx.stroke()
        setPosterText(ctx, 27, colors.ink, '620')
        ctx.fillText(block.start, block.timeX, block.y + 30)
        setPosterText(ctx, 17, colors.subtle || colors.muted, '380')
        ctx.fillText(block.end, block.timeX + 7, block.y + 64)
        drawCanvasPosterImage(ctx, block, colors)
        setPosterText(ctx, 29, colors.ink, '540')
        drawPosterTextLines(ctx, block.titleLines, block.mainX, block.y + 30, 36)
        const venueY = block.y + 34 + block.titleLines.length * 36 + 8
        drawPosterMetaLines(ctx, block, block.mainX, venueY, 28, colors, 21, '330')
      } else if (layout === 'noir') {
        fillRoundRect(ctx, block.x - 18, block.y - 18, block.panelWidth || block.mainWidth + 176, block.height + 18, 18, colors.panel)
        const textX = block.posterWidth ? block.mainX : block.mainX - 18
        ctx.strokeStyle = block.conflict ? colors.conflict : colors.faint
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(block.timeX + 92, block.y + 2)
        ctx.lineTo(block.timeX + 92, block.y + block.height - 18)
        ctx.stroke()
        setPosterText(ctx, 26, colors.ink, '620')
        ctx.fillText(block.start, block.timeX, block.y + 30)
        setPosterText(ctx, 17, colors.subtle || colors.muted, '380')
        ctx.fillText(block.end, block.timeX + 7, block.y + 64)
        drawCanvasPosterImage(ctx, block, colors)
        setPosterText(ctx, 28, colors.ink, '540')
        drawPosterTextLines(ctx, block.titleLines, textX, block.y + 30, 36)
        const venueY = block.y + 34 + block.titleLines.length * 36 + 8
        drawPosterMetaLines(ctx, block, textX, venueY, 27, colors, 20, '330')
      } else if (layout === 'gallery') {
        fillRoundRect(ctx, block.x + 98, block.y - 18, block.posterWidth ? (block.ruleWidth || block.mainWidth + 122) - 98 : block.mainWidth + 24, block.height + 12, 16, colors.panel)
        setPosterText(ctx, 26, colors.ink, '640')
        ctx.fillText(block.start, block.timeX, block.y + 30)
        setPosterText(ctx, 17, colors.subtle || colors.muted, '380')
        ctx.fillText(block.end, block.timeX + 7, block.y + 64)
        drawCanvasPosterImage(ctx, block, colors)
        setPosterText(ctx, 28, colors.ink, '560')
        drawPosterTextLines(ctx, block.titleLines, block.mainX, block.y + 30, 36)
        const venueY = block.y + 34 + block.titleLines.length * 36 + 8
        drawPosterMetaLines(ctx, block, block.mainX, venueY, 27, colors, 20, '330')
      } else {
        setPosterText(ctx, 27, colors.ink, '650')
        ctx.fillText(block.start, block.timeX, block.y + 30)
        setPosterText(ctx, 17, colors.subtle || colors.muted, '380')
        ctx.fillText(block.end, block.timeX + 7, block.y + 64)
        drawCanvasPosterImage(ctx, block, colors)
        setPosterText(ctx, 29, colors.ink, '560')
        drawPosterTextLines(ctx, block.titleLines, block.mainX, block.y + 30, 36)
        const venueY = block.y + 34 + block.titleLines.length * 36 + 8
        drawPosterMetaLines(ctx, block, block.mainX, venueY, 28, colors, 21, '320')
      }

      return
    }

    if (block.type === 'wallPoster') {
      drawCanvasPosterImage(ctx, block, colors)
      return
    }

    if (block.type === 'footer') {
      ctx.save()
      ctx.textAlign = 'right'
      setPosterText(ctx, 16, colors.subtle || colors.muted, '360')
      ctx.fillText(`用「${APP_SHARE_NAME}」整理和导出排片`, block.x + block.width, block.y + 32)
      ctx.restore()
    }
  })
}

async function createPlanPosterImage(plan, options) {
  if (typeof document === 'undefined') return null
  const poster = buildPoster(plan, options)
  if (poster.includePosters) {
    await hydratePosterImages(poster)
  }
  const canvas = document.createElement('canvas')
  const pixelRatio = poster.pixelRatio || Math.max(1, Math.min(window.devicePixelRatio || 1, poster.height > 2600 ? 1.5 : 2))
  canvas.width = poster.width * pixelRatio
  canvas.height = poster.height * pixelRatio
  canvas.style.width = `${poster.width}px`
  canvas.style.height = `${poster.height}px`
  const ctx = canvas.getContext('2d')
  ctx.scale(pixelRatio, pixelRatio)
  paintPlanPoster(ctx, poster)
  try {
    return {
      url: canvas.toDataURL('image/png'),
      filename: `${options.festivalName || 'festival'}-plan.png`,
      width: poster.width,
      height: poster.height
    }
  } catch (error) {
    return null
  }
}

function Spark({ small = false, spinning = false, primary = false }) {
  const className = [
    primary ? 'smart-primary-spark' : 'smart-icon',
    small ? 'is-small' : '',
    spinning ? 'is-spinning' : '',
  ].filter(Boolean).join(' ')

  return (
    <span className={className} aria-hidden="true">
      <span className="smart-spark">
        <span className="smart-spark-point is-top" />
        <span className="smart-spark-point is-right" />
        <span className="smart-spark-point is-bottom" />
        <span className="smart-spark-point is-left" />
        <span className="smart-spark-core" />
      </span>
    </span>
  )
}

function TopNav({ title, festivalName, onAbout }) {
  return (
    <div className="app-custom-nav">
      <div className="app-nav-row">
        <button className="app-about-entry" type="button" onClick={onAbout}>
          <img className="app-about-icon" src="/brand/opengrove-sapling-on-light.png" alt="" />
          <span>关于</span>
        </button>
        <div className="app-nav-title is-with-context">
          <span className="app-nav-main">{title}</span>
          <span className="app-nav-context">{festivalName}</span>
        </div>
      </div>
    </div>
  )
}

function InlineAboutButton({ onClick }) {
  return (
    <button className="inline-about-entry" type="button" onClick={onClick}>
      <img src="/brand/opengrove-sapling-on-light.png" alt="" />
      <span>关于</span>
    </button>
  )
}

function SmartEntry({ onClick }) {
  return (
    <button className="smart-entry" type="button" onClick={onClick}>
      <Spark />
      <span className="smart-entry-label">智能排片</span>
      <span className="smart-arrow">›</span>
    </button>
  )
}

function SearchBox({ value, onChange, placeholder }) {
  return (
    <label className="search-box">
      <span className="search-icon">⌕</span>
      <input className="search-input" value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} />
    </label>
  )
}

function FieldPanel({ fieldConfig, setFieldConfig, mode }) {
  const options = mode === 'films'
    ? [
      ['info', '影片信息', '年份 · 导演 · 片长 · 单元'],
      ['rating', '影片评分', '豆瓣 / IMDb 评分'],
      ['synopsis', '简介', '剧情简介 / 一句话介绍', false]
    ]
    : [
      ['info', '影片信息', '年份 · 导演 · 片长'],
      ['rating', '影片评分', '豆瓣 / IMDb 评分'],
      ['synopsis', '简介', '剧情简介 / 一句话介绍', false],
      ['ticket', '特殊场次', '4K修复 · 映后交流等标签'],
      ['popularity', '热度情况', '关闭后不显示热度，也停止统计你选择的场次']
    ]

  return (
    <div className="filter-panel field-panel">
      {options.map(([key, label, desc, defaultOn = true]) => {
        const checked = defaultOn ? fieldConfig[key] !== false : fieldConfig[key] === true
        return (
          <button
            className="field-row"
            type="button"
            key={key}
            onClick={() => setFieldConfig(prev => {
              const active = defaultOn ? prev[key] !== false : prev[key] === true
              return { ...prev, [key]: !active }
            })}
          >
            <span className="field-row-text">
              <span className="field-row-label">{label}</span>
              <span className="field-row-desc">{desc}</span>
            </span>
            <span className={`field-switch ${checked ? 'is-on' : ''}`}>
              <span className="field-switch-dot" />
            </span>
          </button>
        )
      })}
    </div>
  )
}

function FilterOptionGroup({ label, type, options, active, onSelect }) {
  return (
    <div className="filter-group">
      <div className="filter-group-head"><span className="filter-group-label">{label}</span></div>
      <div className="filter-group-scroll">
        <div className="filter-group-row">
          {options.map(item => (
            <button
              className={`filter-option ${item.key === active ? 'is-picked' : ''}`}
              type="button"
              key={item.key}
              onClick={() => onSelect(type, item.key)}
            >
              <span className="filter-option-label">{item.label}</span>
              <span className="filter-option-count">{item.count}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function RatingSlider({ label, value, onChange }) {
  return (
    <div className="filter-group">
      <div className="filter-group-head">
        <span className="filter-group-label">{label}</span>
        <span className="filter-slider-value">{value > 0 ? `${value} 分以上` : '不限'}</span>
      </div>
      <input className="filter-slider" type="range" min="0" max="9.5" step="0.5" value={value} onChange={event => onChange(Number(event.target.value))} />
    </div>
  )
}

function FilmCard({ film, mark, fieldConfig, onOpen, onMark }) {
  const metaText = detailMetaText([schedule.filmCoreMeta(film), schedule.filmDirector(film)])
  const ratingSummary = schedule.filmRatingSummary(film)
  const synopsis = filmSynopsis(film)
  const interestRank = MARK_OPTIONS.find(item => item.key === mark)?.rank || 0
  const src = posterSrc(film)

  return (
    <article className="film-card" onClick={() => onOpen(film)}>
      <div className="film-main">
        <div className={`film-poster ${src ? '' : 'is-placeholder'}`}>
          {src ? <img className="film-poster-image" src={src} alt={schedule.filmDisplayTitle(film)} loading="lazy" /> : <span className="poster-placeholder">暂无海报</span>}
        </div>
        <div className="film-info">
          <div className="title-row">
            <h2 className="film-title">{schedule.filmDisplayTitle(film)}</h2>
          </div>
          {schedule.filmEnTitle(film) ? <div className="film-en">{schedule.filmEnTitle(film)}</div> : null}
          {fieldConfig.info !== false && metaText ? <div className="film-meta">{metaText}</div> : null}
          {(fieldConfig.info !== false && schedule.filmSection(film)) || (fieldConfig.rating !== false && ratingSummary) ? (
            <div className="film-fact-row">
              {fieldConfig.info !== false && schedule.filmSection(film) ? <span className="film-section">{schedule.filmSection(film)}</span> : null}
              {fieldConfig.rating !== false && ratingSummary ? <span className="film-rating">{ratingSummary}</span> : null}
            </div>
          ) : null}
        </div>
        <div className="star-rail" onClick={event => event.stopPropagation()}>
          {STAR_SLOTS.map(option => (
            <button
              className="star-hit"
              type="button"
              key={option.key}
              aria-label={option.label}
              onClick={() => onMark(film.id, mark === option.key ? '' : option.key)}
            >
              <span className={`star ${interestRank >= option.rank ? 'is-on' : ''}`} />
            </button>
          ))}
        </div>
      </div>
      {fieldConfig.synopsis === true && synopsis ? <div className="film-synopsis">{synopsis}</div> : null}
    </article>
  )
}

function FilmPage({
  films,
  marks,
  fieldConfig,
  setFieldConfig,
  query,
  setQuery,
  onAbout,
  openSmart,
  openFilm,
  setMark
}) {
  const [scope, setScope] = useStoredState('filmScope', 'all')
  const [fieldOpen, setFieldOpen] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [sortOpen, setSortOpen] = useState(false)
  const [activeSort, setActiveSort] = useStoredState('filmActiveSort', DEFAULT_SORT)
  const [collapsedGroups, setCollapsedGroups] = useStoredState('filmCollapsedGroups', {})
  const [section, setSection] = useStoredState('filmFilterSection', ALL_SECTION)
  const [director, setDirector] = useStoredState('filmFilterDirector', ALL_DIRECTOR)
  const [doubanMin, setDoubanMin] = useStoredState('filmFilterDoubanMin', 0)
  const [imdbMin, setImdbMin] = useStoredState('filmFilterImdbMin', 0)
  const searchFilms = useMemo(() => {
    const q = query.trim().toLowerCase()
    return films.filter(film => {
      if (!q) return true
      return filmSearchText(film).includes(q)
    })
  }, [films, query])
  const queriedFilms = useMemo(() => {
    return searchFilms.filter(film => scope !== 'marked' || getInterestRank(schedule.getFilmMark(film, marks)) > 0)
  }, [marks, scope, searchFilms])
  const filterOptionFilms = scope === 'marked' && !queriedFilms.length ? searchFilms : queriedFilms
  const sectionOptions = useMemo(() => [{ key: ALL_SECTION, label: '全部单元', count: filterOptionFilms.length }].concat(countOptions(filterOptionFilms, film => schedule.filmSection(film) || '其他')), [filterOptionFilms])
  const directorOptions = useMemo(() => [{ key: ALL_DIRECTOR, label: '全部导演', count: filterOptionFilms.length }].concat(countOptions(filterOptionFilms, film => schedule.filmDirector(film) || '未知导演')), [filterOptionFilms])
  const activeSection = sectionOptions.some(item => item.key === section) ? section : ALL_SECTION
  const activeDirector = directorOptions.some(item => item.key === director) ? director : ALL_DIRECTOR
  const list = useMemo(() => queriedFilms.filter(film => {
    if (activeSection !== ALL_SECTION && (schedule.filmSection(film) || '其他') !== activeSection) return false
    if (activeDirector !== ALL_DIRECTOR && (schedule.filmDirector(film) || '未知导演') !== activeDirector) return false
    if (doubanMin > 0 && ratingValue(film.doubanRating) < doubanMin) return false
    if (imdbMin > 0 && ratingValue(film.imdbRating) < imdbMin) return false
    return true
  }), [queriedFilms, activeSection, activeDirector, doubanMin, imdbMin])
  const groups = useMemo(() => buildFilmGroups(list, activeSort, marks), [list, activeSort, marks])
  const filterActiveCount = (activeSection !== ALL_SECTION ? 1 : 0) + (activeDirector !== ALL_DIRECTOR ? 1 : 0) + (doubanMin > 0 ? 1 : 0) + (imdbMin > 0 ? 1 : 0)
  const hasGroupedView = activeSort !== 'default' && groups.length > 0
  const allGroupsCollapsed = hasGroupedView && groups.every(group => collapsedGroups?.[group.key])
  const resetFilters = () => {
    setSection(ALL_SECTION)
    setDirector(ALL_DIRECTOR)
    setDoubanMin(0)
    setImdbMin(0)
  }
  const selectFilter = (type, value) => {
    if (type === 'section') setSection(value || ALL_SECTION)
    if (type === 'director') setDirector(value || ALL_DIRECTOR)
  }
  const toggleGroup = key => {
    setCollapsedGroups(prev => ({ ...(prev || {}), [key]: !prev?.[key] }))
  }
  const toggleAllGroups = () => {
    if (!hasGroupedView) return
    if (allGroupsCollapsed) {
      setCollapsedGroups(prev => {
        const next = { ...(prev || {}) }
        groups.forEach(group => { delete next[group.key] })
        return next
      })
      return
    }
    setCollapsedGroups(prev => groups.reduce((next, group) => {
      next[group.key] = true
      return next
    }, { ...(prev || {}) }))
  }

  return (
    <div className="page films-page">
      <div className="films-top">
        <div className="films-tool-row">
          <InlineAboutButton onClick={onAbout} />
          <SearchBox value={query} onChange={setQuery} placeholder="搜片名、导演、单元" />
          <SmartEntry onClick={openSmart} />
        </div>
      </div>

      <div className="film-filter-bar">
        <div className="film-filter-scroll">
          <div className="film-filter-row">
            <div className="interest-segment">
              <button className={`interest-option ${scope === 'all' ? 'is-active' : ''}`} type="button" onClick={() => setScope('all')}>全部影片</button>
              <button className={`interest-option ${scope === 'marked' ? 'is-active' : ''}`} type="button" onClick={() => setScope('marked')}>已标星影片</button>
            </div>
            <button className={`film-tool-chip ${sortOpen ? 'is-active' : ''}`} type="button" onClick={() => { setSortOpen(!sortOpen); setFieldOpen(false); setFilterOpen(false) }}>
              <span className="film-tool-label">{sortFilterLabel(activeSort)}</span>
              <span className="filter-triangle">▼</span>
            </button>
            <button className={`film-tool-chip ${filterOpen ? 'is-active' : ''}`} type="button" onClick={() => { setFilterOpen(!filterOpen); setFieldOpen(false); setSortOpen(false) }}>
              <span className="film-tool-label">筛选</span>
              {filterActiveCount ? <span className="filter-count">· {filterActiveCount}</span> : null}
            </button>
            <button className={`film-tool-chip ${fieldOpen ? 'is-active' : ''}`} type="button" onClick={() => { setFieldOpen(!fieldOpen); setSortOpen(false); setFilterOpen(false) }}>字段</button>
          </div>
        </div>
        {hasGroupedView ? (
          <button
            className="group-toggle-icon"
            type="button"
            onClick={toggleAllGroups}
            aria-label={allGroupsCollapsed ? '展开全部分组' : '收起全部分组'}
            title={allGroupsCollapsed ? '展开全部分组' : '收起全部分组'}
          >
            {allGroupsCollapsed ? <Maximize2 aria-hidden="true" /> : <Minimize2 aria-hidden="true" />}
          </button>
        ) : null}
      </div>

      {sortOpen ? (
        <div className="sort-panel">
          <div className="sort-grid">
            {SORT_OPTIONS.map(option => (
              <button
                className={`sort-option ${activeSort === option.key ? 'is-picked' : ''}`}
                type="button"
                key={option.key}
                onClick={() => { setActiveSort(option.key); setCollapsedGroups({}); setSortOpen(false) }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {filterOpen ? (
        <div className="filter-panel">
          <FilterOptionGroup label="单元" type="section" options={sectionOptions} active={activeSection} onSelect={selectFilter} />
          <FilterOptionGroup label="导演" type="director" options={directorOptions} active={activeDirector} onSelect={selectFilter} />
          <RatingSlider label="豆瓣评分" value={doubanMin} onChange={setDoubanMin} />
          <RatingSlider label="IMDb 评分" value={imdbMin} onChange={setImdbMin} />
          {filterActiveCount ? <button className="filter-panel-reset" type="button" onClick={resetFilters}>重置筛选</button> : null}
        </div>
      ) : null}

      {fieldOpen ? <FieldPanel fieldConfig={fieldConfig} setFieldConfig={setFieldConfig} mode="films" /> : null}

      {list.length ? (
        <div className="film-list">
          {groups.map(group => (
            <section className="film-group" key={group.key}>
              {activeSort !== 'default' ? (
                <button className="group-header" type="button" onClick={() => toggleGroup(group.key)}>
                  <div className="group-left">
                    <span className="group-caret-symbol">
                      {collapsedGroups?.[group.key] ? <ChevronRight aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
                    </span>
                    <div className="group-label">{group.label}</div>
                  </div>
                  <div className="group-side"><span className="group-count">{group.count} 部</span></div>
                </button>
              ) : null}
              {!collapsedGroups?.[group.key] ? (
                <div className="group-list">
                  {group.items.map(film => (
                    <FilmCard
                      key={film.id}
                      film={film}
                      mark={schedule.getFilmMark(film, marks) || ''}
                      fieldConfig={fieldConfig}
                      onOpen={openFilm}
                      onMark={setMark}
                    />
                  ))}
                </div>
              ) : null}
            </section>
          ))}
        </div>
      ) : (
        <div className="empty">
          <div className="empty-title">无结果</div>
        </div>
      )}
    </div>
  )
}

function TagLine({ screening, fieldConfig, popularity }) {
  const interest = screening.interest || {}
  const interestWord = interest.label ? interest.label.replace(/★+/g, '') : '未标星'
  return (
    <div className="tag-line">
      <span className={`interest tone-${interest.tone || 'gray'}`}>
        <span className="interest-word">{interestWord}</span>
        {interest.shortLabel ? <span className="interest-stars">{interest.shortLabel}</span> : null}
      </span>
      {screening.price ? <span className="price">¥{screening.price}</span> : null}
      {fieldConfig.ticket !== false && screening.ticket ? <span className="ticket">{screening.ticket}</span> : null}
      {fieldConfig.popularity !== false && popularity > 0 ? <span className="popularity">{popularity}人已排</span> : null}
    </div>
  )
}

function ActionGlyph({ type }) {
  return (
    <span className={`action-glyph is-${type}`}>
      <span className="glyph-line is-a" />
      <span className="glyph-line is-b" />
    </span>
  )
}

function ScreeningCard({ item, selected, filmScheduled, pickConflict, fieldConfig, popularity, onToggle, onOpenFilm }) {
  return (
    <div className={`screening-card ${selected ? 'is-selected' : ''}`}>
      {item.isMock ? <div className="mock-stamp">{item.mockLabel || '测试场次'}</div> : null}
      <button className="screening-body" type="button" onClick={() => onOpenFilm(item.filmId)}>
        <div className="screen-info">
          <div className="screen-title-row">
            <div className="screen-title">{item.cnTitle}</div>
          </div>
          {fieldConfig.info !== false && (item.cardMeta || item.screenMeta) ? (
            <div className="screen-meta-line"><span className="screen-meta">{item.cardMeta || item.screenMeta}</span></div>
          ) : null}
          {fieldConfig.rating !== false && item.ratingSummary ? <div className="rating-line">{item.ratingSummary}</div> : null}
          {fieldConfig.synopsis === true && item.synopsis ? <div className="screen-synopsis">{item.synopsis}</div> : null}
          <div className="venue-line">{item.cinema} · {item.hall}</div>
          <TagLine screening={item} fieldConfig={fieldConfig} popularity={popularity} />
        </div>
      </button>
      <div className="screening-actions">
        <button className={`pick-button ${selected ? 'is-on' : ''} ${filmScheduled && !selected ? 'is-switch' : ''} ${pickConflict ? 'has-conflict' : ''}`} type="button" onClick={() => onToggle(item.id)}>
          <span className={`pick-symbol ${selected ? 'is-filled' : ''}`}>
            <ActionGlyph type={selected ? 'check' : 'plus'} />
          </span>
          <span className="pick-label">{selected ? '已排' : filmScheduled ? '加入' : pickConflict ? '仍选' : '加入'}</span>
        </button>
        {filmScheduled && !selected ? <span className="action-note">已排过这部</span> : null}
      </div>
    </div>
  )
}

function TimelineDay({ group, selectedIds, allSelectedFilmIds, showHeader = true, collapsed = false, onToggleDay, fieldConfig, popularity, onToggle, onOpenFilm }) {
  return (
    <section className="screening-day">
      {showHeader ? (
        <button className="screening-day-head" type="button" onClick={onToggleDay}>
          <div className="screening-day-left">
            <span className="screening-day-caret">
              {collapsed ? <ChevronRight aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
            </span>
            <span className="screening-day-label">{group.dayLabel}</span>
          </div>
          <div className="screening-day-count">{group.items.length} 场</div>
        </button>
      ) : null}
      {!collapsed ? (
        <div className="screening-list">
          {group.items.map(item => (
            <div className={`timeline-item ${selectedIds.includes(item.id) ? 'is-selected' : ''} ${item.conflict ? 'has-conflict' : ''}`} key={item.id}>
              <div className="timeline-rail">
                <div className="time-stamp">
                  <span className="start mono">{item.start}</span>
                  <span className="end mono">{item.end}</span>
                </div>
                <div className={`timeline-node ${selectedIds.includes(item.id) ? 'is-selected' : ''} ${item.conflict ? 'has-conflict' : ''}`}>
                  {item.conflict ? <span className="conflict-cross"><span className="conflict-cross-line is-a" /><span className="conflict-cross-line is-b" /></span> : null}
                </div>
              </div>
              <ScreeningCard
                item={item}
                selected={selectedIds.includes(item.id)}
                filmScheduled={allSelectedFilmIds[item.filmId]}
                pickConflict={item.pickConflict}
                fieldConfig={fieldConfig}
                popularity={popularity[item.id] || 0}
                onToggle={onToggle}
                onOpenFilm={onOpenFilm}
              />
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}

function SchedulePage({
  screenings,
  marks,
  selectedIds,
  fieldConfig,
  setFieldConfig,
  query,
  setQuery,
  onAbout,
  openSmart,
  onToggle,
  openFilm,
  popularity,
  goFilms
}) {
  const [scope, setScope] = useStoredState('scheduleScope', 'marked')
  const [fieldOpen, setFieldOpen] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [activeDay, setActiveDay] = useStoredState('scheduleFilterDay', ALL_DAYS)
  const [activeDirector, setActiveDirector] = useStoredState('scheduleFilterDirector', ALL_DIRECTOR)
  const [activeCinema, setActiveCinema] = useStoredState('scheduleFilterCinema', ALL_CINEMAS)
  const [activeSection, setActiveSection] = useStoredState('scheduleFilterSection', ALL_SECTION)
  const [doubanMin, setDoubanMin] = useStoredState('scheduleFilterDoubanMin', 0)
  const [imdbMin, setImdbMin] = useStoredState('scheduleFilterImdbMin', 0)
  const [collapsedDays, setCollapsedDays] = useStoredState('scheduleCollapsedDays', {})
  const wantedScreenings = useMemo(() => screenings.filter(item => (item.interest && item.interest.rank) > 0), [screenings])
  const scopeScreenings = scope === 'all' ? screenings : wantedScreenings
  const filterOptionScreenings = scope === 'marked' && !scopeScreenings.length ? screenings : scopeScreenings
  const selectedFilmIds = useMemo(() => selectedIds.reduce((map, id) => {
    const item = screenings.find(screening => screening.id === id)
    if (item) map[item.filmId] = true
    return map
  }, {}), [selectedIds, screenings])
  const dateOptions = useMemo(() => {
    const grouped = schedule.groupByDay(filterOptionScreenings)
    return [{ key: ALL_DAYS, label: '全部日期', count: filterOptionScreenings.length }].concat(grouped.map(day => ({ key: day.date, label: day.dayLabel, count: day.items.length })))
  }, [filterOptionScreenings])
  const cinemaOptions = useMemo(() => [{ key: ALL_CINEMAS, label: '全部影院', count: filterOptionScreenings.length }].concat(countOptions(filterOptionScreenings, item => item.cinema || '未知影院')), [filterOptionScreenings])
  const sectionOptions = useMemo(() => [{ key: ALL_SECTION, label: '全部单元', count: filterOptionScreenings.length }].concat(countOptions(filterOptionScreenings, item => item.sectionLabel || '其他')), [filterOptionScreenings])
  const directorOptions = useMemo(() => [{ key: ALL_DIRECTOR, label: '全部导演', count: filterOptionScreenings.length }].concat(countOptions(filterOptionScreenings, item => item.director || '未知导演')), [filterOptionScreenings])
  const pickedDay = dateOptions.some(item => item.key === activeDay) ? activeDay : ALL_DAYS
  const pickedCinema = cinemaOptions.some(item => item.key === activeCinema) ? activeCinema : ALL_CINEMAS
  const pickedSection = sectionOptions.some(item => item.key === activeSection) ? activeSection : ALL_SECTION
  const pickedDirector = directorOptions.some(item => item.key === activeDirector) ? activeDirector : ALL_DIRECTOR
  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return scopeScreenings
      .filter(item => {
        if (pickedCinema !== ALL_CINEMAS && (item.cinema || '未知影院') !== pickedCinema) return false
        if (pickedSection !== ALL_SECTION && (item.sectionLabel || '其他') !== pickedSection) return false
        if (pickedDirector !== ALL_DIRECTOR && (item.director || '未知导演') !== pickedDirector) return false
        if (doubanMin > 0 && ratingValue(item.doubanRating) < doubanMin) return false
        if (imdbMin > 0 && ratingValue(item.imdbRating) < imdbMin) return false
        if (pickedDay !== ALL_DAYS && item.date !== pickedDay) return false
        if (q && ![
          item.searchText,
          item.country,
          item.year,
          item.dayLabel,
          item.date,
          item.ticket,
          item.price
        ].join(' ').toLowerCase().includes(q)) return false
        return true
      })
      .map(item => {
        const selected = selectedIds.includes(item.id)
        const conflictBaseIds = selected
          ? selectedIds.filter(id => id !== item.id)
          : selectedIds.filter(id => {
            const screening = screenings.find(source => source.id === id)
            return screening && screening.filmId !== item.filmId
          })
        const conflicts = schedule.findConflicts(item, conflictBaseIds, screenings)
        return {
          ...item,
          conflict: selected && conflicts.length > 0,
          pickConflict: !selected && conflicts.length > 0
        }
      })
  }, [scopeScreenings, pickedCinema, pickedSection, pickedDirector, pickedDay, doubanMin, imdbMin, query, selectedIds, screenings])
  const groups = useMemo(() => schedule.groupByDay(list), [list])
  const showDayHeaders = pickedDay === ALL_DAYS
  const hasDayGroups = showDayHeaders && groups.length > 0
  const allDaysCollapsed = hasDayGroups && groups.every(group => collapsedDays?.[group.date])
  const hasMarked = wantedScreenings.length > 0
  const filterActiveCount = (pickedDay !== ALL_DAYS ? 1 : 0) + (pickedCinema !== ALL_CINEMAS ? 1 : 0) + (pickedSection !== ALL_SECTION ? 1 : 0) + (pickedDirector !== ALL_DIRECTOR ? 1 : 0) + (doubanMin > 0 ? 1 : 0) + (imdbMin > 0 ? 1 : 0)
  const selectFilter = (type, value) => {
    if (type === 'date') setActiveDay(value || ALL_DAYS)
    if (type === 'cinema') setActiveCinema(value || ALL_CINEMAS)
    if (type === 'section') setActiveSection(value || ALL_SECTION)
    if (type === 'director') setActiveDirector(value || ALL_DIRECTOR)
  }
  const resetFilters = () => {
    setActiveDay(ALL_DAYS)
    setActiveCinema(ALL_CINEMAS)
    setActiveSection(ALL_SECTION)
    setActiveDirector(ALL_DIRECTOR)
    setDoubanMin(0)
    setImdbMin(0)
    setCollapsedDays({})
  }
  const toggleAllDays = () => {
    if (!hasDayGroups) return
    if (allDaysCollapsed) {
      setCollapsedDays(prev => {
        const next = { ...(prev || {}) }
        groups.forEach(group => { delete next[group.date] })
        return next
      })
      return
    }
    setCollapsedDays(prev => groups.reduce((next, group) => {
      next[group.date] = true
      return next
    }, { ...(prev || {}) }))
  }

  return (
    <div className="page schedule-page">
      <div className="schedule-top">
        <div className="schedule-tool-row">
          <InlineAboutButton onClick={onAbout} />
          <SearchBox value={query} onChange={setQuery} placeholder="搜片名、导演、影院" />
          <SmartEntry onClick={openSmart} />
        </div>
        <div className="schedule-filter-bar">
          <div className="scope-segment">
            <button className={`scope-option ${scope === 'all' ? 'is-active' : ''}`} type="button" onClick={() => { setScope('all'); setActiveDay(ALL_DAYS); setActiveCinema(ALL_CINEMAS); setCollapsedDays({}) }}>全部影片</button>
            <button className={`scope-option ${scope === 'marked' ? 'is-active' : ''}`} type="button" onClick={() => { setScope('marked'); setActiveDay(ALL_DAYS); setActiveCinema(ALL_CINEMAS); setCollapsedDays({}) }}>已标星影片</button>
          </div>
          <button className={`tool-filter-chip ${filterOpen ? 'is-active' : ''}`} type="button" onClick={() => { setFilterOpen(!filterOpen); setFieldOpen(false) }}>
            <span className="filter-label">筛选</span>
            {filterActiveCount ? <span className="filter-count">· {filterActiveCount}</span> : null}
          </button>
          <button className={`tool-filter-chip ${fieldOpen ? 'is-active' : ''}`} type="button" onClick={() => { setFieldOpen(!fieldOpen); setFilterOpen(false) }}>字段</button>
          {hasDayGroups ? (
            <button
              className="group-toggle-icon schedule-group-toggle"
              type="button"
              onClick={toggleAllDays}
              aria-label={allDaysCollapsed ? '展开全部日期' : '收起全部日期'}
              title={allDaysCollapsed ? '展开全部日期' : '收起全部日期'}
            >
              {allDaysCollapsed ? <Maximize2 aria-hidden="true" /> : <Minimize2 aria-hidden="true" />}
            </button>
          ) : null}
        </div>
        {filterOpen ? (
          <div className="filter-panel">
            <FilterOptionGroup label="日期" type="date" options={dateOptions} active={pickedDay} onSelect={selectFilter} />
            <FilterOptionGroup label="影院" type="cinema" options={cinemaOptions} active={pickedCinema} onSelect={selectFilter} />
            <FilterOptionGroup label="单元" type="section" options={sectionOptions} active={pickedSection} onSelect={selectFilter} />
            <FilterOptionGroup label="导演" type="director" options={directorOptions} active={pickedDirector} onSelect={selectFilter} />
            <RatingSlider label="豆瓣评分" value={doubanMin} onChange={setDoubanMin} />
            <RatingSlider label="IMDb 评分" value={imdbMin} onChange={setImdbMin} />
            {filterActiveCount ? <button className="filter-panel-reset" type="button" onClick={resetFilters}>重置筛选</button> : null}
          </div>
        ) : null}
        {fieldOpen ? <FieldPanel fieldConfig={fieldConfig} setFieldConfig={setFieldConfig} mode="schedule" /> : null}
      </div>

      {!groups.length ? (
        <div className="empty-state">
          {!hasMarked && scope === 'marked' ? (
            <div className="empty-start">
              <div className="empty-paragraph">
                <div className="empty-sentence"><span>还没有标记任何电影，你可以 </span><button className="empty-inline-link" type="button" onClick={goFilms}>选电影›</button></div>
                <div className="empty-sentence"><span>也可以看 </span><button className="empty-inline-link" type="button" onClick={() => { setScope('all'); setActiveDay(ALL_DAYS) }}>全部场次›</button><span>，打开完整时间表</span></div>
                <div className="empty-sentence"><span>也可以讲讲需求，让 </span><button className="empty-inline-link" type="button" onClick={openSmart}>智能排片›</button><span> 排一版</span></div>
              </div>
            </div>
          ) : <div className="empty-copy"><div className="empty-line">无结果</div></div>}
        </div>
      ) : (
        <div className="screening-days">
          {groups.map(group => (
            <TimelineDay
              key={group.date}
              group={group}
              selectedIds={selectedIds}
              allSelectedFilmIds={selectedFilmIds}
              showHeader={showDayHeaders}
              collapsed={showDayHeaders && !!collapsedDays[group.date]}
              onToggleDay={() => setCollapsedDays(prev => ({ ...prev, [group.date]: !prev[group.date] }))}
              fieldConfig={fieldConfig}
              popularity={popularity}
              onToggle={onToggle}
              onOpenFilm={openFilm}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function PlanCard({ screening, note, popularity, onEditNote, onRemove, onOpenFilm }) {
  return (
    <div className={`plan-card ${screening.conflict ? 'has-conflict' : ''}`}>
      {screening.isMock ? <div className="mock-stamp">{screening.mockLabel || '测试场次'}</div> : null}
      <div className="plan-content">
        <button className="plan-main" type="button" onClick={() => onOpenFilm(screening.filmId)}>
          <div className="plan-info">
            <div className="screen-title">{screening.cnTitle}</div>
            <div className="venue">{screening.cinema} · {screening.hall}</div>
            <div className="ticket-row">
              {screening.ticketPlan ? <span className="ticket">{screening.ticketPlan}</span> : null}
              {screening.price ? <span className="price">¥{screening.price}</span> : null}
              {popularity > 0 ? <span className="popularity">{popularity}人已排</span> : null}
            </div>
          </div>
        </button>
        <button className={`plan-note-row ${note ? '' : 'is-empty'}`} type="button" onClick={() => onEditNote(screening)}>
          <span className="plan-note">{note ? `备注：${note}` : '备注'}</span>
          <span className="plan-note-edit" aria-label={note ? '编辑备注' : '添加备注'} title={note ? '编辑备注' : '添加备注'}>
            <PencilLine aria-hidden="true" />
          </span>
        </button>
      </div>
      <button className="remove" type="button" onClick={() => onRemove(screening.id)}>
        <span className="remove-symbol"><ActionGlyph type="cross" /></span>
        <span className="remove-label">移除</span>
      </button>
    </div>
  )
}

function PlanTransfer({ from, to }) {
  const commute = schedule.commuteBetween(from, to)
  if (!commute) return null
  const lines = commute.kind === 'same'
    ? [commute.distanceText]
    : [commute.distanceText ? `📍${commute.distanceText}` : ''].concat(commute.modes.map(item => item.text)).filter(Boolean)

  return (
    <div className={`plan-transfer is-${commute.kind}`}>
      <div className="commute-badge" aria-label={`${commute.from}到${commute.to}通勤`}>
        {lines.map(line => <span key={line}>{line}</span>)}
      </div>
    </div>
  )
}

function fullConflictText(pair) {
  const a = pair?.a || {}
  const b = pair?.b || {}
  return `${a.start || ''} ${a.cnTitle || ''} / ${b.start || ''} ${b.cnTitle || ''}`
}

function PlanPage({
  schemes,
  activeScheme,
  setActiveSchemeId,
  addScheme,
  renameScheme,
  deleteScheme,
  plan,
  onAbout,
  openSmart,
  openImport,
  openExport,
  removeScreening,
  editPlanNote,
  openFilm,
  popularity
}) {
  const summary = `${plan.selected.length} 场${plan.totalMinutes ? ` · ${schedule.runtimeText(plan.totalMinutes)}` : ''}`
  const planNotes = activeScheme?.notes || {}
  const [conflictsExpanded, setConflictsExpanded] = useState(false)
  const longPressTimerRef = useRef(null)
  const longPressedRef = useRef(false)

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  const startSchemeLongPress = id => {
    clearLongPressTimer()
    longPressedRef.current = false
    longPressTimerRef.current = window.setTimeout(() => {
      longPressedRef.current = true
      renameScheme(id)
    }, 550)
  }

  const handleSchemeClick = (event, id) => {
    if (longPressedRef.current) {
      event.preventDefault()
      longPressedRef.current = false
      return
    }
    setActiveSchemeId(id)
  }

  useEffect(() => clearLongPressTimer, [])

  return (
    <div className="page plan-page">
      <div className="plan-top">
        <div className="plan-tool-row">
          <InlineAboutButton onClick={onAbout} />
          <div className="scheme-scroll">
            <div className="scheme-row">
              {schemes.map(scheme => (
                <button
                  className={`scheme-card ${scheme.id === activeScheme?.id ? 'is-active' : ''}`}
                  type="button"
                  key={scheme.id}
                  onClick={event => handleSchemeClick(event, scheme.id)}
                  onPointerDown={() => startSchemeLongPress(scheme.id)}
                  onPointerUp={clearLongPressTimer}
                  onPointerCancel={clearLongPressTimer}
                  onPointerLeave={clearLongPressTimer}
                  onContextMenu={event => {
                    event.preventDefault()
                    renameScheme(scheme.id)
                  }}
                >
                  <span className="scheme-name">{scheme.name}</span>
                </button>
              ))}
              <button className="scheme-card is-new" type="button" onClick={addScheme}>
                <span className="scheme-plus">＋</span>
                <span className="scheme-meta">新方案</span>
              </button>
            </div>
          </div>
          <SmartEntry onClick={openSmart} />
        </div>
        <div className="current-plan-bar">
          <div className="current-plan-lead">
            <span className="current-plan-summary">{summary}</span>
            {plan.conflictPairs.length ? (
              <button
                className={`conflict-toggle ${conflictsExpanded ? 'is-open' : ''}`}
                type="button"
                onClick={() => setConflictsExpanded(!conflictsExpanded)}
                aria-expanded={conflictsExpanded}
                aria-label={`${plan.conflictPairs.length}组冲突`}
              >
                <span className="conflict-alert-icon">!</span>
                <span>{plan.conflictPairs.length}组冲突</span>
              </button>
            ) : null}
          </div>
          <div className="current-plan-actions">
            <button className="plan-tool-button" type="button" onClick={deleteScheme}><span className="plan-action-icon is-clear" />删除</button>
            <button className="plan-tool-button" type="button" onClick={openImport}><span className="plan-action-icon is-import" />导入</button>
            <button className={`plan-tool-button ${plan.selected.length ? '' : 'is-disabled'}`} type="button" onClick={openExport}><span className="plan-action-icon is-export" />导出</button>
          </div>
        </div>
        {plan.conflictPairs.length && conflictsExpanded ? (
          <div className="conflict-panel">
            {plan.conflictPairs.map(item => (
              <div className="conflict-item" key={item.id}>{fullConflictText(item)}</div>
            ))}
          </div>
        ) : null}
      </div>

      {plan.selected.length === 0 ? (
        <div className="empty">
          <div className="empty-title">暂无排片</div>
        </div>
      ) : null}

      {plan.selected.length && activeScheme?.smartPlanMeta?.instruction ? (
        <div className="smart-summary">
          <span className="smart-summary-text">{activeScheme.smartPlanMeta.instruction}</span>
        </div>
      ) : null}

      {plan.selected.length ? (
        <div className="day-list">
          {plan.days.map(day => (
            <section className="day-section" key={day.date}>
              <div className="day-title">{day.dayLabel}</div>
              <div className="plan-timeline">
                {day.items.map((item, index) => (
                  <div className="plan-row-group" key={item.id}>
                    {index > 0 ? <PlanTransfer from={day.items[index - 1]} to={item} /> : null}
                    <div className={`plan-item ${item.conflict ? 'has-conflict' : ''}`}>
                      <div className="timeline-rail">
                        <div className="time-stamp">
                          <span className="start mono">{item.start}</span>
                          <span className="end mono">{item.end}</span>
                        </div>
                        <div className={`timeline-node ${item.conflict ? 'has-conflict' : ''}`}>
                          {item.conflict ? <span className="conflict-cross"><span className="conflict-cross-line is-a" /><span className="conflict-cross-line is-b" /></span> : null}
                        </div>
                      </div>
                      <PlanCard
                        screening={item}
                        note={planNotes[item.id] || ''}
                        popularity={popularity[item.id] || 0}
                        onEditNote={editPlanNote}
                        onRemove={removeScreening}
                        onOpenFilm={openFilm}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function PopularityPage({ festivalName, screenings, popularity, posterSrcByFilmId, loading, error, updatedAt, visibleLimit, onRefresh, onLoadMore, onAbout, openFilm }) {
  const loadMoreRef = useRef(null)
  const loadMoreTriggerRef = useRef(0)
  const rankRows = useMemo(() => buildPopularityRows(screenings, popularity, POPULARITY_RANK_MAX_LIMIT), [screenings, popularity])
  const rows = useMemo(() => rankRows.slice(0, visibleLimit), [rankRows, visibleLimit])
  const canLoadMore = visibleLimit < POPULARITY_RANK_MAX_LIMIT && rows.length < rankRows.length
  const max = rows[0]?.popularityCount || 1
  const meta = `来自「${APP_SHARE_NAME}」用户的真实选场数据 · ${formatRankUpdatedAt(updatedAt)}`

  useEffect(() => {
    if (!loading) loadMoreTriggerRef.current = 0
  }, [loading])

  useEffect(() => {
    const target = loadMoreRef.current
    if (!target || !canLoadMore || loading || typeof IntersectionObserver === 'undefined') return undefined
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return
      if (loadMoreTriggerRef.current === visibleLimit) return
      loadMoreTriggerRef.current = visibleLimit
      onLoadMore()
    }, { rootMargin: '160px 0px 260px', threshold: 0.01 })
    observer.observe(target)
    return () => observer.disconnect()
  }, [canLoadMore, loading, onLoadMore, visibleLimit])

  return (
    <div className="page popularity-page">
      <TopNav title="热度榜" festivalName={festivalName} onAbout={onAbout} />
      <div className="popularity-hero">
        <div className="popularity-brand">
          <span className="popularity-brand-dot" />
          <span>{APP_SHARE_NAME}</span>
        </div>
        <div className="popularity-title-row">
          <h1>{festivalName}</h1>
          <span>热度榜</span>
        </div>
        <div className="popularity-meta">{meta}</div>
        <button className={`popularity-refresh ${loading ? 'is-loading' : ''}`} type="button" onClick={onRefresh} disabled={loading}>
          <RefreshCw aria-hidden="true" />
          <span>{loading ? '更新中' : '刷新'}</span>
        </button>
      </div>

      {error ? <div className="popularity-error">{error}</div> : null}

      {rows.length ? (
        <div className="popularity-list">
          {rows.map((item, index) => {
            const rank = index + 1
            const isTop = rank <= 3
            const width = Math.max(4, Math.round((item.popularityCount / max) * 100))
            const src = posterSrcByFilmId[item.filmId] || String(item.posterSrc || '').replace(/^\/assets\/posters\//, '/posters/')
            return (
              <button className="popularity-row" type="button" key={item.id} onClick={() => openFilm(item.filmId)}>
                <span className={`popularity-rank ${isTop ? 'is-top' : ''}`}>{rank}</span>
                <span className={`popularity-poster ${src ? '' : 'is-placeholder'}`}>
                  {src ? <img src={src} alt={item.cnTitle} loading="lazy" /> : <span>{item.cnTitle.replace(/\s*\(4K\)/, '')}</span>}
                </span>
                <span className="popularity-info">
                  <span className="popularity-film-title">{item.cnTitle}</span>
                  <span className="popularity-time">{item.dayLabel} {item.timeRange}</span>
                  <span className="popularity-venue">{formatVenueLine(item)}</span>
                </span>
                <span className="popularity-count">
                  <span className="popularity-count-main">{item.popularityCount}</span>
                  <span className="popularity-count-unit">人已排</span>
                  <span className="popularity-bar">
                    <span className={isTop ? 'is-top' : ''} style={{ width: `${width}%` }} />
                  </span>
                </span>
              </button>
            )
          })}
          <div className="popularity-load-sentinel" ref={loadMoreRef} aria-hidden="true" />
        </div>
      ) : (
        <div className="popularity-empty">
          <div className="empty-title">{loading ? '正在更新热度' : '暂无热度数据'}</div>
          <div className="empty-sentence">{loading ? '稍等一下，榜单很快就来。' : '等有用户排片后，这里会显示最热门的场次。'}</div>
        </div>
      )}
      {rows.length && loading ? (
        <div className="popularity-list-footer">
          <span className="popularity-footer-spinner" aria-label="加载中" />
        </div>
      ) : null}
    </div>
  )
}

function SmartPlanModal({ open, onClose, onSubmit, loading, progress, error }) {
  const [instruction, setInstruction] = useState('')
  const [focused, setFocused] = useState(false)
  const inputRef = useRef(null)
  useEffect(() => {
    if (open) setFocused(false)
  }, [open])
  useEffect(() => {
    if (!open || typeof window === 'undefined') return undefined
    const scrollY = window.scrollY || 0
    const body = document.body
    const previous = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow
    }
    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.left = '0'
    body.style.right = '0'
    body.style.width = '100%'
    body.style.overflow = 'hidden'
    return () => {
      body.style.position = previous.position
      body.style.top = previous.top
      body.style.left = previous.left
      body.style.right = previous.right
      body.style.width = previous.width
      body.style.overflow = previous.overflow
      window.scrollTo(0, scrollY)
    }
  }, [open])

  if (!open) return null
  const hasValue = instruction.trim().length > 0
  const focusInput = event => {
    if (loading) return
    if (document.activeElement === inputRef.current) return
    event.preventDefault()
    setFocused(true)
    window.requestAnimationFrame(() => {
      try {
        inputRef.current?.focus({ preventScroll: true })
      } catch (error) {
        inputRef.current?.focus()
      }
    })
  }

  return (
    <div className="smart-mask" onClick={() => !loading && onClose()}>
      <div className="smart-sheet" onClick={event => event.stopPropagation()}>
        <div className="smart-head">
          <div className="smart-title">智能排片</div>
          <button className="smart-close" type="button" onClick={onClose}>×</button>
        </div>
        <div className={`smart-input-shell ${hasValue || focused ? 'is-focused' : ''}`} onPointerDown={focusInput}>
          {!hasValue && !focused ? (
            <div className="smart-field-prompt">
              <div className="smart-prompt-title">输入你的偏好让 AI 帮你排片或者挑电影，你可以说：</div>
              <div className="smart-prompt-line">- 帮我挑几部高分日影，尽量排到周末</div>
              <div className="smart-prompt-line">- 优先 Movie Movie 电影院</div>
              <div className="smart-prompt-line">- 工作日晚上 7 点前不要排，周五晚上 6 点后可以</div>
              <div className="smart-prompt-line">- 只看周末，一天最多三场</div>
            </div>
          ) : null}
          <textarea
            ref={inputRef}
            className={`smart-input ${hasValue || focused ? 'has-value' : ''}`}
            value={instruction}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={event => setInstruction(event.target.value)}
            disabled={loading}
            maxLength={240}
          />
        </div>
        {error ? <div className="import-error">{error}</div> : null}
        <div className="smart-actions">
          <button className="smart-secondary" type="button" onClick={onClose} disabled={loading}>取消</button>
          <button className={`smart-primary ${loading ? 'is-disabled' : ''}`} type="button" onClick={() => onSubmit(instruction)} disabled={!hasValue || loading}>
            <Spark primary spinning={loading} />
            <span className="smart-primary-label">{loading ? progress : 'AI排片'}</span>
          </button>
        </div>
      </div>
    </div>
  )
}

function ImportDialog({ mode, text, onText, onClose, onImport, onCopy }) {
  if (!mode) return null
  const isImport = mode === 'import'
  return (
    <div className="import-mask" onClick={onClose}>
      <div className="import-dialog" onClick={event => event.stopPropagation()}>
        <div className="import-head">
          <div className="import-title">{isImport ? '导入排片' : '导出文字版（发给朋友一键导入）'}</div>
          <button className="import-close" type="button" onClick={onClose}>×</button>
        </div>
        <textarea
          className="import-input"
          value={text}
          readOnly={!isImport}
          onChange={event => onText(event.target.value)}
          placeholder="粘贴朋友发来的文字版排片，导入后会生成新方案"
        />
        <div className="import-actions">
          <button className="import-secondary" type="button" onClick={onClose}>取消</button>
          <button className={`import-primary ${isImport && !text.trim() ? 'is-disabled' : ''}`} type="button" onClick={isImport ? onImport : onCopy}>{isImport ? '一键导入' : '复制文字版'}</button>
        </div>
      </div>
    </div>
  )
}

function ExportActionSheet({ open, onClose, onPoster, onText, onTicket }) {
  if (!open) return null
  return (
    <div className="action-sheet-mask" onClick={onClose}>
      <div className="action-sheet" onClick={event => event.stopPropagation()}>
        <button className="action-sheet-item" type="button" onClick={onPoster}>导出长图</button>
        <button className="action-sheet-item" type="button" onClick={onTicket}>导出求票 / 出票 / 换票图</button>
        <button className="action-sheet-item" type="button" onClick={onText}>导出文字版（发给朋友一键导入）</button>
        <button className="action-sheet-cancel" type="button" onClick={onClose}>取消</button>
      </div>
    </div>
  )
}

function PosterSheet({ open, theme, setTheme, includePosters, setIncludePosters, includePopularity, setIncludePopularity, includeNotes, setIncludeNotes, preview, previewLoading, onClose, onConfirm }) {
  if (!open) return null
  const activeTemplate = getPosterTheme(theme)
  const isPosterWall = activeTemplate.layout === 'wall'
  return (
    <div className="poster-mask" onClick={onClose}>
      <div className="poster-export-panel" onClick={event => event.stopPropagation()}>
        <div className="poster-live-preview">
          <div className={`poster-live-preview-frame ${isPosterWall ? 'is-wall' : ''}`}>
            {preview ? (
              <img className="poster-live-preview-image" src={preview.url} alt="海报预览" />
            ) : (
              <div className="poster-live-preview-empty">{previewLoading ? '生成预览中' : '暂无预览'}</div>
            )}
          </div>
        </div>
        <div className="poster-sheet">
          <div className="poster-grip" />
          <div className="poster-sheet-head">
            <div>
              <div className="poster-sheet-title">导出长图</div>
            </div>
            {previewLoading ? <span className="poster-preview-spinner" aria-label="生成预览中" /> : null}
          </div>
          <div className="poster-field-title">模板</div>
          <div className="poster-theme-row">
            {POSTER_THEMES.map(item => (
              <button className={`poster-theme ${theme === item.key ? 'is-picked' : ''}`} type="button" key={item.key} onClick={() => setTheme(item.key)}>
                <span className="poster-theme-swatch" style={{ background: item.swatch }} />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
          {!isPosterWall ? (
            <>
              <button
                className="poster-option-row"
                type="button"
                role="switch"
                aria-checked={includePosters}
                onClick={() => setIncludePosters(!includePosters)}
              >
                <span className="poster-option-text">电影海报</span>
                <span className={`poster-toggle ${includePosters ? 'is-on' : ''}`}>
                  <span className="poster-toggle-knob" />
                </span>
              </button>
              <button
                className="poster-option-row"
                type="button"
                role="switch"
                aria-checked={includePopularity}
                onClick={() => setIncludePopularity(!includePopularity)}
              >
                <span className="poster-option-text">热度信息</span>
                <span className={`poster-toggle ${includePopularity ? 'is-on' : ''}`}>
                  <span className="poster-toggle-knob" />
                </span>
              </button>
              <button
                className="poster-option-row"
                type="button"
                role="switch"
                aria-checked={includeNotes}
                onClick={() => setIncludeNotes(!includeNotes)}
              >
                <span className="poster-option-text">备注</span>
                <span className={`poster-toggle ${includeNotes ? 'is-on' : ''}`}>
                  <span className="poster-toggle-knob" />
                </span>
              </button>
            </>
          ) : null}
          <div className="poster-actions">
            <button className="poster-secondary" type="button" onClick={onClose}>取消</button>
            <button className={`poster-primary ${previewLoading ? 'is-disabled' : ''}`} type="button" onClick={onConfirm} disabled={previewLoading}>{previewLoading ? '生成中' : '生成长图'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

const TICKET_TYPES = [
  { key: 'seek', label: '求票', hint: '我想要这场票' },
  { key: 'offer', label: '出票', hint: '我有富余票转出' },
  { key: 'swap', label: '换票', hint: '我的票换你的票' }
]

function ticketScreeningBrief(item) {
  const day = String(item.dayLabel || item.date || '').trim()
  const time = item.start || ''
  const venue = compact([item.cinema, item.hall])
  return compact([`${day} ${time}`.trim(), venue])
}

// 票务图导出表单（合并版：类型 → 场次 → 联系方式）
function TicketPosterSheet({ open, allScreenings, selectedIds, posterSrcByFilmId, onClose, onGenerate }) {
  const [type, setType] = useState('offer')
  // 选中场次：id -> { price, seat }；换票分两组
  const [picked, setPicked] = useState({})
  const [givePicked, setGivePicked] = useState({})
  const [wantPicked, setWantPicked] = useState({})
  const [query, setQuery] = useState('')
  const [giveQuery, setGiveQuery] = useState('')
  const [wantQuery, setWantQuery] = useState('')
  const [contactMode, setContactMode] = useState('text')
  const [contactValue, setContactValue] = useState('')
  const [qrSrc, setQrSrc] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setType('offer')
    setPicked({})
    setGivePicked({})
    setWantPicked({})
    setQuery('')
    setGiveQuery('')
    setWantQuery('')
    setContactMode('text')
    setContactValue('')
    setQrSrc('')
    setBusy(false)
  }, [open])

  if (!open) return null

  const plannedSet = new Set(selectedIds || [])
  const planned = (allScreenings || []).filter(item => plannedSet.has(item.id))

  // 根据搜索词过滤候选场次：空词时只显示已排片，有词时搜全部
  const candidatesFor = q => {
    const text = String(q || '').trim().toLowerCase()
    if (!text) return planned
    return (allScreenings || []).filter(item => (item.searchText || '').includes(text)).slice(0, 30)
  }

  const togglePick = (store, setStore, id) => {
    setStore(prev => {
      const next = { ...prev }
      if (next[id]) delete next[id]
      else next[id] = { price: '', seat: '' }
      return next
    })
  }
  const updateField = (setStore, id, key, value) => {
    setStore(prev => (prev[id] ? { ...prev, [id]: { ...prev[id], [key]: value } } : prev))
  }

  const buildScreeningSpec = (id, fields) => {
    const item = (allScreenings || []).find(s => s.id === id)
    if (!item) return null
    return {
      cnTitle: item.cnTitle,
      dayLabel: item.dayLabel,
      date: item.date,
      start: item.start,
      end: item.end,
      cinema: item.cinema,
      hall: item.hall,
      posterSrc: (posterSrcByFilmId && posterSrcByFilmId[item.filmId]) || item.posterSrc || '',
      price: fields ? fields.price : '',
      seat: fields ? fields.seat : ''
    }
  }

  const selectedCount = type === 'swap'
    ? Object.keys(givePicked).length + Object.keys(wantPicked).length
    : Object.keys(picked).length

  const canGenerate = type === 'swap'
    ? Object.keys(givePicked).length > 0 && Object.keys(wantPicked).length > 0
    : Object.keys(picked).length > 0

  const handleGenerate = async () => {
    if (!canGenerate || busy) return
    setBusy(true)
    const contact = { mode: contactMode, value: contactValue.trim(), qrSrc: contactMode === 'qr' ? qrSrc : '' }
    let spec
    if (type === 'swap') {
      spec = {
        type,
        give: Object.entries(givePicked).map(([id, f]) => buildScreeningSpec(id, f)).filter(Boolean),
        want: Object.entries(wantPicked).map(([id, f]) => buildScreeningSpec(id, f)).filter(Boolean),
        contact
      }
    } else {
      spec = {
        type,
        screenings: Object.entries(picked).map(([id, f]) => buildScreeningSpec(id, f)).filter(Boolean),
        contact
      }
    }
    await onGenerate(spec)
    setBusy(false)
  }

  const onPickQr = event => {
    const file = event.target.files && event.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setQrSrc(String(reader.result || ''))
    reader.readAsDataURL(file)
  }

  const renderPickList = (candidates, store, setStore) => (
    <div className="ticket-pick">
      {candidates.length === 0 ? (
        <div className="ticket-empty">没有匹配的场次</div>
      ) : candidates.map(item => {
        const sel = !!store[item.id]
        return (
          <div key={item.id}>
            <button className={`ticket-pickrow ${sel ? 'is-sel' : ''}`} type="button" onClick={() => togglePick(store, setStore, item.id)}>
              <span className={`ticket-chk ${sel ? 'is-on' : ''}`} />
              <span className="ticket-pk-body">
                <span className="ticket-pk-film">{item.cnTitle}</span>
                <span className="ticket-pk-meta">{ticketScreeningBrief(item)}</span>
              </span>
            </button>
            {sel ? (
              <div className="ticket-opt">
                <div className="ticket-field">
                  <span className="ticket-fl">票价（可选）</span>
                  <input className="ticket-fi" value={store[item.id].price} placeholder="如 ¥80" onChange={e => updateField(setStore, item.id, 'price', e.target.value)} />
                </div>
                <div className="ticket-field">
                  <span className="ticket-fl">座位号（可选）</span>
                  <input className="ticket-fi" value={store[item.id].seat} placeholder="如 5 排 7-8" onChange={e => updateField(setStore, item.id, 'seat', e.target.value)} />
                </div>
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )

  return (
    <div className="poster-mask" onClick={onClose}>
      <div className="poster-sheet ticket-sheet" onClick={event => event.stopPropagation()}>
        <div className="poster-grip" />
        <div className="poster-sheet-head">
          <div className="poster-sheet-title">导出票务图</div>
        </div>

        <div className="ticket-scroll">
          <div className="poster-field-title">类型</div>
          <div className="ticket-type-row">
            {TICKET_TYPES.map(t => (
              <button key={t.key} className={`ticket-type is-${t.key} ${type === t.key ? 'is-on' : ''}`} type="button" onClick={() => setType(t.key)}>
                <span className="ticket-type-nm">{t.label}</span>
                <span className="ticket-type-hint">{t.hint}</span>
              </button>
            ))}
          </div>

          {type === 'swap' ? (
            <>
              <div className="poster-field-title ticket-give">我出（手里的票）</div>
              <input className="ticket-search" value={giveQuery} placeholder="已排片里选，或搜全部场次…" onChange={e => setGiveQuery(e.target.value)} />
              {renderPickList(candidatesFor(giveQuery), givePicked, setGivePicked)}

              <div className="poster-field-title ticket-want">我求（想要的票）</div>
              <input className="ticket-search" value={wantQuery} placeholder="搜索想换的场次…" onChange={e => setWantQuery(e.target.value)} />
              {renderPickList(candidatesFor(wantQuery), wantPicked, setWantPicked)}
            </>
          ) : (
            <>
              <div className="poster-field-title">场次（可多选 · 搜索新增）</div>
              <input className="ticket-search" value={query} placeholder="已排片里选，或搜全部场次…" onChange={e => setQuery(e.target.value)} />
              {renderPickList(candidatesFor(query), picked, setPicked)}
            </>
          )}

          <div className="poster-field-title">联系方式（二选一）</div>
          <div className="ticket-ctype">
            <button className={`ticket-c ${contactMode === 'text' ? 'is-on' : ''}`} type="button" onClick={() => setContactMode('text')}>文字号码</button>
            <button className={`ticket-c ${contactMode === 'qr' ? 'is-on' : ''}`} type="button" onClick={() => setContactMode('qr')}>二维码</button>
          </div>
          {contactMode === 'text' ? (
            <input className="ticket-input" value={contactValue} placeholder="如微信号 moviefan_88" onChange={e => setContactValue(e.target.value)} />
          ) : (
            <>
              <label className="ticket-upload">
                {qrSrc ? <img className="ticket-qr-preview" src={qrSrc} alt="二维码" /> : <span className="ticket-upload-text">上传微信 / 收款二维码图片</span>}
                <input type="file" accept="image/*" hidden onChange={onPickQr} />
              </label>
              <input className="ticket-input" value={contactValue} placeholder="二维码旁的说明（可选，如 加我约票）" onChange={e => setContactValue(e.target.value)} />
            </>
          )}
        </div>

        <div className="poster-actions">
          <button className="poster-secondary" type="button" onClick={onClose}>取消</button>
          <button className={`poster-primary ${!canGenerate || busy ? 'is-disabled' : ''}`} type="button" onClick={handleGenerate} disabled={!canGenerate || busy}>
            {busy ? '生成中' : selectedCount ? `生成 · 已选 ${selectedCount} 场` : '生成长图'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ImagePreview({ image, title = '图片预览', hint = '长按图片保存', onClose }) {
  if (!image) return null
  return (
    <div className="poster-preview-mask" onClick={onClose}>
      <div className="poster-preview" onClick={event => event.stopPropagation()}>
        <div className="poster-preview-head">
          <div>
            <div className="poster-preview-title">{title}</div>
            <div className="poster-preview-hint">{hint}</div>
          </div>
          <button className="poster-preview-close" type="button" onClick={onClose}>×</button>
        </div>
        <div className="poster-preview-scroll">
          <img className="poster-preview-image" src={image.url} alt={image.alt || title} />
        </div>
      </div>
    </div>
  )
}

function externalRatingHref(film, key) {
  if (key === 'douban') {
    if (film.doubanUrl) return film.doubanUrl
    if (film.doubanId) return `https://movie.douban.com/subject/${film.doubanId}/`
  }
  if (key === 'imdb') {
    if (film.imdbUrl) return film.imdbUrl
    if (film.imdbId) return `https://www.imdb.com/title/${film.imdbId}/`
  }
  return ''
}

function detailRatingItems(film) {
  const items = schedule.filmRatingItems(film).map(item => ({
    ...item,
    href: externalRatingHref(film, item.key)
  }))
  const hasDoubanRating = items.some(item => item.key === 'douban')
  const doubanHref = externalRatingHref(film, 'douban')
  if (doubanHref && !hasDoubanRating) {
    items.unshift({
      key: 'douban',
      label: '豆瓣',
      value: '暂无评分',
      href: doubanHref
    })
  }
  return items
}

function DetailRatingItem({ film, item }) {
  const href = item.href || externalRatingHref(film, item.key)
  const className = `detail-rating-item rating-${item.key}`
  const content = (
    <>
      <span className="detail-rating-label">{item.label}</span>
      <span className="detail-rating-value">{item.value}</span>
      {item.extra ? <span className="detail-rating-extra">{item.extra}</span> : null}
    </>
  )

  return href ? (
    <a className={className} href={href} target="_blank" rel="noreferrer">
      {content}
    </a>
  ) : (
    <span className={className}>{content}</span>
  )
}

function DetailScreeningCard({ item, selected, conflict, conflictText, popularity, onToggle }) {
  return (
    <div className={`detail-screening-card ${selected ? 'is-selected' : ''} ${conflict ? 'has-conflict' : ''}`}>
      {item.isMock ? <div className="mock-stamp">{item.mockLabel || '测试场次'}</div> : null}
      <div className="detail-screening-main">
        <div className="detail-screening-time">
          <span className="detail-screening-day">{item.dayLabel}</span>
          <span className="detail-screening-range">{item.timeRange}</span>
        </div>
        <div className="detail-screening-venue">{item.cinema} · {item.hall}</div>
        <div className="ticket-row">
          {item.ticketPlan ? <span className="ticket">{item.ticketPlan}</span> : null}
          {item.price ? <span className="price">¥{item.price}</span> : null}
          {popularity ? <span className="popularity">{popularity}人已排</span> : null}
        </div>
        {conflict ? <div className="detail-conflict">冲突：{conflictText}</div> : null}
      </div>
      <div className="screening-actions">
        <button className={`pick-button ${selected ? 'is-on' : ''}`} type="button" onClick={() => onToggle(item.id)}>
          <span className={`pick-symbol ${selected ? 'is-filled' : ''}`}>
            <ActionGlyph type={selected ? 'check' : 'plus'} />
          </span>
          <span className="pick-label">{selected ? '已排' : '加入'}</span>
        </button>
      </div>
    </div>
  )
}

function DetailModal({ film, screenings, allScreenings, selectedIds, mark, popularity, onClose, onToggle, onMark }) {
  if (!film) return null
  const src = posterSrc(film)
  const interest = schedule.getInterestMeta(mark || film.defaultInterest)
  const interestRank = interest.rank || 0
  const interestWord = ['未标记', '待定', '想看', '必看'][interestRank] || '未标记'
  const recommendation = film.recommendation || film.doulistComment || film.logline || ''
  const synopsis = filmSynopsis(film)
  const ratingItems = detailRatingItems(film)
  const infoRows = buildDetailInfoRows(film)
  const metaRows = buildDetailMetaRows(film)

  return (
    <div className="import-mask detail-mask" onClick={onClose}>
      <div className="detail-dialog" onClick={event => event.stopPropagation()}>
        <button className="detail-close" type="button" onClick={onClose}>×</button>
        <div className={`detail-head tone-${interest.tone || 'gray'}`}>
          <div className={`detail-poster ${src ? '' : 'is-placeholder'}`}>
            {src ? <img src={src} alt={schedule.filmDisplayTitle(film)} /> : <span>暂无海报</span>}
          </div>
          <div className="detail-info">
            <div className="detail-title">{schedule.filmDisplayTitle(film)}</div>
            {schedule.filmEnTitle(film) ? <div className="detail-en">{schedule.filmEnTitle(film)}</div> : null}
            {metaRows.length ? (
              <div className="detail-meta">
                {metaRows.map(row => <span className="detail-meta-line" key={row}>{row}</span>)}
              </div>
            ) : null}
            <div className="detail-tags">
              {schedule.filmSection(film) ? <span className="detail-tag">{schedule.filmSection(film)}</span> : null}
              {schedule.filmGenre(film) ? <span className="detail-tag">{schedule.filmGenre(film)}</span> : null}
            </div>
            {ratingItems.length ? (
              <div className="detail-rating-strip">
                {ratingItems.map(item => <DetailRatingItem key={item.key} film={film} item={item} />)}
              </div>
            ) : null}
          </div>
        </div>

        {recommendation ? (
          <div className="detail-quote">
            <span>官方推荐语</span>
            {recommendation}
          </div>
        ) : null}

        {synopsis ? (
          <div className="detail-quote detail-synopsis">
            <span>剧情简介</span>
            {synopsis}
          </div>
        ) : null}

        {infoRows.length ? (
          <div className="detail-fact-list">
            {infoRows.map(row => (
              <div className={`detail-fact ${row.multiline ? 'is-multiline' : ''}`} key={row.label}>
                <span className="detail-fact-label">{row.label}</span>
                {row.multiline ? (
                  <span className="detail-fact-value detail-fact-value-long">
                    {row.lines.map(line => <span className="detail-fact-line" key={line}>{line}</span>)}
                  </span>
                ) : (
                  <span className="detail-fact-value">{row.value}</span>
                )}
              </div>
            ))}
          </div>
        ) : null}

        <div className="detail-section">
          <div className="detail-section-title">想看程度</div>
          <div className="detail-star-line">
            <div className="detail-star-row">
              {STAR_SLOTS.map(option => (
                <button
                  className="detail-star-hit"
                  type="button"
                  key={option.key}
                  aria-label={option.label}
                  onClick={() => onMark(film.id, mark === option.key ? '' : option.key)}
                >
                  <span className={`star ${interestRank >= option.rank ? 'is-on' : ''}`} />
                </button>
              ))}
            </div>
            <span className={`detail-star-word ${interestRank ? 'is-set' : ''}`}>{interestWord}</span>
          </div>
        </div>

        <div className="detail-section-title">可选场次</div>
        <div className="detail-screenings">
          {screenings.length ? screenings.map(item => {
            const conflicts = schedule.findConflicts(item, selectedIds.filter(id => id !== item.id), allScreenings)
            return (
              <DetailScreeningCard
                key={item.id}
                item={item}
                selected={selectedIds.includes(item.id)}
                conflict={conflicts.length > 0}
                conflictText={conflicts.map(conflict => `${conflict.timeRange} ${conflict.cnTitle}`).join(' / ')}
                popularity={popularity[item.id] || 0}
                onToggle={onToggle}
              />
            )
          }) : <div className="empty-title">暂无场次</div>}
        </div>
      </div>
    </div>
  )
}

function AboutDialog({ festivalName, onClose, onToast, onPreviewQr }) {
  const copyGithub = async () => {
    try {
      await navigator.clipboard.writeText(GITHUB_URL)
      onToast('已复制链接')
    } catch (error) {
      onToast('复制失败，链接已显示')
    }
  }

  return (
    <div className="import-mask" onClick={onClose}>
      <div className="about-dialog" onClick={event => event.stopPropagation()}>
        <div className="import-head">
          <div className="import-title">关于赶场愉快</div>
          <button className="import-close" type="button" onClick={onClose}>×</button>
        </div>

        <div className="about-hero">
          <div className="about-kicker">{festivalName}</div>
          <div className="about-title">赶场愉快</div>
          <div className="about-subtitle">一个影迷自制的电影节选片、挑场次和排片工具。</div>
        </div>

        <div className="about-section">
          <div className="about-section-title">创作者</div>
          <div className="about-section-body">Shire</div>
        </div>

        <div className="about-section">
          <div className="about-section-title">链接</div>
          <div className="about-link-row">
            <span className="about-link-text">GitHub：{GITHUB_URL}</span>
            <button className="about-copy-button" type="button" onClick={copyGithub}>复制</button>
          </div>
        </div>

        <div className="about-section">
          <div className="about-section-title">致谢</div>
          <div className="about-section-body">感谢电影节官方公开信息、影迷整理资料，感谢「坚看眠聊」群友的支持，以及所有帮忙试用和反馈的人。</div>
        </div>

        <div className="about-section">
          <div className="about-section-title">说明</div>
          <div className="about-section-body">排片、票务和活动信息可能变化，请以官方发布为准。智能排片只做辅助判断。</div>
        </div>

        <div className="about-section">
          <div className="about-section-title">隐私与统计</div>
          <div className="about-section-body">使用智能排片时，偏好文本会发送给 AI 服务解析；开启热度情况时，会匿名统计你选择的场次。</div>
        </div>

        <div className="about-section">
          <div className="about-section-title">交流群</div>
          <div className="about-section-body">长按二维码识别加入，反馈问题、交流选片和排片。</div>
          <button className="community-box" type="button" onClick={onPreviewQr}>
            <img src="/community/wechat-feedback-group.jpg" alt="赶场愉快反馈群二维码" />
          </button>
        </div>
      </div>
    </div>
  )
}

function SchemeRenameDialog({ open, value, onValue, onClose, onConfirm }) {
  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => {
      const input = document.querySelector('.scheme-modal-input')
      if (input) input.focus()
    }, 30)
    return () => window.clearTimeout(timer)
  }, [open])

  if (!open) return null

  return (
    <div className="wechat-modal-mask" onClick={onClose}>
      <div className="wechat-modal" onClick={event => event.stopPropagation()}>
        <div className="wechat-modal-title">方案改名</div>
        <input
          className="scheme-modal-input"
          value={value}
          onChange={event => onValue(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') onConfirm()
          }}
          placeholder="输入方案名"
          maxLength={16}
        />
        <div className="wechat-modal-actions">
          <button className="wechat-modal-button" type="button" onClick={onClose}>取消</button>
          <button className="wechat-modal-button is-confirm" type="button" onClick={onConfirm}>保存</button>
        </div>
      </div>
    </div>
  )
}

function SchemeDeleteDialog({ open, onClose, onConfirm }) {
  if (!open) return null

  return (
    <div className="wechat-modal-mask" onClick={onClose}>
      <div className="wechat-modal" onClick={event => event.stopPropagation()}>
        <div className="wechat-modal-title">删除方案</div>
        <div className="wechat-modal-content">是否删除此方案？</div>
        <div className="wechat-modal-actions">
          <button className="wechat-modal-button" type="button" onClick={onClose}>取消</button>
          <button className="wechat-modal-button is-danger" type="button" onClick={onConfirm}>删除</button>
        </div>
      </div>
    </div>
  )
}

function PlanNoteDialog({ open, title, value, onValue, onClose, onConfirm }) {
  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => {
      const input = document.querySelector('.plan-note-input')
      if (input) input.focus()
    }, 30)
    return () => window.clearTimeout(timer)
  }, [open])

  if (!open) return null

  return (
    <div className="wechat-modal-mask" onClick={onClose}>
      <div className="wechat-modal" onClick={event => event.stopPropagation()}>
        <div className="wechat-modal-title">场次备注</div>
        <div className="plan-note-dialog-title">{title}</div>
        <textarea
          className="plan-note-input"
          value={value}
          onChange={event => onValue(event.target.value)}
          onKeyDown={event => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') onConfirm()
          }}
          placeholder="比如：让 A 抢、已抢到"
          maxLength={PLAN_NOTE_MAX_LENGTH}
        />
        <div className="plan-note-dialog-hint">{value.length}/{PLAN_NOTE_MAX_LENGTH}</div>
        <div className="wechat-modal-actions">
          <button className="wechat-modal-button" type="button" onClick={onClose}>取消</button>
          <button className="wechat-modal-button is-confirm" type="button" onClick={onConfirm}>保存</button>
        </div>
      </div>
    </div>
  )
}

function Toast({ message }) {
  if (!message) return null
  return <div className="toast">{message}</div>
}

export default function FestivalWebApp() {
  const films = festival.films || []
  const festivalId = festival.festivalMeta?.name || 'SIFF 2026'
  const festivalName = festival.festivalMeta?.displayName || festivalId
  const [tab, setTab] = useState('films')
  const [query, setQuery] = useState('')
  const [marks, setMarks] = useStoredState('marks', {})
  const [schemes, setSchemes] = useStoredState('schemes', initialSchemes())
  const [activeSchemeId, setActiveSchemeId] = useStoredState('activeSchemeId', DEFAULT_SCHEME_ID)
  const [filmFieldConfig, setFilmFieldConfig] = useStoredState('filmFieldConfig', DEFAULT_FILM_FIELD_CONFIG)
  const [scheduleFieldConfig, setScheduleFieldConfig] = useStoredState('scheduleFieldConfig', DEFAULT_SCHEDULE_FIELD_CONFIG)
  const [popularity, setPopularity] = useState({})
  const [detailFilm, setDetailFilm] = useState(null)
  const [smartOpen, setSmartOpen] = useState(false)
  const [smartLoading, setSmartLoading] = useState(false)
  const [smartProgress, setSmartProgress] = useState('识别需求')
  const [smartError, setSmartError] = useState('')
  const [importMode, setImportMode] = useState('')
  const [importText, setImportText] = useState('')
  const [exportSheetOpen, setExportSheetOpen] = useState(false)
  const [posterSheetOpen, setPosterSheetOpen] = useState(false)
  const [posterTheme, setPosterTheme] = useState('list')
  const [posterIncludePosters, setPosterIncludePosters] = useState(false)
  const [posterIncludePopularity, setPosterIncludePopularity] = useState(false)
  const [posterIncludeNotes, setPosterIncludeNotes] = useState(false)
  const [posterDraftPreview, setPosterDraftPreview] = useState(null)
  const [posterDraftLoading, setPosterDraftLoading] = useState(false)
  const [posterPreview, setPosterPreview] = useState(null)
  const [ticketSheetOpen, setTicketSheetOpen] = useState(false)
  const [imagePreview, setImagePreview] = useState(null)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [popularityRankCounts, setPopularityRankCounts] = useState({})
  const [popularityRankUpdatedAt, setPopularityRankUpdatedAt] = useState(0)
  const [popularityRankLoading, setPopularityRankLoading] = useState(false)
  const [popularityRankError, setPopularityRankError] = useState('')
  const [popularityRankLimit, setPopularityRankLimit] = useState(POPULARITY_RANK_INITIAL_LIMIT)
  const [schemeDialog, setSchemeDialog] = useState(null)
  const [schemeNameDraft, setSchemeNameDraft] = useState('')
  const [planNoteDialog, setPlanNoteDialog] = useState(null)
  const [planNoteDraft, setPlanNoteDraft] = useState('')
  const [toast, setToast] = useState('')
  const [showScrollTop, setShowScrollTop] = useState(false)
  const toastTimerRef = useRef(null)
  const scrollPositionsRef = useRef({ films: 0, schedule: 0, plan: 0, popularity: 0 })
  const popularitySyncSignatureRef = useRef('')
  const popularityRankRequestRef = useRef(null)

  const switchTab = nextTab => {
    if (nextTab === tab) return
    if (typeof window !== 'undefined') {
      scrollPositionsRef.current[tab] = window.scrollY || 0
    }
    trackUsageEvent(`tab_${nextTab}`, festivalId)
    setTab(nextTab)
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          window.scrollTo(0, scrollPositionsRef.current[nextTab] || 0)
        })
      })
    }
  }

  const scrollToTop = () => {
    scrollPositionsRef.current[tab] = 0
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  const showToast = (message, duration = 1500) => {
    setToast(message)
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => {
      setToast('')
      toastTimerRef.current = null
    }, duration)
  }

  const allScreenings = useMemo(() => schedule.buildScreenings(films, marks), [films, marks])
  const filmMap = useMemo(() => films.reduce((map, film) => {
    map[film.id] = film
    return map
  }, {}), [films])
  const screeningFilmMap = useMemo(() => films.reduce((map, film) => {
    ;(film.screenings || []).forEach(screening => { map[screening.id] = film.id })
    return map
  }, {}), [films])
  const posterSrcByFilmId = useMemo(() => films.reduce((map, film) => {
    const src = posterSrc(film)
    if (src) map[film.id] = src
    return map
  }, {}), [films])
  const validScreeningIds = useMemo(() => allScreenings.reduce((map, item) => {
    map[item.id] = true
    return map
  }, {}), [allScreenings])
  const allScreeningIds = useMemo(() => allScreenings.map(item => item.id), [allScreenings])
  const allScreeningIdsSignature = useMemo(() => allScreeningIds.join('|'), [allScreeningIds])
  const normalizedSchemes = useMemo(() => {
    const list = Array.isArray(schemes) && schemes.length ? schemes : initialSchemes()
    return list.map((scheme, index) => {
      const selectedSchemeIds = uniqueIds(scheme.selectedIds).filter(id => validScreeningIds[id])
      return {
        ...scheme,
        name: scheme.name || `方案 ${index + 1}`,
        selectedIds: selectedSchemeIds,
        notes: sanitizePlanNotes(scheme.notes, validScreeningIds, selectedSchemeIds)
      }
    })
  }, [schemes, validScreeningIds])
  const activeScheme = normalizedSchemes.find(scheme => scheme.id === activeSchemeId) || normalizedSchemes[0]
  const selectedIds = activeScheme?.selectedIds || []
  const selectedIdsSignature = selectedIds.join('|')
  const selectedScreeningPayload = useMemo(() => selectedIds.map(id => ({
    screeningId: id,
    filmId: screeningFilmMap[id] || ''
  })), [selectedIdsSignature, screeningFilmMap])
  const plan = useMemo(() => schedule.buildPlan(selectedIds, allScreenings), [selectedIds, allScreenings])
  const popularityRankSource = hasPositivePopularityCounts(popularityRankCounts) ? popularityRankCounts : popularity

  const refreshPopularityRank = (force = false) => {
    if (!allScreeningIds.length) return
    const now = Date.now()
    if (popularityRankRequestRef.current) return
    if (!force && hasPositivePopularityCounts(popularityRankCounts) && popularityRankUpdatedAt && now - popularityRankUpdatedAt < POPULARITY_RANK_REFRESH_MS) return
    setPopularityRankLoading(true)
    setPopularityRankError('')
    const request = fetch('/api/popularity/get', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        festivalId,
        screeningIds: allScreeningIds
      })
    }).then(res => res.json()).then(result => {
      if (!result.ok) throw new Error(result.error || '热度更新失败')
      const nextCounts = result.screeningCounts || {}
      setPopularityRankCounts(nextCounts)
      setPopularityRankUpdatedAt(hasPositivePopularityCounts(nextCounts) ? Date.now() : 0)
    }).catch(() => {
      setPopularityRankError('热度更新失败，稍后再试')
    }).finally(() => {
      popularityRankRequestRef.current = null
      setPopularityRankLoading(false)
    })
    popularityRankRequestRef.current = request
  }

  const loadMorePopularityRank = () => {
    if (popularityRankLimit >= POPULARITY_RANK_MAX_LIMIT || popularityRankLoading || popularityRankRequestRef.current) return
    setPopularityRankLimit(Math.min(popularityRankLimit + POPULARITY_RANK_STEP, POPULARITY_RANK_MAX_LIMIT))
    refreshPopularityRank(true)
  }

  useEffect(() => {
    if (!activeSchemeId && normalizedSchemes[0]) setActiveSchemeId(normalizedSchemes[0].id)
  }, [activeSchemeId, normalizedSchemes, setActiveSchemeId])

  useEffect(() => {
    setPopularityRankLimit(POPULARITY_RANK_INITIAL_LIMIT)
  }, [allScreeningIdsSignature, festivalId])

  useEffect(() => () => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
  }, [])

  useEffect(() => {
    const hasBlockingOverlay = !!(detailFilm || smartOpen || importMode || exportSheetOpen || posterSheetOpen || posterPreview || imagePreview || aboutOpen || schemeDialog || planNoteDialog)
    if (!hasBlockingOverlay || typeof document === 'undefined') return
    const body = document.body
    const scrollY = window.scrollY || 0
    const previousOverflow = body.style.overflow
    const previousTouchAction = body.style.touchAction
    const previousPosition = body.style.position
    const previousTop = body.style.top
    const previousWidth = body.style.width
    body.style.overflow = 'hidden'
    body.style.touchAction = 'none'
    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.width = '100%'
    return () => {
      body.style.overflow = previousOverflow
      body.style.touchAction = previousTouchAction
      body.style.position = previousPosition
      body.style.top = previousTop
      body.style.width = previousWidth
      window.scrollTo(0, scrollY)
    }
  }, [detailFilm, smartOpen, importMode, exportSheetOpen, posterSheetOpen, posterPreview, imagePreview, aboutOpen, schemeDialog, planNoteDialog])

  useEffect(() => {
    setMarks(prev => applyFilmMarkAliases(films, prev))
  }, [films, marks, setMarks])

  useEffect(() => {
    trackUsageEvent('app_open', festivalId)
  }, [festivalId])

  useEffect(() => {
    const updateScrollTop = () => {
      setShowScrollTop((window.scrollY || 0) > 360)
    }
    updateScrollTop()
    window.addEventListener('scroll', updateScrollTop, { passive: true })
    return () => window.removeEventListener('scroll', updateScrollTop)
  }, [])

  useEffect(() => {
    if (tab === 'popularity') refreshPopularityRank(false)
  }, [tab, allScreeningIdsSignature, festivalId])

  useEffect(() => {
    if (!posterSheetOpen || !plan.selected.length) {
      setPosterDraftPreview(null)
      setPosterDraftLoading(false)
      return undefined
    }
    let cancelled = false
    setPosterDraftLoading(true)
    setPosterDraftPreview(null)
    createPlanPosterImage(plan, {
      festivalName,
      theme: posterTheme,
      includePosters: posterIncludePosters,
      includePopularity: posterIncludePopularity,
      includeNotes: posterIncludeNotes,
      posterSrcByFilmId,
      popularity,
      notes: activeScheme?.notes || {}
    }).then(image => {
      if (!cancelled) setPosterDraftPreview(image)
    }).catch(() => {
      if (!cancelled) setPosterDraftPreview(null)
    }).finally(() => {
      if (!cancelled) setPosterDraftLoading(false)
    })
    return () => { cancelled = true }
  }, [posterSheetOpen, plan, festivalName, posterTheme, posterIncludePosters, posterIncludePopularity, posterIncludeNotes, posterSrcByFilmId, popularity, activeScheme?.notes])

  useEffect(() => {
    if (scheduleFieldConfig.popularity === false) {
      setPopularity({})
      fetch('/api/popularity/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ festivalId, anonUserId: getAnonUserId(), screeningIds: [], queryScreeningIds: [], screenings: [] })
      }).catch(() => {})
      return
    }
    if (!allScreeningIds.length) return
    const timer = window.setTimeout(() => {
      fetch('/api/popularity/get', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          festivalId,
          screeningIds: allScreeningIds
        })
      }).then(res => res.json()).then(result => {
        if (result.ok) setPopularity(result.screeningCounts || {})
      }).catch(() => {})
    }, 1200)
    return () => window.clearTimeout(timer)
  }, [allScreeningIdsSignature, festivalId, scheduleFieldConfig.popularity])

  useEffect(() => {
    if (scheduleFieldConfig.popularity === false) return
    const syncSignature = `${festivalId}|${selectedIdsSignature}`
    if (!selectedIds.length && !popularitySyncSignatureRef.current) return
    if (popularitySyncSignatureRef.current === syncSignature) return
    popularitySyncSignatureRef.current = syncSignature
    const timer = window.setTimeout(() => {
      fetch('/api/popularity/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          festivalId,
          anonUserId: getAnonUserId(),
          screeningIds: selectedIds,
          queryScreeningIds: selectedIds,
          screenings: selectedScreeningPayload
        })
      }).then(res => res.json()).then(result => {
        if (result.ok) {
          setPopularity(prev => ({ ...prev, ...(result.screeningCounts || {}) }))
        }
      }).catch(() => {})
    }, 1500)
    return () => window.clearTimeout(timer)
  }, [selectedIdsSignature, selectedScreeningPayload, festivalId, scheduleFieldConfig.popularity])

  const setActiveSelectedIds = (ids, smartPlanMeta) => {
    const targetId = activeScheme?.id || normalizedSchemes[0]?.id || DEFAULT_SCHEME_ID
    const nextIds = uniqueIds(ids)
    setSchemes(prev => {
      const list = Array.isArray(prev) && prev.length ? prev : initialSchemes()
      return list.map(scheme => scheme.id === targetId ? {
        ...scheme,
        selectedIds: nextIds,
        notes: sanitizePlanNotes(scheme.notes, validScreeningIds, nextIds),
        smartPlanMeta: smartPlanMeta === undefined ? scheme.smartPlanMeta : smartPlanMeta,
        updatedAt: Date.now()
      } : scheme)
    })
  }

  const toggleScreening = id => {
    const screening = allScreenings.find(item => item.id === id)
    if (!screening) return
    const selected = selectedIds.includes(id)
    if (selected) {
      trackUsageEvent('unselect_screening', festivalId)
      setActiveSelectedIds(selectedIds.filter(item => item !== id), null)
      showToast('已移除', 1000)
      return
    }
    trackUsageEvent('select_screening', festivalId)
    const nextSelectedIds = selectedIds.concat(id)
    const conflicts = schedule.findConflicts(screening, nextSelectedIds.filter(item => item !== id), allScreenings)
    setActiveSelectedIds(nextSelectedIds, null)
    showToast(
      conflicts.length ? '已加入，时间重叠' : '已加入排片',
      1000
    )
  }

  const setMark = (filmId, mark) => {
    trackUsageEvent(mark ? 'mark_film' : 'unmark_film', festivalId)
    setMarks(prev => {
      const next = { ...(prev || {}) }
      if (mark) next[filmId] = mark
      else delete next[filmId]
      return next
    })
  }

  const addScheme = () => {
    const scheme = createScheme(`方案 ${normalizedSchemes.length + 1}`)
    setSchemes(prev => (Array.isArray(prev) ? prev : []).concat(scheme))
    setActiveSchemeId(scheme.id)
    showToast(`${scheme.name} 已新建`)
  }

  const renameScheme = id => {
    const scheme = normalizedSchemes.find(item => item.id === id)
    if (!scheme) return
    setSchemeNameDraft(scheme.name || '')
    setSchemeDialog({ type: 'rename', id })
  }

  const confirmRenameScheme = () => {
    const id = schemeDialog?.id
    const name = schemeNameDraft.trim()
    if (!id) return
    if (!name) {
      showToast('名称不能为空')
      return
    }
    setSchemes(prev => prev.map(item => item.id === id ? { ...item, name: name.trim().slice(0, 16), updatedAt: Date.now() } : item))
    setSchemeDialog(null)
    showToast('已改名')
  }

  const editPlanNote = screening => {
    if (!screening || !activeScheme) return
    setPlanNoteDialog({
      screeningId: screening.id,
      title: `${screening.timeRange}｜${screening.cnTitle}`
    })
    setPlanNoteDraft(activeScheme.notes?.[screening.id] || '')
  }

  const confirmPlanNote = () => {
    const screeningId = planNoteDialog?.screeningId
    if (!screeningId || !activeScheme) return
    const text = planNoteDraft.trim().slice(0, PLAN_NOTE_MAX_LENGTH)
    setSchemes(prev => {
      const list = Array.isArray(prev) && prev.length ? prev : initialSchemes()
      return list.map(scheme => {
        if (scheme.id !== activeScheme.id) return scheme
        const notes = sanitizePlanNotes(scheme.notes, validScreeningIds, scheme.selectedIds)
        if (text) notes[screeningId] = text
        else delete notes[screeningId]
        return { ...scheme, notes, updatedAt: Date.now() }
      })
    })
    setPlanNoteDialog(null)
    setPlanNoteDraft('')
    showToast(text ? '备注已保存' : '备注已清除')
  }

  const deleteScheme = () => {
    if (!activeScheme) return
    setSchemeDialog({ type: 'delete', id: activeScheme.id })
  }

  const confirmDeleteScheme = () => {
    const id = schemeDialog?.id
    if (!id) return
    setSchemes(prev => {
      const next = prev.filter(item => item.id !== id)
      if (!next.length) {
        const scheme = createScheme('方案 1')
        setActiveSchemeId(scheme.id)
        return [scheme]
      }
      setActiveSchemeId(next[0].id)
      return next
    })
    setSchemeDialog(null)
    showToast('已删除')
  }

  const runSmartPlan = async instruction => {
    const value = instruction.trim()
    if (!value) return
    trackUsageEvent('smart_submit', festivalId)
    const timers = []
    setSmartLoading(true)
    setSmartError('')
    setSmartProgress(SMART_PROGRESS_STEPS[0].text)
    SMART_PROGRESS_STEPS.slice(1).forEach(step => {
      timers.push(window.setTimeout(() => {
        setSmartProgress(step.text)
      }, step.delay))
    })
    try {
      const response = await fetch('/api/ai-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction: value, marks, selectedIds, nowMs: Date.now() })
      })
      const result = await response.json()
      if (!response.ok || !result.ok) throw new Error(result.message || result.error || 'AI 生成失败')
      setActiveSelectedIds(result.selectedIds || [], {
        instruction: value,
        mode: result.mode,
        allowAddFilms: result.allowAddFilms,
        preferences: result.preferences,
        ai: result.ai,
        createdAt: Date.now()
      })
      setSmartOpen(false)
      trackUsageEvent('smart_success', festivalId)
      switchTab('plan')
    } catch (error) {
      trackUsageEvent('smart_error', festivalId)
      setSmartError(String(error?.message || error || 'AI 生成失败'))
    } finally {
      timers.forEach(timer => window.clearTimeout(timer))
      setSmartLoading(false)
      setSmartProgress('')
    }
  }

  const openFilm = filmOrId => {
    const film = typeof filmOrId === 'string' ? filmMap[filmOrId] : filmOrId
    if (film) {
      trackUsageEvent('film_detail_open', festivalId)
      setDetailFilm(film)
    }
  }

  const openSmart = () => {
    trackUsageEvent('smart_open', festivalId)
    setSmartOpen(true)
  }

  const openAbout = () => {
    trackUsageEvent('about_open', festivalId)
    setAboutOpen(true)
  }

  const openImport = () => {
    trackUsageEvent('import_open', festivalId)
    setImportText('')
    setImportMode('import')
  }

  const openCommunityQr = () => {
    trackUsageEvent('community_open', festivalId)
    setImagePreview({ url: '/community/wechat-feedback-group.jpg', alt: '赶场愉快反馈群二维码' })
  }

  const exportPayload = {
    type: 'festival-plan',
    version: 1,
    festival: festivalId,
    festivalName,
    activeSchemeId: activeScheme?.id || '',
    schemes: normalizedSchemes,
    marks,
    exportedAt: new Date().toISOString()
  }

  const openExport = () => {
    if (!plan.selected.length) {
      showToast('先加入场次')
      return
    }
    trackUsageEvent('export_open', festivalId)
    setExportSheetOpen(true)
  }

  const openTextExport = async () => {
    trackUsageEvent('export_text', festivalId)
    setExportSheetOpen(false)
    const text = formatPlanText(plan, {
      festivalName,
      schemeName: activeScheme?.name,
      notes: activeScheme?.notes
    })
    try {
      await navigator.clipboard.writeText(text)
      showToast('已复制')
    } catch (error) {
      setImportText(text)
      setImportMode('export')
    }
  }

  const openPosterExport = () => {
    trackUsageEvent('export_poster', festivalId)
    setExportSheetOpen(false)
    setPosterIncludePosters(false)
    setPosterIncludePopularity(false)
    setPosterIncludeNotes(false)
    setPosterDraftPreview(null)
    setPosterSheetOpen(true)
  }

  const openTicketExport = () => {
    trackUsageEvent('export_ticket', festivalId)
    setExportSheetOpen(false)
    setTicketSheetOpen(true)
  }

  const generateTicketPoster = async spec => {
    const image = await createTicketPosterImage(spec, { festivalName })
    if (image) {
      setTicketSheetOpen(false)
      setPosterPreview(image)
      showToast('票务图已生成')
    } else {
      showToast('生成失败')
    }
  }

  const confirmPosterExport = async () => {
    const image = posterDraftPreview || await createPlanPosterImage(plan, {
      festivalName,
      theme: posterTheme,
      includePosters: posterIncludePosters,
      includePopularity: posterIncludePopularity,
      includeNotes: posterIncludeNotes,
      posterSrcByFilmId,
      popularity,
      notes: activeScheme?.notes || {}
    })
    if (image) {
      setPosterPreview(image)
      showToast('长图已生成')
    } else {
      showToast('生成失败')
    }
    setPosterSheetOpen(false)
  }

  const importPlan = () => {
    try {
      const importedIds = parseImportScreeningIds(importText, validScreeningIds)
      if (importedIds.length) {
        const scheme = createScheme(`导入 ${normalizedSchemes.length + 1}`, importedIds)
        setSchemes(prev => (Array.isArray(prev) ? prev : []).concat(scheme))
        setActiveSchemeId(scheme.id)
        setImportMode('')
        trackUsageEvent('import_success', festivalId)
        switchTab('plan')
        return
      }
      const payload = parseImportText(importText)
      const nextSchemes = payload.schemes.map((scheme, index) => {
        const importedSelectedIds = uniqueIds(scheme.selectedIds).filter(id => validScreeningIds[id])
        return {
          id: String(scheme.id || `import_${Date.now()}_${index}`),
          name: String(scheme.name || `方案 ${index + 1}`).slice(0, 16),
          selectedIds: importedSelectedIds,
          notes: sanitizePlanNotes(scheme.notes, validScreeningIds, importedSelectedIds),
          smartPlanMeta: scheme.smartPlanMeta || null,
          createdAt: scheme.createdAt || Date.now(),
          updatedAt: Date.now()
        }
      })
      setSchemes(nextSchemes.length ? nextSchemes : initialSchemes())
      setActiveSchemeId(payload.activeSchemeId || nextSchemes[0]?.id || DEFAULT_SCHEME_ID)
      setMarks(payload.marks && typeof payload.marks === 'object' ? payload.marks : {})
      setImportMode('')
      trackUsageEvent('import_success', festivalId)
      switchTab('plan')
    } catch (error) {
      showToast(error.message || '导入失败')
    }
  }

  const copyExport = async () => {
    try {
      await navigator.clipboard.writeText(importText)
      showToast('已复制')
    } catch (error) {
      showToast('复制失败，可以手动全选复制')
    }
  }

  return (
    <main>
      {tab === 'films' ? (
        <FilmPage
          films={films}
          marks={marks}
          fieldConfig={filmFieldConfig}
          setFieldConfig={setFilmFieldConfig}
          query={query}
          setQuery={setQuery}
          onAbout={openAbout}
          openSmart={openSmart}
          openFilm={openFilm}
          setMark={setMark}
        />
      ) : null}
      {tab === 'schedule' ? (
        <SchedulePage
          screenings={allScreenings}
          marks={marks}
          selectedIds={selectedIds}
          fieldConfig={scheduleFieldConfig}
          setFieldConfig={setScheduleFieldConfig}
          query={query}
          setQuery={setQuery}
          onAbout={openAbout}
          openSmart={openSmart}
          onToggle={toggleScreening}
          openFilm={openFilm}
          popularity={popularity}
          goFilms={() => switchTab('films')}
        />
      ) : null}
      {tab === 'plan' ? (
        <PlanPage
          schemes={normalizedSchemes}
          activeScheme={activeScheme}
          setActiveSchemeId={setActiveSchemeId}
          addScheme={addScheme}
          renameScheme={renameScheme}
          deleteScheme={deleteScheme}
          plan={plan}
          onAbout={openAbout}
          openSmart={openSmart}
          openImport={openImport}
          openExport={openExport}
          removeScreening={toggleScreening}
          editPlanNote={editPlanNote}
          openFilm={openFilm}
          popularity={popularity}
        />
      ) : null}
      {tab === 'popularity' ? (
        <PopularityPage
          festivalName={festivalName}
          screenings={allScreenings}
          popularity={popularityRankSource}
          posterSrcByFilmId={posterSrcByFilmId}
          loading={popularityRankLoading}
          error={popularityRankError}
          updatedAt={popularityRankUpdatedAt}
          visibleLimit={popularityRankLimit}
          onRefresh={() => refreshPopularityRank(true)}
          onLoadMore={loadMorePopularityRank}
          onAbout={openAbout}
          openFilm={openFilm}
        />
      ) : null}
      <nav className="tabbar">
        <button className={tab === 'films' ? 'is-active' : ''} type="button" onClick={() => switchTab('films')}>
          <img className="tab-icon" src={tab === 'films' ? '/tab/films-active.png' : '/tab/films.png'} alt="" />
          选电影
        </button>
        <button className={tab === 'schedule' ? 'is-active' : ''} type="button" onClick={() => switchTab('schedule')}>
          <img className="tab-icon" src={tab === 'schedule' ? '/tab/schedule-active.png' : '/tab/schedule.png'} alt="" />
          挑场次
        </button>
        <button className={tab === 'plan' ? 'is-active' : ''} type="button" onClick={() => switchTab('plan')}>
          <img className="tab-icon" src={tab === 'plan' ? '/tab/plan-active.png' : '/tab/plan.png'} alt="" />
          排片表
        </button>
        <button className={tab === 'popularity' ? 'is-active' : ''} type="button" onClick={() => switchTab('popularity')}>
          <img className="tab-icon" src={tab === 'popularity' ? '/tab/popularity-active.png' : '/tab/popularity.png'} alt="" />
          热度榜
        </button>
      </nav>
      {showScrollTop ? (
        <button className="scroll-top-button" type="button" onClick={scrollToTop} aria-label="返回顶部" title="返回顶部">
          <ArrowUpToLine aria-hidden="true" />
        </button>
      ) : null}
      <SmartPlanModal open={smartOpen} onClose={() => !smartLoading && setSmartOpen(false)} onSubmit={runSmartPlan} loading={smartLoading} progress={smartProgress} error={smartError} />
      <ExportActionSheet open={exportSheetOpen} onClose={() => setExportSheetOpen(false)} onPoster={openPosterExport} onText={openTextExport} onTicket={openTicketExport} />
      <TicketPosterSheet
        open={ticketSheetOpen}
        allScreenings={allScreenings}
        selectedIds={selectedIds}
        posterSrcByFilmId={posterSrcByFilmId}
        onClose={() => setTicketSheetOpen(false)}
        onGenerate={generateTicketPoster}
      />
      <PosterSheet
        open={posterSheetOpen}
        theme={posterTheme}
        setTheme={setPosterTheme}
        includePosters={posterIncludePosters}
        setIncludePosters={setPosterIncludePosters}
        includePopularity={posterIncludePopularity}
        setIncludePopularity={setPosterIncludePopularity}
        includeNotes={posterIncludeNotes}
        setIncludeNotes={setPosterIncludeNotes}
        preview={posterDraftPreview}
        previewLoading={posterDraftLoading}
        onClose={() => setPosterSheetOpen(false)}
        onConfirm={confirmPosterExport}
      />
      <ImagePreview
        image={posterPreview}
        title="长图已生成"
        hint="长按图片保存"
        onClose={() => setPosterPreview(null)}
      />
      <ImagePreview image={imagePreview} title="交流群" hint="长按二维码识别加入" onClose={() => setImagePreview(null)} />
      <ImportDialog mode={importMode} text={importText} onText={setImportText} onClose={() => setImportMode('')} onImport={importPlan} onCopy={copyExport} />
      <DetailModal
        film={detailFilm}
        screenings={detailFilm ? schedule.findFilmScreenings(detailFilm, allScreenings) : []}
        allScreenings={allScreenings}
        selectedIds={selectedIds}
        mark={detailFilm ? schedule.getFilmMark(detailFilm, marks) || '' : ''}
        popularity={popularity}
        onClose={() => setDetailFilm(null)}
        onToggle={toggleScreening}
        onMark={setMark}
      />
      {aboutOpen ? (
        <AboutDialog
          festivalName={festivalName}
          onClose={() => setAboutOpen(false)}
          onToast={showToast}
          onPreviewQr={openCommunityQr}
        />
      ) : null}
      <SchemeRenameDialog
        open={schemeDialog?.type === 'rename'}
        value={schemeNameDraft}
        onValue={setSchemeNameDraft}
        onClose={() => setSchemeDialog(null)}
        onConfirm={confirmRenameScheme}
      />
      <SchemeDeleteDialog
        open={schemeDialog?.type === 'delete'}
        onClose={() => setSchemeDialog(null)}
        onConfirm={confirmDeleteScheme}
      />
      <PlanNoteDialog
        open={!!planNoteDialog}
        title={planNoteDialog?.title || ''}
        value={planNoteDraft}
        onValue={setPlanNoteDraft}
        onClose={() => {
          setPlanNoteDialog(null)
          setPlanNoteDraft('')
        }}
        onConfirm={confirmPlanNote}
      />
      <Toast message={toast} />
    </main>
  )
}
