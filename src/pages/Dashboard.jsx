import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  Chart as ChartJS,
  LineElement,
  CategoryScale,
  LinearScale,
  PointElement,
  Tooltip,
  Legend,
} from "chart.js";
import { Line } from "react-chartjs-2";

ChartJS.register(LineElement, CategoryScale, LinearScale, PointElement, Tooltip, Legend);

const iso = (d) => new Date(d).toISOString().slice(0, 10);
const todayIso = iso(new Date());

export default function Dashboard() {
  const [bases, setBases] = useState([]);
  const [depts, setDepts] = useState([]);

  const [filters, setFilters] = useState(() => {
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 86400000); // last 30 days
    return { base: "", dept: "", from: iso(from), to: iso(to) };
  });

  const [absences, setAbsences] = useState([]);
  const [headcount, setHeadcount] = useState(0);
  const [loading, setLoading] = useState(true);

  // fetch filter lists (distinct base/dept) and headcount
  useEffect(() => {
    (async () => {
      const { data: emps } = await supabase
        .from("employee")
        .select("base,department,id")
        .eq("status", "active");

      const b = [...new Set((emps || []).map((e) => e.base).filter(Boolean))].sort();
      const d = [...new Set((emps || []).map((e) => e.department).filter(Boolean))].sort();
      setBases(b);
      setDepts(d);
      setHeadcount(emps?.length || 0);
    })();
  }, []);

  // fetch absences in range, optionally filtered by base/dept (client join)
  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: a } = await supabase
        .from("absence")
        .select(
          "id,start_date,end_date,reason_code,employee:employee_id(id,base,department,first_name,last_name)"
        )
        .gte("start_date", filters.from)
        .lte("end_date", filters.to)
        .order("start_date", { ascending: false });

      const view = (a || []).filter(
        (r) =>
          (!filters.base || r.employee?.base === filters.base) &&
          (!filters.dept || r.employee?.department === filters.dept)
      );
      setAbsences(view);
      setLoading(false);
    })();
  }, [filters]);

  // KPIs
  const kpi = useMemo(() => {
    // current absentees (today, respecting base/dept)
    const current = absences.filter(
      (a) => a.start_date <= todayIso && a.end_date >= todayIso
    ).length;

    // rolling 30-day % (use 'from' range end if it equals 30 days; else compute with last 30 days)
    const since30 = iso(new Date(Date.now() - 30 * 86400000));
    const in30 = absences.filter((a) => a.start_date >= since30).length;
    const pct30 =
      headcount > 0 ? Math.round((10000 * in30) / headcount) / 100 : 0;

    // frequent absentees (>=3 in 90 days)
    const since90 = iso(new Date(Date.now() - 90 * 86400000));
    const countByEmp = {};
    absences
      .filter((a) => a.start_date >= since90)
      .forEach((a) => {
        const k = a.employee?.id;
        if (!k) return;
        countByEmp[k] = (countByEmp[k] || 0) + 1;
      });
    const frequent = Object.values(countByEmp).filter((n) => n >= 3).length;

    return { current, pct30, frequent };
  }, [absences, headcount]);

  // 12-week trend (counts per week)
  const trend = useMemo(() => {
    const weeks = Array.from({ length: 12 }, (_, i) => i).map((i) => {
      const end = new Date();
      end.setDate(end.getDate() - (11 - i) * 7);
      const start = new Date(end.getTime() - 6 * 86400000);
      return {
        label: `${start.toISOString().slice(5, 10)}–${end.toISOString().slice(5, 10)}`,
        start: iso(start),
        end: iso(end),
      };
    });

    const counts = weeks.map(
      (w) =>
        absences.filter(
          (a) => !(a.end_date < w.start || a.start_date > w.end)
        ).length
    );

    return { labels: weeks.map((w) => w.label), data: counts };
  }, [absences]);

  // weekday heatmap (Mon–Sun)
  const heat = useMemo(() => {
    const by = [0, 0, 0, 0, 0, 0, 0]; // Sun..Sat
    absences.forEach((a) => {
      let d = new Date(a.start_date);
      const end = new Date(a.end_date);
      while (d <= end) {
        by[d.getDay()] += 1;
        d.setDate(d.getDate() + 1);
      }
    });
    const total = Math.max(1, Math.max(...by));
    return { by, total };
  }, [absences]);

  function updateFilter(key, value) {
    setFilters((f) => ({ ...f, [key]: value }));
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="bg-white rounded shadow p-4">
        <div className="grid md:grid-cols-5 gap-3 items-end">
          <div>
            <label className="block text-sm text-gray-600 mb-1">Base</label>
            <select
              className="border rounded px-3 py-2 w-full"
              value={filters.base}
              onChange={(e) => updateFilter("base", e.target.value)}
            >
              <option value="">All bases</option>
              {bases.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Department</label>
            <select
              className="border rounded px-3 py-2 w-full"
              value={filters.dept}
              onChange={(e) => updateFilter("dept", e.target.value)}
            >
              <option value="">All departments</option>
              {depts.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">From</label>
            <input
              type="date"
              className="border rounded px-3 py-2 w-full"
              value={filters.from}
              onChange={(e) => updateFilter("from", e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">To</label>
            <input
              type="date"
              className="border rounded px-3 py-2 w-full"
              value={filters.to}
              onChange={(e) => updateFilter("to", e.target.value)}
            />
          </div>
          <div className="text-right">
            <div className="text-sm text-gray-600 mb-1">Headcount (active)</div>
            <div className="font-semibold">{headcount}</div>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded shadow">
          <div className="text-gray-600 text-sm">Current absentees</div>
          <div className="text-3xl font-bold">{loading ? "…" : kpi.current}</div>
        </div>
        <div className="bg-white p-4 rounded shadow">
          <div className="text-gray-600 text-sm">30-day absence %</div>
          <div className="text-3xl font-bold">
            {loading ? "…" : `${kpi.pct30}%`}
          </div>
        </div>
        <div className="bg-white p-4 rounded shadow">
          <div className="text-gray-600 text-sm">Frequent absentees (90d)</div>
          <div className="text-3xl font-bold">{loading ? "…" : kpi.frequent}</div>
        </div>
      </div>

      {/* Trend */}
      <div className="bg-white p-4 rounded shadow">
        <div className="font-semibold mb-2">Absence trend (last 12 weeks)</div>
        <Line
          data={{
            labels: trend.labels,
            datasets: [{ label: "Absences", data: trend.data }],
          }}
        />
      </div>

      {/* Weekday heatmap */}
      <div className="bg-white p-4 rounded shadow">
        <div className="font-semibold mb-2">Heatmap: Absence days by weekday</div>
        <div className="grid grid-cols-7 gap-2">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => {
            const v = heat.by[i];
            const intensity = heat.total === 0 ? 0 : Math.round((v / heat.total) * 100);
            const bg = `rgba(255,102,0,${0.15 + 0.7 * (intensity / 100)})`;
            return (
              <div
                key={d}
                className="rounded p-3 text-center"
                style={{ background: bg }}
                title={`${d}: ${v}`}
              >
                <div className="text-sm text-gray-700">{d}</div>
                <div className="text-xl font-bold">{v}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
