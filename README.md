# Ochre Ridge

Mobiler Ego-Shooter im Querformat, gebaut mit three.js. Offenes Naturgelände (ockerfarbenes Trockengras, Kiefern, verschneite Berge), filmische Nachbearbeitung und eine M4A1 mit Händen. Leichte Gegner, Schießstand und ein Bewegungssystem mit Gehen, Laufen, Sprint, Taktik-Sprint und Slide.

**Spielen:** https://kaanbaran965-bot.github.io/warzone-prototype/

Die statische Web-Version liegt im Repository-Root (`index.html`, `assets/`, `js/`) und ist für GitHub Pages unter dem Unterpfad `/warzone-prototype/` ausgelegt. Alle Asset-Pfade sind relativ (`./assets/...`).

## Touch-Steuerung

- **Linker Stick:** wenig auslenken = Gehen, weiter auslenken = Laufen. Ganz nach vorn = Auto-Sprint. Über den Ring hinaus schieben oder doppelt antippen = Taktischer Sprint.
- **Ducken während des Sprints** = Rutschen (Slide).
- **Rechte Bildschirmhälfte** = Umsehen.
- **Große Taste rechts** = Feuern.
- **Fadenkreuz-Taste** = Zielen (ADS).
- **Einstellungen** (☰): Zielhilfe für Touch, Standard 30 %.

## iOS-App aus `source/` bauen (Mac)

Voraussetzungen: Xcode 16+, Node.js 20+, Apple-ID (ein kostenloses Konto reicht für das eigene iPhone).

```bash
cd source
npm install
npm run ios:sync
npx cap open ios
```

In Xcode: Target „App“ → Signing & Capabilities → Team wählen (Bundle-ID bei Bedarf anpassen, Standard `de.luissimons.ochreridge`). iPhone per Kabel anschließen, als Ziel wählen und starten. Nach jeder Code-Änderung erneut `npm run ios:sync` ausführen.

Ausführliche Spiel- und Technikhinweise stehen in [`source/README.md`](source/README.md).
