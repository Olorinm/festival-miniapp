import { gzip } from 'node:zlib'
import { promisify } from 'node:util'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const gzipAsync = promisify(gzip)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const DEFAULT_INPUT = 'cloud-data/festival-data.json'
const TARGETS = [
  { type: 'module', path: 'miniprogram/data/festival.js', compact: true },
  { type: 'module', path: 'web/lib/festival.js', compact: false },
  { type: 'miniapp-commute', path: 'miniprogram/utils/commute-routes.js' },
  { type: 'web-commute', path: 'web/lib/commute-routes.cjs' },
  { type: 'json', path: 'cloudfunctions/getFestivalData/festival-data.json' },
  { type: 'gzip-json', path: 'cloudfunctions/getFestivalData/festival-data.json.gz' }
]

function readArg(name, fallback) {
  const index = process.argv.indexOf(name)
  if (index === -1) {
    return fallback
  }
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value`)
  }
  return value
}

function validateFestivalData(data, inputPath) {
  if (!data || typeof data !== 'object') {
    throw new Error(`${inputPath} must be a JSON object`)
  }
  if (!data.festivalMeta || typeof data.festivalMeta !== 'object') {
    throw new Error(`${inputPath} missing festivalMeta`)
  }
  if (!Array.isArray(data.interestOptions)) {
    throw new Error(`${inputPath} missing interestOptions[]`)
  }
  if (!Array.isArray(data.films)) {
    throw new Error(`${inputPath} missing films[]`)
  }
}

function unwrapPayload(payload, inputPath) {
  const data = payload && payload.data && typeof payload.data === 'object'
    ? payload.data
    : payload
  validateFestivalData(data, inputPath)
  return { payload, data }
}

function stringifyModule(data, compact) {
  const stringify = value => compact
    ? JSON.stringify(value)
    : JSON.stringify(value, null, 2)

  return [
    `const interestOptions = ${stringify(data.interestOptions)}`,
    `const festivalMeta = ${stringify(data.festivalMeta)}`,
    `const films = ${stringify(data.films)}`,
    '',
    'module.exports = { festivalMeta, films, interestOptions }',
    ''
  ].join('\n')
}

function parseRouteKey(key) {
  const marker = '__'
  const index = String(key).indexOf(marker)
  if (index === -1) {
    throw new Error(`Invalid commute route key: ${key}`)
  }
  return [
    String(key).slice(0, index),
    String(key).slice(index + marker.length)
  ]
}

function commuteNames(routes) {
  const names = new Set()
  ;['direct', 'transit', 'walking', 'cycling'].forEach(routeType => {
    Object.keys(routes[routeType] || {}).forEach(key => {
      const [from, to] = parseRouteKey(key)
      names.add(from)
      names.add(to)
    })
  })
  return Array.from(names).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
}

function encodeCommuteMap(map, indexByName) {
  return Object.keys(map || {})
    .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
    .map(key => {
      const [from, to] = parseRouteKey(key)
      return [indexByName.get(from), indexByName.get(to), map[key]]
    })
}

function stringifyMiniappCommute(routes) {
  if (!routes || typeof routes !== 'object') {
    throw new Error('festival data missing commuteRoutes')
  }
  const names = commuteNames(routes)
  const indexByName = new Map(names.map((name, index) => [name, index]))
  const encoded = {
    m: routes.meta || {},
    n: names,
    d: encodeCommuteMap(routes.direct, indexByName),
    t: encodeCommuteMap(routes.transit, indexByName),
    w: encodeCommuteMap(routes.walking, indexByName),
    c: encodeCommuteMap(routes.cycling, indexByName)
  }

  return [
    `const x=${JSON.stringify(encoded)}`,
    'function k(a,b){return x.n[a]+"__"+x.n[b]}function routes(rows){const o={};rows.forEach(e=>{o[k(e[0],e[1])]=e[2]});return o}const direct={};x.d.forEach(e=>{direct[k(e[0],e[1])]=e[2]});module.exports={meta:x.m,direct,transit:routes(x.t),walking:routes(x.w),cycling:routes(x.c)}',
    ''
  ].join('\n')
}

function stringifyWebCommute(routes) {
  if (!routes || typeof routes !== 'object') {
    throw new Error('festival data missing commuteRoutes')
  }
  return `// Generated from ${DEFAULT_INPUT}. Do not edit by hand.\nmodule.exports = ${JSON.stringify(routes, null, 2)}\n`
}

function stringifyJson(data) {
  return `${JSON.stringify(data, null, 2)}\n`
}

async function buildTargetOutput(target, data, payload) {
  if (target.type === 'module') {
    return stringifyModule(data, target.compact)
  }
  if (target.type === 'miniapp-commute') {
    return stringifyMiniappCommute(data.commuteRoutes)
  }
  if (target.type === 'web-commute') {
    return stringifyWebCommute(data.commuteRoutes)
  }
  if (target.type === 'json') {
    return stringifyJson(payload)
  }
  if (target.type === 'gzip-json') {
    return await gzipAsync(stringifyJson(payload), { mtime: 0 })
  }
  throw new Error(`Unknown target type: ${target.type}`)
}

function sameContent(current, output) {
  if (Buffer.isBuffer(output)) {
    return Buffer.isBuffer(current)
      ? current.equals(output)
      : Buffer.from(current).equals(output)
  }
  return String(current) === output
}

async function main() {
  const input = readArg('--input', DEFAULT_INPUT)
  const checkOnly = process.argv.includes('--check')
  const inputPath = path.join(ROOT, input)
  const rawPayload = JSON.parse(await readFile(inputPath, 'utf8'))
  const { payload, data } = unwrapPayload(rawPayload, input)

  let driftCount = 0
  for (const target of TARGETS) {
    const targetPath = path.join(ROOT, target.path)
    const output = await buildTargetOutput(target, data, payload)

    if (checkOnly) {
      let current = null
      try {
        current = await readFile(targetPath)
      } catch (error) {
        driftCount += 1
        console.error(`missing ${target.path}`)
        continue
      }
      if (!sameContent(current, output)) {
        driftCount += 1
        console.error(`drift ${target.path}`)
      } else {
        console.log(`ok ${target.path}`)
      }
      continue
    }

    await mkdir(path.dirname(targetPath), { recursive: true })
    await writeFile(targetPath, output)
    console.log(`wrote ${target.path}`)
  }

  if (driftCount) {
    console.error(`${driftCount} generated data bundle(s) are out of sync. Run node scripts/sync-data-bundles.mjs.`)
    process.exitCode = 1
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
