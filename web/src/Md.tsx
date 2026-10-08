import { memo } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// 讲义正文：GitHub 风格 Markdown，链接在新标签页打开
const PLUGINS = [remarkGfm];
const PARTS: Components = { a: ({ node: _n, ...p }) => <a {...p} target="_blank" rel="noreferrer" /> };

export const Md = memo(({ text }: { text: string }) => (
  <div className="rc-md"><Markdown remarkPlugins={PLUGINS} components={PARTS}>{text}</Markdown></div>
));
