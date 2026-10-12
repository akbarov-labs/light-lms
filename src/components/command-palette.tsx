"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CornerDownLeft, FileText, Search, User, Users } from "lucide-react";
import { formatMoney } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { cx } from "./ui";

interface StudentHit {
  id: string;
  name: string;
  phone: string | null;
  familyId: string;
  groups: string[];
  debt: number | null;
}
interface GroupHit {
  id: string;
  name: string;
  code: number;
  teacher: string;
}
export interface PaletteLabels {
  search: string;
  payTitle: string;
  students: string;
  groups: string;
  pages: string;
  noResults: string;
  typeMore: string;
  hint: string;
  debt: string;
}

type Mode = "search" | "pay";
const PaletteCtx = createContext<(mode: Mode) => void>(() => {});
export const usePalette = () => useContext(PaletteCtx);

type Row = { key: string; kind: "student" | "group" | "page"; label: string; sub?: string; right?: ReactNode; go: () => void };

/** ⌘K / Ctrl+K palette: find a student, group or page; in pay mode, jump straight to taking a payment. */
export function CommandPalette({ pages, labels, children }: { pages: { href: string; label: string }[]; labels: PaletteLabels; children: ReactNode }) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>("search");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ students: StudentHit[]; groups: GroupHit[] }>({ students: [], groups: [] });
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);

  const open = useCallback((m: Mode) => {
    setMode(m);
    setQ("");
    setHits({ students: [], groups: [] });
    setActive(0);
    ref.current?.showModal();
    setTimeout(() => input.current?.focus(), 0);
  }, []);
  const close = () => ref.current?.close();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        open("search");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits({ students: [], groups: [] });
      return;
    }
    const ctl = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`, { signal: ctl.signal });
        if (r.ok) setHits(await r.json());
      } catch {
        /* aborted */
      } finally {
        setLoading(false);
      }
    }, 150);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [q]);

  const rows: Row[] = useMemo(() => {
    const go = (href: string) => () => {
      close();
      router.push(href);
    };
    const out: Row[] = hits.students.map((s) => ({
      key: `s${s.id}`,
      kind: "student",
      label: s.name,
      sub: [s.groups.join(", "), s.phone ? formatPhone(s.phone) : ""].filter(Boolean).join(" · "),
      right: s.debt ? <span className="tnum text-xs font-medium text-red-600">{labels.debt} {formatMoney(s.debt)}</span> : null,
      go: go(mode === "pay" ? `/families/${s.familyId}?pay=1&student=${s.id}` : `/students/${s.id}`),
    }));
    if (mode === "search") {
      out.push(...hits.groups.map((g) => ({ key: `g${g.id}`, kind: "group" as const, label: `${g.name} #${g.code}`, sub: g.teacher, go: go(`/groups/${g.id}`) })));
      const needle = q.trim().toLowerCase();
      if (needle) out.push(...pages.filter((p) => p.label.toLowerCase().includes(needle)).map((p) => ({ key: `p${p.href}`, kind: "page" as const, label: p.label, go: go(p.href) })));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hits, mode, q, pages, labels.debt]);

  useEffect(() => setActive(0), [rows.length]);

  const section = (kind: Row["kind"]) => ({ student: labels.students, group: labels.groups, page: labels.pages })[kind];
  const Icon = ({ kind }: { kind: Row["kind"] }) => (kind === "student" ? <User className="h-4 w-4" /> : kind === "group" ? <Users className="h-4 w-4" /> : <FileText className="h-4 w-4" />);

  return (
    <PaletteCtx.Provider value={open}>
      {children}
      <dialog
        ref={ref}
        aria-label={mode === "pay" ? labels.payTitle : labels.search}
        onClick={(e) => e.target === ref.current && close()}
        className="mt-[12vh] w-[calc(100%-2rem)] max-w-xl rounded-2xl border border-line p-0 shadow-pop"
      >
        <div className="flex items-center gap-2.5 border-b border-zinc-100 px-4">
          <Search className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={mode === "pay" ? labels.payTitle : labels.search}
            aria-label={mode === "pay" ? labels.payTitle : labels.search}
            className="h-12 w-full bg-transparent text-base outline-none placeholder:text-zinc-500 sm:text-sm"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(rows.length - 1, a + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === "Enter" && rows[active]) {
                e.preventDefault();
                rows[active].go();
              }
            }}
          />
          {loading && <span className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" aria-hidden />}
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-1.5" role="listbox">
          {q.trim().length < 2 ? (
            <p className="px-3 py-6 text-center text-sm text-zinc-500">{labels.typeMore}</p>
          ) : rows.length === 0 && !loading ? (
            <p className="px-3 py-6 text-center text-sm text-zinc-500">{labels.noResults}</p>
          ) : (
            rows.map((r, i) => (
              <div key={r.key}>
                {(i === 0 || rows[i - 1].kind !== r.kind) && <div className="px-2.5 pb-1 pt-2 text-xs font-medium text-zinc-500">{section(r.kind)}</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={r.go}
                  className={cx("flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm", i === active ? "bg-zinc-100" : "")}
                >
                  <span className="text-zinc-400"><Icon kind={r.kind} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-zinc-900">{r.label}</span>
                    {r.sub && <span className="block truncate text-xs text-zinc-500">{r.sub}</span>}
                  </span>
                  {r.right}
                  {i === active && <CornerDownLeft className="h-3.5 w-3.5 text-zinc-400" aria-hidden />}
                </button>
              </div>
            ))
          )}
        </div>
        <div className="border-t border-zinc-100 px-4 py-2 text-xs text-zinc-500">{labels.hint}</div>
      </dialog>
    </PaletteCtx.Provider>
  );
}

export function SearchTrigger({ label }: { label: string }) {
  const open = usePalette();
  return (
    <button type="button" onClick={() => open("search")} className="flex h-9 w-full max-w-sm items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50/60 px-3 text-sm text-zinc-500 transition-colors hover:border-zinc-300 hover:bg-white">
      <Search className="h-4 w-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      <kbd className="hidden rounded border border-zinc-200 bg-white px-1.5 font-sans text-[11px] text-zinc-500 sm:inline">⌘K</kbd>
    </button>
  );
}

export function QuickPayButton({ label, className }: { label: string; className?: string }) {
  const open = usePalette();
  return (
    <button type="button" onClick={() => open("pay")} className={className}>
      {label}
    </button>
  );
}
