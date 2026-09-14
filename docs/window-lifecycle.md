# Liberação de janelas no Dock e no Painel

Esta rodada verifica a issue Sheliak #7: encerramento de janelas, referências
e conexões de eventos, incluindo uso repetido em uma sessão GNOME privada.

## Correção

Dock e Painel já removiam os sinais e referências ao receber `unmanaged`.
Faltava limpar a tabela `_trackedWindows` do Dock quando o componente era
desativado com janelas ainda abertas. Uma instância antiga mantida por outro
consumidor podia continuar retendo essas janelas mesmo após desconectar os
sinais. `destroy()` agora limpa essa tabela e admite chamadas repetidas.
Os dois componentes também rejeitam rastreamento após sua destruição.

O teste também expôs retenção de menus durante a troca de perfis. No GNOME
48.8, `Panel._onMenuSet` liga o menu ao painel nativo, que dura toda a sessão.
Depois de destruir cada indicador próprio, o adaptador libera esse vínculo,
preservando o callback nativo durante o fechamento. Submenus de categorias
e de tamanho dos cards liberam a conexão com seu menu pai ao serem destruídos
ou removidos por `removeAll()`. A limpeza atua apenas nos objetos criados pelo
Lyra e nos vínculos correspondentes; não substitui métodos globais do GNOME.


O menu de contexto também mantinha referências às janelas usadas para montar
sua lista. Agora cada ação guarda somente o identificador estável e resolve a
janela entre as que ainda estão abertas no momento do clique. Uma entrada de
janela já fechada não tenta ativar um objeto inválido.

Não se altera a forma de abrir/fechar aplicativos nem as preferências de
perfil. A correção não pressupõe que toda variação de RSS seja vazamento.

## Ensaios reproduzíveis

`npm test` inclui `tests/test-window-lifecycle.mjs`: 600 janelas simuladas por
componente, rastreamento duplicado, `unmanaged`, desativação com janelas
abertas, nova chamada de limpeza e tentativa tardia de rastreamento. Usa a
implementação real de `SignalTracker` e os métodos de ciclo de vida.

O ensaio nativo usa os bundles de produção e um aplicativo GTK 4 real:

```sh
npm run build
env LYRA_NATIVE_WINDOW_CLIENT="$PWD/tests/native-window-lifecycle/client.py" \
  python3 tests/native-pins/run.py --dist dist \
    --probe tests/native-window-lifecycle/extension.js \
    --output /tmp/lyra-window-lifecycle --timeout 1100
```

O harness isola HOME, configurações, D-Bus, compositor e cliente. Renderização
por llvmpipe fica limitada a dois threads. A sessão pessoal não é modificada.
O parâmetro de timeout tem limites e o processo privado é encerrado ao sair.

O teste curto acrescenta `LYRA_WINDOW_LIFECYCLE_QUICK=1` ao comando `env`.
Ele verifica a correção e o instrumento de medição; **não substitui** o teste
prolongado. O teste completo executa:

- Desativação/reativação do Dock com três janelas abertas e limpeza repetida.
- Fechamento de uma janela depois de usar o menu de contexto, mantendo duas
  janelas do mesmo aplicativo abertas e o mesmo ícone no Dock.
- 96 lotes de 12 janelas (1.158 fechamentos, incluindo os seis dos cenários iniciais), com
  alternância entre Lyra, Clássico e Central; movimento, maximização e fechamento
  de janela minimizada. Inclui pausas entre lotes para observar a estabilização.
- Contagem das conexões reais de `Meta.Window` dos bundles Dock/Painel. O probe
  delega às funções originais, registra IDs escalares e não retém callbacks.
  O mapa do Dock e as conexões de ambos devem voltar ao valor anterior ao lote.
- `WeakRef` dos menus próprios anteriores à mudança de perfil: os menus
  descartados devem ser coletados; menus ainda ativos são preservados.
- `WeakRef` para cada janela criada: depois de aguardar a limpeza nativa e
  executar coleta de lixo em jobs separados, nenhuma pode continuar viva.
- RSS, PSS e memória privada via `/proc/self/smaps_rollup`, além de heap GC e
  memória alocada pelo JavaScript via `System.dumpMemoryInfo`.

No GNOME 48.8, `WorkspaceTracker._windowRemoved` retém janelas durante
`LAST_WINDOW_GRACE_TIME = 1000` ms em `ui/windowManager.js`. O ensaio aguarda
1.250 ms após desaparecerem os atores, antes da coleta. Medir antes desse
prazo confunde o temporizador nativo com retenção do Lyra. Em falha de coleta,
o probe grava heap e endereços para identificar as referências fortes.

## Critérios e limites

Os limites são definidos antes da execução, não ajustados para fazer o teste
passar. Após os primeiros 24 lotes de aquecimento:

| Medida | Limite |
| --- | --- |
| Crescimento da mediana de RSS entre os dois últimos grupos de 24 lotes | 16 MiB |
| Faixa de RSS nos últimos 24 lotes | 32 MiB |
| Tendência de RSS por janela fechada, nos lotes após aquecimento | 16 KiB/janela |
| Crescimento da mediana do heap GC entre os dois últimos grupos | 8 MiB |
| Referências fracas a janelas encerradas, após coleta | Zero |
| Referências do Dock e conexões Dock/Painel depois de cada lote | Mesmo total anterior ao lote |

As contagens exatas e a coleta das janelas são os critérios diretos de
liberação. RSS inclui caches e alocações nativas de todo o Shell; não é uma
medida isolada da memória do Lyra. Os limites de estabilização são guardas
práticas, não prova matemática da inexistência de qualquer vazamento.

`result.json` registra andamento, duração, contagens, amostras e resultado.
As evidências de uma versão devem guardar também versões GNOME/Mutter,
hashes dos bundles/fontes e o pacote efetivamente instalado. A qualificação
cobre a versão Wayland testada e essa carga por minutos; não certifica outra
versão, X11, todas as extensões de terceiros ou uma sessão de vários dias.
Posse de handlers de animação (#9) e falhas genéricas de ativação (#10) têm
acompanhamento próprio.

## Diagnóstico da base GNOME

O heap do GNOME Shell 48.8-160100.2.1 também mostrou transições de animação
retidas pelo `sessionSignalHolder` em `ui/environment.js`. Uma amostra com
todos os componentes Lyra desligados reproduziu o acúmulo de callbacks.
A limpeza dos handlers `started`/`stopped` no término da transição eliminou
esses callbacks em um experimento com `G_RESOURCE_OVERLAYS`, limitado a um
compositor descartável. Esse experimento **não altera a base instalada** e
não integra o RPM Sheliak. Há acompanhamento separado antes de propor uma
correção ou backport para o GNOME.

A qualificação do Sheliak deve usar o GNOME original, sem esse overlay.
Passar os limites de memória deste ensaio não demonstra ausência da retenção
nativa identificada nem estabilidade durante dias de sessão.
