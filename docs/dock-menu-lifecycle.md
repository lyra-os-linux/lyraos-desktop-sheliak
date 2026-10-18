# Ciclo de vida dos menus e ícones da Dock

Esta rodada remove a exposição restante ao abort do GNOME Shell que a
Sheliak 2.0.4 (issue #37) não cobria.

## Sintoma

Em 18/10/2026, numa sessão Leap 16.1 com GNOME 48.8, GLib 2.84.4 e gjs 1.84.2,
o Shell abortou duas vezes com a mesma assertion de antes:

```
gclosure.c:754: unable to remove uninstalled invalidation notifier
GLib-GObject:ERROR:../gobject/gsignal.c:4083:invalid_closure_notify: assertion failed: (handler != NULL)
```

Os gatilhos foram abrir o Firefox e abrir janelas de terminal: qualquer
`app-state-changed`. O rastro JS era idêntico nos dois coredumps:

```
Dock._redisplay → AppIcon.destroy → AppContextMenu.destroy → PopupMenu.destroy
→ popupMenu.js:1001 (this.actor.destroy())
```

## Diagnóstico nos coredumps

Com símbolos de depuração (GLib, GObject, gjs, mutter, gnome-shell) os dois
cores mostram o mesmo estado:

- o ator destruído é o `StDrawingArea` `_border` do `BoxPointer` do menu, e o
  handler é o `repaint` que o próprio Shell conecta em `boxpointer.js`;
- a closure desse handler tem quatro notifiers de invalidação; o do gsignal
  está com `data = NULL` em vez do ponteiro da instância, por isso
  `invalid_closure_notify(NULL)` não encontra o handler e aborta;
- apenas essa palavra de 8 bytes está corrompida; as entradas vizinhas e a
  struct `Handler` (instância e sinal corretos) estão íntegras;
- o bloco de heap reutilizado abrigava antes uma `GCClosure` em C do handler
  `child-added` do `StScrollView`.

Ou seja, o `SignalTracker` da extensão não participa: a desconexão acontece
dentro do `PopupMenu.destroy` do Shell, sobre um estado já corrompido por
código C. Um `signal_handler_is_connected` não alcança esse caminho, e o
`abort()` não é capturável em JS.

Um GNOME Shell aninhado (bus e perfil dconf privados, watchpoints de hardware
na entrada do gsignal de 203 closures `repaint`, cinco rodadas de redisplay)
não reproduziu a corrupção. A causa primária permanece fora da Sheliak.

## Correção

A exposição vinha do volume de menus criados e destruídos: cada
`app-state-changed` destruía todos os `AppIcon` da Dock junto com um
`PopupMenu` completo por ícone (BoxPointer, borda, registro no
`PopupMenuManager`), mesmo que nenhum menu tivesse sido aberto.

1. **Menu sob demanda.** `AppIcon` cria o `AppContextMenu` no primeiro clique
   direito ou na primeira tecla Menu / Shift+F10, como o `AppIcon` do próprio
   GNOME (`appDisplay.js`). Antes de existir o menu, o próprio botão trata
   essas teclas; depois, o handler que o `PopupMenu` instala no ator de origem
   assume (`AppPopupMenu._onKeyPress`). `menu` é `null` até o primeiro uso.

2. **Reconciliação em vez de reconstrução.** `Dock._redisplay` compara a lista
   desejada (favoritos + apps em execução) com os ícones existentes. Um ícone
   é mantido quando app, flag de favorito, tamanho e perfil não mudaram; só
   muda de posição em `_appsBox`. Os demais são criados ou destruídos. O
   ampliador libera seus sinais antes de qualquer destruição, como antes.

Em uma sessão típica, abrir ou fechar um aplicativo deixa de destruir
qualquer menu; um ícone só morre quando o app sai da Dock, muda de favorito,
de tamanho ou de perfil.

## Ensaio reproduzível

`npm test` inclui:

- `tests/test-dock-redisplay.mjs`: usa o `_redisplay` real com um `AppIcon`
  simulado e verifica reuso, ordem dos filhos, destruição apenas dos ícones
  que saíram, recriação por mudança de favorito, tamanho e perfil, e que o
  ampliador solta os ícones antes de qualquer `destroy`.
- `tests/test-app-icon-menu.mjs`: usa o `AppIcon` real com um
  `AppContextMenu` simulado e verifica que nenhum menu existe até o primeiro
  clique direito ou tecla Menu / Shift+F10, que o mesmo menu é reaproveitado,
  que `open-state-changed` continua chegando à Dock e que `destroy` fecha e
  destrói o menu uma única vez.

## Limites

A corrupção de memória de origem C continua sem autor identificado; esta
rodada reduz drasticamente a frequência do caminho que a expõe, não a causa.
Se o abort voltar, o rastro deve apontar para outro consumidor de
`PopupMenu` ou para outro `StDrawingArea`, e a investigação deve partir dos
coredumps com os mesmos símbolos.
