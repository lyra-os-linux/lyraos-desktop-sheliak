# Desconexão segura de sinais no SignalTracker

Esta rodada corrige a issue Sheliak #37: o GNOME Shell abortava ao lançar um
aplicativo pela Dock.

## Sintoma

No primeiro login de uma instalação nova (Alpha 8, candidata 3), ao lançar um
aplicativo pela Dock o Shell caía com:

```
GLib-GObject:ERROR:../gobject/gsignal.c:4083:invalid_closure_notify: assertion failed: (handler != NULL)
```

O rastro de pilha passava por `dock@lyraos.com.br/extension.js` no
`SignalTracker` (`destroy` → `object.disconnect(id)`), chamado por
`AppIcon.destroy` dentro de `Dock._redisplay`, que reconstrói os ícones quando
`app-state-changed` dispara.

## Causa

`SignalTracker` desconectava os sinais dentro de um `try/catch`, supondo que
uma fonte já finalizada apenas lançaria uma exceção capturável. Não é o caso:
desconectar um `id` de handler que já saiu da tabela do GObject dispara uma
asserção do GLib (`invalid_closure_notify`), que chama `abort()`. Um `abort()`
encerra o processo e **não** é capturável por `try/catch` em JS.

Isso acontece com emissores compartilhados e de vida longa — como uma
`Shell.App` ou um `Gio.Settings` que sobrevive ao ícone. O dono pode já ter
descartado o handler, ou uma reconstrução pode destruir o mesmo ícone duas
vezes, deixando um `id` obsoleto cujo `disconnect` derruba a sessão inteira.

## Correção

`SignalTracker` agora confirma que o handler ainda está instalado antes de
desconectar:

```ts
if (GObject.signal_handler_is_connected(object, id))
    object.disconnect(id);
```

`signal_handler_is_connected` apenas consulta a tabela de handlers e nunca
aborta. Emissores que não são GObject (`imports.signals`, como `PopupMenu` ou
os arrastáveis do DND) continuam pelo `try/catch`, que é suficiente porque o
`disconnect` deles é puro JavaScript e não pode abortar o processo.

## Ensaio reproduzível

`npm test` inclui `tests/test-signal-tracker.mjs`, que usa a implementação real
do `SignalTracker` com um emissor GObject simulado. Ele cobre:

- `destroy()` com um emissor compartilhado já finalizado (não tenta desconectar
  ids obsoletos);
- `destroy()` com handlers vivos (desconecta exatamente uma vez cada);
- `disconnect(object, id)` repetido e idempotente;
- emissores JavaScript puros, que continuam pelo caminho do `try/catch`.

O teste modela o `abort()` do GLib como efeito colateral, não como exceção,
porque uma asserção real não seria capturável — um teste que lançasse seria
silenciado pelo `catch` antigo e passaria pelo motivo errado.
