# Inventário de telas e estados

Lista completa do que precisa existir visualmente. Serve para o desenho não esquecer os
**estados** — que é onde a maioria dos redesenhos falha, porque só a tela "feliz" é desenhada.

Os tokens de cor estão em `apps/desktop/src/styles/global.css` e vieram do canvas do
Claude Design. Trocar a identidade é trocar esses tokens; a interface inteira acompanha
sem mexer em componente.

## Sistema visual aplicado

| | |
|---|---|
| Fonte | **Geist** (self-hospedada — a CSP do app bloqueia fonte externa), base **13px** |
| Fundos | `#0a0b0d` rail · `#101114` chat · `#15171b` sidebar · `#1a1d22` elevado |
| Bordas | `#23262d` · `#2a2d34` no hover |
| Texto | `#f2f3f5` · `#c6cad1` · `#8a8f98` secundário |
| Destaque | `#7b5cff`, com `#b8a6ff` claro e `#2b2350` para fundo tingido |
| Semânticas | `#35d07f` online · `#ffb224` ausente · `#e5484d` alerta |
| Raios | 6px predominante; 8–12px em cartões e modais |
| Densidade | rail 60px · sidebar 258px · cabeçalho 46px · linha de canal 30px · campo 38px |

## Regras que o desenho precisa respeitar

- **Escuro por padrão.** É um app de comunicação usado à noite, por horas.
- **Identidade própria.** A organização pode lembrar apps do gênero; cores, ícones, sons e
  nome são originais.
- **Duas informações são obrigatórias em toda conversa privada:** que ela é criptografada
  ponta a ponta e que as mensagens somem em 8 horas. Discretas, mas sempre visíveis.
- **O contador de expiração muda de peso** conforme o tempo acaba. Não é um rótulo estático.

---

## Fase 1 — telas que já existem em código

| Tela | Estados a desenhar |
|---|---|
| **Conectar ao servidor** | inicial · conectando · servidor inacessível (com "Tentar novamente") |
| **Entrar / Criar conta** | login · cadastro · erro de credencial · campo de código de convite |
| **Amigos** | abas Online, Todos, Pendentes, Bloqueados · adicionar amigo · cada aba vazia |
| **Conversa privada (DM)** | banner de privacidade · mensagens com contador · composer |
| **Canal de texto** | histórico · cabeçalho com tópico · composer |
| **Barra de servidores** | ícone ativo · hover · badge de menção · botão adicionar |
| **Lista de canais** | categorias recolhíveis · canal ativo · canal de voz (desabilitado hoje) |
| **Painel do usuário** | avatar, nome, status · botões de ação |

## Componentes e estados transversais

Estes existem no código e são os mais esquecidos no desenho:

- **Reconectando** — faixa no topo quando a conexão cai
- **Mensagem enviando** / **falhou ao enviar** (com opção de tentar de novo)
- **Mensagem que não pôde ser aberta** — "enviada antes deste computador entrar na conversa"
- **Criptografia indisponível** — composer bloqueado, com o motivo
- **Aviso de armazenamento fraco** — o sistema não protege as chaves em repouso
- **Contador de expiração em três pesos:** normal (horas) · urgente (menos de 15 min) ·
  últimos 60 segundos (contando por segundo)
- **Alguém está digitando**
- **Arrastar arquivo** — "Solte para enviar"
- **Anexo imagem** (miniatura) e **anexo arquivo** (genérico)
- **Reações** — com e sem a sua
- **Separador de dia** e **marcador de mensagens novas**
- **Vazios:** sem amigos, sem conversas, nenhum canal selecionado
- **Erro** — aviso dispensável no canto
- **Menção** a usuário e a @everyone

## Fase 2 — voz (a implementar)

- Canal de voz com participantes: falando, mudo, ensurdecido, compartilhando tela
- Voz conectada no painel do usuário: ping, desconectar, compartilhar tela
- Chamada privada: chamando · tocando · conectada · perdida · recusada
- Menu de contexto do usuário: volume individual 0–200%, silenciar, perfil
- ~~Configurações → Voz e Vídeo: dispositivos, medidor de nível, push-to-talk~~ **feito**

## Fase 3 — compartilhamento de tela (a implementar)

- Escolher o que compartilhar: monitores, janelas e aplicativos com miniaturas
- Qualidade: resolução (720p / 1080p / 1440p) e FPS (15 / 30 / 60), com automático
- Assistindo: grade de streams, destaque, tela cheia, pop-out, indicador AO VIVO
- Transmitindo: indicação clara + botão vermelho de parar

## Fase 4 — polimento (a implementar)

- **Configurações** com as categorias: Minha Conta, Perfil, Privacidade, Notificações,
  Aparência, Voz e Vídeo, Atalhos, Avançado, Sessões, Sobre
- **Perfil** — cartão flutuante e página completa, incluindo o número de segurança
- **Busca rápida** (Ctrl+K) e **buscar no canal**
- **Mensagens fixadas**
- **Menus de contexto:** usuário, canal, mensagem
- **Criar servidor** e **convidar pessoas**
- **Cargos e permissões**
- **Seletor de emoji**
- **Visualizador de imagem** (ampliar, baixar)
- **Menu da bandeja** e **notificação do Windows**
