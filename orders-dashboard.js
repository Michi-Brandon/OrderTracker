const http = require('http')
const fs = require('fs')
const path = require('path')
const MinecraftData = require('minecraft-data')

const port = Number(process.env.DASHBOARD_PORT || 3008)
const mcVersion = process.env.MC_VERSION || '1.20.2'
const dataPath = path.join(__dirname, 'orders-snapshots.jsonl')
const allDataPath = path.join(__dirname, 'orders-all.jsonl')
const publicDir = path.join(__dirname, 'dashboard')
const texturesBase = path.join(__dirname, 'node_modules', 'prismarine-viewer', 'public', 'textures', '1.20.1')
const textureRoot = path.join(texturesBase, 'items')
const blockTextureRoot = path.join(texturesBase, 'blocks')
const itemsTexturesPath = path.join(texturesBase, 'items_textures.json')
const blocksTexturesPath = path.join(texturesBase, 'blocks_textures.json')
const textureContentPath = path.join(texturesBase, 'texture_content.json')
const placeholderPath = path.join(publicDir, 'item-placeholder.svg')

const minecraft = MinecraftData(mcVersion)
const itemsCatalog = minecraft.itemsArray.map((item) => ({
  name: item.name,
  displayName: item.displayName
}))

const recipesCache = new Map()
const itemTextureMap = new Map()
const blockTextureMap = new Map()
const inlineTextureMap = new Map()

// Grupo de tarea: carga de indices de texturas y resolucion de archivos.
function loadTextureIndex (filePath, targetMap) {
  if (!fs.existsSync(filePath)) return
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    const entries = JSON.parse(raw)
    if (!Array.isArray(entries)) return
    for (const entry of entries) {
      if (!entry || typeof entry.name !== 'string') continue
      if (!entry.texture || typeof entry.texture !== 'string') continue
      targetMap.set(entry.name, entry.texture)
    }
  } catch (err) {
    console.warn('Failed to load texture index:', err && err.message ? err.message : err)
  }
}

function loadInlineTextures (filePath, targetMap) {
  if (!fs.existsSync(filePath)) return
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    const entries = JSON.parse(raw)
    if (!Array.isArray(entries)) return
    for (const entry of entries) {
      if (!entry || typeof entry.name !== 'string') continue
      if (!entry.texture || typeof entry.texture !== 'string') continue
      if (!entry.texture.startsWith('data:image')) continue
      targetMap.set(entry.name, entry.texture)
    }
  } catch (err) {
    console.warn('Failed to load inline textures:', err && err.message ? err.message : err)
  }
}

function resolveTextureFile (texture) {
  if (!texture || typeof texture !== 'string') return null
  let cleaned = texture.replace(/^minecraft:/, '').replace(/^textures\//, '')
  cleaned = cleaned.replace(/^\/+/, '')

  const tryPath = (root, name) => {
    if (!name) return null
    const filePath = path.join(root, `${name}.png`)
    return fs.existsSync(filePath) ? filePath : null
  }

  if (cleaned.startsWith('block/')) return tryPath(blockTextureRoot, cleaned.slice('block/'.length))
  if (cleaned.startsWith('blocks/')) return tryPath(blockTextureRoot, cleaned.slice('blocks/'.length))
  if (cleaned.startsWith('item/')) return tryPath(textureRoot, cleaned.slice('item/'.length))
  if (cleaned.startsWith('items/')) return tryPath(textureRoot, cleaned.slice('items/'.length))

  if (cleaned.includes('/')) {
    const parts = cleaned.split('/')
    const last = parts[parts.length - 1]
    return tryPath(textureRoot, last) || tryPath(blockTextureRoot, last)
  }

  return tryPath(textureRoot, cleaned) || tryPath(blockTextureRoot, cleaned)
}

function serveInlineTexture (res, dataUrl) {
  const base64 = dataUrl.split(',')[1]
  if (!base64) {
    res.writeHead(404)
    res.end('Not found')
    return
  }
  const buffer = Buffer.from(base64, 'base64')
  res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' })
  res.end(buffer)
}

loadTextureIndex(itemsTexturesPath, itemTextureMap)
loadTextureIndex(blocksTexturesPath, blockTextureMap)
loadInlineTextures(textureContentPath, inlineTextureMap)

/*
 * Tarea: construir payload simple de receta desde minecraft-data.
 * Input: item key (ej. "diamond_sword").
 * Output: `{ result, ingredients }` o `null` si no hay receta.
 * Uso: endpoint `/api/recipe` para calculos de craft/margen en dashboard.
 */
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

/*
 * Tarea: leer un JSONL y devolver entradas ordenadas por timestamp.
 * Input: path del archivo.
 * Output: array de objetos parseados (lineas invalidas se ignoran).
 * Uso: `/api/snapshots` y `/api/all`.
 */
function readJsonlSorted (filePath) {
  if (!fs.existsSync(filePath)) return []
  const raw = fs.readFileSync(filePath, 'utf8')
  const lines = raw.split(/\r?\n/).filter((line) => line.trim() !== '')
  const rows = []
  for (const line of lines) {
    try {
      rows.push(JSON.parse(line))
    } catch (err) {
      // ignore bad lines
    }
  }
  rows.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
  return rows
}

function readSnapshots () {
  return readJsonlSorted(dataPath)
}

function readAllPages () {
  return readJsonlSorted(allDataPath)
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

// Grupo de tarea: ruteo HTTP para APIs del dashboard + archivos estaticos.
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
    const inline = inlineTextureMap.get(key)
    if (inline) {
      serveInlineTexture(res, inline)
      return
    }
    const itemPath = path.join(textureRoot, `${key}.png`)
    const blockPath = path.join(blockTextureRoot, `${key}.png`)
    if (fs.existsSync(itemPath)) {
      serveFile(res, itemPath)
    } else if (fs.existsSync(blockPath)) {
      serveFile(res, blockPath)
    } else {
      const mappedTexture = itemTextureMap.get(key) || blockTextureMap.get(key)
      const resolved = resolveTextureFile(mappedTexture)
      if (resolved) {
        serveFile(res, resolved)
        return
      }
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
