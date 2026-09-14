# Falhas parciais de ativação — issue #10

Cada componente deve liberar os recursos criados antes de uma falha, inclusive
quando seu construtor ainda não retornou para `scope.own()`. O `Scope` continua
responsável pelos objetos já registrados e desmonta esses objetos em ordem
inversa. Os construtores cuidam do intervalo anterior ao registro.

## Proteções

- Dock, ícones, lixeira, botão de aplicativos, tooltip, ampliação, indicadores
  dos menus, menu Iniciar e Busca protegem sua inicialização e liberam os
  campos já preenchidos antes de relançar o erro original.
- A limpeza admite campos ainda não inicializados. Sinais externos são
  desligados antes dos atores; menus e chrome próprios são removidos. Os
  ícones entram na lista do Dock antes da configuração posterior. Fechar um
  popup durante a limpeza não pode agendar outra atualização do Dock.
- O menu Iniciar registra cada recurso assim que o adquire: botão próprio,
  lançador alternativo, popup, ação emprestada do Dock e conexão da tecla Super.
  Uma falha intermediária libera essa aquisição, inclusive sem Dock ativo.
- Painel e Animações mantêm as proteções anteriores de restauração por posse.
  Falhas de capacidades opcionais de animação usam o caminho nativo documentado
  em [animation-ownership.md](animation-ownership.md).
- Desktop Icons tolera auxiliares ainda não criados. Sua limpeza tenta cada
  recurso separadamente: processos, sinais, nomes D-Bus, grupos de ações e
  temporizadores. Falhas assíncronas no startup ou D-Bus são registradas pelo
  gerenciador de extensões do GNOME. Um callback de uma ativação anterior não
  pode recriar o serviço nem lançar o auxiliar após desativação/reativação.
- O coordenador preserva o erro de ativação mesmo se a limpeza também falhar;
  erros secundários são registrados separadamente.

Nenhum ponto de injeção de falha foi adicionado ao código de produção. A matriz
altera métodos somente dentro do compositor descartável e restaura-os ao final.
O teste não altera nem reinicia a sessão pessoal.

## Cobertura nativa

`tests/native-partial-activation/extension.js` usa os seis bundles reais e
exercita os seguintes limites internos:

| Componente | Falhas exercitadas |
| --- | --- |
| Dock | Conexão da lixeira, preferências da ampliação, inclusão parcial de chrome, sistema de aplicativos e ícone com menu já criado |
| Painel | Rastreamento de classes, cores da superfície, tema após criar arquivo temporário e conexões do painel inferior |
| Menus | Aplicativos, volumes, inserção parcial no painel, conexão Super e menu Iniciar com Dock desligado |
| Busca | Largura do campo, inserção parcial do popup e índice de aplicativos |
| Animações | Conexão ao compositor e aquisição da integração com o WM; retorno nativo |
| Desktop Icons | Espera de startup, emulação de janela, geometria e criação assíncrona das ações D-Bus |

Depois de cada falha o probe confere o erro original (ou a alternativa nativa
prevista), sinais externos, assinaturas D-Bus, arquivos temporários, atores
Lyra, chrome, indicadores, aparência, componentes independentes e reativação.
Imagens internas que o GNOME recria podem mudar de identidade; o teste conserva
o limite total de atores e verifica individualmente os atores Lyra e chrome.
Uma falha assíncrona é registrada de fato pelo GNOME como erro da extensão;
esse erro identificado como `LYRA_INJECTED` é esperado no log privado.

No GNOME48.8 testado, adicionar e destruir um `St.BoxLayout` no chrome no mesmo
frame também produz avisos nativos `st_widget_get_theme_node`/`Spurious
clutter_actor_allocate`. A reprodução mínima com todos os componentes Lyra
desligados confirma o mesmo comportamento. A injeção exercita esse limite;
os avisos ficam registrados e separados de erros JavaScript, sem silenciá-los.
Sinais, atores e chrome são liberados e a reativação passa. Isso não significa
que a falha de alocação nativa tenha sido corrigida pelo pacote.

`tests/test-desktop-activation.mjs` exercita o entrypoint real com auxiliares
simulados: primeira ativação incompleta, falhas de ações/exportação, callbacks
antigos e ciclos de habilitar/desabilitar. O teste de ciclo de vida também
confere callbacks de fechamento de menus durante a destruição do Dock.

```sh
npm run check
npm test
python3 tests/native-pins/run.py --dist dist \
  --probe tests/native-partial-activation/extension.js \
  --output /tmp/lyra-partial-activation --timeout 180
```

A qualificação usa GNOME Shell/Mutter **48.8-160100.2.1**, Wayland, em Leap16.1
em desenvolvimento. Inclui testes integrados dos perfis/Vega e regressão de
animações e descarte de janelas. Essa matriz cobre os limites descritos, sem
prometer recuperar toda falha interna de alocação em bibliotecas GNOME ou
qualificar outras versões. A investigação de retenção na base GNOME continua
separada; nenhum arquivo do GNOME é modificado pelo RPM Sheliak.
