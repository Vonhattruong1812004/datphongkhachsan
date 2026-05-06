import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/index.css";

function StatusPanel() {
  return (
    <section className="rounded-3xl border border-slate-800 bg-slate-950/80 p-6 text-slate-100 shadow-glow">
      <div className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">ABC Resort Widgets</div>
      <h1 className="mt-3 text-3xl font-black text-slate-50">Hybrid widget runtime da san sang</h1>
      <p className="mt-3 text-sm leading-7 text-slate-300">
        Day la diem vao cho cac widget React/Vite cua he thong moi. Cac man van hanh chinh hien dang chay tren SSR + API that,
        dong thoi san sang tiep tuc gan them OpsConsole, RoomBoard, BookingWizard, eKYC va AI Concierge theo tung page.
      </p>
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        {[
          ["Realtime", "SSE dashboard va room board da hoat dong"],
          ["AI", "Concierge, recommendation, analytics da co"],
          ["PWA", "Manifest, service worker, mobile hub da san sang"]
        ].map(([title, note]) => (
          <article key={title} className="rounded-3xl border border-slate-800 bg-slate-900/80 p-4">
            <div className="text-sm font-black text-slate-50">{title}</div>
            <div className="mt-2 text-sm leading-6 text-slate-400">{note}</div>
          </article>
        ))}
      </div>
    </section>
  );
}

const rootElement = document.getElementById("react-root");
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <StatusPanel />
    </React.StrictMode>
  );
}
