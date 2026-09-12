# Sheliak — extensões Lyra para GNOME

Sheliak 2.0 entrega seis extensões no mesmo RPM:

| Extensão | UUID |
| --- | --- |
| Lyra Dock | `dock@lyraos.com.br` |
| Lyra Painel | `panel@lyraos.com.br` |
| Lyra Menus | `menus@lyraos.com.br` |
| Lyra Busca | `search@lyraos.com.br` |
| Lyra Animações | `animations@lyraos.com.br` |
| Lyra Desktop Icons | `desktop-icons@lyraos.com.br` |

O Vega GTK 5.1.35 configura os componentes e os perfis Lyra, GNOME Vanilla,
Ubuntu, Lyra Clássico, Lyra Central e Lyra Flutuante. O Welcome 0.4.1 usa o
mesmo comando de perfis do Vega. Os IDs antigos permanecem compatíveis para
preservar favoritos e configurações; nomes apresentados usam identidade Lyra.

A extensão monolítica anterior não é instalada por este pacote. Cada extensão
possui enable/disable próprio; Dock/Painel/Menus negociam os elementos que
compartilham e restauram os recursos nativos quando são desligados. O desktop
continua independente dos layouts, inclusive no GNOME Vanilla.

## Compatibilidade e distribuição

GNOME Shell 48, sessão Wayland. Pacote OBS: `sheliak`, no projeto Lyra.
A instalação de fontes locais usa `npm run build`; o OBS recebe o tarball de
fontes com o bundle gerado. Não requer rede ou npm dentro do build RPM.

```sh
npm ci
npm run check
npm test
```

`dist/extensions/` contém exatamente os seis diretórios de extensões.
`dist/common/` é intermediário de build. O spec é `packaging/sheliak.spec`.

## Migração por usuário

O auxiliar `/usr/libexec/lyra/shell-suite migrate`, executado no login GNOME,
preserva preferências e substitui os UUIDs antigos na sessão. O snapshot fica
em `$XDG_STATE_HOME/lyra/shell-suite/migration-v1.json` (por padrão,
`~/.local/state/lyra/shell-suite/`). Nunca executar esse auxiliar como root.

O migrador não move nem apaga arquivos do Desktop. A opção de desktop desligado,
listas vazias explícitas, favoritos separados, bloqueio global do GNOME e
extensões de terceiros são preservados. Mudanças interrompidas de componentes
ficam registradas para recuperação; o status não anuncia sucesso enquanto
houver uma transição incompleta. Aplique novamente o perfil para retomá-la.

Atualizações exigem novo login para carregar os módulos novos do GNOME Shell.
Não recarregar o Shell da sessão pessoal à força. Para reversão, usar uma
combinação compatível dos RPMs anteriores e o snapshot, restaurando apenas
as preferências pertencentes ao conjunto; preservar alterações posteriores
nas extensões de terceiros e todos os arquivos do Desktop.

## Lyra Desktop Icons

O código está em `extensions/desktop-icons/`, baseado no DING 49.0.5.
COPYING, créditos e proveniência upstream são preservados; detalhes de manutenção
em `extensions/desktop-icons/UPSTREAM.md`. O aplicativo auxiliar GJS/GTK e a
integração com Nautilus são mantidos. Os catálogos português e espanhol têm
190 mensagens traduzidas e são verificados no build de testes.

## Organização e validação

Os contratos e a matriz de integração estão em
[docs/extension-suite-contracts.md](docs/extension-suite-contracts.md).
As configurações são inventariadas em `docs/extension-suite-inventory.json`.
Testes nativos usam um GNOME isolado e HOME temporário; os adaptadores dentro
de `tests/native-suite/` não são instalados no RPM.

## Identidade visual

O fundo do dock acompanha a cor e a transparência da barra superior, incluindo
mudanças de tema e de estado do painel. A cor de primeiro plano também vem
do painel. O fundo da barra e do dock tem 10% de transparência, preservando
a opacidade dos textos e ícones; a aparência nativa volta ao desativar Lyra.
O preto do painel padrão escuro é suavizado para o grafite Lyra `#1c2025`,
e o fundo claro usa o lavanda azulado `#ced3f3`. Essas cores são compartilhadas
pelo dock e pelos menus. Outras cores de temas são preservadas.
O dock preserva as classes do dash nativo; menus, busca, destaques,
estados de interação e tooltips continuam usando os estilos do tema ativo.
Os ícones em repouso têm fundo transparente; hover, foco e ativação usam
realces suaves na cor de destaque, com o arredondamento definido pelo tema.
Lixeira e lançador herdam a cor de primeiro plano do painel, inclusive no
modo claro; os indicadores de aplicativos abertos usam a cor de destaque.

Ao passar o ponteiro, o ícone aumenta suavemente em até 40% e os vizinhos recebem uma
ampliação menor. O efeito fica restrito à arte dos ícones, mantendo estáveis
as áreas de clique e de arraste. A ampliação respeita o espaço disponível,
funciona nas docas laterais e horizontais e volta ao normal ao sair. A opção
Animate the Dock e a preferência de animações do GNOME também controlam esse
efeito, que é suspenso durante arrastes e menus de contexto.
Atualizações pendentes são canceladas ao destruir o dock; ícones removidos
deixam de receber animações. O efeito aguarda uma geometria válida na criação
dos atores, evitando propagar escalas inválidas durante mudanças de layout.

Os menus do Shell também acompanham o fundo e o primeiro plano da barra
superior, incluindo Aplicativos, Locais, Sistema, busca, menus do dock e
ajustes rápidos. A caixa de busca acompanha essa superfície, com contorno
discreto em repouso e destaque de foco ao digitar. Ícones e contornos dos botões usam a mesma paleta; seleção,
foco e opções ligadas continuam distintos. Ao abrir a visão geral, os menus
preservam a última superfície legível do painel. A folha de cores temporária
é retirada ao desativar a extensão.

O calendário expandido e os cartões de notificações seguem essa mesma
paleta, incluindo textos secundários, navegação, eventos e relógios. Os
cartões ficam opacos para que notificações empilhadas não sobreponham seus
textos. O dia atual mantém a cor de destaque, com seleção e foco visíveis
nos modos claro e escuro.

Os painéis expandidos dos ajustes rápidos também acompanham essa paleta,
com ícones, subtítulos e seleção legíveis. Isso inclui a camada separada
usada pelos menus de rede, Bluetooth e saída de som.

A janela de preferências GTK do Sheliak usa a mesma paleta clara e escura
do painel nativo, com contraste nos textos, ícones e controles. A variante
acompanha o modo de aparência do sistema enquanto a janela está aberta.

As preferências de posição, tamanho, ocultação e barra flutuante continuam
controlando a disposição dos elementos. Ao ativar **Estender até as bordas**,
a topbar fica reta e sem margens, como com uma janela maximizada. O dock
estendido também perde margens e cantos arredondados; nas laterais, começa
imediatamente abaixo da topbar e alcança a borda inferior. Na posição superior,
fica abaixo da topbar, sem sobreposição. Desativar a extensão até as bordas
restaura as preferências do visual flutuante. No modo estendido, os aplicativos
ficam alinhados ao início (topo nas laterais), com lixeira e botão de aplicativos
no final. Cada modo guarda seu próprio alinhamento.

O Vega pode selecionar explicitamente o perfil Ubuntu usando `desktop-profile`.
As preferências Lyra anteriores ficam em `lyra-profile-settings` para restauração
ao voltar. Estender o dock por si só não seleciona Ubuntu nem esconde menus ou
busca; essas alterações pertencem à seleção do perfil no Vega 5.1.31 ou posterior.

### Perfis Lyra Clássico e Lyra Central

A partir de 1.13.0, os perfis explícitos `windows10` e `windows11` levam o painel
nativo ao rodapé do monitor principal. O dock passa a integrar esse painel,
com aplicativos à esquerda no Lyra Clássico ou centralizados no Lyra Central. O
espaço do painel fica reservado para as janelas e os indicadores de execução
usam o formato de barra de tarefas, sem ampliação dos ícones ao passar o mouse.

O botão L e a tecla Super abrem um menu próprio: lista e blocos de favoritos no
Lyra Clássico, pesquisa e grade de fixados no Lyra Central. Ambos permitem listar,
buscar e abrir aplicativos, acessar configurações, bloquear e desligar com a
confirmação nativa. Os ícones mantêm a identidade dos aplicativos instalados.

A partir de 1.14.0, os aplicativos fixados no painel e os favoritos dos cards
do Iniciar são listas independentes, também separadas entre Lyra Clássico e Lyra Central.
O painel começa com Vega, Arquivos e Firefox. Os cards recebem uma cópia dos
favoritos atuais do GNOME na primeira ativação de cada perfil. Depois disso,
alterar qualquer uma das quatro listas não modifica as demais nem os favoritos
do GNOME usados por Lyra, Ubuntu e GNOME Vanilla.

O botão direito ou Menu/Shift+F10 em um aplicativo oferece ações separadas
para fixar/desafixar no painel e no Iniciar. Os aplicativos do painel podem ser
reordenados arrastando ou pelas ações Mover para antes/depois; estas ações também
ordenam os cards quando usadas no menu. É possível remover todos os itens de
uma lista: ela continua vazia ao trocar de perfil ou reiniciar. Aplicativos
abertos continuam aparecendo no painel conforme a preferência de execução.
As quatro listas persistem nas chaves `windows10-panel-apps`,
`windows11-panel-apps`, `windows10-menu-apps` e `windows11-menu-apps` do Sheliak.

Teste nativo em compositor GNOME 48 isolado (não acessa a sessão pessoal):
`python3 tests/native-pins/run.py --output /tmp/sheliak-pins-test --language pt_BR`.
O teste cobre menus por mouse/teclado, arrastar, migração, listas vazias,
independência dos perfis e reativação da extensão; aceita também en_US/es_ES.

No Lyra Clássico, a versão 1.15.0 permite escolher **Redimensionar → Pequeno,
Médio, Largo ou Grande** pelo botão direito/Menu/Shift+F10 em cada card do
Iniciar. Médio mantém o tamanho anterior; Pequeno exibe apenas o ícone, Largo
ocupa duas larguras médias, e Grande ocupa duas larguras e duas alturas médias.
Os blocos se reorganizam sem sobreposição e continuam acessíveis pela rolagem.
As escolhas são salvas por aplicativo em `windows10-tile-sizes`, inclusive ao
remover e fixar novamente um favorito. O Lyra Central mantém seu tamanho uniforme.
Teste nativo: `python3 tests/native-pins/run.py --probe tests/native-tiles/extension.js
--output /tmp/sheliak-tiles-test --language pt_BR`.

Relógio, calendário, notificações e indicadores são os componentes nativos do
GNOME, reposicionados no painel inferior. Seus menus abrem para cima. Ao sair
do perfil, os componentes, as teclas e a posição do painel são restaurados. O
Vega 5.1.32 guarda as preferências de cada perfil em `desktop-profile-settings`,
incluindo migração das preferências Lyra salvas pela versão com perfil Ubuntu.
O empacotamento continua RPM; não há dependência de outro dock ou menu externo.

O GNOME Shell 48 não expõe uma API pública estável de desfoque do conteúdo
atrás de um ator de extensão. A v1 usa transparência e sombra nativas; não usa
`Shell.BlurEffect`, pois esse efeito desfocaria o próprio dock.

## Lyra Flutuante e área de trabalho

O perfil `macos` usa o logo L à esquerda da barra superior e dock inferior
flutuante centralizado. O Vega controla os valores do perfil e suas preferências.
Lyra Desktop Icons é parte do mesmo RPM, com UUID `desktop-icons@lyraos.com.br`;
seu interruptor é independente dos perfis.

Para testar o conjunto e a migração em GNOME descartável, use
`tests/native-pins/run.py --probe tests/native-suite/extension.js --output PATH`.
`LYRA_NATIVE_SUITE_HELPER` aponta para `packaging/lyra-shell-suite.py`;
`LYRA_NATIVE_VEGA_BINARY` e `VEGA_DESKTOP_TEST_BINARY` permitem testar o Vega real.
`--legacy-extensions PATH` ensaia atualização e reversão com cópias dos UUIDs
antigos encontrados naquele diretório. O runner usa HOME e barramento privados.

## Recuperação de perfis e reversão do pacote

Antes de alterar o layout, o Vega solicita `begin-profile` ao auxiliar. O registro
`profile-v1.json` inclui as preferências e os componentes anteriores, com identidade
do processo controlador. `commit-profile` conclui a troca; `abort-profile` restaura
o estado em falha. Outro processo não pode iniciar uma troca concorrente. Se o
controlador morrer, o próximo login ou tentativa recupera o registro antes de
prosseguir. O estado incompleto não é apresentado como uma seleção confirmada.

Guarde os RPMs anteriores compatíveis. Para voltar à combinação antiga, execute
`/usr/libexec/lyra/shell-suite rollback` na sessão do usuário antes de reinstalar
os RPMs anteriores de Sheliak, Vega, Welcome e DING. O comando usa o snapshot da
migração, preserva escolhas posteriores de extensões de terceiros e prepara os
UUIDs anteriores para o próximo login. Não recarregue o Shell à força; reinstale
os RPMs antigos antes de sair da sessão. O histórico fica em
`last-rollback-v1.json`. Nenhuma dessas operações altera arquivos do Desktop.

## Licenças

O código original Sheliak usa GPL-3.0-or-later. O fork LDI mantém os avisos
GPL-3.0-only ou GPL-3.0-or-later de cada arquivo. O RPM declara ambas; consulte
`LICENSE`, `extensions/desktop-icons/COPYING` e `UPSTREAM.md`.
