// 学习室的服务：读写 data/study.db，给页面提供 /api/study/*，顺带托管打包好的页面和讲义配图
import express from 'express'
import { existsSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { mountStudyRoutes, STUDY_DB } from './study.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.PORT) || 4173
const HOST = process.env.HOST || '127.0.0.1'

mkdirSync(dirname(STUDY_DB), { recursive: true })
const app = express()
app.use(express.json({ limit: '1mb' }))
mountStudyRoutes(app)

const dist = join(root, 'web', 'dist')
app.use('/fig', express.static(join(root, 'data', 'fig')))
if (existsSync(dist)) {
  app.use(express.static(dist))
  app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(join(dist, 'index.html')))
} else {
  app.get('/', (req, res) => res.type('text').send('页面还没打包：先运行 npm run build'))
}

app.listen(PORT, HOST, () => console.log(`学习室：http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}  数据库：${STUDY_DB}`))
