// 票务图（求票 / 出票 / 换票）canvas 绘制模块。
// 完全独立，不依赖 page.jsx 里的排片长图逻辑（paintPlanPoster 等）。
//
// 用法：
//   const image = await createTicketPosterImage(spec, options)
//   image => { url, filename, width, height } | null
//
// spec 结构：
//   {
//     type: 'seek' | 'offer' | 'swap',
//     // seek/offer：单组场次
//     screenings: [{ cnTitle, dayLabel, date, start, end, cinema, hall, posterSrc, price?, seat? }],
//     // swap：两组
//     give: [...same shape...],
//     want: [...same shape...],
//     contact: { mode: 'text' | 'qr', value: '微信号或说明', qrSrc?: 'dataURL/同源图片' }
//   }

const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", sans-serif'
// 列表为左对齐紧凑内容，画布不必占满 750；收窄让右侧不留大片空白。
// 单场满幅海报版仍用较宽画布以保留海报气质。
const WIDTH = 620
const PAD = 40

const TYPE_META = {
  seek: { label: '求 票', accent: '#5ab38a', priceTint: '#9fd6bd' },
  offer: { label: '出 票', accent: '#d49a5e', priceTint: '#e6bd8c' },
  swap: { label: '换 票', accent: '#6f9bc4', priceTint: '#9fbcd8' }
}
const TICKET_THEMES = {
  classic: {
    bg: '#17191c',
    ink: '#f4f2ec',
    muted: '#a8aaa6',
    subtle: '#71756f',
    line: '#34383d',
    contactBg: '#2d2f34',
    contactInk: '#f4f2ec',
    contactCutout: '#2d2f34',
    imageStroke: 'rgba(255,255,255,0.11)'
  },
  paper: {
    bg: '#f2f3f1',
    ink: '#151816',
    muted: '#666d69',
    subtle: '#9ca29e',
    line: '#daddd8',
    contactBg: '#ffffff',
    contactInk: '#151816',
    contactCutout: '#ffffff',
    imageStroke: 'rgba(22,23,22,0.1)',
    typeMeta: {
      seek: { priceTint: '#4c9270' },
      offer: { priceTint: '#9c6c35' },
      swap: { priceTint: '#536f8c' }
    }
  },
  silver: {
    bg: '#f7f9fa',
    ink: '#182026',
    muted: '#6d7780',
    subtle: '#a2aab0',
    line: '#dfe6ea',
    contactBg: '#ffffff',
    contactInk: '#182026',
    contactCutout: '#ffffff',
    imageStroke: 'rgba(24,32,38,0.1)',
    typeMeta: {
      seek: { priceTint: '#4a8f73' },
      offer: { priceTint: '#9b6b33' },
      swap: { priceTint: '#476e94' }
    }
  },
  noir: {
    bg: '#111b2a',
    ink: '#f6f8fb',
    muted: '#aeb9c4',
    subtle: '#778390',
    line: '#263344',
    contactBg: '#1d2a3a',
    contactInk: '#f6f8fb',
    contactCutout: '#1d2a3a',
    imageStroke: 'rgba(210,226,242,0.12)',
    typeMeta: {
      seek: { priceTint: '#92d5b7' },
      offer: { priceTint: '#e0b37f' },
      swap: { priceTint: '#a7c3dd' }
    }
  }
}

const WEIGHT_MAP = { '260': 300, '320': 300, '360': 400, '400': 400, '420': 400, '500': 500, '520': 500, '540': 500, '560': 600, '580': 600, '600': 600, '620': 600, '640': 700, '650': 700, '660': 700, '680': 700, '700': 700, '720': 800 }

function fontWeight(weight) {
  return WEIGHT_MAP[String(weight)] || 400
}

function setText(ctx, size, color, weight) {
  ctx.fillStyle = color
  ctx.font = `${fontWeight(weight)} ${size}px ${FONT_FAMILY}`
}

function ticketTheme(spec) {
  return TICKET_THEMES[String(spec && spec.theme || '').trim()] || TICKET_THEMES.classic
}

function typeTone(colors, type, key) {
  return (colors.typeMeta && colors.typeMeta[type] && colors.typeMeta[type][key]) || TYPE_META[type][key]
}

// 在当前字体下把文字裁到 maxWidth，超出加省略号。需先 setText 设好字体。
function truncate(ctx, text, maxWidth) {
  const value = String(text || '')
  if (!value || ctx.measureText(value).width <= maxWidth) return value
  let lo = 0
  let hi = value.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (ctx.measureText(value.slice(0, mid) + '…').width <= maxWidth) lo = mid
    else hi = mid - 1
  }
  return lo > 0 ? value.slice(0, lo) + '…' : '…'
}

// setText + 裁切 + 绘制，一步到位
function fillTruncated(ctx, text, x, y, maxWidth) {
  ctx.fillText(truncate(ctx, text, maxWidth), x, y)
}

function wrapLines(ctx, text, maxWidth, maxLines = 2) {
  const value = String(text || '').trim()
  if (!value) return []
  const chars = Array.from(value)
  const lines = []
  let line = ''
  chars.forEach(char => {
    const next = line + char
    if (!line || ctx.measureText(next).width <= maxWidth) {
      line = next
      return
    }
    lines.push(line)
    line = char
  })
  if (line) lines.push(line)
  if (lines.length <= maxLines) return lines
  const kept = lines.slice(0, maxLines)
  kept[maxLines - 1] = truncate(ctx, kept[maxLines - 1] + lines.slice(maxLines).join(''), maxWidth)
  return kept
}

function fillWrapped(ctx, text, x, y, maxWidth, lineHeight, maxLines = 2) {
  const lines = wrapLines(ctx, text, maxWidth, maxLines)
  lines.forEach((line, index) => ctx.fillText(line, x, y + index * lineHeight))
  return lines.length
}

function roundRectPath(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

function fillRoundRect(ctx, x, y, w, h, r, color) {
  ctx.fillStyle = color
  roundRectPath(ctx, x, y, w, h, r)
  ctx.fill()
}

function compact(parts) {
  return parts.filter(part => part != null && String(part).trim() !== '').join(' · ')
}

function formatPriceText(value) {
  const text = value != null && String(value).trim() !== '' ? String(value).trim() : ''
  if (!text) return ''
  if (/^[¥￥]/.test(text)) return text.replace(/^￥/, '¥')
  return `¥${text}`
}

function formatSeatText(value) {
  const text = value != null && String(value).trim() !== '' ? String(value).trim() : ''
  if (!text) return ''
  return /^座位[:：]/.test(text) ? text : `座位：${text}`
}

function venueText(item) {
  return compact([item.cinema, item.hall])
}

function venueRowLines(item) {
  const cinema = item && item.cinema != null ? String(item.cinema).trim() : ''
  const hall = item && item.hall != null ? String(item.hall).trim() : ''
  if (cinema && hall) return [cinema, hall]
  return [venueText(item)].filter(Boolean)
}

// 把场次的可选字段（票价/座位）拼成一行
function extraText(item) {
  const price = formatPriceText(item.price)
  const seat = formatSeatText(item.seat)
  return compact([price, seat])
}

function dateTimeText(item) {
  const day = String(item.dayLabel || item.date || '').trim()
  const time = item.start && item.end ? `${item.start}–${item.end}` : (item.start || '')
  return compact([day, time])
}

function isSafeImageSrc(src) {
  const value = String(src || '').trim()
  if (!value) return false
  if (value.startsWith('data:image/')) return true
  if (value.startsWith('/posters/')) return true
  if (value.startsWith('/community/')) return true
  if (typeof window === 'undefined') return false
  try {
    const url = new URL(value, window.location.href)
    return url.origin === window.location.origin
  } catch (error) {
    return false
  }
}

function loadImage(src) {
  if (typeof window === 'undefined' || !isSafeImageSrc(src)) return Promise.resolve(null)
  return new Promise(resolve => {
    const image = new window.Image()
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    image.src = src
  })
}

function normalizeSrc(src) {
  return String(src || '').replace(/^\/assets\/posters\//, '/posters/')
}

// 收集 spec 里所有需要加载的图片（海报 + 二维码），并行预加载
async function hydrateImages(spec) {
  const groups = spec.type === 'swap' ? [...(spec.give || []), ...(spec.want || [])] : (spec.screenings || [])
  const cache = {}
  await Promise.all(groups.map(async item => {
    const src = normalizeSrc(item.posterSrc)
    if (src && !(src in cache)) cache[src] = await loadImage(src)
  }))
  let qr = null
  if (spec.contact && spec.contact.mode === 'qr' && spec.contact.qrSrc) {
    qr = await loadImage(spec.contact.qrSrc)
  }
  return { posters: cache, qr }
}

// 画一张封面图（cover 裁切），失败时画占位渐变
function drawCover(ctx, image, x, y, w, h) {
  if (image && (image.naturalWidth || image.width)) {
    const sw = image.naturalWidth || image.width
    const sh = image.naturalHeight || image.height
    const scale = Math.max(w / sw, h / sh)
    const cw = w / scale
    const ch = h / scale
    const sx = Math.max(0, (sw - cw) / 2)
    const sy = Math.max(0, (sh - ch) / 2)
    ctx.drawImage(image, sx, sy, cw, ch, x, y, w, h)
  } else {
    const grad = ctx.createLinearGradient(x, y, x, y + h)
    grad.addColorStop(0, '#4a4038')
    grad.addColorStop(1, '#221c18')
    ctx.fillStyle = grad
    ctx.fillRect(x, y, w, h)
  }
}

function containRect(image, x, y, w, h) {
  if (image && (image.naturalWidth || image.width)) {
    const sw = image.naturalWidth || image.width
    const sh = image.naturalHeight || image.height
    const scale = Math.min(w / sw, h / sh)
    const dw = sw * scale
    const dh = sh * scale
    return { x: x + (w - dw) / 2, y: y + (h - dh) / 2, w: dw, h: dh }
  }
  return { x, y, w, h }
}

// 画一张完整图片（contain 不裁切），用于单张票务图里的主海报。
function drawContain(ctx, image, x, y, w, h) {
  const rect = containRect(image, x, y, w, h)
  if (image && (image.naturalWidth || image.width)) {
    ctx.save()
    roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, 14)
    ctx.clip()
    ctx.drawImage(image, rect.x, rect.y, rect.w, rect.h)
    ctx.restore()
  } else {
    const grad = ctx.createLinearGradient(x, y, x, y + h)
    grad.addColorStop(0, '#e4e8e1')
    grad.addColorStop(1, '#c9d0c7')
    fillRoundRect(ctx, x, y, w, h, 14, grad)
  }
  return rect
}

// ---- 布局测量：返回总高度，绘制时复用 ----
const HERO_BASE = 790     // 单场票务图基础高度；长标题/二维码时再自动加高
const ROW_H = 132         // 列表行高（标题+时间+影院 三行）
const THUMB_W = 92
const THUMB_H = 130
const GROUP_GAP = 14
const FOOTER_H = 96

function rowHeight(item) {
  return Math.max(ROW_H, rowContentHeight(item) + 18)
}

function rowContentHeight(item) {
  const extraLine = extraText(item) ? 30 : 0
  const venueExtra = Math.max(0, venueRowLines(item).length - 1) * 30
  return 104 + extraLine + venueExtra
}

function estimateLineCount(text, charsPerLine) {
  const length = Array.from(String(text || '').trim()).length
  if (!length) return 1
  return Math.min(2, Math.ceil(length / charsPerLine))
}

function singleHeroHeight(item, spec) {
  const titleLines = estimateLineCount(item && item.cnTitle, 11)
  const venueLines = estimateLineCount(venueText(item), 20)
  const contact = spec && spec.contact ? spec.contact : {}
  const contactExtra = contact.mode === 'qr' && contact.qrSrc ? 110 : (String(contact.value || '').trim() ? 34 : 0)
  return HERO_BASE + (titleLines - 1) * 52 + (venueLines - 1) * 38 + contactExtra
}

function badgeMetrics(ctx, type) {
  const meta = TYPE_META[type]
  const fontSize = 36
  setText(ctx, fontSize, '#fff', '700')
  const tw = ctx.measureText(meta.label).width
  const padX = 34
  return { meta, fontSize, padX, w: tw + padX * 2, h: 70 }
}

function drawBadgeAt(ctx, type, x, y, colors) {
  const { meta, fontSize, padX, w, h } = badgeMetrics(ctx, type)
  fillRoundRect(ctx, x, y, w, h, h / 2, typeTone(colors, type, 'accent'))
  setText(ctx, fontSize, '#fff', '700')
  ctx.fillText(meta.label, x + padX, y + 49)
  return h
}

// 画类型徽标（按右边缘对齐，列表外其他场景保留备用）
function drawBadge(ctx, type, rightX, y, colors) {
  const { w } = badgeMetrics(ctx, type)
  return drawBadgeAt(ctx, type, rightX - w, y, colors)
}

// 画一行列表场次（带缩略海报）。返回行高。
function drawListRow(ctx, item, x, y, width, images, type, colors, rowH, rowPosterH) {
  const naturalH = rowHeight(item)
  const h = rowH || naturalH
  const contentH = rowContentHeight(item)
  const posterImg = images.posters[normalizeSrc(item.posterSrc)] || null
  const posterH = Math.min(h, rowPosterH || Math.max(THUMB_H, contentH))
  const posterW = Math.round(posterH * THUMB_W / THUMB_H)
  const contentTop = y + Math.max(0, Math.round((h - contentH) / 2))
  const posterY = y + Math.max(0, Math.round((h - posterH) / 2))
  // 缩略海报
  ctx.save()
  roundRectPath(ctx, x, posterY, posterW, posterH, 8)
  ctx.clip()
  drawCover(ctx, posterImg, x, posterY, posterW, posterH)
  ctx.restore()
  ctx.strokeStyle = colors.imageStroke || colors.line
  ctx.lineWidth = 1
  roundRectPath(ctx, x, posterY, posterW, posterH, 8)
  ctx.stroke()

  const textX = x + posterW + 22
  const textW = x + width - textX
  let cursor = contentTop + 4
  setText(ctx, 33, colors.ink, '680')
  cursor += 30
  fillTruncated(ctx, item.cnTitle || '', textX, cursor, textW)
  setText(ctx, 24, colors.muted, '440')
  cursor += 34
  // 日期时间一行；影院和影厅分行，避免长影院名把厅名裁成省略号。
  fillTruncated(ctx, dateTimeText(item), textX, cursor, textW)
  venueRowLines(item).forEach(line => {
    cursor += 30
    fillTruncated(ctx, line, textX, cursor, textW)
  })
  const extra = extraText(item)
  if (extra) {
    setText(ctx, 23, typeTone(colors, type, 'priceTint'), '560')
    cursor += 30
    fillTruncated(ctx, extra, textX, cursor, textW)
  }
  return h
}

// 画一组的分组标题（换票用）
function drawGroupLabel(ctx, text, color, x, y) {
  setText(ctx, 22, color, '700')
  ctx.fillText(text, x, y + 22)
  return 34
}

function drawWechatIcon(ctx, x, y, size, color, cutoutColor) {
  const backW = size * 0.72
  const backH = size * 0.52
  const frontW = size * 0.78
  const frontH = size * 0.58

  ctx.save()
  ctx.fillStyle = color
  ctx.globalAlpha = 0.72
  roundRectPath(ctx, x + size * 0.19, y, backW, backH, backH / 2)
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(x + size * 0.62, y + backH - 1)
  ctx.lineTo(x + size * 0.74, y + backH + size * 0.12)
  ctx.lineTo(x + size * 0.55, y + backH + 1)
  ctx.closePath()
  ctx.fill()

  ctx.globalAlpha = 1
  roundRectPath(ctx, x, y + size * 0.22, frontW, frontH, frontH / 2)
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(x + size * 0.2, y + size * 0.22 + frontH - 1)
  ctx.lineTo(x + size * 0.08, y + size * 0.92)
  ctx.lineTo(x + size * 0.35, y + size * 0.22 + frontH - 1)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = cutoutColor
  ctx.beginPath()
  ctx.arc(x + size * 0.26, y + size * 0.49, size * 0.045, 0, Math.PI * 2)
  ctx.arc(x + size * 0.52, y + size * 0.49, size * 0.045, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function drawTextContact(ctx, value, x, top, height, fontSize, padX, colors) {
  const text = String(value || '').trim()
  const iconSize = Math.round(height * 0.5)
  const gap = text ? 9 : 0
  setText(ctx, fontSize, colors.contactInk, '600')
  const textW = text ? ctx.measureText(text).width : 0
  const width = padX * 2 + iconSize + gap + textW
  fillRoundRect(ctx, x, top, width, height, height / 2, colors.contactBg)
  drawWechatIcon(ctx, x + padX, top + Math.round((height - iconSize) / 2), iconSize, colors.contactInk, colors.contactCutout || colors.contactBg)
  if (text) {
    setText(ctx, fontSize, colors.contactInk, '600')
    ctx.fillText(text, x + padX + iconSize + gap, top + Math.round(height * 0.66))
  }
  return width
}

// 画底部联系区，返回高度
function drawFooter(ctx, spec, images, x, y, width, colors) {
  const contact = spec.contact || {}
  const value = String(contact.value || '').trim()
  // 分隔线
  ctx.strokeStyle = colors.line
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x + width, y)
  ctx.stroke()

  const top = y + 30
  if (contact.mode === 'qr' && images.qr) {
    const qrSize = 96
    ctx.save()
    fillRoundRect(ctx, x, top, qrSize, qrSize, 10, '#ffffff')
    roundRectPath(ctx, x + 6, top + 6, qrSize - 12, qrSize - 12, 6)
    ctx.clip()
    drawCover(ctx, images.qr, x + 6, top + 6, qrSize - 12, qrSize - 12)
    ctx.restore()
    if (value) {
      setText(ctx, 24, colors.muted, '560')
      fillTruncated(ctx, value, x + qrSize + 20, top + 56, width - qrSize - 20)
    }
  } else if (value) {
    // 文字胶囊
    drawTextContact(ctx, value, x, top, 48, 26, 18, colors)
  }
  // 底部小字
  setText(ctx, 19, colors.subtle, '400')
  const footerText = '用「赶场愉快」导出'
  ctx.fillText(footerText, x + width - ctx.measureText(footerText).width, y + 30 + (contact.mode === 'qr' && images.qr ? 96 : 48) + 30)
  return FOOTER_H + (contact.mode === 'qr' && images.qr ? 60 : 14)
}

// ===== 布局规划：算出每个区块的位置与画布总高 =====
function planLayout(spec) {
  const colors = ticketTheme(spec)
  const contentX = PAD
  const contentW = WIDTH - PAD * 2
  const blocks = []
  let y = 0

  const single = spec.type !== 'swap' && (spec.screenings || []).length === 1

  if (single) {
    // 单场满幅海报版
    const heroH = singleHeroHeight(spec.screenings[0], spec)
    blocks.push({ kind: 'hero', item: spec.screenings[0], x: 0, y: 0, w: WIDTH, h: heroH })
    y = heroH
    return { blocks, height: y, single: true, contentX, contentW }
  }

  // 列表版头部
  const headTop = PAD
  blocks.push({ kind: 'head', x: contentX, y: headTop, w: contentW })
  y = headTop + 76

  if (spec.type === 'swap') {
    const swapPosterH = Math.max(THUMB_H, ...(spec.give || []).map(rowContentHeight), ...(spec.want || []).map(rowContentHeight))
    const swapRowH = Math.max(ROW_H, swapPosterH + 18)
    // 我出
    blocks.push({ kind: 'groupLabel', text: '我出', color: typeTone(colors, 'offer', 'priceTint'), x: contentX, y })
    y += 40
    ;(spec.give || []).forEach(item => {
      const h = swapRowH
      blocks.push({ kind: 'row', item, type: 'offer', x: contentX, y, w: contentW, h, posterH: swapPosterH })
      y += h + GROUP_GAP
    })
    // 对调分隔
    blocks.push({ kind: 'swapDivider', x: contentX, y, w: contentW })
    y += 56
    // 我求
    blocks.push({ kind: 'groupLabel', text: '我求', color: typeTone(colors, 'seek', 'priceTint'), x: contentX, y })
    y += 40
    ;(spec.want || []).forEach(item => {
      const h = swapRowH
      blocks.push({ kind: 'row', item, type: 'seek', x: contentX, y, w: contentW, h, posterH: swapPosterH })
      y += h + GROUP_GAP
    })
  } else {
    const listPosterH = Math.max(THUMB_H, ...(spec.screenings || []).map(rowContentHeight))
    const listRowH = Math.max(ROW_H, listPosterH + 18)
    ;(spec.screenings || []).forEach(item => {
      const h = listRowH
      blocks.push({ kind: 'row', item, type: spec.type, x: contentX, y, w: contentW, h, posterH: listPosterH })
      y += h + GROUP_GAP
    })
  }

  y += 10
  blocks.push({ kind: 'footer', x: contentX, y, w: contentW })
  y += FOOTER_H + (spec.contact && spec.contact.mode === 'qr' && spec.contact.qrSrc ? 60 : 0)
  y += PAD

  return { blocks, height: y, single: false, contentX, contentW }
}

// ===== 主绘制 =====
function paint(ctx, spec, layout, images) {
  const colors = ticketTheme(spec)
  const heroColors = { ...TICKET_THEMES.classic, typeMeta: colors.typeMeta }
  // 背景
  ctx.fillStyle = colors.bg
  ctx.fillRect(0, 0, WIDTH, layout.height)

  layout.blocks.forEach(block => {
    if (block.kind === 'hero') {
      const item = block.item
      const posterImg = images.posters[normalizeSrc(item.posterSrc)] || null
      ctx.save()
      ctx.filter = 'blur(18px)'
      drawCover(ctx, posterImg, -36, -36, WIDTH + 72, block.h + 72)
      ctx.restore()

      const shade = ctx.createLinearGradient(0, 0, 0, block.h)
      shade.addColorStop(0, 'rgba(7,6,5,0.72)')
      shade.addColorStop(0.58, 'rgba(7,6,5,0.88)')
      shade.addColorStop(1, 'rgba(7,6,5,0.97)')
      ctx.fillStyle = shade
      ctx.fillRect(0, 0, WIDTH, block.h)

      const posterW = 238
      const posterH = 337
      const posterX = Math.round((WIDTH - posterW) / 2)
      const posterY = 108
      const posterRect = drawContain(ctx, posterImg, posterX, posterY, posterW, posterH)
      ctx.strokeStyle = 'rgba(255,255,255,0.16)'
      ctx.lineWidth = 1
      roundRectPath(ctx, posterRect.x, posterRect.y, posterRect.w, posterRect.h, 14)
      ctx.stroke()

      // 徽标左上
      drawBadgeAt(ctx, spec.type, PAD - 22, PAD - 14, colors)
      // 底部信息
      const heroW = WIDTH - PAD * 2
      let cy = posterY + posterH + 72
      setText(ctx, 46, '#fff', '720')
      const titleLines = fillWrapped(ctx, item.cnTitle || '', PAD, cy, heroW, 52, 2)
      cy += titleLines * 52 + 6
      setText(ctx, 27, 'rgba(255,255,255,0.9)', '560')
      ctx.fillText(dateTimeText(item), PAD, cy)
      setText(ctx, 27, 'rgba(255,255,255,0.86)', '440')
      cy += 42
      const venueLines = fillWrapped(ctx, venueText(item), PAD, cy, heroW, 38, 2)
      cy += venueLines * 38 - 38
      const extra = extraText(item)
      if (extra) {
        setText(ctx, 25, typeTone(colors, spec.type, 'priceTint'), '560')
        cy += 42
        fillTruncated(ctx, extra, PAD, cy, heroW)
      }
      // 联系 + 小字（压在海报底部）
      drawFooterInline(ctx, spec, images, PAD, block.h - PAD - 6, heroColors, WIDTH - PAD)
      return
    }
    if (block.kind === 'head') {
      // 顶部只留类型徽标；场次数靠下方列表一目了然，不再重复写标题
      drawBadgeAt(ctx, spec.type, block.x - 22, block.y - 14, colors)
      return
    }
    if (block.kind === 'groupLabel') {
      drawGroupLabel(ctx, block.text, block.color, block.x, block.y)
      return
    }
    if (block.kind === 'swapDivider') {
      ctx.strokeStyle = colors.line
      ctx.lineWidth = 1
      const midY = block.y + 26
      ctx.beginPath()
      ctx.moveTo(block.x, midY)
      ctx.lineTo(block.x + block.w / 2 - 26, midY)
      ctx.moveTo(block.x + block.w / 2 + 26, midY)
      ctx.lineTo(block.x + block.w, midY)
      ctx.stroke()
      setText(ctx, 30, colors.muted, '400')
      ctx.textAlign = 'center'
      ctx.fillText('⇅', block.x + block.w / 2, midY + 11)
      ctx.textAlign = 'left'
      return
    }
    if (block.kind === 'row') {
      drawListRow(ctx, block.item, block.x, block.y, block.w, images, block.type, colors, block.h, block.posterH)
      return
    }
    if (block.kind === 'footer') {
      drawFooter(ctx, spec, images, block.x, block.y, block.w, colors)
      return
    }
  })
}

// 满幅海报版底部的联系条 + 小字（与列表版 footer 略不同，无分隔线）
function drawFooterInline(ctx, spec, images, x, bottomY, colors, rightX = WIDTH - PAD) {
  const contact = spec.contact || {}
  const value = String(contact.value || '').trim()
  let lineY = bottomY
  setText(ctx, 19, colors.subtle, '400')
  const footerText = '用「赶场愉快」导出'
  ctx.fillText(footerText, rightX - ctx.measureText(footerText).width, lineY)
  lineY -= 26
  if (contact.mode === 'qr' && images.qr) {
    const qrSize = 84
    const top = lineY - qrSize
    fillRoundRect(ctx, x, top, qrSize, qrSize, 9, '#fff')
    ctx.save()
    roundRectPath(ctx, x + 5, top + 5, qrSize - 10, qrSize - 10, 5)
    ctx.clip()
    drawCover(ctx, images.qr, x + 5, top + 5, qrSize - 10, qrSize - 10)
    ctx.restore()
    if (value) {
      setText(ctx, 23, colors.muted, '560')
      ctx.fillText(value, x + qrSize + 16, top + qrSize / 2 + 8)
    }
  } else if (value) {
    const h = 44
    drawTextContact(ctx, value, x, lineY - h, h, 25, 17, colors)
  }
}

export async function createTicketPosterImage(spec, options = {}) {
  if (typeof document === 'undefined') return null
  if (!spec || !TYPE_META[spec.type]) return null

  const images = await hydrateImages(spec)
  const layout = planLayout(spec)

  const canvas = document.createElement('canvas')
  const pixelRatio = Math.max(1, Math.min(window.devicePixelRatio || 1, layout.height > 2600 ? 1.5 : 2))
  canvas.width = WIDTH * pixelRatio
  canvas.height = layout.height * pixelRatio
  canvas.style.width = `${WIDTH}px`
  canvas.style.height = `${layout.height}px`
  const ctx = canvas.getContext('2d')
  ctx.scale(pixelRatio, pixelRatio)
  ctx.textBaseline = 'alphabetic'

  paint(ctx, spec, layout, images)

  try {
    return {
      url: canvas.toDataURL('image/png'),
      filename: `${options.festivalName || 'festival'}-ticket-${spec.type}.png`,
      width: WIDTH,
      height: layout.height
    }
  } catch (error) {
    return null
  }
}
