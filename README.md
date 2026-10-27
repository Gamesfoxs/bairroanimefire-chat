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
