import {component, escapeHtml, safeId} from './component.js';
import {initDatabase, rows, one, run, transaction, persistDatabase} from './db.js';
import {syncOfficialCatalog} from './catalog.js';
import {extractPdfText} from './pdf.js';
import {askLocalAI, disposeLocalAI, loadLocalAI, UnsafeModelOutputError} from './ai.js';
import {downloadModel, hasModel} from './model-store.js';
import {isStandalone, registerServiceWorker} from './pwa.js';

const PAGES = ['editais','empresa','documentos','matriz','prompts','inteligencia'];

function money(value) {
  const raw = String(value ?? '').replace(/[^0-9,.-]/g, '').replaceAll('.', '').replace(',', '.');
  const number = Number(raw);
  return Number.isFinite(number) ? number.toLocaleString('pt-BR',{style:'currency',currency:'BRL'}) : value || 'Não informado';
}

function parseJsonLoose(text) {
  const cleaned = String(text ?? '').replace(/^```(?:json)?/i,'').replace(/```$/,'').trim();
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first < 0 || last <= first) return null;
  try { return JSON.parse(cleaned.slice(first,last+1)); } catch { return null; }
}

function sidebarButton(id, page, label, icon, active) {
  return `<button class="nav-item ${active === page ? 'active' : ''}" onclick="document.getElementById('${id}').component.setPage('${page}')"><span>${icon}</span>${label}</button>`;
}

function renderEditais(state, id) {
  const cards = state.editais.length ? state.editais.map(item => `
    <button class="bid-card ${Number(state.selectedEditalId) === Number(item.id) ? 'selected' : ''}" onclick="document.getElementById('${id}').component.selectEdital(${item.id})">
      <span class="bid-number">${escapeHtml(item.numero || 'Sem número')}</span>
      <strong>${escapeHtml(item.orgao || item.unidade || 'Órgão não informado')}</strong>
      <small>${escapeHtml(item.objeto || 'Objeto não informado')}</small>
      <span class="badge">${escapeHtml(item.situacao || 'importado')}</span>
    </button>`).join('') : `<div class="empty"><strong>Nenhum edital disponível.</strong><p>A atualização será verificada automaticamente.</p></div>`;
  const current = state.currentEdital;
  const requirements = state.requisitos.length ? state.requisitos.map(req => `
    <article class="requirement-card">
      <header><span>${escapeHtml(req.categoria || 'Requisito')}</span>${Number(req.obrigatorio) ? '<b>Obrigatório</b>' : ''}</header>
      <h4>${escapeHtml(req.titulo || 'Exigência identificada')}</h4>
      <p>${escapeHtml(req.descricao || '')}</p>
      ${req.risco ? `<div class="risk"><strong>Risco:</strong> ${escapeHtml(req.risco)}</div>` : ''}
      ${req.acao_licitante ? `<div class="action"><strong>Ação recomendada:</strong> ${escapeHtml(req.acao_licitante)}</div>` : ''}
    </article>`).join('') : '<p class="muted">A análise local ainda não materializou requisitos para este edital.</p>';
  return `
    <section class="page-grid bids-layout">
      <aside class="catalog-panel panel">
        <div class="section-head"><div><h2>Editais</h2></div></div>
        <input class="search" id="edital-search" placeholder="Número, órgão ou objeto" oninput="document.getElementById('${id}').component.filterEditais(this.value)">
        <div class="bid-list">${cards}</div>
      </aside>
      <main class="detail-panel panel">
        ${current ? `
          <div class="section-head"><div><h2>${escapeHtml(current.numero || 'Edital selecionado')}</h2></div><span class="status-dot">${escapeHtml(current.situacao || 'importado')}</span></div>
          <h3>${escapeHtml(current.orgao || current.unidade || '')}</h3>
          <p class="lead">${escapeHtml(current.objeto || '')}</p>
          <div class="metrics"><div><span>Valor estimado</span><strong>${escapeHtml(money(current.valor_estimado))}</strong></div><div><span>Sessão</span><strong>${escapeHtml(current.data_sessao || 'Não informada')}</strong></div><div><span>Localidade</span><strong>${escapeHtml(current.localidade || 'Não informada')}</strong></div></div>
          <div class="actions"><button class="primary" ${state.aiReady ? '' : 'disabled'} onclick="document.getElementById('${id}').component.analyzeSelectedEdital()">Analisar com inteligência local</button><button class="secondary" onclick="document.getElementById('${id}').component.setPage('matriz')">Abrir matriz documental</button></div>
          <section class="requirements"><h3>Requisitos identificados</h3>${requirements}</section>
        ` : '<div class="empty"><strong>Selecione um edital</strong><p>Os detalhes aparecerão aqui.</p></div>'}
      </main>
    </section>`;
}

function renderEmpresa(state, id) {
  const e = state.empresa || {};
  return `<section class="panel form-page"><h2>Dados da empresa</h2><p class="lead">Informações utilizadas nas análises de aderência.</p>
    <div class="form-grid">
      <label><span>Razão social</span><input id="empresa-razao" value="${escapeHtml(e.razao_social || '')}"></label>
      <label><span>CNPJ</span><input id="empresa-cnpj" value="${escapeHtml(e.cnpj || '')}"></label>
      <label><span>Porte</span><select id="empresa-porte"><option>${escapeHtml(e.porte || 'LTDA')}</option><option>ME</option><option>EPP</option><option>LTDA</option><option>S.A.</option></select></label>
      <label><span>Município</span><input id="empresa-municipio" value="${escapeHtml(e.municipio || '')}"></label>
      <label><span>Estado</span><input id="empresa-estado" value="${escapeHtml(e.estado || 'BA')}"></label>
      <label><span>Cidade-base</span><input id="empresa-cidade" value="${escapeHtml(e.cidade_base || '')}"></label>
      <label class="wide"><span>Objeto social e especialidades</span><textarea id="empresa-objeto">${escapeHtml(e.objeto_social || '')}</textarea></label>
      <label><span>CNAE principal</span><input id="empresa-cnae" value="${escapeHtml(e.cnae_principal || '')}"></label>
      <label><span>Responsável pelo cadastro</span><input id="empresa-responsavel" value="${escapeHtml(e.responsavel_cadastro || '')}"></label>
    </div><button class="primary" onclick="document.getElementById('${id}').component.saveEmpresa()">Salvar dados</button></section>`;
}

function renderDocumentos(state, id) {
  const docs = state.documentos.length ? state.documentos.map(doc => `
    <article class="document-card"><div class="doc-icon">PDF</div><div><strong>${escapeHtml(doc.nome)}</strong><span>${escapeHtml(doc.tipo || 'Documento')} · ${escapeHtml(doc.status || 'armazenado')}</span><small>Pronto para análise</small></div><button class="ghost" onclick="document.getElementById('${id}').component.confirmDocumento(${doc.id})">Confirmar</button></article>`).join('') : '<div class="empty"><strong>Nenhum documento adicionado.</strong><p>Adicione documentos para relacionar aos requisitos.</p></div>';
  return `<section class="panel"><div class="section-head"><div><h2>Documentos</h2></div><button class="primary" onclick="document.getElementById('${id}').component.openDocument()">Adicionar documento</button></div><p class="lead">Adicione documentos para comprovar requisitos.</p><div class="document-list">${docs}</div></section>`;
}

function renderMatriz(state, id) {
  const options = state.documentos.map(doc => `<option value="${doc.id}">${escapeHtml(doc.nome)}</option>`).join('');
  const rowsHtml = state.matriz.length ? state.matriz.map(item => `
    <tr><td><strong>${escapeHtml(item.titulo || '')}</strong><small>${escapeHtml(item.categoria || '')}</small></td><td>${escapeHtml(item.documento_nome || 'Não relacionado')}</td><td><span class="badge">${escapeHtml(item.situacao || 'pendente')}</span></td><td><select onchange="document.getElementById('${id}').component.linkDocument(${item.id},this.value)"><option value="">Relacionar documento</option>${options}</select></td></tr>`).join('') : '<tr><td colspan="4" class="muted">Analise um edital para criar requisitos e iniciar a correlação.</td></tr>';
  return `<section class="panel"><h2>Matriz documental</h2><p class="lead">Relacione exigências e documentos.</p><div class="table-wrap"><table><thead><tr><th>Requisito</th><th>Documento</th><th>Situação</th><th>Ação</th></tr></thead><tbody>${rowsHtml}</tbody></table></div></section>`;
}

function renderPrompts(state, id) {
  return `<section class="panel"><h2>Critérios de análise</h2><p class="lead">Defina como os editais devem ser analisados.</p><div class="prompt-list">${state.prompts.map(p => `<article class="prompt-card"><h3>${escapeHtml(p.nome)}</h3><p>${escapeHtml(p.descricao || '')}</p><textarea id="prompt-${p.id}">${escapeHtml(p.instrucao || '')}</textarea><button class="secondary" onclick="document.getElementById('${id}').component.savePrompt(${p.id})">Salvar instrução</button></article>`).join('')}</div></section>`;
}

function renderInteligencia(state, id) {
  const stateLabel = state.aiReady
    ? 'Pronta'
    : state.aiLoading
      ? 'Preparando'
      : state.modelStored
        ? 'Disponível'
        : 'Aguardando preparação';

  return `<section class="panel intelligence-page">
    <h2>Inteligência Maximus</h2>
    <p class="lead">Ative os recursos de análise de editais neste dispositivo.</p>
    <div class="model-card">
      <div><span>Status</span><strong>${stateLabel}</strong></div>
      <div class="model-state ${state.aiReady ? 'ready' : ''}">${state.aiReady ? 'Ativa' : 'Inativa'}</div>
    </div>
    ${state.modelDownloading ? `<div class="progress"><div style="width:${state.modelProgress}%"></div></div><p>${state.modelProgress}%</p>` : ''}
    <div class="actions">
      <button class="primary" ${state.aiLoading ? 'disabled' : ''} onclick="document.getElementById('${id}').component.prepareAI()">${state.aiReady ? 'Análise ativa' : 'Ativar análise'}</button>
    </div>
    <div class="install-box">
      <h3>Instalar aplicativo</h3>
      <p>Instale para abrir a Maximus Licitações diretamente no computador.</p>
      <button class="secondary" onclick="document.getElementById('${id}').component.install()">${state.installed ? 'Aplicativo instalado' : 'Instalar'}</button>
    </div>
  </section>`;
}

function* App({id}) {
  this.id = safeId(id,'maximus-licitacoes-app');
  this.element = null;
  this.config = null;
  this.installPrompt = null;
  this.catalogAll = [];
  this.state = {phase:'boot', page:'editais', status:'Preparando a aplicação…', error:'', busy:false, catalogLoading:false, catalogStatus:'Preparando editais', editais:[], currentEdital:null, selectedEditalId:0, empresa:null, documentos:[], requisitos:[], matriz:[], prompts:[], modelStored:false, aiReady:false, aiLoading:false, modelDownloading:false, modelProgress:0, modelStatus:'Preparando análise', installed:isStandalone()};
  this.patch = patch => this.next(patch);

  this.refresh = async () => {
    const editais = rows('SELECT * FROM licitacao ORDER BY data_sessao DESC, id DESC LIMIT 500');
    this.catalogAll = editais;
    let selected = Number(this.state.selectedEditalId || editais[0]?.id || 0);
    const currentEdital = selected ? one('SELECT * FROM licitacao WHERE id=?',[selected]) : null;
    const requisitos = selected ? rows(`SELECT r.* FROM requisito r JOIN edital_topico t ON t.id=r.topico_id JOIN edital_fase f ON f.id=t.fase_id JOIN edital_documento e ON e.id=f.edital_documento_id WHERE e.licitacao_id=? ORDER BY r.id`,[selected]) : [];
    const matriz = selected ? rows(`SELECT r.id,r.titulo,r.categoria,c.situacao,d.nome AS documento_nome FROM requisito r JOIN edital_topico t ON t.id=r.topico_id JOIN edital_fase f ON f.id=t.fase_id JOIN edital_documento e ON e.id=f.edital_documento_id LEFT JOIN correlacao_documental c ON c.requisito_id=r.id LEFT JOIN documento d ON d.id=c.documento_id WHERE e.licitacao_id=? ORDER BY r.id`,[selected]) : [];
    this.patch({editais,currentEdital,selectedEditalId:selected,empresa:one('SELECT * FROM empresa LIMIT 1'),documentos:rows('SELECT * FROM documento ORDER BY id DESC'),requisitos,matriz,prompts:rows('SELECT * FROM prompt_operational ORDER BY id'),modelStored:await hasModel()});
  };

  this.bootstrap = async () => {
    try {
      await registerServiceWorker();
      this.config = await fetch('./app-config.json',{cache:'no-store'}).then(response => {
        if (!response.ok) throw new Error(`Configuração indisponível: HTTP ${response.status}.`);
        return response.json();
      });
      await initDatabase();
      await this.refresh();
      this.patch({phase:'boot',status:'Preparando editais e análise…'});
      await this.initializeOnStart();
      await this.refresh();
      this.patch({phase:'ready',status:'Aplicação pronta.'});
    } catch (error) { this.patch({phase:'error',error:error.message,status:'Não foi possível iniciar a plataforma.'}); }
  };

  this.initializeOnStart = async () => {
    if (this.config.catalog?.autoLoadOnInit !== false) {
      await this.syncOfficial({automatic:true});
    }
    if (this.config.model?.autoPrepareOnInit !== false) {
      await this.prepareAI({automatic:true});
    }
  };

  this.setPage = page => { if (PAGES.includes(page)) this.patch({page,error:''}); };
  this.selectEdital = async editalId => { this.state.selectedEditalId=Number(editalId); await this.refresh(); };
  this.filterEditais = query => { const q=String(query||'').toLowerCase(); this.patch({editais:this.catalogAll.filter(e => `${e.numero} ${e.orgao} ${e.objeto}`.toLowerCase().includes(q))}); };
  this.syncOfficial = async ({automatic=false} = {}) => {
    if (this.state.catalogLoading) return true;
    this.patch({catalogLoading:true,error:'',catalogStatus:'Verificando editais…',status:'Verificando editais…'});
    try {
      const result = await syncOfficialCatalog(
        status => this.patch({catalogStatus:status,status}),
      );
      await persistDatabase();
      await this.refresh();
      const status = result.changed
        ? `${result.count} editais atualizados.`
        : `${result.count} editais disponíveis.`;
      this.patch({catalogLoading:false,catalogStatus:status,status});
      return true;
    } catch (error) {
      this.patch({catalogLoading:false,catalogStatus:'Editais indisponíveis',error:'Não foi possível atualizar os editais.',status:'Não foi possível atualizar os editais.'});
      return false;
    }
  };
  this.saveEmpresa = async () => { const values=['razao','cnpj','porte','municipio','estado','cidade','objeto','cnae','responsavel'].map(k => document.querySelector(`#empresa-${k}`)?.value||''); run(`UPDATE empresa SET razao_social=?,cnpj=?,porte=?,municipio=?,estado=?,cidade_base=?,objeto_social=?,cnae_principal=?,responsavel_cadastro=? WHERE id=(SELECT id FROM empresa LIMIT 1)`,values); await this.refresh(); this.patch({status:'Dados da empresa salvos.'}); };
  this.openDocument = () => document.querySelector('#document-file')?.click();
  this.uploadDocument = async () => { const input=document.querySelector('#document-file'); const file=input?.files?.[0]; if(!file)return; this.patch({busy:true,error:'',status:`Lendo ${file.name} no dispositivo…`}); try{let text=''; if(file.type==='application/pdf'||file.name.toLowerCase().endsWith('.pdf')){const extracted=await extractPdfText(file, ({page,total}) => this.patch({status:`Lendo página ${page} de ${total}…`})); text=extracted.text;}else{text=await file.text();} run(`INSERT INTO documento (empresa_id,tipo,nome,status,texto_extraido,inferencia_status,criado_em) VALUES ((SELECT id FROM empresa LIMIT 1),?,?,?,?,?,datetime('now'))`,['Documento técnico',file.name,'leitura concluída',text,'pendente']); await this.refresh(); this.patch({busy:false,status:`${file.name} adicionado aos documentos.`});}catch(error){this.patch({busy:false,error:error.message,status:'O documento não pôde ser processado.'});}finally{if(input)input.value='';} };
  this.confirmDocumento = async id => { run(`UPDATE documento SET status='confirmado pelo usuário',confirmado_em=datetime('now'),confirmado_por=(SELECT responsavel_cadastro FROM empresa LIMIT 1) WHERE id=?`,[id]); await this.refresh(); this.patch({status:'Documento confirmado.'}); };
  this.prepareAI = async ({automatic=false} = {}) => {
    if (this.state.aiLoading || this.state.aiReady) return true;
    this.patch({aiLoading:true,error:'',modelStatus:'Preparando a análise…'});
    try {
      if (!(await hasModel())) {
        this.patch({modelDownloading:true,modelStatus:'Preparando a análise…',status:'Preparando a análise…'});
        await downloadModel({
          onProgress:({ratio}) => {
            const progress = Math.round(ratio*100);
            this.patch({modelProgress:progress,modelStatus:`Transferindo inteligência local: ${progress}%`});
          },
        });
      }
      this.patch({modelStatus:'Finalizando a preparação…',status:'Finalizando a preparação…'});
      await loadLocalAI({maxNumTokens:this.config.model.maxNumTokens});
      this.patch({aiLoading:false,modelDownloading:false,modelStored:true,aiReady:true,modelStatus:'Inteligência validada e ativa',status:'Inteligência ativa para análise de licitações.'});
      return true;
    } catch (error) {
      if (error?.code === 'UNSAFE_MODEL_OUTPUT' || error instanceof UnsafeModelOutputError) {
        await disposeLocalAI();
        this.patch({aiLoading:false,modelDownloading:false,modelStored:true,aiReady:false,modelStatus:'Análise indisponível',error:'Não foi possível iniciar a análise. Tente novamente.',status:'A análise não foi iniciada.'});
      } else {
        this.patch({aiLoading:false,modelDownloading:false,aiReady:false,modelStatus:'Inteligência indisponível',error:error.message,status:'Não foi possível iniciar a análise.'});
      }
      return false;
    }
  };
  this.analyzeSelectedEdital = async () => { const edital=this.state.currentEdital; if(!edital||!this.state.aiReady)return; this.patch({busy:true,error:'',status:'Analisando exigências e riscos do edital…'}); try{const instruction=one(`SELECT instrucao FROM prompt_operational WHERE chave='edital_requisitos'`)?.instrucao||''; const response=await askLocalAI(`${instruction}\n\nDADOS DO EDITAL:\n${JSON.stringify(edital,null,2)}\n\nResponda somente JSON no formato {"requirements":[{"categoria":"","titulo":"","descricao":"","obrigatorio":true,"pagina":0,"risco":"","acao_licitante":""}]}.`); const parsed=parseJsonLoose(response); if(!parsed?.requirements?.length) throw new Error('A análise não retornou requisitos estruturados.'); transaction(()=>{let doc=one('SELECT id FROM edital_documento WHERE licitacao_id=?',[edital.id]); const docId=doc?.id||run(`INSERT INTO edital_documento (licitacao_id,url,status_download,status_analise,data_analise,inferencia_status,inferencia_json) VALUES (?,?,?,?,datetime('now'),?,?)`,[edital.id,'','dados do edital','analisado','análise concluída',response]); run('DELETE FROM requisito WHERE topico_id IN (SELECT t.id FROM edital_topico t JOIN edital_fase f ON f.id=t.fase_id WHERE f.edital_documento_id=?)',[docId]); run('DELETE FROM edital_topico WHERE fase_id IN (SELECT id FROM edital_fase WHERE edital_documento_id=?)',[docId]); run('DELETE FROM edital_fase WHERE edital_documento_id=?',[docId]); const faseId=run('INSERT INTO edital_fase (edital_documento_id,nome,ordem) VALUES (?,?,1)',[docId,'Requisitos identificados na leitura']); const topicoId=run('INSERT INTO edital_topico (fase_id,titulo,ordem) VALUES (?,?,1)',[faseId,'Requisitos do edital']); for(const req of parsed.requirements){run(`INSERT INTO requisito (topico_id,categoria,titulo,descricao,obrigatorio,pagina,risco,acao_licitante) VALUES (?,?,?,?,?,?,?,?)`,[topicoId,req.categoria||'',req.titulo||'',req.descricao||'',req.obrigatorio?1:0,Number(req.pagina)||0,req.risco||'',req.acao_licitante||'']);}}); await this.refresh(); this.patch({busy:false,status:`${parsed.requirements.length} requisitos identificados.`});}catch(error){
    if(error?.code==='UNSAFE_MODEL_OUTPUT'||error instanceof UnsafeModelOutputError){
      await disposeLocalAI();
      this.patch({busy:false,aiReady:false,modelStored:true,modelStatus:'Análise interrompida',error:'A análise foi interrompida. Tente novamente.',status:'A análise foi interrompida.'});
    }else{
      this.patch({busy:false,error:error.message,status:'A análise não pôde ser materializada.'});
    }
  } };
  this.linkDocument = async (requirementId,documentId) => { if(!documentId)return; const existing=one('SELECT id FROM correlacao_documental WHERE requisito_id=?',[requirementId]); if(existing)run(`UPDATE correlacao_documental SET documento_id=?,situacao='documento relacionado',observacao='Associação manual',confirmado=1 WHERE id=?`,[documentId,existing.id]); else run(`INSERT INTO correlacao_documental (requisito_id,documento_id,pagina_documento,trecho_documento,valor_localizado,situacao,observacao,confirmado) VALUES (?,?,1,'Associação manual','Verificar','documento relacionado','Associação manual',1)`,[requirementId,documentId]); await this.refresh(); this.patch({status:'Evidência relacionada ao requisito.'}); };
  this.savePrompt = async id => { const value=document.querySelector(`#prompt-${id}`)?.value||''; run(`UPDATE prompt_operational SET instrucao=?,atualizado_em=datetime('now') WHERE id=?`,[value,id]); await this.refresh(); this.patch({status:'Configuração salva.'}); };
  this.captureInstall = event => {event.preventDefault();this.installPrompt=event;this.patch({status:'A instalação está disponível.'});};
  this.install = async () => {if(!this.installPrompt){this.patch({status:'Use o botão de instalação do navegador.'});return;}await this.installPrompt.prompt();const result=await this.installPrompt.userChoice;this.installPrompt=null;this.patch({installed:result.outcome==='accepted',status:result.outcome==='accepted'?'Aplicativo instalado.':'A instalação foi cancelada.'});};

  window.addEventListener('beforeinstallprompt',this.captureInstall);
  window.addEventListener('appinstalled',()=>this.patch({installed:true,status:'Aplicativo instalado.'}));
  window.addEventListener('pagehide',()=>void disposeLocalAI(),{once:true});

  while(true){
    Object.assign(this.state,yield(this.element=((element)=>{element.id=this.id;element.component=this;if(this.element?.isConnected)this.element.replaceWith(element);return element;})(Object.assign(document.createElement('template'),{innerHTML:/* html */`
      <section class="app-shell">
        ${this.state.phase==='boot'?`<main class="splash"><div class="brand-mark">M</div><h1>Maximus Licitações Inteligentes</h1><p>${escapeHtml(this.state.status)}</p><div class="loader"></div></main>`:''}
        ${this.state.phase==='error'?`<main class="splash"><h1>Não foi possível concluir a preparação</h1><p>${escapeHtml(this.state.error)}</p></main>`:''}
        ${this.state.phase==='ready'?`
          <aside class="sidebar"><div class="brand"><div class="brand-mark">M</div><div><strong>MAXIMUS</strong><span>Licitações Inteligentes</span></div></div>
            <nav>${sidebarButton(this.id,'editais','Editais','⌁',this.state.page)}${sidebarButton(this.id,'empresa','Empresa','◆',this.state.page)}${sidebarButton(this.id,'documentos','Documentos','▤',this.state.page)}${sidebarButton(this.id,'matriz','Matriz','▦',this.state.page)}${sidebarButton(this.id,'prompts','Configuração','✦',this.state.page)}${sidebarButton(this.id,'inteligencia','Inteligência','◎',this.state.page)}</nav>
            <div class="sidebar-footer"><button class="ghost wide" onclick="document.getElementById('${this.id}').component.install()">${this.state.installed?'Aplicativo instalado':'Instalar aplicativo'}</button></div>
          </aside>
          <main class="workspace"><header class="topbar"><div><h1>${this.state.page==='editais'?'Editais':this.state.page==='empresa'?'Empresa':this.state.page==='documentos'?'Documentos':this.state.page==='matriz'?'Matriz documental':this.state.page==='prompts'?'Configuração':'Inteligência'}</h1></div><div class="runtime"><span class="dot ${this.state.aiReady?'online':''}"></span>${this.state.aiReady?'Análise pronta':'Análise indisponível'}</div></header>
            ${this.state.error ? `<div class="statusbar error">${escapeHtml(this.state.error)}</div>` : this.state.busy || this.state.catalogLoading || this.state.aiLoading ? `<div class="statusbar">${escapeHtml(this.state.status)}</div>` : ``}
            <div class="content">${this.state.page==='editais'?renderEditais(this.state,this.id):this.state.page==='empresa'?renderEmpresa(this.state,this.id):this.state.page==='documentos'?renderDocumentos(this.state,this.id):this.state.page==='matriz'?renderMatriz(this.state,this.id):this.state.page==='prompts'?renderPrompts(this.state,this.id):renderInteligencia(this.state,this.id)}</div>
          </main>`:''}
        <input id="document-file" type="file" accept="application/pdf,.pdf,.txt,.md" hidden onchange="document.getElementById('${this.id}').component.uploadDocument()">
      </section>`}).content.firstElementChild)));
  }
}

const app=component(App,{id:'maximus-licitacoes'});
document.querySelector('#app-root').append(app.next().value);
void app.bootstrap();
