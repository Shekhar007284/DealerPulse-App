import { useState, useEffect, useRef } from "react";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, RadialBarChart, RadialBar,
} from "recharts";
import { Analytics } from "@vercel/analytics/next";
import {
  getPipeline, getMonthlyChart, getBranchStats, getAgingLeads,
  getLostReasons, getSourceStats, getKPIs, fmtCrore, fmtLakh,
  type BranchStat, type AgingLead,
} from "@/data/processor";

// ─── Pre-compute all data once ────────────────────────────────────────────────
const PIPELINE = getPipeline();
const MONTHLY = getMonthlyChart();
const BRANCH_STATS = getBranchStats();
const AGING = getAgingLeads(7);
const LOST_REASONS = getLostReasons();
const SOURCE_STATS = getSourceStats();
const KPIS = getKPIs();

type Tab = "overview" | "branches" | "aging" | "insights";

// ─── Export / share utilities ─────────────────────────────────────────────────
function downloadCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const escape = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [headers, ...rows].map(r => r.map(escape).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  Object.assign(document.createElement("a"), { href: url, download: filename }).click();
  URL.revokeObjectURL(url);
}

async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

// Pre-formatted export data
function exportAgingCSV() {
  downloadCSV("dealerpulse_aging_leads.csv",
    ["Customer", "Model", "Source", "Status", "Rep", "Branch", "Days Silent", "Urgency", "Deal Value (₹)"],
    AGING.map(a => [
      a.lead.customer_name, a.lead.model_interested, a.lead.source,
      a.currentStatus, a.rep?.name ?? "—", a.branch?.name ?? "—",
      a.daysSinceActivity, a.urgency, a.lead.deal_value,
    ])
  );
}

function exportBranchCSV() {
  downloadCSV("dealerpulse_branch_stats.csv",
    ["Branch", "City", "Total Leads", "Sold", "Lost", "Active", "Test Drives", "Close Rate %", "TD Conversion %", "Revenue (₹)", "Avg Deal (₹)"],
    BRANCH_STATS.map(b => [
      b.branch.name, b.branch.city, b.total, b.sold, b.lost, b.active,
      b.testDrives, b.closeRate.toFixed(1), b.testDriveConversion.toFixed(1),
      b.totalRevenue, b.avgDealValue.toFixed(0),
    ])
  );
}

function exportRepsCSV() {
  const allReps = BRANCH_STATS.flatMap(b =>
    b.reps.map(r => ({ ...r, branchName: b.branch.name }))
  );
  downloadCSV("dealerpulse_reps.csv",
    ["Rep", "Branch", "Role", "Leads", "Sold", "Lost", "Close Rate %", "Revenue (₹)", "Avg Response (hrs)"],
    allReps.map(r => [
      r.rep.name, r.branchName, r.rep.role, r.total, r.sold, r.lost,
      r.closeRate.toFixed(1), r.totalRevenue, r.avgResponseHrs.toFixed(1),
    ])
  );
}

function exportMonthlyCSV() {
  downloadCSV("dealerpulse_monthly.csv",
    ["Month", "New Leads", "Test Drives", "Sold", "Lost"],
    MONTHLY.map(m => [m.month, m.newLeads, m.testDrives, m.sold, m.lost])
  );
}

function exportPipelineCSV() {
  downloadCSV("dealerpulse_pipeline.csv",
    ["Stage", "Count", "% of Total"],
    [
      ["Total Leads", PIPELINE.total, "100"],
      ["Attempted Contact", PIPELINE.attempted, ((PIPELINE.attempted / PIPELINE.total) * 100).toFixed(1)],
      ["Engaged (Test Drive)", PIPELINE.engaged, ((PIPELINE.engaged / PIPELINE.total) * 100).toFixed(1)],
      ["Unsold Visits", PIPELINE.unsoldVisits, ((PIPELINE.unsoldVisits / PIPELINE.total) * 100).toFixed(1)],
      ["Sold", PIPELINE.sold, ((PIPELINE.sold / PIPELINE.total) * 100).toFixed(1)],
    ]
  );
}

function buildShareText(tab: Tab): string {
  const lines: string[] = [
    `DealerPulse Analytics — ${tab.charAt(0).toUpperCase() + tab.slice(1)} Snapshot`,
    `Data: Jun–Dec 2025 · All 5 Toyota branches`,
    `Generated: ${new Date().toLocaleString()}`,
    "",
  ];
  if (tab === "overview" || tab === "branches") {
    lines.push(
      `📊 Pipeline Summary`,
      `  Total leads: ${PIPELINE.total}`,
      `  Sold: ${PIPELINE.sold} (${((PIPELINE.sold / PIPELINE.total) * 100).toFixed(1)}% close rate)`,
      `  Lost: ${PIPELINE.lost}`,
      `  Revenue: ${fmtCrore(KPIS.totalRevenue)}`,
      "",
      `🏆 Branch Rankings (by close rate)`,
      ...[...BRANCH_STATS].sort((a, b) => b.closeRate - a.closeRate).map((b, i) =>
        `  ${i + 1}. ${b.branch.name} — ${b.closeRate.toFixed(1)}% close · ${fmtCrore(b.totalRevenue)}`
      ),
    );
  }
  if (tab === "aging") {
    lines.push(
      `🚨 Lead Aging Alert`,
      `  Critical (21+ days silent): ${AGING.filter(a => a.urgency === "critical").length}`,
      `  High (14–20 days): ${AGING.filter(a => a.urgency === "high").length}`,
      `  Medium (7–13 days): ${AGING.filter(a => a.urgency === "medium").length}`,
      `  Total cold leads: ${AGING.length}`,
    );
  }
  if (tab === "insights") {
    lines.push(
      `🔮 Forecast`,
      ...[...BRANCH_STATS].map(b => {
        const exp = Math.round(b.active * (b.closeRate / 100));
        return `  ${b.branch.name}: ~${exp} expected closes from ${b.active} active leads`;
      }),
    );
  }
  return lines.join("\n");
}

// ─── Export dropdown component ────────────────────────────────────────────────
function ExportMenu({ tab }: { tab: Tab }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleCopy = async () => {
    await copyText(buildShareText(tab));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    setOpen(false);
  };

  const exportOptions: { label: string; fn: () => void }[] = [
    { label: "Pipeline funnel (.csv)", fn: () => { exportPipelineCSV(); setOpen(false); } },
    { label: "Monthly chart (.csv)", fn: () => { exportMonthlyCSV(); setOpen(false); } },
    { label: "Branch stats (.csv)", fn: () => { exportBranchCSV(); setOpen(false); } },
    { label: "Rep leaderboard (.csv)", fn: () => { exportRepsCSV(); setOpen(false); } },
    { label: "Aging leads (.csv)", fn: () => { exportAgingCSV(); setOpen(false); } },
  ];

  return (
    <div ref={ref} className="relative">
      <div className="flex items-center gap-1">
        <button
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-1.5 text-xs font-mono px-3 py-1.5 rounded-l border border-[#1e3158] text-[#7a9ec0] hover:border-[#00c9b1] hover:text-[#00c9b1] transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M6 1v7M3 5l3 3 3-3M1 9v1a1 1 0 001 1h8a1 1 0 001-1V9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Export
        </button>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-xs font-mono px-3 py-1.5 rounded-r border border-l-0 border-[#1e3158] text-[#7a9ec0] hover:border-[#00c9b1] hover:text-[#00c9b1] transition-colors"
          title="Copy insight summary to clipboard"
        >
          {copied ? (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="#00c9b1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="1" y="3" width="8" height="8" rx="1.2" stroke="currentColor" strokeWidth="1.2"/><path d="M3 3V2a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1h-1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
          )}
          <span style={{ color: copied ? "#00c9b1" : undefined }}>{copied ? "Copied!" : "Share"}</span>
        </button>
      </div>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-56 bg-[#0b1425] border border-[#1e3158] rounded-xl shadow-2xl z-50 overflow-hidden">
          <p className="text-[9px] font-mono uppercase tracking-widest text-[#2a4168] px-3 pt-3 pb-1">Download CSV</p>
          {exportOptions.map(opt => (
            <button
              key={opt.label}
              onClick={opt.fn}
              className="w-full text-left flex items-center gap-2 px-3 py-2 text-xs font-mono text-[#7a9ec0] hover:bg-[#111e35] hover:text-white transition-colors"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="flex-shrink-0 opacity-50">
                <path d="M5 1v6M2.5 4.5L5 7l2.5-2.5M1 8.5h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              {opt.label}
            </button>
          ))}
          <div className="border-t border-[#111e35] mt-1 pt-1 pb-1">
            <button
              onClick={handleCopy}
              className="w-full text-left flex items-center gap-2 px-3 py-2 text-xs font-mono text-[#7a9ec0] hover:bg-[#111e35] hover:text-white transition-colors"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="flex-shrink-0 opacity-50">
                <rect x="1" y="3" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.2"/>
                <path d="M3 3V2a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              </svg>
              Copy insight as text
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Colour tokens ────────────────────────────────────────────────────────────
const C = {
  teal: "#00c9b1",
  blue: "#3b9eff",
  amber: "#ffad33",
  red: "#ff4d6a",
  purple: "#a78bfa",
  muted: "#4a6990",
  dim: "#2a4168",
};

// ─── Tooltip ─────────────────────────────────────────────────────────────────
function ChartTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#111e35] border border-[#1e3158] rounded-lg px-4 py-3 shadow-2xl">
      <p className="text-[#7a9ec0] text-xs font-mono mb-2">{label}</p>
      {payload.map((e: any) => (
        <div key={e.name} className="flex items-center gap-2 text-xs font-mono">
          <span className="w-2 h-2 rounded-full" style={{ background: e.color }} />
          <span className="text-[#7a9ec0] capitalize">{e.name}</span>
          <span className="text-white font-semibold ml-auto pl-4">{e.value?.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Mini stat tile ───────────────────────────────────────────────────────────
function Stat({ label, value, sub, color = "white" }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-[#0b1425] border border-[#111e35] rounded-xl p-4">
      <p className="text-[10px] font-mono uppercase tracking-widest text-[#4a6990] mb-1">{label}</p>
      <p className="text-2xl font-mono font-semibold" style={{ color }}>{value}</p>
      {sub && <p className="text-xs font-mono mt-0.5" style={{ color: color === "white" ? C.muted : color + "aa" }}>{sub}</p>}
    </div>
  );
}

// ─── Section heading ──────────────────────────────────────────────────────────
function SectionHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-5">
      <h2 className="text-sm font-semibold text-white">{title}</h2>
      {sub && <p className="text-[#4a6990] text-xs font-mono mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Overview tab ─────────────────────────────────────────────────────────────
function OverviewTab() {
  const avgRespDisplay = (() => {
    const h = Math.floor(KPIS.avgResponseHrs);
    const m = Math.round((KPIS.avgResponseHrs - h) * 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  })();

  return (
    <div className="flex flex-col gap-5">
      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Total Leads (Jun–Dec)" value={KPIS.totalLeads.toLocaleString()} sub="510 across 5 branches" />
        <Stat label="Overall Close Rate" value={`${KPIS.closeRate.toFixed(1)}%`} sub={`${PIPELINE.sold} sold of ${PIPELINE.total}`} color={C.teal} />
        <Stat label="Total Revenue" value={fmtCrore(KPIS.totalRevenue)} sub={`Avg ${fmtLakh(KPIS.avgDealValue)} / deal`} color={C.amber} />
        <Stat label="Avg Response Time" value={avgRespDisplay} sub="Lead to first contact" color={C.blue} />
      </div>

      {/* Monthly performance chart */}
      <div className="bg-[#0b1425] border border-[#111e35] rounded-xl p-5">
        <SectionHead title="Monthly Performance (Jun–Dec 2025)" sub="New leads · Test drives · Sales closed · Lost" />
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={MONTHLY} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <defs>
                {[["leads", C.teal], ["sold", C.amber], ["testDrives", C.blue], ["lost", C.red]].map(([k, col]) => (
                  <linearGradient key={k} id={`g-${k}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={col} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={col} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#111e35" vertical={false} />
              <XAxis dataKey="month" tick={{ fill: C.muted, fontSize: 10, fontFamily: "JetBrains Mono" }} axisLine={{ stroke: "#111e35" }} tickLine={false} />
              <YAxis tick={{ fill: C.muted, fontSize: 10, fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTip />} />
              <Area type="monotone" dataKey="newLeads" name="New Leads" stroke={C.teal} strokeWidth={2} fill={`url(#g-leads)`} dot={false} activeDot={{ r: 4 }} />
              <Area type="monotone" dataKey="testDrives" name="Test Drives" stroke={C.blue} strokeWidth={2} fill={`url(#g-testDrives)`} dot={false} activeDot={{ r: 4 }} />
              <Area type="monotone" dataKey="sold" name="Sold" stroke={C.amber} strokeWidth={2} fill={`url(#g-sold)`} dot={false} activeDot={{ r: 4 }} />
              <Area type="monotone" dataKey="lost" name="Lost" stroke={C.red} strokeWidth={1.5} fill={`url(#g-lost)`} dot={false} activeDot={{ r: 4 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Pipeline funnel */}
      <div className="bg-[#0b1425] border border-[#111e35] rounded-xl p-5">
        <SectionHead title="Sales Pipeline Funnel" sub="Lead progression across all 5 branches · Jun–Dec 2025" />
        <div className="flex items-stretch gap-0 overflow-x-auto pb-2">
          {[
            { label: "Total Active Leads", count: PIPELINE.total, color: C.teal },
            { label: "Attempted Contact", count: PIPELINE.attempted, color: C.blue },
            { label: "Engaged (Test Drive)", count: PIPELINE.engaged, color: C.purple },
            { label: "Unsold Visits", count: PIPELINE.unsoldVisits, color: C.amber },
            { label: "Sold", count: PIPELINE.sold, color: C.teal },
          ].map((step, i, arr) => (
            <div key={step.label} className="flex items-center flex-shrink-0">
              <div className="relative group">
                <div
                  className="border rounded-xl p-4 min-w-[148px] transition-all hover:brightness-110"
                  style={{ borderColor: step.color + "33", background: step.color + "0d" }}
                >
                  <p className="text-[10px] font-mono uppercase tracking-widest text-[#7a9ec0] mb-2 leading-tight">{step.label}</p>
                  <p className="text-3xl font-mono font-semibold" style={{ color: step.color }}>
                    {step.count.toLocaleString()}
                  </p>
                  <div className="mt-3 h-1 rounded-full bg-[#111e35] overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${(step.count / PIPELINE.total) * 100}%`, background: step.color }} />
                  </div>
                  <p className="text-[10px] font-mono mt-1.5" style={{ color: step.color + "99" }}>
                    {((step.count / PIPELINE.total) * 100).toFixed(1)}% of total
                  </p>
                  {i > 0 && (
                    <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-[#0b1425] border border-[#1e3158] rounded px-1.5 text-[9px] font-mono text-[#4a6990] whitespace-nowrap">
                      {((step.count / arr[i - 1].count) * 100).toFixed(0)}% conv.
                    </div>
                  )}
                </div>
              </div>
              {i < arr.length - 1 && (
                <div className="flex-shrink-0 px-1">
                  <svg width="24" height="20" viewBox="0 0 24 20" fill="none">
                    <path d="M2 10 H18 M14 4 L22 10 L14 16" stroke="#1e3158" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Drop-off summary */}
        <div className="mt-4 pt-4 border-t border-[#111e35] grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: "Not contacted", value: (PIPELINE.total - PIPELINE.attempted).toString(), color: C.red },
            { label: "Contacted, no test drive", value: (PIPELINE.attempted - PIPELINE.engaged).toString(), color: C.amber },
            { label: "Test drove, unsold", value: PIPELINE.unsoldVisits.toString(), color: "#ffd23f" },
            { label: "Close rate", value: `${((PIPELINE.sold / PIPELINE.total) * 100).toFixed(1)}%`, color: C.teal },
          ].map(item => (
            <div key={item.label} className="flex items-start gap-2">
              <span className="w-1 min-h-[36px] rounded-full flex-shrink-0" style={{ background: item.color }} />
              <div>
                <p className="text-[10px] font-mono text-[#4a6990] uppercase tracking-wider">{item.label}</p>
                <p className="font-mono font-semibold text-base" style={{ color: item.color }}>{item.value}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Lost reasons + Source breakdown side-by-side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Lost reasons */}
        <div className="bg-[#0b1425] border border-[#111e35] rounded-xl p-5">
          <SectionHead title="Why Leads Are Lost" sub={`${PIPELINE.lost} total lost leads`} />
          <div className="flex flex-col gap-2">
            {LOST_REASONS.map((r, i) => {
              const pct = (r.count / PIPELINE.lost) * 100;
              const colors = [C.red, C.amber, "#ffd23f", C.blue, C.purple, C.teal, "#f97316", "#ec4899"];
              return (
                <div key={r.reason} className="flex items-center gap-3">
                  <div className="w-28 flex-shrink-0">
                    <p className="text-[10px] font-mono text-[#7a9ec0] truncate" title={r.reason}>{r.reason}</p>
                  </div>
                  <div className="flex-1 h-5 bg-[#111e35] rounded overflow-hidden relative">
                    <div className="h-full rounded transition-all" style={{ width: `${pct}%`, background: colors[i % colors.length] + "55", borderRight: `2px solid ${colors[i % colors.length]}` }} />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono text-[#7a9ec0]">{r.count}</span>
                  </div>
                  <span className="text-[10px] font-mono text-[#4a6990] w-10 text-right">{pct.toFixed(0)}%</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Lead source */}
        <div className="bg-[#0b1425] border border-[#111e35] rounded-xl p-5">
          <SectionHead title="Lead Source Performance" sub="Volume and close rate by acquisition channel" />
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={SOURCE_STATS} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} barSize={18}>
                <CartesianGrid strokeDasharray="3 3" stroke="#111e35" vertical={false} />
                <XAxis dataKey="source" tick={{ fill: C.muted, fontSize: 9, fontFamily: "JetBrains Mono" }} axisLine={{ stroke: "#111e35" }} tickLine={false} />
                <YAxis yAxisId="left" tick={{ fill: C.muted, fontSize: 10, fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="right" orientation="right" tickFormatter={v => `${v.toFixed(0)}%`} tick={{ fill: C.muted, fontSize: 10, fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTip />} />
                <Bar yAxisId="left" dataKey="total" name="Total" fill={C.blue + "55"} stroke={C.blue} radius={[3, 3, 0, 0]} />
                <Bar yAxisId="left" dataKey="sold" name="Sold" fill={C.teal + "55"} stroke={C.teal} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {/* Close rates per source */}
          <div className="mt-3 flex flex-wrap gap-2">
            {SOURCE_STATS.map(s => (
              <div key={s.source} className="flex items-center gap-1.5 bg-[#111e35] rounded px-2 py-1">
                <span className="text-[10px] font-mono text-[#7a9ec0]">{s.source}</span>
                <span className="text-[10px] font-mono font-semibold" style={{ color: s.closeRate > 20 ? C.teal : s.closeRate > 15 ? C.amber : C.red }}>
                  {s.closeRate.toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Branch analytics tab ─────────────────────────────────────────────────────
function BranchesTab() {
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const selected = BRANCH_STATS.find(b => b.branch.id === selectedBranch) ?? null;
  const sorted = [...BRANCH_STATS].sort((a, b) => b.closeRate - a.closeRate);
  const maxRevenue = Math.max(...BRANCH_STATS.map(b => b.totalRevenue));

  // All reps sorted by close rate
  const allReps = BRANCH_STATS.flatMap(b => b.reps).sort((a, b) => b.sold - a.sold).slice(0, 15);

  return (
    <div className="flex flex-col gap-5">
      {/* Branch cards */}
      <div className="bg-[#0b1425] border border-[#111e35] rounded-xl p-5">
        <SectionHead title="Branch Comparison" sub="Click a branch to drill into rep-level performance" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
          {sorted.map((bs, rank) => (
            <button
              key={bs.branch.id}
              onClick={() => setSelectedBranch(bs.branch.id === selectedBranch ? null : bs.branch.id)}
              className={`text-left p-4 rounded-xl border transition-all ${
                selectedBranch === bs.branch.id
                  ? "border-[#00c9b1] bg-[#00c9b1]/10"
                  : "border-[#111e35] hover:border-[#1e3158]"
              }`}
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="text-xs font-semibold text-white">{bs.branch.name}</p>
                  <p className="text-[10px] font-mono text-[#4a6990]">{bs.branch.city}</p>
                </div>
                <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${rank === 0 ? "bg-[#00c9b1]/20 text-[#00c9b1]" : rank === sorted.length - 1 ? "bg-[#ff4d6a]/20 text-[#ff4d6a]" : "bg-[#111e35] text-[#4a6990]"}`}>
                  #{rank + 1}
                </span>
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between text-[10px] font-mono">
                  <span className="text-[#4a6990]">Leads</span>
                  <span className="text-white">{bs.total}</span>
                </div>
                <div className="flex justify-between text-[10px] font-mono">
                  <span className="text-[#4a6990]">Sold</span>
                  <span style={{ color: C.teal }}>{bs.sold}</span>
                </div>
                <div className="flex justify-between text-[10px] font-mono">
                  <span className="text-[#4a6990]">Close Rate</span>
                  <span style={{ color: bs.closeRate >= 20 ? C.teal : bs.closeRate >= 15 ? C.amber : C.red }}>
                    {bs.closeRate.toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between text-[10px] font-mono">
                  <span className="text-[#4a6990]">Revenue</span>
                  <span className="text-[#7a9ec0]">{fmtCrore(bs.totalRevenue)}</span>
                </div>
              </div>
              {/* Revenue bar */}
              <div className="mt-3 h-1 rounded-full bg-[#111e35] overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${(bs.totalRevenue / maxRevenue) * 100}%`, background: rank === 0 ? C.teal : C.blue }} />
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Selected branch drill-down */}
      {selected && (
        <div className="bg-[#0b1425] border border-[#00c9b1]/30 rounded-xl p-5">
          <SectionHead
            title={`${selected.branch.name} — Rep Breakdown`}
            sub={`${selected.branch.city} · ${selected.reps.length} sales officers · ${selected.closeRate.toFixed(1)}% close rate`}
          />
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="border-b border-[#111e35]">
                  {["Rep", "Role", "Leads", "Sold", "Lost", "Close %", "Revenue", "Avg Response"].map(h => (
                    <th key={h} className="text-left py-2 pr-4 text-[#4a6990] uppercase tracking-wider text-[10px]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...selected.reps].sort((a, b) => b.sold - a.sold).map((rep, i) => (
                  <tr key={rep.rep.id} className={`border-b border-[#0d1829] hover:bg-[#111e35] transition-colors ${i === 0 ? "text-white" : "text-[#7a9ec0]"}`}>
                    <td className="py-2.5 pr-4 font-semibold">{rep.rep.name}</td>
                    <td className="pr-4">
                      <span className={`text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wider ${rep.rep.role === "branch_manager" ? "bg-[#00c9b1]/20 text-[#00c9b1]" : "bg-[#1e3158] text-[#4a6990]"}`}>
                        {rep.rep.role === "branch_manager" ? "Manager" : "Officer"}
                      </span>
                    </td>
                    <td className="pr-4">{rep.total}</td>
                    <td className="pr-4" style={{ color: C.teal }}>{rep.sold}</td>
                    <td className="pr-4" style={{ color: rep.lost > 3 ? C.red : C.muted }}>{rep.lost}</td>
                    <td className="pr-4" style={{ color: rep.closeRate >= 20 ? C.teal : rep.closeRate >= 15 ? C.amber : C.red }}>
                      {rep.closeRate.toFixed(1)}%
                    </td>
                    <td className="pr-4">{fmtCrore(rep.totalRevenue)}</td>
                    <td>{rep.avgResponseHrs < 1 ? `${Math.round(rep.avgResponseHrs * 60)}m` : `${rep.avgResponseHrs.toFixed(1)}h`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Global rep leaderboard */}
      <div className="bg-[#0b1425] border border-[#111e35] rounded-xl p-5">
        <div className="flex items-start justify-between mb-5">
          <SectionHead title="Rep Leaderboard — Top 15 by Sales" sub="All branches combined" />
          <button
            onClick={exportRepsCSV}
            className="flex-shrink-0 flex items-center gap-1.5 text-xs font-mono px-3 py-1.5 rounded border border-[#1e3158] text-[#7a9ec0] hover:border-[#00c9b1] hover:text-[#00c9b1] transition-colors"
          >
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M5.5 1v7M2.5 5l3 3 3-3M1 9.5h9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Export CSV
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="border-b border-[#111e35]">
                {["#", "Rep", "Branch", "Leads", "Sold", "Lost", "Close %", "Revenue", "Avg Resp."].map(h => (
                  <th key={h} className="text-left py-2 pr-4 text-[#4a6990] uppercase tracking-wider text-[10px]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {allReps.map((rep, i) => {
                const branch = BRANCH_STATS.find(b => b.branch.id === rep.rep.branch_id);
                return (
                  <tr key={rep.rep.id} className="border-b border-[#0d1829] hover:bg-[#111e35] transition-colors">
                    <td className="py-2.5 pr-4">
                      {i === 0 ? <span className="text-[#ffd700] font-bold">1</span>
                        : i === 1 ? <span className="text-[#c0c0c0]">2</span>
                        : i === 2 ? <span className="text-[#cd7f32]">3</span>
                        : <span className="text-[#4a6990]">{i + 1}</span>}
                    </td>
                    <td className="pr-4 font-semibold text-white">{rep.rep.name}</td>
                    <td className="pr-4 text-[#4a6990]">{branch?.branch.name ?? "—"}</td>
                    <td className="pr-4 text-[#7a9ec0]">{rep.total}</td>
                    <td className="pr-4" style={{ color: C.teal }}>{rep.sold}</td>
                    <td className="pr-4" style={{ color: rep.lost > 3 ? C.red : C.muted }}>{rep.lost}</td>
                    <td className="pr-4" style={{ color: rep.closeRate >= 20 ? C.teal : rep.closeRate >= 15 ? C.amber : C.red }}>
                      {rep.closeRate.toFixed(1)}%
                    </td>
                    <td className="pr-4 text-[#7a9ec0]">{fmtCrore(rep.totalRevenue)}</td>
                    <td className="text-[#4a6990]">{rep.avgResponseHrs < 1 ? `${Math.round(rep.avgResponseHrs * 60)}m` : `${rep.avgResponseHrs.toFixed(1)}h`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Lead aging tab ───────────────────────────────────────────────────────────
function AgingTab() {
  const [filter, setFilter] = useState<AgingLead["urgency"] | "all">("all");
  const shown = filter === "all" ? AGING : AGING.filter(a => a.urgency === filter);

  const counts = {
    critical: AGING.filter(a => a.urgency === "critical").length,
    high: AGING.filter(a => a.urgency === "high").length,
    medium: AGING.filter(a => a.urgency === "medium").length,
  };

  const urgencyStyle: Record<string, string> = {
    critical: C.red, high: C.amber, medium: "#ffd23f",
  };
  const urgencyBg: Record<string, string> = {
    critical: "#ff4d6a20", high: "#ffad3320", medium: "#ffd23f20",
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        {(["critical", "high", "medium"] as const).map(u => (
          <div key={u} className="bg-[#0b1425] border rounded-xl p-4" style={{ borderColor: urgencyStyle[u] + "40" }}>
            <p className="text-[10px] font-mono uppercase tracking-widest mb-1" style={{ color: urgencyStyle[u] }}>
              {u === "critical" ? "Critical (21+ days)" : u === "high" ? "High (14–20 days)" : "Medium (7–13 days)"}
            </p>
            <p className="text-3xl font-mono font-semibold" style={{ color: urgencyStyle[u] }}>{counts[u]}</p>
            <p className="text-[10px] font-mono text-[#4a6990] mt-1">leads going cold</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-[#0b1425] border border-[#111e35] rounded-xl p-5">
        <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
          <SectionHead title="Cold Lead Watchlist" sub={`${AGING.length} leads with no activity in 7+ days`} />
          <div className="flex items-center gap-2">
            <button
              onClick={exportAgingCSV}
              className="flex items-center gap-1.5 text-xs font-mono px-3 py-1.5 rounded border border-[#1e3158] text-[#7a9ec0] hover:border-[#00c9b1] hover:text-[#00c9b1] transition-colors"
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M5.5 1v7M2.5 5l3 3 3-3M1 9.5h9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
              Export CSV
            </button>
            <div className="flex gap-1">
            {(["all", "critical", "high", "medium"] as const).map(u => (
              <button
                key={u}
                onClick={() => setFilter(u)}
                className={`text-[10px] font-mono uppercase tracking-wider px-3 py-1.5 rounded border transition-all ${
                  filter === u
                    ? u === "all" ? "bg-[#1e3158] border-[#273f6e] text-white" : `border-opacity-50 text-white`
                    : "border-[#111e35] text-[#4a6990] hover:border-[#1e3158]"
                }`}
                style={filter === u && u !== "all" ? { borderColor: urgencyStyle[u], color: urgencyStyle[u], background: urgencyBg[u] } : {}}
              >
                {u}{u !== "all" && ` (${counts[u]})`}
              </button>
            ))}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="border-b border-[#111e35]">
                {["Urgency", "Customer", "Model", "Source", "Status", "Rep", "Branch", "Days Silent", "Deal Value"].map(h => (
                  <th key={h} className="text-left py-2 pr-4 text-[#4a6990] uppercase tracking-wider text-[10px] whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, 80).map(a => (
                <tr key={a.lead.id} className="border-b border-[#0d1829] hover:bg-[#111e35] transition-colors group">
                  <td className="py-2.5 pr-4">
                    <span className="text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded" style={{ color: urgencyStyle[a.urgency], background: urgencyBg[a.urgency] }}>
                      {a.urgency}
                    </span>
                  </td>
                  <td className="pr-4 text-white font-semibold whitespace-nowrap">{a.lead.customer_name}</td>
                  <td className="pr-4 text-[#7a9ec0]">{a.lead.model_interested}</td>
                  <td className="pr-4 text-[#4a6990]">{a.lead.source.replace("_", " ")}</td>
                  <td className="pr-4">
                    <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-[#1e3158] text-[#7a9ec0]">
                      {a.currentStatus.replace("_", " ")}
                    </span>
                  </td>
                  <td className="pr-4 text-[#7a9ec0] whitespace-nowrap">{a.rep?.name ?? "—"}</td>
                  <td className="pr-4 text-[#4a6990]">{a.branch?.name ?? "—"}</td>
                  <td className="pr-4 font-bold" style={{ color: urgencyStyle[a.urgency] }}>
                    {a.daysSinceActivity}d
                  </td>
                  <td className="text-[#4a6990]">{fmtLakh(a.lead.deal_value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length > 80 && (
            <p className="text-center text-[10px] font-mono text-[#2a4168] mt-3">
              Showing 80 of {shown.length} results
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Summary card with copy button ───────────────────────────────────────────
function SummaryCard({ branch, summary, flagStyle }: {
  branch: string;
  summary: string;
  flagStyle: { border: string; bg: string; dot: string; label: string };
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await copyText(`${branch} — ${flagStyle.label}\n\n${summary}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="border rounded-xl p-4 relative group" style={{ borderColor: flagStyle.border, background: flagStyle.bg }}>
      <div className="flex items-center gap-2 mb-2">
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: flagStyle.dot }} />
        <span className="text-xs font-semibold text-white">{branch}</span>
        <span className="ml-auto text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ color: flagStyle.dot, background: flagStyle.dot + "20" }}>
          {flagStyle.label}
        </span>
        <button
          onClick={handleCopy}
          title="Copy to clipboard"
          className="opacity-0 group-hover:opacity-100 transition-opacity ml-1 p-1 rounded hover:bg-white/10"
        >
          {copied
            ? <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M2 5.5l2.5 2.5 4.5-4.5" stroke="#00c9b1" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
            : <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><rect x="1" y="3" width="7" height="7" rx="1" stroke="#7a9ec0" strokeWidth="1.2"/><path d="M3 3V2a1 1 0 011-1h5a1 1 0 011 1v5a1 1 0 01-1 1H8" stroke="#7a9ec0" strokeWidth="1.2" strokeLinecap="round"/></svg>
          }
        </button>
      </div>
      <p className="text-[11px] leading-relaxed text-[#7a9ec0]">{summary}</p>
    </div>
  );
}

// ─── Insights tab ─────────────────────────────────────────────────────────────
function InsightsTab() {
  // Forecast: extrapolate Dec trend from data
  const lastMonth = MONTHLY[MONTHLY.length - 1];
  const avgMonthlyLeads = Math.round(MONTHLY.reduce((s, m) => s + m.newLeads, 0) / MONTHLY.length);
  const avgMonthlySold = MONTHLY.reduce((s, m) => s + m.sold, 0) / MONTHLY.length;

  // What-if scenario state
  const [tdImprovement, setTdImprovement] = useState(10);
  const baseConversionRate = PIPELINE.sold / Math.max(PIPELINE.engaged, 1);
  const improvedSold = Math.round(PIPELINE.engaged * (baseConversionRate + tdImprovement / 100));
  const additionalUnits = improvedSold - PIPELINE.sold;
  const avgDealVal = KPIS.avgDealValue;
  const additionalRevenue = additionalUnits * avgDealVal;

  const branchForecast = BRANCH_STATS.map(bs => {
    const expectedClose = Math.round(bs.active * (bs.closeRate / 100));
    return { bs, expectedClose };
  });

  const aiSummaries: { branch: string; summary: string; flag: "good" | "warn" | "bad" }[] = BRANCH_STATS.map(bs => {
    const cr = bs.closeRate;
    const tdcr = bs.testDriveConversion;
    const topRep = [...bs.reps].sort((a, b) => b.sold - a.sold)[0];
    if (cr >= 20) {
      return {
        branch: bs.branch.name,
        summary: `Strong performer with ${cr.toFixed(1)}% close rate. ${topRep?.rep.name ?? "Top rep"} leads with ${topRep?.sold ?? 0} sales. Test-drive conversion at ${tdcr.toFixed(0)}% — consider replicating this team's follow-up cadence across other branches.`,
        flag: "good" as const,
      };
    } else if (cr >= 15) {
      return {
        branch: bs.branch.name,
        summary: `Mid-tier at ${cr.toFixed(1)}% close rate. ${bs.lost} leads lost — review lost reasons for quick wins. ${bs.active} leads still active; prioritise follow-ups on leads silent 7+ days.`,
        flag: "warn" as const,
      };
    } else {
      return {
        branch: bs.branch.name,
        summary: `Below-average close rate of ${cr.toFixed(1)}%. ${bs.lost} leads lost, only ${bs.sold} converted. Immediate coaching recommended. Test-drive-to-order conversion of ${tdcr.toFixed(0)}% suggests negotiation-stage drop-off.`,
        flag: "bad" as const,
      };
    }
  }).sort((a, b) => (b.flag === "good" ? 1 : b.flag === "warn" ? 0 : -1) - (a.flag === "good" ? 1 : a.flag === "warn" ? 0 : -1));

  const flagStyle: Record<string, { border: string; bg: string; dot: string; label: string }> = {
    good: { border: C.teal + "40", bg: C.teal + "0d", dot: C.teal, label: "On Track" },
    warn: { border: C.amber + "40", bg: C.amber + "0d", dot: C.amber, label: "Needs Attention" },
    bad: { border: C.red + "40", bg: C.red + "0d", dot: C.red, label: "At Risk" },
  };

  return (
    <div className="flex flex-col gap-5">
      {/* AI Summaries */}
      <div className="bg-[#0b1425] border border-[#111e35] rounded-xl p-5">
        <SectionHead title="AI Branch Performance Summaries" sub="Auto-generated from Jun–Dec 2025 data" />
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
          {aiSummaries.map(({ branch, summary, flag }) => {
            const s = flagStyle[flag];
            return (
              <SummaryCard key={branch} branch={branch} summary={summary} flagStyle={s} />
            );
          })}
        </div>
      </div>

      {/* What-if scenario */}
      <div className="bg-[#0b1425] border border-[#00c9b1]/20 rounded-xl p-5">
        <SectionHead title='What-If Scenario: "If we improve test-drive conversion..."' sub="Adjust the slider to model the revenue impact of a conversion rate improvement" />
        <div className="flex flex-col lg:flex-row gap-8 items-start">
          <div className="flex-1">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-mono text-[#7a9ec0]">Test Drive → Order improvement</span>
              <span className="text-2xl font-mono font-bold text-[#00c9b1]">+{tdImprovement}%</span>
            </div>
            <input
              type="range" min={1} max={30} value={tdImprovement}
              onChange={e => setTdImprovement(Number(e.target.value))}
              className="w-full accent-[#00c9b1] h-1.5 rounded-full bg-[#1e3158] appearance-none cursor-pointer"
            />
            <div className="flex justify-between text-[9px] font-mono text-[#2a4168] mt-1">
              <span>+1%</span><span>+30%</span>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4 flex-shrink-0">
            {[
              { label: "Current Sold", value: PIPELINE.sold.toString(), color: C.muted },
              { label: "Projected Sold", value: improvedSold.toString(), color: C.teal },
              { label: "Additional Units", value: `+${additionalUnits}`, color: C.teal },
            ].map(item => (
              <div key={item.label} className="bg-[#060d1a] rounded-xl p-4 text-center">
                <p className="text-[10px] font-mono text-[#4a6990] uppercase tracking-wider mb-1">{item.label}</p>
                <p className="text-2xl font-mono font-bold" style={{ color: item.color }}>{item.value}</p>
              </div>
            ))}
          </div>
        </div>
        {additionalUnits > 0 && (
          <div className="mt-4 p-4 bg-[#00c9b1]/5 border border-[#00c9b1]/20 rounded-xl">
            <p className="text-sm text-[#00c9b1] font-semibold">
              Projected additional revenue: <span className="font-mono text-lg">{fmtCrore(additionalRevenue)}</span>
            </p>
            <p className="text-xs text-[#4a6990] font-mono mt-1">
              Based on {PIPELINE.engaged} leads who reached test drive stage × avg deal value of {fmtLakh(avgDealVal)}
            </p>
          </div>
        )}
      </div>

      {/* Pipeline forecast */}
      <div className="bg-[#0b1425] border border-[#111e35] rounded-xl p-5">
        <SectionHead title="Active Pipeline Forecast" sub="Projected closings from remaining active leads per branch (at current close rates)" />
        <div className="flex flex-col gap-3">
          {branchForecast.map(({ bs, expectedClose }) => (
            <div key={bs.branch.id} className="flex items-center gap-4">
              <div className="w-40 flex-shrink-0">
                <p className="text-xs font-semibold text-white">{bs.branch.name}</p>
                <p className="text-[10px] font-mono text-[#4a6990]">{bs.active} active leads</p>
              </div>
              <div className="flex-1 h-7 bg-[#111e35] rounded-lg overflow-hidden relative">
                <div
                  className="h-full rounded-lg flex items-center px-2 transition-all duration-700"
                  style={{
                    width: `${Math.min(100, (expectedClose / Math.max(...branchForecast.map(b => b.expectedClose))) * 100)}%`,
                    background: bs.closeRate >= 20 ? C.teal + "33" : bs.closeRate >= 15 ? C.amber + "33" : C.red + "33",
                    borderRight: `2px solid ${bs.closeRate >= 20 ? C.teal : bs.closeRate >= 15 ? C.amber : C.red}`,
                  }}
                />
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-mono text-white">
                  ~{expectedClose} expected closes
                </span>
              </div>
              <div className="w-16 text-right">
                <p className="text-xs font-mono font-semibold" style={{ color: bs.closeRate >= 20 ? C.teal : bs.closeRate >= 15 ? C.amber : C.red }}>
                  {bs.closeRate.toFixed(1)}%
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState<Tab>("overview");
  const [liveTime, setLiveTime] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setLiveTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: "overview", label: "Overview" },
    { id: "branches", label: "Branches" },
    { id: "aging", label: "Lead Aging", badge: AGING.filter(a => a.urgency === "critical").length },
    { id: "insights", label: "Insights & Forecast" },
  ];

  return (
    <div className="min-h-full bg-[#060d1a] text-[#e2eaf6] flex flex-col">
      {/* Nav */}
      <header className="flex-shrink-0 flex items-center justify-between px-5 h-12 border-b border-[#111e35] bg-[#0b1425]">
        <div className="flex items-center gap-3">
          <span className="text-[#00c9b1] font-bold text-lg tracking-tight">Satya.ai</span>
          <span className="text-[#1e3158] text-lg">|</span>
          <span className="text-[#7a9ec0] text-sm font-medium">DealerPulse Analytics</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-[#4a6990] hidden sm:block">Jun–Dec 2025 · 5 Branches · 510 Leads</span>
          <ExportMenu tab={tab} />
          <div className="flex items-center gap-1.5 bg-[#111e35] border border-[#1e3158] rounded-full px-3 py-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[#00c9b1]" />
            <span className="text-[10px] font-mono text-[#00c9b1] tracking-widest">LIVE</span>
          </div>
          <div className="w-7 h-7 rounded-full bg-[#00c9b1] flex items-center justify-center text-[#060d1a] text-xs font-bold">CEO</div>
        </div>
      </header>

      {/* Page header */}
      <div className="flex-shrink-0 border-b border-[#111e35] bg-[#0b1425] px-5">
        <div className="max-w-[1600px] mx-auto flex items-end gap-1 pt-4 overflow-x-auto">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-shrink-0 flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-all whitespace-nowrap ${
                tab === t.id
                  ? "border-[#00c9b1] text-[#00c9b1]"
                  : "border-transparent text-[#4a6990] hover:text-[#7a9ec0]"
              }`}
            >
              {t.label}
              {t.badge != null && t.badge > 0 && (
                <span className="text-[9px] font-mono bg-[#ff4d6a] text-white rounded-full px-1.5 py-0.5">{t.badge}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-5 overflow-auto">
        <div className="max-w-[1600px] mx-auto">
          {tab === "overview" && <OverviewTab />}
          {tab === "branches" && <BranchesTab />}
          {tab === "aging" && <AgingTab />}
          {tab === "insights" && <InsightsTab />}
        </div>
      </div>
    </div>
  );
}
