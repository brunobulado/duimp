# DUIMP XML Generator

## 📋 Sobre o Projeto

O DUIMP XML Generator é uma aplicação web desenvolvida em Node.js e JavaScript que realiza a integração com as APIs do Portal Único Siscomex para consulta de Declarações Únicas de Importação (DUIMP) e geração automática de arquivos XML destinados à importação em sistemas ERP.

A solução foi criada para simplificar o processo de obtenção de informações da DUIMP, eliminando atividades manuais de consulta e digitação, reduzindo erros operacionais e acelerando a integração entre o Siscomex e sistemas corporativos.

---

## 🚀 Principais Funcionalidades

### Gestão de Usuários

* Autenticação de usuários.
* Controle de acesso por perfil.
* Perfil Administrador com permissões completas.
* Criação e exclusão de usuários.
* Alteração e redefinição de senhas.

### Gestão de Empresas

* Cadastro de múltiplas empresas importadoras.
* Armazenamento do CNPJ da empresa.
* Configuração de credenciais de acesso à API do Siscomex:

  * Client ID
  * Client Secret
  * Role Type

### Integração com o Portal Único Siscomex

* Autenticação automática nas APIs oficiais.
* Consulta das versões disponíveis da DUIMP.
* Recuperação dos dados completos da declaração.
* Consulta complementar ao Catálogo de Produtos.
* Recuperação automática de atributos e descrições de mercadorias quando disponíveis.

### Geração de XML

* Geração automática do XML da DUIMP.
* Estruturação completa dos dados da declaração.
* Inclusão de:

  * Dados gerais da DUIMP
  * Dados da carga
  * Tributos
  * Pagamentos
  * Adições
  * Itens da declaração
  * Atributos dos produtos
  * Informações de valoração
  * Informações cambiais
* Download imediato do arquivo XML.

---

## 🔄 Fluxo de Utilização

1. O administrador cadastra uma empresa importadora.
2. Informa:

   * Razão Social
   * CNPJ
   * Client ID
   * Client Secret
   * Role Type
3. O administrador cria usuários ou utiliza sua própria conta.
4. O usuário acessa a tela de geração.
5. Seleciona a empresa desejada.
6. Informa o número da DUIMP.
7. Seleciona a versão da DUIMP.
8. O sistema consulta automaticamente as APIs do Siscomex.
9. O XML é gerado e disponibilizado para download.
10. O arquivo pode ser utilizado para importação em sistemas ERP.

---

## 🛠 Tecnologias Utilizadas

### Backend

* Node.js
* Express.js
* Express Session
* Node Fetch

### Frontend

* HTML5
* CSS3
* JavaScript

### Armazenamento

* Arquivos JSON

### Integrações Externas

* API Portal Único Siscomex
* API DUIMP
* API DUIMP SEFAZ
* API Catálogo de Produtos (CATP)

---

## 🎯 Objetivo

Automatizar o consumo das APIs do Portal Único Siscomex para transformar informações da DUIMP em arquivos XML estruturados, permitindo sua integração com sistemas ERP e reduzindo significativamente o trabalho operacional das equipes de comércio exterior.

---

## 👨‍💻 Autor

Bruno da Silva Bulado

Analista e Desenvolvedor de Software

Projeto desenvolvido para automação de processos de comércio exterior e integração com o Portal Único Siscomex.

