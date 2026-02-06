'use strict'

const mineflayer = require('mineflayer')
const http = require('http')
const fs = require('fs')
const path = require('path')
const MinecraftData = require('minecraft-data')

let mineflayerViewer = null
let viewerLoadError = null

async function loadViewer () {
  if (mineflayerViewer) return mineflayerViewer
  if (viewerLoadError) return null

  try {
    const mod = require('prismarine-viewer')
    mineflayerViewer = mod.mineflayer || (mod.default && mod.default.mineflayer) || mod
    return mineflayerViewer
  } catch (err) {
    if (err && err.code === 'ERR_REQUIRE_ESM') {
      try {
        const mod = await import('prismarine-viewer')
        mineflayerViewer = mod.mineflayer || (mod.default && mod.default.mineflayer) || mod
        return mineflayerViewer
      } catch (err2) {
        viewerLoadError = err2
        return null
      }
    }
    viewerLoadError = err
    return null
  }
}

const args = process.argv.slice(2)
const username = args[0] || process.env.MC_EMAIL
const password = args[1] || process.env.MC_PASSWORD

if (!username) {
  console.error('Usage: node x.js <email> [password]')
  console.error('Or set MC_EMAIL (and optionally MC_PASSWORD) in your environment.')
  process.exit(1)
}

const host = process.env.MC_HOST || 'donutsmp.net'
const version = process.env.MC_VERSION || '1.20.2'
const auth = process.env.MC_AUTH || 'microsoft'
const viewerPort = Number(process.env.VIEWER_PORT || 3007)
const enableViewer = process.env.VIEWER !== '0'
const enableOrders = true
const ordersIntervalMs = Number(process.env.ORDERS_INTERVAL_MS || 60000)
const ordersOpenTimeoutMs = Number(process.env.ORDERS_OPEN_TIMEOUT_MS || 15000)
const searchAllOpenTimeoutMs = Number(process.env.ORDERS_SEARCH_ALL_OPEN_TIMEOUT_MS || Math.max(ordersOpenTimeoutMs * 4, 60000))
const searchAllTimeoutMs = Number(process.env.ORDERS_SEARCH_ALL_TIMEOUT_MS || 300000)
const searchAllRequestTimeoutMs = Number(process.env.ORDERS_SEARCH_ALL_REQUEST_TIMEOUT_MS || 600000)
const searchAllPageDelayMs = Number(process.env.ORDERS_SEARCH_ALL_PAGE_DELAY_MS || 25000)
const ordersCloseDelayMs = Number(process.env.ORDERS_CLOSE_DELAY_MS || 800)
const ordersStartDelayMs = Number(process.env.ORDERS_START_DELAY_MS || 7000)
const ordersHumanDelayMinMs = Number(process.env.ORDERS_HUMAN_DELAY_MIN_MS || 300)
const ordersHumanDelayMaxMs = Number(process.env.ORDERS_HUMAN_DELAY_MAX_MS || 900)
const ordersSchedulerIntervalMs = Number(process.env.ORDERS_SCHEDULER_INTERVAL_MS || 1000)
const ordersApiPort = Number(process.env.ORDERS_API_PORT || 3010)
const ordersAutoTrack = process.env.ORDERS_AUTOTRACK !== '0'
const ordersProductKey = process.env.ORDERS_PRODUCT || 'repeater'
const ordersCommandPrefix = process.env.ORDERS_CMD_PREFIX || `/orders`

const ordersLogPath = path.join(__dirname, 'orders-snapshots.jsonl')
const ordersAllLogPath = path.join(__dirname, 'orders-all.jsonl')
const ordersAliasesPath = path.join(__dirname, 'orders-aliases.json')
const ordersTrackedPath = path.join(__dirname, 'orders-tracked.json')
const alertsPath = path.join(__dirname, 'orders-alerts.json')

const minecraft = MinecraftData(version)
const enchantmentDict = minecraft.enchantmentsArray.reduce((acc, e) => {
  acc[e.displayName] = e.name
  return acc
}, {})

const botOptions = {
  host,
  username,
  auth,
  version
}

if (password && auth !== 'microsoft') {
  botOptions.password = password
} else if (password && auth === 'microsoft') {
  console.warn('Password ignored for microsoft auth. You will be prompted to login with a browser code.')
}

const bot = mineflayer.createBot(botOptions)

let expectOrdersWindow = false
let ordersInFlight = false
let ordersOpenTimeout = null
let schedulerTimer = null
let currentTask = null
let pendingChatMessage = null
let searchAllRequested = false
let searchAllRunning = false
let searchAllRunId = null
let searchAllRunTs = null
let searchAllLastRunTs = null
let searchAllRequestedAt = null
let searchAllStartedAt = null
let alertsConfig = { webhookUrl: '', rules: [] }
let alertLastTriggered = new Map()

const trackedProducts = new Map()
const pendingQueue = []
const pendingSet = new Set()
const orderAliases = new Map()
const trackedOrder = []

loadAliases()
loadTrackedList()
loadAlertsConfig()
loadSearchAllLastRun()

bot.once('spawn', () => {
  console.log(`Spawned on ${host} as ${bot.username} (version ${version}, auth ${auth})`)

  if (enableViewer) {
    startViewerIfEnabled().catch((err) => {
      console.warn('Failed to start prismarine-viewer:', err && err.message ? err.message : err)
    })
  }

  startOrdersApiServer()
  setTimeout(() => {
    const restored = rehydrateTrackedList()
    if (!restored && ordersAutoTrack && ordersProductKey) {
      trackProduct(ordersProductKey, { immediate: true })
    }
    startScheduler()
  }, ordersStartDelayMs)
})

function normalizeProductKey (value) {
  return (value || '')
    .toLowerCase()
    .replace(/["']/g, '')
    .replace(/[^a-z0-9\s_\-]/g, '')
    .trim()
    .replace(/[\s\-]+/g, '_')
}

function sanitizeCommandName (value) {
  return String(value || '').trim().replace(/\s+/g, ' ')
}

function loadAliases () {
  try {
    if (!fs.existsSync(ordersAliasesPath)) return
    const raw = fs.readFileSync(ordersAliasesPath, 'utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return
    for (const [key, command] of Object.entries(parsed)) {
      const normalized = normalizeProductKey(key)
      const cleaned = sanitizeCommandName(command)
      if (normalized && cleaned) {
        orderAliases.set(normalized, cleaned)
      }
    }
  } catch (err) {
    console.warn('Failed to load aliases:', err && err.message ? err.message : err)
  }
}

function loadTrackedList () {
  try {
    if (!fs.existsSync(ordersTrackedPath)) return
    const raw = fs.readFileSync(ordersTrackedPath, 'utf8')
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return
    trackedOrder.length = 0
    for (const entry of parsed) {
      const key = normalizeProductKey(typeof entry === 'string' ? entry : entry?.key)
      if (key && !trackedOrder.includes(key)) {
        trackedOrder.push(key)
      }
    }
  } catch (err) {
    console.warn('Failed to load tracked list:', err && err.message ? err.message : err)
  }
}

function loadAlertsConfig () {
  try {
    if (!fs.existsSync(alertsPath)) return
    const raw = fs.readFileSync(alertsPath, 'utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return
    const webhookUrl = typeof parsed.webhookUrl === 'string' ? parsed.webhookUrl.trim() : ''
    const rules = Array.isArray(parsed.rules) ? parsed.rules.map(normalizeAlertRule).filter(Boolean) : []
    alertsConfig = { webhookUrl, rules }
  } catch (err) {
    console.warn('Failed to load alerts config:', err && err.message ? err.message : err)
  }
}

function loadSearchAllLastRun () {
  try {
    if (!fs.existsSync(ordersAllLogPath)) return
    const raw = fs.readFileSync(ordersAllLogPath, 'utf8')
    const lines = raw.split(/\r?\n/).filter((line) => line.trim() !== '')
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      try {
        const entry = JSON.parse(lines[i])
        const ts = entry.runTs || entry.ts
        if (ts) {
          searchAllLastRunTs = ts
          break
        }
      } catch (err) {
        // ignore
      }
    }
  } catch (err) {
    console.warn('Failed to load last search-all timestamp:', err && err.message ? err.message : err)
  }
}

function saveAlertsConfig () {
  try {
    fs.writeFileSync(alertsPath, JSON.stringify(alertsConfig, null, 2), 'utf8')
  } catch (err) {
    console.warn('Failed to save alerts config:', err && err.message ? err.message : err)
  }
}

function normalizeAlertRule (rule) {
  if (!rule || typeof rule !== 'object') return null
  const productKey = normalizeProductKey(rule.productKey || rule.product || rule.item || '')
  if (!productKey) return null
  const id = typeof rule.id === 'string' && rule.id.trim()
    ? rule.id.trim()
    : `alert_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`
  const toNumber = (value) => {
    if (value == null || value === '') return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return {
    id,
    productKey,
    priceMin: toNumber(rule.priceMin),
    priceMax: toNumber(rule.priceMax),
    qtyMin: toNumber(rule.qtyMin),
    qtyMax: toNumber(rule.qtyMax)
  }
}

function saveTrackedList () {
  try {
    fs.writeFileSync(ordersTrackedPath, JSON.stringify(trackedOrder, null, 2), 'utf8')
  } catch (err) {
    console.warn('Failed to save tracked list:', err && err.message ? err.message : err)
  }
}

function saveAliases () {
  try {
    const payload = Object.fromEntries(orderAliases.entries())
    fs.writeFileSync(ordersAliasesPath, JSON.stringify(payload, null, 2), 'utf8')
  } catch (err) {
    console.warn('Failed to save aliases:', err && err.message ? err.message : err)
  }
}

function setAlias (productKey, commandName) {
  const key = normalizeProductKey(productKey)
  if (!key) return null
  const cleaned = sanitizeCommandName(commandName)
  if (!cleaned) {
    orderAliases.delete(key)
    saveAliases()
    return null
  }
  orderAliases.set(key, cleaned)
  saveAliases()
  const tracked = trackedProducts.get(key)
  if (tracked) tracked.commandName = cleaned
  return cleaned
}

function getAlias (productKey) {
  const key = normalizeProductKey(productKey)
  if (!key) return null
  return orderAliases.get(key) || null
}

function getCommandName (productKey) {
  return getAlias(productKey) || productKey
}

function randomBetween (min, max) {
  const low = Number.isFinite(min) ? min : 0
  const high = Number.isFinite(max) ? max : low
  if (high <= low) return low
  return Math.floor(low + Math.random() * (high - low))
}

function enqueueProduct (productKey) {
  if (!productKey) return
  if (pendingSet.has(productKey)) return
  if (currentTask && currentTask.productKey === productKey) return
  pendingQueue.push(productKey)
  pendingSet.add(productKey)
}

function trackProduct (productKey, options = {}) {
  const key = normalizeProductKey(productKey)
  if (!key) return null

  if (options.commandName) {
    setAlias(key, options.commandName)
  }

  const now = Date.now()
  const existing = trackedProducts.get(key)
  if (!existing) {
    trackedProducts.set(key, {
      key,
      intervalMs: ordersIntervalMs,
      nextRunAt: now,
      lastRunAt: null,
      commandName: getCommandName(key)
    })
    if (!options.restore) {
      if (!trackedOrder.includes(key)) trackedOrder.push(key)
      saveTrackedList()
    }
    enqueueProduct(key)
    return key
  }

  if (options.immediate) {
    existing.nextRunAt = now
    enqueueProduct(key)
  }

  if (!trackedOrder.includes(key)) {
    trackedOrder.push(key)
    saveTrackedList()
  }
  existing.commandName = getCommandName(key)
  return key
}

function untrackProduct (productKey) {
  const key = normalizeProductKey(productKey)
  if (!key) return false
  trackedProducts.delete(key)
  pendingSet.delete(key)
  const idx = pendingQueue.indexOf(key)
  if (idx >= 0) pendingQueue.splice(idx, 1)
  const orderIdx = trackedOrder.indexOf(key)
  if (orderIdx >= 0) trackedOrder.splice(orderIdx, 1)
  saveTrackedList()
  return true
}

function rehydrateTrackedList () {
  if (trackedOrder.length === 0) return false
  trackedOrder.forEach((key, index) => {
    setTimeout(() => {
      trackProduct(key, { immediate: true, restore: true })
    }, index * 1000)
  })
  return true
}

function startScheduler () {
  if (schedulerTimer) return
  schedulerTimer = setInterval(() => {
    schedulerTick()
  }, ordersSchedulerIntervalMs)
  schedulerTick()
}

function schedulerTick () {
  if (searchAllRunning || searchAllRequested) return
  const now = Date.now()
  for (const key of trackedOrder) {
    const entry = trackedProducts.get(key)
    if (!entry) continue
    if (now >= entry.nextRunAt) {
      enqueueProduct(key)
      while (entry.nextRunAt <= now) {
        entry.nextRunAt += entry.intervalMs
      }
    }
  }
  processQueue()
}

function processQueue () {
  if (!enableOrders) return
  if (currentTask || ordersInFlight) return
  if (searchAllRequested && !searchAllRunning) {
    if (searchAllRequestedAt && Date.now() - searchAllRequestedAt > searchAllRequestTimeoutMs) {
      console.warn('Search all request timed out; clearing request.')
      searchAllRequested = false
      searchAllRequestedAt = null
      return
    }
    startSearchAll()
    return
  }
  if (pendingQueue.length === 0) return

  const productKey = pendingQueue.shift()
  pendingSet.delete(productKey)

  currentTask = {
    productKey,
    commandName: getCommandName(productKey),
    startedAt: Date.now()
  }

  issueOrdersCommand(productKey)
}

function issueOrdersCommand (productKey) {
  if (!productKey) {
    finishCurrentTask()
    return
  }
  const commandName = currentTask?.commandName || getCommandName(productKey) || productKey
  const command = `${ordersCommandPrefix} ${commandName}`.trim()
  ordersInFlight = true
  expectOrdersWindow = true
  bot.chat(command)
  console.log(`Sent command: ${command}`)

  if (ordersOpenTimeout) clearTimeout(ordersOpenTimeout)
  ordersOpenTimeout = setTimeout(() => {
    if (ordersInFlight && currentTask?.productKey === productKey) {
      console.log(`Orders window timeout for ${productKey}; will retry on next interval.`)
      ordersInFlight = false
      expectOrdersWindow = false
      finishCurrentTask()
    }
  }, ordersOpenTimeoutMs)
}

function startSearchAll () {
  if (searchAllRunning) return
  searchAllRequested = false
  searchAllRequestedAt = null
  searchAllRunning = true
  searchAllStartedAt = Date.now()
  searchAllRunId = `run_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`
  searchAllRunTs = new Date().toISOString()
  currentTask = { type: 'searchAll', startedAt: Date.now() }
  ordersInFlight = true
  expectOrdersWindow = true
  if (ordersOpenTimeout) {
    clearTimeout(ordersOpenTimeout)
    ordersOpenTimeout = null
  }
  const command = `${ordersCommandPrefix}`.trim()
  bot.chat(command)
  console.log(`Search all orders started: ${command}`)
  ordersOpenTimeout = setTimeout(() => {
    if (searchAllRunning) {
      console.warn('Search all window timeout; aborting.')
      searchAllRunning = false
      searchAllRequested = false
      searchAllRequestedAt = null
      searchAllStartedAt = null
      currentTask = null
      ordersInFlight = false
      expectOrdersWindow = false
      processQueue()
    }
  }, searchAllOpenTimeoutMs)
}

function windowSignature (window) {
  if (!window || !Array.isArray(window.slots)) return ''
  const limit = Math.min(window.slots.length, 54)
  const parts = []
  for (let i = 0; i < limit; i += 1) {
    const item = window.slots[i]
    if (!item) {
      parts.push('empty')
      continue
    }
    parts.push(`${item.name || 'item'}:${item.count ?? 0}:${item.displayName || item.customName || ''}`)
  }
  return parts.join('|')
}

function stripFormatting (value) {
  return String(value || '').replace(/§[0-9A-FK-OR]/gi, '').trim()
}

function getSlotLabel (item) {
  if (!item) return ''
  return stripFormatting(item.displayName || item.customName || '')
}

function getItemLoreText (item) {
  if (!item) return []
  const raw = getLoreLines(item)
  if (!raw || raw.length === 0) return []
  return mapLoreLegacy(raw)
    .map((line) => stripFormatting(typeof line === 'string' ? line : String(line)))
    .filter((line) => line)
}

function slotHasNextLore (slot) {
  if (!slot) return false
  const lore = getItemLoreText(slot)
  return lore.some((line) => {
    const lowered = String(line).toLowerCase()
    return lowered.includes('next page') || lowered.includes('next')
  })
}

function hasNextArrow (window) {
  if (!window || !Array.isArray(window.slots)) return false
  const item = window.slots[53]
  if (!item) return false
  const name = String(item.name || '').toLowerCase()
  const label = getSlotLabel(item).toLowerCase()
  return name.includes('arrow') && (label.includes('next') || slotHasNextLore(item))
}

function hasNextArrowSlot (snapshotSlot, windowItem) {
  const name = String(snapshotSlot?.item?.name || windowItem?.name || '').toLowerCase()
  const label = String(
    snapshotSlot?.item?.displayName ||
    snapshotSlot?.item?.name ||
    getSlotLabel(windowItem) ||
    ''
  ).toLowerCase()
  const lore = Array.isArray(snapshotSlot?.loreText) ? snapshotSlot.loreText : getItemLoreText(windowItem)
  const loreHasNext = lore.some((line) => stripFormatting(line).toLowerCase().includes('next'))
  const isArrow = name.includes('arrow') || label.includes('arrow')
  return loreHasNext && (isArrow || label.includes('next'))
}

function clickNextArrow () {
  try {
    bot.clickWindow(53, 0, 0)
    return true
  } catch (err) {
    console.warn('Failed to click next arrow:', err && err.message ? err.message : err)
    return false
  }
}

function waitForWindowChange (getWindow, previousSignature, timeoutMs = 6000) {
  const start = Date.now()
  return new Promise((resolve) => {
    const check = () => {
      const win = getWindow()
      const signature = windowSignature(win)
      if (signature && signature !== previousSignature) {
        resolve(true)
        return
      }
      if (Date.now() - start >= timeoutMs) {
        resolve(false)
        return
      }
      setTimeout(check, 200)
    }
    setTimeout(check, 200)
  })
}

function delay (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function scanSearchAllPages (window) {
  if (!window) return
  const runId = searchAllRunId
  const runTs = searchAllRunTs
  let page = 1
  let currentWindow = window
  let safety = 0
  const seenSignatures = new Set()

  while (currentWindow && searchAllRunning && safety < 200) {
    if (searchAllStartedAt && Date.now() - searchAllStartedAt > searchAllTimeoutMs) {
      console.warn('Search all exceeded timeout; stopping.')
      break
    }
    const snapshot = dumpWindowSlotsWithMeta(currentWindow, {
      page,
      productKey: '__all__',
      productName: 'All Orders',
      runId,
      runTs,
      mode: 'all',
      recordTo: 'all'
    })
    if (snapshot) {
      logSearchAllSnapshot(snapshot)
    }
    if (!snapshot) break
    const signature = windowSignature(currentWindow)
    if (signature) {
      if (seenSignatures.has(signature)) {
        console.warn('Search all detected repeated page signature; stopping to avoid loop.')
        break
      }
      seenSignatures.add(signature)
    }
    const slot53 = snapshot?.slots ? snapshot.slots[53] : null
    const next = hasNextArrowSlot(slot53, currentWindow?.slots ? currentWindow.slots[53] : null) || hasNextArrow(currentWindow)
    if (!next) {
      const slot = currentWindow?.slots ? currentWindow.slots[53] : null
      const label = getSlotLabel(slot) || 'none'
      const name = slot?.name || 'empty'
      const lore = getItemLoreText(slot).join(' | ')
      console.log(`Search all reached last page (no Next arrow). Slot53: ${name} "${label}"${lore ? ` | ${lore}` : ''}`)
      break
    }
    console.log(`Search all clicking Next (page ${page})`)
    if (!clickNextArrow()) break
    await delay(searchAllPageDelayMs)
    const changed = await waitForWindowChange(() => bot.currentWindow || currentWindow, signature, 6000)
    if (!changed) {
      console.warn('Search all page did not change after clicking Next; stopping.')
      break
    }
    currentWindow = bot.currentWindow || currentWindow
    page += 1
    safety += 1
  }

  searchAllLastRunTs = runTs
  finishSearchAll(currentWindow)
}

function finishSearchAll (window) {
  searchAllRunning = false
  searchAllRunId = null
  searchAllRunTs = null
  searchAllStartedAt = null
  if (ordersOpenTimeout) {
    clearTimeout(ordersOpenTimeout)
    ordersOpenTimeout = null
  }
  if (window) {
    closeOrdersWindow(window)
  }
  currentTask = null
  ordersInFlight = false
  expectOrdersWindow = false
  trySendPendingChat()
  processQueue()
}

function finishCurrentTask () {
  currentTask = null
  ordersInFlight = false
  expectOrdersWindow = false
  if (ordersOpenTimeout) {
    clearTimeout(ordersOpenTimeout)
    ordersOpenTimeout = null
  }

  const delay = randomBetween(ordersHumanDelayMinMs, ordersHumanDelayMaxMs)
  if (delay > 0) {
    setTimeout(processQueue, delay)
  } else {
    processQueue()
  }

  trySendPendingChat()
}

function trySendPendingChat () {
  if (!pendingChatMessage) return
  if (ordersInFlight || currentTask) return
  const message = pendingChatMessage
  pendingChatMessage = null
  try {
    bot.chat(message)
    console.log(`Sent chat: ${message}`)
  } catch (err) {
    console.warn('Failed to send chat message:', err && err.message ? err.message : err)
  }
}

function readJsonBody (req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      if (!body) return resolve({})
      try {
        resolve(JSON.parse(body))
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

function sendJson (res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  })
  res.end(JSON.stringify(payload))
}

function startOrdersApiServer () {
  if (startOrdersApiServer.started) return
  startOrdersApiServer.started = true

  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const url = new URL(req.url, `http://${req.headers.host}`)

    if (url.pathname === '/track' && req.method === 'POST') {
      try {
        const payload = await readJsonBody(req)
        const productKey = normalizeProductKey(payload.productKey || payload.product || '')
        const commandName = payload.commandName || payload.ordersName || payload.command || payload.query || ''
        if (!productKey) {
          sendJson(res, 400, { ok: false, error: 'Missing productKey' })
          return
        }
        const key = trackProduct(productKey, { immediate: true, commandName })
        sendJson(res, 200, { ok: true, productKey: key })
        return
      } catch (err) {
        sendJson(res, 400, { ok: false, error: 'Invalid JSON body' })
        return
      }
    }

    if (url.pathname === '/untrack' && req.method === 'POST') {
      try {
        const payload = await readJsonBody(req)
        const productKey = normalizeProductKey(payload.productKey || payload.product || '')
        if (!productKey) {
          sendJson(res, 400, { ok: false, error: 'Missing productKey' })
          return
        }
        untrackProduct(productKey)
        sendJson(res, 200, { ok: true, productKey })
        return
      } catch (err) {
        sendJson(res, 400, { ok: false, error: 'Invalid JSON body' })
        return
      }
    }

    if (url.pathname === '/alias' && req.method === 'POST') {
      try {
        const payload = await readJsonBody(req)
        const productKey = normalizeProductKey(payload.productKey || payload.product || '')
        const commandName = payload.commandName || payload.ordersName || payload.command || payload.query || ''
        if (!productKey) {
          sendJson(res, 400, { ok: false, error: 'Missing productKey' })
          return
        }
        const alias = setAlias(productKey, commandName)
        sendJson(res, 200, { ok: true, productKey, commandName: alias })
        return
      } catch (err) {
        sendJson(res, 400, { ok: false, error: 'Invalid JSON body' })
        return
      }
    }

    if (url.pathname === '/say' && req.method === 'POST') {
      try {
        const payload = await readJsonBody(req)
        const message = String(payload.message || payload.text || '').trim()
        if (!message) {
          sendJson(res, 400, { ok: false, error: 'Missing message' })
          return
        }
        pendingChatMessage = message.slice(0, 255)
        trySendPendingChat()
        sendJson(res, 200, { ok: true })
        return
      } catch (err) {
        sendJson(res, 400, { ok: false, error: 'Invalid JSON body' })
        return
      }
    }

    if (url.pathname === '/queue' && req.method === 'GET') {
      const tracked = [...trackedOrder]
      const items = tracked
        .map((key) => trackedProducts.get(key))
        .filter(Boolean)
        .map((entry) => ({
          key: entry.key,
          intervalMs: entry.intervalMs,
          nextRunAt: entry.nextRunAt,
          lastRunAt: entry.lastRunAt,
          commandName: entry.commandName || getCommandName(entry.key)
        }))
      sendJson(res, 200, {
        ok: true,
        tracked,
        aliases: Object.fromEntries(orderAliases.entries()),
        items,
        pending: [...pendingQueue],
        current: currentTask ? currentTask.productKey : null
      })
      return
    }

    if (url.pathname === '/search-all' && req.method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        running: searchAllRunning,
        runId: searchAllRunId,
        runTs: searchAllRunTs,
        lastRunTs: searchAllLastRunTs
      })
      return
    }

    if (url.pathname === '/search-all' && req.method === 'POST') {
      if (!searchAllRunning) {
        searchAllRequested = true
        searchAllRequestedAt = Date.now()
        if (!currentTask && !ordersInFlight) {
          startSearchAll()
        }
      }
      sendJson(res, 200, {
        ok: true,
        running: searchAllRunning,
        runId: searchAllRunId,
        runTs: searchAllRunTs,
        lastRunTs: searchAllLastRunTs
      })
      return
    }

    if (url.pathname === '/alerts' && req.method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        webhookUrl: alertsConfig.webhookUrl || '',
        rules: alertsConfig.rules || []
      })
      return
    }

    if (url.pathname === '/alerts' && req.method === 'POST') {
      try {
        const payload = await readJsonBody(req)
        const webhookUrl = typeof payload.webhookUrl === 'string' ? payload.webhookUrl.trim() : ''
        const rules = Array.isArray(payload.rules)
          ? payload.rules.map(normalizeAlertRule).filter(Boolean)
          : []
        alertsConfig = { webhookUrl, rules }
        saveAlertsConfig()
        sendJson(res, 200, { ok: true })
        return
      } catch (err) {
        sendJson(res, 400, { ok: false, error: 'Invalid JSON body' })
        return
      }
    }

    sendJson(res, 404, { ok: false, error: 'Not found' })
  })

  server.listen(ordersApiPort, () => {
    console.log(`Orders API running at http://localhost:${ordersApiPort}`)
  })
}

function closeOrdersWindow (window) {
  try {
    bot.closeWindow(window)
    return
  } catch (err) {
    // fallback below
  }

  if (bot._client && window && typeof window.id === 'number') {
    try {
      bot._client.write('close_window', { windowId: window.id })
    } catch (err) {
      console.warn('Failed to close orders window:', err && err.message ? err.message : err)
    }
  }
}

bot.on('windowOpen', (window) => {
  if (!enableOrders) {
    return
  }

  if (searchAllRunning || currentTask?.type === 'searchAll') {
    expectOrdersWindow = false
    ordersInFlight = false
    if (ordersOpenTimeout) {
      clearTimeout(ordersOpenTimeout)
      ordersOpenTimeout = null
    }
    scanSearchAllPages(window).catch((err) => {
      console.warn('Search all failed:', err && err.message ? err.message : err)
      finishSearchAll(window)
    })
    return
  }

  if (!expectOrdersWindow) {
    return
  }

  expectOrdersWindow = false
  ordersInFlight = false
  if (ordersOpenTimeout) {
    clearTimeout(ordersOpenTimeout)
    ordersOpenTimeout = null
  }
  const productKey = currentTask?.productKey || ordersProductKey
  captureOrdersSnapshot(window, { page: 1, productKey })
  const tracked = trackedProducts.get(productKey)
  if (tracked) {
    tracked.lastRunAt = Date.now()
  }

  const closeDelay = Math.max(ordersCloseDelayMs, 0)
  setTimeout(() => {
    closeOrdersWindow(window)
    finishCurrentTask()
  }, closeDelay)
})

bot.on('kicked', (reason) => {
  console.log('Kicked:', reason)
})

bot.on('error', (err) => {
  console.log('Error:', err)
})

bot.on('end', () => {
  console.log('Disconnected')
})


function captureOrdersSnapshot (window, meta) {
  return dumpWindowSlotsWithMeta(window, meta)
}

function dumpWindowSlots (window) {
  return dumpWindowSlotsWithMeta(window, {})
}

function dumpWindowSlotsWithMeta (window, meta) {
  if (!window || !Array.isArray(window.slots)) {
    return null
  }

  let containerSlots = getContainerSlotCount(window)
  if (meta?.mode === 'all') {
    const maxSlots = Math.min(window.slots.length, 54)
    if (maxSlots > containerSlots) {
      containerSlots = maxSlots
    }
  }

  const slots = []
  for (let i = 0; i < containerSlots; i += 1) {
    const item = window.slots[i]
    const itemInfo = item
      ? {
          name: item.name || null,
          displayName: item.displayName || item.customName || null,
          count: item.count ?? null
        }
      : null

    let order = null
    let loreText = []
    if (item) {
      const rawLore = getLoreLines(item)
      if (rawLore && rawLore.length > 0) {
        loreText = mapLoreLegacy(rawLore).map((line) => (typeof line === 'string' ? line.trim() : String(line).trim()))
      }
    }

    const parsed = parseOrderFromItem(item)
    if (parsed) {
      order = parsed.order
      if (parsed.loreText && parsed.loreText.length > 0) {
        loreText = parsed.loreText
      }
    }

    slots.push({
      slot: i,
      item: itemInfo,
      order,
      loreText
    })
  }

  const snapshot = buildOrdersSnapshot(slots, meta)
  if (meta && meta.recordTo === 'all') {
    recordAllPageSnapshot(snapshot)
  } else {
    recordPageSnapshot(snapshot)
  }
  return snapshot
}

function formatItem (item) {
  if (!item) return 'empty'
  const name = item.name || 'unknown'
  const display = item.displayName && item.displayName !== name ? ` (${item.displayName})` : ''
  const count = item.count != null ? ` x${item.count}` : ''
  return `${name}${display}${count}`
}

function getContainerSlotCount (window) {
  if (window && typeof window.inventoryStart === 'number') {
    return window.inventoryStart
  }

  const type = typeof window?.type === 'string' ? window.type : ''
  const match = /generic_9x(\d)/.exec(type)
  if (match) return 9 * Number(match[1])

  return Array.isArray(window?.slots) ? window.slots.length : 0
}

async function startViewerIfEnabled () {
  const viewer = await loadViewer()
  if (!viewer) {
    if (viewerLoadError) {
      const code = viewerLoadError.code ? ` (${viewerLoadError.code})` : ''
      console.warn(`prismarine-viewer not available${code}: ${viewerLoadError.message}`)
    } else {
      console.warn('prismarine-viewer is not installed. Run: npm install prismarine-viewer')
    }
    return
  }

  if (typeof viewer !== 'function') {
    console.warn('prismarine-viewer loaded but did not export a viewer function.')
    return
  }

  viewer(bot, { port: viewerPort, firstPerson: true })
  console.log(`Viewer running at http://localhost:${viewerPort}`)
}


function getLoreLines (item) {
  if (!item) return []
  if (Array.isArray(item.customLore) && item.customLore.length > 0) return item.customLore

  const lore =
    item.nbt?.value?.display?.value?.Lore?.value?.value ||
    item.nbt?.value?.display?.value?.Lore?.value ||
    null

  return Array.isArray(lore) ? lore : []
}

function mapLoreLegacy (lore) {
  return lore.map((line) => {
    if (typeof line !== 'string') return String(line)
    const trimmed = line.trim()
    if (!trimmed) return ''
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed?.extra)) {
        return parsed.extra.map((e) => e.text || '').join('')
      }
      if (typeof parsed === 'string') return parsed
      if (typeof parsed?.text === 'string') return parsed.text
    } catch (err) {
      // Not JSON, keep as-is.
    }
    return line
  }).flat()
}

const levels = {
  I: 1,
  II: 2,
  III: 3,
  IV: 4,
  V: 5,
  VI: 6,
  VII: 7,
  VIII: 8,
  IX: 9,
  X: 10
}

function mapEnchantmentsLegacy (enchants) {
  const result = []
  for (const enchant of enchants) {
    const parts = enchant.trim().split(' ')
    const last = parts[parts.length - 1]
    const hasLevel = last && Object.prototype.hasOwnProperty.call(levels, last)
    const level = hasLevel ? levels[last] ?? 1 : 1
    const nameOnly = hasLevel ? parts.slice(0, -1).join(' ') : parts.join(' ')
    const mapped = enchantmentDict[nameOnly]
    if (mapped) result.push({ name: mapped, level })
  }
  return result
}

function parseDuration (durationStr) {
  const parts = durationStr.split(' ')
  let ms = 0
  for (const part of parts) {
    if (part.endsWith('d')) ms += parseInt(part, 10) * 86_400_000
    else if (part.endsWith('h')) ms += parseInt(part, 10) * 3_600_000
    else if (part.endsWith('m')) ms += parseInt(part, 10) * 60_000
    else if (part.endsWith('s')) ms += parseInt(part, 10) * 1_000
  }
  return ms
}

function parseCompactNumber (str) {
  const num = parseFloat(str)
  if (str.endsWith('K')) return num * 1_000
  if (str.endsWith('M')) return num * 1_000_000
  if (str.endsWith('B')) return num * 1_000_000_000
  return num
}

function roundDownToInterval (value, intervalMs) {
  return Math.floor(value / intervalMs) * intervalMs
}

function parseOrderFromItem (item) {
  const rawLore = getLoreLines(item)
  if (!rawLore || rawLore.length === 0) return null

  const loreText = mapLoreLegacy(rawLore).map((line) => (typeof line === 'string' ? line.trim() : String(line).trim()))
  const name = item.displayName || item.customName || item.name || 'unknown'

  try {
    const order = parseLore(name, loreText)
    return { order, rawLore, loreText }
  } catch (err) {
    return null
  }
}

function parseLore (name, lore) {
  const priceLineIndex = lore.findIndex((line) => /^\$\d/.test(line))
  const enchantments = mapEnchantmentsLegacy(lore.slice(1, priceLineIndex).filter((line) => line.trim() !== ''))

  const priceLine = lore[priceLineIndex]
  if (!priceLine) throw new Error('No price found in lore')
  const priceRaw = priceLine.split(' ')[0]?.replace('$', '')
  if (!priceRaw) throw new Error('priceRaw is undefined')
  const price = parseCompactNumber(priceRaw)

  const deliveredLine = lore.find((line) => /^[\d.KMB]+\/[\d.KMB]+ Delivered$/.test(line))
  const [deliveredRaw, orderedRaw] = deliveredLine?.split(' Delivered')[0]?.split('/') ?? [undefined, undefined]
  if (!deliveredRaw || !orderedRaw) throw new Error('DeliveredRaw or OrderedRaw is undefined')
  const delivered = Math.floor(parseCompactNumber(deliveredRaw))
  const ordered = Math.floor(parseCompactNumber(orderedRaw))

  const clickLine = lore.find((line) => line.startsWith('Click to deliver '))
  if (!clickLine) throw new Error('Username is undefined')
  const username = clickLine.split(' ')[3]
  if (!username) throw new Error('Username is undefined')

  const durationLine = lore[lore.length - 1]
  if (!durationLine) throw new Error('DurationLine is undefined')
  const duration = durationLine.split(' Until')[0]
  if (!duration) throw new Error('Duration is undefined')
  const expiresAt = roundDownToInterval(Date.now() + parseDuration(duration), 300_000)

  return {
    name,
    enchantments,
    price,
    amountOrdered: ordered,
    amountDelivered: delivered,
    userName: username,
    expiresAt,
    source: 'order'
  }
}

function buildOrdersSnapshot (slots, meta) {
  const nowIso = new Date().toISOString()
  const page = meta && meta.page ? meta.page : 1
  const productKey = meta?.productKey || currentTask?.productKey || ordersProductKey

  const namedSlot = slots.find((s) => s.order?.name) || slots.find((s) => s.item?.displayName)
  const productName = meta?.productName || namedSlot?.order?.name || namedSlot?.item?.displayName || productKey

  const orderSlots = slots.filter((s) => s.order)
  orderSlots.sort((a, b) => {
    if (b.order.price !== a.order.price) return b.order.price - a.order.price
    return b.order.amountOrdered - a.order.amountOrdered
  })

  const maxSlot = orderSlots[0]
  const max = maxSlot
    ? {
        price: maxSlot.order.price,
        amountOrdered: maxSlot.order.amountOrdered,
        amountDelivered: maxSlot.order.amountDelivered,
        slot: maxSlot.slot,
        userName: maxSlot.order.userName
      }
    : null

  const snapshot = {
    ts: nowIso,
    productKey,
    productName,
    page,
    max,
    slots
  }

  if (meta?.runId) snapshot.runId = meta.runId
  if (meta?.runTs) snapshot.runTs = meta.runTs
  if (meta?.mode) snapshot.mode = meta.mode

  return snapshot
}

function recordPageSnapshot (snapshot) {
  if (!snapshot) return
  try {
    fs.appendFileSync(ordersLogPath, JSON.stringify(snapshot) + '\n', 'utf8')
    const size = fs.statSync(ordersLogPath).size
    console.log(`Snapshot saved (${size} bytes)`)
    evaluateAlerts(snapshot)
  } catch (err) {
    console.warn('Failed to write orders log:', err && err.message ? err.message : err)
  }
}

function recordAllPageSnapshot (snapshot) {
  if (!snapshot) return
  try {
    fs.appendFileSync(ordersAllLogPath, JSON.stringify(snapshot) + '\n', 'utf8')
    const size = fs.statSync(ordersAllLogPath).size
    console.log(`All-orders page saved (${size} bytes)`)
  } catch (err) {
    console.warn('Failed to write all-orders log:', err && err.message ? err.message : err)
  }
}

function logSearchAllSnapshot (snapshot) {
  if (!snapshot || !Array.isArray(snapshot.slots)) return
  const pageLabel = snapshot.page != null ? snapshot.page : '?'
  const header = `SearchAll page ${pageLabel} (${snapshot.ts})`
  console.log(header)
  let orderCount = 0
  let controlCount = 0
  let emptyCount = 0
  for (const slot of snapshot.slots) {
    if (!slot?.item) {
      emptyCount += 1
      continue
    }
    const itemName = slot.item.displayName || slot.item.name || 'unknown'
    if (!slot.order) {
      controlCount += 1
      const label = slot.loreText?.join(' | ') || ''
      console.log(`  [slot ${slot.slot}] ${itemName} ${label ? `| ${label}` : ''}`.trim())
      continue
    }
    orderCount += 1
    const user = slot.order.userName || 'unknown'
    const price = slot.order.price ?? 0
    const delivered = slot.order.amountDelivered ?? 0
    const ordered = slot.order.amountOrdered ?? 0
    const totalPaid = price * delivered
    const totalOrder = price * ordered
    console.log(
      `  [slot ${slot.slot}] ${itemName} | user: ${user} | unit: ${formatPriceCompact(price)} | qty: ${formatNumberCompact(delivered)}/${formatNumberCompact(ordered)} | total: ${formatPriceCompact(totalPaid)}/${formatPriceCompact(totalOrder)}`
    )
  }
  console.log(`  Slots: ${snapshot.slots.length} | orders: ${orderCount} | controls: ${controlCount} | empty: ${emptyCount}`)
}

function formatPriceCompact (value) {
  if (!Number.isFinite(value)) return 'n/a'
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`
  return `$${value}`
}

function formatNumberCompact (value) {
  if (!Number.isFinite(value)) return 'n/a'
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return `${value}`
}

function evaluateAlerts (snapshot) {
  if (!snapshot || !snapshot.productKey || !snapshot.max) return
  if (!alertsConfig || !alertsConfig.webhookUrl || !Array.isArray(alertsConfig.rules)) return
  const productKey = snapshot.productKey
  const max = snapshot.max
  const remaining = Math.max((max.amountOrdered || 0) - (max.amountDelivered || 0), 0)
  const price = max.price

  for (const rule of alertsConfig.rules) {
    if (!rule || rule.productKey !== productKey) continue
    if (rule.priceMin != null && price < rule.priceMin) continue
    if (rule.priceMax != null && price > rule.priceMax) continue
    if (rule.qtyMin != null && remaining < rule.qtyMin) continue
    if (rule.qtyMax != null && remaining > rule.qtyMax) continue

    const lastKey = `${rule.id}:${snapshot.ts}`
    if (alertLastTriggered.has(lastKey)) continue
    alertLastTriggered.set(lastKey, Date.now())

    sendAlertWebhook({
      productKey,
      productName: snapshot.productName || productKey,
      price,
      remaining,
      delivered: max.amountDelivered ?? 0,
      ordered: max.amountOrdered ?? 0,
      ts: snapshot.ts
    })
  }
}

async function sendAlertWebhook (payload) {
  const webhookUrl = alertsConfig?.webhookUrl
  if (!webhookUrl) return

  const content = [
    `Order alert: ${payload.productName}`,
    `Price: ${formatPriceCompact(payload.price)}`,
    `Remaining: ${formatNumberCompact(payload.remaining)} (${formatNumberCompact(payload.delivered)}/${formatNumberCompact(payload.ordered)} delivered)`,
    `Snapshot: ${payload.ts}`
  ].join('\n')

  try {
    if (typeof fetch === 'function') {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
      })
    } else {
      console.warn('Fetch not available; alert not sent.')
    }
  } catch (err) {
    console.warn('Failed to send alert webhook:', err && err.message ? err.message : err)
  }
}

