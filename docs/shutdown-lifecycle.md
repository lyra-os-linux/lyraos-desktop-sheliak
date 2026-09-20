# Encerramento do Shell — Sheliak #34

A versão 2.0.3 libera os componentes que usam `LyraExtension` no sinal `destroy`
do `uiGroup`, antes da destruição dos seus filhos. Na base GNOME48.8, o
LayoutManager destrói esse grupo em seu callback de `global::shutdown`;
callbacks posteriores, inclusive durante o loop de encerramento de main.js,
podem encontrar o painel e os atores do dock já descartados.

A correção revoga os providers antes de liberar seus recursos, preserva a
restauração normal e desconecta o hook ao desativar. Desativação repetida ou
reentrante é inofensiva; a instância encerrada não pode reativar-se durante o
shutdown. Uma nova instância continua podendo ativar-se numa nova sessão.
Não há captura genérica para ocultar acessos a atores destruídos.

## Comparação nativa em20/09/2026

GNOME Shell/Mutter48.8-160100.2.1, compositor Wayland headless privado,
D-Bus e diretórios XDG temporários, renderização llvmpipe. Baseline Git64212dd.

O harness alterna os quatro perfis, desativa/reativa os componentes em dois
ciclos, envia SIGTERM real ao compositor e aguarda sua saída. Um callback de
shutdown do probe solicita explicitamente uma segunda desativação tardia,
após o LayoutManager, para reproduzir de maneira determinística a ordem da
falha. Isso não equivale a executar logout pelo GNOME Session ou reiniciar
uma VM. Os logs são inspecionados **depois** da saída; exigimos código0,
nenhum encerramento forçado, nenhuma mensagem de acesso a objeto descartado,
nenhum erro JS/cleanup e nenhum callback de GC adicional ao controle nativo.

| Cenário final | Objetos descartados na baseline | Na correção |
| --- | ---: | ---: |
| Shell sem componentes Lyra | 0 | 0 |
| Painel isolado | 42 | 0 |
| Dock isolado | 41 | 0 |
| Painel + dock, Lyra | 83 | 0 |
| Painel + dock, Windows10 | 143 | 0 |
| Painel + dock, Windows11 | 168 | 0 |
| Painel/dock/menus/busca/animações, macOS | 130 | 0 |

Os dois lados encerraram sem segfault; a baseline confirma os acessos inválidos,
não uma reprodução da queda nativa. Os 208 checks da matriz verificam os ciclos
de ativação; o ensaio separado de coexistência passou69 checks de restauração
de geometria, menus, relógio, convivência e rollback de ativação parcial.

A reprodução preliminar sem o callback tardio também mostrou acessos inválidos
em menus/busca. Com DING ativo, apareceram avisos de GC não atribuídos por stack
suficiente; não se declara que a correção eliminou todos os avisos de todo o
Shell. A matriz controlada acima isola os cinco componentes derivados de
LyraExtension e não usa DING. Seus logs não tiveram avisos de GC em nenhum lado.

Testes automatizados:133 testes Node,3 testes de provider,12 Python, catálogos,
TypeScript e compilação. Evidência e hashes: [shutdown-evidence.json](shutdown-evidence.json).

## Reprodução

```sh
npm run check
npm test
python3 tests/native-shutdown/run.py --output /tmp/sheliak-shutdown
```

Para comparar um bundle anterior, acrescentar `--dist /caminho/dist-anterior`
e `--expect-disposed`. O teste espera ao menos um cenário com o defeito, mas
continua exigindo execução completa e saída normal do compositor.

## Limites e próximos gates

Não foi encontrado coredump acessível do incidente físico de18/09. Não atribuir
a causa do segfault em libmutter-clutter a esta falha apenas pela proximidade
no journal. O controle llvmpipe demonstra que os acessos inválidos independem
da GPU NVIDIA específica; não qualifica todos os drivers.

A issue34 permanece aberta: publicar e qualificar o RPM2.0.3, incluir na
candidata, executar logout/reboot em sessão GNOME completa e hardware aplicável,
com o checksum exato da ISO. Nenhum componente da sessão do mantenedor foi
substituído/desativado; nenhuma ISO foi construída. Reversão: reverter fontes,
reconstruir pelo staging e manter a candidata bloqueada até repetir os gates.
