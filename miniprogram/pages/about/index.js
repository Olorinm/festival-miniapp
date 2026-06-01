const app = getApp()

Page({
  data: {
    festivalName: app.globalData.festivalMeta.name,
    githubUrl: 'https://github.com/Olorinm/festival-miniapp',
    groupQrSrc: '/assets/community/wechat-feedback-group.jpg'
  },

  onShow() {
    this.setData({ festivalName: app.globalData.festivalMeta.name })
    app.whenFestivalDataReady().then(() => {
      this.setData({ festivalName: app.globalData.festivalMeta.name })
    })
  },

  copyGithubUrl() {
    wx.setClipboardData({
      data: this.data.githubUrl,
      success: () => {
        wx.showToast({
          title: '已复制链接',
          icon: 'none'
        })
      }
    })
  },

  previewGroupQr() {
    wx.previewImage({
      urls: [this.data.groupQrSrc],
      current: this.data.groupQrSrc
    })
  }
})
