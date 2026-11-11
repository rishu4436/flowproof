"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Activity, BookOpen, Boxes, Cpu, FlaskConical, LayoutDashboard, Menu, Play, Receipt, Settings, Workflow } from "lucide-react";
import { Mark } from "./mark";

const links = [
  ["/overview", "Overview", LayoutDashboard],
  ["/workflows", "Workflows", Workflow],
  ["/runs", "Runs", Play],
  ["/receipts", "Receipts", Receipt],
  ["/demo", "Demo Lab", FlaskConical],
  ["/benchmarks", "Benchmark Lab", Boxes],
  ["/ai", "Models", Cpu],
  ["/integrations", "Integrations", Boxes],
  ["/activity", "Activity", Activity],
  ["/settings", "Settings", Settings],
  ["/help", "Help", BookOpen],
] as const;

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const [query, setQuery] = useState("");
  const [health, setHealth] = useState<string>("checking");
  const crumbs = pathname.split("/").filter(Boolean);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPalette((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    let stop = false;
    const load = () => {
      fetch("/api/integrations")
        .then((response) => response.json())
        .then((body) => {
          if (stop) return;
          const items = body.items as Array<{ status: string }> | undefined;
          const bad = items?.some((item) => item.status === "offline" || item.status === "authentication_failed" || item.status === "service_unavailable");
          setHealth(bad ? "attention" : "ready");
        })
        .catch(() => setHealth("offline"));
    };
    load();
    const timer = setInterval(load, 15000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, []);

  const results = useMemo(() => links.filter((link) => link[1].toLowerCase().includes(query.toLowerCase())), [query]);

  return (
    <div className="shell">
      <aside className={`nav ${open ? "open" : ""}`}>
        <Link href="/overview" className="nav-brand">
          <Mark />
          <div>
            <strong>FlowProof</strong>
            <span>Prove the outcome</span>
          </div>
        </Link>
        <nav>
          {links.map(([href, label, Icon]) => (
            <Link key={href} href={href} className={pathname === href || pathname.startsWith(`${href}/`) ? "active" : ""} onClick={() => setOpen(false)}>
              <Icon size={16} />
              {label}
            </Link>
          ))}
        </nav>
        <div className="nav-foot">
          <div className={`pill ${health === "ready" ? "verified" : health === "checking" ? "neutral" : "unknown"}`}>{health === "ready" ? "Services responding" : health === "checking" ? "Checking services" : "A service needs attention"}</div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <button className="btn ghost" aria-label="Open navigation" onClick={() => setOpen((value) => !value)}>
            <Menu size={16} />
          </button>
          <div className="crumbs">
            <Link href="/overview">Workspace</Link>
            {crumbs.map((crumb, index) => (
              <span key={crumb}>
                / <strong>{index === crumbs.length - 1 ? crumb : crumb}</strong>
              </span>
            ))}
          </div>
          <div style={{ marginLeft: "auto" }} className="row">
            <button className="btn" onClick={() => setPalette(true)}>
              Search <span className="mono">Ctrl K</span>
            </button>
            <ThemeSwitch />
          </div>
        </header>
        {children}
      </div>
      {palette ? (
        <div className="cmdk" onClick={() => setPalette(false)}>
          <div className="panel" onClick={(event) => event.stopPropagation()}>
            <input autoFocus className="field" style={{ width: "100%", marginBottom: 8 }} placeholder="Jump to a surface" value={query} onChange={(event) => setQuery(event.target.value)} />
            {results.map(([href, label]) => (
              <button key={href} className="btn ghost" style={{ width: "100%", justifyContent: "flex-start" }} onClick={() => { setPalette(false); router.push(href); }}>
                {label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ThemeSwitch() {
  const [theme, setTheme] = useState("studio");
  useEffect(() => {
    setTheme(document.documentElement.dataset.theme || "studio");
  }, []);
  return (
    <select
      aria-label="Theme"
      value={theme}
      onChange={(event) => {
        const next = event.target.value;
        document.documentElement.dataset.theme = next;
        localStorage.setItem("fp-theme", next);
        setTheme(next);
      }}
    >
      <option value="studio">Studio</option>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select>
  );
}
