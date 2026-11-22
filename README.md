# Quadratmeter

Eigentumswohnungen als Kapitalanlage durchrechnen – zusammen mit Claude.

Du legst eine Wohnung an, trägst die Daten aus dem Inserat ein, und Kaufnebenkosten, Rendite, Rate und Cashflow rechnen sich schon beim Tippen mit. Finanzierung und Steuersatz hinterlegst du einmal im Konto als Standardwerte.

Optional schickst du Claude den Link zu einem Inserat. Claude liest die Daten, recherchiert den Standort und speichert die Analyse über einen MCP-Connector in Quadratmeter. In der Web-App siehst du dann Kennzahlen, Diagramme, Standortnoten, die Risiko-Ampel und das Fazit. Mit einem Szenario-Rechner probierst du andere Preise, Zinsen oder Eigenkapital aus.

Eigene API-Keys brauchst du nicht: Claude verbindet sich per OAuth, und jeder Nutzer meldet sich dabei mit seinem eigenen Quadratmeter-Konto an.

## Was drin ist

- **Rechner** (`src/shared/calc.js`): Kaufnebenkosten je Bundesland, Brutto- und Nettomietrendite, Kaufpreisfaktor, Annuitätendarlehen, Cashflow vor und nach Steuern (AfA nach Baujahr, Grenzsteuersatz), 30-Jahres-Prognose, Eigenkapitalrendite (IRR) mit Verkauf, cashflow-neutraler Kaufpreis und Ampel-Faustregeln. Derselbe Code läuft im Server und im Browser.
- **MCP-Server** unter `/mcp` mit den Tools `list_properties`, `get_property`, `create_property`, `update_property`, `calculate`, `save_analysis`, `add_note` und `compare_properties`.
- **OAuth 2.1** mit dynamischer Client-Registrierung und PKCE, so wie Claude es für eigene Connectors erwartet.
- **Detailseite in Reitern**: Überblick (mit Szenario-Reglern), Rechnung (Rechenweg Schritt für Schritt mit den Zahlen der Wohnung und Begriffserklärungen), Prognose, Standort & Risiken, Notizen & Daten.
- **Web-App**: Wohnungen im Formular anlegen und bearbeiten (mit Kennzahlen beim Tippen), eigene Standardwerte für Finanzierung und Steuer, Übersicht mit Sortierung und Statusfilter, Detailseite, Vergleich von bis zu sechs Wohnungen, Notizen, Konto mit verbundenen Apps.
- **Nutzer und Rollen**: Admins laden Nutzer per Link ein, setzen Passwörter zurück, sperren oder löschen Nutzer. Jeder sieht nur seine eigenen Wohnungen.
- **Freigabe**: Eine Wohnung lässt sich mit anderen Nutzern teilen. Sie erscheint bei ihnen unter „Mit mir geteilt“ und kann nur angesehen werden; die Szenario-Regler funktionieren, gespeichert wird nichts. Claude sieht weiterhin nur die eigenen Wohnungen.

Keine externen Abhängigkeiten: nur Node.js 22 mit eingebautem SQLite.

## Auf Coolify deployen

1. **Neue Ressource** anlegen, das GitHub-Repo `quadratmeter` auswählen, Branch `main`, Build Pack **Dockerfile**.
2. **Port** `3000` eintragen und eine **Domain** vergeben, z. B. `https://quadratmeter.deine-domain.de`.
3. **Umgebungsvariablen** setzen:

   | Variable | Beispiel | Bedeutung |
   | --- | --- | --- |
   | `BASE_URL` | `https://quadratmeter.deine-domain.de` | Öffentliche Adresse, ohne `/` am Ende. Pflicht, sonst klappt OAuth nicht. |
   | `ADMIN_EMAIL` | `du@example.com` | Erster Admin, wird beim allerersten Start angelegt. |
   | `ADMIN_PASSWORD` | mindestens 10 Zeichen | Passwort des ersten Admins. Ohne Passwort steht ein Link zum Festlegen im Log. |
   | `ADMIN_NAME` | `Korbinian` | Anzeigename des Admins (optional). |

4. **Persistenten Speicher** anlegen: ein Volume mit Ziel `/data`. Dort liegt die SQLite-Datenbank. Ohne Volume sind die Daten nach jedem Deploy weg.
   Nimm ein Docker-Volume. Bei einem Bind-Mount auf einen Host-Ordner muss der Ordner dem Nutzer mit der ID 1000 gehören (`chown 1000:1000 <ordner>`).
5. **Deploy** klicken. Der Healthcheck läuft über `/health`.
6. Unter `BASE_URL` anmelden. Unter **Nutzer** deinen Bruder einladen und ihm den Link schicken.

Die Admin-Variablen werden nur beim ersten Start genutzt, solange es noch keinen Nutzer gibt. Danach kannst du sie wieder entfernen.

## Claude verbinden

Jeder Nutzer macht das einmal in seinem eigenen Claude-Konto:

1. In Claude unter **Einstellungen › Connectors** einen eigenen Connector hinzufügen.
2. Als Adresse `https://quadratmeter.deine-domain.de/mcp` eintragen. Die Adresse steht auch in der App unter **Konto**.
3. Auf **Verbinden** klicken, mit dem Quadratmeter-Konto anmelden und den Zugriff erlauben.
4. In einem Chat zum Beispiel schreiben: „Analysiere diese Wohnung in Quadratmeter: https://…“

Verbindungen lassen sich unter **Konto** trennen. Wird ein Nutzer gesperrt, endet sein Claude-Zugriff sofort.

## Lokal starten

```bash
ADMIN_EMAIL=du@example.com ADMIN_PASSWORD=geheim-geheim npm run dev
# http://localhost:3000
npm test
```

Für einen lokalen Test mit Claude muss der Server per https aus dem Internet erreichbar sein, z. B. über einen Tunnel.

## Hinweise zur Rechnung

- Grunderwerbsteuersätze Stand November 2026, pro Analyse überschreibbar.
- Standardannahmen: Nebenkosten aus Eigenkapital, Kaufpreis finanziert, 3,8 % Sollzins, 2 % Tilgung, 35 % Grenzsteuersatz, 75 % Gebäudeanteil, 5 €/m² eigene Instandhaltung, 2 % Mietausfall. Claude soll die Finanzierungsdaten erfragen.
- Vereinfachungen: gleicher Zins nach der Zinsbindung, Rücklagenzuführung erst bei Verwendung absetzbar und darum in der Steuer nicht abgezogen, Verkauf ohne Verkaufskosten und steuerfrei.
- Die Analyse ersetzt keine Steuer-, Rechts- oder Finanzberatung.

## Aufbau

```
src/
  server.js        HTTP-Server
  app.js           Routen der Web-App
  oauth.js         OAuth-Server für den Connector
  mcp.js           MCP-Endpunkt (Streamable HTTP)
  tools.js         MCP-Tools und Anleitung für Claude
  store.js         Datenzugriff und Prüfung der Eingaben
  db.js            SQLite und Migrationen
  views.js         HTML-Seiten
  shared/          Rechner und Felddefinitionen (auch im Browser)
public/            CSS, Browser-Skript, Icon
test/              Tests für Rechner und den kompletten Ablauf
```
