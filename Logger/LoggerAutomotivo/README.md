# Logger IoT Automotivo

MVP de diagnóstico remoto para peças automotivas monitoradas por Loggers externos. O sistema recebe eventos genéricos por HTTP, mantém peças e Loggers como entidades distintas, registra a associação entre eles e apresenta pesquisa, logs, diagnóstico, histórico, alertas e exportação CSV em um dashboard técnico.

## Arquitetura e stack

```text
ESP32 / simulador -> REST API (Express + TypeScript) -> PostgreSQL -> React + Vite
```

- `backend/`: API REST, validação Zod, migrations SQL e seed.
- `frontend/`: dashboard React/TypeScript responsivo.
- `backend/migrations/`: schema PostgreSQL versionado.
- `backend/data/`: PostgreSQL embutido local e persistente (ignorado pelo Git).

No desenvolvimento local, a API usa PGlite, uma distribuição PostgreSQL embutida, para funcionar sem Docker ou instalação de servidor. Ao definir `DATABASE_URL`, o mesmo backend usa um PostgreSQL convencional por meio do driver `pg`. O modelo inclui `part_logger_assignments`, permitindo trocar ou reassociar um Logger no futuro sem confundir `pieceId` com `loggerId`.

## Execução rápida

Pré-requisito: Node.js 22 ou superior.

```powershell
npm.cmd install
Copy-Item .env.example .env
npm.cmd run db:migrate
npm.cmd run db:seed
npm.cmd run dev
```

Abra `http://localhost:5173`. A API estará em `http://localhost:3333`. Pesquise por `PT-00018429`, `SN-2026-18429` ou `LOGGER-001`.

O comando `npm run dev` inicia frontend e backend juntos. O backend também aplica a migration e garante o seed ao iniciar. Os comandos explícitos de banco foram mantidos para preparação e automação de ambientes.

Para validar:

```powershell
npm.cmd test
npm.cmd run build
```

## PostgreSQL externo

Defina uma conexão PostgreSQL no `.env`:

```env
DATABASE_URL=postgresql://logger:logger@localhost:5432/logger_automotivo
PORT=3333
CORS_ORIGIN=http://localhost:5173
OFFLINE_THRESHOLD_MINUTES=10
```

Depois execute `npm.cmd run db:migrate` e `npm.cmd run db:seed`. Se `DATABASE_URL` ficar vazio, o banco embutido será usado. Não coloque credenciais reais no repositório.

O arquivo `docker-compose.yml` inclui um PostgreSQL opcional. Com Docker disponível, execute `docker compose up -d postgres`, copie a `DATABASE_URL` do exemplo acima para o `.env` e rode migration e seed. O Docker não é necessário para a demonstração local com PGlite.

## Endpoints

| Método | Rota | Uso |
|---|---|---|
| GET | `/api/health` | Saúde da API e banco |
| GET | `/api/dashboard` | Métricas e ocorrências resumidas |
| GET | `/api/parts?search=...` | Pesquisa por peça, série ou Logger |
| GET | `/api/parts/:pieceId` | Detalhes da peça e Logger atual |
| GET | `/api/parts/:pieceId/events` | Eventos com filtros e paginação |
| GET | `/api/parts/:pieceId/events/export` | Download CSV dos eventos filtrados |
| GET | `/api/parts/:pieceId/diagnosis` | Falha mais relevante para diagnóstico |
| GET | `/api/loggers` | Lista resumida de Loggers |
| GET | `/api/loggers/:loggerId` | Detalhes de um Logger |
| GET | `/api/alerts` | Alertas ordenados por prioridade |
| POST | `/api/events` | Ingestão de evento do Logger/ESP32 |
| POST | `/api/loggers/:loggerId/heartbeat` | Atualização de presença e telemetria |

Filtros de eventos: `level`, `event`, `startDate`, `endDate`, `limit` e `page`. Datas usam ISO 8601 com fuso. A exportação CSV aceita os mesmos filtros, exceto paginação, e limita cada arquivo a 10.000 registros.

## Integração do ESP32

O firmware precisará configurar somente a URL base e o identificador do Logger já cadastrado:

```text
API_BASE_URL=http://IP-DO-COMPUTADOR:3333
LOGGER_ID=LOGGER-001
```

Em um ESP32 físico, `localhost` aponta para o próprio microcontrolador; use o IP acessível do computador. O header obrigatório hoje é `Content-Type: application/json`.

### Enviar evento

```bash
curl -X POST http://localhost:3333/api/events \
  -H "Content-Type: application/json" \
  -d '{
    "loggerId": "LOGGER-001",
    "timestamp": "2026-09-09T08:15:32-03:00",
    "level": "ERROR",
    "event": "RESPONSE_TIMEOUT",
    "signal": "LOCK_RESPONSE",
    "expected": "HIGH",
    "received": "NONE",
    "result": "FAIL",
    "possibleCause": "Possível falha de conexão, saída ou componente.",
    "evidence": ["Comando detectado", "Logger permaneceu operacional", "Resposta esperada não foi detectada"]
  }'
```

Sucesso: HTTP `201 Created`.

```json
{
  "success": true,
  "eventId": "uuid-do-evento",
  "receivedAt": "2026-09-09T11:15:32.000Z"
}
```

A API retorna `400` para JSON inválido ou campos fora do contrato e `404` quando o `loggerId` não está cadastrado. Um evento aceito atualiza `lastSeen` e coloca o Logger como `ONLINE`. Os nomes de `event` e `signal` são genéricos; a API não está acoplada a LOCK/UNLOCK.

### Enviar heartbeat

```bash
curl -X POST http://localhost:3333/api/loggers/LOGGER-001/heartbeat \
  -H "Content-Type: application/json" \
  -d '{
    "timestamp": "2026-09-09T08:20:00-03:00",
    "batteryVoltage": 12.4,
    "firmwareVersion": "0.1.0",
    "pendingEvents": 0
  }'
```

Sucesso: HTTP `200 OK`. O heartbeat atualiza `lastSeen`, status, tensão, firmware e quantidade pendente. Sem evento ou heartbeat pelo tempo definido em `OFFLINE_THRESHOLD_MINUTES`, as consultas apresentam o Logger como `OFFLINE`.

## Fluxo da demonstração

1. Abra o dashboard e escolha **Pesquisar Peça**.
2. Pesquise `PT-00018429` e abra o dispositivo.
3. Confira `LOGGER-001`, status e telemetria na Visão Geral.
4. Na aba Log, filtre período/severidade e use **Download log**.
5. Veja esperado × recebido e evidências em Diagnóstico.
6. Consulte as falhas anteriores em Histórico.
7. Envie um evento ou heartbeat com os exemplos acima; a interface atualiza por polling em até 15 segundos.

## Próximos passos para o ESP32

Antes da integração em ambiente real, falta cadastrar o `loggerId` físico no banco, definir o endereço de rede acessível pelo dispositivo e implementar no firmware o POST JSON com fila/retry. Para produção, também devem ser adicionadas credenciais individuais por Logger, TLS, idempotência por identificador de evento e uma política de retenção. Esses itens não alteram o contrato básico demonstrado pelo MVP.
