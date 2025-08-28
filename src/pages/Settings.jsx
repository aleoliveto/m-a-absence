import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Card, Button, Field, Input, Table, toast } from "../components/ui";

export default function Settings(){
  const [settings, setSettings] = useState({ frequent_absences_threshold: 3, long_absence_days: 7 });
  const [reasons, setReasons] = useState([]);
  const [newReason, setNewReason] = useState({ code: "", label: "", reportable: true, paid: true });

  useEffect(()=>{ load(); }, []);

  async function load(){
    const { data: s } = await supabase.from("settings").select("*").eq("id",1).maybeSingle();
    if (s) setSettings(s);
    const { data: rs } = await supabase.from("absence_reason").select("*").order("label", { ascending: true });
    setReasons(rs || []);
  }

  async function saveThresholds(e){
    e.preventDefault();
    const payload = {
      frequent_absences_threshold: Number(settings.frequent_absences_threshold || 3),
      long_absence_days: Number(settings.long_absence_days || 7),
    };
    const { error } = await supabase.from("settings").upsert({ id:1, ...payload });
    if (error) return toast(error.message, "danger");
    toast("Thresholds saved", "success");
    load();
  }

  async function addReason(e){
    e.preventDefault();
    if (!newReason.code || !newReason.label) return toast("Code and label required", "warning");
    const { error } = await supabase.from("absence_reason").insert([newReason]);
    if (error) return toast(error.message, "danger");
    setNewReason({ code: "", label: "", reportable: true, paid: true });
    toast("Reason added", "success");
    load();
  }

  async function deleteReason(code){
    if (!window.confirm(`Delete reason ${code}?`)) return;
    const { error } = await supabase.from("absence_reason").delete().eq("code", code);
    if (error) return toast(error.message, "danger");
    toast("Reason deleted", "success");
    load();
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Settings</h1>

      <Card title="Thresholds">
        <form onSubmit={saveThresholds} className="grid md:grid-cols-3 gap-3">
          <Field label="Frequent absences threshold (events in 90 days)">
            <Input type="number" min="1" value={settings.frequent_absences_threshold}
              onChange={e=>setSettings(s=>({...s, frequent_absences_threshold: e.target.value}))}/>
          </Field>
          <Field label="Long absence (days)">
            <Input type="number" min="1" value={settings.long_absence_days}
              onChange={e=>setSettings(s=>({...s, long_absence_days: e.target.value}))}/>
          </Field>
          <div className="md:col-span-3">
            <Button type="submit">Save thresholds</Button>
          </div>
        </form>
      </Card>

      <Card title="Absence reasons">
        <form onSubmit={addReason} className="grid md:grid-cols-4 gap-3 mb-4">
          <Field label="Code"><Input placeholder="e.g. SICK" value={newReason.code}
            onChange={e=>setNewReason(r=>({...r, code: e.target.value.trim().toUpperCase()}))}/></Field>
          <Field label="Label"><Input placeholder="Sickness (short-term)" value={newReason.label}
            onChange={e=>setNewReason(r=>({...r, label: e.target.value}))}/></Field>
          <Field label="Reportable?">
            <select className="border rounded-lg px-3 py-2 w-full"
              value={newReason.reportable ? "true":"false"}
              onChange={e=>setNewReason(r=>({...r, reportable: e.target.value==="true"}))}>
              <option value="true">Yes</option><option value="false">No</option>
            </select>
          </Field>
          <Field label="Paid?">
            <select className="border rounded-lg px-3 py-2 w-full"
              value={newReason.paid ? "true":"false"}
              onChange={e=>setNewReason(r=>({...r, paid: e.target.value==="true"}))}>
              <option value="true">Yes</option><option value="false">No</option>
            </select>
          </Field>
          <div className="md:col-span-4"><Button type="submit">Add reason</Button></div>
        </form>

        <Table head={["Code","Label","Reportable","Paid",""]}>
          {reasons.map(r=>(
            <tr key={r.code}>
              <td className="p-3">{r.code}</td>
              <td className="p-3">{r.label}</td>
              <td className="p-3">{r.reportable ? "Yes":"No"}</td>
              <td className="p-3">{r.paid ? "Yes":"No"}</td>
              <td className="p-3 text-right">
                <Button variant="danger" onClick={()=>deleteReason(r.code)}>Delete</Button>
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
