const fetch = require('node-fetch');

async function probarOllamaConContexto() {
    const modelo = "qwen2.5:3b";//"llama3.2:1b"; //
    const url = "http://localhost:11434/api/generate";
    
    // 1. EL CEREBRO DE TU EMPRESA (Lógica If/Then para modelos 1B)
    const contextoEmpresa = `Eres un asesor de ventas profesional de la plataforma CRM Whatsvaa. 
        Tu respuesta debe tener MÁXIMO 30 PALABRAS. Ve directo al grano. No uses saludos excesivamente informales.

        REGLAS DE RECOMENDACIÓN (OBLIGATORIAS):
        - Si el usuario menciona tener entre 1 y 99 clientes -> Recomienda EXCLUSIVAMENTE el "Plan Basic" ($19).
        - Si el usuario menciona tener entre 100 y 30,000 clientes -> Recomienda EXCLUSIVAMENTE el "Plan Full" ($20).

        Lee la cantidad de clientes del usuario y ofrece el plan correcto según las reglas. Menciona el precio.`;

    // 2. EL MENSAJE REAL DEL CLIENTE
    const mensajeCliente = "Hola, tengo una base de datos grande de 20,000 clientes. ¿Qué plan me recomiendas y cuánto cuesta?";

    console.log(`[+] Generando respuesta...`);
    console.time("⏱️ Tiempo");

    try {
        const respuesta = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: modelo,
                system: contextoEmpresa, // Inyectamos el catálogo aquí
                prompt: mensajeCliente,  // La pregunta del cliente aquí
                stream: false
            })
        });

        const data = await respuesta.json();
        console.timeEnd("⏱️ Tiempo");
        
        console.log("\n🤖 Respuesta de la IA:");
        console.log("-----------------------------------------");
        console.log(data.response);
        console.log("-----------------------------------------");

    } catch (error) {
        console.error("Error:", error.message);
    }
}

probarOllamaConContexto();