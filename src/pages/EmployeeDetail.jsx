import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { Card, Button, Field, Input, Select, Table } from "../components/ui";

export default function EmployeeDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [emp, setEmp] = useState(null);
  const [absences, setAbsences] = useState([]);
  const [reasons, setReasons] = useState([]);

  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    first_name: "", last_name: "", email: "", base: "", department: "",
    role_code: "", hire_date: "", status: "active", manager_email: "",
  });

  const [form, setForm] = useState({ start_date: "", end_date: "", reason_code: "SICK", notes: "" });

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  async function load() {
    setLoading(true);

    const { data: e, error: eErr } = await supabase.from("employee").select("*").eq("id", id).single();
    if (eErr) { alert(eErr.message); setLoading(false); return; }
    setEmp(e);
    setEditForm({
      first_name: e.first_name || "", last_name: e.last_name || "", email: e.email || "",
      base: e.base || "", department: e.department || "", role_code: e.role_code || "",
      hire_date: e.hire_date || "", status: e.status || "active", manager_email: e.manager_email || "",
    });

    const { data: a } = await supabase
      .from("absence").select("*").eq("employee_id", id).order("start_date", { ascending: false });
    setAbsences(a || []);

    const { data: rs } = await supabase.from("absence_reason").select("code,label").order("label", { ascending: true });
    setReasons(rs || []);

    setLoading(false);
  }

  async function addAbsence() {
    if (!form.start_date || !form.end_date) return alert("Enter start and end dates");
    if (form.end_date < form.start_date) return alert("End date must be after start");
    const { error } = await supabase
      .from("absence").insert([{ employee_id: id, ...form, created_by: "admin@app" }]);
    if (error) return alert(error.message);
    setForm({ start_date: "", end_date: "", reason_code: reasons[0]?.code || "SICK", notes: "" });
    const { data: a } = await supabase
      .from("absence").select("*").eq("employee_id", id).order("start_date", { ascending: false });
    setAbsences(a || []);
  }

  async function saveEmployee(e) {
    e.preventDefault();
    if (!editForm.first_name || !editForm.last_name || !editForm.email) {
      return alert("First name, Last name and Email are required");
    }
    const { error } = await supabase.from("employee").update(editForm).eq("id", id);
    if (error) return alert(error.message);
    setEditing(false); load();
  }

  async function deleteEmployee() {
    if (!window.confirm("Delete this employee? This will also remove their absences.")) return;
    const { error } = await supabase.from("employee").delete().eq("id", id);
    if (error) return alert(error.message);
    navigate("/employees");
  }

  async function deleteAbsence(absId) {
    if (!window.confirm("Delete this absence?")) return;
    const { error } = await supabase.from("absence").delete().eq("id", absId);
    if (error) return alert(error.message);
    const { data: a } = await supabase
      .from("absence").select("*").eq("employee_id", id).order("start_date", { ascending: false });
    setAbsences(a || []);
  }

  if (loading) return <div>Loading…</div>;
  if (!emp) return <div>Not found</div>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">{emp.first_name} {emp.last_name}</h1>
          <div className="text-gray-600">{emp.email} — {emp.base || "—"} / {emp.department || "—"}</div>
          <div className="text-sm text-gray-500">Status: <span className="font-medium">{emp.status}</span>{emp.role_code ? ` • Role: ${emp.role_code}` : ""}</div>
        </div>
        <div className="flex gap-2">
          {!editing ? (
            <Button onClick={() => setEditing(true)}>Edit Employee</Button>
          ) : (
            <Button variant="outline" onClick={() => { setEditing(false); setEditForm({
              first_name: emp.first_name || "", last_name: emp.last_name || "", email: emp.email || "",
              base: emp.base || "", department: emp.department || "", role_code: emp.role_code || "",
              hire_date: emp.hire_date || "", status: emp.status || "active", manager_email: emp.manager_email || "",
            }); }}>Cancel</Button>
          )}
          <Button variant="danger" onClick={deleteEmployee}>Delete</Button>
        </div>
      </div>

      {/* Edit employee */}
      {editing && (
        <Card title="Edit Employee">
          <form onSubmit={saveEmployee} className="grid md:grid-cols-3 gap-3">
            <Field label="First name"><Input value={editForm.first_name} onChange={e=>setEditForm(f=>({...f,first_name:e.target.value}))} /></Field>
            <Field label="Last name"><Input value={editForm.last_name} onChange={e=>setEditForm(f=>({...f,last_name:e.target.value}))} /></Field>
            <Field label="Email"><Input value={editForm.email} onChange={e=>setEditForm(f=>({...f,email:e.target.value}))} /></Field>
            <Field label="Base"><Input value={editForm.base} onChange={e=>setEditForm(f=>({...f,base:e.target.value}))} /></Field>
            <Field label="Department"><Input value={editForm.department} onChange={e=>setEditForm(f=>({...f,department:e.target.value}))} /></Field>
            <Field label="Role code"><Input value={editForm.role_code} onChange={e=>setEditForm(f=>({...f,role_code:e.target.value}))} /></Field>
            <Field label="Hire date"><Input type="date" value={editForm.hire_date || ""} onChange={e=>setEditForm(f=>({...f,hire_date:e.target.value}))} /></Field>
            <Field label="Status">
              <Select value={editForm.status} onChange={e=>setEditForm(f=>({...f,status:e.target.value}))}>
                <option value="active">Active</option>
                <option value="leave">Leave</option>
                <option value="terminated">Terminated</option>
              </Select>
            </Field>
            <Field label="Manager email"><Input value={editForm.manager_email} onChange={e=>setEditForm(f=>({...f,manager_email:e.target.value}))} /></Field>
            <div className="md:col-span-3"><Button type="submit">Save Changes</Button></div>
          </form>
        </Card>
      )}

      {/* Add absence */}
      <Card title="Add Absence">
        <div className="grid md:grid-cols-4 gap-3">
          <Field label="Start date"><Input type="date" value={form.start_date} onChange={e=>setForm(f=>({...f,start_date:e.target.value}))} /></Field>
          <Field label="End date"><Input type="date" value={form.end_date} onChange={e=>setForm(f=>({...f,end_date:e.target.value}))} /></Field>
          <Field label="Reason">
            <Select value={form.reason_code} onChange={e=>setForm(f=>({...f,reason_code:e.target.value}))}>
              {reasons.map(r => <option key={r.code} value={r.code}>{r.code}</option>)}
            </Select>
          </Field>
          <Field label="Notes"><Input value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} /></Field>
        </div>
        <div className="mt-3"><Button onClick={addAbsence}>Save Absence</Button></div>
      </Card>

      {/* Absence history */}
      <Card title="Absence History">
        {absences.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">No absences recorded for this employee.</div>
        ) : (
          <Table head={["Start","End","Reason","Notes",""]}>
            {absences.map(a => (
              <tr key={a.id}>
                <td className="p-3">{a.start_date}</td>
                <td className="p-3">{a.end_date}</td>
                <td className="p-3">{a.reason_code}</td>
                <td className="p-3">{a.notes || ""}</td>
                <td className="p-3 text-right">
                  <Button variant="danger" onClick={() => deleteAbsence(a.id)}>Delete</Button>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
