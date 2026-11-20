# Simulador 3D Interativo — Freio por Correntes de Foucault

Simulador eletromecânico interativo em 3D desenvolvido em **Three.js** (módulos ES sem etapa de compilação) para análise física, validação numérica e apoio ao dimensionamento do protótipo de bancada da disciplina de **Conversão Eletromecânica de Energia** (6º Semestre).

🌐 **Acesse online via GitHub Pages:** [https://giobrendo.github.io/simulador-freio-foucault/](https://giobrendo.github.io/simulador-freio-foucault/)

---

## 🎯 Objetivos do Projeto

- **Fidelidade Física e Eletromagnética:**
  - Modelo de núcleo em C de aço-silício com saturação e curva B-H não-linear (M400-50A / EN 10106).
  - Formulação de torque de frenagem com correções de borda de Schieber, efeito pelicular ($\delta$), franjamento de gap e desmagnetização.
  - Curva característica de torque vs. rotação ($T \times \omega$) pelo modelo de Wouterse com indicação em tempo real do ponto de operação.
  - Suporte a múltiplos materiais de disco: Cobre (C11000), Alumínio (1050 / 6061-T6) e Aço Galvanizado (disco ferromagnético com camada superficial de zinco).
  - Dinâmica térmica acoplada: condução, convecção natural/forçada por rotação e dissipação térmica com variação de resistividade.

- **Visualização 3D Didática e Intuitiva:**
  - Renderização 3D completa com Three.js: motor de acionamento, disco rotativo, bobinas duplas, suportes mecânicos, mancais e linhas de campo.
  - Painel de controle de parâmetros em tempo real (corrente, frequência CC/CA, espessura, entreferro, materiais e temperatura).

---

## 🚀 Como Executar

Por utilizar módulos ES nativos e CDN para Three.js, o projeto não requer nenhuma etapa de compilação (zero-build). Basta servir a pasta por um servidor HTTP estático local:

### Usando Python:
```bash
python -m http.server 8000
```
Em seguida, acesse no navegador: [http://localhost:8000](http://localhost:8000)

### Usando Node.js / npx:
```bash
npx serve .
```

---

## 🧪 Testes Unitários e Validação Numérica

A física do modelo é validada com uma suíte de testes unitários executada diretamente pelo runner nativo do Node.js:

```bash
npm test
```
ou:
```bash
node --test
```

Todos os 40 testes de física cobrem saturação B-H, tempos de desaceleração, histerese, regime CA, dissipação térmica e estabilidade dinâmica.

---

## 📁 Estrutura do Repositório

```text
├── docs/                               # Documentação técnica e planos de projeto
│   ├── Freios_Eletromagneticos.md       # Fundamentação física detalhada e bibliografia
│   ├── plano-implementacao.md          # Especificação e etapas de implementação
│   └── projeto-simulador-unificado.md  # Especificações técnicas e unificação
├── js/                                 # Lógica da simulação e renderização
│   ├── config.js                       # Parâmetros e constantes padrão
│   ├── features.js                     # Recursos complementares e interface
│   ├── main.js                         # Loop principal da simulação
│   ├── materials.js                    # Propriedades elétricas/térmicas dos materiais
│   ├── physics.js                      # Modelagem matemática e física eletromecânica
│   └── scene.js                        # Construção e shaders da cena 3D (Three.js)
├── tests/
│   └── physics.test.mjs                # Suíte de testes automatizados do modelo físico
├── index.html                          # Aplicação web e interface gráfica
└── package.json                        # Configuração do projeto e scripts de teste
```

---

## 👥 Autores & Disciplina

- **Desenvolvido por:** Giovanni Brendo
- **Disciplina:** Conversão Eletromecânica de Energia
- **Contexto:** 6º Semestre de Engenharia
