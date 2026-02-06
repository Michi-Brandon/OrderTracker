const http = require('http')
const fs = require('fs')
const path = require('path')
const MinecraftData = require('minecraft-data')

const port = Number(process.env.DASHBOARD_PORT || 3008)
const mcVersion = process.env.MC_VERSION || '1.20.2'
const dataPath = path.join(__dirname, 'orders-snapshots.jsonl')
const allDataPath = path.join(__dirname, 'orders-all.jsonl')
const publicDir = path.join(__dirname, 'dashboard')
const textureRoot = path.join(__dirname, 'node_modules', 'prismarine-viewer', 'public', 'textures', '1.20.1', 'items')
const blockTextureRoot = path.join(__dirname, 'node_modules', 'prismarine-viewer', 'public', 'textures', '1.20.1', 'blocks')
const placeholderPath = path.join(publicDir, 'item-placeholder.svg')

const minecraft = MinecraftData(mcVersion)
const itemsCatalog = minecraft.itemsArray.map((item) => ({
  name: item.name,
  displayName: item.displayName
}))

const recipesCache = new Map()

function buildRecipe (itemName) {
  if (!itemName) return null
  if (recipesCache.has(itemName)) return recipesCache.get(itemName)

  const item = minecraft.itemsByName[itemName]
  if (!item) {
    recipesCache.set(itemName, null)
    return null
  }

  const recipes = minecraft.recipes[item.id]
  if (!recipes || recipes.length === 0) {
    recipesCache.set(itemName, null)
    return null
  }

  const recipe = recipes[0]
  const counts = new Map()

  if (recipe.inShape) {
    for (const row of recipe.inShape) {
      for (const id of row) {
        if (!id || id <= 0) continue
        counts.set(id, (counts.get(id) || 0) + 1)
      }
    }
  } else if (recipe.ingredients) {
    for (const id of recipe.ingredients) {
      if (!id || id <= 0) continue
      counts.set(id, (counts.get(id) || 0) + 1)
    }
  }

  const ingredients = []
  for (const [id, count] of counts.entries()) {
    const ingredient = minecraft.items[id]
    if (!ingredient) continue
    ingredients.push({
      name: ingredient.name,
      displayName: ingredient.displayName,
      count
    })
  }

  const resultCount = recipe.result?.count || 1
  const payload = {
    result: {
      name: item.name,
      displayName: item.displayName,
      count: resultCount
    },
    ingredients
  }

  recipesCache.set(itemName, payload)
  return payload
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
}

function readSnapshots () {
  if (!fs.existsSync(dataPath)) return []
  const raw = fs.readFileSync(dataPath, 'utf8')
  const lines = raw.split(/\r?\n/).filter((line) => line.trim() !== '')
  const snapshots = []
  for (const line of lines) {
    try {
      snapshots.push(JSON.parse(line))
    } catch (err) {
      // ignore bad lines
    }
  }
  snapshots.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
  return snapshots
}

function readAllPages () {
  if (!fs.existsSync(allDataPath)) return []
  const raw = fs.readFileSync(allDataPath, 'utf8')
  const lines = raw.split(/\r?\n/).filter((line) => line.trim() !== '')
  const pages = []
  for (const line of lines) {
    try {
      pages.push(JSON.parse(line))
    } catch (err) {
      // ignore bad lines
    }
  }
  pages.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
  return pages
}

function sendJson (res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  })
  res.end(body)
}

function serveFile (res, filePath) {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404)
    res.end('Not found')
    return
  }
  const ext = path.extname(filePath)
  const type = mimeTypes[ext] || 'application/octet-stream'
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' })
  fs.createReadStream(filePath).pipe(res)
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)

  if (url.pathname === '/api/snapshots') {
    const snapshots = readSnapshots()
    sendJson(res, 200, snapshots)
    return
  }

  if (url.pathname === '/api/all') {
    const pages = readAllPages()
    sendJson(res, 200, pages)
    return
  }

  if (url.pathname === '/api/items') {
    sendJson(res, 200, itemsCatalog)
    return
  }

  if (url.pathname === '/api/recipe') {
    const key = (url.searchParams.get('item') || '').toLowerCase()
    if (!key) {
      sendJson(res, 400, { ok: false, error: 'Missing item' })
      return
    }
    const recipe = buildRecipe(key)
    sendJson(res, 200, recipe || { result: null, ingredients: [] })
    return
  }

  if (url.pathname.startsWith('/item/')) {
    const raw = decodeURIComponent(url.pathname.slice('/item/'.length))
    const base = raw.replace(/\.png$/i, '')
    const key = base.toLowerCase().replace(/[^a-z0-9_\-]/g, '')
    const itemPath = path.join(textureRoot, `${key}.png`)
    const blockPath = path.join(blockTextureRoot, `${key}.png`)
    if (fs.existsSync(itemPath)) {
      serveFile(res, itemPath)
    } else if (fs.existsSync(blockPath)) {
      serveFile(res, blockPath)
    } else {
      serveFile(res, placeholderPath)
    }
    return
  }

  if (url.pathname === '/' || url.pathname === '/index.html') {
    serveFile(res, path.join(publicDir, 'index.html'))
    return
  }

  if (url.pathname === '/app.js' || url.pathname === '/style.css' || url.pathname === '/item-placeholder.svg') {
    serveFile(res, path.join(publicDir, url.pathname.slice(1)))
    return
  }

  res.writeHead(404)
  res.end('Not found')
})

server.listen(port, () => {
  console.log(`Orders dashboard running at http://localhost:${port}`)
})
