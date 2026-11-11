"use client";

export function TrendChart({
  data,
}: {
  data: Array<{ date: string; verified: number; failed: number; unverified: number; other?: number }>;
}) {
  if (data.length === 0) return <p className="empty">No executions in this range.</p>;
  const max = Math.max(
    1,
    ...data.map((day) => day.verified + day.failed + day.unverified + (day.other ?? 0)),
  );
  return (
    <div>
      {data.map((day) => {
        const total = day.verified + day.failed + day.unverified + (day.other ?? 0);
        return (
          <div key={day.date} style={{ display: "grid", gridTemplateColumns: "108px 1fr 36px", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <span className="mono">{day.date.slice(5)}</span>
            <div style={{ display: "flex", height: 16, background: "var(--cloud)", borderRadius: 4, overflow: "hidden" }} aria-label={`${total} runs on ${day.date}`}>
              <span style={{ width: `${(day.verified / max) * 100}%`, background: "#0f9e8f" }} />
              <span style={{ width: `${(day.failed / max) * 100}%`, background: "#e66b69" }} />
              <span style={{ width: `${(day.unverified / max) * 100}%`, background: "#e9a43a" }} />
              <span style={{ width: `${((day.other ?? 0) / max) * 100}%`, background: "#829198" }} />
            </div>
            <span className="mono">{total}</span>
          </div>
        );
      })}
      <p className="lede">Teal verified, coral failed, amber unverified, slate cancelled or blocked.</p>
    </div>
  );
}

export function DistributionChart({ data }: { data: Array<{ name: string; value: number }> }) {
  if (data.length === 0) return <p className="empty">No outcomes yet.</p>;
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const colors = ["#0f9e8f", "#e66b69", "#8d4b4b", "#e9a43a", "#829198", "#5e7178"];
  return (
    <div>
      {data.map((item, index) => (
        <div key={item.name} style={{ display: "grid", gridTemplateColumns: "140px 1fr 36px", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <span>{item.name}</span>
          <div style={{ height: 16, background: "var(--cloud)", borderRadius: 4, overflow: "hidden" }}>
            <span style={{ display: "block", height: "100%", width: `${total === 0 ? 0 : (item.value / total) * 100}%`, background: colors[index % colors.length] }} />
          </div>
          <span className="mono">{item.value}</span>
        </div>
      ))}
    </div>
  );
}
