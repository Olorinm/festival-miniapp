import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { getEventSummary, isSummaryAuthorized } = require('../../../../lib/event-stats.cjs')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const preferredRegion = 'hkg1'

export async function GET(request) {
  try {
    const url = new URL(request.url)
    if (!isSummaryAuthorized(url.searchParams.get('k'))) {
      return Response.json({
        ok: false,
        error: 'unauthorized'
      }, { status: 401 })
    }
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
