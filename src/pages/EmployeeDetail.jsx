import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function EmployeeDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [emp, setEmp] = useState(null);
  const [absences, setAbsences] = useState([]);
  const [loading, setLoading] = useState(true);

  // edit mode
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    first_name: "",
    last_name: "",
    email: "",
    base: "",
    department: "",
    role_code: "",
    hire_date: "",
    status: "active",
    manager_email: "",
  });

  // add-absence form
  const [form, setForm] = useState({
    start_date: "",
    end_date: "",
    reason_code: "SICK",
    notes: "",
  });

  useEffect(() => {
    load();
    // eslint-disable-next-line
  }, [id]);

  async function load() {
    setLoading(true);
    const { data: e, error: eErr } = await supabase
      .from("employee")
      .select("*")
      .eq("id", id)
      .single();

    if (eErr) {
      alert(eErr.message);
      setLoading(false);
      return;
    }
    setEmp(e);
    setEditForm({
      first_name: e.first_name || "",
      last_name: e.last_name || "",
      email: e.email || "",
      base: e.base || "",
      department: e.department || "",
      role_code: e.role_code || "",
      hire_date: e.hire_date || "",
      status: e.status || "active",
      manager_email: e.manager_email || "",
    });

    const { data: a, error: aErr } = await supabase
      .from("absence")
      .select("*")
      .eq("employee_id", id)
      .order("start_date", { ascending: false });

    if (aErr) alert(aErr.message);
    setAbsences(a || []);
    setLoading(false);
  }

  async function addAbsence() {
    if (!form.start_date || !form.end_date)
      return alert("Enter start and end dates");
    if (form.end_date < form.start_date)
      return alert("End date must be after start");

    const { error } = await supabase
      .from("absence")
      .insert([{ employee_id: id, ...form, created_by: "admin@app" }]);

    if (error) return alert(error.message);
    setForm({ start_date: "", end_date: "", reason_code: "SICK", notes: "" });
    load();
  }

  async function saveEmployee(e) {
    e.preventDefault();
    if (!editForm.first_name || !editForm.last_name || !editForm.email) {
      return alert("First name, Last name and Email are required");
    }
    const { error } = await supabase
      .from("employee")
      .update(editForm)
      .eq("id", id);

    if (error) return alert(error.message);
    setEditing(false);
    load();
  }

  async function deleteEmployee() {
    const ok = window.confirm(
      "Delete this employee? This will also remove their absences."
    );
    if (!ok) return;
    const { error } = await supabase.from("employee").delete().eq("id", id);
    if (error) return alert(error.message);
    navigate("/employees");
  }

  if (loading) return <div>Loading…</div>;
  if (!emp) return <div>Not found</div>;

  return (
    <div className="space-y-6">
      {/* Header + actions */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">
            {emp.first_name} {emp.last_name}
          </h1>
          <div className="text-gray-600">
            {emp.email} — {emp.base || "—"} / {emp.department || "—"}
          </div>
        </div>
        <div className="flex gap-2">
          {!editing ? (
            <button
              onClick={() => setEditing(true)}
              className="bg-blue-600 text-white px-4 py-2 rounded"
            >
              Edit Employee
            </button>
          ) : (
            <button
              onClick={() => {
                setEditing(false);
                setEditForm({
                  first_name: emp.first_name || "",
                  last_name: emp.last_name || "",
                  email: emp.email || "",
                  base: emp.base || "",
                  department: emp.department || "",
                  role_code: emp.role_code || "",
                  hire_date: emp.hire_date || "",
                  status: emp.status || "active",
                  manager_email: emp.manager_email || "",
                });
              }}
              className="px-4 py-2 rounded border"
            >
              Cancel
            </button>
          )}
          <button
            onClick={deleteEmployee}
            className="bg-red-600 text-white px-4 py-2 rounded"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Edit form */}
      {editing && (
        <form
          onSubmit={saveEmployee}
          className="bg-white rounded shadow p-4 space-y-3"
        >
          <div className="grid md:grid-cols-3 gap-3">
            <input
              placeholder="First name"
              value={editForm.first_name}
              onChange={(e) =>
                setEditForm((f) => ({ ...f, first_name: e.target.value }))
              }
              className="border rounded px-3 py-2"
            />
            <input
              placeholder="Last name"
              value={editForm.last_name}
              onChange={(e) =>
                setEditForm((f) => ({ ...f, last_name: e.target.value }))
              }
              className="border rounded px-3 py-2"
            />
            <input
              placeholder="Email"
              value={editForm.email}
              onChange={(e) =>
                setEditForm((f) => ({ ...f, email: e.target.value }))
              }
              className="border rounded px-3 py-2"
            />
            <input
              placeholder="Base (e.g. LTN)"
              value={editForm.base}
              onChange={(e) =>
                setEditForm((f) => ({ ...f, base: e.target.value }))
              }
              className="border rounded px-3 py-2"
            />
            <input
              placeholder="Department"
              value={editForm.department}
              onChange={(e) =>
                setEditForm((f) => ({ ...f, department: e.target.value }))
              }
              className="border rounded px-3 py-2"
            />
            <input
              placeholder="Role code"
              value={editForm.role_code}
              onChange={(e) =>
                setEditForm((f) => ({ ...f, role_code: e.target.value }))
              }
              className="border rounded px-3 py-2"
            />
            <input
              type="date"
              value={editForm.hire_date || ""}
              onChange={(e) =>
                setEditForm((f) => ({ ...f, hire_date: e.target.value }))
              }
              className="border rounded px-3 py-2"
            />
            <select
              value={editForm.status}
              onChange={(e) =>
                setEditForm((f) => ({ ...f, status: e.target.value }))
              }
              className="border rounded px-3 py-2"
            >
              <option value="active">Active</option>
              <option value="leave">Leave</option>
              <option value="terminated">Terminated</option>
            </select>
            <input
              placeholder="Manager email"
              value={editForm.manager_email}
              onChange={(e) =>
                setEditForm((f) => ({ ...f, manager_email: e.target.value }))
              }
              className="border rounded px-3 py-2"
            />
          </div>
          <button
            type="submit"
            className="bg-green-600 text-white px-4 py-2 rounded"
          >
            Save Changes
          </button>
        </form>
      )}

      {/* Add Absence */}
      <div className="bg-white rounded shadow p-4">
        <div className="font-semibold mb-3">Add Absence</div>
        <div className="grid md:grid-cols-4 gap-3">
          <input
            type="date"
            value={form.start_date}
            onChange={(e) =>
              setForm((f) => ({ ...f, start_date: e.target.value }))
            }
            className="border rounded px-3 py-2"
          />
          <input
            type="date"
            value={form.end_date}
            onChange={(e) =>
              setForm((f) => ({ ...f, end_date: e.target.value }))
            }
            className="border rounded px-3 py-2"
          />
          <select
            value={form.reason_code}
            onChange={(e) =>
              setForm((f) => ({ ...f, reason_code: e.target.value }))
            }
            className="border rounded px-3 py-2"
          >
            <option value="SICK">SICK</option>
            <option value="STRESS">STRESS</option>
            <option value="MED_APPT">MED_APPT</option>
            <option value="FAMILY">FAMILY</option>
            <option value="BEREAVE">BEREAVEMENT</option>
            <option value="UNAUTH">UNAUTH</option>
            <option value="OTHER">OTHER</option>
          </select>
          <input
            placeholder="Notes"
            value={form.notes}
            onChange={(e) =>
              setForm((f) => ({ ...f, notes: e.target.value }))
            }
            className="border rounded px-3 py-2"
          />
        </div>
        <div className="mt-3">
          <button
            onClick={addAbsence}
            className="bg-orange-600 text-white px-4 py-2 rounded"
          >
            Save Absence
          </button>
        </div>
      </div>

      {/* Absence history */}
      <div className="bg-white rounded shadow overflow-auto">
        <table className="min-w-full">
          <thead>
            <tr className="text-left text-sm text-gray-600">
              <th className="p-3">Start</th>
              <th className="p-3">End</th>
              <th className="p-3">Reason</th>
              <th className="p-3">Notes</th>
            </tr>
          </thead>
          <tbody>
            {absences.map((a) => (
              <tr key={a.id} className="border-t">
                <td className="p-3">{a.start_date}</td>
                <td className="p-3">{a.end_date}</td>
                <td className="p-3">{a.reason_code}</td>
                <td className="p-3">{a.notes || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
