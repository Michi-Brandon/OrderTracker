const chart = document.getElementById('chart')
const ctx = chart.getContext('2d')
const tooltip = document.getElementById('tooltip')
const resultList = document.getElementById('resultList')
const trackButton = document.getElementById('trackButton')
const selectedProductLabel = document.getElementById('selectedProductLabel')
const productTitle = document.getElementById('productTitle')
const productSubtitle = document.getElementById('productSubtitle')
const rangeControls = document.getElementById('rangeControls')
const searchInput = document.getElementById('search')
const snapshotMeta = document.getElementById('snapshotMeta')
const grid = document.getElementById('grid')
const gridMeta = document.getElementById('gridMeta')
const chartLegend = document.getElementById('chartLegend')
const botApiBase = window.BOT_API || 'http://localhost:3010'
const trackedList = document.getElementById('trackedList')
const searchAllSortSelect = document.getElementById('searchAllSortSelect')
const trackingSortSelect = document.getElementById('trackingSortSelect')
const orderConfigStatus = document.getElementById('orderConfigStatus')
const craftSummary = document.getElementById('craftSummary')
const craftList = document.getElementById('craftList')
const variantPicker = document.getElementById('variantPicker')
const variantPickerButton = document.getElementById('variantPickerButton')
const variantPickerMenu = document.getElementById('variantPickerMenu')
const trackAliasInput = document.getElementById('trackAliasInput')
const chatMessageInput = document.getElementById('chatMessageInput')
const chatSendButton = document.getElementById('chatSendButton')
const chartModeControls = document.getElementById('chartModeControls')
const searchAllButton = document.getElementById('searchAllButton')
const searchAllStatus = document.getElementById('searchAllStatus')
const snapshotPanel = document.getElementById('snapshotPanel')
const groupedList = document.getElementById('groupedList')
const groupedMeta = document.getElementById('groupedMeta')
const groupedView = document.getElementById('groupedView')
const groupedChart = document.getElementById('groupedChart')
const groupedChartCtx = groupedChart ? groupedChart.getContext('2d') : null
const groupedChartLegend = document.getElementById('groupedChartLegend')
const groupedSearchInput = document.getElementById('groupedSearch')
const groupedSearchResults = document.getElementById('groupedSearchResults')
const productView = document.getElementById('productView')
const marginsView = document.getElementById('marginsView')
const marginsHoursInput = document.getElementById('marginsHours')
const marginsSearchInput = document.getElementById('marginsSearch')
const marginsSearchResults = document.getElementById('marginsSearchResults')
const marginsUpdateNotice = document.getElementById('marginsUpdateNotice')
const marginsList = document.getElementById('marginsList')
const tabs = Array.from(document.querySelectorAll('[data-tab]'))
const alertsWebhookInput = document.getElementById('alertsWebhook')
const alertsList = document.getElementById('alertsList')
const addAlertButton = document.getElementById('addAlertButton')
const alertsTabs = Array.from(document.querySelectorAll('[data-alert-tab]'))
const alertsProductView = document.getElementById('alertsProductView')
const alertsTotalView = document.getElementById('alertsTotalView')
const alertsApiView = document.getElementById('alertsApiView')
const alertsListAll = document.getElementById('alertsListAll')
const confirmAlertsButtons = Array.from(document.querySelectorAll('[data-alert-confirm]'))
const itemsDatalist = document.getElementById('itemsDatalist')

let snapshots = []
let chartPoints = []
let chartSnapshots = []
let chartOutlierBoxes = []
let hoverIndex = null
let activeIndex = null
let itemsCatalog = []
let selectedProduct = null
let activeSnapshot = null
let activeSnapshotLocked = false
let timeRangeMs = null
let trackedKeys = new Set()
let trackedItems = []
let activeRecipe = null
let aliasMap = new Map()
let chartMode = 'snapshot'
let allPages = []
let groupedRuns = []
let latestGroupedRun = null
let groupedOrdersByItem = new Map()
let groupedItemCounts = new Map()
let groupedOrdersByVariant = new Map()
let groupedVariantsByBase = new Map()
let groupedVariantMetaByBase = new Map()
let trackedOrdersByVariant = new Map()
let trackedVariantsByBase = new Map()
let selectedVariantOptions = []
let loadingAllPages = false
let marginsHours = 24
let marginRowsCache = []
let marginTrackingPendingKeys = new Set()
let marginMoveNotice = null
let transientTrackEntries = []
let alertsConfig = { webhookUrl: '', rules: [] }
let alertsTab = 'product'
let activeTab = 'product'
let recipeCache = new Map()
const orderSortOptionsDefault = [
  { key: 'most_paid', label: 'Most Paid' },
  { key: 'most_delivered', label: 'Most Delivered' },
  { key: 'recently_listed', label: 'Recently Listed' },
  { key: 'most_money_per_item', label: 'Most Money Per Item' }
]
let orderSortOptions = [...orderSortOptionsDefault]
let orderConfig = {
  searchAllSort: 'recently_listed',
  trackingSort: 'most_money_per_item'
}

/*
 * Tarea: centralizar llamadas POST JSON al API del bot.
 * Input: nombre del endpoint y payload.
 * Output: objeto Response de fetch.
 * Uso: tracking, aliases, alertas, chat y config de orden.
 */
function postBotJson (endpoint, payload = {}) {
  return fetch(`${botApiBase}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
}

/*
 * Tarea: mantener consistente el comportamiento de alias input.
 * Input: elemento input y productKey.
 * Output: sin retorno (registra listeners del DOM).
 * Uso: lista tracked y filas de craft para evitar listeners duplicados.
 */
function bindAliasInputEvents (aliasInput, productKey) {
  if (!aliasInput || !productKey) return
  aliasInput.addEventListener('click', (event) => {
    event.stopPropagation()
  })
  aliasInput.addEventListener('change', () => {
    applyAlias(productKey, aliasInput.value)
  })
  aliasInput.addEventListener('keydown', (event) => {
    event.stopPropagation()
    if (event.key === 'Enter') {
      event.preventDefault()
      aliasInput.blur()
    }
  })
}

/*
 * Tarea: encolar tracking de enchanted_book desde acciones UI compartidas.
 * Input: `once` boolean y contexto opcional (anchor/highlights).
 * Output: Promise de trackProductsBatch.
 * Uso: acciones de craft y margenes.
 */
function queueBookTracking (once, options = {}) {
  const anchorKey = String(options.anchorKey || selectedProduct?.key || 'enchanted_book')
  return trackProductsBatch(['enchanted_book'], {
    ...options,
    once: Boolean(once),
    anchorKey
  })
}

/*
 * Tarea: conectar botones "Track once/always" para enchanted books.
 * Input: nodo raiz DOM + selectores + anchor key.
 * Output: sin retorno (registra listeners del DOM).
 * Uso: resumen de craft y controles por fila.
 */
function bindBookTrackingButtons (root, options = {}) {
  if (!root) return
  const onceSelector = options.onceSelector || '[data-book-action="once"]'
  const alwaysSelector = options.alwaysSelector || '[data-book-action="always"]'
  const anchorKey = String(options.anchorKey || selectedProduct?.key || 'enchanted_book')
  const onceButton = root.querySelector(onceSelector)
  const alwaysButton = root.querySelector(alwaysSelector)

  if (onceButton) {
    onceButton.addEventListener('click', (event) => {
      event.stopPropagation()
      queueBookTracking(true, { anchorKey })
    })
  }
  if (alwaysButton) {
    alwaysButton.addEventListener('click', (event) => {
      event.stopPropagation()
      queueBookTracking(false, { anchorKey })
    })
  }
}

// Grupo de tarea: formato, parse helpers y controles UI de order-config.
function formatPrice (value) {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`
  return `$${value}`
}

function formatNumber (value) {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return `${value}`
}

function formatTime (ts) {
  const date = new Date(ts)
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatAxisTime (ts) {
  const date = new Date(ts)
  return date.toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function formatDateTime (ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString()
}

function parseNumberOrNull (value) {
  if (value == null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeSortKey (value, fallback) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (orderSortOptions.some((option) => option.key === normalized)) return normalized
  return fallback
}

function setOrderConfigStatus (message, isError = false) {
  if (!orderConfigStatus) return
  orderConfigStatus.textContent = message || ''
  orderConfigStatus.style.color = isError ? '#fca5a5' : ''
}

function renderOrderConfigSelectors () {
  const selectors = [searchAllSortSelect, trackingSortSelect]
  selectors.forEach((selectEl) => {
    if (!selectEl) return
    const current = selectEl.value
    selectEl.innerHTML = orderSortOptions
      .map((option) => `<option value="${option.key}">${option.label}</option>`)
      .join('')
    if (current) {
      selectEl.value = normalizeSortKey(current, orderSortOptions[0]?.key || '')
    }
  })

  if (searchAllSortSelect) {
    searchAllSortSelect.value = normalizeSortKey(
      orderConfig.searchAllSort,
      'recently_listed'
    )
  }
  if (trackingSortSelect) {
    trackingSortSelect.value = normalizeSortKey(
      orderConfig.trackingSort,
      'most_money_per_item'
    )
  }
}

async function loadOrderConfig () {
  if (!searchAllSortSelect || !trackingSortSelect) return
  try {
    const res = await fetch(`${botApiBase}/order-config`)
    if (!res.ok) throw new Error('Order config unavailable')
    const data = await res.json()
    const options = Array.isArray(data.options) && data.options.length > 0
      ? data.options
      : orderSortOptionsDefault
    orderSortOptions = options
      .map((option) => ({
        key: option.key,
        label: option.label
      }))
      .filter((option) => option.key && option.label)
    if (orderSortOptions.length === 0) {
      orderSortOptions = [...orderSortOptionsDefault]
    }
    orderConfig = {
      searchAllSort: normalizeSortKey(data.searchAllSort, 'recently_listed'),
      trackingSort: normalizeSortKey(data.trackingSort, 'most_money_per_item')
    }
    renderOrderConfigSelectors()
    setOrderConfigStatus('Order configuration loaded')
  } catch (err) {
    orderSortOptions = [...orderSortOptionsDefault]
    orderConfig = {
      searchAllSort: 'recently_listed',
      trackingSort: 'most_money_per_item'
    }
    renderOrderConfigSelectors()
    setOrderConfigStatus('Order configuration unavailable', true)
  }
}

async function saveOrderConfig () {
  if (!searchAllSortSelect || !trackingSortSelect) return
  const payload = {
    searchAllSort: normalizeSortKey(searchAllSortSelect.value, orderConfig.searchAllSort),
    trackingSort: normalizeSortKey(trackingSortSelect.value, orderConfig.trackingSort)
  }
  try {
    setOrderConfigStatus('Saving order configuration...')
    const res = await postBotJson('order-config', payload)
    if (!res.ok) throw new Error('Failed to save')
    const data = await res.json()
    orderConfig = {
      searchAllSort: normalizeSortKey(data.searchAllSort, payload.searchAllSort),
      trackingSort: normalizeSortKey(data.trackingSort, payload.trackingSort)
    }
    renderOrderConfigSelectors()
    setOrderConfigStatus('Order configuration saved')
  } catch (err) {
    setOrderConfigStatus('Failed to save order configuration', true)
  }
}


function initSidebarSections () {
  const sections = Array.from(document.querySelectorAll('.sidebar-section'))
  let dragged = null

  const setCollapsed = (section, collapsed) => {
    section.classList.toggle('collapsed', collapsed)
    section.setAttribute('draggable', collapsed ? 'true' : 'false')
  }

  for (const section of sections) {
    const header = section.querySelector('.section-header')
    const body = section.querySelector('.section-body')
    setCollapsed(section, false)

    if (body) {
      const key = `sidebarSectionHeight:${section.dataset.section || 'default'}`
      const saved = localStorage.getItem(key)
      if (saved) {
        body.style.height = saved
      }

      const storeHeight = () => {
        if (section.classList.contains('collapsed')) return
        const height = Math.round(body.getBoundingClientRect().height)
        if (height > 0) {
          localStorage.setItem(key, `${height}px`)
        }
      }

      if (window.ResizeObserver) {
        const observer = new ResizeObserver(() => {
          storeHeight()
        })
        observer.observe(body)
      } else {
        body.addEventListener('mouseup', storeHeight)
      }
    }

    if (header) {
      header.addEventListener('click', () => {
        if (section.dataset.ignoreClick === '1') return
        const collapsed = section.classList.contains('collapsed')
        setCollapsed(section, !collapsed)
      })
    }

    section.addEventListener('dragstart', (event) => {
      if (!section.classList.contains('collapsed')) {
        event.preventDefault()
        return
      }
      dragged = section
      section.classList.add('dragging')
      section.dataset.ignoreClick = '1'
      event.dataTransfer.effectAllowed = 'move'
    })

    section.addEventListener('dragend', () => {
      section.classList.remove('dragging')
      dragged = null
      setTimeout(() => {
        section.dataset.ignoreClick = '0'
      }, 50)
    })

    section.addEventListener('dragover', (event) => {
      if (!dragged || dragged === section) return
      event.preventDefault()
      const rect = section.getBoundingClientRect()
      const after = event.clientY - rect.top > rect.height / 2
      const parent = section.parentElement
      if (after) parent.insertBefore(dragged, section.nextSibling)
      else parent.insertBefore(dragged, section)
    })
  }
}

// Grupo de tarea: normalizacion de items y modelo de variantes grouped/tracked.
function normalizeItemKey (value) {
  return (value || '')
    .toLowerCase()
    .replace(/^minecraft:/, '')
    .replace(/["']/g, '')
    .replace(/[^a-z0-9\s_\-]/g, '')
    .trim()
    .replace(/[\s\-]+/g, '_')
}

function getItemKey (item) {
  if (!item) return ''
  return normalizeItemKey(item.name || item.displayName || '')
}

const romanLevelsMap = {
  1: 'I',
  2: 'II',
  3: 'III',
  4: 'IV',
  5: 'V',
  6: 'VI',
  7: 'VII',
  8: 'VIII',
  9: 'IX',
  10: 'X'
}

function toRomanLevel (level) {
  const normalized = Number(level)
  if (!Number.isFinite(normalized) || normalized <= 0) return 'I'
  return romanLevelsMap[normalized] || `${Math.round(normalized)}`
}

function formatEnchantName (name) {
  const cleaned = String(name || '')
    .trim()
    .replace(/^minecraft:/, '')
    .replace(/[_\-]+/g, ' ')
  if (!cleaned) return 'Unknown'
  return cleaned
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function normalizeEnchantments (enchantments) {
  if (!Array.isArray(enchantments)) return []
  const list = enchantments
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const name = normalizeItemKey(entry.name || entry.id || '')
      if (!name) return null
      const levelRaw = Number(entry.level)
      const level = Number.isFinite(levelRaw) && levelRaw > 0 ? Math.floor(levelRaw) : 1
      return { name, level }
    })
    .filter(Boolean)
  list.sort((a, b) => {
    const nameDiff = a.name.localeCompare(b.name)
    if (nameDiff !== 0) return nameDiff
    return a.level - b.level
  })
  return list
}

function buildEnchantSignature (enchantments) {
  const normalized = normalizeEnchantments(enchantments)
  if (normalized.length === 0) return ''
  return normalized.map((entry) => `${entry.name}:${entry.level}`).join('|')
}

function buildVariantKey (baseKey, signature = '') {
  const itemKey = normalizeItemKey(baseKey)
  if (!itemKey) return ''
  const enchSig = String(signature || '').trim()
  return enchSig ? `${itemKey}::${enchSig}` : `${itemKey}::plain`
}

function getVariantSignatureFromOrder (order) {
  if (!order || typeof order !== 'object') return ''
  return buildEnchantSignature(order.enchantments || [])
}

function getVariantEnchantmentsFromOrder (order) {
  if (!order || typeof order !== 'object') return []
  return normalizeEnchantments(order.enchantments || [])
}

function formatEnchantmentsCompact (enchantments, maxVisible = 2) {
  const list = normalizeEnchantments(enchantments)
  if (list.length === 0) return 'Unenchanted'
  const entries = list.map((entry) => `${formatEnchantName(entry.name)} ${toRomanLevel(entry.level)}`)
  if (entries.length <= maxVisible) return entries.join(', ')
  const shown = entries.slice(0, maxVisible).join(', ')
  return `${shown}, +${entries.length - maxVisible}`
}

function formatVariantDisplayName (baseName, enchantments) {
  const cleanBase = baseName || 'Unknown'
  const summary = formatEnchantmentsCompact(enchantments, 2)
  return summary === 'Unenchanted' ? `${cleanBase} (Unenchanted)` : `${cleanBase} (${summary})`
}

function getSlotVariantInfo (slot) {
  if (!slot?.item || !slot?.order) return null
  const baseKey = normalizeItemKey(slot.item.name || '')
  if (!baseKey) return null
  const enchantments = getVariantEnchantmentsFromOrder(slot.order)
  const signature = buildEnchantSignature(enchantments)
  return {
    baseKey,
    signature,
    enchantments,
    variantKey: buildVariantKey(baseKey, signature),
    isEnchanted: enchantments.length > 0
  }
}

function slotMatchesVariant (slot, signature) {
  const target = String(signature || '')
  if (!slot?.order) return target === ''
  return getVariantSignatureFromOrder(slot.order) === target
}

function itemIconUrl (item) {
  const key = getItemKey(item)
  if (!key) return '/item-placeholder.svg'
  return `/item/${encodeURIComponent(key)}.png`
}

function matchesQuery (textValue, tokens) {
  const lower = (textValue || '').toLowerCase()
  return tokens.every((token) => {
    if (lower.includes(token)) return true
    if (token.endsWith('s') && lower.includes(token.slice(0, -1))) return true
    return false
  })
}

function slotMatchesKey (slot, key) {
  if (!key) return true
  if (!slot?.item) return false
  const target = normalizeItemKey(key)
  const itemKey = normalizeItemKey(slot.item.name || '')
  if (itemKey && itemKey === target) return true
  const displayKey = normalizeItemKey(slot.item.displayName || '')
  if (displayKey && displayKey === target) return true
  return false
}

function slotMatchesSelected (slot) {
  if (!slotMatchesKey(slot, selectedProduct?.key)) return false
  const signature = selectedProduct?.variantSignature
  if (signature == null) return true
  return slotMatchesVariant(slot, signature)
}

function collectItems (snapshot, maxSlots) {
  const slots = snapshot?.slots || []
  const items = new Map()

  for (const slot of slots) {
    if (maxSlots != null && slot.slot >= maxSlots) continue
    if (!slot.item) continue

    const key = getItemKey(slot.item)
    if (!key) continue

    const displayName = slot.item.displayName || slot.item.name || key
    const entry = items.get(key) || { key, name: displayName, count: 0 }
    entry.count += 1
    items.set(key, entry)
  }

  return Array.from(items.values()).sort((a, b) => a.name.localeCompare(b.name))
}

const timeRanges = [
  { label: '8h', ms: 8 * 60 * 60 * 1000 },
  { label: '12h', ms: 12 * 60 * 60 * 1000 },
  { label: '24h', ms: 24 * 60 * 60 * 1000 },
  { label: '2d', ms: 2 * 24 * 60 * 60 * 1000 },
  { label: '1w', ms: 7 * 24 * 60 * 60 * 1000 },
  { label: 'All', ms: null }
]

timeRangeMs = timeRangeMs ?? timeRanges[2].ms

function getFilteredSnapshots () {
  let filtered = Array.isArray(snapshots) ? snapshots : []
  if (selectedProduct?.key) {
    filtered = filtered.filter((snap) => snap.productKey === selectedProduct.key)
  }
  if (timeRangeMs) {
    const cutoff = Date.now() - timeRangeMs
    filtered = filtered.filter((snap) => new Date(snap.ts).getTime() >= cutoff)
  }
  return filtered
}

function pickBestOrder (orders) {
  if (!orders || orders.length === 0) return null
  let best = null
  for (const order of orders) {
    const remaining = Math.max((order.amountOrdered || 0) - (order.amountDelivered || 0), 0)
    const score = (order.price || 0) * Math.max(remaining, 1)
    if (!best || score > best.score) {
      best = {
        price: order.price || 0,
        amountOrdered: order.amountOrdered || 0,
        amountDelivered: order.amountDelivered || 0,
        remaining,
        userName: order.userName || '',
        score
      }
    }
  }
  return best
}

function addVariantRecord (targetMap, baseKey, signature, record) {
  const normalizedKey = normalizeItemKey(baseKey)
  if (!normalizedKey) return
  const sig = String(signature || '')
  const byBase = targetMap.get(normalizedKey) || new Map()
  const list = byBase.get(sig) || []
  list.push(record)
  byBase.set(sig, list)
  targetMap.set(normalizedKey, byBase)
}

function buildTrackedIndexes () {
  const byVariant = new Map()
  const byBase = new Map()
  for (const snapshot of snapshots || []) {
    if (!snapshot?.slots || !Array.isArray(snapshot.slots)) continue
    for (const slot of snapshot.slots) {
      if (!slot?.order || !slot?.item) continue
      const variantInfo = getSlotVariantInfo(slot)
      if (!variantInfo) continue
      const priceRaw = Number(slot.order.price)
      const price = Number.isFinite(priceRaw) ? priceRaw : null
      if (price == null) continue
      const amountOrderedRaw = Number(slot.order.amountOrdered)
      const amountDeliveredRaw = Number(slot.order.amountDelivered)
      const amountOrdered = Number.isFinite(amountOrderedRaw) ? amountOrderedRaw : 0
      const amountDelivered = Number.isFinite(amountDeliveredRaw) ? amountDeliveredRaw : 0
      const record = {
        key: variantInfo.baseKey,
        signature: variantInfo.signature,
        variantKey: variantInfo.variantKey,
        enchantments: variantInfo.enchantments,
        name: slot.item.displayName || slot.item.name || variantInfo.baseKey,
        ts: snapshot.ts,
        source: 'tracked',
        page: Number(snapshot.page) || 1,
        slot: Number.isFinite(Number(slot.slot)) ? Number(slot.slot) : null,
        userName: slot.order.userName || '—',
        price,
        amountOrdered,
        amountDelivered,
        totalOrdered: price * amountOrdered,
        totalDelivered: price * amountDelivered
      }
      const variantBucket = byVariant.get(variantInfo.variantKey) || []
      variantBucket.push(record)
      byVariant.set(variantInfo.variantKey, variantBucket)
      addVariantRecord(byBase, variantInfo.baseKey, variantInfo.signature, record)
    }
  }
  trackedOrdersByVariant = byVariant
  trackedVariantsByBase = byBase
}

function buildGroupedRuns () {
  const runsMap = new Map()
  const ordersByItem = new Map()
  const ordersByVariant = new Map()
  const countsByItem = new Map()
  const variantsByBaseMeta = new Map()
  for (const page of allPages || []) {
    if (!page || !page.ts) continue
    const runId = page.runId || page.runTs || page.ts
    const runTs = page.runTs || page.ts
    if (!runId) continue
    const run = runsMap.get(runId) || {
      runId,
      ts: runTs,
      items: new Map(),
      pages: 0
    }
    run.pages += 1
    if (runTs && new Date(runTs).getTime() > new Date(run.ts).getTime()) {
      run.ts = runTs
    }

    const slots = page.slots || []
    for (const slot of slots) {
      if (!slot?.order || !slot?.item) continue
      const variantInfo = getSlotVariantInfo(slot)
      if (!variantInfo) continue
      const key = variantInfo.baseKey
      const signature = variantInfo.signature
      const variantKey = variantInfo.variantKey
      const pageTs = page.ts || runTs || null
      const amountOrderedRaw = Number(slot.order.amountOrdered)
      const amountDeliveredRaw = Number(slot.order.amountDelivered)
      const amountOrdered = Number.isFinite(amountOrderedRaw) ? amountOrderedRaw : 0
      const amountDelivered = Number.isFinite(amountDeliveredRaw) ? amountDeliveredRaw : 0
      const priceRaw = Number(slot.order.price)
      const price = Number.isFinite(priceRaw) ? priceRaw : null
      const entry = run.items.get(variantKey) || {
        key,
        signature,
        variantKey,
        enchantments: variantInfo.enchantments,
        name: slot.item.displayName || slot.item.name || key,
        orders: []
      }
      entry.orders.push({
        price: price ?? 0,
        amountOrdered,
        amountDelivered,
        userName: slot.order.userName
      })
      run.items.set(variantKey, entry)

      if (price != null) {
        const bucket = ordersByItem.get(key) || []
        bucket.push({
          key,
          signature,
          variantKey,
          enchantments: variantInfo.enchantments,
          name: slot.item.displayName || slot.item.name || key,
          ts: pageTs,
          runId,
          page: Number(page.page) || 1,
          slot: Number.isFinite(Number(slot.slot)) ? Number(slot.slot) : null,
          userName: slot.order.userName || '—',
          price,
          amountOrdered,
          amountDelivered,
          totalOrdered: price * amountOrdered,
          totalDelivered: price * amountDelivered
        })
        ordersByItem.set(key, bucket)
        const variantBucket = ordersByVariant.get(variantKey) || []
        variantBucket.push({
          key,
          signature,
          variantKey,
          enchantments: variantInfo.enchantments,
          name: slot.item.displayName || slot.item.name || key,
          ts: pageTs,
          runId,
          page: Number(page.page) || 1,
          slot: Number.isFinite(Number(slot.slot)) ? Number(slot.slot) : null,
          userName: slot.order.userName || '—',
          price,
          amountOrdered,
          amountDelivered,
          totalOrdered: price * amountOrdered,
          totalDelivered: price * amountDelivered
        })
        ordersByVariant.set(variantKey, variantBucket)
        countsByItem.set(key, (countsByItem.get(key) || 0) + 1)

        const byBaseMeta = variantsByBaseMeta.get(key) || new Map()
        if (!byBaseMeta.has(signature)) {
          byBaseMeta.set(signature, {
            key,
            signature,
            variantKey,
            enchantments: variantInfo.enchantments,
            name: slot.item.displayName || slot.item.name || key
          })
        }
        variantsByBaseMeta.set(key, byBaseMeta)
      }
    }

    runsMap.set(runId, run)
  }

  const runs = Array.from(runsMap.values())
  for (const run of runs) {
    for (const entry of run.items.values()) {
      entry.best = pickBestOrder(entry.orders)
      entry.ordersCount = entry.orders.length
      entry.remainingTotal = entry.orders.reduce((sum, o) => {
        const remaining = Math.max((o.amountOrdered || 0) - (o.amountDelivered || 0), 0)
        return sum + remaining
      }, 0)
    }
  }

  runs.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
  groupedRuns = runs
  latestGroupedRun = runs.length > 0 ? runs[runs.length - 1] : null
  groupedOrdersByItem = ordersByItem
  groupedOrdersByVariant = ordersByVariant
  groupedItemCounts = countsByItem

  const variantsByBase = new Map()
  const variantsMetaByBase = new Map()
  for (const [baseKey, signaturesMap] of variantsByBaseMeta.entries()) {
    const variants = Array.from(signaturesMap.values())
    variants.sort((a, b) => {
      const aCount = (ordersByVariant.get(a.variantKey) || []).length
      const bCount = (ordersByVariant.get(b.variantKey) || []).length
      if (bCount !== aCount) return bCount - aCount
      const aPrice = (ordersByVariant.get(a.variantKey) || [])[0]?.price ?? 0
      const bPrice = (ordersByVariant.get(b.variantKey) || [])[0]?.price ?? 0
      if (bPrice !== aPrice) return bPrice - aPrice
      return a.name.localeCompare(b.name)
    })
    const recordsBySignature = new Map()
    for (const variant of variants) {
      recordsBySignature.set(variant.signature || '', ordersByVariant.get(variant.variantKey) || [])
    }
    variantsByBase.set(baseKey, recordsBySignature)
    variantsMetaByBase.set(baseKey, variants)
  }
  groupedVariantsByBase = variantsByBase
  groupedVariantMetaByBase = variantsMetaByBase
}

function getGroupedSeries () {
  if (!selectedProduct?.key) return []
  const key = normalizeItemKey(selectedProduct.key)
  const signature = String(selectedProduct?.variantSignature || '')
  const variantKey = buildVariantKey(key, signature)
  const series = []
  for (const run of groupedRuns || []) {
    const entry = run.items.get(variantKey)
    if (!entry || !entry.best) continue
    series.push({
      ts: run.ts,
      runId: run.runId,
      grouped: true,
      productKey: key,
      productName: entry.name,
      max: {
        price: entry.best.price,
        amountOrdered: entry.best.amountOrdered,
        amountDelivered: entry.best.amountDelivered,
        remaining: entry.best.remaining,
        userName: entry.best.userName,
        enchantments: entry.enchantments || []
      }
    })
  }
  return series
}

function getFilteredGroupedSeries () {
  let series = getGroupedSeries()
  if (timeRangeMs) {
    const cutoff = Date.now() - timeRangeMs
    series = series.filter((snap) => new Date(snap.ts).getTime() >= cutoff)
  }
  return series
}

function getBaseDisplayName (baseKey) {
  const normalized = normalizeItemKey(baseKey)
  if (!normalized) return baseKey || '—'
  const fromCatalog = itemsCatalog.find((item) => item.name === normalized)
  if (fromCatalog?.displayName) return fromCatalog.displayName
  const groupedVariantMap = groupedVariantsByBase.get(normalized)
  if (groupedVariantMap && groupedVariantMap.size > 0) {
    const firstRecords = groupedVariantMap.values().next().value
    if (Array.isArray(firstRecords) && firstRecords[0]?.name) return firstRecords[0].name
  }
  const trackedVariantMap = trackedVariantsByBase.get(normalized)
  if (trackedVariantMap && trackedVariantMap.size > 0) {
    const firstList = trackedVariantMap.values().next().value
    if (Array.isArray(firstList) && firstList[0]?.name) return firstList[0].name
  }
  return normalized
}

function summarizeVariantRecords (records, sinceMs = null) {
  if (!Array.isArray(records) || records.length === 0) return null
  const cutoff = Number.isFinite(sinceMs) && sinceMs > 0 ? Date.now() - sinceMs : null
  const filtered = records
    .filter((record) => {
      const price = Number(record?.price)
      if (!Number.isFinite(price)) return false
      if (cutoff == null) return true
      const tsMs = record?.ts ? new Date(record.ts).getTime() : 0
      return !(tsMs && tsMs < cutoff)
    })
    .sort((a, b) => {
      if (b.price !== a.price) return b.price - a.price
      const aTs = a.ts ? new Date(a.ts).getTime() : 0
      const bTs = b.ts ? new Date(b.ts).getTime() : 0
      return bTs - aTs
    })
  if (filtered.length === 0) return null

  let min = Infinity
  let max = -Infinity
  let sum = 0
  let latestTs = 0
  let latestPrice = null

  for (const record of filtered) {
    const price = Number(record.price)
    if (!Number.isFinite(price)) continue
    sum += price
    if (price < min) min = price
    if (price > max) max = price
    const tsMs = record.ts ? new Date(record.ts).getTime() : 0
    if (tsMs >= latestTs) {
      latestTs = tsMs
      latestPrice = price
    }
  }

  const first = filtered[0]
  return {
    min,
    max,
    latest: latestPrice,
    count: filtered.length,
    avg: sum / Math.max(filtered.length, 1),
    topRecord: first,
    records: filtered,
    signature: first?.signature || '',
    enchantments: normalizeEnchantments(first?.enchantments || []),
    name: first?.name || ''
  }
}

function getVariantSummariesForProduct (productKey) {
  const baseKey = normalizeItemKey(productKey)
  if (!baseKey) return []
  const trackedMap = trackedVariantsByBase.get(baseKey) || new Map()
  const groupedMap = groupedVariantsByBase.get(baseKey) || new Map()
  const signatures = new Set([...trackedMap.keys(), ...groupedMap.keys()])

  const results = []
  for (const signature of signatures) {
    const trackedRecords = trackedMap.get(signature) || []
    const groupedRecords = groupedMap.get(signature) || []
    const trackedSummary = summarizeVariantRecords(trackedRecords)
    const groupedSummary = summarizeVariantRecords(groupedRecords)
    const preferred = trackedSummary || groupedSummary
    if (!preferred) continue
    results.push({
      baseKey,
      signature,
      variantKey: buildVariantKey(baseKey, signature),
      enchantments: preferred.enchantments,
      name: preferred.name || getBaseDisplayName(baseKey),
      source: trackedSummary ? 'tracked' : 'grouped',
      summary: preferred,
      trackedSummary,
      groupedSummary
    })
  }

  results.sort((a, b) => {
    const aIsPlain = a.signature === ''
    const bIsPlain = b.signature === ''
    if (aIsPlain !== bIsPlain) return aIsPlain ? -1 : 1
    if (b.summary.max !== a.summary.max) return b.summary.max - a.summary.max
    return (b.summary.count || 0) - (a.summary.count || 0)
  })
  return results
}

function buildVariantDropdownOptions (productKey) {
  const baseKey = normalizeItemKey(productKey)
  if (!baseKey) return []
  const baseName = getBaseDisplayName(baseKey)
  const summaries = getVariantSummariesForProduct(baseKey)
  if (summaries.length === 0) return []

  const options = []
  const plainSummary = summaries.find((entry) => entry.signature === '')
  if (plainSummary) {
    const records = plainSummary.summary.records || []
    const topPlainOffers = records.slice(0, 4)
    topPlainOffers.forEach((record, index) => {
      const sourceTag = plainSummary.source === 'tracked' ? 'TRK' : 'ALL'
      const rankLabel = index === 0 ? 'Top unenchanted' : `Alt unenchanted #${index + 1}`
      options.push({
        id: `plain:${index}`,
        type: index === 0 ? 'plain-primary' : 'plain-offer',
        baseKey,
        signature: '',
        variantKey: plainSummary.variantKey,
        enchantments: [],
        source: plainSummary.source,
        price: record.price,
        userName: record.userName || '—',
        ts: record.ts || null,
        hint: {
          price: record.price,
          userName: record.userName || ''
        },
        buttonLabel: `${rankLabel} • ${formatPrice(Math.round(record.price))} [${sourceTag}]`,
        menuMain: `${rankLabel} • ${formatPrice(Math.round(record.price))}`,
        menuMeta: `${baseName} • ${sourceTag} • ${record.userName || '—'}`
      })
    })
  }

  const enchanted = summaries
    .filter((entry) => entry.signature !== '')
    .sort((a, b) => b.summary.max - a.summary.max)

  for (const entry of enchanted) {
    const sourceTag = entry.source === 'tracked' ? 'TRK' : 'ALL'
    options.push({
      id: `ench:${entry.signature}`,
      type: 'enchanted-variant',
      baseKey,
      signature: entry.signature,
      variantKey: entry.variantKey,
      enchantments: entry.enchantments,
      source: entry.source,
      price: entry.summary.max,
      userName: entry.summary.topRecord?.userName || '—',
      ts: entry.summary.topRecord?.ts || null,
      hint: {
        price: entry.summary.topRecord?.price,
        userName: entry.summary.topRecord?.userName || ''
      },
      buttonLabel: `${formatEnchantmentsCompact(entry.enchantments, 2)} • ${formatPrice(Math.round(entry.summary.max))} [${sourceTag}]`,
      menuMain: `${formatEnchantmentsCompact(entry.enchantments, 3)} • ${formatPrice(Math.round(entry.summary.max))}`,
      menuMeta: `${baseName} • ${sourceTag} • ${entry.summary.topRecord?.userName || '—'}`
    })
  }

  return options
}

function selectVariantOption (option, rerender = true) {
  if (!selectedProduct || !option) return
  selectedProduct.variantSignature = option.signature || ''
  selectedProduct.variantEnchantments = normalizeEnchantments(option.enchantments || [])
  selectedProduct.variantOptionId = option.id
  selectedProduct.variantHint = option.hint || null
  renderVariantPicker()
  if (!rerender) return
  activeSnapshot = null
  activeSnapshotLocked = false
  renderChart()
  renderActiveSnapshot()
  renderGroupedSummary()
  renderMargins()
}

function refreshVariantOptions (selection = {}) {
  if (!selectedProduct?.key) {
    selectedVariantOptions = []
    renderVariantPicker()
    return
  }
  selectedVariantOptions = buildVariantDropdownOptions(selectedProduct.key)
  if (selectedVariantOptions.length === 0) {
    selectedProduct.variantSignature = ''
    selectedProduct.variantEnchantments = []
    selectedProduct.variantOptionId = ''
    selectedProduct.variantHint = null
    renderVariantPicker()
    return
  }

  const preserveId = selection.preserve && selectedProduct.variantOptionId
    ? selectedProduct.variantOptionId
    : ''
  const preferredId = selection.optionId || ''
  const preferredSignature = typeof selection.signature === 'string' ? selection.signature : null
  const hintPrice = parseNumberOrNull(selection.hint?.price)
  const hintUser = String(selection.hint?.userName || '').trim().toLowerCase()

  let option = null
  if (preferredId) {
    option = selectedVariantOptions.find((entry) => entry.id === preferredId) || null
  }
  if (!option && preserveId) {
    option = selectedVariantOptions.find((entry) => entry.id === preserveId) || null
  }
  if (!option && preferredSignature != null) {
    option = selectedVariantOptions.find((entry) => entry.signature === preferredSignature) || null
  }
  if (!option && hintPrice != null) {
    option = selectedVariantOptions.find((entry) => {
      const price = Number(entry.hint?.price)
      if (!Number.isFinite(price)) return false
      if (Math.abs(price - hintPrice) > 1e-9) return false
      if (!hintUser) return true
      return String(entry.hint?.userName || '').trim().toLowerCase() === hintUser
    }) || null
  }
  if (!option) option = selectedVariantOptions[0]
  selectVariantOption(option, false)
}

function renderVariantPicker () {
  if (!variantPicker || !variantPickerButton || !variantPickerMenu) return
  if (!selectedProduct?.key || selectedVariantOptions.length === 0) {
    variantPicker.hidden = true
    variantPicker.classList.remove('open')
    variantPickerMenu.hidden = true
    variantPickerMenu.innerHTML = ''
    return
  }

  variantPicker.hidden = false
  const activeOption = selectedVariantOptions.find((entry) => entry.id === selectedProduct.variantOptionId) || selectedVariantOptions[0]
  variantPickerButton.textContent = activeOption ? activeOption.buttonLabel : 'Select variant'
  variantPickerMenu.innerHTML = ''

  if (selectedVariantOptions.length === 0) {
    variantPickerMenu.innerHTML = '<div class="variant-empty">No variants found.</div>'
    return
  }

  for (const option of selectedVariantOptions) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'variant-option'
    if (selectedProduct.variantOptionId === option.id) {
      button.classList.add('active')
    }
    button.innerHTML = `
      <div class="variant-option-main">${option.menuMain}</div>
      <div class="variant-option-meta">${option.menuMeta}</div>
    `
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      variantPicker.classList.remove('open')
      variantPickerMenu.hidden = true
      selectVariantOption(option, true)
    })
    variantPickerMenu.appendChild(button)
  }
  if (!variantPicker.classList.contains('open')) {
    variantPickerMenu.hidden = true
  }
}

function setSelectedProduct (item, selection = {}) {
  if (!item) return
  const normalized = normalizeItemKey(item.name || item.key || '')
  if (!normalized) return
  selectedProduct = {
    key: normalized,
    name: item.displayName || item.name || normalized,
    variantSignature: '',
    variantEnchantments: [],
    variantOptionId: '',
    variantHint: null
  }
  activeSnapshot = null
  activeSnapshotLocked = false
  refreshVariantOptions({
    preserve: false,
    optionId: selection.optionId || '',
    signature: selection.signature,
    hint: selection.hint || null
  })
  updateProductLabels()
  updateTrackButton()
  renderTrackedList()
  if (trackAliasInput) {
    const aliasValue = aliasMap.get(selectedProduct.key) || selectedProduct.name
    trackAliasInput.value = aliasValue
    trackAliasInput.disabled = false
  }
  loadRecipeForSelected()
  renderChart()
  renderActiveSnapshot()
  renderGroupedSummary()
  renderAlerts()
}

function updateProductLabels (snapshot = null, options = {}) {
  const name = selectedProduct?.name || '—'
  productTitle.textContent = `Product: ${name}`

  const mode = options.mode || chartMode
  if (snapshot) {
    const label = mode === 'grouped' ? 'Latest grouped scan' : 'Latest snapshot'
    productSubtitle.textContent = `${label}: ${new Date(snapshot.ts).toLocaleString()}`
  } else {
    const label = mode === 'grouped' ? 'Latest grouped scan' : 'Latest snapshot'
    productSubtitle.textContent = `${label}: —`
  }

  selectedProductLabel.textContent = selectedProduct
    ? `Selected: ${selectedProduct.name} • ${formatEnchantmentsCompact(selectedProduct.variantEnchantments || [], 2)}`
    : 'Selected: —'

  trackButton.disabled = !selectedProduct
}

function isTrackedSelected () {
  if (!selectedProduct?.key) return false
  return trackedKeys.has(selectedProduct.key)
}

function updateTrackButton () {
  if (!selectedProduct) {
    trackButton.textContent = 'Trackear'
    trackButton.disabled = true
    trackButton.classList.remove('tracking')
    if (trackAliasInput) {
      trackAliasInput.value = ''
      trackAliasInput.disabled = true
    }
    return
  }

  trackButton.disabled = false
  if (isTrackedSelected()) {
    trackButton.textContent = 'Tracking (click to stop)'
    trackButton.classList.add('tracking')
  } else {
    trackButton.textContent = 'Trackear'
    trackButton.classList.remove('tracking')
  }

  if (trackAliasInput) {
    trackAliasInput.disabled = false
  }
}

async function applyAlias (productKey, value) {
  const commandName = (value || '').trim()
  try {
    const res = await postBotJson('alias', { productKey, commandName })
    if (res.ok) {
      await loadQueueState()
    }
  } catch (err) {
    console.error(err)
  }
}

function renderTrackedList () {
  trackedList.innerHTML = ''

  const transient = transientTrackEntries.filter((entry) => entry && entry.key)
  for (const entry of transient) {
    const item = itemsCatalog.find((i) => i.name === entry.key)
    const displayName = item?.displayName || entry.name || entry.key
    const wrapper = document.createElement('div')
    wrapper.className = `tracked-item transient${entry.fading ? ' fading' : ''}`
    wrapper.innerHTML = `
      <div class="item-thumb"><img src="${itemIconUrl(item || { name: entry.key })}" alt="" /></div>
      <div>
        <div><strong>${displayName}</strong></div>
        <div class="meta">Track once queued</div>
      </div>
    `
    trackedList.appendChild(wrapper)
  }

  if ((!trackedItems || trackedItems.length === 0) && transient.length === 0) {
    trackedList.innerHTML = '<div class="meta">No tracked items</div>'
    return
  }

  for (const entry of (trackedItems || [])) {
    const item = itemsCatalog.find((i) => i.name === entry.key)
    const displayName = item?.displayName || entry.key
    const wrapper = document.createElement('div')
    wrapper.className = 'tracked-item'

    if (entry.key === selectedProduct?.key) {
      wrapper.classList.add('active')
    }

    const lastLabel = formatDateTime(entry.lastRunAt)
    const nextLabel = formatDateTime(entry.nextRunAt)
    const aliasValue = aliasMap.get(entry.key) || entry.commandName || displayName

    wrapper.innerHTML = `
      <div class="item-thumb"><img src="${itemIconUrl(item || { name: entry.key })}" alt="" /></div>
      <div>
        <div><strong>${displayName}</strong></div>
        <div class="meta">Last: ${lastLabel}</div>
        <div class="meta">Next: ${nextLabel}</div>
        <div class="alias-row">
          <input class="alias-input" value="${aliasValue}" placeholder="orders query" />
        </div>
      </div>
    `

    const aliasInput = wrapper.querySelector('.alias-input')
    bindAliasInputEvents(aliasInput, entry.key)

    wrapper.addEventListener('click', () => {
      if (item) {
        setSelectedProduct(item)
      } else {
        setSelectedProduct({ name: entry.key, displayName })
      }
    })

    trackedList.appendChild(wrapper)
  }
}

function renderRangeControls () {
  rangeControls.innerHTML = ''
  for (const range of timeRanges) {
    const button = document.createElement('button')
    button.textContent = range.label
    if (timeRangeMs === range.ms || (!timeRangeMs && range.ms === null)) {
      button.classList.add('active')
    }
    button.addEventListener('click', () => {
      timeRangeMs = range.ms
      activeSnapshotLocked = false
      renderRangeControls()
      renderChart()
      renderActiveSnapshot()
    })
    rangeControls.appendChild(button)
  }
}

function renderChartModeControls () {
  if (!chartModeControls) return
  if (chartMode !== 'snapshot') {
    chartMode = 'snapshot'
  }
  chartModeControls.innerHTML = ''
  const modes = [
    { label: 'Snapshot', value: 'snapshot' }
  ]
  for (const mode of modes) {
    const button = document.createElement('button')
    button.textContent = mode.label
    if (chartMode === mode.value) button.classList.add('active')
    button.addEventListener('click', () => {
      setChartMode(mode.value)
    })
    chartModeControls.appendChild(button)
  }
}

function setChartMode (mode) {
  chartMode = mode
  activeSnapshotLocked = false
  renderChartModeControls()
  renderChart()
  renderActiveSnapshot()
  renderCraftSection()
  renderGroupedSummary()
  renderMargins()
  if (snapshotPanel) {
    snapshotPanel.hidden = false
  }
}

function setActiveTab (tab) {
  activeTab = tab
  for (const button of tabs) {
    button.classList.toggle('active', button.dataset.tab === tab)
  }
  if (productView) productView.hidden = tab !== 'product'
  if (marginsView) marginsView.hidden = tab !== 'margins'
  if (groupedView) groupedView.hidden = tab !== 'grouped'
  if (tab === 'margins') {
    renderMargins()
    return
  }
  if (tab === 'grouped') {
    renderGroupedSummary()
    return
  }
  if (chartMode !== 'snapshot') {
    setChartMode('snapshot')
    return
  }
  renderChart()
  renderActiveSnapshot()
}

function setAlertsTab (tab) {
  alertsTab = tab
  alertsTabs.forEach((button) => {
    button.classList.toggle('active', button.dataset.alertTab === tab)
  })
  if (alertsProductView) alertsProductView.hidden = tab !== 'product'
  if (alertsTotalView) alertsTotalView.hidden = tab !== 'total'
  if (alertsApiView) alertsApiView.hidden = tab !== 'api'
  renderAlerts()
}

// Grupo de tarea: acciones track/untrack e interaccion con cola desde UI.
async function trackSelectedProduct () {
  if (!selectedProduct?.key) return

  const aliasInput = document.getElementById('trackAliasInput')
  const commandName = aliasInput ? aliasInput.value.trim() : ''
  await toggleTrack(selectedProduct.key, commandName)
}

async function toggleTrack (productKey, commandName) {
  if (!productKey) return
  try {
    const endpoint = trackedKeys.has(productKey) ? 'untrack' : 'track'
    const payload = { productKey }
    if (endpoint === 'track' && commandName) {
      payload.commandName = commandName
    }
    const res = await postBotJson(endpoint, payload)

    if (res.ok) {
      await loadQueueState()
    }
  } catch (err) {
    console.error(err)
  }
}

async function sendTrackRequest (productKey, options = {}) {
  const key = normalizeItemKey(productKey)
  if (!key) return false
  const once = Boolean(options.once)
  const endpoint = once ? 'track-once' : 'track'
  const payload = { productKey: key }
  if (options.commandName) {
    payload.commandName = String(options.commandName).trim()
  }
  const res = await postBotJson(endpoint, payload)
  return res.ok
}

function getMarginRankMap (rows) {
  const map = new Map()
  const list = Array.isArray(rows) ? rows : []
  for (let i = 0; i < list.length; i += 1) {
    const key = String(list[i]?.id || list[i]?.key || '').trim()
    if (!key || map.has(key)) continue
    map.set(key, i + 1)
  }
  return map
}

function showMarginMoveNotice (itemKey, fromRank, toRank, targetKey = '') {
  if (!itemKey || !Number.isFinite(fromRank) || !Number.isFinite(toRank)) return
  if (toRank <= fromRank) return
  marginMoveNotice = {
    key: String(itemKey || '').trim(),
    from: fromRank,
    to: toRank,
    targetKey: String(targetKey || '').trim(),
    expiresAt: Date.now() + 6000
  }
  setTimeout(() => {
    if (!marginMoveNotice) return
    if (Date.now() >= marginMoveNotice.expiresAt) {
      marginMoveNotice = null
      if (activeTab === 'margins') {
        renderMargins()
      }
    }
  }, 6200)
}

function addTransientTrackEntries (keys) {
  const uniqueKeys = [...new Set((keys || []).map((key) => normalizeItemKey(key)).filter(Boolean))]
  for (const key of uniqueKeys) {
    const id = `transient_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`
    const entry = {
      id,
      key,
      name: getGroupedDisplayName(key),
      fading: false
    }
    transientTrackEntries.unshift(entry)
    setTimeout(() => {
      const target = transientTrackEntries.find((item) => item.id === id)
      if (!target) return
      target.fading = true
      renderTrackedList()
    }, 4000)
    setTimeout(() => {
      transientTrackEntries = transientTrackEntries.filter((item) => item.id !== id)
      renderTrackedList()
    }, 5000)
  }
  renderTrackedList()
}

function sleep (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForQueueCompletion (keys, timeoutMs = 60000) {
  const targetKeys = new Set((keys || []).map((key) => normalizeItemKey(key)).filter(Boolean))
  if (targetKeys.size === 0) return true

  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(`${botApiBase}/queue`)
      if (res.ok) {
        const data = await res.json()
        const inFlight = new Set()
        if (Array.isArray(data.pending)) {
          for (const key of data.pending) {
            inFlight.add(normalizeItemKey(key))
          }
        }
        if (data.current) {
          inFlight.add(normalizeItemKey(data.current))
        }
        const stillRunning = [...targetKeys].some((key) => inFlight.has(key))
        if (!stillRunning) return true
      }
    } catch (err) {
      // Keep polling.
    }
    await sleep(1200)
  }

  return false
}

async function trackProductsBatch (productKeys, options = {}) {
  const uniqueKeys = [...new Set((productKeys || []).map((key) => normalizeItemKey(key)).filter(Boolean))]
  if (uniqueKeys.length === 0) return
  const highlightKeys = [
    ...uniqueKeys,
    ...((options.highlightKeys || []).map((key) => normalizeItemKey(key)).filter(Boolean))
  ]
  const highlightRowIds = [...new Set((options.highlightRowIds || []).map((id) => String(id || '').trim()).filter(Boolean))]
  const highlightTokens = [...new Set([...highlightKeys, ...highlightRowIds])]
  const rankBefore = getMarginRankMap(marginRowsCache)
  if (options.once) {
    addTransientTrackEntries(uniqueKeys)
  }
  highlightTokens.forEach((key) => marginTrackingPendingKeys.add(key))
  if (activeTab === 'margins') {
    await renderMargins()
  }

  try {
    for (const key of uniqueKeys) {
      try {
        await sendTrackRequest(key, options)
      } catch (err) {
        console.error(err)
      }
    }
    await waitForQueueCompletion(uniqueKeys)
    await loadQueueState()
    await loadSnapshots()
    await loadAllPages()
  } finally {
    highlightTokens.forEach((key) => marginTrackingPendingKeys.delete(key))
    await renderMargins()
    const anchorKey = String(options.anchorKey || '').trim()
    if (anchorKey) {
      const rankAfter = getMarginRankMap(marginRowsCache)
      const fromRank = rankBefore.get(anchorKey)
      const toRank = rankAfter.get(anchorKey)
      if (Number.isFinite(fromRank) && Number.isFinite(toRank) && toRank > fromRank) {
        const targetRow = marginRowsCache[toRank - 1]
        showMarginMoveNotice(anchorKey, fromRank, toRank, targetRow?.id || targetRow?.key || '')
        await renderMargins()
      }
    }
  }
}



function getMaxSlot (snapshot, keyOverride = null, options = {}) {
  if (snapshot?.grouped && snapshot?.max && snapshot.max.price != null) return snapshot.max
  if (!keyOverride && !selectedProduct?.key && snapshot?.max && snapshot.max.price != null) return snapshot.max
  const key = normalizeItemKey(keyOverride || selectedProduct?.key)
  if (!key) return null
  const explicitSignature = Object.prototype.hasOwnProperty.call(options, 'variantSignature')
    ? String(options.variantSignature || '')
    : null
  const signature = explicitSignature
    ? explicitSignature
    : ((keyOverride && normalizeItemKey(keyOverride) !== normalizeItemKey(selectedProduct?.key))
        ? ''
        : String(selectedProduct?.variantSignature || ''))
  const hint = options.hint || ((!keyOverride || key === normalizeItemKey(selectedProduct?.key)) ? selectedProduct?.variantHint : null)
  const hintPriceRaw = Number(hint?.price)
  const hintPrice = Number.isFinite(hintPriceRaw) ? hintPriceRaw : null
  const hintUser = String(hint?.userName || '').trim().toLowerCase()
  const orderSlots = (snapshot?.slots || []).filter((slot) => {
    if (!slot?.order) return false
    if (!slotMatchesKey(slot, key)) return false
    return slotMatchesVariant(slot, signature)
  })
  if (orderSlots.length === 0 && options.fallbackAny) {
    for (const slot of snapshot?.slots || []) {
      if (!slot?.order) continue
      if (!slotMatchesKey(slot, key)) continue
      orderSlots.push(slot)
    }
  }
  orderSlots.sort((a, b) => {
    if (hintPrice != null) {
      const aUser = String(a.order.userName || '').trim().toLowerCase()
      const bUser = String(b.order.userName || '').trim().toLowerCase()
      const aMatch = Math.abs((a.order.price || 0) - hintPrice) < 1e-9 && (!hintUser || aUser === hintUser)
      const bMatch = Math.abs((b.order.price || 0) - hintPrice) < 1e-9 && (!hintUser || bUser === hintUser)
      if (aMatch !== bMatch) return aMatch ? -1 : 1
    }
    if (b.order.price !== a.order.price) return b.order.price - a.order.price
    return b.order.amountOrdered - a.order.amountOrdered
  })
  if (!orderSlots[0]) return null
  return {
    price: orderSlots[0].order.price,
    amountOrdered: orderSlots[0].order.amountOrdered,
    amountDelivered: orderSlots[0].order.amountDelivered,
    slot: orderSlots[0].slot,
    userName: orderSlots[0].order.userName,
    enchantments: normalizeEnchantments(orderSlots[0].order.enchantments || [])
  }
}

// Grupo de tarea: carga de snapshots/all-pages/recipe y calculo de estadisticas.
async function loadItemsCatalog () {
  try {
    const res = await fetch('/api/items')
    const data = await res.json()
    itemsCatalog = Array.isArray(data) ? data : []
    if (itemsDatalist) {
      itemsDatalist.innerHTML = itemsCatalog
        .map((item) => `<option value="${item.name}">${item.displayName}</option>`)
        .join('')
    }
  } catch (err) {
    console.error(err)
    itemsCatalog = []
  }
}

async function loadSnapshots () {
  try {
    const res = await fetch('/api/snapshots')
    const data = await res.json()

    if (Array.isArray(data) && data.length > 0) {
      snapshots = data
      buildTrackedIndexes()
      if (!selectedProduct) {
        const latest = snapshots[snapshots.length - 1]
        const catalogItem = itemsCatalog.find((item) => item.name === latest.productKey)
        const fallbackItem = { name: latest.productKey, displayName: latest.productName || latest.productKey }
        setSelectedProduct(catalogItem || fallbackItem)
        return
      }
      refreshVariantOptions({ preserve: true })
    } else {
      snapshots = []
      buildTrackedIndexes()
      activeSnapshot = null
      activeSnapshotLocked = false
      refreshVariantOptions({ preserve: true })
    }

    renderChart()
    renderActiveSnapshot()
    if (activeTab === 'margins') {
      renderMargins()
    }
  } catch (err) {
    console.error(err)
    snapshots = []
    trackedOrdersByVariant = new Map()
    trackedVariantsByBase = new Map()
    refreshVariantOptions({ preserve: true })
  }
}

async function loadRecipeForSelected () {
  if (!selectedProduct?.key) {
    activeRecipe = null
    renderCraftSection()
    return
  }

  try {
    const res = await fetch(`/api/recipe?item=${encodeURIComponent(selectedProduct.key)}`)
    const data = await res.json()
    activeRecipe = data && data.ingredients ? data : null
    renderCraftSection()
  } catch (err) {
    console.error(err)
    activeRecipe = null
    renderCraftSection()
  }
}

function getLatestSnapshotMap () {
  const map = new Map()
  for (const snap of snapshots) {
    if (!snap?.productKey || !snap?.ts) continue
    const prev = map.get(snap.productKey)
    if (!prev || new Date(snap.ts).getTime() > new Date(prev.ts).getTime()) {
      map.set(snap.productKey, snap)
    }
  }
  return map
}

function renderCraftSection () {
  renderVariantPicker()
  craftSummary.innerHTML = ''
  craftList.innerHTML = ''

  if (!activeRecipe || !activeRecipe.ingredients || activeRecipe.ingredients.length === 0) {
    craftSummary.innerHTML = '<div class="metric"><strong>No recipe</strong>Recipe data unavailable</div>'
    return
  }

  const selectedSignature = String(selectedProduct?.variantSignature || '')
  const selectedEnchantments = normalizeEnchantments(selectedProduct?.variantEnchantments || [])
  const selectedOption = selectedVariantOptions.find((entry) => entry.id === selectedProduct?.variantOptionId) || null
  const resultCount = activeRecipe.result?.count || 1
  const productStats = getPreferredPriceStats(selectedProduct?.key, null, {
    variantSignature: selectedSignature
  })
  const hintedPrice = Number(selectedOption?.hint?.price)
  const productUnitPrice = Number.isFinite(hintedPrice)
    ? hintedPrice
    : (productStats?.max ?? null)

  let craftCost = 0
  let craftCostKnown = true
  const components = activeRecipe.ingredients.map((ingredient) => ({
    type: 'ingredient',
    key: normalizeItemKey(ingredient.name),
    displayName: ingredient.displayName || getGroupedDisplayName(ingredient.name),
    qtyPerUnit: ingredient.count / resultCount,
    variantSignature: '',
    enchantments: []
  }))

  selectedEnchantments.forEach((enchantment) => {
    components.push({
      type: 'book',
      key: 'enchanted_book',
      displayName: `Enchanted Book (${formatEnchantName(enchantment.name)} ${toRomanLevel(enchantment.level)})`,
      qtyPerUnit: 1,
      variantSignature: buildEnchantSignature([enchantment]),
      enchantments: [enchantment]
    })
  })

  const pricedComponents = components.map((component) => {
    const stats = getPreferredPriceStats(component.key, null, {
      variantSignature: component.variantSignature,
      allowAny: component.type === 'book'
    })
    const unitPrice = stats?.max ?? null
    const totalCost = unitPrice != null ? unitPrice * component.qtyPerUnit : null
    if (totalCost == null) {
      craftCostKnown = false
    } else {
      craftCost += totalCost
    }
    return {
      ...component,
      unitPrice,
      totalCost,
      source: stats?.source || 'grouped'
    }
  })

  const summary = document.createElement('div')
  summary.className = 'metric'
  summary.innerHTML = `
    <strong>Craft cost</strong>
    ${craftCostKnown ? formatPrice(Math.round(craftCost)) : 'n/a'}
  `
  craftSummary.appendChild(summary)

  const priceMetric = document.createElement('div')
  priceMetric.className = 'metric'
  priceMetric.innerHTML = `
    <strong>Top order price</strong>
    ${productUnitPrice != null ? formatPrice(Math.round(productUnitPrice)) : 'n/a'}
  `
  craftSummary.appendChild(priceMetric)

  const marginMetric = document.createElement('div')
  let marginText = 'n/a'
  let marginClass = ''
  if (productUnitPrice != null && craftCostKnown) {
    const margin = productUnitPrice - craftCost
    marginText = `${margin >= 0 ? '+' : '-'}${formatPrice(Math.abs(Math.round(margin)))}`
    marginClass = margin >= 0 ? 'positive' : 'negative'
  }
  marginMetric.className = `metric ${marginClass}`
  marginMetric.innerHTML = `
    <strong>Margin</strong>
    ${marginText}
  `
  craftSummary.appendChild(marginMetric)

  if (selectedEnchantments.length > 0) {
    const booksMetric = document.createElement('div')
    booksMetric.className = 'metric'
    booksMetric.innerHTML = `
      <strong>Books</strong>
      <div class="craft-book-actions">
        <button data-book-track="once" type="button">Track once</button>
        <button data-book-track="always" type="button">Track always</button>
      </div>
    `
    bindBookTrackingButtons(booksMetric, {
      onceSelector: '[data-book-track="once"]',
      alwaysSelector: '[data-book-track="always"]',
      anchorKey: selectedProduct?.key || 'enchanted_book'
    })
    craftSummary.appendChild(booksMetric)
  }

  for (const component of pricedComponents) {
    const item = itemsCatalog.find((i) => i.name === component.key)
    const displayName = component.displayName || item?.displayName || component.key
    const isTracked = trackedKeys.has(component.key)
    const aliasValue = aliasMap.get(component.key) || displayName
    const sourceLabel = component.source === 'tracked' ? 'tracked' : 'grouped'

    const row = document.createElement('div')
    row.className = 'craft-item'
    const controlsHtml = component.type === 'book'
      ? `
        <div class="craft-book-actions">
          <button data-book-action="once" type="button">Once</button>
          <button data-book-action="always" type="button">Always</button>
        </div>
      `
      : `
        <button class="${isTracked ? 'tracking' : ''}" data-item-action="toggle">${isTracked ? 'Tracking' : 'Track'}</button>
        <input class="alias-input craft-alias" value="${aliasValue}" placeholder="orders query" />
      `
    row.innerHTML = `
      <div class="item-info">
        <div class="item-thumb"><img src="${itemIconUrl(item || { name: component.key })}" alt="" /></div>
        <div>
          <div class="item-name">${displayName}</div>
          <div class="item-actions">
            ${controlsHtml}
            <div class="metrics">
              <strong>${component.qtyPerUnit % 1 === 0 ? component.qtyPerUnit : component.qtyPerUnit.toFixed(2)}x</strong>
              <div>Unit: ${component.unitPrice != null ? formatPrice(Math.round(component.unitPrice)) : 'n/a'} (${sourceLabel})</div>
              <div>${component.totalCost != null ? formatPrice(Math.round(component.totalCost)) : 'n/a'}</div>
            </div>
          </div>
        </div>
      </div>
    `

    if (component.type === 'book') {
      bindBookTrackingButtons(row, {
        anchorKey: selectedProduct?.key || 'enchanted_book'
      })
    } else {
      const button = row.querySelector('[data-item-action="toggle"]')
      if (button) {
        button.addEventListener('click', (event) => {
          event.stopPropagation()
          const input = row.querySelector('.alias-input')
          const commandName = input ? input.value.trim() : ''
          toggleTrack(component.key, commandName)
        })
      }

      const aliasInput = row.querySelector('.alias-input')
      bindAliasInputEvents(aliasInput, component.key)
    }

    craftList.appendChild(row)
  }
}

async function loadQueueState () {
  try {
    const res = await fetch(`${botApiBase}/queue`)
    if (!res.ok) throw new Error('Queue unavailable')
    const data = await res.json()
    trackedKeys = new Set(Array.isArray(data.tracked) ? data.tracked : [])
    trackedItems = Array.isArray(data.items) ? data.items : []
    aliasMap = new Map(Object.entries(data.aliases || {}))
    updateTrackButton()
    if (trackAliasInput && selectedProduct?.key) {
      trackAliasInput.value = aliasMap.get(selectedProduct.key) || selectedProduct.name
    }
    renderTrackedList()
    renderCraftSection()
  } catch (err) {
    trackedKeys = new Set()
    trackedItems = []
    aliasMap = new Map()
    updateTrackButton()
    if (trackAliasInput) {
      trackAliasInput.value = selectedProduct?.name || ''
    }
    renderTrackedList()
    renderCraftSection()
  }
}

async function loadAllPages () {
  if (loadingAllPages) return
  loadingAllPages = true
  try {
    const res = await fetch('/api/all')
    const data = await res.json()
    allPages = Array.isArray(data) ? data : []
    buildGroupedRuns()
    refreshVariantOptions({ preserve: true })
    renderGroupedSearch()
    renderGroupedSummary()
    if (chartMode === 'grouped') {
      renderChart()
      renderActiveSnapshot()
      renderCraftSection()
    }
    renderMargins()
  } catch (err) {
    console.error(err)
    allPages = []
    groupedRuns = []
    latestGroupedRun = null
    groupedOrdersByItem = new Map()
    groupedItemCounts = new Map()
    groupedOrdersByVariant = new Map()
    groupedVariantsByBase = new Map()
    groupedVariantMetaByBase = new Map()
    refreshVariantOptions({ preserve: true })
    renderGroupedSearch()
    renderGroupedSummary()
    renderMargins()
  } finally {
    loadingAllPages = false
  }
}

async function loadSearchAllStatus () {
  if (!searchAllStatus) return
  try {
    const res = await fetch(`${botApiBase}/search-all`)
    if (!res.ok) throw new Error('Search-all unavailable')
    const data = await res.json()
    const last = data.lastRunTs ? new Date(data.lastRunTs).toLocaleString() : '—'
    searchAllStatus.textContent = data.running ? 'Scanning…' : `Last scan: ${last}`
    if (searchAllButton) {
      searchAllButton.disabled = Boolean(data.running)
    }
    if (data.running) {
      await loadAllPages()
    }
  } catch (err) {
    searchAllStatus.textContent = 'Search-all unavailable'
  }
}

async function triggerSearchAll () {
  if (!searchAllButton) return
  searchAllButton.disabled = true
  try {
    const res = await fetch(`${botApiBase}/search-all`, { method: 'POST' })
    if (res.ok) {
      await loadSearchAllStatus()
    }
  } catch (err) {
    console.error(err)
  } finally {
    setTimeout(() => loadSearchAllStatus(), 1500)
  }
}

function getGroupedDisplayName (key) {
  const baseKey = String(key || '').includes('::') ? String(key).split('::')[0] : key
  const normalized = normalizeItemKey(baseKey)
  if (!normalized) return key || '—'
  const fromCatalog = itemsCatalog.find((item) => item.name === normalized)
  if (fromCatalog?.displayName) return fromCatalog.displayName
  const records = groupedOrdersByItem.get(normalized) || []
  if (records.length > 0) {
    const named = records.find((record) => record.name)
    if (named?.name) return named.name
  }
  return normalized
}

function getGroupedProductRecords (productKey = selectedProduct?.key, options = {}) {
  const normalized = normalizeItemKey(productKey)
  if (!normalized) return []
  const signature = Object.prototype.hasOwnProperty.call(options, 'signature')
    ? String(options.signature || '')
    : String(selectedProduct?.variantSignature || '')
  const variantKey = buildVariantKey(normalized, signature)
  let records = [...(groupedOrdersByVariant.get(variantKey) || [])]
  if (records.length === 0 && options.allowAny) {
    records = [...(groupedOrdersByItem.get(normalized) || [])]
  }
  records.sort((a, b) => {
    if (b.price !== a.price) return b.price - a.price
    const aTs = a.ts ? new Date(a.ts).getTime() : 0
    const bTs = b.ts ? new Date(b.ts).getTime() : 0
    return bTs - aTs
  })
  return records
}

function getGroupedPriceStats (productKey, sinceMs, options = {}) {
  const signature = Object.prototype.hasOwnProperty.call(options, 'variantSignature')
    ? String(options.variantSignature || '')
    : ''
  const records = getGroupedProductRecords(productKey, { signature, allowAny: options.allowAny })
  const summary = summarizeVariantRecords(records, sinceMs)
  if (!summary) return null
  return {
    avg: summary.avg,
    min: summary.min,
    max: summary.max,
    latest: summary.latest,
    count: summary.count,
    topRecord: summary.topRecord,
    signature
  }
}

function getTrackedPriceStats (productKey, sinceMs, options = {}) {
  const normalized = normalizeItemKey(productKey)
  if (!normalized) return null
  const bySignature = trackedVariantsByBase.get(normalized)
  if (!bySignature || bySignature.size === 0) return null
  const signature = Object.prototype.hasOwnProperty.call(options, 'variantSignature')
    ? String(options.variantSignature || '')
    : ''
  let records = bySignature.get(signature) || []
  if ((!records || records.length === 0) && options.allowAny) {
    records = Array.from(bySignature.values()).flat()
  }
  const summary = summarizeVariantRecords(records, sinceMs)
  if (!summary) return null
  return {
    avg: summary.avg,
    min: summary.min,
    max: summary.max,
    latest: summary.latest,
    count: summary.count,
    topRecord: summary.topRecord,
    signature
  }
}

function getPreferredPriceStats (productKey, sinceMs, options = {}) {
  const trackedStats = getTrackedPriceStats(productKey, sinceMs, options)
  if (trackedStats) {
    return {
      ...trackedStats,
      source: 'tracked'
    }
  }
  const groupedStats = getGroupedPriceStats(productKey, sinceMs, options)
  if (!groupedStats) return null
  return {
    ...groupedStats,
    source: 'grouped'
  }
}

// Grupo de tarea: busquedas grouped/margins y vistas de ranking.
function getGroupedSearchCandidates (query) {
  const text = String(query || '').trim().toLowerCase()
  const tokens = text.split(/[\s,]+/).filter((token) => token.length > 0)

  if (tokens.length === 0) {
    const items = Array.from(groupedItemCounts.entries())
      .map(([key, count]) => ({
        key,
        displayName: getGroupedDisplayName(key),
        count
      }))
      .sort((a, b) => b.count - a.count || a.displayName.localeCompare(b.displayName))
    return items.slice(0, 40)
  }

  const fromCatalog = itemsCatalog
    .filter((item) => matchesQuery(`${item.displayName} ${item.name}`, tokens))
    .map((item) => {
      const key = normalizeItemKey(item.name)
      return {
        key,
        displayName: item.displayName || item.name,
        count: groupedItemCounts.get(key) || 0
      }
    })
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count || a.displayName.localeCompare(b.displayName))
  return fromCatalog.slice(0, 40)
}

function renderGroupedSearch () {
  if (!groupedSearchResults) return
  groupedSearchResults.innerHTML = ''
  const query = groupedSearchInput ? groupedSearchInput.value : ''
  const candidates = getGroupedSearchCandidates(query)

  if (candidates.length === 0) {
    groupedSearchResults.innerHTML = '<div class="meta">No grouped matches.</div>'
    return
  }

  for (const candidate of candidates) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'grouped-search-item'
    if (selectedProduct?.key === candidate.key) {
      button.classList.add('active')
    }
    button.innerHTML = `
      <span>${candidate.displayName}</span>
      <span>${candidate.count}</span>
    `
    button.addEventListener('click', () => {
      setSelectedProduct({ name: candidate.key, displayName: candidate.displayName })
      if (activeTab !== 'grouped') {
        setActiveTab('grouped')
      } else {
        renderGroupedSummary()
      }
    })
    groupedSearchResults.appendChild(button)
  }
}

function getMarginsSearchCandidates (query) {
  const text = String(query || '').trim().toLowerCase()
  const tokens = text.split(/[\s,]+/).filter((token) => token.length > 0)
  const source = Array.isArray(marginRowsCache) ? marginRowsCache : []

  if (tokens.length === 0) {
    return source.slice(0, 40).map((row) => ({
      id: row.id,
      baseKey: row.baseKey,
      signature: row.signature || '',
      displayName: row.displayName || getGroupedDisplayName(row.baseKey),
      margin: row.margin,
      topUserName: row.topUserName || ''
    }))
  }

  return source
    .filter((row) => matchesQuery(`${row.displayName || row.name || row.baseKey} ${row.baseKey}`, tokens))
    .slice(0, 40)
    .map((row) => ({
      id: row.id,
      baseKey: row.baseKey,
      signature: row.signature || '',
      displayName: row.displayName || getGroupedDisplayName(row.baseKey),
      margin: row.margin,
      topUserName: row.topUserName || ''
    }))
}

function renderMarginsSearch () {
  if (!marginsSearchResults) return
  marginsSearchResults.innerHTML = ''
  const query = marginsSearchInput ? marginsSearchInput.value : ''
  const candidates = getMarginsSearchCandidates(query)

  if (candidates.length === 0) {
    marginsSearchResults.innerHTML = '<div class="meta">No margin matches.</div>'
    return
  }

  for (const candidate of candidates) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'grouped-search-item'
    if (selectedProduct?.key === candidate.baseKey && String(selectedProduct?.variantSignature || '') === String(candidate.signature || '')) {
      button.classList.add('active')
    }
    button.innerHTML = `
      <span>${candidate.displayName}</span>
      <span>${candidate.margin >= 0 ? '+' : '-'}${formatPrice(Math.round(Math.abs(candidate.margin)))}</span>
    `
    button.addEventListener('click', () => {
      if (marginsSearchInput) {
        marginsSearchInput.value = candidate.displayName
      }
      setSelectedProduct(
        { name: candidate.baseKey, displayName: getGroupedDisplayName(candidate.baseKey) },
        {
          signature: candidate.signature
        }
      )
      if (activeTab !== 'margins') {
        setActiveTab('margins')
      } else {
        renderMargins()
      }
    })
    marginsSearchResults.appendChild(button)
  }
}

function renderGroupedRecordsChart (records) {
  if (!groupedChart || !groupedChartCtx) return
  const dpr = window.devicePixelRatio || 1
  const rect = groupedChart.getBoundingClientRect()
  groupedChart.width = rect.width * dpr
  groupedChart.height = rect.height * dpr
  groupedChartCtx.setTransform(1, 0, 0, 1, 0, 0)
  groupedChartCtx.scale(dpr, dpr)
  groupedChartCtx.clearRect(0, 0, rect.width, rect.height)

  if (!Array.isArray(records) || records.length === 0) {
    groupedChartCtx.fillStyle = '#666'
    groupedChartCtx.font = '14px Space Grotesk, sans-serif'
    groupedChartCtx.fillText('No grouped records for selected product', 12, 30)
    if (groupedChartLegend) groupedChartLegend.textContent = 'Grouped chart: no data'
    return
  }

  const series = [...records].sort((a, b) => {
    const aTs = a.ts ? new Date(a.ts).getTime() : 0
    const bTs = b.ts ? new Date(b.ts).getTime() : 0
    if (aTs !== bTs) return aTs - bTs
    return a.price - b.price
  })
  const prices = series.map((entry) => entry.price)
  const maxPrice = Math.max(...prices, 1)
  const minPrice = Math.min(...prices)
  const avgPrice = prices.reduce((sum, value) => sum + value, 0) / prices.length

  const padding = { left: 60, right: 20, top: 24, bottom: 36 }
  const width = rect.width - padding.left - padding.right
  const height = rect.height - padding.top - padding.bottom

  const points = series.map((entry, idx) => {
    const x = padding.left + (width * idx) / Math.max(series.length - 1, 1)
    const y = padding.top + height - (height * entry.price) / maxPrice
    return { x, y, idx, entry }
  })

  groupedChartCtx.strokeStyle = '#e3dccf'
  groupedChartCtx.lineWidth = 1
  groupedChartCtx.font = '12px Space Grotesk, sans-serif'
  groupedChartCtx.fillStyle = '#6b6f76'

  const yTicks = 4
  for (let i = 0; i <= yTicks; i += 1) {
    const y = padding.top + (height * i) / yTicks
    groupedChartCtx.beginPath()
    groupedChartCtx.moveTo(padding.left, y)
    groupedChartCtx.lineTo(padding.left + width, y)
    groupedChartCtx.stroke()
    const priceLabel = formatPrice(Math.round(maxPrice * (1 - i / yTicks)))
    groupedChartCtx.fillText(priceLabel, 8, y + 4)
  }

  const xTicks = Math.min(5, series.length - 1)
  for (let i = 0; i <= xTicks; i += 1) {
    const idx = Math.round((series.length - 1) * (i / Math.max(xTicks, 1)))
    const x = padding.left + (width * idx) / Math.max(series.length - 1, 1)
    groupedChartCtx.beginPath()
    groupedChartCtx.moveTo(x, padding.top)
    groupedChartCtx.lineTo(x, padding.top + height)
    groupedChartCtx.stroke()
    const label = formatAxisTime(series[idx].ts || Date.now())
    const textWidth = groupedChartCtx.measureText(label).width
    groupedChartCtx.fillText(label, x - textWidth / 2, padding.top + height + 20)
  }

  groupedChartCtx.strokeStyle = '#1f2933'
  groupedChartCtx.lineWidth = 2
  groupedChartCtx.beginPath()
  points.forEach((point, idx) => {
    if (idx === 0) groupedChartCtx.moveTo(point.x, point.y)
    else groupedChartCtx.lineTo(point.x, point.y)
  })
  groupedChartCtx.stroke()

  points.forEach((point) => {
    groupedChartCtx.fillStyle = '#f05d3b'
    groupedChartCtx.beginPath()
    groupedChartCtx.arc(point.x, point.y, 3, 0, Math.PI * 2)
    groupedChartCtx.fill()
  })

  if (groupedChartLegend) {
    groupedChartLegend.textContent = `Records: ${series.length} • Max: ${formatPrice(Math.round(maxPrice))} • Min: ${formatPrice(Math.round(minPrice))} • Avg: ${formatPrice(Math.round(avgPrice))}`
  }
}

function renderGroupedSummary () {
  if (!groupedList || !groupedMeta) return
  if (activeTab !== 'grouped') return

  groupedList.innerHTML = ''
  const records = getGroupedProductRecords(selectedProduct?.key)
  renderGroupedSearch()

  if (!selectedProduct?.key) {
    groupedMeta.textContent = 'Select a product to view grouped records.'
    groupedList.innerHTML = '<div class="meta">No selected product.</div>'
    renderGroupedRecordsChart([])
    return
  }

  if (records.length === 0) {
    groupedMeta.textContent = 'No grouped records yet. Run "Search all orders".'
    groupedList.innerHTML = '<div class="meta">No grouped data for this product.</div>'
    renderGroupedRecordsChart([])
    return
  }

  const latestTs = records.find((record) => record.ts)?.ts || null
  const variantLabel = formatEnchantmentsCompact(selectedProduct?.variantEnchantments || [], 2)
  groupedMeta.textContent = `Records: ${records.length} • Variant: ${variantLabel} • Last seen: ${latestTs ? formatDateTime(latestTs) : '—'}`
  renderGroupedRecordsChart(records)

  const displayName = getGroupedDisplayName(selectedProduct.key)
  const limitedRecords = records.slice(0, 1500)
  for (const record of limitedRecords) {
    const row = document.createElement('div')
    row.className = 'grouped-record-row'
    const timeLabel = record.ts ? formatDateTime(record.ts) : '—'
    const slotLabel = record.slot == null ? '' : ` • Slot ${record.slot}`
    row.innerHTML = `
      <div class="grouped-record-main">
        <div class="item-name">${formatVariantDisplayName(displayName, record.enchantments || selectedProduct?.variantEnchantments || [])}</div>
        <div class="item-meta">${record.userName} • ${timeLabel} • Page ${record.page}${slotLabel}</div>
      </div>
      <div class="grouped-record-price">${formatPrice(record.price)}</div>
      <div class="grouped-record-qty">${formatNumber(record.amountDelivered)}/${formatNumber(record.amountOrdered)}</div>
      <div class="grouped-record-total">${formatPrice(record.totalDelivered)}/${formatPrice(record.totalOrdered)}</div>
    `
    groupedList.appendChild(row)
  }
}

async function loadAlertsConfig () {
  if (!alertsWebhookInput || !alertsList) return
  try {
    const res = await fetch(`${botApiBase}/alerts`)
    if (!res.ok) throw new Error('Alerts unavailable')
    const data = await res.json()
    alertsConfig = {
      webhookUrl: data.webhookUrl || '',
      rules: Array.isArray(data.rules) ? data.rules : []
    }
    alertsWebhookInput.value = alertsConfig.webhookUrl || ''
    renderAlerts()
  } catch (err) {
    console.error(err)
  }
}

async function saveAlertsConfig () {
  try {
    await postBotJson('alerts', alertsConfig)
  } catch (err) {
    console.error(err)
  }
}

function renderAlertsList (listEl, rules, options = {}) {
  if (!listEl) return
  listEl.innerHTML = ''
  const productLocked = options.productLocked
  const lockedProductKey = options.productKey || ''

  if (rules.length === 0) {
    listEl.innerHTML = '<div class="meta">No alerts configured.</div>'
    return
  }

  for (const rule of rules) {
    const row = document.createElement('div')
    row.className = 'alert-row'
    row.dataset.id = rule.id
    const productValue = productLocked ? lockedProductKey : (rule.productKey || '')
    row.innerHTML = `
      <input class="alert-item" list="itemsDatalist" placeholder="item key" value="${productValue}" ${productLocked ? 'disabled' : ''} />
      <input class="alert-min" type="number" placeholder="Min $" value="${rule.priceMin ?? ''}" />
      <input class="alert-max" type="number" placeholder="Max $" value="${rule.priceMax ?? ''}" />
      <input class="alert-qty-min" type="number" placeholder="Min qty" value="${rule.qtyMin ?? ''}" />
      <input class="alert-qty-max" type="number" placeholder="Max qty" value="${rule.qtyMax ?? ''}" />
      <button class="alert-remove" type="button">✕</button>
    `

    const inputs = row.querySelectorAll('input')
    inputs.forEach((input) => {
      input.addEventListener('change', () => {
        rule.productKey = productLocked ? lockedProductKey : row.querySelector('.alert-item').value.trim()
        rule.priceMin = row.querySelector('.alert-min').value.trim()
        rule.priceMax = row.querySelector('.alert-max').value.trim()
        rule.qtyMin = row.querySelector('.alert-qty-min').value.trim()
        rule.qtyMax = row.querySelector('.alert-qty-max').value.trim()
        saveAlertsConfig()
      })
    })

    const removeBtn = row.querySelector('.alert-remove')
    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
        alertsConfig.rules = alertsConfig.rules.filter((r) => r.id !== rule.id)
        renderAlerts()
        saveAlertsConfig()
      })
    }

    listEl.appendChild(row)
  }
}

function renderAlerts () {
  if (!alertsList) return
  if (!alertsListAll) return

  const rules = Array.isArray(alertsConfig.rules) ? alertsConfig.rules : []
  const selectedKey = selectedProduct?.key || ''
  const productConfirm = confirmAlertsButtons.find((button) => button.dataset.alertConfirm === 'product')
  const totalConfirm = confirmAlertsButtons.find((button) => button.dataset.alertConfirm === 'total')

  if (alertsTab === 'product') {
    alertsListAll.innerHTML = ''
    if (!selectedKey) {
      alertsList.innerHTML = '<div class="meta">Select a product to configure alerts.</div>'
      if (productConfirm) productConfirm.disabled = true
      return
    }
    if (productConfirm) productConfirm.disabled = false
    const filtered = rules.filter((rule) => rule.productKey === selectedKey)
    renderAlertsList(alertsList, filtered, { productLocked: true, productKey: selectedKey })
  } else if (alertsTab === 'total') {
    alertsList.innerHTML = ''
    if (productConfirm) productConfirm.disabled = true
    if (totalConfirm) totalConfirm.disabled = false
    renderAlertsList(alertsListAll, rules, { productLocked: false })
  } else {
    alertsList.innerHTML = ''
    alertsListAll.innerHTML = ''
    if (productConfirm) productConfirm.disabled = true
    if (totalConfirm) totalConfirm.disabled = true
  }
}

async function fetchRecipeCached (itemKey) {
  if (!itemKey) return null
  if (recipeCache.has(itemKey)) return recipeCache.get(itemKey)
  const promise = fetch(`/api/recipe?item=${encodeURIComponent(itemKey)}`)
    .then((res) => res.json())
    .then((data) => (data && data.ingredients ? data : null))
    .catch(() => null)
  recipeCache.set(itemKey, promise)
  return promise
}

/*
 * Tarea: mapear acciones de tabla de margenes a batches de tracking.
 * Input: `row` de margenes y action id (item/material/book, once/always).
 * Output: Promise<void>.
 * Uso: botones de margenes para definir el flujo en un solo lugar.
 */
async function runMarginRowTrackAction (row, action) {
  if (!row || !action) return
  const shared = {
    anchorKey: row.id,
    highlightRowIds: [row.id]
  }
  if (action === 'item-once') {
    await trackProductsBatch([row.baseKey], { ...shared, once: true })
    return
  }
  if (action === 'item-always') {
    await trackProductsBatch([row.baseKey], { ...shared, once: false })
    return
  }
  const materialKeys = [...new Set((row.materials || []).map((material) => material.key).filter(Boolean))]
  if (action === 'materials-once') {
    await trackProductsBatch(materialKeys, {
      ...shared,
      once: true,
      highlightKeys: materialKeys
    })
    return
  }
  if (action === 'materials-always') {
    await trackProductsBatch(materialKeys, {
      ...shared,
      once: false,
      highlightKeys: materialKeys
    })
    return
  }
  if (action === 'books-once') {
    await queueBookTracking(true, {
      ...shared,
      highlightKeys: ['enchanted_book']
    })
    return
  }
  if (action === 'books-always') {
    await queueBookTracking(false, {
      ...shared,
      highlightKeys: ['enchanted_book']
    })
  }
}

async function renderMargins () {
  if (!marginsList) return
  marginsList.innerHTML = '<div class="meta">Loading margins…</div>'
  if (!groupedVariantMetaByBase || groupedVariantMetaByBase.size === 0) {
    marginRowsCache = []
    renderMarginsSearch()
    marginsList.innerHTML = '<div class="meta">Run a grouped scan to calculate margins.</div>'
    if (marginsUpdateNotice) marginsUpdateNotice.hidden = true
    return
  }

  const hours = Number(marginsHours) || 24
  const sinceMs = hours * 60 * 60 * 1000
  const candidates = []
  for (const variants of groupedVariantMetaByBase.values()) {
    if (!Array.isArray(variants)) continue
    candidates.push(...variants)
  }
  const formatQty = (value) => {
    if (!Number.isFinite(value)) return '0'
    if (Math.abs(value - Math.round(value)) < 1e-9) return `${Math.round(value)}`
    return value.toFixed(2).replace(/\.?0+$/, '')
  }
  const sourceLabel = (source) => (source === 'tracked' ? 'tracked' : 'grouped')

  const rows = []
  for (const entry of candidates) {
    const baseKey = normalizeItemKey(entry?.key || '')
    if (!baseKey) continue
    const signature = String(entry?.signature || '')
    const enchantments = normalizeEnchantments(entry?.enchantments || [])
    const productStats = getPreferredPriceStats(baseKey, sinceMs, { variantSignature: signature })
    if (!productStats) continue
    const recipe = await fetchRecipeCached(baseKey)
    if (!recipe || !recipe.ingredients || recipe.ingredients.length === 0) continue

    let craftCost = 0
    let craftKnown = true
    const materialDetails = []
    const resultCount = recipe.result?.count || 1
    const components = recipe.ingredients.map((ingredient) => ({
      type: 'ingredient',
      key: normalizeItemKey(ingredient.name),
      displayName: ingredient.displayName || getGroupedDisplayName(ingredient.name),
      qtyPerUnit: ingredient.count / resultCount,
      variantSignature: ''
    }))
    enchantments.forEach((enchant) => {
      components.push({
        type: 'book',
        key: 'enchanted_book',
        displayName: `Enchanted Book (${formatEnchantName(enchant.name)} ${toRomanLevel(enchant.level)})`,
        qtyPerUnit: 1,
        variantSignature: buildEnchantSignature([enchant]),
        enchantments: [enchant]
      })
    })

    for (const component of components) {
      const ingredientStats = getPreferredPriceStats(component.key, sinceMs, {
        variantSignature: component.variantSignature,
        allowAny: component.type === 'book'
      })
      if (!ingredientStats) {
        craftKnown = false
        break
      }
      const qtyPerUnit = component.qtyPerUnit
      const unitPrice = ingredientStats.max
      const totalCost = unitPrice * qtyPerUnit
      craftCost += totalCost
      const materialId = component.type === 'book'
        ? buildVariantKey(component.key, component.variantSignature)
        : normalizeItemKey(component.key)
      materialDetails.push({
        id: materialId,
        key: normalizeItemKey(component.key),
        variantSignature: component.variantSignature,
        displayName: component.displayName || getGroupedDisplayName(component.key),
        qtyPerUnit,
        unitPrice,
        totalCost,
        source: sourceLabel(ingredientStats.source),
        type: component.type
      })
    }
    if (!craftKnown) continue
    const sellPrice = productStats.max
    const margin = sellPrice - craftCost
    const rowId = buildVariantKey(baseKey, signature)
    const displayName = formatVariantDisplayName(getGroupedDisplayName(baseKey), enchantments)
    rows.push({
      id: rowId,
      key: rowId,
      baseKey,
      signature,
      enchantments,
      displayName,
      name: entry.name,
      sellPrice,
      craftCost,
      margin,
      productMax: productStats.max,
      points: productStats.count,
      sellSource: sourceLabel(productStats.source),
      recipe,
      materials: materialDetails,
      hasBooks: enchantments.length > 0,
      topUserName: productStats.topRecord?.userName || '—'
    })
  }

  rows.sort((a, b) => b.margin - a.margin)
  marginRowsCache = rows
  renderMarginsSearch()

  const queryTokens = String(marginsSearchInput?.value || '')
    .trim()
    .toLowerCase()
    .split(/[\s,]+/)
    .filter((token) => token.length > 0)
  const visibleRows = queryTokens.length > 0
    ? rows.filter((row) => matchesQuery(`${row.displayName} ${row.baseKey} ${formatEnchantmentsCompact(row.enchantments || [], 4)}`, queryTokens))
    : rows

  if (marginMoveNotice && marginMoveNotice.expiresAt < Date.now()) {
    marginMoveNotice = null
  }
  if (marginsUpdateNotice) {
    const rowNameMap = new Map(rows.map((row) => [row.id, row.displayName]))
    if (marginMoveNotice) {
      marginsUpdateNotice.hidden = false
      const name = rowNameMap.get(marginMoveNotice.key) || getGroupedDisplayName(marginMoveNotice.key)
      const targetName = marginMoveNotice.targetKey
        ? (rowNameMap.get(marginMoveNotice.targetKey) || getGroupedDisplayName(marginMoveNotice.targetKey))
        : ''
      marginsUpdateNotice.textContent = targetName && targetName !== name
        ? `${name} moved down from #${marginMoveNotice.from} to #${marginMoveNotice.to} (below ${targetName})`
        : `${name} moved down from #${marginMoveNotice.from} to #${marginMoveNotice.to}`
    } else {
      marginsUpdateNotice.hidden = true
      marginsUpdateNotice.textContent = ''
    }
  }

  marginsList.innerHTML = ''

  if (visibleRows.length === 0) {
    marginsList.innerHTML = '<div class="meta">No margins available for this window.</div>'
    return
  }

  const header = document.createElement('div')
  header.className = 'margin-header'
  header.innerHTML = `
    <div>Item</div>
    <div>Sell Price</div>
    <div>Material Cost</div>
    <div>Margin</div>
    <div>Actions</div>
  `
  marginsList.appendChild(header)

  for (const row of visibleRows.slice(0, 80)) {
    const node = document.createElement('div')
    node.className = 'margin-row'
    const isPendingRow = marginTrackingPendingKeys.has(row.id) || marginTrackingPendingKeys.has(row.baseKey)
    const isMovedDown = marginMoveNotice && marginMoveNotice.key === row.id && marginMoveNotice.expiresAt >= Date.now()
    if (isPendingRow) node.classList.add('pending')
    if (isMovedDown) node.classList.add('rank-moved-down')
    const materialsHtml = row.materials
      .map((material) => `
        <div class="margin-material-chip${marginTrackingPendingKeys.has(material.id) || marginTrackingPendingKeys.has(material.key) ? ' pending' : ''}">
          <div class="item-thumb"><img src="${itemIconUrl({ name: material.key })}" alt="" /></div>
          <div class="margin-material-info">
            <div class="margin-material-name">${material.displayName} x${formatQty(material.qtyPerUnit)}</div>
            <div class="margin-material-meta">${formatPrice(Math.round(material.unitPrice))} (${material.source})</div>
          </div>
        </div>
      `)
      .join('')

    node.innerHTML = `
      <div class="margin-row-main">
        <div class="margin-item">
          <div class="item-thumb"><img src="${itemIconUrl({ name: row.baseKey })}" alt="" /></div>
          <div>
            <div class="item-name">${row.displayName}</div>
            <div class="meta">Top sell (${hours}h) from ${row.sellSource} • samples ${row.points}</div>
          </div>
        </div>
        <div class="margin-metric">
          <div class="metric-label">Sell Price</div>
          <div class="metric-value">${formatPrice(Math.round(row.sellPrice))}</div>
        </div>
        <div class="margin-metric">
          <div class="metric-label">Material Cost</div>
          <div class="metric-value">${formatPrice(Math.round(row.craftCost))}</div>
        </div>
        <div class="margin-metric">
          <div class="metric-label">Margin</div>
          <div class="metric-value ${row.margin >= 0 ? 'positive' : 'negative'}">${row.margin >= 0 ? '+' : '-'}${formatPrice(Math.round(Math.abs(row.margin)))}</div>
        </div>
        <div class="margin-actions">
          <button data-action="item-once" type="button" ${isPendingRow ? 'disabled' : ''}>Track Item Once</button>
          <button data-action="item-always" type="button" ${isPendingRow ? 'disabled' : ''}>Track Item Always</button>
          <button data-action="materials-once" type="button" ${isPendingRow ? 'disabled' : ''}>Track Mats Once</button>
          <button data-action="materials-always" type="button" ${isPendingRow ? 'disabled' : ''}>Track Mats Always</button>
          ${row.hasBooks ? `<button data-action="books-once" type="button" ${isPendingRow ? 'disabled' : ''}>Track Books Once</button>` : ''}
          ${row.hasBooks ? `<button data-action="books-always" type="button" ${isPendingRow ? 'disabled' : ''}>Track Books Always</button>` : ''}
        </div>
      </div>
      <div class="margin-materials">
        <div class="margin-materials-title">Materials used for material cost</div>
        <div class="margin-materials-grid">${materialsHtml}</div>
      </div>
    `

    const actionButtons = node.querySelectorAll('.margin-actions button')
    actionButtons.forEach((button) => {
      button.addEventListener('click', async (event) => {
        event.stopPropagation()
        const action = String(button.getAttribute('data-action') || '')
        await runMarginRowTrackAction(row, action)
      })
    })

    node.addEventListener('click', () => {
      setSelectedProduct(
        { name: row.baseKey, displayName: getGroupedDisplayName(row.baseKey) },
        {
          signature: row.signature,
          hint: {
            price: row.sellPrice,
            userName: row.topUserName
          }
        }
      )
      setActiveTab('grouped')
    })
    marginsList.appendChild(node)
  }
}

function getAlertHitIndexes (snapshotsList) {
  if (!selectedProduct?.key) return new Set()
  if (!alertsConfig || !Array.isArray(alertsConfig.rules)) return new Set()
  const rules = alertsConfig.rules.filter((rule) => rule?.productKey === selectedProduct.key)
  if (rules.length === 0) return new Set()

  const hits = new Set()
  const cooldowns = new Map()
  const fallbackCooldownMs = 300000

  for (let i = 0; i < snapshotsList.length; i += 1) {
    const snapshot = snapshotsList[i]
    const max = getMaxSlot(snapshot, selectedProduct.key, {
      variantSignature: selectedProduct?.variantSignature || ''
    })
    if (!max || !Number.isFinite(max.price)) continue
    const price = max.price
    const orderedQty = Number(max.amountOrdered) || 0
    const userKey = typeof max.userName === 'string' ? max.userName.trim().toLowerCase() : ''
    const tsMs = new Date(snapshot.ts).getTime()

    for (const rule of rules) {
      const priceMin = parseNumberOrNull(rule.priceMin)
      const priceMax = parseNumberOrNull(rule.priceMax)
      const qtyMin = parseNumberOrNull(rule.qtyMin)
      const qtyMax = parseNumberOrNull(rule.qtyMax)

      if (priceMin != null && price < priceMin) continue
      if (priceMax != null && price > priceMax) continue
      if (qtyMin != null && orderedQty < qtyMin) continue
      if (qtyMax != null && orderedQty > qtyMax) continue

      if (userKey) {
        const cooldownKey = `${rule.id}:${userKey}`
        const cooldownUntil = cooldowns.get(cooldownKey)
        if (cooldownUntil && cooldownUntil > tsMs) continue
        const expiresAt = Number.isFinite(Number(max.expiresAt))
          ? Number(max.expiresAt)
          : tsMs + fallbackCooldownMs
        cooldowns.set(cooldownKey, expiresAt)
      }

      hits.add(i)
      break
    }
  }

  return hits
}

// Grupo de tarea: render de chart + snapshot/grid.
function renderChart () {
  const dpr = window.devicePixelRatio || 1
  const rect = chart.getBoundingClientRect()
  chart.width = rect.width * dpr
  chart.height = rect.height * dpr
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.scale(dpr, dpr)

  ctx.clearRect(0, 0, rect.width, rect.height)

  chartSnapshots = chartMode === 'grouped' ? getFilteredGroupedSeries() : getFilteredSnapshots()
  if (chartMode === 'snapshot' && selectedProduct?.key) {
    chartSnapshots = chartSnapshots.filter((snapshot) => !!getMaxSlot(snapshot))
  }
  chartOutlierBoxes = []

  if (chartSnapshots.length === 0) {
    ctx.fillStyle = '#666'
    ctx.font = '14px Space Grotesk, sans-serif'
    ctx.fillText(chartMode === 'grouped' ? 'No grouped scans in this range' : 'No snapshots in this range', 12, 30)
    chartPoints = []
    chartLegend.textContent = 'Latest: no data'
    return
  }

  const padding = { left: 60, right: 20, top: 24, bottom: 36 }
  const width = rect.width - padding.left - padding.right
  const height = rect.height - padding.top - padding.bottom
  const maxSlots = chartSnapshots.map((s) => getMaxSlot(s))
  const prices = maxSlots.map((max) => max?.price || 0)
  const maxPrice = Math.max(...prices, 1)
  const alertHits = chartMode === 'snapshot' ? getAlertHitIndexes(chartSnapshots) : new Set()

  chartPoints = chartSnapshots.map((snap, idx) => {
    const x = padding.left + (width * idx) / Math.max(chartSnapshots.length - 1, 1)
    const y = padding.top + height - (height * prices[idx]) / maxPrice
    return { x, y, idx }
  })

  ctx.strokeStyle = '#e3dccf'
  ctx.lineWidth = 1
  ctx.font = '12px Space Grotesk, sans-serif'
  ctx.fillStyle = '#6b6f76'

  const yTicks = 4
  for (let i = 0; i <= yTicks; i += 1) {
    const y = padding.top + (height * i) / yTicks
    ctx.beginPath()
    ctx.moveTo(padding.left, y)
    ctx.lineTo(padding.left + width, y)
    ctx.stroke()

    const priceLabel = formatPrice(Math.round(maxPrice * (1 - i / yTicks)))
    ctx.fillText(priceLabel, 8, y + 4)
  }

  const xTicks = Math.min(5, chartSnapshots.length - 1)
  for (let i = 0; i <= xTicks; i += 1) {
    const idx = Math.round((chartSnapshots.length - 1) * (i / Math.max(xTicks, 1)))
    const x = padding.left + (width * idx) / Math.max(chartSnapshots.length - 1, 1)
    ctx.beginPath()
    ctx.moveTo(x, padding.top)
    ctx.lineTo(x, padding.top + height)
    ctx.stroke()

    const label = formatAxisTime(chartSnapshots[idx].ts)
    const textWidth = ctx.measureText(label).width
    ctx.fillText(label, x - textWidth / 2, padding.top + height + 20)
  }

  ctx.strokeStyle = '#f05d3b'
  ctx.lineWidth = 2
  ctx.beginPath()
  chartPoints.forEach((pt, idx) => {
    if (idx === 0) ctx.moveTo(pt.x, pt.y)
    else ctx.lineTo(pt.x, pt.y)
  })
  ctx.stroke()

  chartPoints.forEach((pt) => {
    ctx.fillStyle = alertHits.has(pt.idx) ? '#2fbf9c' : '#1f2933'
    ctx.beginPath()
    ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2)
    ctx.fill()
  })

  const stats = (() => {
    if (prices.length === 0) return null
    const mean = prices.reduce((sum, v) => sum + v, 0) / prices.length
    const variance = prices.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / prices.length
    const std = Math.sqrt(variance)
    return { mean, std }
  })()

  if (stats && stats.std > 0) {
    const threshold = stats.mean + stats.std * 2
    ctx.font = '11px Space Grotesk, sans-serif'
    ctx.fillStyle = '#1f2933'
    ctx.strokeStyle = 'rgba(31,41,51,0.2)'
    const seenUsers = new Set()

    const drawBox = (pt, max, price, options = {}) => {
      const paid = Number.isFinite(max.amountDelivered) ? max.amountDelivered * price : null
      const total = Number.isFinite(max.amountOrdered) ? max.amountOrdered * price : null
      const lines = [
        `Unit ${formatPrice(price)}`,
        `Paid ${paid != null ? formatPrice(paid) : 'n/a'}`,
        `Total ${total != null ? formatPrice(total) : 'n/a'}`
      ]

      const lineHeight = 13
      const paddingX = 6
      const paddingY = 4
      const textWidth = Math.max(...lines.map((line) => ctx.measureText(line).width))
      const boxWidth = textWidth + paddingX * 2
      const boxHeight = lines.length * lineHeight + paddingY * 2
      let boxX = pt.x + 8
      let boxY = pt.y - boxHeight - 8

      if (boxX + boxWidth > rect.width - 8) {
        boxX = pt.x - boxWidth - 8
      }
      if (boxX < 8) boxX = 8
      if (boxY < 8) boxY = pt.y + 8

      if (options.capture) {
        chartOutlierBoxes.push({
          idx: pt.idx,
          x: boxX,
          y: boxY,
          w: boxWidth,
          h: boxHeight
        })
      }

      ctx.fillStyle = 'rgba(31, 41, 51, 0.88)'
      ctx.fillRect(boxX, boxY, boxWidth, boxHeight)
      ctx.fillStyle = '#fff'
      lines.forEach((line, i) => {
        ctx.fillText(line, boxX + paddingX, boxY + paddingY + (i + 1) * lineHeight - 3)
      })
    }

    chartPoints.forEach((pt, idx) => {
      const price = prices[idx]
      if (price < threshold) return
      const max = maxSlots[idx]
      if (!max) return
      const userKey = typeof max.userName === 'string' ? max.userName.trim().toLowerCase() : ''
      if (userKey) {
        if (seenUsers.has(userKey)) return
        seenUsers.add(userKey)
      }
      if (hoverIndex === idx) return
      drawBox(pt, max, price, { capture: true })
    })

    if (hoverIndex != null) {
      const hoverPrice = prices[hoverIndex]
      const hoverMax = maxSlots[hoverIndex]
      const hoverPoint = chartPoints.find((p) => p.idx === hoverIndex)
      if (hoverPoint && hoverMax && hoverPrice >= threshold) {
        drawBox(hoverPoint, hoverMax, hoverPrice, { capture: true })
      }
    }
  }

  if (hoverIndex != null) {
    const pt = chartPoints.find((p) => p.idx === hoverIndex)
    if (pt) {
      ctx.fillStyle = '#fbd06a'
      ctx.beginPath()
      ctx.arc(pt.x, pt.y, 6, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  const last = chartSnapshots[chartSnapshots.length - 1]
  const lastMax = getMaxSlot(last)
  if (lastMax) {
    const hasNumbers = Number.isFinite(lastMax.amountOrdered) && Number.isFinite(lastMax.amountDelivered)
    const remaining = hasNumbers ? lastMax.amountOrdered - lastMax.amountDelivered : null
    const remainingLabel = remaining != null ? formatNumber(remaining) : 'n/a'
    const extra = hasNumbers
      ? `${formatNumber(lastMax.amountDelivered)}/${formatNumber(lastMax.amountOrdered)} delivered`
      : 'delivered n/a'
    chartLegend.textContent = chartMode === 'grouped'
      ? `Latest grouped: ${formatPrice(lastMax.price)} (remaining ${remainingLabel})`
      : `Latest: ${formatPrice(lastMax.price)} (${extra})`
  } else {
    chartLegend.textContent = 'Latest: no data'
  }
}

function renderActiveSnapshot () {
  if (chartMode === 'grouped') {
    const filtered = getFilteredGroupedSeries()
    if (filtered.length === 0) {
      if (snapshotMeta) {
        snapshotMeta.innerHTML = `
          <div><strong>Grouped scan:</strong> —</div>
          <div><strong>Product:</strong> ${selectedProduct?.name || selectedProduct?.key || '—'}</div>
          <div><strong>Best price:</strong> n/a</div>
        `
      }
      updateProductLabels(null, { mode: 'grouped' })
      const fallbackSnapshot = snapshots.length > 0 ? snapshots[snapshots.length - 1] : { slots: [] }
      renderSearchResults(fallbackSnapshot)
      renderGrid(null)
      renderCraftSection()
      renderGroupedSummary()
      return
    }

    let snapshot = null
    if (activeSnapshotLocked && activeSnapshot && activeSnapshot.grouped) {
      snapshot = filtered.find((snap) => snap.ts === activeSnapshot.ts && snap.runId === activeSnapshot.runId)
    }
    if (!snapshot) {
      snapshot = filtered[filtered.length - 1]
      activeSnapshotLocked = false
    }

    activeSnapshot = snapshot
    const max = getMaxSlot(snapshot)
    const remaining = max && Number.isFinite(max.amountOrdered) && Number.isFinite(max.amountDelivered)
      ? max.amountOrdered - max.amountDelivered
      : null
    if (snapshotMeta) {
      snapshotMeta.innerHTML = `
        <div><strong>Grouped scan:</strong> ${new Date(snapshot.ts).toLocaleString()}</div>
        <div><strong>Product:</strong> ${selectedProduct?.name || snapshot.productName || snapshot.productKey}</div>
        <div><strong>Best price:</strong> ${max ? formatPrice(max.price) : 'n/a'} ${remaining != null ? `(remaining ${formatNumber(remaining)})` : ''}</div>
      `
    }

    updateProductLabels(snapshot, { mode: 'grouped' })
    const fallbackSnapshot = snapshots.length > 0 ? snapshots[snapshots.length - 1] : { slots: [] }
    renderSearchResults(fallbackSnapshot)
    renderGrid(null)
    renderCraftSection()
    renderGroupedSummary()
    return
  }

  const filtered = getFilteredSnapshots()

  if (filtered.length === 0) {
    if (snapshotMeta) {
      snapshotMeta.innerHTML = `
        <div><strong>Snapshot:</strong> —</div>
        <div><strong>Product:</strong> ${selectedProduct?.name || selectedProduct?.key || '—'}</div>
        <div><strong>Max price:</strong> n/a</div>
      `
    }
    updateProductLabels(null)
    renderSearchResults({ slots: [] })
    renderGrid(null)
    renderCraftSection()
    return
  }

  let snapshot = null
  if (activeSnapshotLocked && activeSnapshot) {
    snapshot = filtered.find((snap) => snap.ts === activeSnapshot.ts)
  }
  if (!snapshot) {
    snapshot = filtered[filtered.length - 1]
    activeSnapshotLocked = false
  }

  activeSnapshot = snapshot

  const max = getMaxSlot(snapshot)
  if (snapshotMeta) {
    snapshotMeta.innerHTML = `
      <div><strong>Snapshot:</strong> ${new Date(snapshot.ts).toLocaleString()}</div>
      <div><strong>Product:</strong> ${selectedProduct?.name || snapshot.productName || snapshot.productKey}</div>
      <div><strong>Max price:</strong> ${max ? formatPrice(max.price) : 'n/a'}</div>
    `
  }

  updateProductLabels(snapshot)
  renderSearchResults(snapshot)
  renderGrid(snapshot)
  renderCraftSection()
}

function renderSearchResults (snapshot = { slots: [] }) {
  const query = searchInput.value.trim().toLowerCase()
  const tokens = query.split(/[\s,]+/).filter((t) => t.length > 0)

  const snapshotItems = collectItems(snapshot, 45)
  const snapshotMap = new Map(snapshotItems.map((item) => [item.key, item]))

  resultList.innerHTML = ''
  if (tokens.length === 0) {
    resultList.innerHTML = '<div class="result-item">Type to search</div>'
    return
  }

  const filtered = itemsCatalog.filter((item) =>
    matchesQuery(`${item.displayName} ${item.name}`, tokens)
  )

  if (filtered.length === 0) {
    resultList.innerHTML = '<div class="result-item">No matches</div>'
    return
  }

  for (const item of filtered) {
    const entry = document.createElement('div')
    entry.className = 'result-item'

    if (selectedProduct?.key === item.name) {
      entry.classList.add('active')
    }

    const match = snapshotMap.get(item.name)
    const countLabel = match ? `Slots: ${match.count}` : 'Not on page'

    entry.innerHTML = `
      <div class="item-thumb"><img src="${itemIconUrl(item)}" alt="" /></div>
      <div>
        <div><strong>${item.displayName}</strong></div>
        <div class="price">${countLabel}</div>
      </div>
    `
    entry.addEventListener('click', () => {
      setSelectedProduct(item)
    })

    resultList.appendChild(entry)
  }
}

function renderGrid (snapshot) {
  grid.innerHTML = ''
  const slots = snapshot?.slots || []
  const slotMap = new Map(slots.map((slot) => [slot.slot, slot]))
  const max = snapshot ? getMaxSlot(snapshot) : null
  const maxSlots = 45

  const name = snapshot?.productName || selectedProduct?.name || selectedProduct?.key || '—'
  const timeLabel = snapshot?.ts ? formatTime(snapshot.ts) : ''
  gridMeta.textContent = timeLabel ? `${name} - ${timeLabel}` : name

  const rawSlots = []
  for (let i = 0; i < maxSlots; i += 1) {
    rawSlots.push(slotMap.get(i) || null)
  }

  const matchingSlots = rawSlots.filter((slot) => slot && slotMatchesSelected(slot))
  const hintPriceRaw = Number(selectedProduct?.variantHint?.price)
  const hintPrice = Number.isFinite(hintPriceRaw) ? hintPriceRaw : null
  const hintUser = String(selectedProduct?.variantHint?.userName || '').trim().toLowerCase()
  matchingSlots.sort((a, b) => {
    if (hintPrice != null) {
      const aUser = String(a?.order?.userName || '').trim().toLowerCase()
      const bUser = String(b?.order?.userName || '').trim().toLowerCase()
      const aMatch = Math.abs((a?.order?.price || 0) - hintPrice) < 1e-9 && (!hintUser || aUser === hintUser)
      const bMatch = Math.abs((b?.order?.price || 0) - hintPrice) < 1e-9 && (!hintUser || bUser === hintUser)
      if (aMatch !== bMatch) return aMatch ? -1 : 1
    }
    if ((b?.order?.price || 0) !== (a?.order?.price || 0)) {
      return (b?.order?.price || 0) - (a?.order?.price || 0)
    }
    return (b?.order?.amountOrdered || 0) - (a?.order?.amountOrdered || 0)
  })
  const otherSlots = rawSlots.filter((slot) => !slot || !slotMatchesSelected(slot))
  const displaySlots = [...matchingSlots, ...otherSlots]

  for (let i = 0; i < maxSlots; i += 1) {
    const slot = displaySlots[i]
    const cell = document.createElement('div')
    cell.className = 'slot'

    if (!slot || !slot.item || !slotMatchesSelected(slot)) {
      cell.classList.add('empty')
      cell.innerHTML = `
        <div class="slot-icon"><img src="/item-placeholder.svg" alt="" /></div>
        <div class="slot-content">
          <div class="name">Empty</div>
          <div class="meta">Slot ${slot?.slot ?? i}</div>
        </div>
      `
    } else {
      const name = slot.item.displayName || slot.item.name
      let qtyLine = `Qty: x${slot.item.count ?? 1}`
      let unitLine = 'Unit: n/a'
      let totalLine = '—'
      let userLine = ''

      if (slot.order) {
        const totalPaid = slot.order.price * slot.order.amountDelivered
        const totalTotal = slot.order.price * slot.order.amountOrdered
        qtyLine = `Qty: ${formatNumber(slot.order.amountDelivered)}/${formatNumber(slot.order.amountOrdered)}`
        unitLine = `Unit: ${formatPrice(slot.order.price)}`
        totalLine = `${formatPrice(totalPaid)}/${formatPrice(totalTotal)}`
        userLine = slot.order.userName || ''
      }

      if (max && slot.slot === max.slot) {
        cell.classList.add('max')
      }

      cell.innerHTML = `
        <div class="slot-icon">
          <img src="${itemIconUrl(slot.item)}" alt="" />
        </div>
        <div class="slot-content">
          <div class="name">${name}</div>
          <div class="meta">${userLine || '—'}</div>
          <div class="meta">${qtyLine}</div>
          <div class="meta">${unitLine}</div>
          <div class="meta">${totalLine}</div>
        </div>
      `
      cell.title = slot.loreText?.join(' | ') || ''
    }

    grid.appendChild(cell)
  }
}

function positionTooltip (x, y) {
  const wrap = chart.parentElement
  const padding = 8
  tooltip.style.left = '0px'
  tooltip.style.top = '0px'

  const wrapRect = wrap.getBoundingClientRect()
  const tipRect = tooltip.getBoundingClientRect()

  let left = x + 12
  let top = y - tipRect.height - 12

  if (left + tipRect.width > wrapRect.width - padding) {
    left = x - tipRect.width - 12
  }
  if (left < padding) left = padding

  if (top < padding) {
    top = y + 12
  }
  if (top + tipRect.height > wrapRect.height - padding) {
    top = wrapRect.height - tipRect.height - padding
  }

  tooltip.style.left = `${left}px`
  tooltip.style.top = `${top}px`
}

chart.addEventListener('mousemove', (event) => {
  const rect = chart.getBoundingClientRect()
  const x = event.clientX - rect.left
  const y = event.clientY - rect.top

  let closest = null
  let minDist = 12

  for (const pt of chartPoints) {
    const dx = pt.x - x
    const dy = pt.y - y
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist < minDist) {
      minDist = dist
      closest = pt
    }
  }

  if (closest) {
    hoverIndex = closest.idx
    const snapshot = chartSnapshots[hoverIndex]
    const max = getMaxSlot(snapshot)

    tooltip.hidden = false
    const delivered = max ? `${formatNumber(max.amountDelivered)}/${formatNumber(max.amountOrdered)}` : 'n/a'
    const remaining = max && Number.isFinite(max.amountOrdered) && Number.isFinite(max.amountDelivered)
      ? formatNumber(max.amountOrdered - max.amountDelivered)
      : 'n/a'
    const fullTime = new Date(snapshot.ts).toLocaleString()
    tooltip.innerHTML = `
      <div><strong>Time:</strong> ${fullTime}</div>
      <div><strong>Price:</strong> ${max ? formatPrice(max.price) : 'n/a'}</div>
      <div><strong>${chartMode === 'grouped' ? 'Remaining' : 'Delivered'}:</strong> ${chartMode === 'grouped' ? remaining : delivered}</div>
    `
    positionTooltip(closest.x, closest.y)

    renderChart()
    return
  }

  let hitBox = null
  for (let i = chartOutlierBoxes.length - 1; i >= 0; i -= 1) {
    const box = chartOutlierBoxes[i]
    if (
      x >= box.x &&
      x <= box.x + box.w &&
      y >= box.y &&
      y <= box.y + box.h
    ) {
      hitBox = box
      break
    }
  }

  if (hitBox) {
    hoverIndex = hitBox.idx
    tooltip.hidden = true
    renderChart()
    return
  }

  hoverIndex = null
  tooltip.hidden = true
  renderChart()
})

chart.addEventListener('mouseleave', () => {
  hoverIndex = null
  tooltip.hidden = true
  renderChart()
})

chart.addEventListener('click', (event) => {
  const rect = chart.getBoundingClientRect()
  const x = event.clientX - rect.left
  const y = event.clientY - rect.top

  let closest = null
  let minDist = 12

  for (const pt of chartPoints) {
    const dx = pt.x - x
    const dy = pt.y - y
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist < minDist) {
      minDist = dist
      closest = pt
    }
  }

  if (!closest) return
  const snapshot = chartSnapshots[closest.idx]
  if (!snapshot) return
  activeSnapshot = snapshot
  activeSnapshotLocked = true
  renderActiveSnapshot()
})

searchInput.addEventListener('input', () => {
  renderActiveSnapshot()
})

window.addEventListener('resize', () => {
  if (activeTab === 'grouped') {
    renderGroupedSummary()
    return
  }
  renderChart()
})

// Grupo de tarea: bootstrap de listeners y loops de refresco periodico.
async function init () {
  await loadItemsCatalog()
  initSidebarSections()
  renderRangeControls()
  renderChartModeControls()
  renderOrderConfigSelectors()
  if (variantPickerButton && variantPicker && variantPickerMenu) {
    variantPickerButton.addEventListener('click', (event) => {
      event.stopPropagation()
      const isOpen = variantPicker.classList.contains('open')
      variantPicker.classList.toggle('open', !isOpen)
      variantPickerMenu.hidden = isOpen
    })
    document.addEventListener('click', () => {
      if (!variantPicker.classList.contains('open')) return
      variantPicker.classList.remove('open')
      variantPickerMenu.hidden = true
    })
    variantPickerMenu.addEventListener('click', (event) => {
      event.stopPropagation()
    })
  }
  if (searchAllSortSelect) {
    searchAllSortSelect.addEventListener('change', () => {
      orderConfig.searchAllSort = normalizeSortKey(searchAllSortSelect.value, orderConfig.searchAllSort)
      saveOrderConfig()
    })
  }
  if (trackingSortSelect) {
    trackingSortSelect.addEventListener('change', () => {
      orderConfig.trackingSort = normalizeSortKey(trackingSortSelect.value, orderConfig.trackingSort)
      saveOrderConfig()
    })
  }
  trackButton.addEventListener('click', () => {
    trackSelectedProduct()
  })
  if (searchAllButton) {
    searchAllButton.addEventListener('click', () => {
      triggerSearchAll()
    })
  }
  if (chatMessageInput && chatSendButton) {
    const updateChatState = () => {
      chatSendButton.disabled = chatMessageInput.value.trim().length === 0
    }
    chatMessageInput.addEventListener('input', updateChatState)
    chatSendButton.addEventListener('click', async () => {
      const message = chatMessageInput.value.trim()
      if (!message) return
      chatSendButton.disabled = true
      try {
        const res = await postBotJson('say', { message })
        if (res.ok) {
          chatMessageInput.value = ''
        }
      } catch (err) {
        console.error(err)
      } finally {
        updateChatState()
      }
    })
    updateChatState()
  }
  if (trackAliasInput) {
    trackAliasInput.addEventListener('change', () => {
      if (selectedProduct?.key) {
        applyAlias(selectedProduct.key, trackAliasInput.value)
      }
    })
    trackAliasInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        trackAliasInput.blur()
      }
    })
  }
  if (tabs.length > 0) {
    tabs.forEach((button) => {
      button.addEventListener('click', () => {
        setActiveTab(button.dataset.tab)
      })
    })
    setActiveTab('product')
  }
  if (groupedSearchInput) {
    groupedSearchInput.addEventListener('input', () => {
      if (activeTab === 'grouped') {
        renderGroupedSearch()
      }
    })
  }
  if (marginsSearchInput) {
    marginsSearchInput.addEventListener('input', () => {
      if (activeTab === 'margins') {
        renderMargins()
      }
    })
  }
  if (marginsHoursInput) {
    const initialHours = Number(marginsHoursInput.value)
    marginsHours = Number.isFinite(initialHours) && initialHours > 0 ? initialHours : 24
    marginsHoursInput.addEventListener('change', () => {
      const nextValue = Number(marginsHoursInput.value)
      marginsHours = Number.isFinite(nextValue) && nextValue > 0 ? nextValue : 24
      marginsHoursInput.value = marginsHours
      renderMargins()
    })
  }
  if (alertsWebhookInput) {
    alertsWebhookInput.addEventListener('change', () => {
      alertsConfig.webhookUrl = alertsWebhookInput.value.trim()
      saveAlertsConfig()
    })
  }
  if (alertsTabs.length > 0) {
    alertsTabs.forEach((button) => {
      button.addEventListener('click', () => {
        setAlertsTab(button.dataset.alertTab)
      })
    })
    setAlertsTab(alertsTab)
  }
  if (confirmAlertsButtons.length > 0) {
    confirmAlertsButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const scope = button.dataset.alertConfirm || 'product'
        if (scope === 'total') {
          const rules = Array.isArray(alertsConfig.rules) ? alertsConfig.rules : []
          console.log(`Alerts confirmed (total): ${rules.length} rule(s).`, rules)
          return
        }
        const key = selectedProduct?.key
        if (!key) {
          console.log('Alerts: no product selected.')
          return
        }
        const rules = (alertsConfig.rules || []).filter((r) => r.productKey === key)
        console.log(`Alerts confirmed for ${key}: ${rules.length} rule(s).`, rules)
      })
    })
  }
  if (addAlertButton) {
    addAlertButton.addEventListener('click', () => {
      const id = `alert_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`
      alertsConfig.rules = alertsConfig.rules || []
      alertsConfig.rules.push({
        id,
        productKey: alertsTab === 'product' ? (selectedProduct?.key || '') : '',
        priceMin: '',
        priceMax: '',
        qtyMin: '',
        qtyMax: ''
      })
      renderAlerts()
      saveAlertsConfig()
    })
  }
  await loadQueueState()
  await loadSnapshots()
  await loadAllPages()
  await loadSearchAllStatus()
  await loadOrderConfig()
  await loadAlertsConfig()
  setInterval(loadSnapshots, 30000)
  setInterval(loadAllPages, 15000)
  setInterval(loadQueueState, 15000)
  setInterval(loadSearchAllStatus, 15000)
}

init()
