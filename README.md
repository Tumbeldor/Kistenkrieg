# Kistenkrieg

Top-Down-Shooter für den Browser – am PC und auf dem iPhone. Solo gegen Bots oder online mit bis zu 4 Freunden.

**▶ Jetzt spielen: https://tumbeldor.github.io/Kistenkrieg/**

## Features

- **Modi:** Jeder gegen jeden (online wahlweise nur unter Freunden oder mit Bots) · Team vs. Bots (Koop) · Überleben mit Bot-Wellen und Boss alle 5 Wellen (Koop)
- **Bots** in 4 Schwierigkeitsstufen (Leicht, Normal, Schwer, Albtraum) mit Pfadsuche, Deckung und Medikit-Suche
- **9 Waffen:** Pistole, MP, Schrotflinte, Sturmgewehr, Scharfschützengewehr, Flammenwerfer, Minigun, Raketenwerfer, Railgun
- **Karten:** Lagerhalle, Wald, Wüste in den Größen Klein, Mittel und Groß (oder automatisch nach Spielerzahl) – jedes Match zufällig generiert, mit zerstörbaren Kisten, Explosivfässern und Büschen zum Verstecken
- **Progression:** XP und 30 Level; freischaltbare Waffen, Perks, Tarnmuster und Kopfbedeckungen; Statistiken; Spielstand-Code zum Übertragen
- **Online:** Raum erstellen → Link oder 4-stelligen Code an Freunde schicken. Verbindung direkt zwischen den Geräten (WebRTC über PeerJS), kein eigener Server nötig
- **iPhone:** Touch-Steuerung mit zwei virtuellen Sticks; über „Zum Home-Bildschirm“ im Vollbild

## Steuerung

| PC | iPhone |
| --- | --- |
| WASD laufen, Maus zielen, Linksklick schießen | Linker Daumen laufen |
| R nachladen, Q / Mausrad / 1–3 Waffe wechseln | Rechter Daumen zielen, weit ziehen = feuern, kurz tippen = Schnellschuss |
| Tab Punkte, Esc Pause | Buttons für Nachladen, Wechseln, Punkte und Pause |

## Entwicklung

```bash
npm install
npm run dev       # lokaler Server mit Hot Reload
npm run build     # erzeugt dist/ (eine einzige index.html plus Icons)
npm run preview   # Build lokal testen
```

Mehrspieler lokal testen ohne Internet: zwei Tabs mit `?net=local` öffnen (z. B. `http://localhost:5173/?net=local`).

## Testversion (Experimente)

- `main` ist die normale Version: https://tumbeldor.github.io/Kistenkrieg/
- `experiment` ist die Testversion: https://tumbeldor.github.io/Kistenkrieg/test/ – mit eigenem Spielstand (startet als Kopie des normalen) und eigenen Räumen
- Der Tag `stabil-v1` markiert den Stand vor den Experimenten; dorthin kann jederzeit zurückgesprungen werden

## Veröffentlichen

`dist/` ist eine rein statische Seite und läuft auf jedem Static-Host:

- **GitHub Pages:** Der Workflow `.github/workflows/deploy.yml` baut und veröffentlicht bei jedem Push auf `main`. Einmalig im Repo unter *Settings → Pages → Source* „GitHub Actions“ wählen.
- **Netlify Drop:** Ordner `dist/` auf https://app.netlify.com/drop ziehen.
- **itch.io:** `dist/` als ZIP hochladen, „This file will be played in the browser“ aktivieren.

## Technik

TypeScript + Vite, Canvas 2D, Web Audio (synthetisierte Sounds), PeerJS für WebRTC. Der Host simuliert das Match (Bots, Treffer, Punkte), Clients schicken Eingaben und bekommen 30 Snapshots pro Sekunde.
