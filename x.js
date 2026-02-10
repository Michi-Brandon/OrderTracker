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
const searchAllPageDelayMinMs = Number(process.env.ORDERS_SEARCH_ALL_PAGE_DELAY_MIN_MS || 1000)
const searchAllPageDelayMaxMs = Number(process.env.ORDERS_SEARCH_ALL_PAGE_DELAY_MAX_MS || 2000)
const searchAllStallTimeoutMs = Number(process.env.ORDERS_SEARCH_ALL_STALL_TIMEOUT_MS || 12000)
const ordersCloseDelayMs = Number(process.env.ORDERS_CLOSE_DELAY_MS || 800)
const ordersStartDelayMs = Number(process.env.ORDERS_START_DELAY_MS || 7000)
const ordersHumanDelayMinMs = Number(process.env.ORDERS_HUMAN_DELAY_MIN_MS || 300)
const ordersHumanDelayMaxMs = Number(process.env.ORDERS_HUMAN_DELAY_MAX_MS || 900)
const ordersSchedulerIntervalMs = Number(process.env.ORDERS_SCHEDULER_INTERVAL_MS || 1000)
const ordersApiPort = Number(process.env.ORDERS_API_PORT || 3010)
const ordersAutoTrack = process.env.ORDERS_AUTOTRACK !== '0'
const ordersCommandPrefix = process.env.ORDERS_CMD_PREFIX || `/orders`
const ordersMinMatches = Number(process.env.ORDERS_MIN_MATCHES || 3)
const ordersPageSearchLimit = Number(process.env.ORDERS_PAGE_SEARCH_LIMIT || 6)
const ordersPageDelayMs = Number(process.env.ORDERS_PAGE_DELAY_MS || 1200)
const alertAverageWindowMs = Number(process.env.ALERT_AVG_WINDOW_MS || 86_400_000)
const alertUserCooldownMs = Number(process.env.ALERT_USER_COOLDOWN_MS || 300_000)
const orderSortKeys = new Set([
  'most_paid',
  'most_delivered',
  'recently_listed',
  'most_money_per_item'
])
const defaultOrderConfig = Object.freeze({
  searchAllSort: 'recently_listed',
  trackingSort: 'most_money_per_item'
})

const ordersLogPath = path.join(__dirname, 'orders-snapshots.jsonl')
const ordersAllLogPath = path.join(__dirname, 'orders-all.jsonl')
const ordersAliasesPath = path.join(__dirname, 'orders-aliases.json')
const ordersTrackedPath = path.join(__dirname, 'orders-tracked.json')
const alertsPath = path.join(__dirname, 'orders-alerts.json')
const ordersConfigPath = path.join(__dirname, 'orders-config.json')

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
let searchAllScannerActive = false
let alertsConfig = { webhookUrl: '', rules: [] }
let ordersConfig = {
  searchAllSort: defaultOrderConfig.searchAllSort,
  trackingSort: defaultOrderConfig.trackingSort
}
let alertUserCooldown = new Map()
const priceHistory = new Map()

const trackedProducts = new Map()
const pendingQueue = []
const pendingSet = new Set()
const orderAliases = new Map()
const trackedOrder = []

loadAliases()
loadTrackedList()
loadAlertsConfig()
loadOrderConfig()
loadSearchAllLastRun()
seedPriceHistory()

bot.once('spawn', () => {
  console.log(`Spawned on ${host} as ${bot.username} (version ${version}, auth ${auth})`)

  if (enableViewer) {
    startViewerIfEnabled().catch((err) => {
      console.warn('Failed to start prismarine-viewer:', err && err.message ? err.message : err)
    })
  }

  startOrdersApiServer()
  setTimeout(() => {
    if (ordersAutoTrack) {
      rehydrateTrackedList()
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

function normalizeOrderSortKey (value, fallback) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (orderSortKeys.has(normalized)) return normalized
  const safeFallback = typeof fallback === 'string' ? fallback.trim().toLowerCase() : ''
  return orderSortKeys.has(safeFallback) ? safeFallback : defaultOrderConfig.searchAllSort
}

function loadOrderConfig () {
  try {
    if (!fs.existsSync(ordersConfigPath)) {
      saveOrderConfig()
      return
    }
    const raw = fs.readFileSync(ordersConfigPath, 'utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return
    const searchAllSort = normalizeOrderSortKey(
      parsed.searchAllSort || parsed.searchAll || parsed?.sort?.searchAll,
      defaultOrderConfig.searchAllSort
    )
    const trackingSort = normalizeOrderSortKey(
      parsed.trackingSort || parsed.tracking || parsed?.sort?.tracking,
      defaultOrderConfig.trackingSort
    )
    ordersConfig = { searchAllSort, trackingSort }
  } catch (err) {
    console.warn('Failed to load orders config:', err && err.message ? err.message : err)
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

function saveOrderConfig () {
  try {
    fs.writeFileSync(ordersConfigPath, JSON.stringify(ordersConfig, null, 2), 'utf8')
  } catch (err) {
    console.warn('Failed to save orders config:', err && err.message ? err.message : err)
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

function trackProductOnce (productKey, options = {}) {
  const key = normalizeProductKey(productKey)
  if (!key) return null

  if (options.commandName) {
    setAlias(key, options.commandName)
  }

  enqueueProduct(key)
  processQueue()
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
  searchAllRunning = true
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

function hasNextArrow (window) {
  if (!window || !Array.isArray(window.slots)) return false
  const item = window.slots[53]
  if (!item) return false
  const name = String(item.name || '').toLowerCase()
  const label = getSlotLabel(item).toLowerCase()
  return name.includes('arrow') || label.includes('arrow')
}

function hasNextArrowSlot (snapshotSlot, windowItem) {
  const name = String(snapshotSlot?.item?.name || windowItem?.name || '').toLowerCase()
  const label = String(
    snapshotSlot?.item?.displayName ||
    snapshotSlot?.item?.name ||
    getSlotLabel(windowItem) ||
    ''
  ).toLowerCase()
  return name.includes('arrow') || label.includes('arrow')
}

const sortOptions = [
  { key: 'most_paid', label: 'Most Paid' },
  { key: 'most_delivered', label: 'Most Delivered' },
  { key: 'recently_listed', label: 'Recently Listed' },
  { key: 'most_money_per_item', label: 'Most Money Per Item' }
]
const sortOptionByKey = new Map(sortOptions.map((option) => [option.key, option]))
const defaultSortDelayMinMs = 1000
const defaultSortDelayMaxMs = 2000

function extractTextFromComponent (component) {
  if (component == null) return ''
  if (typeof component === 'string') return component
  let text = ''
  if (typeof component.text === 'string') text += component.text
  if (Array.isArray(component.extra)) {
    for (const part of component.extra) {
      text += extractTextFromComponent(part)
    }
  }
  return text
}

function collectComponentColors (component, colors = []) {
  if (!component || typeof component !== 'object') return colors
  if (typeof component.color === 'string' && component.color.trim() !== '') {
    colors.push(component.color.trim().toLowerCase())
  }
  if (Array.isArray(component.extra)) {
    for (const part of component.extra) {
      collectComponentColors(part, colors)
    }
  }
  return colors
}

function parseLoreColorInfo (rawLine) {
  const rawString = typeof rawLine === 'string' ? rawLine : String(rawLine)
  const legacyCodes = Array.from(rawString.matchAll(/§([0-9a-fk-or])/ig)).map((m) => m[1].toLowerCase())
  let text = stripFormatting(rawString)
  let jsonColors = []

  try {
    const parsed = JSON.parse(rawString)
    text = stripFormatting(extractTextFromComponent(parsed))
    jsonColors = [...new Set(collectComponentColors(parsed))]
  } catch (err) {
    // Not JSON lore; keep legacy color codes.
  }

  return {
    text,
    legacyCodes,
    jsonColors
  }
}

function findSortControlSlot (window) {
  if (!window || !Array.isArray(window.slots)) return null
  const max = Math.min(window.slots.length, 54)
  for (let i = 0; i < max; i += 1) {
    const item = window.slots[i]
    if (!item) continue
    const name = String(item.name || '').toLowerCase()
    const label = getSlotLabel(item).toLowerCase()
    if (name.includes('cauldron') || label.includes('cauldron')) {
      return { index: i, item }
    }
  }
  return null
}

function isWhiteSortColor (value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return false
  return normalized === 'white' || normalized === '#ffffff' || normalized === '#fff' || normalized === 'f'
}

function isLegacyColorCode (code) {
  return /^[0-9a-f]$/i.test(String(code || ''))
}

function isSortLineSelectedByColor (lineInfo) {
  if (!lineInfo) return false
  if (Array.isArray(lineInfo.jsonColors) && lineInfo.jsonColors.length > 0) {
    return lineInfo.jsonColors.some((color) => !isWhiteSortColor(color))
  }
  const legacyColors = (lineInfo.legacyCodes || []).filter(isLegacyColorCode)
  if (legacyColors.length === 0) return false
  const lastColorCode = legacyColors[legacyColors.length - 1].toLowerCase()
  return lastColorCode !== 'f'
}

function getSortState (window) {
  const control = findSortControlSlot(window)
  if (!control) return { controlIndex: null, selectedKey: null, options: [] }
  const loreLines = getLoreLines(control.item)
  if (!loreLines || loreLines.length === 0) {
    return {
      controlIndex: control.index,
      selectedKey: null,
      options: sortOptions.map((option) => ({
        key: option.key,
        label: option.label,
        selected: false,
        lineIndex: -1,
        text: option.label,
        jsonColors: [],
        legacyCodes: []
      }))
    }
  }
  const options = sortOptions.map((option) => ({
    key: option.key,
    label: option.label,
    selected: false,
    lineIndex: -1,
    text: option.label,
    jsonColors: [],
    legacyCodes: []
  }))
  for (let i = 0; i < loreLines.length; i += 1) {
    const lineInfo = parseLoreColorInfo(loreLines[i])
    const lineText = lineInfo.text.toLowerCase()
    for (const option of options) {
      if (!lineText.includes(option.label.toLowerCase())) continue
      option.lineIndex = i
      option.text = lineInfo.text
      option.jsonColors = lineInfo.jsonColors
      option.legacyCodes = lineInfo.legacyCodes
      option.selected = isSortLineSelectedByColor(lineInfo)
      break
    }
  }
  const selected = options.find((option) => option.selected)
  return {
    controlIndex: control.index,
    selectedKey: selected ? selected.key : null,
    options
  }
}

function getConfiguredSortKey (scope) {
  const fallback = scope === 'tracking'
    ? defaultOrderConfig.trackingSort
    : defaultOrderConfig.searchAllSort
  const configured = scope === 'tracking'
    ? ordersConfig.trackingSort
    : ordersConfig.searchAllSort
  return normalizeOrderSortKey(configured, fallback)
}

function clickWindowSlot (slotIndex) {
  try {
    bot.clickWindow(slotIndex, 0, 0)
    return true
  } catch (err) {
    console.warn('Failed to click slot:', err && err.message ? err.message : err)
    return false
  }
}

async function ensureSortOption (window, desiredKey, maxAttempts = 16) {
  const normalizedDesired = normalizeOrderSortKey(desiredKey, defaultOrderConfig.searchAllSort)
  if (!sortOptionByKey.has(normalizedDesired)) {
    return { ok: false, window, reason: 'invalid-sort-key' }
  }
  let currentWindow = window
  let state = getSortState(currentWindow)
  if (!state || state.controlIndex == null) {
    return { ok: false, window: currentWindow, reason: 'sort-control-missing' }
  }
  if (state.selectedKey === normalizedDesired) {
    return { ok: true, window: currentWindow, selectedKey: state.selectedKey }
  }

  let attempts = 0
  const delayMin = Number.isFinite(searchAllPageDelayMinMs) ? searchAllPageDelayMinMs : defaultSortDelayMinMs
  const delayMax = Number.isFinite(searchAllPageDelayMaxMs) ? searchAllPageDelayMaxMs : defaultSortDelayMaxMs

  const clickAndCheck = async () => {
    const controlIndex = state?.controlIndex
    if (!Number.isInteger(controlIndex)) return false
    if (!clickWindowSlot(controlIndex)) return false
    await delay(randomBetween(delayMin, delayMax))
    currentWindow = bot.currentWindow || currentWindow
    state = getSortState(currentWindow)
    attempts += 1
    return true
  }

  if (state.selectedKey && sortOptionByKey.has(state.selectedKey)) {
    const currentIndex = sortOptions.findIndex((option) => option.key === state.selectedKey)
    const desiredIndex = sortOptions.findIndex((option) => option.key === normalizedDesired)
    if (currentIndex >= 0 && desiredIndex >= 0) {
      const plannedClicks = (desiredIndex - currentIndex + sortOptions.length) % sortOptions.length
      for (let i = 0; i < plannedClicks && attempts < maxAttempts; i += 1) {
        const ok = await clickAndCheck()
        if (!ok) {
          return { ok: false, window: currentWindow, reason: 'sort-click-failed' }
        }
        if (state?.selectedKey === normalizedDesired) {
          return { ok: true, window: currentWindow, selectedKey: state.selectedKey }
        }
      }
    }
  }

  while (attempts < maxAttempts) {
    if (state?.selectedKey === normalizedDesired) {
      return { ok: true, window: currentWindow, selectedKey: state.selectedKey }
    }
    const targetState = state?.options?.find((option) => option.key === normalizedDesired)
    if (targetState?.selected) {
      return { ok: true, window: currentWindow, selectedKey: normalizedDesired }
    }
    const ok = await clickAndCheck()
    if (!ok) {
      return { ok: false, window: currentWindow, reason: 'sort-click-failed' }
    }
  }

  return { ok: false, window: currentWindow, reason: 'max-attempts' }
}

function slotMatchesProduct (slot, productKey) {
  if (!slot?.item || !productKey) return false
  const target = normalizeProductKey(productKey)
  const nameKey = normalizeProductKey(slot.item.name || '')
  if (nameKey && nameKey === target) return true
  const displayKey = normalizeProductKey(slot.item.displayName || '')
  if (displayKey && displayKey === target) return true
  return false
}

function countMatchingSlots (snapshot, productKey) {
  if (!snapshot?.slots || !productKey) return 0
  return snapshot.slots.filter((slot) => slotMatchesProduct(slot, productKey)).length
}

async function captureOrdersSnapshotWithPagination (window, meta, options = {}) {
  if (!window) return null
  let currentWindow = window
  let page = meta?.page || 1
  let snapshot = null
  const minMatches = Number.isFinite(options.minMatches) ? options.minMatches : ordersMinMatches
  const maxPages = Number.isFinite(options.maxPages) ? options.maxPages : ordersPageSearchLimit
  let attempts = 0

  while (currentWindow && attempts < maxPages) {
    snapshot = dumpWindowSlotsWithMeta(currentWindow, { ...meta, page, recordTo: 'none' })
    const matches = countMatchingSlots(snapshot, meta?.productKey)
    const slot53 = snapshot?.slots ? snapshot.slots[53] : null
    const next = hasNextArrowSlot(slot53, currentWindow?.slots ? currentWindow.slots[53] : null) || hasNextArrow(currentWindow)
    if (matches >= minMatches || !next) break
    if (!clickNextArrow()) break
    await delay(ordersPageDelayMs)
    const signature = windowSignature(currentWindow)
    const changed = await waitForWindowChange(() => bot.currentWindow || currentWindow, signature, 6000)
    if (!changed) break
    currentWindow = bot.currentWindow || currentWindow
    page += 1
    attempts += 1
  }

  if (snapshot) {
    recordPageSnapshot(snapshot)
  }

  return snapshot
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
  const hasTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0
  return new Promise((resolve) => {
    const check = () => {
      const win = getWindow()
      const signature = windowSignature(win)
      if (signature && signature !== previousSignature) {
        resolve(true)
        return
      }
      if (hasTimeout && Date.now() - start >= timeoutMs) {
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

async function advanceSearchAllPageWithRecovery (currentWindow, page) {
  let attempts = 0

  while (searchAllRunning) {
    attempts += 1
    const signature = windowSignature(currentWindow)
    console.log(`Search all clicking Next (page ${page}, attempt ${attempts})`)
    if (!clickNextArrow()) {
      return { ok: false, window: currentWindow, reason: 'click-failed' }
    }

    const pageDelay = randomBetween(searchAllPageDelayMinMs, searchAllPageDelayMaxMs)
    await delay(pageDelay)
    const changed = await waitForWindowChange(
      () => bot.currentWindow || currentWindow,
      signature,
      searchAllStallTimeoutMs
    )

    if (changed) {
      return { ok: true, window: bot.currentWindow || currentWindow, attempts }
    }

    const latestWindow = bot.currentWindow || currentWindow
    currentWindow = latestWindow
    const stillHasNext = hasNextArrow(currentWindow)
    if (!stillHasNext) {
      return { ok: false, window: currentWindow, reason: 'no-next-arrow', attempts }
    }

    console.warn(
      `Search all stalled on page ${page} for ${searchAllStallTimeoutMs}ms; retrying Next click.`
    )
  }

  return { ok: false, window: currentWindow, reason: 'search-stopped', attempts }
}

async function scanSearchAllPages (window) {
  if (!window) return
  searchAllScannerActive = true
  const runId = searchAllRunId
  const runTs = searchAllRunTs
  let page = 1
  let currentWindow = window

  const desiredSort = getConfiguredSortKey('searchAll')
  const sortResult = await ensureSortOption(currentWindow, desiredSort)
  currentWindow = sortResult.window || currentWindow

  while (currentWindow && searchAllRunning) {
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
    const pageAdvance = await advanceSearchAllPageWithRecovery(currentWindow, page)
    if (!pageAdvance.ok) {
      currentWindow = pageAdvance.window || currentWindow
      if (pageAdvance.reason !== 'no-next-arrow') {
        console.warn(
          `Search all stopped on page ${page} (${pageAdvance.reason || 'unknown'}).`
        )
      }
      break
    }
    currentWindow = pageAdvance.window || currentWindow
    page += 1
  }

  searchAllLastRunTs = runTs
  finishSearchAll(currentWindow)
}

function finishSearchAll (window) {
  searchAllRunning = false
  searchAllRunId = null
  searchAllRunTs = null
  searchAllScannerActive = false
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

    if (url.pathname === '/track-once' && req.method === 'POST') {
      try {
        const payload = await readJsonBody(req)
        const productKey = normalizeProductKey(payload.productKey || payload.product || '')
        const commandName = payload.commandName || payload.ordersName || payload.command || payload.query || ''
        if (!productKey) {
          sendJson(res, 400, { ok: false, error: 'Missing productKey' })
          return
        }
        const key = trackProductOnce(productKey, { commandName })
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

    if (url.pathname === '/order-config' && req.method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        searchAllSort: getConfiguredSortKey('searchAll'),
        trackingSort: getConfiguredSortKey('tracking'),
        options: sortOptions
      })
      return
    }

    if (url.pathname === '/order-config' && req.method === 'POST') {
      try {
        const payload = await readJsonBody(req)
        const nextSearchAllSort = normalizeOrderSortKey(
          payload.searchAllSort || payload.searchAll || payload?.sort?.searchAll,
          getConfiguredSortKey('searchAll')
        )
        const nextTrackingSort = normalizeOrderSortKey(
          payload.trackingSort || payload.tracking || payload?.sort?.tracking,
          getConfiguredSortKey('tracking')
        )
        ordersConfig = {
          searchAllSort: nextSearchAllSort,
          trackingSort: nextTrackingSort
        }
        saveOrderConfig()
        sendJson(res, 200, {
          ok: true,
          searchAllSort: ordersConfig.searchAllSort,
          trackingSort: ordersConfig.trackingSort,
          options: sortOptions
        })
        return
      } catch (err) {
        sendJson(res, 400, { ok: false, error: 'Invalid JSON body' })
        return
      }
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

bot.on('windowOpen', async (window) => {
  if (!enableOrders) {
    return
  }

  if (searchAllRunning || currentTask?.type === 'searchAll') {
    if (searchAllScannerActive) {
      return
    }
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
  const productKey = currentTask?.productKey || ''
  let activeWindow = window
  const trackingSort = getConfiguredSortKey('tracking')
  const sortResult = await ensureSortOption(window, trackingSort)
  activeWindow = sortResult.window || activeWindow
  const sortFallback = !sortResult.ok && trackingSort === 'most_money_per_item'
  await captureOrdersSnapshotWithPagination(activeWindow, {
    page: 1,
    productKey,
    sortByPrice: sortFallback
  }, {
    minMatches: ordersMinMatches,
    maxPages: ordersPageSearchLimit
  })
  const tracked = trackedProducts.get(productKey)
  if (tracked) {
    tracked.lastRunAt = Date.now()
  }

  const closeDelay = Math.max(ordersCloseDelayMs, 0)
  setTimeout(() => {
    closeOrdersWindow(bot.currentWindow || activeWindow || window)
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

  let slots = []
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

  if (meta?.sortByPrice) {
    const orderSlots = slots.filter((slot) => slot.order)
    orderSlots.sort((a, b) => {
      const priceDiff = (b.order?.price || 0) - (a.order?.price || 0)
      if (priceDiff !== 0) return priceDiff
      return (b.order?.amountOrdered || 0) - (a.order?.amountOrdered || 0)
    })
    const rest = slots.filter((slot) => !slot.order)
    slots = [...orderSlots, ...rest]
  }

  const snapshot = buildOrdersSnapshot(slots, meta)
  if (meta && meta.recordTo === 'none') {
    return snapshot
  }
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
  const productKey = meta?.productKey || currentTask?.productKey || ''

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
        userName: maxSlot.order.userName,
        expiresAt: maxSlot.order.expiresAt ?? null,
        enchantments: Array.isArray(maxSlot.order.enchantments) ? maxSlot.order.enchantments : []
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
    updatePriceHistory(snapshot)
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

function updatePriceHistory (snapshot) {
  if (!snapshot?.productKey || !snapshot?.max || !Number.isFinite(snapshot.max.price)) return
  const key = snapshot.productKey
  const ts = new Date(snapshot.ts).getTime()
  if (!Number.isFinite(ts)) return
  const entry = priceHistory.get(key) || []
  entry.push({ ts, price: snapshot.max.price })
  const cutoff = Date.now() - alertAverageWindowMs
  while (entry.length && entry[0].ts < cutoff) {
    entry.shift()
  }
  priceHistory.set(key, entry)
}

function seedPriceHistory () {
  try {
    if (!fs.existsSync(ordersLogPath)) return
    const raw = fs.readFileSync(ordersLogPath, 'utf8')
    const lines = raw.split(/\r?\n/).filter((line) => line.trim() !== '')
    const cutoff = Date.now() - alertAverageWindowMs
    for (const line of lines) {
      try {
        const snapshot = JSON.parse(line)
        if (!snapshot?.productKey || !snapshot?.max || !Number.isFinite(snapshot.max.price)) continue
        const ts = new Date(snapshot.ts).getTime()
        if (!Number.isFinite(ts) || ts < cutoff) continue
        const entry = priceHistory.get(snapshot.productKey) || []
        entry.push({ ts, price: snapshot.max.price })
        priceHistory.set(snapshot.productKey, entry)
      } catch {
        // ignore bad line
      }
    }
  } catch (err) {
    console.warn('Failed to seed price history:', err && err.message ? err.message : err)
  }
}

function getAveragePrice (productKey) {
  if (!productKey) return null
  const entry = priceHistory.get(productKey)
  if (!entry || entry.length === 0) return null
  const sum = entry.reduce((acc, item) => acc + item.price, 0)
  return sum / entry.length
}

function evaluateAlerts (snapshot) {
  if (!snapshot || !snapshot.productKey || !snapshot.max) return
  if (!alertsConfig || !alertsConfig.webhookUrl || !Array.isArray(alertsConfig.rules)) return
  const productKey = snapshot.productKey
  const max = snapshot.max
  const orderedQty = max.amountOrdered || 0
  const deliveredQty = max.amountDelivered || 0
  const remaining = Math.max(orderedQty - deliveredQty, 0)
  const price = max.price
  const avgPrice = getAveragePrice(productKey)
  const userKey = typeof max.userName === 'string' ? max.userName.trim().toLowerCase() : ''
  const now = Date.now()

  for (const [key, expiry] of alertUserCooldown.entries()) {
    if (expiry <= now) alertUserCooldown.delete(key)
  }

  for (const rule of alertsConfig.rules) {
    if (!rule || rule.productKey !== productKey) continue
    if (rule.priceMin != null && price < rule.priceMin) continue
    if (rule.priceMax != null && price > rule.priceMax) continue
    if (rule.qtyMin != null && orderedQty < rule.qtyMin) continue
    if (rule.qtyMax != null && orderedQty > rule.qtyMax) continue

    if (userKey) {
      const cooldownKey = `${rule.id}:${productKey}:${userKey}`
      const cooldownUntil = alertUserCooldown.get(cooldownKey)
      if (cooldownUntil && cooldownUntil > now) continue
      const expiresAt = Number.isFinite(max.expiresAt) ? max.expiresAt : now + alertUserCooldownMs
      alertUserCooldown.set(cooldownKey, expiresAt)
    }

    const totalSale = orderedQty * price
    const diff = avgPrice != null ? price - avgPrice : null
    const potentialGain = diff != null ? diff * orderedQty : null

    sendAlertWebhook({
      productKey,
      productName: snapshot.productName || productKey,
      price,
      remaining,
      delivered: deliveredQty,
      ordered: orderedQty,
      ts: snapshot.ts,
      userName: max.userName || 'unknown',
      avgPrice,
      totalSale,
      potentialGain
    })
  }
}

async function sendAlertWebhook (payload) {
  const webhookUrl = alertsConfig?.webhookUrl
  if (!webhookUrl) return

  const avgLabel = payload.avgPrice != null ? formatPriceCompact(payload.avgPrice) : 'n/a'
  const totalLabel = Number.isFinite(payload.totalSale) ? formatPriceCompact(payload.totalSale) : 'n/a'
  const gainLabel = Number.isFinite(payload.potentialGain)
    ? `${payload.potentialGain >= 0 ? '+' : '-'}${formatPriceCompact(Math.abs(payload.potentialGain))}`
    : 'n/a'

  const content = [
    `Order alert: ${payload.productName}`,
    `User: ${payload.userName}`,
    `Unit: ${formatPriceCompact(payload.price)}`,
    `Qty ordered: ${formatNumberCompact(payload.ordered)} (delivered ${formatNumberCompact(payload.delivered)}, remaining ${formatNumberCompact(payload.remaining)})`,
    `Total sale: ${totalLabel}`,
    `Avg price: ${avgLabel}`,
    `Potential gain vs avg: ${gainLabel}`,
    `Snapshot: ${payload.ts}`
  ].join('\n')

  try {
    if (typeof fetch === 'function') {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
      })
      console.log(`Discord alert sent:\n${content}`)
    } else {
      console.warn('Fetch not available; alert not sent.')
    }
  } catch (err) {
    console.warn('Failed to send alert webhook:', err && err.message ? err.message : err)
  }
}

