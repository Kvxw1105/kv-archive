import { createIndexedDbCaptureStore } from "./capture-store.js";
import { createIndexedDbLibraryStore } from "./library-store.js";
import { buildPortableCapturePackage, createPortableCaptureZipBlob, readPortableCaptureZip } from "./capture-package.js";
import { createTaskFeedback } from "./task-feedback.js";
import { createDebouncedWriter, createDraftStore, hasMeaningfulDraft } from "./draft-store.js";
import { resolveProjectSelection } from "./project-identity.js";
import { relationSelectionState, restoreUndoMode } from "./capture-ux.js";

const captureStore=createIndexedDbCaptureStore();
const libraryStore=createIndexedDbLibraryStore();
const taskFeedback=createTaskFeedback({page:"CAPTURE & RECOVERY",autoScroll:true});
const captureAnchor=document.querySelector(".composer");
const recoveryAnchor=document.querySelector(".recovery-panel");
const $=(id)=>document.getElementById(id);
const elements=Object.fromEntries(["capture-form","project","new-project","kind","title","body","tags","source-url","reset","status","draft-status","undo-bar","undo-text","undo-button","query","filter-project","filter-kind","filter-status","items","capture-load-more","count","relation-form","relation-from","relation-to","relation-type","relation-submit","relation-help","relations","detail","detail-content","export-portable","import-portable-file","analyze-portable","apply-portable","portable-plan","recovery-receipts"].map((id)=>[id,$(id)]));
let editingId=null;
let items=[];
let pendingPortablePackage=null;
let pendingPortablePlan=null;
let undoAction=null;
let undoTimer=null;
let relationItemsCurrent=[];
const CAPTURE_RENDER_BATCH=100;
const DETAIL_HISTORY_BATCH=50;
const RELATION_BATCH=100;
const RECOVERY_RECEIPT_BATCH=30;
let itemRenderLimit=CAPTURE_RENDER_BATCH;
let currentDetailData=null;
let detailLimits={versions:DETAIL_HISTORY_BATCH,operations:DETAIL_HISTORY_BATCH,relations:DETAIL_HISTORY_BATCH,promotions:DETAIL_HISTORY_BATCH};
let relationRenderLimit=RELATION_BATCH;
let recoveryReceiptLimit=RECOVERY_RECEIPT_BATCH;
let currentRelationRows=[];
let currentRelationTitles=new Map();
let currentRecoveryReceipts=[];
const draftStore=createDraftStore({storage:localStorage,key:"kv-archive:capture-draft:v1"});
const kindLabel={note:"笔记",flash:"闪念",web_excerpt:"网页摘录",ai_excerpt:"AI 片段",conversation:"对话",image:"图片",file:"文件"};
const relationLabel={related_to:"相关",supports:"支持",depends_on:"依赖",derived_from:"源自",references:"引用",contains:"包含",supersedes:"替代",promoted_to:"晋升为",belongs_to:"属于"};
const escapeHtml=(value)=>String(value??"").replace(/[&<>"']/g,(char)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const dateText=(value)=>value?new Date(value).toLocaleString("zh-CN",{hour12:false}):"";
function setStatus(text,tone=""){elements.status.textContent=text;elements.status.dataset.tone=tone;}
function selectedProject(){const option=elements.project.selectedOptions[0];const existingProjects=[...elements.project.options].filter((row)=>row.value).map((row)=>({id:row.value,title:row.dataset.title||row.textContent||row.value}));return resolveProjectSelection({selectedId:elements.project.value||null,selectedTitle:option?.dataset.title||option?.textContent||"",newTitle:elements["new-project"].value,existingProjects});}
function currentDraft(){const option=elements.project.selectedOptions[0];const newProjectTitle=elements["new-project"].value.trim();return {editingId,expectedRevision:editingId?Number(elements["capture-form"].dataset.expectedRevision||0):null,projectId:newProjectTitle?null:elements.project.value||null,projectTitle:newProjectTitle?"":option?.dataset.title||option?.textContent||"",newProjectTitle,kind:elements.kind.value,title:elements.title.value,body:elements.body.value,tags:elements.tags.value,sourceUrl:elements["source-url"].value,updatedAt:new Date().toISOString()};}
function updateDraftStatus(text="草稿会自动保存在当前浏览器。",tone=""){elements["draft-status"].textContent=text;elements["draft-status"].dataset.tone=tone;}
const draftWriter=createDebouncedWriter((value)=>{let saved=null;try{saved=draftStore.save(value);}catch(error){updateDraftStatus(`草稿保存失败：${error instanceof Error?error.message:String(error)}`,"error");return;}if(saved)updateDraftStatus(`草稿已自动保存 · ${new Date(saved.updatedAt).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"})}`,"success");else updateDraftStatus();},320);
function clearDraft(){draftWriter.cancel();draftStore.clear();updateDraftStatus();}
function resetForm({clear=true,preserveProjectId=""}={}){editingId=null;delete elements["capture-form"].dataset.expectedRevision;elements["capture-form"].reset();elements.kind.value="note";elements.project.value=preserveProjectId;elements["new-project"].value="";$("save").textContent="保存内容";if(clear)clearDraft();}
async function restoreDraft(){const draft=draftStore.load();if(!draft)return;let restoredEditing=false;let staleEditing=false;if(draft.editingId){const item=await captureStore.get(draft.editingId).catch(()=>null);if(item&&item.revision===draft.expectedRevision){editingId=item.id;elements["capture-form"].dataset.expectedRevision=String(item.revision);restoredEditing=true;$("save").textContent="保存新版本";}else{draft.editingId=null;draft.expectedRevision=null;staleEditing=true;}}const projectExists=[...elements.project.options].some((option)=>option.value===draft.projectId);elements.project.value=projectExists?(draft.projectId||""):"";elements["new-project"].value=draft.newProjectTitle||(!projectExists?draft.projectTitle||"":"");elements.kind.value=draft.kind||"note";elements.title.value=draft.title||"";elements.body.value=draft.body||"";elements.tags.value=draft.tags||"";elements["source-url"].value=draft.sourceUrl||"";if(staleEditing)updateDraftStatus("原记录已经变化，未保存内容已作为新草稿恢复。","warning");else if(restoredEditing)updateDraftStatus("已恢复未保存的编辑草稿。","warning");else if(hasMeaningfulDraft(draft))updateDraftStatus("已恢复上次未保存的草稿。","warning");}
function showUndo(text,action){clearTimeout(undoTimer);undoAction=action;elements["undo-text"].textContent=text;elements["undo-bar"].hidden=false;undoTimer=setTimeout(()=>{undoAction=null;elements["undo-bar"].hidden=true;},8000);}
function hideUndo(){clearTimeout(undoTimer);undoAction=null;elements["undo-bar"].hidden=true;}
function tags(){return elements.tags.value.split(/[,，]/).map((value)=>value.trim()).filter(Boolean);}
async function loadProjects(){const currentProject=elements.project.value;const currentFilter=elements["filter-project"].value;const projects=await libraryStore.listStateProjects();const options=projects.map((p)=>`<option value="${escapeHtml(p.id)}" data-title="${escapeHtml(p.title)}">${escapeHtml(p.title)}</option>`).join("");elements.project.innerHTML='<option value="">未绑定 Project</option>'+options;elements["filter-project"].innerHTML='<option value="all">全部 Project</option><option value="__unbound__">未绑定 Project</option>'+options;if([...elements.project.options].some((option)=>option.value===currentProject))elements.project.value=currentProject;if([...elements["filter-project"].options].some((option)=>option.value===currentFilter))elements["filter-project"].value=currentFilter;}
function selectedFilterProject(){const value=elements["filter-project"].value;return {value,projectId:value&&value!=="all"&&value!=="__unbound__"?value:null,unbound:value==="__unbound__"};}

function portableScope(){const filter=selectedFilterProject();return {projectId:filter.projectId,dateFrom:null,dateTo:null,unbound:filter.unbound};}
function safeFilePart(value){return String(value||"all").trim().replace(/[^a-zA-Z0-9._-]+/g,"-").replace(/^-+|-+$/g,"")||"all";}
function planMetric(label,value){return `<div><span>${escapeHtml(label)}</span><strong>${Number(value||0)}</strong></div>`;}
function renderPortablePlan(plan){
  pendingPortablePlan=plan;
  elements["apply-portable"].disabled=!plan?.canApply;
  if(!plan){elements["portable-plan"].className="recovery-output empty";elements["portable-plan"].textContent="请选择 KV Archive Portable Capture ZIP。";return;}
  const warnings=plan.validation?.issues?.filter((row)=>row.severity==="warning")||[];
  const conflicts=plan.conflicts||[];
  elements["portable-plan"].className="recovery-output";
  elements["portable-plan"].innerHTML=`<div class="plan-metrics">${planMetric("新建内容",plan.writeCounts.createObjects)}${planMetric("安全推进",plan.writeCounts.fastForwardObjects)}${planMetric("新增版本",plan.writeCounts.addVersions)}${planMetric("新增关系",plan.writeCounts.addRelations)}${planMetric("新增日志",plan.writeCounts.addOperations)}${planMetric("新增晋升",plan.writeCounts.addPromotions)}</div><p><strong>${plan.canApply?"可以写入":"禁止写入"}</strong> · 总写入 ${plan.totalWrites} · 冲突 ${conflicts.length} · 警告 ${warnings.length}</p>${conflicts.length?`<ul class="conflict-list">${conflicts.slice(0,30).map((row)=>`<li><code>${escapeHtml(row.code)}</code> · ${escapeHtml(row.collection)} / ${escapeHtml(row.id)} · ${escapeHtml(row.message)}</li>`).join("")}</ul>`:""}${warnings.length?`<ul class="warning-list">${warnings.slice(0,20).map((row)=>`<li><code>${escapeHtml(row.code)}</code> · ${escapeHtml(row.path)} · ${escapeHtml(row.message)}</li>`).join("")}</ul>`:""}<details><summary>查看计划哈希</summary><code>${escapeHtml(plan.planHash)}</code></details>`;
}
async function refreshRecoveryReceipts(){
  const receipts=await captureStore.listRecoveryReceipts();
  const rolledBack=new Set(receipts.filter((row)=>row.type==="rollback"&&row.status==="applied").map((row)=>row.sourceReceiptId));
  currentRecoveryReceipts=receipts;
  const visible=receipts.slice(0,recoveryReceiptLimit);
  elements["recovery-receipts"].innerHTML=receipts.length?visible.map((row)=>`<article class="receipt"><header><strong>${row.type==="rollback"?"回滚":"导入"} · ${escapeHtml(row.status)}</strong><span>${escapeHtml(dateText(row.createdAt))}</span></header><p>${escapeHtml(row.packageId||"")}</p><code>${escapeHtml(row.id)}</code>${row.type==="import"&&row.status==="applied"&&!rolledBack.has(row.id)?`<div class="actions"><button type="button" class="secondary" data-rollback-receipt="${escapeHtml(row.id)}">检查并回滚</button></div>`:rolledBack.has(row.id)?'<p class="status" data-tone="success">已通过追加回执回滚</p>':""}</article>`).join("")+(receipts.length>recoveryReceiptLimit?`<button type="button" class="secondary" data-receipts-more>再加载 ${Math.min(RECOVERY_RECEIPT_BATCH,receipts.length-recoveryReceiptLimit)} 条回执</button>`:""):'<div class="empty">暂无恢复回执。</div>';
}
async function exportPortablePackage(){
  taskFeedback.start({id:"capture-export",title:"正在导出可迁移记录包",detail:"读取当前 Project 范围，核验版本链后生成 Portable Capture ZIP。",stage:"读取内容",step:0,stepLabels:["读取","核验","打包","下载"],button:elements["export-portable"],buttonLabel:"正在导出…",anchor:recoveryAnchor,indeterminate:true});
  try{
    const scope=portableScope();
    const records=await captureStore.exportRecords({projectId:scope.projectId||"all",unbound:scope.unbound});
    taskFeedback.update({title:"正在核验版本链",detail:`${records.contentObjects?.length||0} 条内容，准备生成确定性包。`,stage:"核验数据",step:1,indeterminate:true});
    const packageValue=await buildPortableCapturePackage(records,{scope,sourceAppVersion:chrome.runtime.getManifest().version});
    const blob=createPortableCaptureZipBlob(packageValue);
    const url=URL.createObjectURL(blob);
    try{await chrome.downloads.download({url,filename:`KV-Archive-Portable-Capture-${safeFilePart(scope.unbound?"unbound":scope.projectId)}-${packageValue.payloadHash.slice(7,19)}.zip`,saveAs:true});}
    finally{setTimeout(()=>URL.revokeObjectURL(url),30000);}
    setStatus(`Portable Capture 已导出：${packageValue.counts.contentObjects} 条内容，${packageValue.counts.contentVersions} 个版本。`,"success");
    taskFeedback.success({title:"Portable Capture 已生成",detail:`${packageValue.counts.contentObjects} 条内容、${packageValue.counts.contentVersions} 个版本已提交下载。`,button:elements["export-portable"]});
  }catch(error){const message=error instanceof Error?error.message:String(error);taskFeedback.fail({title:"Portable Capture 导出失败",detail:message,button:elements["export-portable"]});throw error;}
}
async function analyzePortableFile(){
  const file=elements["import-portable-file"].files?.[0];
  if(!file)throw new Error("请先选择 Portable Capture ZIP");
  taskFeedback.start({id:"capture-analyze",title:"正在执行导入干运行",detail:"验证 ZIP、Payload Hash、版本链和冲突；此阶段不会写入数据。",stage:"验证文件",step:0,stepLabels:["验证 ZIP","比较数据","生成计划","等待确认"],button:elements["analyze-portable"],buttonLabel:"正在分析…",anchor:recoveryAnchor,indeterminate:true});
  try{
    const parsed=await readPortableCaptureZip(await file.arrayBuffer());
    pendingPortablePackage=parsed.package;
    taskFeedback.update({title:"正在比较本地数据",detail:"检查同 ID、同版本与关系端点冲突。",stage:"冲突分析",step:1,indeterminate:true});
    const plan=await captureStore.analyzePortablePackage(parsed.package);
    renderPortablePlan(plan);
    setStatus(plan.canApply?"干运行完成：没有阻塞冲突。":"干运行完成：发现冲突，未写入任何数据。",plan.canApply?"success":"error");
    if(plan.canApply)taskFeedback.success({title:"干运行通过",detail:`计划写入 ${plan.totalWrites} 条记录；尚未写入，等待你确认。`,button:elements["analyze-portable"]});
    else taskFeedback.fail({title:"干运行发现冲突",detail:`检测到 ${plan.conflicts?.length||0} 个阻塞冲突，没有写入任何数据。`,button:elements["analyze-portable"]});
  }catch(error){const message=error instanceof Error?error.message:String(error);taskFeedback.fail({title:"干运行分析失败",detail:message,button:elements["analyze-portable"]});throw error;}
}
async function applyPortableFile(){
  if(!pendingPortablePackage||!pendingPortablePlan?.canApply)throw new Error("请先完成无冲突的干运行分析");
  if(!confirm(`确认写入 ${pendingPortablePlan.totalWrites} 条恢复记录？原始会话证据和 Project State 不会被修改。`))return;
  taskFeedback.start({id:"capture-apply",title:"正在写入恢复记录",detail:"按干运行计划执行原子写入，并生成不可覆盖的导入回执。",stage:"执行写入",step:1,stepLabels:["确认计划","原子写入","保存回执","完成"],current:0,total:pendingPortablePlan.totalWrites,button:elements["apply-portable"],buttonLabel:"正在写入…",anchor:recoveryAnchor,indeterminate:true});
  try{
    const result=await captureStore.applyPortablePackage(pendingPortablePackage);
    setStatus(`恢复写入完成，回执 ${result.receipt.id} 已保存。`,"success");
    pendingPortablePackage=null;pendingPortablePlan=null;elements["import-portable-file"].value="";elements["analyze-portable"].disabled=true;renderPortablePlan(null);
    await refresh();await refreshRecoveryReceipts();
    taskFeedback.success({title:"恢复写入完成",detail:`不可覆盖回执 ${result.receipt.id} 已保存，可用于审计和安全回滚。`,button:elements["apply-portable"]});
  }catch(error){const message=error instanceof Error?error.message:String(error);taskFeedback.fail({title:"恢复写入未完成",detail:message,button:elements["apply-portable"]});throw error;}
}
async function rollbackReceipt(receiptId){
  taskFeedback.start({id:"capture-rollback",title:"正在检查安全回滚边界",detail:"先核对导入后是否发生编辑或新增依赖，不会直接删除数据。",stage:"分析回执",step:0,stepLabels:["分析","确认边界","回滚","保存回执"],anchor:recoveryAnchor,indeterminate:true});
  const plan=await captureStore.analyzePortableRollback(receiptId);
  if(!plan.canRollback){setStatus(`回滚被 ${plan.conflicts.length} 个边界冲突阻止。`,"error");taskFeedback.fail({title:"回滚被安全边界阻止",detail:`检测到 ${plan.conflicts.length} 个冲突，没有修改数据。`});alert(plan.conflicts.map((row)=>`${row.code}: ${row.message}`).join("\n"));return;}
  if(!confirm(`确认撤销该次导入？将删除 ${plan.actions.deleteObjectIds.length} 个导入对象，并恢复 ${plan.actions.restoreObjects.length} 个安全推进对象。`)){taskFeedback.clear();return;}
  try{const result=await captureStore.rollbackPortableImport(receiptId);setStatus(`回滚完成，追加回执 ${result.receipt.id}。`,"success");await refresh();await refreshRecoveryReceipts();taskFeedback.success({title:"安全回滚完成",detail:`追加回执 ${result.receipt.id} 已保存，历史审计链未被覆盖。`});}
  catch(error){const message=error instanceof Error?error.message:String(error);taskFeedback.fail({title:"回滚未完成",detail:message});throw error;}
}
function card(item){const snippet=item.body.slice(0,260);let controls="";let promotion="";if(item.status==="trashed")controls=`<button data-action="restore" data-id="${escapeHtml(item.id)}">恢复</button>`;else if(item.status==="archived")controls=`<button data-action="edit" data-id="${escapeHtml(item.id)}">编辑</button><button data-action="restore" data-id="${escapeHtml(item.id)}">取消归档</button><button data-action="trash" data-id="${escapeHtml(item.id)}">回收</button>`;else{controls=`<button data-action="edit" data-id="${escapeHtml(item.id)}">编辑</button><button data-action="archive" data-id="${escapeHtml(item.id)}">归档</button><button data-action="trash" data-id="${escapeHtml(item.id)}">回收</button>`;promotion=item.projectId?`<span class="promotion-menu"><button data-action="promote-memory" data-id="${escapeHtml(item.id)}">→ Memory</button><button data-action="promote-decision" data-id="${escapeHtml(item.id)}">→ Decision</button><button data-action="promote-task" data-id="${escapeHtml(item.id)}">→ Task</button></span>`:`<span class="promotion-hint">绑定 Project 后可晋升</span>`;}return `<article class="item-card" data-status="${escapeHtml(item.status)}"><header><h3>${escapeHtml(item.title)}</h3><span class="pill">${escapeHtml(item.status==="archived"?"已归档":item.status==="trashed"?"回收站":kindLabel[item.kind]||item.kind)}</span></header><p>${escapeHtml(snippet||"（无正文）")}</p><div class="item-meta"><span>v${item.revision}</span><span>${escapeHtml(item.projectTitle||"未绑定 Project")}</span><span>${escapeHtml(dateText(item.updatedAt))}</span>${item.tags.map((tag)=>`<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div><div class="item-actions"><button data-action="detail" data-id="${escapeHtml(item.id)}">详情</button>${controls}${promotion}</div></article>`;}
function syncRelationControls(relationItems=relationItemsCurrent){const ids=relationItems.map((item)=>item.id);const state=relationSelectionState(ids,elements["relation-from"].value,elements["relation-to"].value);elements["relation-from"].value=state.fromId;elements["relation-to"].value=state.toId;elements["relation-submit"].disabled=!state.ready;elements["relation-from"].disabled=ids.length<2;elements["relation-to"].disabled=ids.length<2;elements["relation-type"].disabled=ids.length<2;elements["relation-help"].textContent=state.ready?"选择两条不同记录建立关系；只在当前 Project 范围内生效。":"至少需要两条使用中的同一 Project 范围记录。";}
async function refresh(){const filter=selectedFilterProject();elements.items.setAttribute("aria-busy","true");elements.items.innerHTML='<div class="empty">正在读取记录与关系……</div>';try{items=await captureStore.list({projectId:filter.projectId,kind:elements["filter-kind"].value,status:elements["filter-status"].value,query:elements.query.value});if(filter.unbound)items=items.filter((item)=>!item.projectId);elements.count.textContent=String(items.length);const visibleItems=items.slice(0,itemRenderLimit);elements.items.innerHTML=visibleItems.length?visibleItems.map(card).join(""):'<div class="empty"><strong>当前筛选下没有内容</strong><span>可以调整筛选，或回到左侧先记录一条内容。</span><div class="empty-actions"><button type="button" data-empty-action="compose">开始记录</button><button type="button" class="secondary" data-empty-action="reset-filter">清除筛选</button></div></div>';elements["capture-load-more"].hidden=items.length<=itemRenderLimit;elements["capture-load-more"].textContent=items.length>itemRenderLimit?`再加载 ${Math.min(CAPTURE_RENDER_BATCH,items.length-itemRenderLimit)} 条 · 还剩 ${items.length-itemRenderLimit} 条`:"没有更多记录";let relationItems=await captureStore.list({projectId:filter.projectId,status:"active"});if(filter.unbound)relationItems=relationItems.filter((item)=>!item.projectId);relationItemsCurrent=relationItems;const opts=relationItems.map((item)=>`<option value="${escapeHtml(item.id)}">${escapeHtml(item.title)} · ${escapeHtml(kindLabel[item.kind]||item.kind)}</option>`).join("");elements["relation-from"].innerHTML=opts;elements["relation-to"].innerHTML=opts;syncRelationControls(relationItems);await refreshRelations(relationItems);}finally{elements.items.removeAttribute("aria-busy");}}
function renderRelations(){const visible=currentRelationRows.slice(0,relationRenderLimit);elements.relations.innerHTML=currentRelationRows.length?visible.map((row)=>`<div class="relation"><strong>${escapeHtml(currentRelationTitles.get(row.fromId)||row.fromId)}</strong> ${escapeHtml(relationLabel[row.relation]||row.relation)} <strong>${escapeHtml(currentRelationTitles.get(row.toId)||row.toId)}</strong> <button data-unlink="${escapeHtml(row.id)}" class="secondary">删除</button></div>`).join("")+(currentRelationRows.length>relationRenderLimit?`<button type="button" class="secondary" data-relations-more>再加载 ${Math.min(RELATION_BATCH,currentRelationRows.length-relationRenderLimit)} 条关系</button>`:""):'<div class="empty">暂无关系。</div>';}
async function refreshRelations(visibleItems=null){const filter=selectedFilterProject();let relations=await captureStore.listRelations(null,filter.projectId);const rows=visibleItems||await captureStore.list({projectId:filter.projectId,status:"all"});const visible=filter.unbound?rows.filter((item)=>!item.projectId):rows;currentRelationTitles=new Map(visible.map((item)=>[item.id,item.title]));if(filter.unbound)relations=relations.filter((row)=>currentRelationTitles.has(row.fromId)&&currentRelationTitles.has(row.toId));currentRelationRows=relations;renderRelations();}
function detailSection(title,kind,rows,renderRow){const limit=detailLimits[kind];const visible=rows.slice(0,limit);return `<section class="detail-card"><h3>${escapeHtml(title)} · ${rows.length}</h3>${visible.length?visible.map(renderRow).join(""):"暂无"}${rows.length>limit?`<button type="button" class="secondary" data-detail-more="${escapeHtml(kind)}">再加载 ${Math.min(DETAIL_HISTORY_BATCH,rows.length-limit)} 条</button>`:""}</section>`;}
function renderCaptureDetail(){if(!currentDetailData)return;const {item,versions,operations,relations,ownPromotions}=currentDetailData;elements["detail-content"].innerHTML=`<div class="detail-shell"><span class="kicker">${escapeHtml(item.id)}</span><h2>${escapeHtml(item.title)}</h2><div class="item-meta"><span>${escapeHtml(kindLabel[item.kind]||item.kind)}</span><span>v${item.revision}</span><span>${escapeHtml(item.contentHash)}</span></div><pre>${escapeHtml(item.body)}</pre><div class="detail-grid">${detailSection("版本历史","versions",versions,(row)=>`<div class="event-row">v${row.revision} · ${escapeHtml(row.reason)} · ${escapeHtml(dateText(row.createdAt))}${row.revision!==item.revision?` <button data-restore-version="${row.revision}" data-object-id="${escapeHtml(item.id)}">恢复为新版本</button>`:""}</div>`)}${detailSection("操作日志","operations",operations,(row)=>`<div class="event-row">${escapeHtml(row.type)} · → v${row.resultingRevision} · ${escapeHtml(dateText(row.createdAt))}</div>`)}${detailSection("关系","relations",relations,(row)=>`<div class="event-row">${escapeHtml(row.fromId)} ${escapeHtml(relationLabel[row.relation]||row.relation)} ${escapeHtml(row.toId)}</div>`)}${detailSection("晋升草案","promotions",ownPromotions,(row)=>`<div class="event-row">${escapeHtml(row.targetKind)} · ${escapeHtml(row.status)}<details><summary>查看草案</summary><pre>${escapeHtml(JSON.stringify(row.draft,null,2))}</pre></details></div>`)}</div></div>`;}
async function openDetail(id){
  currentDetailData=null;
  detailLimits={versions:DETAIL_HISTORY_BATCH,operations:DETAIL_HISTORY_BATCH,relations:DETAIL_HISTORY_BATCH,promotions:DETAIL_HISTORY_BATCH};
  elements["detail-content"].innerHTML=`<div class="detail-shell"><h2>正在读取记录详情</h2><p>加载版本历史、操作日志、关系和晋升草案……</p></div>`;
  elements.detail.showModal();
  taskFeedback.start({id:"capture-detail",title:"正在打开记录详情",detail:"读取当前内容及其不可变历史。",stage:"读取记录",step:0,stepLabels:["读取","版本","关系","完成"],anchor:elements["detail-content"],indeterminate:true});
  try{
    const item=await captureStore.get(id);
    if(!item)throw new Error("未找到该记录");
    const [versions,operations,relations,promotions]=await Promise.all([captureStore.listVersions(id),captureStore.listOperations({objectId:id}),captureStore.listRelations(id),captureStore.listPromotions(item.projectId)]);
    const ownPromotions=promotions.filter((row)=>row.sourceObjectId===id);
    currentDetailData={item,versions,operations,relations,ownPromotions};
    renderCaptureDetail();
    taskFeedback.success({title:"记录详情已打开",detail:`版本 ${versions.length} 条、操作 ${operations.length} 条、关系 ${relations.length} 条。`});
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    elements["detail-content"].innerHTML=`<div class="detail-shell"><h2>无法打开记录</h2><p>${escapeHtml(message)}</p></div>`;
    taskFeedback.fail({title:"记录详情读取失败",detail:message});
  }
}
async function promote(id,targetKind){taskFeedback.start({id:"capture-promote",title:"正在创建晋升草案",detail:"整理为待审核的 Memory、Decision 或 Task，不会自动批准。",stage:"读取记录",step:0,stepLabels:["读取","生成草案","提交审核","完成"],anchor:captureAnchor,indeterminate:true});const item=await captureStore.get(id);if(!item?.projectId){taskFeedback.fail({title:"无法创建晋升草案",detail:"请先把内容绑定到 Project。"});throw new Error("请先把内容绑定到 Project，再创建晋升草案。");}const state=await libraryStore.getProjectState(item.projectId,item.projectTitle||item.projectId);const promotion=await captureStore.createPromotion(id,targetKind,{baseVersion:state.stateVersion,projectTitle:state.projectTitle});if(targetKind==="decision"||targetKind==="task"){const result=await libraryStore.importStateProposal(promotion.draft);await captureStore.markPromotion(promotion.id,"submitted",{reviewerNote:`State proposal ${result.proposal.id}`});setStatus(`已创建 ${targetKind} 待审核提案，请到项目状态中心复核。`,"success");}else{const blob=new Blob([JSON.stringify(promotion.draft,null,2)+"\n"],{type:"application/json"});const url=URL.createObjectURL(blob);await chrome.downloads.download({url,filename:`KV-Archive-Memory-Promotion-${id}.json`,saveAs:true});setTimeout(()=>URL.revokeObjectURL(url),30000);setStatus("Memory 晋升草案已生成并下载，仍需人工审核。","success");}await refresh();taskFeedback.success({title:"晋升草案已创建",detail:"草案已进入人工审核流程，不会自动改写项目状态。"});}
elements["capture-form"].addEventListener("submit",async(event)=>{event.preventDefault();try{const project=selectedProject();const value={kind:elements.kind.value,projectId:project.id,projectTitle:project.id?project.title:null,title:elements.title.value,body:elements.body.value,tags:tags(),source:{provider:elements["source-url"].value?"web":null,sourceUrl:elements["source-url"].value||null,sourceId:null,rawObjectKey:null,capturedAt:new Date().toISOString(),metadata:{}}};const wasEditing=Boolean(editingId);if(editingId){const expectedRevision=Number(elements["capture-form"].dataset.expectedRevision||0);await captureStore.update(editingId,value,{expectedRevision});}else await captureStore.create(value);clearDraft();setStatus(wasEditing?"已保存新版本；Project 已保留，可继续记录。":"内容已保存；Project 已保留，可继续记录。","success");resetForm({preserveProjectId:project.id||""});await loadProjects();await refresh();elements.body.focus();}catch(error){draftWriter.flush(currentDraft());setStatus(error instanceof Error?error.message:String(error),"error");}});
elements.reset.addEventListener("click",()=>{if(hasMeaningfulDraft(currentDraft())&&!confirm("确认清空当前未保存内容？"))return;resetForm();setStatus("编辑区已清空。","success");});
for(const id of ["project","new-project","kind","title","body","tags","source-url"])elements[id].addEventListener(id==="body"||id==="title"||id==="tags"||id==="source-url"?"input":"change",()=>draftWriter.schedule(currentDraft()));
window.addEventListener("beforeunload",()=>draftWriter.flush(currentDraft()));
elements["undo-button"].addEventListener("click",async()=>{if(!undoAction)return;const action=undoAction;hideUndo();try{await action();await refresh();setStatus("已撤销刚才的操作。","success");}catch(error){setStatus(`撤销失败：${error instanceof Error?error.message:String(error)}`,"error");}});
for(const id of ["query","filter-project","filter-kind","filter-status"])elements[id].addEventListener(id==="query"?"input":"change",()=>{itemRenderLimit=CAPTURE_RENDER_BATCH;relationRenderLimit=RELATION_BATCH;refresh();});
elements["capture-load-more"].addEventListener("click",async()=>{itemRenderLimit+=CAPTURE_RENDER_BATCH;await refresh();});
elements.items.addEventListener("click",async(event)=>{const emptyAction=event.target.closest("button[data-empty-action]");if(emptyAction){if(emptyAction.dataset.emptyAction==="compose"){window.scrollTo({top:0,behavior:"smooth"});elements.body.focus();}else{elements.query.value="";elements["filter-project"].value="all";elements["filter-kind"].value="all";elements["filter-status"].value="active";await refresh();}return;}const button=event.target.closest("button[data-action]");if(!button)return;const {action,id}=button.dataset;try{if(action==="detail")await openDetail(id);else if(action==="edit"){const item=await captureStore.get(id);editingId=id;elements["capture-form"].dataset.expectedRevision=String(item.revision);elements.project.value=item.projectId||"";elements["new-project"].value="";elements.kind.value=item.kind;elements.title.value=item.title;elements.body.value=item.body;elements.tags.value=item.tags.join(", ");elements["source-url"].value=item.source?.sourceUrl||"";$("save").textContent="保存新版本";draftWriter.flush(currentDraft());window.scrollTo({top:0,behavior:"smooth"});elements.body.focus();}else if(action==="archive"){await captureStore.archive(id);showUndo("记录已归档。",()=>captureStore.restore(id));}else if(action==="trash"){const item=await captureStore.get(id);if(!confirm(`确认将“${item?.title||"该记录"}”移入回收站？可以在回收站恢复。`))return;const previous=item?.status||"active";await captureStore.trash(id);showUndo("记录已移入回收站。",async()=>{await captureStore.restore(id);if(previous==="archived")await captureStore.archive(id);});}else if(action==="restore"){const before=await captureStore.get(id);const undoMode=restoreUndoMode(before);await captureStore.restore(id);showUndo(before?.status==="archived"?"已取消归档。":"记录已从回收站恢复。",async()=>{if(undoMode==="archive")await captureStore.archive(id);else if(undoMode==="trash")await captureStore.trash(id);});}else if(action.startsWith("promote-"))await promote(id,action.slice(8));await refresh();}catch(error){setStatus(error instanceof Error?error.message:String(error),"error");}});
for(const id of ["relation-from","relation-to"]){elements[id].addEventListener("change",()=>syncRelationControls());}
elements["relation-form"].addEventListener("submit",async(event)=>{event.preventDefault();try{if(elements["relation-from"].value===elements["relation-to"].value)throw new Error("来源和目标必须是两条不同记录");await captureStore.link({fromId:elements["relation-from"].value,toId:elements["relation-to"].value,relation:elements["relation-type"].value});setStatus("关系已建立。","success");await refreshRelations();}catch(error){setStatus(error instanceof Error?error.message:String(error),"error");}});
elements.relations.addEventListener("click",async(event)=>{if(event.target.closest("[data-relations-more]")){relationRenderLimit+=RELATION_BATCH;renderRelations();return;}const button=event.target.closest("button[data-unlink]");if(!button)return;if(!confirm("确认删除这条关系？内容本身不会被删除。"))return;try{await captureStore.unlink(button.dataset.unlink);await refreshRelations();setStatus("关系已删除。","success");}catch(error){setStatus(`关系删除失败：${error instanceof Error?error.message:String(error)}`,"error");}});
elements["detail-content"].addEventListener("click",async(event)=>{const more=event.target.closest("button[data-detail-more]");if(more){const kind=more.dataset.detailMore;if(Object.hasOwn(detailLimits,kind)){detailLimits[kind]+=DETAIL_HISTORY_BATCH;renderCaptureDetail();}return;}const button=event.target.closest("button[data-restore-version]");if(!button)return;if(!confirm(`确认从 v${button.dataset.restoreVersion} 生成新的当前版本？现有历史不会删除。`))return;try{await captureStore.restoreVersion(button.dataset.objectId,Number(button.dataset.restoreVersion));elements.detail.close();await refresh();setStatus("已从历史快照生成新的当前版本。","success");}catch(error){setStatus(`版本恢复失败：${error instanceof Error?error.message:String(error)}`,"error");}});
elements["export-portable"].addEventListener("click",()=>exportPortablePackage().catch((error)=>setStatus(error instanceof Error?error.message:String(error),"error")));
elements["import-portable-file"].addEventListener("change",()=>{pendingPortablePackage=null;pendingPortablePlan=null;renderPortablePlan(null);elements["analyze-portable"].disabled=!elements["import-portable-file"].files?.length;});
elements["analyze-portable"].addEventListener("click",()=>analyzePortableFile().catch((error)=>{renderPortablePlan(null);setStatus(error instanceof Error?error.message:String(error),"error");}));
elements["apply-portable"].addEventListener("click",()=>applyPortableFile().catch((error)=>setStatus(error instanceof Error?error.message:String(error),"error")));
elements["recovery-receipts"].addEventListener("click",(event)=>{if(event.target.closest("[data-receipts-more]")){recoveryReceiptLimit+=RECOVERY_RECEIPT_BATCH;refreshRecoveryReceipts().catch((error)=>setStatus(error instanceof Error?error.message:String(error),"error"));return;}const button=event.target.closest("button[data-rollback-receipt]");if(button)rollbackReceipt(button.dataset.rollbackReceipt).catch((error)=>setStatus(error instanceof Error?error.message:String(error),"error"));});
await loadProjects();await restoreDraft();await refresh();await refreshRecoveryReceipts();
