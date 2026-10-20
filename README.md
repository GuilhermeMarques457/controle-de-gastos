# Meu dinheiro

Aplicação web simples para registrar despesas e entradas, acompanhar o orçamento por mês e importar as planilhas CSV.

## Como abrir

Abra `index.html` em um navegador moderno. A fonte e os gráficos são carregados de serviços externos, então a primeira abertura precisa de internet.

## Armazenamento

Os lançamentos são gravados no `localStorage` deste navegador. Para sincronizar também com JSONBin:

1. Crie uma conta e um bin JSON no [JSONBin.io](https://jsonbin.io/).
2. No app, abra **Configurações**.
3. Informe o ID do bin e sua `X-Master-Key`.

Ao conectar um bin vazio, o app cria o registro com seus dados locais. Ao conectar um bin existente, os registros locais são enviados para ele. Se o app ainda não tiver dados locais, busca os dados do bin. Cada salvamento atualiza os dois armazenamentos; se a rede falhar, a cópia local permanece salva e o app informa a falha de sincronização. As credenciais ficam no armazenamento deste navegador. Não compartilhe a chave mestra.

O app usa a API v3 do JSONBin com um bin dedicado, sem versionamento do histórico para manter o conteúdo atual sincronizado. Guarde uma cópia dos seus dados se precisar de histórico de versões.

## Importar CSV

Use o botão com seta para cima. São aceitos:

- As planilhas matriciais enviadas: uma linha por categoria e meses nas colunas, com seções **RECEITAS** e **DESPESAS** e o ano no título.
- Arquivos tabulares com colunas como `Data`, `Valor`, `Categoria`, `Tipo`, `Descrição` e `Observação`. `Data` e `Valor` são obrigatórias; a data pode estar em `DD/MM/AAAA` ou `AAAA-MM-DD`.

Cada valor preenchido na matriz mensal vira um lançamento no primeiro dia daquele mês. As categorias encontradas são mantidas como aparecem na planilha, incluindo variações entre anos.

No formulário, as categorias sugeridas acompanham o tipo selecionado: despesas mostram categorias de despesa e receitas mostram categorias de entrada. Categorias importadas ou personalizadas aparecem no tipo em que foram usadas.

## Arquivos

- `index.html` — estrutura da página
- `styles.css` — identidade visual responsiva
- `app.js` — registros, gráficos, importação e persistência
