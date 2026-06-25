import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { syncWebSnapshotToWechat } = require('../../../../lib/popularity.cjs')
const schedule = require('../../../../lib/schedule.cjs')
const festival = require('../../../../lib/festival.js')
const { checkRateLimit, rateLimitResponse } = require('../../../../lib/rate-limit.cjs')

export const runtime = 'nodejs'
export const preferredRegion = 'hkg1'
export const dynamic = 'force-dynamic'

function authorized(request) {
  const expected = String(process.env.POPULARITY_SYNC_CRON_TOKEN || process.env.CRON_SECRET || '').trim()
  if (!expected) {
    return false
  }
  const header = String(request.headers.get('authorization') || '').trim()
  const token = header.replace(/^Bearer\s+/i, '').trim()
  return token === expected
}

export async function GET(request) {
  try {
    if (!authorized(request)) {
      return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
    }
    const limit = checkRateLimit(request, 'popularity-sync-wechat', { windowMs: 60000, max: 6 })
    if (!limit.ok) return rateLimitResponse(limit)

    const url = new URL(request.url)
    const festivalId = url.searchParams.get('festivalId') || festival.festivalMeta?.name || 'SIFF 2026'
    const force = url.searchParams.get('force') === '1'
    const screenings = schedule.buildScreenings(festival.films || [], {})
    const screeningIds = screenings.map(item => item.id).filter(Boolean)
    const result = await syncWebSnapshotToWechat({
      festivalId,
      screeningIds,
      force
    })
    return Response.json({ ok: !!result.ok, ...result })
  } catch (error) {
    return Response.json({
      ok: false,
      error: String(error && error.message || error || 'sync failed').slice(0, 120)
    }, { status: 500 })
  }
}
