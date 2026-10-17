const key = process.env.AISSTREAM_API_KEY;
const mmsi = process.env.MMSI;
const socket = new WebSocket("wss://stream.aisstream.io/v0/stream");
const timeout = setTimeout(() => {
  console.error("Timeout : aucun message AIS reçu");
  socket.close();
  process.exit(1);
}, 240000);
socket.onopen = () => {
  socket.send(JSON.stringify({
    APIKey: key,
    BoundingBoxes: [[[-90, -180], [90, 180]]],
    FiltersShipMMSI: [mmsi],
    FilterMessageTypes: ["PositionReport"],
  }));
};

socket.onerror = (e) => {
  console.error("WebSocket : " + (e.message ?? "erreur"));
  process.exit(1);
};
