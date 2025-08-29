

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Card, Button, Field, Input, Select, Table, Badge, toast } from "../components/ui";

export default function ShiftTemplate(){
  const empty = {
    id: null,
    name: "",
    start_time: "08:00",
    end_time: "16:00",
    role_code: "",
    base: "",
    department: "",
    min_staff: 1,
    max_staff: 1,
    notes: ""
  };
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(empty);
  const [loading, setLoading] = useState(false);

  async function load(){
    const { data, error } = await supabase
      .from("shift_template")
      .select("*")
      .order("name", { ascending: true });
    if (error) { toast(error.message, "danger"); return; }
    setItems(data||[]);
  }
  useEffect(()=>{ load(); },[]);

  function reset(){ setForm(empty); }

  async function save(e){
    e.preventDefault();
    setLoading(true);
    const payload = {
      name: form.name?.trim(),
      start_time: form.start_time, end_time: form.end_time,
      role_code: form.role_code?.trim() || null,
      base: form.base?.trim() || null,
      department: form.department?.trim() || null,
      min_staff: Number(form.min_staff||1),
      max_staff: Number(form.max_staff||1),
      notes: form.notes?.trim() || null
    };
    let error;
    if (form.id){
      ({ error } = await supabase.from("shift_template").update(payload).eq("id", form.id));
    } else {
      ({ error } = await supabase.from("shift_template").insert([payload]));
    }
    setLoading(false);
    if (error) return toast(error.message, "danger");
    toast(form.id ? "Template updated" : "Template added", "success");
    reset();
    load();
  }

  async function edit(id){
    const t = items.find(x=>x.id===id);
    if (!t) return;
    setForm({
      id: t.id,
      name: t.name||"",
      start_time: t.start_time||"08:00",
      end_time: t.end_time||"16:00",
      role_code: t.role_code||"",
      base: t.base||"",
      department: t.department||"",
      min_staff: t.min_staff||1,
      max_staff: t.max_staff||1,
      notes: t.notes||""
    });
  }

  async function remove(id){
    if (!window.confirm("Delete this template?")) return;
    const { error } = await supabase.from("shift_template").delete().eq("id", id);
    if (error) return toast(error.message, "danger");
    toast("Template deleted", "success");
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Shift Templates</h1>
      </div>
      <div className="text-sm text-gray-600">Create reusable shift definitions (time, role, min/max) and apply them when creating new shifts in the roster.</div>

      <Card title={form.id ? "Edit template" : "New template"}>
        <form onSubmit={save} className="grid md:grid-cols-8 gap-3">
          <Field label="Name" className="md:col-span-2"><Input value={form.name} onChange={e=>setForm(f=>({...f, name:e.target.value}))} required/></Field>
          <Field label="Start"><Input type="time" value={form.start_time} onChange={e=>setForm(f=>({...f, start_time:e.target.value}))} required/></Field>
          <Field label="End"><Input type="time" value={form.end_time} onChange={e=>setForm(f=>({...f, end_time:e.target.value}))} required/></Field>
          <Field label="Role"><Input value={form.role_code} onChange={e=>setForm(f=>({...f, role_code:e.target.value}))}/></Field>
          <Field label="Team"><Input value={form.base} onChange={e=>setForm(f=>({...f, base:e.target.value}))}/></Field>
          <Field label="Dept"><Input value={form.department} onChange={e=>setForm(f=>({...f, department:e.target.value}))}/></Field>
          <Field label="Min / Max" className="md:col-span-2">
            <div className="flex gap-2">
              <Input type="number" min="1" value={form.min_staff} onChange={e=>setForm(f=>({...f, min_staff:e.target.value}))}/>
              <Input type="number" min="1" value={form.max_staff} onChange={e=>setForm(f=>({...f, max_staff:e.target.value}))}/>
            </div>
          </Field>
          <Field label="Notes" className="md:col-span-6"><Input value={form.notes} onChange={e=>setForm(f=>({...f, notes:e.target.value}))}/></Field>
          <div className="md:col-span-8 flex gap-2">
            <Button type="submit" disabled={loading}>{loading? 'Saving…':'Save template'}</Button>
            {form.id && <Button variant="outline" type="button" onClick={reset}>Cancel edit</Button>}
          </div>
        </form>
      </Card>

      <Card title="Templates">
        {items.length === 0 ? (
          <div className="text-sm text-gray-500">No templates yet.</div>
        ) : (
          <Table head={["Name","Time","Role","Team/Dept","Min/Max","Notes","Actions"]}>
            {items.map(t=> (
              <tr key={t.id}>
                <td className="p-3 font-medium">{t.name}</td>
                <td className="p-3">{t.start_time}–{t.end_time}</td>
                <td className="p-3">{t.role_code || '—'}</td>
                <td className="p-3">{t.base || '—'} / {t.department || '—'}</td>
                <td className="p-3">{t.min_staff}/{t.max_staff}</td>
                <td className="p-3">{t.notes || '—'}</td>
                <td className="p-3 whitespace-nowrap flex gap-2">
                  <Button variant="outline" onClick={()=>edit(t.id)}>Edit</Button>
                  <Button variant="danger" onClick={()=>remove(t.id)}>Delete</Button>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}