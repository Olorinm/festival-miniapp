const {
  buildScreenings
} = require('../../utils/schedule')
const {
  buildSmartPlan,
  mergePreferenceOverrides,
  parsePreferenceInstruction,
  SMART_MODE_MARKED,
  SMART_MODE_PICK
} = require('../../utils/smart-plan')
const { setCurrentTabBarHidden } = require('../../utils/tab-bar')

const app = getApp()
const TASK_CLASSIFY_INTENT = 'classifyIntent'
const TASK_PICK_FILMS = 'pickFilms'
const TASK_PARSE_PREFERENCES = 'parseSchedulePreferences'

const SMART_PROGRESS_STEPS = [
  { delay: 0, text: '理解需求中' },
  { delay: 700, text: '解析偏好中' },
  { delay: 1600, text: '匹配场次中' },
  { delay: 2800, text: '生成方案中' },
  { delay: 5200, text: '还在生成，请稍等' }
]

function getSmartToastTitle(instruction, source) {
  if (!instruction) {
    return '已生成排片'
  }
  return source === 'ai' ? 'AI已解析' : '本地排片'
}

function getCloudFailCode(error) {
  const message = String((error && (error.errMsg || error.message)) || error || '')
  const errCodeMatch = message.match(/errCode:\s*(-?\d+)/i)
  if (errCodeMatch) {
    return `call_function_${errCodeMatch[1]}`
  }
  if (/Environment not found|env/i.test(message)) {
    return 'call_function_env'
  }
  if (/FunctionName|function/i.test(message)) {
    return 'call_function_name'
  }
  return 'call_function_fail'
}

function detectSmartMode(instruction, hasMarkedFilms) {
  if (!hasMarkedFilms) {
    return SMART_MODE_PICK
  }

  const text = String(instruction || '')
  return /帮我选|推荐|选几部|挑几部|随便|不知道看什么|没选|没有标|补几部|补一些|也可以帮我选|帮我挑/.test(text)
    ? SMART_MODE_PICK
    : SMART_MODE_MARKED
}

function normalizeFilmWeights(weights) {
  if (!weights || typeof weights !== 'object') {
    return {}
  }

  return Object.keys(weights).reduce((map, id) => {
    const value = Number(weights[id])
    if (id && Number.isFinite(value) && value > 0) {
      map[id] = Math.max(0, Math.min(100, Math.round(value)))
    }
    return map
  }, {})
}

function normalizeSelectedFilmIds(ids) {
  if (!Array.isArray(ids)) {
    return []
  }

  const seen = {}
  return ids
    .map(id => String(id || '').trim())
    .filter(Boolean)
    .filter(id => {
      if (seen[id]) {
        return false
      }
      seen[id] = true
      return true
    })
    .slice(0, 80)
}

function normalizeAllowAddFilms(value, hasMarkedFilms) {
  return !hasMarkedFilms || value === true
}

function textField(value, limit) {
  const text = String(value || '').trim()
  return text ? text.slice(0, limit || 60) : ''
}

function numberField(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

function filmIdsFromScreenings(screenings) {
  const seen = {}
  return (screenings || [])
    .map(screening => String((screening && screening.filmId) || '').trim())
    .filter(Boolean)
    .filter(id => {
      if (seen[id]) {
        return false
      }
      seen[id] = true
      return true
    })
}

function mergeFilmIds() {
  const seen = {}
  const result = []
  Array.prototype.slice.call(arguments).forEach(ids => {
    normalizeSelectedFilmIds(ids).forEach(id => {
      if (!seen[id]) {
        seen[id] = true
        result.push(id)
      }
    })
  })
  return result.slice(0, 80)
}

function buildSmartFilmCatalog(films, screenings) {
  const screeningCounts = (screenings || []).reduce((map, screening) => {
    const filmId = String((screening && screening.filmId) || '').trim()
    if (filmId) {
      map[filmId] = (map[filmId] || 0) + 1
    }
    return map
  }, {})

  return (Array.isArray(films) ? films : [])
    .map(film => {
      const id = textField(film && film.id, 48)
      const title = textField(film && (film.cnTitle || film.title), 36)
      if (!id || !title) {
        return null
      }

      const item = {
        id,
        title,
        screeningCount: screeningCounts[id] || 0
      }
      ;[
        ['enTitle', 42],
        ['section', 32],
        ['director', 32],
        ['country', 24],
        ['genre', 32],
        ['recommendation', 90]
      ].forEach(([key, limit]) => {
        const value = textField(film && film[key], limit)
        if (value) {
          item[key] = value
        }
      })
      ;[
        'year',
        'runtime',
        'doubanRating',
        'doubanRatingCount',
        'imdbRating'
      ].forEach(key => {
        const value = numberField(film && film[key])
        if (value) {
          item[key] = value
        }
      })
      return item
    })
    .filter(Boolean)
}

Component({
  data: {
    smartSheetOpen: false,
    smartInstruction: '',
    smartInputFocus: false,
    smartPlanning: false,
    smartProgressText: '',
    smartPrimaryLabel: 'AI排片'
  },

  lifetimes: {
    detached() {
      this.clearSmartProgress()
      setCurrentTabBarHidden(false)
    }
  },

  methods: {
    open() {
      setCurrentTabBarHidden(true)
      this.setData({
        smartSheetOpen: true,
        smartInputFocus: false,
        smartProgressText: '',
        smartPrimaryLabel: 'AI排片'
      })
    },

    noop() {},

    clearSmartProgress() {
      ;(this._smartProgressTimers || []).forEach(timer => clearTimeout(timer))
      this._smartProgressTimers = []
    },

    setSmartProgress(text) {
      this.setData({ smartProgressText: text })
    },

    startSmartProgress() {
      this.clearSmartProgress()
      this._smartProgressTimers = SMART_PROGRESS_STEPS.map(step => {
        return setTimeout(() => {
          if (this.data.smartPlanning) {
            this.setSmartProgress(step.text)
          }
        }, step.delay)
      })
    },

    closeSmartPlan() {
      if (this.data.smartPlanning) {
        return
      }
      this.setData({ smartSheetOpen: false, smartInputFocus: false }, () => setCurrentTabBarHidden(false))
    },

    focusSmartInput() {
      this.setData({ smartInputFocus: true })
    },

    blurSmartInput() {
      this.setData({ smartInputFocus: false })
    },

    inputSmartInstruction(event) {
      const value = event.detail.value || ''
      this.setData({
        smartInstruction: value,
        smartPrimaryLabel: 'AI排片'
      })
    },

    parseWithAI(task, instruction, localParsed, context) {
      if (!instruction || !wx.cloud || !wx.cloud.callFunction) {
        return Promise.resolve(Object.assign({}, localParsed, { source: instruction ? 'fallback' : 'script' }))
      }

      return new Promise(resolve => {
        wx.cloud.callFunction({
          name: 'parsePreference',
          data: {
            task,
            instruction,
            hasMarkedFilms: !!(context && context.hasMarkedFilms),
            films: context && context.films ? context.films : []
          },
          success: res => {
            const result = res && res.result
            if (!result) {
              console.warn('[smart-plan] AI解析失败', result || res)
              resolve(Object.assign({}, localParsed, { source: 'fallback', errorCode: 'empty_result' }))
              return
            }

            console.info('[smart-plan] 偏好解析结果', {
              task,
              source: result.source === 'ai' ? 'ai' : 'fallback',
              allowAddFilms: !!result.allowAddFilms,
              preferences: result.preferences || {}
            })
            const parsed = {
              source: result.source === 'ai' ? 'ai' : 'fallback',
              errorCode: result.errorCode || (result.debug && result.debug.code) || '',
              debug: result.debug || null
            }
            if (task === TASK_CLASSIFY_INTENT) {
              parsed.mode = result.mode
              parsed.allowAddFilms = normalizeAllowAddFilms(result.allowAddFilms, !!(context && context.hasMarkedFilms))
            } else if (task === TASK_PICK_FILMS) {
              parsed.selectedFilmIds = normalizeSelectedFilmIds(result.selectedFilmIds)
              parsed.filmWeights = normalizeFilmWeights(result.filmWeights)
            } else {
              parsed.preferences = mergePreferenceOverrides(localParsed.preferences, result.preferences)
            }
            resolve(parsed)
          },
          fail: error => {
            console.warn('[smart-plan] AI云函数调用失败', error)
            resolve(Object.assign({}, localParsed, { source: 'fallback', errorCode: getCloudFailCode(error), debug: error }))
          }
        })
      })
    },

    runSmartPlan() {
      if (this.data.smartPlanning) {
        return
      }

      const marks = app.getFilmMarks()
      const allScreenings = buildScreenings(app.globalData.films, marks)
      const wantedScreenings = allScreenings.filter(screening => screening.interest.rank > 0)
      if (!allScreenings.length) {
        wx.showToast({ title: '暂无场次', icon: 'none' })
        return
      }

      this.setData({ smartPlanning: true, smartProgressText: '理解需求中' })
      this.startSmartProgress()
      const instruction = this.data.smartInstruction.trim()
      const hasMarkedFilms = wantedScreenings.length > 0
      const aiInstruction = instruction || (hasMarkedFilms ? '' : '请根据片单帮我选一组值得看的电影并排片')
      const localMode = detectSmartMode(instruction, hasMarkedFilms)
      const localParsed = Object.assign(parsePreferenceInstruction(instruction), {
        mode: localMode,
        allowAddFilms: localMode === SMART_MODE_PICK,
        selectedFilmIds: [],
        filmWeights: {}
      })

      const workflow = aiInstruction
        ? this.parseWithAI(TASK_CLASSIFY_INTENT, aiInstruction, localParsed, {
          hasMarkedFilms,
          films: []
        }).then(intentParsed => {
          if (intentParsed.source !== 'ai') {
            return intentParsed
          }

          const allowAddFilms = normalizeAllowAddFilms(intentParsed.allowAddFilms, hasMarkedFilms)
          const smartFilmCatalog = allowAddFilms ? buildSmartFilmCatalog(app.globalData.films, allScreenings) : []
          this.setSmartProgress(allowAddFilms ? '解析偏好与筛选影片中' : '解析偏好中')

          const preferencePromise = this.parseWithAI(TASK_PARSE_PREFERENCES, aiInstruction, {
            preferences: localParsed.preferences
          }, {
            hasMarkedFilms,
            films: []
          })
          const pickPromise = allowAddFilms && smartFilmCatalog.length
            ? this.parseWithAI(TASK_PICK_FILMS, aiInstruction, {
              selectedFilmIds: [],
              filmWeights: {}
            }, {
              hasMarkedFilms,
              films: smartFilmCatalog
            })
            : Promise.resolve({
              source: 'ai',
              selectedFilmIds: [],
              filmWeights: {}
            })

          return Promise.all([preferencePromise, pickPromise]).then(results => {
            const preferenceParsed = results[0]
            const pickParsed = results[1]
            if (preferenceParsed.source !== 'ai') {
              return Object.assign({}, localParsed, {
                source: 'fallback',
                errorCode: preferenceParsed.errorCode,
                debug: preferenceParsed.debug
              })
            }
            if (allowAddFilms && pickParsed.source !== 'ai') {
              return Object.assign({}, localParsed, {
                source: 'fallback',
                errorCode: pickParsed.errorCode,
                debug: pickParsed.debug
              })
            }
            if (allowAddFilms && !hasMarkedFilms && !pickParsed.selectedFilmIds.length) {
              return Object.assign({}, localParsed, {
                source: 'fallback',
                errorCode: 'empty_film_pick'
              })
            }

            return {
              source: 'ai',
              mode: allowAddFilms ? SMART_MODE_PICK : SMART_MODE_MARKED,
              allowAddFilms,
              selectedFilmIds: allowAddFilms ? pickParsed.selectedFilmIds : [],
              filmWeights: allowAddFilms ? pickParsed.filmWeights : {},
              preferences: preferenceParsed.preferences
            }
          })
        })
        : Promise.resolve(Object.assign({}, localParsed, { source: 'script' }))

      workflow.then(parsed => {
        this.clearSmartProgress()
        if (aiInstruction && parsed.source !== 'ai') {
          this.setData({ smartPlanning: false, smartProgressText: '' })
          wx.showToast({ title: `AI失败：${parsed.errorCode || 'unknown'}`, icon: 'none' })
          console.warn('[smart-plan] AI不可用', parsed.debug || parsed.errorCode || parsed)
          return
        }

        this.setSmartProgress('应用方案中')
        const allowAddFilms = normalizeAllowAddFilms(parsed.allowAddFilms, hasMarkedFilms)
        const mode = allowAddFilms ? SMART_MODE_PICK : SMART_MODE_MARKED
        const markedFilmIds = filmIdsFromScreenings(wantedScreenings)
        const selectedFilmIds = allowAddFilms ? mergeFilmIds(hasMarkedFilms ? markedFilmIds : [], parsed.selectedFilmIds) : []
        const candidateScreenings = allowAddFilms ? allScreenings : wantedScreenings
        const result = buildSmartPlan(candidateScreenings, parsed.preferences, {
          mode,
          selectedFilmIds,
          filmWeights: parsed.filmWeights
        })

        this.setData({ smartPlanning: false })
        if (!result.selectedIds.length) {
          this.setData({ smartProgressText: '' })
          wx.showToast({ title: mode === SMART_MODE_PICK ? '没有可排场次' : '先标星', icon: 'none' })
          return
        }

        app.globalData.smartPlanMeta = {
          mode,
          allowAddFilms,
          source: parsed.source,
          instruction,
          preferences: result.preferences
        }
        app.setSelectedScreeningIds(result.selectedIds)
        this.setData({ smartSheetOpen: false }, () => {
          setCurrentTabBarHidden(false)
          this.triggerEvent('planned', { mode, source: parsed.source })
          wx.showToast({
            title: mode === SMART_MODE_PICK && parsed.source === 'ai' ? 'AI已选片' : getSmartToastTitle(instruction, parsed.source),
            icon: 'none',
            duration: 900
          })
          setTimeout(() => {
            wx.switchTab({ url: '/pages/plan/index' })
          }, 260)
        })
      })
    }
  }
})
