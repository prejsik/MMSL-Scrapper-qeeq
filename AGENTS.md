# Zasady dla agentów (Codex i Claude Code)

Ten plik czytają oba narzędzia; `CLAUDE.md` tylko go importuje. Repozytorium jest publiczne.

## Gałąź główna

Gałąź główna tego repo to `main` (do 22.11.2026 nazywała się `codex/qeeq-tool`): od niej zakładaj gałęzie i do niej kieruj PR-y.

Starsza kopia na laptopie może nadal stać na `codex/qeeq-tool`. Przestaw ją raz: `git fetch origin; git branch -m codex/qeeq-tool main; git branch -u origin/main main; git remote set-head origin -a`.

## Automaty (stan 18.11.2026)

- „QEEQ gated daily” jest wyłączony przez GitHub za brak aktywności w repo (ostatni przebieg 21.10.2026). Włączaj go tylko na wyraźną prośbę.
- `gh workflow run` uruchamiaj tylko na wyraźną prośbę.

## Testy

- Lokalnie: `npm test`.
- Na GitHubie „QEEQ bounded smoke” startuje po pushu zmian w `src/qeeq/`, `tests/run-qeeq-tests.js`, konfiguracji, `package*.json` lub workflowach QEEQ. Inne zmiany nie mają testów na GitHubie i wtedy o scaleniu decyduje `npm test` uruchomiony lokalnie.

## Publiczne repo

Wyniki (`output/`), sekrety i dane osobowe zostają poza commitami. Konfiguracja trafia do repo tylko jako `*.example.json`.
