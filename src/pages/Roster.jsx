import { useEffect, useMemo, useState, useRef, useLayoutEffect } from "react";
import { supabase } from "../lib/supabase";
import { Card, Button, Field, Input, Select, Table, Badge, toast } from "../components/ui";
// Simple color generator for role buckets
const roleHue = (str = "-") => { let h = 0; for (let i=0;i<str.length;i++) h = (h*31 + str.charCodeAt(i)) % 360; return h; };

// Helper: format shift label
const formatShiftLabel = (s) => {
  const rc = (s.role_code||'').toString().toUpperCase();
  // Explicit role labels
  if (rc === 'TRAIN' || rc === 'TRAINING') return 'Training';
  // Time-based defaults
  const st = s.start_time, et = s.end_time;
  if (st === '08:00' && et === '16:00') return 'Day Shift';
  if (st === '20:00' && et === '06:00') return 'Night Shift';
  // Fallbacks
  if (rc) return rc.charAt(0) + rc.slice(1).toLowerCase();
  return 'Shift';
};

const iso = (d) => {
  const x = new Date(d);
  x.setHours(0,0,0,0);
  const y = new Date(x.getTime() - x.getTimezoneOffset()*60000);
  return y.toISOString().slice(0,10);
};
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

  // scrolling + virtualization
  const scrollRef = useRef(null);
  const [scrollY, setScrollY] = useState(0);
  const [viewportH, setViewportH] = useState(600);
  const [headerShadow, setHeaderShadow] = useState(false);
  const ROW_HEIGHT = 80; // px, approximate row height

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

  // Notes: { [empId]: { [isoDate]: string[] } }
  const [notesByEmpDay, setNotesByEmpDay] = useState({}); // { [empId]: { [isoDate]: string[] } }
  // Hover preview key for notes ("empId|YYYY-MM-DD"), and side panel state
  const [noteHoverKey, setNoteHoverKey] = useState("");
  const [notesPanel, setNotesPanel] = useState({ open:false, empId:null });

  // Availability: { [empId]: { [isoDate]: 'available'|'preferred'|'unavailable' } }
  const [availabilityByEmpDay, setAvailabilityByEmpDay] = useState({});
  const [showAvailability, setShowAvailability] = useState(false);

  // Helper: return week notes for an employee aligned to visible days
  const getEmpWeekNotes = (empId) => {
    const byDate = notesByEmpDay[empId] || {};
    return days.map(d => ({ date:d, notes: byDate[d] || [] }));
  };

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

  // measure viewport height and listen to resize
  useLayoutEffect(()=>{
    const el = scrollRef.current;
    const measure = ()=> setViewportH(el ? el.clientHeight : 600);
    measure();
    window.addEventListener('resize', measure);
    return ()=> window.removeEventListener('resize', measure);
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
  const [quickAvailKey, setQuickAvailKey] = useState(""); // `${emp.id}|${date}`
  useEffect(()=>{
    (async ()=>{
      const { data, error } = await supabase
        .from('employee_availability')
        .select('employee_id,date,status')
        .gte('date', filters.from)
        .lte('date', filters.to);
      if (error) { console.error(error); setAvailabilityByEmpDay({}); return; }
      const map = {};
      (data||[]).forEach(r=>{
        if (!r.employee_id || !r.date) return;
        map[r.employee_id] = map[r.employee_id] || {};
        map[r.employee_id][r.date] = r.status; // 'available' | 'preferred' | 'unavailable'
      });
      setAvailabilityByEmpDay(map);
    })();
  }, [filters.from, filters.to]);

  async function setAvailability(empId, date, status){
    // status: 'available' | 'preferred' | 'unavailable' | null (clear)
    if (!empId || !date) return;
    if (status === null){
      const { error } = await supabase.from('employee_availability').delete().match({ employee_id: empId, date });
      if (error) { toast(error.message, 'danger'); return; }
      setAvailabilityByEmpDay(prev=>{
        const copy = { ...prev };
        if (copy[empId]){ delete copy[empId][date]; }
        return copy;
      });
      toast('Availability cleared', 'success');
      return;
    }
    const { error } = await supabase.from('employee_availability').upsert({ employee_id: empId, date, status }, { onConflict: 'employee_id,date' });
    if (error) { toast(error.message, 'danger'); return; }
    setAvailabilityByEmpDay(prev=>({ ...prev, [empId]: { ...(prev[empId]||{}), [date]: status } }));
    toast('Availability saved', 'success');
  }

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

  // === Auto-fill helpers ===
  function isAbsent(empId, dateIso){
    return !!(absencesByEmpDay[empId]?.has(dateIso));
  }

  function isAvailable(empId, dateIso){
    const st = availabilityByEmpDay[empId]?.[dateIso];
    // 'preferred' > 'available' > neutral; 'unavailable' is excluded
    return st === 'available' || st === 'preferred' || st === undefined;
  }

  function availabilityRank(empId, dateIso){
    const st = availabilityByEmpDay[empId]?.[dateIso];
    if (st === 'preferred') return 0;
    if (st === 'available') return 1;
    if (st === undefined) return 2;
    return 3; // unavailable
  }

  function suggestCandidatesForShift(shift, count){
    const date = shift.shift_date;
    const assigns = new Set((assignmentsByShift[shift.shift_id] || []).map(a => a.employee_id));
    const pool = (employees || [])
      .filter(e => (!shift.base || e.base === shift.base) && (!shift.department || e.department === shift.department))
      .filter(e => !assigns.has(e.id) && !isAbsent(e.id, date) && isAvailable(e.id, date));

    const ranked = pool.sort((a,b)=>{
      const r = availabilityRank(a.id, date) - availabilityRank(b.id, date);
      if (r !== 0) return r;
      const ha = assignedHoursByEmp[a.id] || 0;
      const hb = assignedHoursByEmp[b.id] || 0;
      if (ha !== hb) return ha - hb;
      const an = `${a.last_name||''} ${a.first_name||''}`.toLowerCase();
      const bn = `${b.last_name||''} ${b.first_name||''}`.toLowerCase();
      return an.localeCompare(bn);
    });

    return ranked.slice(0, Math.max(0, count));
  }

  async function fillShift(shift){
    const assigns = assignmentsByShift[shift.shift_id] || [];
    const remaining = Math.max(0, (shift.min_staff || 0) - assigns.length);
    if (remaining <= 0) { toast('No remaining slots for this shift', 'info'); return; }
    const candidates = suggestCandidatesForShift(shift, remaining);
    if (candidates.length === 0) { toast('No suitable candidates found', 'warning'); return; }
    const names = candidates.map(c=>`${c.first_name} ${c.last_name}`).join(', ');
    if (!window.confirm(`Assign ${names} to ${formatShiftLabel(shift)} on ${shift.shift_date}?`)) return;
    for (const c of candidates){
      const { error } = await supabase.from('roster_assignment').insert([{ shift_id: shift.shift_id, employee_id: c.id, assigned_by: 'autofill@app' }]);
      if (error) { toast(error.message, 'danger'); break; }
    }
    toast('Shift filled', 'success');
    load();
  }

  async function autofillWeek(){
    if (!window.confirm('Auto-fill remaining slots for all shifts this week using availability and current load?')) return;
    for (const s of (shifts || [])){
      const assigns = assignmentsByShift[s.shift_id] || [];
      const remaining = Math.max(0, (s.min_staff || 0) - assigns.length);
      if (remaining <= 0) continue;
      const candidates = suggestCandidatesForShift(s, remaining);
      for (const c of candidates){
        const { error } = await supabase.from('roster_assignment').insert([{ shift_id: s.shift_id, employee_id: c.id, assigned_by: 'autofill@app' }]);
        if (error) { toast(error.message, 'danger'); break; }
      }
    }
    toast('Auto-fill complete', 'success');
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

  async function addNote(empId, date){
    const note = window.prompt("Enter note for this day:");
    if (!note) return;
    const { error } = await supabase
      .from("roster_note")
      .insert([{ employee_id: empId, date, text: note }]);
    if (error) { toast(error.message, "danger"); return; }
    toast("Note added", "success");
    setNotesByEmpDay(prev => {
      const copy = { ...prev };
      const byDate = { ...(copy[empId] || {}) };
      byDate[date] = [ ...(byDate[date] || []), note ];
      copy[empId] = byDate;
      return copy;
    });
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

  // Map current assigned hours per employee for the visible week (for fair distribution)
  const assignedHoursByEmp = useMemo(() => {
    const hours = {};
    (shifts || []).forEach(s => {
      const assigns = assignmentsByShift[s.shift_id] || [];
      const h = shiftHours(s.start_time, s.end_time);
      assigns.forEach(a => {
        hours[a.employee_id] = (hours[a.employee_id] || 0) + h;
      });
    });
    return hours;
  }, [shifts, assignmentsByShift]);

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

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("roster_note")
        .select("employee_id,date,text")
        .gte("date", filters.from)
        .lte("date", filters.to);
      if (error) { console.error(error); setNotesByEmpDay({}); return; }
      const map = {};
      (data || []).forEach(n => {
        if (!n.employee_id || !n.date) return;
        if (!map[n.employee_id]) map[n.employee_id] = {};
        map[n.employee_id][n.date] = [ ...(map[n.employee_id][n.date] || []), n.text ];
      });
      setNotesByEmpDay(map);
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
        const bucket = row.byDay[s.shift_date];
        if (!bucket) return; // shift is outside the current days window
        bucket.push(s);
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

  const totalEmployeeRows = employeeRows.length;
  const startIndex = groupBy === 'employee' ? Math.max(0, Math.floor(scrollY / ROW_HEIGHT) - 3) : 0;
  const visibleCount = groupBy === 'employee' ? Math.ceil(viewportH / ROW_HEIGHT) + 6 : totalEmployeeRows;
  const endIndex = groupBy === 'employee' ? Math.min(totalEmployeeRows, startIndex + visibleCount) : totalEmployeeRows;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Roster</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={()=> setShowFilters(v=>!v)}>{showFilters? "Hide Filters":"Filters"}</Button>
          <Button onClick={()=> setShowCreate(v=>!v)}>{showCreate? "Hide New Shift":"New Shift"}</Button>
          <Button variant="ghost" onClick={()=> setFilters(f=>{
            const ws = weekStart(new Date(f.from));
            const prev = weekStart(addDays(ws, -7));
            return { ...f, from: iso(prev), to: iso(addDays(prev,6)) };
          })}>← Prev week</Button>
          <Button variant="ghost" onClick={()=> setFilters(f=>{
            const ws = weekStart(new Date());
            return { ...f, from: iso(ws), to: iso(addDays(ws,6)) };
          })}>Today</Button>
          <Button variant="outline" onClick={()=> setShowAvailability(v=>!v)}>
            {showAvailability ? 'Hide Availability' : 'Show Availability'}
          </Button>
          <Button variant="outline" onClick={autofillWeek}>Auto-fill week</Button>
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
          <div className="overflow-auto" ref={scrollRef} onScroll={(e)=>{ setScrollY(e.currentTarget.scrollTop); setHeaderShadow(e.currentTarget.scrollTop>0); }}>
            <div className="min-w-[1100px] w-full">
              {/* Header row: group label + 7 day columns */}
              <div className={`grid ${headerShadow ? 'shadow-sm' : ''}`} style={{gridTemplateColumns: `200px repeat(7, 140px)`}}>
                <div className="p-3 text-xs font-medium text-gray-500 uppercase tracking-wide">{groupBy === 'base' ? 'Team' : groupBy.replace('_',' ')}</div>
                {days.map(d => (
                  <div key={d} className="p-3 text-sm font-semibold text-gray-700 sticky top-0 bg-white z-10 border-b">{new Date(d).toLocaleDateString(undefined,{ weekday:'short', month:'short', day:'numeric' })}</div>
                ))}
              </div>

              {/* Rows */}
              {groupBy === 'employee' ? (
                <>
                  <div style={{ height: startIndex * ROW_HEIGHT }} />
                  {employeeRows.slice(startIndex, endIndex).map(({ emp, byDay, totalHrs }) => (
                    <div key={emp.id} className="grid border-t" style={{gridTemplateColumns: `200px repeat(7, 140px)`}}>
                    {/* Left: employee identity + weekly total */}
                    <div className="p-3 bg-gray-50/60 border-r sticky left-0 z-10">
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
                      <div
                        key={d}
                        className="relative p-1.5 border-r h-[80px] overflow-visible"
                        onContextMenu={(e) => { e.preventDefault(); addNote(emp.id, d); }}
                      >
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

                        {/* Availability button */}
                        <button
                          className="absolute top-0.5 left-0.5 text-xs text-gray-500 hover:text-gray-700 px-1"
                          onClick={(e)=>{ e.preventDefault(); e.stopPropagation(); setQuickAvailKey(k=> k===`${emp.id}|${d}`? "" : `${emp.id}|${d}`); }}
                          title="Set availability"
                        >⚑</button>
                        {quickAvailKey === `${emp.id}|${d}` && (
                          <div className="absolute z-20 left-1 top-5 bg-white border rounded shadow p-1 flex flex-col gap-1 text-xs">
                            <button className="px-2 py-1 hover:bg-gray-50 text-left" onClick={()=> setAvailability(emp.id, d, 'available')}>Mark Available</button>
                            <button className="px-2 py-1 hover:bg-gray-50 text-left" onClick={()=> setAvailability(emp.id, d, 'preferred')}>Mark Preferred</button>
                            <button className="px-2 py-1 hover:bg-gray-50 text-left" onClick={()=> setAvailability(emp.id, d, 'unavailable')}>Mark Unavailable</button>
                            <button className="px-2 py-1 hover:bg-gray-50 text-left" onClick={()=> setAvailability(emp.id, d, null)}>Clear</button>
                          </div>
                        )}

                        {/* Availability overlay dot */}
                        {showAvailability && (
                          (()=>{
                            const st = availabilityByEmpDay[emp.id]?.[d];
                            if (!st) return null;
                            const color = st==='available' ? 'bg-green-500' : st==='preferred' ? 'bg-amber-500' : 'bg-red-500';
                            const label = st==='available' ? 'Available' : st==='preferred' ? 'Preferred' : 'Unavailable';
                            return (
                              <div className="absolute -bottom-1 left-1 flex items-center gap-1 text-[10px]">
                                <span className={`inline-block h-2.5 w-2.5 rounded-full ${color}`} title={label}></span>
                                <span className="text-gray-600">{label}</span>
                              </div>
                            );
                          })()
                        )}

                        {/* Notes indicator (if notes exist) */}
                        {(notesByEmpDay[emp.id]?.[d]?.length > 0) && (
                          <button
                            className="absolute top-0.5 right-6 text-xs px-1 rounded bg-yellow-50 border border-yellow-200 text-yellow-700"
                            title="View notes"
                            onMouseEnter={()=> setNoteHoverKey(`${emp.id}|${d}`)}
                            onMouseLeave={()=> setNoteHoverKey("")}
                            onClick={(e)=>{ e.preventDefault(); e.stopPropagation(); setNotesPanel({ open:true, empId: emp.id }); }}
                          >
                            📝 {notesByEmpDay[emp.id][d].length}
                          </button>
                        )}

                        {/* Hover preview popover */}
                        {noteHoverKey === `${emp.id}|${d}` && (
                          <div className="absolute z-40 left-full top-0 ml-2 w-56 bg-white border rounded shadow-lg p-2 text-xs space-y-1">
                            {notesByEmpDay[emp.id][d].map((t, i)=>(
                              <div key={i} className="text-gray-700 break-words">• {t}</div>
                            ))}
                            <div className="pt-1 border-t text-[10px] text-gray-500">Click 📝 to open week notes</div>
                          </div>
                        )}
                        {(() => {
                          const isAbsent = !!(absencesByEmpDay[emp.id]?.has(d));
                          const shiftsToday = byDay[d];
                          if (shiftsToday.length === 0) {
                            return (
                              <div className="h-[48px] flex items-center justify-center">
                                {isAbsent ? (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 border border-red-200 text-red-700">ABSENT</span>
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
                                  <div key={`${emp.id}-${s.shift_id}`} className="group rounded border text-[11px]" style={{borderColor:`hsl(${hue},70%,60%)`, background:`hsl(${hue},100%,98%)`}}>
                                    <div className="px-2 py-1 flex items-center justify-between gap-2">
                                      <div className="font-medium truncate" title={formatShiftLabel(s)}>{formatShiftLabel(s)}</div>
                                      <button
                                        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-50"
                                        title="Remove this employee from the shift"
                                        aria-label="Remove"
                                        onClick={(e)=>{ e.preventDefault(); e.stopPropagation(); if (!window.confirm('Remove this employee from the shift?')) return; unassign(s.shift_id, emp.id); }}
                                      >
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-red-600">
                                          <path fillRule="evenodd" d="M8.5 3a1 1 0 00-1 1V5H5a1 1 0 100 2h10a1 1 0 100-2h-2.5V4a1 1 0 00-1-1h-3zM6 8a1 1 0 011 1v6a1 1 0 11-2 0V9a1 1 0 011-1zm4 0a1 1 0 011 1v6a1 1 0 11-2 0V9a1 1 0 011-1zm5 1a1 1 0 00-1-1h-1v6a3 3 0 01-3 3H9a3 3 0 01-3-3V8H5a1 1 0 100 2h10a1 1 0 001-1z" clipRule="evenodd" />
                                        </svg>
                                      </button>
                                    </div>
                                    {(isAbsent || confl.length>0) && (
                                      <div className="px-2 pb-1 flex gap-1 flex-wrap">
                                        {isAbsent && <span className="text-[10px] px-1 rounded bg-red-50 border border-red-200 text-red-700">ABSENT</span>}
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
                  ))}
                  <div style={{ height: Math.max(0, (totalEmployeeRows - endIndex) * ROW_HEIGHT) }} />
                </>
              ) : (
                grouped.map(g => (
                  <div key={g.key} className="grid border-t" style={{gridTemplateColumns: `200px repeat(7, 140px)`}}>
                    {/* Group label */}
                    <div className="p-3 bg-gray-50/60 border-r sticky left-0 z-10">
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
                        <div key={d} className="p-1 border-r h-[64px] overflow-auto">
                          {inCell.length === 0 ? (
                            <div className="text-[11px] text-gray-400">—</div>
                          ) : (
                            <div className="space-y-2">
                              {inCell.map(s => {
                                const assigns = assignmentsByShift[s.shift_id] || [];
                                const remaining = Math.max(0, s.min_staff - assigns.length);
                                const hue = roleHue(String(s.role_code||g.key||''));
                                const confl = conflictsByShift[s.shift_id] || [];
                                // Removed function shiftLabel(s) { ... }
                                return (
                                  <div key={s.shift_id} className="rounded border text-[11px]" style={{background:`hsl(${hue},100%,97%)`, borderColor:`hsl(${hue},70%,80%)`}}>
                                    <div className="px-2 py-0.5 flex items-center justify-between gap-2">
                                      <div className="text-xs font-medium">{formatShiftLabel(s)}</div>
                                      <div className="flex items-center gap-2">
                                        <Badge tone={remaining>0? 'danger' : (assigns.length> s.max_staff? 'warning' : 'success')}>
                                          {assigns.length}/{s.min_staff}
                                        </Badge>
                                        {remaining > 0 && (
                                          <button
                                            className="text-[11px] px-1.5 py-0.5 rounded border hover:bg-gray-50"
                                            onClick={()=>fillShift(s)}
                                            title="Fill from availability"
                                          >Fill</button>
                                        )}
                                      </div>
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
                                  <button
                                    className="p-1 rounded hover:bg-red-50"
                                    title="Remove"
                                    aria-label="Remove"
                                    onClick={()=>{ if (!window.confirm('Remove this employee from the shift?')) return; unassign(s.shift_id, a.employee_id); }}
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-red-600">
                                      <path fillRule="evenodd" d="M8.5 3a1 1 0 00-1 1V5H5a1 1 0 100 2h10a1 1 0 100-2h-2.5V4a1 1 0 00-1-1h-3zM6 8a1 1 0 011 1v6a1 1 0 11-2 0V9a1 1 0 011-1zm4 0a1 1 0 011 1v6a1 1 0 11-2 0V9a1 1 0 011-1zm5 1a1 1 0 00-1-1h-1v6a3 3 0 01-3 3H9a3 3 0 01-3-3V8H5a1 1 0 100 2h10a1 1 0 001-1z" clipRule="evenodd" />
                                    </svg>
                                  </button>
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
      {/* Right-side Notes Panel */}
      {notesPanel.open && (
        <div className="fixed inset-0 z-40">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/20"
            onClick={() => setNotesPanel({ open: false, empId: null })}
          />
          {/* Panel */}
          <div className="absolute right-0 top-0 h-full w-full sm:w-[360px] bg-white shadow-xl border-l border-gray-200 flex flex-col">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <div className="text-sm font-semibold">Notes for this week</div>
              <button
                className="text-sm px-2 py-1 rounded border hover:bg-gray-50"
                onClick={() => setNotesPanel({ open: false, empId: null })}
              >
                Close
              </button>
            </div>
            <div className="p-3 overflow-auto text-sm">
              {!notesPanel.empId ? (
                <div className="text-gray-500">No employee selected.</div>
              ) : (
                (() => {
                  const items = getEmpWeekNotes(notesPanel.empId);
                  const hasAny = items.some((x) => (x.notes || []).length > 0);
                  if (!hasAny)
                    return (
                      <div className="text-gray-500">No notes for this week.</div>
                    );
                  return (
                    <div className="space-y-3">
                      {items.map(({ date, notes }) => (
                        <div key={date} className="border rounded p-2">
                          <div className="text-xs font-medium text-gray-600 mb-1">
                            {new Date(date).toLocaleDateString(undefined, {
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                            })}
                          </div>
                          {(notes || []).length === 0 ? (
                            <div className="text-[11px] text-gray-400">—</div>
                          ) : (
                            <ul className="list-disc pl-4 space-y-1">
                              {notes.map((t, i) => (
                                <li key={i} className="break-words">
                                  {t}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })()
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}