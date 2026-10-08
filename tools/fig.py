#!/usr/bin/env python3
"""把一张讲义插图（HTML，图画在 id=fig 的元素里）渲染成 2 倍清晰度的 PNG。

用法：python3 tools/fig.py 图.html 课id-序号.png
输出放 data/fig/，讲义 figure 的 src 写 /fig/文件名。
需要 Playwright：pip install playwright && playwright install chromium
"""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

OUT = Path(__file__).resolve().parent.parent / "data" / "fig"


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    src, name = Path(sys.argv[1]).resolve(), sys.argv[2]
    OUT.mkdir(parents=True, exist_ok=True)
    out = OUT / name
    with sync_playwright() as p:
        b = p.chromium.launch()
        page = b.new_page(viewport={"width": 720, "height": 600}, device_scale_factor=2)
        page.goto(src.as_uri(), wait_until="domcontentloaded")
        page.wait_for_timeout(800)
        page.locator("#fig").screenshot(path=str(out), omit_background=False)
        b.close()
    print(out, "→ src:", f"/fig/{name}")


if __name__ == "__main__":
    main()
