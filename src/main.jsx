import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import './index.css'
import Dashboard from './pages/Dashboard.jsx'
import Employees from './pages/Employees.jsx'
import EmployeeDetail from './pages/EmployeeDetail.jsx'
import Absences from './pages/Absences.jsx'
import Settings from './pages/Settings.jsx'
import Roster from './pages/Roster.jsx'
import ShiftTemplate from './pages/ShiftTemplate.jsx'
import { Toaster } from './components/ui'

function Layout(){
  const linkBase = 'px-3 py-2 rounded-lg text-sm font-medium transition-colors'
  const active = 'bg-white text-orange-700 shadow'
  const idle = 'text-white/90 hover:bg-white/10'
  const [role, setRole] = useState(() => localStorage.getItem('app:role') || 'manager');
  useEffect(() => {
    localStorage.setItem('app:role', role);
    window.appRole = role;
    window.dispatchEvent(new Event('app:role'));
  }, [role]);

  const canSee = {
    manager: { dashboard:true, employees:true, absences:true, roster:true, templates:true, settings:true },
    senior:  { dashboard:false, employees:false, absences:false, roster:true, templates:false, settings:false },
    officer: { dashboard:false, employees:false, absences:false, roster:true, templates:false, settings:false }
  }[role] || { roster:true };
  return (
    <div className="min-h-screen">
      <header className="bg-orange-600 text-white sticky top-0 z-40 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-white/20 flex items-center justify-center font-bold">AT</div>
            <div className="text-lg font-bold tracking-tight">Absence Tracker</div>
          </div>
          <nav className="flex gap-2">
            {canSee.dashboard && (
              <NavLink to="/" end className={({isActive}) => `${linkBase} ${isActive?active:idle}`}>Dashboard</NavLink>
            )}
            {canSee.employees && (
              <NavLink to="/employees" className={({isActive}) => `${linkBase} ${isActive?active:idle}`}>Employees</NavLink>
            )}
            {canSee.absences && (
              <NavLink to="/absences" className={({isActive}) => `${linkBase} ${isActive?active:idle}`}>Absences</NavLink>
            )}
            {canSee.roster && (
              <NavLink to="/roster" className={({isActive}) => `${linkBase} ${isActive?active:idle}`}>Roster</NavLink>
            )}
            {canSee.templates && (
              <NavLink to="/templates" className={({isActive}) => `${linkBase} ${isActive?active:idle}`}>Templates</NavLink>
            )}
            {canSee.settings && (
              <NavLink to="/settings" className={({isActive}) => `${linkBase} ${isActive?active:idle}`}>Settings</NavLink>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <label className="text-sm text-white/90 flex items-center gap-2">
              Role:
              <select
                value={role}
                onChange={(e)=> setRole(e.target.value)}
                className="bg-white/10 text-white px-2 py-1 rounded border border-white/20"
                title="Switch role (simulated)"
              >
                <option value="manager">Manager</option>
                <option value="senior">Senior</option>
                <option value="officer">Officer</option>
              </select>
            </label>
            <button
              onClick={() => { document.body.classList.toggle('dense'); }}
              className="px-3 py-1.5 rounded-lg text-sm bg-white/10 hover:bg-white/20"
              title="Toggle compact mode"
            >
              Compact
            </button>
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto p-4 space-y-6">
        <Routes>
          {canSee.dashboard && <Route path="/" element={<Dashboard/>}/>} 
          {canSee.employees && <Route path="/employees" element={<Employees/>}/>} 
          {canSee.employees && <Route path="/employees/:id" element={<EmployeeDetail/>}/>} 
          {canSee.absences && <Route path="/absences" element={<Absences/>}/>} 
          {canSee.roster && <Route path="/roster" element={<Roster/>}/>} 
          {canSee.templates && <Route path="/templates" element={<ShiftTemplate/>}/>} 
          {canSee.settings && <Route path="/settings" element={<Settings/>}/>} 
          {!canSee.dashboard && <Route path="/" element={<div className="p-6 text-sm text-gray-600">Not authorized</div>} />}
          {!canSee.employees && <Route path="/employees" element={<div className="p-6 text-sm text-gray-600">Not authorized</div>} />}
          {!canSee.employees && <Route path="/employees/:id" element={<div className="p-6 text-sm text-gray-600">Not authorized</div>} />}
          {!canSee.absences && <Route path="/absences" element={<div className="p-6 text-sm text-gray-600">Not authorized</div>} />}
          {!canSee.templates && <Route path="/templates" element={<div className="p-6 text-sm text-gray-600">Not authorized</div>} />}
          {!canSee.settings && <Route path="/settings" element={<div className="p-6 text-sm text-gray-600">Not authorized</div>} />}
        </Routes>
        <footer className="py-6 text-center text-xs text-gray-500">
          © {new Date().getFullYear()} Absence Tracker
        </footer>
      </main>
      <Toaster />
    </div>
  )
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Layout/>
    </BrowserRouter>
  </React.StrictMode>
)
