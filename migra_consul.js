const http = require('http');
const https = require('https');
const fs = require('fs');
const readline = require('readline');

// ==============================================================================
// CONFIGURAÇÃO DOS AMBIENTES
// ==============================================================================
const SERVIDORES = [
    { nome: "Local", url: "http://localhost:8500/v1/kv" },
    { nome: "Desenvolvimento", url: "http://10.160.4.73:30085/v1/kv" },
    { nome: "Homologacao", url: "http://10.160.0.8:30085/v1/kv" },
    { nome: "Producao", url: "http://10.0.0.10:8500/v1/kv" }
];

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

function request(url, options, data = null) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        const req = client.request(url, options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => resolve({ statusCode: res.statusCode, body }));
        });
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
    });
}

function listarAmbientes() {
    SERVIDORES.forEach((sv, index) => {
        console.log(`  [${index + 1}] ${sv.nome} (${sv.url})`);
    });
}

// Função auxiliar para garantir que os caminhos fiquem limpos e padronizados
function tratarCaminho(caminho) {
    if (!caminho) return '';
    let resultado = caminho.trim();
    if (resultado.startsWith('/')) resultado = resultado.substring(1);
    return resultado;
}

// ==============================================================================
// FLUXO PRINCIPAL
// ==============================================================================
async function main() {
    console.log("====================================================");
    console.log("   SISTEMA DE MIGRAÇÃO AVANÇADA DE KV CONSUL (JS)   ");
    console.log("====================================================\n");

    // 1. SELEÇÃO DA ORIGEM
    console.log(">>> Selecione o ambiente de ORIGEM:");
    listarAmbientes();
    const opcaoOrigem = await question("Digite o número da opção desejada: ");
    const idxOrigem = parseInt(opcaoOrigem) - 1;

    if (isNaN(idxOrigem) || idxOrigem < 0 || idxOrigem >= SERVIDORES.length) {
        console.log("❌ Opção de origem inválida. Saindo...");
        rl.close();
        return;
    }
    const origem = SERVIDORES[idxOrigem];

    // 2. SELEÇÃO DO DESTINO
    console.log(`\n🟢 Origem: ${origem.nome}\n`);
    console.log(">>> Selecione o DESTINO (Servidor ou Arquivo Local):");
    listarAmbientes();
    console.log("  [L] Arquivo Local (Exportar tudo para um único arquivo .json)");
    const opcaoDestino = await question("Digite o número ou 'L': ");

    // 3. SELEÇÃO DOS CAMINHOS (ORIGEM E DESTINO)
    console.log("\n>>> Defina o escopo da cópia:");
    let caminhoOrigem = await question('Informe o caminho de ORIGEM no Consul: ');
    caminhoOrigem = tratarCaminho(caminhoOrigem);

    if (!caminhoOrigem) {
        console.log("❌ O caminho de origem não pode ser vazio. Saindo...");
        rl.close();
        return;
    }

    const ehDiretorio = caminhoOrigem.endsWith('/');
    
    // Pergunta o novo caminho de destino
    let caminhoDestino = await question('Informe o caminho de DESTINO (Pressione ENTER para manter o mesmo da origem): ');
    caminhoDestino = tratarCaminho(caminhoDestino);

    // Se o usuário deu ENTER (vazio), assume a mesma chave da origem
    if (!caminhoDestino) {
        caminhoDestino = caminhoOrigem;
        console.log(`ℹ️ Usando o mesmo caminho de origem para o destino: "${caminhoDestino}"`);
    } else {
        // Regra de segurança: Se a origem for diretório, o destino também precisa terminar com "/"
        if (ehDiretorio && !caminhoDestino.endsWith('/')) {
            caminhoDestino += '/';
        }
    }

    // 4. BUSCA DOS DADOS NA ORIGEM
    console.log("\n🔄 Buscando dados da origem...");
    try {
        const urlBusca = `${origem.url}/${caminhoOrigem}${ehDiretorio ? '?recurse' : ''}`;
        const respostaOrigem = await request(urlBusca, { method: 'GET' });

        if (respostaOrigem.statusCode !== 200) {
            console.log(`❌ Erro: Caminho não encontrado na origem. Status HTTP: ${respostaOrigem.statusCode}`);
            rl.close();
            return;
        }

        const listaItens = JSON.parse(respostaOrigem.body);

        if (!Array.isArray(listaItens) || listaItens.length === 0) {
            console.log("❌ Erro: Nenhum dado retornado para o caminho informado.");
            rl.close();
            return;
        }

        const itensProcessados = [];
        for (const item of listaItens) {
            if (!item.Value) continue; // Ignora diretórios vazios mapeados pelo Consul

            try {
                const payloadString = Buffer.from(item.Value, 'base64').toString('utf-8');
                let payloadFormatado;
                try {
                    payloadFormatado = JSON.stringify(JSON.parse(payloadString), null, 2);
                } catch {
                    payloadFormatado = payloadString;
                }

                // LÓGICA DE RECOMPOSIÇÃO DO CAMINHO (Mapeamento Dinâmico)
                let chaveFinal;
                if (caminhoOrigem === caminhoDestino) {
                    chaveFinal = item.Key;
                } else if (!ehDiretorio) {
                    // Se for chave única, substitui o caminho inteiro pelo novo destino informado
                    chaveFinal = caminhoDestino;
                } else {
                    // Se for diretório, substitui apenas o prefixo da origem pelo prefixo do destino
                    const subCaminho = item.Key.substring(caminhoOrigem.length);
                    chaveFinal = caminhoDestino + subCaminho;
                }

                itensProcessados.push({
                    chaveOriginal: item.Key,
                    chaveDestino: chaveFinal,
                    conteudo: payloadFormatado
                });
            } catch (e) {
                console.log(`⚠️ Falha ao processar a chave: ${item.Key}. Ignorando...`);
            }
        }

        console.log(`📦 Encontrada(s) ${itensProcessados.length} chave(s) prontas para migração.`);

        // 5. ENVIO PARA O DESTINO (LOCAL OU REMOTO)
        if (opcaoDestino.toUpperCase() === 'L') {
            // Exportação Local
            const dataFormatada = new Date().toISOString().replace(/[:.]/g, '-');
            const nomeArquivo = `backup_consul_remapeado_${dataFormatada}.json`;

            fs.writeFileSync(nomeArquivo, JSON.stringify(itensProcessados, null, 2));
            console.log(`💾 Sucesso! Dados exportados localmente com mapeamento de destino em: ${nomeArquivo}`);
        } else {
            // Exportação Remota
            const idxDestino = parseInt(opcaoDestino) - 1;
            if (isNaN(idxDestino) || idxDestino < 0 || idxDestino >= SERVIDORES.length) {
                console.log("❌ Opção de destino inválida. Saindo...");
                rl.close();
                return;
            }
            const destino = SERVIDORES[idxDestino];
            console.log(`🚀 Iniciando transferência para o destino: ${destino.nome}...\n`);

            let sucessos = 0;
            let falhas = 0;

            for (const item of itensProcessados) {
                const urlEnvio = `${destino.url}/${item.chaveDestino}`;
                
                const contentType = item.conteudo.trim().startsWith('{') || item.conteudo.trim().startsWith('[') 
                    ? 'application/json' 
                    : 'text/plain';

                const respostaDestino = await request(urlEnvio, {
                    method: 'PUT',
                    headers: { 'Content-Type': contentType }
                }, item.conteudo);

                if (respostaDestino.statusCode === 200) {
                    console.log(`  ✅ [OK] ${item.chaveOriginal} ➡️  ${item.chaveDestino}`);
                    sucessos++;
                } else {
                    console.log(`  ❌ [ERRO] Falha ao gravar ${item.chaveDestino} (Status: ${respostaDestino.statusCode})`);
                    falhas++;
                }
            }

            console.log(`\n🏁 Processo concluído em '${destino.nome}':`);
            console.log(`   Sucessos: ${sucessos}`);
            console.log(`   Falhas: ${falhas}`);
        }

    } catch (error) {
        console.error("❌ Ocorreu um erro crítico durante a operação:", error.message || error);
    } finally {
        rl.close();
    }
}

main();