import { useEffect, useMemo, useState, useRef, useLayoutEffect } from "react";
import { supabase } from "../lib/supabase";
import { Card, Button, Field, Input, Select, Table, Badge, toast } from "../components/ui";
// Simple color generator for role buckets
const roleHue = (str = "-") => { let h = 0; for (let i=0;i<str.length;i++) h = (h*31 + str.charCodeAt(i)) % 360; return h; };

// Role priority for sorting within team
const rolePriority = (role = '') => {
  const r = String(role).toLowerCase();
  if (r === 'senior') return 0;
  if (r === 'officer') return 1;
  return 2; // others
};

// Helper: format shift label
const formatShiftLabel = (s) => {
  const rc = (s.role_code||'').toString().toUpperCase();
  // Explicit role labels
  if (rc === 'TRAIN' || rc === 'TRAINING') return 'Training';
  // Time-based defaults
  const st = s.start_time, et = s.end_time;
  if (st === '06:00' && et === '18:00') return 'Day Shift';
  if (st === '18:00' && et === '06:00') return 'Night Shift';
  // Fallbacks
  if (rc) return rc.charAt(0) + rc.slice(1).toLowerCase();
  return 'Shift';
};

// === Team pattern config (5 teams on a 28-day rolling pattern) ===
const TEAMS = [
  { name: 'Blue',   offset: 0 },
  { name: 'Orange', offset: 6 },
  { name: 'Purple', offset: 12 },
  { name: 'Green',  offset: 18 },
  { name: 'Red',    offset: 24 },
];
// Pattern string for 28 days (tokens: D=Day, N=Night, REST=rest day, OFF=off)
const PATTERN_TOKENS = [
  'D','D','D','N','N','REST','OFF','OFF','OFF','OFF',
  'D','D','N','N','REST','OFF','OFF','OFF','OFF',
  'D','D','N','N','N','REST','OFF','OFF','OFF'
];
// map token -> shift time/role or none
const TOKEN_MAP = {
  D:   { start: '06:00', end: '18:00', role: 'SHIFT' },
  N:   { start: '18:00', end: '06:00', role: 'SHIFT' },
  REST: null,
  OFF:  null,
};
function patternIndexFor(teamOffset, anchorDate, date){
  const a = new Date(anchorDate); a.setHours(0,0,0,0);
  const d = new Date(date); d.setHours(0,0,0,0);
  const diffDays = Math.round((d - a)/(1000*60*60*24));
  return ((teamOffset + diffDays) % PATTERN_TOKENS.length + PATTERN_TOKENS.length) % PATTERN_TOKENS.length;
}

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
  while (d <= end) { out.push(iso(d)); d.setDate(d.getDate()+1); }
  return out;
};

export default function Roster(){
  const [bases, setBases] = useState([]);
  const [depts, setDepts] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [groupBy, setGroupBy] = useState("employee"); // employee | role_code | base | department

  // Role awareness from header selector
  const [role, setRole] = useState(() => (typeof window !== 'undefined' && window.appRole) ? window.appRole : (localStorage.getItem('app:role') || 'manager'));
  useEffect(() => {
    const onRole = () => setRole((typeof window !== 'undefined' && window.appRole) ? window.appRole : (localStorage.getItem('app:role') || 'manager'));
    window.addEventListener('app:role', onRole);
    return () => window.removeEventListener('app:role', onRole);
  }, []);
  const canEdit = role === 'manager' || role === 'senior';

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
  const [publishedOnly, setPublishedOnly] = useState(false);
  // Collapse advanced toolbar controls into a panel
  const [showAdvanced, setShowAdvanced] = useState(false);
  // Templates + bulk apply
  const [templates, setTemplates] = useState([]);
  const [showApplyTemplate, setShowApplyTemplate] = useState(false);
  const [applyForm, setApplyForm] = useState(()=>{
    const ws = weekStart(new Date());
    return {
      template_id: "",
      from: iso(weekStart(new Date(filters.from || ws))),
      to: iso(addDays(weekStart(new Date(filters.from || ws)), 6)),
      weekdays: { Mon:true, Tue:true, Wed:true, Thu:true, Fri:true, Sat:false, Sun:false },
      override: { base:"", department:"", min_staff:"", max_staff:"", notes:"" },
      autoAssign: false,
    };
  });
  // Preview for Apply Template
  const [applyPreview, setApplyPreview] = useState({ open:false, rows:[], duplicates:[] });
  // Pattern generator anchor day (choose any date)
  const [patternAnchor, setPatternAnchor] = useState(() => iso(weekStart(new Date())));
  // Float month controls
  const [floatTeam, setFloatTeam] = useState("");
  const [floatMonth, setFloatMonth] = useState(() => iso(new Date())); // store full date (YYYY-MM-DD)
  useEffect(()=>{
    (async ()=>{
      const { data, error } = await supabase
        .from('shift_template')
        .select('*')
        .order('name', { ascending: true });
      if (error) { console.error(error); return; }
      setTemplates(data||[]);
    })();
  },[]);
  function setApplyToCurrentWeek(weekdaysOnly=true){
    setApplyForm(f=>{
      const ws = weekStart(new Date(filters.from));
      const base = { ...f, from: iso(ws), to: iso(addDays(ws,6)) };
      if (weekdaysOnly){
        return { ...base, weekdays: { Mon:true, Tue:true, Wed:true, Thu:true, Fri:true, Sat:false, Sun:false } };
      }
      return { ...base, weekdays: { Mon:true, Tue:true, Wed:true, Thu:true, Fri:true, Sat:true, Sun:true } };
    });
  }

  function buildApplyRows(){
    if (!applyForm.template_id) return { rows: [], duplicates: [] };
    const t = templates.find(x=>x.id===applyForm.template_id);
    if (!t) return { rows: [], duplicates: [] };

    const from = new Date(applyForm.from); from.setHours(0,0,0,0);
    const to = new Date(applyForm.to); to.setHours(0,0,0,0);
    const wanted = new Set(Object.entries(applyForm.weekdays).filter(([k,v])=>!!v).map(([k])=>k));
    const weekdayName = (d)=> ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];

    const rows = [];
    let d = new Date(from);
    while (d <= to){
      const label = weekdayName(d);
      if (wanted.has(label)){
        rows.push({
          shift_date: iso(d),
          start_time: t.start_time,
          end_time: t.end_time,
          base: applyForm.override.base || t.base || '',
          department: applyForm.override.department || t.department || '',
          role_code: t.role_code || '',
          min_staff: Number(applyForm.override.min_staff || t.min_staff || 1),
          max_staff: Number(applyForm.override.max_staff || t.max_staff || 1),
          notes: applyForm.override.notes || t.notes || ''
        });
      }
      d.setDate(d.getDate()+1);
    }

    // Build duplicate keys from currently loaded shifts
    const existing = new Set((shifts||[]).map(s => `${s.shift_date}|${s.start_time}|${s.end_time}|${s.base||''}|${s.department||''}|${s.role_code||''}`));
    const duplicates = [];
    rows.forEach(r => {
      const k = `${r.shift_date}|${r.start_time}|${r.end_time}|${r.base||''}|${r.department||''}|${r.role_code||''}`;
      if (existing.has(k)) duplicates.push(r);
    });

    return { rows, duplicates };
  }

  function openApplyPreview(e){
    e?.preventDefault?.();
    if (!applyForm.template_id) return toast('Choose a template', 'warning');
    const { rows, duplicates } = buildApplyRows();
    if (rows.length === 0) return toast('No dates match your filters', 'warning');
    setApplyPreview({ open:true, rows, duplicates });
  }

  async function createFromPreview(){
    const rows = applyPreview.rows || [];
    if (rows.length === 0) { setApplyPreview({ open:false, rows:[], duplicates:[] }); return; }
    const { data: created, error } = await supabase.from('roster_shift').insert(rows).select('*');
    if (error) { toast(error.message, 'danger'); return; }

    if (applyForm.autoAssign && Array.isArray(created)){
      for (const s of created){
        try {
          const stub = {
            shift_id: s.id || s.shift_id,
            shift_date: s.shift_date,
            start_time: s.start_time,
            end_time: s.end_time,
            base: s.base,
            department: s.department,
            role_code: s.role_code,
            min_staff: s.min_staff,
            max_staff: s.max_staff
          };
          const remaining = Math.max(0, (stub.min_staff || 0));
          if (remaining <= 0) continue;
          const candidates = suggestCandidatesForShift(stub, remaining);
          for (const c of candidates){
            const { error: errA } = await supabase.from('roster_assignment').insert([{ shift_id: stub.shift_id, employee_id: c.id, assigned_by: 'autofill@app' }]);
            if (errA) { console.warn(errA.message); break; }
          }
        } catch (e) { console.warn(e); }
      }
    }

    setApplyPreview({ open:false, rows:[], duplicates:[] });
    toast(`Created ${rows.length} shifts${applyForm.autoAssign? ' + auto-assigned':''}`, 'success');
    setShowApplyTemplate(false);
    setApplyForm(f=>({ ...f, template_id:"" }));
    load();
  }

  async function applyTemplateBulk(e){
    e?.preventDefault?.();
    if (!applyForm.template_id) return toast('Choose a template', 'warning');
    const t = templates.find(x=>x.id===applyForm.template_id);
    if (!t) return toast('Template not found', 'danger');
    const from = new Date(applyForm.from); from.setHours(0,0,0,0);
    const to = new Date(applyForm.to); to.setHours(0,0,0,0);
    if (to < from) return toast('End date must be after start', 'warning');

    const wanted = new Set(Object.entries(applyForm.weekdays).filter(([k,v])=>!!v).map(([k])=>k));
    if (wanted.size===0) return toast('Pick at least one weekday', 'warning');

    const weekdayName = (d)=> ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];

    const rows = [];
    let d = new Date(from);
    while (d <= to){
      const label = weekdayName(d);
      if (wanted.has(label)){
        rows.push({
          shift_date: iso(d),
          start_time: t.start_time,
          end_time: t.end_time,
          base: applyForm.override.base || t.base || '',
          department: applyForm.override.department || t.department || '',
          role_code: t.role_code || '',
          min_staff: Number(applyForm.override.min_staff || t.min_staff || 1),
          max_staff: Number(applyForm.override.max_staff || t.max_staff || 1),
          notes: applyForm.override.notes || t.notes || ''
        });
      }
      d.setDate(d.getDate()+1);
    }

    if (rows.length===0) return toast('No dates match your filters', 'warning');
    if (!window.confirm(`Create ${rows.length} shifts from template "${t.name}"?`)) return;

    const { data: created, error } = await supabase.from('roster_shift').insert(rows).select('*');
    if (error) return toast(error.message, 'danger');
    // Optionally auto-assign based on availability & fairness
    if (applyForm.autoAssign && Array.isArray(created)){
      for (const s of created){
        try {
          const stub = {
            shift_id: s.id || s.shift_id, // support view column names
            shift_date: s.shift_date,
            start_time: s.start_time,
            end_time: s.end_time,
            base: s.base,
            department: s.department,
            role_code: s.role_code,
            min_staff: s.min_staff,
            max_staff: s.max_staff
          };
          const assigns = []; // none yet
          const remaining = Math.max(0, (stub.min_staff || 0) - assigns.length);
          if (remaining <= 0) continue;
          const candidates = suggestCandidatesForShift(stub, remaining);
          for (const c of candidates){
            const { error: errA } = await supabase.from('roster_assignment').insert([{ shift_id: stub.shift_id, employee_id: c.id, assigned_by: 'autofill@app' }]);
            if (errA) { console.warn(errA.message); break; }
          }
        } catch (e) { console.warn(e); }
      }
    }
    toast(`Created ${rows.length} shifts${applyForm.autoAssign? ' + auto-assigned':''}`, 'success');
    setShowApplyTemplate(false);
    setApplyForm(f=>({ ...f, template_id:"" }));
    load();
  }
  const [absencesByEmpDay, setAbsencesByEmpDay] = useState({}); // { empId: Set([YYYY-MM-DD]) }

  // Notes: { [empId]: { [isoDate]: string[] } }
  const [notesByEmpDay, setNotesByEmpDay] = useState({}); // { [empId]: { [isoDate]: string[] } }
  // Hover preview key for notes ("empId|YYYY-MM-DD"), and side panel state
  const [noteHoverKey, setNoteHoverKey] = useState("");
  const [notesPanel, setNotesPanel] = useState({ open:false, empId:null });
  // Preview modal for auto-fill of a single shift
  const [fillPreview, setFillPreview] = useState({ open:false, shift:null, candidates:[] });

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
  useEffect(()=>{ load(); }, [filters, publishedOnly]);
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
      (!filters.dept || r.department === filters.dept) &&
      (!publishedOnly || r.status === 'published')
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

  // Helper: check if a shift is locked (published or cancelled)
  function isShiftLockedById(shift_id){
    const s = (shifts||[]).find(x => x.shift_id === shift_id);
    return !!(s && (s.status === 'published' || s.status === 'cancelled'));
  }

  async function assign(shift_id){
    if (!canEdit) { toast('Not authorized', 'danger'); return; }
    // Role restrictions: Seniors can only assign Officers
    if (role === 'senior') {
      const emp = employees.find(e => e.id === assignForm.employee_id);
      if (!emp || (emp.role_code && emp.role_code.toLowerCase() !== 'officer')) {
        toast('Seniors may only assign Officers', 'danger');
        return;
      }
    }
    if (isShiftLockedById(shift_id)) { toast('Shift is published/cancelled — edits locked', 'warning'); return; }
    if (!assignForm.employee_id) return toast("Choose an employee", "warning");
    const { error } = await supabase.from("roster_assignment").insert([{ shift_id, employee_id: assignForm.employee_id, assigned_by: "admin@app" }]);
    if (error) return toast(error.message, "danger");
    toast("Assigned", "success");
    setAssignForm({ empSearch:"", employee_id:"" });
    load();
  }

  async function unassign(shift_id, employee_id){
    if (!canEdit) { toast('Not authorized', 'danger'); return; }
    if (role === 'senior') {
      const emp = employees.find(e => e.id === employee_id);
      if (!emp || (emp.role_code && emp.role_code.toLowerCase() !== 'officer')) {
        toast('Seniors may only unassign Officers', 'danger');
        return;
      }
    }
    if (isShiftLockedById(shift_id)) { toast('Shift is published/cancelled — edits locked', 'warning'); return; }
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

  function availabilityText(empId, dateIso){
    const st = availabilityByEmpDay[empId]?.[dateIso];
    if (st === 'preferred') return 'Preferred';
    if (st === 'available') return 'Available';
    if (st === 'unavailable') return 'Unavailable';
    return '—';
  }

  // Helper: compute a subtle background tint for availability
  function availabilityTint(empId, dateIso){
    if (!showAvailability) return null;
    const st = availabilityByEmpDay[empId]?.[dateIso];
    if (!st) return null;
    // return a very subtle RGBA tint
    if (st === 'preferred') return 'rgba(245, 158, 11, 0.08)';   // amber-500 @ 8%
    if (st === 'available') return 'rgba(16, 185, 129, 0.08)';   // emerald-500 @ 8%
    if (st === 'unavailable') return 'rgba(239, 68, 68, 0.08)';  // red-500 @ 8%
    return null;
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

  function openFillPreview(shift){
    const assigns = assignmentsByShift[shift.shift_id] || [];
    const remaining = Math.max(0, (shift.min_staff || 0) - assigns.length);
    if (remaining <= 0) { toast('No remaining slots for this shift', 'info'); return; }
    const candidates = suggestCandidatesForShift(shift, remaining);
    if (candidates.length === 0) { toast('No suitable candidates found', 'warning'); return; }
    setFillPreview({ open:true, shift, candidates });
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

  async function setWeekStatus(rangeFrom, rangeTo, status){
    let q = supabase.from('roster_shift').update({ status })
      .gte('shift_date', rangeFrom)
      .lte('shift_date', rangeTo);
    if (filters.base) q = q.eq('base', filters.base);
    if (filters.dept) q = q.eq('department', filters.dept);
    const { error } = await q;
    if (error) return toast(error.message, 'danger');
    toast(`Week set to ${status}`, 'success');
    load();
  }
  function publishWeek(){
    if (role !== 'manager') { toast('Not authorized', 'danger'); return; }
    setWeekStatus(filters.from, filters.to, 'published');
  }
  function unpublishWeek(){
    if (role !== 'manager') { toast('Not authorized', 'danger'); return; }
    setWeekStatus(filters.from, filters.to, 'planned');
  }

  // === Delete shift helper ===
  async function deleteShift(shift_id){
    if (!canEdit) { toast('Not authorized', 'danger'); return; }
    if (isShiftLockedById(shift_id)) { toast('Shift is published/cancelled — edits locked', 'warning'); return; }
    if (!window.confirm('Delete this shift? This will also remove its assignments.')) return;

    // 1) Delete assignments first to avoid FK constraint issues
    const { error: errA } = await supabase.from('roster_assignment').delete().eq('shift_id', shift_id);
    if (errA) { toast(errA.message, 'danger'); return; }

    // 2) Delete the shift
    const { error: errS } = await supabase.from('roster_shift').delete().eq('id', shift_id);
    if (errS) { toast(errS.message, 'danger'); return; }

    toast('Shift deleted', 'success');
    load();
  }

  async function setStatus(shift_id, status){
    if (!canEdit) { toast('Not authorized', 'danger'); return; }
    const { error } = await supabase.from("roster_shift").update({ status }).eq("id", shift_id);
    if (error) return toast(error.message, "danger");
    toast(`Shift ${status}`, "success");
    load();
  }

  async function quickCreate(emp, date, kind){
    // Presets
    const presets = {
      day: { start: "06:00", end: "18:00", role: emp.role_code || "SHIFT" },
      night: { start: "18:00", end: "06:00", role: emp.role_code || "SHIFT" }, // overnight supported by shiftHours
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

    // Sort: Team (base) → Senior first → Name
    return [...byId.values()].sort((a, b) => {
      const ta = `${a.emp.base || ''}`.toLowerCase();
      const tb = `${b.emp.base || ''}`.toLowerCase();
      if (ta !== tb) return ta.localeCompare(tb);
      const ra = rolePriority(a.emp.role_code);
      const rb = rolePriority(b.emp.role_code);
      if (ra !== rb) return ra - rb;
      const an = `${a.emp.last_name || ''} ${a.emp.first_name || ''}`.trim().toLowerCase();
      const bn = `${b.emp.last_name || ''} ${b.emp.first_name || ''}`.trim().toLowerCase();
      return an.localeCompare(bn);
    });
  }, [groupBy, employees, filters.base, filters.dept, shifts, assignmentsByShift, days]);

  const totalEmployeeRows = employeeRows.length;
  const startIndex = groupBy === 'employee' ? Math.max(0, Math.floor(scrollY / ROW_HEIGHT) - 3) : 0;
  const visibleCount = groupBy === 'employee' ? Math.ceil(viewportH / ROW_HEIGHT) + 6 : totalEmployeeRows;
  const endIndex = groupBy === 'employee' ? Math.min(totalEmployeeRows, startIndex + visibleCount) : totalEmployeeRows;

  // Handler for copying previous week's shifts to current week
  async function copyPrevWeek(){
    const ws = weekStart(new Date(filters.from));
    const prev = weekStart(addDays(ws, -7));
    const prevFrom = iso(prev);
    const prevTo = iso(addDays(prev, 6));

    // fetch previous week shifts
    const { data: prevShifts, error } = await supabase
      .from('roster_shift')
      .select('*')
      .gte('shift_date', prevFrom)
      .lte('shift_date', prevTo);
    if (error) { toast(error.message, 'danger'); return; }

    if (!Array.isArray(prevShifts) || prevShifts.length===0){
      toast('No shifts found in previous week', 'info');
      return;
    }

    // offset each shift forward by 7 days
    const newRows = prevShifts.map(s => ({
      ...s,
      id: undefined,
      shift_id: undefined,
      shift_date: iso(addDays(new Date(s.shift_date), 7)),
      status: 'planned'
    }));

    // prevent duplicates (match on date+time+team+dept+role)
    const existing = new Set((shifts||[]).map(x => `${x.shift_date}|${x.start_time}|${x.end_time}|${x.base||''}|${x.department||''}|${x.role_code||''}`));
    const deduped = newRows.filter(r => !existing.has(`${r.shift_date}|${r.start_time}|${r.end_time}|${r.base||''}|${r.department||''}|${r.role_code||''}`));

    if (deduped.length===0){
      toast('All shifts already exist for this week', 'info');
      return;
    }

    const { error: err2 } = await supabase.from('roster_shift').insert(deduped);
    if (err2) { toast(err2.message, 'danger'); return; }
    toast(`Copied ${deduped.length} shifts from previous week`, 'success');
    load();
  }

  // Generate Float Month: fill unmet coverage using officers from a float team, capping each at 14 working days
  async function generateFloatMonth(){
    if (!canEdit) { toast('Not authorized', 'danger'); return; }
    if (!floatMonth) { toast('Pick a month', 'warning'); return; }
    const base = new Date(floatMonth);
    base.setHours(0,0,0,0);
    const from = iso(new Date(base.getFullYear(), base.getMonth(), 1));
    const to = iso(new Date(base.getFullYear(), base.getMonth()+1, 0));

    // pull coverage rows needing staff
    const { data: cov, error: errC } = await supabase
      .from('roster_coverage_v')
      .select('*')
      .gte('shift_date', from).lte('shift_date', to)
      .neq('status','cancelled');
    if (errC) { toast(errC.message, 'danger'); return; }
    const need = (cov||[]).filter(s => s.assigned_count < s.min_staff);
    if (need.length===0){ toast('No unmet coverage this month', 'info'); return; }

    // fetch assignments for these shifts to know dates per employee
    const ids = need.map(s=>s.shift_id);
    const { data: assigns } = await supabase
      .from('roster_assignment')
      .select('shift_id,employee_id');
    const byShiftDate = Object.fromEntries((cov||[]).map(s=>[s.shift_id, s.shift_date]));

    // build existing per-emp counts & per-day sets (within the month)
    const empDays = {}; // {empId: count of assigned days}
    const empDates = {}; // {empId: Set(dates)}
    (assigns||[]).forEach(a=>{
      const d = byShiftDate[a.shift_id];
      if (!d) return;
      empDays[a.employee_id] = (empDays[a.employee_id]||0) + 1;
      (empDates[a.employee_id] = empDates[a.employee_id]||new Set()).add(d);
    });

    // availability & absences for the month
    const { data: av } = await supabase.from('employee_availability').select('employee_id,date,status').gte('date',from).lte('date',to);
    const avail = {}; (av||[]).forEach(r=>{ (avail[r.employee_id] = avail[r.employee_id]||{})[r.date]=r.status; });
    const { data: abs } = await supabase.from('absence').select('employee_id,start_date,end_date').lte('start_date',to).gte('end_date',from);
    const absent = {}; (abs||[]).forEach(a=>{ const ds = eachDateIso(a.start_date,a.end_date); const s = absent[a.employee_id]||new Set(); ds.forEach(d=>s.add(d)); absent[a.employee_id]=s; });

    // eligible officers pool (floatTeam or all)
    const pool = (employees||[]).filter(e => (!floatTeam || e.base===floatTeam));
    const rankAvail = (empId,d)=>{ const st = avail[empId]?.[d]; return st==='preferred'?0 : st==='available'?1 : st===undefined?2 : 9; };

    // Greedy assignment
    let made = 0;
    for (const s of need.sort((a,b)=> a.shift_date.localeCompare(b.shift_date))){
      let remaining = (s.min_staff - s.assigned_count);
      while (remaining-- > 0){
        const d = s.shift_date;
        const cand = pool
          .filter(e => (empDays[e.id]||0) < 14)
          .filter(e => !(empDates[e.id]?.has(d)))
          .filter(e => !(absent[e.id]?.has(d)))
          .filter(e => rankAvail(e.id,d) < 9)
          .sort((a,b)=>{
            const ra = rankAvail(a.id,d) - rankAvail(b.id,d);
            if (ra!==0) return ra;
            const ca = (empDays[a.id]||0) - (empDays[b.id]||0);
            if (ca!==0) return ca;
            return `${a.last_name||''}${a.first_name||''}`.localeCompare(`${b.last_name||''}${b.first_name||''}`);
          })[0];
        if (!cand) break;
        const { error: errI } = await supabase.from('roster_assignment').insert([{ shift_id: s.shift_id, employee_id: cand.id, assigned_by: 'float@app' }]);
        if (errI) { toast(errI.message,'danger'); break; }
        empDays[cand.id] = (empDays[cand.id]||0) + 1;
        (empDates[cand.id] = empDates[cand.id]||new Set()).add(d);
        made++;
      }
    }
    toast(made? `Float month: assigned ${made} slots` : 'No eligible assignments could be made', made? 'success' : 'info');
    load();
  }

  // Generate 28‑day rolling pattern for 5 teams starting from selected anchor
  async function generatePattern(){
    if (!canEdit) { toast('Not authorized', 'danger'); return; }
    if (!patternAnchor) { toast('Pick an anchor date', 'warning'); return; }
    const anchor = new Date(patternAnchor); anchor.setHours(0,0,0,0);
    const periodFrom = iso(anchor);
    const periodTo = iso(addDays(anchor, 27));

    // Optionally scope to a single Team from filters
    const teams = (filters.base ? TEAMS.filter(t=> t.name === filters.base) : TEAMS);
    if (teams.length === 0){ toast('No matching team for current filter', 'info'); return; }

    // Fetch existing shifts in the 28‑day window for dedupe
    const { data: existingRows, error: exErr } = await supabase
      .from('roster_shift')
      .select('shift_date,start_time,end_time,base,department,role_code')
      .gte('shift_date', periodFrom)
      .lte('shift_date', periodTo);
    if (exErr) { toast(exErr.message, 'danger'); return; }
    const existing = new Set((existingRows||[]).map(x => `${x.shift_date}|${x.start_time}|${x.end_time}|${x.base||''}|${x.department||''}|${x.role_code||''}`));

    const rows = [];
    for (let i=0;i<28;i++){
      const d = addDays(anchor, i);
      const dateIso = iso(d);
      for (const team of teams){
        const idx = patternIndexFor(team.offset, anchor, d);
        const token = PATTERN_TOKENS[idx];
        const map = TOKEN_MAP[token];
        if (!map) continue; // REST / OFF
        const row = {
          shift_date: dateIso,
          start_time: map.start,
          end_time: map.end,
          base: team.name,
          department: filters.dept || '',
          role_code: map.role,
          min_staff: 1,
          max_staff: 1,
          notes: 'Pattern'
        };
        const key = `${row.shift_date}|${row.start_time}|${row.end_time}|${row.base}|${row.department}|${row.role_code}`;
        if (!existing.has(key)) rows.push(row);
      }
    }

    if (rows.length === 0){ toast('Nothing to create (already exists)', 'info'); return; }

    const { error } = await supabase.from('roster_shift').insert(rows);
    if (error) { toast(error.message, 'danger'); return; }
    toast(`Created ${rows.length} shifts from 28‑day pattern`, 'success');
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold flex items-center gap-2">
          Roster
          <Badge
            tone={
              role === 'manager'
                ? 'success'
                : role === 'senior'
                ? 'info'
                : 'neutral'
            }
            title={`Your access level: ${role}`}
          >
            {role.charAt(0).toUpperCase() + role.slice(1)}
          </Badge>
        </h1>
        <div className="flex items-center gap-2">
          {/* Week nav */}
          <Button variant="ghost" onClick={()=> setFilters(f=>{
            const ws = weekStart(new Date(f.from));
            const prev = weekStart(addDays(ws, -7));
            return { ...f, from: iso(prev), to: iso(addDays(prev,6)) };
          })}>← Prev</Button>
          <Button variant="ghost" onClick={()=> setFilters(f=>{
            const ws = weekStart(new Date());
            return { ...f, from: iso(ws), to: iso(addDays(ws,6)) };
          })}>This week</Button>
          <Button variant="ghost" onClick={()=> setFilters(f=>{
            const ws = weekStart(new Date(f.from));
            const next = weekStart(addDays(ws, 7));
            return { ...f, from: iso(next), to: iso(addDays(next,6)) };
          })}>Next →</Button>

          <div className="w-px h-6 bg-gray-200 mx-1" />

          {/* Essentials */}
          <Button variant="outline" onClick={()=> setShowFilters(v=>!v)}>{showFilters? "Hide Filters":"Filters"}</Button>
          <Button variant="outline" onClick={()=> setShowAvailability(v=>!v)}>
            {showAvailability ? 'Hide Availability' : 'Show Availability'}
          </Button>
          <label className="ml-1 inline-flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={publishedOnly} onChange={e=> setPublishedOnly(e.target.checked)} />
            Published only
          </label>

          <div className="w-px h-6 bg-gray-200 mx-1" />

          {/* Advanced panel toggle and Create Shift toggle: Managers only */}
          {role === 'manager' && (
            <>
              <Button variant="outline" onClick={()=> setShowAdvanced(v=>!v)}>
                {showAdvanced ? 'Hide advanced' : 'Advanced'}
              </Button>
              <Button variant="outline" onClick={()=> setShowCreate(v=>!v)}>
                {showCreate ? 'Hide Create' : 'Create Shift'}
              </Button>
            </>
          )}
        </div>
      </div>
      <div className="text-sm text-gray-600">Plan shifts and track coverage. Absence conflicts are flagged automatically.</div>
      {showAdvanced && role === 'manager' && (
        <Card title="Advanced controls">
          <div className="flex flex-wrap gap-2">
            <Field label="Pattern anchor date">
              <Input type="date" value={patternAnchor} onChange={e=> setPatternAnchor(e.target.value)} />
            </Field>
            <Button variant="outline" onClick={generatePattern}>Generate 28‑day Pattern</Button>

            <Field label="Float team">
              <Select value={floatTeam} onChange={e=> setFloatTeam(e.target.value)}>
                <option value="">All</option>
                {TEAMS.map(t=> <option key={t.name} value={t.name}>{t.name}</option>)}
              </Select>
            </Field>
            <Field label="Float month">
              <Input type="date" value={floatMonth} onChange={e=> setFloatMonth(e.target.value)} />
            </Field>
            <Button variant="outline" onClick={generateFloatMonth}>Generate Float Month</Button>

            {/* Allow both manager and senior for Copy Previous Week and Auto-fill Week */}
            {(role === 'manager' || role === 'senior') && (
              <>
                <Button variant="outline" onClick={copyPrevWeek}>Copy Previous Week → Current</Button>
                <Button variant="outline" onClick={autofillWeek}>Auto‑fill Week</Button>
              </>
            )}
            {/* Only manager for Publish/Unpublish */}
            {role === 'manager' && (
              <>
                <Button variant="outline" onClick={publishWeek}>Publish Week</Button>
                <Button variant="outline" onClick={unpublishWeek}>Unpublish Week</Button>
              </>
            )}
          </div>
        </Card>
      )}
      {showAvailability && (
        <div className="flex items-center gap-3 text-[11px] text-gray-600">
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500"></span> Available</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-500"></span> Preferred</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500"></span> Unavailable</span>
          <span className="text-gray-400">(cells lightly tinted)</span>
        </div>
      )}

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

      {showApplyTemplate && (
        <Card title="Apply template to date range">
          <form onSubmit={applyTemplateBulk} className="grid md:grid-cols-8 gap-3">
            <Field label="Template" className="md:col-span-3">
              <Select value={applyForm.template_id} onChange={e=> setApplyForm(f=>({...f, template_id:e.target.value}))}>
                <option value="">— Select template —</option>
                {templates.map(t=> <option key={t.id} value={t.id}>{t.name} ({t.start_time}–{t.end_time})</option>)}
              </Select>
            </Field>
            <Field label="From"><Input type="date" value={applyForm.from} onChange={e=> setApplyForm(f=>({...f, from:e.target.value}))}/></Field>
            <Field label="To"><Input type="date" value={applyForm.to} onChange={e=> setApplyForm(f=>({...f, to:e.target.value}))}/></Field>
            <Field label="Weekdays" className="md:col-span-3">
              <div className="flex flex-wrap gap-2 text-sm">
                {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(w => (
                  <label key={w} className="inline-flex items-center gap-1 border rounded px-2 py-1">
                    <input type="checkbox" checked={!!applyForm.weekdays[w]} onChange={e=> setApplyForm(f=>({...f, weekdays:{...f.weekdays, [w]: e.target.checked}}))}/>
                    {w}
                  </label>
                ))}
              </div>
            </Field>

            <Field label="Override Team"><Input placeholder="(optional)" value={applyForm.override.base} onChange={e=> setApplyForm(f=>({...f, override:{...f.override, base:e.target.value}}))}/></Field>
            <Field label="Override Dept"><Input placeholder="(optional)" value={applyForm.override.department} onChange={e=> setApplyForm(f=>({...f, override:{...f.override, department:e.target.value}}))}/></Field>
            <Field label="Override Min/Max" className="md:col-span-2">
              <div className="flex gap-2">
                <Input type="number" min="1" placeholder="min" value={applyForm.override.min_staff} onChange={e=> setApplyForm(f=>({...f, override:{...f.override, min_staff:e.target.value}}))}/>
                <Input type="number" min="1" placeholder="max" value={applyForm.override.max_staff} onChange={e=> setApplyForm(f=>({...f, override:{...f.override, max_staff:e.target.value}}))}/>
              </div>
            </Field>
            <Field label="Override Notes" className="md:col-span-4">
              <Input placeholder="(optional)" value={applyForm.override.notes} onChange={e=> setApplyForm(f=>({...f, override:{...f.override, notes:e.target.value}}))}/>
            </Field>

            <div className="md:col-span-8 flex flex-wrap items-center gap-2 justify-between">
              <div className="flex items-center gap-3 text-sm">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={!!applyForm.autoAssign}
                    onChange={e=> setApplyForm(f=>({...f, autoAssign: e.target.checked}))}
                  />
                  Auto-assign after create
                </label>
                <div className="text-gray-400">•</div>
                <button type="button" className="px-2 py-1 border rounded hover:bg-gray-50" onClick={()=> setApplyToCurrentWeek(true)}>This week (weekdays)</button>
                <button type="button" className="px-2 py-1 border rounded hover:bg-gray-50" onClick={()=> setApplyToCurrentWeek(false)}>This week (all days)</button>
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" onClick={openApplyPreview}>Preview</Button>
                <Button type="submit">Create shifts</Button>
                <Button variant="outline" type="button" onClick={()=> setShowApplyTemplate(false)}>Cancel</Button>
              </div>
            </div>
          </form>
        </Card>
      )}
      {/* Multi-schedule view */}
      <Card>
          <div className="overflow-auto" ref={scrollRef} onScroll={(e)=>{ setScrollY(e.currentTarget.scrollTop); setHeaderShadow(e.currentTarget.scrollTop>0); }}>
            <div className="min-w-[1100px] w-full">
              {/* Header row: group label + 7 day columns */}
              <div className={`grid ${headerShadow ? 'shadow-sm' : ''}`} style={{ gridTemplateColumns: '200px repeat(7, 140px)' }}>
                <div className="p-3 text-xs font-medium text-gray-500 uppercase tracking-wide">{groupBy === 'base' ? 'Team' : groupBy.replace('_',' ')}</div>
                {days.map(d => (
                  <div key={d} className="p-3 text-sm font-semibold text-gray-700 sticky top-0 bg-white z-10 border-b">{new Date(d).toLocaleDateString(undefined,{ weekday:'short', month:'short', day:'numeric' })}</div>
                ))}
              </div>

              {/* Rows */}
              {groupBy === 'employee' ? (
                <div className="contents">
                  <div style={{ height: startIndex * ROW_HEIGHT }} />
                  {employeeRows.slice(startIndex, endIndex).map(({ emp, byDay, totalHrs }, idx) => {
                    const globalIndex = startIndex + idx;
                    const prevBase = globalIndex > 0 ? (employeeRows[globalIndex - 1]?.emp?.base || '') : '';
                    const currBase = emp.base || '';
                    const showTeamSep = currBase !== prevBase;
                    return (
                      <div className="contents" key={`row-${emp.id}`}>
                        {showTeamSep && (
                          <div className="grid" style={{ gridTemplateColumns: '200px repeat(7, 140px)' }}>
                            <div className="px-3 py-2 text-[11px] font-semibold text-gray-600 bg-white sticky left-0 z-10 border-y border-t border-gray-200">
                              Team: {currBase || '—'}
                            </div>
                            {days.map(d => (
                              <div key={`sep-${currBase}-${d}`} className="border-y border-gray-200 bg-white" />
                            ))}
                          </div>
                        )}
                        <div className="grid border-t" style={{ gridTemplateColumns: '200px repeat(7, 140px)' }}>
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
                        style={{ backgroundColor: availabilityTint(emp.id, d) || undefined }}
                        onContextMenu={(e) => { e.preventDefault(); addNote(emp.id, d); }}
                      >
                        {/* Quick add and availability buttons - role restrictions */}
                        {(() => {
                          // For Officers: hide both quick add and quick avail controls
                          if (role === "officer") return null;
                          // For Seniors: only show for Officer employees
                          if (role === "senior" && String(emp.role_code || "").toLowerCase() !== "officer") return null;
                          // Otherwise (Manager, or Senior on Officer), show controls
                          return (
                            <>
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
                            </>
                          );
                        })()}

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
                                      {(() => {
                                        // Officer: never show unassign
                                        if (role === "officer") return null;
                                        // Senior: only show for Officer employees
                                        if (role === "senior" && String(emp.role_code || "").toLowerCase() !== "officer") return null;
                                        // Manager: always show, or Senior for Officer
                                        if (canEdit) {
                                          return (
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
                                          );
                                        }
                                        return null;
                                      })()}
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
                      </div>
                    );
                  })}
                  <div style={{ height: Math.max(0, (totalEmployeeRows - endIndex) * ROW_HEIGHT) }} />
                </div>
              ) : (
                grouped.map(g => (
                  <div key={g.key} className="grid border-t" style={{ gridTemplateColumns: '200px repeat(7, 140px)' }}>
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
                                // Role-based restrictions for controls
                                // Officer: no edit controls at all
                                // Senior: only allow add/remove if shift is for Officer
                                const isOfficerShift = String(s.role_code || "").toLowerCase() === "officer";
                                const controlsAllowed =
                                  (role === "manager") ||
                                  (role === "senior" && isOfficerShift);
                                return (
                                  <div
                                    key={s.shift_id}
                                    className="rounded border text-[11px]"
                                    style={{
                                      background: `linear-gradient(0deg, ${coverageBg}, ${coverageBg}), hsl(${hue},100%,97%)`,
                                      borderColor: `hsl(${hue},70%,80%)`
                                    }}
                                  >
                                  <div className="px-2 py-0.5 flex items-center justify-between gap-2">
                                    <div className="text-xs font-medium">{formatShiftLabel(s)}</div>
                                    <div className="flex items-center gap-2">
                                      <Badge tone={remaining>0? 'danger' : (assigns.length> s.max_staff? 'warning' : 'success')}>
                                        {assigns.length}/{s.min_staff}
                                      </Badge>
                                      {(remaining > 0 && s.status !== 'published' && s.status !== 'cancelled' && controlsAllowed) && (
                                        <button
                                          className="text-[11px] px-1.5 py-0.5 rounded border hover:bg-gray-50"
                                          onClick={()=>openFillPreview(s)}
                                          title="Preview candidates and fill"
                                        >Fill</button>
                                      )}
                                      {(controlsAllowed && s.status !== 'published' && s.status !== 'cancelled') && (
                                        <button
                                          className="text-[11px] p-1.5 rounded hover:bg-red-50"
                                          title="Delete shift"
                                          onClick={()=>deleteShift(s.shift_id)}
                                        >
                                          🗑️
                                        </button>
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
                                    {s.status === 'published' || s.status === 'cancelled' ? (
                                      <div className="mt-2 text-[11px] text-gray-500">{s.status === 'published' ? 'Published — edits disabled' : 'Cancelled'}</div>
                                    ) : (
                                      controlsAllowed && (
                                        <div className="mt-2 flex gap-1">
                                          <Select value={assignForm.employee_id} onChange={e=>setAssignForm(f=>({...f, employee_id:e.target.value}))}>
                                            <option value="">Add…</option>
                                            {employees.map(emp => (
                                              <option key={emp.id} value={emp.id}>{emp.first_name} {emp.last_name}</option>
                                            ))}
                                          </Select>
                                          <Button onClick={()=>assign(s.shift_id)}>Add</Button>
                                        </div>
                                      )
                                    )}
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
    </div>
  );
}