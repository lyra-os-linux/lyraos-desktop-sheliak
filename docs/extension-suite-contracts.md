# Contratos da suíte de extensões Lyra

Estado: extração das seis extensões implementada; qualificação e publicação
em andamento. Base examinada: Sheliak `12ce13dc75aeaecadb0067f5d3c6d7ad8b93900c`,
Vega `d26c7ff35d820c2a86765539902b3744b1067204`. Motivação aprovada: organização
para manutenção/expansão. Nenhuma alegação de lentidão.

## Distribuição e fronteiras

Um repositório, um RPM `sheliak`, seis extensões propostas: Lyra Dock, Lyra Painel,
Lyra Menus, Lyra Busca, Lyra Animações e Lyra Desktop Icons. Core, Aparência e
Layouts são código compartilhado, sem uma extensão central obrigatória.
Cada extensão pode ser desativada. Não haverá extensão chamada Sheliak na entrega
final. A entrada antiga foi removida; o RPM instala somente os seis novos UUIDs.

| Responsável futuro | Origem atual | Responsabilidade exclusiva |
| --- | --- | --- |
| Dock | `dock.ts`, `appIcon.ts`, `dockMagnifier.ts`, `trashIcon.ts`, `showAppsButton.ts`, `launcherEntries.ts`, `tooltip.ts` | Atores do dock, scroll próprio, DND, pins do painel, geometria de ícones das janelas e ocultação do dash nativo enquanto substituído |
| Painel | `topBar.ts`, parte de `windowsPanel.ts`, `panelSurfaceTheme.ts`, `panelMenuTheme.ts` | Posição/altura/margens do painel, struts, barreiras, posição do relógio, visibilidade dos indicadores nativos e estilos globais do Shell |
| Menus | indicadores de aplicativos/locais/sistema de `panelMenus.ts`, `startMenu.ts`, parte de `windowsPanel.ts`, `tileSizes.ts`, `tileLayout.ts` | Menu L/Iniciar, cards, favoritos dos menus e posse temporária da tecla Super nos perfis Clássico/Central |
| Busca | `SearchIndicator` em `panelMenus.ts` | Campo de busca do painel e serviço de consulta de apps/arquivos; cancelamento e descarte de respostas antigas |
| Animações | `windowAnimations.ts` | Eventos de minimizar/restaurar, timelines, conclusão dos efeitos e restauração dos handlers nativos |
| Desktop Icons | DING 49.0.5, importação pendente | Aplicativo auxiliar, ícones/arquivos do desktop, preferências DING e consumo da área útil publicada |
| Shared Core | `signals.ts`, `shellCompat.ts`, contratos novos | Ciclo de vida e adaptadores compatíveis; código reutilizável sem iniciar serviços ao importar |
| Shared Appearance | `prefsTheme.ts`, `prefs.css` e funções de cor a extrair | Cálculo de estilos, sem mutação global na importação; cada proprietário aplica/remove os seus estilos |
| Shared Layouts | `desktopProfile.ts`, `dockAlignment.ts` e contratos com Vega | IDs estáveis e apresentação por perfil; não habilita extensões nem escreve preferências automaticamente |
| Shared app helpers | `appAccessible.ts`, `contextMenu.ts`, `profileFavorites.ts` | Código de acessibilidade/favoritos reutilizado; cada superfície possui sua instância e lista |

`prefs.ts`, schemas, catálogos, CSS, build e RPM devem ser repartidos por essas
fronteiras durante a extração. `extension.ts` hoje coordena os componentes e altera
login/Overview; a supressão temporária da Overview no login acompanha Dock, com
restauração no startup-complete e disable. Painel possui a visibilidade de Activities.
Desligar Dock deve restaurar o dash, mesmo que Painel continue ativo.

## Acoplamentos constatados e tratamento

1. `WindowsPanel` recebe a classe concreta `Dock`, transfere o dock ao painel,
   instancia `StartMenu` e bloqueia o handler nativo de Super. A primeira alteração
   troca essa dependência por `DockPanelIntegration` e `DockLauncherIntegration`,
   em `src/contracts/dockIntegration.ts`. Apenas tipos mudaram. A separação de
   atores, atalho e ciclo de vida vem depois; essas interfaces ainda não são API
   pública entre extensões.
2. `PanelMenus` constrói quatro indicadores e controla a posição/compactação da
   busca. Busca terá indicador próprio. O painel oferece posicionamento e limite
   de largura por contrato; Menus não acessa os campos privados de Busca.
3. `StartMenu` já filtra apps por conta própria, enquanto SearchIndicator consulta
   Tracker. Preservar a pesquisa local de aplicativos se Busca for desativada.
   O compartilhamento do serviço não deve ampliar silenciosamente os resultados
   do Iniciar para arquivos; isso seria uma mudança de produto separada.
4. Dock lê a superfície do painel; PanelMenuTheme injeta CSS em `Main.uiGroup`
   para calendário, notificações e ajustes rápidos. Painel será o único dono
   dessa folha global. Menus/Dock/Busca têm estilos locais e fallback legível
   calculado por Appearance quando Painel estiver ausente.
5. Animações já usam `Meta.Window.get_icon_geometry()`, não a instância Dock.
   Preservar essa integração nativa e seu destino alternativo. Não criar uma
   dependência de ativação entre Animações e Dock.
6. `profileFavorites.ts` inicializa favoritos a partir de GNOME somente quando
   não existe valor do usuário. Lista explicitamente vazia deve continuar vazia.
   Pins do painel pertencem ao Dock; pins/cards do Iniciar pertencem a Menus.
7. Vega GTK usa UUID/schema Sheliak e UUID DING em `vega-gtk/src/dock.rs`.
   Welcome delega a aplicação ao Vega. A busca dirigida em `vegad` não encontrou
   referências a esses UUIDs: não há motivo identificado para mover a aplicação
   dos perfis para o daemon privilegiado.

## Contrato entre extensões a implementar

Descobrir provedores pelos UUIDs fixos via ExtensionManager do Shell, isolando
esse acesso no adaptador Core para GNOME 48. Cada provedor publica uma fachada
com versão principal do protocolo e capacidades; consumidores não importam
arquivos nem acessam campos privados de outra extensão. Uma versão incompatível
é tratada como capacidade indisponível, com diagnóstico e fallback.

Não depender de um singleton definido em biblioteca empacotada várias vezes:
cada bundle pode ter sua própria instância. Cada fachada pertence à instância
ativa de sua extensão e é invalidada antes de destruir os seus recursos.

Cada conexão de integração retorna uma liberação idempotente. O provedor notifica
a revogação antes de destruir atores; o consumidor encerra sinais, menus e
referências emprestadas. Ao sair, o consumidor também libera sua conexão. Observar
estado do ExtensionManager permite encontrar uma nova instância após reativação;
callbacks guardam uma geração para ignorar trabalho da instância anterior.

### Painel e Dock

- Painel publica uma área de hospedagem e orçamento de largura, identificados por
  monitor e disposição. Possui o contêiner, nunca os ícones ou o scroll do Dock.
- Dock cria/destrói seu scroll e é o único a transferir seus atores para/de um
  host. Painel solicita integração, sem manipular filhos privados do Dock.
- Revogar o host primeiro fecha popups ancorados, desfaz o empréstimo do lançador
  e desacopla Dock; só então remove o contêiner. Desligar Dock libera o host sem
  destruir painel, relógio ou indicadores.
- Sem Painel, Dock volta ao modo independente; Clássico/Central conservam uma
  barra inferior própria, reservando sua área e respeitando o painel nativo.
- Sem Dock, Painel conserva seu layout e indicadores, sem deixar uma área vazia
  reservada para aplicativos que não existem.

### Menus, lançador e Super

- Dock oferece seu lançador por empréstimo. Menus fornece a ação e possui o popup;
  o lançador continua pertencendo ao Dock. Ao desconectar, retorna à grade nativa.
- Sem Dock, Menus cria seu próprio botão L no Painel; sem Painel, usa o painel
  nativo do GNOME. Apenas um botão L/Iniciar por integração ativa.
- Menus é o único responsável por Super em Clássico/Central. Preservar o handler
  anterior, suspender a ação no bloqueio e restaurá-lo ao sair ou falhar. Não
  sobrescrever modificações de terceiros sem verificar a posse do recurso.
- Sem Menus, o lançador do Dock abre a grade nativa e Super mantém o GNOME.
- Painel define orientação das setas de indicadores nativos; Menus define a dos
  próprios popups. Nenhum dos dois destrói ou reconfigura o popup do outro.

### Busca, estilos e desktop

- Consulta recebe texto, limite e cancelamento; resultado não contém atores
  pertencentes ao provedor. Desativar Busca cancela consultas e remove seu campo.
  Menus preserva busca local de apps. Falha do Tracker não impede abrir apps.
- Painel é responsável por estilos globais. Appearance calcula paleta comum,
  sem outra extensão disputar `Main.panel.style` ou a folha global. Remover uma
  folha própria não remove estilos de terceiros; reconectar após troca de tema.
- Dock/Painel publicam ocupação efetiva por monitor. O adaptador de LDI combina
  essas áreas sem somar duas vezes o dock hospedado no painel. Ausência de um
  provedor remove sua contribuição. Não confundir strut de janela com margem
  extra do desktop; validar o cálculo com o protocolo upstream do DING.
- Desligar LDI encerra somente seu auxiliar/integração. Arquivos e preferências
  permanecem; nenhuma extensão o reativa por conta própria.

## Configurações e perfis

O arquivo `extension-suite-inventory.json` enumera as 42 chaves originais e duas
novas chaves de coordenação por perfil, com tipo, proprietário futuro, consumidores adicionais e tratamento.
Os proprietários são responsáveis pela semântica, não os únicos escritores:
Vega e preferências podem escrever valores validados na sessão do usuário.

Primeiro preservar schema/path/chaves e IDs persistidos. O schema compartilhado
pode ser entregue pelo pacote: não precisa pertencer a uma extensão chamada
Sheliak. Mudança de schema só ocorrerá com migrador idempotente e fallback.
Snapshots são do coordenador de perfis no Vega; extensões não sobrescrevem a
escolha do usuário quando são habilitadas.

| Perfil/ID atual | Dock | Painel | Menus | Busca no painel | Animações | LDI |
| --- | --- | --- | --- | --- | --- | --- |
| Lyra / `lyra` | Configuração salva | Configuração salva | Configuração salva | Configuração salva | Preferência salva | Independente |
| GNOME Vanilla / `vanilla` | Desligado | Desligado | Desligado | Desligado | Desligado | Independente |
| Ubuntu / `ubuntu` | Lateral estendido | Superior sem margens | Desligado por padrão | Desligada por padrão | Preferência salva | Independente |
| Lyra Clássico / `windows10` | Inferior integrado, apps à esquerda | Inferior | Iniciar em blocos | Desligada por padrão | Preferência salva | Independente |
| Lyra Central / `windows11` | Inferior integrado, apps ao centro | Inferior | Iniciar em grade | Desligada por padrão | Preferência salva | Independente |
| Lyra Flutuante / `macos` | Inferior flutuante | Superior | L à esquerda | Desligada por padrão | Preferência salva | Independente |

A tabela define presets e equivalência do comportamento atual, não obriga a
reativar componentes desligados pelo usuário. O Vega deve registrar ajustes
individuais por perfil, inclusive estado ativo/inativo, e restaurá-los ao voltar.
Snapshots antigos sem esses campos recebem defaults compatíveis uma única vez.
Bloqueio global e extensões de terceiros são preservados. Aplicação parcial exige
recuperação, não pode ser anunciada como perfil confirmado.

## Matriz de aceitação antes da extração ser publicada

- Ativar todos os provedores em ordens diferentes; validar também remoção e
  reativação de cada um com o perfil atual, sem duplicar atores/sinais/atalhos.
- Painel desligado com Dock/Menus ativos; Dock desligado com Painel/Menus ativos;
  Menus desligado com Dock ativo; Busca desligada durante consulta pendente.
- Host revogado com popup aberto; integração incompatível; provedor falha durante
  enable; callback atrasado após disable; indicadores de terceiros adicionados.
- Temas claro/escuro, calendário, notificações e ajustes rápidos; retorno ao
  estilo anterior quando Painel sai, sem perda da legibilidade nos demais.
- Ida/volta entre os seis perfis; Super, grade nativa, cards, pins independentes,
  lista vazia explícita, tamanhos e preferências personalizadas preservados.
- Dock em todas as bordas, estendido/flutuante, fullscreen, múltiplos monitores,
  escala fracionária/HiDPI, troca do monitor principal e área útil LDI.
- Instalação nova, upgrade, interrupção/repetição de migração e rollback; DING/LDI
  nunca ativos simultaneamente. Desktop desabilitado permanece desabilitado.
- Testes nativos usam HOME privado/VM. Não alterar ou encerrar a sessão pessoal
  para ensaiar falhas. Não confundir catálogo traduzido com validação visual.

## Marco atual

As seis extensões são geradas por `scripts/build.mjs` e instaladas juntas pelo
spec Sheliak 2.0. A camada de sessão Python migra configurações, aplica conjuntos
de componentes e recupera transições interrompidas; o Vega preserva a lógica
existente dos layouts e usa esse auxiliar sem privilégios. Welcome continua
usando a interface versionada do Vega. Alterações no vegad não foram necessárias.

A validação inclui contratos de ciclo de vida, testes antigos do dock/menus,
catálogos, testes de migração e sessão GNOME privada com o Vega/GTK real.
Conclusão dos testes não equivale a promoção OBS nem qualificação da ISO.
