import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { getEventSummary } = require('../../../../lib/event-stats.cjs')

export const runtime = 'nodejs'
export const preferredRegion = 'hkg1'

export async function GET(request) {
  try {
    const url = new URL(request.url)
    const result = await getEventSummary({
      festivalId: url.searchParams.get('festivalId'),
      days: url.searchParams.get('days')
    })
    return Response.json({ ok: true, ...result })
  } catch (error) {
    return Response.json({
      ok: false,
      error: String(error && error.message || error || 'summary failed').slice(0, 120)
    }, { status: 400 })
  }
}
