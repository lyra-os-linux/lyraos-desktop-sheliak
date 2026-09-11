# Sheliak

Sheliak é o dock do Lyra OS para o GNOME Shell. A versão 1 oferece favoritos,
aplicativos em execução, menus por aplicativo, lixeira dinâmica e acesso à
grade nativa de aplicativos. O dock fica centralizado na borda esquerda e usa
ocultação inteligente quando uma janela ocupa sua área.

A extensão também permite ajustar a altura da barra superior e ocultar o relógio
ou os indicadores nativos à direita. Ela oferece menus opcionais de
**Aplicativos**, **Locais**, **Sistema** e **Busca** nessa barra: Aplicativos são
organizados por categoria; Locais reúne pastas pessoais, marcadores do
gerenciador de arquivos e volumes montados; Sistema oferece acesso ao código
fonte, ao relatório de problemas, ao Vega e às informações do sistema; e Busca
encontra aplicativos e configurações.

Cada menu, sua posição e seus conteúdos dinâmicos podem ser configurados na
página Barra superior das preferências. A mesma página permite ocultar o botão
nativo de áreas de trabalho, ordenar categorias e aplicativos alfabeticamente
e abrir os submenus de categorias lateralmente.

Ao minimizar ou restaurar uma janela, o Sheliak oferece animações de zoom ao
ícone e desvanecimento, além da opção sem animação. Os efeitos que usam o item
correspondente no dock como destino acompanham o dock nas bordas inferior,
esquerda e direita.

As configurações podem ser abertas pelo gerenciador de extensões do GNOME e
incluem posição, tamanho dos ícones, margem, animações do dock e das janelas e
três modos de visibilidade (ocultação inteligente, auto hide e sempre ativo),
além dos elementos exibidos. A página Sobre reúne website, relatório de erros,
créditos e informações legais.

## Compatibilidade

- GNOME Shell 48 (versão 48.4 no openSUSE Leap 16.0)
- Sessão Wayland

## Pacote oficial para openSUSE

O pacote oficial chama-se `sheliak` e é publicado no projeto OBS
`home:rodrigosbrito:lyra`.

No openSUSE Leap 16.0:

```sh
sudo zypper ar -f \
  https://download.opensuse.org/repositories/home:/rodrigosbrito:/lyra/openSUSE_Leap_16.0/ \
  home:rodrigosbrito:lyra
sudo zypper refresh
sudo zypper install sheliak
```

Depois da instalação, encerre e inicie a sessão GNOME e habilite a extensão:

```sh
gnome-extensions enable sheliak@lyraos.com.br
```

## Build

```sh
npm install
npm run check
npm run build
```

O diretório `dist/` contém a extensão pronta. Para gerar um ZIP:

```sh
npm run pack
```

## Instalação local

```sh
mkdir -p ~/.local/share/gnome-shell/extensions/sheliak@lyraos.com.br
cp -a dist/. ~/.local/share/gnome-shell/extensions/sheliak@lyraos.com.br/
gnome-extensions enable sheliak@lyraos.com.br
```

Em Wayland, encerre e inicie a sessão depois da instalação ou atualização do
pacote. Alternar entre GNOME Vanilla e Lyra reativa a extensão, mas não
recarrega seu módulo JavaScript. Depois que a versão atualizada é carregada,
as cores são reaplicadas em cada ativação do perfil Lyra.

## Empacotamento

O pacote do sistema deve instalar o conteúdo de `dist/` em:

`/usr/share/gnome-shell/extensions/sheliak@lyraos.com.br/`

O spec de referência está em `packaging/sheliak.spec`. O destino oficial é:

- Projeto OBS: `home:rodrigosbrito:lyra`
- Pacote: `sheliak`
- Repositório Git: `https://github.com/lyra-os-linux/lyraos-desktop-sheliak`

A imagem/meta-pacote do Lyra OS deve instalar `sheliak`, habilitar
`sheliak@lyraos.com.br` por padrão e remover a dependência de Dash to Dock. O
meta-pacote e o `Lyra-Themes` não fazem parte deste repositório; essa troca deve
ser aplicada no repositório que atualmente declara a dependência.

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

### Perfis Windows 10 e Windows 11

A partir de 1.13.0, os perfis explícitos `windows10` e `windows11` levam o painel
nativo ao rodapé do monitor principal. O dock passa a integrar esse painel,
com aplicativos à esquerda no Windows 10 ou centralizados no Windows 11. O
espaço do painel fica reservado para as janelas e os indicadores de execução
usam o formato de barra de tarefas, sem ampliação dos ícones ao passar o mouse.

O botão L e a tecla Super abrem um menu próprio: lista e blocos de favoritos no
Windows 10, pesquisa e grade de fixados no Windows 11. Ambos permitem listar,
buscar e abrir aplicativos, acessar configurações, bloquear e desligar com a
confirmação nativa. Os ícones mantêm a identidade dos aplicativos instalados.

A partir de 1.14.0, os aplicativos fixados no painel e os favoritos dos cards
do Iniciar são listas independentes, também separadas entre Windows 10 e 11.
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

No Windows 10, a versão 1.15.0 permite escolher **Redimensionar → Pequeno,
Médio, Largo ou Grande** pelo botão direito/Menu/Shift+F10 em cada card do
Iniciar. Médio mantém o tamanho anterior; Pequeno exibe apenas o ícone, Largo
ocupa duas larguras médias, e Grande ocupa duas larguras e duas alturas médias.
Os blocos se reorganizam sem sobreposição e continuam acessíveis pela rolagem.
As escolhas são salvas por aplicativo em `windows10-tile-sizes`, inclusive ao
remover e fixar novamente um favorito. O Windows 11 mantém seu tamanho uniforme.
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

## Licença

GPL-3.0-or-later.
