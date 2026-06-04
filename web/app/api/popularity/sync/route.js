import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { syncPopularity } = require('../../../../lib/popularity.cjs')
const { checkRateLimit, rateLimitResponse } = require('../../../../lib/rate-limit.cjs')

export const runtime = 'nodejs'
export const preferredRegion = 'hkg1'

export async function POST(request) {
  try {
    const limit = checkRateLimit(request, 'popularity-sync', { windowMs: 60000, max: 30 })
    if (!limit.ok) return rateLimitResponse(limit)

    const payload = await request.json()
    const result = await syncPopularity(payload)
    return Response.json({ ok: true, ...result })
  } catch (error) {
    return Response.json({
      ok: false,
      error: String(error && error.message || error || 'sync failed').slice(0, 120)
    }, { status: 400 })
  }
}
