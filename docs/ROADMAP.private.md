# Notas privadas: segurança e questões legais

Este ficheiro está no `.gitignore` e não deve ser publicado. Descreve falhas que ainda não estão corrigidas e assuntos pessoais. Data: 27/11/2026.

## Segurança: corrigir antes de divulgar (Fase 0)

Todas estas falhas foram verificadas com Playwright, com stubs de `chrome.*`.

A causa é a mesma em todos os casos. O viewer (`viewer.js:962`) aceita qualquer mensagem `{rv:1,…}` cujo `e.source` seja a janela de um frame. Os scripts da própria página conseguem enviar essas mensagens, por isso conseguem fazer-se passar pelo content script.

| # | Problema | Onde | Correção |
|---|---|---|---|
| 1 | Injeção de HTML/CSS no painel de overflow: `extra`, `width` e `over` entram no `innerHTML` sem escape. O `onerror` inline é bloqueado pela CSP, mas links falsos e `<style>` passam. | `viewer.js:513,519` | Converter para `Number()` e validar os tipos |
| 2 | Uma página em A consegue clicar e escrever em B, mesmo com Interações desligado (`sendB` incondicional) | `viewer.js:998-1005`, `content.js:316-328` | Autenticar o remetente e reencaminhar só eventos do content script |
| 3 | O que se escreve, **passwords incluídas**, é espelhado em B e enviado com `postMessage(…, '*')`. Os scripts do site B recebem o valor. | `viewer.js:94,1004`, `content.js:262-265` | Ignorar `type=password` e campos de pagamento, e enviar para a origem esperada |
| 4 | "Abrir em separador" abre qualquer esquema, incluindo `data:` falsificado | `viewer.js:975,832` | Aceitar só `http`, `https` e `file` |
| 5 | `rememberIcon` aceita `url` e `icon` falsificados, por isso uma página pode trocar o favicon de qualquer favorito | `viewer.js:977,747-761` | Validar a origem do frame |
| 6 | Qualquer frame responde ao Export HTML, e o object URL nunca é revogado | `viewer.js:1014-1017` | Aceitar só o frame pedido e usar `revokeObjectURL` |
| 7 | Os frames podem pôr a extensão a fazer fetch de qualquer URL de stylesheet | `viewer.js:265-273` | Limitar a URLs de CSS das origens dos frames |
| 8 | A regra DNR remove X-Frame-Options e CSP de qualquer subframe, a qualquer profundidade | `viewer.js:111-131` | Limitar a regra aos hosts de A e B (`requestDomains`) |

**Correção de fundo:** passar o canal content script → viewer para `chrome.runtime` (portas ou `sendMessage`) e identificar cada frame por `sender.frameId`, a que a página não tem acesso. O sentido viewer → content script já está protegido: `content.js:287` verifica a origem e o `parent`.

## Questões legais

1. **Marca "Allview".** O nome pertence à Visual Fan SA (Roménia/UE): telemóveis, tablets e portáteis. A empresa ganhou um processo contra a Huawei por usar "ALL-VIEW DISPLAY".
   - **Decisão:** o projeto fica só no GitHub e mantém o nome.
   - O risco é baixo sem loja e sem fins comerciais, mas não é zero.
   - Se algum dia for para a Chrome Web Store, ou crescer muito, mudar de nome primeiro (o GitHub redireciona repositórios renomeados).
2. **Email nos commits.** Os commits públicos têm o email pessoal. Ativar "Keep my email addresses private" no GitHub e usar o endereço noreply daqui para a frente.
