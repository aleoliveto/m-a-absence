import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { Card, Button, Field, Input, Select, Table, Badge, toast } from "../components/ui";
// Simple color generator for role buckets
const roleHue = (str = "-") => { let h = 0; for (let i=0;i<str.length;i++) h = (h*31 + str.charCodeAt(i)) % 360; return h; };

const iso = (d) => new Date(d).toISOString().slice(0,10);
const weekStart = (d) => {
  const x = new Date(d); const day = x.getDay(); // 0 Sun..6 Sat
  const diff = (day + 6) % 7; // make Monday start
  x.setDate(x.getDate() - diff);
  x.setHours(0,0,0,0);
  return x;
};
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate()+n); return x; };
const timeToMinutes = (t) => { const [h,m] = (t||"0:0").split(":").map(Number); return h*60 + m; };
const shiftHours = (start, end) => {
  const s = timeToMinutes(start), e = timeToMinutes(end);
  let mins = e - s;
  if (mins <= 0) mins += 24*60; // support overnight (end past midnight)
  return Math.max(0, mins/60);
};
const eachDateIso = (from, to) => {
  const out = []; let d = new Date(from); const end = new Date(to);
  d.setHours(0,0,0,0); end.setHours(0,0,0,0);
  while (d <= end) { out.push(d.toISOString().slice(0,10)); d.setDate(d.getDate()+1); }
  return out;
};

export default function Roster(){
  const [bases, setBases] = useState([]);
  const [depts, setDepts] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [viewMode, setViewMode] = useState("grid"); // grid | list
  const [groupBy, setGroupBy] = useState("employee"); // employee | role_code | base | department

  const [filters, setFilters] = useState(()=>{
    const ws = weekStart(new Date());
    const monday = iso(ws);
    const sunday = iso(addDays(ws, 6));
    return { base: "", dept: "", from: monday, to: sunday };
  });

  const [shifts, setShifts] = useState([]); // coverage rows with assigned_count etc.
  const [loading, setLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [absencesByEmpDay, setAbsencesByEmpDay] = useState({}); // { empId: Set([YYYY-MM-DD]) }

  const days = useMemo(()=>{
    const start = new Date(filters.from);
    return Array.from({length:7}, (_,i)=> iso(addDays(start,i)));
  }, [filters.from]);

  // lookups
  useEffect(()=>{
    (async ()=>{
      const { data: emps } = await supabase.from("employee").select("*").eq("status","active").order("last_name",{ascending:true});
      setEmployees(emps||[]);
      setBases([...new Set((emps||[]).map(e=>e.base).filter(Boolean))].sort());
      setDepts([...new Set((emps||[]).map(e=>e.department).filter(Boolean))].sort());
    })();
  },[]);

  // load shifts with coverage
  useEffect(()=>{ load(); /* eslint-disable-next-line */ }, [filters]);
  async function load(){
    setLoading(true);
    const { data } = await supabase
      .from("roster_coverage_v")
      .select("*")
      .gte("shift_date", filters.from)
      .lte("shift_date", filters.to)
      .order("shift_date", { ascending: true })
      .order("start_time", { ascending: true });
    const view = (data||[]).filter(r =>
      (!filters.base || r.base === filters.base) &&
      (!filters.dept || r.department === filters.dept)
    );
    setShifts(view);
    setLoading(false);
  }

  // modal-less create shift
  const [newShift, setNewShift] = useState({
    shift_date: iso(new Date()),
    start_time: "08:00",
    end_time: "16:00",
    base: "",
    department: "",
    role_code: "",
    min_staff: 1,
    max_staff: 1,
    notes: ""
  });
  async function createShift(e){
    e.preventDefault();
    if (!newShift.shift_date || !newShift.start_time || !newShift.end_time) {
      return toast("Date, start and end time are required", "warning");
    }
    const payload = { ...newShift, min_staff: Number(newShift.min_staff||1), max_staff: Number(newShift.max_staff||1) };
    const { error } = await supabase.from("roster_shift").insert([payload]);
    if (error) return toast(error.message, "danger");
    toast("Shift created", "success");
    setNewShift(s=>({...s, notes:""}));
    load();
  }

  // assignment helpers
  const [assignForm, setAssignForm] = useState({ empSearch:"", employee_id:"" });
  // quick-add UI state: which employee|date cell is open
  const [quickAddKey, setQuickAddKey] = useState(""); // `${emp.id}|${date}`

  async function assign(shift_id){
    if (!assignForm.employee_id) return toast("Choose an employee", "warning");
    const { error } = await supabase.from("roster_assignment").insert([{ shift_id, employee_id: assignForm.employee_id, assigned_by: "admin@app" }]);
    if (error) return toast(error.message, "danger");
    toast("Assigned", "success");
    setAssignForm({ empSearch:"", employee_id:"" });
    load();
  }

  async function unassign(shift_id, employee_id){
    const { error } = await supabase.from("roster_assignment").delete().match({ shift_id, employee_id });
    if (error) return toast(error.message, "danger");
    toast("Unassigned", "success");
    load();
  }

  async function setStatus(shift_id, status){
    const { error } = await supabase.from("roster_shift").update({ status }).eq("id", shift_id);
    if (error) return toast(error.message, "danger");
    toast(`Shift ${status}`, "success");
    load();
  }

  async function quickCreate(emp, date, kind){
    // Presets
    const presets = {
      day: { start: "08:00", end: "16:00", role: emp.role_code || "SHIFT" },
      night: { start: "20:00", end: "06:00", role: emp.role_code || "SHIFT" }, // overnight supported by shiftHours
      training: { start: "09:00", end: "17:00", role: "TRAIN" }
    };
    const p = presets[kind];
    if (!p) return;

    const payload = {
      shift_date: date,
      start_time: p.start,
      end_time: p.end,
      base: emp.base || "",
      department: emp.department || "",
      role_code: p.role,
      min_staff: 1,
      max_staff: 1,
      notes: kind.charAt(0).toUpperCase()+kind.slice(1)
    };

    const { data: created, error } = await supabase.from("roster_shift").insert([payload]).select().limit(1);
    if (error) { toast(error.message, "danger"); return; }
    const shift = created?.[0];
    if (!shift) { toast("Shift not created", "danger"); return; }

    const { error: errA } = await supabase.from("roster_assignment").insert([{ shift_id: shift.id || shift.shift_id || shift.ID, employee_id: emp.id, assigned_by: "admin@app" }]);
    if (errA) { toast(errA.message, "danger"); } else { toast("Shift added", "success"); }
    setQuickAddKey("");
    load();
  }

  // fetch assignments for displayed shifts
  const [assignmentsByShift, setAssignmentsByShift] = useState({});
  useEffect(()=>{
    (async ()=>{
      if (!shifts.length) { setAssignmentsByShift({}); return; }
      const ids = shifts.map(s=>s.shift_id);
      const { data } = await supabase.from("roster_assignment")
        .select("id,shift_id,employee_id,employee:employee_id ( id, first_name, last_name, base, department )")
        .in("shift_id", ids);
      const by = {};
      (data||[]).forEach(a=>{
        by[a.shift_id] = by[a.shift_id] || [];
        by[a.shift_id].push(a);
      });
      setAssignmentsByShift(by);
    })();
  }, [shifts]);

  // conflict rows (assignments vs absences)
  const [conflicts, setConflicts] = useState([]);
  useEffect(()=>{
    (async ()=>{
      const { data } = await supabase
        .from("roster_conflicts_v")
        .select("*")
        .gte("shift_date", filters.from)
        .lte("shift_date", filters.to);
      setConflicts(data||[]);
    })();
  }, [filters, shifts.length]);

  const conflictsByShift = useMemo(()=>{
    const by={};
    (conflicts||[]).forEach(c=>{
      by[c.shift_id] = by[c.shift_id] || [];
      by[c.shift_id].push(c);
    });
    return by;
  }, [conflicts]);

  useEffect(()=>{
    (async ()=>{
      // Load absences overlapping the visible week
      const { data, error } = await supabase
        .from("absence")
        .select("employee_id,start_date,end_date")
        .lte("start_date", filters.to)
        .gte("end_date", filters.from);
      if (error) { console.error(error); setAbsencesByEmpDay({}); return; }
      const map = {};
      (data||[]).forEach(a => {
        if (!a.employee_id) return;
        const days = eachDateIso(a.start_date, a.end_date);
        const set = map[a.employee_id] || new Set();
        days.forEach(d => set.add(d));
        map[a.employee_id] = set;
      });
      setAbsencesByEmpDay(map);
    })();
  }, [filters.from, filters.to]);

  const grouped = useMemo(() => {
    const by = new Map();
    (shifts || []).forEach(s => {
      const key = (s[groupBy] || "—");
      if (!by.has(key)) by.set(key, { key, rows: [] });
      by.get(key).rows.push(s);
    });
    return [...by.values()].sort((a,b)=> String(a.key).localeCompare(String(b.key)));
  }, [shifts, groupBy]);

  const employeeRows = useMemo(() => {
    if (groupBy !== 'employee') return [];
    const byId = new Map();

    // Respect Team/Dept filters
    const emps = (employees || []).filter(e =>
      (!filters.base || e.base === filters.base) &&
      (!filters.dept || e.department === filters.dept)
    );

    // Initialize empty day-buckets for each employee in the filtered list
    emps.forEach(e => byId.set(
      e.id,
      { emp: e, byDay: Object.fromEntries(days.map(d => [d, []])), totalHrs: 0 }
    ));

    // Fill buckets with the shifts the employee is assigned to for that day
    (shifts || []).forEach(s => {
      const assigns = assignmentsByShift[s.shift_id] || [];
      assigns.forEach(a => {
        const row = byId.get(a.employee_id);
        if (!row) return; // filtered out
        row.byDay[s.shift_date].push(s);
        row.totalHrs += shiftHours(s.start_time, s.end_time);
      });
    });

    // Sort employees by Last, First
    return [...byId.values()].sort((a, b) => {
      const an = `${a.emp.last_name || ''} ${a.emp.first_name || ''}`.trim().toLowerCase();
      const bn = `${b.emp.last_name || ''} ${b.emp.first_name || ''}`.trim().toLowerCase();
      return an.localeCompare(bn);
    });
  }, [groupBy, employees, filters.base, filters.dept, shifts, assignmentsByShift, days]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Roster</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={()=> setShowFilters(v=>!v)}>{showFilters? "Hide Filters":"Filters"}</Button>
          <Button onClick={()=> setShowCreate(v=>!v)}>{showCreate? "Hide New Shift":"New Shift"}</Button>
          <Button variant="ghost" onClick={()=> setFilters(f=>{
            const ws = weekStart(new Date(f.from));
            const next = weekStart(addDays(ws, 7));
            return { ...f, from: iso(next), to: iso(addDays(next,6)) };
          })}>Next week →</Button>
        </div>
      </div>
      <div className="text-sm text-gray-600">Plan shifts and track coverage. Absence conflicts are flagged automatically.</div>

      {/* Filters */}
      {showFilters && (
        <Card title="Filters">
          <div className="grid md:grid-cols-6 gap-3">
            <Field label="Team">
              <Select value={filters.base} onChange={e=>setFilters(f=>({...f, base:e.target.value}))}>
                <option value="">All</option>
                {bases.map(b=> <option key={b} value={b}>{b}</option>)}
              </Select>
            </Field>
            <Field label="Department">
              <Select value={filters.dept} onChange={e=>setFilters(f=>({...f, dept:e.target.value}))}>
                <option value="">All</option>
                {depts.map(d=> <option key={d} value={d}>{d}</option>)}
              </Select>
            </Field>
            <Field label="Week from (Mon)">
              <Input type="date" value={filters.from} onChange={e=>{
                const ws = weekStart(new Date(e.target.value));
                setFilters(f=>({ ...f, from: iso(ws), to: iso(addDays(ws,6)) }));
              }}/>
            </Field>
            <Field label="To (Sun)"><Input type="date" value={filters.to} onChange={e=>setFilters(f=>({...f, to:e.target.value}))}/></Field>
            <Field label="View">
              <Select value={viewMode} onChange={e=>setViewMode(e.target.value)}>
                <option value="grid">Grid</option>
                <option value="list">List</option>
              </Select>
            </Field>
            <Field label="Group by">
              <Select value={groupBy} onChange={e=>setGroupBy(e.target.value)}>
                <option value="employee">Employee</option>
                <option value="role_code">Function / Role</option>
                <option value="department">Department</option>
                <option value="base">Team</option>
              </Select>
            </Field>
            <div className="md:col-span-2 flex items-end">
              <div className="text-sm text-gray-600">Showing week {filters.from} → {filters.to}</div>
            </div>
          </div>
        </Card>
      )}

      {/* Create shift */}
      {showCreate && (
        <Card title="Create shift">
          <form onSubmit={createShift} className="grid md:grid-cols-7 gap-3">
            <Field label="Date"><Input type="date" value={newShift.shift_date} onChange={e=>setNewShift(s=>({...s, shift_date:e.target.value}))}/></Field>
            <Field label="Start"><Input type="time" value={newShift.start_time} onChange={e=>setNewShift(s=>({...s, start_time:e.target.value}))}/></Field>
            <Field label="End"><Input type="time" value={newShift.end_time} onChange={e=>setNewShift(s=>({...s, end_time:e.target.value}))}/></Field>
            <Field label="Team"><Input value={newShift.base} onChange={e=>setNewShift(s=>({...s, base:e.target.value}))}/></Field>
            <Field label="Dept"><Input value={newShift.department} onChange={e=>setNewShift(s=>({...s, department:e.target.value}))}/></Field>
            <Field label="Role"><Input value={newShift.role_code} onChange={e=>setNewShift(s=>({...s, role_code:e.target.value}))}/></Field>
            <Field label="Min / Max">
              <div className="flex gap-2">
                <Input type="number" min="1" value={newShift.min_staff} onChange={e=>setNewShift(s=>({...s, min_staff:e.target.value}))}/>
                <Input type="number" min="1" value={newShift.max_staff} onChange={e=>setNewShift(s=>({...s, max_staff:e.target.value}))}/>
              </div>
            </Field>
            <Field label="Notes" className="md:col-span-5"><Input value={newShift.notes} onChange={e=>setNewShift(s=>({...s, notes:e.target.value}))}/></Field>
            <div className="md:col-span-7"><Button type="submit">Add shift</Button></div>
          </form>
        </Card>
      )}

      {/* Multi-schedule view */}
      {viewMode === "grid" ? (
        <Card>
          <div className="overflow-auto">
            <div className="min-w-[1100px]">
              {/* Header row: group label + 7 day columns */}
              <div className="grid" style={{gridTemplateColumns: `200px repeat(7, 140px)`}}>
                <div className="p-3 text-xs font-medium text-gray-500 uppercase tracking-wide">{groupBy === 'base' ? 'Team' : groupBy.replace('_',' ')}</div>
                {days.map(d => (
                  <div key={d} className="p-3 text-sm font-semibold text-gray-700 sticky top-0 bg-white z-10 border-b">{new Date(d).toLocaleDateString(undefined,{ weekday:'short', month:'short', day:'numeric' })}</div>
                ))}
              </div>

              {/* Rows */}
              {groupBy === 'employee' ? (
                employeeRows.map(({ emp, byDay, totalHrs }) => (
                  <div key={emp.id} className="grid border-t" style={{gridTemplateColumns: `220px repeat(7, 1fr)`}}>
                    {/* Left: employee identity + weekly total */}
                    <div className="p-3 bg-gray-50/60 border-r">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="h-7 w-7 rounded-full bg-gray-200 flex items-center justify-center text-xs font-medium">
                            {(emp.first_name?.[0]||'').toUpperCase()}{(emp.last_name?.[0]||'').toUpperCase()}
                          </div>
                          <div>
                            <div className="text-sm font-semibold">{emp.first_name} {emp.last_name}</div>
                            <div className="text-[11px] text-gray-500">{emp.base || '—'} / {emp.department || '—'}{emp.role_code ? ` • ${emp.role_code}` : ''}</div>
                          </div>
                        </div>
                        <div className="text-xs text-gray-600">{Math.round(totalHrs*10)/10}h</div>
                      </div>
                    </div>

                    {/* Day cells */}
                    {days.map(d => (
                      <div key={d} className="relative p-1.5 border-r min-h-[56px]">
                        {/* Quick add button */}
                        <button
                          className="absolute top-0.5 right-0.5 text-xs text-gray-500 hover:text-gray-700 px-1"
                          onClick={(e)=>{ e.preventDefault(); e.stopPropagation(); setQuickAddKey(k=> k===`${emp.id}|${d}`? "" : `${emp.id}|${d}`); }}
                          title="Quick add"
                        >＋</button>
                        {quickAddKey === `${emp.id}|${d}` && (
                          <div className="absolute z-20 right-1 top-5 bg-white border rounded shadow p-1 flex flex-col gap-1 text-xs">
                            <button className="px-2 py-1 hover:bg-gray-50 text-left" onClick={()=>quickCreate(emp, d, 'day')}>Day shift</button>
                            <button className="px-2 py-1 hover:bg-gray-50 text-left" onClick={()=>quickCreate(emp, d, 'night')}>Night shift</button>
                            <button className="px-2 py-1 hover:bg-gray-50 text-left" onClick={()=>quickCreate(emp, d, 'training')}>Training</button>
                          </div>
                        )}
                        {(() => {
                          const isAbsent = !!(absencesByEmpDay[emp.id]?.has(d));
                          const shiftsToday = byDay[d];
                          if (shiftsToday.length === 0) {
                            return (
                              <div className="h-[48px] flex items-center justify-center">
                                {isAbsent ? (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 border border-red-200 text-red-700">Absent</span>
                                ) : (
                                  <span className="text-[11px] text-gray-400">—</span>
                                )}
                              </div>
                            );
                          }
                          return (
                            <div className="space-y-1.5">
                              {shiftsToday.map(s => {
                                const hue = roleHue(String(s.role_code||''));
                                const confl = (conflictsByShift[s.shift_id] || []).filter(c => c.employee_id === emp.id);
                                return (
                                  <div key={`${emp.id}-${s.shift_id}`} className="rounded border text-[11px]" style={{borderColor:`hsl(${hue},70%,60%)`, background:`hsl(${hue},100%,98%)`}}>
                                    <div className="px-2 py-1 flex items-center justify-between gap-2">
                                      <div className="font-medium truncate" title={s.role_code || 'Shift'}>{s.role_code || 'Shift'}</div>
                                      <div className="shrink-0 whitespace-nowrap">{s.start_time}–{s.end_time}</div>
                                    </div>
                                    {(isAbsent || confl.length>0) && (
                                      <div className="px-2 pb-1 flex gap-1 flex-wrap">
                                        {isAbsent && <span className="text-[10px] px-1 rounded bg-red-50 border border-red-200 text-red-700">Absent</span>}
                                        {confl.length>0 && <span className="text-[10px] px-1 rounded bg-yellow-50 border border-yellow-200 text-yellow-700">{confl.length} conflict</span>}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })()}
                      </div>
                    ))}
                  </div>
                ))
              ) : (
                grouped.map(g => (
                  <div key={g.key} className="grid border-t" style={{gridTemplateColumns: `220px repeat(7, 1fr)`}}>
                    {/* Group label */}
                    <div className="p-3 bg-gray-50/60 border-r">
                      <div className="text-sm font-semibold flex items-center gap-2">
                        {groupBy === 'role_code' && (
                          <span className="inline-block h-3 w-3 rounded" style={{background:`hsl(${roleHue(String(g.key))},80%,70%)`}} />
                        )}
                        {String(g.key) || '—'}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">{g.rows.length} shift{g.rows.length!==1?'s':''}</div>
                    </div>

                    {/* 7 day cells */}
                    {days.map(d => {
                      const inCell = g.rows.filter(s => s.shift_date === d);
                      return (
                        <div key={d} className="p-1 border-r min-h-[52px]">
                          {inCell.length === 0 ? (
                            <div className="text-[11px] text-gray-400">—</div>
                          ) : (
                            <div className="space-y-2">
                              {inCell.map(s => {
                                const assigns = assignmentsByShift[s.shift_id] || [];
                                const remaining = Math.max(0, s.min_staff - assigns.length);
                                const hue = roleHue(String(s.role_code||g.key||''));
                                const confl = conflictsByShift[s.shift_id] || [];
                                return (
                                  <div key={s.shift_id} className="rounded border text-[11px]" style={{background:`hsl(${hue},100%,97%)`, borderColor:`hsl(${hue},70%,80%)`}}>
                                    <div className="px-2 py-0.5 flex items-center justify-between">
                                      <div className="text-xs font-medium">{s.start_time}–{s.end_time}</div>
                                      <Badge tone={remaining>0? 'danger' : (assigns.length> s.max_staff? 'warning' : 'success')}>
                                        {assigns.length}/{s.min_staff}
                                      </Badge>
                                    </div>
                                    <div className="px-2 pb-1">
                                      {assigns.length === 0 ? (
                                        <div className="text-[11px] text-gray-500">Unassigned</div>
                                      ) : (
                                        <div className="flex flex-wrap gap-1">
                                          {assigns.slice(0,2).map(a => (
                                            <span key={a.id} className="text-[11px] bg-white/80 border rounded px-1.5 py-0.5">
                                              {a.employee?.first_name} {a.employee?.last_name}
                                            </span>
                                          ))}
                                          {assigns.length > 2 && (
                                            <span className="text-[11px] text-gray-600">+{assigns.length-2} more</span>
                                          )}
                                          {confl.length>0 && (
                                            <span className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-1.5 py-0.5">{confl.length} conflict</span>
                                          )}
                                        </div>
                                      )}
                                      <div className="mt-2 flex gap-1">
                                        <Select value={assignForm.employee_id} onChange={e=>setAssignForm(f=>({...f, employee_id:e.target.value}))}>
                                          <option value="">Add…</option>
                                          {employees.map(emp => (
                                            <option key={emp.id} value={emp.id}>{emp.first_name} {emp.last_name}</option>
                                          ))}
                                        </Select>
                                        <Button onClick={()=>assign(s.shift_id)}>Add</Button>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </div>
        </Card>
      ) : (
        // Fallback to the original list view
        <>
          {days.map(d => {
            const dayRows = shifts.filter(s=> s.shift_date === d);
            return (
              <Card key={d} title={new Date(d).toLocaleDateString(undefined,{ weekday:'long', year:'numeric', month:'short', day:'numeric' })}>
                {dayRows.length === 0 ? (
                  <div className="text-sm text-gray-500">No shifts.</div>
                ) : (
                  <Table head={["Time","Team/Dept","Role","Coverage","Status","Assignments","Actions"]}>
                    {dayRows.map(s=>{
                      const assigns = assignmentsByShift[s.shift_id] || [];
                      const confl = conflictsByShift[s.shift_id] || [];
                      const coverageTone = s.understaffed_by>0 ? "danger" : (s.overstaffed_by>0 ? "warning" : "success");
                      return (
                        <tr key={s.shift_id} className="group">
                          <td className="p-3">{s.start_time}–{s.end_time}</td>
                          <td className="p-3">{s.base || "—"} / {s.department || "—"}</td>
                          <td className="p-3">{s.role_code || "—"}</td>
                          <td className="p-3">
                            <div className="flex items-center gap-2">
                              <Badge tone={coverageTone}>
                                {s.assigned_count}/{s.min_staff} (max {s.max_staff})
                              </Badge>
                              {confl.length>0 && <Badge tone="danger">{confl.length} conflict(s)</Badge>}
                            </div>
                          </td>
                          <td className="p-3">
                            <Badge tone={s.status==="published" ? "success" : (s.status==="cancelled" ? "danger":"info")}>{s.status}</Badge>
                          </td>
                          <td className="p-3">
                            <div className="flex flex-wrap gap-2">
                              {assigns.map(a=>(
                                <span key={a.id} className="inline-flex items-center gap-2 bg-gray-100 rounded-md px-2 py-1">
                                  {a.employee?.first_name} {a.employee?.last_name}
                                  <button className="text-xs text-red-600 hover:underline" onClick={()=>unassign(s.shift_id, a.employee_id)}>remove</button>
                                </span>
                              ))}
                            </div>
                            <div className="mt-2 flex gap-2">
                              <Input placeholder="Search…" value={assignForm.empSearch} onChange={e=>setAssignForm(f=>({...f, empSearch:e.target.value}))}/>
                              <Select value={assignForm.employee_id} onChange={e=>setAssignForm(f=>({...f, employee_id:e.target.value}))}>
                                <option value="">Pick employee…</option>
                                {employees
                                  .filter(emp=>{
                                    const q = assignForm.empSearch.trim().toLowerCase();
                                    const full = `${emp.first_name} ${emp.last_name}`.toLowerCase();
                                    return !q || full.includes(q) || (emp.email||"").toLowerCase().includes(q);
                                  })
                                  .map(emp=>(
                                    <option key={emp.id} value={emp.id}>
                                      {emp.first_name} {emp.last_name} — {emp.base || "—"}/{emp.department || "—"}
                                    </option>
                                  ))}
                              </Select>
                              <Button onClick={()=>assign(s.shift_id)}>Assign</Button>
                            </div>
                          </td>
                          <td className="p-3 whitespace-nowrap">
                            <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
                              {s.status !== "published" && <Button variant="outline" onClick={()=>setStatus(s.shift_id,"published")}>Publish</Button>}
                              {s.status !== "planned" && <Button variant="outline" onClick={()=>setStatus(s.shift_id,"planned")}>Unpublish</Button>}
                              {s.status !== "cancelled" && <Button variant="danger" onClick={()=>setStatus(s.shift_id,"cancelled")}>Cancel</Button>}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </Table>
                )}
              </Card>
            );
          })}
        </>
      )}
    </div>
  );
}