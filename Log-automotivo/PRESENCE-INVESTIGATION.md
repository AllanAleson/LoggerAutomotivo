# Investigação de presença — 30/09/2026

## Evidência anterior à correção

Consultas reais à API local, sem enviar heartbeat artificial:

| Relógio UTC observado | lastSeen do LOGGER-001 | Status |
| --- | --- | --- |
| 13:39:10Z | 10:39:04Z | OFFLINE |
| 13:39:36.473Z (health do backend) | 10:39:35Z | OFFLINE |

O valor persistido mudou durante os heartbeats. No segundo registro, a idade calculada foi 10.801,473 segundos. Não é apenas exibição UTC-03: os dois valores comparados são instantes UTC, com Z. Dashboard retornou online=0/offline=1; pesquisa e detalhes retornaram OFFLINE com o mesmo lastSeen.

## Rastreamento

- POST /api/loggers/:loggerId/heartbeat validava o payload e persistia o timestamp do dispositivo em loggers.last_seen (TIMESTAMPTZ), status ONLINE, telemetria e updated_at. O 200 não significava que a consulta de presença consideraria esse instante recente.
- GET /api/loggers/:loggerId e GET /api/loggers usam normalizePart/effectiveStatus.
- GET /api/dashboard consulta o mesmo campo e usa a mesma effectiveStatus.
- Pesquisar Peça usa GET /api/parts?search=...; detalhes usam GET /api/parts/:pieceId. Ambos usam normalizePart/effectiveStatus.
- Há uma única regra de status efetivo no backend. A coluna status é o estado armazenado, enquanto o GET aplica o timeout.
- O frontend apresenta status fornecido pela API. Não recalcula OFFLINE com lastSeen. Intl.DateTimeFormat apenas converte a apresentação para o horário local.
- Dashboard, dispositivos e detalhes já atualizavam a cada 15 segundos. Pesquisa fazia uma consulta por mudança de termo e mantinha estado React antigo; agora também atualiza a cada 15 segundos.
- Não foi encontrada camada de cache da aplicação para esses dados. As respostas de API agora declaram Cache-Control: no-store para impedir reutilização de uma representação de presença antiga.
- POST /api/events já atualizava last_seen, comportamento documentado também na tela Configurações. Isso permanece intencional: receber um evento válido comprova comunicação. Usar o horário do evento fazia eventos antigos sincronizados regredirem a presença.
- O servidor executava seed automaticamente ao iniciar, sobrescrevendo last_seen e telemetria. Esse seed automático foi removido; reinício da API não executa seed.

## Correção e regra final

Heartbeat e eventos válidos persistem last_seen=NOW() no banco, horário do recebimento. O timestamp original do evento continua preservado em events.timestamp. Nenhuma conversão ou compensação manual de três horas foi aplicada.

effectiveStatus compara os instantes em milissegundos, usa Date.getTime() diretamente quando o driver retorna Date, e trata data ausente/inválida como OFFLINE. Idade maior que OFFLINE_THRESHOLD_MINUTES × 60.000 significa OFFLINE; até esse limite significa ONLINE, preservando WARNING quando armazenado. O padrão continua 10 minutos. Heartbeat e evento recebido colocam o estado armazenado em ONLINE. Todas as consultas de status compartilham essa regra.

Arquivos da aplicação alterados:

- backend/src/app.ts
- backend/src/server.ts
- backend/test/api.test.ts
- frontend/src/App.tsx

## Verificação automatizada

npm test: 9 testes passaram. npm run build: backend TypeScript e frontend TypeScript/Vite passaram. git diff --check passou.

Novo teste usa banco PGlite isolado em memória, sem seed, com timezone America/Sao_Paulo. Verifica logger individual, lista, dashboard, pesquisa e detalhe para: ausência de comunicação, heartbeat, intervalo de 30 segundos, limite exato de 10 minutos, expiração um milissegundo depois e novo heartbeat. Verifica timestamps de dispositivo antigos, futuros e com offset, persistência de lastSeen, telemetria, ausência de cache e preservação do timestamp de evento antigo. A suíte preexistente usa dados de demonstração somente em seu banco em memória; o banco real não recebeu seed.

## Validação em tempo real

A API corrigida foi iniciada em localhost:3333 com backend/dist/server.js, mantendo o banco existente e sem seed. Não houve alteração no firmware nem remoção de eventos.

Execute no diretório Log-automotivo:

```powershell
.\monitor-presence.ps1 -Samples 12 -IntervalSeconds 10
```

Com Wokwi ativo, lastSeen deve avançar aproximadamente a cada 30 segundos; logger/search/part devem ser ONLINE e o dashboard online=1/offline=0. Recarregue uma vez a página para garantir que o frontend corrigido esteja carregado. Todas essas telas consultam a API a cada 15 segundos.

Pare o Wokwi e aguarde mais de 10 minutos desde a última comunicação (heartbeat ou evento). As próximas consultas devem retornar OFFLINE, online=0/offline=1. Reinicie o Wokwi: o primeiro heartbeat recebido deve recuperar ONLINE e a interface deve refletir isso na próxima atualização.

Após o reinício da API, as primeiras consultas ainda retornavam lastSeen=10:40:35Z: nenhum heartbeat novo havia chegado naquele intervalo. O retorno real para ONLINE depende de retomar a simulação; isso não deve ser confundido com a validação automatizada já concluída.
