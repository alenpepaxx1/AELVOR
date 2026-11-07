// Copyright © 2026 Alen Pepa
import { attributeMarkdown } from "./copyright.ts";
export type Locale = "en" | "de";
export type AgentMode = "auto" | "investigate" | "build" | "learn";

export const templates = [
  { id: "review", icon: "code", category: { en: "CODE REVIEW", de: "CODE-REVIEW" }, title: { en: "Find the weak spot", de: "Schwachstellen finden" }, description: { en: "Turn vulnerable code into a stronger foundation.", de: "Aus anfälligem Code eine sichere Basis machen." }, prompt: { en: "Review this Python code for SQL injection and show a safer version:\n\nquery = \"SELECT id FROM users WHERE name = '\" + username + \"'\"\ncursor.execute(query)", de: "Prüfe diesen Python-Code auf SQL-Injection und zeige eine sichere Version:\n\nquery = \"SELECT id FROM users WHERE name = '\" + username + \"'\"\ncursor.execute(query)" }, mode: "investigate" },
  { id: "incident", icon: "scan", category: { en: "THREAT ANALYSIS", de: "BEDROHUNGSANALYSE" }, title: { en: "Make sense of a threat", de: "Bedrohungen verstehen" }, description: { en: "Go from a suspicious signal to a clear plan.", de: "Vom verdächtigen Signal zum klaren Plan." }, prompt: { en: "Create an incident response checklist for a suspected phishing email.", de: "Erstelle eine Incident-Response-Checkliste für eine verdächtige Phishing-E-Mail." }, mode: "investigate" },
  { id: "script", icon: "terminal", category: { en: "BUILD & AUTOMATE", de: "ERSTELLEN & AUTOMATISIEREN" }, title: { en: "Build your next tool", de: "Dein nächstes Tool bauen" }, description: { en: "Create useful scripts, one conversation at a time.", de: "Nützliche Skripte im Gespräch entwickeln." }, prompt: { en: "Write a Python command-line script to calculate a file's SHA-256 hash.", de: "Schreibe ein Python-Kommandozeilenskript, das den SHA-256-Hash einer Datei berechnet." }, mode: "build" },
  { id: "learn", icon: "fingerprint", category: { en: "LEARN & EXPLORE", de: "LERNEN & ENTDECKEN" }, title: { en: "Connect the dots", de: "Zusammenhänge erkennen" }, description: { en: "Understand complex security ideas, simply.", de: "Komplexe Sicherheitskonzepte einfach verstehen." }, prompt: { en: "Explain Zero Trust with a practical example and a short implementation checklist.", de: "Erkläre Zero Trust mit einem praktischen Beispiel und einer kurzen Checkliste zur Umsetzung." }, mode: "learn" },
] as const;

export function playbookRequest(id: string, locale: Locale) {
  const template = templates.find(item => item.id === id);
  return template ? { text: template.prompt[locale], mode: template.mode, engine: "tools" as const } : undefined;
}

const hashScript = `import argparse
import hashlib
from pathlib import Path

def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("file", type=Path)
    args = parser.parse_args()
    try:
        print(f"{sha256_file(args.file)}  {args.file}")
    except OSError as error:
        parser.exit(1, f"Error: {error}\\n")`;

function rawExampleResponse(id: string, locale: Locale): string {
  if (id === "review") return locale === "de" ? `## Die Schwachstelle: SQL-Injection
Der Benutzername wird direkt in die SQL-Abfrage eingefügt. Dadurch können Eingaben als SQL-Code interpretiert werden.

### Sichere Variante mit sqlite3
\`\`\`python
# Der Wert wird getrennt vom SQL-Befehl übergeben.
cursor.execute(
    "SELECT id FROM users WHERE name = ?",
    (username,),
)
user = cursor.fetchone()
\`\`\`
### Warum das hilft
- Platzhalter trennen SQL-Code und Daten.
- Manuelles Escaping ist nicht erforderlich.
- Die Datenbankverbindung sollte nur die benötigten Rechte haben.

**Beachte:** Die Platzhalter-Syntax hängt vom Datenbanktreiber ab. Dies ist ein Beispiel für Python sqlite3. Prüfe außerdem Authentifizierung und Zugriffsrechte der gesamten Anwendung.` : `## The weak spot: SQL injection
The username is concatenated directly into the query. This allows user input to be interpreted as SQL syntax.

### A safer version with sqlite3
\`\`\`python
# Pass the value separately from the SQL statement.
cursor.execute(
    "SELECT id FROM users WHERE name = ?",
    (username,),
)
user = cursor.fetchone()
\`\`\`
### Why this works
- Parameterized queries keep SQL syntax separate from data.
- You do not need to escape the username manually.
- Give the database connection only the permissions it needs.

**Note:** Placeholder syntax varies between database drivers. This example uses Python sqlite3. Authentication and authorization still need their own review.`;
  if (id === "incident") return locale === "de" ? `## Phishing: die ersten Schritte
**Ziel:** Den Vorfall eingrenzen, Beweise sichern und den tatsächlichen Umfang ermitteln.

### 1. Eingrenzen
- Keine Links öffnen, Anhänge ausführen oder auf die Nachricht antworten.
- Die Nachricht über den vorgesehenen Meldeweg an das Sicherheitsteam weitergeben.
- Falls ein Anhang ausgeführt wurde: Das betroffene Gerät nach dem Incident-Response-Verfahren vom Netzwerk isolieren.

### 2. Beweise sichern
- Originalnachricht einschließlich vollständiger E-Mail-Header aufbewahren.
- Empfangszeit, Empfänger und bereits erfolgte Interaktionen dokumentieren.
- Verdächtige URLs als Text erfassen, ohne sie aufzurufen.

### 3. Umfang prüfen
- Mail-Logs nach identischen Absendern, Domains und Nachrichten durchsuchen.
- Bei eingegebenen Zugangsdaten: Sitzungen widerrufen, Kennwort über einen vertrauenswürdigen Weg ändern und MFA prüfen.
- Unerwartete Weiterleitungsregeln und Anmeldungen untersuchen.

### 4. Bereinigen und nachbereiten
- Bestätigte schädliche Nachrichten und Indikatoren nach Freigabe blockieren.
- Maßnahmen, Verantwortliche und Zeitpunkte dokumentieren.
- Erkennung und Schulung anhand der Erkenntnisse verbessern.

Dies ist eine vorbereitete Beispiel-Checkliste; es wurde kein Postfach oder Gerät untersucht.` : `## Phishing: your first-response checklist
**Objective:** Contain the incident, preserve evidence, and establish the actual scope.

### 1. Contain
- Do not open links, run attachments, or reply to the message.
- Report it through your organization's security channel.
- If an attachment ran, isolate the affected device according to your incident response procedure.

### 2. Preserve evidence
- Keep the original email with its full headers.
- Record the time received, recipients, and any interactions.
- Capture suspicious URLs as text without visiting them.

### 3. Establish scope
- Search mail logs for related senders, domains, and messages.
- If credentials were entered, revoke sessions, reset the password through a trusted channel, and review MFA.
- Investigate unexpected forwarding rules and sign-ins.

### 4. Recover and improve
- Block confirmed malicious indicators and remove messages after approval.
- Record actions, owners, and timestamps.
- Improve detection and awareness based on the findings.

This is a prepared example checklist. No mailbox or device has been inspected.`;
  if (id === "script") return locale === "de" ? `## Ein SHA-256-Tool für die Kommandozeile
Dieses Skript liest die Datei in Blöcken, damit auch große Dateien nicht vollständig in den Arbeitsspeicher geladen werden.

\`\`\`python
${hashScript}
\`\`\`
### Verwendung
Speichere den Code als **file_hash.py** und führe ihn lokal aus:
\`\`\`bash
python file_hash.py /pfad/zur/datei
\`\`\`
**Einordnung:** Ein Hash hilft beim Vergleich der Dateiintegrität. Er beweist allein weder die Herkunft einer Datei noch, dass sie ungefährlich ist. Vergleiche ihn mit einer vertrauenswürdigen Referenz. Das Skript wurde hier nicht ausgeführt.` : `## A small SHA-256 command-line tool
This script reads the file in chunks, so it also works with large files without loading the whole file into memory.

\`\`\`python
${hashScript}
\`\`\`
### Run it
Save the code as **file_hash.py**, then run it locally:
\`\`\`bash
python file_hash.py /path/to/file
\`\`\`
**Keep in mind:** A hash helps compare file integrity. It does not by itself prove a file's origin or safety. Compare it against a trusted reference. This script has not been executed here.`;
  return locale === "de" ? `## Zero Trust: jede Anfrage prüfen
Zero Trust bedeutet, dass der Zugriff auf eine Ressource anhand von Identität, Gerätezustand und Kontext bewertet wird. Der Standort im Firmennetz allein ist kein Vertrauensbeweis.

### Ein praktisches Beispiel
Eine Mitarbeiterin möchte auf das interne Ticketsystem zugreifen. Der Zugriff setzt eine verifizierte Identität mit MFA, ein verwaltetes und aktuelles Gerät sowie eine passende Rolle voraus. Ändert sich das Risiko, kann eine erneute Anmeldung erforderlich sein.

### Checkliste zur Umsetzung
1. Anwendungen, Daten und Zugriffswege inventarisieren.
2. Zentrale Identitäten und phishingresistente MFA einführen.
3. Minimale Berechtigungen und regelmäßige Zugriffsprüfungen nutzen.
4. Gerätezustand in Zugriffsentscheidungen einbeziehen.
5. Systeme segmentieren und Zugriffe protokollieren.
6. Mit einer Anwendung starten, Auswirkungen messen und schrittweise erweitern.

**Merksatz:** Explizit prüfen, minimale Rechte vergeben und einen möglichen Einbruch berücksichtigen. Zero Trust ist ein Architekturansatz, kein einzelnes Produkt.` : `## Zero Trust: verify each request
Zero Trust evaluates access using identity, device health, and context. Being inside the company network is not enough to establish trust.

### A practical example
An employee opens an internal ticketing application. Access requires a verified identity with MFA, a managed and up-to-date device, and the right role. If the risk changes, the system may require authentication again.

### Implementation checklist
1. Inventory applications, data, and access paths.
2. Centralize identity and introduce phishing-resistant MFA.
3. Apply least privilege and review access regularly.
4. Include device health in access decisions.
5. Segment systems and log access.
6. Pilot with one application, measure the impact, and expand gradually.

**Remember:** Verify explicitly, grant least privilege, and assume a breach is possible. Zero Trust is an architectural approach, not a single product.`;
}

export function exampleResponse(id: string, locale: Locale): string { return attributeMarkdown(rawExampleResponse(id, locale)); }
