# kontur

**Architektur wird sichtbar.**

Kontur ist ein Open-Source-Projekt für C4-basierte Softwarearchitektur als Code. Ziel ist, Architekturmodelle direkt in der IDE verständlich zu beschreiben, zu prüfen und interaktiv zu erkunden — zunächst lokal für eine Person oder ein Team, später verbunden über mehrere Git-Repositories.

Das Projekt befindet sich in der Konzept- und Aufbauphase. Die folgenden Punkte beschreiben die Zielsetzung, noch keine verfügbaren Funktionen.

## Zielsetzung

Architekturbeschreibungen sollen wie Quellcode gepflegt werden: textbasiert, versioniert und über Git überprüfbar. Aus einem gemeinsamen Modell entstehen unterschiedliche Sichten auf Systeme, Container und ihre Beziehungen.

Kontur soll dabei drei Dinge verbinden:

- **Gute Bedienbarkeit:** Modellierung in VS Code mit Sprachunterstützung, verständlichen Fehlermeldungen und einer lokalen Live-Vorschau.
- **Nachvollziehbare Architektur:** Git-versionierte Dateien bleiben die verbindliche Quelle. Diagramme und spätere zentrale Indizes werden daraus abgeleitet.
- **AI-Unterstützung:** Assistenten sollen Modelle über MCP verstehen, prüfen und Änderungen vorbereiten können. Änderungen erfolgen an den Quelldateien und durchlaufen den normalen Git-Review-Prozess.

Langfristig soll daraus ein föderiertes Architektur-Repository entstehen: Teams pflegen ihre Modelle eigenständig, während eine konsolidierte Sicht teamübergreifende Zusammenhänge sichtbar macht.

## Grundprinzipien

- **Lokal zuerst:** Modellierung und Visualisierung funktionieren offline, ohne Konto oder zentralen Dienst.
- **Eigener Rust-Kern:** Parser, Architekturmodell, Referenzauflösung, Validierung und Language Server werden in Rust entwickelt.
- **Structurizr DSL als erstes Eingabeformat:** Kontur verwendet eine eigene Implementierung und benötigt weder den Structurizr-Server noch dessen Bibliotheken. Zunächst wird ein dokumentierter Sprachumfang unterstützt; nicht unterstützte Syntax erzeugt explizite Diagnosen.
- **Ein gemeinsamer Kern:** VS-Code-Unterstützung, CLI und späterer Service verwenden dieselbe Modellverarbeitung und dieselben Prüfungen.
- **Modell und Darstellung getrennt:** Fachliche Architektur bleibt unabhängig von Layout und Visualisierung. Für Darstellung und Layout sollen bestehende Bibliotheken genutzt werden.
- **Durchgehend Open Source:** Alle Produktbestandteile stehen unter der [MIT-Lizenz](LICENSE).

## Entwicklungsschritte

| Schritt | Ziel |
| --- | --- |
| **1. Lokale Modellierung** | Architektur in einem lokalen Workspace in VS Code beschreiben, prüfen und visualisieren. |
| **2. Lokale AI-Unterstützung** | Über MCP Modelle abfragen, Konsistenz prüfen und Änderungen an lokalen Dateien vorbereiten. |
| **3. Externe Modelle referenzieren** | Architektur-Workspaces anderer Teams aus Git-Repositories über festgelegte Versionen einbinden. |
| **4. Zentrale Gesamtsicht** | Teammodelle zusammenführen und über Suche, Weboberfläche und lesenden MCP-Zugriff gemeinsam erkunden. |

## Aktueller Fokus: lokale Modellierung

Der erste Meilenstein konzentriert sich auf einen lokalen Workspace für eine Person oder ein Team. Das Modell darf auf mehrere Dateien verteilt sein.

Geplant sind:

- Ein erster DSL-Umfang mit Personen, Softwaresystemen, Containern, Beziehungen, grundlegenden Metadaten und Sichten.
- Ein eigener Language Server mit Diagnosen, Vervollständigung, Hover und Navigation zur Definition.
- Eine VS-Code-Erweiterung mit lokaler Live-Vorschau, Auswahl von Sichten, Zoom und Verschieben sowie Navigation zwischen Diagramm und Quelltext.
- Vorschau ungespeicherter Änderungen. Bei ungültigen Eingaben bleibt die letzte gültige Darstellung sichtbar und wird als veraltet gekennzeichnet.
- Möglichst stabile Diagrammlayouts während der Bearbeitung.
- Eine lokale Validierungs-CLI, deren Prüfungen auch in einer Git-Pipeline ausgeführt werden können.

**Erstes Akzeptanzszenario:** Ein Team öffnet sein Repository in VS Code, beschreibt zwei Systeme mit Containern und beschrifteten Beziehungen und kann diese lokal visualisieren und bearbeiten. Fehler werden verständlich angezeigt; Diagrammelemente führen zu ihrer Definition im Quelltext.

## Technische Richtung

Der Rust-Kern hält Architekturmodell, stabile Elementidentitäten und Quellpositionen vor. Die browserbasierte Visualisierung soll sowohl in einer VS-Code-Webview als auch später in der Weboberfläche wiederverwendbar sein.

Die Auswahl der Visualisierungs- und Layoutbibliotheken sowie die Verpackung des lokalen Kerns sind noch offen. React Flow mit ELK.js ist ein Kandidat; Mermaid wurde als mögliche Prototyp- oder Exportoption diskutiert. Die Entscheidung soll anhand eines kleinen Prototyps mit verschachtelten Containern, beschrifteten Beziehungen und Änderungen am Modell getroffen werden.
