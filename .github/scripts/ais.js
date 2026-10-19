const fs = require("fs");

const key = process.env.VESSELAPI_KEY; // Remplacez par votre clé VesselAPI si nécessaire
const mmsi = process.env.MMSI;

if (!key || !mmsi) {
  console.error("Erreur : Variables manquantes.");
  process.exit(1);
}

async function getLatestPosition() {
  try {
    // Exemple d'appel HTTP vers un point de terminaison REST de position de navire
    // https://api.vesselapi.com/v1/vessel/211331640/position?filter.idType=mmsi
    const response = await fetch(`https://api.vesselapi.com/v1/vessel/227904590/position?filter.idType=mmsi`, {
      headers: { 'Authorization': `Bearer ${key}` }
    });

    if (!response.ok) {
      throw new Error(`Erreur API: ${response.status}`);
    }

    const data = await response.json();
    const p = data.vesselPosition || data;
    
    // --- CORRECTION DU TIMESTAMP ---
    let rawTimestamp = p.timestamp || p.date || p.receivedAt;
    let finalDate;

    if (rawTimestamp) {
      // Si c'est un nombre à 10 chiffres (secondes Unix), on le convertit en millisecondes
      if (typeof rawTimestamp === "number" && rawTimestamp.toString().length === 10) {
        rawTimestamp = rawTimestamp * 1000;
      }
      
      const parsedDate = new Date(rawTimestamp);
      // Sécurité si la date parsée reste invalide malgré tout
      finalDate = isNaN(parsedDate.getTime()) ? new Date().toISOString() : parsedDate.toISOString();
    } else {
      finalDate = new Date().toISOString(); // Valeur de repli sur l'heure actuelle
    }
    // -------------------------------
    
    // Extraction des données selon la structure de l'API choisie
    const out = {
      latitude: data.latitude,
      longitude: data.longitude,
      date: new Date(data.timestamp).toISOString(),
      sog: data.speed ?? null,
      cog: data.course ?? null,
      source: "ais",
    };

    fs.writeFileSync("position.json", JSON.stringify(out, null, 2));
    console.log("Position mise à jour avec succès via API REST.");
    process.exit(0);

  } catch (error) {
    console.error("Impossible de récupérer la position :", error.message);
    process.exit(1);
  }
}

getLatestPosition();
