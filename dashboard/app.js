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
    const res = await fetch(`${botApiBase}/order-config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
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
  return slotMatchesKey(slot, selectedProduct?.key)
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

function buildGroupedRuns () {
  const runsMap = new Map()
  const ordersByItem = new Map()
  const countsByItem = new Map()
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
      const key = normalizeItemKey(slot.item.name || getItemKey(slot.item))
      if (!key) continue
      const pageTs = page.ts || runTs || null
      const amountOrderedRaw = Number(slot.order.amountOrdered)
      const amountDeliveredRaw = Number(slot.order.amountDelivered)
      const amountOrdered = Number.isFinite(amountOrderedRaw) ? amountOrderedRaw : 0
      const amountDelivered = Number.isFinite(amountDeliveredRaw) ? amountDeliveredRaw : 0
      const priceRaw = Number(slot.order.price)
      const price = Number.isFinite(priceRaw) ? priceRaw : null
      const entry = run.items.get(key) || {
        key,
        name: slot.item.displayName || slot.item.name || key,
        orders: []
      }
      entry.orders.push({
        price: price ?? 0,
        amountOrdered,
        amountDelivered,
        userName: slot.order.userName
      })
      run.items.set(key, entry)

      if (price != null) {
        const bucket = ordersByItem.get(key) || []
        bucket.push({
          key,
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
        countsByItem.set(key, (countsByItem.get(key) || 0) + 1)
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
  groupedItemCounts = countsByItem
}

function getGroupedSeries () {
  if (!selectedProduct?.key) return []
  const key = selectedProduct.key
  const series = []
  for (const run of groupedRuns || []) {
    const entry = run.items.get(key)
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
        userName: entry.best.userName
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

function setSelectedProduct (item) {
  if (!item) return
  selectedProduct = {
    key: item.name,
    name: item.displayName || item.name
  }
  activeSnapshot = null
  activeSnapshotLocked = false
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
    ? `Selected: ${selectedProduct.name}`
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
    const res = await fetch(`${botApiBase}/alias`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productKey, commandName })
    })
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
    if (aliasInput) {
      aliasInput.addEventListener('click', (event) => {
        event.stopPropagation()
      })
      aliasInput.addEventListener('change', () => {
        applyAlias(entry.key, aliasInput.value)
      })
      aliasInput.addEventListener('keydown', (event) => {
        event.stopPropagation()
        if (event.key === 'Enter') {
          event.preventDefault()
          aliasInput.blur()
        }
      })
    }

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
    const res = await fetch(`${botApiBase}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })

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
  const res = await fetch(`${botApiBase}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  return res.ok
}

function getMarginRankMap (rows) {
  const map = new Map()
  const list = Array.isArray(rows) ? rows : []
  for (let i = 0; i < list.length; i += 1) {
    const key = normalizeItemKey(list[i]?.key)
    if (!key || map.has(key)) continue
    map.set(key, i + 1)
  }
  return map
}

function showMarginMoveNotice (itemKey, fromRank, toRank, targetKey = '') {
  if (!itemKey || !Number.isFinite(fromRank) || !Number.isFinite(toRank)) return
  if (toRank <= fromRank) return
  marginMoveNotice = {
    key: normalizeItemKey(itemKey),
    from: fromRank,
    to: toRank,
    targetKey: normalizeItemKey(targetKey),
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
  const rankBefore = getMarginRankMap(marginRowsCache)
  if (options.once) {
    addTransientTrackEntries(uniqueKeys)
  }
  highlightKeys.forEach((key) => marginTrackingPendingKeys.add(key))
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
    highlightKeys.forEach((key) => marginTrackingPendingKeys.delete(key))
    await renderMargins()
    const anchorKey = normalizeItemKey(options.anchorKey)
    if (anchorKey) {
      const rankAfter = getMarginRankMap(marginRowsCache)
      const fromRank = rankBefore.get(anchorKey)
      const toRank = rankAfter.get(anchorKey)
      if (Number.isFinite(fromRank) && Number.isFinite(toRank) && toRank > fromRank) {
        const targetRow = marginRowsCache[toRank - 1]
        showMarginMoveNotice(anchorKey, fromRank, toRank, targetRow?.key || '')
        await renderMargins()
      }
    }
  }
}



function getMaxSlot (snapshot, keyOverride = null) {
  if (snapshot?.grouped && snapshot?.max && snapshot.max.price != null) return snapshot.max
  if (!keyOverride && !selectedProduct?.key && snapshot?.max && snapshot.max.price != null) return snapshot.max
  const key = keyOverride || selectedProduct?.key
  const orderSlots = (snapshot?.slots || []).filter((slot) => slot.order && slotMatchesKey(slot, key))
  orderSlots.sort((a, b) => {
    if (b.order.price !== a.order.price) return b.order.price - a.order.price
    return b.order.amountOrdered - a.order.amountOrdered
  })
  if (!orderSlots[0]) return null
  return {
    price: orderSlots[0].order.price,
    amountOrdered: orderSlots[0].order.amountOrdered,
    amountDelivered: orderSlots[0].order.amountDelivered,
    slot: orderSlots[0].slot,
    userName: orderSlots[0].order.userName
  }
}

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
      if (!selectedProduct) {
        const latest = snapshots[snapshots.length - 1]
        const catalogItem = itemsCatalog.find((item) => item.name === latest.productKey)
        const fallbackItem = { name: latest.productKey, displayName: latest.productName || latest.productKey }
        setSelectedProduct(catalogItem || fallbackItem)
        return
      }
    } else if (snapshots.length === 0) {
      snapshots = []
      activeSnapshot = null
      activeSnapshotLocked = false
    }

    renderChart()
    renderActiveSnapshot()
    if (activeTab === 'margins') {
      renderMargins()
    }
  } catch (err) {
    console.error(err)
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
  craftSummary.innerHTML = ''
  craftList.innerHTML = ''

  if (!activeRecipe || !activeRecipe.ingredients || activeRecipe.ingredients.length === 0) {
    craftSummary.innerHTML = '<div class="metric"><strong>No recipe</strong>Recipe data unavailable</div>'
    return
  }

  const latestMap = getLatestSnapshotMap()
  const resultCount = activeRecipe.result?.count || 1

  let productUnitPrice = null
  if (chartMode === 'grouped') {
    const groupedItem = latestGroupedRun?.items?.get(selectedProduct?.key)
    productUnitPrice = groupedItem?.best?.price ?? null
  } else {
    const productSnapshot = activeSnapshot
    const productMax = productSnapshot ? getMaxSlot(productSnapshot, selectedProduct?.key) : null
    productUnitPrice = productMax?.price ?? null
  }

  let craftCost = 0
  let craftCostKnown = true

  for (const ingredient of activeRecipe.ingredients) {
    let unitPrice = null
    if (chartMode === 'grouped') {
      const groupedItem = latestGroupedRun?.items?.get(ingredient.name)
      unitPrice = groupedItem?.best?.price ?? null
    } else {
      const latest = latestMap.get(ingredient.name)
      const max = latest ? getMaxSlot(latest, ingredient.name) : null
      unitPrice = max?.price ?? null
    }
    const qtyPerUnit = ingredient.count / resultCount
    if (unitPrice == null) {
      craftCostKnown = false
      continue
    }
    craftCost += unitPrice * qtyPerUnit
  }

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
    ${productUnitPrice != null ? formatPrice(productUnitPrice) : 'n/a'}
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

  for (const ingredient of activeRecipe.ingredients) {
    let unitPrice = null
    if (chartMode === 'grouped') {
      const groupedItem = latestGroupedRun?.items?.get(ingredient.name)
      unitPrice = groupedItem?.best?.price ?? null
    } else {
      const latest = latestMap.get(ingredient.name)
      const max = latest ? getMaxSlot(latest, ingredient.name) : null
      unitPrice = max?.price ?? null
    }
    const qtyPerUnit = ingredient.count / resultCount
    const totalCost = unitPrice != null ? unitPrice * qtyPerUnit : null
    const item = itemsCatalog.find((i) => i.name === ingredient.name)
    const displayName = item?.displayName || ingredient.displayName || ingredient.name
    const isTracked = trackedKeys.has(ingredient.name)
    const aliasValue = aliasMap.get(ingredient.name) || displayName

    const row = document.createElement('div')
    row.className = 'craft-item'
    row.innerHTML = `
      <div class="item-info">
        <div class="item-thumb"><img src="${itemIconUrl(item || { name: ingredient.name })}" alt="" /></div>
        <div>
          <div class="item-name">${displayName}</div>
          <div class="item-actions">
            <button class="${isTracked ? 'tracking' : ''}">${isTracked ? 'Tracking' : 'Track'}</button>
            <input class="alias-input craft-alias" value="${aliasValue}" placeholder="orders query" />
            <div class="metrics">
              <strong>${qtyPerUnit % 1 === 0 ? qtyPerUnit : qtyPerUnit.toFixed(2)}x</strong>
              <div>Unit: ${unitPrice != null ? formatPrice(unitPrice) : 'n/a'}</div>
              <div>${totalCost != null ? formatPrice(Math.round(totalCost)) : 'n/a'}</div>
            </div>
          </div>
        </div>
      </div>
    `

    const button = row.querySelector('button')
    if (button) {
      button.addEventListener('click', (event) => {
        event.stopPropagation()
        const input = row.querySelector('.alias-input')
        const commandName = input ? input.value.trim() : ''
        toggleTrack(ingredient.name, commandName)
      })
    }

    const aliasInput = row.querySelector('.alias-input')
    if (aliasInput) {
      aliasInput.addEventListener('click', (event) => {
        event.stopPropagation()
      })
      aliasInput.addEventListener('change', () => {
        applyAlias(ingredient.name, aliasInput.value)
      })
      aliasInput.addEventListener('keydown', (event) => {
        event.stopPropagation()
        if (event.key === 'Enter') {
          event.preventDefault()
          aliasInput.blur()
        }
      })
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
  const normalized = normalizeItemKey(key)
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

function getGroupedProductRecords (productKey = selectedProduct?.key) {
  const normalized = normalizeItemKey(productKey)
  if (!normalized) return []
  const records = [...(groupedOrdersByItem.get(normalized) || [])]
  records.sort((a, b) => {
    if (b.price !== a.price) return b.price - a.price
    const aTs = a.ts ? new Date(a.ts).getTime() : 0
    const bTs = b.ts ? new Date(b.ts).getTime() : 0
    return bTs - aTs
  })
  return records
}

function getGroupedPriceStats (productKey, sinceMs) {
  const records = getGroupedProductRecords(productKey)
  if (!records.length) return null
  const cutoff = Number.isFinite(sinceMs) && sinceMs > 0 ? Date.now() - sinceMs : null

  let min = Infinity
  let max = -Infinity
  let sum = 0
  let count = 0
  let latestTs = 0
  let latestPrice = null

  for (const record of records) {
    const price = Number(record.price)
    if (!Number.isFinite(price)) continue
    const tsMs = record.ts ? new Date(record.ts).getTime() : 0
    if (cutoff != null && tsMs && tsMs < cutoff) continue

    sum += price
    count += 1
    if (price < min) min = price
    if (price > max) max = price
    if (tsMs >= latestTs) {
      latestTs = tsMs
      latestPrice = price
    }
  }

  if (count === 0) return null
  return {
    avg: sum / count,
    min,
    max,
    latest: latestPrice,
    count
  }
}

function getTrackedPriceStats (productKey, sinceMs) {
  const normalized = normalizeItemKey(productKey)
  if (!normalized) return null
  const cutoff = Number.isFinite(sinceMs) && sinceMs > 0 ? Date.now() - sinceMs : null
  const sourceSnapshots = Array.isArray(snapshots) ? snapshots : []

  let min = Infinity
  let max = -Infinity
  let sum = 0
  let count = 0
  let latestTs = 0
  let latestPrice = null

  for (const snapshot of sourceSnapshots) {
    if (!snapshot) continue
    if (normalizeItemKey(snapshot.productKey) !== normalized) continue
    const tsMs = snapshot.ts ? new Date(snapshot.ts).getTime() : 0
    if (cutoff != null && tsMs && tsMs < cutoff) continue

    const top = getMaxSlot(snapshot, normalized)
    const price = Number(top?.price)
    if (!Number.isFinite(price)) continue

    sum += price
    count += 1
    if (price < min) min = price
    if (price > max) max = price
    if (tsMs >= latestTs) {
      latestTs = tsMs
      latestPrice = price
    }
  }

  if (count === 0) return null
  return {
    avg: sum / count,
    min,
    max,
    latest: latestPrice,
    count
  }
}

function getPreferredPriceStats (productKey, sinceMs) {
  const trackedStats = getTrackedPriceStats(productKey, sinceMs)
  if (trackedStats) {
    return {
      ...trackedStats,
      source: 'tracked'
    }
  }
  const groupedStats = getGroupedPriceStats(productKey, sinceMs)
  if (!groupedStats) return null
  return {
    ...groupedStats,
    source: 'grouped'
  }
}

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
      key: normalizeItemKey(row.key),
      displayName: row.displayName || getGroupedDisplayName(row.key),
      margin: row.margin
    }))
  }

  return source
    .filter((row) => matchesQuery(`${row.displayName || row.name || row.key} ${row.key}`, tokens))
    .slice(0, 40)
    .map((row) => ({
      key: normalizeItemKey(row.key),
      displayName: row.displayName || getGroupedDisplayName(row.key),
      margin: row.margin
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
    if (selectedProduct?.key === candidate.key) {
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
      setSelectedProduct({ name: candidate.key, displayName: candidate.displayName })
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
  groupedMeta.textContent = `Records: ${records.length} • Last seen: ${latestTs ? formatDateTime(latestTs) : '—'}`
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
        <div class="item-name">${displayName}</div>
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
    await fetch(`${botApiBase}/alerts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(alertsConfig)
    })
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

async function renderMargins () {
  if (!marginsList) return
  marginsList.innerHTML = '<div class="meta">Loading margins…</div>'
  const run = latestGroupedRun
  if (!run) {
    marginRowsCache = []
    renderMarginsSearch()
    marginsList.innerHTML = '<div class="meta">Run a grouped scan to calculate margins.</div>'
    if (marginsUpdateNotice) marginsUpdateNotice.hidden = true
    return
  }

  const hours = Number(marginsHours) || 24
  const sinceMs = hours * 60 * 60 * 1000
  const candidates = Array.from(run.items.values())
  const formatQty = (value) => {
    if (!Number.isFinite(value)) return '0'
    if (Math.abs(value - Math.round(value)) < 1e-9) return `${Math.round(value)}`
    return value.toFixed(2).replace(/\.?0+$/, '')
  }
  const sourceLabel = (source) => (source === 'tracked' ? 'tracked' : 'grouped')

  const rows = []
  for (const entry of candidates) {
    const productStats = getPreferredPriceStats(entry.key, sinceMs)
    if (!productStats) continue
    const recipe = await fetchRecipeCached(entry.key)
    if (!recipe || !recipe.ingredients || recipe.ingredients.length === 0) continue

    let craftCost = 0
    let craftKnown = true
    const materialDetails = []
    const resultCount = recipe.result?.count || 1
    for (const ingredient of recipe.ingredients) {
      const ingredientStats = getPreferredPriceStats(ingredient.name, sinceMs)
      if (!ingredientStats) {
        craftKnown = false
        break
      }
      const qtyPerUnit = ingredient.count / resultCount
      const unitPrice = ingredientStats.max
      const totalCost = unitPrice * qtyPerUnit
      craftCost += totalCost
      materialDetails.push({
        key: normalizeItemKey(ingredient.name),
        displayName: ingredient.displayName || getGroupedDisplayName(ingredient.name),
        qtyPerUnit,
        unitPrice,
        totalCost,
        source: sourceLabel(ingredientStats.source)
      })
    }
    if (!craftKnown) continue
    const sellPrice = productStats.max
    const margin = sellPrice - craftCost
    const key = normalizeItemKey(entry.key)
    const displayName = getGroupedDisplayName(key)
    rows.push({
      key,
      displayName,
      name: entry.name,
      sellPrice,
      craftCost,
      margin,
      productMax: productStats.max,
      points: productStats.count,
      sellSource: sourceLabel(productStats.source),
      recipe,
      materials: materialDetails
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
    ? rows.filter((row) => matchesQuery(`${row.displayName} ${row.key}`, queryTokens))
    : rows

  if (marginMoveNotice && marginMoveNotice.expiresAt < Date.now()) {
    marginMoveNotice = null
  }
  if (marginsUpdateNotice) {
    if (marginMoveNotice) {
      marginsUpdateNotice.hidden = false
      const name = getGroupedDisplayName(marginMoveNotice.key)
      const targetName = marginMoveNotice.targetKey
        ? getGroupedDisplayName(marginMoveNotice.targetKey)
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
    const isPendingRow = marginTrackingPendingKeys.has(row.key)
    const isMovedDown = marginMoveNotice && marginMoveNotice.key === row.key && marginMoveNotice.expiresAt >= Date.now()
    if (isPendingRow) node.classList.add('pending')
    if (isMovedDown) node.classList.add('rank-moved-down')
    const materialsHtml = row.materials
      .map((material) => `
        <div class="margin-material-chip${marginTrackingPendingKeys.has(material.key) ? ' pending' : ''}">
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
          <div class="item-thumb"><img src="${itemIconUrl({ name: row.key })}" alt="" /></div>
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
        const action = button.getAttribute('data-action')
        if (action === 'item-once') {
          await trackProductsBatch([row.key], { once: true, anchorKey: row.key })
          return
        }
        if (action === 'item-always') {
          await trackProductsBatch([row.key], { once: false, anchorKey: row.key })
          return
        }
        const materialKeys = row.materials.map((material) => material.key)
        if (action === 'materials-once') {
          await trackProductsBatch(materialKeys, { once: true, anchorKey: row.key, highlightKeys: [row.key] })
          return
        }
        if (action === 'materials-always') {
          await trackProductsBatch(materialKeys, { once: false, anchorKey: row.key, highlightKeys: [row.key] })
        }
      })
    })

    node.addEventListener('click', () => {
      setSelectedProduct({ name: row.key, displayName: row.displayName })
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
    const max = getMaxSlot(snapshot, selectedProduct.key)
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

function renderChart () {
  const dpr = window.devicePixelRatio || 1
  const rect = chart.getBoundingClientRect()
  chart.width = rect.width * dpr
  chart.height = rect.height * dpr
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.scale(dpr, dpr)

  ctx.clearRect(0, 0, rect.width, rect.height)

  chartSnapshots = chartMode === 'grouped' ? getFilteredGroupedSeries() : getFilteredSnapshots()
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

async function init () {
  await loadItemsCatalog()
  initSidebarSections()
  renderRangeControls()
  renderChartModeControls()
  renderOrderConfigSelectors()
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
        const res = await fetch(`${botApiBase}/say`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message })
        })
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
