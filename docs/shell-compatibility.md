# Compatibilidade com GNOME Shell

A suíte suporta a família GNOME 48. O RPM exige `gnome-shell >= 48` e `< 49`,
e os seis metadados continuam declarando somente `48`. A versão de manutenção
qualificada nesta rodada local é **GNOME Shell/Mutter 48.8-160100.2.1**, no
openSUSE Leap 16.1 em desenvolvimento. Isso não qualifica automaticamente
versões passadas/futuras, GNOME 49, outra distribuição ou sessões X11 reais.

## Adaptadores e alternativas

Os acessos privados dos componentes TypeScript ficam em `src/shellCompat.ts`.
O adaptador verifica métodos e formatos antes de alterar o Shell, retorna
`null` quando uma capacidade opcional falta e registra um diagnóstico por
capacidade/bundle. Não inventa estruturas substitutas dentro do GNOME.

| Dependência | Consumidor | Comportamento sem a capacidade |
| --- | --- | --- |
| `layoutManager._startingUp` e `startup-complete` | Dock e Desktop Icons | Flag ausente equivale a inicialização concluída; Dock só suprime a overview após conectar a restauração. A ausência do sinal mantém a overview nativa. LDI conserva seu ciclo de inicialização upstream. |
| `panel._rightBox`, com enumeração e sinais | Painel | Mantém geometria e relógio; não interfere na visibilidade dos indicadores nativos. |
| `panel._leftBox/_centerBox/_rightBox` e medição | Menus/Busca | Usa uma caixa disponível e apresentação compacta quando não pode calcular espaço; sem caixa disponível, não insere indicadores. |
| Caixas centrais/laterais, `_trackedActors`, flags booleanas do painel, `_updatePanelBarrier`, `_destroyPanelBarrier` | Painel inferior Clássico/Central | Não move o painel nem hospeda o dock. O painel superior e o dock independente permanecem utilizáveis. |
| `menu._boxPointer`, `updateArrowSide`, `arrowSide` | Menus/Painel | Conserva a orientação nativa do popup. |
| `overview.dash`, `hide/show`, visibilidade | Dock | Mantém o Lyra Dock; não tenta ocultar/restaurar um dash desconhecido. |
| `overview.showApps` | Botão de aplicativos do Dock | Abre a overview nativa por `show`, se disponível. |
| ExtensionManager `lookup/connect/disconnect` | Core | Descoberta é obrigatória antes da ativação para impedir coexistência com a extensão monolítica antiga. Sua ausência interrompe somente a extensão que está sendo ativada, antes de ela alterar o Shell. |
| Endpoint Lyra `version/current/subscribe` | Integrações entre extensões | Protocolo incompatível ou assinatura ausente equivale a provedor indisponível. |
| ShellWM completion, sinais e bloqueio/desbloqueio; descoberta de ambos os handlers | Animações | Mantém animações nativas. Falha ao conectar substitutos libera conexões e bloqueios já adquiridos. |
| `WorkspaceAnimation.WorkspaceGroup.prototype._shouldShowWindow` e `Shell.Global.prototype.get_window_actors` | Adaptador herdado do Desktop Icons | Método ausente ou somente leitura não é interceptado. Desktop continua com o comportamento de listagem de janelas nativo. |

No painel inferior, a aquisição guarda as flags originais e a função de
barreira, antes de modificar o layout. A liberação é idempotente. Se a
aquisição falhar, desfaz o que adquiriu. Uma função de barreira substituída
posteriormente por outra extensão não é sobrescrita na liberação.

O adaptador JavaScript de Desktop Icons permanece em
`extensions/desktop-icons/gnomeShellOverride.js`, junto do código herdado.
Captura os callbacks originais por instância, verifica capacidade antes de
interceptar e restaura somente o método que ainda possui. Um terceiro que
retenha o wrapper pode chamá-lo após desativação: ele delega ao original sem
consultar estado descartado. O acesso à flag de startup usa o Core comum.
`UPSTREAM.md` registra essas diferenças para a próxima atualização do fork.

`Gio._promisify`, `_delegate` do protocolo DND e `_init` de classes GObject são
contratos GJS/GObject/integração diferentes dos campos privados acima. Não se
substituem indiscriminadamente nomes iniciados por sublinhado. APIs públicas
de Clutter, St, Meta, Gio e o restante dos módulos upstream continuam sujeitos
à qualificação da versão instalada.

## Validação e limites

- `npm run check` e `npm test`: TypeScript, empacotamento, traduções, migração,
  layout, liberação dos adaptadores, capacidades ausentes/incompatíveis e
  preservação de substituições posteriores feitas por terceiros.
- `tests/native-shell-compat/extension.js`: compositor GNOME 48 privado;
  oculta campos somente durante a ativação síncrona da extensão e restaura
  antes dos callbacks do próprio GNOME. Verifica alternativas de layout,
  menus/busca, descoberta, dash e uma janela GTK real minimizada/restaurada
  após falhas na integração de animações. Não modifica a sessão pessoal.
- `tests/native-suite/extension.js`: Desktop Icons com janela auxiliar,
  Vega real, perfis, revogação/recriação de provedores e ordens de ativação.

Exemplo do teste negativo, executado na raiz do repositório:

```sh
python3 tests/native-pins/run.py --dist dist \
  --probe tests/native-shell-compat/extension.js --output /tmp/lyra-compat-results
```

O teste negativo simula a interface vista pelas extensões; não transforma
GNOME 48.8 em outra versão de manutenção. Cada nova versão do pacote GNOME
suportado exige repetir os testes nativos e registrar versões, artefatos e
resultados antes da qualificação. Alterar somente `shell-version` não basta.

A identificação inequívoca da posse dos handlers de animação continua na
issue #9: a busca GObject por sinal valida existência/conexão, mas ainda não
prova quem registrou cada callback. Esta correção não encerra #9, janelas
liberadas (#7) ou falhas parciais genéricas (#10). A rodada de coexistência
do Painel (#2) tem [contrato e testes próprios](panel-coexistence.md).
Os testes de compatibilidade aqui cobrem os caminhos modificados, sem alegar
cobertura de toda exceção possível de um construtor.

Na instalação local, o RPM substitui arquivos no disco. Uma sessão GNOME já
aberta mantém módulos JavaScript carregados; as novas proteções passam a
valer na próxima sessão. Não se força logout/reinício nem se recriam classes
GObject em uso para atualizar código durante a sessão pessoal.
