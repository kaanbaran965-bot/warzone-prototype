# Ochre Ridge – Warzone-Mobile-Stil FPS-Prototyp (three.js, iPhone Querformat)

Offenes Naturgelände (ockerfarbene Trockengras-Felder, Kiefernwälder, verschneite Berge, Höhennebel,
warme Sonne), filmisches Post-Processing (Bloom, ACES, Grading, Vignette, Grain, Schärfung),
detailliertes M4A1 + Hände mit prozeduralem ADS/Rückstoß/Nachladen, minimales HUD –
jetzt mit leichten Gegnern, Schießstand, Deckung und vollem Bewegungssystem.

## Spielinhalt
- **Gefechtszone** (ca. 120 m voraus, leicht rechts vom Spawn): 3 Bots gleichzeitig, absichtlich LEICHT
  (lange Reaktionszeit 1,5–2,3 s, geringe Trefferquote, 5–7 Schaden pro Treffer, kurze Salven). Sie patrouillieren,
  entdecken dich, suchen Deckung an Felsen/Baumstämmen/Bäumen, schießen mit sichtbaren Leuchtspuren zurück,
  zucken bei Treffern, fallen um und erscheinen nach 7 s weit entfernt neu.
- **Schaden**: Kopftreffer ×2, Körper ×1, Gliedmaßen ×0,8. Trefferkreuz (rot bei Kill/Kopf), Treffer-Ton,
  Kill-Feed oben rechts, ELIM/PKT oben links (Kill 100, Kopfschuss-Kill 150, Stahlziel 10/15).
- **Spieler**: 100 HP + 3 Platten à 50. Gesundheit regeneriert nach 4 s ohne Treffer; roter Schadensrand mit
  Richtungsanzeige. Tod → Todeskamera + Bildschirm „AUSGESCHALTET“ (Wiedereinstieg nach 4 s per Taste, automatisch nach 8 s).
- **Munitionskisten** (Stapel in der Zone): hingehen → Reserve auf 210 + Platten voll (12 s Abklingzeit).
- **Schießstand** direkt vor dem Spawn: 3 klappende Stahl-Silhouetten + 2 Gongs.
- **Zielhilfe (nur Touch)**, Standard 30 %, Regler im Menü: Verlangsamung der Umseh-Empfindlichkeit nahe Gegnern,
  sanftes Mitziehen zum nächsten sichtbaren Gegner in einem kleinen Kegel (nur während du dich bewegst/umsiehst/schießt),
  stärkerer „Snap“ beim Anvisieren (ebenfalls auf 30 % skaliert). 0 % = aus.

## Steuerung – Touch (iPhone)
| Aktion | Bedienung |
|---|---|
| Gehen / Laufen | linker Stick: wenig auslenken = Gehen, mehr = Laufen |
| Sprinten | Stick ganz nach vorn = Auto-Sprint (abschaltbar im Menü) |
| Taktiksprint | beim Sprinten Stick über den Ring hinaus schieben **oder** Stick doppelt antippen (4 s, dann 3 s Abklingzeit) |
| Rutschen | beim Sprinten Ducken-Taste drücken (endet in Hocke oder – Stick weiter vorn – wieder im Sprint) |
| Umsehen | rechte Bildschirmhälfte ziehen |
| Feuern | große Feuer-Taste rechts (beim Halten ziehen = gleichzeitig zielen) |
| Zielen (ADS) | Fadenkreuz-Taste (Umschalten; „Halten“ im Menü einstellbar) – bewegt sich langsamer, Sprint bricht ADS ab |
| Nachladen | Pfeil-Kreis-Taste (Magazin raus/rein, bei leerem Magazin zusätzlich Ladehebel) |
| Springen / Ducken | Doppelpfeil hoch / Pfeil runter |
| Menü | ☰ oben rechts: Qualität, Empfindlichkeit, FOV, Zielen halten/umschalten, **Zielhilfe %**, **Auto-Sprint**, **Gegner aktiv**, Kompass, Debug |

## Steuerung – Desktop
WASD bewegen · Maus umsehen (Klick fängt die Maus) · **Alt/Q** gehen · **Shift** Sprint, erneut Shift beim Sprinten = Taktiksprint ·
**C/Strg** Ducken (beim Sprinten = Rutschen) · **V** Rutschen · **Leertaste** Springen · **LMB** Feuer · **RMB** Zielen · **R** Nachladen · **F/I** Waffe inspizieren · Menü über ☰ (Esc gibt die Maus frei).

## Bewegung (Technik)
Delta-Zeit-basiert, Beschleunigung/Abbremsen mit Trägheit, Zustandsautomat Idle/Walk/Run/Sprint/TacticalSprint/Jump/
Crouch/Slide/ADS (Geschwindigkeiten 2,6 / 4,6 / 6,4 / 8,0 m/s, Hocke 2,2, ADS ×0,55). Kopfwippen pro Zustand,
Roll beim Strafen/Drehen, Landungs-Delle, Sprung mit Schwerkraft und Waffenreaktion, Hocke mit tieferer Kamera und
anderer Waffenhaltung, Rutschen mit abklingender Geschwindigkeit, gekippter tiefer Kamera und Abklingzeit,
FOV-Kick beim (Taktik-)Sprint, Schritte nach Tempo.

## Web (Entwicklung / Test)
    npm install
    npm run dev          # Dev-Server
    npm run build && npm run preview   # Produktions-Build unter http://localhost:4188

URL-Optionen: `?q=low|medium|high` (Grafikqualität erzwingen), `?manual` (nur für Screenshot-/Test-Tools).
Tests (Playwright, headless): `node tools/final-shots.mjs` (Screenshot-Satz), `node tools/move-test.mjs`
(Bewegungswerte), `node tools/aa-test.mjs` (Zielhilfe) – jeweils bei laufendem `npm run preview`.

## iOS (auf dem Mac)
Voraussetzungen: Xcode 16+, Node 20+, Apple-ID (kostenloses Konto reicht für eigenes iPhone).

    npm install
    npm run ios:sync     # vite build + npx cap sync ios
    npx cap open ios     # öffnet ios/App/App.xcodeproj in Xcode

In Xcode: Target "App" → Signing & Capabilities → Team wählen (Bundle-ID ggf. ändern, Standard
`de.luissimons.ochreridge`), iPhone per Kabel anschließen, als Ziel wählen, ▶ Run.
Beim ersten Start auf dem iPhone: Einstellungen → Allgemein → VPN & Geräteverwaltung → Entwickler vertrauen.
Nach jeder Code-Änderung erneut `npm run ios:sync`.

Die App ist nur Querformat, Vollbild, ohne Statusleiste/Home-Indikator (eigener `GameViewController`),
Haptik beim Schießen und beim Tod. Standard-Qualität auf Touch-Geräten: „Mittel“ mit dynamischer Auflösung.

## Struktur
- `src/core` Renderer + Qualitätspresets · `src/post` Post-FX-Kette · `src/world` Gelände, Gras (GPU), Kiefern, Berge, Nebel, Felsen, Deckung (Stämme, Kisten)
- `src/game` Spieler-Zustandsautomat, Kamera, Waffe, Viewmodel (IK-Arme), Effekte · `src/combat` Bots, KI, Ballistik, Ziele, Schaden, Zielhilfe
- `src/input` Tastatur/Maus/Touch · `src/ui` HUD + Einstellungen · `src/audio` Sounds (Datei + prozedural)
- `tools/` Playwright-Testskripte · `public/CREDITS.txt` Lizenzen (CC0 / CC BY 4.0 / OFL)

## Bekannte Grenzen
- Performance noch nicht auf echtem iPhone gemessen (im Gefecht ca. 260 Draw-Calls).
- Bots navigieren geradlinig (kein Pathfinding), einfache Deckungslogik; keine Teams/Spielmodi.
- Zielhilfe nur bei Touch-Bedienung aktiv.
