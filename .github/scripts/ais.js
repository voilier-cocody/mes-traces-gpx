const key = process.env.AISSTREAM_API_KEY;
const mmsi = process.env.MMSI;
const socket = new WebSocket("wss://stream.aisstream.io/v0/stream");
const timeout = setTimeout(() => {
  console.error("Timeout : aucun message AIS reçu");
  socket.close();
  process.exit(0);
}, 240000);
socket.onopen = () => {
  socket.send(JSON.stringify({
    APIKey: key,
    BoundingBoxes: [[[-90, -180], [90, 180]]],
    FiltersShipMMSI: [mmsi],
    FilterMessageTypes: ["PositionReport"],
  }));
};
socket.onmessage = async (ev) => {
  const raw = ev.data instanceof Blob ? await ev.data.text() : String(ev.data);
  const msg = JSON.parse(raw);
  const p = msg.Message?.PositionReport;
  if (!p) return;
  const out = {
    latitude: p.Latitude,
    longitude: p.Longitude,
    date: new Date(p.Timestamp ?? Date.now()).toISOString(),
    sog: p.Sog ?? null,
    cog: p.Cog ?? null,
    source: "ais",
  };
  require("fs").writeFileSync("location.json", JSON.stringify(out, null, 2));
  clearTimeout(timeout);
  socket.close();
  process.exit(0);
};
socket.onerror = (e) => {
  console.error("WebSocket : " + (e.message ?? "erreur"));
  process.exit(1);
};
