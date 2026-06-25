const APP_SHARE_NAME = '赶场愉快'

function festivalDisplayName() {
  const app = getApp()
  const meta = app.globalData.festivalMeta || {}
  return meta.displayName || meta.name || '电影节'
}

function withFestivalTitle(title) {
  const festivalName = festivalDisplayName()
  const text = String(title || '').trim()
  return text ? `${text}｜${festivalName}` : `${APP_SHARE_NAME} ${festivalName}`
}

function normalizePath(path) {
  const text = String(path || '/pages/films/index').trim()
  return text.startsWith('/') ? text : `/${text}`
}

function timelineQueryFromPath(path) {
  const query = normalizePath(path).split('?')[1] || ''
  return query
}

function enableShareMenu() {
  if (!wx.showShareMenu) {
    return
  }

  try {
    wx.showShareMenu({
      withShareTicket: false,
      menus: ['shareAppMessage', 'shareTimeline']
    })
  } catch (error) {}
}

function shareAppMessage(options) {
  const source = options || {}
  const share = {
    title: source.rawTitle || withFestivalTitle(source.title),
    path: normalizePath(source.path)
  }
  if (source.imageUrl) {
    share.imageUrl = source.imageUrl
  }
  return share
}

function shareTimeline(options) {
  const source = options || {}
  const share = {
    title: source.rawTitle || withFestivalTitle(source.title),
    query: source.query || timelineQueryFromPath(source.path)
  }
  if (source.imageUrl) {
    share.imageUrl = source.imageUrl
  }
  return share
}

module.exports = {
  APP_SHARE_NAME,
  enableShareMenu,
  shareAppMessage,
  shareTimeline,
  withFestivalTitle
}
