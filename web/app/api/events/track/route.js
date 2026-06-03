import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { trackEvent } = require('../../../../lib/event-stats.cjs')

export const runtime = 'nodejs'
export const preferredRegion = 'hkg1'

export async function POST(request) {
  try {
    const payload = await request.json()
    const result = await trackEvent(payload)
    return Response.json({ ok: true, ...result })
  } catch (error) {
    return Response.json({
      ok: false,
      error: String(error && error.message || error || 'track failed').slice(0, 120)
    }, { status: 400 })
  }
}
