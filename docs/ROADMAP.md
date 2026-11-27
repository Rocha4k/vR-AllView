# AllView: plano de melhoria

Plano de 27/11/2026, a partir de uma revisão de design, de uma auditoria técnica com o detector Impeccable e de testes com Playwright.

**Decisões tomadas**

- **Header:** uma barra única de 40px mais uma régua de breakpoints de 28px.
- **Distribuição:** só no GitHub, sem lojas de extensões.

---

## Ponto de partida

| Avaliação | Nota |
|---|---|
| Usabilidade (10 heurísticas de Nielsen) | 23/40, aceitável |
| Auditoria técnica (acessibilidade, performance, temas, responsive, integridade) | 10/20, aceitável, com trabalho a fazer |

Altura do header medida numa janela com 900px de altura:

| Largura | Hoje | Com Compare | Objetivo |
|---|---|---|---|
| 1920 | 193px | 240px | ~69px |
| 1440 / 1280 | 233px | 280px | ~69px |
| 1180 | 278px | 325px | ~69px |

Ganho esperado:

- **Zoom Fit num portátil 1366×768:** passa de 0,31 para 0,47, ou seja, cerca de +50% de tamanho nos dispositivos.
- **Primeiro pixel da página num telemóvel (1080p):** sobe de 283px para cerca de 111px.

**A manter, porque é a assinatura do produto:**

- A barra de breakpoints: range syntax, `em`, CSS de outras origens, snap e Alt+clique.
- O detetor de overflow, que aponta o culpado.
- O A/B com swipe e diferença.
- O conjunto de ícones próprio.
- Os números em mono.

---

## Fase 0: preparação

- [ ] Rever o canal de mensagens entre os frames e o viewer. As notas detalhadas estão fora do repositório.
- [ ] Criar o token `--faint`, de pelo menos `#7c7c84` (4,56:1), para substituir `#5c5c64` e `#55555c`, que hoje falham o contraste mínimo.
- [ ] Substituir os `#fff` literais por `--accent-ink` e não usar texto abaixo de 11px.
- [ ] Adicionar um `SECURITY.md` com a forma de reportar problemas.
- [ ] No README, avisar que dentro do AllView são removidas as proteções de framing dos sites (X-Frame-Options e CSP).
- [ ] No README, acrescentar uma nota sobre as marcas: os nomes de dispositivos pertencem aos respetivos donos e não há afiliação.

## Fase 1, v1.2 "Mais ecrã": header compacto e performance

### Header: barra única + régua (cerca de 69px no total)

```
+------------------------------------------------------------------------------------------------+
|AV v|< > R| localhost:5600/demo/      * v|->|Pinned 5 v|S N I|Tools 2 v|Ovl v|-50%+|A/B|Cam v|..|  40px
+------------------------------------------------------------------------------------------------+
|< 820 >|240--560-600-----768[#]900--------1200-------1440--------1920|  6 breakpoints         ^ |  28px
+------------------------------------------------------------------------------------------------+
           Compare ligado → painel flutuante no fundo do palco (0px no header):
           | B 127.0.0.1:5601 v | Opacity  Diff  Swipe | --o-- 50% | <-> | x |
```

**Linha 1 (40px)**

Regras gerais:

- `--h: 28px` e padding `6px 10px`.
- `flex-wrap: nowrap`: o que não couber vai para o menu `..` (padrão priority-plus).

Da esquerda para a direita:

1. **Logótipo com menu.** Ajuda, atalhos, repor dispositivos e exportar/importar definições. A palavra "ALLVIEW" sai do header.
2. **‹ › ⟳**
3. **Campo de endereço**, com ★ e um dropdown com três secções:
   - Favoritos, que se reordenam a arrastar ou com Alt+setas.
   - Recentes.
   - "Usar como B".

   Este dropdown **substitui a linha de favoritos** e poupa 45px.
4. **Go:** a única ação principal a vermelho.
5. **Menu "Pinned · 5 ▾"**, com:
   - Os conjuntos Pinned, Mobile, Tablet, Desktop e All.
   - Uma caixa de seleção por dispositivo.
   - Adicionar dispositivo, Rodar todos e Repor.

   Este menu **substitui a linha de separadores**.
6. **Sync:** três toggles só com ícone, para Scroll, Navegação e Interações.
7. **Tools ▾:** Edit, Inspect, Outlines, No CSS, Scrollbars e Overflow.
   - São itens com visto, legenda e atalho.
   - O botão mostra quantas ferramentas estão ativas.
8. **Overlays ▾:** grelha (nenhuma, 8px, 12 colunas ou centro), réguas e Wrap.
9. **Zoom:** um stepper `− 50% +`, com Fit e os níveis no menu.
10. **A/B:** liga o painel do Compare.
11. **Captura (botão dividido):** este dispositivo, todos, ou copiar para a área de transferência. Export HTML só aparece com o Edit ligado.

**Linha 2 (28px, só quando o Fluid está visível)**

- **À esquerda:** `‹ [820] px ›`.
- **Na régua:**
  - Marcas numa única linha. Quando colidem, o rótulo esconde-se e aparece ao passar o rato.
  - Uma faixa que mostra o intervalo atual.
  - Losangos com a largura dos outros dispositivos.
- **À direita:** o número de breakpoints, o estado da leitura e um botão para recolher.
- A dica que hoje ocupa espaço passa a tooltip e entra na ajuda.

**Compare**

Painel flutuante de 36px no fundo do palco, com:

- O campo B e os favoritos.
- O modo: Opacity, Diff ou Swipe.
- O slider.
- O botão de troca (swap).
- O botão de fechar.

**Cards**

O cabeçalho passa a uma linha de 26px: ícone do tipo, nome, dimensões e badge de overflow.

- As ferramentas (pin, rodar, recarregar, captura) aparecem com o rato ou com `:focus-within`.
- "Abrir em separador" e "Remover" passam para um menu `⋯`.
- Poupa cerca de 35px por card de telemóvel.

**Modo foco**

A tecla F esconde o header todo. Volta com F ou ao encostar o rato ao topo.

**Implementação dos menus**

- Popover API, com `aria-haspopup`, `role="menu"` e `menuitemcheckbox`.
- Esc fecha o menu e o foco volta ao botão que o abriu.

### Uso da cor

- **O vermelho fica reservado** para três coisas:
  - Erros, como o badge de overflow.
  - A ação principal (Go).
  - O marcador da largura do Fluid.
- **Estado ligado:** fundo elevado neutro, texto claro e sublinhado neutro de 2px.
- **Separador ou site ativo:** marca-se com peso e sublinhado, não com fundo vermelho.
- **Anel de foco:** 2px, na cor do texto, com `z-index` acima dos vizinhos.
- **`@media (forced-colors: active)`:** usar `Highlight` para os estados ligado e selecionado.
- **Redesenhar 4 ícones:**
  - Rodar: hoje parece uma impressora.
  - Overflow: hoje parece "sair".
  - No CSS.
  - Scrollbars.

### Performance e estado

- [ ] `render()` deixa de destruir os frames. Os cards são reconciliados pelo id do dispositivo e passam a mostrar-se ou esconder-se, mantendo scroll, formulários e edições.
- [ ] `renderBp()` atualiza só as marcas, em vez de reconstruir o `innerHTML`. Isto também corrige o foco que o slider e o campo de largura perdem.
- [ ] `layout()` só reconstrói as réguas quando estão ligadas.

### Critérios de aceitação

- Header de 70px ou menos em qualquer largura entre 1024 e 2560, sem quebras de linha.
- Todos os controlos acessíveis pelo teclado.
- Mudar de conjunto não recarrega nenhum frame.

## Fase 2, v1.3 "Fluxo": usabilidade

- [ ] Atalhos:

  | Tecla | Ação |
  |---|---|
  | Ctrl+L | Endereço |
  | 1–5 | Conjuntos de dispositivos |
  | S / N / I | Sync de scroll / navegação / interações |
  | E / O | Ferramentas de página |
  | − / + / 0 | Zoom |
  | C | Compare |
  | [ / ] | Breakpoint anterior / seguinte |
  | Shift+P | Captura de todos |
  | F | Modo foco |
  | ? | Folha de atalhos |

- [ ] Paleta de comandos (Ctrl+K) com todas as ações.
- [ ] Trocar `confirm()` por um toast com **Anular** ao remover dispositivos e sites e ao repor.
- [ ] Estados dos frames:
  - Uma barra de carregamento de 2px.
  - Se o frame não responder em cerca de 6s: "Não carregou. O site pode bloquear iframes", com *Tentar de novo* e *Abrir em separador*.
- [ ] Erros escritos em linguagem simples, sem `err.message` em bruto.
- [ ] Primeiro arranque com endereço, recentes e favoritos, em vez de frames em branco.
- [ ] Validar o endereço: hoje qualquer gralha vira `https://gralha`.
- [ ] Fit 2D: escolher o zoom que faz caber todos os dispositivos visíveis.
- [ ] Capturas com progresso ("3 de 5") e cópia para a área de transferência.
- [ ] Acessibilidade:
  - `aria-current` nos conjuntos.
  - `aria-pressed` nos pins.
  - `title` em cada iframe.
  - Nome acessível no campo de largura.
- [ ] Grelha de 8px que se adapta ao zoom.
- [ ] Rótulos das réguas sem colisões.

## Fase 3, v1.4 "Diagnóstico": funcionalidades

**Alterações**

- [ ] Scroll sincronizado por elemento âncora, em vez de percentagem. Assim os dispositivos ficam alinhados mesmo quando a página tem alturas diferentes.
- [ ] Alargar o detetor de overflow a um "Responsive lint", com um painel único para todos os dispositivos. Passa a detetar também:
  - Texto cortado ou com ellipsis.
  - Alvos de toque com menos de 44px.
  - Letra com menos de 12px.
  - Imagens esticadas.
- [ ] Breakpoints:
  - Incluir `@container` e `matchMedia`.
  - Ao clicar numa marca, mostrar os seletores que mudam nesse ponto.
- [ ] Compare: mapear caminhos quando A e B têm URLs diferentes, e sincronizar também hover e foco.
- [ ] Atualizar os presets de dispositivos e criar um editor (editar, duplicar, reordenar cards).

**Novas**

1. [ ] Workspaces por projeto, guardados por favorito: conjunto de dispositivos, site B e zoom.
2. [ ] Relatório para partilhar:
   - Uma folha de contactos em PNG, com todos os dispositivos legendados.
   - Um relatório HTML com os problemas encontrados.
3. [ ] Overlay de design: arrastar um PNG (por exemplo, exportado do Figma) para cima de um dispositivo, em modo opacidade ou diferença. Reaproveita o Compare.
4. [ ] Capturas da página inteira.
5. [ ] Exportar e importar definições em JSON.
6. [ ] "Abrir link no AllView" no menu de contexto.
7. [ ] Traduções EN/PT/ES com `chrome.i18n`.
8. [ ] Opcional: aviso discreto quando sair uma versão nova nos Releases do GitHub. Desligado por defeito, e declarado no README porque faz um pedido à rede.

## Fase 4: ecossistema

- [ ] Extrair para um módulo partilhado o núcleo de análise: scan de overflow, recolha de media queries e `parseBreakpoints`.
- [ ] CLI com Playwright. O comando

  ```
  npx <nome> audit <url> --devices 375x667,768x1024,1366x768
  ```

  gera um JSON com culpados e breakpoints, mais um PNG por dispositivo.
- [ ] Skill `responsive-audit`, com `SKILL.md` e `scripts/`. A skill corre a CLI, e o agente lê o JSON, vê os screenshots e corrige o CSS. O nome não pode conter "claude" nem "anthropic".
- [ ] Plugin do Claude Code servido a partir deste repositório, com `.claude-plugin/marketplace.json`:
  - Instalação: `claude plugin marketplace add Rocha4k/vR-AllView` e depois `claude plugin install <nome>@<marketplace>`.
  - Validação: `claude plugin validate --strict`.
  - Limite: só funciona no Claude Code, porque precisa de rede e de um browser headless.
- [ ] GitHub Action que faz falhar o PR quando aparece scroll horizontal novo.

---

## Técnico, em paralelo

- [ ] Injetar o content script só no separador do AllView. Hoje corre em todas as páginas visitadas, mesmo com o AllView fechado.
- [ ] Limitar a regra de remoção de cabeçalhos aos hosts de A e B. Hoje aplica-se a qualquer subframe do separador.
- [ ] Dividir `viewer.js` (1156 linhas) em módulos ES, mantendo o projeto sem build step.
- [ ] Testes:
  - Unitários para `parseBreakpoints`, `bUrlFor` e `normalizeUrl`.
  - End-to-end com Playwright, carregando o viewer com stubs de `chrome.*`.
- [ ] GitHub Actions para lint, testes e zip de release.

## Divulgação, só no GitHub

1. **Releases com o zip da extensão.** As instruções de instalação passam a "transferir, descompactar e carregar sem empacotar", mais simples do que `git clone`.
2. **GIF de 20 a 30 segundos no topo do README.** Deve mostrar:
   - A largura a ser arrastada, com as marcas de breakpoint a acender.
   - O badge de overflow a apontar o elemento culpado.
   - O A/B em modo diferença.
3. **Comparação honesta com Responsive Viewer, Responsively App e Polypane.** O posicionamento proposto: "a alternativa gratuita, dentro do browser, com os breakpoints lidos do teu CSS e o culpado do scroll horizontal".
4. **Arrumar o repositório:**
   - Topics: `responsive-design`, `chrome-extension`, `devtools`, `css`, `breakpoints`, `web-development`.
   - Imagem de social preview.
   - `CHANGELOG.md`, `CONTRIBUTING.md`, templates de issues e Discussions.
5. **Lançamento:**
   - Show HN.
   - r/webdev, r/Frontend e r/css, respeitando as regras de autopromoção.
   - Um artigo no dev.to.
   - Clips curtos nas redes sociais.
   - Sugestão às newsletters Frontend Focus e CSS Weekly.
   - PRs para listas "awesome".
6. **O plugin do Claude Code da Fase 4.** Encaixa na distribuição só pelo GitHub e chega a um segundo público.

Sem loja, quem instala tem de ativar o modo de programador e não recebe atualizações automáticas. Daí a utilidade do aviso de nova versão (Fase 3, ponto 8) e de um processo de atualização simples no README.
