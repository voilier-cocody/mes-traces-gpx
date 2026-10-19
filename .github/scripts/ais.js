const fs = require("fs");

const key = process.env.AISSTREAM_API_KEY;
const mmsi = process.env.MMSI;

if (!key || !mmsi) {
  console.error("Erreur : Les variables AISSTREAM_API_KEY ou MMSI sont manquantes.");
  process.exit(1);
}

// 1. On passe la clé directement dans l'URL pour une authentification immédiate
const socket = new WebSocket(`wss://stream.aisstream.io/v0/stream?apiKey=${key}`);

const timeout = setTimeout(() => {
  console.error("Timeout : aucun message AIS reçu pour le MMSI " + mmsi);
  socket.close();
  process.exit(0); // Quitte proprement pour le workflow
}, 240000);

socket.onopen = () => {
  console.log(`Connexion établie. Recherche du MMSI : ${mmsi}...`);
  // 2. On envoie l'abonnement sans avoir besoin de répéter l'APIKey ici
  socket.send(JSON.stringify({
    BoundingBoxes: [[[-90, -180], [90, 180]]],
    FiltersShipMMSI: [String(mmsi)],
    FilterMessageTypes: ["PositionReport"],
  }));
};

socket.onmessage = async (ev) => {
  try {
    const raw = ev.data instanceof Blob ? await ev.data.text() : String(ev.data);
    const msg = JSON.parse(raw);
    
    // AisStream renvoie parfois des messages de keep-alive ou de statut, on valide la structure
    const p = msg.Message?.PositionReport;
    if (!p) return;

    console.log("Position reçue ! Enregistrement...");
    const out = {
      latitude: p.Latitude,
      longitude: p.Longitude,
      date: new Date(msg.MetaData?.Timestamp || Date.now()).toISOString(),
      sog: p.Sog ?? null,
      cog: p.Cog ?? null,
      source: "ais",
    };

    // Note : Votre YAML cherche "position.json", assurez-vous de nommer le fichier correctement ici
    fs.writeFileSync("position.json", JSON.stringify(out, null, 2));
    
    clearTimeout(timeout);
    socket.close();
    process.exit(0);
  } catch (err) {
    console.error("Erreur lors du traitement du message :", err);
  }
};

socket.onclose = (event) => {
  console.log(`Le WebSocket a été fermé. Code: ${event.code}, Raison: ${event.reason || "Aucune"}`);
};

socket.onerror = (e) => {
  console.error("WebSocket Erreur : " + (e.message ?? "erreur inconnue"));
  process.exit(1);
};
