import type { LandingContent } from "@/lib/landing-content";

/**
 * O site público, em português.
 *
 * Traduzido e não transposto palavra a palavra: «culto» para o encontro de
 * domingo, «célula» para um home cell, «dízimos e ofertas» — são as palavras
 * que uma congregação reconhece. As afirmações continuam verificáveis dentro
 * do produto, tal como na versão inglesa, porque esta página é também o que um
 * motor de busca lê para decidir se o site descreve algo real.
 */
export const pt: LandingContent = {
  hero: {
    eyebrow: "Para igrejas, comunhões e ministérios",
    title: "Tudo o que o seu ministério precisa,",
    titleAccent: "numa só aplicação simples",
    body: "Deixe de andar entre cadernos, folhas de cálculo e grupos de WhatsApp. Presenças, membros, grupos, turmas, ofertas, finanças da igreja e acompanhamento. SMS em massa e e-mail grátis, lembretes que se enviam sozinhos, eventos, formulários, pregações e a sua própria página pública — uma só conta, feita para África.",
    ctaPrimary: "Começar gratuitamente",
    ctaSecondary: "Ver preços",
    reassurance: "Primeiros 7 domingos grátis • Sem cartão • Cancele quando quiser",
  },

  highlights: [
    { value: "18", label: "Módulos, uma só conta" },
    { value: "7", label: "Domingos grátis para experimentar" },
    { value: "₦0", label: "Para começar — sem cartão" },
    { value: "100%", label: "Os seus dados, exportáveis" },
  ],

  painsTitle: "As dores de cabeça diárias de dirigir um ministério",
  painsIntro:
    "Se algum destes lhe soa familiar, não está sozinho — e a culpa não é sua.",
  painsOutro: "O FlockInsight resolve tudo isto — num só lugar. 👇",

  pains: [
    "«Não faço ideia de quantas pessoas vieram no domingo passado — nem no mês passado.»",
    "«Os contactos dos nossos membros estão espalhados por cadernos, telemóveis e três grupos de WhatsApp.»",
    "«Os visitantes vêm uma vez e nunca mais lhes ligamos — simplesmente desaparecem.»",
    "«Contar e registar as ofertas à mão leva horas e mesmo assim não bate certo.»",
    "«Esquecemo-nos dos aniversários, e lembrar toda a gente do culto é uma tarefa manual todas as semanas.»",
    "«Ninguém me sabe dizer quem terminou a turma de fundamentos sem ir ver a um caderno.»",
  ],

  featuresTitle: "Tudo o que precisa para fazer crescer o seu ministério",

  features: [
    {
      icon: "attendance",
      title: "Presenças em menos de um minuto",
      body: "Introduza os números com o polegar no telemóvel, de pé ao fundo da sala — adultos, adolescentes, crianças e visitantes, separados por sexo se quiser. Registar duas vezes o mesmo culto altera-o em vez de o duplicar.",
    },
    {
      icon: "members",
      title: "Membros e agregados",
      body: "Um único registo para toda a congregação, com as famílias agrupadas por agregado e as crianças ligadas a um encarregado. Importe centenas a partir de uma folha de cálculo, ou deixe os membros atualizarem os seus dados por um link privado.",
    },
    {
      icon: "groups",
      title: "Grupos, ministérios e células",
      body: "Coros, acolhimento, departamentos, células e comissões, cada um com os seus líderes e funções. Escreva a qualquer um deles sem incomodar o resto da igreja.",
    },
    {
      icon: "training",
      title: "Formação e turmas",
      body: "Organize turmas de fundamentos, batismo, preparação para o casamento e formação de líderes. Inscreva pessoas, registe notas, e um emblema aparece ao lado do nome de quem concluiu.",
    },
    {
      icon: "giving",
      title: "Ofertas, projetos e promessas",
      body: "Registe dízimos e ofertas nas suas próprias categorias. Lance um fundo de construção com um objetivo, saiba quem prometeu o quê, e contacte apenas quem está mesmo em atraso.",
    },
    {
      icon: "finance",
      title: "Finanças — a contabilidade completa",
      body: "Receitas, despesas, contas bancárias e transferências, com saldos calculados em vez de escritos à mão. Ligue uma categoria de ofertas a um fundo e ele enche-se sozinho a partir do que foi dado.",
    },
    {
      icon: "followup",
      title: "Acompanhamento de visitantes",
      body: "Os visitantes entram numa lista, ficam atribuídos a uma pessoa real, e avançam por etapas até se tornarem membros ou recusarem. Mensagens de boas-vindas automáticas fazem o primeiro contacto.",
    },
    {
      icon: "comms",
      title: "SMS em massa e e-mail grátis",
      body: "Chegue a todos, a um grupo, ou a algumas pessoas. Um ID de remetente próprio para que as mensagens cheguem com o nome da sua igreja, e e-mail que não custa nada, por mais longo que seja.",
    },
    {
      icon: "reminders",
      title: "Lembretes que se enviam sozinhos",
      body: "Todos os cultos, todas as semanas, no seu fuso horário, sem ninguém ter de se lembrar. Aniversários de nascimento e de casamento também, com as suas próprias palavras.",
    },
    {
      icon: "forms",
      title: "Formulários com um link para partilhar",
      body: "Crie uma ficha de visitante ou uma inscrição para um evento, partilhe um link ou um código QR, e as respostas criam fichas de membro e entram sozinhas no acompanhamento.",
    },
    {
      icon: "events",
      title: "Eventos e programas",
      body: "Publique uma cruzada ou uma convenção com o cartaz, as datas e o local. Os eventos públicos aparecem na sua página e no diretório, onde as pessoas procuram uma igreja.",
    },
    {
      icon: "media",
      title: "Pregações e mediateca",
      body: "Carregue pregações, fotografias, boletins e documentos, e partilhe qualquer um por link. O áudio e o vídeo reproduzem-se no navegador — ninguém tem de transferir para ouvir.",
    },
    {
      icon: "devotionals",
      title: "Devocionais e newsletters",
      body: "Escreva um devocional diário ou uma newsletter semanal e envie-a por e-mail a membros e subscritores. Agende com uma semana de antecedência. O e-mail é gratuito e ilimitado.",
    },
    {
      icon: "public",
      title: "A sua própria página pública",
      body: "Uma página a sério em flockinsight.com/c/a-sua-igreja, com os horários dos cultos e os eventos sempre atualizados, porque vêm dos seus próprios registos.",
    },
    {
      icon: "analytics",
      title: "Análises e tendências",
      body: "Crescimento ao longo do tempo, adultos face a crianças, um culto comparado com outro, visitantes mês a mês. A tendência, e não apenas o número do último domingo.",
    },
    {
      icon: "reports",
      title: "Relatórios e exportação completa",
      body: "Qualquer parte dos seus dados em folha de cálculo ou PDF, ou tudo num só ficheiro com um dicionário de dados. Os dados são da sua igreja, e pode sempre levá-los consigo.",
    },
    {
      icon: "branches",
      title: "Congregações e denominações",
      body: "Ligue as congregações a uma sede e veja um relatório único sobre todas elas, agrupadas por zona. Cada congregação mantém os seus registos privados — a sede vê apenas totais.",
    },
    {
      icon: "roles",
      title: "Funções e permissões",
      body: "Deixe o responsável do acolhimento registar presenças sem ver as ofertas, e o tesoureiro manter as contas sem abrir o registo de membros. Uma secção a que alguém não tem acesso simplesmente não existe para essa pessoa.",
    },
  ],

  stepsTitle: "Comece em minutos",
  steps: [
    {
      n: 1,
      title: "Crie a sua conta",
      body: "O nome da sua igreja, o país e a moeda. Cerca de dois minutos, sem cartão.",
    },
    {
      n: 2,
      title: "Adicione cultos e membros",
      body: "Defina os cultos de domingo e de meio da semana, e depois importe a sua congregação de uma folha de cálculo.",
    },
    {
      n: 3,
      title: "Registe o seu primeiro domingo",
      body: "Toque em Registar, introduza os números, guarde. O seu gráfico de presenças começa aí.",
    },
  ],

  builtForTitle: "Feito para o modo como as igrejas africanas funcionam",
  builtFor: [
    {
      title: "Funciona com ligação lenta",
      body: "As páginas que um visitante ou um voluntário abre de facto são feitas para serem leves. Sem painéis pesados onde basta uma página simples, e nada é carregado antes de poder ler a página.",
    },
    {
      title: "SMS que chegam com o nome da sua igreja",
      body: "Tratamos por si do registo do ID de remetente junto das operadoras, para que as suas mensagens digam GraceChapel em vez de um número desconhecido que as pessoas ignoram.",
    },
    {
      title: "Naira, e mais 30 moedas africanas",
      body: "O dinheiro é registado e apresentado na sua própria moeda, não convertido para a de outra pessoa.",
    },
    {
      title: "Moradas como são realmente escritas",
      body: "Casa, rua, cidade, município e província — com pontos de referência na sua página pública, porque é assim que as pessoas são mesmo orientadas numa cidade nigeriana.",
    },
    {
      title: "Funciona no telemóvel que tem no bolso",
      body: "Instale-o no ecrã principal e abre como uma aplicação. As presenças foram pensadas para serem registadas de pé, com uma só mão.",
    },
    {
      title: "Com um preço para uma congregação real",
      body: "Sete domingos grátis, sem cartão para começar, e um plano que arranca pequeno. Nada aqui parte do princípio de um orçamento de igreja americana.",
    },
  ],

  audiencesTitle: "Feito para",
  audiences: [
    "Igrejas locais",
    "Grupos universitários e de estudantes",
    "Células e grupos de casa",
    "Ministérios e obras de evangelização",
    "Denominações com várias congregações",
  ],

  faqTitle: "Respostas diretas",
  faq: [
    {
      q: "O que é o FlockInsight?",
      a: "O FlockInsight é software de gestão para igrejas, comunhões e ministérios. Reúne num só lugar presenças, membros, grupos, formação, ofertas, finanças da igreja, acompanhamento de visitantes, comunicação, eventos, formulários, pregações e relatórios, e dá a cada igreja uma página pública. Funciona num navegador, em qualquer telemóvel ou computador.",
    },
    {
      q: "Quanto custa?",
      a: "Cada igreja tem os primeiros sete domingos grátis, sem necessidade de cartão. Depois há planos pagos em naira, que diferem sobretudo no número de membros que pode ter. O e-mail é gratuito e ilimitado em todos os planos; os SMS são pagos por mensagem a partir de uma carteira que carrega.",
    },
    {
      q: "Funciona no telemóvel?",
      a: "Sim, e foi pensado primeiro para o telemóvel. Pode instalá-lo no ecrã principal e abre como uma aplicação. Registar presenças foi feito para se fazer com uma só mão, de pé.",
    },
    {
      q: "Funciona com uma ligação lenta à internet?",
      a: "Sim. As páginas públicas são propositadamente leves e a aplicação evita carregar seja o que for antes de poder ler a página. Foi construído para igrejas com dados móveis, não com fibra de escritório.",
    },
    {
      q: "Posso enviar SMS aos meus membros?",
      a: "Sim. Pede uma vez um ID de remetente para que as mensagens cheguem com o nome da sua igreja em vez de um número desconhecido, e nós tratamos do registo junto das operadoras. Os SMS são cobrados por mensagem a partir da sua carteira. O e-mail é gratuito e ilimitado.",
    },
    {
      q: "Posso trazer os meus registos existentes?",
      a: "Sim. Membros, histórico de presenças e histórico de ofertas podem ser importados de uma folha de cálculo, para que uma igreja que sai do Excel ou de um livro de registos comece com a sua história intacta em vez de do zero.",
    },
    {
      q: "Quem pode ver o quê?",
      a: "Quem decide é você. As funções controlam o acesso módulo a módulo, por isso o responsável do acolhimento pode registar presenças sem ver as ofertas, e o tesoureiro pode manter as contas sem abrir o registo de membros. Uma secção para a qual alguém não tem permissão não aparece de todo para essa pessoa.",
    },
    {
      q: "Posso recuperar os meus dados?",
      a: "A qualquer momento. Cada parte dos seus registos é transferível em folha de cálculo ou PDF, e uma exportação completa dá-lhe tudo num só ficheiro com um dicionário de dados a explicar como os ficheiros se articulam. Os dados são da sua igreja.",
    },
    {
      q: "Serve para uma denominação com várias congregações?",
      a: "Sim. Cada congregação funciona como a sua própria igreja, com os seus registos e a sua equipa, e pode ligar-se a uma sede que vê totais por congregação, agrupados em zonas. A sede nunca vê as fichas de membro nem os registos de ofertas de uma congregação em particular.",
    },
    {
      q: "Em que países funciona?",
      a: "Em qualquer lugar com ligação à internet, com suporte para mais de 30 moedas africanas. Foi construído a pensar primeiro na Nigéria e no resto de África — formatos de morada, moedas e rotas de SMS estão configurados para esse contexto.",
    },
    {
      q: "Os dados da minha igreja estão seguros?",
      a: "Os registos de cada igreja estão separados e só são acessíveis às pessoas que convidou. A base de dados tem cópias de segurança diárias, é cifrada e copiada para fora do servidor. Ninguém noutra igreja consegue ver os seus membros, as suas ofertas ou as suas mensagens.",
    },
    {
      q: "É preciso perceber de tecnologia para usar?",
      a: "Não. Se sabe usar o WhatsApp, sabe usar o FlockInsight. Configurar uma igreja demora cerca de meia hora, e há guias passo a passo para cada parte, dentro da aplicação.",
    },
  ],

  ctaTitle: "Comece já este domingo",
  ctaBody:
    "Sete domingos grátis. Sem cartão. Os seus dados continuam a ser seus.",
  footerTagline:
    "A dar às igrejas ferramentas de gestão modernas para crescerem e prosperarem.",
  pricing: {
    title: "Preços simples para cada igreja",
    intro:
      "Comece gratuitamente e cresça ao ritmo da sua congregação. Não é preciso cartão para começar.",
    promo: "Promoção de lançamento: os seus primeiros 7 domingos são grátis",
    mostPopular: "Mais escolhido",
    free: "Grátis",
    firstSundays: "Os primeiros 7 domingos",
    getStarted: "Começar",
    contactUs: "Fale connosco",
    perMonth: "/mês",
    customTitle:
      "Precisa de algo à medida para uma denominação ou um ministério com várias congregações?",
    talkToUs: "Fale connosco",
    fullDetailsPre: "Veja todos os detalhes dos planos na",
    pricingPageLink: "página de preços",
    nairaNote: "Preços em nairas.",
    currencyNote:
      "Preços apresentados em {currency}. O seu cartão é debitado em nairas nigerianas, e o total inclui {fee} referentes a taxas de cartão internacional. Convertido à taxa de câmbio de hoje.",
    currencyNoteIndicative:
      "Preços apresentados em {currency}. O seu cartão é debitado em nairas nigerianas, e o total inclui {fee} referentes a taxas de cartão internacional. O serviço de taxas de câmbio está indisponível neste momento, pelo que o valor convertido é indicativo.",
  },
  nav: {
    features: "Funcionalidades",
    howItWorks: "Como funciona",
    pricing: "Preços",
    faq: "Perguntas frequentes",
    findChurch: "Encontrar uma igreja",
    bookDemo: "Marcar uma demonstração",
    logIn: "Entrar",
    startFree: "Começar gratuitamente",
  },
};
