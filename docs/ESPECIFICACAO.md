# Bairro Anime Fire — rede social estilo Discord + WhatsApp

Especificação completa: o que o Discord e o WhatsApp têm, o que o Bairro já entrega hoje, a direção visual (anime / escuro), a stack que aproveita o que já está no ar e um roadmap em fases.

Fontes abertas em 15 de novembro de 2026 (America/Sao_Paulo):

- [chat.bairroanimefire.com](https://chat.bairroanimefire.com)
- [bairroanimefire.com/novidades.php](https://bairroanimefire.com/novidades.php)
- Repositório público [Gamesfoxs/bairroanimefire-chat](https://github.com/Gamesfoxs/bairroanimefire-chat)

---

## Sumário

1. [Visão geral](#visão-geral)
2. [O que está no ar hoje](#o-que-está-no-ar-hoje)
3. [Tudo que Discord e WhatsApp têm — no idioma do Bairro](#tudo-que-discord-e-whatsapp-têm--no-idioma-do-bairro)
4. [Análise de lacunas](#análise-de-lacunas)
5. [Direção visual — Fogo Neon](#direção-visual--fogo-neon)
6. [Stack sugerida](#stack-sugerida--construir-em-cima-do-que-já-roda)
7. [Roadmap em fases](#roadmap-em-fases)

---

## Visão geral

> **Os dois lados já foram acessados.** O chat em https://chat.bairroanimefire.com respondeu 200 (Cloudflare + PWA Node). O GitHub autenticado é Gamesfoxs; o único repositório da conta é Gamesfoxs/bairroanimefire-chat, público, em JavaScript, com último push em 14 de novembro de 2026 às 23:42 (America/Sao_Paulo). O site principal em PHP também foi lido pela página de Novidades e Sobre.

| Indicador | Valor |
| --- | --- |
| Chat no ar | PWA |
| Conta única com o site | SSO |
| Pessoas por sala de voz (P2P) | 10 |
| Próximo salto de produto | Fase 2 |

### A ideia do produto

O Bairro Anime Fire já é uma rede social brasileira de anime, mangá e games: feed, Bairros, amigos, mensagens, calls, XP e um Chat Global. Em paralelo, o subdomínio de chat é um cliente estilo Discord — rail de servidores, canais, PVs, voz, câmera e administração. O destino é juntar o melhor dos dois mundos: comunidades e voz no jeito Discord, conversas íntimas, status e chamadas no jeito WhatsApp, com a cara de anime escuro que o Bairro já tem.

### Promessa para o morador

Um lugar só para a tropa: entrar com a mesma conta do site, criar ou entrar numa guilda por convite, conversar em canais, mandar um PV, ligar com voz e câmera, postar no feed, subir de nível e acompanhar status dos amigos — no PC, no celular e no app, em português, sem anúncio no meio da conversa.

### Três camadas, um produto

| Camada | Referência | Papel no Bairro |
| --- | --- | --- |
| Comunidades | Discord (servidores) + Bairros | Guildas com canais, cargos, convites e voz |
| Conversas | WhatsApp (PV, grupos, status) | DMs, grupos íntimos, recados e stories da galera |
| Rede social | O que o site já é | Feed, Fagulhas, animes, XP, perfil e descoberta |

---

## O que está no ar hoje

Leitura direta do HTML/CSS/JS de chat.bairroanimefire.com, do README e do código em Gamesfoxs/bairroanimefire-chat, e da página de Novidades do site principal (até a nota 2026.10.22, PHP 8.5.12).

### chat.bairroanimefire.com

PWA em português, tema roxo-escuro (`#1a0a2e`), login exclusivo por “Entrar com BairroAnimeFire” (SSO, cookie HttpOnly, sem senha separada). Layout de quatro colunas no PC: rail de servidores (72px), sidebar de canais/amigos (240px), chat e painel de membros (220px). No celular, drawers e botões no cabeçalho.

| Recurso no chat | Situação | Como funciona hoje |
| --- | --- | --- |
| Servidores | Tem | Criar guilda, ícone emoji, acesso por convite (validade 7 dias, até 30 usos). Só dono/mod cria convite e canal. |
| Servidor padrão | Tem | Bairro Anime Fire com canais `#geral`, `#anime`, `#jogos` e um canal de voz automático por servidor. |
| Chat de texto | Tem | Socket.IO, até 2000 caracteres, indicador de digitação, reconexão com banner, limite de 16 mensagens / 10s; respostas citadas, reações por emoji, edição e exclusão com permissões. |
| DMs | Tem | Só entre amigos confirmados ou membros do mesmo servidor privado. Contador de não lidas no rail e no título da aba, respostas, reações e busca restrita aos participantes. |
| Amigos | Tem | Adicionar por nome de usuário, pedidos pendentes, lista na home. |
| Presença | Parcial | Online/offline visível para amigos e membros do mesmo servidor privado. |
| Voz e vídeo | Parcial | WebRTC P2P até 10 pessoas: entrar, mudo, câmera, transmitir tela, qualidade Auto / 720p / 540p / 360p. Áudio com eco e ruído do navegador. Sem gravação no servidor. |
| Mídia | Tem | PNG, JPEG, WEBP, GIF até 8 MiB; MP4/WEBM até 24 MiB; mensagem de voz gravada no navegador até 90 s / 8 MiB (se suportado). S3 privado, links temporários, prévia, colar/arrastar, barra de progresso, zoom. Limite 40 envios ou 250 MiB por pessoa / 24h. |
| GIF | Parcial | O botão abre o seletor de arquivo GIF do aparelho — não há pesquisa Tenor/Giphy. |
| Administração | Tem | Dono: renomear, promover/remover mods, expulsar, banir, desbanir, apagar mensagens, ver auditoria. Mod: convidar, criar canais, expulsar/banir comuns e apagar mensagens. Permissões checadas no servidor. |
| Segurança | Tem | CSP, X-Frame-Options, Permissions-Policy (câmera, microfone, tela), origem travada no subdomínio, noindex, rate-limit de sinalização WebRTC. |

> **Nota do README vs. o site ao vivo.** Um trecho antigo do README ainda diz que não há vídeo, compartilhamento de tela nem anexos S3. A interface no ar (CSS/JS v20261114v8) e as seções posteriores do mesmo README já documentam câmera, tela, qualidade, S3 e painel admin. Esta especificação segue o que está publicado hoje.

### Repositório GitHub

Conta `Gamesfoxs` (1 repositório público). Projeto [bairroanimefire-chat](https://github.com/Gamesfoxs/bairroanimefire-chat), criado em 27 de outubro de 2026.

Stack declarada: Node.js 18+, Express 5, Socket.IO 4.8, SQLite via `sql.js` (sem binário nativo, pensado para Hostinger Node), frontend vanilla HTML/CSS/JS, PWA (`manifest.json` + service worker), JWT/cookies, bcryptjs, SSO com `https://bairroanimefire.com/auth/chat`, mídia em S3 (`sa-east-1`).

Estrutura: `server.js`, `src/db`, `src/routes` (auth, sso, servers, friends, dms, admin, media), `src/socket`, `src/media/s3.js`, `public/`, testes `quality-smoke.js` e `professional-smoke.js`. Troca futura por MySQL já está prevista na camada `src/db/index.js`.

### Site principal (bairroanimefire.com)

Rede social em PHP 8.5.12, sessão, Cloudflare e visual de fogo (theme-color `#FF4D00`), com temas de estilo incluindo escuro, sakura, oceano, floresta, roxo-neon e dourado. Além do catálogo de animes, o morador já tem:

| Área | O que já existe no site |
| --- | --- |
| Feed | Texto, imagem, GIF, vídeo, áudio, enquetes (2 a 4 opções), comentários, curtidas, salvos, links clicáveis. |
| Bairros | Comunidades com nome, ícone, descrição e regras. Fundador gerencia, promove mods e expulsa. |
| Chat Global | Widget flutuante no PC, tela cheia no celular, respostas, reações e não lidas — separado do PWA do subdomínio. |
| Mensagens e calls | Chat privado e botão de voz/vídeo no perfil. |
| Social | Amigos, Explorar, busca (usuários, animes, bairros, posts), notificações em tempo real, configurações, login Google. |
| Progresso | XP, níveis (Novato até Lenda do Bairro), 7 conquistas, ranking. |
| Cargos do site | Fundador, Vice-Fundador e Staff, com badges e prévia rápida de perfil. |
| Fagulhas | Área de vídeos curtos da comunidade (não é status de 24h). |
| Apps | Modo App estilo Discord + Steam, instalador Windows, APK Android, PWA no iPhone, FOX//BROWSER em beta. |
| Comunidade | Sugestões votadas, Apoie (Pix/Asaas), páginas Sobre, Termos e Privacidade. |

---

## Tudo que Discord e WhatsApp têm — no idioma do Bairro

Abaixo está o mapa completo de funcionalidades. Nomes entre parênteses são como a galera já conhece. O Bairro não precisa copiar a marca; precisa cobrir o job de cada recurso, com cara de anime e as palavras da casa (Bairro, guilda, tropa, morador, Fagulhas).

### Servidores, Bairros e comunidades

Servidores (Discord) e Comunidades (WhatsApp) viram Guildas / Bairros no produto. Cada um tem nome, ícone, banner, descrição, regras e dono.

Canais de texto, voz e vídeo, agrupados em categorias. Canais de anúncios (só staff publica), fóruns / tópicos, canal de palco (um fala, a plateia escuta) e canal de mídia. Canais de boas-vindas e fluxos de entrada (aceitar regras antes de falar).

Convites com prazo, limite de usos, vínculo a um canal, links permanentes da guilda e descoberta pública opcional (hoje a maioria é só por convite — isso deve continuar como padrão para salas da tropa). Integração: um Bairro do site pode nascer com uma guilda no chat, e vice-versa.

### Cargos, permissões e informação

Cargos livres (não só dono/mod): nome, cor, ícone, ordem de hierarquia, hoistar na lista de membros, atribuir por convite ou automaticamente. Matriz de permissões: ver canal, enviar mensagem, anexar arquivo, mencionar @everyone, gerenciar mensagens, conectar/falar na voz, compartilhar tela, silenciar, expulsar, banir, gerenciar canais e cargos, criar convites, administrar o servidor.

Overrides por canal (este cargo não vê `#staff`; só veteranos falam em `#voz-evento`). Cargos do site (Fundador, Vice-Fundador, Staff, títulos de XP) devem aparecer como badges também no chat.

### Mensagens (o coração do produto)

Enviar, editar, apagar (para todos / só para mim), responder com citação, encaminhar, fixar, marcar como não lida, copiar link. Threads / tópicos a partir de uma mensagem, com histórico próprio. Reações com emoji (inclusive os do Bairro) e contagem visível.

Texto rico: negrito, itálico, spoiler, bloco de código, listas, links com prévia segura. Menções a pessoa, cargo e canal; @todos com permissão. Mensagens de até alguns milhares de caracteres, com quebra e agrupar mensagens seguidas do mesmo autor.

Mídia: fotos, vídeo, GIF pesquisável (Tenor/Giphy ou acervo próprio), arquivos, álbum, figurinhas (pack da comunidade + importar), emojis customizados da guilda, mensagens de voz (segurar para gravar, como no WhatsApp), visualização única, enquetes dentro do canal ou do PV. Indicador “digitando” (já existe) e recibos de leitura no PV (enviado, entregue, visto).

Busca no histórico: por texto, pessoa, canal, data, tem/não tem link ou anexo. Mensagens temporárias (sumir em 24h / 7 dias) e modo desaparecer no PV, no espírito WhatsApp.

### DMs, grupos e amigos

PV 1:1 (já existe, com trava de amizade/servidor). Grupos de PV (estilo WhatsApp / group DM do Discord): criar, nome, ícone, adicionar e remover membros, admin do grupo, link de convite, sair do grupo.

Pedidos de amizade por @usuario, pendentes, bloquear, silenciar, arquivar conversa, notificação custom por conversa. Lista de amigos com status e atalho para call. No celular, a aba de conversas deve parecer WhatsApp (lista + balões); no PC, a home de amigos pode continuar no jeito Discord.

### Chamadas, voz, vídeo e tela

Sala de voz persistente no servidor (já existe) e chamada avulsa de PV / grupo (como WhatsApp e o botão verde do perfil no site). Controles: microfone, ensurdecer, câmera, compartilhar tela (janela ou tela cheia), fundo desfocado, qualidade, trocar dispositivo, levantar a mão, transmitir para a guilda (Go Live).

Grade de vídeo, speaker view, modo teatro, lista de quem está na sala. Ruído, eco e ganho (já usam o navegador). Para passar de ~8–10 pessoas com vídeo estável, é preciso SFU + TURN — o P2P atual não escala. Chamadas em Android/iOS e no PC; tela no celular é limitada pelo navegador e precisa de app nativo no futuro.

### Status, presença e stories

Presença: online, ausente, ocupado, invisível, mais status personalizado (“assistindo X”, “no bunker da guilda”). “Visto por último” no PV, com opção de privacidade. Atividade na voz visível na lista de membros.

Status / stories no jeito WhatsApp: foto, vídeo ou texto com prazo de 24h, visível para amigos ou por lista, respostas que caem no PV, mute de status de alguém. Fagulhas continua como vídeos curtos públicos da comunidade — são produtos diferentes (Reels vs. Status).

### Perfis, notificações e busca

Perfil unificado com o site: avatar, capa, @, bio, lista de animes, nível/XP, conquistas, cargos, botões de amizade, PV e call. Cartão rápido ao passar o mouse / toque no nome (o site já tem prévia).

Notificações: push no app e no navegador, badge, som, não perturbe, silenciar canal ou servidor, só menções, só amigos. Central já existe no site — o chat precisa da mesma árvore e de Web Push de verdade. Busca global: pessoas, guildas, Bairros, posts e, no chat, mensagens.

### Moderação, segurança e bots

Além de expulsar/banir/auditoria (já existem): timeout (castigo temporário), avisos, limpar mensagens em massa, denúncia, palavras bloqueadas, Anti-raid, nível de verificação, captcha na entrada, bloquear DMs de desconhecidos, 2FA para ações de admin.

Bots e integrações: comandos com `/` (anunciar episódio, enquete, XP, cargo automático), webhooks, log de entradas, música só se couber na casa. API documentada para o próprio Bairro (avisar drop de anime, Fagulhas novas, sugestões aprovadas).

Criptografia: hoje há HTTPS, cookies seguros e S3 privado com link temporário — isso não é ponta a ponta. Meta: E2EE nos PVs e grupos íntimos (estilo WhatsApp), com aviso claro de que canais de guilda e mídia compartilhada são protegidos no trânsito e no armazenamento, mas o servidor ainda processa o conteúdo para busca e moderação.

### Multiplataforma, acessibilidade e extra

Web, PWA, app Windows (já há instalador do site), Android e iOS / adicionar à tela inicial. Sessão em vários aparelhos, dispositivos ligados, encerrar sessão remota. Modo App do site (janelas Discord + Steam) deve abrir o chat como uma janela de primeira classe, não como um site à parte.

Acessibilidade: teclado, foco visível, movimento reduzido (já começou), leitores de tela, tamanho de fonte, alto contraste. Eventos da guilda (estreia, raid, watch party), clipes curtos da call, temas, papel de parede no PV, idioma pt-BR nativo com opção de outros idiomas depois. Apoie vira perks (emoji extra, banner animado, upload maior) sem bloquear o essencial — o Bairro continua gratuito.

---

## Análise de lacunas

Comparativo honesto entre Discord, WhatsApp e o Bairro (site + chat). “Parcial” significa que a base existe, mas ainda falta o acabamento que o morador espera no dia a dia.

| Funcionalidade | Discord | WhatsApp | Bairro hoje | Situação |
| --- | --- | --- | --- | --- |
| Servidores / comunidades | Sim | Comunidades | Guildas no chat + Bairros no site | Parcial |
| Canais de texto | Sim | Grupos / canais | Sim, no chat | Tem |
| Canais de voz e vídeo | Sim + palco | Chamadas avulsas | Sala P2P até 10; call no perfil do site | Parcial |
| Compartilhar tela | Sim | Sim (app) | Sim no PC; frágil no celular | Parcial |
| DMs 1:1 | Sim | Sim | Sim, com regra de amizade/servidor | Tem |
| Grupos de PV | Group DM | Núcleo do app | Não | Falta |
| Amigos e pedidos | Sim | Contatos | Sim no chat e no site | Tem |
| Respostas e reações | Sim | Sim | Agora também no PWA do chat: citação e emoji com contagem, em canal e PV | Tem |
| Editar / apagar própria msg | Sim | Sim | Autor edita e apaga; dono e moderadores podem apagar conteúdo em canal | Tem |
| Threads / tópicos | Sim | Não (canais sim) | Não | Falta |
| Figurinhas e emoji da casa | Sim (Nitro p/ alguns) | Sim | Não no chat | Falta |
| GIF pesquisável | Tenor | Sim | Só arquivo local | Parcial |
| Mensagem de voz | Clipes / voz | Núcleo | Gravação pelo MediaRecorder com prévia e envio privado ao S3, conforme suporte do navegador | Parcial |
| Enquetes | Sim | Sim | No feed, não no canal/PV | Parcial |
| Recibo de leitura | Não clássico | Sim (visto) | Não lidas de DM, sem “visto” por mensagem | Parcial |
| Stories 24h | Não | Status | Fagulhas é outro formato | Falta |
| Presença rica | Online/ausente/ocupado | Visto por último | Só online/offline | Parcial |
| Cargos custom + overrides | Muito forte | Admin de grupo | Dono e moderador fixos | Parcial |
| Moderação avançada | Timeout, AutoMod | Admin / comunidades | Ban, expulsar, auditoria, apagar | Parcial |
| Bots e comandos `/` | Ecossistema | Pouco | Não | Falta |
| Busca de mensagens | Sim | Sim | Busca textual simples dentro do canal ou PV, com verificação de acesso; filtros avançados pendentes | Parcial |
| Push nativo | Sim | Sim | Toasts no site; chat ainda depende da aba aberta | Parcial |
| E2EE | Só em áudios de PV recentes | Padrão | TLS + S3 privado, sem ponta a ponta | Falta |
| Mensagens temporárias | Não nativo | Sim | Não | Falta |
| TURN / NAT difícil | Sim | Sim | Ausente; o próprio README avisa | Falta |
| SFU para call grande | Sim (media server) | Sim | Mesh P2P | Falta |
| Perfil rico no chat | Sim | Sim | Nome + cor de avatar; perfil completo está no site | Parcial |
| Apps desktop / mobile | Nativos | Nativos | PWA do chat + apps do site | Parcial |

> **A maior oportunidade.** O Bairro já tem a casca Discord (layout, servidores, voz, admin) e a casca de rede social (feed, Bairros, XP, apps). O buraco está no miolo das conversas — responder, reagir, editar, figurinha, áudio, visto, stories, grupos de PV — e na infra de chamada (TURN + SFU) para a tropa não cair quando a rede é ruim ou a sala cresce.

---

## Direção visual — Fogo Neon

O site fala em fogo (`#FF4D00`, gradientes de brasas, vidro desfocado). O chat já é um Discord roxo-escuro muito bonito. A direção é unificar os dois num visual anime / dark: fundo quase preto-ameixa, acento violeta, choque quente de fogo e rosa, tipografia limpa, UI densa no PC e confortável no polegar.

### Paleta (tokens do chat atual + fogo do site)

| Token | Hex | Uso |
| --- | --- | --- |
| `bg-deep` | `#0d0618` | Fundo da página / PWA (já é o `background_color` do manifest) |
| `bg-rail` | `#0a0412` | Trilho de servidores, a faixa mais escura |
| `bg-sidebar` | `#150a24` | Lista de canais, amigos e membros |
| `bg-chat` | `#1a0f2e` | Área da conversa; theme-color próximo: `#1a0a2e` |
| `bg-input` | `#24153a` | Composer, campos, botões secundários |
| `bg-hover` | `#2a1a45` | Hover de linhas e canais |
| `bg-active` | `#3d2460` | Canal ou servidor ativo |
| `accent` | `#a855f7` | Violeta principal — botões, foco, rail ativo |
| `accent-hot` | `#ec4899` | Rosa neon — hover, títulos, energia anime |
| `accent-fire` | `#f97316` | Laranja de apoio no chat |
| `fire-site` | `#FF4D00` | Laranja oficial do site; usar em CTA e XP |
| `text` | `#f3e8ff` | Texto principal, quase branco-lila |
| `text-muted` | `#a78bba` | Secundário |
| `text-dim` | `#7c6a8a` | Horário, hash, dicas |
| `online` | `#22c55e` | Bolinha online, call no ar |
| `idle` | `#eab308` | Ausente |
| `offline` | `#6b7280` | Offline |
| `danger` | `#ef4444` | Sair da call, banir, zona de perigo |
| `lilac` | `#d8b4fe` | Eyebrow, canal de voz, foco de teclado |

> **Regra de cor.** 80% da interface é fundo e texto. O violeta guia a navegação. O fogo `#FF4D00` aparece em pontos quentes (enviar, XP, “ao vivo”), nunca em parágrafos inteiros. Um acento por bloco: não misturar rosa, laranja e verde no mesmo botão.

### Tipografia

| Papel | Família sugerida | Corte |
| --- | --- | --- |
| Interface (hoje) | Segoe UI, system-ui, Apple System | Já no chat; ótimo fallback nativo |
| Títulos e marca | Outfit ou Sora, peso 600–800 | 18–32px, tracking um pouco aberto nos eyebrows |
| Corpo e mensagens | Inter ou IBM Plex Sans | 14px no PC (estilo Discord), 16px no composer mobile |
| Nomes japoneses / anime | Noto Sans JP | Ao lado da sans latina, só quando houver kana/kanji |
| Código e convites | IBM Plex Mono ou JetBrains Mono | Códigos de convite, IDs, slash commands |

Raio padrão já é 8px no chat; cards da home usam 14px. Manter. Densidade alta no desktop (header 48px, rail 72px) e um pouco mais de respiro no toque (header 58px, rail 60px — valores que o CSS já pratica).

### Layout das telas principais

Mapa do desktop da guilda — as quatro colunas que o chat já usa, para não redesenhar o que funciona:

```text
+-----------+----------------+---------------------------+------------------+
| Rail 72   | Canais 240     | Conversa                  | Membros 220      |
| Casa,     | Categorias,    | Header, histórico,        | Por cargo,       |
| guildas,  | #texto, voz,   | digitação, composer       | presença,        |
| criar +   | admin          |                           | perfil rápido    |
+-----------+----------------+---------------------------+------------------+
```

| Tela | Referência | O que mostrar |
| --- | --- | --- |
| Login | Cartão central que já existe | Marca, uma frase, botão único de SSO. Sem segundo formulário de senha. |
| Home / Amigos | Discord Friends + lista WhatsApp | Adicionar amigo, pedidos, amigos online, atalho para voz, criar guilda, entrar por convite. No futuro: faixa de stories no topo. |
| Guilda | Discord clássico (já no ar) | Rail \| canais \| mensagens flat com avatar \| membros agrupados por cargo. Composer com anexo, GIF, figurinha, áudio e enquete. |
| PV e grupos | Balões WhatsApp sobre fundo `#1a0f2e` | Mensagens em bolhas (minhas à direita no acento, dele à esquerda no sidebar), visto, resposta colada, áudio em pílula. |
| Chamada | Sala que já existe, mais polida | Grade de vídeo, nome, mute, barra inferior fixa (mic, câmera, tela, qualidade, sair). Chip “ao vivo” em verde. |
| Administração | Modal que já existe | Renomear, membros, cargos, banidos, auditoria. Evoluir para uma tela cheia com abas: Cargos, Canais, Convites, Segurança. |
| Perfil | Site (capa estilo Twitter) + cartão no chat | Mesmo perfil nos dois lugares. Botões Amigo, Mensagem, Ligar. XP e badges visíveis. |
| Mobile | Híbrido | Aba Conversas (WhatsApp) \| Guildas (rail horizontal) \| Feed \| Status \| Perfil. Gestos para voltar; drawers só quando precisar. |

### Componentes de interface

Rail com indicador de não lida (já existe). Canais com `#` e ícone de voz. Composer único com anexo, GIF, figurinha, áudio e enviar. Balão de PV vs. linha flat de canal. Chip de presença (verde / amarelo / vermelho / cinza). Toast (já existe). Lightbox de mídia (já existe). Cartão de convite. Painel de membro ao clicar no avatar. Barra de call flutuante quando a pessoa navega em outro canal. Stories em círculos no topo da home. Badges de cargo com a cor do cargo. Skeleton de carregamento no histórico. Empty states com uma frase só (“Sua tropa ainda não chegou”), sem mascote barulhento.

Movimento: microinterações curtas (120–180ms), respeito a `prefers-reduced-motion` (já citado no projeto). Vidro e brilho de fogo só em hover de cards e no Modo App, para não cansar o chat — a conversa precisa parecer estável, não um opening o tempo todo.

---

## Stack sugerida — construir em cima do que já roda

Não reescrever o Bairro do zero. O chat já é Node + Express + Socket.IO + frontend vanilla + PWA, com SSO no PHP do site, Cloudflare na frente e S3 privado em `sa-east-1`. A evolução é incremental.

| Camada | Hoje | Próximo passo recomendado |
| --- | --- | --- |
| Site social | PHP 8.5.12, sessão, Hostinger, Docker de deploy | Continuar como fonte da verdade de conta, feed, Bairros, XP e SSO |
| Chat | Node 18+, Express 5, Socket.IO 4.8, vanilla JS | Manter o servidor e ir componentizando o front (ou migrar telas críticas para um framework só quando o composer e as threads pesarem) |
| Banco do chat | SQLite via sql.js, persistência atômica | MySQL ou MariaDB (a própria camada db já prevê `DATABASE_URL` / mysql2) quando a concorrência crescer; FTS5 ou Meilisearch para busca de mensagens |
| Tempo real | Socket.IO no processo Node | Redis adapter no Socket.IO quando houver mais de uma instância; filas para push e upload |
| Mídia | S3 privado, links temporários, Lura / api-s3.lurahosting.net | Manter; acrescentar transcodificação leve de áudio/vídeo e antivírus de upload |
| Chamadas | WebRTC P2P sinalizado no Socket.IO, sem TURN | Coturn ou TURN gerenciado já na Fase 1; depois LiveKit, mediasoup ou Cloudflare Calls (SFU) para salas maiores |
| Auth | SSO BairroAnimeFire, cookie HttpOnly, JWT de sessão | Manter conta única; 2FA no site vale para o chat; nunca voltar senha local no subdomínio |
| Push e apps | PWA do chat + apps do site (Windows, Android, iOS via tela inicial) | Web Push no service worker; depois FCM/APNs nos APKs para PV e call; abrir o chat dentro do Modo App |
| Edge e segurança | Cloudflare, CSP, noindex no chat | Manter; WAF e rate-limit no edge; E2EE só nos PVs numa fase própria |

> **O que não fazer agora.** Trocar o frontend inteiro por um clone de Discord em React, abandonar o PHP do site, ou meter E2EE em canal público da guilda. Isso atrasaria o que o morador mais sente falta: responder, reagir, ligar sem cair e usar no celular com notificação.

---

## Roadmap em fases

A Fase 0 já está no ar. O MVP de verdade, para o usuário, é fechar as conversas e as chamadas. Depois vêm comunidade avançada, camada WhatsApp (stories e E2EE) e escala.

| Fase | Item | Status |
| --- | --- | --- |
| 0 | SSO, servidores, convites, canais, DMs, amigos, presença | Concluído |
| 0 | Admin (dono/mod, ban, auditoria) e mídia S3 | Concluído |
| 0 | Voz, câmera, tela e qualidade no P2P | Concluído |
| 1 | TURN para redes difíceis e testes reais em dois aparelhos | Em andamento |
| 1 | Responder, reagir, editar e apagar em canais/PVs | Implementado nesta entrega |
| 1 | Menções avançadas, pesquisa filtrada e Web Push | Pendente |
| 1 | Mensagem de voz no composer (MediaRecorder + S3) | Implementado no código; teste em aparelhos reais pendente |
| 1 | GIF pesquisável | Pendente |
| 1 | Unificar tokens de fogo do site com o roxo do chat | Parcial: aplicação Fogo Neon nas conversas e pesquisa |
| 2 | Grupos de PV, visto, presença rica, busca no histórico | Pendente |
| 2 | Cargos custom, overrides, categorias, timeout e figurinhas | Pendente |
| 3 | Status 24h, mensagens temporárias, perfil unificado no chat | Pendente |
| 3 | SFU (LiveKit ou equivalente) e call de grupo estável | Pendente |
| 4 | E2EE em PVs/grupos, bots/comandos, eventos da guilda | Pendente |
| 5 | MySQL, Redis, apps nativos do chat, perks do Apoie | Pendente |

### Observação operacional do armazenamento (15/11/2026)

A implementação de áudio e mídia usa URLs privadas do S3, mas a credencial atual
retornou AccessDenied ao excluir um objeto de teste. O endpoint de aplicação
já pode revogar a visualização de uma mensagem apagada, porém a exclusão física
precisa de autorização s3:DeleteObject. Há registro de erro 400 intermitente
em teste de upload. Não tratar a limpeza física ou a entrega de áudio no celular
como comprovadas até resolver a permissão e testar em dispositivos reais.

### Fase 1 — MVP das conversas (agora)

TURN, respostas, reações, editar/apagar do autor, menções, mensagem de voz, pesquisa de GIF, Web Push, polimento mobile e a paleta Fogo Neon alinhada ao site. É o salto que mais se sente no dia a dia.

### Fases 2 a 5 — produto completo (depois)

- **Fase 2:** grupos de PV e cargos de verdade.
- **Fase 3:** stories e SFU.
- **Fase 4:** E2EE e bots.
- **Fase 5:** banco, escala e apps nativos.

Cada fase deve chegar inteira para a tropa, não como interruptor solto no menu.

### Como medir que a fase acabou

Fase 1 fecha quando duas pessoas em redes diferentes (um no 4G, outro no Wi-Fi) entram na voz sem falha por NAT, trocam resposta + reação + áudio, e recebem push com o app em segundo plano. Fase 3 fecha quando uma watch party de mais de 10 pessoas segura vídeo e tela. Fase 4 fecha quando um PV mostra cadeado de ponta a ponta e o texto não é legível no banco.

> **Ponto de partida forte.** Você não está começando do zero: o trilho, o SSO, a voz, o S3 e o site social já existem. Este documento é o mapa para transformar isso numa rede que um fã reconhece na hora — mistura de Discord e WhatsApp, com a cara do Bairro Anime Fire.
