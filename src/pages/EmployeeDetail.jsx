import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function EmployeeDetail(){
  const { id } = useParams()
  const [emp, setEmp] = useState(null)
  const [absences, setAbsences] = useState([])
  const [form, setForm] = useState({ start_date:'', end_date:'', reason_code:'SICK', notes:'' })

  useEffect(()=>{ (async ()=>{
    const { data: e } = await supabase.from('employee').select('*').eq('id', id).single()
    setEmp(e)
    const { data: a } = await supabase.from('absence').select('*').eq('employee_id', id).order('start_date', { ascending:false })
    setAbsences(a||[])
  })() }, [id])

  async function addAbsence(){
    if(!form.start_date || !form.end_date) return alert('Enter start and end dates')
    if(form.end_date < form.start_date) return alert('End date must be after start')
    const { error } = await supabase.from('absence').insert([{ employee_id: id, ...form, created_by: 'admin@app' }])
    if(error){ alert(error.message); return }
    const { data: a } = await supabase.from('absence').select('*').eq('employee_id', id).order('start_date', { ascending:false })
    setAbsences(a||[])
    setForm({ start_date:'', end_date:'', reason_code:'SICK', notes:'' })
  }

  if(!emp) return <div>Loading…</div>
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">{emp.first_name} {emp.last_name}</h1>
          <div className="text-gray-600">{emp.email} — {emp.base} / {emp.department}</div>
        </div>
      </div>

      <div className="bg-white rounded shadow p-4">
        <div className="font-semibold mb-3">Add Absence</div>
        <div className="grid md:grid-cols-4 gap-3">
          <input type="date" value={form.start_date} onChange={e=>setForm(f=>({...f,start_date:e.target.value}))} className="border rounded px-3 py-2"/>
          <input type="date" value={form.end_date} onChange={e=>setForm(f=>({...f,end_date:e.target.value}))} className="border rounded px-3 py-2"/>
          <select value={form.reason_code} onChange={e=>setForm(f=>({...f,reason_code:e.target.value}))} className="border rounded px-3 py-2">
            <option value="SICK">SICK</option>
            <option value="STRESS">STRESS</option>
            <option value="MED_APPT">MED_APPT</option>
            <option value="FAMILY">FAMILY</option>
            <option value="BEREAVE">BEREAVE</option>
            <option value="UNAUTH">UNAUTH</option>
            <option value="OTHER">OTHER</option>
          </select>
          <input placeholder="Notes" value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} className="border rounded px-3 py-2"/>
        </div>
        <div className="mt-3">
          <button onClick={addAbsence} className="bg-orange-600 text-white px-4 py-2 rounded">Save</button>
        </div>
      </div>

      <div className="bg-white rounded shadow overflow-auto">
        <table className="min-w-full">
          <thead><tr className="text-left text-sm text-gray-600">
            <th className="p-3">Start</th><th className="p-3">End</th><th className="p-3">Reason</th><th className="p-3">Notes</th>
          </tr></thead>
          <tbody>
            {absences.map(a=>(
              <tr key={a.id} className="border-t">
                <td className="p-3">{a.start_date}</td>
                <td className="p-3">{a.end_date}</td>
                <td className="p-3">{a.reason_code}</td>
                <td className="p-3">{a.notes||''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
