function syncTabBar(page, selected) {
  if (!page || typeof page.getTabBar !== 'function') {
    return
  }

  const tabBar = page.getTabBar()
  if (!tabBar || typeof tabBar.setData !== 'function') {
    return
  }

  if (tabBar.data && tabBar.data.selected === selected && tabBar.data.hidden === false) {
    return
  }

  tabBar.setData({ selected, hidden: false })
}

function setTabBarHidden(page, hidden) {
  if (!page || typeof page.getTabBar !== 'function') {
    return
  }

  const tabBar = page.getTabBar()
  if (!tabBar || typeof tabBar.setData !== 'function') {
    return
  }

  const nextHidden = !!hidden
  if (tabBar.data && tabBar.data.hidden === nextHidden) {
    return
  }

  tabBar.setData({ hidden: nextHidden })
}

function setCurrentTabBarHidden(hidden) {
  const pages = getCurrentPages()
  setTabBarHidden(pages[pages.length - 1], hidden)
}

module.exports = {
  syncTabBar,
  setTabBarHidden,
  setCurrentTabBarHidden
}
