const buckets = globalThis.__festivalApiRateLimit || new Map()
globalThis.__festivalApiRateLimit = buckets

function clientKey(request) {
  const headers = request && request.headers
  const forwarded = headers && headers.get && headers.get('x-forwarded-for')
  const realIp = headers && headers.get && headers.get('x-real-ip')
  const ip = String(forwarded || realIp || '').split(',')[0].trim()
  if (ip) return ip.slice(0, 80)
  const userAgent = headers && headers.get && headers.get('user-agent')
  return `ua:${String(userAgent || 'unknown').slice(0, 120)}`
}

function checkRateLimit(request, name, options) {
  const now = Date.now()
  const windowMs = Math.max(1000, Number(options && options.windowMs) || 60000)
  const max = Math.max(1, Number(options && options.max) || 60)
  const key = `${name}:${clientKey(request)}`
  const cutoff = now - windowMs
  const hits = (buckets.get(key) || []).filter(time => time > cutoff)
  if (hits.length >= max) {
    const retryAfterMs = Math.max(1000, hits[0] + windowMs - now)
    buckets.set(key, hits)
    return {
      ok: false,
      retryAfter: Math.ceil(retryAfterMs / 1000)
    }
  }
  hits.push(now)
  buckets.set(key, hits)

  if (buckets.size > 2000) {
    for (const [bucketKey, values] of buckets.entries()) {
      const active = values.filter(time => time > cutoff)
      if (active.length) buckets.set(bucketKey, active)
      else buckets.delete(bucketKey)
    }
  }

  return { ok: true, retryAfter: 0 }
}

function rateLimitResponse(result) {
  return Response.json({
    ok: false,
    error: 'rate_limited',
    retryAfter: result.retryAfter
  }, {
    status: 429,
    headers: {
      'Retry-After': String(result.retryAfter)
    }
  })
}

module.exports = {
  checkRateLimit,
  rateLimitResponse
}
