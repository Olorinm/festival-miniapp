'use client'

import { Analytics as VercelAnalytics } from '@vercel/analytics/next'

function scrubPrivateStats(event) {
  try {
    const url = new URL(event.url)
    if (url.pathname === '/stats' || url.pathname === '/api/events/summary') {
      return null
    }
  } catch (error) {}
  return event
}

export default function Analytics() {
  return <VercelAnalytics beforeSend={scrubPrivateStats} />
}
