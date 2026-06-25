const interestOptions = [
  { key: 'must', label: '必看', shortLabel: '必看', rank: 3, tone: 'gold' },
  { key: 'want', label: '想看', shortLabel: '想看', rank: 2, tone: 'blue' },
  { key: 'maybe', label: '待定', shortLabel: '待定', rank: 1, tone: 'gray' },
  { key: 'none', label: '未标记', shortLabel: '', rank: 0, tone: 'gray' }
]

const festivalMeta = {
  name: 'SIFF 2026',
  displayName: '28th SIFF',
  subtitle: '选片与排片助手',
  city: '上海',
  sourceNote: '片单来自 2026 上海电影节整理数据；场次来自第28届上海国际电影节官方排片表。',
  dataVersion: 'lite-fallback'
}

module.exports = {
  festivalMeta,
  films: [],
  interestOptions
}
