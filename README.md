# Schwunganalyse (Golf)

Persönliche Web-App zur Analyse des eigenen Golfschwungs. Läuft komplett im Browser, auch auf dem iPhone als Homescreen-App. Videos verlassen das Gerät nicht.

## Funktionen
- Video-Upload (Face-on oder Down-the-line), Zuschneiden auf Ansprechen bis Finish
- Skelett-Overlay, Einzelbildsteuerung, Zeitlupe 0,25× / 0,5×
- Automatische Schwungphasen: Ansprechen, Top, Treffmoment, Finish
- Messwerte: Schulter- und Hüftdrehung, X-Faktor, offene Schultern/Hüfte im Treffmoment, Führungsarm-Streckung, Armebene (DTL), Gewichtsverlagerung und Kopfbewegung (Face-on)
- Vergleich mit selbst hochgeladenem Pro-Schwung, phasensynchron nebeneinander
- Verlauf auf dem Gerät (IndexedDB, nur Messwerte und Standbild), Diagramm, JSON-Export/Import
- Einstellbar: Spielhand, Trainingsziel (hebt passende Werte hervor)

## Technik
- Vanilla JS, keine Build-Schritte
- MediaPipe Pose Landmarker 0.10.21 (`vendor/`) mit Modell `pose_landmarker_full` (`models/`), lokal eingebunden, damit die App offline läuft
- Service Worker (`sw.js`) cached App und Modell; bei Änderungen `CACHE` hochzählen

## Lokal starten
```
npx http-server . -p 8080
```
Dann http://localhost:8080 öffnen. Für das iPhone braucht es HTTPS (z. B. GitHub Pages).

## Grenzen
- Der Schläger wird nicht erkannt: keine Schwungbahn, kein Schlägerblatt, kein Schlägerkopftempo.
- Drehwinkel stammen aus der 3D-Schätzung einer einzelnen Kamera, Genauigkeit eher ±10°.
- Ohne Zeitlupe verwischt der Abschwung, Treffmoment wird dann ungenauer.

## Tests
```
node tests/analysis.test.mjs
```
