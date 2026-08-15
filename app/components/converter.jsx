'use client';

import React, { useState, useCallback, useRef } from "react";
import { Upload, Download, MapPin, FileText, X, Route } from "lucide-react";

// --- GPX parsing -----------------------------------------------------------

function parseGpx(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const err = doc.querySelector("parsererror");
  if (err) throw new Error("Soubor se nepodařilo přečíst jako platné GPX/XML.");

  const groups = [];

  // Routes (<rte>) - ordered waypoints of a planned route
  doc.querySelectorAll("rte").forEach((rte, i) => {
    const name = rte.querySelector("name")?.textContent?.trim() || `Trasa ${i + 1}`;
    const pts = [...rte.querySelectorAll("rtept")].map((pt, idx) => ({
      lat: pt.getAttribute("lat"),
      lon: pt.getAttribute("lon"),
      label: pt.querySelector("name")?.textContent?.trim() || `Bod ${idx + 1}`,
    }));
    if (pts.length) groups.push({ kind: "Trasa", name, points: pts });
  });

  // Tracks (<trk>) - recorded track, may have multiple segments
  doc.querySelectorAll("trk").forEach((trk, i) => {
    const name = trk.querySelector("name")?.textContent?.trim() || `Záznam ${i + 1}`;
    const pts = [...trk.querySelectorAll("trkpt")].map((pt, idx) => ({
      lat: pt.getAttribute("lat"),
      lon: pt.getAttribute("lon"),
      label: `Bod ${idx + 1}`,
    }));
    if (pts.length) groups.push({ kind: "Záznam", name, points: pts });
  });

  // Standalone waypoints (<wpt>)
  const wpts = [...doc.querySelectorAll("gpx > wpt")];
  if (wpts.length) {
    const pts = wpts.map((pt, idx) => ({
      lat: pt.getAttribute("lat"),
      lon: pt.getAttribute("lon"),
      label: pt.querySelector("name")?.textContent?.trim() || `Bod ${idx + 1}`,
    }));
    groups.push({ kind: "Body", name: "Waypointy", points: pts });
  }

  return groups;
}

// --- VCF generation ----------------------------------------------------------

function escapeVcf(str) {
  return String(str).replace(/([,;\\])/g, "\\$1");
}

function buildVcf(groups, { includeGroupName }) {
  let out = "";
  for (const group of groups) {
    for (const pt of group.points) {
      if (!pt.lat || !pt.lon) continue;
      const label = includeGroupName ? `${group.name} - ${pt.label}` : pt.label;
      const safe = escapeVcf(label);
      out +=
        "BEGIN:VCARD\r\n" +
        "VERSION:3.0\r\n" +
        `N:;${safe};;;\r\n` +
        `FN:${safe}\r\n` +
        `GEO:${pt.lat},${pt.lon}\r\n` +
        "END:VCARD\r\n";
    }
  }
  return out;
}

// --- UI ----------------------------------------------------------------------

export default function GpxToVcf() {
  const [fileName, setFileName] = useState("");
  const [groups, setGroups] = useState(null);
  const [error, setError] = useState("");
  const [includeGroupName, setIncludeGroupName] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  const totalPoints = groups ? groups.reduce((n, g) => n + g.points.length, 0) : 0;

  const handleFile = useCallback((file) => {
    setError("");
    if (!file) return;
    if (!/\.gpx$/i.test(file.name)) {
      setError("Vyber prosím soubor s příponou .gpx");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = parseGpx(String(e.target.result));
        if (!parsed.length) {
          setError("V souboru se nenašly žádné body (trasa, záznam ani waypointy).");
          setGroups(null);
          setFileName("");
          return;
        }
        setGroups(parsed);
        setFileName(file.name);
      } catch (err) {
        setError(err.message || "Soubor se nepodařilo zpracovat.");
        setGroups(null);
        setFileName("");
      }
    };
    reader.onerror = () => setError("Soubor se nepodařilo načíst.");
    reader.readAsText(file, "utf-8");
  }, []);

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragOver(false);
      handleFile(e.dataTransfer.files?.[0]);
    },
    [handleFile]
  );

  const download = useCallback(() => {
    if (!groups) return;
    const vcf = buildVcf(groups, { includeGroupName });
    const blob = new Blob([vcf], { type: "text/vcard;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName.replace(/\.gpx$/i, "") + ".vcf" || "trasa.vcf";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [groups, includeGroupName, fileName]);

  const reset = () => {
    setGroups(null);
    setFileName("");
    setError("");
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div
      style={{
        minHeight: "100%",
        background: "#0f1410",
        color: "#e8ede6",
        fontFamily:
          "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
        padding: "32px 20px",
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div style={{ width: "100%", maxWidth: 560 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <Route size={22} color="#8fbf6f" strokeWidth={2} />
          <h1
            style={{
              margin: 0,
              fontSize: 20,
              fontWeight: 700,
              letterSpacing: "0.02em",
              color: "#f2f5ee",
            }}
          >
            GPX → VCF
          </h1>
        </div>
        <p style={{ margin: "0 0 26px", fontSize: 13, color: "#9aa596", lineHeight: 1.5 }}>
          Nahraj GPX trasu a stáhni body jako vizitky (.vcf) se souřadnicemi v poli GEO —
          hodí se pro import do navigací a telefonů, které GPX neumí.
        </p>

        {!groups && (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            style={{
              border: `1.5px dashed ${dragOver ? "#8fbf6f" : "#3a453a"}`,
              borderRadius: 10,
              padding: "40px 20px",
              textAlign: "center",
              cursor: "pointer",
              background: dragOver ? "rgba(143,191,111,0.06)" : "transparent",
              transition: "border-color 120ms, background 120ms",
            }}
          >
            <Upload size={26} color="#8fbf6f" style={{ marginBottom: 10 }} />
            <div style={{ fontSize: 14, color: "#e8ede6", marginBottom: 4 }}>
              Přetáhni sem .gpx soubor
            </div>
            <div style={{ fontSize: 12, color: "#6f7a6a" }}>nebo klikni pro výběr</div>
            <input
              ref={inputRef}
              type="file"
              accept=".gpx"
              onChange={(e) => handleFile(e.target.files?.[0])}
              style={{ display: "none" }}
            />
          </div>
        )}

        {error && (
          <div
            style={{
              marginTop: 14,
              padding: "10px 12px",
              borderRadius: 8,
              background: "rgba(191,111,111,0.1)",
              border: "1px solid rgba(191,111,111,0.35)",
              color: "#e0a3a3",
              fontSize: 12.5,
            }}
          >
            {error}
          </div>
        )}

        {groups && (
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 14px",
                borderRadius: 10,
                border: "1px solid #2b332b",
                background: "#141914",
                marginBottom: 16,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <FileText size={17} color="#8fbf6f" style={{ flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      color: "#f2f5ee",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {fileName}
                  </div>
                  <div style={{ fontSize: 11.5, color: "#6f7a6a", marginTop: 2 }}>
                    {totalPoints} {totalPoints === 1 ? "bod" : totalPoints < 5 ? "body" : "bodů"}
                  </div>
                </div>
              </div>
              <button
                onClick={reset}
                aria-label="Zrušit soubor"
                style={{
                  background: "none",
                  border: "none",
                  color: "#6f7a6a",
                  cursor: "pointer",
                  padding: 4,
                  flexShrink: 0,
                }}
              >
                <X size={16} />
              </button>
            </div>

            <div
              style={{
                border: "1px solid #2b332b",
                borderRadius: 10,
                padding: "12px 14px",
                marginBottom: 16,
                maxHeight: 180,
                overflowY: "auto",
              }}
            >
              {groups.map((g, i) => (
                <div key={i} style={{ marginBottom: i < groups.length - 1 ? 10 : 0 }}>
                  <div style={{ fontSize: 12, color: "#8fbf6f", marginBottom: 4 }}>
                    {g.kind}: {g.name} ({g.points.length})
                  </div>
                  {g.points.slice(0, 10).map((p, j) => (
                    <div
                      key={j}
                      style={{
                        fontSize: 11.5,
                        color: "#8a948a",
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        paddingLeft: 4,
                      }}
                    >
                      <MapPin size={11} />
                      {p.label} · {Number(p.lat).toFixed(5)}, {Number(p.lon).toFixed(5)}
                    </div>
                  ))}
                  {g.points.length > 10 && (
                    <div style={{ fontSize: 11.5, color: "#5c665c", paddingLeft: 21 }}>
                      … a dalších {g.points.length - 3}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 12.5,
                color: "#9aa596",
                marginBottom: 18,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={includeGroupName}
                onChange={(e) => setIncludeGroupName(e.target.checked)}
                style={{ accentColor: "#8fbf6f" }}
              />
              Přidat název trasy do jména kontaktu
            </label>

            <button
              onClick={download}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                padding: "12px 16px",
                borderRadius: 9,
                border: "none",
                background: "#8fbf6f",
                color: "#0f1410",
                fontSize: 13.5,
                fontWeight: 700,
                cursor: "pointer",
                letterSpacing: "0.01em",
              }}
            >
              <Download size={16} strokeWidth={2.5} />
              Stáhnout .vcf
            </button>
          </div>
        )}
      </div>
    </div>
  );
}