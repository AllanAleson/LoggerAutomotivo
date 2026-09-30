# Logger Automotivo: ESP32 -> API local

## Iniciar

Backend/frontend existentes (PowerShell, pasta do firmware):

```powershell
Push-Location ..\Logger\LoggerAutomotivo
npm.cmd run dev
```

Se os servidores ja estiverem ativos, mantenha-os. Nao refaca seed/banco.

Em outro terminal, na pasta `Log-automotivo`:

```powershell
& "$env:USERPROFILE\.platformio\penv\Scripts\platformio.exe" run -e esp32dev
```

Abra essa pasta no VS Code. Pressione F1 -> **Wokwi: Start Simulator**.
Se a extensao solicitar licenca, use F1 -> **Wokwi: Request a new License**,
conclua a ativacao pelo navegador e inicie novamente. Mantenha a aba do simulador
visivel: a simulacao pode pausar quando fica oculta.

## Rede local

SSID `Wokwi-GUEST`, sem senha, canal 6. A API configurada em
`include/network_config.h` e `http://host.wokwi.internal:3333`.

O Wokwi para VS Code inclui o Private IoT Gateway e resolve esse hostname para
o computador que executa a extensao. Assim o ESP32 chega ao backend Windows em
`localhost:3333`. Nao execute um gateway separado, ngrok ou Cloudflare. Nao e
necessario `net.forward`: esse recurso encaminha conexoes do host para servidores
no ESP32, a direcao oposta a este projeto. Execute o VS Code localmente no Windows,
sem Remote SSH/WSL/container, para o gateway e backend estarem no mesmo host.

Documentacao oficial:
- https://docs.wokwi.com/vscode/project-config#iot-gateway-esp32-wifi
- https://docs.wokwi.com/guides/esp32-wifi#connecting-to-your-local-machine

## Verificar heartbeat

No Serial, espere `[WIFI] conectado` e `[HEARTBEAT] aceito - 200`.
O primeiro heartbeat e preparado imediatamente; os seguintes a cada 30 segundos
do tempo simulado. Consulte:

```powershell
Invoke-RestMethod http://localhost:3333/api/loggers/LOGGER-001 | Format-List
```

Confira `status=ONLINE`, `pieceId=PT-00018429`, `lastSeen` recente,
`firmwareVersion=0.2.0`, `batteryVoltage=12.4` (valor DEMO, nao medido) e
`pendingEvents`. O campo communicationMode existente nao e alterado pela API de
heartbeat; eventual rotulo CELLULAR no dashboard vem do cadastro anterior.

## LOCK ponta a ponta

1. Confira `[OK] Cartao SD montado.` e heartbeat 200.
2. Pressione **IN2 LOCK** por mais de 40 ms e solte.
3. Confira JSON com `event=LOCK`, `signal=IN2`, `received=ACTIVE` no Serial,
   depois `[FILA] salvo no SD` e `[HTTP] evento enviado - 201`.
4. Abra http://localhost:5173/parts/PT-00018429 e selecione **LOG**.
   Aguarde o polling (ate 15 segundos) e remova filtros de evento/nivel/data.
5. A soltura tambem gera LOCK com `received=RELEASED`, preservando o comportamento
   anterior. Repita com IN1 IGNITION, IN3 UNLOCK e IN4 WINDOW.

## Retry e armazenamento

Cada evento novo e registrado em `/logs.jsonl`, depois em `/outbox.jsonl`, antes
de qualquer POST. HTTP usa tarefa FreeRTOS separada; SD, RTC, debounce e LED
continuam na tarefa principal. Eventos sao enviados em ordem, um por vez.
Falhas HTTP mantem o evento na fila, com retry a cada 5 segundos. O cursor
confirmado fica no journal `/sent.offset`, somente apos 201. Nenhum desses
arquivos e apagado. Logs antigos anteriores a integracao ficam no arquivo
original e nao sao enviados automaticamente.

Teste: pare somente o backend, pressione os quatro botoes, confira falhas e
pendentes no Serial, reinicie o backend e observe os 201 e a fila esvaziar.
O heartbeat atualiza a contagem no proximo periodo. Ao reiniciar o dispositivo,
o firmware recupera a fila se o mesmo conteudo do SD estiver disponivel. Nao
presuma que parar/reabrir o Wokwi preserva o cartao virtual entre sessoes.

Entrega e pelo menos uma vez: resposta HTTP perdida ou checkpoint interrompido
pode duplicar um evento porque a API atual nao oferece chave de idempotencia.
400/404 tambem preservam o evento; o Serial mostra a resposta para diagnostico.
Nao ha descarte silencioso nem compactacao automatica do SD. Falhas fisicas de
escrita/cartao cheio sao sinalizadas no Serial; nesse caso nao ha garantia de
persistencia. Se apenas a escrita da outbox falhar, recupere o registro de
`logs.jsonl` antes de substituir o cartao.

O DS1307 do Wokwi inicia com a hora atual UTC. Os timestamps incluem `Z`.
Sem RTC, usa NTP; antes de NTP, a data UTC de compilacao + uptime e aproximada
e anunciada no Serial. Em hardware real, configure o RTC em UTC.

## Escopo da verificacao

Compile com o comando acima. Os artefatos permanecem em
`.pio/build/esp32dev/firmware.bin` e `.pio/build/esp32dev/firmware.elf`.
Frontend/backend e seus contratos nao foram modificados. A comprovacao visual
do clique e do dashboard exige iniciar o simulador no VS Code.
