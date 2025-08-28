import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { Card, Button, Field, Input, Table, Badge } from "../components/ui";

const iso = (d) => new Date(d).toISOString().slice(0, 10);

export default function Employees() {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    first_name: "", last_name: "", email: "",
    base: "", department: "", role_code: "",
    hire_date: "", status: "active",
  });

  // settings + recent absence counts (90d)
  const [settings, setSettings] = useState({ frequent_absences_threshold: 3 });
  const [counts90, setCounts90] = useState({}); // { employee_id: count }

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    // Employees
    const { data: emps } = await supabase
      .from("employee")
      .select("*")
      .order("last_name", { ascending: true });
    setRows(emps || []);

    // Settings
    const { data: s } = await supabase.from("settings").select("*").eq("id", 1).maybeSingle();
    if (s) setSettings(s);

    // Absences in last 90 days → count by employee
    const since90 = iso(new Date(Date.now() - 90 * 86400000));
    const { data: recents } = await supabase
      .from("absence")
      .select("employee_id,start_date")
      .gte("start_date", since90);

    const by = {};
    (recents || []).forEach(r => {
      if (!r.employee_id) return;
      by[r.employee_id] = (by[r.employee_id] || 0) + 1;
    });
    setCounts90(by);
  }

  async function addEmployee(e) {
    e.preventDefault();
    if (!form.email || !form.first_name || !form.last_name) return alert("First/last name and Email are required");
    const { error } = await supabase.from("employee").insert([form]);
    if (error) return alert(error.message);
    setForm({ first_name:"", last_name:"", email:"", base:"", department:"", role_code:"", hire_date:"", status:"active" });
    setShowForm(false);
    loadAll();
  }

  const view = useMemo(() => {
    return rows.filter(r =>
      (r.first_name + " " + r.last_name).toLowerCase().includes(q.toLowerCase()) ||
      (r.email || "").toLowerCase().includes(q.toLowerCase())
    );
  }, [rows, q]);

  const statusTone = s => s==="active" ? "success" : (s==="leave" ? "warning" : "danger");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Employees</h1>
        <div className="flex gap-2">
          <Input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search…" />
          <Button onClick={()=>setShowForm(s=>!s)}>{showForm? "Cancel":"＋ Add Employee"}</Button>
        </div>
      </div>

      {showForm && (
        <Card title="New Employee">
          <form onSubmit={addEmployee} className="grid md:grid-cols-3 gap-3">
            <Field label="First name"><Input value={form.first_name} onChange={e=>setForm(f=>({...f,first_name:e.target.value}))}/></Field>
            <Field label="Last name"><Input value={form.last_name} onChange={e=>setForm(f=>({...f,last_name:e.target.value}))}/></Field>
            <Field label="Email"><Input value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))}/></Field>
            <Field label="Base"><Input value={form.base} onChange={e=>setForm(f=>({...f,base:e.target.value}))}/></Field>
            <Field label="Department"><Input value={form.department} onChange={e=>setForm(f=>({...f,department:e.target.value}))}/></Field>
            <Field label="Role code"><Input value={form.role_code} onChange={e=>setForm(f=>({...f,role_code:e.target.value}))}/></Field>
            <Field label="Hire date"><Input type="date" value={form.hire_date} onChange={e=>setForm(f=>({...f,hire_date:e.target.value}))}/></Field>
            <Field label="Status">
              <select className="border rounded-lg px-3 py-2 w-full" value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))}>
                <option value="active">Active</option>
                <option value="leave">Leave</option>
                <option value="terminated">Terminated</option>
              </select>
            </Field>
            <div className="md:col-span-3"><Button type="submit">Save Employee</Button></div>
          </form>
        </Card>
      )}

      <Card>
        <Table head={["Name","Email","Base","Dept","Status","Events (90d)"]}>
          {view.map(e => {
            const count = counts90[e.id] || 0;
            const isFrequent = count >= (settings.frequent_absences_threshold ?? 3);
            return (
              <tr key={e.id}>
                <td className="p-3">
                  <Link to={`/employees/${e.id}`} className="text-blue-600 hover:underline">
                    {e.first_name} {e.last_name}
                  </Link>
                </td>
                <td className="p-3">{e.email}</td>
                <td className="p-3">{e.base}</td>
                <td className="p-3">{e.department}</td>
                <td className="p-3"><Badge tone={statusTone(e.status)}>{e.status}</Badge></td>
                <td className="p-3">
                  <div className="flex items-center gap-2">
                    <span>{count}</span>
                    {isFrequent && <Badge tone="danger">Frequent</Badge>}
                  </div>
                </td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </div>
  );
}
