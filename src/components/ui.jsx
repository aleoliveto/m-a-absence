import React from "react";

// Minimal Tailwind UI primitives — no external deps
export function Card(props) {
  const { title, actions, children } = props;
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100">
      {(title || actions) ? (
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          {title && <h3 className="text-sm font-semibold text-gray-800">{title}</h3>}
          {actions}
        </div>
      ) : null}
      <div className="p-4">{children}</div>
    </div>
  );
}

export function Button({ variant="primary", className="", ...props }) {
  const base = "px-3 py-2 rounded-lg text-sm font-medium transition-colors";
  const styles = {
    primary: "bg-orange-600 text-white hover:bg-orange-700",
    outline: "border border-gray-300 hover:bg-gray-50",
    danger: "bg-red-600 text-white hover:bg-red-700",
    ghost: "text-gray-700 hover:bg-gray-100"
  };
  return <button className={`${base} ${styles[variant]} ${className}`} {...props} />;
}

export function Badge({ tone="default", children }) {
  const tones = {
    default: "bg-gray-100 text-gray-800",
    success: "bg-green-100 text-green-800",
    warning: "bg-yellow-100 text-yellow-800",
    danger: "bg-red-100 text-red-800",
    info: "bg-blue-100 text-blue-800",
  };
  return (
    <span className={`text-xs px-2 py-1 rounded-md ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function Field({ label, children }) {
  return (
    <label className="block">
      {label && <div className="text-xs text-gray-600 mb-1">{label}</div>}
      {children}
    </label>
  );
}

export function Input(props) {
  return (
    <input
      className="border rounded-lg px-3 py-2 w-full focus:outline-none focus:ring-2 focus:ring-orange-300"
      {...props}
    />
  );
}

export function Select(props) {
  return (
    <select
      className="border rounded-lg px-3 py-2 w-full focus:outline-none focus:ring-2 focus:ring-orange-300"
      {...props}
    />
  );
}

export function Table({ head, children }) {
  return (
    <div className="overflow-auto rounded-xl border border-gray-100">
      <table className="min-w-full text-sm">
        {head && (
          <thead className="bg-gray-50 text-gray-600 sticky top-0 z-10">
            <tr>
              {head.map((h, i) => (
                <th key={i} className="p-3 text-left font-medium">{h}</th>
              ))}
            </tr>
          </thead>
        )}
        <tbody className="[&>tr]:border-t [&>tr]:border-gray-100 [&>tr:nth-child(odd)]:bg-gray-50/30 [&>tr:hover]:bg-gray-50">
          {children}
        </tbody>
      </table>
    </div>
  );
}

export function Skeleton({ className="" }) {
  return <div className={`animate-pulse bg-gray-200 rounded ${className}`} />;
}

export function EmptyState({ title="No data", hint="" }) {
  return (
    <div className="text-center text-gray-500 py-10">
      <div className="text-lg font-medium">{title}</div>
      {hint && <div className="text-sm mt-1">{hint}</div>}
    </div>
  );
}

// --- Lightweight toast system (no deps)
let __toast_id = 0;
export function toast(message, tone = "info") {
  const detail = { id: ++__toast_id, message, tone, ttl: 3000 };
  window.dispatchEvent(new CustomEvent("app:toast", { detail }));
}

export function Toaster() {
  const [items, setItems] = React.useState([]);
  React.useEffect(() => {
    function onToast(e){
      const t = e.detail;
      setItems(prev => [...prev, t]);
      setTimeout(()=>{
        setItems(prev => prev.filter(x => x.id !== t.id));
      }, t.ttl || 3000);
    }
    window.addEventListener("app:toast", onToast);
    return () => window.removeEventListener("app:toast", onToast);
  }, []);
  const toneMap = {
    info: "bg-gray-900 text-white",
    success: "bg-green-600 text-white",
    warning: "bg-yellow-600 text-white",
    danger: "bg-red-600 text-white",
  };
  return (
    <div className="fixed bottom-4 right-4 z-[100] space-y-2">
      {items.map(t => (
        <div key={t.id} className={`px-3 py-2 rounded-lg shadow-lg ${toneMap[t.tone] || toneMap.info}`}>
          <div className="text-sm">{t.message}</div>
        </div>
      ))}
    </div>
  );
}
