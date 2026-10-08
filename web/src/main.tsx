import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Study } from "./Study";
import "./study.css";

// 深浅色：默认跟系统，点右上角切换后记在本机
const THEME_KEY = "rc-theme";
type Mode = "light" | "dark";
const systemMode = (): Mode => (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
const savedMode = (): Mode | null => { try { const v = localStorage.getItem(THEME_KEY); return v === "light" || v === "dark" ? v : null; } catch { return null; } };

function App() {
  const [mode, setMode] = useState<Mode>(() => savedMode() ?? systemMode());
  useEffect(() => { document.documentElement.classList.toggle("dark", mode === "dark"); }, [mode]);
  const flip = () => {
    const next = mode === "dark" ? "light" : "dark";
    setMode(next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* 无痕窗口写不了 */ }
  };
  return (
    <div className="rc-app">
      <header className="rc-top">
        <div className="rc-top-title">学习室<span className="rc-smallcaps">Study</span></div>
        <button type="button" className="rc-study-link" onClick={flip}>{mode === "dark" ? "浅色" : "深色"}</button>
      </header>
      <main className="rc-main"><Study /></main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
