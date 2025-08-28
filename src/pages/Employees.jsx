import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function Employees(){
  const [rows, setRows] = useState([])
  const [q, setQ] = useState("")

  useEffect(()=>{ (async ()=>{
    const { data } = await supabase.from('employee').select('*').order('last_name', { ascending: true })
    setRows(data||[])
  })() }, [])

  const view = rows.filter(r => (r.first_name+' '+r.last_name).toLowerCase().includes(q.toLowerCase()) || (r.email||'').toLowerCase().includes(q.toLowerCase()))

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Employees</h1>
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search…" className="border rounded px-3 py-2"/>
      </div>
      <div className="bg-white rounded shadow overflow-auto">
        <table className="min-w-full">
          <thead><tr className="text-left text-sm text-gray-600">
            <th className="p-3">Name</th><th className="p-3">Email</th><th className="p-3">Base</th><th className="p-3">Dept</th>
          </tr></thead>
          <tbody>
            {view.map(e=>(
              <tr key={e.id} className="border-t">
                <td className="p-3"><Link to={`/employees/${e.id}`} className="text-blue-600 hover:underline">{e.first_name} {e.last_name}</Link></td>
                <td className="p-3">{e.email}</td>
                <td className="p-3">{e.base}</td>
                <td className="p-3">{e.department}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
