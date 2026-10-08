// 学习室：课程 → 单元 → 课，一课是一叠内容块加课后小测。
// 标准答案只存在这里，前端拿到的题目不带答案；作答后由这里判分，判过的题才把答案和解析发回去。
// 简答题程序判不了，先记成「待批改」，由老师（Claude）用 tools/study_admin.py 批改。
import Database from 'better-sqlite3'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

export const STUDY_DB = process.env.STUDY_DB || join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'study.db')

const SCHEMA = `
CREATE TABLE IF NOT EXISTS study_course (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, goal TEXT DEFAULT '', profile TEXT DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS study_unit (
  id INTEGER PRIMARY KEY, course_id INTEGER NOT NULL REFERENCES study_course(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL, title TEXT NOT NULL, objective TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS study_lesson (
  id INTEGER PRIMARY KEY, unit_id INTEGER NOT NULL REFERENCES study_unit(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL, title TEXT NOT NULL, summary TEXT DEFAULT '', key_points TEXT DEFAULT '[]',
  est_minutes INTEGER, status TEXT NOT NULL DEFAULT 'draft', done_at TEXT, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS study_block (
  id INTEGER PRIMARY KEY, lesson_id INTEGER NOT NULL REFERENCES study_lesson(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS study_question (
  id INTEGER PRIMARY KEY, lesson_id INTEGER NOT NULL REFERENCES study_lesson(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL, type TEXT NOT NULL, stem TEXT NOT NULL, options TEXT DEFAULT '[]',
  answer TEXT NOT NULL DEFAULT 'null', explanation TEXT DEFAULT '', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS study_attempt (
  id INTEGER PRIMARY KEY, question_id INTEGER NOT NULL REFERENCES study_question(id) ON DELETE CASCADE,
  answer TEXT NOT NULL, result TEXT NOT NULL, feedback TEXT DEFAULT '', created_at TEXT NOT NULL, graded_at TEXT);
CREATE INDEX IF NOT EXISTS idx_study_attempt_q ON study_attempt(question_id, id);
CREATE TABLE IF NOT EXISTS study_wish (
  id INTEGER PRIMARY KEY, topic TEXT NOT NULL, note TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new', created_at TEXT NOT NULL, done_at TEXT);
`

let db = null
export function studyDb() {
  if (db) return db
  db = new Database(STUDY_DB)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
  // 开课前摸底：起点、终点、讲法，写课时照着定深度。老库没有这列就补上
  const cols = db.prepare('PRAGMA table_info(study_course)').all().map(c => c.name)
  if (!cols.includes('profile')) db.exec("ALTER TABLE study_course ADD COLUMN profile TEXT DEFAULT '{}'")
  // 批改结果看过没有：看过的不再在首页提醒
  const acols = db.prepare('PRAGMA table_info(study_attempt)').all().map(c => c.name)
  if (!acols.includes('seen_at')) db.exec('ALTER TABLE study_attempt ADD COLUMN seen_at TEXT')
  return db
}

const now = () => new Date().toISOString()
const parse = (s, d) => { try { return JSON.parse(s) } catch { return d } }
// 答案和标准答案都先去掉空白、统一大小写和全半角标点再比
const norm = (s) => String(s ?? '').normalize('NFKC').replace(/\s+/g, '').toLowerCase()
const SCORE = { correct: 1, partial: 0.5, incorrect: 0 }

// 能自动判的题当场判；简答题记成待批改
function grade(q, given) {
  const key = parse(q.answer, null)
  switch (q.type) {
    case 'single':
    case 'true_false':
      return norm(given) === norm(key) ? 'correct' : 'incorrect'
    case 'multiple': {
      const a = new Set((Array.isArray(given) ? given : []).map(norm))
      const b = new Set((Array.isArray(key) ? key : []).map(norm))
      if (a.size === b.size && [...a].every(x => b.has(x))) return 'correct'
      return [...a].some(x => b.has(x)) && [...a].every(x => b.has(x)) ? 'partial' : 'incorrect'
    }
    case 'fill':
      return (Array.isArray(key) ? key : [key]).some(k => norm(k) === norm(given)) ? 'correct' : 'incorrect'
    default:
      return 'pending'
  }
}

function latestAttempts(d, lessonIds) {
  if (!lessonIds.length) return new Map()
  const rows = d.prepare(
    `SELECT a.*, q.lesson_id FROM study_attempt a JOIN study_question q ON q.id = a.question_id
     WHERE q.lesson_id IN (${lessonIds.map(() => '?').join(',')})
       AND a.id = (SELECT MAX(id) FROM study_attempt WHERE question_id = a.question_id)`
  ).all(...lessonIds)
  return new Map(rows.map(r => [r.question_id, r]))
}

// 一课的进度：答过几题、得分（判过的题按 对1 半对0.5 错0 平均）
function progressOf(questions, latest) {
  const done = questions.filter(q => latest.has(q.id))
  const graded = done.map(q => latest.get(q.id)).filter(a => a.result in SCORE)
  const score = graded.length ? graded.reduce((s, a) => s + SCORE[a.result], 0) / graded.length : null
  return { total: questions.length, answered: done.length, score }
}

function publicQuestion(q, a) {
  const out = { id: q.id, idx: q.idx, type: q.type, stem: q.stem, options: parse(q.options, []) }
  if (a) {
    out.attempt = { answer: parse(a.answer, null), result: a.result, feedback: a.feedback, at: a.created_at }
    // 判过了才给答案和解析；待批改的不给，免得看了答案再改
    if (a.result !== 'pending') { out.answer = parse(q.answer, null); out.explanation = q.explanation }
  }
  return out
}

// 按服务器所在时区算是哪一天
const dayOf = (iso) => new Date(iso).toLocaleDateString('sv-SE')

// 一门课接着学哪一课：上次动过的那课没学完就回那课，否则往后找第一课写好了还没学完的
function nextOf(lessons, lastId) {
  const at = lessons.findIndex(l => l.id === lastId)
  if (at >= 0 && lessons[at].status === 'ready') return { lesson: lessons[at], waiting: null }
  const after = [...lessons.slice(at + 1), ...lessons.slice(0, at + 1)]
  const ready = after.find(l => l.status === 'ready')
  if (ready) return { lesson: ready, waiting: null }
  return { lesson: null, waiting: lessons.find(l => l.status === 'draft') || null }
}

// 首页：接着学、统计、错题、批改回来的、想学的、所有课
function homeOf(d) {
  const courses = d.prepare("SELECT id, title, goal, profile, status, updated_at FROM study_course WHERE status != 'archived' ORDER BY updated_at DESC").all()
  const lessons = d.prepare(
    `SELECT l.id, l.idx, l.title, l.status, l.done_at, u.course_id, u.idx AS unit_idx
     FROM study_lesson l JOIN study_unit u ON u.id = l.unit_id ORDER BY u.course_id, u.idx, l.idx`
  ).all()
  const attempts = d.prepare(
    `SELECT a.id, a.question_id, a.result, a.created_at, q.lesson_id FROM study_attempt a
     JOIN study_question q ON q.id = a.question_id ORDER BY a.id`
  ).all()
  const byId = new Map(lessons.map(l => [l.id, l]))

  // 每门课最后动过的那课：作答或点学完，取最晚的
  const lastAct = new Map()
  const touch = (lid, at) => {
    const l = byId.get(lid)
    if (!l || !at) return
    const cur = lastAct.get(l.course_id)
    if (!cur || at > cur.at) lastAct.set(l.course_id, { id: lid, at })
  }
  for (const a of attempts) touch(a.lesson_id, a.created_at)
  for (const l of lessons) touch(l.id, l.done_at)

  const items = courses.map(c => {
    const ls = lessons.filter(l => l.course_id === c.id)
    const last = lastAct.get(c.id)
    const { lesson, waiting } = nextOf(ls, last?.id)
    const brief = (l) => l && { id: l.id, no: `${l.unit_idx}.${l.idx}`, title: l.title }
    return {
      id: c.id, title: c.title, goal: c.goal, profile: parse(c.profile, {}),
      lessons: ls.length, done: ls.filter(l => l.status === 'done').length,
      last_at: last?.at || null, last: brief(last && byId.get(last.id)),
      next: brief(lesson), waiting: brief(waiting),
    }
  }).sort((a, b) => (b.last_at || '').localeCompare(a.last_at || ''))

  // 统计：每题只看最后一次作答
  const latest = new Map()
  for (const a of attempts) latest.set(a.question_id, a)
  const graded = [...latest.values()].filter(a => a.result in SCORE)
  const days = new Map()
  for (const a of attempts) days.set(dayOf(a.created_at), (days.get(dayOf(a.created_at)) || 0) + 1)
  for (const l of lessons) if (l.done_at) days.set(dayOf(l.done_at), (days.get(dayOf(l.done_at)) || 0) + 1)
  const today = dayOf(now())
  const back = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return dayOf(d.toISOString()) }
  let streak = 0
  for (let i = days.has(today) ? 0 : 1; days.has(back(i)); i++) streak++
  const stats = {
    lessons_done: lessons.filter(l => l.status === 'done').length,
    answered: latest.size,
    accuracy: graded.length ? graded.reduce((s, a) => s + SCORE[a.result], 0) / graded.length : null,
    streak,
    days: Array.from({ length: 14 }, (_, i) => { const day = back(13 - i); return { day, n: days.get(day) || 0 } }),
  }

  const wrongIds = [...latest.values()].filter(a => a.result === 'incorrect' || a.result === 'partial')
  const wrong = wrongIds.length ? d.prepare(
    `SELECT q.id, q.type, q.stem, q.lesson_id, l.title AS lesson_title, l.idx, u.idx AS unit_idx, u.course_id
     FROM study_question q JOIN study_lesson l ON l.id = q.lesson_id JOIN study_unit u ON u.id = l.unit_id
     WHERE q.id IN (${wrongIds.map(() => '?').join(',')})`
  ).all(...wrongIds.map(a => a.question_id)).map(q => {
    const a = latest.get(q.id)
    return { id: q.id, type: q.type, stem: q.stem, lesson_id: q.lesson_id, course_id: q.course_id,
      lesson: `${q.unit_idx}.${q.idx} ${q.lesson_title}`, result: a.result, at: a.created_at }
  }).sort((a, b) => b.at.localeCompare(a.at)) : []

  const returned = d.prepare(
    `SELECT a.id, a.result, a.feedback, a.graded_at, q.id AS question_id, q.stem, q.lesson_id, u.course_id,
       l.title AS lesson_title, l.idx, u.idx AS unit_idx
     FROM study_attempt a JOIN study_question q ON q.id = a.question_id
     JOIN study_lesson l ON l.id = q.lesson_id JOIN study_unit u ON u.id = l.unit_id
     WHERE q.type = 'short' AND a.graded_at IS NOT NULL AND a.seen_at IS NULL ORDER BY a.graded_at DESC`
  ).all().map(r => ({ id: r.id, result: r.result, feedback: r.feedback, at: r.graded_at, question_id: r.question_id,
    stem: r.stem, lesson_id: r.lesson_id, course_id: r.course_id, lesson: `${r.unit_idx}.${r.idx} ${r.lesson_title}` }))

  const wishes = d.prepare("SELECT id, topic, note, created_at FROM study_wish WHERE status = 'new' ORDER BY id DESC").all()
  return { courses: items, stats, wrong, returned, wishes }
}

// 还没批的简答，按课归拢：老师被叫去批改时看一眼是哪几课、各几道
export function pendingByLesson() {
  return studyDb().prepare(
    `SELECT u.idx AS unit, l.idx AS lesson, l.title, COUNT(*) AS n FROM study_attempt a
       JOIN study_question q ON q.id = a.question_id JOIN study_lesson l ON l.id = q.lesson_id
       JOIN study_unit u ON u.id = l.unit_id
     WHERE a.result = 'pending' GROUP BY l.id ORDER BY u.idx, l.idx`
  ).all()
}

// onPending：交了一道要老师批的简答
export function mountStudyRoutes(app, { onPending } = {}) {
  studyDb()  // 开机就建好表，study_admin.py 直接用
  app.get('/api/study/courses', (req, res) => {
    try {
      const d = studyDb()
      const items = d.prepare(
        `SELECT c.id, c.title, c.goal, c.status, c.updated_at,
           (SELECT COUNT(*) FROM study_lesson l JOIN study_unit u ON u.id = l.unit_id WHERE u.course_id = c.id) AS lessons,
           (SELECT COUNT(*) FROM study_lesson l JOIN study_unit u ON u.id = l.unit_id WHERE u.course_id = c.id AND l.status = 'done') AS done
         FROM study_course c WHERE c.status != 'archived' ORDER BY c.updated_at DESC`
      ).all()
      res.json({ items })
    } catch (e) { res.status(500).json({ error: e.message }) }
  })

  app.get('/api/study/courses/:id', (req, res) => {
    try {
      const d = studyDb()
      const course = d.prepare('SELECT * FROM study_course WHERE id = ?').get(req.params.id)
      if (!course) return res.status(404).json({ error: '没有这门课' })
      course.profile = parse(course.profile, {})
      const units = d.prepare('SELECT * FROM study_unit WHERE course_id = ? ORDER BY idx').all(course.id)
      const lessons = d.prepare(
        `SELECT l.id, l.unit_id, l.idx, l.title, l.summary, l.est_minutes, l.status
         FROM study_lesson l JOIN study_unit u ON u.id = l.unit_id WHERE u.course_id = ? ORDER BY u.idx, l.idx`
      ).all(course.id)
      const qs = lessons.length ? d.prepare(
        `SELECT id, lesson_id FROM study_question WHERE lesson_id IN (${lessons.map(() => '?').join(',')})`
      ).all(...lessons.map(l => l.id)) : []
      const latest = latestAttempts(d, lessons.map(l => l.id))
      for (const l of lessons) l.progress = progressOf(qs.filter(q => q.lesson_id === l.id), latest)
      res.json({ course, units: units.map(u => ({ ...u, lessons: lessons.filter(l => l.unit_id === u.id) })) })
    } catch (e) { res.status(500).json({ error: e.message }) }
  })

  app.get('/api/study/lessons/:id', (req, res) => {
    try {
      const d = studyDb()
      const lesson = d.prepare(
        'SELECT l.*, u.course_id, u.title AS unit_title, u.idx AS unit_idx FROM study_lesson l JOIN study_unit u ON u.id = l.unit_id WHERE l.id = ?'
      ).get(req.params.id)
      if (!lesson) return res.status(404).json({ error: '没有这一课' })
      lesson.key_points = parse(lesson.key_points, [])
      const blocks = d.prepare('SELECT id, idx, type, data FROM study_block WHERE lesson_id = ? ORDER BY idx').all(lesson.id)
        .map(b => ({ ...b, data: parse(b.data, {}) }))
      const qs = d.prepare('SELECT * FROM study_question WHERE lesson_id = ? ORDER BY idx').all(lesson.id)
      const latest = latestAttempts(d, [lesson.id])
      res.json({
        lesson, blocks,
        questions: qs.map(q => publicQuestion(q, latest.get(q.id))),
        progress: progressOf(qs, latest),
      })
    } catch (e) { res.status(500).json({ error: e.message }) }
  })

  app.post('/api/study/questions/:id/attempts', (req, res) => {
    try {
      const d = studyDb()
      const q = d.prepare('SELECT * FROM study_question WHERE id = ?').get(req.params.id)
      if (!q) return res.status(404).json({ error: '没有这道题' })
      const given = req.body?.answer
      if (given == null || (typeof given === 'string' && !given.trim()) || (Array.isArray(given) && !given.length)) {
        return res.status(400).json({ error: '还没作答' })
      }
      const result = grade(q, given)
      const at = now()
      const info = d.prepare(
        'INSERT INTO study_attempt (question_id, answer, result, created_at, graded_at) VALUES (?, ?, ?, ?, ?)'
      ).run(q.id, JSON.stringify(given), result, at, result === 'pending' ? null : at)
      const a = d.prepare('SELECT * FROM study_attempt WHERE id = ?').get(info.lastInsertRowid)
      if (result === 'pending') onPending?.()
      res.json({ question: publicQuestion(q, a) })
    } catch (e) { res.status(500).json({ error: e.message }) }
  })

  app.get('/api/study/home', (req, res) => {
    try { res.json(homeOf(studyDb())) } catch (e) { res.status(500).json({ error: e.message }) }
  })

  // 看过批改结果，首页就不再提醒
  app.post('/api/study/attempts/:id/seen', (req, res) => {
    try {
      studyDb().prepare('UPDATE study_attempt SET seen_at = COALESCE(seen_at, ?) WHERE id = ?').run(now(), req.params.id)
      res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
  })

  // 想学的主题，老师用 study_admin.py wishes 看到后摸底开课
  app.post('/api/study/wishes', (req, res) => {
    try {
      const topic = String(req.body?.topic || '').trim().slice(0, 200)
      if (!topic) return res.status(400).json({ error: '想学什么还没写' })
      const note = String(req.body?.note || '').trim().slice(0, 2000)
      const d = studyDb()
      const id = d.prepare('INSERT INTO study_wish (topic, note, created_at) VALUES (?, ?, ?)').run(topic, note, now()).lastInsertRowid
      res.json({ wish: d.prepare('SELECT id, topic, note, created_at FROM study_wish WHERE id = ?').get(id) })
    } catch (e) { res.status(500).json({ error: e.message }) }
  })

  app.delete('/api/study/wishes/:id', (req, res) => {
    try {
      studyDb().prepare("DELETE FROM study_wish WHERE id = ? AND status = 'new'").run(req.params.id)
      res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: e.message }) }
  })

  // 点「这课学完了」；再点一次撤回
  app.post('/api/study/lessons/:id/done', (req, res) => {
    try {
      const d = studyDb()
      const done = req.body?.done !== false
      const r = d.prepare(
        "UPDATE study_lesson SET status = ?, done_at = ?, updated_at = ? WHERE id = ? AND status != 'draft'"
      ).run(done ? 'done' : 'ready', done ? now() : null, now(), req.params.id)
      if (!r.changes) return res.status(404).json({ error: '这一课还没写好' })
      d.prepare('UPDATE study_course SET updated_at = ? WHERE id = (SELECT course_id FROM study_unit WHERE id = (SELECT unit_id FROM study_lesson WHERE id = ?))')
        .run(now(), req.params.id)
      res.json({ ok: true, status: done ? 'done' : 'ready' })
    } catch (e) { res.status(500).json({ error: e.message }) }
  })
}
