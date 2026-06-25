const FONT_FAMILY = '"PingFang SC", "Hiragino Sans GB", sans-serif'
const WIDTH = 750
const PAD_X = 36
const HEADER_H = 170
const ROW_H = 168
const FOOTER_H = 70

const COLORS = {
  bg: '#ffffff',
  ink: '#161614',
  title: '#141412',
  brand: '#171715',
  muted: '#9a9a90',
  body: '#6f6f67',
  line: '#ededea',
  rank: '#cfcec8',
  top: '#3f5b73',
  bar: '#c9c8c1',
  barBg: '#ecece8',
  badge: '#171917',
  placeholder: '#e3e4de'
}

const WEIGHT_MAP = {
  500: 'normal',
  600: 'bold',
  650: 'bold',
  700: 'bold',
  750: 'bold',
  800: 'bold'
}

function setText(ctx, size, color, weight, options) {
  const opts = options || {}
  const style = opts.italic ? 'italic ' : ''
  ctx.fillStyle = color
  ctx.font = `${style}${WEIGHT_MAP[String(weight)] || 'normal'} ${size}px ${FONT_FAMILY}`
}

function compact(parts) {
  return parts.map(part => String(part || '').trim()).filter(Boolean).join(' · ')
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

function drawWrapped(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const lines = wrapLines(ctx, text, maxWidth, maxLines)
  lines.forEach((line, index) => ctx.fillText(line, x, y + index * lineHeight))
  return lines.length
}

function posterSources(item) {
  const list = Array.isArray(item && item.posterSrcs) ? item.posterSrcs : [
    item && item.posterCanvasSrc,
    item && item.posterSrc
  ]
  const seen = {}
  return list
    .map(src => String(src || '').trim())
    .filter(Boolean)
    .filter(src => {
      if (seen[src]) return false
      seen[src] = true
      return true
    })
}

function posterKey(item) {
  return posterSources(item)[0] || ''
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

function hydratePosters(canvas, rows) {
  const posters = {}
  const tasks = (rows || []).map(item => {
    const key = posterKey(item)
    if (!key || posters[key] !== undefined) return Promise.resolve()
    posters[key] = null
    return loadFirstCanvasImage(canvas, posterSources(item)).then(image => {
      posters[key] = image
    })
  })
  return Promise.all(tasks).then(() => posters)
}

function drawCover(ctx, image, x, y, w, h) {
  if (!image || !image.width || !image.height) return false
  const ratio = Math.max(w / image.width, h / image.height)
  const sw = w / ratio
  const sh = h / ratio
  const sx = Math.max(0, (image.width - sw) / 2)
  const sy = Math.max(0, (image.height - sh) / 2)
  ctx.drawImage(image, sx, sy, sw, sh, x, y, w, h)
  return true
}

function drawPoster(ctx, image, item, x, y, w, h) {
  ctx.save()
  roundRectPath(ctx, x, y, w, h, 12)
  ctx.clip()
  if (!drawCover(ctx, image, x, y, w, h)) {
    ctx.fillStyle = COLORS.placeholder
    ctx.fillRect(x, y, w, h)
    setText(ctx, 20, '#9a9f96', '700')
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const lines = wrapLines(ctx, String(item.cnTitle || '').replace(/\s*\(4K\)/, ''), w * 0.72, 2)
    lines.forEach((line, index) => {
      ctx.fillText(line, x + w / 2, y + h / 2 + (index - (lines.length - 1) / 2) * 24)
    })
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
  }
  ctx.restore()
}

function drawHeader(ctx, spec) {
  ctx.fillStyle = COLORS.bg
  ctx.fillRect(0, 0, WIDTH, spec.height)

  ctx.beginPath()
  ctx.arc(PAD_X + 6, 31, 6, 0, Math.PI * 2)
  ctx.fillStyle = COLORS.brand
  ctx.fill()

  setText(ctx, 22, '#777d75', '600')
  ctx.fillText('赶场愉快', PAD_X + 24, 39)

  setText(ctx, 44, '#171917', '750')
  const title = spec.festivalName || '28th SIFF'
  ctx.fillText(title, PAD_X, 93)
  const titleWidth = ctx.measureText(title).width

  const badgeX = PAD_X + titleWidth + 16
  const badgeText = spec.rankLabel || '热度榜'
  setText(ctx, 18, '#ffffff', '700')
  const badgeW = Math.max(80, Math.ceil(ctx.measureText(badgeText).width) + 26)
  fillRoundRect(ctx, badgeX, 63, badgeW, 32, 16, COLORS.badge)
  setText(ctx, 18, '#ffffff', '700')
  ctx.fillText(badgeText, badgeX + 13, 85)

  setText(ctx, 22, '#858982', '500')
  const meta = spec.metaText || ''
  drawWrapped(ctx, meta, PAD_X, 126, 520, 28, 2)

  ctx.strokeStyle = COLORS.line
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(PAD_X, HEADER_H - 1)
  ctx.lineTo(WIDTH - PAD_X, HEADER_H - 1)
  ctx.stroke()
}

function drawRow(ctx, item, index, maxCount, posters) {
  const y = HEADER_H + index * ROW_H
  const centerY = y + ROW_H / 2
  const isTop = index < 3

  ctx.strokeStyle = COLORS.line
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(PAD_X, y + ROW_H)
  ctx.lineTo(WIDTH - PAD_X, y + ROW_H)
  ctx.stroke()

  setText(ctx, 58, isTop ? COLORS.top : COLORS.rank, '800', { italic: true })
  ctx.textAlign = 'center'
  ctx.fillText(String(index + 1), PAD_X + 32, centerY + 19)
  ctx.textAlign = 'left'

  const posterX = PAD_X + 78
  const posterY = y + 24
  const posterW = item.hidePoster ? 0 : 78
  const posterH = 114
  if (!item.hidePoster) {
    drawPoster(ctx, posters[posterKey(item)], item, posterX, posterY, posterW, posterH)
  }

  const textX = item.hidePoster ? posterX : posterX + posterW + 24
  const textRight = WIDTH - PAD_X - 124
  const textW = Math.max(120, textRight - textX)
  setText(ctx, 29, COLORS.ink, '750')
  ctx.fillText(truncate(ctx, item.cnTitle, textW), textX, y + 52)
  setText(ctx, 22, COLORS.body, '650')
  ctx.fillText(truncate(ctx, item.primaryMeta || compact([item.dayLabel, item.timeRange]), textW), textX, y + 85)
  setText(ctx, 21, COLORS.muted, '600')
  ctx.fillText(truncate(ctx, item.secondaryMeta || item.venueLine || compact([item.cinema, item.hall]), textW), textX, y + 114)

  const count = Math.max(0, Number(item.popularityCount) || 0)
  const countX = WIDTH - PAD_X
  ctx.textAlign = 'right'
  setText(ctx, 48, '#1f1f1c', '800')
  ctx.fillText(String(count), countX, y + 58)
  setText(ctx, 18, COLORS.muted, '650')
  ctx.fillText('人已排', countX, y + 83)

  const barW = 96
  const barH = 8
  const barX = countX - barW
  const barY = y + 102
  fillRoundRect(ctx, barX, barY, barW, barH, 99, COLORS.barBg)
  fillRoundRect(ctx, barX, barY, Math.max(4, Math.round(barW * count / Math.max(1, maxCount))), barH, 99, isTop ? COLORS.top : COLORS.bar)
  ctx.textAlign = 'left'
}

function drawFooter(ctx, y) {
  setText(ctx, 20, COLORS.muted, '600')
  ctx.textAlign = 'right'
  ctx.fillText('用「赶场愉快」查看电影节热度', WIDTH - PAD_X, y + 42)
  ctx.textAlign = 'left'
}

function exportPixelRatio(height) {
  const windowInfo = wx.getWindowInfo
    ? wx.getWindowInfo()
    : (wx.getSystemInfoSync ? wx.getSystemInfoSync() : {})
  const deviceRatio = windowInfo.pixelRatio || 1
  const cap = height > 5600 ? 1 : (height > 3000 ? 1.35 : 2)
  return Math.max(1, Math.min(deviceRatio, cap))
}

function createPopularityPoster(canvas, spec) {
  if (!canvas || !spec || !Array.isArray(spec.rows) || !spec.rows.length) {
    return Promise.reject(new Error('invalid_popularity_poster_spec'))
  }
  const rows = spec.rows
  const height = HEADER_H + rows.length * ROW_H + FOOTER_H
  const pixelRatio = exportPixelRatio(height)
  canvas.width = Math.round(WIDTH * pixelRatio)
  canvas.height = Math.round(height * pixelRatio)
  const ctx = canvas.getContext('2d')
  ctx.scale(pixelRatio, pixelRatio)
  ctx.textBaseline = 'alphabetic'

  return hydratePosters(canvas, rows).then(posters => {
    drawHeader(ctx, Object.assign({}, spec, { height }))
    const maxCount = Math.max(1, Number(rows[0] && rows[0].popularityCount) || 1)
    rows.forEach((item, index) => drawRow(ctx, item, index, maxCount, posters))
    drawFooter(ctx, HEADER_H + rows.length * ROW_H)
    return {
      width: WIDTH,
      height,
      pixelRatio
    }
  })
}

module.exports = {
  createPopularityPoster
}
