# Mefly TV

App de canais de TV ao vivo pra Smart TV (LG webOS / Android TV).
Pega canais de addons no padrão Stremio + iptv-org. 100% client-side.

Hospedado via GitHub Pages — a casca instalada na TV carrega sempre a
versão mais recente daqui (auto-atualização).

## Atualizar o app na TV

1. Edite os arquivos nesta pasta (no PC).
2. Rode `ATUALIZAR_APP.bat` (na pasta de cima, em `tools/`) — ou:
   `git add . && git commit -m "update" && git push`
3. Pronto. A TV pega a nova versão na próxima vez que abrir.

## Rodar/testar local

Use `tools/2-TESTAR_NO_PC.bat` na pasta do projeto.
