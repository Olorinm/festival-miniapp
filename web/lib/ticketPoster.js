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

const WEIGHT_MAP = { '260': 300, '320': 300, '360': 400, '400': 400, '420': 400, '500': 500, '520': 500, '540': 500, '560': 600, '580': 600, '600': 600, '620': 600, '640': 700, '650': 700, '660': 700, '680': 700, '700': 700, '720': 800 }

function fontWeight(weight) {
  return WEIGHT_MAP[String(weight)] || 400
}

function setText(ctx, size, color, weight) {
  ctx.fillStyle = color
  ctx.font = `${fontWeight(weight)} ${size}px ${FONT_FAMILY}`
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

function venueText(item) {
  return compact([item.cinema, item.hall])
}

// 把场次的可选字段（票价/座位）拼成一行
function extraText(item) {
  const price = item.price != null && String(item.price).trim() !== '' ? String(item.price).trim() : ''
  const seat = item.seat != null && String(item.seat).trim() !== '' ? String(item.seat).trim() : ''
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

// ---- 布局测量：返回总高度，绘制时复用 ----
const HERO_MIN = 760      // 单场满幅海报区高度
const ROW_H = 132         // 列表行高（标题+时间+影院 三行）
const ROW_H_EXTRA = 162   // 列表行高（多一行票价/座位）
const THUMB_W = 92
const THUMB_H = 130
const GROUP_GAP = 14
const FOOTER_H = 96

function rowHeight(item) {
  return extraText(item) ? ROW_H_EXTRA : ROW_H
}

// 画类型徽标（右上角）
function drawBadge(ctx, type, rightX, y) {
  const meta = TYPE_META[type]
  const fontSize = 32
  setText(ctx, fontSize, '#fff', '700')
  const tw = ctx.measureText(meta.label).width
  const padX = 30
  const w = tw + padX * 2
  const h = 62
  const x = rightX - w
  fillRoundRect(ctx, x, y, w, h, h / 2, meta.accent)
  setText(ctx, fontSize, '#fff', '700')
  ctx.fillText(meta.label, x + padX, y + 43)
  return h
}

// 画一行列表场次（带缩略海报）。返回行高。
function drawListRow(ctx, item, x, y, width, images, type) {
  const h = rowHeight(item)
  const posterImg = images.posters[normalizeSrc(item.posterSrc)] || null
  // 缩略海报
  ctx.save()
  roundRectPath(ctx, x, y + (h - THUMB_H) / 2, THUMB_W, THUMB_H, 8)
  ctx.clip()
  drawCover(ctx, posterImg, x, y + (h - THUMB_H) / 2, THUMB_W, THUMB_H)
  ctx.restore()
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'
  ctx.lineWidth = 1
  roundRectPath(ctx, x, y + (h - THUMB_H) / 2, THUMB_W, THUMB_H, 8)
  ctx.stroke()

  const textX = x + THUMB_W + 22
  const textW = x + width - textX
  let cursor = y + (h - THUMB_H) / 2 + 4
  setText(ctx, 33, '#ffffff', '680')
  cursor += 30
  fillTruncated(ctx, item.cnTitle || '', textX, cursor, textW)
  setText(ctx, 24, 'rgba(255,255,255,0.66)', '440')
  cursor += 34
  // 日期时间一行、影院一行，分两行避免超长被裁掉关键信息
  fillTruncated(ctx, dateTimeText(item), textX, cursor, textW)
  cursor += 30
  fillTruncated(ctx, venueText(item), textX, cursor, textW)
  const extra = extraText(item)
  if (extra) {
    setText(ctx, 23, TYPE_META[type].priceTint, '560')
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

// 画底部联系区，返回高度
function drawFooter(ctx, spec, images, x, y, width) {
  const contact = spec.contact || {}
  const value = String(contact.value || '').trim()
  // 分隔线
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'
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
      setText(ctx, 24, 'rgba(255,255,255,0.82)', '560')
      fillTruncated(ctx, value, x + qrSize + 20, top + 56, width - qrSize - 20)
    }
  } else if (value) {
    // 文字胶囊
    setText(ctx, 26, '#fff', '600')
    const tw = ctx.measureText(value).width
    const padX = 20
    fillRoundRect(ctx, x, top, tw + padX * 2, 48, 24, 'rgba(255,255,255,0.13)')
    setText(ctx, 26, '#fff', '600')
    ctx.fillText(value, x + padX, top + 32)
  }
  // 底部小字
  setText(ctx, 19, 'rgba(255,255,255,0.34)', '400')
  ctx.fillText('用「赶场愉快」（cinehappy.com）导出', x, y + 30 + (contact.mode === 'qr' && images.qr ? 96 : 48) + 30)
  return FOOTER_H + (contact.mode === 'qr' && images.qr ? 60 : 14)
}

// ===== 布局规划：算出每个区块的位置与画布总高 =====
function planLayout(spec) {
  const contentX = PAD
  const contentW = WIDTH - PAD * 2
  const blocks = []
  let y = 0

  const single = spec.type !== 'swap' && (spec.screenings || []).length === 1

  if (single) {
    // 单场满幅海报版
    blocks.push({ kind: 'hero', item: spec.screenings[0], x: 0, y: 0, w: WIDTH, h: HERO_MIN })
    y = HERO_MIN
    return { blocks, height: y, single: true, contentX, contentW }
  }

  // 列表版头部
  const headTop = PAD
  blocks.push({ kind: 'head', x: contentX, y: headTop, w: contentW })
  y = headTop + 76

  if (spec.type === 'swap') {
    // 我出
    blocks.push({ kind: 'groupLabel', text: '我出', color: TYPE_META.offer.priceTint, x: contentX, y })
    y += 40
    ;(spec.give || []).forEach(item => {
      const h = rowHeight(item)
      blocks.push({ kind: 'row', item, type: 'offer', x: contentX, y, w: contentW, h })
      y += h + GROUP_GAP
    })
    // 对调分隔
    blocks.push({ kind: 'swapDivider', x: contentX, y, w: contentW })
    y += 56
    // 我求
    blocks.push({ kind: 'groupLabel', text: '我求', color: TYPE_META.seek.priceTint, x: contentX, y })
    y += 40
    ;(spec.want || []).forEach(item => {
      const h = rowHeight(item)
      blocks.push({ kind: 'row', item, type: 'seek', x: contentX, y, w: contentW, h })
      y += h + GROUP_GAP
    })
  } else {
    ;(spec.screenings || []).forEach(item => {
      const h = rowHeight(item)
      blocks.push({ kind: 'row', item, type: spec.type, x: contentX, y, w: contentW, h })
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
  // 背景
  ctx.fillStyle = '#1b1715'
  ctx.fillRect(0, 0, WIDTH, layout.height)

  layout.blocks.forEach(block => {
    if (block.kind === 'hero') {
      const item = block.item
      const posterImg = images.posters[normalizeSrc(item.posterSrc)] || null
      drawCover(ctx, posterImg, 0, 0, WIDTH, block.h)
      // 底部暗角渐变
      const grad = ctx.createLinearGradient(0, block.h, 0, 0)
      grad.addColorStop(0, 'rgba(8,6,5,0.95)')
      grad.addColorStop(0.34, 'rgba(8,6,5,0.72)')
      grad.addColorStop(0.66, 'rgba(8,6,5,0.28)')
      grad.addColorStop(1, 'rgba(8,6,5,0.04)')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, WIDTH, block.h)
      // 徽标右上
      drawBadge(ctx, spec.type, WIDTH - PAD, PAD)
      // 底部信息
      const heroW = WIDTH - PAD * 2
      let cy = block.h - PAD - 200
      setText(ctx, 52, '#fff', '720')
      fillTruncated(ctx, item.cnTitle || '', PAD, cy, heroW)
      setText(ctx, 27, 'rgba(255,255,255,0.9)', '560')
      cy += 44
      fillTruncated(ctx, dateTimeText(item), PAD, cy, heroW)
      setText(ctx, 27, 'rgba(255,255,255,0.9)', '440')
      cy += 38
      fillTruncated(ctx, venueText(item), PAD, cy, heroW)
      const extra = extraText(item)
      if (extra) {
        setText(ctx, 25, TYPE_META[spec.type].priceTint, '560')
        cy += 36
        fillTruncated(ctx, extra, PAD, cy, heroW)
      }
      // 联系 + 小字（压在海报底部）
      drawFooterInline(ctx, spec, images, PAD, block.h - PAD - 6)
      return
    }
    if (block.kind === 'head') {
      // 顶部只留类型徽标；场次数靠下方列表一目了然，不再重复写标题
      drawBadge(ctx, spec.type, block.x + block.w, block.y)
      return
    }
    if (block.kind === 'groupLabel') {
      drawGroupLabel(ctx, block.text, block.color, block.x, block.y)
      return
    }
    if (block.kind === 'swapDivider') {
      ctx.strokeStyle = 'rgba(255,255,255,0.14)'
      ctx.lineWidth = 1
      const midY = block.y + 26
      ctx.beginPath()
      ctx.moveTo(block.x, midY)
      ctx.lineTo(block.x + block.w / 2 - 26, midY)
      ctx.moveTo(block.x + block.w / 2 + 26, midY)
      ctx.lineTo(block.x + block.w, midY)
      ctx.stroke()
      setText(ctx, 30, 'rgba(255,255,255,0.6)', '400')
      ctx.textAlign = 'center'
      ctx.fillText('⇅', block.x + block.w / 2, midY + 11)
      ctx.textAlign = 'left'
      return
    }
    if (block.kind === 'row') {
      drawListRow(ctx, block.item, block.x, block.y, block.w, images, block.type)
      return
    }
    if (block.kind === 'footer') {
      drawFooter(ctx, spec, images, block.x, block.y, block.w)
      return
    }
  })
}

// 满幅海报版底部的联系条 + 小字（与列表版 footer 略不同，无分隔线）
function drawFooterInline(ctx, spec, images, x, bottomY) {
  const contact = spec.contact || {}
  const value = String(contact.value || '').trim()
  let lineY = bottomY
  setText(ctx, 19, 'rgba(255,255,255,0.4)', '400')
  ctx.fillText('用「赶场愉快」（cinehappy.com）导出', x, lineY)
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
      setText(ctx, 23, 'rgba(255,255,255,0.82)', '560')
      ctx.fillText(value, x + qrSize + 16, top + qrSize / 2 + 8)
    }
  } else if (value) {
    setText(ctx, 25, '#fff', '600')
    const tw = ctx.measureText(value).width
    const padX = 18
    const h = 44
    fillRoundRect(ctx, x, lineY - h, tw + padX * 2, h, h / 2, 'rgba(255,255,255,0.13)')
    setText(ctx, 25, '#fff', '600')
    ctx.fillText(value, x + padX, lineY - h + 30)
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
