export default function Home() {
  return (
    <div className="grid h-screen w-screen grid-rows-[auto_1fr_auto] gap-px bg-border">
      <header className="flex h-10 items-center justify-between bg-bg px-4 text-[11px] uppercase tracking-[0.12em] text-muted">
        <span>agent treasury</span>
        <span className="num text-fg">
          as of <span className="text-accent">live</span>
        </span>
      </header>

      <main className="grid grid-cols-[280px_1fr_360px] gap-px bg-border">
        <Pane label="agents">
          <Placeholder rows={5} />
        </Pane>

        <Pane label="treasury">
          <div className="flex h-full flex-col gap-6 p-6">
            <div className="num text-[10px] uppercase tracking-[0.12em] text-muted">
              total · usd
            </div>
            <div className="num text-[64px] font-medium leading-none tracking-tight">
              0.00
            </div>
            <div className="flex-1 rounded-[2px] border border-border bg-surface-1" />
          </div>
        </Pane>

        <Pane label="stream">
          <Placeholder rows={12} />
        </Pane>
      </main>

      <footer className="flex h-8 items-center bg-bg px-4 text-[10px] uppercase tracking-[0.14em] text-muted">
        <span>scrubber · w5</span>
      </footer>
    </div>
  );
}

function Pane({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col bg-surface-1">
      <div className="flex h-7 items-center border-b border-border px-3 text-[10px] uppercase tracking-[0.14em] text-muted">
        {label}
      </div>
      <div className="flex-1 overflow-hidden">{children}</div>
    </section>
  );
}

function Placeholder({ rows }: { rows: number }) {
  return (
    <ul className="flex flex-col">
      {Array.from({ length: rows }).map((_, i) => (
        <li
          key={i}
          className="flex items-center justify-between border-b border-border px-3 py-2 text-[12px]"
        >
          <span className="text-muted">—</span>
          <span className="num text-fg">0.00</span>
        </li>
      ))}
    </ul>
  );
}
