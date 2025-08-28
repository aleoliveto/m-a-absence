import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { exportCsv } from "../lib/exportCsv";

const iso = (d) => new Date(d).toISOString().slice(0, 10);

export default function Absences() {
  const [rows, setRows] = useState([]);
  const [bases, setBases] = useState([]);
  const [depts, setDepts] = useState([]);
  const [reasons, setReasons] = useState([]);

  const [filters, setFilters] = useState(() => {
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 86400000);
    return { base: "", dept: "", from: iso(from), to: iso(to), q: "" };
  });

  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({
    start_date: "",
    end_date: "",
    reason_code: "",
    notes: "",
  });

  useEffect(() => {
    (async () => {
      // Filter lists
      const { data: emps } = await supabase
        .from("employee")
        .select("id,base,department")
        .eq("status", "active");
      setBases(
        [...new Set((emps || []).map((e) => e.base).filter(Boolean))].sort()
      );
      setDepts(
        [...new Set((emps || []).map((e) => e.department).filter(Boolean))].sort()
      );

      // Reason list
      const { data: rs } = await supabase
        .from("absence_reason")
        .select("code,label")
        .order("label", { ascending: true });
      setReasons(rs || []);
    })();
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line
  }, [filters.from, filters.to]);

  async function load() {
    const { data } = await supabase
      .from("absence")
      .select(
        "id,start_date,end_date,reason_code,notes,employee:employee_id ( id, first_name, last_name, email, base, department )"
      )
      .gte("start_date", filters.from)
      .lte("end_date", filters.to)
      .order("start_date", { ascending: false });
    setRows(data || []);
  }

  const view = useMemo(() => {
    return (rows || []).filter((r) => {
      const matchBase = !filters.base || r.employee?.base === filters.base;
      const matchDept = !filters.dept || r.employee?.department === filters.dept;
      const q = filters.q.trim().toLowerCase();
      const matchQ =
        !q ||
        `${r.employee?.first_name || ""} ${r.employee?.last_name || ""}`
          .toLowerCase()
          .includes(q) ||
        (r.employee?.email || "").toLowerCase().includes(q);
      return matchBase && matchDept && matchQ;
    });
  }, [rows, filters]);

  function startEdit(r) {
    setEditingId(r.id);
    setEditForm({
      start_date: r.start_date,
      end_date: r.end_date,
      reason_code: r.reason_code,
      notes: r.notes || "",
    });
  }
  function cancelEdit() {
    setEditingId(null);
  }
  async function saveEdit(id) {
    if (!editForm.start_date || !editForm.end_date)
      return alert("Start and end dates are required");
    if (editForm.end_date < editForm.start_date)
      return alert("End date must be after start date");
    const { error } = await supabase
      .from("absence")
      .update(editForm)
      .eq("id", id);
    if (error) return alert(error.message);
    cancelEdit();
    load();
  }
  async function remove(id) {
    const ok = window.confirm("Delete this absence record?");
    if (!ok) return;
    const { error } = await supabase.from("absence").delete().eq("id", id);
    if (error) return alert(error.message);
    load();
  }

  function exportCurrent() {
    exportCsv(
      `absences_${filters.from}_${filters.to}.csv`,
      view.map((r) => ({
        start_date: r.start_date,
        end_date: r.end_date,
        reason_code: r.reason_code,
        notes: r.notes || "",
        first_name: r.employee?.first_name,
        last_name: r.employee?.last_name,
        email: r.employee?.email,
        base: r.employee?.base,
        department: r.employee?.department,
      }))
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Absences</h1>
        <div className="flex gap-2">
          <button onClick={exportCurrent} className="border px-3 py-2 rounded">
            Export CSV
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded shadow p-4">
        <div className="grid md:grid-cols-6 gap-3">
          <div>
            <label className="block text-sm text-gray-600 mb-1">Base</label>
            <select
              className="border rounded px-3 py-2 w-full"
              value={filters.base}
              onChange={(e) => setFilters((f) => ({ ...f, base: e.target.value }))}
            >
              <option value="">All</option>
              {bases.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Department</label>
            <select
              className="border rounded px-3 py-2 w-full"
              value={filters.dept}
              onChange={(e) => setFilters((f) => ({ ...f, dept: e.target.value }))}
            >
              <option value="">All</option>
              {depts.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">From</label>
            <input
              type="date"
              className="border rounded px-3 py-2 w-full"
              value={filters.from}
              onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">To</label>
            <input
              type="date"
              className="border rounded px-3 py-2 w-full"
              value={filters.to}
              onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm text-gray-600 mb-1">Search</label>
            <input
              className="border rounded px-3 py-2 w-full"
              placeholder="Name or email…"
              value={filters.q}
              onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded shadow overflow-auto">
        <table className="min-w-full">
          <thead>
            <tr className="text-left text-sm text-gray-600">
              <th className="p-3">Employee</th>
              <th className="p-3">Base</th>
              <th className="p-3">Dept</th>
              <th className="p-3">Start</th>
              <th className="p-3">End</th>
              <th className="p-3">Reason</th>
              <th className="p-3">Notes</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {view.map((r) =>
              editingId === r.id ? (
                <tr key={r.id} className="border-t bg-orange-50">
                  <td className="p-3">
                    {r.employee?.first_name} {r.employee?.last_name}
                    <div className="text-xs text-gray-500">{r.employee?.email}</div>
                  </td>
                  <td className="p-3">{r.employee?.base}</td>
                  <td className="p-3">{r.employee?.department}</td>
                  <td className="p-3">
                    <input
                      type="date"
                      value={editForm.start_date}
                      onChange={(e) =>
                        setEditForm((f) => ({ ...f, start_date: e.target.value }))
                      }
                      className="border rounded px-2 py-1"
                    />
                  </td>
                  <td className="p-3">
                    <input
                      type="date"
                      value={editForm.end_date}
                      onChange={(e) =>
                        setEditForm((f) => ({ ...f, end_date: e.target.value }))
                      }
                      className="border rounded px-2 py-1"
                    />
                  </td>
                  <td className="p-3">
                    <select
                      value={editForm.reason_code}
                      onChange={(e) =>
                        setEditForm((f) => ({ ...f, reason_code: e.target.value }))
                      }
                      className="border rounded px-2 py-1"
                    >
                      {reasons.map((x) => (
                        <option key={x.code} value={x.code}>
                          {x.code}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="p-3">
                    <input
                      value={editForm.notes}
                      onChange={(e) =>
                        setEditForm((f) => ({ ...f, notes: e.target.value }))
                      }
                      className="border rounded px-2 py-1 w-full"
                    />
                  </td>
                  <td className="p-3 whitespace-nowrap">
                    <button
                      onClick={() => saveEdit(r.id)}
                      className="bg-green-600 text-white px-3 py-1 rounded mr-2"
                    >
                      Save
                    </button>
                    <button onClick={cancelEdit} className="border px-3 py-1 rounded">
                      Cancel
                    </button>
                  </td>
                </tr>
              ) : (
                <tr key={r.id} className="border-t">
                  <td className="p-3">
                    {r.employee?.first_name} {r.employee?.last_name}
                    <div className="text-xs text-gray-500">{r.employee?.email}</div>
                  </td>
                  <td className="p-3">{r.employee?.base}</td>
                  <td className="p-3">{r.employee?.department}</td>
                  <td className="p-3">{r.start_date}</td>
                  <td className="p-3">{r.end_date}</td>
                  <td className="p-3">{r.reason_code}</td>
                  <td className="p-3">{r.notes || ""}</td>
                  <td className="p-3 whitespace-nowrap">
                    <button
                      onClick={() => startEdit(r)}
                      className="border px-3 py-1 rounded mr-2"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => remove(r.id)}
                      className="bg-red-600 text-white px-3 py-1 rounded"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
