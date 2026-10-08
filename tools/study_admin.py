#!/usr/bin/env python3
"""学习室的老师工具：排课、写课、看待批改的简答、批改。表由 server/study.js 建（npm start 时建好）。

  study_admin.py show [课程id]                 课程列表，或一门课的大纲和进度
  study_admin.py course-import 文件.json       导入一门课的骨架（单元、课），新建
  study_admin.py course-profile 课程id 文件.json  改一门课的摸底（起点、终点、讲法）
  study_admin.py lesson 课id                   读出一课的讲义和小测（答课上提问时用）
  study_admin.py lesson-set 课id 文件.json     写一课：内容块、小测，写完这课就能上
  study_admin.py pending                       待批改的简答
  study_admin.py grade 作答id 结果 [评语]      批改简答，结果是 correct / partial / incorrect
  study_admin.py wishes [id done]              首页「我想学」写下的主题；开了课就标 done

骨架 JSON：{"title","goal","profile":{"start","goal","style"},"units":[{"title","objective","lessons":[{"title","summary","key_points":[],"est_minutes"}]}]}
一课 JSON：{"summary"?, "key_points"?, "est_minutes"?,
           "blocks":[{"type":"text|callout|code|figure","data":{...}}],
           "questions":[{"type":"single|multiple|true_false|fill|short","stem","options":[],"answer","explanation"}]}
  text {md}；callout {md, tone: note|warn|key}；code {lang, code, caption}；figure {src, caption}
  讲义 md 的强调各管一种：**词** 是要记住的术语（荧光底），*词* 是要当心的地方（酒红下划线），`x` 是专有名称，[文字](网址) 是链接（虚线加 ↗，引用资料要带原文链接）；
  列表项开头的 **小标题**： 不画底。callout 的 tone：key 要点（金线）、warn 当心（酒红线）、note 旁注、例子（灰底）
  single/true_false 的 answer 是选项原文；multiple 是选项原文数组；fill 是可接受答案数组；short 的 answer 写参考答案，给批改时看
"""
import json, os, sqlite3, sys
from datetime import datetime, timezone
from pathlib import Path

DB = Path(os.environ.get("STUDY_DB") or Path(__file__).resolve().parent.parent / "data" / "study.db")
TYPES_B = {"text", "callout", "code", "figure"}
TYPES_Q = {"single", "multiple", "true_false", "fill", "short"}


def now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def conn():
    if not DB.exists():
        sys.exit(f"{DB} 不存在：先 npm start 跑一次服务，它会建好表")
    c = sqlite3.connect(DB)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys = ON")
    return c


def show(cid=None):
    c = conn()
    if cid is None:
        for r in c.execute("SELECT id, title, status FROM study_course ORDER BY id"):
            print(f"{r['id']}  {r['title']}  [{r['status']}]")
        return
    co = c.execute("SELECT * FROM study_course WHERE id=?", (cid,)).fetchone()
    if not co:
        sys.exit("没有这门课")
    print(f"{co['title']}\n目标：{co['goal']}")
    pf = json.loads(co["profile"] or "{}")
    for k, name in (("start", "起点"), ("goal", "终点"), ("style", "讲法")):
        if pf.get(k):
            print(f"{name}：{pf[k]}")
    for u in c.execute("SELECT * FROM study_unit WHERE course_id=? ORDER BY idx", (cid,)):
        print(f"\n第{u['idx']}单元 {u['title']}（{u['objective']}）")
        for l in c.execute("SELECT * FROM study_lesson WHERE unit_id=? ORDER BY idx", (u["id"],)):
            nb = c.execute("SELECT COUNT(*) FROM study_block WHERE lesson_id=?", (l["id"],)).fetchone()[0]
            nq = c.execute("SELECT COUNT(*) FROM study_question WHERE lesson_id=?", (l["id"],)).fetchone()[0]
            print(f"  课{l['id']}  {u['idx']}.{l['idx']} {l['title']}  [{l['status']}] 块{nb} 题{nq}")


def course_import(path):
    d = json.loads(Path(path).read_text())
    c = conn()
    with c:
        cid = c.execute("INSERT INTO study_course(title, goal, profile, created_at, updated_at) VALUES(?,?,?,?,?)",
                        (d["title"], d.get("goal", ""), json.dumps(d.get("profile", {}), ensure_ascii=False),
                         now(), now())).lastrowid
        for i, u in enumerate(d.get("units", []), 1):
            uid = c.execute("INSERT INTO study_unit(course_id, idx, title, objective) VALUES(?,?,?,?)",
                            (cid, i, u["title"], u.get("objective", ""))).lastrowid
            for j, l in enumerate(u.get("lessons", []), 1):
                c.execute("INSERT INTO study_lesson(unit_id, idx, title, summary, key_points, est_minutes, updated_at)"
                          " VALUES(?,?,?,?,?,?,?)",
                          (uid, j, l["title"], l.get("summary", ""), json.dumps(l.get("key_points", []), ensure_ascii=False),
                           l.get("est_minutes"), now()))
    print(f"已建课程 {cid}")
    show(cid)


def course_profile(cid, path):
    pf = json.loads(Path(path).read_text())
    c = conn()
    with c:
        n = c.execute("UPDATE study_course SET profile=?, updated_at=? WHERE id=?",
                      (json.dumps(pf, ensure_ascii=False), now(), cid)).rowcount
    if not n:
        sys.exit("没有这门课")
    show(cid)


def lesson(lid):
    c = conn()
    l = c.execute("SELECT l.*, u.idx AS uidx FROM study_lesson l JOIN study_unit u ON u.id=l.unit_id WHERE l.id=?",
                  (lid,)).fetchone()
    if not l:
        sys.exit("没有这一课")
    print(f"{l['uidx']}.{l['idx']} {l['title']}\n{l['summary']}\n")
    for b in c.execute("SELECT type, data FROM study_block WHERE lesson_id=? ORDER BY idx", (lid,)):
        d = json.loads(b["data"])
        if b["type"] == "text":
            print(d.get("md", ""))
        elif b["type"] == "callout":
            print(f"[{d.get('tone', 'note')}] {d.get('md', '')}")
        elif b["type"] == "code":
            print(f"```{d.get('lang', '')}\n{d.get('code', '')}\n```")
        else:
            print(f"[图] {d.get('caption', '')}")
        print()
    for q in c.execute("SELECT * FROM study_question WHERE lesson_id=? ORDER BY idx", (lid,)):
        print(f"题{q['idx']}（{q['type']}）{q['stem']}\n  答案：{json.loads(q['answer'])}")


def lesson_set(lid, path):
    d = json.loads(Path(path).read_text())
    for b in d.get("blocks", []):
        if b["type"] not in TYPES_B:
            sys.exit(f"不认识的内容块类型 {b['type']}")
    for q in d.get("questions", []):
        if q["type"] not in TYPES_Q:
            sys.exit(f"不认识的题型 {q['type']}")
        if q["type"] in ("single", "true_false") and q["answer"] not in q.get("options", []):
            sys.exit(f"答案不在选项里：{q['stem'][:20]}")
        if q["type"] == "multiple" and not set(q["answer"]) <= set(q.get("options", [])):
            sys.exit(f"答案不在选项里：{q['stem'][:20]}")
    c = conn()
    if not c.execute("SELECT 1 FROM study_lesson WHERE id=?", (lid,)).fetchone():
        sys.exit("没有这一课")
    answered = c.execute("SELECT COUNT(*) FROM study_attempt a JOIN study_question q ON q.id=a.question_id"
                         " WHERE q.lesson_id=?", (lid,)).fetchone()[0]
    with c:
        c.execute("DELETE FROM study_block WHERE lesson_id=?", (lid,))
        for i, b in enumerate(d.get("blocks", []), 1):
            c.execute("INSERT INTO study_block(lesson_id, idx, type, data) VALUES(?,?,?,?)",
                      (lid, i, b["type"], json.dumps(b.get("data", {}), ensure_ascii=False)))
        if "questions" in d:
            if answered:
                print(f"这课已有 {answered} 次作答，小测不动，只换了内容块")
            else:
                c.execute("DELETE FROM study_question WHERE lesson_id=?", (lid,))
                for i, q in enumerate(d["questions"], 1):
                    c.execute("INSERT INTO study_question(lesson_id, idx, type, stem, options, answer, explanation, created_at)"
                              " VALUES(?,?,?,?,?,?,?,?)",
                              (lid, i, q["type"], q["stem"], json.dumps(q.get("options", []), ensure_ascii=False),
                               json.dumps(q.get("answer"), ensure_ascii=False), q.get("explanation", ""), now()))
        sets, args = ["status = CASE status WHEN 'draft' THEN 'ready' ELSE status END", "updated_at = ?"], [now()]
        for k in ("summary", "est_minutes"):
            if k in d:
                sets.append(f"{k} = ?"); args.append(d[k])
        if "key_points" in d:
            sets.append("key_points = ?"); args.append(json.dumps(d["key_points"], ensure_ascii=False))
        c.execute(f"UPDATE study_lesson SET {', '.join(sets)} WHERE id = ?", (*args, lid))
    print(f"课{lid} 写好了")


def pending():
    c = conn()
    rows = c.execute("SELECT a.id, a.answer, a.created_at, q.stem, q.answer AS ref, l.title FROM study_attempt a"
                     " JOIN study_question q ON q.id=a.question_id JOIN study_lesson l ON l.id=q.lesson_id"
                     " WHERE a.result='pending' ORDER BY a.id").fetchall()
    if not rows:
        print("没有待批改的")
    for r in rows:
        print(f"作答{r['id']}  《{r['title']}》 {r['created_at']}\n  题：{r['stem']}\n  参考：{json.loads(r['ref'])}"
              f"\n  作答：{json.loads(r['answer'])}\n")


def grade(aid, result, feedback=""):
    if result not in ("correct", "partial", "incorrect"):
        sys.exit("结果只能是 correct / partial / incorrect")
    c = conn()
    with c:
        n = c.execute("UPDATE study_attempt SET result=?, feedback=?, graded_at=? WHERE id=?",
                      (result, feedback, now(), aid)).rowcount
    print("批好了" if n else "没有这次作答")


def wishes(wid=None, op=None):
    c = conn()
    if wid is not None:
        if op != "done":
            sys.exit("用法：wishes id done")
        with c:
            n = c.execute("UPDATE study_wish SET status='done', done_at=? WHERE id=?", (now(), wid)).rowcount
        print("标好了" if n else "没有这条")
        return
    rows = c.execute("SELECT * FROM study_wish WHERE status='new' ORDER BY id").fetchall()
    if not rows:
        print("没有新的想学")
    for r in rows:
        print(f"{r['id']}  {r['topic']}  （{r['created_at'][:10]}）" + (f"\n    {r['note']}" if r["note"] else ""))


if __name__ == "__main__":
    a = sys.argv[1:]
    cmds = {"show": lambda: show(int(a[1]) if len(a) > 1 else None),
            "course-import": lambda: course_import(a[1]),
            "course-profile": lambda: course_profile(int(a[1]), a[2]),
            "lesson": lambda: lesson(int(a[1])),
            "lesson-set": lambda: lesson_set(int(a[1]), a[2]),
            "pending": pending,
            "wishes": lambda: wishes(int(a[1]) if len(a) > 1 else None, a[2] if len(a) > 2 else None),
            "grade": lambda: grade(int(a[1]), a[2], a[3] if len(a) > 3 else "")}
    if not a or a[0] not in cmds:
        sys.exit(__doc__)
    cmds[a[0]]()
