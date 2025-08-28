import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Dashboard(){
  const [kpi, setKpi] = useState({current:0, pct30:0, frequent:0})

  useEffect(()=>{
    const today = new Date().toISOString().slice(0,10)
    ;(async ()=>{
      const { data: current } = await supabase
        .from('absence')
        .select('id')
        .lte('start_date', today)
        .gte('end_date', today)

      const since = new Date(Date.now()-30*86400000).toISOString().slice(0,10)
      const [{ count: absCount }, { data: headcount }] = await Promise.all([
        supabase.from('absence').select('employee_id', { count: 'exact', head: true }).gte('start_date', since),
        supabase.from('employee').select('id').eq('status','active')
      ])
      const pct30 = headcount?.length ? Math.round(10000*(absCount||0)/headcount.length)/100 : 0

      const since90 = new Date(Date.now()-90*86400000).toISOString().slice(0,10)
      const { data: recent } = await supabase.from('absence').select('employee_id,start_date').gte('start_date', since90)
      const counts = recent?.reduce((a,r)=>{ a[r.employee_id]=(a[r.employee_id]||0)+1; return a; },{})||{}
      const frequent = Object.values(counts).filter(x=>x>=3).length

      setKpi({ current: current?.length||0, pct30, frequent })
    })()
  }, [])

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="bg-white p-4 rounded shadow">
        <div className="text-gray-600 text-sm">Current absentees</div>
        <div className="text-3xl font-bold">{kpi.current}</div>
      </div>
      <div className="bg-white p-4 rounded shadow">
        <div className="text-gray-600 text-sm">30-day absence %</div>
        <div className="text-3xl font-bold">{kpi.pct30}%</div>
      </div>
      <div className="bg-white p-4 rounded shadow">
        <div className="text-gray-600 text-sm">Frequent absentees (90d)</div>
        <div className="text-3xl font-bold">{kpi.frequent}</div>
      </div>
    </div>
  )
}
