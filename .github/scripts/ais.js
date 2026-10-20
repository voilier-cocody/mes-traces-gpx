const fs = require("fs");

const key = process.env.VESSELAPI_KEY; // Remplacez par votre clé VesselAPI si nécessaire https://dashboard.vesselapi.com/
const mmsi = process.env.MMSI;
const fileName = "position.json";

if (!key || !mmsi) {
  console.error("Erreur : Variables manquantes.");
  process.exit(1);
}

async function getLatestPosition() {
  try {
    const response = await fetch(`https://api.vesselapi.com/v1/vessel/${mmsi}/position?filter.idType=mmsi`, {
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

 // --- NOUVELLE LOGIQUE DE COMPARAISON DES DATES ---
    let shouldUpdate = true;
    const newDateObj = new Date(out.date);

    if (fs.existsSync(fileName)) {
      try {
        const fileContent = fs.readFileSync(fileName, 'utf-8');
        const oldData = JSON.parse(fileContent);

        if (oldData && oldData.date) {
          const oldDateObj = new Date(oldData.date);

          // Si la nouvelle date est plus ancienne ou identique, on n'écrit rien
          if (newDateObj <= oldDateObj) {
            console.log(`Pas de mise à jour nécessaire. Date API (${out.date}) antérieure ou égale à la date enregistrée (${oldData.date}).`);
            shouldUpdate = false;
          }
        }
      } catch (parseError) {
        console.warn("Attention : Impossible de lire ou parser l'ancien JSON. Le fichier sera écrasé.", parseError.message);
      }
    }

    // Écriture uniquement si la donnée est strictement plus récente
    if (shouldUpdate) {
      fs.writeFileSync(fileName, JSON.stringify(out, null, 2));
      console.log("Fichier position.json mis à jour avec succès !");
    }
    // -------------------------------------------------

    process.exit(0);
    
  } catch (error) {
    console.error("Impossible de récupérer la position :", error.message);
    process.exit(1);
  }
}

getLatestPosition();
