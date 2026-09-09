import rawData from "@/imports/dealership_data.json";

// ─── Raw types ────────────────────────────────────────────────────────────────
export interface Branch { id: string; name: string; city: string }
export interface SalesRep { id: string; name: string; branch_id: string; role: string; joined: string }
export interface StatusEntry { status: string; timestamp: string; note: string }
export interface Lead {
  id: string;
  customer_name: string;
  phone: string;
  source: string;
  model_interested: string;
  status: string;
  assigned_to: string;
  branch_id: string;
  created_at: string;
  last_activity_at: string;
  status_history: StatusEntry[];
  expected_close_date: string;
  deal_value: number;
  lost_reason: string | null;
}

const STATUS_RANK: Record<string, number> = {
  new: 0, contacted: 1, test_drive: 2, negotiation: 3, order_placed: 4, delivered: 5, lost: -1,
};

const isSold = (s: string) => s === "order_placed" || s === "delivered";
const isLost = (s: string) => s === "lost";
const isActive = (s: string) => !isSold(s) && !isLost(s);

function maxStatus(lead: Lead): number {
  return Math.max(...lead.status_history.map(e => STATUS_RANK[e.status] ?? -2));
}

function reachedStatus(lead: Lead, target: string): boolean {
  return lead.status_history.some(e => e.status === target || STATUS_RANK[e.status] > STATUS_RANK[target]);
}

function getStatusTimestamp(lead: Lead, status: string): string | null {
  const entry = lead.status_history.find(e => e.status === status);
  return entry ? entry.timestamp : null;
}

// ─── Exports ──────────────────────────────────────────────────────────────────
export const branches: Branch[] = (rawData as any).branches;
export const salesReps: SalesRep[] = (rawData as any).sales_reps;
export const leads: Lead[] = (rawData as any).leads;

// ─── Pipeline funnel ──────────────────────────────────────────────────────────
export function getPipeline() {
  const total = leads.length;
  const attempted = leads.filter(l => reachedStatus(l, "contacted")).length;
  const engaged = leads.filter(l => reachedStatus(l, "test_drive")).length;
  // Test drove but didn't convert (still active OR lost after test_drive)
  const unsoldVisits = leads.filter(l => reachedStatus(l, "test_drive") && !isSold(l.status)).length;
  const sold = leads.filter(l => isSold(l.status)).length;
  const lost = leads.filter(l => isLost(l.status)).length;
  const active = leads.filter(l => isActive(l.status)).length;
  return { total, attempted, engaged, unsoldVisits, sold, lost, active };
}

// ─── Monthly chart data ───────────────────────────────────────────────────────
export function getMonthlyChart() {
  const months: Record<string, { month: string; newLeads: number; sold: number; lost: number; testDrives: number }> = {};
  const monthLabels = ["Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  monthLabels.forEach(m => (months[m] = { month: m, newLeads: 0, sold: 0, lost: 0, testDrives: 0 }));

  leads.forEach(lead => {
    const created = new Date(lead.created_at);
    const mLabel = created.toLocaleString("default", { month: "short" });
    if (!months[mLabel]) return;
    months[mLabel].newLeads++;

    // Count sold by when order_placed happened
    const opTs = getStatusTimestamp(lead, "order_placed") || getStatusTimestamp(lead, "delivered");
    if (opTs) {
      const m2 = new Date(opTs).toLocaleString("default", { month: "short" });
      if (months[m2]) months[m2].sold++;
    }

    // Count lost
    if (isLost(lead.status)) {
      const lostTs = getStatusTimestamp(lead, "lost");
      if (lostTs) {
        const m3 = new Date(lostTs).toLocaleString("default", { month: "short" });
        if (months[m3]) months[m3].lost++;
      }
    }

    // Count test drives
    const tdTs = getStatusTimestamp(lead, "test_drive");
    if (tdTs) {
      const m4 = new Date(tdTs).toLocaleString("default", { month: "short" });
      if (months[m4]) months[m4].testDrives++;
    }
  });

  return monthLabels.map(m => months[m]);
}

// ─── Branch stats ─────────────────────────────────────────────────────────────
export interface BranchStat {
  branch: Branch;
  total: number;
  sold: number;
  lost: number;
  active: number;
  testDrives: number;
  closeRate: number;
  testDriveConversion: number;
  totalRevenue: number;
  avgDealValue: number;
  reps: RepStat[];
}

export interface RepStat {
  rep: SalesRep;
  total: number;
  sold: number;
  lost: number;
  closeRate: number;
  totalRevenue: number;
  avgResponseHrs: number;
}

export function getBranchStats(): BranchStat[] {
  return branches.map(branch => {
    const branchLeads = leads.filter(l => l.branch_id === branch.id);
    const soldLeads = branchLeads.filter(l => isSold(l.status));
    const lostLeads = branchLeads.filter(l => isLost(l.status));
    const testDriveLeads = branchLeads.filter(l => reachedStatus(l, "test_drive"));

    const totalRevenue = soldLeads.reduce((s, l) => s + l.deal_value, 0);
    const branchReps = salesReps.filter(r => r.branch_id === branch.id);

    const reps: RepStat[] = branchReps.map(rep => {
      const repLeads = branchLeads.filter(l => l.assigned_to === rep.id);
      const repSold = repLeads.filter(l => isSold(l.status));
      const repLost = repLeads.filter(l => isLost(l.status));

      // Avg response time: created_at to first contacted entry
      const responseTimes = repLeads
        .map(l => {
          const contactedTs = getStatusTimestamp(l, "contacted");
          if (!contactedTs) return null;
          return (new Date(contactedTs).getTime() - new Date(l.created_at).getTime()) / (1000 * 3600);
        })
        .filter((v): v is number => v !== null && v >= 0 && v < 720);

      return {
        rep,
        total: repLeads.length,
        sold: repSold.length,
        lost: repLost.length,
        closeRate: repLeads.length ? (repSold.length / repLeads.length) * 100 : 0,
        totalRevenue: repSold.reduce((s, l) => s + l.deal_value, 0),
        avgResponseHrs: responseTimes.length
          ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
          : 0,
      };
    });

    return {
      branch,
      total: branchLeads.length,
      sold: soldLeads.length,
      lost: lostLeads.length,
      active: branchLeads.filter(l => isActive(l.status)).length,
      testDrives: testDriveLeads.length,
      closeRate: branchLeads.length ? (soldLeads.length / branchLeads.length) * 100 : 0,
      testDriveConversion: testDriveLeads.length ? (soldLeads.filter(l => reachedStatus(l, "test_drive")).length / testDriveLeads.length) * 100 : 0,
      totalRevenue,
      avgDealValue: soldLeads.length ? totalRevenue / soldLeads.length : 0,
      reps,
    };
  });
}

// ─── Lead aging ───────────────────────────────────────────────────────────────
export interface AgingLead {
  lead: Lead;
  daysSinceActivity: number;
  currentStatus: string;
  branch: Branch | undefined;
  rep: SalesRep | undefined;
  urgency: "critical" | "high" | "medium";
}

export function getAgingLeads(cutoffDays = 7): AgingLead[] {
  const refDate = new Date("2025-12-31T23:59:00Z");
  return leads
    .filter(l => isActive(l.status))
    .map(l => {
      const last = new Date(l.last_activity_at);
      const days = Math.floor((refDate.getTime() - last.getTime()) / (1000 * 86400));
      const branch = branches.find(b => b.id === l.branch_id);
      const rep = salesReps.find(r => r.id === l.assigned_to);
      const urgency: AgingLead["urgency"] = days >= 21 ? "critical" : days >= 14 ? "high" : "medium";
      return { lead: l, daysSinceActivity: days, currentStatus: l.status, branch, rep, urgency };
    })
    .filter(a => a.daysSinceActivity >= cutoffDays)
    .sort((a, b) => b.daysSinceActivity - a.daysSinceActivity);
}

// ─── Lost reason breakdown ────────────────────────────────────────────────────
export function getLostReasons() {
  const counts: Record<string, number> = {};
  leads.filter(l => isLost(l.status)).forEach(l => {
    const r = l.lost_reason ?? "Unknown";
    counts[r] = (counts[r] ?? 0) + 1;
  });
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, count }));
}

// ─── Source breakdown ─────────────────────────────────────────────────────────
export function getSourceStats() {
  const counts: Record<string, { total: number; sold: number }> = {};
  leads.forEach(l => {
    if (!counts[l.source]) counts[l.source] = { total: 0, sold: 0 };
    counts[l.source].total++;
    if (isSold(l.status)) counts[l.source].sold++;
  });
  return Object.entries(counts)
    .map(([source, s]) => ({ source, ...s, closeRate: (s.sold / s.total) * 100 }))
    .sort((a, b) => b.total - a.total);
}

// ─── KPIs ─────────────────────────────────────────────────────────────────────
export function getKPIs() {
  const pipeline = getPipeline();
  const soldLeads = leads.filter(l => isSold(l.status));
  const totalRevenue = soldLeads.reduce((s, l) => s + l.deal_value, 0);

  // Avg response time (hours)
  const responseTimes = leads
    .map(l => {
      const ct = getStatusTimestamp(l, "contacted");
      if (!ct) return null;
      const diff = (new Date(ct).getTime() - new Date(l.created_at).getTime()) / (1000 * 3600);
      return diff >= 0 && diff < 720 ? diff : null;
    })
    .filter((v): v is number => v !== null);
  const avgResponseHrs = responseTimes.length
    ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
    : 0;

  const bStats = getBranchStats();
  const topBranch = [...bStats].sort((a, b) => b.closeRate - a.closeRate)[0];

  return {
    totalLeads: pipeline.total,
    closeRate: (pipeline.sold / pipeline.total) * 100,
    totalRevenue,
    avgDealValue: soldLeads.length ? totalRevenue / soldLeads.length : 0,
    avgResponseHrs,
    topBranch: topBranch?.branch.name ?? "—",
    topBranchCloseRate: topBranch?.closeRate ?? 0,
    agingLeadsCount: getAgingLeads(14).length,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
export function fmtCrore(n: number): string {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`;
  return `₹${n.toLocaleString("en-IN")}`;
}

export function fmtLakh(n: number): string {
  return `₹${(n / 1e5).toFixed(1)}L`;
}
