const http = require('http');
const https = require('https');
const fs = require('fs');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

function listJsonFiles() {
    try {
        const files = fs.readdirSync('.');
        const filteredFiles = files.filter(x => x.includes('.json'));
        const options = [];
        for (let index = 0; index < filteredFiles.length; index++) {
            const element = filteredFiles[index];
            console.log(`[${index}]: ${element}`);
            options.push(element);
        }
        return options;
    } catch (err) {
        console.error('Error:', err);
        throw 'Failed reading JSON files'
    }
}

function readFile(name) {
    try {
        const file = fs.readFileSync(name);
        return file;
    }
    catch {
        return null;
    }
}

function parseFileToObject(bufferData) {
    const jsonString = bufferData.toString('utf8');
    const jsObject = JSON.parse(jsonString);
    return jsObject;
}

function findTools(obj) {
    const dataObj = obj.drawflow.Home.data;
    const entries = Object.entries(dataObj);
    const tools = entries
        .filter(([key, value]) => value.class === 'ToolBlock')
        .map((([key, value]) => value));
    return tools;
}

function replaceToolsAtObject(obj, newTools, projectName) {
    const dataObj = obj.drawflow.Home.data;
    const entries = Object.entries(dataObj);
    entries
        .filter(([key, value]) => value.class === 'ToolBlock')
        .forEach((([key, value]) => {
            const newTool = newTools.find(x => x.name === value.name);
            if (!newTool) return;
            replaceParametersAtTool(newTool, value, projectName)
        }));
    return Object.fromEntries(entries);
}

function replaceParametersAtTool(originTool, destinationTool, projectName) {
    const inputs = [];

    destinationTool.data.parameters.inputs.forEach(x => {
        if (x.name === 'project') {
            inputs.push({ ...x, value: projectName });
        }
        else {
            inputs.push(x)
        }
    });

    destinationTool.data.parameters.inputs = [...inputs];
    destinationTool.data.parameters.outputs = [...destinationTool.data.parameters.outputs];
    console.log(`* ${originTool.name} mergeada ✅`);
}

// ==============================================================================
// FLUXO PRINCIPAL
// ==============================================================================
async function main() {
    console.log("====================================================");
    console.log("   SISTEMA DE MIGRAÇÃO AVANÇADA DE TOOLS (JS)   ");
    console.log("====================================================\n");

    // 1. SELEÇÃO DA ORIGEM
    console.log(">>> Selecione o arquivo de ORIGEM:\n");
    const files = listJsonFiles();
    if (!files.length) {
        console.log("❌ Sem opções disponíveis. Saindo...");
        rl.close();
        return;
    }

    const optionOrigin = await question("\nDigite a opção desejada: ");
    const idxOrigin = parseInt(optionOrigin);
    if (isNaN(idxOrigin) || idxOrigin < 0 || idxOrigin >= files.length) {
        console.log("❌ Opção de origem inválida. Saindo...");
        rl.close();
        return;
    }

    const origin = readFile(files[optionOrigin]);
    if (!origin) {
        console.log("❌ Opção de origin inválida. Saindo...");
        rl.close();
        return;
    }

    // 2. SELEÇÃO DO DESTINO
    console.log(`\n🟢 Origin: ${optionOrigin}\n`);
    console.log(">>> Selecione o DESTINO:\n");
    listJsonFiles();

    const optionDestination = await question("\nDigite a opção desejada: ");
    const idxDestination = parseInt(optionDestination);
    if (isNaN(idxDestination) || idxDestination < 0 || idxDestination >= files.length) {
        console.log("❌ Opção de origem inválida. Saindo...");
        rl.close();
        return;
    }

    const destination = readFile(files[idxDestination]);
    if (!destination) {
        console.log("❌ O caminho de origin não pode ser vazio. Saindo...");
        rl.close();
        return;
    }


    // 4. BUSCA DOS DADOS NA ORIGEM
    const projectName = await question("\nInforme o nome do projeto: \n");
    console.log("\n🔄 Buscando dados da origin...");
    try {
        const objOrigin = parseFileToObject(origin);
        const toolsOrigin = findTools(objOrigin);

        const objDestination = parseFileToObject(origin);
        const newHomeData = replaceToolsAtObject(objDestination, toolsOrigin, projectName);

        objDestination.drawflow.Home.data = { ...newHomeData };
        const jsonString = JSON.stringify(objDestination, null, 2);

        fs.writeFileSync(`${projectName}-${new Date().toISOString().replaceAll(':', '-')}.json`, jsonString, 'utf8');
        console.log('✨ File saved successfully!');
    } catch (error) {
        console.error("❌ Ocorreu um erro crítico durante a operação:", error.message || error);
    } finally {
        await question('Pressione qualquer tecla para finalizar. \n');
        rl.close();
    }
}

main();