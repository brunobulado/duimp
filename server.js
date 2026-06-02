const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const session = require('express-session');

const app = express();
app.use(express.json());

app.use(session({
    secret: 'chave-super-secreta-duimp',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

app.use(express.static('public'));

// =================================================================
// BANCO DE DADOS AUTOGERENCIÁVEL COM MIGRAÇÃO
// =================================================================
const DATA_DIR = path.join(__dirname, 'data');
const CLIENTES_FILE = path.join(DATA_DIR, 'clientes.json');
const USUARIOS_FILE = path.join(DATA_DIR, 'usuarios.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(CLIENTES_FILE)) fs.writeFileSync(CLIENTES_FILE, JSON.stringify([], null, 4));

if (!fs.existsSync(USUARIOS_FILE)) {
    const adminPadrao = [{ id: "1", usuario: "admin", senha: "123", perfil: "admin" }];
    fs.writeFileSync(USUARIOS_FILE, JSON.stringify(adminPadrao, null, 4));
}

function lerDB(arquivo) { 
    let dados = JSON.parse(fs.readFileSync(arquivo, 'utf8')); 
    
    // Migração automática: Garante que os clientes antigos ganhem um ID e suportem o CNPJ completo
    if (arquivo === CLIENTES_FILE) {
        let modificado = false;
        dados.forEach(c => {
            if (!c.id) { c.id = Date.now().toString() + Math.floor(Math.random() * 1000); modificado = true; }
            if (!c.cnpjCompleto) { c.cnpjCompleto = c.cnpjRaiz; modificado = true; }
        });
        if (modificado) salvarDB(CLIENTES_FILE, dados);
    }
    return dados;
}
function salvarDB(arquivo, dados) { fs.writeFileSync(arquivo, JSON.stringify(dados, null, 4)); }

// =================================================================
// LOGIN E USUÁRIOS
// =================================================================
app.post('/api/login', (req, res) => {
    const { usuario, senha } = req.body;
    const usuarios = lerDB(USUARIOS_FILE);
    const userLogado = usuarios.find(u => u.usuario === usuario && u.senha === senha);
    if (userLogado) {
        req.session.logado = true;
        req.session.usuario = userLogado.usuario;
        req.session.perfil = userLogado.perfil;
        res.json({ success: true, perfil: userLogado.perfil });
    } else res.status(401).json({ success: false });
});

app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });
app.get('/api/check-auth', (req, res) => res.json({ logado: !!req.session.logado, usuario: req.session.usuario, perfil: req.session.perfil }));

function checkAuth(req, res, next) { if (req.session.logado) next(); else res.status(403).json({ error: "Acesso negado." }); }
function checkAdmin(req, res, next) { if (req.session.logado && req.session.perfil === 'admin') next(); else res.status(403).json({ error: "Restrito." }); }

app.get('/api/usuarios', checkAdmin, (req, res) => res.json(lerDB(USUARIOS_FILE)));
app.post('/api/usuarios', checkAdmin, (req, res) => {
    const usuarios = lerDB(USUARIOS_FILE);
    usuarios.push({ id: Date.now().toString(), ...req.body });
    salvarDB(USUARIOS_FILE, usuarios);
    res.json({ success: true });
});
app.delete('/api/usuarios/:id', checkAdmin, (req, res) => {
    let usuarios = lerDB(USUARIOS_FILE);
    usuarios = usuarios.filter(u => u.id !== req.params.id);
    salvarDB(USUARIOS_FILE, usuarios);
    res.json({ success: true });
});

// Nova rota: Admin reseta a senha de um usuário
app.put('/api/usuarios/:id/reset-senha', checkAdmin, (req, res) => {
    const usuarios = lerDB(USUARIOS_FILE);
    const index = usuarios.findIndex(u => u.id === req.params.id);
    if (index >= 0) {
        usuarios[index].senha = req.body.novaSenha;
        salvarDB(USUARIOS_FILE, usuarios);
        res.json({ success: true });
    } else res.status(404).json({ success: false });
});

// O próprio usuário muda sua senha
app.put('/api/usuarios/senha', checkAuth, (req, res) => {
    const usuarios = lerDB(USUARIOS_FILE);
    const index = usuarios.findIndex(u => u.usuario === req.session.usuario);
    if (index >= 0) {
        usuarios[index].senha = req.body.novaSenha;
        salvarDB(USUARIOS_FILE, usuarios);
        res.json({ success: true });
    } else res.status(404).json({ success: false });
});

// =================================================================
// CLIENTES (Agora com edição e CNPJ Completo)
// =================================================================
app.get('/api/clientes', checkAuth, (req, res) => {
    const clientes = lerDB(CLIENTES_FILE);
    if (req.session.perfil !== 'admin') {
        return res.json(clientes.map(c => ({ id: c.id, cnpjCompleto: c.cnpjCompleto, nome: c.nome })));
    }
    res.json(clientes);
});

app.post('/api/clientes', checkAdmin, (req, res) => {
    const clientes = lerDB(CLIENTES_FILE);
    const data = req.body;
    
    // Garante que a raiz seja sempre os 8 primeiros dígitos do CNPJ completo
    data.cnpjRaiz = data.cnpjCompleto.substring(0, 8);

    if (data.id) {
        // Modo Edição: Substitui o cliente existente pelo ID
        const index = clientes.findIndex(c => c.id === data.id);
        if (index >= 0) clientes[index] = data;
        else clientes.push(data);
    } else {
        // Modo Novo Cadastro
        data.id = Date.now().toString();
        clientes.push(data);
    }
    salvarDB(CLIENTES_FILE, clientes);
    res.json({ success: true });
});

app.delete('/api/clientes/:id', checkAdmin, (req, res) => {
    let clientes = lerDB(CLIENTES_FILE);
    clientes = clientes.filter(c => c.id !== req.params.id);
    salvarDB(CLIENTES_FILE, clientes);
    res.json({ success: true });
});

// =================================================================
// INTEGRAÇÃO SISCOMEX: CATÁLOGO, SEFAZ E DUIMP
// =================================================================
let AMBIENTE_GERAL = { token_jwt: "", token_csrf: "", expiresAt: null, cnpjAtual: "" };

async function autenticarSiscomex(cliente) {
    if (AMBIENTE_GERAL.token_jwt && Date.now() < AMBIENTE_GERAL.expiresAt && AMBIENTE_GERAL.cnpjAtual === cliente.cnpjRaiz) return true;
    try {
        const res = await fetch("https://portalunico.siscomex.gov.br/portal/api/autenticar/chave-acesso", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Client-Id': cliente.clientId, 'Client-Secret': cliente.clientSecret, 'Role-Type': cliente.roleType || 'IMPEXP' }
        });
        if (!res.ok) return false;
        let jwt = res.headers.get("Set-Token") || res.headers.get("set-token");
        if (jwt && jwt.startsWith("Bearer ")) jwt = jwt.replace("Bearer ", "");
        let csrf = res.headers.get("X-CSRF-Token") || res.headers.get("x-csrf-token");
        if (jwt && csrf) {
            AMBIENTE_GERAL = { token_jwt: jwt, token_csrf: csrf.trim(), expiresAt: Date.now() + 55 * 60 * 1000, cnpjAtual: cliente.cnpjRaiz };
            return true;
        }
    } catch (e) { console.error(e); }
    return false;
}

app.get('/api/versoes-duimp', checkAuth, async (req, res) => {
    let { id_cliente, numero_duimp } = req.query;
    numero_duimp = numero_duimp.replace(/[^A-Za-z0-9]/g, '');

    const clientes = lerDB(CLIENTES_FILE);
    const cliente = clientes.find(c => c.id === id_cliente);
    if (!cliente) return res.status(404).json({ error: "Cliente não encontrado." });
    if (!(await autenticarSiscomex(cliente))) return res.status(500).json({ error: "Falha na autenticação Siscomex." });

    try {
        const resVer = await fetch(`https://portalunico.siscomex.gov.br/duimp-api/api/ext/duimp/${numero_duimp}/versoes`, {
            headers: { 'Authorization': AMBIENTE_GERAL.token_jwt, 'X-CSRF-Token': AMBIENTE_GERAL.token_csrf }
        });
        if (!resVer.ok) throw new Error("DUIMP não encontrada.");
        res.json(await resVer.json());
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/gerar-duimp', checkAuth, async (req, res) => {
    let { id_cliente, numero_duimp, versao } = req.query;
    numero_duimp = numero_duimp.replace(/[^A-Za-z0-9]/g, '');
    versao = versao.replace(/[^0-9]/g, '');

    const htmlErro = (msg, detalhes = "") => `
        <div style="font-family: Arial; padding: 40px; text-align: center;">
            <h2 style="color: #dc3545;">Erro na Extração</h2>
            <p style="font-size: 16px;">${msg}</p>
            ${detalhes ? `<p style="font-size: 13px; color: #666;">Detalhes: ${detalhes}</p>` : ''}
            <button onclick="window.history.back()" style="padding: 10px 20px; background: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer; margin-top: 20px;">Voltar</button>
        </div>
    `;

    const clientes = lerDB(CLIENTES_FILE);
    const cliente = clientes.find(c => c.id === id_cliente);
    if (!cliente) return res.status(404).send(htmlErro("Cliente não encontrado na base de dados."));

    if (!(await autenticarSiscomex(cliente))) return res.status(500).send(htmlErro("Falha na autenticação com o Siscomex.", "Verifique o Client-Id, Client-Secret e Role-Type do cliente cadastrado."));

    const headersApi = { 'Authorization': AMBIENTE_GERAL.token_jwt, 'X-CSRF-Token': AMBIENTE_GERAL.token_csrf, 'Content-Type': 'application/json' };
    const getApi = async (url) => {
        const r = await fetch(url, { method: 'GET', headers: headersApi });
        if (!r.ok) throw new Error(`A versão ${versao} da DUIMP não existe ou a API recusou o acesso.`);
        return r.json();
    };

    let cab, itensRaw;
    try {
        cab = await getApi(`https://portalunico.siscomex.gov.br/duimp-sefaz/api/ext/duimp/${numero_duimp}/${versao}`);
        itensRaw = await getApi(`https://portalunico.siscomex.gov.br/duimp-sefaz/api/ext/duimp/${numero_duimp}/${versao}/itens`);
    } catch (e) {
        try {
            // console.log("Acesso Sefaz indisponível. Recorrendo à API Padrão...");
            cab = await getApi(`https://portalunico.siscomex.gov.br/duimp-api/api/ext/duimp/${numero_duimp}/${versao}`);
            itensRaw = await getApi(`https://portalunico.siscomex.gov.br/duimp-api/api/ext/duimp/${numero_duimp}/${versao}/itens`);
        } catch (fallbackError) {
            return res.status(500).send(htmlErro(`Não foi possível acessar a DUIMP.`, fallbackError.message));
        }
    }

    let itens = Array.isArray(itensRaw) ? itensRaw : (itensRaw.extratoItens || []);

    // RESGATE DE ATRIBUTOS E DESCRIÇÃO NO CATÁLOGO
    for (let i = 0; i < itens.length; i++) {
        let item = itens[i];
        const faltaAtributo = !item.atributos || item.atributos.length === 0;
        const faltaDescricao = !item.mercadoria || !item.mercadoria.descricao || item.mercadoria.descricao.trim() === "";

        if (faltaAtributo || faltaDescricao) {
            const pCod = item.produto?.codigo;
            const pVer = item.produto?.versao;
            if (pCod && pVer) {
                try {
                    const catData = await getApi(`https://portalunico.siscomex.gov.br/catp/api/ext/produto/${cliente.cnpjRaiz}/${pCod}/${pVer}`);
                    if (catData) {
                        if (faltaAtributo && catData.atributos) item.atributos = catData.atributos;
                        if (faltaDescricao && (catData.descricao || catData.denominacao)) {
                            if (!item.mercadoria) item.mercadoria = {};
                            item.mercadoria.descricao = catData.descricao || catData.denominacao;
                        }
                    }
                } catch (err) { console.log(`Catálogo indisponível para o produto ${pCod}`); }
            }
        }
    }

    try {
        const s = (val) => {
            if (val === null || val === undefined || val === 'undefined') return "";
            return String(val).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        };

        const cod = (obj) => {
            if (!obj) return `\n<codigo></codigo>\n<descricao/>\n<codigoDescricao></codigoDescricao>`;
            let codigo = typeof obj === "object" ? s(obj.codigo || obj.sigla || obj.valor || "") : s(obj);
            if(!codigo) return `\n<codigo></codigo>\n<descricao/>\n<codigoDescricao></codigoDescricao>`;
            return `\n<codigo>${codigo}</codigo>\n<descricao/>\n<codigoDescricao>${codigo} - </codigoDescricao>`;
        };

        const mapaTributos = { "II": "1", "IPI": "2", "PIS": "6", "COFINS": "7", "TAXA_UTILIZACAO": "I" };

        let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<duimp>\n`;
        
        xml += `    <extratoGeral>\n`;
        xml += `        <numeroDuimp>${s(cab.identificacao?.numero)}</numeroDuimp>\n`;
        xml += `        <versao>${s(cab.identificacao?.versao)}</versao>\n`;
        xml += `        <dataRegistro>${s(cab.identificacao?.dataRegistro)}</dataRegistro>\n`;
        xml += `        <responsavelRegistroNumero>${s(cab.identificacao?.responsavelRegistroNumero)}</responsavelRegistroNumero>\n`;
        xml += `        <chaveAcesso>${s(cab.identificacao?.chaveAcesso)}</chaveAcesso>\n`;
        xml += `        <importadorTipo>${s(cab.identificacao?.importador?.tipoImportador)}</importadorTipo>\n`;

        // =================================================================
        // AJUSTE PRECISO DA TAG CNPJ: <codigo> 8 digitos | <codigoDescricao> 14 digitos
        // =================================================================
        const cnpjFull = cliente.cnpjCompleto;
        const cnpjRoot = cliente.cnpjRaiz;
        
        xml += `        <cpfCnpj>\n            <codigo>${s(cnpjRoot)}</codigo>\n            <descricao/>\n            <codigoDescricao>${s(cnpjFull)} - </codigoDescricao>\n        </cpfCnpj>\n`;
        
        xml += `        <informacaoComplementar>${s(cab.identificacao?.informacaoComplementar)}</informacaoComplementar>\n`;
        xml += `        <situacaoDuimp>${s(cab.situacao?.situacaoDuimp)}</situacaoDuimp>\n`;
        xml += `        <situacaoLicenciamento>${s(cab.situacao?.situacaoLicenciamento)}</situacaoLicenciamento>\n`;
        xml += `        <controleCarga>${s(cab.situacao?.controleCarga)}</controleCarga>\n`;

        const urfVal = cab.urfAnaliseFiscal || cab.urfDespacho || "";
        xml += `        <urfAnaliseFiscal>${cod(urfVal)}\n        </urfAnaliseFiscal>\n`;
        
        xml += `        <cargaIdentificacao>${s(cab.carga?.identificacao)}</cargaIdentificacao>\n`;
        xml += `        <paisProcedencia>${cod(cab.carga?.paisProcedencia)}\n        </paisProcedencia>\n`;

        const moedaFrete = cab.carga?.frete?.moedaNegociada || cab.carga?.frete?.moeda || "USD";
        xml += `        <cargaMoedaFreteTotal>${cod(moedaFrete)}\n        </cargaMoedaFreteTotal>\n`;
        xml += `        <cargaValorFreteTotal>${s(cab.carga?.frete?.valorMoedaNegociada || cab.carga?.frete?.valor)}</cargaValorFreteTotal>\n`;

        const moedaSeguro = cab.carga?.seguro?.moedaNegociada || cab.carga?.seguro?.moeda || "";
        xml += `        <seguroMoedaNegociada>${cod(moedaSeguro)}\n        </seguroMoedaNegociada>\n`;
        xml += `        <seguroValorMoedaNegociada>${s(cab.carga?.seguro?.valorMoedaNegociada || cab.carga?.seguro?.valor)}</seguroValorMoedaNegociada>\n`;

        (cab.documentosInstrucao || []).forEach(doc => {
            xml += `        <documentosInstrucao>\n            <tipo>\n                <codigo>${s(doc.tipo?.codigo || doc.tipo)}</codigo>\n                <descricao/>\n                <codigoDescricao>${s(doc.tipo?.codigo || doc.tipo)} - </codigoDescricao>\n            </tipo>\n`;
            (doc.palavrasChave || []).forEach(pk => {
                xml += `            <palavrasChave>\n                <codigo>${s(pk.codigo)}</codigo>\n                <valor>${s(pk.valor)}</valor>\n            </palavrasChave>\n`;
            });
            xml += `        </documentosInstrucao>\n`;
        });

        xml += `        <totalAdicoes>${cab.adicoes ? cab.adicoes.length : 0}</totalAdicoes>\n`;
        (cab.adicoes || []).forEach(ad => {
            xml += `        <listaAdicoes>\n            <numeroAdicao>${s(ad.numero)}</numeroAdicao>\n`;
            (ad.itens || []).forEach(i => { xml += `            <numerosItens>${s(i)}</numerosItens>\n`; });
            xml += `        </listaAdicoes>\n`;
        });

        (cab.tributos?.tributosCalculados || []).forEach(t => {
            const tributoOriginal = s(t.tributo?.codigo || t.tipo?.codigo || t.tipo || "");
            const tCod = mapaTributos[tributoOriginal] || tributoOriginal;
            const tDesc = s(t.tributo?.descricao || t.tipo?.descricao || tributoOriginal);
            xml += `        <listaTributos>\n            <tributo>\n                <codigo>${tCod}</codigo>\n                <descricao>${tDesc}</descricao>\n                <codigoDescricao>${tCod} - ${tDesc}</codigoDescricao>\n            </tributo>\n`;
            xml += `            <valorCalculado>${s(t.valoresBRL?.calculado)}</valorCalculado>\n            <valorDevido>${s(t.valoresBRL?.devido)}</valorDevido>\n            <valorSuspenso/>\n            <valorAReduzir/>\n            <valorARecolher>${s(t.valoresBRL?.aRecolher)}</valorARecolher>\n            <valorRecolhido>${s(t.valoresBRL?.recolhido)}</valorRecolhido>\n            <valorComplementar/>\n        </listaTributos>\n`;
        });

        (cab.pagamentosAnteriores || cab.pagamentos || []).forEach(pg => {
            const recCod = s(pg.receita?.codigo || pg.receita);
            const tribOriginal = s(pg.tributo?.codigo || pg.tributo || "");
            const tribCod = mapaTributos[tribOriginal] || tribOriginal;
            xml += `        <pagamentosAnteriores>\n            <indicePagamento>${s(pg.indicePagamento || pg.indice)}</indicePagamento>\n            <versaoOrigem>${s(pg.versaoOrigem)}</versaoOrigem>\n`;
            xml += `            <receita>\n                <codigo>${recCod}</codigo>\n                <descricao/>\n                <codigoDescricao>${recCod} - </codigoDescricao>\n            </receita>\n`;
            xml += `            <valor>${s(pg.valor)}</valor>\n            <dataPagamento>${s(pg.dataPagamento)}</dataPagamento>\n            <banco>${s(pg.banco)}</banco>\n            <agencia>${s(pg.agencia)}</agencia>\n            <conta>${s(pg.conta)}</conta>\n`;
            xml += `            <tributo>\n                <codigo>${tribCod}</codigo>\n                <descricao/>\n                <codigoDescricao>${tribCod} - </codigoDescricao>\n            </tributo>\n`;
            xml += `            <receitaJuros/>\n            <valorJuros/>\n            <dataPagamentoJuros/>\n            <bancoJuros/>\n            <agenciaJuros/>\n            <contaJuros/>\n            <valorTotal>${s(pg.valorTotal || pg.valor)}</valorTotal>\n        </pagamentosAnteriores>\n`;
        });

        xml += `        <vmleReal>${s(cab.tributos?.mercadoria?.valorTotalLocalEmbarqueBRL)}</vmleReal>\n`;
        xml += `        <vmleDolar>${s(cab.tributos?.mercadoria?.valorTotalLocalEmbarqueUSD)}</vmleDolar>\n`;
        xml += `        <canalConsolidado>${s(cab.resultadoAnaliseRisco?.canalConsolidado)}</canalConsolidado>\n`;
        xml += `        <quantidadeItens>${itens.length}</quantidadeItens>\n    </extratoGeral>\n`;

        itens.forEach(item => {
            xml += `    <extratoItens>\n`;
            xml += `        <numeroDuimp>${s(item.identificacao?.numero)}</numeroDuimp>\n        <versaoDuimp>${s(item.identificacao?.versao)}</versaoDuimp>\n        <numeroItem>${s(item.identificacao?.numeroItem)}</numeroItem>\n        <status>${s(item.status)}</status>\n        <codigoProduto>${s(item.produto?.codigo)}</codigoProduto>\n        <versaoProduto>${s(item.produto?.versao)}</versaoProduto>\n`;
            xml += `        <produto>\n            <codigo>${s(item.produto?.codigo)}</codigo>\n            <versao>${s(item.produto?.versao)}</versao>\n            <situacao/>\n            <descricao>${s(item.mercadoria?.descricao)}</descricao>\n            <denominacao>${s(item.mercadoria?.descricao)}</denominacao>\n            <cnpjRaiz>${s(item.produto?.importadorFabricante?.cnpjRaiz || cliente.cnpjRaiz)}</cnpjRaiz>\n            <ncm>${s(item.produto?.ncm)}</ncm>\n            <dataFimVigencia/>\n            <dataInicioVigencia/>\n        </produto>\n`;
            xml += `        <ncm>\n            <codigo>${s(item.produto?.ncm)}</codigo>\n            <descricao/>\n            <codigoDescricao>${s(item.produto?.ncm)} - </codigoDescricao>\n        </ncm>\n`;
            xml += `        <fabricanteCodigo>${s(item.fabricante?.codigo)}</fabricanteCodigo>\n        <fabricanteVersao>${s(item.fabricante?.versao)}</fabricanteVersao>\n        <fabricantePais>\n            ${cod(item.fabricante?.pais)}\n        </fabricantePais>\n`;
            xml += `        <exportadorCodigo>${s(item.exportador?.codigo)}</exportadorCodigo>\n        <exportadorVersao>${s(item.exportador?.versao)}</exportadorVersao>\n        <exportadorPais>\n            ${cod(item.exportador?.pais)}\n        </exportadorPais>\n`;
            xml += `        <indicadorExportadorFabricante>\n            ${cod(item.indicadorExportadorFabricante)}\n        </indicadorExportadorFabricante>\n`;
            xml += `        <indicadorCompradorVendedor>\n            ${cod(item.indicadorCompradorVendedor)}\n        </indicadorCompradorVendedor>\n`;
            xml += `        <indicadorAdquirente>\n            ${cod(item.indicadorAdquirente || "IMPORTACAO_DIRETA")}\n        </indicadorAdquirente>\n`;
            xml += `        <tipoAplicacao>\n            ${cod(item.tipoAplicacao || "CONSUMO")}\n        </tipoAplicacao>\n`;
            xml += `        <condicao>${s(item.condicao || item.mercadoria?.condicao)}</condicao>\n`;

            const cv = item.condicaoVenda || {};
            const val = item.valoracao || {};
            const unidCom = item.mercadoria?.unidadeComercializacao || item.mercadoria?.unidadeComercial || cv.unidadeComercial || "QUILOGRAMA";
            const qtdCom = item.mercadoria?.quantidadeComercializacao || item.mercadoria?.quantidade || cv.quantidade || item.mercadoria?.pesoLiquido || "";
            const moedaNeg = val.moeda || cv.moedaNegociada || "USD";
            const vlrUnit = val.valorUnitario || ((parseFloat(cv.valorMoedaNegociada || 0) / parseFloat(qtdCom || 1))).toFixed(7);
            const vlrMoeda = val.valorTotal || cv.valorMoedaNegociada || cv.valor || "";
            const vlrBRL = val.valorTotalReais || cv.valorBRL || item.tributos?.mercadoria?.valorLocalEmbarqueBRL || "";

            xml += `        <unidadeComercial>${s(unidCom)}</unidadeComercial>\n        <quantidadeComercial>${s(qtdCom)}</quantidadeComercial>\n        <dadosMercadoriaMedidaEstatisticaQuantidade>${s(item.mercadoria?.medidaEstatistica || item.mercadoria?.pesoLiquido)}</dadosMercadoriaMedidaEstatisticaQuantidade>\n        <dadosMercadoriaPesoLiquido>${s(item.mercadoria?.pesoLiquido)}</dadosMercadoriaPesoLiquido>\n`;
            xml += `        <moedaNegociada>\n            ${cod(moedaNeg)}\n        </moedaNegociada>\n`;
            xml += `        <valorUnitarioMoedaNegociada>${s(vlrUnit)}</valorUnitarioMoedaNegociada>\n        <descricaoMercadoria>${s(item.mercadoria?.descricao)}</descricaoMercadoria>\n`;
            xml += `        <metodoValoracao>\n            ${cod(item.metodoValoracao || "1")}\n        </metodoValoracao>\n`;
            xml += `        <incoterm>\n            ${cod(cv.incoterm || item.incoterm || "FOB")}\n        </incoterm>\n`;
            xml += `        <incotermComplemento/>\n        <valorMercadoriaCondicaoVenda>${s(vlrMoeda)}</valorMercadoriaCondicaoVenda>\n        <valorMercadoriaCondicaoVendaReal>${s(vlrBRL)}</valorMercadoriaCondicaoVendaReal>\n`;
            
            const freteItem = item.carga?.frete?.valorBRL || item.frete?.valorBRL || val.frete || "";
            xml += `        <valorFrete>${s(freteItem)}</valorFrete>\n        <valorSeguro>${s(item.carga?.seguro?.valorBRL || item.seguro?.valorBRL || val.seguro || "0.00")}</valorSeguro>\n`;
            
            xml += `        <dadosCambiaisCoberturaCambial>\n            ${cod(item.dadosCambiais?.coberturaCambial || "ATE_180_DIAS")}\n        </dadosCambiaisCoberturaCambial>\n`;
            xml += `        <dadosCambiaisNumeroROF/>\n        <dadosCambiaisValor>${s(item.dadosCambiais?.valor || vlrMoeda)}</dadosCambiaisValor>\n`;

            (item.atributos || []).forEach(att => {
                xml += `        <atributos>\n            <codigo>${s(att.codigo)}</codigo>\n            <valor>${s(att.valor)}</valor>\n        </atributos>\n`;
            });

            xml += `        <vmle>${s(vlrBRL)}</vmle>\n        <vmld>${s(item.tributos?.mercadoria?.valorAduaneiroBRL || item.valorAduaneiro)}</vmld>\n`;

            (item.tributos?.tributosCalculados || []).forEach(t => {
                const tributoOriginal = s(t.tributo?.codigo || t.tipo?.codigo || t.tipo || "");
                const tCod = mapaTributos[tributoOriginal] || tributoOriginal;
                const tDesc = s(t.tributo?.descricao || t.tipo?.descricao || tributoOriginal);
                const fLeg = s(t.memoriaCalculo?.codigoFundamentoLegalNormal);

                xml += `        <tributosCalculados>\n            <tributo>\n                <codigo>${tCod}</codigo>\n                <descricao>${tDesc}</descricao>\n                <codigoDescricao>${tCod} - ${tDesc}</codigoDescricao>\n            </tributo>\n`;
                xml += `            <valorCalculado>${s(t.valoresBRL?.calculado)}</valorCalculado>\n            <valorDevido>${s(t.valoresBRL?.devido)}</valorDevido>\n            <valorSuspenso/>\n            <valorAReduzir/>\n            <valorARecolher>${s(t.valoresBRL?.aRecolher)}</valorARecolher>\n            <valorOriginalmenteDevido/>\n`;
                xml += `            <fundamentoLegalNormal>\n                <codigo>${fLeg}</codigo>\n                <descricao/>\n                <codigoDescricao>${fLeg} - </codigoDescricao>\n            </fundamentoLegalNormal>\n`;
                xml += `            <valorBaseCalculo>${s(t.memoriaCalculo?.baseCalculoBRL)}</valorBaseCalculo>\n            <valorBaseCalculoReduzida/>\n            <valorBaseCalculoEspecifica/>\n            <percReducaoBaseCalculo/>\n`;
                xml += `            <tipoAliquota>\n                <codigo>${s(t.memoriaCalculo?.tipoAliquota)}</codigo>\n                <descricao/>\n                <codigoDescricao>${s(t.memoriaCalculo?.tipoAliquota)} - </codigoDescricao>\n            </tipoAliquota>\n`;
                xml += `            <valorAliquota>${s(t.memoriaCalculo?.valorAliquota)}</valorAliquota>\n            <valorAliquotaEspecifica/>\n            <valorAliquotaReduzida/>\n            <percReducaoAliquotaReduzida/>\n            <valorNormal>${s(t.valoresBRL?.calculado)}</valorNormal>\n        </tributosCalculados>\n`;
            });

            xml += `        <dadosDrawback>\n            <numeroAtoDuimpInsumo/>\n            <itemAtoDuimpInsumo/>\n        </dadosDrawback>\n    </extratoItens>\n`;
        });

        xml += `</duimp>`;

        res.setHeader('Content-Type', 'application/xml');
        res.setHeader('Content-Disposition', `attachment; filename="${numero_duimp}.xml"`);
        res.send(xml);

//     } catch (e) {
//         console.error(e);
//         res.status(500).send(htmlErro("Erro ao estruturar o XML: " + e.message));
//     }
// });

// app.listen(3000, () => console.log('🚀 Sistema Sefaz/Catálogo operando na porta 3000 com resgate total!'));


    } catch (e) {
        console.error(e);
        res.status(500).send(htmlErro("Erro ao estruturar o XML: " + e.message));
    }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`🚀 Sistema Sefaz/Catálogo operando na porta ${PORT} com resgate total!`);
});