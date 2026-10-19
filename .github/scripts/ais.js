const fs = require("fs");

const key = process.env.VESSELAPI_KEY; // Remplacez par votre clé VesselAPI si nécessaire https://dashboard.vesselapi.com/
const mmsi = process.env.MMSI;

if (!key || !mmsi) {
  console.error("Erreur : Variables manquantes.");
  process.exit(1);
}

async function getLatestPosition() {
  try {
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
    
      const out = {
      latitude: p.latitude ?? p.lat,
      longitude: p.longitude ?? p.lon,
      date: finalDate,
      sog: p.speed ?? p.sog ?? null,
      cog: p.course ?? p.cog ?? null,
      source: "AIS",
    };

    fs.writeFileSync("position.json", JSON.stringify(out, null, 2));
    console.log("Fichier position.json mis à jour avec succès !");
    process.exit(0);

  } catch (error) {
    console.error("Impossible de récupérer la position :", error.message);
    process.exit(1);
  }
}

getLatestPosition();
