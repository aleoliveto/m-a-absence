import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { Card, Field, Input, Select, Table, Skeleton } from "../components/ui";
import {
  Chart as ChartJS,
  LineElement, CategoryScale, LinearScale, PointElement, Tooltip, Legend, BarElement
} from "chart.js";
import { Line, Bar } from "react-chartjs-2";

ChartJS.register(LineElement, CategoryScale, LinearScale, PointElement, Tooltip, Legend, BarElement);

const iso = (d) => new Date(d).toISOString().slice(0, 10);
const todayIso = iso(new Date());

export default function Dashboard() {
  const [bases, setBases] = useState([]);
  const [depts, setDepts] = useState([]);
  const [reasons, setReasons] = useState([]);

  const [settings, setSettings] = useState({ frequent_absences_threshold: 3, long_absence_days: 7 });

  const [filters, setFilters] = useState(() => {
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 86400000);
    return { base: "", dept: "", from: iso(from), to: iso(to) };
  });

  const [absences, setAbsences] = useState([]);
  const [headcount, setHeadcount] = useState(0);
  const [loading, setLoading] = useState(true);

  // lookups + headcount + settings
  useEffect(() => {
    (async () => {
      const { data: emps } = await supabase.from("employee").select("id,base,department").eq("status","active");
      setHeadcount(emps?.length || 0);
      setBases([...new Set((emps||[]).map(e=>e.base).filter(Boolean))].sort());
      setDepts([...new Set((emps||[]).map(e=>e.department).filter(Boolean))].sort());

      const { data: rs } = await supabase.from("absence_reason").select("code,label").order("label", { ascending: true });
      setReasons(rs || []);

      const { data: s } = await supabase.from("settings").select("*").eq("id",1).maybeSingle();
      if (s) setSettings(s);
    })();
  }, []);

  // data
  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("absence")
        .select("id,start_date,end_date,reason_code,employee:employee_id ( id, base, department, first_name, last_name )")
        .gte("start_date", filters.from)
        .lte("end_date", filters.to)
        .order("start_date", { ascending: false });
      const view = (data||[]).filter(r =>
        (!filters.base || r.employee?.base===filters.base) &&
        (!filters.dept || r.employee?.department===filters.dept)
      );
      setAbsences(view);
      setLoading(false);
    })();
  }, [filters]);

  const dayDiff = (a,b)=>Math.max(1, Math.round((new Date(b)-new Date(a))/86400000)+1);

  // KPIs
  const kpi = useMemo(()=>{
    const current = absences.filter(a=>a.start_date<=todayIso && a.end_date>=todayIso).length;

    const since30 = iso(new Date(Date.now()-30*86400000));
    const uniq = new Set(absences.filter(a=>a.start_date>=since30).map(a=>a.employee?.id));
    const pct30 = headcount>0 ? Math.round(10000*uniq.size/headcount)/100 : 0;

    const since90 = iso(new Date(Date.now()-90*86400000));
    const countByEmp = {};
    absences.filter(a=>a.start_date>=since90).forEach(a=>{
      const k=a.employee?.id; if(!k) return; countByEmp[k]=(countByEmp[k]||0)+1;
    });
    const frequent = Object.values(countByEmp).filter(n=>n >= settings.frequent_absences_threshold).length;

    const durations = absences.map(a=>dayDiff(a.start_date,a.end_date));
    const avgDur = durations.length ? Math.round(10*durations.reduce((s,n)=>s+n,0)/durations.length)/10 : 0;

    return { current, pct30, frequent, avgDur };
  }, [absences, headcount, settings.frequent_absences_threshold]);

  // Top repeat absentees (last 90d, using threshold)
  const topRepeat = useMemo(()=>{
    const since90 = iso(new Date(Date.now()-90*86400000));
    const by = new Map();
    absences.filter(a=>a.start_date>=since90).forEach(a=>{
      if(!a.employee) return;
      const key = a.employee.id;
      const entry = by.get(key) || { count:0, emp:a.employee };
      entry.count += 1;
      by.set(key, entry);
    });
    return [...by.values()].sort((a,b)=>b.count-a.count).slice(0,5);
  }, [absences]);

  // Trends
  const trendWeeks = useMemo(()=>{
    const weeks = Array.from({length:12}, (_,i)=>{
      const end = new Date(); end.setDate(end.getDate()-(11-i)*7);
      const start = new Date(end.getTime()-6*86400000);
      return { label:`${start.toISOString().slice(5,10)}–${end.toISOString().slice(5,10)}`, start: iso(start), end: iso(end) };
    });
    const counts = weeks.map(w => absences.filter(a => !(a.end_date < w.start || a.start_date > w.end)).length);
    return { labels: weeks.map(w=>w.label), data: counts };
  }, [absences]);

  const trendMonths = useMemo(()=>{
    const months=[]; const d=new Date(); d.setDate(1); d.setMonth(d.getMonth()-11);
    for(let i=0;i<12;i++){ const y=d.getFullYear(), m=d.getMonth(); const s=new Date(y,m,1), e=new Date(y,m+1,0);
      months.push({ label:s.toLocaleString("en",{month:"short"}), start:iso(s), end:iso(e) }); d.setMonth(m+1);
    }
    const counts = months.map(m => absences.filter(a => !(a.end_date < m.start || a.start_date > m.end)).length);
    return { labels: months.map(m=>m.label), data: counts };
  }, [absences]);

  const reasonBar = useMemo(()=>{
    const labels = reasons.map(r=>r.code);
    const data = labels.map(c => absences.filter(a=>a.reason_code===c).length);
    return { labels, data };
  }, [absences, reasons]);

  // heatmap (Sun..Sat)
  const heat = useMemo(()=>{
    const by=[0,0,0,0,0,0,0];
    absences.forEach(a=>{
      let d=new Date(a.start_date), end=new Date(a.end_date);
      while(d<=end){ by[d.getDay()] += 1; d.setDate(d.getDate()+1); }
    });
    const peak=Math.max(1,...by);
    return { by, peak };
  }, [absences]);

  return (
    <div className="space-y-6">
      <div className="text-sm text-gray-600">Overview of absence trends and key indicators.</div>
      <Card title="Filters">
        <div className="grid md:grid-cols-5 gap-3">
          <Field label="Base">
            <Select value={filters.base} onChange={e=>setFilters(f=>({...f,base:e.target.value}))}>
              <option value="">All bases</option>
              {bases.map(b=><option key={b} value={b}>{b}</option>)}
            </Select>
          </Field>
          <Field label="Department">
            <Select value={filters.dept} onChange={e=>setFilters(f=>({...f,dept:e.target.value}))}>
              <option value="">All departments</option>
              {depts.map(d=><option key={d} value={d}>{d}</option>)}
            </Select>
          </Field>
          <Field label="From"><Input type="date" value={filters.from} onChange={e=>setFilters(f=>({...f,from:e.target.value}))}/></Field>
          <Field label="To"><Input type="date" value={filters.to} onChange={e=>setFilters(f=>({...f,to:e.target.value}))}/></Field>
          <div className="flex items-end">
            <div className="text-sm text-gray-600">
              Headcount: <span className="font-semibold">{headcount}</span>
            </div>
          </div>
        </div>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card title="Current absentees"><div className="text-3xl font-bold">{loading ? <Skeleton className="h-8 w-20"/> : kpi.current}</div></Card>
        <Card title="30-day absence %"><div className="text-3xl font-bold">{loading ? <Skeleton className="h-8 w-24"/> : `${kpi.pct30}%`}</div></Card>
        <Card title={`Frequent absentees (≥${settings.frequent_absences_threshold} in 90d)`}><div className="text-3xl font-bold">{loading ? <Skeleton className="h-8 w-20"/> : kpi.frequent}</div></Card>
        <Card title={`Avg duration (days, long ≥${settings.long_absence_days})`}><div className="text-3xl font-bold">{loading ? <Skeleton className="h-8 w-20"/> : kpi.avgDur}</div></Card>
      </div>

      {/* Trends */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Absence trend — last 12 weeks">
          <Line data={{ labels: trendWeeks.labels, datasets:[{ label:"Absences", data: trendWeeks.data }] }} options={{ maintainAspectRatio:false }} height={220}/>
        </Card>
        <Card title="Absence trend — last 12 months">
          <Line data={{ labels: trendMonths.labels, datasets:[{ label:"Absences", data: trendMonths.data }] }} options={{ maintainAspectRatio:false }} height={220}/>
        </Card>
      </div>

      {/* Reason breakdown + Top repeat */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Reason breakdown (count)">
          <Bar data={{ labels: reasonBar.labels, datasets:[{ label:"Count", data: reasonBar.data }] }} options={{ maintainAspectRatio:false }} height={240}/>
        </Card>

        <Card title={`Top repeat absentees (last 90 days, threshold ${settings.frequent_absences_threshold})`}>
          {topRepeat.length === 0 ? (
            <div className="text-sm text-gray-500">No repeat absentees in the selected window.</div>
          ) : (
            <Table head={["Employee","Base","Dept","Events (90d)"]}>
              {topRepeat.map(x=>(
                <tr key={x.emp.id}>
                  <td className="p-3">{x.emp.first_name} {x.emp.last_name}</td>
                  <td className="p-3">{x.emp.base}</td>
                  <td className="p-3">{x.emp.department}</td>
                  <td className="p-3">{x.count}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>

      {/* Heatmap */}
      <Card title="Heatmap — absence days by weekday">
        <div className="grid grid-cols-7 gap-2">
          {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d,i)=>{
            const v = heat.by[i]; const intensity = heat.peak===0 ? 0 : v/heat.peak;
            const bg = `rgba(255,102,0,${0.15 + 0.7*intensity})`;
            return (
              <div key={d} className="rounded-lg p-3 text-center" style={{background:bg}}>
                <div className="text-sm text-gray-700">{d}</div>
                <div className="text-xl font-bold">{v}</div>
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  );
}
