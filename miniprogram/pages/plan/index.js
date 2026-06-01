const {
  buildPlan,
  buildScreenings
} = require('../../utils/schedule')
const { getNavMetrics } = require('../../utils/nav')

const app = getApp()

const POSTER_WIDTH = 750
const MINIAPP_CODE_PATH = ''
const DEFAULT_POSTER_THEME = 'list'
const POSTER_FONT_FAMILY = '"PingFang SC", "Hiragino Sans GB", sans-serif'
const APP_SHARE_NAME = '赶场愉快'
const IMPORT_HINT = `用「${APP_SHARE_NAME}」导入：复制全文或底部导入码。`
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
  }
]
function getPosterTheme(key) {
  return POSTER_THEMES.find(theme => theme.key === key) || POSTER_THEMES[0]
}

function estimateTextWidth(text, size) {
  return Array.from(String(text || '')).reduce((sum, char) => {
    return sum + (/[\x00-\x7F]/.test(char) ? size * 0.56 : size)
  }, 0)
}

function wrapText(text, maxWidth, size, maxLines) {
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

  if (line) {
    lines.push(line)
  }

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
  const festivalName = posterFestivalName(name)
  return `我的 ${festivalName}`
}

function posterTitleParts(title) {
  const normalized = String(title || '').trim()
  const match = normalized.match(/^我的\s+(.+)$/)
  if (match && match[1]) {
    return {
      prefix: '我的',
      main: match[1]
    }
  }
  return {
    prefix: '',
    main: normalized
  }
}

function posterDayNumber(day) {
  const text = `${day.dayLabel || ''} ${day.date || ''}`
  const slashMatch = text.match(/\d{1,2}\/(\d{1,2})/)
  if (slashMatch) {
    return slashMatch[1]
  }
  const dateMatch = text.match(/\d{4}[-/](\d{1,2})[-/](\d{1,2})/)
  if (dateMatch) {
    return dateMatch[2]
  }
  return ''
}

function buildPoster(plan, options) {
  const theme = getPosterTheme(options && options.theme)
  const layout = theme.layout || 'minimal'
  const width = POSTER_WIDTH
  const margin = layout === 'gallery' ? 58 : layout === 'list' ? 62 : 74
  const contentWidth = width - margin * 2
  const timeX = margin
  const mainX = layout === 'gallery' ? 188 : layout === 'list' ? 184 : 216
  const mainWidth = width - mainX - margin
  const blocks = []
  let y = layout === 'noir' ? 52 : layout === 'list' ? 48 : 56

  blocks.push({
    type: 'header',
    x: margin,
    y,
    width: contentWidth,
    height: layout === 'noir' ? 214 : layout === 'list' ? 188 : 204,
    festivalName: posterFestivalName(app.globalData.festivalMeta.name),
    title: posterFestivalTitle(app.globalData.festivalMeta.name)
  })
  y += layout === 'noir' ? 292 : layout === 'list' ? 238 : 284

  plan.days.forEach(day => {
    y += layout === 'minimal' ? 34 : layout === 'list' ? 24 : 26
    const dayStartY = y
    const dayNumber = posterDayNumber(day)

    blocks.push({
      type: 'dayStart',
      x: margin,
      y: dayStartY,
      width: contentWidth,
      label: day.dayLabel,
      number: dayNumber
    })
    y += layout === 'minimal' ? 72 : layout === 'list' ? 58 : 58

    day.items.forEach(item => {
      const titleSize = layout === 'noir' ? 28 : layout === 'list' ? 28 : 29
      const venueSize = layout === 'noir' ? 20 : layout === 'list' ? 20 : 21
      const titleLines = wrapText(item.cnTitle, mainWidth, titleSize)
      const venueLines = wrapText(posterVenue(item), mainWidth, venueSize)
      const itemHeight = Math.max(
        layout === 'gallery' ? 116 : layout === 'list' ? 98 : 106,
        26 + titleLines.length * (layout === 'list' ? 34 : 36) + venueLines.length * (layout === 'list' ? 26 : 28)
      )

      blocks.push({
        type: 'item',
        x: margin,
        y,
        height: itemHeight,
        timeX,
        mainX,
        mainWidth,
        start: item.start,
        end: item.end,
        titleLines,
        venueLines,
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
    height: options && options.includeCode ? 94 : 46,
    codePath: options && options.includeCode ? MINIAPP_CODE_PATH : ''
  })
  y += (options && options.includeCode ? 126 : 76)

  return {
    width,
    height: Math.max(420, y),
    blocks,
    theme,
    includeCode: !!(options && options.includeCode),
    summary: {
      title: `${app.globalData.festivalMeta.name} 我的排片`,
      count: `${plan.selected.length} 场 · ${formatPosterDuration(plan.totalMinutes)}`,
      screenings: plan.selected.length,
      duration: formatPosterDuration(plan.totalMinutes)
    }
  }
}

function formatMinutes(minutes) {
  const hour = Math.floor(minutes / 60)
  const minute = minutes % 60
  return `${hour}小时${minute ? `${minute}分` : ''}`
}

function popularityText(count) {
  const value = Number(count) || 0
  return value > 0 ? `${value} 人已排` : ''
}

function formatPosterDuration(minutes) {
  const hour = Math.floor(minutes / 60)
  const minute = minutes % 60
  return `${hour}h${minute ? `${minute}m` : ''}`
}

function formatHourValue(minutes) {
  const hour = minutes / 60
  return Number.isInteger(hour) ? `${hour}` : hour.toFixed(1)
}

function formatExportSummary(plan) {
  if (!plan || !plan.selected || !plan.selected.length) {
    return '还没有排片'
  }
  return `${plan.selected.length} 场 · ${formatMinutes(plan.totalMinutes)}`
}

function formatVenueLine(item) {
  return [item.cinema, item.hall]
    .map(part => String(part || '').trim())
    .filter(Boolean)
    .join(' · ')
}

function canvasFontWeight(weight) {
  if (String(weight || '').toLowerCase() === 'bold') {
    return 'bold'
  }
  return Number(weight) >= 560 ? 'bold' : 'normal'
}

function setText(ctx, size, color, weight) {
  ctx.fillStyle = color
  ctx.font = `${canvasFontWeight(weight)} ${size}px ${POSTER_FONT_FAMILY}`
}

function setNumberText(ctx, size, color, weight) {
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

function drawPosterPin(ctx, x, y, color) {
  ctx.save()
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x, y, 8, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(x - 6, y + 4)
  ctx.lineTo(x, y + 15)
  ctx.lineTo(x + 6, y + 4)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = 'rgba(255, 255, 255, 0.48)'
  ctx.beginPath()
  ctx.arc(x, y, 3, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function drawTextWithTracking(ctx, text, x, y, tracking) {
  let cursorX = x
  Array.from(String(text || '')).forEach(char => {
    ctx.fillText(char, cursorX, y)
    cursorX += ctx.measureText(char).width + tracking
  })
}

function drawPosterTitleBlock(ctx, block, poster, colors) {
  const layout = colors.layout || 'minimal'
  const titleSize = layout === 'list' ? 44 : layout === 'noir' ? 42 : 41
  const brandY = layout === 'list' ? block.y + 30 : block.y + 50
  const titleY = layout === 'list' ? block.y + 90 : block.y + 124
  const summaryY = layout === 'list' ? block.y + 134 : block.y + 168
  const lineY = layout === 'list' ? block.y + 174 : block.y + 204
  const tagHeight = layout === 'list' ? 32 : 30
  const tagText = '排片'
  const tagBg = colors.accent || colors.ink
  const tagInk = colors.bg
  const title = block.festivalName || posterFestivalName(app.globalData.festivalMeta.name)

  ctx.save()
  setText(ctx, 18, colors.muted || colors.subtle, '520')
  ctx.fillText(APP_SHARE_NAME, block.x, brandY)

  setText(ctx, titleSize, colors.ink, '650')
  ctx.fillText(title, block.x, titleY)

  const titleWidth = ctx.measureText(title).width
  const tagWidth = 68
  const tagX = block.x + titleWidth + 16
  const tagY = titleY - tagHeight + 4
  if (tagX + tagWidth <= block.x + block.width) {
    fillRoundRect(ctx, tagX, tagY, tagWidth, tagHeight, tagHeight / 2, tagBg)
    setText(ctx, 17, tagInk, '620')
    ctx.fillText(tagText, tagX + 17, tagY + 22)
  }

  setNumberText(ctx, 20, colors.muted || colors.subtle, '420')
  ctx.fillText(poster.summary.count, block.x, summaryY)

  ctx.strokeStyle = colors.faint || colors.ghost
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(block.x, lineY)
  ctx.lineTo(block.x + block.width, lineY)
  ctx.stroke()
  ctx.restore()
}

function drawPosterStats(ctx, block, poster, colors) {
  const right = block.x + block.width
  const top = block.y + 66
  const left = right - 166
  const dividerX = left + 72
  const count = `${poster.summary.screenings || 0}`
  const duration = poster.summary.duration || '0h'

  ctx.save()
  ctx.strokeStyle = colors.faint || colors.ghost
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(left, top - 20)
  ctx.lineTo(right, top - 20)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(dividerX, top - 4)
  ctx.lineTo(dividerX, top + 66)
  ctx.stroke()

  setNumberText(ctx, 28, colors.ink, '560')
  const countWidth = ctx.measureText(count).width
  ctx.fillText(count, left, top + 14)
  setText(ctx, 14, colors.muted || colors.subtle, '360')
  ctx.fillText('场', left + countWidth + 5, top + 13)
  ctx.fillText('场次', left, top + 46)

  setNumberText(ctx, 20, colors.ink, '520')
  ctx.fillText(duration, dividerX + 22, top + 12)
  setText(ctx, 14, colors.muted || colors.subtle, '360')
  ctx.fillText('总时长', dividerX + 22, top + 46)
  ctx.restore()
}

function drawPosterHeader(ctx, block, poster, colors) {
  drawPosterTitleBlock(ctx, block, poster, colors)
}

function drawTextLines(ctx, lines, x, y, lineHeight) {
  lines.forEach((line, index) => {
    ctx.fillText(line, x, y + index * lineHeight)
  })
}

function getImageInfo(src) {
  return new Promise(resolve => {
    wx.getImageInfo({
      src,
      success: () => resolve(true),
      fail: () => resolve(false)
    })
  })
}

function drawPosterImage(canvas, ctx, src, x, y, width, height) {
  return new Promise(resolve => {
    if (!src || !canvas || !canvas.createImage) {
      resolve(false)
      return
    }

    const image = canvas.createImage()
    image.onload = () => {
      ctx.drawImage(image, x, y, width, height)
      resolve(true)
    }
    image.onerror = () => resolve(false)
    image.src = src
  })
}

function uniqueIds(ids) {
  const seen = {}
  return ids.filter(id => {
    if (!id || seen[id]) {
      return false
    }
    seen[id] = true
    return true
  })
}

function normalizeMatchText(text) {
  return String(text || '')
    .replace(/[“”"']/g, '')
    .replace(/[（）()]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase()
}

function formatPlanText(plan, options) {
  const source = options || {}
  const lines = [
    `${APP_SHARE_NAME}｜${source.festivalName || '电影节'}排片`,
    source.schemeName ? `${source.schemeName} · ${formatExportSummary(plan)}` : formatExportSummary(plan),
    ''
  ]

  plan.days.forEach(day => {
    lines.push(day.dayLabel)
    day.items.forEach(item => {
      const conflictMark = item.conflict ? ' [冲突]' : ''
      lines.push(`${item.timeRange}｜${item.cnTitle}${conflictMark}`)
      lines.push(formatVenueLine(item))
      lines.push('')
    })
  })

  if (plan.conflictPairs.length) {
    lines.push('待处理冲突')
    plan.conflictPairs.forEach(pair => lines.push(pair.label))
    lines.push('')
  }

  lines.push(`导入码：${plan.selected.map(item => item.id).join(',')}`)
  lines.push(IMPORT_HINT)
  return lines.join('\n')
}

function parseImportCodes(text) {
  const match = String(text || '').match(/导入码[:：]\s*([^\n\r]+)/)
  if (!match) {
    return []
  }
  return uniqueIds(match[1]
    .split(/[,，、\s]+/)
    .map(item => item.trim())
    .filter(Boolean))
}

function parseTextMatches(text, allScreenings) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
  const picked = []
  const used = {}
  const dayMap = allScreenings.reduce((map, screening) => {
    if (screening.dayLabel) {
      map[normalizeMatchText(screening.dayLabel)] = screening.date
    }
    return map
  }, {})
  let currentDate = ''

  lines.forEach((line, index) => {
    const match = line.match(/^(\d{1,2}:\d{2})\s*[-–—~至]\s*(\d{1,2}:\d{2})\s*[｜| ]\s*(.+)$/)
    if (!match) {
      const date = dayMap[normalizeMatchText(line)]
      if (date) {
        currentDate = date
      }
      return
    }

    const start = match[1]
    const end = match[2]
    const title = match[3].replace(/\s*\[冲突\]\s*$/, '').trim()
    const venueLine = lines[index + 1] || ''
    const normalizedTitle = normalizeMatchText(title)
    const normalizedVenue = normalizeMatchText(venueLine)
    const candidates = allScreenings
      .filter(screening => {
        return screening.start === start &&
          screening.end === end &&
          (!currentDate || screening.date === currentDate) &&
          normalizeMatchText(screening.cnTitle) === normalizedTitle &&
          !used[screening.id]
      })
      .map(screening => {
        const cinemaHit = normalizedVenue.includes(normalizeMatchText(screening.cinema))
        const hallHit = normalizedVenue.includes(normalizeMatchText(screening.hall))
        return {
          screening,
          score: (cinemaHit ? 2 : 0) + (hallHit ? 1 : 0)
        }
      })
      .sort((a, b) => b.score - a.score)

    if (candidates.length) {
      const id = candidates[0].screening.id
      used[id] = true
      picked.push(id)
    }
  })

  return picked
}

function parsePlanImportText(text, allScreenings) {
  const idMap = allScreenings.reduce((map, screening) => {
    map[screening.id] = true
    return map
  }, {})
  const codedIds = parseImportCodes(text).filter(id => idMap[id])
  if (codedIds.length) {
    return uniqueIds(codedIds)
  }
  return uniqueIds(parseTextMatches(text, allScreenings))
}

function buildCurrentPlan() {
  const allScreenings = buildScreenings(app.globalData.films, app.getFilmMarks())
  return buildPlan(app.getSelectedScreeningIds(), allScreenings)
}

function attachPopularity(plan, counts) {
  const popularityMap = counts || {}
  return Object.assign({}, plan, {
    days: (plan.days || []).map(day => Object.assign({}, day, {
      items: (day.items || []).map(screening => Object.assign({}, screening, {
        popularityCount: popularityMap[screening.id] || 0,
        popularityText: popularityText(popularityMap[screening.id])
      }))
    })),
    selected: (plan.selected || []).map(screening => Object.assign({}, screening, {
      popularityCount: popularityMap[screening.id] || 0,
      popularityText: popularityText(popularityMap[screening.id])
    }))
  })
}

Page({
  data: {
    festivalName: app.globalData.festivalMeta.name,
    plan: {
      selected: [],
      days: [],
      conflictPairs: [],
      totalPrice: 0,
      totalMinutes: 0
    },
    totalHourValue: '0',
    priceLabel: '-',
    smartPlanMeta: null,
    empty: true,
    planSchemes: [],
    activePlanSchemeId: '',
    importSheetOpen: false,
    importText: '',
    importError: '',
    exportSummary: '还没有排片',
    posterSheetOpen: false,
    posterThemes: POSTER_THEMES,
    posterTheme: DEFAULT_POSTER_THEME,
    posterCodeAvailable: false,
    posterIncludeCode: false,
    posterWidth: POSTER_WIDTH,
    posterHeight: 420,
    currentSchemeName: '方案 1',
    currentSchemeMeta: '0 场',
    currentSchemeSummary: '当前方案 · 方案 1 · 0 场',
    navTop: 0,
    navHeight: 44,
    navRight: 120,
    navTotalHeight: 88,
    contentTop: 92
  },

  onLoad() {
    this.setNavMetrics()
    this.refreshPosterCodeAvailability()
  },

  onShow() {
    this.setNavMetrics()
    this.renderPlan()
    app.whenFestivalDataReady().then(() => {
      this.renderPlan()
    })
  },

  setNavMetrics() {
    this.setData(getNavMetrics())
  },

  removeScreening(event) {
    const id = event.currentTarget.dataset.id
    app.globalData.smartPlanMeta = null
    app.toggleScreening(id)
    this.renderPlan()
    app.syncScreeningPopularity({
      queryScreeningIds: [id]
    }).then(() => this.renderPlan())
  },

  deletePlanScheme() {
    const activeScheme = this.data.planSchemes.find(scheme => scheme.active)
    if (!activeScheme) {
      return
    }
    wx.showModal({
      title: '删除方案',
      content: '是否删除此方案？',
      confirmText: '删除',
      confirmColor: '#c0392b',
      success: result => {
        if (!result.confirm) {
          return
        }
        app.globalData.smartPlanMeta = null
        const deleted = app.deletePlanScheme(activeScheme.id)
        const removedIds = deleted ? deleted.selectedIds || [] : []
        this.renderPlan()
        app.syncScreeningPopularity({
          queryScreeningIds: removedIds
        }).then(() => this.renderPlan())
        wx.showToast({ title: '已删除', icon: 'none' })
      }
    })
  },

  noop() {},

  openSmartPlan() {
    const smartPlan = this.selectComponent('#smartPlan')
    if (smartPlan) {
      smartPlan.open()
    }
  },

  onSmartPlanned() {
    this.renderPlan()
  },

  copyPlan() {
    if (!this.data.plan || !this.data.plan.selected.length) {
      return
    }
    const activeScheme = this.data.planSchemes.find(scheme => scheme.id === this.data.activePlanSchemeId)
    wx.setClipboardData({
      data: formatPlanText(this.data.plan, {
        festivalName: this.data.festivalName,
        schemeName: activeScheme && activeScheme.name
      }),
      success: () => wx.showToast({ title: '已复制', icon: 'success' })
    })
  },

  exportPlan() {
    if (!this.data.plan || !this.data.plan.selected.length) {
      wx.showToast({ title: '先加入场次', icon: 'none' })
      return
    }

    wx.showActionSheet({
      itemList: ['导出长图', '导出文字版（发给朋友一键导入）'],
      success: result => {
        if (result.tapIndex === 0) {
          this.openPosterSheet()
        }
        if (result.tapIndex === 1) {
          this.copyPlan()
        }
      }
    })
  },

  openPosterSheet() {
    this.setData({ posterSheetOpen: true })
  },

  closePosterSheet() {
    this.setData({ posterSheetOpen: false })
  },

  selectPosterTheme(event) {
    this.setData({ posterTheme: event.currentTarget.dataset.theme || DEFAULT_POSTER_THEME })
  },

  refreshPosterCodeAvailability() {
    getImageInfo(MINIAPP_CODE_PATH).then(exists => {
      this.setData({
        posterCodeAvailable: exists,
        posterIncludeCode: exists ? this.data.posterIncludeCode : false
      })
    })
  },

  togglePosterCode() {
    if (!this.data.posterCodeAvailable) {
      wx.showToast({ title: '先配置小程序码', icon: 'none' })
      return
    }
    this.setData({ posterIncludeCode: !this.data.posterIncludeCode })
  },

  confirmPosterExport() {
    this.exportPlanPoster({
      theme: this.data.posterTheme,
      includeCode: this.data.posterIncludeCode
    })
  },

  openImportSheet() {
    this.setData({
      importSheetOpen: true,
      importText: '',
      importError: ''
    })
  },

  closeImportSheet() {
    this.setData({
      importSheetOpen: false,
      importError: ''
    })
  },

  inputImportText(event) {
    this.setData({
      importText: event.detail.value || '',
      importError: ''
    })
  },

  importPlanText() {
    const text = this.data.importText.trim()
    if (!text) {
      this.setData({ importError: '先粘贴文字版排片' })
      return
    }

    const allScreenings = buildScreenings(app.globalData.films, app.getFilmMarks())
    const importIds = parsePlanImportText(text, allScreenings)
    if (!importIds.length) {
      this.setData({ importError: '没识别到可导入的场次' })
      return
    }

    const scheme = app.createPlanScheme(importIds, `导入 ${app.getPlanSchemes().length + 1}`)
    this.setData({
      importSheetOpen: false,
      importText: '',
      importError: ''
    })
    this.renderPlan()
    app.syncScreeningPopularity({
      queryScreeningIds: importIds
    }).then(() => this.renderPlan())
    wx.showToast({
      title: `${scheme.name} 已导入`,
      icon: 'none'
    })
  },

  selectPlanScheme(event) {
    if (app.setActivePlanScheme(event.currentTarget.dataset.id)) {
      this.renderPlan()
    }
  },

  renamePlanScheme(event) {
    const id = event.currentTarget.dataset.id
    const currentName = event.currentTarget.dataset.name || ''
    wx.showModal({
      title: '方案改名',
      editable: true,
      placeholderText: '输入方案名',
      content: currentName,
      confirmText: '保存',
      success: result => {
        if (!result.confirm) {
          return
        }
        const nextName = String(result.content || '').trim()
        if (!nextName) {
          wx.showToast({ title: '名称不能为空', icon: 'none' })
          return
        }
        if (app.renamePlanScheme(id, nextName)) {
          this.renderPlan()
          wx.showToast({ title: '已改名', icon: 'success' })
        }
      }
    })
  },

  createBlankPlanScheme() {
    const scheme = app.createPlanScheme([], `方案 ${app.getPlanSchemes().length + 1}`)
    this.renderPlan()
    wx.showToast({
      title: `${scheme.name} 已新建`,
      icon: 'none'
    })
  },

  exportPlanPoster(options) {
    if (!this.data.plan || !this.data.plan.selected.length) {
      wx.showToast({ title: '先加入场次', icon: 'none' })
      return
    }

    const posterOptions = Object.assign({
      theme: this.data.posterTheme,
      includeCode: this.data.posterCodeAvailable && this.data.posterIncludeCode
    }, options || {})

    const continueExport = () => {
      const currentPlan = buildCurrentPlan()
      const poster = buildPoster(currentPlan, posterOptions)
      this.setData({
        plan: currentPlan,
        empty: currentPlan.selected.length === 0,
        posterSheetOpen: false,
        posterWidth: poster.width,
        posterHeight: poster.height
      }, () => {
        wx.showLoading({ title: '生成中' })
        setTimeout(() => this.drawPlanPoster(poster), 80)
      })
    }

    if (!posterOptions.includeCode) {
      continueExport()
      return
    }

    getImageInfo(MINIAPP_CODE_PATH).then(exists => {
      if (!exists) {
        wx.showToast({ title: '先配置小程序码', icon: 'none' })
        return
      }
      continueExport()
    })
  },

  drawPlanPoster(poster) {
    this.createSelectorQuery()
      .select('#planPoster')
      .fields({ node: true, size: true })
      .exec(res => {
        const canvas = res && res[0] && res[0].node
        if (!canvas) {
          wx.hideLoading()
          wx.showToast({ title: '导出失败', icon: 'none' })
          return
        }

        this.paintPlanPoster(canvas, poster)
      })
  },

  paintPlanPoster(canvas, poster) {
    const ctx = canvas.getContext('2d')
    const pixelRatio = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).pixelRatio || 1
    const colors = poster.theme
    const layout = colors.layout || 'minimal'

    canvas.width = poster.width * pixelRatio
    canvas.height = poster.height * pixelRatio
    ctx.scale(pixelRatio, pixelRatio)

    ctx.fillStyle = colors.bg
    ctx.fillRect(0, 0, poster.width, poster.height)

    poster.blocks.forEach(block => {
      if (block.type === 'header') {
        drawPosterHeader(ctx, block, poster, colors)
        return
      }

      if (block.type === 'dayStart') {
        if (layout === 'list') {
          setText(ctx, 23, colors.ink, '650')
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
            setNumberText(ctx, 220, colors.ghost || colors.faint, '260')
            ctx.fillText(block.number, 328, block.y + 196)
          }
          return
        }

        if (layout === 'silver') {
          setText(ctx, 22, colors.accent, '560')
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
          setText(ctx, 20, colors.ink, '520')
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
          setText(ctx, 19, colors.bg, '560')
          ctx.fillText(block.label, block.x + 14, block.y + 28)
          ctx.strokeStyle = colors.faint
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(block.x + 128, block.y + 21)
          ctx.lineTo(block.x + block.width, block.y + 21)
          ctx.stroke()
          return
        }
        return
      }

      if (block.type === 'item') {
        if (layout === 'list') {
          setNumberText(ctx, 28, colors.ink, '660')
          ctx.fillText(block.start, block.timeX, block.y + 30)
          setNumberText(ctx, 17, colors.subtle || colors.muted, '400')
          ctx.fillText(block.end, block.timeX + 7, block.y + 62)
          setText(ctx, 28, colors.ink, '570')
          drawTextLines(ctx, block.titleLines, block.mainX, block.y + 30, 34)
          const venueY = block.y + 32 + block.titleLines.length * 34 + 7
          setText(ctx, 20, colors.muted, '340')
          drawTextLines(ctx, block.venueLines, block.mainX, venueY, 26)
        } else if (layout === 'silver') {
          ctx.strokeStyle = block.conflict ? colors.conflict : colors.faint
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(block.x, block.y - 12)
          ctx.lineTo(block.x + block.mainWidth + 142, block.y - 12)
          ctx.stroke()
          setNumberText(ctx, 27, colors.ink, '620')
          ctx.fillText(block.start, block.timeX, block.y + 30)
          setNumberText(ctx, 17, colors.subtle || colors.muted, '380')
          ctx.fillText(block.end, block.timeX + 7, block.y + 64)
          setText(ctx, 29, colors.ink, '540')
          drawTextLines(ctx, block.titleLines, block.mainX, block.y + 30, 36)
          const venueY = block.y + 34 + block.titleLines.length * 36 + 8
          setText(ctx, 21, colors.muted, '330')
          drawTextLines(ctx, block.venueLines, block.mainX, venueY, 28)
        } else if (layout === 'noir') {
          fillRoundRect(ctx, block.x - 18, block.y - 18, block.mainWidth + 176, block.height + 18, 18, colors.panel)
          ctx.strokeStyle = block.conflict ? colors.conflict : colors.faint
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(block.timeX + 92, block.y + 2)
          ctx.lineTo(block.timeX + 92, block.y + block.height - 18)
          ctx.stroke()
          setNumberText(ctx, 26, colors.ink, '620')
          ctx.fillText(block.start, block.timeX, block.y + 30)
          setNumberText(ctx, 17, colors.subtle || colors.muted, '380')
          ctx.fillText(block.end, block.timeX + 7, block.y + 64)
          setText(ctx, 28, colors.ink, '540')
          drawTextLines(ctx, block.titleLines, block.mainX - 18, block.y + 30, 36)
          const venueY = block.y + 34 + block.titleLines.length * 36 + 8
          setText(ctx, 20, colors.muted, '330')
          drawTextLines(ctx, block.venueLines, block.mainX - 18, venueY, 27)
        } else if (layout === 'gallery') {
          fillRoundRect(ctx, block.x + 98, block.y - 18, block.mainWidth + 24, block.height + 12, 16, colors.panel)
          setNumberText(ctx, 26, colors.ink, '640')
          ctx.fillText(block.start, block.timeX, block.y + 30)
          setNumberText(ctx, 17, colors.subtle || colors.muted, '380')
          ctx.fillText(block.end, block.timeX + 7, block.y + 64)
          setText(ctx, 28, colors.ink, '560')
          drawTextLines(ctx, block.titleLines, block.mainX, block.y + 30, 36)
          const venueY = block.y + 34 + block.titleLines.length * 36 + 8
          setText(ctx, 20, colors.muted, '330')
          drawTextLines(ctx, block.venueLines, block.mainX, venueY, 27)
        } else {
          setNumberText(ctx, 27, colors.ink, '650')
          ctx.fillText(block.start, block.timeX, block.y + 30)
          setNumberText(ctx, 17, colors.subtle || colors.muted, '380')
          ctx.fillText(block.end, block.timeX + 7, block.y + 64)
          setText(ctx, 29, colors.ink, '560')
          drawTextLines(ctx, block.titleLines, block.mainX, block.y + 30, 36)
          const venueY = block.y + 34 + block.titleLines.length * 36 + 8
          setText(ctx, 21, colors.muted, '320')
          drawTextLines(ctx, block.venueLines, block.mainX, venueY, 28)
        }

        if (block.conflict) {
          setText(ctx, 17, colors.conflict, '480')
          ctx.fillText('时间冲突', block.mainX, block.y + block.height - 6)
        }
        return
      }

      if (block.type === 'footer') {
        const codeSize = block.codePath ? 62 : 0
        const textRight = block.x + block.width - (codeSize ? codeSize + 14 : 0)

        ctx.save()
        ctx.textAlign = 'right'
        setText(ctx, 16, colors.subtle || colors.muted, '360')
        ctx.fillText(`用「${APP_SHARE_NAME}」整理和导出排片`, textRight, block.y + 32)
        ctx.restore()

        if (block.codePath) {
          fillRoundRect(ctx, block.x + block.width - codeSize, block.y, codeSize, codeSize, 0, '#ffffff')
        }
      }
    })

    const footerBlock = poster.blocks.find(block => block.type === 'footer')
    const codePromise = footerBlock && footerBlock.codePath
      ? drawPosterImage(canvas, ctx, footerBlock.codePath, footerBlock.x + footerBlock.width - 62, footerBlock.y, 62, 62)
      : Promise.resolve(false)

    const scale = poster.height > 2600 ? 1 : 2
    Promise.all([codePromise]).then(() => {
      wx.canvasToTempFilePath({
        canvas,
        width: poster.width,
        height: poster.height,
        destWidth: poster.width * scale,
        destHeight: poster.height * scale,
        success: res => {
          wx.hideLoading()
          wx.previewImage({
            urls: [res.tempFilePath],
            current: res.tempFilePath
          })
        },
        fail: () => {
          wx.hideLoading()
          wx.showToast({ title: '导出失败', icon: 'none' })
        }
      }, this)
    })
  },

  renderPlan() {
    const renderToken = (this._renderToken || 0) + 1
    this._renderToken = renderToken
    const allScreenings = buildScreenings(app.globalData.films, app.getFilmMarks())
    const rawPlan = buildPlan(app.getSelectedScreeningIds(), allScreenings)
    const screeningIds = rawPlan.selected.map(screening => screening.id)
    const plan = attachPopularity(rawPlan, app.getScreeningPopularityMap(screeningIds))
    const activePlanSchemeId = app.getActivePlanSchemeId()
    const planSchemes = app.getPlanSchemes().map((scheme, index) => {
      const schemePlan = buildPlan(scheme.selectedIds || [], allScreenings)
      const hasItems = schemePlan.selected.length > 0
      const noteParts = []
      if (hasItems) {
        noteParts.push(schemePlan.conflictPairs.length ? `${schemePlan.conflictPairs.length} 冲突` : '无冲突')
        if (schemePlan.totalPrice) {
          noteParts.push(`¥${schemePlan.totalPrice}`)
        }
      }
      return {
        id: scheme.id,
        name: scheme.name || `方案 ${index + 1}`,
        count: schemePlan.selected.length,
        conflicts: schemePlan.conflictPairs.length,
        meta: hasItems
          ? `${schemePlan.selected.length} 场 · ${formatMinutes(schemePlan.totalMinutes)}`
          : '0 场',
        note: hasItems ? noteParts.join(' · ') : '空方案',
        noteTone: schemePlan.conflictPairs.length ? 'is-conflict' : '',
        active: scheme.id === activePlanSchemeId
      }
    })
    this.setData({
      festivalName: app.globalData.festivalMeta.name,
      plan,
      totalHourValue: formatHourValue(plan.totalMinutes),
      priceLabel: plan.totalPrice ? `¥${plan.totalPrice}` : '-',
      smartPlanMeta: app.globalData.smartPlanMeta,
      planSchemes,
      activePlanSchemeId,
      currentSchemeName: (planSchemes.find(scheme => scheme.active) || planSchemes[0] || {}).name || '方案',
      currentSchemeMeta: plan.selected.length ? formatExportSummary(plan) : '0 场',
      currentSchemeSummary: plan.selected.length ? formatExportSummary(plan) : '0 场',
      exportSummary: formatExportSummary(plan),
      empty: plan.selected.length === 0
    }, () => {
      this.refreshPopularity(screeningIds, renderToken)
    })
  },

  refreshPopularity(screeningIds, renderToken) {
    app.fetchScreeningPopularity(screeningIds).then(counts => {
      if (this._renderToken !== renderToken) {
        return
      }
      const updates = {}
      ;((this.data.plan && this.data.plan.days) || []).forEach((day, dayIndex) => {
        ;(day.items || []).forEach((screening, screeningIndex) => {
          const count = counts[screening.id] || 0
          if (screening.popularityCount !== count) {
            updates[`plan.days[${dayIndex}].items[${screeningIndex}].popularityCount`] = count
            updates[`plan.days[${dayIndex}].items[${screeningIndex}].popularityText`] = popularityText(count)
          }
        })
      })
      if (Object.keys(updates).length) {
        this.setData(updates)
      }
    })
  }
})
