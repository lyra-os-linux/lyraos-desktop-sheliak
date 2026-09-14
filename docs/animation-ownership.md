# Animações e eventos nativos — issue #9

A integração é qualificada no GNOME Shell/Mutter **48.8-160100.2.1**, em
Wayland, no Leap 16.1 em desenvolvimento. Zoom, fade e a opção sem animação
continuam disponíveis no Vega. O pacote suporta somente a família GNOME 48;
novas versões precisam repetir a validação nativa.

## Problema e mudança

`signal_handler_find(shellwm, {signalId})` encontra um handler conectado,
mas não demonstra que ele pertence ao GNOME. O WindowManager cria callbacks
com `bind()` no construtor e não expõe essas instâncias para identificação.
Bloquear o primeiro callback encontrado poderia bloquear outra extensão.

Lyra Animações não procura nem bloqueia handlers de minimizar/restaurar.
O GNOME recebe os eventos, decide se a janela deve ser animada, registra a
operação e executa sua própria conclusão. A extensão intercepta somente a
solicitação `actor.ease()` desse caminho para executar seu transform.

O contrato é verificado em `src/shellCompat.ts` e adquirido por
`src/animationBridge.ts`:

1. Confirma o WM nativo, seus conjuntos de minimizar/restaurar, a decisão de
   animação, os sinais de conclusão e as APIs GObject de contexto de emissão.
2. Recusa uma decisão já sobrescrita na instância do WM. Instala um wrapper
   que continua chamando a decisão original.
3. Durante uma emissão de minimizar/restaurar, prepara uma interceptação
   temporária de `ease` somente em um ator sem substituição própria.
4. A interceptação exige o mesmo ator, contexto de evento, operação registrada
   pelo WM e callback `onStopped`. Ela se remove antes de iniciar a animação.
5. O transform termina chamando o `onStopped` fornecido pelo GNOME. Os conjuntos
   nativos controlam a conclusão, inclusive quando `kill-window-effects` já
   encerrou a operação.

Os IDs consultados são dos **tipos de sinal**, nunca de handlers conectados.
Este é um contrato privado de integração, não uma API pública garantida entre
versões do GNOME nem uma promessa de compatibilidade com toda extensão externa.

## Falhas e liberação

Uma interceptação não consumida expira na próxima passagem ociosa do loop,
ao destruir o ator ou ao desativar a extensão. Remoções verificam identidade:
substituições posteriores por terceiros permanecem. Um wrapper retido depois
da desativação apenas delega ao método original.

A extensão conecta apenas seu próprio `kill-window-effects`. Se a aquisição
da integração falhar, libera essa conexão. Falhas de criação, conexão ou
início da timeline liberam sinais e restauram a preparação nativa antes de
chamar o `ease` original. Nunca há desbloqueio de um ID que possa ter sido
removido ou reutilizado por outra extensão.

Ao restaurar rapidamente, a operação anterior termina antes de preparar e
mostrar a janela. Posição, escala, opacidade, translação e pivô são restaurados.
A timeline é registrada antes de começar e sua conclusão é idempotente.
Desativação e fechamento liberam os mapas, sinais e timelines próprios.

## Testes

- `tests/test-window-animations.mjs`: efeitos, conclusão única, alternância
  rápida, conexões externas, substituições antes/depois da ativação, expiração,
  falhas de conexão/alocação/início e desativação durante uma operação.
- `tests/test-shell-compat.mjs`: capacidade ausente, contexto de sinal e
  recusa de contratos incompatíveis antes de alterar o GNOME.
- `tests/native-animation-ownership/extension.js`: janela GTK real, tela cheia,
  zoom/fade/nenhum, restaurações rápidas, callbacks externos conectados antes
  e depois da ativação, falha de conexão da timeline, caminho totalmente nativo,
  substituições externas e fechamento durante uma animação.
- `tests/native-shell-compat/extension.js` e `tests/native-suite/extension.js`:
  alternativas nativas, independência dos componentes, Vega e perfis.

```sh
npm run check
npm test
python3 tests/native-pins/run.py --dist dist \
  --probe tests/native-animation-ownership/extension.js \
  --output /tmp/lyra-animation-results --timeout 120
```

O teste nativo exige o compositor privado do harness e não modifica a sessão
pessoal. Instalar o RPM atualiza arquivos; uma sessão já aberta passa a usar
o novo JavaScript no próximo login normal.

A retenção observada nas transições do próprio GNOME, descrita em
[window-lifecycle.md](window-lifecycle.md), continua como investigação separada.
Esta mudança não instala alterações nos arquivos do GNOME e tem escopo separado da
[cobertura de falhas parciais da issue #10](partial-activation.md).
