const tabs = [
  {
    pagePath: '/pages/films/index',
    text: '选电影',
    iconPath: '/assets/tab/films.png',
    selectedIconPath: '/assets/tab/films-active.png'
  },
  {
    pagePath: '/pages/schedule/index',
    text: '挑场次',
    iconPath: '/assets/tab/schedule.png',
    selectedIconPath: '/assets/tab/schedule-active.png'
  },
  {
    pagePath: '/pages/plan/index',
    text: '排片表',
    iconPath: '/assets/tab/plan.png',
    selectedIconPath: '/assets/tab/plan-active.png'
  },
  {
    pagePath: '/pages/popularity/index',
    text: '热度榜',
    iconPath: '/assets/tab/popularity.png',
    selectedIconPath: '/assets/tab/popularity-active.png'
  }
]

function currentRoute() {
  const pages = getCurrentPages()
  const current = pages[pages.length - 1]
  return current && `/${current.route}`
}

function getWindowMetrics() {
  try {
    if (wx.getWindowInfo) {
      return wx.getWindowInfo()
    }
  } catch (error) {}
  try {
    return wx.getSystemInfoSync ? wx.getSystemInfoSync() : {}
  } catch (error) {
    return {}
  }
}

function getBottomGap() {
  const metrics = getWindowMetrics()
  const screenHeight = Number(metrics.screenHeight || metrics.windowHeight) || 0
  const safeBottom = metrics.safeArea && Number(metrics.safeArea.bottom) || screenHeight
  const safeInset = Math.max(0, Math.round(screenHeight - safeBottom))
  return Math.max(6, safeInset - 12)
}

Component({
  data: {
    selected: -1,
    hidden: false,
    bottomGap: 6,
    tabs
  },

  lifetimes: {
    attached() {
      this.syncLayout()
      this.syncSelected()
    }
  },

  pageLifetimes: {
    show() {
      this.syncLayout()
      this.syncSelected()
    }
  },

  methods: {
    syncLayout() {
      const bottomGap = getBottomGap()
      if (bottomGap !== this.data.bottomGap) {
        this.setData({ bottomGap })
      }
    },

    syncSelected() {
      const route = currentRoute()
      const selected = tabs.findIndex(item => item.pagePath === route)
      if (selected >= 0 && selected !== this.data.selected) {
        this.setData({ selected })
      }
    },

    switchTab(event) {
      const index = Number(event.currentTarget.dataset.index)
      const target = tabs[index]
      if (!target) {
        return
      }
      if (index === this.data.selected) {
        this.syncSelected()
        return
      }
      wx.switchTab({
        url: target.pagePath
      })
    }
  }
})
