import { ImageResponse } from "next/og";

export const alt = "acta — Ledger Sandbox";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Generated at build time. Uses the default sans-serif font + a monospace
// fallback for the code snippet; no custom font asset needed.
export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#0A0A0A",
          display: "flex",
          flexDirection: "column",
          padding: "64px 72px",
          color: "#FAFAFA",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: "16px",
            fontSize: "24px",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "#A1A1AA",
          }}
        >
          <span style={{ color: "#FAFAFA", fontWeight: 600 }}>ACTA</span>
          <span style={{ color: "#52525B" }}>·</span>
          <span>Ledger Sandbox</span>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginTop: "60px",
          }}
        >
          <div
            style={{
              fontSize: "84px",
              fontWeight: 300,
              lineHeight: 1.05,
              color: "#FAFAFA",
            }}
          >
            Multi-currency,
          </div>
          <div
            style={{
              fontSize: "84px",
              fontWeight: 300,
              lineHeight: 1.05,
              color: "#FAFAFA",
            }}
          >
            double-entry,
          </div>
          <div
            style={{
              fontSize: "84px",
              fontWeight: 300,
              lineHeight: 1.05,
              color: "#F59E0B",
            }}
          >
            point-in-time.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            marginTop: "auto",
            background: "#111113",
            border: "1px solid #27272A",
            padding: "20px 24px",
            fontFamily: "monospace",
            fontSize: "20px",
            color: "#FAFAFA",
          }}
        >
          $ curl -X POST acta.money/transactions -H &quot;Authorization: Bearer ac_…&quot;
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: "24px",
            fontSize: "18px",
            color: "#A1A1AA",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        >
          <span>A Postgres ledger you can sign up to</span>
          <span style={{ color: "#F59E0B" }}>acta.money</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
