# Ativação dos aplicativos — auditoria #18

O dock participa do seletor `Ctrl+Alt+Tab` com o nome Sheliak. Tab e as setas
usam a navegação de foco do GNOME; Enter, Espaço e Enter numérico ativam o botão.
O foco mantém o dock visível no modo de ocultação automática. Menu ou Shift+F10
abrem o menu de contexto e Escape o fecha. A aparência do foco usa o CSS existente.

## Implementação

- `clicked` é a única entrada para ativar um aplicativo por mouse, teclado ou
  ação acessível. A liberação primária chega ao tratamento nativo de `St.Button`;
  a secundária continua abrindo o menu. Não há ativação duplicada.
- `PopupMenu` normalmente captura Enter/Espaço na origem. O menu de aplicativo
  deixa essas teclas e as setas passarem e reserva Menu/Shift+F10 para si.
- O botão exporta `Atk.Action` com uma ação localizada (`Activate`, `Ativar`,
  `Activar`). Geometria, foco e estados são delegados ao objeto nativo. A consulta
  acessível não substitui a associação que ATK mantém com o ator nem inicializa
  ponteiros opacos por JavaScript. Consultas durante construção/descarte retornam
  um objeto inativo; ações agendadas são canceladas quando o botão é destruído.
- GJS resolve `get_name` contra `Atk.Object`, antes de `Atk.Action`; por isso o
  rótulo da ação usa `get_localized_name`, preservando o nome do aplicativo.
- DND arrasta uma textura separada, preservando o botão e sua posição ao cancelar.
  A posição de inserção considera a metade de cada item, permitindo mover um
  favorito para depois do último sem sair da área de aplicativos.

Referências da plataforma: [St.Button 48.8](https://github.com/GNOME/gnome-shell/blob/48.8/src/st/st-button.c),
[PopupMenu](https://github.com/GNOME/gnome-shell/blob/48.8/js/ui/popupMenu.js),
[DND](https://github.com/GNOME/gnome-shell/blob/48.8/js/ui/dnd.js) e
[Clutter.Actor](https://github.com/GNOME/mutter/blob/48.8/clutter/clutter/clutter-actor.c).

## Qualificação em 10/09/2026

```sh
npm run check
npm test
python3 tests/native-keyboard/run.py --output /tmp/sheliak-keyboard-result
```

O ensaio nativo exige GNOME Shell/Mutter 48, GTK4, AT-SPI, PyGObject e
`dbus-run-session`. Usa uma sessão Wayland headless com llvmpipe, bus privado e
diretórios XDG temporários. Os eventos vêm de dispositivos virtuais do Mutter;
a ação acessível é chamada por outro processo via AT-SPI. Um aplicativo GTK real
abre duas janelas para testar lançamento e alternância. Nenhuma configuração da
sessão pessoal ou transação de pacotes é usada.

Na base `be83e17`, 17 dos 29 checks falharam, incluindo Enter/Espaço/Enter
numérico, AT-SPI, entrada no dock, menus de teclado e revelação por foco. Com a
correção, **29/29 passaram**, incluindo clique único, cancelamento ao perder foco,
geometria acessível, menu secundário, arraste/cancelamento/reposicionamento,
ocultação automática e foco nos perfis Lyra, Ubuntu, Windows 10 e Windows 11.
O log final não apresentou erros de objetos descartados ou de memória do Sheliak;
serviços do sistema ausentes são esperados no bus isolado.

Também passaram TypeScript, 24 testes Node, os catálogos de 141 chaves com gettext
real nos três idiomas e a leitura do spec RPM. O CI executa os testes Node e de
tradução; o teste nativo é separado por exigir GNOME 48. A qualificação não inclui
saída de voz do Orca, login via GDM, instalação de novo RPM ou publicação OBS.
