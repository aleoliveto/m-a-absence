import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import './index.css'
import Dashboard from './pages/Dashboard.jsx'
import Employees from './pages/Employees.jsx'
import EmployeeDetail from './pages/EmployeeDetail.jsx'
import Absences from './pages/Absences.jsx'

function Layout(){
  const linkBase = 'px-3 py-2 rounded-lg text-sm font-medium transition-colors'
  const active = 'bg-white text-orange-700 shadow'
  const idle = 'text-white/90 hover:bg-white/10'
  return (
    <div className="min-h-screen">
      <header className="bg-orange-600 text-white">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-6">
          <div className="text-lg font-bold tracking-tight">Absence Tracker</div>
          <nav className="flex gap-2">
            <NavLink to="/" end className={({isActive}) => `${linkBase} ${isActive?active:idle}`}>Dashboard</NavLink>
            <NavLink to="/employees" className={({isActive}) => `${linkBase} ${isActive?active:idle}`}>Employees</NavLink>
            <NavLink to="/absences" className={({isActive}) => `${linkBase} ${isActive?active:idle}`}>Absences</NavLink>
          </nav>
        </div>
      </header>
      <main className="max-w-6xl mx-auto p-4 space-y-6">
        <Routes>
          <Route path="/" element={<Dashboard/>}/>
          <Route path="/employees" element={<Employees/>}/>
          <Route path="/employees/:id" element={<EmployeeDetail/>}/>
          <Route path="/absences" element={<Absences/>}/>
        </Routes>
        <footer className="py-6 text-center text-xs text-gray-500">
          © {new Date().getFullYear()} Absence Tracker
        </footer>
      </main>
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
