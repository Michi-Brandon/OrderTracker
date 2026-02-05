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
const craftSummary = document.getElementById('craftSummary')
const craftList = document.getElementById('craftList')
const trackAliasInput = document.getElementById('trackAliasInput')
const chatMessageInput = document.getElementById('chatMessageInput')
const chatSendButton = document.getElementById('chatSendButton')

let snapshots = []
let chartPoints = []
let chartSnapshots = []
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
}

function updateProductLabels (snapshot = null) {
  const name = selectedProduct?.name || '—'
  productTitle.textContent = `Product: ${name}`

  if (snapshot) {
    productSubtitle.textContent = `Latest snapshot: ${new Date(snapshot.ts).toLocaleString()}`
  } else {
    productSubtitle.textContent = 'Latest snapshot: —'
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
  if (!trackedItems || trackedItems.length === 0) {
    trackedList.innerHTML = '<div class="meta">No tracked items</div>'
    return
  }

  for (const entry of trackedItems) {
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



function getMaxSlot (snapshot, keyOverride = null) {
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

  const productSnapshot = activeSnapshot
  const productMax = productSnapshot ? getMaxSlot(productSnapshot, selectedProduct?.key) : null
  const productUnitPrice = productMax?.price ?? null

  let craftCost = 0
  let craftCostKnown = true

  for (const ingredient of activeRecipe.ingredients) {
    const latest = latestMap.get(ingredient.name)
    const max = latest ? getMaxSlot(latest, ingredient.name) : null
    const unitPrice = max?.price ?? null
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
    const latest = latestMap.get(ingredient.name)
    const max = latest ? getMaxSlot(latest, ingredient.name) : null
    const unitPrice = max?.price ?? null
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
          </div>
        </div>
      </div>
      <div class="metrics">
        <strong>${qtyPerUnit % 1 === 0 ? qtyPerUnit : qtyPerUnit.toFixed(2)}x</strong>
        <div>Unit: ${unitPrice != null ? formatPrice(unitPrice) : 'n/a'}</div>
        <div>${totalCost != null ? formatPrice(Math.round(totalCost)) : 'n/a'}</div>
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

function renderChart () {
  const dpr = window.devicePixelRatio || 1
  const rect = chart.getBoundingClientRect()
  chart.width = rect.width * dpr
  chart.height = rect.height * dpr
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.scale(dpr, dpr)

  ctx.clearRect(0, 0, rect.width, rect.height)

  chartSnapshots = getFilteredSnapshots()

  if (chartSnapshots.length === 0) {
    ctx.fillStyle = '#666'
    ctx.font = '14px Space Grotesk, sans-serif'
    ctx.fillText('No snapshots in this range', 12, 30)
    chartPoints = []
    chartLegend.textContent = 'Latest: no data'
    return
  }

  const padding = { left: 60, right: 20, top: 24, bottom: 36 }
  const width = rect.width - padding.left - padding.right
  const height = rect.height - padding.top - padding.bottom
  const prices = chartSnapshots.map((s) => getMaxSlot(s)?.price || 0)
  const maxPrice = Math.max(...prices, 1)

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
    ctx.fillStyle = '#1f2933'
    ctx.beginPath()
    ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2)
    ctx.fill()
  })

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
  chartLegend.textContent = lastMax
    ? `Latest: ${formatPrice(lastMax.price)} (${formatNumber(lastMax.amountDelivered)}/${formatNumber(lastMax.amountOrdered)} delivered)`
    : 'Latest: no data'
}

function renderActiveSnapshot () {
  const filtered = getFilteredSnapshots()

  if (filtered.length === 0) {
    snapshotMeta.innerHTML = `
      <div><strong>Snapshot:</strong> —</div>
      <div><strong>Product:</strong> ${selectedProduct?.name || selectedProduct?.key || '—'}</div>
      <div><strong>Max price:</strong> n/a</div>
    `
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
  snapshotMeta.innerHTML = `
    <div><strong>Snapshot:</strong> ${new Date(snapshot.ts).toLocaleString()}</div>
    <div><strong>Product:</strong> ${selectedProduct?.name || snapshot.productName || snapshot.productKey}</div>
    <div><strong>Max price:</strong> ${max ? formatPrice(max.price) : 'n/a'}</div>
  `

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
    const fullTime = new Date(snapshot.ts).toLocaleString()
    tooltip.innerHTML = `
      <div><strong>Time:</strong> ${fullTime}</div>
      <div><strong>Price:</strong> ${max ? formatPrice(max.price) : 'n/a'}</div>
      <div><strong>Delivered:</strong> ${delivered}</div>
    `
    positionTooltip(closest.x, closest.y)

    renderChart()
  } else {
    hoverIndex = null
    tooltip.hidden = true
    renderChart()
  }
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
  renderChart()
})

async function init () {
  await loadItemsCatalog()
  initSidebarSections()
  renderRangeControls()
  trackButton.addEventListener('click', () => {
    trackSelectedProduct()
  })
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
  await loadQueueState()
  await loadSnapshots()
  setInterval(loadSnapshots, 30000)
  setInterval(loadQueueState, 15000)
}

init()
