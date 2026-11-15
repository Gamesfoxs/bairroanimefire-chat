# Bairro Anime Fire — Chat (PWA)

Chat em tempo real estilo Discord para celular e PC. Marca: **Bairro Anime Fire**.

## Stack

- Node.js + Express + Socket.io
- SQLite via `sql.js` (sem compilação nativa; fácil de rodar na Hostinger Node)
- Frontend vanilla (HTML/CSS/JS) + PWA (manifest + service worker)
- Auth: JWT (Bearer + cookie) + bcrypt

## Como rodar

```bash
cd bairroanimefire-chat
cp .env.example .env   # opcional — edite JWT_SECRET
npm install
npm start
```

Abra `http://localhost:3000` (ou a porta em `PORT`).

Desenvolvimento com reload:

```bash
npm run dev
```

## Variáveis de ambiente

| Variável     | Padrão                                      | Descrição                          |
|--------------|---------------------------------------------|------------------------------------|
| `PORT`       | `3000`                                      | Porta HTTP                         |
| `JWT_SECRET` | `bairro-anime-fire-dev-secret-change-me`    | Segredo para assinar tokens JWT    |
| `DB_PATH`    | `./data/chat.db`                            | Caminho do arquivo SQLite          |
| `NODE_ENV`   | `development`                               | Ambiente                           |

> MySQL depois: a camada em `src/db/index.js` exporta `run/get/all/exec`. Dá para trocar por `mysql2` lendo `DATABASE_URL` sem mudar as rotas.

## Funcionalidades (MVP)

1. **Registro / login** com usuário + senha  
2. Servidor padrão **Bairro Anime Fire** com canais `#geral`, `#anime`, `#jogos`  
3. Chat em tempo real nos canais (Socket.io)  
4. Mensagens diretas (DM) entre usuários  
5. Presença online  
6. Lista de amigos (pedido por username + aceitar)  
7. Layout responsivo estilo Discord (rail de servidores, canais, chat, membros)  
8. UI em **português (pt-BR)**  
9. PWA instalável no celular e no PC  

## Scripts

- `npm start` — produção  
- `npm run dev` — nodemon  

## Estrutura

```
server.js              # Express + Socket.io
src/db/                # SQLite (sql.js)
src/routes/            # auth, servers, friends, dms
src/socket/            # eventos em tempo real
src/middleware/        # JWT
public/                # frontend + PWA
data/                  # chat.db (criado em runtime)
```

## Deploy (Hostinger Node)

O pai/agente faz o deploy depois da autenticação Hostinger. Localmente basta `npm start` com `PORT` definido pelo painel.

## Atualização 14/11/2026 — salas privadas e voz da guilda

- Autenticação exclusivamente pelo SSO da Conta BairroAnimeFire, cookies HttpOnly (sem JWT em localStorage).
- Servidores próprios com acesso por convite, códigos aleatórios, validade de 7 dias e até 30 usos.
- Somente o dono cria convites e canais; convidados entram nos canais do servidor.
- Canais de texto e mensagens diretas com Socket.IO e verificação de membros antes de entrar em rooms.
- Somente amigos confirmados ou membros de um mesmo servidor privado podem iniciar uma DM.
- Canais de voz WebRTC (até 10 conexões por sala) via sinalização autenticada no Socket.IO. Áudio P2P, sem gravação no servidor.
- Microfone ativado só pelo clique de entrar; controle de mudo e sair; responsividade para PC e celular.
- Origem HTTP e WebSocket restrita ao subdomínio do chat; páginas privadas sem indexação.
- Banco SQLite com salvamento por substituição atômica; preservar backup do banco antes de atualizações.
- QA: testes de SSO não autenticado, convites, controle de acesso, DMs, mensagens e sinalização em staging.

**Limites:** chamadas de voz podem falhar em redes NAT restritivas sem TURN, e testes automatizados de sinalização não substituem duas chamadas reais. Ainda não há vídeo, compartilhamento de tela, anexos S3, permissões avançadas, moderação completa nem criptografia ponta a ponta das mensagens.


## Administração e arquivos (novembro de 2026)

Cada servidor tem um dono. O dono acessa **🛡️ Administração** na barra lateral,
pode renomear o servidor, promover ou remover moderadores, expulsar, banir,
desbanir e apagar mensagens. Moderadores podem convidar, criar canais,
expulsar/banir membros comuns e apagar mensagens. As permissões são verificadas
no servidor a cada ação. Expulsar/banir remove o acesso ao servidor e às salas.

No chat e no PV, os botões **📎** e **GIF** enviam PNG/JPEG/WEBP/GIF (até 8 MiB)
ou MP4/WEBM (até 24 MiB). O botão GIF abre o seletor de arquivos GIF do aparelho;
não inclui pesquisa online. Os anexos são salvos **no S3 privado**, nunca como
arquivos permanentes na VPS. Os destinatários autorizados recebem links S3
temporários após autenticação. Há limites de 40 uploads ou 250 MiB por pessoa
em 24 horas. Uploads abandonados há mais de 24 horas são limpos periodicamente.

Configure os valores MEDIA_S3_* no .env local usando credenciais S3
apropriadas, com o prefixo separado. NÃO inclua chaves no Git.
Para uploads de vídeo acima de 10 MiB, o proxy Nginx do chat precisa permitir
corpos de até 24 MiB em /api/media/upload; recomendável usar
proxy_request_buffering off somente nessa rota.

Cuidado: mídia compartilhada não é criptografada de ponta a ponta, e links
temporários ainda funcionam até expirar. Não trate isso como um cofre de dados.


## Melhorias de qualidade e experiência

- **Câmera:** escolha Automática, HD 720p, Equilibrada 540p ou Economia de dados 360p nas salas de voz. O modo Automático favorece qualidade no computador, equilíbrio no celular e economia se a conexão estiver marcada para reduzir dados. A resolução e o bitrate são limites desejados, não garantias de qualidade em toda rede.
- **Áudio:** mantém cancelamento de eco, supressão de ruído e controle de ganho do navegador. A chamada é P2P/WebRTC; sem servidor TURN, a conexão pode falhar entre redes restritas.
- **Anexos:** prévia de imagem/GIF, barra de upload, envio por colar ou arrastar arquivo e zoom de fotos. Os arquivos são enviados ao S3 sem recompressão pelo frontend, respeitando os limites de 8 MiB por imagem/GIF e 24 MiB por vídeo.
- **Conversas:** sincronização ao reconectar; mensagens novas recebidas durante o carregamento são mescladas e deduplicadas. Respostas tardias da conversa anterior são descartadas.
- **Acessibilidade:** zoom acionável por teclado, interface com adaptação à tela e respeito a preferência de movimento reduzido.

Validação sem navegador: execute node tests/quality-smoke.js. Testes de chamada entre aparelhos reais e largura mobile em navegador físico continuam necessários.


## Consolidação profissional (novembro de 2026)

Esta etapa reforça o chat existente sem substituir contas, conversas ou mídias:

- Cabeçalhos Content-Security-Policy, X-Frame-Options e Permissions-Policy, com scripts carregados somente da origem do chat; a inicialização PWA foi transferida para o arquivo JavaScript.
- Dados de cor dos perfis recebem validação hexadecimal; nomes e ícones de servidor são exibidos como texto. Botões de mensagem nos membros também funcionam por toque e teclado.
- Mensagens privadas não lidas possuem contadores por conta guardados no SQLite, sincronizados quando a conversa é aberta, com indicador no menu e no título do navegador.
- Em caso de desconexão, o chat exibe um aviso e bloqueia o envio até a conexão retornar. O histórico já tinha sincronização ao reconectar.
- Controles moderados de frequência para envio de mensagens, indicador de digitação e negociação WebRTC, mantendo limite de até 10 participantes por sala.
- Testes de integração com contas de teste e banco isolado cobrem leitura de PV, restrição de acesso, segurança de origem, sinalização Socket.IO e limite de mensagens.

Em desenvolvimento a confirmação vem dos testes de código e serviços. Testes de qualidade em dispositivos reais, TURN para redes restritas e escalabilidade além de grupos pequenos ainda são trabalhos futuros.
