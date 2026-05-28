function getNavMetrics() {
  try {
    const system = wx.getSystemInfoSync()
    const menu = wx.getMenuButtonBoundingClientRect()
    const navTop = menu.top || system.statusBarHeight || 0
    const navHeight = menu.height || 44
    const navRight = Math.max(112, system.windowWidth - menu.left + 10)
    const navTotalHeight = navTop + navHeight
    return {
      navTop,
      navHeight,
      navRight,
      navTotalHeight,
      contentTop: navTotalHeight + 4
    }
  } catch (error) {
    return {
      navTop: 0,
      navHeight: 44,
      navRight: 120,
      navTotalHeight: 88,
      contentTop: 92
    }
  }
}

module.exports = {
  getNavMetrics
}
