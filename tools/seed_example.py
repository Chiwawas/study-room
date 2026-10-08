#!/usr/bin/env python3
"""导入示例课「RAG：先翻资料再回答」：大纲 + 写好的第一课，装好后先看看长什么样。"""
import sqlite3
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
admin = [sys.executable, str(root / "tools" / "study_admin.py")]
ex = root / "examples" / "rag"
subprocess.run([*admin, "course-import", str(ex / "course.json")], check=True)
from study_admin import DB  # noqa: E402  与 study_admin.py 用同一个库

c = sqlite3.connect(DB)
lid = c.execute("SELECT l.id FROM study_lesson l JOIN study_unit u ON u.id = l.unit_id"
                " WHERE u.course_id = (SELECT MAX(id) FROM study_course) AND u.idx = 1 AND l.idx = 1").fetchone()[0]
subprocess.run([*admin, "lesson-set", str(lid), str(ex / "1-1.json")], check=True)
