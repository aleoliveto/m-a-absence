import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { Card, Button, Field, Input, Table, Badge } from "../components/ui";

export default function Employees() {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    first_name: "", last_name: "", email: "",
    base: "", department: "", role_code: "",
    hire_date: "", status: "active",
  });

  useEffect(() => { load(); }, []);
  async function load() {
    const { data } = await supabase.from("employee").select("*").order("last_name", { ascending: true });
    setRows(data || []);
  }

  async function addEmployee(e) {
    e.preventDefault();
    if (!form.email || !form.first_name || !form.last_name) return alert("First/last name and Email are required");
    const { error } = await supabase.from("employee").insert([form]);
    if (error) return alert(error.message);
    setForm({ first_name:"", last_name:"", email:"", base:"", department:"", role_code:"", hire_date:"", status:"active" });
    setShowForm(false); load();
  }

  const view = rows.filter(r =>
    (r.first_name+" "+r.last_name).toLowerCase().includes(q.toLowerCase()) ||
    (r.email||"").toLowerCase().includes(q.toLowerCase())
  );

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
        <Table head={["Name","Email","Base","Dept","Status"]}>
          {view.map(e=>(
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
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
