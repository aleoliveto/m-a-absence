export function exportCsv(filename, rows) {
  if (!rows || !rows.length) return;
  const head = Object.keys(rows[0]);
  const csv = [
    head.join(","),
    ...rows.map((r) =>
      head
        .map((k) => {
          const v = r[k] ?? "";
          return `"${String(v).replace(/"/g, '""')}"`;
        })
        .join(",")
    ),
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 500);
}
