import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import './index.css'
import Dashboard from './pages/Dashboard.jsx'
import Employees from './pages/Employees.jsx'
import EmployeeDetail from './pages/EmployeeDetail.jsx'
import Absences from './pages/Absences.jsx'

function Layout(){
  const base = 'px-3 py-2 rounded transition-colors'
  return (
    <div className="min-h-screen">
      <header className="bg-orange-600 text-white">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-4">
          <div className="font-bold">Absence Tracker</div>
          <nav className="flex gap-2">
            <NavLink
              to="/"
              end
              className={({isActive}) =>
                isActive
                  ? `${base} bg-white text-orange-700 shadow-sm`
                  : `${base} text-white/90 hover:bg-white/10`
              }
            >
              Dashboard
            </NavLink>
            <NavLink
              to="/employees"
              className={({isActive}) =>
                isActive
                  ? `${base} bg-white text-orange-700 shadow-sm`
                  : `${base} text-white/90 hover:bg-white/10`
              }
            >
              Employees
            </NavLink>
            <NavLink
              to="/absences"
              className={({isActive}) =>
                isActive
                  ? `${base} bg-white text-orange-700 shadow-sm`
                  : `${base} text-white/90 hover:bg-white/10`
              }
            >
              Absences
            </NavLink>
          </nav>
        </div>
      </header>
      <main className="max-w-6xl mx-auto p-4">
        <Routes>
          <Route path="/" element={<Dashboard/>}/>
          <Route path="/employees" element={<Employees/>}/>
          <Route path="/employees/:id" element={<EmployeeDetail/>}/>
          <Route path="/absences" element={<Absences/>}/>
        </Routes>
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
