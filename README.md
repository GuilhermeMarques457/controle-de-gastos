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

Use o botão de importação no topo. São aceitos arquivos CSV e extratos PDF do Mercado Pago e do Nubank:

- As planilhas matriciais enviadas: uma linha por categoria e meses nas colunas, com seções **RECEITAS** e **DESPESAS** e o ano no título.
- Arquivos tabulares com colunas como `Data`, `Valor`, `Categoria`, `Tipo`, `Descrição` e `Observação`. `Data` e `Valor` são obrigatórias; a data pode estar em `DD/MM/AAAA` ou `AAAA-MM-DD`.

No extrato PDF do Mercado Pago, as movimentações são identificadas pelo ID da operação. Se o mesmo extrato ou um período sobreposto for importado novamente, os IDs já registrados são ignorados. No PDF do Nubank, cada movimentação recebe uma identificação calculada a partir da data, descrição, valor e ocorrência, para que reimportações e períodos sobrepostos não dupliquem lançamentos.

Para cada banco, o app guarda a data mais recente alcançada pela importação. Na próxima importação, considera os lançamentos dessa data e os posteriores; a data de corte é inclusiva para capturar novas movimentações lançadas no mesmo dia. Os IDs existentes evitam repetir o que já foi importado, sem substituir categorias ou descrições que você editou.

As movimentações sem categoria confirmada entram como **Indefinido** para revisão manual. No Mercado Pago, Pix recebido com o nome do titular da conta é categorizado como **Salário**. As linhas de rendimentos do extrato são somadas em uma única receita por importação.

Cada valor preenchido na matriz mensal vira um lançamento no primeiro dia daquele mês. As categorias encontradas são mantidas como aparecem na planilha, incluindo variações entre anos.

No formulário, as categorias sugeridas acompanham o tipo selecionado: despesas mostram categorias de despesa e receitas mostram categorias de entrada. Categorias importadas ou personalizadas aparecem no tipo em que foram usadas.

## Recursos

- Use **Esconder valores** acima do resumo para ocultar os valores financeiros na tela.
- Em **Movimentações**, escolha entre tabela e cartões no computador; a escolha fica salva neste dispositivo. No celular, a visualização em cartões é automática.
- No cadastro de uma movimentação, marque **Repetir todo mês, no dia 1** para criar os lançamentos dos meses seguintes automaticamente. O app completa meses em falta ao abrir e evita duplicar lançamentos. A data final é opcional; sem ela, a recorrência continua até ser desativada ou o lançamento recorrente ser excluído.

## Clínica

- A área **Clínica** permite cadastrar pacientes com telefone, frequência de sessões semanal, quinzenal ou mensal, frequência de pagamento, data de início e valor por sessão. As sessões previstas são calculadas automaticamente para o mês selecionado, incluindo meses com quatro ou cinco sessões semanais. Uma sessão não paga fica destacada como vencida após o prazo de pagamento do paciente: 7 dias, 15 dias ou até o mesmo dia do mês seguinte (limitado ao último dia do mês quando necessário). Sessões marcadas como falta não geram cobrança vencida.
- Use **Somente vencidas** para listar sessões não pagas vencidas em qualquer mês e ver o total em aberto. Desmarque para voltar à agenda do mês selecionado.
- No computador, alterne entre a tabela de pacientes e a visualização em cartões. A escolha fica salva neste dispositivo; no celular, os pacientes aparecem em cartões automaticamente.
- Para cada sessão, registre presença (a confirmar, compareceu, faltou ou remarcou), valor e pagamento. Sessões pagas entram como receita da categoria **Atendimentos clínicos** no resumo e no fluxo financeiro, separadas dos lançamentos de salário.
- As despesas podem ser classificadas como fixas, parceladas, recorrentes, únicas ou emergenciais, com vencimento no prazo, adiantado ou atrasado. Marque **Já foi pago** para contar a despesa como saída e escolha o pote que ela reduz.
- A divisão inicial dos potes é **Contas 50%**, **Desejos 30%** e **Futuro 20%**. Ela pode ser ajustada; as entradas do mês são distribuídas pelas porcentagens e as despesas pagas reduzem o saldo disponível do pote escolhido.
- Os dados de pacientes, sessões e potes ficam junto aos demais dados locais e também são incluídos no JSONBin quando a sincronização está conectada.

## Arquivos

- `index.html` — estrutura da página
- `styles.css` — identidade visual responsiva
- `app.js` — registros, gráficos, importação e persistência
