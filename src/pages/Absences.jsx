import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { exportCsv } from "../lib/exportCsv";
import { Card, Button, Field, Input, Select, Table, Badge, toast } from "../components/ui";

const iso = (d) => new Date(d).toISOString().slice(0, 10);
const dayDiff = (a, b) => Math.max(1, Math.round((new Date(b) - new Date(a)) / 86400000) + 1);

export default function Absences() {
  const [rows, setRows] = useState([]);
  const [bases, setBases] = useState([]);
  const [depts, setDepts] = useState([]);
  const [reasons, setReasons] = useState([]);
  const [settings, setSettings] = useState({ long_absence_days: 7 });

  const [filters, setFilters] = useState(() => {
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 86400000);
    return { base: "", dept: "", from: iso(from), to: iso(to), q: "" };
  });

  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({
    start_date: "",
    end_date: "",
    reason_code: "",
    notes: "",
  });

  // Lookup lists + settings
  useEffect(() => {
    (async () => {
      const { data: emps } = await supabase
        .from("employee").select("id,base,department").eq("status", "active");
      setBases([...new Set((emps || []).map(e => e.base).filter(Boolean))].sort());
      setDepts([...new Set((emps || []).map(e => e.department).filter(Boolean))].sort());

      const { data: rs } = await supabase
        .from("absence_reason").select("code,label").order("label", { ascending: true });
      setReasons(rs || []);

      const { data: s } = await supabase.from("settings").select("*").eq("id",1).maybeSingle();
      if (s) setSettings(s);
    })();
  }, []);

  // Load rows in date range
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filters.from, filters.to]);
  async function load() {
    const { data } = await supabase
      .from("absence")
      .select("id,start_date,end_date,reason_code,notes,employee:employee_id ( id, first_name, last_name, email, base, department )")
      .gte("start_date", filters.from)
      .lte("end_date", filters.to)
      .order("start_date", { ascending: false });
    setRows(data || []);
  }

  // Client-side filters for base/dept/search
  const view = useMemo(() => {
    return (rows || []).filter(r => {
      const matchBase = !filters.base || r.employee?.base === filters.base;
      const matchDept = !filters.dept || r.employee?.department === filters.dept;
      const q = filters.q.trim().toLowerCase();
      const full = `${r.employee?.first_name || ""} ${r.employee?.last_name || ""}`.toLowerCase();
      const matchQ = !q || full.includes(q) || (r.employee?.email || "").toLowerCase().includes(q);
      return matchBase && matchDept && matchQ;
    });
  }, [rows, filters]);

  // Inline edit handlers
  function startEdit(r) {
    setEditingId(r.id);
    setEditForm({
      start_date: r.start_date,
      end_date: r.end_date,
      reason_code: r.reason_code,
      notes: r.notes || "",
    });
  }
  function cancelEdit() { setEditingId(null); }
  async function saveEdit(id) {
    if (!editForm.start_date || !editForm.end_date) return toast("Start and end dates are required", "warning");
    if (editForm.end_date < editForm.start_date) return toast("End date must be after start date", "warning");
    const { error } = await supabase.from("absence").update(editForm).eq("id", id);
    if (error) return toast(error.message, "danger");
    toast("Absence updated", "success");
    cancelEdit(); load();
  }
  async function remove(id) {
    if (!window.confirm("Delete this absence record?")) return;
    const { error } = await supabase.from("absence").delete().eq("id", id);
    if (error) return toast(error.message, "danger");
    toast("Absence deleted", "success");
    load();
  }

  function exportCurrent() {
    exportCsv(
      `absences_${filters.from}_${filters.to}.csv`,
      view.map(r => ({
        start_date: r.start_date,
        end_date: r.end_date,
        duration_days: dayDiff(r.start_date, r.end_date),
        reason_code: r.reason_code,
        notes: r.notes || "",
        first_name: r.employee?.first_name,
        last_name: r.employee?.last_name,
        email: r.employee?.email,
        base: r.employee?.base,
        department: r.employee?.department,
      }))
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Absences</h1>
      </div>
      <div className="text-sm text-gray-600">Track all recorded absences. <span className="ml-2">Showing {view.length} of {rows.length} in range.</span></div>

      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={exportCurrent}>Export CSV</Button>
      </div>

      <Card title="Filters">
        <div className="grid md:grid-cols-6 gap-3">
          <Field label="Team">
            <Select value={filters.base} onChange={e => setFilters(f => ({ ...f, base: e.target.value }))}>
              <option value="">All</option>
              {bases.map(b => <option key={b} value={b}>{b}</option>)}
            </Select>
          </Field>
          <Field label="Department">
            <Select value={filters.dept} onChange={e => setFilters(f => ({ ...f, dept: e.target.value }))}>
              <option value="">All</option>
              {depts.map(d => <option key={d} value={d}>{d}</option>)}
            </Select>
          </Field>
          <Field label="From">
            <Input type="date" value={filters.from} onChange={e => setFilters(f => ({ ...f, from: e.target.value }))} />
          </Field>
          <Field label="To">
            <Input type="date" value={filters.to} onChange={e => setFilters(f => ({ ...f, to: e.target.value }))} />
          </Field>
          <Field label="Search (name/email)" >
            <Input placeholder="e.g. Alex or alex@…" value={filters.q} onChange={e => setFilters(f => ({ ...f, q: e.target.value }))} />
          </Field>
          <div className="flex items-end"><Button variant="ghost" onClick={load}>Refresh</Button></div>
        </div>
      </Card>

      <Card>
        {view.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">No absences match your filters.</div>
        ) : (
          <Table head={["Employee","Team","Dept","Start","End","Duration","Reason","Notes",""]}>
            {view.map(r => {
              const duration = dayDiff(r.start_date, r.end_date);
              const isLong = duration >= (settings.long_absence_days ?? 7);
              return (
                editingId === r.id ? (
                  <tr key={r.id} className="bg-orange-50">
                    <td className="p-3">
                      {r.employee?.first_name} {r.employee?.last_name}
                      <div className="text-xs text-gray-500">{r.employee?.email}</div>
                    </td>
                    <td className="p-3">{r.employee?.base}</td>
                    <td className="p-3">{r.employee?.department}</td>
                    <td className="p-3">
                      <Input type="date" value={editForm.start_date}
                        onChange={e => setEditForm(f => ({ ...f, start_date: e.target.value }))} />
                    </td>
                    <td className="p-3">
                      <Input type="date" value={editForm.end_date}
                        onChange={e => setEditForm(f => ({ ...f, end_date: e.target.value }))} />
                    </td>
                    <td className="p-3">{dayDiff(editForm.start_date, editForm.end_date)}</td>
                    <td className="p-3">
                      <Select value={editForm.reason_code}
                        onChange={e => setEditForm(f => ({ ...f, reason_code: e.target.value }))}>
                        {reasons.map(x => <option key={x.code} value={x.code}>{x.code}</option>)}
                      </Select>
                    </td>
                    <td className="p-3">
                      <Input value={editForm.notes}
                        onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} />
                    </td>
                    <td className="p-3 whitespace-nowrap">
                      <Button variant="primary" className="mr-2" onClick={() => saveEdit(r.id)}>Save</Button>
                      <Button variant="outline" onClick={cancelEdit}>Cancel</Button>
                    </td>
                  </tr>
                ) : (
                  <tr key={r.id}>
                    <td className="p-3">
                      {r.employee?.first_name} {r.employee?.last_name}
                      <div className="text-xs text-gray-500">{r.employee?.email}</div>
                    </td>
                    <td className="p-3">{r.employee?.base}</td>
                    <td className="p-3">{r.employee?.department}</td>
                    <td className="p-3">{r.start_date}</td>
                    <td className="p-3">{r.end_date}</td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <span>{duration}</span>
                        {isLong && <Badge tone="warning">Long</Badge>}
                      </div>
                    </td>
                    <td className="p-3">{r.reason_code}</td>
                    <td className="p-3">{r.notes || ""}</td>
                    <td className="p-3 whitespace-nowrap">
                      <Button variant="outline" className="mr-2" onClick={() => startEdit(r)}>Edit</Button>
                      <Button variant="danger" onClick={() => remove(r.id)}>Delete</Button>
                    </td>
                  </tr>
                )
              );
            })}
          </Table>
        )}
      </Card>
    </div>
  );
}
