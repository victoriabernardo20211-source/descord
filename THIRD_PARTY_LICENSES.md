# Dependências de terceiros

Todas as dependências diretas do projeto usam licenças permissivas, compatíveis com um
projeto privado e fechado. Nenhuma exige abertura do código.

| Pacote | Licença | Uso |
|---|---|---|
| NestJS | MIT | framework do backend |
| Prisma | Apache-2.0 | ORM e migrations |
| PostgreSQL | PostgreSQL License | banco de dados |
| Redis (7.x, imagem oficial) | BSD-3-Clause | cache, filas, presença |
| Socket.IO | MIT | eventos em tempo real |
| BullMQ | MIT | jobs atrasados da expiração |
| ioredis | MIT | cliente Redis |
| argon2 (node) | MIT | hash de senha |
| sharp | Apache-2.0 | miniaturas de imagem |
| file-type | MIT | detecção de MIME por conteúdo |
| Zod | MIT | validação e contratos compartilhados |
| Electron | MIT | aplicativo desktop |
| React | MIT | interface |
| Vite / electron-vite | MIT | build |
| Tailwind CSS | MIT | estilos |
| Zustand | MIT | estado do cliente |
| electron-builder | MIT | instalador Windows |
| LiveKit (server + SDK) | Apache-2.0 | SFU de voz e tela (Fase 2/3) |
| Caddy | Apache-2.0 | reverse proxy e HTTPS |

Para gerar o inventário completo, incluindo dependências transitivas:

```bash
pnpm licenses list --json > licenses.json
```

## Assets próprios

O ícone, a marca "Nexus", a paleta de cores e todos os elementos visuais deste projeto são
originais. Nenhum asset, som, logo, cor ou código proprietário de qualquer outro produto de
comunicação foi copiado.
