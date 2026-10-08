#!/usr/bin/env python3
"""给学习室截一张整页图，写完课自检排版用。服务要先跑着（npm start）。

用法：python3 tools/shot.py 输出.png [--course 课程id] [--lesson 课id] [--dark] [--width 1280]
  不带 --course 截书房首页；带上就打开那门课（再带 --lesson 打开那一课）。
  --width 390 看手机宽度。地址默认 http://127.0.0.1:4173，可用环境变量 STUDY_URL 改。
需要 Playwright：pip install playwright && playwright install chromium
"""
import argparse
import os
from urllib.parse import urlencode
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser(usage=__doc__)
ap.add_argument("out")
ap.add_argument("--course", type=int)
ap.add_argument("--lesson", type=int)
ap.add_argument("--dark", action="store_true")
ap.add_argument("--width", type=int, default=1280)
a = ap.parse_args()

url = os.environ.get("STUDY_URL", "http://127.0.0.1:4173").rstrip("/") + "/"
if a.course:
    url += "?" + urlencode({k: v for k, v in (("course", a.course), ("lesson", a.lesson)) if v})

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={"width": a.width, "height": 900}, device_scale_factor=2,
                      color_scheme="dark" if a.dark else "light")
    page.add_init_script("try { localStorage.removeItem('rc-theme') } catch {}")
    page.goto(url, wait_until="domcontentloaded")
    page.wait_for_function("document.querySelector('.rc-main')?.textContent.trim()", timeout=15000)
    page.wait_for_timeout(1500)
    for _ in range(3):  # 中文字体按字分片加载，等它们都到齐再截
        page.evaluate("document.fonts.ready.then(() => 0)")
        page.wait_for_timeout(1000)
    page.screenshot(path=a.out, full_page=True)
    b.close()
print(a.out)
