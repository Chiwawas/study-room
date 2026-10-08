import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Md } from "./Md";

// 学习室：首页是书房（接着学、统计、错题、批改回来的、想学的、所有课）；点进一门课是左边课表、右边讲义和课后小测。
// 课由老师（Claude，见 skill/study-room）写进数据库，这里只读和交答案
const API = "/api/study";
const LAST_KEY = "rc-study-lesson";
const FOLD_KEY = "rc-study-toc-folded";

const cn = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ");

// 两个小箭头图标（Lucide 的 chevron-left / chevrons-left）
const Chevron = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);
const ChevronLeft = () => <Chevron d="m15 18-6-6 6-6" />;
const ChevronsLeft = () => <Chevron d="m11 17-5-5 5-5M18 17l-5-5 5-5" />;

type Progress = { total: number; answered: number; score: number | null };
type Status = "draft" | "ready" | "done";
type LessonRow = { id: number; unit_id: number; idx: number; title: string; summary: string; est_minutes: number | null; status: Status; progress: Progress };
type Unit = { id: number; idx: number; title: string; objective: string; lessons: LessonRow[] };
type Course = { id: number; title: string; goal: string; profile?: { start?: string; goal?: string; style?: string } };
type Block = { id: number; type: "text" | "callout" | "code" | "figure"; data: Record<string, string> };
type Result = "correct" | "partial" | "incorrect" | "pending";
type Question = {
  id: number; idx: number; type: "single" | "multiple" | "true_false" | "fill" | "short"; stem: string; options: string[];
  attempt?: { answer: string | string[]; result: Result; feedback: string; at: string };
  answer?: string | string[]; explanation?: string;
};
type Lesson = {
  lesson: { id: number; idx: number; title: string; summary: string; key_points: string[]; est_minutes: number | null; status: Status; unit_idx: number; unit_title: string };
  blocks: Block[]; questions: Question[]; progress: Progress;
};

async function call<T>(path: string, body?: object, method = body ? "POST" : "GET"): Promise<T> {
  const r = await fetch(API + path, body ? {
    method, credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  } : { method, credentials: "same-origin" });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}

// 上次看到哪一课，只是本机的方便，读写失败就从头开始
const lastLesson = () => { try { return Number(localStorage.getItem(LAST_KEY)) || null; } catch { return null; } };
const keepLesson = (id: number) => { try { localStorage.setItem(LAST_KEY, String(id)); } catch { /* 无痕窗口写不了 */ } };
const savedFold = () => { try { return localStorage.getItem(FOLD_KEY) === "1"; } catch { return false; } };

const CN = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
const cnNo = (n: number) => CN[n] ?? String(n);
const pct = (s: number | null) => (s == null ? "" : `${Math.round(s * 100)} 分`);

const RESULT: Record<Result, string> = { correct: "答对了", partial: "对了一部分", incorrect: "没答对", pending: "交给老师了，批完这里会显示" };
const SCORE: Partial<Record<Result, number>> = { correct: 1, partial: 0.5, incorrect: 0 };
const TONE: Record<string, string> = { key: "要点", warn: "注意", note: "旁注" };

function BlockView({ b }: { b: Block }) {
  const d = b.data;
  if (b.type === "text") return <Md text={d.md || ""} />;
  if (b.type === "callout") {
    const tone = TONE[d.tone] ? d.tone : "note";
    return (
      <aside className={cn("rc-study-callout", `is-${tone}`)}>
        <div className="rc-study-callout-tag">{TONE[tone]}</div>
        <Md text={d.md || ""} />
      </aside>
    );
  }
  if (b.type === "code") {
    return (
      <figure className="rc-study-fig">
        <pre className="rc-study-code"><code>{d.code}</code></pre>
        {d.caption ? <figcaption>{d.caption}</figcaption> : null}
      </figure>
    );
  }
  if (b.type === "figure") {
    return (
      <figure className="rc-study-fig">
        <img src={d.src} alt={d.caption || ""} loading="lazy" />
        {d.caption ? <figcaption>{d.caption}</figcaption> : null}
      </figure>
    );
  }
  return null;
}

const asList = (v: unknown) => (Array.isArray(v) ? v.map(String) : v == null ? [] : [String(v)]);

// 一道题：没答过或点了再做一次就是作答态；交了以后显示自己的答案、对错、标准答案和解析
function QuizItem({ q, n, onAnswered }: { q: Question; n: number; onAnswered: (q: Question) => void }) {
  const [again, setAgain] = useState(false);
  const [pick, setPick] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const choice = q.type === "single" || q.type === "true_false" || q.type === "multiple";
  const answering = !q.attempt || again;
  const ready = choice ? pick.length > 0 : !!text.trim();

  const toggle = (o: string) =>
    setPick(p => (q.type === "multiple" ? (p.includes(o) ? p.filter(x => x !== o) : [...p, o]) : [o]));

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true); setErr("");
    try {
      const answer = q.type === "multiple" ? pick : choice ? pick[0] : text.trim();
      const d = await call<{ question: Question }>(`/questions/${q.id}/attempts`, { answer });
      onAnswered(d.question);
      setAgain(false); setPick([]); setText("");
    } catch (e) {
      setErr((e as Error).message || "没交上，再试一次");
    } finally {
      setBusy(false);
    }
  };

  const given = asList(q.attempt?.answer);
  const key = asList(q.answer);
  const kind = q.type === "multiple" ? "多选" : q.type === "true_false" ? "判断" : q.type === "fill" ? "填空" : q.type === "short" ? "简答" : "单选";

  return (
    <li className="rc-quiz-item" id={`q-${q.id}`}>
      <div className="rc-quiz-stem">
        <span className="rc-quiz-n">{n}</span>
        <span className="rc-quiz-kind">{kind}</span>
        <span>{q.stem}</span>
      </div>

      {choice ? (
        <div className={cn("rc-quiz-opts", q.type === "true_false" && "is-row")} role={q.type === "multiple" ? "group" : "radiogroup"}>
          {q.options.map(o => {
            const mine = answering ? pick.includes(o) : given.includes(o);
            const right = !answering && q.answer != null && key.includes(o);
            const wrong = !answering && q.answer != null && mine && !right;
            return (
              <button
                key={o}
                type="button"
                disabled={!answering}
                role={q.type === "multiple" ? "checkbox" : "radio"}
                aria-checked={mine}
                onClick={() => toggle(o)}
                className={cn("rc-quiz-opt", mine && "is-mine", right && "is-right", wrong && "is-wrong", q.type === "multiple" && "is-multi")}
              >
                <i aria-hidden />
                <span>{o}</span>
              </button>
            );
          })}
        </div>
      ) : answering ? (
        q.type === "fill" ? (
          <input
            className="rc-quiz-input"
            value={text}
            placeholder="填在这里，回车交"
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) submit(); }}
          />
        ) : (
          <textarea className="rc-quiz-input is-long" rows={4} value={text} placeholder="用自己的话写，不用写很长" onChange={e => setText(e.target.value)} />
        )
      ) : (
        <div className="rc-quiz-given"><span className="rc-quiz-label">你答</span>{given.join("、")}</div>
      )}

      {answering ? (
        <div className="rc-quiz-actions">
          <button type="button" className="rc-study-btn" disabled={!ready || busy} onClick={submit}>{busy ? "交卷中…" : "交"}</button>
          {again ? <button type="button" className="rc-study-link" onClick={() => setAgain(false)}>算了，看上次的</button> : null}
          {err ? <span className="rc-quiz-err">{err}</span> : null}
        </div>
      ) : q.attempt ? (
        <div className={cn("rc-quiz-result", `is-${q.attempt.result}`)}>
          <div className="rc-quiz-verdict">
            <span>{RESULT[q.attempt.result]}</span>
            <button type="button" className="rc-study-link" onClick={() => setAgain(true)}>再做一次</button>
          </div>
          {q.attempt.feedback ? <div className="rc-quiz-note"><span className="rc-quiz-label">老师说</span>{q.attempt.feedback}</div> : null}
          {q.answer != null && !choice ? (
            <div className="rc-quiz-note"><span className="rc-quiz-label">{q.type === "short" ? "参考" : "答案"}</span>{key.join(" / ")}</div>
          ) : null}
          {q.explanation ? <div className="rc-quiz-note"><span className="rc-quiz-label">解析</span>{q.explanation}</div> : null}
        </div>
      ) : null}
    </li>
  );
}

// 讲义字号四档，记住上次选的
const FS_KEY = "rc-study-fs";
const FONT_SIZES: [number, string][] = [[13, "小"], [15, "中"], [17, "大"], [19, "特大"]];
const savedFs = () => { try { const n = Number(localStorage.getItem(FS_KEY)); return FONT_SIZES.some(([v]) => v === n) ? n : 15; } catch { return 15; } };

// 课题上方行尾的「Aa」，点开选字号；点别处或按 Esc 收起
function FontSize({ value, onPick }: { value: number; onPick: (n: number) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div className="rc-study-fs" ref={box}>
      <button type="button" className={cn("rc-study-fs-btn", open && "is-open")} aria-expanded={open} aria-label="字号" title="字号" onClick={() => setOpen(o => !o)}>Aa</button>
      {open ? (
        <div className="rc-study-fs-pop" role="group" aria-label="字号">
          {FONT_SIZES.map(([v, label]) => (
            <button key={v} type="button" aria-pressed={value === v} className={cn(value === v && "is-active")} onClick={() => onPick(v)}>{label}</button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function LessonView({ id, focusQ, onChanged }: { id: number; focusQ?: number; onChanged: () => void }) {
  const [data, setData] = useState<Lesson | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [fs, setFs] = useState(savedFs);
  const pickFs = (n: number) => { setFs(n); try { localStorage.setItem(FS_KEY, String(n)); } catch { /* 无痕窗口写不了 */ } };

  useEffect(() => {
    let live = true;
    setData(null); setErr("");
    call<Lesson>(`/lessons/${id}`).then(d => { if (live) setData(d); }).catch(e => { if (live) setErr(e.message); });
    return () => { live = false; };
  }, [id]);

  // 从首页的错题、批改点进来时，直接翻到那道题
  useEffect(() => {
    if (!data || !focusQ) return;
    const el = document.getElementById(`q-${focusQ}`);
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    el.classList.add("is-focus");
    const t = setTimeout(() => el.classList.remove("is-focus"), 2400);
    return () => clearTimeout(t);
  }, [data, focusQ]);

  const answered = (nq: Question) => {
    setData(d => d && { ...d, questions: d.questions.map(q => (q.id === nq.id ? nq : q)) });
    onChanged();
  };

  const markDone = async (done: boolean) => {
    setBusy(true);
    try {
      const r = await call<{ status: Status }>(`/lessons/${id}/done`, { done });
      setData(d => d && { ...d, lesson: { ...d.lesson, status: r.status } });
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (err && !data) return <div className="rc-study-empty">{err}</div>;
  if (!data) return <div className="rc-study-empty">翻开中…</div>;

  const { lesson, blocks, questions } = data;
  const draft = lesson.status === "draft";
  const nAns = questions.filter(q => q.attempt).length;
  const graded = questions.filter(q => q.attempt && q.attempt.result !== "pending");
  const score = graded.length ? graded.reduce((s, q) => s + (SCORE[q.attempt!.result] ?? 0), 0) / graded.length : null;

  return (
    <article className="rc-study-paper" style={{ "--rc-study-fs": `${fs}px` } as CSSProperties}>
      <header className="rc-study-head">
        <div className="rc-study-headline">
          <div className="rc-smallcaps">第{cnNo(lesson.unit_idx)}单元 · {lesson.unit_title}</div>
          <FontSize value={fs} onPick={pickFs} />
        </div>
        <h1 className="rc-study-title">
          <span className="rc-study-no">{lesson.unit_idx}.{lesson.idx}</span>
          {lesson.title}
        </h1>
        {lesson.summary ? <p className="rc-study-summary">{lesson.summary}</p> : null}
        <div className="rc-study-meta">
          {lesson.est_minutes ? <span>约 {lesson.est_minutes} 分钟</span> : null}
          {lesson.key_points.length ? <span>这课讲：{lesson.key_points.join(" · ")}</span> : null}
        </div>
      </header>

      {draft ? (
        <div className="rc-study-empty is-inline">这一课老师还没写好。</div>
      ) : (
        <>
          <div className="rc-study-body">
            {blocks.map(b => <BlockView key={b.id} b={b} />)}
          </div>

          {questions.length ? (
            <section className="rc-quiz" aria-label="课后小测">
              <div className="rc-quiz-head">
                <h2>课后小测</h2>
                <span className="rc-quiz-tally">已答 {nAns} / {questions.length}{score != null ? ` · ${pct(score)}` : ""}</span>
              </div>
              <ol>
                {questions.map((q, i) => <QuizItem key={q.id} q={q} n={i + 1} onAnswered={answered} />)}
              </ol>
            </section>
          ) : null}

          <footer className="rc-study-foot">
            {lesson.status === "done" ? (
              <>
                <span className="rc-study-done">这课学完了</span>
                <button type="button" className="rc-study-link" disabled={busy} onClick={() => markDone(false)}>撤回</button>
              </>
            ) : (
              <button type="button" className="rc-study-btn is-wide" disabled={busy} onClick={() => markDone(true)}>这课学完了</button>
            )}
            {err ? <span className="rc-quiz-err">{err}</span> : null}
          </footer>
        </>
      )}
    </article>
  );
}

type Open = { course: number; lesson?: number; question?: number };

function CourseView({ go, onHome }: { go: Open; onHome: () => void }) {
  const [course, setCourse] = useState<{ course: Course; units: Unit[] } | null | undefined>(undefined);
  const [err, setErr] = useState("");
  const [current, setCurrent] = useState<number | null>(go.lesson ?? null);
  // 课表可以收起来，讲义就宽一些；收没收记在本机
  const [folded, setFolded] = useState(savedFold);
  const fold = (v: boolean) => { setFolded(v); try { localStorage.setItem(FOLD_KEY, v ? "1" : "0"); } catch { /* 无痕窗口写不了 */ } };

  const loadCourse = useCallback(async () => {
    try {
      setCourse(await call<{ course: Course; units: Unit[] }>(`/courses/${go.course}`));
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [go.course]);
  useEffect(() => { loadCourse(); }, [loadCourse]);

  const rows = course ? course.units.flatMap(u => u.lessons) : [];

  // 先回到上次看的那课；没有就翻到第一节还没学完的写好了的课
  useEffect(() => {
    if (current != null || !rows.length) return;
    const last = lastLesson();
    const pick = rows.find(l => l.id === last) ?? rows.find(l => l.status === "ready") ?? rows[0];
    setCurrent(pick.id);
  }, [rows, current]);

  const open = (id: number) => { setCurrent(id); keepLesson(id); };

  if (err && !course) return <div className="rc-study-empty">学习室没打开：{err}</div>;
  if (course === undefined) return <div className="rc-study-empty">翻开中…</div>;
  if (course === null) return <div className="rc-study-empty">没有这门课。</div>;

  const doneN = rows.filter(l => l.status === "done").length;

  return (
    <div className="rc-study">
      {folded ? (
        <button type="button" className="rc-study-rail" onClick={() => fold(false)} aria-label="展开课表" title="展开课表">
          <span>课表</span>
        </button>
      ) : (
      <nav className="rc-study-toc" aria-label="课表">
        <button type="button" className="rc-study-back" onClick={onHome}><ChevronLeft />所有课程</button>
        <div className="rc-study-course">{course.course.title}</div>
        {course.course.profile?.start && course.course.profile?.goal ? (
          <div className="rc-study-path" title={course.course.profile.style || undefined}>
            {course.course.profile.start}<span aria-hidden="true">→</span>{course.course.profile.goal}
          </div>
        ) : null}
        <div className="rc-study-toc-head">
          <div className="rc-study-count">学完 {doneN} / {rows.length}</div>
          <button type="button" className="rc-study-fold" onClick={() => fold(true)} title="收起课表"><ChevronsLeft />收起</button>
        </div>
        {course.units.map(u => (
          <section key={u.id} className="rc-study-unit">
            <div className="rc-study-unit-name"><span>{cnNo(u.idx)}</span>{u.title}</div>
            <ul>
              {u.lessons.map(l => (
                <li key={l.id}>
                  <button
                    type="button"
                    onClick={() => open(l.id)}
                    aria-current={current === l.id ? "page" : undefined}
                    className={cn("rc-study-lesson", `is-${l.status}`, current === l.id && "is-active")}
                  >
                    <span className="rc-study-lesson-no">{u.idx}.{l.idx}</span>
                    <span className="rc-study-lesson-title">{l.title}</span>
                    <span className="rc-study-lesson-state">
                      {l.status === "done" ? "✓" : l.status !== "draft" && l.progress.answered ? `${l.progress.answered}/${l.progress.total}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </nav>
      )}
      <div className="rc-study-read">
        {current != null ? <LessonView key={current} id={current} focusQ={current === go.lesson ? go.question : undefined} onChanged={loadCourse} /> : null}
      </div>
    </div>
  );
}

// 网址带 ?course=1&lesson=2 时直接打开那门课那一课（自检截图用）
const linked = (): Open | null => {
  const q = new URLSearchParams(location.search);
  const course = Number(q.get("course"));
  return course ? { course, lesson: Number(q.get("lesson")) || undefined } : null;
};

// 学习室入口：先到书房，点哪门课、哪一课就翻过去
export function Study() {
  const [go, setGo] = useState<Open | null>(linked);
  const open = (o: Open) => { if (o.lesson) keepLesson(o.lesson); setGo(o); };
  return go ? <CourseView key={`${go.course}-${go.lesson}-${go.question}`} go={go} onHome={() => setGo(null)} /> : <Home onOpen={open} />;
}

type Brief = { id: number; no: string; title: string };
type CourseCard = {
  id: number; title: string; goal: string; profile: Course["profile"]; lessons: number; done: number;
  last_at: string | null; last: Brief | null; next: Brief | null; waiting: Brief | null;
};
type Wrong = { id: number; type: Question["type"]; stem: string; lesson_id: number; course_id: number; lesson: string; result: Result; at: string };
type Returned = { id: number; result: Result; feedback: string; at: string; question_id: number; stem: string; lesson_id: number; course_id: number; lesson: string };
type Wish = { id: number; topic: string; note: string; created_at: string };
type HomeData = {
  courses: CourseCard[];
  stats: { lessons_done: number; answered: number; accuracy: number | null; streak: number; days: { day: string; n: number }[] };
  wrong: Wrong[]; returned: Returned[]; wishes: Wish[];
};

const ago = (iso: string | null) => {
  if (!iso) return "";
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86400e3);
  return days <= 0 ? "今天" : days === 1 ? "昨天" : `${days} 天前`;
};
const WRONG_SHOWN = 6;

function Home({ onOpen }: { onOpen: (o: Open) => void }) {
  const [data, setData] = useState<HomeData | null>(null);
  const [err, setErr] = useState("");
  const [allWrong, setAllWrong] = useState(false);
  const [topic, setTopic] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    call<HomeData>("/home").then(setData).catch(e => setErr((e as Error).message));
  }, []);
  useEffect(load, [load]);

  const wish = async () => {
    if (!topic.trim() || busy) return;
    setBusy(true);
    try {
      const { wish: w } = await call<{ wish: Wish }>("/wishes", { topic, note });
      setData(d => d && { ...d, wishes: [w, ...d.wishes] });
      setTopic(""); setNote("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const unwish = (id: number) => {
    setData(d => d && { ...d, wishes: d.wishes.filter(w => w.id !== id) });
    call(`/wishes/${id}`, {}, "DELETE").catch(() => load());
  };
  // 批改结果点开看过、或点「知道了」，首页就不再提醒
  const seen = (r: Returned, open: boolean) => {
    setData(d => d && { ...d, returned: d.returned.filter(x => x.id !== r.id) });
    call(`/attempts/${r.id}/seen`, {}).catch(() => {});
    if (open) onOpen({ course: r.course_id, lesson: r.lesson_id, question: r.question_id });
  };

  if (err && !data) return <div className="rc-study-empty">学习室没打开：{err}</div>;
  if (!data) return <div className="rc-study-empty">翻开中…</div>;

  const { courses, stats, wrong, returned, wishes } = data;
  const top = courses[0];
  const going = courses.filter(c => !(c.lessons && c.done === c.lessons));
  const finished = courses.filter(c => c.lessons && c.done === c.lessons);
  const maxDay = Math.max(1, ...stats.days.map(d => d.n));
  const shownWrong = allWrong ? wrong : wrong.slice(0, WRONG_SHOWN);

  return (
    <div className="rc-study-read">
      <div className="rc-home">
        {top ? (
          <section className="rc-home-hero" aria-label="接着学">
            <div className="rc-smallcaps">{top.last_at ? `上次学习 · ${ago(top.last_at)}` : "还没开始"}</div>
            <h1 className="rc-home-hero-title">{top.title}</h1>
            {top.profile?.start && top.profile?.goal ? (
              <div className="rc-study-path">{top.profile.start}<span aria-hidden="true">→</span>{top.profile.goal}</div>
            ) : null}
            <div className="rc-home-bar" role="progressbar" aria-valuemin={0} aria-valuemax={top.lessons} aria-valuenow={top.done}>
              <span style={{ width: `${top.lessons ? (top.done / top.lessons) * 100 : 0}%` }} />
            </div>
            <div className="rc-home-hero-foot">
              <span className="rc-home-dim">学完 {top.done} / {top.lessons} 课</span>
              {top.next ? (
                <button type="button" className="rc-study-btn is-wide" onClick={() => onOpen({ course: top.id, lesson: top.next!.id })}>
                  {top.last ? "接着学" : "开始学"} {top.next.no} {top.next.title}
                </button>
              ) : top.waiting ? (
                <span className="rc-home-dim">下一课还在写：{top.waiting.no} {top.waiting.title}</span>
              ) : null}
            </div>
          </section>
        ) : (
          <div className="rc-study-empty is-inline">还没有课。在下面「我想学」写下想学的，老师来排课。</div>
        )}

        <section className="rc-home-stats" aria-label="学习统计">
          <div><b>{stats.lessons_done}</b><span>学完的课</span></div>
          <div><b>{stats.answered}</b><span>做过的题</span></div>
          <div><b>{stats.accuracy == null ? "—" : `${Math.round(stats.accuracy * 100)}%`}</b><span>正确率</span></div>
          <div><b>{stats.streak}</b><span>连续学习天数</span></div>
          <div className="rc-home-days" aria-label="最近两周">
            {stats.days.map(d => (
              <i key={d.day} title={`${d.day.slice(5).replace("-", "月")}日 · ${d.n ? `${d.n} 次` : "没学"}`}
                 style={{ "--lv": d.n ? 0.25 + 0.75 * (d.n / maxDay) : 0 } as CSSProperties} />
            ))}
            <span>最近两周</span>
          </div>
        </section>

        {returned.length ? (
          <section className="rc-home-sec" aria-label="批改回来了">
            <h2 className="rc-home-h">批改回来了<em>{returned.length}</em></h2>
            <ul className="rc-home-list">
              {returned.map(r => (
                <li key={r.id} className="rc-home-item">
                  <button type="button" className="rc-home-item-main" onClick={() => seen(r, true)}>
                    <span className={cn("rc-home-tag", `is-${r.result}`)}>{RESULT[r.result]}</span>
                    <span className="rc-home-stem">{r.stem}</span>
                    {r.feedback ? <span className="rc-home-fb">老师说：{r.feedback}</span> : null}
                    <span className="rc-home-dim">{r.lesson}</span>
                  </button>
                  <button type="button" className="rc-study-link" onClick={() => seen(r, false)}>知道了</button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className="rc-home-cols">
          <section className="rc-home-sec" aria-label="错题本">
            <h2 className="rc-home-h">错题本{wrong.length ? <em>{wrong.length}</em> : null}</h2>
            {wrong.length ? (
              <>
                <ul className="rc-home-list">
                  {shownWrong.map(w => (
                    <li key={w.id} className="rc-home-item">
                      <button type="button" className="rc-home-item-main" onClick={() => onOpen({ course: w.course_id, lesson: w.lesson_id, question: w.id })}>
                        <span className={cn("rc-home-tag", `is-${w.result}`)}>{w.result === "partial" ? "半对" : "错"}</span>
                        <span className="rc-home-stem">{w.stem}</span>
                        <span className="rc-home-dim">{w.lesson} · {ago(w.at)}</span>
                      </button>
                      <span className="rc-home-go" aria-hidden="true">去重做</span>
                    </li>
                  ))}
                </ul>
                {wrong.length > WRONG_SHOWN ? (
                  <button type="button" className="rc-study-link" onClick={() => setAllWrong(v => !v)}>{allWrong ? "收起" : `全部 ${wrong.length} 道`}</button>
                ) : null}
              </>
            ) : (
              <p className="rc-home-none">还没有错题。做错的题会收在这里，重做对了就移出去。</p>
            )}
          </section>

          <section className="rc-home-sec" aria-label="我想学">
            <h2 className="rc-home-h">我想学</h2>
            <div className="rc-home-wish">
              <input className="rc-quiz-input" value={topic} maxLength={200} placeholder="想学什么，比如：Transformer 是怎么回事"
                     onChange={e => setTopic(e.target.value)}
                     onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) wish(); }} />
              <textarea className="rc-quiz-input is-long" rows={2} value={note} maxLength={2000} placeholder="想学到什么程度、为什么想学（可不写）"
                        onChange={e => setNote(e.target.value)} />
              <div className="rc-quiz-actions">
                <button type="button" className="rc-study-btn" disabled={!topic.trim() || busy} onClick={wish}>{busy ? "放进去…" : "交给老师"}</button>
                <span className="rc-home-dim">老师看到后会先问你几个问题，再排课</span>
              </div>
            </div>
            {wishes.length ? (
              <ul className="rc-home-list is-tight">
                {wishes.map(w => (
                  <li key={w.id} className="rc-home-item">
                    <div className="rc-home-item-main is-static">
                      <span className="rc-home-stem">{w.topic}</span>
                      {w.note ? <span className="rc-home-dim">{w.note}</span> : null}
                      <span className="rc-home-dim">等老师排课 · {ago(w.created_at)}</span>
                    </div>
                    <button type="button" className="rc-study-link" onClick={() => unwish(w.id)}>撤回</button>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        </div>

        <section className="rc-home-sec" aria-label="所有课程">
          <h2 className="rc-home-h">所有课程</h2>
          <div className="rc-home-cards">
            {going.map(c => <CourseTile key={c.id} c={c} onOpen={onOpen} />)}
          </div>
          {finished.length ? (
            <>
              <h3 className="rc-home-sub">学完的</h3>
              <div className="rc-home-cards">
                {finished.map(c => <CourseTile key={c.id} c={c} onOpen={onOpen} />)}
              </div>
            </>
          ) : null}
        </section>
        {err ? <div className="rc-quiz-err">{err}</div> : null}
      </div>
    </div>
  );
}

function CourseTile({ c, onOpen }: { c: CourseCard; onOpen: (o: Open) => void }) {
  return (
    <button type="button" className="rc-home-card" onClick={() => onOpen({ course: c.id, lesson: c.next?.id ?? c.last?.id })}>
      <span className="rc-home-card-title">{c.title}</span>
      {c.profile?.goal ? <span className="rc-home-dim">学完能：{c.profile.goal}</span> : null}
      <span className="rc-home-bar is-thin"><span style={{ width: `${c.lessons ? (c.done / c.lessons) * 100 : 0}%` }} /></span>
      <span className="rc-home-dim">
        {c.done} / {c.lessons} 课{c.last ? ` · 上次学到 ${c.last.no}` : ""}{c.last_at ? ` · ${ago(c.last_at)}` : ""}
      </span>
    </button>
  );
}
