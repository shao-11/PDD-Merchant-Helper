;(function () {
  if (window.__dtxAntiHookInstalled) return
  window.__dtxAntiHookInstalled = true

  function push(v, source, url, method, antiParams) {
    if (!v || typeof v !== 'string') return
    try {
      window.postMessage(
        {
          __dtx__: true,
          type: 'dtxAntiContent',
          token: v,
          source: source || 'unknown',
          url: url || '',
          method: method || '',
          antiParams: antiParams || null,
          ts: Date.now(),
        },
        '*',
      )
    } catch (_) {
      /* ignore */
    }
  }

  function pickAntiFromHeaders(headersLike) {
    if (!headersLike) return ''
    if (headersLike instanceof Headers) {
      return headersLike.get('anti-content') || headersLike.get('Anti-Content') || ''
    }
    if (Array.isArray(headersLike)) {
      for (const pair of headersLike) {
        if (!Array.isArray(pair) || pair.length < 2) continue
        if (String(pair[0]).toLowerCase() === 'anti-content') return String(pair[1] || '')
      }
      return ''
    }
    if (typeof headersLike === 'object') {
      for (const key of Object.keys(headersLike)) {
        if (String(key).toLowerCase() === 'anti-content') return String(headersLike[key] || '')
      }
    }
    return ''
  }

  function pickAntiParams(url, bodyText) {
    const out = {}
    try {
      const u = new URL(String(url || ''), window.location.origin)
      for (const [k, v] of u.searchParams.entries()) {
        if (String(k).toLowerCase().includes('anti')) out[k] = v
      }
    } catch (_) {
      /* ignore */
    }
    if (typeof bodyText === 'string' && bodyText) {
      try {
        const parsed = JSON.parse(bodyText)
        if (parsed && typeof parsed === 'object') {
          for (const k of Object.keys(parsed)) {
            if (String(k).toLowerCase().includes('anti')) out[k] = String(parsed[k] ?? '')
          }
        }
      } catch (_) {
        try {
          const params = new URLSearchParams(bodyText)
          for (const [k, v] of params.entries()) {
            if (String(k).toLowerCase().includes('anti')) out[k] = v
          }
        } catch (_) {
          /* ignore */
        }
      }
    }
    return Object.keys(out).length > 0 ? out : null
  }

  function pickAntiFromBody(bodyText) {
    if (typeof bodyText !== 'string' || !bodyText) return ''
    try {
      const parsed = JSON.parse(bodyText)
      if (parsed && typeof parsed === 'object') {
        for (const key of Object.keys(parsed)) {
          const lower = String(key).toLowerCase()
          if (lower === 'anti-content' || lower === 'anti_content' || lower === 'anticontent') {
            return String(parsed[key] || '')
          }
        }
      }
    } catch (_) {
      try {
        const params = new URLSearchParams(bodyText)
        for (const [k, v] of params.entries()) {
          const lower = String(k).toLowerCase()
          if (lower === 'anti-content' || lower === 'anti_content' || lower === 'anticontent') {
            return String(v || '')
          }
        }
      } catch (_) {
        /* ignore */
      }
    }
    return ''
  }

  const hSet = Headers.prototype.set
  Headers.prototype.set = function (name, value) {
    try {
      if (String(name).toLowerCase() === 'anti-content') push(String(value), 'headers.set', '', '', null)
    } catch (_) {
      /* ignore */
    }
    return hSet.call(this, name, value)
  }

  const hAppend = Headers.prototype.append
  Headers.prototype.append = function (name, value) {
    try {
      if (String(name).toLowerCase() === 'anti-content') push(String(value), 'headers.append', '', '', null)
    } catch (_) {
      /* ignore */
    }
    return hAppend.call(this, name, value)
  }

  const nativeFetch = window.fetch
  window.fetch = function (input, init) {
    try {
      const antiFromInit = pickAntiFromHeaders(init?.headers)
      const antiFromReqHeaders = !antiFromInit && input instanceof Request ? pickAntiFromHeaders(input.headers) : ''
      const url = typeof input === 'string' ? input : input?.url || ''
      const method = String(init?.method || (input instanceof Request ? input.method : '') || 'GET')
      const bodyText = typeof init?.body === 'string' ? init.body : ''
      const antiFromBody = pickAntiFromBody(bodyText)
      const anti = antiFromInit || antiFromReqHeaders || antiFromBody
      const antiParams = pickAntiParams(url, bodyText)
      if (anti) push(String(anti), 'fetch', String(url || ''), method, antiParams)
      if (!anti && input instanceof Request) {
        const cloned = input.clone()
        void cloned
          .text()
          .then((txt) => {
            const fromReqBody = pickAntiFromBody(txt)
            if (fromReqBody) {
              push(String(fromReqBody), 'fetch.requestBody', String(url || ''), method, pickAntiParams(url, txt))
            }
          })
          .catch(() => {
            /* ignore */
          })
      }
    } catch (_) {
      /* ignore */
    }
    return nativeFetch.apply(this, arguments)
  }

  const xhrOpen = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function (method, url) {
    try {
      this.__dtxXhrMeta = {
        method: String(method || ''),
        url: String(url || ''),
        body: '',
      }
    } catch (_) {
      /* ignore */
    }
    return xhrOpen.apply(this, arguments)
  }

  const xhrSet = XMLHttpRequest.prototype.setRequestHeader
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    try {
      if (String(name).toLowerCase() === 'anti-content') {
        const url = this.__dtxXhrMeta?.url || ''
        const method = this.__dtxXhrMeta?.method || ''
        const body = this.__dtxXhrMeta?.body || ''
        const antiParams = pickAntiParams(url, body)
        const antiFromBody = pickAntiFromBody(body)
        push(String(value || antiFromBody), 'xhr.setRequestHeader', url, method, antiParams)
      }
    } catch (_) {
      /* ignore */
    }
    return xhrSet.call(this, name, value)
  }

  const xhrSend = XMLHttpRequest.prototype.send
  XMLHttpRequest.prototype.send = function (body) {
    try {
      if (typeof body === 'string') this.__dtxXhrMeta.body = body
      const url = this.__dtxXhrMeta?.url || ''
      const method = this.__dtxXhrMeta?.method || ''
      const anti = pickAntiFromBody(this.__dtxXhrMeta?.body || '')
      if (anti) {
        push(String(anti), 'xhr.sendBody', url, method, pickAntiParams(url, this.__dtxXhrMeta?.body || ''))
      }
    } catch (_) {
      /* ignore */
    }
    return xhrSend.call(this, body)
  }
})()
