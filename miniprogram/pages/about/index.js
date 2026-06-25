const app = getApp()
const { enableShareMenu, shareAppMessage, shareTimeline } = require('../../utils/share')

function festivalDisplayName() {
  const meta = app.globalData.festivalMeta || {}
  return meta.displayName || meta.name || '电影节'
}

function normalizeCommunityConfig(config) {
  const source = config && typeof config === 'object' ? config : {}
  const groupQrUrl = String(source.groupQrUrl || '').trim()
  const groupQrSrc = String(source.groupQrSrc || '').trim()
  return {
    groupName: String(source.groupName || '赶场愉快反馈群').trim(),
    groupHint: String(source.groupHint || '长按二维码识别加入，反馈问题、交流选片和排片。').trim(),
    groupQrFileID: String(source.groupQrFileID || source.groupQrFileId || '').trim(),
    groupQrSrc: groupQrUrl || groupQrSrc
  }
}

function isCloudFileID(value) {
  return /^cloud:\/\//.test(String(value || '').trim())
}

Page({
  data: {
    festivalName: festivalDisplayName(),
    githubUrl: 'https://github.com/Olorinm/festival-miniapp',
    groupName: '赶场愉快反馈群',
    groupHint: '长按二维码识别加入，反馈问题、交流选片和排片。',
    groupQrSrc: ''
  },

  onShow() {
    enableShareMenu()
    this.refreshCommunityConfig()
    app.whenFestivalDataReady().then(() => {
      this.refreshCommunityConfig()
    })
    if (app.fetchCommunityConfig) {
      app.fetchCommunityConfig().then(() => {
        this.refreshCommunityConfig()
      })
    }
  },

  onShareAppMessage() {
    return shareAppMessage({
      title: '电影节选片排片工具',
      path: '/pages/films/index'
    })
  },

  onShareTimeline() {
    return shareTimeline({
      title: '电影节选片排片工具',
      path: '/pages/films/index'
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

  refreshCommunityConfig() {
    const config = normalizeCommunityConfig(
      app.getCommunityConfig ? app.getCommunityConfig() : app.globalData.communityConfig
    )
    this.setData({
      festivalName: festivalDisplayName(),
      groupName: config.groupName || '赶场愉快反馈群',
      groupHint: config.groupHint || '长按二维码识别加入，反馈问题、交流选片和排片。'
    })

    if (config.groupQrFileID && wx.cloud && wx.cloud.getTempFileURL) {
      if (config.groupQrSrc && !isCloudFileID(config.groupQrSrc)) {
        this.setData({ groupQrSrc: config.groupQrSrc })
        return
      }
      this.setData({ groupQrSrc: '' })
      wx.cloud.getTempFileURL({
        fileList: [config.groupQrFileID],
        success: res => {
          const file = res && res.fileList && res.fileList[0]
          const tempFileURL = file && file.tempFileURL
          if (tempFileURL) {
            this.setData({
              groupQrSrc: tempFileURL
            })
          }
        },
        fail: () => {
          this.setData({
            groupQrSrc: config.groupQrSrc && !isCloudFileID(config.groupQrSrc) ? config.groupQrSrc : ''
          })
        }
      })
      return
    }

    this.setData({
      groupQrSrc: config.groupQrSrc && !isCloudFileID(config.groupQrSrc) ? config.groupQrSrc : ''
    })
  },

  previewGroupQr() {
    if (!this.data.groupQrSrc) {
      return
    }
    wx.previewImage({
      urls: [this.data.groupQrSrc],
      current: this.data.groupQrSrc
    })
  }
})
