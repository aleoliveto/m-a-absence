import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Absences(){
  const [rows, setRows] = useState([])

  useEffect(()=>{ (async ()=>{
    const { data } = await supabase.from('absence')
      .select('id, start_date, end_date, reason_code, notes, employee:employee_id ( first_name, last_name, email, base, department )')
      .order('start_date', { ascending: false })
    setRows(data||[])
  })() }, [])

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-bold">Absences</h1>
      <div className="bg-white rounded shadow overflow-auto">
        <table className="min-w-full">
          <thead><tr className="text-left text-sm text-gray-600">
            <th className="p-3">Employee</th><th className="p-3">Base</th><th className="p-3">Dept</th><th className="p-3">Start</th><th className="p-3">End</th><th className="p-3">Reason</th>
          </tr></thead>
          <tbody>
            {rows.map(r=>(
              <tr key={r.id} className="border-t">
                <td className="p-3">{r.employee?.first_name} {r.employee?.last_name}</td>
                <td className="p-3">{r.employee?.base}</td>
                <td className="p-3">{r.employee?.department}</td>
                <td className="p-3">{r.start_date}</td>
                <td className="p-3">{r.end_date}</td>
                <td className="p-3">{r.reason_code}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
