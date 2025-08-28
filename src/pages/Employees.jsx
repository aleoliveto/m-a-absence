import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function Employees() {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    email: "",
    base: "",
    department: "",
    role_code: "",
    hire_date: "",
    status: "active",
  });

  // Load employees
  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data } = await supabase
      .from("employee")
      .select("*")
      .order("last_name", { ascending: true });
    setRows(data || []);
  }

  async function addEmployee(e) {
    e.preventDefault();
    if (!form.email || !form.first_name || !form.last_name) {
      alert("First name, Last name and Email are required");
      return;
    }
    const { error } = await supabase.from("employee").insert([form]);
    if (error) {
      alert(error.message);
      return;
    }
    setForm({
      first_name: "",
      last_name: "",
      email: "",
      base: "",
      department: "",
      role_code: "",
      hire_date: "",
      status: "active",
    });
    setShowForm(false);
    load();
  }

  const view = rows.filter(
    (r) =>
      (r.first_name + " " + r.last_name)
        .toLowerCase()
        .includes(q.toLowerCase()) ||
      (r.email || "").toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Employees</h1>
        <div className="flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            className="border rounded px-3 py-2"
          />
          <button
            onClick={() => setShowForm((s) => !s)}
            className="bg-orange-600 text-white px-3 py-2 rounded"
          >
            {showForm ? "Cancel" : "+ Add Employee"}
          </button>
        </div>
      </div>

      {/* Add employee form */}
      {showForm && (
        <form
          onSubmit={addEmployee}
          className="bg-white rounded shadow p-4 space-y-3"
        >
          <div className="grid md:grid-cols-3 gap-3">
            <input
              placeholder="First name"
              value={form.first_name}
              onChange={(e) =>
                setForm((f) => ({ ...f, first_name: e.target.value }))
              }
              className="border rounded px-3 py-2"
            />
            <input
              placeholder="Last name"
              value={form.last_name}
              onChange={(e) =>
                setForm((f) => ({ ...f, last_name: e.target.value }))
              }
              className="border rounded px-3 py-2"
            />
            <input
              placeholder="Email"
              value={form.email}
              onChange={(e) =>
                setForm((f) => ({ ...f, email: e.target.value }))
              }
              className="border rounded px-3 py-2"
            />
            <input
              placeholder="Base (e.g. LTN)"
              value={form.base}
              onChange={(e) =>
                setForm((f) => ({ ...f, base: e.target.value }))
              }
              className="border rounded px-3 py-2"
            />
            <input
              placeholder="Department"
              value={form.department}
              onChange={(e) =>
                setForm((f) => ({ ...f, department: e.target.value }))
              }
              className="border rounded px-3 py-2"
            />
            <input
              placeholder="Role code"
              value={form.role_code}
              onChange={(e) =>
                setForm((f) => ({ ...f, role_code: e.target.value }))
              }
              className="border rounded px-3 py-2"
            />
            <input
              type="date"
              value={form.hire_date}
              onChange={(e) =>
                setForm((f) => ({ ...f, hire_date: e.target.value }))
              }
              className="border rounded px-3 py-2"
            />
            <select
              value={form.status}
              onChange={(e) =>
                setForm((f) => ({ ...f, status: e.target.value }))
              }
              className="border rounded px-3 py-2"
            >
              <option value="active">Active</option>
              <option value="leave">Leave</option>
              <option value="terminated">Terminated</option>
            </select>
          </div>
          <button
            type="submit"
            className="bg-green-600 text-white px-4 py-2 rounded"
          >
            Save Employee
          </button>
        </form>
      )}

      {/* Table of employees */}
      <div className="bg-white rounded shadow overflow-auto">
        <table className="min-w-full">
          <thead>
            <tr className="text-left text-sm text-gray-600">
              <th className="p-3">Name</th>
              <th className="p-3">Email</th>
              <th className="p-3">Base</th>
              <th className="p-3">Dept</th>
              <th className="p-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {view.map((e) => (
              <tr key={e.id} className="border-t">
                <td className="p-3">
                  <Link
                    to={`/employees/${e.id}`}
                    className="text-blue-600 hover:underline"
                  >
                    {e.first_name} {e.last_name}
                  </Link>
                </td>
                <td className="p-3">{e.email}</td>
                <td className="p-3">{e.base}</td>
                <td className="p-3">{e.department}</td>
                <td className="p-3">{e.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
