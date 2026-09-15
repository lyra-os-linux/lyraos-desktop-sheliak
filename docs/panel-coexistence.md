# Restauração e coexistência do Lyra Painel

Implementação da issue Sheliak #2, qualificada localmente em GNOME Shell/Mutter
48.8, Wayland. Fontes e pacote desta rodada aguardam publicação conjunta.

## Estado compartilhado

| Estado | Regra de restauração |
| --- | --- |
| Relógio, Activities e indicadores nativos | A opção de ocultar suprime o ator, preservando o último pedido externo observável. Liberar a opção/desativar restaura apenas uma alteração ainda própria. Um ator inicialmente oculto não é exibido automaticamente. |
| Altura | Preserva os pedidos mínimo/natural e seus indicadores de dimensionamento automático. O `height` consultado antes da alocação pode incluir margens; não deve ser passado novamente a `set_height`. Alteração externa anterior a uma nova escrita Lyra passa a ser a referência de restauração. |
| Margens | Compara a geometria atual à última aplicada. Resolve o estado a devolver antes de remover layout/estilos e o aplica depois de toda a remoção, pois CSS pode redefinir margens. |
| Classes do painel e de `Main.uiGroup` | Cada classe tem acompanhamento próprio. Classes preexistentes, classes alheias e uma classe removida/reintroduzida por outro componente são preservadas. Não substitui a lista inteira. |
| Estilo inline da superfície | Remove somente a declaração delimitada do Lyra. CSS acrescentado ou substituído por terceiros é preservado; a transparência anterior não é incorporada à base a cada atualização. |
| Folha de cores dos menus | Descarrega somente o arquivo temporário criado pela instância e remove o arquivo. Libera sinais e atualização idle também se a construção falhar. |
| Painel inferior | Guarda a posição original do relógio e respeita realocação posterior. Preserva direção de menus, deslocamento do centro e visibilidade alterados por terceiros. Restaura a reserva de espaço apenas se o registro e seus parâmetros ainda forem os aplicados pelo Lyra; libera a barreira própria e suas classes. |

`ownedState.ts` implementa escritas reversíveis; `panelState.ts` aplica esse
controle a visibilidade e classes. Uma escrita que não muda o valor não adquire
posse. Notificações de mudanças externas invalidam a posse de visibilidade e
classes, inclusive quando o valor muda e depois retorna ao anterior.

Ao sair, os consumidores soltam os elementos emprestados. O Painel desconecta
sua sincronização, retira layout e temas e restaura a geometria por último.
Falhas na construção do painel básico, superfície, cores ou layout inferior
liberam os recursos já adquiridos. Uma falha ao inserir o relógio devolve o
ator ao pai anterior, evitando deixá-lo destacado do Shell.

## Limites do contrato

- As preferências Lyra continuam governando o layout enquanto o componente está
  ativo. Por exemplo, o painel reaplica suas margens quando St carrega CSS e
  mantém indicadores ocultos quando essa é a preferência do usuário.
- Uma atribuição externa do mesmo valor, sem notificação observável, não informa
  intenção nem identidade do escritor. Não é possível prometer posse exclusiva
  nessas condições. Reescrita arbitrária do próprio trecho CSS Lyra também não
  pode ser identificada como uma declaração ainda própria.
- A posição do relógio é restaurada se o pai ainda for o escolhido pelo Lyra.
  Não se tenta arbitrar entre duas extensões que controlam simultaneamente a
  mesma posição ou a mesma preferência. Menus sem notificação de direção são
  protegidos pela comparação da direção atual à última aplicada.
- A matriz usa atores estrangeiros e falhas controladas em GNOME privado. Não
  certifica todas as extensões do catálogo, X11 ou outra versão do Shell.
- A rodada não encerra os trabalhos gerais de janelas liberadas (#7), posse
  da [integração de animações (#9)](animation-ownership.md) ou falhas parciais de outros componentes (#10).

## Verificação

`npm test` inclui as regressões de visibilidade, geometria, classes, CSS,
atores destruídos, desconexão de sinais e falha parcial. `npm run check`
valida os tipos. Para o teste nativo, a partir da raiz do repositório:

```sh
python3 tests/native-pins/run.py --dist dist \
  --probe tests/native-panel-coexistence/extension.js \
  --output /tmp/lyra-panel-coexistence
```

O harness inicia um compositor separado, com HOME, D-Bus e configurações
privados. Exercita escritores anteriores/posteriores, remoção em ordens
diferentes, indicadores tardios, perfis Clássico/Central e recuperação de
falhas após mutações reais. A suíte nativa geral verifica os seis perfis com
Vega e Desktop Icons.

Instalar o RPM atualiza o disco. Os módulos JavaScript de uma sessão pessoal
já aberta são substituídos no próximo login normal; não se força recarga de
classes GObject, reinício do Shell ou logout para aplicar esta correção.
