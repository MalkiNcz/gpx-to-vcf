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

function buildVcf(groups, { includeGroupName, addresses }) {
  let out = "";
  for (const group of groups) {
    const pts = group.points.filter((pt) => pt.lat && pt.lon);
    if (!pts.length) continue;

    const addressOf = (pt) => addresses[pointKey(pt.lat, pt.lon)] || pt.label;
    const routeName = `Trasa z ${addressOf(pts[0])} do ${addressOf(pts[pts.length - 1])}`;

    pts.forEach((pt, idx) => {
      const address = addressOf(pt);
      const label = includeGroupName
        ? `${routeName} - bod ${idx + 1} - ${address}`
        : address;
      const safe = escapeVcf(label);
      out +=
        "BEGIN:VCARD\r\n" +
        "VERSION:3.0\r\n" +
        `N;CHARSET=UTF-8:;${safe};;;\r\n` +
        `FN;CHARSET=UTF-8:${safe}\r\n` +
        `GEO:${pt.lat},${pt.lon}\r\n` +
        "END:VCARD\r\n";
    });
  }
  return out;
}

async function getAddress(lat, lon) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Nepodařilo se načíst adresu.");
  return res.json();
}

function formatAddress(data) {
  const addr = data?.address;
  if (!addr) return data?.display_name || null;
  const city = addr.city || addr.town || addr.village || addr.municipality;
  return [addr.road, city].filter(Boolean).join(", ") || data.display_name || null;
}

const pointKey = (lat, lon) => `${lat},${lon}`;

// Nominatim's usage policy allows ~1 request/second, so lookups run sequentially with a delay.
const NOMINATIM_DELAY_MS = 1100;

// --- UI ----------------------------------------------------------------------

export default function GpxToVcf() {
  const [fileName, setFileName] = useState("");
  const [groups, setGroups] = useState(null);
  const [error, setError] = useState("");
  const [includeGroupName, setIncludeGroupName] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [addresses, setAddresses] = useState({});
  const [resolvingAddresses, setResolvingAddresses] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(null);
  const inputRef = useRef(null);
  const resolveGenRef = useRef(0);

  const totalPoints = groups ? groups.reduce((n, g) => n + g.points.length, 0) : 0;

  const resolveAddresses = useCallback((parsedGroups) => {
    const gen = ++resolveGenRef.current;
    const points = [];
    for (const g of parsedGroups) {
      for (const p of g.points.slice(0, 10)) {
        if (p.lat && p.lon) points.push(p);
      }
    }
    setAddresses({});
    if (!points.length) return;
    setResolvingAddresses(true);

    (async () => {
      for (const p of points) {
        if (resolveGenRef.current !== gen) return;
        const key = pointKey(p.lat, p.lon);
        try {
          const data = await getAddress(p.lat, p.lon);
          if (resolveGenRef.current !== gen) return;
          setAddresses((prev) => ({ ...prev, [key]: formatAddress(data) || "Adresa nenalezena" }));
        } catch {
          if (resolveGenRef.current !== gen) return;
          setAddresses((prev) => ({ ...prev, [key]: null }));
        }
        await new Promise((r) => setTimeout(r, NOMINATIM_DELAY_MS));
      }
      if (resolveGenRef.current === gen) setResolvingAddresses(false);
    })();
  }, []);

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
        resolveAddresses(parsed);
      } catch (err) {
        setError(err.message || "Soubor se nepodařilo zpracovat.");
        setGroups(null);
        setFileName("");
      }
    };
    reader.onerror = () => setError("Soubor se nepodařilo načíst.");
    reader.readAsText(file, "utf-8");
  }, [resolveAddresses]);

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragOver(false);
      handleFile(e.dataTransfer.files?.[0]);
    },
    [handleFile]
  );

  const download = useCallback(async () => {
    if (!groups) return;

    // Collect every point missing a resolved address (preview only resolved the first 10/group).
    const addrMap = { ...addresses };
    const missing = [];
    const seenKeys = new Set();
    for (const g of groups) {
      for (const p of g.points) {
        if (!p.lat || !p.lon) continue;
        const key = pointKey(p.lat, p.lon);
        if (seenKeys.has(key) || key in addrMap) continue;
        seenKeys.add(key);
        missing.push({ p, key });
      }
    }

    if (missing.length) {
      setDownloadProgress({ done: 0, total: missing.length });
      for (let i = 0; i < missing.length; i++) {
        const { p, key } = missing[i];
        try {
          const data = await getAddress(p.lat, p.lon);
          addrMap[key] = formatAddress(data) || p.label;
        } catch {
          addrMap[key] = p.label;
        }
        setAddresses((prev) => ({ ...prev, [key]: addrMap[key] }));
        setDownloadProgress({ done: i + 1, total: missing.length });
        if (i < missing.length - 1) await new Promise((r) => setTimeout(r, NOMINATIM_DELAY_MS));
      }
      setDownloadProgress(null);
    }

    const vcf = buildVcf(groups, { includeGroupName, addresses: addrMap });
    // Leading BOM helps Windows-flavored vCard readers (Outlook, Contacts) detect UTF-8
    // instead of falling back to the system codepage and mangling diacritics.
    const blob = new Blob(["﻿" + vcf], { type: "text/vcard;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName.replace(/\.gpx$/i, "") + ".vcf" || "trasa.vcf";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [groups, includeGroupName, fileName, addresses]);

  const reset = () => {
    resolveGenRef.current++;
    setGroups(null);
    setFileName("");
    setError("");
    setAddresses({});
    setResolvingAddresses(false);
    setDownloadProgress(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div
      style={{
        width: "100%",
        maxWidth: 560,
        margin: "0 auto",
        color: "var(--text-primary)",
        fontFamily:
          "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
        padding: "32px 20px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <Route size={22} color="var(--accent)" strokeWidth={2} />
        <h1
          style={{
            margin: 0,
            fontSize: 20,
            fontWeight: 700,
            letterSpacing: "0.02em",
            color: "var(--text-primary)",
          }}
        >
          GPX → VCF
        </h1>
      </div>
      <p style={{ margin: "0 0 26px", fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 }}>
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
            border: `1.5px dashed ${dragOver ? "var(--accent)" : "var(--panel-border)"}`,
            borderRadius: 10,
            padding: "40px 20px",
            textAlign: "center",
            cursor: "pointer",
            background: dragOver ? "var(--accent-soft)" : "transparent",
            transition: "border-color 120ms, background 120ms",
          }}
        >
          <Upload size={26} color="var(--accent)" style={{ marginBottom: 10 }} />
          <div style={{ fontSize: 14, color: "var(--text-primary)", marginBottom: 4 }}>
            Přetáhni sem .gpx soubor
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>nebo klikni pro výběr</div>
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
            background: "var(--danger-bg)",
            border: "1px solid var(--danger-border)",
            color: "var(--danger-text)",
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
              border: "1px solid var(--panel-border)",
              background: "var(--card-bg)",
              marginBottom: 16,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <FileText size={17} color="var(--accent)" style={{ flexShrink: 0 }} />
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    color: "var(--text-primary)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {fileName}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>
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
                color: "var(--text-muted)",
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
              border: "1px solid var(--panel-border)",
              borderRadius: 10,
              padding: "12px 14px",
              marginBottom: 16,
              maxHeight: 180,
              overflowY: "auto",
            }}
          >
            {groups.map((g, i) => (
              <div key={i} style={{ marginBottom: i < groups.length - 1 ? 10 : 0 }}>
                <div style={{ fontSize: 12, color: "var(--accent)", marginBottom: 4 }}>
                  {g.kind}: {g.name} ({g.points.length})
                </div>
                {g.points.slice(0, 10).map((p, j) => {
                  const key = p.lat && p.lon ? pointKey(p.lat, p.lon) : null;
                  const address = key ? addresses[key] : undefined;
                  return (
                    <div
                      key={j}
                      style={{
                        fontSize: 11.5,
                        color: "var(--text-secondary)",
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        paddingLeft: 4,
                      }}
                    >
                      <MapPin size={11} />
                      <span>
                        {p.label} · {Number(p.lat).toFixed(5)}, {Number(p.lon).toFixed(5)}
                        {address && ` · ${address}`}
                        {address === undefined && resolvingAddresses && (
                          <span style={{ color: "var(--text-muted)" }}> · načítám adresu…</span>
                        )}
                      </span>
                    </div>
                  );
                })}
                {g.points.length > 10 && (
                  <div style={{ fontSize: 11.5, color: "var(--text-muted)", paddingLeft: 21 }}>
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
              color: "var(--text-secondary)",
              marginBottom: 18,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={includeGroupName}
              onChange={(e) => setIncludeGroupName(e.target.checked)}
              style={{ accentColor: "var(--accent)" }}
            />
            Přidat název trasy do jména kontaktu
          </label>

          <button
            onClick={download}
            disabled={!!downloadProgress}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              padding: "12px 16px",
              borderRadius: 9,
              border: "none",
              background: "var(--accent)",
              color: "var(--accent-contrast)",
              fontSize: 13.5,
              fontWeight: 700,
              cursor: downloadProgress ? "default" : "pointer",
              letterSpacing: "0.01em",
              opacity: downloadProgress ? 0.7 : 1,
            }}
          >
            <Download size={16} strokeWidth={2.5} />
            {downloadProgress
              ? `Načítám adresy… ${downloadProgress.done}/${downloadProgress.total}`
              : "Stáhnout .vcf"}
          </button>
        </div>
      )}
    </div>
  );
}