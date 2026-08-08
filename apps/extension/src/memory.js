import { createIndexedDbLibraryStore } from "./library-store.js";
import { buildMemoryBundle, buildMemoryPackage, diffMemoryMarkdown } from "./memory-core.js";
import { buildProjectMemoryCandidates, evaluateMemoryGate, memoryGateManifest, renderMemoryGateMarkdown } from "./memory-gate-core.js";
import { createStoredZip } from "./zip.js";
import { sha256Hex } from "./vault-index.js";
import { createTaskFeedback } from "./task-feedback.js";
import { createIndexedDbCaptureStore } from "./capture-store.js";

const store = createIndexedDbLibraryStore();
const captureStore = createIndexedDbCaptureStore();
const taskFeedback = createTaskFeedback({ page: "PROJECT CONTEXT", autoScroll: true });
const memoryAnchor = document.querySelector(".preview-panel");
const gateAnchor = document.querySelector(".gate-panel");
const ids = ["project","mode","budget","query","generate","copy","insert","approve","export","preview","status","approved-version","tokens","sources","changes","diff","versions","gate-policy","gate-target","gate-budget","run-gate","export-gate","gate-status","gate-include","gate-review","gate-exclude","gate-tokens","gate-results","gate-runs","project-help"];
const el = Object.fromEntries(ids.map((id)=>[id,document.getElementById(id)]));
const encoder = new TextEncoder();
let candidate = null;
let displayed = null;
let approved = null;
let gateReport = null;
let gateRun = null;
const GATE_RUN_BATCH=8;
const MEMORY_VERSION_BATCH=12;
let gateRunLimit=GATE_RUN_BATCH;
let memoryVersionLimit=MEMORY_VERSION_BATCH;
let memoryVersions=[];
const PROJECT_PREF_KEY = "kv-archive:memory-project:v1";

function setStatus(text,tone=""){el.status.textContent=text;el.status.dataset.tone=tone;}
function setGateStatus(text,tone=""){el["gate-status"].textContent=text;el["gate-status"].dataset.tone=tone;}
function escapeHtml(value){return String(value??"").replace(/[&<>"']/g,(char)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));}
function download(filename, bytes, type="application/zip"){const blob=new Blob([bytes],{type});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function slug(value){return String(value||"Project").replace(/[^\p{L}\p{N}._-]+/gu,"-").replace(/^-+|-+$/g,"").slice(0,80)||"Project";}

async function loadProjects(){
  const projects=await store.listStateProjects();
  const previous=el.project.value;
  let preferred="";
  try{preferred=localStorage.getItem(PROJECT_PREF_KEY)||"";}catch{}
  el.project.innerHTML='<option value="">请选择 Project</option>'+projects.map((p)=>`<option value="${escapeHtml(p.id)}">${escapeHtml(p.title)}</option>`).join("");
  const candidate=[previous,preferred,projects.length===1?projects[0].id:""].find((id)=>id&&projects.some((p)=>p.id===id));
  if(candidate)el.project.value=candidate;
  if(!projects.length){
    el["project-help"].textContent="尚无可用 Project。先从会话篮子导入 ChatGPT Project，或在记录中心创建带 Project 的笔记。";
    setStatus("尚未建立 Project。Project 是本地工作范围，不是 ChatGPT 账号开关。", "warning");
  }else if(el.project.value){
    el["project-help"].textContent=`已选择“${el.project.selectedOptions[0]?.textContent||el.project.value}”。只会使用这个范围的数据。`;
  }else{
    el["project-help"].textContent=`当前有 ${projects.length} 个 Project，请选择一个工作范围。`;
  }
  syncProjectControls();
  return projects;
}

function syncProjectControls(){
  const ready=Boolean(el.project.value);
  el.generate.disabled=!ready;
  el["run-gate"].disabled=!ready;
  if(!ready){
    el.copy.disabled=true;
    el.insert.disabled=true;
    el.approve.disabled=true;
    el["export-gate"].disabled=true;
  }
}

function renderMemoryVersions(){const visible=memoryVersions.slice(0,memoryVersionLimit);el.versions.innerHTML=memoryVersions.length?visible.map((v)=>`<div class="version"><strong>v${v.version}</strong><span>${escapeHtml(v.approvedAt||"")} · 状态 v${v.sourceStateVersion||0}</span></div>`).join("")+(memoryVersions.length>memoryVersionLimit?`<button type="button" class="ghost gate-more" data-memory-versions-more>再显示 ${Math.min(MEMORY_VERSION_BATCH,memoryVersions.length-memoryVersionLimit)} 个版本</button>`:""):'<div class="empty">暂无历史版本。</div>';}
async function refreshApproved(){const id=el.project.value;approved=id?await store.getApprovedMemory(id):null;el["approved-version"].textContent=approved?`v${approved.version}`:"未批准";memoryVersions=id?await store.listMemoryVersions(id):[];renderMemoryVersions();el.export.disabled=!approved;}
function renderDiff(before,after){const diff=diffMemoryMarkdown(before,after);el.changes.textContent=String(diff.changed);el.diff.innerHTML=diff.changed?[...diff.removed.map((line)=>`<div class="diff-row remove">− ${escapeHtml(line)}</div>`),...diff.added.map((line)=>`<div class="diff-row add">+ ${escapeHtml(line)}</div>`)].join(""):'<div class="empty">与已批准版本一致。</div>';}
function currentApprovedText(mode){if(!approved)return "";return mode==="core"?approved.core?.markdown||"":approved.project?.markdown||"";}

async function generate(){const projectId=el.project.value;if(!projectId)throw new Error("请选择 Project");const records=await store.exportAgentRecords({projectId});Object.assign(records,await captureStore.exportRecords({projectId}));const mode=el.mode.value;const options={projectId,mode,query:el.query.value,budgetTokens:Number(el.budget.value)};if(mode==="task"){displayed=await buildMemoryPackage(records,options);candidate=null;}else{const core=await buildMemoryPackage(records,{...options,mode:"core"});const project=await buildMemoryPackage(records,{...options,mode:"project"});candidate={projectId,projectTitle:core.projectTitle,sourceStateVersion:core.sourceStateVersion,sourceStateHash:core.sourceStateHash,core,project,hash:await sha256Hex({core:core.hash,project:project.hash})};displayed=mode==="core"?core:project;}el.preview.textContent=displayed.markdown;el.tokens.textContent=String(displayed.estimatedTokens);el.sources.textContent=String(displayed.sources.length);renderDiff(mode==="task"?"":currentApprovedText(mode),displayed.markdown);el.copy.disabled=false;el.insert.disabled=false;el.approve.disabled=mode==="task";setStatus(mode==="task"?"任务上下文已生成，可复制或插入 ChatGPT。":"候选记忆已生成，请查看 Diff 后批准。","success");}

function evidenceVerifier(records){const rows=records.evidence||[];const objects=records.contentObjects||[];const versions=records.contentVersions||[];return (uri)=>{const text=String(uri);if(text.startsWith("contextvault://project/"))return true;const content=text.match(/^contextvault:\/\/content\/([^?]+)\?revision=([^&#]+)&hash=([^&#]+)$/i);if(content){let objectId,revision,contentHash;try{objectId=decodeURIComponent(content[1]);revision=Number(decodeURIComponent(content[2]));contentHash=decodeURIComponent(content[3]);}catch{return false;}const current=objects.find((row)=>row.id===objectId&&Number(row.revision)===revision);const historical=versions.find((row)=>row.objectId===objectId&&Number(row.revision)===revision)?.snapshot;return (current||historical)?.contentHash===contentHash;}const match=text.match(/^contextvault:\/\/conversation\/([^/]+)\/node\/([^?]+)\?evidence=([^&#]+)$/i);if(!match)return false;let conversationId,nodeId,evidenceHash;try{conversationId=decodeURIComponent(match[1]);nodeId=decodeURIComponent(match[2]);evidenceHash=decodeURIComponent(match[3]);}catch{return false;}return rows.some((row)=>row.conversationId===conversationId&&row.evidenceHash===evidenceHash&&row.canonical?.nodes?.[nodeId]);};}
function reasonCodes(row){return [...(row.reasonCodes||[]),...(row.warnings||[])];}
function renderGate(report){gateReport=report;el["gate-include"].textContent=String(report.counts.INCLUDE);el["gate-review"].textContent=String(report.counts.REVIEW);el["gate-exclude"].textContent=String(report.counts.EXCLUDE);el["gate-tokens"].textContent=`${report.usedTokens}/${report.tokenBudget}`;el["gate-results"].innerHTML=report.candidates.length?report.candidates.map((row)=>{const decision=row.decision.toLowerCase();const evidence=row.candidate.evidenceUris?.length||0;const codes=reasonCodes(row);return `<tr><td><span class="gate-badge ${decision}">${escapeHtml(row.decision)}</span></td><td><span class="candidate-title">${escapeHtml(row.candidate.title||row.candidate.id)}</span><span class="candidate-text">${escapeHtml(row.candidate.text||"（无正文）")}</span></td><td>${escapeHtml(row.candidate.kind)}</td><td><div class="reason-list">${codes.length?codes.map((code)=>`<code>${escapeHtml(code)}</code>`).join(""):"—"}</div></td><td>${evidence}</td><td>${row.allocatedTokens||row.candidate.estimatedTokens}</td></tr>`;}).join(""):'<tr><td colspan="6" class="empty">没有候选记忆。</td></tr>';el["export-gate"].disabled=false;}
async function refreshGateLedger(){const projectId=el.project.value;if(!projectId){el["gate-runs"].innerHTML='<div class="empty">暂无运行回执。</div>';return;}const config=await store.getMemoryGateConfig(projectId);if(config){el["gate-policy"].value=config.policy;el["gate-target"].value=config.target;el["gate-budget"].value=String(config.tokenBudget);}const runs=await store.listMemoryGateRuns(projectId);const visible=runs.slice(0,gateRunLimit);el["gate-runs"].innerHTML=runs.length?visible.map((run)=>`<div class="gate-run"><span>${escapeHtml(run.createdAt||"")}<br>${escapeHtml(run.config?.policy||"")} · ${run.report?.counts?.INCLUDE||0}/${run.report?.counts?.REVIEW||0}/${run.report?.counts?.EXCLUDE||0}</span><button class="ghost" data-restore-run="${escapeHtml(run.id)}">恢复策略</button></div>`).join("")+(runs.length>gateRunLimit?`<button type="button" class="ghost gate-more" data-gate-more>再显示 ${Math.min(GATE_RUN_BATCH,runs.length-gateRunLimit)} 条</button>`:""):'<div class="empty">暂无运行回执。</div>';}
async function runGate(){const projectId=el.project.value;if(!projectId)throw new Error("请选择 Project");const records=await store.exportAgentRecords({projectId});Object.assign(records,await captureStore.exportRecords({projectId}));const state=records.states.find((row)=>row.projectId===projectId);if(!state)throw new Error("当前 Project 没有已批准状态");const config=await store.saveMemoryGateConfig({projectId,projectTitle:state.projectTitle,policy:el["gate-policy"].value,target:el["gate-target"].value,tokenBudget:Number(el["gate-budget"].value)});const candidates=buildProjectMemoryCandidates(state,{verifyEvidence:evidenceVerifier(records)});const report=evaluateMemoryGate(candidates,{projectId,stateVersion:state.stateVersion,projectTitle:state.projectTitle,policy:config.policy,target:config.target,tokenBudget:config.tokenBudget,generatedAt:new Date().toISOString()});gateRun=await store.saveMemoryGateRun({projectId,projectTitle:state.projectTitle,sourceStateVersion:state.stateVersion,sourceStateHash:state.stateHash,config,report,createdAt:report.generatedAt});renderGate(report);await refreshGateLedger();setGateStatus(`Gate 已完成并保存回执。纳入 ${report.counts.INCLUDE}，复核 ${report.counts.REVIEW}，排除 ${report.counts.EXCLUDE}。`,report.counts.REVIEW?"warning":"success");}
function exportGate(){if(!gateReport||!gateRun)throw new Error("尚未运行 Memory Gate");const manifest={...memoryGateManifest(gateReport),runId:gateRun.id,runHash:gateRun.hash,configVersion:gateRun.config?.version||null,sourceStateVersion:gateRun.sourceStateVersion,sourceStateHash:gateRun.sourceStateHash};const entries=[{name:"memory-gate-manifest.json",data:JSON.stringify(manifest,null,2)+"\n"},{name:"memory-gate-report.json",data:JSON.stringify(gateReport,null,2)+"\n"},{name:"memory-gate-report.md",data:renderMemoryGateMarkdown(gateReport)},{name:"included-memories.json",data:JSON.stringify(gateReport.included,null,2)+"\n"},{name:"excluded-memories.json",data:JSON.stringify(gateReport.excluded,null,2)+"\n"},{name:"review-required.json",data:JSON.stringify(gateReport.reviewRequired,null,2)+"\n"},{name:"gate-config.json",data:JSON.stringify(gateRun.config,null,2)+"\n"}];const bytes=createStoredZip(entries.map((row)=>({name:row.name,data:encoder.encode(row.data)})));download(`KV-Archive-${slug(gateReport.projectTitle)}-Memory-Gate-${gateReport.generatedAt.slice(0,10)}.zip`,bytes);}

async function insertIntoChatGPT(text){const tabs=await chrome.tabs.query({url:["https://chatgpt.com/*","https://chat.openai.com/*"]});const tab=tabs.find((item)=>item.active)||tabs.sort((a,b)=>(b.lastAccessed||0)-(a.lastAccessed||0))[0];if(!tab?.id)throw new Error("请先打开一个 ChatGPT 标签页");const [{result}]=await chrome.scripting.executeScript({target:{tabId:tab.id},args:[text],func:(payload)=>{const editor=document.querySelector('#prompt-textarea')||document.querySelector('textarea[data-id="root"]')||document.querySelector('textarea')||document.querySelector('[contenteditable="true"]');if(!editor)return {ok:false};editor.focus();if(editor instanceof HTMLTextAreaElement){editor.value=payload;editor.dispatchEvent(new Event('input',{bubbles:true}));}else{editor.textContent=payload;editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:payload}));}return {ok:true};}});if(!result?.ok)throw new Error("未找到 ChatGPT 输入框，请打开具体对话后重试");await chrome.tabs.update(tab.id,{active:true});}

el.generate.addEventListener("click",async()=>{el.generate.disabled=true;taskFeedback.start({id:"memory-generate",title:"正在生成项目上下文",detail:"读取当前 Project 的状态、会话、笔记和证据，再按预算整理候选内容。",stage:"读取项目资料",step:0,stepLabels:["读取","整理","比较","可使用"],button:el.generate,buttonLabel:"正在生成…",anchor:memoryAnchor,indeterminate:true});try{await generate();taskFeedback.success({title:"项目上下文已生成",detail:`${displayed?.sources?.length||0} 个来源，约 ${displayed?.estimatedTokens||0} Token；可以复制、插入或审核。`,button:el.generate});}catch(error){const message=error instanceof Error?error.message:String(error);setStatus(message,"error");taskFeedback.fail({title:"项目上下文生成失败",detail:message,button:el.generate});}finally{el.generate.disabled=!el.project.value;}});
el.copy.addEventListener("click",async()=>{await navigator.clipboard.writeText(displayed.markdown);setStatus("已复制到剪贴板。","success");});
el.insert.addEventListener("click",async()=>{taskFeedback.start({id:"memory-insert",title:"正在插入 ChatGPT",detail:"定位已登录标签页与输入框，写入后不会自动发送。",stage:"查找 ChatGPT",step:1,button:el.insert,buttonLabel:"正在插入…",anchor:memoryAnchor,indeterminate:true});try{await insertIntoChatGPT(displayed.markdown);setStatus("已插入 ChatGPT 输入框，请确认后发送。","success");taskFeedback.success({title:"已插入 ChatGPT 输入框",detail:"内容尚未发送，请在 ChatGPT 中检查后自行发送。",button:el.insert});}catch(error){const message=error instanceof Error?error.message:String(error);setStatus(message,"error");taskFeedback.fail({title:"插入失败",detail:message,button:el.insert});}});
el.approve.addEventListener("click",async()=>{if(!candidate)return;taskFeedback.start({id:"memory-approve",title:"正在批准上下文版本",detail:"写入新的不可覆盖版本并刷新版本账本。",stage:"写入版本",step:2,button:el.approve,buttonLabel:"正在批准…",anchor:memoryAnchor,indeterminate:true});try{approved=await store.approveMemoryPackage(candidate,"Approved in Memory Sync Center");await refreshApproved();renderDiff(currentApprovedText(el.mode.value),displayed.markdown);setStatus(`已批准记忆版本 v${approved.version}。`,"success");taskFeedback.success({title:`已批准版本 v${approved.version}`,detail:"旧版本仍保留在版本账本中，可用于审计和恢复。",button:el.approve});}catch(error){const message=error instanceof Error?error.message:String(error);setStatus(message,"error");taskFeedback.fail({title:"批准未完成",detail:message,button:el.approve});}});
el.export.addEventListener("click",()=>{try{const bundle=buildMemoryBundle(approved);download(bundle.filename,bundle.bytes);}catch(error){setStatus(error instanceof Error?error.message:String(error),"error");}});
el["run-gate"].addEventListener("click",async()=>{el["run-gate"].disabled=true;taskFeedback.start({id:"memory-gate",title:"正在运行记忆准入审核",detail:"核验候选内容的范围、证据、敏感度和 Token 预算，不修改已批准状态。",stage:"读取候选",step:0,stepLabels:["读取","审核","保存回执","完成"],button:el["run-gate"],buttonLabel:"正在审核…",anchor:gateAnchor,indeterminate:true});try{await runGate();taskFeedback.success({title:"Memory Gate 已完成",detail:`纳入 ${gateReport?.counts?.INCLUDE||0}，复核 ${gateReport?.counts?.REVIEW||0}，排除 ${gateReport?.counts?.EXCLUDE||0}；回执已保存。`,button:el["run-gate"]});}catch(error){const message=error instanceof Error?error.message:String(error);setGateStatus(message,"error");taskFeedback.fail({title:"Memory Gate 未完成",detail:message,button:el["run-gate"]});}finally{el["run-gate"].disabled=!el.project.value;}});
el["export-gate"].addEventListener("click",()=>{try{exportGate();}catch(error){setGateStatus(error instanceof Error?error.message:String(error),"error");}});
el["gate-runs"].addEventListener("click",async(event)=>{if(event.target.closest("[data-gate-more]")){gateRunLimit+=GATE_RUN_BATCH;await refreshGateLedger();return;}const button=event.target.closest("[data-restore-run]");if(!button)return;try{const config=await store.restoreMemoryGateConfigFromRun(button.dataset.restoreRun);el["gate-policy"].value=config.policy;el["gate-target"].value=config.target;el["gate-budget"].value=String(config.tokenBudget);await refreshGateLedger();setGateStatus(`已从历史回执恢复策略，生成配置 v${config.version}。`,"success");}catch(error){setGateStatus(error instanceof Error?error.message:String(error),"error");}});
el.versions.addEventListener("click",(event)=>{if(!event.target.closest("[data-memory-versions-more]"))return;memoryVersionLimit+=MEMORY_VERSION_BATCH;renderMemoryVersions();});
el.project.addEventListener("change",async()=>{
  gateRunLimit=GATE_RUN_BATCH;
  memoryVersionLimit=MEMORY_VERSION_BATCH;
  candidate=null;displayed=null;gateReport=null;gateRun=null;el.preview.textContent="";
  el.copy.disabled=el.insert.disabled=el.approve.disabled=true;el["export-gate"].disabled=true;
  el["gate-results"].innerHTML='<tr><td colspan="6" class="empty">尚未运行 Memory Gate。</td></tr>';
  try{if(el.project.value)localStorage.setItem(PROJECT_PREF_KEY,el.project.value);else localStorage.removeItem(PROJECT_PREF_KEY);}catch{}
  el["project-help"].textContent=el.project.value?`已选择“${el.project.selectedOptions[0]?.textContent||el.project.value}”。只会使用这个范围的数据。`:"请选择一个 Project，避免不同工作内容互相污染。";
  syncProjectControls();
  await refreshApproved();await refreshGateLedger();
});
el.mode.addEventListener("change",()=>{el.query.disabled=el.mode.value!=="task";});
el.query.disabled=true;
await loadProjects();await refreshApproved();await refreshGateLedger();syncProjectControls();
