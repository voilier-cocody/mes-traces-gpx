const fs = require("fs");

const key = process.env.AISSTREAM_API_KEY;
const mmsi = process.env.MMSI;

if (!key || !mmsi) {
  console.error("Erreur : Les variables AISSTREAM_API_KEY ou MMSI sont manquantes.");
  process.exit(1);
}

const socket = new WebSocket("wss://ais.openwaters.io/v0/stream");

const timeout = setTimeout(() => {
  console.error(`Timeout : aucun message AIS reçu pour le MMSI ${mmsi} après 4 minutes.`);
  socket.close();
  process.exit(0); // Permet au workflow de se terminer sans marquer un échec rouge si le bateau dort
}, 240000);

socket.onopen = () => {
  console.log(`Connexion établie avec AisStream. Envoi de l'abonnement pour le MMSI : ${mmsi}...`);
  
  // La clé d'API DOIT impérativement être passée dans le JSON ici
  socket.send(JSON.stringify({
    APIKey: key,
    BoundingBoxes: [[[-90, -180], [90, 180]]], // Définition correcte des limites mondiales (Worldwide)
    FiltersShipMMSI: [String(mmsi)],
    FilterMessageTypes: ["PositionReport"],
    snapshot: true
  }));
};

socket.onmessage = async (ev) => {
  try {
    const raw = ev.data instanceof Blob ? await ev.data.text() : String(ev.data);
    const msg = JSON.parse(raw);
    
    // Ignorer les messages de notification/statut internes d'AisStream
    const p = msg.Message?.PositionReport;
    if (!p) return;

    console.log(`Position détectée pour le navire ! Écriture dans position.json...`);
    const out = {
      latitude: p.Latitude,
      longitude: p.Longitude,
      date: new Date(msg.MetaData?.Timestamp || Date.now()).toISOString(),
      sog: p.Sog ?? null,
      cog: p.Cog ?? null,
      source: "ais",
    };

    fs.writeFileSync("position.json", JSON.stringify(out, null, 2));
    
    clearTimeout(timeout);
    socket.close();
    process.exit(0);
  } catch (err) {
    console.error("Erreur d'analyse du message reçu :", err);
  }
};

socket.onclose = (event) => {
  console.log(`Le WebSocket a été fermé. Code: ${event.code}, Raison: ${event.reason || "Aucune (Fermeture serveur brute)"}`);
};

socket.onerror = (e) => {
  console.error("WebSocket Erreur : " + (e.message ?? "Erreur inconnue de flux"));
  process.exit(1);
};
