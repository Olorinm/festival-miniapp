const FONT_FAMILY = '"PingFang SC", "Hiragino Sans GB", sans-serif'
const WIDTH = 620
const PAD = 40

const TYPE_META = {
  seek: { label: '求 票', accent: '#5ab38a', priceTint: '#9fd6bd' },
  offer: { label: '出 票', accent: '#d49a5e', priceTint: '#e6bd8c' },
  swap: { label: '换 票', accent: '#6f9bc4', priceTint: '#9fbcd8' }
}

const TICKET_THEMES = {
  classic: {
    key: 'classic',
    label: '经典',
    swatch: '#17191c',
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
    key: 'paper',
    label: '纸感',
    swatch: '#f2f3f1',
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
    key: 'silver',
    label: '冷白',
    swatch: '#f7f9fa',
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
    key: 'noir',
    label: '夜场',
    swatch: '#111b2a',
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

const TICKET_THEME_OPTIONS = Object.keys(TICKET_THEMES).map(key => TICKET_THEMES[key])

const WEIGHT_MAP = {
  260: 'normal',
  320: 'normal',
  360: 'normal',
  400: 'normal',
  420: 'normal',
  500: 'normal',
  520: 'normal',
  540: 'normal',
  560: 'bold',
  580: 'bold',
  600: 'bold',
  620: 'bold',
  640: 'bold',
  650: 'bold',
  660: 'bold',
  680: 'bold',
  700: 'bold',
  720: 'bold'
}

const HERO_BASE = 790
const ROW_H = 132
const THUMB_W = 92
const THUMB_H = 130
const THUMB_MAX_H = 144
const GROUP_GAP = 14
const FOOTER_H = 96

function ticketTheme(spec) {
  return TICKET_THEMES[String(spec && spec.theme || '').trim()] || TICKET_THEMES.classic
}

function typeTone(colors, type, key) {
  return (colors.typeMeta && colors.typeMeta[type] && colors.typeMeta[type][key]) || TYPE_META[type][key]
}

function setText(ctx, size, color, weight) {
  ctx.fillStyle = color
  ctx.font = `${WEIGHT_MAP[String(weight)] || 'normal'} ${size}px ${FONT_FAMILY}`
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

function extraText(item) {
  return compact([formatPriceText(item.price), formatSeatText(item.seat)])
}

function dateTimeText(item) {
  const day = String(item.dayLabel || item.date || '').trim()
  const time = item.start && item.end ? `${item.start}-${item.end}` : (item.start || '')
  return compact([day, time])
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

function truncate(ctx, text, maxWidth) {
  const value = String(text || '')
  if (!value || ctx.measureText(value).width <= maxWidth) return value
  let lo = 0
  let hi = value.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (ctx.measureText(value.slice(0, mid) + '...').width <= maxWidth) lo = mid
    else hi = mid - 1
  }
  return lo > 0 ? value.slice(0, lo) + '...' : '...'
}

function fillTruncated(ctx, text, x, y, maxWidth) {
  ctx.fillText(truncate(ctx, text, maxWidth), x, y)
}

function wrapLines(ctx, text, maxWidth, maxLines) {
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
  if (!maxLines || lines.length <= maxLines) return lines
  const kept = lines.slice(0, maxLines)
  kept[maxLines - 1] = truncate(ctx, kept[maxLines - 1] + lines.slice(maxLines).join(''), maxWidth)
  return kept
}

function fillWrapped(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const lines = wrapLines(ctx, text, maxWidth, maxLines)
  lines.forEach((line, index) => ctx.fillText(line, x, y + index * lineHeight))
  return lines.length
}

function rowContentHeight(item) {
  const extraLine = extraText(item) ? 30 : 0
  const venueExtra = Math.max(0, venueRowLines(item).length - 1) * 30
  return 104 + extraLine + venueExtra
}

function rowHeight(item) {
  return Math.max(ROW_H, rowContentHeight(item) + 18)
}

function sharedPosterHeight(items) {
  const contentHeights = (items || []).map(rowContentHeight)
  const target = Math.max(THUMB_H, ...contentHeights)
  return Math.min(THUMB_MAX_H, target)
}

function maxRowContentHeight(items) {
  return Math.max(0, ...(items || []).map(rowContentHeight))
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
  const metrics = badgeMetrics(ctx, type)
  fillRoundRect(ctx, x, y, metrics.w, metrics.h, metrics.h / 2, typeTone(colors, type, 'accent'))
  setText(ctx, metrics.fontSize, '#fff', '700')
  ctx.fillText(metrics.meta.label, x + metrics.padX, y + 49)
}

function drawGroupLabel(ctx, text, color, x, y) {
  setText(ctx, 22, color, '700')
  ctx.fillText(text, x, y + 22)
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
}

function drawFooter(ctx, spec, images, x, y, width, colors) {
  const contact = spec.contact || {}
  const value = String(contact.value || '').trim()
  ctx.strokeStyle = colors.line
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x + width, y)
  ctx.stroke()
  const top = y + 30
  if (contact.mode === 'qr' && images.qr) {
    const qrSize = 96
    fillRoundRect(ctx, x, top, qrSize, qrSize, 10, '#ffffff')
    ctx.save()
    roundRectPath(ctx, x + 6, top + 6, qrSize - 12, qrSize - 12, 6)
    ctx.clip()
    drawCover(ctx, images.qr, x + 6, top + 6, qrSize - 12, qrSize - 12)
    ctx.restore()
    if (value) {
      setText(ctx, 24, colors.muted, '560')
      fillTruncated(ctx, value, x + qrSize + 20, top + 56, width - qrSize - 20)
    }
  } else if (value) {
    drawTextContact(ctx, value, x, top, 48, 26, 18, colors)
  }
  setText(ctx, 19, colors.subtle, '400')
  const footerText = '用「赶场愉快」导出'
  ctx.fillText(footerText, x + width - ctx.measureText(footerText).width, y + 30 + (contact.mode === 'qr' && images.qr ? 96 : 48) + 30)
}

function drawFooterInline(ctx, spec, images, x, bottomY, colors, rightX) {
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

function planLayout(spec) {
  const colors = ticketTheme(spec)
  const contentX = PAD
  const contentW = WIDTH - PAD * 2
  const blocks = []
  let y = 0
  const single = spec.type !== 'swap' && (spec.screenings || []).length === 1

  if (single) {
    const heroH = singleHeroHeight(spec.screenings[0], spec)
    blocks.push({ kind: 'hero', item: spec.screenings[0], x: 0, y: 0, w: WIDTH, h: heroH })
    return { blocks, height: heroH, single: true, contentX, contentW }
  }

  const headTop = PAD
  blocks.push({ kind: 'head', x: contentX, y: headTop, w: contentW })
  y = headTop + 76

  if (spec.type === 'swap') {
    const swapItems = [].concat(spec.give || [], spec.want || [])
    const swapPosterH = sharedPosterHeight(swapItems)
    const swapRowH = Math.max(ROW_H, swapPosterH + 18, maxRowContentHeight(swapItems) + 18)
    blocks.push({ kind: 'groupLabel', text: '我出', color: typeTone(colors, 'offer', 'priceTint'), x: contentX, y })
    y += 40
    ;(spec.give || []).forEach(item => {
      blocks.push({ kind: 'row', item, type: 'offer', x: contentX, y, w: contentW, h: swapRowH, posterH: swapPosterH })
      y += swapRowH + GROUP_GAP
    })
    blocks.push({ kind: 'swapDivider', x: contentX, y, w: contentW })
    y += 56
    blocks.push({ kind: 'groupLabel', text: '我求', color: typeTone(colors, 'seek', 'priceTint'), x: contentX, y })
    y += 40
    ;(spec.want || []).forEach(item => {
      blocks.push({ kind: 'row', item, type: 'seek', x: contentX, y, w: contentW, h: swapRowH, posterH: swapPosterH })
      y += swapRowH + GROUP_GAP
    })
  } else {
    const listItems = spec.screenings || []
    const listPosterH = sharedPosterHeight(listItems)
    const listRowH = Math.max(ROW_H, listPosterH + 18, maxRowContentHeight(listItems) + 18)
    ;(spec.screenings || []).forEach(item => {
      blocks.push({ kind: 'row', item, type: spec.type, x: contentX, y, w: contentW, h: listRowH, posterH: listPosterH })
      y += listRowH + GROUP_GAP
    })
  }

  y += 10
  blocks.push({ kind: 'footer', x: contentX, y, w: contentW })
  y += FOOTER_H + (spec.contact && spec.contact.mode === 'qr' && spec.contact.qrSrc ? 60 : 0)
  y += PAD
  return { blocks, height: y, single: false, contentX, contentW }
}

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
    return
  }
  const grad = ctx.createLinearGradient(x, y, x, y + h)
  grad.addColorStop(0, '#e4e8e1')
  grad.addColorStop(1, '#c9d0c7')
  ctx.fillStyle = grad
  ctx.fillRect(x, y, w, h)
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

function drawListRow(ctx, item, x, y, width, images, type, colors, rowH, rowPosterH) {
  const h = rowH || rowHeight(item)
  const contentH = rowContentHeight(item)
  const posterImg = images.posters[posterKey(item)] || null
  const posterH = Math.min(h, rowPosterH || Math.max(THUMB_H, contentH))
  const posterW = Math.round(posterH * THUMB_W / THUMB_H)
  const contentTop = y + Math.max(0, Math.round((h - contentH) / 2))
  const posterY = y + Math.max(0, Math.round((h - posterH) / 2))

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
}

function paint(ctx, spec, layout, images) {
  const colors = ticketTheme(spec)
  const heroColors = Object.assign({}, TICKET_THEMES.classic, { typeMeta: colors.typeMeta })
  ctx.fillStyle = colors.bg
  ctx.fillRect(0, 0, WIDTH, layout.height)

  layout.blocks.forEach(block => {
    if (block.kind === 'hero') {
      const item = block.item
      const posterImg = images.posters[posterKey(item)] || null
      drawCover(ctx, posterImg, -36, -36, WIDTH + 72, block.h + 72)
      const shade = ctx.createLinearGradient(0, 0, 0, block.h)
      shade.addColorStop(0, 'rgba(7,6,5,0.72)')
      shade.addColorStop(0.58, 'rgba(7,6,5,0.88)')
      shade.addColorStop(1, 'rgba(7,6,5,0.97)')
      ctx.fillStyle = shade
      ctx.fillRect(0, 0, WIDTH, block.h)

      const posterW = 220
      const posterH = 312
      const posterX = Math.round((WIDTH - posterW) / 2)
      const posterY = 116
      const posterRect = drawContain(ctx, posterImg, posterX, posterY, posterW, posterH)
      ctx.strokeStyle = 'rgba(255,255,255,0.16)'
      ctx.lineWidth = 1
      roundRectPath(ctx, posterRect.x, posterRect.y, posterRect.w, posterRect.h, 14)
      ctx.stroke()

      drawBadgeAt(ctx, spec.type, PAD - 22, PAD - 14, colors)
      const heroW = WIDTH - PAD * 2
      let cy = posterY + posterH + 64
      setText(ctx, 46, '#fff', '720')
      const titleLines = fillWrapped(ctx, item.cnTitle || '', PAD, cy, heroW, 52, 2)
      cy += titleLines * 52 + 8
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
      drawFooterInline(ctx, spec, images, PAD, block.h - PAD - 6, heroColors, WIDTH - PAD)
      return
    }
    if (block.kind === 'head') {
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
    }
  })
}

function loadCanvasImage(canvas, src) {
  return new Promise(resolve => {
    const value = String(src || '').trim()
    if (!value || !canvas || !canvas.createImage) {
      resolve(null)
      return
    }
    resolveCanvasImageSrc(value).then(canvasSrc => {
      if (!canvasSrc) {
        resolve(null)
        return
      }
      const image = canvas.createImage()
      image.onload = () => resolve(image)
      image.onerror = () => resolve(null)
      image.src = canvasSrc
    })
  })
}

function posterSources(item) {
  const list = Array.isArray(item && item.posterSrcs) ? item.posterSrcs : [item && item.posterSrc]
  const seen = {}
  return list
    .map(src => String(src || '').trim())
    .filter(Boolean)
    .filter(src => {
      if (seen[src]) {
        return false
      }
      seen[src] = true
      return true
    })
}

function posterKey(item) {
  const sources = posterSources(item)
  return sources[0] || ''
}

function loadFirstCanvasImage(canvas, sources) {
  const list = Array.isArray(sources) ? sources : [sources]
  return new Promise(resolve => {
    const tryNext = index => {
      const src = list[index]
      if (!src) {
        resolve(null)
        return
      }
      loadCanvasImage(canvas, src).then(image => {
        if (image) {
          resolve(image)
          return
        }
        tryNext(index + 1)
      })
    }
    tryNext(0)
  })
}

function resolveCanvasImageSrc(src) {
  return new Promise(resolve => {
    const value = String(src || '').trim()
    if (!value) {
      resolve('')
      return
    }

    if (/^cloud:\/\//.test(value) && typeof wx !== 'undefined' && wx.cloud && wx.cloud.downloadFile) {
      wx.cloud.downloadFile({
        fileID: value,
        success: res => resolve(res && res.tempFilePath || ''),
        fail: () => resolve('')
      })
      return
    }

    if (/^https?:\/\//.test(value) && typeof wx !== 'undefined' && wx.getImageInfo) {
      wx.getImageInfo({
        src: value,
        success: res => resolve(res && res.path || value),
        fail: () => resolve(value)
      })
      return
    }

    resolve(value)
  })
}

function collectPosterItems(spec) {
  return spec.type === 'swap'
    ? [].concat(spec.give || [], spec.want || [])
    : (spec.screenings || [])
}

function hydrateImages(canvas, spec) {
  const posters = {}
  const items = collectPosterItems(spec)
  const posterTasks = items.map(item => {
    const key = posterKey(item)
    if (!key || posters[key] !== undefined) return Promise.resolve()
    posters[key] = null
    return loadFirstCanvasImage(canvas, posterSources(item)).then(image => {
      posters[key] = image
    })
  })
  const qrSrc = spec.contact && spec.contact.mode === 'qr' ? String(spec.contact.qrSrc || '').trim() : ''
  const qrTask = qrSrc ? loadCanvasImage(canvas, qrSrc) : Promise.resolve(null)
  return Promise.all(posterTasks.concat(qrTask)).then(results => ({
    posters,
    qr: qrSrc ? results[results.length - 1] : null
  }))
}

function createTicketPoster(canvas, spec) {
  if (!canvas || !spec || !TYPE_META[spec.type]) {
    return Promise.reject(new Error('invalid_ticket_poster_spec'))
  }
  const layout = planLayout(spec)
  const windowInfo = wx.getWindowInfo
    ? wx.getWindowInfo()
    : (wx.getSystemInfoSync ? wx.getSystemInfoSync() : {})
  const pixelRatio = Math.max(1, Math.min(windowInfo.pixelRatio || 1, layout.height > 2600 ? 1.5 : 2))
  canvas.width = Math.round(WIDTH * pixelRatio)
  canvas.height = Math.round(layout.height * pixelRatio)
  const ctx = canvas.getContext('2d')
  ctx.scale(pixelRatio, pixelRatio)
  ctx.textBaseline = 'alphabetic'
  return hydrateImages(canvas, spec).then(images => {
    paint(ctx, spec, layout, images)
    return {
      width: WIDTH,
      height: layout.height,
      pixelRatio
    }
  })
}

module.exports = {
  TICKET_THEME_OPTIONS,
  createTicketPoster,
  formatPriceText
}
